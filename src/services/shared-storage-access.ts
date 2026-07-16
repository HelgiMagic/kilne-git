/**
 * Android shared-storage access for Obsidian-visible vault paths.
 *
 * Android 11+ requires the special “All files access” toggle
 * (`MANAGE_EXTERNAL_STORAGE`) — a normal runtime permission dialog is not enough.
 */

import { Linking, PermissionsAndroid, Platform } from 'react-native'
import Constants from 'expo-constants'
import { Directory } from 'expo-file-system'

import {
  resolveLocalPath,
  SHARED_STORAGE_ACCESS_ERROR,
  sharedStorageRoot,
  toFileUri,
} from '@/services/storage'

const PROBE_DIR_NAME = '.kilne-git-write-probe'

function androidApiLevel(): number {
  return typeof Platform.Version === 'number'
    ? Platform.Version
    : parseInt(String(Platform.Version), 10)
}

function appPackageName(): string {
  return Constants.expoConfig?.android?.package ?? 'com.kilne.git'
}

/** True when `path` resolves under shared phone storage (not app-private). */
export function isUnderSharedStorage(pathOrUri: string): boolean {
  if (Platform.OS !== 'android') {
    return false
  }
  const resolved = resolveLocalPath(pathOrUri)
  // Match any emulated/primary shared root, not only the hardcoded constant —
  // some devices use /storage/emulated/legacy or similar.
  if (
    resolved.startsWith('/storage/') ||
    resolved.startsWith('/sdcard/') ||
    resolved.startsWith('/mnt/sdcard/')
  ) {
    return true
  }
  const root = sharedStorageRoot().replace(/\/+$/, '')
  return resolved === root || resolved.startsWith(`${root}/`)
}

export function isSharedStorageAccessError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return (
    message === SHARED_STORAGE_ACCESS_ERROR ||
    /Missing ['"]WRITE['"] permission/i.test(message) ||
    /All files access/i.test(message) ||
    /EACCES|Permission denied/i.test(message)
  )
}

/**
 * Open the system screen to enable All files access for this app.
 * On Android 11+ this is a Settings toggle — there is no runtime permission dialog.
 */
export async function openAllFilesAccessSettings(): Promise<void> {
  if (Platform.OS !== 'android') {
    return
  }
  const pkg = appPackageName()

  // Per-app All files access screen (data URI must be package:<name>).
  try {
    await Linking.openURL(
      `intent:#Intent;action=android.settings.MANAGE_APP_ALL_FILES_ACCESS_PERMISSION;data=package:${pkg};end`,
    )
    return
  } catch {
    // fall through
  }

  try {
    await Linking.sendIntent('android.settings.MANAGE_APP_ALL_FILES_ACCESS_PERMISSION', [
      { key: 'android.provider.extra.APP_PACKAGE', value: pkg },
    ])
    return
  } catch {
    // fall through
  }

  try {
    await Linking.sendIntent('android.settings.MANAGE_ALL_FILES_ACCESS_PERMISSION')
    return
  } catch {
    // fall through
  }

  await Linking.openSettings()
}

/**
 * Ensure we can write under shared storage (e.g. Documents/).
 * Returns false when the user still needs to grant All files access.
 *
 * On API 30+ there is no runtime dialog — callers should open Settings when this
 * returns false.
 */
export async function ensureSharedStorageWriteAccess(): Promise<boolean> {
  if (Platform.OS !== 'android') {
    return true
  }

  if (androidApiLevel() < 30) {
    const result = await PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE,
      PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE,
    ])
    return (
      result[PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE] ===
      PermissionsAndroid.RESULTS.GRANTED
    )
  }

  return await probeSharedDocumentsWrite()
}

/**
 * Probe write access on the existing Documents folder.
 * expo-file-system checks File.canWrite() on the *parent*, so this works once
 * All files access is granted — unlike Directory.create on a path that does not
 * exist yet.
 */
async function probeSharedDocumentsWrite(): Promise<boolean> {
  const documentsPath = `${sharedStorageRoot().replace(/\/+$/, '')}/Documents`
  const documents = new Directory(toFileUri(documentsPath))
  try {
    if (!documents.exists) {
      return false
    }
    const probe = documents.createDirectory(PROBE_DIR_NAME)
    try {
      probe.delete()
    } catch {
      // best-effort cleanup
    }
    return true
  } catch {
    return false
  }
}
