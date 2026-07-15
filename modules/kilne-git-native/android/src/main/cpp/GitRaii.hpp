#pragma once

#include <functional>
#include <memory>

#include <git2.h>

namespace margelo::nitro::kilne::git {

/**
 * `unique_ptr` deleters for the libgit2 C structs we use. Using RAII guarantees
 * that we never leak a libgit2 handle, even when an exception is thrown mid-call.
 */

struct GitPtrDeleters {
  static void repository(git_repository* p) noexcept        { if (p) git_repository_free(p); }
  static void remote(git_remote* p) noexcept                { if (p) git_remote_free(p); }
  static void index(git_index* p) noexcept                  { if (p) git_index_free(p); }
  static void annotatedCommit(git_annotated_commit* p) noexcept {
    if (p) git_annotated_commit_free(p);
  }
  static void reference(git_reference* p) noexcept          { if (p) git_reference_free(p); }
  static void commit(git_commit* p) noexcept                { if (p) git_commit_free(p); }
  static void tree(git_tree* p) noexcept                    { if (p) git_tree_free(p); }
  static void signature(git_signature* p) noexcept          { if (p) git_signature_free(p); }
  static void statusList(git_status_list* p) noexcept       { if (p) git_status_list_free(p); }
  static void strarray(git_strarray* p) noexcept            { if (p) git_strarray_dispose(p); }
  static void credential(git_credential* p) noexcept        { if (p) git_credential_free(p); }
};

using RepositoryOwner       = std::unique_ptr<git_repository,        decltype(&GitPtrDeleters::repository)>;
using RemoteOwner           = std::unique_ptr<git_remote,            decltype(&GitPtrDeleters::remote)>;
using IndexOwner            = std::unique_ptr<git_index,             decltype(&GitPtrDeleters::index)>;
using AnnotatedCommitOwner  = std::unique_ptr<git_annotated_commit,  decltype(&GitPtrDeleters::annotatedCommit)>;
using ReferenceOwner        = std::unique_ptr<git_reference,         decltype(&GitPtrDeleters::reference)>;
using CommitOwner           = std::unique_ptr<git_commit,            decltype(&GitPtrDeleters::commit)>;
using TreeOwner             = std::unique_ptr<git_tree,              decltype(&GitPtrDeleters::tree)>;
using SignatureOwner        = std::unique_ptr<git_signature,         decltype(&GitPtrDeleters::signature)>;
using StatusListOwner       = std::unique_ptr<git_status_list,       decltype(&GitPtrDeleters::statusList)>;
using CredentialOwner       = std::unique_ptr<git_credential,        decltype(&GitPtrDeleters::credential)>;

/** Wraps a raw `git_repository*` into a RAII owner. */
inline RepositoryOwner takeRepo(git_repository* p) { return RepositoryOwner(p, GitPtrDeleters::repository); }
inline RemoteOwner takeRemote(git_remote* p)       { return RemoteOwner(p, GitPtrDeleters::remote); }
inline IndexOwner takeIndex(git_index* p)          { return IndexOwner(p, GitPtrDeleters::index); }
inline AnnotatedCommitOwner takeAnnotated(git_annotated_commit* p) {
  return AnnotatedCommitOwner(p, GitPtrDeleters::annotatedCommit);
}
inline ReferenceOwner takeRef(git_reference* p)    { return ReferenceOwner(p, GitPtrDeleters::reference); }
inline CommitOwner takeCommit(git_commit* p)       { return CommitOwner(p, GitPtrDeleters::commit); }
inline TreeOwner takeTree(git_tree* p)             { return TreeOwner(p, GitPtrDeleters::tree); }
inline SignatureOwner takeSig(git_signature* p)    { return SignatureOwner(p, GitPtrDeleters::signature); }
inline StatusListOwner takeStatus(git_status_list* p) { return StatusListOwner(p, GitPtrDeleters::statusList); }

/**
 * Payload passed into libgit2's `credentials` and `certificate_check` callbacks.
 * Lives on the stack of the calling operation.
 */
struct AuthPayload {
  std::string username;
  std::string password;
  bool insecure{false};
  /** Counts credential attempts so we can bail out after a few failures. */
  int attempts{0};
};

/**
 * Configures a `git_remote_callbacks` (or fetch/push options) to use the given
 * auth payload. Use this for clone, fetch and push.
 */
void applyAuth(git_remote_callbacks& cb, AuthPayload& payload);

}  // namespace margelo::nitro::kilne::git
