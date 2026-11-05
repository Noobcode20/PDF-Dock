# Keyboard/navigation audit fixes

Audit IDs: **16, 20, 21, 22**. Independent per-issue review is pending.

- **16:** Save document now activates the actual standalone output form's submit button, respecting its disabled/saving state. The output form remains responsible for validation and destination settings.
- **20:** Removed unconditional global interception of Tab. Home's existing preview shortcut is limited to a focused file row with an active document; ordinary buttons, empty Home, and other pages retain normal Tab traversal.
- **21:** Custom selects identify their owning trigger to the modal focus scope. Tab/Shift+Tab close the popup and move relative to the trigger, with wrapping only inside a dialog. Focus leaving the select dismisses its popup. Escape still restores trigger focus.
- **22:** Sidebar collapse/expand transfers focus to the replacement toggle only when the activated toggle owned focus; unrelated programmatic layout changes do not steal focus.

## Validation

- `node scripts/test-keyboard-shortcuts.mjs` — passed (30 actions, matching/persistence/conflict behavior).
- `npm run build` — passed. Existing bundle-size and qpdf browser-module notices remain.
- `node scripts/test-audit-keyboard-ui.cjs` — passed against built Electron in a unique disposable profile. Actual key presses verify Home Tab, sidebar focus both directions, popup Tab/Shift+Tab/Escape, and one standalone output save through the desktop bridge. The native save dialog is redirected to a disposable path; no real user documents/storage are touched.

The UI test waits for exiting dialogs to detach: while their transition is active, the modal focus scope intentionally remains in effect. No packaged installer or platform other than this Mac was tested.
