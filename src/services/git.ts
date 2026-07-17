/**
 * High-level git service: wraps HybridGit with Repo credentials and path helpers.
 */

import {
  getGit,
  type CloneResult,
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

function nativePath(repoOrPath: Repo | string): string {
  const raw = typeof repoOrPath === 'string' ? repoOrPath : repoOrPath.localPath
  return resolveLocalPath(toFilesystemPath(raw))
}

async function toCredentials(repo: Repo): Promise<GitCredentials | undefined> {
  const token = await loadToken(repo.id)
  if (token == null || token.length === 0) return undefined
  return { username: repo.username, password: token }
}

function commitOptions(repo: Repo) {
  return {
    authorName: repo.authorName || undefined,
    authorEmail: repo.authorEmail || undefined,
  }
}

function cloneOptions(repo: Repo) {
  const branch = repo.branch.trim()
  return {
    branch: branch.length > 0 ? branch : undefined,
  }
}

let cachedGit: ReturnType<typeof getGit> | null = null
function git() {
  return (cachedGit ??= getGit())
}

function removeDirectoryBestEffort(path: string): void {
  try {
    const dir = new Directory(toFileUri(path))
    if (dir.exists) dir.delete()
  } catch {
    // ignore — caller still surfaces the original error
  }
}

/** Leftover failed clone: has `.git` but is not openable. Never deletes user-only files. */
async function isPartialFailedClone(path: string, dir: Directory): Promise<boolean> {
  const entries = dir.list()
  if (!entries.some((entry) => entry.name === '.git')) return false
  try {
    return !(await git().isRepository(path))
  } catch {
    return true
  }
}

/**
 * Clone into `repo.localPath`. On failure, cleans up if we created/cleared the dir.
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
    if (cleanupOnFailure) removeDirectoryBestEffort(path)
    throw e
  }
}

export async function pull(repo: Repo): Promise<PullResult> {
  const result = await git().pull(nativePath(repo), await toCredentials(repo))
  if (result.conflicted.length > 0) {
    throw new Error(
      `Merge conflicts in ${result.conflicted.length} file(s): ${result.conflicted.slice(0, 5).join(', ')}`,
    )
  }
  return result
}

export async function commitAllAndPush(repo: Repo, message: string): Promise<{
  filesChanged: number
  sha?: string
}> {
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
  return {
    filesChanged: result.commit.filesChanged,
    sha: result.commit.sha,
  }
}

export async function push(repo: Repo): Promise<void> {
  const result = await git().push(nativePath(repo), await toCredentials(repo))
  if (!result.pushed) throw new Error('Push failed')
}

export async function status(repo: Repo): Promise<StatusResult> {
  return await git().status(nativePath(repo))
}
