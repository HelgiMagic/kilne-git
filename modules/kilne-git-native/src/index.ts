import { NitroModules } from 'react-native-nitro-modules'
import type { Git } from './Git.nitro'

export type {
  Git,
  GitCredentials,
  StatusResult,
  FileStatusEntry,
  FileState,
  CommitResult,
  PullResult,
  PushResult,
  CloneResult,
  CommitOptions,
  CloneOptions,
} from './Git.nitro'

let _git: Git | null = null

/**
 * Lazily creates and caches the singleton HybridGit instance.
 * The native object is created the first time it's requested and reused afterwards.
 */
export function getGit(): Git {
  if (_git === null) {
    _git = NitroModules.createHybridObject<Git>('Git')
  }
  return _git
}
