# Desktop focused audit: settings, storage, feedback, updater

Scope: requested source files in Electron and renderer. I inspected the source and attempted the supplied preview route in a fresh incognito tab; `preview_open` returned `chrome-error://chromewebdata/`, so visible-control runtime checks were unavailable. No UI state or shared storage was changed. Findings below are code-confirmed or explicitly labeled improvements; no app fixes were made.

## Findings

### 1. Disabling recent copies destroys the existing local library immediately
- **Severity:** Medium
- **Evidence:** Code confirmed
- **Repro:** Settings → General → uncheck “Keep local recent PDF copies.”
- **Expected:** The preference disables future automatic copies; clearing existing history should be a separately named/described destructive action.
- **Actual:** `onChange` persists false and immediately calls `handleClearCache()`, which recursively removes the entire recent-files directory, including cached PDFs and index. The checkbox label describes future storage only.
- **Consequence:** Existing local copies are irreversibly removed with one toggle and no confirmation; users may mistake this for hiding/pausing recent items.
- **Source:** [SettingsPage.jsx](/Users/udbhavp/Desktop/My%20Work/Tools/PDF%20Tools/src/pages/SettingsPage.jsx:325), [SettingsPage.jsx](/Users/udbhavp/Desktop/My%20Work/Tools/PDF%20Tools/src/pages/SettingsPage.jsx:332), [main.cjs](/Users/udbhavp/Desktop/My%20Work/Tools/PDF%20Tools/electron/main.cjs:498)
- **Suggested change:** Separate the preference from deletion, or clearly disclose and confirm that disabling also deletes all cached copies.

### 2. Turning recent copies back on does not restore PDFs opened while disabled
- **Severity:** Low
- **Evidence:** Code confirmed
- **Repro:** Disable recent copies, then open a PDF; re-enable the setting and inspect Recent Files.
- **Expected:** If the setting means “keep recent copies,” enabling it should resume retention for future opens (already the code intent); improve the UI to explain that missed files are not backfilled and only newly opened/exported files return.
- **Actual:** `rememberPdf` returns immediately while the preference is false; re-enabling only changes localStorage and leaves those opened files unrecorded.
- **Consequence:** The list remains empty/stale after re-enabling, with no indication that the preference cannot reconstruct history.
- **Source:** [fileServices.js](/Users/udbhavp/Desktop/My%20Work/Tools/PDF%20Tools/src/fileServices.js:34), [SettingsPage.jsx](/Users/udbhavp/Desktop/My%20Work/Tools/PDF%20Tools/src/pages/SettingsPage.jsx:332)
- **Suggested change:** State that re-enabling applies to future activity, and clarify whether manual re-add is available.

### 3. Feedback honeypot is collected but never used to reject submissions
- **Severity:** Low
- **Evidence:** Code confirmed
- **Repro:** A bot fills the visually hidden `Company` field and submits either feedback form.
- **Expected:** Honeypot-filled submissions should be silently discarded or rejected before reaching GitHub/proxy.
- **Actual:** Both forms pass `company` into `submitFeedbackReport`; the payload forwards it, but submit logic has no branch that tests it. The Electron proxy handler likewise forwards payload without honeypot validation.
- **Consequence:** The anti-spam field provides no spam filtering and can give a false sense of protection while bot reports consume proxy/GitHub capacity.
- **Source:** [FeedbackSettings.jsx](/Users/udbhavp/Desktop/My%20Work/Tools/PDF%20Tools/src/components/FeedbackSettings.jsx:125), [BugReportDialog.jsx](/Users/udbhavp/Desktop/My%20Work/Tools/PDF%20Tools/src/components/BugReportDialog.jsx:67), [feedbackReporting.js](/Users/udbhavp/Desktop/My%20Work/Tools/PDF%20Tools/src/feedbackReporting.js:44), [feedbackReporting.js](/Users/udbhavp/Desktop/My%20Work/Tools/PDF%20Tools/src/feedbackReporting.js:75)
- **Suggested change:** Validate the honeypot before either delivery path and return a neutral success-shaped result for filled fields.

