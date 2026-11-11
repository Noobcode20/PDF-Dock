# Audit 22 review — PASS

Reviewed commit: `d436e575d44416b2c22af89e59949a29550e937f`.
Checkout: `/Users/udbhavp/.t3/worktrees/PDF Tools/t3-661d91be`.
Reviewer: independent GPT-6.1 Sol review; no delegated agents.

**Verdict: PASS for the original sidebar-toggle activation defect.** No blocking regression found in the changed focus-transfer implementation. Adjacent existing focus gaps are recorded below; this is not a claim that all sidebar accessibility is resolved.

## Original defect status

Read original issue 22 from `/Users/udbhavp/Desktop/My Work/Tools/PDF Tools/audit/2026-11-04/findings.json`: activating Collapse sidebar removed the focused node and left `document.activeElement` at BODY.

Resolved for both collapse and expand with mouse clicks, Enter, and Space. The replacement button owns focus immediately after the update in all six cases. `src/components/Sidebar.jsx:21-27` records whether the clicked toggle owned focus and restores it in a layout effect; the two replacement controls share the ref at lines 123 and 128. Ordinary Tab after collapse reaches Settings; Shift+Tab after expansion reaches Settings. There is no focus reset to the beginning of the document in these activation paths.

## Findings, ordered by severity

No blocking findings attributable to this fix.

1. **Low — existing phone drawer focus remains offscreen after close/navigation.** At 390px, open the navigation drawer, then click its close button. The drawer closes, but the focused element remains the drawer's `Close navigation menu` button. The probe waited until that button's right edge was negative (`-0.769012451171875`), confirming focus on the offscreen drawer. Navigating Home likewise closes the drawer while retaining focus on its Home button. Relevant paths: `src/components/Sidebar.jsx:20` and `:75`, `src/main.jsx:431-437`, `src/styles.css:3367-3373`. These handlers/styles existed before the reviewed commit, as checked with `git show d436e57^` and the commit diff; no parent-version runtime session was run. A follow-up should restore focus to the mobile menu trigger when the drawer closes and keep the closed drawer out of keyboard navigation. This does not block the desktop toggle fix.
2. **Low — existing focus loss when the focused toggle disappears through a shortcut or responsive transition.** With Expand sidebar focused, `Meta+b` expands the sidebar and leaves BODY focused. Resizing the same focused control from desktop to 390px also removes it and leaves BODY focused. `src/main.jsx:991` changes collapse state directly; `src/main.jsx:425-426` changes the responsive mode; `src/components/Sidebar.jsx:15` and `:123-128` remove the control. The new handoff at `:21-27` intentionally applies only to an activated toggle, so these separate triggers do not set the restore flag. The removal/state paths are present in the parent source. Consider handling disappearing focused controls in a separate follow-up, while preserving the tested rule that unrelated focus must not be stolen. This is outside the original activation reproduction.

## Regression and UX probes

Native Electron loaded this checkout's newly built `dist` with `PDFKING_USE_BUILD=1`, in a unique temporary `--user-data-dir`. Both test scripts exit their own Electron process and remove temporary profiles in `finally`. No real user storage or documents were used.

- Mouse, Enter, and Space: collapse -> Expand sidebar focused; expand -> Collapse sidebar focused.
- Following focus order: Tab after collapse -> Settings; Shift+Tab after expansion -> Settings.
- Four shortcut toggles while Home owns focus: Home retains focus through each collapse/expand.
- Scripted `.click()` on an unfocused collapse/expand control preserves Home focus in both directions; no unconditional focus theft.
- Main-content input retains focus through shortcut collapse/expand. The probe temporarily exposes and focuses the actual tool file input through DOM styling for this isolated check; it does not assert that the unmodified hidden input is normally tabbable.
- Collapsed Convert pointer hover opens its flyout; choosing PDF to JPG opens the tool and removes the flyout.
- Keyboard focus on Convert opens the flyout; Escape closes it and preserves trigger focus. Expanded Convert submenu still closes/reopens.
- Computed accessibility snapshots report `button "Collapse sidebar"` and `button "Expand sidebar"`. Both controls retain native button semantics and distinct action names. This checks Chromium's accessible semantics, not actual VoiceOver announcements.
- Phone layout at 390px removes desktop collapse/expand controls; menu trigger opens drawer and reports `aria-expanded="true"`; drawer close, navigation, and Escape close it. Phone shortcut does not steal focus from the menu trigger or introduce desktop controls.
- Returning to 1200px restores desktop behavior; Enter on the restored toggle transfers focus correctly.
- No renderer `pageerror` events during the independent probes.

Phone coverage uses a resized native Electron window after relaxing only this disposable window's 1024px minimum. It exercises the app's real media-query/layout logic, not touch hardware, mobile Safari, or an installed phone build. Native platform coverage is macOS Darwin arm64 only; Windows/Linux and packaged installers were not tested.

## Commands and actual outputs

Dependencies were initially absent. Created only a dependency symlink:

```sh
ln -s '/Users/udbhavp/Desktop/My Work/Tools/PDF Tools/node_modules' node_modules
npm run build
```

Exit 0. Relevant actual output:

```text
vite v7.3.6 building client environment for production...
✓ 698 modules transformed.
✓ built in 3.58s
```

Build also emitted the qpdf `node:module` browser-externalization notice and the >500 kB chunk warning. Neither prevented the build.

```sh
node scripts/test-audit-keyboard-ui.cjs
```

Exit 0:

```text
PASS audit keyboard UI IDs 16,20,21,22: native standalone shortcut save; Home Tab traversal; popup Tab/Shift+Tab/Escape; sidebar focus through collapse/expand.
```

```sh
node scripts/test-keyboard-shortcuts.mjs
```

Exit 0:

```text
PASS keyboard shortcuts: 30 labelled actions, unique defaults, platform-aware matching, conflict replacement, persistence.
```

Node also emitted its `MODULE_TYPELESS_PACKAGE_JSON` warning for `src/keyboardShortcuts.js`.

```sh
node docs/reviews/audit-22-probes.cjs > docs/reviews/audit-22-probes.log 2>&1
```

Exit 0, run twice while refining the evidence probe. Complete actual final output: [audit-22-probes.log](audit-22-probes.log). Reproducible test source: [audit-22-probes.cjs](audit-22-probes.cjs). The PHONE and SHORTCUT observation lines intentionally record existing limitations rather than asserting those paths are fixed.

`git diff --name-only` returned no tracked application changes. Only review artifacts and the dependency symlink were added. No push, PR, application-source edit, or new checkout was performed.
