/**
 * Secure storage for personal access tokens (expo-secure-store / Android Keystore).
 * In-memory cache avoids a Keystore round-trip on every pull/push/sync.
 */

import * as SecureStore from 'expo-secure-store'

import { tokenKey } from '@/types/repo'

const tokenCache = new Map<string, string>()

export async function saveToken(repoId: string, token: string): Promise<void> {
  await SecureStore.setItemAsync(tokenKey(repoId), token, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED,
  })
  tokenCache.set(repoId, token)
}

export async function loadToken(repoId: string): Promise<string | null> {
  const cached = tokenCache.get(repoId)
  if (cached != null) return cached
  const token = await SecureStore.getItemAsync(tokenKey(repoId))
  if (token != null && token.length > 0) {
    tokenCache.set(repoId, token)
  }
  return token
}

export async function deleteToken(repoId: string): Promise<void> {
  tokenCache.delete(repoId)
  await SecureStore.deleteItemAsync(tokenKey(repoId))
}
