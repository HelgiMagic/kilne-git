/**
 * Secure storage wrapper around `expo-secure-store` for personal access tokens.
 *
 * Tokens are keyed per-repo as `kilne-git.token.<repoId>` (see {@link tokenKey}).
 * On Android, SecureStore uses the Android Keystore — values are encrypted at
 * rest with a hardware-backed key when available.
 */

import * as SecureStore from 'expo-secure-store'

import { SECURE_KEY_PREFIX, tokenKey } from '@/types/repo'

/** Save a token for a repo, replacing any previous value. */
export async function saveToken(repoId: string, token: string): Promise<void> {
  await SecureStore.setItemAsync(tokenKey(repoId), token, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED,
  })
}

/** Get the token for a repo, or null when none is stored. */
export async function loadToken(repoId: string): Promise<string | null> {
  return await SecureStore.getItemAsync(tokenKey(repoId))
}

/** Delete the token for a repo. Safe to call when no token is stored. */
export async function deleteToken(repoId: string): Promise<void> {
  await SecureStore.deleteItemAsync(tokenKey(repoId))
}

/**
 * Probe which of the given repo IDs have a token stored.
 * expo-secure-store has no enumeration API, so callers must supply known IDs.
 */
export async function listTokenIds(knownRepoIds: readonly string[]): Promise<Set<string>> {
  const present = new Set<string>()
  await Promise.all(
    knownRepoIds.map(async (id) => {
      const value = await loadToken(id)
      if (value != null && value.length > 0) {
        present.add(id)
      }
    }),
  )
  return present
}

export { SECURE_KEY_PREFIX }
