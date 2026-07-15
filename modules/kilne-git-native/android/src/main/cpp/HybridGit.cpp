#include "HybridGit.hpp"

#include "GitErrors.hpp"
#include "GitRaii.hpp"

#include <algorithm>
#include <chrono>
#include <cstring>
#include <memory>
#include <mutex>
#include <sstream>
#include <string>
#include <vector>

#include <git2.h>

namespace margelo::nitro::kilne::git {

namespace {

// Global libgit2 refcount — multiple HybridGit instances can coexist safely.
std::once_flag g_libgit2InitOnce;

/** Resolve a `GitCredentials` optional into an `AuthPayload` ready for callbacks. */
AuthPayload toPayload(const std::optional<GitCredentials>& creds, bool insecure) {
  AuthPayload p;
  p.insecure = insecure;
  if (creds.has_value()) {
    p.username = creds->username;
    p.password = creds->password;
  }
  return p;
}

/** Convert a `git_status_t` bitmask entry to the simplified JS enum. */
FileState decodeStatus(unsigned int status) noexcept {
  // GIT_STATUS_CURRENT == 0 by definition; never passed here.
  if (status & GIT_STATUS_INDEX_NEW || status & GIT_STATUS_WT_NEW)              return FileState::NEW;
  if (status & GIT_STATUS_INDEX_MODIFIED || status & GIT_STATUS_WT_MODIFIED)    return FileState::MODIFIED;
  if (status & GIT_STATUS_INDEX_DELETED || status & GIT_STATUS_WT_DELETED)      return FileState::DELETED;
  if (status & GIT_STATUS_INDEX_RENAMED || status & GIT_STATUS_WT_RENAMED)      return FileState::RENAMED;
  if (status & GIT_STATUS_INDEX_TYPECHANGE || status & GIT_STATUS_WT_TYPECHANGE) return FileState::TYPECHANGE;
  if (status & GIT_STATUS_CONFLICTED)                                            return FileState::CONFLICTED;
  return FileState::CURRENT;
}

/** Open a repository or throw. Always returns a valid owner. */
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

/**
 * Look up the configured upstream for `head` (e.g. "origin/main").
 * Returns an empty optional when no upstream is set.
 */
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
  return std::string(name);  // full refname, e.g. "refs/remotes/origin/main"
}

/** Read the short branch name currently checked out (or null for detached HEAD). */
std::optional<std::string> readHeadBranch(git_repository& repo) {
  git_reference* rawHead = nullptr;
  if (git_repository_head(&rawHead, &repo) != 0 || rawHead == nullptr) {
    return std::nullopt;
  }
  ReferenceOwner head = takeRef(rawHead);
  if (git_reference_is_branch(head.get()) == 0) {
    return std::nullopt;  // detached HEAD
  }
  const char* branchName = nullptr;
  if (git_branch_name(&branchName, head.get()) != 0 || branchName == nullptr) {
    return std::nullopt;
  }
  return std::string(branchName);
}

/**
 * Fetch from upstream and return the annotated commit of FETCH_HEAD.
 * Performs a network round-trip. Throws on auth / network failures.
 */
AnnotatedCommitOwner fetchUpstream(git_repository& repo, const AuthPayload& auth) {
  auto upstream = resolveUpstream(repo);
  if (!upstream.has_value()) {
    throw GitError("Fetch", "No upstream is configured for the current branch.");
  }
  const std::string& upstreamRef = *upstream;
  constexpr const char* kRemotePrefix = "refs/remotes/";
  if (upstreamRef.rfind(kRemotePrefix, 0) != 0) {
    throw GitError("Fetch", "Upstream ref is not under refs/remotes/: " + upstreamRef);
  }
  // Split "refs/remotes/<remote>/<branch>" into remote + branch.
  const std::string afterPrefix = upstreamRef.substr(std::strlen(kRemotePrefix));
  const auto slashPos = afterPrefix.find('/');
  if (slashPos == std::string::npos) {
    throw GitError("Fetch", "Cannot parse remote/branch from upstream: " + upstreamRef);
  }
  const std::string remoteName = afterPrefix.substr(0, slashPos);
  const std::string branchName = afterPrefix.substr(slashPos + 1);

  git_remote* rawRemote = nullptr;
  checkGit(git_remote_lookup(&rawRemote, &repo, remoteName.c_str()), "lookup-remote", remoteName);
  RemoteOwner remote = takeRemote(rawRemote);

  AuthPayload authCopy = auth;  // libgit2 calls may mutate attempts counter
  git_fetch_options fetchOpts;
  checkGit(git_fetch_options_init(&fetchOpts, GIT_FETCH_OPTIONS_VERSION), "fetch-init");
  applyAuth(fetchOpts.callbacks, authCopy);
  // Always update FETCH_HEAD so we can resolve the merge target.
  const std::string refspecStr =
      "+refs/heads/" + branchName + ":refs/remotes/" + remoteName + "/" + branchName;
  const char* refspec = refspecStr.c_str();
  git_strarray refspecs = {const_cast<char**>(&refspec), 1};
  checkGit(git_remote_fetch(remote.get(), &refspecs, &fetchOpts, "kilne-git pull"), "fetch", branchName);

  // Find the OID of the upstream branch we just fetched.
  git_annotated_commit* rawAnnotated = nullptr;
  checkGit(git_annotated_commit_from_refname(&rawAnnotated, &repo, upstreamRef.c_str()),
           "lookup-upstream-commit", upstreamRef);
  return takeAnnotated(rawAnnotated);
}

/**
 * Convert a `git_oid` to its hex string representation.
 */
std::string oidToHex(const git_oid* oid) {
  char buf[GIT_OID_SHA1_HEXSIZE + 1] = {0};
  git_oid_tostr(buf, sizeof(buf), oid);
  return std::string(buf);
}

/**
 * Build a `StatusResult` from the current repository state. Reads both the
 * status list and ahead/behind counts relative to upstream.
 */
StatusResult buildStatus(git_repository& repo) {
  git_status_options opts;
  git_status_options_init(&opts, GIT_STATUS_OPTIONS_VERSION);
  opts.show = GIT_STATUS_SHOW_INDEX_AND_WORKDIR;
  opts.flags =
      GIT_STATUS_OPT_INCLUDE_UNTRACKED |
      GIT_STATUS_OPT_RECURSE_UNTRACKED_DIRS |
      GIT_STATUS_OPT_RENAMES_HEAD_TO_INDEX |
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
    if (entry == nullptr || entry->head_to_index == nullptr) {
      // Defensive: untracked files have head_to_index == NULL but status == WT_NEW.
      if (entry != nullptr && entry->status == GIT_STATUS_WT_NEW && entry->path != nullptr) {
        result.untracked.push_back(entry->path);
        result.isClean = false;
      }
      continue;
    }
    const char* path = entry->head_to_index->old_file.path != nullptr
                           ? entry->head_to_index->old_file.path
                           : entry->head_to_index->new_file.path;
    if (path == nullptr && entry->path != nullptr) {
      path = entry->path;
    }
    if (path == nullptr) {
      continue;
    }
    const unsigned int status = entry->status;
    FileStatusEntry fe{
        /*path=*/std::string(path),
        /*worktree=*/decodeStatus(status & 0xFFFF0000u),  // WT_* bits live high
        /*index=*/decodeStatus(status & 0x0000FFFFu),
    };

    bool isStaged = (status & (GIT_STATUS_INDEX_NEW | GIT_STATUS_INDEX_MODIFIED |
                               GIT_STATUS_INDEX_DELETED | GIT_STATUS_INDEX_RENAMED |
                               GIT_STATUS_INDEX_TYPECHANGE)) != 0;
    bool isWorking = (status & (GIT_STATUS_WT_MODIFIED | GIT_STATUS_WT_DELETED |
                                GIT_STATUS_WT_TYPECHANGE | GIT_STATUS_WT_RENAMED)) != 0;
    bool isUntracked = (status & GIT_STATUS_WT_NEW) != 0;
    bool isConflict = (status & GIT_STATUS_CONFLICTED) != 0;

    if (isStaged)   result.staged.push_back(fe);
    if (isWorking)  result.working.push_back(fe);
    if (isUntracked) result.untracked.push_back(std::string(path));
    if (isConflict) result.conflicted.push_back(std::string(path));
    if (status != GIT_STATUS_CURRENT) result.isClean = false;
  }

