import { useStore } from '@/store'
import { IDLE_SYNC, type Repo, type SyncState } from '@/types/repo'
import { Spacing } from '@/constants/theme'
import { StyleSheet, View } from 'react-native'

import { ThemedText } from '@/components/themed-text'
import { ThemedView } from '@/components/themed-view'
import { displayLocalPath } from '@/services/storage'

interface Props {
  repo: Repo
}

const SYNC_LABEL: Record<SyncState['kind'], string> = {
  idle: 'Ready',
  pulling: 'Pulling…',
  pushing: 'Pushing…',
  cloning: 'Cloning…',
  done: 'Synced',
  error: 'Sync error',
}

export function RepoCard({ repo }: Props) {
  const sync = useStore((s) => s.sync[repo.id] ?? IDLE_SYNC)
  const busy = sync.kind === 'pulling' || sync.kind === 'pushing' || sync.kind === 'cloning'
  const isError = sync.kind === 'error'

  return (
    <ThemedView type="backgroundElement" style={styles.card}>
      <View style={styles.header}>
        <ThemedText type="smallBold" numberOfLines={1} style={styles.name}>
          {repo.name}
        </ThemedText>
        <StatusPill kind={sync.kind} isError={isError} busy={busy} />
      </View>

      <ThemedText type="small" numberOfLines={1} style={styles.url}>
        {repo.url}
      </ThemedText>
      <ThemedText type="small" numberOfLines={1}>
        {repo.branch} · {shortPath(repo.localPath)}
      </ThemedText>

      <View style={styles.meta}>
        <ThemedText type="small">
          {SYNC_LABEL[sync.kind]}
          {sync.kind === 'done' || sync.kind === 'error' ? ` · ${formatRelative(sync.at)}` : ''}
        </ThemedText>
      </View>

      {sync.kind === 'error' && (
        <ThemedText type="small" style={styles.error} numberOfLines={2}>
          {sync.message}
        </ThemedText>
      )}
    </ThemedView>
  )
}

function StatusPill({ kind, isError, busy }: { kind: SyncState['kind']; isError: boolean; busy: boolean }) {
  const color = isError ? '#B00020' : busy ? '#208AEF' : '#2E7D32'
  return (
    <View style={[styles.pill, { borderColor: color }]}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <ThemedText type="small" style={{ color }}>
        {SYNC_LABEL[kind]}
      </ThemedText>
    </View>
  )
}

function shortPath(path: string): string {
  const display = displayLocalPath(path)
  const segments = display.split('/')
  if (segments.length <= 3) {
    return display
  }
  return '…/' + segments.slice(-2).join('/')
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime()
  const now = Date.now()
  const delta = Math.max(0, now - then) / 1000
  if (delta < 60) return 'just now'
  if (delta < 3600) return `${Math.floor(delta / 60)}m ago`
  if (delta < 86400) return `${Math.floor(delta / 3600)}h ago`
  return `${Math.floor(delta / 86400)}d ago`
}

const styles = StyleSheet.create({
  card: {
    padding: Spacing.three,
    borderRadius: 14,
    gap: Spacing.one,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  name: { flexShrink: 1, fontSize: 16 },
  url: { opacity: 0.7 },
  meta: { marginTop: Spacing.one },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.half,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: Spacing.one,
    paddingVertical: Spacing.half,
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  error: { color: '#B00020', marginTop: Spacing.one },
})
