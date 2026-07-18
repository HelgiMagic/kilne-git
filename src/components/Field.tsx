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
      <ThemedText type="label" themeColor="textSecondary">
        {label}
      </ThemedText>
      {hint != null && (
        <ThemedText type="small" themeColor="textSecondary" style={styles.hint}>
          {hint}
        </ThemedText>
      )}
      <View style={styles.value}>{children}</View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { gap: Spacing.one, marginBottom: Spacing.three },
  hint: { opacity: 0.85 },
  value: { marginTop: Spacing.one },
})
