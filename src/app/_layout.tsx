import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router'
import { Stack } from 'expo-router'
import * as SplashScreen from 'expo-splash-screen'
import { StatusBar } from 'expo-status-bar'
import { useEffect } from 'react'
import { useColorScheme } from 'react-native'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { SafeAreaProvider } from 'react-native-safe-area-context'

import { useStore } from '@/store'
import { Colors, Spacing } from '@/constants/theme'

SplashScreen.preventAutoHideAsync()

export default function RootLayout() {
  const colorScheme = useColorScheme()
  const hydrate = useStore((s) => s.hydrate)

  useEffect(() => {
    let mounted = true
    hydrate().finally(() => {
      if (mounted) {
        SplashScreen.hideAsync().catch(() => {})
      }
    })
    return () => {
      mounted = false
    }
  }, [hydrate])

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <GestureHandlerRootView style={{ flex: 1, backgroundColor: (colorScheme === 'dark' ? Colors.dark : Colors.light).background }}>
        <SafeAreaProvider>
          <StatusBar style={colorScheme === 'dark' ? 'light' : 'dark'} />
          <RootLayoutNav />
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </ThemeProvider>
  )
}

function RootLayoutNav() {
  return (
    <Stack
      screenOptions={{
        headerShadowVisible: false,
        contentStyle: { paddingHorizontal: Spacing.three },
      }}
    >
      <Stack.Screen name="index" options={{ title: 'Repositories' }} />
      <Stack.Screen name="add" options={{ title: 'Add repository', presentation: 'modal' }} />
      <Stack.Screen name="repo/[id]" options={{ title: 'Repository' }} />
    </Stack>
  )
}
