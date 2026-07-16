#include "GitMerge.hpp"

#include "GitErrors.hpp"

#include <cstdio>
#include <optional>
#include <string>
#include <vector>

#include <git2.h>

namespace margelo::nitro::kilne::git {

namespace {

void writeWorkdirFile(git_repository& repo, const char* relPath, const void* data, size_t len) {
  const char* workdir = git_repository_workdir(&repo);
  if (workdir == nullptr || relPath == nullptr) {
    throw GitError("Merge", "Cannot write resolved file: missing workdir/path.");
  }
  const std::string fullPath = std::string(workdir) + relPath;
  FILE* file = std::fopen(fullPath.c_str(), "wb");
  if (file == nullptr) {
    throw GitError("Merge", std::string("Cannot write resolved file: ") + relPath);
  }
  if (len > 0 && std::fwrite(data, 1, len, file) != len) {
    std::fclose(file);
    throw GitError("Merge", std::string("Failed writing resolved file: ") + relPath);
  }
  std::fclose(file);
}

int collectMergeHead(const git_oid* oid, void* payload) {
  auto* heads = static_cast<std::vector<git_oid>*>(payload);
  heads->push_back(*oid);
  return 0;
}

StageAndCommitResult stageAllAndCommitImpl(
    git_repository& repo,
    const char* message,
    const std::optional<CommitAndInsecureOptions>* options,
    const char* commitOperation) {
  git_index* rawIndex = nullptr;
  checkGit(git_repository_index(&rawIndex, &repo), "index", "");
  IndexOwner index = takeIndex(rawIndex);

  git_strarray paths = {nullptr, 0};
  checkGit(git_index_add_all(index.get(), &paths, 0, nullptr, nullptr), "add-all", "");
  checkGit(git_index_write(index.get()), "index-write", "");

  // HEAD points at a commit OID — resolve to its tree for the diff.
  git_oid headCommitOid{};
  const bool hasHead =
      git_reference_name_to_id(&headCommitOid, &repo, "HEAD") == 0;

  CommitOwner parentCommit(nullptr, GitPtrDeleters::commit);
  TreeOwner headTree(nullptr, GitPtrDeleters::tree);
  if (hasHead) {
    git_commit* rawParent = nullptr;
    checkGit(git_commit_lookup(&rawParent, &repo, &headCommitOid), "lookup-parent", "");
    parentCommit = takeCommit(rawParent);
    git_tree* rawHeadTree = nullptr;
    checkGit(git_commit_tree(&rawHeadTree, parentCommit.get()), "head-tree", "");
    headTree = takeTree(rawHeadTree);
  }

  git_diff_options diffOpts;
  git_diff_options_init(&diffOpts, GIT_DIFF_OPTIONS_VERSION);
  git_diff* rawDiff = nullptr;
  checkGit(git_diff_tree_to_index(&rawDiff, &repo,
                                  hasHead ? headTree.get() : nullptr,
                                  index.get(), &diffOpts),
           "diff", "");
  const size_t filesChanged = git_diff_num_deltas(rawDiff);
  git_diff_free(rawDiff);

  StageAndCommitResult result{};
  result.filesChanged = filesChanged;
  if (filesChanged == 0) {
    return result;
  }

  git_oid newTreeOid{};
  checkGit(git_index_write_tree(&newTreeOid, index.get()), "write-tree", "");
  git_tree* rawNewTree = nullptr;
  checkGit(git_tree_lookup(&rawNewTree, &repo, &newTreeOid), "lookup-tree", "");
  TreeOwner newTree = takeTree(rawNewTree);

  SignatureOwner author(nullptr, GitPtrDeleters::signature);
  const git_signature* authorPtr = nullptr;
  if (options != nullptr) {
    author = makeAuthorSignature(repo, *options);
  } else {
    author = defaultSignature(repo);
  }
  authorPtr = author.get();
  // Committer always uses the same identity as author.

  std::vector<const git_commit*> parentPtrs;
  if (hasHead) {
    parentPtrs.push_back(parentCommit.get());
  }

  git_oid commitOid{};
  checkGit(git_commit_create(&commitOid, &repo, "HEAD",
                             authorPtr, authorPtr, nullptr,
                             message, newTree.get(),
                             parentPtrs.size(), parentPtrs.data()),
           commitOperation, "");
  result.sha = oidToHex(&commitOid);
  return result;
}

}  // namespace

std::string oidToHex(const git_oid* oid) {
  char buf[GIT_OID_SHA1_HEXSIZE + 1] = {0};
  git_oid_tostr(buf, sizeof(buf), oid);
  return std::string(buf);
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

SignatureOwner defaultSignature(git_repository& repo) {
  git_signature* rawSig = nullptr;
  if (git_signature_default(&rawSig, &repo) != 0) {
    checkGit(git_signature_now(&rawSig, "kilne-git", "kilne-git@localhost"),
             "signature-default", "");
  }
  return takeSig(rawSig);
}

StageAndCommitResult stageAllAndCommit(git_repository& repo,
                                       const char* message,
                                       const char* commitOperation) {
  return stageAllAndCommitImpl(repo, message, nullptr, commitOperation);
}

StageAndCommitResult stageAllAndCommit(git_repository& repo,
                                       const char* message,
                                       const std::optional<CommitAndInsecureOptions>& options,
                                       const char* commitOperation) {
  return stageAllAndCommitImpl(repo, message, &options, commitOperation);
}

bool commitDirtyChanges(git_repository& repo, const char* message) {
  auto result = stageAllAndCommit(repo, message, "commit-dirty");
  return result.sha.has_value();
}

bool healStaleWorktreeIfIndexMatchesAncestor(git_repository& repo, const git_oid& headOid) {
  git_commit* rawHead = nullptr;
  if (git_commit_lookup(&rawHead, &repo, &headOid) != 0 || rawHead == nullptr) {
    return false;
  }
  CommitOwner headCommit = takeCommit(rawHead);

  git_index* rawIndex = nullptr;
  if (git_repository_index(&rawIndex, &repo) != 0 || rawIndex == nullptr) {
    return false;
  }
  IndexOwner index = takeIndex(rawIndex);

  git_oid indexTreeOid{};
  if (git_index_write_tree(&indexTreeOid, index.get()) != 0) {
    return false;
  }

  git_tree* rawHeadTree = nullptr;
  if (git_commit_tree(&rawHeadTree, headCommit.get()) != 0 || rawHeadTree == nullptr) {
    return false;
  }
  TreeOwner headTree = takeTree(rawHeadTree);
  if (git_oid_equal(&indexTreeOid, git_tree_id(headTree.get())) == 1) {
    return false;  // already in sync
  }

  bool matchesAncestor = false;
  git_commit* walk = nullptr;
  if (git_commit_parent(&walk, headCommit.get(), 0) != 0 || walk == nullptr) {
    return false;
  }
  for (int depth = 0; depth < 64 && walk != nullptr; ++depth) {
    CommitOwner current = takeCommit(walk);
    walk = nullptr;

    git_tree* rawTree = nullptr;
    if (git_commit_tree(&rawTree, current.get()) == 0 && rawTree != nullptr) {
      TreeOwner tree = takeTree(rawTree);
      if (git_oid_equal(&indexTreeOid, git_tree_id(tree.get())) == 1) {
        matchesAncestor = true;
        break;
      }
    }

    if (git_commit_parentcount(current.get()) < 1) {
      break;
    }
    if (git_commit_parent(&walk, current.get(), 0) != 0) {
      walk = nullptr;
    }
  }
  if (walk != nullptr) {
    git_commit_free(walk);
  }
  if (!matchesAncestor) {
    return false;
  }

  git_checkout_options coOpts;
  git_checkout_options_init(&coOpts, GIT_CHECKOUT_OPTIONS_VERSION);
  coOpts.checkout_strategy = GIT_CHECKOUT_FORCE;
  checkGit(git_checkout_tree(&repo, reinterpret_cast<git_object*>(headTree.get()), &coOpts),
           "heal-stale-checkout", "");
  return true;
}

void resolveIndexConflictsUnion(git_repository& repo, git_index& index) {
  if (!git_index_has_conflicts(&index)) {
    return;
  }

  struct ConflictSides {
    std::string path;
    bool hasAncestor{false};
    bool hasOurs{false};
    bool hasTheirs{false};
    git_index_entry ancestor{};
    git_index_entry ours{};
    git_index_entry theirs{};
  };

  std::vector<ConflictSides> conflicts;
  git_index_conflict_iterator* it = nullptr;
  checkGit(git_index_conflict_iterator_new(&it, &index), "conflict-iterator", "");
  const git_index_entry* ancestor = nullptr;
  const git_index_entry* ours = nullptr;
  const git_index_entry* theirs = nullptr;
  while (git_index_conflict_next(&ancestor, &ours, &theirs, it) == 0) {
    ConflictSides entry{};
    if (theirs != nullptr && theirs->path != nullptr) {
      entry.path = theirs->path;
    } else if (ours != nullptr && ours->path != nullptr) {
      entry.path = ours->path;
    } else if (ancestor != nullptr && ancestor->path != nullptr) {
      entry.path = ancestor->path;
    } else {
      continue;
    }
    if (ancestor != nullptr) {
      entry.hasAncestor = true;
      entry.ancestor = *ancestor;
    }
    if (ours != nullptr) {
      entry.hasOurs = true;
      entry.ours = *ours;
    }
    if (theirs != nullptr) {
      entry.hasTheirs = true;
      entry.theirs = *theirs;
    }
    conflicts.push_back(std::move(entry));
  }
  git_index_conflict_iterator_free(it);

  for (const auto& conflict : conflicts) {
    if (conflict.hasOurs && conflict.hasTheirs) {
      git_merge_file_options fileOpts;
      git_merge_file_options_init(&fileOpts, GIT_MERGE_FILE_OPTIONS_VERSION);
      fileOpts.favor = GIT_MERGE_FILE_FAVOR_UNION;

      git_merge_file_result fileResult{};
      checkGit(git_merge_file_from_index(
                   &fileResult, &repo,
                   conflict.hasAncestor ? &conflict.ancestor : nullptr,
                   &conflict.ours, &conflict.theirs, &fileOpts),
               "merge-file-union", conflict.path);
      writeWorkdirFile(repo, conflict.path.c_str(), fileResult.ptr, fileResult.len);
      git_merge_file_result_free(&fileResult);
      checkGit(git_index_add_bypath(&index, conflict.path.c_str()),
               "stage-resolved", conflict.path);
    } else if (conflict.hasOurs) {
      git_index_entry entry = conflict.ours;
      GIT_INDEX_ENTRY_STAGE_SET(&entry, 0);
      checkGit(git_index_conflict_remove(&index, conflict.path.c_str()),
               "clear-conflict", conflict.path);
      checkGit(git_index_add(&index, &entry), "stage-ours", conflict.path);
    } else if (conflict.hasTheirs) {
      git_blob* rawBlob = nullptr;
      checkGit(git_blob_lookup(&rawBlob, &repo, &conflict.theirs.id),
               "lookup-theirs", conflict.path);
      writeWorkdirFile(repo, conflict.path.c_str(),
                       git_blob_rawcontent(rawBlob),
                       static_cast<size_t>(git_blob_rawsize(rawBlob)));
      git_blob_free(rawBlob);
      checkGit(git_index_add_bypath(&index, conflict.path.c_str()),
               "stage-theirs", conflict.path);
    } else {
      checkGit(git_index_remove_bypath(&index, conflict.path.c_str()),
               "remove-both-deleted", conflict.path);
    }
  }

  checkGit(git_index_write(&index), "index-write-resolved", "");
  if (git_index_has_conflicts(&index)) {
    throw GitError("Merge", "Unable to auto-resolve all merge conflicts.");
  }
}

void commitMergeFromIndex(git_repository& repo, git_index& index) {
  resolveIndexConflictsUnion(repo, index);

  git_oid treeOid{};
  checkGit(git_index_write_tree(&treeOid, &index), "merge-write-tree", "");
  checkGit(git_index_write(&index), "merge-index-write", "");
  git_tree* rawTree = nullptr;
  checkGit(git_tree_lookup(&rawTree, &repo, &treeOid), "merge-lookup-tree", "");
  TreeOwner tree = takeTree(rawTree);

  git_oid headOid{};
  checkGit(git_reference_name_to_id(&headOid, &repo, "HEAD"), "merge-head", "HEAD");
  git_commit* rawHeadCommit = nullptr;
  checkGit(git_commit_lookup(&rawHeadCommit, &repo, &headOid), "merge-head-lookup", "");
  CommitOwner headCommit = takeCommit(rawHeadCommit);

  std::vector<git_oid> mergeHeadOids;
  checkGit(git_repository_mergehead_foreach(&repo, collectMergeHead, &mergeHeadOids),
           "merge-heads", "");
  if (mergeHeadOids.empty()) {
    throw GitError("Merge", "MERGE_HEAD missing; cannot complete merge commit.");
  }

  std::vector<CommitOwner> mergeCommits;
  std::vector<const git_commit*> parents;
  parents.push_back(headCommit.get());
  mergeCommits.reserve(mergeHeadOids.size());
  for (const git_oid& oid : mergeHeadOids) {
    git_commit* raw = nullptr;
    checkGit(git_commit_lookup(&raw, &repo, &oid), "merge-parent-lookup", "");
    mergeCommits.push_back(takeCommit(raw));
    parents.push_back(mergeCommits.back().get());
  }

  SignatureOwner sig = defaultSignature(repo);
  git_oid commitOid{};
  checkGit(git_commit_create(&commitOid, &repo, "HEAD",
                             sig.get(), sig.get(), nullptr,
                             "Merge upstream", tree.get(),
                             parents.size(), parents.data()),
           "merge-commit", "");
  checkGit(git_repository_state_cleanup(&repo), "merge-cleanup", "");
}

}  // namespace margelo::nitro::kilne::git
