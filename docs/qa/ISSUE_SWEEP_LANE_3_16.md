# Issue sweep lane: #3 and #16

## Changes
- Removed celebratory confetti from successful tool runs and successful bug report submissions. Tool/report success remains plainly communicated; report submission keeps its accessible `role="status"`, confirmation copy, and check icon.
- Confirmed keyboard settings expose the 30 supported app/editor shortcut actions. Existing behavior includes custom bindings in local storage, platform-aware matching, collision detection/replacement, clearing, and reset. Added an explicit catalog breadth regression assertion.
- Editor page/zoom shortcuts are routed to the PDF editor workspace through the existing custom event integration.

## Validation
- - `node scripts/test-keyboard-shortcuts.mjs` passed (30 actions; persistence, collision and platform matching assertions).
- `git diff --check` passed.
- `npm run build` could not run: `vite: command not found` (dependencies are not installed in this checkout).
- No Electron/browser runtime verification was performed.

## Integration note
- Shortcut save/export behavior remains routed to existing UI/save APIs; this lane does not change save implementation.
