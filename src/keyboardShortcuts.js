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
  'navigate-editor': { combo: '—', metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, key: '' },
  'print-document': { combo: '—', metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, key: '' },
  'toggle-right-sidebar': { combo: '—', metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, key: '' },
  'focus-editor-search': { combo: '—', metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, key: '' },
  'editor-page-next': { combo: '—', metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, key: '' },
  'editor-page-previous': { combo: '—', metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, key: '' },
  'editor-page-first': { combo: '—', metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, key: '' },
  'editor-page-last': { combo: '—', metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, key: '' },
  'editor-zoom-in': { combo: '—', metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, key: '' },
  'editor-zoom-out': { combo: '—', metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, key: '' },
  'editor-zoom-reset': { combo: '—', metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, key: '' }
}

export function matchesShortcut(event, shortcut, isMac) {
  if (!shortcut?.key || event.altKey !== !!shortcut.altKey || event.shiftKey !== !!shortcut.shiftKey || shortcut.key.toLowerCase() !== event.key.toLowerCase()) return false
  const modifier = shortcut.metaKey && shortcut.ctrlKey
    ? (isMac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey)
    : shortcut.metaKey
      ? event.metaKey && !event.ctrlKey
      : shortcut.ctrlKey
        ? event.ctrlKey && !event.metaKey
        : !event.metaKey && !event.ctrlKey
  return modifier
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
