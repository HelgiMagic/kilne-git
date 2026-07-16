#include "GitRepoOps.hpp"

#include "GitErrors.hpp"

#include <cstring>
#include <optional>
#include <string>
#include <vector>

#include <git2.h>

namespace margelo::nitro::kilne::git {

namespace {

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

}  // namespace

AuthPayload toPayload(const std::optional<GitCredentials>& creds, bool insecure) {
  AuthPayload p;
  p.insecure = insecure;
  if (creds.has_value()) {
    p.username = creds->username;
    p.password = creds->password;
  }
  return p;
}

void applyAndroidRepoConfig(git_repository& repo) {
  git_config* rawCfg = nullptr;
  if (git_repository_config(&rawCfg, &repo) != 0 || rawCfg == nullptr) {
    return;
  }
  ConfigOwner cfg = takeConfig(rawCfg);
  // Directory mtimes often do not update when files are added; untracked cache
  // then permanently misses new notes/attachments in existing folders.
  git_config_set_bool(cfg.get(), "core.untrackedCache", 0);
  // FUSE reports 0777 for everything — avoid spurious mode-only "changes".
  git_config_set_bool(cfg.get(), "core.filemode", 0);
  git_config_set_bool(cfg.get(), "core.symlinks", 0);
}

RepositoryOwner openRepo(const std::string& path) {
  git_repository* raw = nullptr;
  checkGit(git_repository_open_ext(&raw, path.c_str(),
                                   GIT_REPOSITORY_OPEN_NO_SEARCH, nullptr),
           "open", path);
  if (raw == nullptr) {
    throw GitError("Open", "git_repository_open returned null for: " + path);
  }
  auto repo = takeRepo(raw);
  applyAndroidRepoConfig(*repo);
  return repo;
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

StatusResult buildStatus(git_repository& repo) {
  git_status_options opts;
  git_status_options_init(&opts, GIT_STATUS_OPTIONS_VERSION);
  opts.show = GIT_STATUS_SHOW_INDEX_AND_WORKDIR;
  opts.flags =
      GIT_STATUS_OPT_INCLUDE_UNTRACKED |
      GIT_STATUS_OPT_RECURSE_UNTRACKED_DIRS |
      GIT_STATUS_OPT_INCLUDE_UNREADABLE |
      GIT_STATUS_OPT_INCLUDE_UNREADABLE_AS_UNTRACKED |
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

size_t aheadOfUpstream(git_repository& repo, const git_oid& upstreamOid) {
  git_oid localOid{};
  if (git_reference_name_to_id(&localOid, &repo, "HEAD") != 0) {
    return 0;
  }
  size_t ahead = 0;
  size_t behind = 0;
  if (git_graph_ahead_behind(&ahead, &behind, &repo, &localOid, &upstreamOid) != 0) {
    return 0;
  }
  return ahead;
}

}  // namespace margelo::nitro::kilne::git
