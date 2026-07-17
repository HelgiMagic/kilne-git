/**
 * Android shared-storage access for Obsidian-visible vault paths.
 *
 * Android 11+ requires the special “All files access” toggle
 * (`MANAGE_EXTERNAL_STORAGE`) — there is no runtime permission dialog.
 * Without it, MediaProvider FUSE hides Obsidian-created files from `readdir`,
 * so git never stages new notes/attachments while tracked edits still work.
 */

import { Alert, Linking, NativeModules, PermissionsAndroid, Platform } from 'react-native'
import Constants from 'expo-constants'

import {
  resolveLocalPath,
  SHARED_STORAGE_ACCESS_ERROR,
  sharedStorageRoot,
} from '@/services/storage'

type AllFilesAccessNative = {
  isExternalStorageManager: () => Promise<boolean>
  openSettings: () => Promise<void>
}

function androidApiLevel(): number {
  return typeof Platform.Version === 'number'
    ? Platform.Version
    : parseInt(String(Platform.Version), 10)
}

function appPackageName(): string {
  return Constants.expoConfig?.android?.package ?? 'com.kilne.git'
}

function nativeAllFiles(): AllFilesAccessNative | null {
  const mod = NativeModules.KilneAllFilesAccess as AllFilesAccessNative | undefined
  if (
    mod != null &&
    typeof mod.isExternalStorageManager === 'function' &&
    typeof mod.openSettings === 'function'
  ) {
    return mod
  }
  return null
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

  const native = nativeAllFiles()
  if (native != null) {
    try {
      await native.openSettings()
      return
    } catch {
      // fall through to Linking fallbacks
    }
  }

  const pkg = appPackageName()

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
 * True when the process has All Files Access (API 30+) or legacy storage grants.
 * Uses `Environment.isExternalStorageManager()` — not a Documents write probe
 * (write can succeed for app-owned paths while foreign files stay invisible).
 */
export async function hasAllFilesAccess(): Promise<boolean> {
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

  const native = nativeAllFiles()
  if (native == null) {
    // Native module missing (bad link) — refuse rather than false-positive.
    return false
  }
  return await native.isExternalStorageManager()
}

/**
 * Ensure All Files Access for shared-storage vaults.
 * Returns false when the user still needs to grant it in Settings.
 */
export async function ensureSharedStorageWriteAccess(): Promise<boolean> {
  return await hasAllFilesAccess()
}

/**
 * Throw if `path` is under shared storage and All Files Access is missing.
 * Call before clone / status / commit / pull / push.
 */
export async function requireSharedStorageAccess(pathOrUri: string): Promise<void> {
  if (!isUnderSharedStorage(pathOrUri)) {
    return
  }
  if (!(await hasAllFilesAccess())) {
    throw new Error(SHARED_STORAGE_ACCESS_ERROR)
  }
}

/** Alert + open the All files access Settings screen. */
export function promptSharedStorageAccess(onOpened?: () => void): void {
  Alert.alert(
    'All files access needed',
    'kilne-git must see files created by Obsidian (new notes and photos). Android has no normal permission popup — enable “All files access” (or “Allow access to manage all files”) for kilne-git, then try again.',
    [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Open settings',
        onPress: () => {
          void openAllFilesAccessSettings().then(() => onOpened?.())
        },
      },
    ],
  )
}
