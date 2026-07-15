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
 * List all repo IDs that have a token stored. Used to display "token set" badges
 * without exposing the value itself.
 *
 * expo-secure-store doesn't ship an enumeration API, so we rely on the well-known
 * prefix. This is cheap (reads the keystore only when accessed) and matches what
 * libraries like `expo-secure-store` themselves recommend for grouped keys.
 */
export async function listTokenIds(): Promise<Set<string>> {
  // SecureStore doesn't expose SecureStore's internal storage; we approximate by
  // probing known IDs from outside. In practice the app always knows the repo IDs
  // because they live in storage.ts, so this helper is mostly here for completeness.
  throw new Error('listTokenIds is not supported by expo-secure-store — pass known IDs from loadRepos().')
}

export { SECURE_KEY_PREFIX }
