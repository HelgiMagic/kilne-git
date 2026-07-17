/**
 * Tracked repository config. Tokens live in SecureStore (see `services/secure.ts`),
 * not in this model. Repo list is persisted as JSON via `services/storage.ts`.
 */

export interface Repo {
  id: string
  name: string
  url: string
  /** Empty on add → clone uses remote HEAD, then the real name is stored. */
  branch: string
  localPath: string
  username: string
  authorName: string
  authorEmail: string
  lastSyncedAt: string | null
}

export type NewRepo = Omit<Repo, 'id' | 'lastSyncedAt'> & { id?: string }

export type SyncState =
  | { kind: 'idle' }
  | { kind: 'pulling' }
  | { kind: 'pushing' }
  | { kind: 'cloning' }
  | { kind: 'done'; at: string; message: string }
  | { kind: 'error'; at: string; message: string }

/** Stable idle snapshot for Zustand selectors. */
export const IDLE_SYNC: SyncState = { kind: 'idle' }

const SECURE_KEY_PREFIX = 'kilne-git.token.'

export function tokenKey(repoId: string): string {
  return SECURE_KEY_PREFIX + repoId
}