### 4. “Anonymous” reporting sends all optional context as plain report text
- **Severity:** Low (privacy clarity)
- **Evidence:** Code confirmed
- **Repro:** Settings → Bugs & Requests; enter optional expected behavior/steps and submit with “Reports are sent by PDF Dock” (no-account path).
- **Expected:** The privacy claim should distinguish user-entered context and make explicit that optional context is sent to the reporting service.
- **Actual:** `expected`, `steps`, and app context are concatenated into the issue body; the privacy copy says “We only include what you write and basic app details,” but no-account delivery sends the full body to a third-party worker and GitHub.
- **Consequence:** Users can disclose sensitive text without a clear destination-specific disclosure; “anonymous” may be read as private/local rather than account-independent public issue submission.
- **Source:** [feedbackReporting.js](/Users/udbhavp/Desktop/My%20Work/Tools/PDF%20Tools/src/feedbackReporting.js:50), [feedbackReporting.js](/Users/udbhavp/Desktop/My%20Work/Tools/PDF%20Tools/src/feedbackReporting.js:74), [FeedbackSettings.jsx](/Users/udbhavp/Desktop/My%20Work/Tools/PDF%20Tools/src/components/FeedbackSettings.jsx:131)
- **Suggested change:** Label the method “No GitHub account” and state that submitted text becomes a GitHub issue; link privacy guidance beside submit.

### 5. Update preference writes can overwrite concurrently changed preferences
- **Severity:** Low
- **Evidence:** Code confirmed
- **Repro:** Skip an offered version while another settings writer updates `settings.json` (for example, output folder selection).
- **Expected:** Independent preferences should persist independently without lost updates.
- **Actual:** Updater stores skip choice in its own `update-preferences.json` (so it does not conflict with output-folder JSON), but each skip replaces the full updater preference object. This becomes a lost-update bug as soon as another updater preference is added; currently skipVersion is the only field.
- **Consequence:** **Improvement, not a current user-facing bug:** future updater preferences can silently disappear when skip is saved.
- **Source:** [updateController.cjs](/Users/udbhavp/Desktop/My%20Work/Tools/PDF%20Tools/electron/updateController.cjs:19), [updateController.cjs](/Users/udbhavp/Desktop/My%20Work/Tools/PDF%20Tools/electron/updateController.cjs:65)
- **Suggested change:** Merge the updated key into the currently read preference object (and use atomic write if crash-safe persistence is desired).

### 6. Update check button reports “complete” while the controller is still checking
- **Severity:** Low
- **Evidence:** Code confirmed
- **Repro:** In General settings, click “Check for updates” and inspect the returned status while the network request is ongoing.
- **Expected:** Keep a checking state until the updater emits a terminal outcome.
- **Actual:** The button awaits `onCheckUpdates`; `check()` awaits `checkForUpdates()`, which may resolve before updater events settle. The caller then maps any nonterminal status such as `checking` to “Update check complete.”
- **Consequence:** The status line can claim completion prematurely and leave the user unsure whether a result is forthcoming.
- **Source:** [SettingsPage.jsx](/Users/udbhavp/Desktop/My%20Work/Tools/PDF%20Tools/src/pages/SettingsPage.jsx:277), [updateController.cjs](/Users/udbhavp/Desktop/My%20Work/Tools/PDF%20Tools/electron/updateController.cjs:46)
- **Suggested change:** Resolve check only on `update-available`, `update-not-available`, or error, or retain “Checking…” for nonterminal states and update from subscribed state events.

### 7. App feedback action can report success without opening a fallback URL
- **Severity:** Low
- **Evidence:** Code confirmed
- **Repro:** Submit successfully from BugReportDialog, then click “Open GitHub issue” in a renderer where `pdfKing.openExternal` exists but rejects or resolves `false`.
- **Expected:** Surface the failure or fall back to a browser URL.
- **Actual:** The conditional only falls back when `openExternal` is absent. If present, its promise is returned from the click handler without error UI/catch; a `false` result is ignored.
- **Consequence:** The user can click the confirmation action and get no issue page and no explanation.
- **Source:** [BugReportDialog.jsx](/Users/udbhavp/Desktop/My%20Work/Tools/PDF%20Tools/src/components/BugReportDialog.jsx:57)
- **Suggested change:** Await result, handle false/rejection visibly, and offer a copyable issue URL.

## Runtime probe

- Attempted fresh incognito preview at `http://127.0.0.1:5174` per task instructions. The tool opened `chrome-error://chromewebdata/`; therefore actual settings controls and updater UI were not exercised. This is a tool/app availability limitation, not counted as an app defect.
- Report count: 7 distinct findings/improvements. The update-preference note is explicitly a future-proofing improvement, not a current defect.
