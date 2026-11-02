export const DEFAULT_SHORTCUTS = {
  'search': { combo: 'ctrl+k', metaKey: true, ctrlKey: true, key: 'k', toggleOnRepeat: true },
  'new-document': { combo: 'ctrl+shift+n', metaKey: true, ctrlKey: true, shiftKey: true, altKey: false, key: 'n' },
  'new-window': { combo: 'ctrl+n', metaKey: true, ctrlKey: true, shiftKey: false, altKey: false, key: 'n' },
  'open-file': { combo: 'ctrl+o', metaKey: true, ctrlKey: true, shiftKey: false, altKey: false, key: 'o', toggleOnRepeat: true },
  'save-export': { combo: 'ctrl+s', metaKey: true, ctrlKey: true, key: 's' },
  'undo': { combo: 'ctrl+z', metaKey: true, ctrlKey: true, shiftKey: false, altKey: false, key: 'z' },
  'redo': { combo: 'ctrl+shift+z', metaKey: true, ctrlKey: true, shiftKey: true, altKey: false, key: 'z' },
  'close-overlay': { combo: 'esc', metaKey: false, ctrlKey: false, key: 'Escape' },
  'navigate-home': { combo: 'ctrl+h', metaKey: true, ctrlKey: true, key: 'h' },
  'navigate-recent': { combo: 'ctrl+shift+r', metaKey: true, ctrlKey: true, shiftKey: true, key: 'r' },
  'navigate-settings': { combo: 'ctrl+,', metaKey: true, ctrlKey: true, key: ',' },
  'new-tab': { combo: 'ctrl+t', metaKey: true, ctrlKey: true, key: 't' },
  'close-tab': { combo: 'ctrl+w', metaKey: true, ctrlKey: true, key: 'w' },
  'close-window': { combo: 'ctrl+shift+w', metaKey: true, ctrlKey: true, shiftKey: true, key: 'w' },
  'toggle-sidebar': { combo: 'ctrl+b', metaKey: true, ctrlKey: true, key: 'b' },
  'toggle-theme': { combo: 'ctrl+shift+t', metaKey: true, ctrlKey: true, shiftKey: true, key: 't' },
  'next-tab': { combo: 'ctrl+tab', metaKey: false, ctrlKey: true, shiftKey: false, altKey: false, key: 'Tab' },
  'previous-tab': { combo: 'ctrl+shift+tab', metaKey: false, ctrlKey: true, shiftKey: true, altKey: false, key: 'Tab' },
  'navigate-editor': { combo: 'ctrl+e', metaKey: true, ctrlKey: true, shiftKey: false, altKey: false, key: 'e' },
  'save-as': { combo: 'ctrl+shift+s', metaKey: true, ctrlKey: true, shiftKey: true, key: 's' },
  'print-document': { combo: 'ctrl+p', metaKey: true, ctrlKey: true, shiftKey: false, altKey: false, key: 'p' },
  'toggle-right-sidebar': { combo: 'ctrl+alt+b', metaKey: true, ctrlKey: true, shiftKey: false, altKey: true, key: 'b' },
  'focus-editor-search': { combo: 'ctrl+f', metaKey: true, ctrlKey: true, shiftKey: false, altKey: false, key: 'f' },
  'editor-page-next': { combo: 'pagedown', metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, key: 'PageDown' },
  'editor-page-previous': { combo: 'pageup', metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, key: 'PageUp' },
  'editor-page-first': { combo: 'home', metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, key: 'Home' },
  'editor-page-last': { combo: 'end', metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, key: 'End' },
  'editor-zoom-in': { combo: 'ctrl+=', metaKey: true, ctrlKey: true, shiftKey: false, altKey: false, key: '=' },
  'editor-zoom-out': { combo: 'ctrl+-', metaKey: true, ctrlKey: true, shiftKey: false, altKey: false, key: '-' },
  'editor-zoom-reset': { combo: 'ctrl+0', metaKey: true, ctrlKey: true, shiftKey: false, altKey: false, key: '0' }
}