  // Branch + upstream info
  result.head = readHeadBranch(repo);
  auto upstream = resolveUpstream(repo);
  if (upstream.has_value()) {
    result.upstream = upstream;  // full refname like "refs/remotes/origin/main"
  }

  // Ahead / behind counts
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
    // NB: we intentionally do NOT call git_libgit2_shutdown() because the
    // process lives only as long as the JS runtime and other code might still
    // hold libgit2 state. libgit2 cleans up at process exit anyway.
  }
}

std::string HybridGit::getVersion() {
  return std::string(LIBGIT2_VERSION);
}

// ----------------------------------------------------------------------------
// init
// ----------------------------------------------------------------------------
std::shared_ptr<Promise<std::string>> HybridGit::init(const std::string& localPath) {
  return Promise<std::string>::async([localPath](const std::shared_ptr<PromiseRuntime>& /*rt*/) {
    git_repository* raw = nullptr;
    checkGit(git_repository_init(&raw, localPath.c_str(), 0 /*bare=false*/),
             "init", localPath);
    auto repo = takeRepo(raw);
    char* resolved = git_repository_path(repo.get());
    if (resolved == nullptr) {
      throw GitError("Init", "git_repository_path returned null after init");
    }
    return std::string(resolved);
  });
}

// ----------------------------------------------------------------------------
// clone
// ----------------------------------------------------------------------------
std::shared_ptr<Promise<CloneResult>> HybridGit::clone(
    const std::string& url,
    const std::string& localPath,
    const std::optional<GitCredentials>& credentials,
    const std::optional<CloneOptions>& options) {
  return Promise<CloneResult>::async(
      [url, localPath, credentials, options](const std::shared_ptr<PromiseRuntime>& /*rt*/) {
        git_clone_options cloneOpts;
        checkGit(git_clone_options_init(&cloneOpts, GIT_CLONE_OPTIONS_VERSION), "clone-init");
        if (options.has_value()) {
          if (options->branch.has_value()) {
            cloneOpts.checkout_branch = options->branch->c_str();
          }
          if (options->depth.has_value() && *options->depth > 0) {
            cloneOpts.fetch_opts.depth = static_cast<unsigned int>(*options->depth);
          }
          const bool insecure = options->insecure.value_or(false);
          if (insecure) {
            AuthPayload auth = toPayload(credentials, true);
            applyAuth(cloneOpts.fetch_opts.callbacks, auth);
            git_repository* raw = nullptr;
            checkGit(git_clone(&raw, url.c_str(), localPath.c_str(), &cloneOpts), "clone", url);
            auto repo = takeRepo(raw);
            CloneResult result{};
            result.path = localPath;
            result.branch = options->branch.value_or("HEAD");
            result.receivedObjects = 0;
            return result;
          }
        }
        AuthPayload auth = toPayload(credentials, false);
        applyAuth(cloneOpts.fetch_opts.callbacks, auth);

        git_repository* raw = nullptr;
        checkGit(git_clone(&raw, url.c_str(), localPath.c_str(), &cloneOpts), "clone", url);
        auto repo = takeRepo(raw);

        CloneResult result{};
        result.path = localPath;
        // libgit2 doesn't surface the checkout branch name directly; use what
        // we asked for, or HEAD.
        result.branch = options->branch.value_or("HEAD");
        result.receivedObjects = 0;
        return result;
      });
}

