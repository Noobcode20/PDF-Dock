# Audit 20 independent review

**Verdict: FAIL** — original global Tab blocker is resolved, but the new guard breaks the intentional row full-preview shortcut and still captures Tab from a row action button.

Reviewed commit: `d436e575d44416b2c22af89e59949a29550e937f`.
Checkout: `/Users/udbhavp/.t3/worktrees/PDF Tools/t3-4e68c85e`.
Review date: 2026-11-05. Scope: audit issue 20, commit diff and neighboring Home, modal, Settings and standalone-tool keyboard behavior. Original audit read from `/Users/udbhavp/Desktop/My Work/Tools/PDF Tools/audit/2026-11-04/findings.json`; implementation notes read from `docs/fixes/keyboard-navigation.md`.

## Findings (ranked)

### 1. Medium — selecting a file does not enable its Tab preview shortcut

Paths: `src/pages/HomePage.jsx:495` (new state guard), `src/pages/HomePage.jsx:500` (effect dependencies), `src/pages/HomePage.jsx:308` (selection updates state).

Reproduction with an isolated populated library:

1. Load Home with two PDFs and no active selection.
2. Click a file row; it becomes selected and its inspector preview renders.
3. Press Tab while the row owns focus.

Actual: focus advances to the row checkbox; no full preview opens. The handler closes over the initial null `activeFileId`. Clicking a row updates that state but does not refresh the effect because `activeFileId` is absent from its dependency array. The newly added guard therefore disables the documented interaction in an ordinary selection flow. This is a regression introduced by adding that state read to the guard.

Native output:

```text
{"probe":"click row then Tab","selected":"true","expanded":0,"overlay":0,"focus":{"tag":"INPUT","label":"Select review20-beta.pdf","class":""}}
```

Control: changing the search query while retaining the selected file refreshes the effect; focusing the row and pressing Tab then opens full preview. ArrowRight advances the two-page preview to `2 / 2`, and Escape closes it. This distinguishes a stale event handler from a PDF-rendering failure. Include the selected-file state in the effect's dependencies (or use another current-state mechanism), and verify the initial click/keyboard-selection paths without first editing search.

### 2. Medium — the preview guard also intercepts Tab from Remove buttons

Paths: `src/pages/HomePage.jsx:495`, `src/pages/HomePage.jsx:637` (nested Remove button).

After refreshing the handler with a search change, focus a row's `Remove … from library` button and press Tab. Actual: full preview opens and focus moves to its Next page control. Expected: a normal action button should advance through the library controls; the intentional shortcut should belong to the row itself. `event.target.closest('.home-file-row')` admits descendants, including buttons. Inputs are separately excluded by the editable guard, making adjacent row controls inconsistent.

Native output:

```text
{"probe":"Remove row action Tab","overlay":1,"focus":{"tag":"BUTTON","label":"Next page","class":"home-preview-page-button"}}
```

This is a remaining scoping defect in the proposed resolution, rather than a claim that descendant interception first appeared in this commit. Restrict the shortcut to the row focus target itself and independently test its checkbox and Remove action.

## Original defect status and regression probes

The unconditional global Tab `preventDefault` block was removed from `src/main.jsx` (current keyboard handler ends at lines 1025–1028). The original empty-Home reproduction now passes. No general Tab trap was observed in the tested settled pages.

Actual native keypress results:

- Empty Home New document: Tab → Home navigation button; Shift+Tab → PDF Dock home brand button.
- Empty Home Add PDFs: Tab → Search recent PDFs; Shift+Tab → command palette button.
- Populated Home New document: both directions advance normally, with the same destinations.
- Focused first file row: Shift+Tab → Search recent PDFs, without opening preview.
- Settings Appearance section tab: Tab → General; Shift+Tab → command palette button.
- PDF to JPG Choose files: Tab → JPEG select trigger; Shift+Tab → file drop zone.
- New-document modal: first control Shift+Tab wraps to last; last control Tab wraps to first.
- Remove confirmation: both boundary directions wrap inside the dialog; Escape closes it and preserves both cached records.
- Full preview: opens from the focused row after the handler refresh, ArrowRight advances pages, Escape closes it.
- Existing native suite: popup Tab/Shift+Tab/Escape, sidebar collapse/expand focus, Home Tab and standalone save all passed.
- Independent probe renderer errors: `[]`.

These are native Electron observations, not source-only assertions. The independent probe logs the two defects rather than asserting they are acceptable: its exit 0 means the evidence run completed and its other assertions passed, not that the review passes.

## Commands and actual outputs

Dependencies were absent. Created only the authorized dependency symlink:

```sh
ln -s '/Users/udbhavp/Desktop/My Work/Tools/PDF Tools/node_modules' node_modules
npm run build
```

Build exit 0, `✓ 698 modules transformed.`, `✓ built in 4.07s`. Vite warned about externalizing `node:module` in qpdf and chunks larger than 500 kB. Build output was generated in this checkout's `dist`.

```sh
node scripts/test-audit-keyboard-ui.cjs
```

Exit 0:

```text
PASS audit keyboard UI IDs 16,20,21,22: native standalone shortcut save; Home Tab traversal; popup Tab/Shift+Tab/Escape; sidebar focus through collapse/expand.
```

```sh
node docs/reviews/audit-20-probe.cjs > docs/reviews/audit-20-probe.log 2>&1
```

Final evidence run exit 0. Complete actual keypress output is in `docs/reviews/audit-20-probe.log`; reproducible probe source is `docs/reviews/audit-20-probe.cjs`. Final lines:

```text
PASS remove modal wraps both directions; Escape preserves records
renderer errors: []
CLEANUP native app closed; unique temporary profile removed
```

Probe development corrections: the first run pressed Tab during the Settings transition and stopped on a transient focus result; the final run waits 500 ms for that page transition. Another preliminary run accidentally created identical-byte fixtures without stable library IDs, which the cache correctly deduplicated; final fixtures use distinct explicit IDs and verify two records survive cancellation. Neither preliminary observation is reported as an application defect.

## Coverage and workspace limits

Tested built Electron on this Mac with actual Playwright keypresses and disposable two-page PDFs in unique `pdfdock-review20-*` temporary profiles. Both native test processes closed their app and removed their temporary profiles. No real user storage, parent application sources or caches were changed. No browser tab was opened. No application code edits, push, or PR.

Not tested: Windows/Linux, packaged installer, screen reader output, every tool/editor page, or an exhaustive full-preview focus cycle. The passing general-navigation and modal probes do not establish coverage of those surfaces. Only review evidence files and the dependency symlink are untracked.
