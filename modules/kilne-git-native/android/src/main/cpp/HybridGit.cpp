#include "HybridGit.hpp"

#include "GitErrors.hpp"
#include "GitRaii.hpp"

#include <cstring>
#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <unordered_map>
#include <vector>

#include <git2.h>

namespace margelo::nitro::kilne::git {

namespace {

std::once_flag g_libgit2InitOnce;

/** Serialize all libgit2 work on a given repository path. */
std::mutex& mutexForPath(const std::string& path) {
  static std::mutex mapMutex;
  static std::unordered_map<std::string, std::shared_ptr<std::mutex>> locks;
  std::lock_guard<std::mutex> guard(mapMutex);
  auto& entry = locks[path];
  if (!entry) {
    entry = std::make_shared<std::mutex>();
  }
  return *entry;
}

AuthPayload toPayload(const std::optional<GitCredentials>& creds, bool insecure) {
  AuthPayload p;
  p.insecure = insecure;
  if (creds.has_value()) {
    p.username = creds->username;
    p.password = creds->password;
  }
  return p;
}

constexpr unsigned int kIndexStatusMask =
    GIT_STATUS_INDEX_NEW | GIT_STATUS_INDEX_MODIFIED | GIT_STATUS_INDEX_DELETED |
    GIT_STATUS_INDEX_RENAMED | GIT_STATUS_INDEX_TYPECHANGE;

constexpr unsigned int kWorktreeStatusMask =
    GIT_STATUS_WT_NEW | GIT_STATUS_WT_MODIFIED | GIT_STATUS_WT_DELETED |
    GIT_STATUS_WT_TYPECHANGE | GIT_STATUS_WT_RENAMED | GIT_STATUS_WT_UNREADABLE;

/** Convert a `git_status_t` bitmask (index or worktree subset) to the JS enum. */
FileState decodeStatus(unsigned int status) noexcept {
  if (status == 0) return FileState::CURRENT;
  if (status & GIT_STATUS_CONFLICTED) return FileState::CONFLICTED;
  if (status & (GIT_STATUS_INDEX_NEW | GIT_STATUS_WT_NEW)) return FileState::NEW;
  if (status & (GIT_STATUS_INDEX_MODIFIED | GIT_STATUS_WT_MODIFIED)) return FileState::MODIFIED;
  if (status & (GIT_STATUS_INDEX_DELETED | GIT_STATUS_WT_DELETED)) return FileState::DELETED;
  if (status & (GIT_STATUS_INDEX_RENAMED | GIT_STATUS_WT_RENAMED)) return FileState::RENAMED;
  if (status & (GIT_STATUS_INDEX_TYPECHANGE | GIT_STATUS_WT_TYPECHANGE)) return FileState::TYPECHANGE;
  return FileState::CURRENT;
}

const char* deltaPath(const git_diff_delta* delta) noexcept {
  if (delta == nullptr) return nullptr;
  if (delta->new_file.path != nullptr) return delta->new_file.path;
  return delta->old_file.path;
}

RepositoryOwner openRepo(const std::string& path) {
  git_repository* raw = nullptr;
  checkGit(git_repository_open_ext(&raw, path.c_str(),
                                   GIT_REPOSITORY_OPEN_NO_SEARCH, nullptr),
           "open", path);
  if (raw == nullptr) {
    throw GitError("Open", "git_repository_open returned null for: " + path);
  }
  return takeRepo(raw);
}

std::optional<std::string> readHeadBranch(git_repository& repo) {
  git_reference* rawHead = nullptr;
  if (git_repository_head(&rawHead, &repo) != 0 || rawHead == nullptr) {
    return std::nullopt;
  }
  ReferenceOwner head = takeRef(rawHead);
  if (git_reference_is_branch(head.get()) == 0) {
    return std::nullopt;
  }
  const char* branchName = nullptr;
  if (git_branch_name(&branchName, head.get()) != 0 || branchName == nullptr) {
    return std::nullopt;
  }
  return std::string(branchName);
}

std::optional<std::string> resolveUpstream(git_repository& repo) {
  ReferenceOwner head(nullptr, GitPtrDeleters::reference);
  git_reference* rawHead = nullptr;
  if (git_repository_head(&rawHead, &repo) != 0 || rawHead == nullptr) {
    return std::nullopt;
  }
  head = takeRef(rawHead);

  git_reference* rawUpstream = nullptr;
  if (git_branch_upstream(&rawUpstream, head.get()) != 0 || rawUpstream == nullptr) {
    return std::nullopt;
  }
  ReferenceOwner upstream = takeRef(rawUpstream);
  const char* name = git_reference_name(upstream.get());
  if (name == nullptr) {
    return std::nullopt;
  }
  return std::string(name);
}

/** Prefer configured upstream; otherwise fall back to refs/remotes/origin/<branch>. */
std::string resolveUpstreamOrFallback(git_repository& repo) {
  auto upstream = resolveUpstream(repo);
  if (upstream.has_value()) {
    return *upstream;
  }
  auto branch = readHeadBranch(repo);
  if (!branch.has_value()) {
    throw GitError("Fetch", "No upstream configured and HEAD is detached.");
  }
  return "refs/remotes/origin/" + *branch;
}

std::string remoteNameFromUpstream(const std::string& upstreamRef) {
  constexpr const char* kRemotePrefix = "refs/remotes/";
  if (upstreamRef.rfind(kRemotePrefix, 0) != 0) {
    return "origin";
  }
  const std::string afterPrefix = upstreamRef.substr(std::strlen(kRemotePrefix));
  const auto slashPos = afterPrefix.find('/');
  if (slashPos == std::string::npos) {
    return "origin";
  }
  return afterPrefix.substr(0, slashPos);
}

std::string branchNameFromUpstream(const std::string& upstreamRef) {
  constexpr const char* kRemotePrefix = "refs/remotes/";
  if (upstreamRef.rfind(kRemotePrefix, 0) != 0) {
    throw GitError("Fetch", "Upstream ref is not under refs/remotes/: " + upstreamRef);
  }
  const std::string afterPrefix = upstreamRef.substr(std::strlen(kRemotePrefix));
  const auto slashPos = afterPrefix.find('/');
  if (slashPos == std::string::npos) {
    throw GitError("Fetch", "Cannot parse remote/branch from upstream: " + upstreamRef);
  }
  return afterPrefix.substr(slashPos + 1);
}

AnnotatedCommitOwner fetchUpstream(git_repository& repo, const AuthPayload& auth) {
  const std::string upstreamRef = resolveUpstreamOrFallback(repo);
  const std::string remoteName = remoteNameFromUpstream(upstreamRef);
  const std::string branchName = branchNameFromUpstream(upstreamRef);

  git_remote* rawRemote = nullptr;
  checkGit(git_remote_lookup(&rawRemote, &repo, remoteName.c_str()), "lookup-remote", remoteName);
  RemoteOwner remote = takeRemote(rawRemote);

  AuthPayload authCopy = auth;
  git_fetch_options fetchOpts;
  checkGit(git_fetch_options_init(&fetchOpts, GIT_FETCH_OPTIONS_VERSION), "fetch-init");
  applyAuth(fetchOpts.callbacks, authCopy);

  const std::string refspecStr =
      "+refs/heads/" + branchName + ":refs/remotes/" + remoteName + "/" + branchName;
  const char* refspec = refspecStr.c_str();
  git_strarray refspecs = {const_cast<char**>(&refspec), 1};
  checkGit(git_remote_fetch(remote.get(), &refspecs, &fetchOpts, "kilne-git pull"), "fetch", branchName);

  git_annotated_commit* rawAnnotated = nullptr;
  checkGit(git_annotated_commit_from_revspec(&rawAnnotated, &repo, upstreamRef.c_str()),
           "lookup-upstream-commit", upstreamRef);
  return takeAnnotated(rawAnnotated);
}

std::string oidToHex(const git_oid* oid) {
  char buf[GIT_OID_SHA1_HEXSIZE + 1] = {0};
  git_oid_tostr(buf, sizeof(buf), oid);
  return std::string(buf);
}

StatusResult buildStatus(git_repository& repo) {
  git_status_options opts;
  git_status_options_init(&opts, GIT_STATUS_OPTIONS_VERSION);
  opts.show = GIT_STATUS_SHOW_INDEX_AND_WORKDIR;
  opts.flags =
      GIT_STATUS_OPT_INCLUDE_UNTRACKED |
      GIT_STATUS_OPT_RECURSE_UNTRACKED_DIRS |
      GIT_STATUS_OPT_RENAMES_HEAD_TO_INDEX |
      GIT_STATUS_OPT_RENAMES_INDEX_TO_WORKDIR |
      GIT_STATUS_OPT_SORT_CASE_SENSITIVELY;
  opts.rename_threshold = 50;

  git_status_list* rawList = nullptr;
  checkGit(git_status_list_new(&rawList, &repo, &opts), "status-list");
  StatusListOwner list = takeStatus(rawList);

  StatusResult result{};
  result.isClean = true;
  result.ahead = 0;
  result.behind = 0;
  result.staged = {};
  result.working = {};
  result.untracked = {};
  result.conflicted = {};
  result.head = std::nullopt;
  result.upstream = std::nullopt;

  const std::size_t count = git_status_list_entrycount(list.get());
  for (std::size_t i = 0; i < count; ++i) {
    const git_status_entry* entry = git_status_byindex(list.get(), i);
    if (entry == nullptr) {
      continue;
    }

    const char* path = deltaPath(entry->head_to_index);
    if (path == nullptr) {
      path = deltaPath(entry->index_to_workdir);
    }
    if (path == nullptr) {
      continue;
    }

    const unsigned int status = entry->status;
    FileStatusEntry fe{
        /*path=*/std::string(path),
        /*worktree=*/decodeStatus(status & kWorktreeStatusMask),
        /*index=*/decodeStatus(status & kIndexStatusMask),
    };
    if ((status & GIT_STATUS_CONFLICTED) != 0) {
      fe.worktree = FileState::CONFLICTED;
      fe.index = FileState::CONFLICTED;
    }

    const bool isStaged = (status & kIndexStatusMask) != 0;
    const bool isWorking =
        (status & (GIT_STATUS_WT_MODIFIED | GIT_STATUS_WT_DELETED |
                   GIT_STATUS_WT_TYPECHANGE | GIT_STATUS_WT_RENAMED |
                   GIT_STATUS_WT_UNREADABLE)) != 0;
    const bool isUntracked = (status & GIT_STATUS_WT_NEW) != 0;
    const bool isConflict = (status & GIT_STATUS_CONFLICTED) != 0;

    if (isStaged) result.staged.push_back(fe);
    if (isWorking) result.working.push_back(fe);
    if (isUntracked) result.untracked.push_back(std::string(path));
    if (isConflict) result.conflicted.push_back(std::string(path));
    if (status != GIT_STATUS_CURRENT) result.isClean = false;
  }

  result.head = readHeadBranch(repo);
  auto upstream = resolveUpstream(repo);
  if (upstream.has_value()) {
    result.upstream = upstream;
  }

  git_oid localOid{};
  git_oid upstreamOid{};
  if (git_reference_name_to_id(&localOid, &repo, "HEAD") == 0 && upstream.has_value() &&
      git_reference_name_to_id(&upstreamOid, &repo, upstream->c_str()) == 0) {
    size_t ahead = 0;
    size_t behind = 0;
    if (git_graph_ahead_behind(&ahead, &behind, &repo, &localOid, &upstreamOid) == 0) {
      result.ahead = static_cast<double>(ahead);
      result.behind = static_cast<double>(behind);
    }
  }

  return result;
}

PushResult pushHead(git_repository& repo, const AuthPayload& auth) {
  const std::string upstreamRef = resolveUpstreamOrFallback(repo);
  const std::string remoteName = remoteNameFromUpstream(upstreamRef);

  git_remote* rawRemote = nullptr;
  checkGit(git_remote_lookup(&rawRemote, &repo, remoteName.c_str()),
           "lookup-remote", remoteName);
  RemoteOwner remote = takeRemote(rawRemote);

  AuthPayload authCopy = auth;
  git_push_options pushOpts;
  git_push_options_init(&pushOpts, GIT_PUSH_OPTIONS_VERSION);
  applyAuth(pushOpts.callbacks, authCopy);

  auto headBranch = readHeadBranch(repo);
  if (!headBranch.has_value()) {
    throw GitError("Push", "Cannot push: detached HEAD.");
  }
  // Non-force refspec — refuse non-fast-forward updates on the remote.
  const std::string pushSpec = "refs/heads/" + *headBranch + ":refs/heads/" + *headBranch;
  char* specStr = const_cast<char*>(pushSpec.c_str());
  git_strarray pushRefs = {&specStr, 1};
  checkGit(git_remote_push(remote.get(), &pushRefs, &pushOpts), "push", pushSpec);

  PushResult result{};
  result.pushed = true;
  result.updated = true;
  return result;
}

SignatureOwner makeAuthorSignature(git_repository& repo,
                                   const std::optional<CommitAndInsecureOptions>& options) {
  std::string authorName = "kilne-git";
  std::string authorEmail = "kilne-git@localhost";
  if (options.has_value()) {
    if (options->authorName.has_value()) authorName = *options->authorName;
    if (options->authorEmail.has_value()) authorEmail = *options->authorEmail;
  }

  git_signature* rawSig = nullptr;
  if (options.has_value() &&
      (options->authorName.has_value() || options->authorEmail.has_value())) {
    checkGit(git_signature_now(&rawSig, authorName.c_str(), authorEmail.c_str()),
             "signature-author", "");
  } else if (git_signature_default(&rawSig, &repo) != 0) {
    checkGit(git_signature_now(&rawSig, authorName.c_str(), authorEmail.c_str()),
             "signature-author-default", "");
  }
  return takeSig(rawSig);
}

SignatureOwner makeCommitterSignature(git_repository& repo,
                                      const std::optional<CommitAndInsecureOptions>& options,
                                      const git_signature* authorFallback) {
  if (options.has_value() &&
      (options->committerName.has_value() || options->committerEmail.has_value())) {
    const std::string name = options->committerName.value_or(
        authorFallback != nullptr ? std::string(authorFallback->name) : "kilne-git");
    const std::string email = options->committerEmail.value_or(
        authorFallback != nullptr ? std::string(authorFallback->email) : "kilne-git@localhost");
    git_signature* rawSig = nullptr;
    checkGit(git_signature_now(&rawSig, name.c_str(), email.c_str()), "signature-committer", "");
    return takeSig(rawSig);
  }
  // Same identity as author when committer overrides are omitted.
  git_signature* rawDup = nullptr;
  checkGit(git_signature_dup(&rawDup, authorFallback), "signature-committer-dup", "");
  return takeSig(rawDup);
}

}  // namespace

HybridGit::HybridGit() {
  std::call_once(g_libgit2InitOnce, []() {
    const int rc = git_libgit2_init();
    if (rc < 0) {
      throwGitError("Init", "git_libgit2_init() failed", rc);
    }
  });
  _initialised.store(true, std::memory_order_release);
}

HybridGit::~HybridGit() {
  if (_initialised.exchange(false, std::memory_order_acq_rel)) {
    // Intentionally do not call git_libgit2_shutdown() — process lifetime matches
    // the JS runtime and other code may still hold libgit2 state.
  }
}

std::string HybridGit::getVersion() {
  return std::string(LIBGIT2_VERSION);
}

std::shared_ptr<Promise<std::string>> HybridGit::init(const std::string& localPath) {
  return Promise<std::string>::async([localPath]() {
    std::lock_guard<std::mutex> lock(mutexForPath(localPath));
    git_repository* raw = nullptr;
    checkGit(git_repository_init(&raw, localPath.c_str(), 0 /*bare=false*/),
             "init", localPath);
    auto repo = takeRepo(raw);
    const char* workdir = git_repository_workdir(repo.get());
    if (workdir == nullptr) {
      throw GitError("Init", "git_repository_workdir returned null after init");
    }
    return std::string(workdir);
  });
}

std::shared_ptr<Promise<CloneResult>> HybridGit::clone(
    const std::string& url,
    const std::string& localPath,
    const std::optional<GitCredentials>& credentials,
    const std::optional<CloneOptions>& options) {
  return Promise<CloneResult>::async(
      [url, localPath, credentials, options]() {
        std::lock_guard<std::mutex> lock(mutexForPath(localPath));

        git_clone_options cloneOpts;
        checkGit(git_clone_options_init(&cloneOpts, GIT_CLONE_OPTIONS_VERSION), "clone-init");

        std::string branchOwned;
        if (options.has_value()) {
          if (options->branch.has_value()) {
            branchOwned = *options->branch;
            cloneOpts.checkout_branch = branchOwned.c_str();
          }
          if (options->depth.has_value() && *options->depth > 0) {
            cloneOpts.fetch_opts.depth = static_cast<unsigned int>(*options->depth);
          }
        }

        const bool insecure =
            options.has_value() && options->insecure.value_or(false);
        AuthPayload auth = toPayload(credentials, insecure);
        applyAuth(cloneOpts.fetch_opts.callbacks, auth);

        git_repository* raw = nullptr;
        checkGit(git_clone(&raw, url.c_str(), localPath.c_str(), &cloneOpts), "clone", url);
        auto repo = takeRepo(raw);

        CloneResult result{};
        result.path = localPath;
        result.branch = branchOwned.empty() ? "HEAD" : branchOwned;
        result.receivedObjects = 0;
        return result;
      });
}

std::shared_ptr<Promise<PullResult>> HybridGit::pull(
    const std::string& localPath,
    const std::optional<GitCredentials>& credentials,
    const std::optional<InsecureOptions>& options) {
  return Promise<PullResult>::async(
      [localPath, credentials, options]() {
        std::lock_guard<std::mutex> lock(mutexForPath(localPath));
        auto repo = openRepo(localPath);
        AuthPayload auth = toPayload(credentials, options.has_value() && options->insecure.value_or(false));

        AnnotatedCommitOwner upstreamCommit = fetchUpstream(*repo, auth);

        git_oid localOid{};
        checkGit(git_reference_name_to_id(&localOid, repo.get(), "HEAD"), "resolve-head", "HEAD");
        const git_oid* upstreamOid = git_annotated_commit_id(upstreamCommit.get());

        size_t ahead = 0;
        size_t behind = 0;
        checkGit(git_graph_ahead_behind(&ahead, &behind, repo.get(), &localOid, upstreamOid),
                 "ahead-behind", "");

        PullResult result{};
        result.fastForwarded = false;
        result.merged = false;
        result.commitsFetched = static_cast<double>(behind);
        result.conflicted = {};

        if (behind == 0) {
          return result;
        }

        if (ahead == 0) {
          const git_oid* target = git_annotated_commit_id(upstreamCommit.get());
          auto branch = readHeadBranch(*repo);
          if (!branch.has_value()) {
            throw GitError("Pull", "Cannot fast-forward: detached HEAD.");
          }
          const std::string branchRef = "refs/heads/" + *branch;
          checkGit(git_reference_create(nullptr, repo.get(), branchRef.c_str(),
                                        target, /*force=*/1, "kilne-git pull"),
                   "fast-forward-ref", *branch);
          checkGit(git_repository_set_head(repo.get(), branchRef.c_str()),
                   "fast-forward-set-head", *branch);
          git_checkout_options coOpts;
          git_checkout_options_init(&coOpts, GIT_CHECKOUT_OPTIONS_VERSION);
          coOpts.checkout_strategy = GIT_CHECKOUT_SAFE;
          checkGit(git_checkout_head(repo.get(), &coOpts), "fast-forward-checkout-head", "");
          result.fastForwarded = true;
          return result;
        }

        const git_annotated_commit* heads[] = {upstreamCommit.get()};
        git_merge_options mergeOpts;
        git_merge_options_init(&mergeOpts, GIT_MERGE_OPTIONS_VERSION);
        git_checkout_options checkoutOpts;
        git_checkout_options_init(&checkoutOpts, GIT_CHECKOUT_OPTIONS_VERSION);
        checkoutOpts.checkout_strategy = GIT_CHECKOUT_SAFE;
        checkGit(git_merge(repo.get(), heads, 1, &mergeOpts, &checkoutOpts), "merge", "");

        IndexOwner index(nullptr, GitPtrDeleters::index);
        git_index* rawIndex = nullptr;
        checkGit(git_repository_index(&rawIndex, repo.get()), "merge-index", "");
        index = takeIndex(rawIndex);

        if (git_index_has_conflicts(index.get())) {
          git_index_conflict_iterator* it = nullptr;
          if (git_index_conflict_iterator_new(&it, index.get()) == 0) {
            const git_index_entry* ancestor = nullptr;
            const git_index_entry* ours = nullptr;
            const git_index_entry* theirs = nullptr;
            while (git_index_conflict_next(&ancestor, &ours, &theirs, it) == 0) {
              if (theirs != nullptr && theirs->path != nullptr) {
                result.conflicted.push_back(theirs->path);
              } else if (ours != nullptr && ours->path != nullptr) {
                result.conflicted.push_back(ours->path);
              }
            }
            git_index_conflict_iterator_free(it);
          }
          // Leave merge state on disk so the user can resolve conflicts.
          return result;
        }

        git_signature* rawSig = nullptr;
        if (git_signature_default(&rawSig, repo.get()) != 0) {
          checkGit(git_signature_now(&rawSig, "kilne-git", "kilne-git@localhost"),
                   "merge-signature", "");
        }
        SignatureOwner sig = takeSig(rawSig);

        git_oid treeOid{};
        checkGit(git_index_write_tree(&treeOid, index.get()), "merge-write-tree", "");
        checkGit(git_index_write(index.get()), "merge-index-write", "");
        git_tree* rawTree = nullptr;
        checkGit(git_tree_lookup(&rawTree, repo.get(), &treeOid), "merge-lookup-tree", "");
        TreeOwner tree = takeTree(rawTree);

        git_commit* rawHeadCommit = nullptr;
        checkGit(git_commit_lookup(&rawHeadCommit, repo.get(), &localOid), "merge-head", "");
        CommitOwner headCommit = takeCommit(rawHeadCommit);

        const git_oid* upstreamCommitOid = git_annotated_commit_id(upstreamCommit.get());
        git_commit* rawUpstreamCommit = nullptr;
        checkGit(git_commit_lookup(&rawUpstreamCommit, repo.get(), upstreamCommitOid),
                 "merge-upstream", "");
        CommitOwner upstreamCommitObj = takeCommit(rawUpstreamCommit);

        const git_commit* parents[] = {headCommit.get(), upstreamCommitObj.get()};
        git_oid commitOid{};
        checkGit(git_commit_create(&commitOid, repo.get(), "HEAD",
                                   sig.get(), sig.get(), nullptr,
                                   "Merge upstream", tree.get(), 2, parents),
                 "merge-commit", "");
        checkGit(git_repository_state_cleanup(repo.get()), "merge-cleanup", "");
        result.merged = true;
        return result;
      });
}

std::shared_ptr<Promise<CommitAndPushResult>> HybridGit::commitAllAndPush(
    const std::string& localPath,
    const std::string& message,
    const std::optional<GitCredentials>& credentials,
    const std::optional<CommitAndInsecureOptions>& options) {
  return Promise<CommitAndPushResult>::async(
      [localPath, message, credentials, options]() {
        std::lock_guard<std::mutex> lock(mutexForPath(localPath));
        auto repo = openRepo(localPath);

        git_index* rawIndex = nullptr;
        checkGit(git_repository_index(&rawIndex, repo.get()), "index", "");
        IndexOwner index = takeIndex(rawIndex);

        git_strarray paths = {nullptr, 0};
        checkGit(git_index_add_all(index.get(), &paths, 0, nullptr, nullptr), "add-all", "");
        checkGit(git_index_write(index.get()), "index-write", "");

        // HEAD points at a commit OID — resolve to its tree for the diff.
        git_oid headCommitOid{};
        const bool hasHead =
            git_reference_name_to_id(&headCommitOid, repo.get(), "HEAD") == 0;

        CommitOwner parentCommit(nullptr, GitPtrDeleters::commit);
        TreeOwner headTree(nullptr, GitPtrDeleters::tree);
        if (hasHead) {
          git_commit* rawParent = nullptr;
          checkGit(git_commit_lookup(&rawParent, repo.get(), &headCommitOid), "lookup-parent", "");
          parentCommit = takeCommit(rawParent);
          git_tree* rawHeadTree = nullptr;
          checkGit(git_commit_tree(&rawHeadTree, parentCommit.get()), "head-tree", "");
          headTree = takeTree(rawHeadTree);
        }

        git_diff_options diffOpts;
        git_diff_options_init(&diffOpts, GIT_DIFF_OPTIONS_VERSION);
        git_diff* rawDiff = nullptr;
        checkGit(git_diff_tree_to_index(&rawDiff, repo.get(),
                                        hasHead ? headTree.get() : nullptr,
                                        index.get(), &diffOpts),
                 "diff", "");
        const size_t filesChanged = git_diff_num_deltas(rawDiff);
        git_diff_free(rawDiff);

        CommitResult commitResult{};
        commitResult.sha = std::nullopt;
        commitResult.filesChanged = static_cast<double>(filesChanged);

        if (filesChanged > 0) {
          git_oid newTreeOid{};
          checkGit(git_index_write_tree(&newTreeOid, index.get()), "write-tree", "");
          git_tree* rawNewTree = nullptr;
          checkGit(git_tree_lookup(&rawNewTree, repo.get(), &newTreeOid), "lookup-tree", "");
          TreeOwner newTree = takeTree(rawNewTree);

          SignatureOwner author = makeAuthorSignature(*repo, options);
          SignatureOwner committer = makeCommitterSignature(*repo, options, author.get());

          std::vector<const git_commit*> parentPtrs;
          if (hasHead) {
            parentPtrs.push_back(parentCommit.get());
          }

          git_oid commitOid{};
          checkGit(git_commit_create(&commitOid, repo.get(), "HEAD",
                                     author.get(), committer.get(), nullptr,
                                     message.c_str(), newTree.get(),
                                     parentPtrs.size(), parentPtrs.data()),
                   "commit-create", "");
          commitResult.sha = oidToHex(&commitOid);
        }

        AuthPayload auth =
            toPayload(credentials, options.has_value() && options->insecure.value_or(false));
        PushResult pushResult = pushHead(*repo, auth);

        CommitAndPushResult combined{};
        combined.commit = commitResult;
        combined.push = pushResult;
        return combined;
      });
}

std::shared_ptr<Promise<PushResult>> HybridGit::push(
    const std::string& localPath,
    const std::optional<GitCredentials>& credentials,
    const std::optional<InsecureOptions>& options) {
  return Promise<PushResult>::async(
      [localPath, credentials, options]() {
        std::lock_guard<std::mutex> lock(mutexForPath(localPath));
        auto repo = openRepo(localPath);
        AuthPayload auth = toPayload(credentials, options.has_value() && options->insecure.value_or(false));
        return pushHead(*repo, auth);
      });
}

std::shared_ptr<Promise<StatusResult>> HybridGit::status(const std::string& localPath) {
  return Promise<StatusResult>::async([localPath]() {
    std::lock_guard<std::mutex> lock(mutexForPath(localPath));
    auto repo = openRepo(localPath);
    return buildStatus(*repo);
  });
}

std::shared_ptr<Promise<bool>> HybridGit::isRepository(const std::string& localPath) {
  return Promise<bool>::async([localPath]() {
    git_repository* raw = nullptr;
    const int rc = git_repository_open_ext(&raw, localPath.c_str(),
                                           GIT_REPOSITORY_OPEN_NO_SEARCH, nullptr);
    if (raw != nullptr) {
      git_repository_free(raw);
    }
    return rc == 0;
  });
}

}  // namespace margelo::nitro::kilne::git