// ----------------------------------------------------------------------------
// pull
// ----------------------------------------------------------------------------
std::shared_ptr<Promise<PullResult>> HybridGit::pull(
    const std::string& localPath,
    const std::optional<GitCredentials>& credentials,
    const std::optional<InsecureOptions>& options) {
  return Promise<PullResult>::async(
      [localPath, credentials, options](const std::shared_ptr<PromiseRuntime>& /*rt*/) {
        auto repo = openRepo(localPath);
        AuthPayload auth = toPayload(credentials, options.has_value() && options->insecure.value_or(false));

        AnnotatedCommitOwner upstreamCommit = fetchUpstream(*repo, auth);

        // Compare upstream and local HEAD to decide what to do.
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
          // Nothing to integrate — already up to date.
          return result;
        }

        // Try fast-forward first.
        if (ahead == 0) {
          // Move the local branch ref to upstream's commit, then check it out.
          const git_oid* target = git_annotated_commit_id(upstreamCommit.get());
          auto branch = readHeadBranch(*repo);
          if (!branch.has_value()) {
            throw GitError("Pull", "Cannot fast-forward: detached HEAD.");
          }
          checkGit(git_reference_create(nullptr, repo.get(),
                                        ("refs/heads/" + *branch).c_str(),
                                        target, /*force=*/1, "kilne-git pull"),
                   "fast-forward-ref", *branch);
          checkGit(git_repository_set_head(repo.get(),
                                           ("refs/heads/" + *branch).c_str()),
                   "fast-forward-set-head", *branch);
          git_checkout_options coOpts;
          git_checkout_options_init(&coOpts, GIT_CHECKOUT_OPTIONS_VERSION);
          coOpts.checkout_strategy = GIT_CHECKOUT_SAFE;
          checkGit(git_checkout_head(repo.get(), &coOpts), "fast-forward-checkout-head", "");
          result.fastForwarded = true;
          return result;
        }

        // Diverged — perform a real merge.
        const git_annotated_commit* heads[] = {upstreamCommit.get()};
        git_merge_options mergeOpts;
        git_merge_options_init(&mergeOpts, GIT_MERGE_OPTIONS_VERSION);
        git_checkout_options checkoutOpts;
        git_checkout_options_init(&checkoutOpts, GIT_CHECKOUT_OPTIONS_VERSION);
        checkoutOpts.checkout_strategy = GIT_CHECKOUT_SAFE;
        checkGit(git_merge(repo.get(), heads, 1, &mergeOpts, &checkoutOpts),
                 "merge", "");

        // Detect conflicts.
        IndexOwner index(nullptr, GitPtrDeleters::index);
        git_index* rawIndex = nullptr;
        checkGit(git_repository_index(&rawIndex, repo.get()), "merge-index", "");
        index = takeIndex(rawIndex);
        const size_t conflictCount = git_index_has_conflicts(index.get()) ? 1 : 0;
        if (conflictCount > 0) {
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
          return result;  // conflicts present — user must resolve
        }
        result.merged = true;

        // libgit2 leaves the merge in progress on disk. To match `git pull`'s
        // default behaviour (auto-commit on clean merge) we need to commit.
        git_signature* rawSig = nullptr;
        checkGit(git_signature_default(&rawSig, repo.get()), "merge-signature", "");
        SignatureOwner sig = takeSig(rawSig);

        // Build the tree from the (already-updated) index.
        git_oid treeOid{};
        checkGit(git_index_write_tree(&treeOid, index.get()), "merge-write-tree", "");
        git_tree* rawTree2 = nullptr;
        checkGit(git_tree_lookup(&rawTree2, repo.get(), &treeOid), "merge-lookup-tree", "");
        TreeOwner tree = takeTree(rawTree2);

        // Parents = HEAD + upstream.
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
        return result;
      });
}

