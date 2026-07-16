import { StyleSheet, Text, type TextProps } from 'react-native'

import { type ThemeColor } from '@/constants/theme'
import { useTheme } from '@/hooks/use-theme'

export type ThemedTextProps = TextProps & {
  type?: 'default' | 'title' | 'small' | 'smallBold'
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
        type === 'small' && styles.small,
        type === 'smallBold' && styles.smallBold,
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
  title: { fontSize: 28, fontWeight: '600', lineHeight: 34 },
})
