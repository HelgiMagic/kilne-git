#pragma once

#include "GitRaii.hpp"
#include "HybridGitSpec.hpp"

#include <optional>
#include <string>

#include <git2.h>

namespace margelo::nitro::kilne::git {

struct StageAndCommitResult {
  size_t filesChanged{0};
  std::optional<std::string> sha;
};

std::string oidToHex(const git_oid* oid);

SignatureOwner makeAuthorSignature(git_repository& repo,
                                   const std::optional<CommitAndInsecureOptions>& options);
SignatureOwner defaultSignature(git_repository& repo);

/**
 * Stage all paths and create a commit when the index differs from HEAD's tree.
 * Signatures are created only when a commit is needed.
 * `commitOperation` is the checkGit operation name used on commit failure.
 */
StageAndCommitResult stageAllAndCommit(git_repository& repo,
                                       const char* message,
                                       const char* commitOperation = "commit-create");

StageAndCommitResult stageAllAndCommit(git_repository& repo,
                                       const char* message,
                                       const std::optional<CommitAndInsecureOptions>& options,
                                       const char* commitOperation = "commit-create");

/** Stage + commit local dirty changes so merge/FF checkout is not blocked. */
bool commitDirtyChanges(git_repository& repo, const char* message);

/**
 * Older pull FF moved HEAD before checkout; SAFE checkout then treated the
 * still-old worktree as dirty local edits and skipped updating files. After
 * that, ahead/behind is 0 but the index still matches an ancestor of HEAD.
 * Completing a FORCE checkout of HEAD is safe in that case — the "local
 * changes" are just the missing upstream tree.
 *
 * @return true when the worktree was repaired.
 */
bool healStaleWorktreeIfIndexMatchesAncestor(git_repository& repo, const git_oid& headOid);

/**
 * Auto-resolve remaining index conflicts with a line-oriented union (both sides kept).
 * Modify/delete: keep the side that still has the file.
 */
void resolveIndexConflictsUnion(git_repository& repo, git_index& index);

/** Create a merge commit from the current index + MERGE_HEAD, then clear merge state. */
void commitMergeFromIndex(git_repository& repo, git_index& index);

}  // namespace margelo::nitro::kilne::git