// ----------------------------------------------------------------------------
// commitAllAndPush
// ----------------------------------------------------------------------------
std::shared_ptr<Promise<CommitAndPushResult>> HybridGit::commitAllAndPush(
    const std::string& localPath,
    const std::string& message,
    const std::optional<GitCredentials>& credentials,
    const std::optional<CommitAndInsecureOptions>& options) {
  return Promise<CommitAndPushResult>::async(
      [localPath, message, credentials, options](const std::shared_ptr<PromiseRuntime>& /*rt*/) {
        auto repo = openRepo(localPath);

        // Stage everything (respects .gitignore).
        git_index* rawIndex = nullptr;
        checkGit(git_repository_index(&rawIndex, repo.get()), "index", "");
        IndexOwner index = takeIndex(rawIndex);

        git_strarray paths = {nullptr, 0};  // empty -> "."
        checkGit(git_index_add_all(index.get(), &paths, 0, nullptr), "add-all", "");
        checkGit(git_index_write(index.get()), "index-write", "");

        // Compute number of files that changed in the index vs HEAD.
        git_tree* rawHeadTree = nullptr;
        git_oid headTreeOid{};
        bool hasHead = git_reference_name_to_id(&headTreeOid, repo.get(), "HEAD") == 0;
        if (hasHead) {
          checkGit(git_tree_lookup(&rawHeadTree, repo.get(), &headTreeOid), "head-tree", "");
        }
        TreeOwner headTree = takeTree(rawHeadTree);

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
          // Write the new tree.
          git_oid newTreeOid{};
          checkGit(git_index_write_tree(&newTreeOid, index.get()), "write-tree", "");
          git_tree* rawNewTree = nullptr;
          checkGit(git_tree_lookup(&rawNewTree, repo.get(), &newTreeOid), "lookup-tree", "");
          TreeOwner newTree = takeTree(rawNewTree);

          // Build signature.
          git_signature* rawSig = nullptr;
          std::string authorName = "kilne-git";
          std::string authorEmail = "kilne-git@localhost";
          std::string committerName = authorName;
          std::string committerEmail = authorEmail;
          if (options.has_value()) {
            if (options->authorName.has_value())  authorName = *options->authorName;
            if (options->authorEmail.has_value()) authorEmail = *options->authorEmail;
            if (options->committerName.has_value())  committerName = *options->committerName;
            if (options->committerEmail.has_value()) committerEmail = *options->committerEmail;
          }
          // Try the configured signature first, then fall back to override / defaults.
          if (options.has_value() &&
              (options->authorName.has_value() || options->authorEmail.has_value())) {
            checkGit(git_signature_now(&rawSig, authorName.c_str(), authorEmail.c_str()),
                     "signature-now", "");
          } else if (git_signature_default(&rawSig, repo.get()) != 0) {
            checkGit(git_signature_now(&rawSig, authorName.c_str(), authorEmail.c_str()),
                     "signature-default", "");
          }
          SignatureOwner sig = takeSig(rawSig);

          // Parent commit (HEAD), if any.
          std::vector<git_commit*> parentPtrs;
          std::vector<CommitOwner> parentOwners;
          if (hasHead) {
            git_commit* rawParent = nullptr;
            checkGit(git_commit_lookup(&rawParent, repo.get(), &headTreeOid), "lookup-parent", "");
            parentOwners.push_back(takeCommit(rawParent));
            parentPtrs.push_back(parentOwners.back().get());
          }

          git_oid commitOid{};
          checkGit(git_commit_create(&commitOid, repo.get(), "HEAD",
                                     sig.get(), sig.get(), nullptr,
                                     message.c_str(), newTree.get(),
                                     parentPtrs.size(), parentPtrs.data()),
                   "commit-create", "");
          commitResult.sha = oidToHex(&commitOid);
        }

        // Push HEAD to upstream regardless of whether we created a commit.
        AuthPayload auth = toPayload(credentials, options.has_value() && options->insecure.value_or(false));
        git_remote* rawRemote = nullptr;
        // Try configured upstream remote; if none, fall back to "origin".
        auto upstream = resolveUpstream(*repo);
        std::string remoteName = "origin";
        if (upstream.has_value()) {
          // upstream is like "refs/remotes/<remote>/<branch>"
          constexpr const char* kPrefix = "refs/remotes/";
          if (upstream->rfind(kPrefix, 0) == 0) {
            const std::string after = upstream->substr(std::strlen(kPrefix));
            const auto slash = after.find('/');
            if (slash != std::string::npos) {
              remoteName = after.substr(0, slash);
            }
          }
        }
        if (git_remote_lookup(&rawRemote, repo.get(), remoteName.c_str()) != 0) {
          // No "origin" — nothing to push to.
          CommitAndPushResult combined{};
          combined.commit = commitResult;
          combined.push.pushed = false;
          combined.push.updated = false;
          return combined;
        }
        RemoteOwner remote = takeRemote(rawRemote);
        git_push_options pushOpts;
        git_push_options_init(&pushOpts, GIT_PUSH_OPTIONS_VERSION);
        applyAuth(pushOpts.callbacks, auth);

        // Push HEAD to refs/heads/<branch> on the remote.
        auto headBranch = readHeadBranch(*repo);
        const std::string localRef = headBranch.has_value()
            ? ("refs/heads/" + *headBranch)
            : std::string("HEAD");
        const std::string pushSpec = "+" + localRef + ":" + localRef;
        char* specStr = const_cast<char*>(pushSpec.c_str());
        git_strarray pushRefs = {&specStr, 1};
        const int pushRc = git_remote_push(remote.get(), &pushRefs, &pushOpts);
        PushResult pushResult{};
        pushResult.pushed = (pushRc == 0);
        pushResult.updated = (pushRc == 0);

        CommitAndPushResult combined{};
        combined.commit = commitResult;
        combined.push = pushResult;
        return combined;
      });
}

