/**
 * Sync orchestration: clone / pull / push / commit-and-push / full sync.
 * Updates zustand sync state so the UI can show progress and outcomes.
 */

import { useStore } from '@/store'
import * as git from '@/services/git'
import {
  isSharedStorageAccessError,
  promptSharedStorageAccess,
  requireSharedStorageAccess,
} from '@/services/shared-storage-access'
import { saveRepos } from '@/services/storage'
import { type Repo } from '@/types/repo'

function isBusy(state: ReturnType<typeof useStore.getState>['sync'][string]): boolean {
  return state?.kind === 'pulling' || state?.kind === 'pushing' || state?.kind === 'cloning'
}

function assertNotBusy(repoId: string) {
  const { sync } = useStore.getState()
  if (isBusy(sync[repoId])) {
    throw new Error('another sync is already in progress for this repository.')
  }
}

function nowIso(): string {
  return new Date().toISOString()
}

function setDone(repoId: string, message: string) {
  useStore.getState().setSync(repoId, { kind: 'done', at: nowIso(), message })
}

function setError(repoId: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  useStore.getState().setSync(repoId, { kind: 'error', at: nowIso(), message })
}

async function persistLastSynced(repoId: string) {
  const { repos } = useStore.getState()
  const updated = repos.map((r) =>
    r.id === repoId ? { ...r, lastSyncedAt: nowIso() } : r,
  )
  useStore.setState({ repos: updated })
  await saveRepos(updated)
}

async function ensureRepoStorageAccess(repo: Repo): Promise<void> {
  try {
    await requireSharedStorageAccess(repo.localPath)
  } catch (e) {
    if (isSharedStorageAccessError(e)) {
      promptSharedStorageAccess()
    }
    setError(repo.id, e)
    throw e
  }
}

function pullDoneMessage(result: Awaited<ReturnType<typeof git.pull>>): string {
  if (result.merged) return 'merged and pushed upstream changes'
  if (result.fastForwarded) {
    const n = Math.max(1, Math.round(result.commitsFetched))
    return `pulled ${n} commit${n === 1 ? '' : 's'} (fast-forward)`
  }
  if (result.commitsFetched === 0) return 'sync complete'
  return 'pull complete'
}

function commitPushDoneMessage(result: Awaited<ReturnType<typeof git.commitAllAndPush>>): string {
  if (result.sha != null && result.filesChanged > 0) {
    const n = Math.round(result.filesChanged)
    return `committed ${n} file${n === 1 ? '' : 's'} (${result.sha.slice(0, 7)}) and pushed`
  }
  return 'nothing new to commit — pushed current head'
}

export async function pullRepo(repo: Repo): Promise<void> {
  assertNotBusy(repo.id)
  await ensureRepoStorageAccess(repo)
  useStore.getState().setSync(repo.id, { kind: 'pulling' })
  try {
    const result = await git.pull(repo)
    setDone(repo.id, pullDoneMessage(result))
    await persistLastSynced(repo.id)
  } catch (e) {
    setError(repo.id, e)
    throw e
  }
}

export async function commitAndPushRepo(repo: Repo, message: string): Promise<void> {
  assertNotBusy(repo.id)
  await ensureRepoStorageAccess(repo)
  useStore.getState().setSync(repo.id, { kind: 'pushing' })
  try {
    const result = await git.commitAllAndPush(repo, message)
    setDone(repo.id, commitPushDoneMessage(result))
    await persistLastSynced(repo.id)
  } catch (e) {
    setError(repo.id, e)
    throw e
  }
}

/**
 * Bidirectional sync via native pull: auto-commit dirty → fetch → FF/merge →
 * push when ahead. Avoids a second full stage+push pass (previously pull then
 * commitAllAndPush), which dominated wall time on large Obsidian vaults.
 */
export async function syncRepo(repo: Repo, _message?: string): Promise<void> {
  assertNotBusy(repo.id)
  await ensureRepoStorageAccess(repo)
  useStore.getState().setSync(repo.id, { kind: 'pulling' })
  try {
    const pullResult = await git.pull(repo)
    setDone(repo.id, pullDoneMessage(pullResult))
    await persistLastSynced(repo.id)
  } catch (e) {
    setError(repo.id, e)
    throw e
  }
}

export async function pushRepo(repo: Repo): Promise<void> {
  assertNotBusy(repo.id)
  await ensureRepoStorageAccess(repo)
  useStore.getState().setSync(repo.id, { kind: 'pushing' })
  try {
    await git.push(repo)
    setDone(repo.id, 'pushed current head (no new commit)')
    await persistLastSynced(repo.id)
  } catch (e) {
    setError(repo.id, e)
    throw e
  }
}

export async function cloneRepo(repo: Repo): Promise<void> {
  assertNotBusy(repo.id)
  await ensureRepoStorageAccess(repo)
  useStore.getState().setSync(repo.id, { kind: 'cloning' })
  try {
    const result = await git.clone(repo)
    if (result.branch.length > 0 && result.branch !== 'HEAD' && result.branch !== repo.branch) {
      await useStore.getState().upsertRepo({ ...repo, branch: result.branch })
    }
    setDone(repo.id, 'clone complete')
    await persistLastSynced(repo.id)
  } catch (e) {
    setError(repo.id, e)
    throw e
  }
}
