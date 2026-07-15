/**
 * Global app state. Powered by zustand because it's tiny, framework-agnostic
 * and works great with React 19's `useSyncExternalStore`.
 *
 * The store keeps the in-memory list of repos (mirrored from disk) plus a
 * per-repo transient sync-state map that the UI reads to render spinners and
 * toast notifications.
 */

import { create } from 'zustand'

import { loadRepos, saveRepos } from '@/services/storage'
import { deleteToken, saveToken } from '@/services/secure'
import { type NewRepo, type Repo, type SyncState } from '@/types/repo'

interface AppState {
  /** Persisted repos, hydrated from disk on startup. */
  repos: Repo[]
  /** Per-repo transient state for the most recent action. */
  sync: Record<string, SyncState>
  /** True until the initial hydration from disk has finished. */
  hydrated: boolean

  // actions
  hydrate: () => Promise<void>
  upsertRepo: (input: NewRepo) => Promise<Repo>
  removeRepo: (id: string) => Promise<void>
  setRepoToken: (id: string, token: string) => Promise<void>
  setSync: (id: string, state: SyncState) => void
}

function makeId(): string {
  // Lightweight UUID v4. React Native ships crypto.getRandomValues.
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0'))
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10, 16).join('')}`
}

function withId(input: NewRepo): Repo {
  const repo: Repo = {
    id: input.id ?? makeId(),
    name: input.name,
    url: input.url,
    branch: input.branch,
    localPath: input.localPath,
    username: input.username,
    insecure: input.insecure,
    authorName: input.authorName,
    authorEmail: input.authorEmail,
    lastSyncedAt: null,
  }
  return repo
}

export const useStore = create<AppState>((set, get) => ({
  repos: [],
  sync: {},
  hydrated: false,

  hydrate: async () => {
    if (get().hydrated) {
      return
    }
    const repos = await loadRepos()
    set({ repos, hydrated: true })
  },

  upsertRepo: async (input) => {
    const existing = input.id != null
      ? get().repos.find((r) => r.id === input.id)
      : undefined
    const repo: Repo = existing != null
      ? { ...existing, ...input, id: existing.id }
      : withId(input)
    const next = existing != null
      ? get().repos.map((r) => (r.id === repo.id ? repo : r))
      : [...get().repos, repo]
    set({ repos: next })
    await saveRepos(next)
    return repo
  },

  removeRepo: async (id) => {
    const next = get().repos.filter((r) => r.id !== id)
    const nextSync = { ...get().sync }
    delete nextSync[id]
    set({ repos: next, sync: nextSync })
    await saveRepos(next)
    await deleteToken(id)
  },

  setRepoToken: async (id, token) => {
    await saveToken(id, token)
  },

  setSync: (id, state) => {
    set((s) => ({ sync: { ...s.sync, [id]: state } }))
  },
}))

/** Selector: returns the live sync state for a repo, or idle. */
export function selectSync(sync: Record<string, SyncState>, id: string): SyncState {
  return sync[id] ?? { kind: 'idle' }
}
