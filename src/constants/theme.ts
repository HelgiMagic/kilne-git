export const Colors = {
  light: {
    text: '#111111',
    background: '#FFFFFF',
    backgroundElement: '#FFFFFF',
    backgroundSelected: '#DEDED8',
    textSecondary: '#111111',
    textMuted: '#111111',
    placeholder: '#9B9B9B',
    border: '#C8C8C0',
  },
  dark: {
    text: '#F5F5F5',
    background: '#111111',
    backgroundElement: '#181818',
    backgroundSelected: '#1F1F1F',
    textSecondary: '#F5F5F5',
    textMuted: '#F5F5F5',
    placeholder: '#6B6B6B',
    border: '#2A2A2A',
  },
} as const

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const

/** Neon lime — primary CTA only. */
export const Accent = '#D7FF00'

/** Text / icons on lime fills. */
export const AccentInk = '#111111'

export const Danger = '#FF3B4A'
export const Success = '#3DDC84'

/** Sharp edges: zero radius everywhere. */
export const Radii = {
  none: 0,
} as const

export const BorderWidth = 1
