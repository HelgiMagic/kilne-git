#include "GitErrors.hpp"

#include <git2.h>

namespace margelo::nitro::kilne::git {

namespace {

/**
 * Map libgit2's numeric error class to a short symbolic name.
 * Mirrors `git_error_t` in git2/errors.h (libgit2 1.9).
 */
const char* classIdToName(int klass) noexcept {
  switch (klass) {
    case GIT_ERROR_NONE:        return "None";
    case GIT_ERROR_NOMEMORY:    return "NoMemory";
    case GIT_ERROR_OS:          return "OS";
    case GIT_ERROR_INVALID:     return "Invalid";
    case GIT_ERROR_REFERENCE:   return "Reference";
    case GIT_ERROR_ZLIB:        return "Zlib";
    case GIT_ERROR_REPOSITORY:  return "Repository";
    case GIT_ERROR_CONFIG:      return "Config";
    case GIT_ERROR_REGEX:       return "Regex";
    case GIT_ERROR_ODB:         return "ODB";
    case GIT_ERROR_INDEX:       return "Index";
    case GIT_ERROR_OBJECT:      return "Object";
    case GIT_ERROR_NET:         return "Net";
    case GIT_ERROR_TAG:         return "Tag";
    case GIT_ERROR_TREE:        return "Tree";
    case GIT_ERROR_INDEXER:     return "Indexer";
    case GIT_ERROR_SSL:         return "SSL";
    case GIT_ERROR_SUBMODULE:   return "Submodule";
    case GIT_ERROR_THREAD:      return "Thread";
    case GIT_ERROR_STASH:       return "Stash";
    case GIT_ERROR_CHECKOUT:    return "Checkout";
    case GIT_ERROR_FETCHHEAD:   return "FetchHead";
    case GIT_ERROR_MERGE:       return "Merge";
    case GIT_ERROR_SSH:         return "SSH";
    case GIT_ERROR_FILTER:      return "Filter";
    case GIT_ERROR_REVERT:      return "Revert";
    case GIT_ERROR_CALLBACK:    return "Callback";
    case GIT_ERROR_CHERRYPICK:  return "CherryPick";
    case GIT_ERROR_DESCRIBE:    return "Describe";
    case GIT_ERROR_REBASE:      return "Rebase";
    case GIT_ERROR_FILESYSTEM:  return "Filesystem";
    case GIT_ERROR_PATCH:       return "Patch";
    case GIT_ERROR_WORKTREE:    return "Worktree";
    case GIT_ERROR_SHA:         return "SHA";
    case GIT_ERROR_HTTP:        return "HTTP";
    case GIT_ERROR_INTERNAL:    return "Internal";
    case GIT_ERROR_GRAFTS:      return "Grafts";
    default:                    return "Unknown";
  }
}

}  // namespace

[[noreturn]] void throwGitError(const std::string& className,
                                const std::string& fallback,
                                int errorCode) {
  const git_error* err = git_error_last();
  if (err != nullptr && err->message != nullptr) {
    std::string detail = err->message;
    if (err->klass != 0) {
      detail += " (libgit2 code=" + std::to_string(errorCode) +
                ", class=" + classIdToName(err->klass) + ")";
    }
    throw GitError(className, detail);
  }
  throw GitError(className,
                 fallback + " (libgit2 code=" + std::to_string(errorCode) + ")");
}

void checkGit(int errorCode,
              const std::string& operation,
              const std::string& context) {
  if (errorCode < 0) {
    std::string className = operation;
    if (!context.empty()) {
      className += ":" + context;
    }
    throwGitError(className, operation + " failed", errorCode);
  }
}

}  // namespace margelo::nitro::kilne::git
