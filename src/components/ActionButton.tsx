import { ActivityIndicator, Pressable, StyleSheet } from 'react-native'

import { ThemedText } from '@/components/themed-text'
import { Accent, Spacing } from '@/constants/theme'

interface Props {
  label: string
  onPress: () => void
  disabled?: boolean
  loading?: boolean
}

/** Outlined action button used on repo cards and the detail screen. */
export function ActionButton({ label, onPress, disabled = false, loading = false }: Props) {
  return (
    <Pressable
      style={[styles.btn, disabled && styles.disabled]}
      onPress={onPress}
      disabled={disabled}
    >
      {loading ? (
        <ActivityIndicator color={Accent} />
      ) : (
        <ThemedText style={{ color: Accent }}>{label}</ThemedText>
      )}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  btn: {
    flex: 1,
    borderWidth: 1,
    borderColor: Accent,
    borderRadius: 10,
    paddingVertical: Spacing.two,
    alignItems: 'center',
  },
  disabled: { opacity: 0.5 },
})
