import type { HybridObject } from 'react-native-nitro-modules'

/**
 * Credentials for HTTPS basic authentication.
 * For GitHub/GitLab PATs: username can be anything (commonly "x-access-token"),
 * password is the token.
 */
export interface GitCredentials {
  username: string
  password: string
}

/** Per-call flags shared by pull / push. */
export interface InsecureOptions {
  /** Disable TLS certificate verification (self-signed / self-hosted). */
  insecure?: boolean
}

/** Author identity for commits. Committer uses the same identity. */
export interface CommitOptions {
  authorName?: string
  authorEmail?: string
}

export interface CommitAndInsecureOptions extends CommitOptions, InsecureOptions {}

export interface CloneOptions {
  /** Branch to check out after clone. If omitted, uses the remote HEAD. */
  branch?: string
  insecure?: boolean
}

/**
 * Status of a single file. Mirrors `git_status_t` from libgit2 (simplified).
 * String union (not numeric enum) so Nitrogen keeps type-safe C++ variants.
 */
export type FileState =
  | 'current'
  | 'new'
  | 'modified'
  | 'deleted'
  | 'renamed'
  | 'typechange'
  | 'conflicted'

export interface FileStatusEntry {
  path: string
  worktree: FileState
  index: FileState
}

export interface StatusResult {
  isClean: boolean
  ahead: number
  behind: number
  staged: FileStatusEntry[]
  working: FileStatusEntry[]
  untracked: string[]
  conflicted: string[]
  head?: string
  upstream?: string
}

export interface CommitResult {
  /** SHA of the new commit, or omitted when there was nothing to commit. */
  sha?: string
  filesChanged: number
}

export interface PullResult {
  fastForwarded: boolean
  merged: boolean
  commitsFetched: number
  conflicted: string[]
}

export interface PushResult {
  pushed: boolean
  updated: boolean
}

export interface CloneResult {
  path: string
  branch: string
  receivedObjects: number
}

export interface CommitAndPushResult {
  commit: CommitResult
  push: PushResult
}

/**
 * Stateless git operations — `localPath` is the identity.
 * Implemented in C++ on libgit2. Async methods run off the JS thread.
 *
 * Optional params use `?:` (→ `std::optional`) rather than `T | null`.
 */
export interface Git extends HybridObject<{ android: 'c++' }> {
  readonly version: string

  /**
   * Clone `url` into `localPath`. Destination must not exist or be empty.
   */
  clone(
    url: string,
    localPath: string,
    credentials?: GitCredentials,
    options?: CloneOptions,
  ): Promise<CloneResult>

  /**
   * Fetch + merge into HEAD (`git pull`). Fast-forward when possible,
   * otherwise union-merge. May auto-commit dirty local changes first and
   * push after a merge commit.
   */
  pull(
    localPath: string,
    credentials?: GitCredentials,
    options?: InsecureOptions,
  ): Promise<PullResult>

  /**
   * Stage all changes (`git add -A` + workdir walk), commit with `message`,
   * push HEAD (non-force). No commit is created when there is nothing to
   * stage; push still runs. Throws if new files remain unstageable after retry.
   */
  commitAllAndPush(
    localPath: string,
    message: string,
    credentials?: GitCredentials,
    options?: CommitAndInsecureOptions,
  ): Promise<CommitAndPushResult>

  /** Push HEAD to its upstream without creating a commit. */
  push(
    localPath: string,
    credentials?: GitCredentials,
    options?: InsecureOptions,
  ): Promise<PushResult>

  status(localPath: string): Promise<StatusResult>

  /** True if `localPath` is a git repository. */
  isRepository(localPath: string): Promise<boolean>
}
