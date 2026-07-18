import { useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native'
import { router } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { Field } from '@/components/Field'
import { ThemedText } from '@/components/themed-text'
import { ThemedView } from '@/components/themed-view'
import { Accent, AccentInk, BorderWidth, Radii, Spacing } from '@/constants/theme'
import { useTheme } from '@/hooks/use-theme'
import { useStore } from '@/store'
import { type Repo } from '@/types/repo'
import { cloneRepo } from '@/services/sync'
import { defaultVaultLocalPath, resolveLocalPath } from '@/services/storage'
import {
  ensureSharedStorageWriteAccess,
  isSharedStorageAccessError,
  isUnderSharedStorage,
  promptSharedStorageAccess,
} from '@/services/shared-storage-access'

interface FormState {
  name: string
  url: string
  branch: string
  localPath: string
  username: string
  token: string
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
  const theme = useTheme()
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

  async function onSave() {
    const name = form.name.trim() || deriveName(form.url)
    const localPathInput = form.localPath.trim() || defaultLocalPath(name)
    if (form.url.trim().length === 0) {
      Alert.alert('missing fields', 'url is required.')
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
        // ensureRepoStorageAccess / pre-check already showed the Settings alert
      } else {
        Alert.alert(
          'clone failed',
          e instanceof Error ? e.message : String(e),
        )
      }
    } finally {
      setSaving(false)
    }
  }

  const inputStyle = [
    styles.input,
    {
      borderColor: theme.border,
      color: theme.text,
      backgroundColor: theme.backgroundElement,
    },
  ]

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
        <Field label="clone url" hint="https url, e.g. https://github.com/you/vault.git">
          <TextInput
            style={inputStyle}
            value={form.url}
            onChangeText={onUrlChange}
            placeholder="https://github.com/you/vault.git"
            placeholderTextColor={theme.placeholder}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />
        </Field>

        <Field label="display name" hint="shown in the repo list.">
          <TextInput
            style={inputStyle}
            value={form.name}
            onChangeText={onNameChange}
            placeholder="vault"
            placeholderTextColor={theme.placeholder}
          />
        </Field>

        <Field label="branch" hint="leave empty to use the remote default (main, master, …).">
          <TextInput
            style={inputStyle}
            value={form.branch}
            onChangeText={(v) => set('branch', v)}
            placeholder="remote default"
            placeholderTextColor={theme.placeholder}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </Field>

        <Field
          label="local path"
          hint="under phone storage — e.g. documents/my-vault. on android 11+ the app will ask you to enable all files access in settings (required so new obsidian files are visible to git)."
        >
          <TextInput
            style={inputStyle}
            value={form.localPath}
            onChangeText={(v) => set('localPath', v)}
            placeholder={defaultLocalPath('vault')}
            placeholderTextColor={theme.placeholder}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </Field>

        <Field label="personal access token" hint="github: settings → developer settings → personal access tokens. select 'repo' scope.">
          <TextInput
            style={inputStyle}
            value={form.token}
            onChangeText={(v) => set('token', v)}
            placeholder="ghp_xxxxxxxxxxxx"
            placeholderTextColor={theme.placeholder}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
          />
        </Field>

        <Field label="username" hint="for github tokens, anything works — defaults to x-access-token.">
          <TextInput
            style={inputStyle}
            value={form.username}
            onChangeText={(v) => set('username', v)}
            placeholder="x-access-token"
            placeholderTextColor={theme.placeholder}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </Field>

        <Field label="author name">
          <TextInput
            style={inputStyle}
            value={form.authorName}
            onChangeText={(v) => set('authorName', v)}
            placeholder="kilne-git"
            placeholderTextColor={theme.placeholder}
          />
        </Field>

        <Field label="author email">
          <TextInput
            style={inputStyle}
            value={form.authorEmail}
            onChangeText={(v) => set('authorEmail', v)}
            placeholder="kilne-git@localhost"
            placeholderTextColor={theme.placeholder}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
          />
        </Field>

        <View style={styles.actions}>
          <Pressable style={styles.primaryBtn} onPress={onSave} disabled={saving}>
            {saving ? (
              <ActivityIndicator color={AccentInk} />
            ) : (
              <ThemedText type="label" style={styles.primaryBtnText}>
                clone & save
              </ThemedText>
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
    borderWidth: BorderWidth,
    borderRadius: Radii.none,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    fontSize: 16,
  },
  actions: { paddingTop: Spacing.four },
  primaryBtn: {
    backgroundColor: Accent,
    paddingVertical: Spacing.three,
    borderRadius: Radii.none,
    alignItems: 'center',
  },
  primaryBtnText: {
    color: AccentInk,
  },
})
