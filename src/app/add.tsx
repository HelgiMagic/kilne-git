import { useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View, Switch, Alert } from 'react-native'
import { router } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { Field } from '@/components/Field'
import { ThemedText } from '@/components/themed-text'
import { ThemedView } from '@/components/themed-view'
import { Spacing } from '@/constants/theme'
import { useStore } from '@/store'
import { type Repo } from '@/types/repo'
import { cloneRepo } from '@/hooks/use-sync'
import { documentDirectoryUri } from '@/services/storage'

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
  const docDir = documentDirectoryUri()
  const safe = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'vault'
  return `${docDir}vaults/${safe}`
}

function deriveName(url: string): string {
  const match = url.match(/[/:]([^/]+?)(?:\.git)?$/)
  return match?.[1] ?? 'vault'
}

export default function AddRepoScreen() {
  const insets = useSafeAreaInsets()
  const upsertRepo = useStore((s) => s.upsertRepo)
  const setRepoToken = useStore((s) => s.setRepoToken)
  const [saving, setSaving] = useState(false)

  const [form, setForm] = useState<FormState>({
    name: '',
    url: '',
    branch: 'main',
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
        set('localPath', defaultLocalPath(derived))
      }
    }
  }

  async function onSave() {
    if (form.url.trim().length === 0 || form.localPath.trim().length === 0) {
      Alert.alert('Missing fields', 'URL and local path are required.')
      return
    }
    setSaving(true)
    try {
      const repo: Repo = await upsertRepo({
        name: form.name || deriveName(form.url),
        url: form.url.trim(),
        branch: form.branch.trim() || 'main',
        localPath: form.localPath.trim(),
        username: form.username.trim() || 'x-access-token',
        insecure: form.insecure,
        authorName: form.authorName.trim(),
        authorEmail: form.authorEmail.trim(),
      })
      if (form.token.trim().length > 0) {
        await setRepoToken(repo.id, form.token.trim())
      }
      await cloneRepo(repo)
      router.back()
    } catch (e) {
      Alert.alert(
        'Clone failed',
        e instanceof Error ? e.message : String(e),
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <ThemedView style={styles.container}>
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
          onChangeText={(v) => set('name', v)}
          placeholder="vault"
        />
      </Field>

      <Field label="Branch" hint="Defaults to main.">
        <TextInput
          style={styles.input}
          value={form.branch}
          onChangeText={(v) => set('branch', v)}
          placeholder="main"
          autoCapitalize="none"
          autoCorrect={false}
        />
      </Field>

      <Field label="Local path" hint="Where to clone on device. Obsidian must be able to read this folder.">
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

      <View style={[styles.actions, { paddingBottom: insets.bottom + Spacing.two }]}>
        <Pressable style={styles.primaryBtn} onPress={onSave} disabled={saving}>
          {saving ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <ThemedText style={styles.primaryBtnText}>Clone & save</ThemedText>
          )}
        </Pressable>
      </View>
    </ThemedView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingVertical: Spacing.three },
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
    backgroundColor: '#208AEF',
    paddingVertical: Spacing.three,
    borderRadius: 10,
    alignItems: 'center',
  },
  primaryBtnText: { color: '#fff', fontWeight: '600', fontSize: 16 },
})
