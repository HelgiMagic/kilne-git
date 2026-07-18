export const Colors = {
  light: {
    text: '#0A0A0A',
    background: '#F4F4F0',
    backgroundElement: '#FFFFFF',
    backgroundSelected: '#E8E8E2',
    textSecondary: '#5C5C56',
    border: 'rgba(0,0,0,0.2)',
  },
  dark: {
    text: '#FFFFFF',
    background: '#000000',
    backgroundElement: '#0A0A0A',
    backgroundSelected: '#141414',
    textSecondary: '#8A8A8A',
    border: 'rgba(255,255,255,0.2)',
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

/** Neon lime — primary CTA fill (both themes). */
export const Accent = '#C8FF00'

/** Text / icons on lime fills. */
export const AccentInk = '#0A0A0A'

export const Danger = '#FF3B4A'
export const Success = '#3DDC84'

/** Sharp edges: zero radius everywhere. */
export const Radii = {
  none: 0,
} as const

export const BorderWidth = 1
