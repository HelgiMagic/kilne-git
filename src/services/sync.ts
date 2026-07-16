/**
 * Sync orchestration: clone / pull / push / commit-and-push.
 * Updates zustand sync state so the UI can show progress and outcomes.
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

export async function pullRepo(repo: Repo): Promise<void> {
  assertNotBusy(repo.id)
  useStore.getState().setSync(repo.id, { kind: 'pulling' })
  try {
    const result = await git.pull(repo)
    if (result.merged) {
      setDone(repo.id, 'Merged and pushed upstream changes')
    } else if (result.fastForwarded) {
      const n = Math.max(1, Math.round(result.commitsFetched))
      setDone(repo.id, `Pulled ${n} commit${n === 1 ? '' : 's'} (fast-forward)`)
    } else if (result.commitsFetched === 0) {
      setDone(repo.id, 'Already up to date')
    } else {
      setDone(repo.id, 'Pull complete')
    }
    await persistLastSynced(repo.id)
  } catch (e) {
    setError(repo.id, e)
    throw e
  }
}

export async function commitAndPushRepo(repo: Repo, message: string): Promise<void> {
  assertNotBusy(repo.id)
  useStore.getState().setSync(repo.id, { kind: 'pushing' })
  try {
    const result = await git.commitAllAndPush(repo, message)
    if (result.sha != null && result.filesChanged > 0) {
      const n = Math.round(result.filesChanged)
      setDone(
        repo.id,
        `Committed ${n} file${n === 1 ? '' : 's'} (${result.sha.slice(0, 7)}) and pushed`,
      )
    } else {
      setDone(repo.id, 'Nothing new to commit — pushed current HEAD')
    }
    await persistLastSynced(repo.id)
  } catch (e) {
    setError(repo.id, e)
    throw e
  }
}

export async function pushRepo(repo: Repo): Promise<void> {
  assertNotBusy(repo.id)
  useStore.getState().setSync(repo.id, { kind: 'pushing' })
  try {
    await git.push(repo)
    setDone(repo.id, 'Pushed current HEAD (no new commit)')
    await persistLastSynced(repo.id)
  } catch (e) {
    setError(repo.id, e)
    throw e
  }
}

export async function cloneRepo(repo: Repo): Promise<void> {
  assertNotBusy(repo.id)
  useStore.getState().setSync(repo.id, { kind: 'cloning' })
  try {
    const result = await git.clone(repo)
    if (result.branch.length > 0 && result.branch !== 'HEAD' && result.branch !== repo.branch) {
      await useStore.getState().upsertRepo({ ...repo, branch: result.branch })
    }
    setDone(repo.id, 'Clone complete')
    await persistLastSynced(repo.id)
  } catch (e) {
    setError(repo.id, e)
    throw e
  }
}
