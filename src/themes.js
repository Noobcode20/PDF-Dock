export const THEMES = [
  { id: 'violet', name: 'Violet', description: 'The original, softened', light: 'violet-light', dark: 'violet-dark' },
  { id: 'slate', name: 'Slate', description: 'Cool and focused', light: 'slate-light', dark: 'slate-dark' },
  { id: 'grove', name: 'Grove', description: 'Quiet botanical green', light: 'grove-light', dark: 'grove-dark' },
  { id: 'sand', name: 'Sand', description: 'Warm paper and ink', light: 'sand-light', dark: 'sand-dark' },
  { id: 'berry', name: 'Berry', description: 'Muted rose and plum', light: 'berry-light', dark: 'berry-dark' },
]

export const DEFAULT_THEME = 'violet-dark'
export const ALL_THEME_IDS = THEMES.flatMap(({ light, dark }) => [light, dark])

const BRAND_ACCENTS = {
  'violet-light': '#7952d4', 'violet-dark': '#b5a0f3',
  'slate-light': '#477ba9', 'slate-dark': '#91b9d8',
  'grove-light': '#4d8051', 'grove-dark': '#94bd91',
  'sand-light': '#9a7040', 'sand-dark': '#d3ad78',
  'berry-light': '#a05270', 'berry-dark': '#d19ab1',
}

export function themeBrandAccent(theme) {
  return BRAND_ACCENTS[normalizeTheme(theme)]
}

export function normalizeTheme(theme, fallback = DEFAULT_THEME) {
  if (ALL_THEME_IDS.includes(theme)) return theme
  if (theme === 'light') return 'violet-light'
  if (theme === 'dark') return 'violet-dark'
  return fallback
}

export function isLightTheme(theme) {
  return theme.endsWith('-light')
}

export function pairedTheme(theme) {
  return isLightTheme(theme) ? theme.replace('-light', '-dark') : theme.replace('-dark', '-light')
}