// ----------------------------------------------------------------------------
// push
// ----------------------------------------------------------------------------
std::shared_ptr<Promise<PushResult>> HybridGit::push(
    const std::string& localPath,
    const std::optional<GitCredentials>& credentials,
    const std::optional<InsecureOptions>& options) {
  return Promise<PushResult>::async(
      [localPath, credentials, options](const std::shared_ptr<PromiseRuntime>& /*rt*/) {
        auto repo = openRepo(localPath);
        AuthPayload auth = toPayload(credentials, options.has_value() && options->insecure.value_or(false));

        auto upstream = resolveUpstream(*repo);
        std::string remoteName = "origin";
        if (upstream.has_value()) {
          constexpr const char* kPrefix = "refs/remotes/";
          if (upstream->rfind(kPrefix, 0) == 0) {
            const std::string after = upstream->substr(std::strlen(kPrefix));
            const auto slash = after.find('/');
            if (slash != std::string::npos) {
              remoteName = after.substr(0, slash);
            }
          }
        }
        git_remote* rawRemote = nullptr;
        checkGit(git_remote_lookup(&rawRemote, repo.get(), remoteName.c_str()),
                 "lookup-remote", remoteName);
        RemoteOwner remote = takeRemote(rawRemote);

        git_push_options pushOpts;
        git_push_options_init(&pushOpts, GIT_PUSH_OPTIONS_VERSION);
        applyAuth(pushOpts.callbacks, auth);

        auto headBranch = readHeadBranch(*repo);
        const std::string localRef = headBranch.has_value()
            ? ("refs/heads/" + *headBranch)
            : std::string("HEAD");
        const std::string pushSpec = "+" + localRef + ":" + localRef;
        char* specStr = const_cast<char*>(pushSpec.c_str());
        git_strarray pushRefs = {&specStr, 1};
        checkGit(git_remote_push(remote.get(), &pushRefs, &pushOpts), "push", localRef);

        PushResult result{};
        result.pushed = true;
        result.updated = true;
        return result;
      });
}

// ----------------------------------------------------------------------------
// status
// ----------------------------------------------------------------------------
std::shared_ptr<Promise<StatusResult>> HybridGit::status(const std::string& localPath) {
  return Promise<StatusResult>::async([localPath](const std::shared_ptr<PromiseRuntime>& /*rt*/) {
    auto repo = openRepo(localPath);
    return buildStatus(*repo);
  });
}

// ----------------------------------------------------------------------------
// isRepository
// ----------------------------------------------------------------------------
std::shared_ptr<Promise<bool>> HybridGit::isRepository(const std::string& localPath) {
  return Promise<bool>::async([localPath](const std::shared_ptr<PromiseRuntime>& /*rt*/) {
    git_repository* raw = nullptr;
    const int rc = git_repository_open_ext(&raw, localPath.c_str(),
                                           GIT_REPOSITORY_OPEN_NO_SEARCH, nullptr);
    if (raw != nullptr) {
      git_repository_free(raw);
    }
    return rc == 0 && raw != nullptr;
  });
}

}  // namespace margelo::nitro::kilne::git
