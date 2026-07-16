import type { HybridObject } from 'react-native-nitro-modules'

/**
 * Credentials for HTTPS basic authentication.
 * For GitHub/GitLab personal access tokens: username can be anything (commonly
 * "x-access-token" or the user handle), password is the token itself.
 */
export interface GitCredentials {
  username: string
  password: string
}

/**
 * Generic per-call flags that don't need their own struct.
 */
export interface InsecureOptions {
  /** Disable TLS certificate verification (self-hosted servers with self-signed certs). */
  insecure?: boolean
}

/**
 * Optional author / committer identity for `commitAllAndPush`.
 */
export interface CommitOptions {
  authorName?: string
  authorEmail?: string
  committerName?: string
  committerEmail?: string
}

/**
 * Combined options for the "commit + push" composite operation.
 */
export interface CommitAndInsecureOptions extends CommitOptions, InsecureOptions {}

/**
 * Optional clone knobs.
 */
export interface CloneOptions {
  /** Branch to check out after clone. If omitted, uses the remote HEAD. */
  branch?: string
  /** Shallow clone depth. 0 means full history. */
  depth?: number
  /** Disable TLS certificate verification (self-hosted servers). */
  insecure?: boolean
}

/**
 * Status of a single file. Mirrors `git_status_t` from libgit2 (simplified).
 *
 * Declared as a string union because Nitrogen's C++ enums are numeric only —
 * unions translate to `std::variant<...>` and stay type-safe end to end.
 */
export type FileState =
  | 'current'
  | 'new'
  | 'modified'
  | 'deleted'
  | 'renamed'
  | 'typechange'
  | 'conflicted'

/**
 * One entry in the status list.
 */
export interface FileStatusEntry {
  path: string
  worktree: FileState
  index: FileState
}

/**
 * Result of `Git.status()`.
 */
export interface StatusResult {
  /** True when there are no changes (clean working tree). */
  isClean: boolean
  /** Number of commits ahead of upstream (unpushed). */
  ahead: number
  /** Number of commits behind upstream. */
  behind: number
  /** Files changed in the index (staged). */
  staged: FileStatusEntry[]
  /** Files changed in the working tree (unstaged). */
  working: FileStatusEntry[]
  /** Untracked files (not ignored, not in index). */
  untracked: string[]
  /** Conflicted files (merge/rebase in progress). */
  conflicted: string[]
  /** Currently checked out branch name, or omitted in detached HEAD. */
  head?: string
  /** Upstream branch name (e.g. "refs/remotes/origin/main"), or omitted if unset. */
  upstream?: string
}

/**
 * Result of the commit step.
 */
export interface CommitResult {
  /** SHA-1 of the newly created commit, or omitted when there was nothing to commit. */
  sha?: string
  /** Number of files included in the commit. */
  filesChanged: number
}

/**
 * Result of `Git.pull()`.
 */
export interface PullResult {
  /** True when HEAD was fast-forwarded to upstream. */
  fastForwarded: boolean
  /** True when a merge commit was created (non-ff merge happened). */
  merged: boolean
  /** Number of upstream commits that were integrated. */
  commitsFetched: number
  /** Files in conflict after merge (empty when clean). */
  conflicted: string[]
}

/**
 * Result of `Git.push()`.
 */
export interface PushResult {
  /** True when the push completed (may still have been up-to-date). */
  pushed: boolean
  /** True when at least one ref was actually updated on the remote. */
  updated: boolean
}

/**
 * Result of `Git.clone()`.
 */
export interface CloneResult {
  /** Absolute path to the freshly cloned working tree. */
  path: string
  /** Branch that was checked out. */
  branch: string
  /** Number of objects fetched (best-effort; may be 0 when libgit2 doesn't report). */
  receivedObjects: number
}

/**
 * Combined result of `commitAllAndPush`.
 */
export interface CommitAndPushResult {
  commit: CommitResult
  push: PushResult
}

/**
 * Top-level Git operations, all stateless — the local path is the identity.
 *
 * Implemented in C++ on top of libgit2 (https://libgit2).
 * All async functions run on a background thread; safe to call from JS.
 *
 * Note on optionality: we use TypeScript `?:` (optional) for nullable parameters
 * rather than `T | null`. Nitrogen translates `T?` to `std::optional<T>`, which
 * is far easier to handle in C++ than the `std::variant<NullType, T>` that
 * `T | null` would produce. From JS, omit the argument or pass `undefined`.
 */
export interface Git extends HybridObject<{ ios: 'c++', android: 'c++' }> {
  /** libgit2 version string, e.g. "1.9.0". */
  readonly version: string

  /**
   * Initialise an empty repository at `localPath`. Creates `.git` and the working tree.
   * Resolves with the absolute working-tree path. Rejects if the directory already contains a repo.
   */
  init(localPath: string): Promise<string>

  /**
   * Clone `url` into `localPath`. The destination must not exist or be empty.
   */
  clone(
    url: string,
    localPath: string,
    credentials?: GitCredentials,
    options?: CloneOptions,
  ): Promise<CloneResult>

  /**
   * Fetch from the upstream and merge it into HEAD (equivalent of `git pull`).
   * Uses the repository's configured upstream; falls back to "origin <head>" if missing.
   * Performs a fast-forward when possible, otherwise a real merge with `--no-ff` semantics.
   */
  pull(
    localPath: string,
    credentials?: GitCredentials,
    options?: InsecureOptions,
  ): Promise<PullResult>

  /**
   * Stage all changes (including untracked files, minus .gitignored), commit them
   * with `message` and push HEAD to its upstream (non-force).
   *
   * If there is nothing to stage, no commit is created (but push still runs).
   * Push failures reject the promise.
   */
  commitAllAndPush(
    localPath: string,
    message: string,
    credentials?: GitCredentials,
    options?: CommitAndInsecureOptions,
  ): Promise<CommitAndPushResult>

  /**
   * Push HEAD to its configured upstream without creating a commit.
   */
  push(
    localPath: string,
    credentials?: GitCredentials,
    options?: InsecureOptions,
  ): Promise<PushResult>

  /**
   * Compute the full working-tree status of the repository at `localPath`.
   * Cheap to call — runs in a few milliseconds even for large repos.
   */
  status(localPath: string): Promise<StatusResult>

  /**
   * Cheap check: returns true if `localPath/.git` exists (is a repo).
   */
  isRepository(localPath: string): Promise<boolean>
}
