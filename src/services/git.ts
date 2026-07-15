/**
 * High-level git service used by the UI. Wraps the native HybridGit object and
 * pairs it with the persisted {@link Repo} records so callers don't have to
 * pass paths / credentials around manually.
 */

import { getGit, type Git, type GitCredentials, type StatusResult } from 'kilne-git-native'
import { Directory } from 'expo-file-system'

import type { Repo } from '@/types/repo'
import { loadToken } from '@/services/secure'
import { ensureDirectoryExists } from '@/services/storage'

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
  return {
    branch: repo.branch || undefined,
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
  return await git().init(localPath)
}

/**
 * Clone a repository. Creates `localPath` if missing, throwing away any existing
 * contents when they are empty.
 */
export async function clone(repo: Repo): Promise<void> {
  const dir = new Directory(repo.localPath)
  if (dir.exists) {
    const entries = dir.list()
    if (entries.length > 0) {
      throw new Error(`Destination is not empty: ${repo.localPath}`)
    }
  } else {
    await ensureDirectoryExists(repo.localPath)
  }
  await git().clone(repo.url, repo.localPath, await toCredentials(repo), cloneOptions(repo))
}

/** `git pull` on the configured upstream. */
export async function pull(repo: Repo): Promise<void> {
  await git().pull(repo.localPath, await toCredentials(repo), options(repo))
}

/** Stage everything + commit + push. */
export async function commitAllAndPush(repo: Repo, message: string): Promise<void> {
  await git().commitAllAndPush(
    repo.localPath,
    message,
    await toCredentials(repo),
    commitOptions(repo),
  )
}

/** `git push HEAD` without staging/committing. */
export async function push(repo: Repo): Promise<void> {
  await git().push(repo.localPath, await toCredentials(repo), options(repo))
}

/** Full status of the repo. */
export async function status(repo: Repo): Promise<StatusResult> {
  return await git().status(repo.localPath)
}

/** Cheap repo-existence check. */
export async function isRepository(localPath: string): Promise<boolean> {
  return await git().isRepository(localPath)
}

/** libgit2 version string, surfaced for diagnostics. */
export function gitVersion(): string {
  return git().version
}