export const SHORTCUT_ACTIONS = [
  ['search', 'Quick search'],
  ['new-window', 'New window'],
  ['open-file', 'Open PDF'],
  ['save-export', 'Save document'],
  ['save-as', 'Save as'],
  ['undo', 'Undo'],
  ['redo', 'Redo'],
  ['close-overlay', 'Close dialog or menu'],
  ['navigate-home', 'Go to Home'],
  ['navigate-recent', 'Go to Recent files'],
  ['navigate-settings', 'Go to Settings'],
  ['navigate-editor', 'Go to Editor'],
  ['new-document', 'New document'],
  ['new-tab', 'New tab'],
  ['close-tab', 'Close tab'],
  ['next-tab', 'Next tab'],
  ['previous-tab', 'Previous tab'],
  ['close-window', 'Close window'],
  ['toggle-sidebar', 'Toggle sidebar'],
  ['toggle-theme', 'Toggle light/dark theme'],
  ['print-document', 'Print PDF'],
  ['toggle-right-sidebar', 'Toggle editor properties panel'],
  ['focus-editor-search', 'Find in PDF'],
  ['editor-page-next', 'Next PDF page'],
  ['editor-page-previous', 'Previous PDF page'],
  ['editor-page-first', 'First PDF page'],
  ['editor-page-last', 'Last PDF page'],
  ['editor-zoom-in', 'Zoom in'],
  ['editor-zoom-out', 'Zoom out'],
  ['editor-zoom-reset', 'Reset zoom']
]

export function matchesShortcut(event, shortcut, isMac) {
  if (!shortcut?.key) return false
  const expected = shortcut.key.toLowerCase()
  const actual = String(event.key || '').toLowerCase()
  const zoomAlias = (expected === '=' && actual === '+') || (expected === '+' && actual === '=')
    || (expected === '-' && actual === '_') || (expected === '_' && actual === '-')
  const keyMatches = expected === actual || zoomAlias
  const shiftMatches = zoomAlias ? true : event.shiftKey === !!shortcut.shiftKey
  if (!keyMatches || event.altKey !== !!shortcut.altKey || !shiftMatches) return false
  const modifier = shortcut.metaKey && shortcut.ctrlKey
    ? (isMac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey)
    : shortcut.metaKey
      ? event.metaKey && !event.ctrlKey
      : shortcut.ctrlKey
        ? event.ctrlKey && !event.metaKey
        : !event.metaKey && !event.ctrlKey
  return modifier
}

export function shortcutSignature(shortcut, isMac) {
  if (!shortcut?.key) return ''
  const modifier = shortcut.metaKey && shortcut.ctrlKey
    ? 'platform'
    : shortcut.metaKey
      ? (isMac ? 'platform' : 'meta')
      : shortcut.ctrlKey
        ? (isMac ? 'ctrl' : 'platform')
        : ''
  let key = shortcut.key.toLowerCase()
  let shift = !!shortcut.shiftKey
  if (key === '+') key = '='
  else if (key === '_') key = '-'
  if (key === '=' || key === '-') shift = false
  return [modifier, !!shortcut.altKey, shift, key].join('|')
}

export function findShortcutConflict(shortcuts, action, candidate, isMac) {
  const signature = shortcutSignature(candidate, isMac)
  if (!signature) return null
  for (const [key, shortcut] of Object.entries(shortcuts || {})) {
    if (key !== action && shortcutSignature(shortcut, isMac) === signature) return key
  }
  return null
}

export function loadShortcuts() {
  try {
    const stored = window.localStorage.getItem('pdfking-shortcuts')
    const saved = stored ? JSON.parse(stored) : {}
    const shortcuts = { ...DEFAULT_SHORTCUTS, ...saved }
    // Move the old Cmd/Ctrl+N assignment from New Document to New Window.
    if (!saved['new-window'] && saved['new-document']?.key?.toLowerCase() === 'n' && (saved['new-document']?.metaKey || saved['new-document']?.ctrlKey)) {
      shortcuts['new-window'] = DEFAULT_SHORTCUTS['new-window']
      shortcuts['new-document'] = DEFAULT_SHORTCUTS['new-document']
    }
    if (saved['new-window']?.combo === 'meta+n' && saved['new-window']?.key?.toLowerCase() === 'n' && saved['new-window']?.metaKey && !saved['new-window']?.ctrlKey) shortcuts['new-window'] = DEFAULT_SHORTCUTS['new-window']
    if (saved['open-file']?.combo === 'meta+o' && saved['open-file']?.key?.toLowerCase() === 'o' && saved['open-file']?.metaKey && !saved['open-file']?.ctrlKey) shortcuts['open-file'] = DEFAULT_SHORTCUTS['open-file']
    return shortcuts
  } catch { return DEFAULT_SHORTCUTS }
}

export function saveShortcuts(shortcuts) {
  const custom = {}
  for (const key in shortcuts) {
    const def = DEFAULT_SHORTCUTS[key]
    if (!def || JSON.stringify(shortcuts[key]) !== JSON.stringify(def)) custom[key] = shortcuts[key]
  }
  window.localStorage.setItem('pdfking-shortcuts', JSON.stringify(custom))
}
