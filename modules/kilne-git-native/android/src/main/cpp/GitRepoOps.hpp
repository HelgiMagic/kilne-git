#pragma once

#include "GitRaii.hpp"
#include "HybridGitSpec.hpp"

#include <optional>
#include <string>

#include <git2.h>

namespace margelo::nitro::kilne::git {

AuthPayload toPayload(const std::optional<GitCredentials>& creds, bool insecure);

RepositoryOwner openRepo(const std::string& path);

/** Persist FUSE-friendly core.* settings (untrackedCache/filemode/symlinks). */
void applyAndroidRepoConfig(git_repository& repo);

std::optional<std::string> readHeadBranch(git_repository& repo);
std::optional<std::string> resolveUpstream(git_repository& repo);
std::string resolveUpstreamOrFallback(git_repository& repo);
std::string remoteNameFromUpstream(const std::string& upstreamRef);
std::string branchNameFromUpstream(const std::string& upstreamRef);

AnnotatedCommitOwner fetchUpstream(git_repository& repo, const AuthPayload& auth);
PushResult pushHead(git_repository& repo, const AuthPayload& auth);
StatusResult buildStatus(git_repository& repo);
size_t aheadOfUpstream(git_repository& repo, const git_oid& upstreamOid);

}  // namespace margelo::nitro::kilne::git
