import { ActivityIndicator, Pressable, StyleSheet } from 'react-native'

import { ThemedText } from '@/components/themed-text'
import { Accent, AccentInk, BorderWidth, Radii, Spacing } from '@/constants/theme'

interface Props {
  label: string
  onPress: () => void
  disabled?: boolean
  loading?: boolean
  /** outline = lime border; solid = lime fill + dark ink */
  variant?: 'outline' | 'solid'
}

/** Sharp-edged action button used on repo cards and the detail screen. */
export function ActionButton({
  label,
  onPress,
  disabled = false,
  loading = false,
  variant = 'outline',
}: Props) {
  const solid = variant === 'solid'
  const indicatorColor = solid ? AccentInk : Accent

  return (
    <Pressable
      style={[styles.btn, solid ? styles.solid : styles.outline, disabled && styles.disabled]}
      onPress={onPress}
      disabled={disabled}
    >
      {loading ? (
        <ActivityIndicator color={indicatorColor} />
      ) : (
        <ThemedText style={{ color: solid ? AccentInk : Accent, fontWeight: '600' }}>
          {label}
        </ThemedText>
      )}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  btn: {
    flex: 1,
    borderWidth: BorderWidth,
    borderRadius: Radii.none,
    paddingVertical: Spacing.two,
    alignItems: 'center',
  },
  outline: {
    borderColor: Accent,
    backgroundColor: 'transparent',
  },
  solid: {
    borderColor: Accent,
    backgroundColor: Accent,
  },
  disabled: { opacity: 0.5 },
})
