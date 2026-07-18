import { useGlobalSearchParams, useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { ActionButton } from '@/components/ActionButton'
import { Field } from '@/components/Field'
import { ThemedText } from '@/components/themed-text'
import { ThemedView } from '@/components/themed-view'
import {
  Accent,
  AccentInk,
  BorderWidth,
  Danger,
  Radii,
  Spacing,
} from '@/constants/theme'
import { useTheme } from '@/hooks/use-theme'
import * as git from '@/services/git'
import { commitAndPushRepo, pullRepo, pushRepo } from '@/services/sync'
import {
  isSharedStorageAccessError,
  promptSharedStorageAccess,
  requireSharedStorageAccess,
} from '@/services/shared-storage-access'
import { displayLocalPath } from '@/services/storage'
import { useStore } from '@/store'
import { IDLE_SYNC } from '@/types/repo'
import { type StatusResult } from 'kilne-git-native'
import { defaultCommitMessage } from '@/utils/commit'

export default function RepoDetailScreen() {
  const params = useGlobalSearchParams<{ id: string }>()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const theme = useTheme()

  const repo = useStore((s) => s.repos.find((r) => r.id === params.id))
  const sync = useStore((s) => (repo ? (s.sync[repo.id] ?? IDLE_SYNC) : IDLE_SYNC))
  const removeRepo = useStore((s) => s.removeRepo)

  const [status, setStatus] = useState<StatusResult | null>(null)
  const [statusLoading, setStatusLoading] = useState(false)
  const [commitMessage, setCommitMessage] = useState('')

  useEffect(() => {
    if (repo == null) return
    refreshStatus({ promptIfDenied: false }).catch(() => {})
  }, [repo?.id])

  if (repo == null) {
    return (
      <ThemedView style={styles.center}>
        <ThemedText>repository not found.</ThemedText>
        <Pressable onPress={() => router.replace('/')} style={styles.link}>
          <ThemedText type="label" themeColor="textSecondary">
            back to list
          </ThemedText>
        </Pressable>
      </ThemedView>
    )
  }

  const busy = sync.kind === 'pulling' || sync.kind === 'pushing' || sync.kind === 'cloning'

  async function refreshStatus(options?: { promptIfDenied?: boolean }) {
    if (!repo) return
    setStatusLoading(true)
    try {
      await requireSharedStorageAccess(repo.localPath)
      setStatus(await git.status(repo))
    } catch (e) {
      setStatus(null)
      if (options?.promptIfDenied !== false && isSharedStorageAccessError(e)) {
        promptSharedStorageAccess()
      }
    } finally {
      setStatusLoading(false)
    }
  }

  async function onPull() {
    if (!repo) return
    try {
      await pullRepo(repo)
      await refreshStatus()
    } catch {
      // error already in store
    }
  }

  async function onPush() {
    if (!repo) return
    try {
      await pushRepo(repo)
      await refreshStatus()
    } catch {
      // error already in store
    }
  }

  async function onCommitAndPush() {
    if (!repo) return
    const message = commitMessage.trim() || defaultCommitMessage()
    try {
      await commitAndPushRepo(repo, message)
      setCommitMessage('')
      await refreshStatus()
    } catch {
      // error already in store
    }
  }

  async function onRemove() {
    if (!repo) return
    Alert.alert(
      'remove repository?',
      `this deletes the config and stored token. the cloned files at ${displayLocalPath(repo.localPath)} stay on disk.`,
      [
        { text: 'cancel', style: 'cancel' },
        {
          text: 'remove',
          style: 'destructive',
          onPress: async () => {
            await removeRepo(repo.id)
            router.replace('/')
          },
        },
      ],
    )
  }

  return (
    <ScrollView
      contentContainerStyle={{
        paddingVertical: Spacing.three,
        paddingBottom: insets.bottom + Spacing.five,
      }}
      showsVerticalScrollIndicator={false}
    >
      <ThemedText type="title">{repo.name}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary" style={{ marginTop: Spacing.two }}>
        {repo.url.replace(/^https?:\/\//, '').replace(/\.git$/, '')}
      </ThemedText>
      <ThemedText type="caption" themeColor="textMuted" style={{ marginBottom: Spacing.four, marginTop: Spacing.one }}>
        {repo.branch || 'default'} · {displayLocalPath(repo.localPath)}
      </ThemedText>

      <SyncBanner kind={sync.kind} message={'message' in sync ? sync.message : ''} />

      <View style={styles.buttonRow}>
        <ActionButton label="pull" onPress={onPull} disabled={busy} loading={sync.kind === 'pulling'} />
        <ActionButton
          label="push only"
          onPress={onPush}
          disabled={busy}
          loading={sync.kind === 'pushing'}
        />
      </View>

      <Field label="commit message" hint="optional. auto-generated when left blank.">
        <TextInput
          style={[
            styles.input,
            {
              borderColor: theme.border,
              color: theme.text,
              backgroundColor: theme.backgroundElement,
            },
          ]}
          value={commitMessage}
          onChangeText={setCommitMessage}
          placeholder="auto: sync from android"
          placeholderTextColor={theme.placeholder}
          autoCapitalize="none"
          autoCorrect={false}
          multiline
        />
      </Field>

      <Pressable
        style={[styles.primaryBtn, busy && styles.btnDisabled]}
        onPress={onCommitAndPush}
        disabled={busy}
      >
        <ThemedText type="smallBold" style={styles.primaryBtnText}>
          commit all & push
        </ThemedText>
      </Pressable>

      <View style={{ height: Spacing.five }} />

      <ThemedText type="label" themeColor="textMuted">
        status
      </ThemedText>
      {statusLoading ? (
        <ActivityIndicator color={theme.textSecondary} style={{ marginTop: Spacing.three }} />
      ) : status == null ? (
        <ThemedText type="small" themeColor="textSecondary" style={{ marginTop: Spacing.two }}>
          status unavailable. if this vault is on phone storage, enable all files access, then refresh.
        </ThemedText>
      ) : (
        <StatusView status={status} />
      )}

      <Pressable onPress={() => void refreshStatus({ promptIfDenied: true })} style={styles.link}>
        <ThemedText type="label" themeColor="textSecondary">
          refresh status
        </ThemedText>
      </Pressable>

      <View style={{ height: Spacing.five }} />
      <Pressable
        onPress={onRemove}
        style={[styles.dangerBtn, { borderColor: theme.border }]}
      >
        <ThemedText type="label" style={{ color: Danger }}>
          remove repository
        </ThemedText>
      </Pressable>
    </ScrollView>
  )
}

function StatusView({ status }: { status: StatusResult }) {
  const theme = useTheme()
  return (
    <ThemedView
      type="backgroundElement"
      style={[styles.statusBox, { borderColor: theme.border }]}
    >
      <Row label="branch" value={status.head ?? '(detached head)'} />
      <Row label="upstream" value={status.upstream ?? '(none)'} />
      <Row label="clean" value={status.isClean ? 'yes' : 'no'} />
      <Row label="ahead" value={String(status.ahead)} />
      <Row label="behind" value={String(status.behind)} />
      {status.staged.length > 0 && (
        <>
          <Section title="staged" />
          {status.staged.map((s) => (
            <ThemedText key={'s-' + s.path} type="small" numberOfLines={1}>
              {s.path} ({s.index})
            </ThemedText>
          ))}
        </>
      )}
      {status.working.length > 0 && (
        <>
          <Section title="working tree" />
          {status.working.map((s) => (
            <ThemedText key={'w-' + s.path} type="small" numberOfLines={1}>
              {s.path} ({s.worktree})
            </ThemedText>
          ))}
        </>
      )}
      {status.untracked.length > 0 && (
        <>
          <Section title="untracked" />
          {status.untracked.map((p) => (
            <ThemedText key={'u-' + p} type="small" numberOfLines={1}>
              {p}
            </ThemedText>
          ))}
        </>
      )}
      {status.conflicted.length > 0 && (
        <>
          <Section title="conflicted" />
          {status.conflicted.map((p) => (
            <ThemedText key={'c-' + p} type="small" style={{ color: Danger }} numberOfLines={1}>
              {p}
            </ThemedText>
          ))}
        </>
      )}
    </ThemedView>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <ThemedText type="label" themeColor="textMuted" style={styles.rowLabel}>
        {label}
      </ThemedText>
      <ThemedText type="small" style={styles.rowValue} numberOfLines={1}>
        {value}
      </ThemedText>
    </View>
  )
}

function Section({ title }: { title: string }) {
  return (
    <ThemedText type="label" themeColor="textMuted" style={{ marginTop: Spacing.three, marginBottom: Spacing.one }}>
      {title}
    </ThemedText>
  )
}

function SyncBanner({ kind, message }: { kind: string; message: string }) {
  const theme = useTheme()
  if (kind === 'idle' || kind === 'pulling' || kind === 'pushing' || kind === 'cloning') {
    return null
  }
  const isError = kind === 'error'
  return (
    <View
      style={[
        styles.banner,
        {
          borderColor: isError ? Danger : theme.border,
          backgroundColor: isError ? 'rgba(255,59,74,0.08)' : theme.backgroundSelected,
        },
      ]}
    >
      <ThemedText type="small" style={{ color: isError ? Danger : theme.textSecondary }}>
        {message}
      </ThemedText>
    </View>
  )
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.three },
  link: { marginTop: Spacing.three, alignSelf: 'flex-start', paddingVertical: Spacing.one },
  buttonRow: { flexDirection: 'row', gap: Spacing.two, marginBottom: Spacing.four },
  primaryBtn: {
    backgroundColor: Accent,
    borderRadius: Radii.none,
    paddingVertical: Spacing.three,
    alignItems: 'center',
  },
  btnDisabled: { opacity: 0.45 },
  primaryBtnText: {
    color: AccentInk,
    fontSize: 15,
    lineHeight: 20,
    letterSpacing: 0.4,
  },
  input: {
    borderWidth: BorderWidth,
    borderRadius: Radii.none,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    fontSize: 16,
    minHeight: 72,
    textAlignVertical: 'top',
  },
  statusBox: {
    padding: Spacing.four,
    borderRadius: Radii.none,
    borderWidth: BorderWidth,
    marginTop: Spacing.three,
    gap: Spacing.two,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  rowLabel: { width: 72 },
  rowValue: { flex: 1 },
  banner: {
    padding: Spacing.three,
    borderRadius: Radii.none,
    borderWidth: BorderWidth,
    marginBottom: Spacing.four,
  },
  dangerBtn: {
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    alignSelf: 'flex-start',
    borderWidth: BorderWidth,
    borderRadius: Radii.none,
  },
})
