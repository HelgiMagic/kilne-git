import { Link, useFocusEffect, useRouter } from 'expo-router'
import { useCallback } from 'react'
import { ActivityIndicator, FlatList, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { ThemedText } from '@/components/themed-text'
import { ThemedView } from '@/components/themed-view'
import { RepoCard } from '@/components/RepoCard'
import { Accent, AccentInk, Radii, Spacing } from '@/constants/theme'
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
        <ActivityIndicator color={Accent} />
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
          <RepoCard
            repo={item}
            onPress={() => router.push({ pathname: '/repo/[id]', params: { id: item.id } })}
          />
        )}
        ItemSeparatorComponent={() => <View style={{ height: Spacing.two }} />}
        ListEmptyComponent={() => (
          <View style={styles.empty}>
            <ThemedText type="title" style={{ textAlign: 'center' }}>
              no repositories yet
            </ThemedText>
            <ThemedText
              type="small"
              themeColor="textSecondary"
              style={{ textAlign: 'center', marginTop: Spacing.two }}
            >
              add your obsidian vault git remote to start syncing.
            </ThemedText>
          </View>
        )}
      />

      <Link href="/add" style={[styles.fab, { bottom: insets.bottom + Spacing.three }]}>
        <ThemedText style={styles.fabText}>+ add</ThemedText>
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
    backgroundColor: Accent,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
    borderRadius: Radii.none,
  },
  fabText: {
    color: AccentInk,
    fontWeight: '700',
    fontSize: 14,
    letterSpacing: 0.8,
  },
})
