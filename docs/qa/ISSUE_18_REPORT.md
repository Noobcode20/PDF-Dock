> Historical lane checkpoint. The integrated implementation and final parent verification are recorded in [ISSUE_SWEEP.md](ISSUE_SWEEP.md) and [REAL_DOCUMENT_VERIFICATION.md](REAL_DOCUMENT_VERIFICATION.md).

# Issue #18 implementation report

Editor Save now stores the current PDF bytes through the app's recent/library backend and records the same filename and source association. It does not invoke Electron's file save dialog or browser download. Save as and the explicit export flow still use the file save dialog. The editor's successful-save revision handling remains in place, and failures still propagate without marking the session saved.

Regression coverage: `scripts/test-editor-library-save.mjs` asserts the library path causes no disk write/download, preserves name/source association and bytes, and export still requests a destination.

Validation: the focused regression script passes. `npm run build` could not run because dependencies are not installed (`vite: command not found`). No Electron runtime/reopen verification was performed.

Limitation: the library backend currently keys stored blobs by content digest, so changed content is a distinct internal entry; the visible filename/source association is preserved and the newest saved copy can be reopened from the library. A durable logical document ID across edits requires a schema-level library identity change, which is outside this focused patch. Concurrent edits in save/session code (including undo work) may need integration review.
