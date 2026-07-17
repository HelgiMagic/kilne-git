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
import { Accent, Danger, Spacing, Success } from '@/constants/theme'
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
        <ThemedText>Repository not found.</ThemedText>
        <Pressable onPress={() => router.replace('/')} style={styles.link}>
          <ThemedText style={{ color: Accent }}>Back to list</ThemedText>
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
      'Remove repository?',
      `This deletes the config and stored token. The cloned files at ${displayLocalPath(repo.localPath)} stay on disk.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
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
      <ThemedText type="small" style={{ opacity: 0.7, marginBottom: Spacing.three }}>
        {repo.url}
      </ThemedText>

      <SyncBanner kind={sync.kind} message={'message' in sync ? sync.message : ''} />

      <View style={styles.buttonRow}>
        <ActionButton label="Pull" onPress={onPull} disabled={busy} loading={sync.kind === 'pulling'} />
        <ActionButton
          label="Push only"
          onPress={onPush}
          disabled={busy}
          loading={sync.kind === 'pushing'}
        />
      </View>

      <Field label="Commit message" hint="Optional. Auto-generated when left blank.">
        <TextInput
          style={styles.input}
          value={commitMessage}
          onChangeText={setCommitMessage}
          placeholder="auto: sync from android"
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
        <ThemedText style={styles.primaryBtnText}>Commit all & push</ThemedText>
      </Pressable>

      <View style={{ height: Spacing.four }} />

      <ThemedText type="smallBold">Status</ThemedText>
      {statusLoading ? (
        <ActivityIndicator style={{ marginTop: Spacing.two }} />
      ) : status == null ? (
        <ThemedText type="small" style={{ marginTop: Spacing.two }}>
          Status unavailable. If this vault is on phone storage, enable All files access, then Refresh.
        </ThemedText>
      ) : (
        <StatusView status={status} />
      )}

      <Pressable onPress={() => void refreshStatus({ promptIfDenied: true })} style={styles.link}>
        <ThemedText style={{ color: Accent }}>Refresh status</ThemedText>
      </Pressable>

      <View style={{ height: Spacing.four }} />
      <Pressable onPress={onRemove} style={styles.dangerBtn}>
        <ThemedText style={{ color: Danger }}>Remove repository</ThemedText>
      </Pressable>
    </ScrollView>
  )
}

function StatusView({ status }: { status: StatusResult }) {
  return (
    <ThemedView type="backgroundElement" style={styles.statusBox}>
      <Row label="Branch" value={status.head ?? '(detached HEAD)'} />
      <Row label="Upstream" value={status.upstream ?? '(none)'} />
      <Row label="Clean" value={status.isClean ? 'yes' : 'no'} />
      <Row label="Ahead" value={String(status.ahead)} />
      <Row label="Behind" value={String(status.behind)} />
      {status.staged.length > 0 && (
        <>
          <Section title="Staged" />
          {status.staged.map((s) => (
            <ThemedText key={'s-' + s.path} type="small" numberOfLines={1}>
              {s.path} ({s.index})
            </ThemedText>
          ))}
        </>
      )}
      {status.working.length > 0 && (
        <>
          <Section title="Working tree" />
          {status.working.map((s) => (
            <ThemedText key={'w-' + s.path} type="small" numberOfLines={1}>
              {s.path} ({s.worktree})
            </ThemedText>
          ))}
        </>
      )}
      {status.untracked.length > 0 && (
        <>
          <Section title="Untracked" />
          {status.untracked.map((p) => (
            <ThemedText key={'u-' + p} type="small" numberOfLines={1}>
              {p}
            </ThemedText>
          ))}
        </>
      )}
      {status.conflicted.length > 0 && (
        <>
          <Section title="Conflicted" />
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
      <ThemedText type="small" style={{ opacity: 0.7 }}>
        {label}
      </ThemedText>
      <ThemedText type="small">{value}</ThemedText>
    </View>
  )
}

function Section({ title }: { title: string }) {
  return (
    <ThemedText type="smallBold" style={{ marginTop: Spacing.two, marginBottom: Spacing.one }}>
      {title}
    </ThemedText>
  )
}

function SyncBanner({ kind, message }: { kind: string; message: string }) {
  if (kind === 'idle' || kind === 'pulling' || kind === 'pushing' || kind === 'cloning') {
    return null
  }
  const isError = kind === 'error'
  return (
    <View style={[styles.banner, isError ? styles.bannerError : styles.bannerOk]}>
      <ThemedText style={{ color: isError ? Danger : Success }}>{message}</ThemedText>
    </View>
  )
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.three },
  link: { marginTop: Spacing.two, alignSelf: 'flex-start', paddingVertical: Spacing.one },
  buttonRow: { flexDirection: 'row', gap: Spacing.two, marginBottom: Spacing.three },
  primaryBtn: {
    backgroundColor: Accent,
    borderRadius: 10,
    paddingVertical: Spacing.three,
    alignItems: 'center',
  },
  btnDisabled: { opacity: 0.5 },
  primaryBtnText: { color: '#fff', fontWeight: '600', fontSize: 16 },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.two,
    fontSize: 16,
    minHeight: 60,
  },
  statusBox: {
    padding: Spacing.three,
    borderRadius: 12,
    marginTop: Spacing.two,
    gap: Spacing.one,
  },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  banner: { padding: Spacing.two, borderRadius: 8, marginBottom: Spacing.three },
  bannerError: { backgroundColor: 'rgba(176,0,32,0.08)' },
  bannerOk: { backgroundColor: 'rgba(46,125,50,0.08)' },
  dangerBtn: {
    paddingVertical: Spacing.two,
    alignSelf: 'flex-start',
  },
})
