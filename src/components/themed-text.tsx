import { StyleSheet, Text, type TextProps } from 'react-native'

import { type ThemeColor } from '@/constants/theme'
import { useTheme } from '@/hooks/use-theme'

export type ThemedTextProps = TextProps & {
  type?: 'default' | 'title' | 'heading' | 'small' | 'smallBold' | 'label' | 'caption'
  themeColor?: ThemeColor
}

export function ThemedText({ style, type = 'default', themeColor, ...rest }: ThemedTextProps) {
  const theme = useTheme()

  return (
    <Text
      style={[
        { color: theme[themeColor ?? 'text'] },
        type === 'default' && styles.default,
        type === 'title' && styles.title,
        type === 'heading' && styles.heading,
        type === 'small' && styles.small,
        type === 'smallBold' && styles.smallBold,
        type === 'label' && styles.label,
        type === 'caption' && styles.caption,
        style,
      ]}
      {...rest}
    />
  )
}

const styles = StyleSheet.create({
  small: { fontSize: 14, lineHeight: 20, fontWeight: '500' },
  smallBold: { fontSize: 14, lineHeight: 20, fontWeight: '700' },
  default: { fontSize: 16, lineHeight: 24, fontWeight: '500' },
  heading: { fontSize: 18, lineHeight: 24, fontWeight: '600', letterSpacing: 0.2 },
  title: { fontSize: 24, fontWeight: '700', lineHeight: 30, letterSpacing: 0.3 },
  label: {
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '600',
    letterSpacing: 1.0,
  },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: '500' },
})
