import assert from 'node:assert/strict';
import { DEFAULT_SHORTCUTS, SHORTCUT_ACTIONS, findShortcutConflict, loadShortcuts, matchesShortcut, saveShortcuts, shortcutSignature } from '../src/keyboardShortcuts.js';

const store = new Map();
globalThis.window = {
  localStorage: {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  },
};

const actions = new Map(SHORTCUT_ACTIONS);
assert.equal(actions.size, SHORTCUT_ACTIONS.length, 'shortcut labels must be unique');
assert.equal(Object.keys(DEFAULT_SHORTCUTS).length, SHORTCUT_ACTIONS.length, 'every shortcut needs a settings label');
for (const [action, label] of SHORTCUT_ACTIONS) {
  assert.ok(DEFAULT_SHORTCUTS[action], `${action} has no default`);
  assert.ok(label, `${action} has no label`);
  assert.ok(DEFAULT_SHORTCUTS[action].key, `${action} must be bound by default`);
  assert.ok(DEFAULT_SHORTCUTS[action].combo && DEFAULT_SHORTCUTS[action].combo !== '—', `${action} has no display combo`);
}
for (const action of ['save-as', 'print-document', 'navigate-editor', 'toggle-right-sidebar', 'focus-editor-search', 'next-tab', 'previous-tab', 'editor-page-next', 'editor-page-previous', 'editor-page-first', 'editor-page-last', 'editor-zoom-in', 'editor-zoom-out', 'editor-zoom-reset']) {
  assert.ok(DEFAULT_SHORTCUTS[action]?.key, `${action} must be customizable and bound`);
}
const signatures = new Map();
for (const [action, shortcut] of Object.entries(DEFAULT_SHORTCUTS)) {
  const signature = shortcutSignature(shortcut, false);
  assert.ok(!signatures.has(signature), `${action} conflicts with ${signatures.get(signature)}`);
  signatures.set(signature, action);
}

assert.ok(matchesShortcut({ key: 'p', metaKey: true, ctrlKey: false, shiftKey: false, altKey: false }, DEFAULT_SHORTCUTS['print-document'], true));
assert.ok(matchesShortcut({ key: 'p', metaKey: false, ctrlKey: true, shiftKey: false, altKey: false }, DEFAULT_SHORTCUTS['print-document'], false));
assert.ok(!matchesShortcut({ key: 'p', metaKey: false, ctrlKey: true, shiftKey: true, altKey: false }, DEFAULT_SHORTCUTS['print-document'], false));
assert.ok(matchesShortcut({ key: 'Tab', metaKey: false, ctrlKey: true, shiftKey: false, altKey: false }, DEFAULT_SHORTCUTS['next-tab'], true));
assert.ok(matchesShortcut({ key: 'Tab', metaKey: false, ctrlKey: true, shiftKey: true, altKey: false }, DEFAULT_SHORTCUTS['previous-tab'], true));
assert.ok(!matchesShortcut({ key: 'Tab', metaKey: false, ctrlKey: true, shiftKey: true, altKey: false }, DEFAULT_SHORTCUTS['next-tab'], true));
assert.ok(matchesShortcut({ key: 'PageDown', metaKey: false, ctrlKey: false, shiftKey: false, altKey: false }, DEFAULT_SHORTCUTS['editor-page-next'], true));
assert.ok(matchesShortcut({ key: 'b', metaKey: true, ctrlKey: false, shiftKey: false, altKey: true }, DEFAULT_SHORTCUTS['toggle-right-sidebar'], true));
assert.ok(matchesShortcut({ key: '=', metaKey: true, ctrlKey: false, shiftKey: false, altKey: false }, DEFAULT_SHORTCUTS['editor-zoom-in'], true));
assert.ok(matchesShortcut({ key: '+', metaKey: true, ctrlKey: false, shiftKey: true, altKey: false }, DEFAULT_SHORTCUTS['editor-zoom-in'], true));
assert.ok(matchesShortcut({ key: '+', metaKey: false, ctrlKey: true, shiftKey: true, altKey: false }, DEFAULT_SHORTCUTS['editor-zoom-in'], false));
assert.ok(matchesShortcut({ key: '_', metaKey: true, ctrlKey: false, shiftKey: true, altKey: false }, DEFAULT_SHORTCUTS['editor-zoom-out'], true));
assert.ok(!matchesShortcut({ key: '+', metaKey: false, ctrlKey: false, shiftKey: true, altKey: false }, DEFAULT_SHORTCUTS['editor-zoom-in'], true));
assert.equal(shortcutSignature({ key: '+', metaKey: true, ctrlKey: true, shiftKey: true }, true), shortcutSignature(DEFAULT_SHORTCUTS['editor-zoom-in'], true));

assert.equal(findShortcutConflict(DEFAULT_SHORTCUTS, 'save-as', DEFAULT_SHORTCUTS['save-export'], false), 'save-export');
assert.equal(findShortcutConflict(DEFAULT_SHORTCUTS, 'save-as', DEFAULT_SHORTCUTS['save-as'], false), null);
const target = { combo: 'ctrl+alt+p', metaKey: true, ctrlKey: true, shiftKey: false, altKey: true, key: 'p' };
const changed = { ...loadShortcuts(), 'print-document': target };
saveShortcuts(changed);
assert.deepEqual(loadShortcuts()['print-document'], target);
saveShortcuts(DEFAULT_SHORTCUTS);
assert.equal(store.get('pdfking-shortcuts'), '{}');
assert.equal(shortcutSignature({ key: '' }, false), '');
assert.equal(SHORTCUT_ACTIONS.length, 30, 'settings should expose the supported app and editor actions');
console.log(`PASS keyboard shortcuts: ${SHORTCUT_ACTIONS.length} labelled actions, unique defaults, platform-aware matching, conflict replacement, persistence.`);
