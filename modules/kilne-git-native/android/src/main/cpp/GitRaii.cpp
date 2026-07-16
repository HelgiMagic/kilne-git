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
    git_error_set_str(GIT_ERROR_AUTH,
                      "Authentication failed after 4 attempts — credentials rejected by server.");
    return GIT_ERROR;
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

/**
 * When `insecure` is set we unconditionally accept any TLS certificate. This is
 * needed for self-hosted GitLab/Gitea with a self-signed cert.
 *
 * Returning 1 = accept the certificate.
 */
int certCheckCallback(git_cert* /*cert*/, int /*valid*/, const char* /*host*/, void* payload) noexcept {
  auto* data = static_cast<AuthPayload*>(payload);
  if (data != nullptr && data->insecure) {
    return 1;  // accept
  }
  // libgit2 will reject automatically if valid == 0
  return 0;
}

}  // namespace

void applyAuth(git_remote_callbacks& cb, AuthPayload& payload) {
  git_remote_init_callbacks(&cb, GIT_REMOTE_CALLBACKS_VERSION);
  cb.credentials = &credentialsCallback;
  cb.certificate_check = &certCheckCallback;
  cb.payload = &payload;
}

}  // namespace margelo::nitro::kilne::git
