import { create } from 'zustand'

import { loadRepos, saveRepos } from '@/services/storage'
import { deleteToken, saveToken } from '@/services/secure'
import { type NewRepo, type Repo, type SyncState } from '@/types/repo'

interface AppState {
  repos: Repo[]
  sync: Record<string, SyncState>
  hydrated: boolean
  hydrate: () => Promise<void>
  upsertRepo: (input: NewRepo) => Promise<Repo>
  removeRepo: (id: string) => Promise<void>
  setRepoToken: (id: string, token: string) => Promise<void>
  setSync: (id: string, state: SyncState) => void
}

function makeId(): string {
  // Local repo ids only — not a security boundary.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 11)}`
}

function withId(input: NewRepo): Repo {
  return {
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
}

export const useStore = create<AppState>((set, get) => ({
  repos: [],
  sync: {},
  hydrated: false,

  hydrate: async () => {
    if (get().hydrated) return
    const repos = await loadRepos()
    set({ repos, hydrated: true })
  },

  upsertRepo: async (input) => {
    const existing = input.id != null ? get().repos.find((r) => r.id === input.id) : undefined
    const repo: Repo =
      existing != null ? { ...existing, ...input, id: existing.id } : withId(input)
    const next =
      existing != null
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
