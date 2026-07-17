#include "GitRaii.hpp"

#include "GitErrors.hpp"

#include <git2.h>

namespace margelo::nitro::kilne::git {

namespace {

/**
 * libgit2 calls this to obtain credentials for the transport. We supply
 * username/password (which is also how GitHub PATs are passed — username is
 * ignored server-side, password is the token).
 *
 * The function may be called multiple times during a single operation as
 * libgit2 negotiates the auth scheme. If we already tried and got rejected
 * (4 attempts), we give up to avoid an infinite loop.
 */
int credentialsCallback(git_credential** out,
                        const char* /*url*/,
                        const char* username_from_url,
                        unsigned int /*allowed_types*/,
                        void* payload) noexcept {
  auto* data = static_cast<AuthPayload*>(payload);
  if (data == nullptr) {
    return GIT_ERROR;
  }
  if (data->password.empty()) {
    // No credentials supplied — let libgit2 try anonymous transport.
    return GIT_PASSTHROUGH;
  }
  if (++data->attempts > 4) {
    // Bail out — returning GIT_EAUTH stops libgit2's credential retry loop.
    return GIT_EAUTH;
  }
  // Prefer the username the app configured (e.g. x-access-token). Fall back to
  // the URL-embedded user only when none was supplied.
  const char* user = !data->username.empty()
                         ? data->username.c_str()
                         : username_from_url;
  if (user == nullptr || user[0] == '\0') {
    user = "git";
  }
  return git_credential_userpass_plaintext_new(out, user, data->password.c_str());
}

}  // namespace

void applyAuth(git_remote_callbacks& cb, AuthPayload& payload) {
  git_remote_init_callbacks(&cb, GIT_REMOTE_CALLBACKS_VERSION);
  cb.credentials = &credentialsCallback;
  cb.payload = &payload;
}

}  // namespace margelo::nitro::kilne::git
