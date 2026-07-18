import { Link, useFocusEffect, useRouter } from 'expo-router'
import { useCallback } from 'react'
import { ActivityIndicator, FlatList, Pressable, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { ThemedText } from '@/components/themed-text'
import { ThemedView } from '@/components/themed-view'
import { RepoCard } from '@/components/RepoCard'
import { Accent, AccentInk, BorderWidth, Radii, Spacing } from '@/constants/theme'
import { useTheme } from '@/hooks/use-theme'
import { useStore } from '@/store'

export default function RepoListScreen() {
  const repos = useStore((s) => s.repos)
  const hydrated = useStore((s) => s.hydrated)
  const theme = useTheme()
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
        <ActivityIndicator color={theme.textSecondary} />
      </ThemedView>
    )
  }

  return (
    <ThemedView style={[styles.container, { paddingTop: insets.top }]}>
      <FlatList
        contentContainerStyle={{
          paddingTop: Spacing.three,
          paddingBottom: insets.bottom + Spacing.six + 56,
        }}
        showsVerticalScrollIndicator={false}
        data={repos}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={
          <ThemedText type="heading" style={styles.screenTitle}>
            repositories
          </ThemedText>
        }
        renderItem={({ item }) => (
          <RepoCard
            repo={item}
            onPress={() => router.push({ pathname: '/repo/[id]', params: { id: item.id } })}
          />
        )}
        ItemSeparatorComponent={() => <View style={{ height: Spacing.three }} />}
        ListEmptyComponent={() => (
          <View style={styles.empty}>
            <ThemedText type="title" style={{ textAlign: 'center' }}>
              no repositories yet
            </ThemedText>
            <ThemedText
              type="small"
              themeColor="textSecondary"
              style={{ textAlign: 'center', marginTop: Spacing.three }}
            >
              add your obsidian vault git remote to start syncing.
            </ThemedText>
          </View>
        )}
      />

      <Link href="/add" asChild>
        <Pressable
          style={StyleSheet.flatten([
            styles.addBtn,
            {
              bottom: insets.bottom + Spacing.three,
              borderColor: Accent,
              backgroundColor: Accent,
            },
          ])}
        >
          <ThemedText type="label" style={{ color: AccentInk }}>
            +
          </ThemedText>
          <ThemedText type="label" style={{ color: AccentInk }}>
            add
          </ThemedText>
        </Pressable>
      </Link>
    </ThemedView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  screenTitle: {
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '600',
    letterSpacing: 0.3,
    marginBottom: Spacing.four,
  },
  empty: {
    paddingVertical: Spacing.six,
    paddingHorizontal: Spacing.four,
    gap: Spacing.two,
  },
  addBtn: {
    position: 'absolute',
    right: Spacing.three,
    width: 56,
    height: 56,
    borderWidth: BorderWidth,
    borderRadius: Radii.none,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
})
