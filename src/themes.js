export const THEMES = [
  { id: 'violet', name: 'Daylight', description: 'Relaxed blue surfaces and a clean sans serif voice', light: 'violet-light', dark: 'violet-dark' },
  { id: 'slate', name: 'Blueprint', description: 'Measured steel tones with a precise, quiet finish', light: 'slate-light', dark: 'slate-dark' },
  { id: 'grove', name: 'Canopy', description: 'Soft botanical neutrals and grounded green accents', light: 'grove-light', dark: 'grove-dark' },
  { id: 'sand', name: 'Gazette', description: 'Newsprint neutrals with editorial serif headlines', light: 'sand-light', dark: 'sand-dark' },
  { id: 'daybreak', name: 'Daybreak', description: 'Sunny paper, warm type, and optimistic teal details', light: 'daybreak-light', dark: 'daybreak-dark' },
  { id: 'contrast', name: 'Contrast', description: 'Direct, high-readability color with strong focus cues', light: 'contrast-light', dark: 'contrast-dark' },
  { id: 'midnight', name: 'Midnight', description: 'Near-black precision with restrained violet light', light: 'midnight-light', dark: 'midnight-dark' },
  { id: 'pop', name: 'POP!', description: 'Playful pink and lavender with rounded expressive type', light: 'pop-light', dark: 'pop-dark' },
]

export const DEFAULT_THEME = 'violet-light'
export const ALL_THEME_IDS = THEMES.flatMap(({ light, dark }) => [light, dark])

const BRAND_ACCENTS = {
  'violet-light': '#315fd1', 'violet-dark': '#a6bcf5',
  'slate-light': '#526f8e', 'slate-dark': '#a9c0d3',
  'grove-light': '#557b59', 'grove-dark': '#adc89e',
  'sand-light': '#756044', 'sand-dark': '#d4c193',
  'daybreak-light': '#C35B1B', 'daybreak-dark': '#FFC46D',
  'contrast-light': '#0039B3', 'contrast-dark': '#FFE35B',
  'midnight-light': '#7653D8', 'midnight-dark': '#B69AFF',
  'pop-light': '#B62972', 'pop-dark': '#FF83BF',
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
