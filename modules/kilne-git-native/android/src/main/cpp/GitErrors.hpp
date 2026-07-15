#pragma once

#include <stdexcept>
#include <string>

namespace margelo::nitro::kilne::git {

/**
 * Exception thrown when a libgit2 call fails. Carries the symbolic error class
 * (e.g. "Auth", "Http", "MergeConflict") plus the human-readable message from
 * `git_error_last()`. Nitro will surface it as a JS Error whose `message`
 * includes both pieces.
 */
class GitError : public std::runtime_error {
public:
  GitError(const std::string& className, const std::string& detail)
      : std::runtime_error("[" + className + "] " + detail),
        className_(className),
        detail_(detail) {}

  const std::string& className() const noexcept { return className_; }
  const std::string& detail() const noexcept { return detail_; }

private:
  std::string className_;
  std::string detail_;
};

/**
 * Throw a GitError built from `git_error_last()`. Use after any libgit2 call
 * that returned a non-zero exit code.
 *
 * @param className   symbolic class shown to JS (e.g. "Clone", "Fetch")
 * @param fallback    human-readable fallback when libgit2 has no error set
 * @param errorCode   the value returned by the failing libgit2 call
 */
[[noreturn]] void throwGitError(const std::string& className,
                                const std::string& fallback,
                                int errorCode);

/**
 * Convenience wrapper that asserts the libgit2 call succeeded. Throws on non-zero.
 *
 * Usage: `checkGit(git_repository_open(&repo, path.c_str()), "open", path);`
 */
void checkGit(int errorCode,
              const std::string& operation,
              const std::string& context = "");

}  // namespace margelo::nitro::kilne::git
