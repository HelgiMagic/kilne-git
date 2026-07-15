/**
 * Sync orchestration: pulls, commits-and-pushes, and clones repos via the git
 * service, updating the zustand store with progress + outcome so UI can react.
 *
 * Each action is idempotent: if another action is already running for the same
 * repo, the call is a no-op.
 */

import { useStore } from '@/store'
import * as git from '@/services/git'
import { saveRepos } from '@/services/storage'
import { type Repo } from '@/types/repo'

function isBusy(state: ReturnType<typeof useStore.getState>['sync'][string]): boolean {
  return state?.kind === 'pulling' || state?.kind === 'pushing' || state?.kind === 'cloning'
}

function assertNotBusy(repoId: string) {
  const { sync } = useStore.getState()
  if (isBusy(sync[repoId])) {
    throw new Error('Another sync is already in progress for this repository.')
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

/** Pull latest changes from upstream for `repo`. No-op when busy. */
export async function pullRepo(repo: Repo): Promise<void> {
  assertNotBusy(repo.id)
  useStore.getState().setSync(repo.id, { kind: 'pulling' })
  try {
    await git.pull(repo)
    setDone(repo.id, 'Pull complete')
    await persistLastSynced(repo.id)
  } catch (e) {
    setError(repo.id, e)
    throw e
  }
}

/** Stage everything + commit + push for `repo`. No-op when busy. */
export async function commitAndPushRepo(repo: Repo, message: string): Promise<void> {
  assertNotBusy(repo.id)
  useStore.getState().setSync(repo.id, { kind: 'pushing' })
  try {
    await git.commitAllAndPush(repo, message)
    setDone(repo.id, 'Push complete')
    await persistLastSynced(repo.id)
  } catch (e) {
    setError(repo.id, e)
    throw e
  }
}

/** Push without committing (for commits already made elsewhere). */
export async function pushRepo(repo: Repo): Promise<void> {
  assertNotBusy(repo.id)
  useStore.getState().setSync(repo.id, { kind: 'pushing' })
  try {
    await git.push(repo)
    setDone(repo.id, 'Push complete')
    await persistLastSynced(repo.id)
  } catch (e) {
    setError(repo.id, e)
    throw e
  }
}

/** First-time clone of `repo`. Used from the "Add repo" flow. */
export async function cloneRepo(repo: Repo): Promise<void> {
  useStore.getState().setSync(repo.id, { kind: 'cloning' })
  try {
    await git.clone(repo)
    setDone(repo.id, 'Clone complete')
    await persistLastSynced(repo.id)
  } catch (e) {
    setError(repo.id, e)
    throw e
  }
}
