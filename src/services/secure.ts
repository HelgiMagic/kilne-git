/**
 * Secure storage for personal access tokens (expo-secure-store / Android Keystore).
 */

import * as SecureStore from 'expo-secure-store'

import { tokenKey } from '@/types/repo'

export async function saveToken(repoId: string, token: string): Promise<void> {
  await SecureStore.setItemAsync(tokenKey(repoId), token, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED,
  })
}

export async function loadToken(repoId: string): Promise<string | null> {
  return await SecureStore.getItemAsync(tokenKey(repoId))
}

export async function deleteToken(repoId: string): Promise<void> {
  await SecureStore.deleteItemAsync(tokenKey(repoId))
}
