import { ActivityIndicator, Pressable, StyleSheet } from 'react-native'

import { ThemedText } from '@/components/themed-text'
import { Accent, AccentInk, BorderWidth, Radii, Spacing } from '@/constants/theme'
import { useTheme } from '@/hooks/use-theme'

interface Props {
  label: string
  onPress: () => void
  disabled?: boolean
  loading?: boolean
  /** solid = lime primary CTA; outline = muted secondary */
  variant?: 'outline' | 'solid'
  /** Edge-to-edge: no border, full width of parent */
  flush?: boolean
}

/** Sharp-edged action button. Lime reserved for solid (primary) only. */
export function ActionButton({
  label,
  onPress,
  disabled = false,
  loading = false,
  variant = 'outline',
  flush = false,
}: Props) {
  const theme = useTheme()
  const solid = variant === 'solid'
  const indicatorColor = solid ? AccentInk : theme.textSecondary
  const textColor = solid ? AccentInk : theme.text

  return (
    <Pressable
      style={[
        styles.btn,
        solid
          ? styles.solid
          : [styles.outline, { borderColor: theme.border }],
        flush && styles.flush,
        disabled && styles.disabled,
      ]}
      onPress={onPress}
      disabled={disabled}
    >
      {loading ? (
        <ActivityIndicator color={indicatorColor} />
      ) : (
        <ThemedText type="smallBold" style={[styles.label, { color: textColor }]}>
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
    paddingVertical: Spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontSize: 15,
    lineHeight: 20,
    letterSpacing: 0.4,
  },
  outline: {
    backgroundColor: 'transparent',
  },
  solid: {
    borderColor: Accent,
    backgroundColor: Accent,
  },
  flush: {
    borderWidth: 0,
    alignSelf: 'stretch',
  },
  disabled: { opacity: 0.45 },
})
