import { useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  TextInput,
  View,
} from 'react-native'
import { router } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { Field } from '@/components/Field'
import { ThemedText } from '@/components/themed-text'
import { ThemedView } from '@/components/themed-view'
import { Accent, Spacing } from '@/constants/theme'
import { useStore } from '@/store'
import { type Repo } from '@/types/repo'
import { cloneRepo } from '@/services/sync'
import { defaultVaultLocalPath, resolveLocalPath } from '@/services/storage'
import {
  ensureSharedStorageWriteAccess,
  isSharedStorageAccessError,
  isUnderSharedStorage,
  openAllFilesAccessSettings,
} from '@/services/shared-storage-access'

interface FormState {
  name: string
  url: string
  branch: string
  localPath: string
  username: string
  token: string
  insecure: boolean
  authorName: string
  authorEmail: string
}

function defaultLocalPath(name: string): string {
  return defaultVaultLocalPath(name)
}

function deriveName(url: string): string {
  const match = url.match(/[/:]([^/]+?)(?:\.git)?$/)
  return match?.[1] ?? 'vault'
}

function isAutoLocalPath(path: string, name: string): boolean {
  const trimmed = path.trim()
  return trimmed.length === 0 || trimmed === defaultLocalPath(name)
}

export default function AddRepoScreen() {
  const insets = useSafeAreaInsets()
  const upsertRepo = useStore((s) => s.upsertRepo)
  const setRepoToken = useStore((s) => s.setRepoToken)
  const [saving, setSaving] = useState(false)

  const [form, setForm] = useState<FormState>({
    name: '',
    url: '',
    branch: '',
    localPath: '',
    username: 'x-access-token',
    token: '',
    insecure: false,
    authorName: 'kilne-git',
    authorEmail: 'kilne-git@localhost',
  })

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  function onUrlChange(value: string) {
    set('url', value)
    if (form.name.trim().length === 0) {
      const derived = deriveName(value)
      if (derived !== 'vault') {
        set('name', derived)
        if (isAutoLocalPath(form.localPath, form.name)) {
          set('localPath', defaultLocalPath(derived))
        }
      }
    }
  }

  function onNameChange(value: string) {
    const prevName = form.name
    set('name', value)
    if (isAutoLocalPath(form.localPath, prevName)) {
      set('localPath', defaultLocalPath(value))
    }
  }

  function promptSharedStorageAccess() {
    Alert.alert(
      'Storage access needed',
      'Android will not show a normal permission popup for this. Open settings, enable “All files access” (or “Allow access to manage all files”) for kilne-git, then tap Clone again.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Open settings',
          onPress: () => {
            void openAllFilesAccessSettings()
          },
        },
      ],
    )
  }

  async function onSave() {
    const name = form.name.trim() || deriveName(form.url)
    const localPathInput = form.localPath.trim() || defaultLocalPath(name)
    if (form.url.trim().length === 0) {
      Alert.alert('Missing fields', 'URL is required.')
      return
    }

    const absolutePath = resolveLocalPath(localPathInput)
    if (isUnderSharedStorage(absolutePath)) {
      const canWrite = await ensureSharedStorageWriteAccess()
      if (!canWrite) {
        promptSharedStorageAccess()
        return
      }
    }

    setSaving(true)
    let createdId: string | null = null
    try {
      const repo: Repo = await upsertRepo({
        name,
        url: form.url.trim(),
        // Empty → clone uses remote HEAD (main, master, …), then we persist it.
        branch: form.branch.trim(),
        localPath: absolutePath,
        username: form.username.trim() || 'x-access-token',
        insecure: form.insecure,
        authorName: form.authorName.trim(),
        authorEmail: form.authorEmail.trim(),
      })
      createdId = repo.id
      if (form.token.trim().length > 0) {
        await setRepoToken(repo.id, form.token.trim())
      }
      await cloneRepo(repo)
      router.back()
    } catch (e) {
      // Don't leave a half-configured repo row after a failed first clone.
      if (createdId != null) {
        try {
          await useStore.getState().removeRepo(createdId)
        } catch {
          // best-effort cleanup
        }
      }
      if (isSharedStorageAccessError(e)) {
        promptSharedStorageAccess()
      } else {
        Alert.alert(
          'Clone failed',
          e instanceof Error ? e.message : String(e),
        )
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <ThemedView style={styles.container}>
      <ScrollView
        contentContainerStyle={{
          paddingVertical: Spacing.three,
          paddingBottom: insets.bottom + Spacing.five,
        }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Field label="Clone URL" hint="HTTPS URL, e.g. https://github.com/you/vault.git">
          <TextInput
            style={styles.input}
            value={form.url}
            onChangeText={onUrlChange}
            placeholder="https://github.com/you/vault.git"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />
        </Field>

        <Field label="Display name" hint="Shown in the repo list.">
          <TextInput
            style={styles.input}
            value={form.name}
            onChangeText={onNameChange}
            placeholder="vault"
          />
        </Field>

        <Field label="Branch" hint="Leave empty to use the remote default (main, master, …).">
          <TextInput
            style={styles.input}
            value={form.branch}
            onChangeText={(v) => set('branch', v)}
            placeholder="remote default"
            autoCapitalize="none"
            autoCorrect={false}
          />
        </Field>

        <Field
          label="Local path"
          hint="Under phone storage — e.g. Documents/my-vault. On Android 11+ enable All files access in system settings (no popup). Obsidian can open this folder."
        >
          <TextInput
            style={styles.input}
            value={form.localPath}
            onChangeText={(v) => set('localPath', v)}
            placeholder={defaultLocalPath('vault')}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </Field>

        <Field label="Personal access token" hint="GitHub: Settings → Developer settings → Personal access tokens. Select 'repo' scope.">
          <TextInput
            style={styles.input}
            value={form.token}
            onChangeText={(v) => set('token', v)}
            placeholder="ghp_xxxxxxxxxxxx"
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
          />
        </Field>

        <Field label="Username" hint="For GitHub tokens, anything works — defaults to x-access-token.">
          <TextInput
            style={styles.input}
            value={form.username}
            onChangeText={(v) => set('username', v)}
            placeholder="x-access-token"
            autoCapitalize="none"
            autoCorrect={false}
          />
        </Field>

        <Field label="Author name">
          <TextInput
            style={styles.input}
            value={form.authorName}
            onChangeText={(v) => set('authorName', v)}
            placeholder="kilne-git"
          />
        </Field>

        <Field label="Author email">
          <TextInput
            style={styles.input}
            value={form.authorEmail}
            onChangeText={(v) => set('authorEmail', v)}
            placeholder="kilne-git@localhost"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
          />
        </Field>

        <Field label="Insecure TLS" hint="Skip certificate verification — only for self-hosted servers.">
          <Switch value={form.insecure} onValueChange={(v) => set('insecure', v)} />
        </Field>

        <View style={styles.actions}>
          <Pressable style={styles.primaryBtn} onPress={onSave} disabled={saving}>
            {saving ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <ThemedText style={styles.primaryBtnText}>Clone & save</ThemedText>
            )}
          </Pressable>
        </View>
      </ScrollView>
    </ThemedView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.two,
    fontSize: 16,
  },
  actions: { paddingTop: Spacing.two },
  primaryBtn: {
    backgroundColor: Accent,
    paddingVertical: Spacing.three,
    borderRadius: 10,
    alignItems: 'center',
  },
  primaryBtnText: { color: '#fff', fontWeight: '600', fontSize: 16 },
})
