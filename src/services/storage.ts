/**
 * Persists the list of {@link Repo} configs to the device.
 *
 * Uses the new object-oriented `expo-file-system` API (v57+). Config is stored
 * as JSON in the app's document directory, which survives re-installs of the JS
 * bundle but is wiped if the app itself is uninstalled.
 */

import { Platform } from 'react-native'
import { Directory, File, Paths } from 'expo-file-system'

import { type Repo, STORAGE_KEYS } from '@/types/repo'

const FILE_NAME = 'kilne-git.repos.json'

/** Primary shared storage root on Android (what file managers call “Internal storage”). */
const ANDROID_SHARED_ROOT = '/storage/emulated/0'

function repoFile(): File {
  // `Paths.document` is a Directory; join it with our filename to get a File.
  return new File(Paths.document, FILE_NAME)
}

/**
 * Load all repos from disk. Returns an empty array when the file does not exist
 * yet (first launch) or is empty / corrupt.
 */
export async function loadRepos(): Promise<Repo[]> {
  const file = repoFile()
  if (!file.exists) {
    return []
  }
  const raw = await file.text()
  if (raw.trim().length === 0) {
    return []
  }
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) {
      return []
    }
    return parsed.filter((r): r is Repo => typeof r === 'object' && r != null && 'id' in r)
  } catch {
    return []
  }
}

/**
 * Persist the full list of repos to disk, atomically replacing any previous file.
 */
export async function saveRepos(repos: Repo[]): Promise<void> {
  const file = repoFile()
  const json = JSON.stringify(repos, null, 2)
  await file.write(json, { encoding: 'utf8' })
}

/** Returns the document directory as a `file://` URI string. */
export function documentDirectoryUri(): string {
  return Paths.document.uri
}

/**
 * Returns the document directory as an absolute filesystem path (no `file://` scheme).
 * Use this for libgit2 and anywhere a native path is required.
 */
export function documentDirectoryPath(): string {
  return toFilesystemPath(Paths.document.uri)
}

/**
 * Shared storage root other apps (e.g. Obsidian) can read.
 * On Android this is internal storage; elsewhere fall back to the app document dir.
 */
export function sharedStorageRoot(): string {
  if (Platform.OS === 'android') {
    return ANDROID_SHARED_ROOT
  }
  return documentDirectoryPath()
}

/** Slugify a vault/repo name for use as a folder segment. */
export function vaultFolderName(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'vault'
}

/**
 * Default local path shown in the Add form — short, Obsidian-friendly.
 * On Android: `Documents/<name>` (resolved under shared storage on save).
 * Elsewhere: absolute path under the app document directory.
 */
export function defaultVaultLocalPath(name: string): string {
  const folder = vaultFolderName(name)
  if (Platform.OS === 'android') {
    return `Documents/${folder}`
  }
  return `${documentDirectoryPath().replace(/\/+$/, '')}/vaults/${folder}`
}

/**
 * Expand a user-entered local path to an absolute filesystem path for libgit2.
 * Relative paths like `Documents/my-vault` resolve under {@link sharedStorageRoot}.
 */
export function resolveLocalPath(pathOrUri: string): string {
  const fs = toFilesystemPath(pathOrUri)
  if (fs.length === 0) {
    return fs
  }
  // Absolute Unix / already-rooted Android path, or Windows drive path.
  if (fs.startsWith('/') || /^[A-Za-z]:[\\/]/.test(fs)) {
    return fs
  }
  const root = sharedStorageRoot().replace(/\/+$/, '')
  return `${root}/${fs.replace(/^\/+/, '')}`
}

/**
 * Shorten an absolute shared-storage path for display
 * (`/storage/emulated/0/Documents/vault` → `Documents/vault`).
 */
export function displayLocalPath(pathOrUri: string): string {
  const fs = toFilesystemPath(pathOrUri)
  if (Platform.OS !== 'android') {
    return fs
  }
  const root = ANDROID_SHARED_ROOT
  if (fs === root) {
    return '/'
  }
  if (fs.startsWith(`${root}/`)) {
    return fs.slice(root.length + 1)
  }
  return fs
}

/**
 * Convert a `file://` URI (or already-absolute path) to a filesystem path for libgit2.
 * Expo APIs speak URIs; libgit2 rejects `file://…` and treats `file:` as a relative dir.
 */
export function toFilesystemPath(uriOrPath: string): string {
  const trimmed = uriOrPath.trim()
  if (!trimmed.startsWith('file:')) {
    return trimmed
  }
  try {
    const url = new URL(trimmed)
    let pathname = decodeURIComponent(url.pathname)
    // `file:///C:/…` → URL.pathname is `/C:/…`; strip the extra leading slash.
    if (/^\/[A-Za-z]:[/\\]/.test(pathname)) {
      pathname = pathname.slice(1)
    }
    return pathname
  } catch {
    return decodeURIComponent(trimmed.replace(/^file:\/\//i, ''))
  }
}

/** Ensure `pathOrUri` is a `file://` URI for expo-file-system APIs. */
export function toFileUri(pathOrUri: string): string {
  const trimmed = pathOrUri.trim()
  if (trimmed.startsWith('file:')) {
    return trimmed
  }
  // Absolute Unix path → file:///… ; Windows drive path → file:///C:/…
  if (trimmed.startsWith('/')) {
    return `file://${trimmed}`
  }
  return `file:///${trimmed.replace(/\\/g, '/')}`
}

/**
 * Ensures the given directory exists, creating it (and any parents).
 *
 * expo-file-system rejects `Directory.create` on paths that do not exist yet
 * outside the app sandbox (`File.canWrite()` is false for missing paths). For
 * those, we walk *up* to an existing ancestor and create children via
 * `createDirectory` (permission is checked on the existing parent).
 */
export async function ensureDirectoryExists(pathOrUri: string): Promise<void> {
  const abs = resolveLocalPath(toFilesystemPath(pathOrUri)).replace(/\/+$/, '')
  if (abs.length === 0) {
    return
  }

  const target = new Directory(toFileUri(abs))
  try {
    if (target.exists) {
      return
    }
    target.create({ intermediates: true, idempotent: true })
    return
  } catch {
    // Fall through — typical for new shared-storage paths.
  }

  ensureDirectoryViaAncestors(abs)
}

/** Thrown when shared storage is not writable (All files access missing). */
export const SHARED_STORAGE_ACCESS_ERROR =
  'Cannot write to shared storage. Enable “All files access” for kilne-git in system settings, then try again.'

/**
 * Walk up from `absPath` until an existing ancestor is found, then create the
 * missing child segments. Never starts from `/` — expo reports root as missing
 * without broad storage access.
 */
function ensureDirectoryViaAncestors(absPath: string): void {
  const missing: string[] = []
  let cursor = absPath

  while (cursor.length > 1) {
    const dir = new Directory(toFileUri(cursor))
    if (dir.exists) {
      let parent = dir
      for (const name of missing) {
        parent = parent.createDirectory(name)
      }
      return
    }
    const slash = cursor.lastIndexOf('/')
    if (slash <= 0) {
      break
    }
    missing.unshift(cursor.slice(slash + 1))
    cursor = cursor.slice(0, slash)
  }

  throw new Error(SHARED_STORAGE_ACCESS_ERROR)
}

export { STORAGE_KEYS }
