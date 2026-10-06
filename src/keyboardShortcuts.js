export const DEFAULT_SHORTCUTS = {
  'search': { combo: 'ctrl+k', metaKey: true, ctrlKey: true, key: 'k' },
  'new-document': { combo: 'ctrl+n', metaKey: true, ctrlKey: true, key: 'n' },
  'open-file': { combo: 'ctrl+o', metaKey: true, ctrlKey: true, key: 'o' },
  'save-export': { combo: 'ctrl+s', metaKey: true, ctrlKey: true, key: 's' },
  'close-overlay': { combo: 'esc', metaKey: false, ctrlKey: false, key: 'Escape' },
  'navigate-home': { combo: 'ctrl+h', metaKey: true, ctrlKey: true, key: 'h' },
  'navigate-recent': { combo: 'ctrl+shift+r', metaKey: true, ctrlKey: true, shiftKey: true, key: 'r' },
  'navigate-settings': { combo: 'ctrl+,', metaKey: true, ctrlKey: true, key: ',' },
  'new-tab': { combo: 'ctrl+t', metaKey: true, ctrlKey: true, key: 't' },
  'close-tab': { combo: 'ctrl+w', metaKey: true, ctrlKey: true, key: 'w' },
  'toggle-sidebar': { combo: 'ctrl+b', metaKey: true, ctrlKey: true, key: 'b' },
  'toggle-theme': { combo: 'ctrl+shift+t', metaKey: true, ctrlKey: true, shiftKey: true, key: 't' }
}

export function loadShortcuts() {
  try {
    const stored = window.localStorage.getItem('pdfking-shortcuts')
    return stored ? { ...DEFAULT_SHORTCUTS, ...JSON.parse(stored) } : DEFAULT_SHORTCUTS
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
