# Audit 16 independent review

Verdict: **PASS**

Reviewed commit: `d436e575d44416b2c22af89e59949a29550e937f`.
Checkout: `/Users/udbhavp/.t3/worktrees/PDF Tools/t3-b6c11fd9`.
Date: 2026-11-05. Reviewer worked independently without subagents or application edits.

## Original defect

Resolved. The original audit JSON at `/Users/udbhavp/Desktop/My Work/Tools/PDF Tools/audit/2026-11-04/findings.json`, ID 16, describes a selector looking inside `.output-row` for its sibling form's save control. `src/main.jsx:1005` now selects `.output-save-controls button[type="submit"]:not(:disabled)` and clicks the real form submit control at line 1006. Native Electron key presses demonstrated this route reaching the desktop save IPC and writing actual output files.

## Findings by severity

No blocking or nonblocking defects found in the assigned change and tested neighboring behaviors.

Relevant inspected paths:

- `src/main.jsx:935`: recording, editable-target, modal and platform routing guards; save-as remains editor-only at line 944; standalone save-export at line 1004 remains excluded from the full editor.
- `src/components/OutputSaveControls.jsx:11`: normal form submission retains browser required-field validation, filename validation, saving guard, and disabled controls at lines 22–28.
- `src/outputStorage.js:1`: filename sanitation and extension handling; destination handling at line 11.
- `src/pages/ToolStudioPage.jsx:548`: global in-flight save guard, destination forwarding, removal only after success, cancellation retains output. Form integration at line 765.
- `electron/main.cjs:528`: native save IPC, dialog options and atomic file write.

## Commands and actual outputs

Dependencies were initially absent. Created only the authorized dependency symlink:

```sh
ln -s '/Users/udbhavp/Desktop/My Work/Tools/PDF Tools/node_modules' node_modules
npm run build
node scripts/test-audit-keyboard-ui.cjs
node scripts/test-keyboard-shortcuts.mjs
node scripts/test-output-storage.mjs
node docs/reviews/audit-16-probes.cjs
```

Build exited 0: `✓ 698 modules transformed.` and `✓ built in 3.62s`. Notices: qpdf's `node:module` externalized for browser compatibility and chunks exceeding 500 kB. No build error.

Existing checks exited 0:

```text
PASS audit keyboard UI IDs 16,20,21,22: native standalone shortcut save; Home Tab traversal; popup Tab/Shift+Tab/Escape; sidebar focus through collapse/expand.
PASS keyboard shortcuts: 30 labelled actions, unique defaults, platform-aware matching, conflict replacement, persistence.
PASS output storage: names, app/device/both, independent library copies, cancellation, partial failures, and unsupported formats.
```

The shortcut unit script also emitted Node's MODULE_TYPELESS_PACKAGE_JSON warning; assertions passed.

Independent native probe's final run exited 0:

```text
PASS invalid empty/whitespace/path/special/trailing-dot names block native save from focused filename input
PASS focused name saves once with .pdf extension; cancellation preserves output and enables retry
PASS focused destination routes save; pending save disables controls; repeated shortcuts do not invoke another dialog
PASS library-only shortcut creates exactly one PDF library entry without device dialog, even with recent recording disabled
PASS both destination writes valid two-page PDF through native IPC and creates one library entry
PASS device destination writes without adding a library copy
PASS no output is no-op; macOS Control+S and standalone Save As do not misroute; modal blocks save; closing modal restores Meta+S
```

## Regression and UX probes

The independent script produces a merged two-page PDF from two real fixtures. It uses actual Playwright keyboard input into this checkout's built Electron renderer. Five invalid filename cases produce zero save-dialog calls; the empty input has `validity.valueMissing`, while other invalid names show the form's error. A filename without extension reaches native dialog options as `custom-name.pdf` exactly once.

Cancellation leaves the output and restores enabled controls. Holding the save dialog promise pending disables name, destination, Preview and Save; two further Meta+S presses keep the call count unchanged. Saving from the focused name field and focused destination select both work. Library-only saves create one named entry and no device dialog; both creates one named library entry and a filesystem PDF parsed with pdf-lib as two pages; device creates no corresponding library entry. These explicit choices work with automatic recent recording disabled.

Command routing probes verify no output is a no-op, Control+S on this Mac does not trigger the platform Meta+S action, Meta+Shift+S does not invoke standalone save, and the command-palette modal blocks saving until dismissed. Existing native test additionally covers JPG output and adjacent keyboard UI behavior. The fix does not modify shortcut definitions, full-editor save routing, or save-as routing; full-editor save was inspected but not independently exercised here.

Harness development included failed runs, not product findings: duplicate fixture paths yielded no selected files; a main-process test stub incorrectly used an unavailable `require`; a modal-restoration assertion initially used New document, which intentionally creates a new Home tab (`src/main.jsx:500`). Corrected the fixtures/stub and used Command palette to test modal blocking without changing tabs. The final checked-in probe passes end to end.

## Coverage limits and cleanup

Runtime coverage is macOS Electron from this checkout's freshly built `dist`; no Windows/Linux installation or packaged installer was tested. Cross-platform Ctrl modifier matching is covered by the existing shortcut unit assertions, not a native Windows run. `dialog.showSaveDialog` was redirected inside the isolated main process to cancel, delay, or select disposable paths: real renderer key handling, preload/IPC, validation, library persistence and filesystem writes executed, but the operating system save-panel UI itself was not automated. Dialog filename basename was asserted; custom output-folder preferences and editor save internals were not independently exercised.

Every native run used a unique temporary user-data profile and fixture directory, closed its own Electron instance, and removed its temporary data in finally. Real user storage was not used. No browser tab was opened. Application source was unchanged; review artifacts and the dependency symlink are the only untracked additions.
