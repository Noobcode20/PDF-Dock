# Audit 21 independent review

**Verdict: FAIL** — the original reproduction is resolved, but the new manual Tab traversal skips a real focusable inspector control and can lose focus when a candidate cannot receive focus.

- Reviewed commit: `d436e575d44416b2c22af89e59949a29550e937f`.
- Checkout: `/Users/udbhavp/.t3/worktrees/PDF Tools/t3-679301ca`.
- Scope: `src/components/ThemedSelect.jsx`, modal integration in `src/main.jsx`, surrounding New document and text-inspector behavior, `docs/fixes/keyboard-navigation.md`, supplied native test, and original finding 21 read from the absolute audit JSON path supplied in the brief.
- No application source changes, checkout creation, pushes, PRs, or subagents. Review script and machine-readable results accompany this report.

## Findings, ranked by severity

### 1. P2 — Popup Shift+Tab skips the inspector's native disclosure control

**Location:** `src/components/ThemedSelect.jsx:110-117`; affected existing control: `src/components/InspectorSection.jsx:5-6`.

Reproduced in the real built app, without DOM fixtures:

1. Import a disposable single-page PDF containing text through New document.
2. Choose Edit text, double-click the text, and open the text properties inspector.
3. Focus Font family with its popup closed; press Shift+Tab. Chromium focuses the `SUMMARY` named `Typography`.
4. Open Font family; press Shift+Tab. The popup closes, but focus goes to the button named `Close properties panel`, skipping Typography.

Actual output:

```json
{"name":"native traversal parity Font family Shift+Tab","pass":false,"details":{"expected":{"tag":"SUMMARY","id":"","label":null,"text":"Typography"},"actual":{"tag":"BUTTON","id":"","label":"Close properties panel","text":""}}}
```

The added candidate query omits `summary` and other native sequential-focus targets, so its computed previous control differs from the browser's actual previous control. This is a regression in the new popup Tab path. Keyboard users lose the expected route to collapse/expand Typography. Use a complete, consistently ordered tabbable-target calculation, including native disclosure controls and editable elements, rather than this restricted selector.

### 2. P2 — Unfocusable candidates consume Tab and leave focus on BODY

**Location:** `src/components/ThemedSelect.jsx:110-117`.

Reproduced with explicitly inserted DOM fixture buttons immediately after the real Page size select host in New document. These are component edge-case probes, not a claim that the current form contains these particular buttons.

| Candidate inserted before Orientation | Actual result after popup Tab |
| --- | --- |
| ordinary disabled button | Correctly skips to Orientation |
| `display:none` button | Correctly skips to Orientation |
| `visibility:hidden` button | Popup closes; active element becomes BODY |
| button with `inert` | Popup closes; active element becomes BODY |
| disabled button with `tabindex="0"` | Popup closes; active element becomes BODY |

The visibility filter only checks layout rectangles. Hidden-by-visibility and inert controls still have rectangles. The `[tabindex="0"]` selector arm also admits a disabled button despite the other selector arms' `:not(:disabled)` checks. `next.focus()` then silently fails after default Tab was prevented. Removing the focused popup option sends focus to BODY, outside the dialog, instead of continuing to Orientation.

All three failure records contain `"pass":false` and `"details":{"tag":"BODY","id":"","label":null,...}` in `audit-21-results.json`. Exclude all disabled/inert/non-visible targets regardless of selector arm; avoid consuming navigation without a valid focus destination.

## Original defect status

**Resolved for the reported New document scenario.** Page size → open list → Tab closes the list and focuses Orientation; Orientation → open list → Shift+Tab closes it and returns to Page size. `aria-expanded` and popup removal are driven by the same open state. Escape leaves the selected value unchanged, restores trigger focus, and leaves the dialog open. Programmatic focus to another real control also dismisses the list.

## Commands and actual outputs

Dependencies were initially absent. Created only the authorized dependency symlink:

```sh
ln -s '/Users/udbhavp/Desktop/My Work/Tools/PDF Tools/node_modules' node_modules
npm run build
```

Build exit **0**: `✓ 698 modules transformed.` and `✓ built in 3.76s`. Existing qpdf `node:module` externalization and large-chunk warnings were emitted. Build output belongs to this checkout's `dist`.

```sh
node scripts/test-audit-keyboard-ui.cjs > tmp/audit-21-baseline.log 2>&1
```

Exit **0**, actual output:

```text
PASS audit keyboard UI IDs 16,20,21,22: native standalone shortcut save; Home Tab traversal; popup Tab/Shift+Tab/Escape; sidebar focus through collapse/expand.
```

```sh
node docs/reviews/audit-21-probes.cjs > tmp/audit-21-probes.log 2>&1
```

Final run exit **2**, intentionally set for recorded failed probes: **33 probes, 29 passed, 4 failed**. Three failures are variants of finding 2; one is finding 1. No renderer errors. Full structured observations: [audit-21-results.json](audit-21-results.json). Reproduction harness: [audit-21-probes.cjs](audit-21-probes.cjs).

An earlier harness run timed out because adding a synthetic nested-dialog role and immediately clicking raced the app's modal observer. The final harness lets modal synchronization settle before input; nested probes then complete. This harness race is not reported as an app defect. Enter restores focus on the next animation frame; its final probe waits for that frame.

`git diff --check` exited **0** (no output).

## Additional regression and UX coverage

Passed native Electron probes:

- Arrow opening, End/Home, forward/backward option wrapping, Enter selection of Legal, Escape cancellation and trigger restoration.
- Nested modal scopes using DOM roles around real mounted controls: forward traversal stays in the inner scope; first-select Shift+Tab wraps to the last input; last-select Tab wraps to the first select when the trailing input is disabled; single-control scope wraps in both directions. These are synthetic scope tests, not end-user nested-modal workflow coverage.
- Outside dialogs in the real editor: Font size Tab advances to Line height; reverse Tab returns to Font size. All eight native-versus-popup traversal comparisons across Font family, Font weight, Font size and Line height passed except the Typography omission above.
- Active rich-text input remains present with its edited content through popup Tab, Shift+Tab, choosing 24 pt, and Escape. It subsequently commits the expected text. This verifies the editing session and rendered committed preview; saved PDF export was not independently inspected in this review.
- Popup stays inside the viewport near an edge and after native window resizing. Actual observed resized rectangle: x=840, y=526, right=1016, bottom=637 in a 1024×720 viewport. Native minimum window width constrained the requested resize. Menu scrolling preserves placement within animation tolerance.

Coverage is development Electron on this Mac with this checkout's production build, not an installed package, Windows/Linux, VoiceOver, or browser chrome/window-boundary Tab behavior. All native app instances were exited in `finally`; unique temporary profiles/PDFs were removed. No real user documents or profile storage were used.
