import { Pressable, StyleSheet, View } from 'react-native'

import { ActionButton } from '@/components/ActionButton'
import { ThemedText } from '@/components/themed-text'
import { ThemedView } from '@/components/themed-view'
import { BorderWidth, Danger, Radii, Spacing } from '@/constants/theme'
import { useTheme } from '@/hooks/use-theme'
import { syncRepo } from '@/services/sync'
import { displayLocalPath } from '@/services/storage'
import { useStore } from '@/store'
import { IDLE_SYNC, type Repo, type SyncState } from '@/types/repo'
import { defaultCommitMessage } from '@/utils/commit'

interface Props {
  repo: Repo
  onPress?: () => void
}

const SYNC_LABEL: Record<SyncState['kind'], string> = {
  idle: 'ready',
  pulling: 'pulling…',
  pushing: 'pushing…',
  cloning: 'cloning…',
  done: 'synced',
  error: 'sync error',
}

export function RepoCard({ repo, onPress }: Props) {
  const theme = useTheme()
  const sync = useStore((s) => s.sync[repo.id] ?? IDLE_SYNC)
  const busy = sync.kind === 'pulling' || sync.kind === 'pushing' || sync.kind === 'cloning'
  const isError = sync.kind === 'error'

  const updatedAt =
    sync.kind === 'done' || sync.kind === 'error'
      ? sync.at
      : repo.lastSyncedAt

  async function onSync() {
    try {
      await syncRepo(repo, defaultCommitMessage())
    } catch {
      // error already in store
    }
  }

  return (
    <ThemedView type="backgroundElement" style={styles.card}>
      <Pressable
        onPress={onPress}
        disabled={onPress == null}
        style={[styles.body, { borderColor: theme.border }]}
      >
        <View style={styles.header}>
          <ThemedText type="heading" numberOfLines={1} style={styles.name}>
            {repo.name}
          </ThemedText>
          <StatusBadge kind={sync.kind} isError={isError} />
        </View>

        <ThemedText type="small" numberOfLines={1} themeColor="textSecondary">
          {shortUrl(repo.url)}
        </ThemedText>

        <ThemedText type="caption" themeColor="textMuted" numberOfLines={1} style={styles.meta}>
          {repo.branch || 'default'} · {shortPath(repo.localPath)}
        </ThemedText>

        <View style={styles.techRows}>
          <TechRow
            label="updated"
            value={updatedAt != null ? formatRelative(updatedAt) : 'never'}
          />
        </View>

        {sync.kind === 'error' && (
          <ThemedText type="caption" style={styles.error} numberOfLines={2}>
            {sync.message}
          </ThemedText>
        )}
      </Pressable>

      <ActionButton
        label="sync"
        variant="solid"
        onPress={onSync}
        disabled={busy}
        loading={busy}
        flush
      />
    </ThemedView>
  )
}

function TechRow({
  label,
  value,
  danger = false,
}: {
  label: string
  value: string
  danger?: boolean
}) {
  return (
    <View style={styles.techRow}>
      <ThemedText type="small" themeColor="textMuted" style={styles.techLabel}>
        {label}
      </ThemedText>
      <ThemedText
        type="small"
        themeColor={danger ? undefined : 'textSecondary'}
        style={danger ? styles.error : undefined}
      >
        {value}
      </ThemedText>
    </View>
  )
}

function StatusBadge({ kind, isError }: { kind: SyncState['kind']; isError: boolean }) {
  const theme = useTheme()
  const color = isError ? Danger : theme.textSecondary
  return (
    <View style={[styles.badge, { borderColor: color }]}>
      <ThemedText type="label" style={{ color }}>
        {SYNC_LABEL[kind]}
      </ThemedText>
    </View>
  )
}

function shortUrl(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/\.git$/, '')
}

function shortPath(path: string): string {
  const display = displayLocalPath(path)
  const segments = display.split('/')
  if (segments.length <= 3) return display
  return '…/' + segments.slice(-2).join('/')
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime()
  const delta = Math.max(0, Date.now() - then) / 1000
  if (delta < 60) return 'just now'
  if (delta < 3600) return `${Math.floor(delta / 60)}m ago`
  if (delta < 86400) return `${Math.floor(delta / 3600)}h ago`
  return `${Math.floor(delta / 86400)}d ago`
}

const styles = StyleSheet.create({
  card: {
    borderRadius: Radii.none,
    overflow: 'hidden',
  },
  body: {
    borderTopWidth: BorderWidth,
    borderLeftWidth: BorderWidth,
    borderRightWidth: BorderWidth,
    borderBottomWidth: 0,
    padding: Spacing.four,
    gap: Spacing.two,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: Spacing.three,
    marginBottom: Spacing.one,
  },
  name: { flexShrink: 1 },
  meta: { marginTop: Spacing.half },
  techRows: {
    marginTop: Spacing.three,
    gap: Spacing.two,
  },
  techRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  techLabel: {
    width: 64,
  },
  badge: {
    borderWidth: BorderWidth,
    borderRadius: Radii.none,
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
  error: { color: Danger },
})
