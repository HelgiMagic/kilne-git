/**
 * JS-side model of a tracked repository. Persisted in AsyncStorage under
 * {@link STORAGE_KEYS.repos} and looked up by {@link Repo['id']}.
 *
 * The personal access token is NOT stored here — it lives in expo-secure-store
 * keyed by `kilne-git.token.<id>` (see {@link secureStorage}).
 */
export interface Repo {
  /** Stable random ID (UUID v4). */
  id: string
  /** Display name shown in the UI. Defaults to the repo name from the URL. */
  name: string
  /** HTTPS clone URL, e.g. `https://github.com/user/vault.git`. */
  url: string
  /** Default branch, e.g. `main`. Used for clone + as fallback when no upstream is set. */
  branch: string
  /** Absolute filesystem path to the working tree on the device. */
  localPath: string
  /** GitHub-style username used for basic auth (anything for tokens). */
  username: string
  /** Whether to disable TLS certificate verification (self-hosted servers). */
  insecure: boolean
  /** Author identity for commits, when not derived from token / git config. */
  authorName: string
  authorEmail: string
  /** ISO timestamp of the last successful sync. */
  lastSyncedAt: string | null
}

/** Subset of {@link Repo} that the user can edit when adding a new repository. */
export type NewRepo = Omit<Repo, 'id' | 'lastSyncedAt'> & { id?: string }

/** Live progress / result of the most recent sync action for a given repo. */
export type SyncState =
  | { kind: 'idle' }
  | { kind: 'pulling' }
  | { kind: 'pushing' }
  | { kind: 'cloning' }
  | { kind: 'done'; at: string; message: string }
  | { kind: 'error'; at: string; message: string }

export const STORAGE_KEYS = {
  repos: 'kilne-git.repos',
} as const

export const SECURE_KEY_PREFIX = 'kilne-git.token.'

/** Build the secure-storage key for a repo's token. */
export function tokenKey(repoId: string): string {
  return SECURE_KEY_PREFIX + repoId
}
