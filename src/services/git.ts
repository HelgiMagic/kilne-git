/**
 * High-level git service used by the UI. Wraps the native HybridGit object and
 * pairs it with the persisted {@link Repo} records so callers don't have to
 * pass paths / credentials around manually.
 */

import {
  getGit,
  type CloneResult,
  type Git,
  type GitCredentials,
  type PullResult,
  type StatusResult,
} from 'kilne-git-native'
import { Directory } from 'expo-file-system'

import type { Repo } from '@/types/repo'
import { loadToken } from '@/services/secure'
import {
  ensureDirectoryExists,
  resolveLocalPath,
  toFileUri,
  toFilesystemPath,
} from '@/services/storage'

/** Absolute FS path for libgit2 — strips a `file://` URI if the caller stored one. */
function nativePath(repoOrPath: Repo | string): string {
  const raw = typeof repoOrPath === 'string' ? repoOrPath : repoOrPath.localPath
  return resolveLocalPath(toFilesystemPath(raw))
}

/**
 * Maps a stored {@link Repo} to the credentials expected by the native layer.
 * When no token is stored, returns undefined (anonymous transport).
 */
async function toCredentials(repo: Repo): Promise<GitCredentials | undefined> {
  const token = await loadToken(repo.id)
  if (token == null || token.length === 0) {
    return undefined
  }
  return { username: repo.username, password: token }
}

function options(repo: Repo) {
  return { insecure: repo.insecure }
}

function commitOptions(repo: Repo) {
  return {
    insecure: repo.insecure,
    authorName: repo.authorName || undefined,
    authorEmail: repo.authorEmail || undefined,
  }
}

function cloneOptions(repo: Repo) {
  const branch = repo.branch.trim()
  return {
    // Omit branch so libgit2 checks out the remote HEAD (main, master, …).
    branch: branch.length > 0 ? branch : undefined,
    insecure: repo.insecure,
  }
}

/**
 * Lazily-initialized native handle. The native object is a singleton; we cache
 * it on the JS side too.
 */
let _git: Git | null = null
function git(): Git {
  if (_git === null) {
    _git = getGit()
  }
  return _git
}

/** Exposed for tests; in production the singleton is fine. */
export function _resetGitForTests(): void {
  _git = null
}

// ----------------------------------------------------------------------------
// Public operations
// ----------------------------------------------------------------------------

/** `git init` at the given path. Throws if the directory is a repo already. */
export async function init(localPath: string): Promise<string> {
  return await git().init(nativePath(localPath))
}

/** Best-effort recursive delete — used to unwind a failed / partial clone. */
function removeDirectoryBestEffort(path: string): void {
  try {
    const dir = new Directory(toFileUri(path))
    if (dir.exists) {
      dir.delete()
    }
  } catch {
    // ignore — caller still surfaces the original error
  }
}

/**
 * Leftover from a previous failed clone (ownership / network / etc.).
 * Safe to wipe: has a `.git` dir but is not openable as a repository.
 * Never deletes a path that only has user files (no `.git`).
 */
async function isPartialFailedClone(path: string, dir: Directory): Promise<boolean> {
  const entries = dir.list()
  if (!entries.some((entry) => entry.name === '.git')) {
    return false
  }
  try {
    return !(await git().isRepository(path))
  } catch {
    return true
  }
}

/**
 * Clone a repository. Creates `localPath` if missing.
 * On failure, removes the destination when we created it or cleared a partial clone,
 * so retry does not hit “Destination is not empty”.
 * Returns the clone result (including the branch that was actually checked out).
 */
export async function clone(repo: Repo): Promise<CloneResult> {
  const path = nativePath(repo)
  const dir = new Directory(toFileUri(path))
  let cleanupOnFailure = false

  if (dir.exists) {
    const entries = dir.list()
    if (entries.length > 0) {
      if (await isPartialFailedClone(path, dir)) {
        removeDirectoryBestEffort(path)
        await ensureDirectoryExists(path)
        cleanupOnFailure = true
      } else {
        throw new Error(`Destination is not empty: ${path}`)
      }
    } else {
      cleanupOnFailure = true
    }
  } else {
    await ensureDirectoryExists(path)
    cleanupOnFailure = true
  }

  try {
    return await git().clone(repo.url, path, await toCredentials(repo), cloneOptions(repo))
  } catch (e) {
    if (cleanupOnFailure) {
      removeDirectoryBestEffort(path)
    }
    throw e
  }
}

/**
 * `git pull` on the configured upstream (falls back to origin/<head>).
 * Commits dirty local changes if needed, merges with union auto-resolve,
 * completes any interrupted merge, then pushes when local is ahead.
 * Returns the native result so callers can distinguish "already up to date".
 */
export async function pull(repo: Repo): Promise<PullResult> {
  const result = await git().pull(nativePath(repo), await toCredentials(repo), options(repo))
  if (result.conflicted.length > 0) {
    throw new Error(
      `Merge conflicts in ${result.conflicted.length} file(s): ${result.conflicted.slice(0, 5).join(', ')}`,
    )
  }
  return result
}

/** Stage everything + commit + push. Throws if the push fails. */
export async function commitAllAndPush(repo: Repo, message: string): Promise<void> {
  const result = await git().commitAllAndPush(
    nativePath(repo),
    message,
    await toCredentials(repo),
    commitOptions(repo),
  )
  if (!result.push.pushed) {
    const sha = result.commit.sha != null ? ` (commit ${result.commit.sha.slice(0, 7)})` : ''
    throw new Error(`Push failed${sha}`)
  }
}

/** `git push HEAD` without staging/committing. */
export async function push(repo: Repo): Promise<void> {
  const result = await git().push(nativePath(repo), await toCredentials(repo), options(repo))
  if (!result.pushed) {
    throw new Error('Push failed')
  }
}

/** Full status of the repo. */
export async function status(repo: Repo): Promise<StatusResult> {
  return await git().status(nativePath(repo))
}

/** Cheap repo-existence check. */
export async function isRepository(localPath: string): Promise<boolean> {
  return await git().isRepository(nativePath(localPath))
}

/** libgit2 version string, surfaced for diagnostics. */
export function gitVersion(): string {
  return git().version
}
