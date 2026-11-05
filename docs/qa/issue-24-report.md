> Historical lane checkpoint. The integrated implementation and final parent verification are recorded in [ISSUE_SWEEP.md](ISSUE_SWEEP.md) and [REAL_DOCUMENT_VERIFICATION.md](REAL_DOCUMENT_VERIFICATION.md).

# Issue #24: editor undo and redo

## Finding

Image crop/transform slider updates are coalesced for one history step. Undoing or redoing while that coalescing window is open previously left it active, so a subsequent slider update could change the document without recording a new history entry and without invalidating redo.

## Change

Undo and redo now close the active crop coalescing session before restoring a snapshot. Added regression assertions to the editor history test for baseline capture, undo/redo stack movement, and redo invalidation by a subsequent edit.

## Checks

- `node scripts/test-editor.mjs` — not run: `@napi-rs/canvas` is not installed in this checkout.
- `npm run build` — not run: Vite is not installed in this checkout.
- No Electron or browser runtime verification performed.

## Integration note

The source change is limited to `ToolStudioPage.jsx`; another editor lane touching the same file should preserve the two crop-session resets in `undoEdit` and `redoEdit`.
