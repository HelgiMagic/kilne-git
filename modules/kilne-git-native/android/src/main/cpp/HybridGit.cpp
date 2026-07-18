#include "HybridGit.hpp"

#include "GitErrors.hpp"
#include "GitMerge.hpp"
#include "GitRaii.hpp"
#include "GitRepoOps.hpp"

#include <chrono>
#include <cstdio>
#include <ctime>
#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <unordered_map>

#include <git2.h>

#if defined(__ANDROID__)
#include <android/log.h>
#define KILNE_LOGI(...) __android_log_print(ANDROID_LOG_INFO, "kilne-git", __VA_ARGS__)
#else
#define KILNE_LOGI(...) ((void)0)
#endif

namespace margelo::nitro::kilne::git {

namespace {

std::once_flag g_libgit2InitOnce;

/** Same shape as JS `defaultCommitMessage()` — always includes UTC time. */
std::string autoSyncCommitMessage() {
  using clock = std::chrono::system_clock;
  const auto now = clock::now();
  const auto secs = clock::to_time_t(now);
  const auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(
                      now.time_since_epoch())
                      .count() %
                  1000;
  std::tm tmUtc{};
#if defined(_WIN32)
  gmtime_s(&tmUtc, &secs);
#else
  gmtime_r(&secs, &tmUtc);
#endif
  char buf[64];
  std::snprintf(buf,
                sizeof(buf),
                "auto: sync from android @ %04d-%02d-%02dT%02d:%02d:%02d.%03lldZ",
                tmUtc.tm_year + 1900,
                tmUtc.tm_mon + 1,
                tmUtc.tm_mday,
                tmUtc.tm_hour,
                tmUtc.tm_min,
                tmUtc.tm_sec,
                static_cast<long long>(ms < 0 ? 0 : ms));
  return std::string(buf);
}

/** Serialize all libgit2 work on a given repository path. */
std::mutex& mutexForPath(const std::string& path) {
  static std::mutex mapMutex;
  static std::unordered_map<std::string, std::shared_ptr<std::mutex>> locks;
  std::lock_guard<std::mutex> guard(mapMutex);
  auto& entry = locks[path];
  if (!entry) {
    entry = std::make_shared<std::mutex>();
  }
  return *entry;
}

}  // namespace

HybridGit::HybridGit() : HybridObject(TAG) {
  std::call_once(g_libgit2InitOnce, []() {
    const int rc = git_libgit2_init();
    if (rc < 0) {
      throwGitError("Init", "git_libgit2_init() failed", rc);
    }
    // Shared storage on Android (e.g. /storage/emulated/0/Documents) is owned by
    // a media/sdcard UID, not the app. libgit2's default ownership check then
    // fails with GIT_EOWNER (-36). Safe here: vault paths are user-chosen and
    // we already require All files access for those locations.
    git_libgit2_opts(GIT_OPT_SET_OWNER_VALIDATION, 0);
    // Build-host CERT_LOCATION (see android/CMakeLists.txt) does not exist on
    // device. Load Android's system CA store so HTTPS verify works.
    static const char* const kCaDirs[] = {
        "/apex/com.android.conscrypt/cacerts",  // Android 14+
        "/system/etc/security/cacerts",
    };
    for (const char* dir : kCaDirs) {
      if (git_libgit2_opts(GIT_OPT_SET_SSL_CERT_LOCATIONS, nullptr, dir) == 0) {
        break;
      }
    }
  });
}

HybridGit::~HybridGit() = default;

std::string HybridGit::getVersion() {
  return std::string(LIBGIT2_VERSION);
}

std::shared_ptr<Promise<CloneResult>> HybridGit::clone(
    const std::string& url,
    const std::string& localPath,
    const std::optional<GitCredentials>& credentials,
    const std::optional<CloneOptions>& options) {
  return Promise<CloneResult>::async(
      [url, localPath, credentials, options]() {
        std::lock_guard<std::mutex> lock(mutexForPath(localPath));

        git_clone_options cloneOpts;
        checkGit(git_clone_options_init(&cloneOpts, GIT_CLONE_OPTIONS_VERSION), "clone-init");

        std::string branchOwned;
        if (options.has_value() && options->branch.has_value()) {
          branchOwned = *options->branch;
          cloneOpts.checkout_branch = branchOwned.c_str();
        }

        AuthPayload auth = toPayload(credentials);
        applyAuth(cloneOpts.fetch_opts.callbacks, auth);

        git_repository* raw = nullptr;
        checkGit(git_clone(&raw, url.c_str(), localPath.c_str(), &cloneOpts), "clone", url);
        auto repo = takeRepo(raw);
        applyAndroidRepoConfig(*repo);

        CloneResult result{};
        result.path = localPath;
        // Prefer the actual checked-out branch (remote HEAD when none was requested).
        auto head = readHeadBranch(*repo);
        result.branch = head.has_value()
            ? *head
            : (branchOwned.empty() ? "HEAD" : branchOwned);
        result.receivedObjects = 0;
        return result;
      });
}

std::shared_ptr<Promise<PullResult>> HybridGit::pull(
    const std::string& localPath,
    const std::optional<GitCredentials>& credentials) {
  return Promise<PullResult>::async(
      [localPath, credentials]() {
        using clock = std::chrono::steady_clock;
        const auto tPull = clock::now();
        auto msSince = [](clock::time_point start) {
          return std::chrono::duration_cast<std::chrono::milliseconds>(clock::now() - start)
              .count();
        };

        std::lock_guard<std::mutex> lock(mutexForPath(localPath));
        auto repo = openRepo(localPath);
        AuthPayload auth = toPayload(credentials);

        PullResult result{};
        result.fastForwarded = false;
        result.merged = false;
        result.commitsFetched = 0;
        result.conflicted = {};

        // Finish an interrupted merge (e.g. previous pull left conflicts on disk).
        auto tPhase = clock::now();
        if (git_repository_state(repo.get()) == GIT_REPOSITORY_STATE_MERGE) {
          git_index* rawIndex = nullptr;
          checkGit(git_repository_index(&rawIndex, repo.get()), "merge-index", "");
          IndexOwner index = takeIndex(rawIndex);
          commitMergeFromIndex(*repo, *index);
          result.merged = true;
          KILNE_LOGI("pull: finish-merge=%lldms", msSince(tPhase));
        } else {
          // Commit local edits first so merge/FF checkout cannot be blocked.
          const std::string message = autoSyncCommitMessage();
          commitDirtyChanges(*repo, message.c_str());
          KILNE_LOGI("pull: local-commit=%lldms", msSince(tPhase));
        }

        tPhase = clock::now();
        AnnotatedCommitOwner upstreamCommit = fetchUpstream(*repo, auth);
        KILNE_LOGI("pull: fetch=%lldms", msSince(tPhase));

        git_oid localOid{};
        checkGit(git_reference_name_to_id(&localOid, repo.get(), "HEAD"), "resolve-head", "HEAD");
        const git_oid* upstreamOid = git_annotated_commit_id(upstreamCommit.get());

        size_t ahead = 0;
        size_t behind = 0;
        checkGit(git_graph_ahead_behind(&ahead, &behind, repo.get(), &localOid, upstreamOid),
                 "ahead-behind", "");
        result.commitsFetched = static_cast<double>(behind);

        tPhase = clock::now();
        if (behind == 0) {
          // Recover vaults stuck by the old FF order (HEAD moved, files did not).
          if (healStaleWorktreeIfIndexMatchesAncestor(*repo, localOid)) {
            result.fastForwarded = true;
            result.commitsFetched = 1;
          }
        } else if (ahead == 0) {
          // Fast-forward: checkout the upstream tree WHILE HEAD still points at
          // the old commit, then move the branch ref. Moving HEAD first makes
          // GIT_CHECKOUT_SAFE treat the old worktree as dirty local edits and
          // either no-op or refuse — leaving Behind:0 with files never updated.
          const git_oid* target = git_annotated_commit_id(upstreamCommit.get());
          auto branch = readHeadBranch(*repo);
          if (!branch.has_value()) {
            throw GitError("Pull", "Cannot fast-forward: detached HEAD.");
          }

          git_commit* rawTargetCommit = nullptr;
          checkGit(git_commit_lookup(&rawTargetCommit, repo.get(), target),
                   "fast-forward-lookup", "");
          CommitOwner targetCommit = takeCommit(rawTargetCommit);
          git_tree* rawTargetTree = nullptr;
          checkGit(git_commit_tree(&rawTargetTree, targetCommit.get()),
                   "fast-forward-tree", "");
          TreeOwner targetTree = takeTree(rawTargetTree);

          git_checkout_options coOpts;
          git_checkout_options_init(&coOpts, GIT_CHECKOUT_OPTIONS_VERSION);
          coOpts.checkout_strategy = GIT_CHECKOUT_SAFE;
          checkGit(git_checkout_tree(repo.get(),
                                     reinterpret_cast<git_object*>(targetTree.get()),
                                     &coOpts),
                   "fast-forward-checkout", "");

          const std::string branchRef = "refs/heads/" + *branch;
          checkGit(git_reference_create(nullptr, repo.get(), branchRef.c_str(),
                                        target, /*force=*/1, "kilne-git pull"),
                   "fast-forward-ref", *branch);
          checkGit(git_repository_set_head(repo.get(), branchRef.c_str()),
                   "fast-forward-set-head", *branch);
          result.fastForwarded = true;
        } else {
          const git_annotated_commit* heads[] = {upstreamCommit.get()};
          git_merge_options mergeOpts;
          git_merge_options_init(&mergeOpts, GIT_MERGE_OPTIONS_VERSION);
          // Auto-resolve content conflicts by keeping both sides (line-oriented union).
          mergeOpts.file_favor = GIT_MERGE_FILE_FAVOR_UNION;
          git_checkout_options checkoutOpts;
          git_checkout_options_init(&checkoutOpts, GIT_CHECKOUT_OPTIONS_VERSION);
          checkoutOpts.checkout_strategy = GIT_CHECKOUT_SAFE;
          checkGit(git_merge(repo.get(), heads, 1, &mergeOpts, &checkoutOpts), "merge", "");

          git_index* rawIndex = nullptr;
          checkGit(git_repository_index(&rawIndex, repo.get()), "merge-index", "");
          IndexOwner index = takeIndex(rawIndex);
          commitMergeFromIndex(*repo, *index);
          result.merged = true;
        }
        KILNE_LOGI("pull: integrate ahead=%zu behind=%zu ff=%d merge=%d (%lldms)",
                   ahead, behind, result.fastForwarded ? 1 : 0, result.merged ? 1 : 0,
                   msSince(tPhase));

        // Publish local commits (auto-commit and/or merge) in one Pull/Sync.
        tPhase = clock::now();
        if (aheadOfUpstream(*repo, *upstreamOid) > 0) {
          pushHead(*repo, auth);
          KILNE_LOGI("pull: push=%lldms", msSince(tPhase));
        } else {
          KILNE_LOGI("pull: push=skipped");
        }
        KILNE_LOGI("pull: total=%lldms", msSince(tPull));
        return result;
      });
}

std::shared_ptr<Promise<CommitAndPushResult>> HybridGit::commitAllAndPush(
    const std::string& localPath,
    const std::string& message,
    const std::optional<GitCredentials>& credentials,
    const std::optional<CommitOptions>& options) {
  return Promise<CommitAndPushResult>::async(
      [localPath, message, credentials, options]() {
        std::lock_guard<std::mutex> lock(mutexForPath(localPath));
        auto repo = openRepo(localPath);

        auto stageResult = stageAllAndCommit(*repo, message.c_str(), options);

        CommitResult commitResult{};
        commitResult.sha = stageResult.sha;
        commitResult.filesChanged = static_cast<double>(stageResult.filesChanged);

        AuthPayload auth = toPayload(credentials);
        PushResult pushResult = pushHead(*repo, auth);

        CommitAndPushResult combined{};
        combined.commit = commitResult;
        combined.push = pushResult;
        return combined;
      });
}

std::shared_ptr<Promise<PushResult>> HybridGit::push(
    const std::string& localPath,
    const std::optional<GitCredentials>& credentials) {
  return Promise<PushResult>::async(
      [localPath, credentials]() {
        std::lock_guard<std::mutex> lock(mutexForPath(localPath));
        auto repo = openRepo(localPath);
        AuthPayload auth = toPayload(credentials);
        return pushHead(*repo, auth);
      });
}

std::shared_ptr<Promise<StatusResult>> HybridGit::status(const std::string& localPath) {
  return Promise<StatusResult>::async([localPath]() {
    std::lock_guard<std::mutex> lock(mutexForPath(localPath));
    auto repo = openRepo(localPath);
    return buildStatus(*repo);
  });
}

std::shared_ptr<Promise<bool>> HybridGit::isRepository(const std::string& localPath) {
  return Promise<bool>::async([localPath]() {
    git_repository* raw = nullptr;
    const int rc = git_repository_open_ext(&raw, localPath.c_str(),
                                           GIT_REPOSITORY_OPEN_NO_SEARCH, nullptr);
    if (raw != nullptr) {
      git_repository_free(raw);
    }
    return rc == 0;
  });
}

}  // namespace margelo::nitro::kilne::git
