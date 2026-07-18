import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router'
import { Stack } from 'expo-router'
import * as SplashScreen from 'expo-splash-screen'
import { StatusBar } from 'expo-status-bar'
import { useEffect } from 'react'
import { useColorScheme } from 'react-native'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { SafeAreaProvider } from 'react-native-safe-area-context'

import { Accent, Colors, Spacing } from '@/constants/theme'
import { useStore } from '@/store'

SplashScreen.preventAutoHideAsync()

const SharpDark = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: Accent,
    background: Colors.dark.background,
    card: Colors.dark.background,
    text: Colors.dark.text,
    border: Colors.dark.border,
    notification: Accent,
  },
}

const SharpLight = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    primary: Accent,
    background: Colors.light.background,
    card: Colors.light.background,
    text: Colors.light.text,
    border: Colors.light.border,
    notification: Accent,
  },
}

export default function RootLayout() {
  const colorScheme = useColorScheme()
  const hydrate = useStore((s) => s.hydrate)
  const dark = colorScheme === 'dark'
  const background = (dark ? Colors.dark : Colors.light).background
  const text = (dark ? Colors.dark : Colors.light).text

  useEffect(() => {
    let mounted = true
    hydrate().finally(() => {
      if (mounted) SplashScreen.hideAsync().catch(() => {})
    })
    return () => {
      mounted = false
    }
  }, [hydrate])

  return (
    <ThemeProvider value={dark ? SharpDark : SharpLight}>
      <GestureHandlerRootView style={{ flex: 1, backgroundColor: background }}>
        <SafeAreaProvider>
          <StatusBar style={dark ? 'light' : 'dark'} />
          <Stack
            screenOptions={{
              headerShadowVisible: false,
              headerStyle: { backgroundColor: background },
              headerTintColor: text,
              headerTitleAlign: 'left',
              headerTitleStyle: { fontWeight: '600', color: text, letterSpacing: 0.3 },
              contentStyle: { paddingHorizontal: Spacing.four, backgroundColor: background },
            }}
          >
            <Stack.Screen name="index" options={{ title: 'repositories', headerShown: false }} />
            <Stack.Screen name="add" options={{ title: 'add repository', presentation: 'modal' }} />
            <Stack.Screen name="repo/[id]" options={{ title: 'repository' }} />
          </Stack>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </ThemeProvider>
  )
}
