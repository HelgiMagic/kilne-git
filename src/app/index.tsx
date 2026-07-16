import { Link } from 'expo-router'
import { useRouter } from 'expo-router'
import { useFocusEffect } from 'expo-router'
import { useCallback } from 'react'
import { ActivityIndicator, FlatList, Platform, Pressable, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { ThemedText } from '@/components/themed-text'
import { ThemedView } from '@/components/themed-view'
import { RepoCard } from '@/components/RepoCard'
import { Spacing } from '@/constants/theme'
import { useStore } from '@/store'

export default function RepoListScreen() {
  const repos = useStore((s) => s.repos)
  const hydrated = useStore((s) => s.hydrated)
  const router = useRouter()
  const insets = useSafeAreaInsets()

  useFocusEffect(
    useCallback(() => {
      // Re-hydrate is cheap when already loaded.
      useStore.getState().hydrate().catch(() => {})
    }, []),
  )

  if (!hydrated) {
    return (
      <ThemedView style={styles.center}>
        <ActivityIndicator />
      </ThemedView>
    )
  }

  return (
    <ThemedView style={styles.container}>
      <FlatList
        contentContainerStyle={{
          paddingVertical: Spacing.three,
          paddingBottom: insets.bottom + Spacing.five,
        }}
        showsVerticalScrollIndicator={false}
        data={repos}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => router.push({ pathname: '/repo/[id]', params: { id: item.id } })}
          >
            <RepoCard repo={item} />
          </Pressable>
        )}
        ItemSeparatorComponent={() => <View style={{ height: Spacing.two }} />}
        ListEmptyComponent={() => (
          <View style={styles.empty}>
            <ThemedText type="title" style={{ textAlign: 'center' }}>
              No repositories yet
            </ThemedText>
            <ThemedText type="small" style={{ textAlign: 'center', marginTop: Spacing.two }}>
              Add your Obsidian vault git remote to start syncing.
            </ThemedText>
          </View>
        )}
      />

      <Link href="/add" style={[styles.fab, { bottom: insets.bottom + Spacing.three }]}>
        <ThemedText style={styles.fabText}>+ Add</ThemedText>
      </Link>
    </ThemedView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  empty: { paddingVertical: Spacing.six, paddingHorizontal: Spacing.four, gap: Spacing.two },
  fab: {
    position: 'absolute',
    right: Spacing.three,
    backgroundColor: '#208AEF',
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
    borderRadius: 999,
    ...Platform.select({
      android: { elevation: 4 },
      ios: { shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } },
    }),
  },
  fabText: { color: '#fff', fontWeight: '600', fontSize: 16 },
})
