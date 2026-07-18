import { StyleSheet, View } from 'react-native'

import { ThemedText } from '@/components/themed-text'
import { Spacing } from '@/constants/theme'

interface Props {
  label: string
  hint?: string
  children: React.ReactNode
}

/** Label + optional hint wrapping a form control. */
export function Field({ label, hint, children }: Props) {
  return (
    <View style={styles.container}>
      <ThemedText type="label" themeColor="textMuted">
        {label}
      </ThemedText>
      {hint != null && (
        <ThemedText type="caption" themeColor="textMuted" style={styles.hint}>
          {hint}
        </ThemedText>
      )}
      <View style={styles.value}>{children}</View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { gap: Spacing.one, marginBottom: Spacing.four },
  hint: { opacity: 0.9 },
  value: { marginTop: Spacing.two },
})
