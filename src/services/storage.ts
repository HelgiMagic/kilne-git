/**
 * Persists the list of {@link Repo} configs to the device.
 *
 * Uses the new object-oriented `expo-file-system` API (v57+). Config is stored
 * as JSON in the app's document directory, which survives re-installs of the JS
 * bundle but is wiped if the app itself is uninstalled.
 */

import { Directory, File, Paths } from 'expo-file-system'

import { type Repo, STORAGE_KEYS } from '@/types/repo'

const FILE_NAME = 'kilne-git.repos.json'

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

/** Ensures the given `file://` URI directory exists, creating it (and any parents). */
export async function ensureDirectoryExists(uri: string): Promise<void> {
  const dir = new Directory(uri)
  if (!dir.exists) {
    dir.create()
  }
}

export { STORAGE_KEYS }
