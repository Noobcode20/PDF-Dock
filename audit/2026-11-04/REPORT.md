# PDF Dock adversarial audit — 40 reviewed findings

Completed: 2026-11-05. Audit started 2026-11-04. This is the consolidated, reviewed report; the earlier scoped reports are raw inputs and include rejected leads.

**27 defects and 13 concrete feature/usability improvements.** Six defects were reproduced through the UI, four through focused engine probes, and 17 are confirmed from reachable source paths without a full UI reproduction. Improvements describe current limitations, not promises the app necessarily makes.

## Scope and evidence

- Multiple GPT-6 Luna audits ran concurrently through the **Codex provider (`providerInstanceId: codex`)**, not Jovin. The supervisor traced call chains, rejected false positives, and performed additional runtime probes.
- Runtime UI checks used an empty incognito profile and disposable generated PDFs. Browser DOM/control interactions, rather than injected React state, were used to reproduce UI failures. Engine probes are separately labeled.
- The shared checkout was changing during the audit. UI checks therefore used the copied source under `supervisor/runtime`, captured on November 4; `supervisor/source-manifest.json` records its hashes. Source references below were rechecked against the November 5 working tree. The tested snapshot is retained as `supervisor/tested-source.tar.gz`.
- Native installed-app behavior, real GitHub authorization, CLI installation, and every conversion/output permutation were not exercised. Source-confirmed items must not be described as end-to-end runtime failures.
- The audit did not implement fixes. Existing application edits were preserved; audit fixtures, scripts and reports are under this directory.

## Reproduction evidence

- [Engine probe script](supervisor/probe.mjs) and [results](supervisor/probe-results.json): identical tracked PDF streams, missing style undo steps, off-page field creation, and tracking-independent layout widths.
- [UI observations](supervisor/ui-observations.json): font import, form-management crash, Tab handling, custom select, sidebar focus and library range selection.
- [Form crash screenshot](supervisor/form-management-crash.png). Disposable fixtures: [form suggestions](supervisor/FormSuggestions.pdf), [Alpha](supervisor/Alpha.pdf), [Beta](supervisor/Beta.pdf), [Gamma](supervisor/Gamma.pdf).

## Findings

### 01. Adding a valid local font fails with a Promise-cloning error

**High · Defect · UI reproduced**

**Reproduce:** Settings → General → Add font; choose public/fonts/NotoSans-Regular.ttf.

**Actual:** The UI reports: Failed to execute 'put' on 'IDBObjectStore': #<Promise> could not be cloned. readFontFamilyName is async, but addLocalFont passes its unawaited result as the stored name.

**Expected:** A supported TTF should appear in the font library and be usable in text editing. **Impact:** The advertised font-import feature fails before a font can be stored.

**Suggested fix:** Await readFontFamilyName before constructing the record; close/abort the font transaction on synchronous action failures.

**Source:** [src/pages/SettingsPage.jsx:151](</Users/udbhavp/Desktop/My Work/Tools/PDF Tools/src/pages/SettingsPage.jsx:151>); [src/editor/localFonts.js:31](</Users/udbhavp/Desktop/My Work/Tools/PDF Tools/src/editor/localFonts.js:31>)

### 02. Manage fields crashes after accepting detected fields

**High · Defect · UI reproduced**

**Reproduce:** Open supervisor/FormSuggestions.pdf → Form → Detect fields on this page → accept Name and Phone → Manage fields.

**Actual:** The error boundary replaces the app with “Cannot read properties of null (reading 'x')”. Detection and acceptance produce objects without key. RegionLayer compares preview?.key to item.key; both are undefined, so it picks null preview as the rectangle and reads r.x. Updates/deletions also identify annotations by key.

**Expected:** Accepted fields should remain visible and independently editable. **Impact:** A normal form-building workflow crashes the workspace and requires a reload.

**Suggested fix:** Assign a stable unique key when accepting each candidate and require preview to exist before comparing keys.

**Source:** [src/pages/ToolStudioPage.jsx:1690](</Users/udbhavp/Desktop/My Work/Tools/PDF Tools/src/pages/ToolStudioPage.jsx:1690>); [src/editor/RegionLayer.jsx:29](</Users/udbhavp/Desktop/My Work/Tools/PDF Tools/src/editor/RegionLayer.jsx:29>); [src/editor/formDetection.js:27](</Users/udbhavp/Desktop/My Work/Tools/PDF Tools/src/editor/formDetection.js:27>)

### 03. Character tracking is not written within PDF text runs

**Medium · Defect · Engine reproduced**

**Reproduce:** Add a text box containing ABCD, set Tracking to 5 pt, save; compare with tracking 0.

**Actual:** The engine probe generated identical page content streams for tracking 0 and 5, with no Tc operator. applyOperations passes characterSpacing to pdf-lib page.drawText, but the installed drawText implementation does not consume that option. Cursor offsets between separate runs do not add tracking within a word.

**Expected:** Saved glyph spacing should match the editor preview. **Impact:** Text can look correct during editing and lose its tracking in the saved PDF.

**Suggested fix:** Emit PDF character-spacing operators around the text run, or position glyphs using a supported drawing path.

**Source:** [src/editor/operations.js:195](</Users/udbhavp/Desktop/My Work/Tools/PDF Tools/src/editor/operations.js:195>); [node_modules/pdf-lib/cjs/api/PDFPage.js:832](</Users/udbhavp/Desktop/My Work/Tools/PDF Tools/node_modules/pdf-lib/cjs/api/PDFPage.js:832>)

### 04. Text wrapping and alignment measure width without tracking

**Medium · Defect · Engine reproduced**

**Reproduce:** Use a narrow text box and increase tracking enough that a line should wrap; also try centered text.

**Actual:** layoutStyledText measures only font.widthOfTextAtSize. The probe returned the same 58.92-point width and one-line layout for AA AA at tracking 0 and 10 in a 75-point box. Four 10-point character gaps would make the latter exceed the box. Alignment and overflow checks consume these unadjusted widths.

**Expected:** Wrapping, alignment and overflow checks should include the requested character gaps. **Impact:** Lines wrap at the wrong positions and centered/right-aligned text is positioned using the wrong width. This remains a separate layout defect after fixing the writer in finding 3.

**Suggested fix:** Include signed tracking in token, chunk and line widths, and account for gaps across run boundaries.

**Source:** [src/editor/styledText.js:18](</Users/udbhavp/Desktop/My Work/Tools/PDF Tools/src/editor/styledText.js:18>); [src/editor/operations.js:182](</Users/udbhavp/Desktop/My Work/Tools/PDF Tools/src/editor/operations.js:182>)

### 05. Opacity and line-height changes do not create text undo steps

**Medium · Defect · Engine reproduced**

**Reproduce:** While editing text, change only opacity or line height, then try Undo.

**Actual:** recordTextInput compares a signature that omits opacity and lineHeightScale. The probe changed both values and produced zero past entries while replacing present with the new style.

**Expected:** Each committed user-visible formatting change should be undoable. **Impact:** The change cannot be undone by the active text history; a later undo can skip it.

**Suggested fix:** Include all editable formatting state in the history comparison, while still excluding transient selection metadata.

**Source:** [src/editor/textInputHistory.js:1](</Users/udbhavp/Desktop/My Work/Tools/PDF Tools/src/editor/textInputHistory.js:1>); [src/editor/RichTextInput.jsx:48](</Users/udbhavp/Desktop/My Work/Tools/PDF Tools/src/editor/RichTextInput.jsx:48>)

### 06. Opacity applied to a text selection is stored but not rendered or exported

**Medium · Defect · Code confirmed**

**Reproduce:** Edit a paragraph, select some characters, and change Text opacity.

**Actual:** The inspector effect appends opacity to styleRanges for a nonempty selection. RichTextInput and renderStyledText do not apply range opacity; the PDF writer uses only operation.opacity, and font-run resolution drops range opacity.

**Expected:** Either apply opacity to the selected characters or explicitly apply it to the whole text box. **Impact:** An enabled control accepts a selection-level change that has no visible or saved effect.

**Suggested fix:** Render/export per-run opacity, or treat opacity as a box property before the range-style branch.

**Source:** [src/pages/ToolStudioPage.jsx:3308](</Users/udbhavp/Desktop/My Work/Tools/PDF Tools/src/pages/ToolStudioPage.jsx:3308>); [src/pages/ToolStudioPage.jsx:3198](</Users/udbhavp/Desktop/My Work/Tools/PDF Tools/src/pages/ToolStudioPage.jsx:3198>); [src/editor/operations.js:194](</Users/udbhavp/Desktop/My Work/Tools/PDF Tools/src/editor/operations.js:194>)

### 07. 100% and 115% line-height choices are overridden by a 120% minimum

**Medium · Defect · Code confirmed**

**Reproduce:** Choose 100% or 115% line height before placing a new multiline text box, then type into it and let the input remeasure.

**Actual:** TextInspector offers those choices, but fitTextInput raises the box lineHeightScale to at least maxFontScale * 1.2 whenever it measures a non-source-layout edit.

**Expected:** The selected supported line height should persist and govern the text layout. **Impact:** Compact line spacing cannot be achieved despite the controls offering it.

**Suggested fix:** Separate minimum box height from requested line spacing; preserve the explicit line-height setting.

**Source:** [src/components/TextInspector.jsx:17](</Users/udbhavp/Desktop/My Work/Tools/PDF Tools/src/components/TextInspector.jsx:17>); [src/pages/ToolStudioPage.jsx:3271](</Users/udbhavp/Desktop/My Work/Tools/PDF Tools/src/pages/ToolStudioPage.jsx:3271>)

### 08. Placing a very tall or very wide image can distort its aspect ratio

**Medium · Defect · Code confirmed**

**Reproduce:** Add a tall image, such as 100 × 10000 pixels, to an upright PDF page; compare its proportions to the source.

**Actual:** placeImageFile fixes width at 0.4 of the page and separately clamps height to 0.02–0.95. When the calculated height hits either limit, width is not recomputed even though aspectLocked is true. The resulting rectangle has a different source aspect.

**Expected:** A new image should be scaled uniformly to fit both limits. **Impact:** Valid images are stretched on insertion, requiring manual correction.

**Suggested fix:** Calculate one uniform fit scale from both page dimensions, then derive both width and height.

**Source:** [src/pages/ToolStudioPage.jsx:1441](</Users/udbhavp/Desktop/My Work/Tools/PDF Tools/src/pages/ToolStudioPage.jsx:1441>); [src/pages/ToolStudioPage.jsx:1442](</Users/udbhavp/Desktop/My Work/Tools/PDF Tools/src/pages/ToolStudioPage.jsx:1442>)

### 09. Uploading the same signature file cannot reliably retry a failed attempt

**Low · Defect · Code confirmed**

**Reproduce:** Upload an invalid signature image, repair/replace that file externally, then choose the same path again.

**Actual:** SignaturePanel does not clear the file input value after reading it, unlike ImageInspector. Reselecting the same path can produce no change event; its decode-error state is also never cleared on a later successful upload.

**Expected:** Same-file retry should run decoding again and remove stale error messages on success. **Impact:** The signature flow can appear unresponsive or keep showing an error after recovery.

**Suggested fix:** Capture the File, reset the input value immediately, and clear the previous error before/successfully after decoding.

**Source:** [src/editor/SignaturePanel.jsx:90](</Users/udbhavp/Desktop/My Work/Tools/PDF Tools/src/editor/SignaturePanel.jsx:90>); [src/components/ImageInspector.jsx:98](</Users/udbhavp/Desktop/My Work/Tools/PDF Tools/src/components/ImageInspector.jsx:98>)

### 10. Invalid suggested field names are accepted and fail only during save/apply

**Medium · Defect · Code confirmed**

**Reproduce:** Detect fields, clear a candidate name or give two candidates the same name, accept them, then Apply/Save.

**Actual:** Acceptance removes the suggestion from the review panel and adds an operation without validating the name. The engine rejects empty/dotted names and collisions only when materializing all edits.

**Expected:** Reject the bad name before acceptance and retain the candidate for correction. **Impact:** A late form error blocks the whole pending operation set after the user has done additional work. The candidate-key crash is a separate defect in finding 2.

**Suggested fix:** Validate nonempty unique names against existing fields and pending creates at acceptance, with an inline error.

**Source:** [src/editor/FormCandidatesPanel.jsx:12](</Users/udbhavp/Desktop/My Work/Tools/PDF Tools/src/editor/FormCandidatesPanel.jsx:12>); [src/pages/ToolStudioPage.jsx:1690](</Users/udbhavp/Desktop/My Work/Tools/PDF Tools/src/pages/ToolStudioPage.jsx:1690>); [src/editor/operations.js:368](</Users/udbhavp/Desktop/My Work/Tools/PDF Tools/src/editor/operations.js:368>)

### 11. Suggested fields can be accepted partly or entirely outside the page

**Medium · Defect · Engine reproduced**

**Reproduce:** Set a detected field to x=90% and width=30%, accept it, and apply. Negative coordinates can also be typed.

**Actual:** The controlled inputs do not enforce their advisory min/max. displayRect requires finite coordinates and positive dimensions but not containment. The engine probe successfully created a widget whose right edge is about 735 points on a 612-point page.

**Expected:** Reject or clamp the complete rectangle to the visible page. **Impact:** Created fields can be clipped or inaccessible in the output PDF.

**Suggested fix:** Validate x/y, dimensions and x+width/y+height at acceptance and at the operation boundary.

**Source:** [src/editor/FormCandidatesPanel.jsx:31](</Users/udbhavp/Desktop/My Work/Tools/PDF Tools/src/editor/FormCandidatesPanel.jsx:31>); [src/editor/coordinates.js:32](</Users/udbhavp/Desktop/My Work/Tools/PDF Tools/src/editor/coordinates.js:32>); [src/editor/operations.js:366](</Users/udbhavp/Desktop/My Work/Tools/PDF Tools/src/editor/operations.js:366>)

### 12. Single-document tools accept multiple inputs and silently process only the first

**Medium · Defect · Code confirmed**

**Reproduce:** Select several PDFs on Home and choose Compress N PDFs, or add multiple inputs to a conversion tool, then run it.

**Actual:** The picker/addFiles path permits multiple inputs for almost every tool; processKnown assigns file = files[0] and most nonaggregate branches use only that file. Home explicitly advertises Compress N PDFs for the selection.

**Expected:** Process every advertised input, or constrain the picker and wording to one input. **Impact:** Users can mistake one converted/compressed document for a completed batch.

**Suggested fix:** Define input cardinality per tool and either loop over inputs with per-file results or reject extra files visibly.

**Source:** [src/pages/ToolStudioPage.jsx:62](</Users/udbhavp/Desktop/My Work/Tools/PDF Tools/src/pages/ToolStudioPage.jsx:62>); [src/pages/ToolStudioPage.jsx:414](</Users/udbhavp/Desktop/My Work/Tools/PDF Tools/src/pages/ToolStudioPage.jsx:414>); [src/pdfEngine.js:969](</Users/udbhavp/Desktop/My Work/Tools/PDF Tools/src/pdfEngine.js:969>); [src/pages/HomePage.jsx:156](</Users/udbhavp/Desktop/My Work/Tools/PDF Tools/src/pages/HomePage.jsx:156>)

### 13. Merge treats different PDFs with the same name and size as the same file

**Medium · Defect · Code confirmed**

**Reproduce:** Prepare two different PDFs with the same filename and byte length in different folders; add both to Merge.

**Actual:** Merge compares only name and size. Selecting a matching item removes the existing entry as a toggle instead of retaining the second document. Content and source path are not considered.

**Expected:** Distinct files should remain distinct; toggling a recent entry should use its stable identity. **Impact:** The merged result can omit an intended input without a clear duplicate warning.

**Suggested fix:** Use source/library identity or a content digest, and distinguish explicit selection toggles from new file imports.

**Source:** [src/pages/ToolStudioPage.jsx:415](</Users/udbhavp/Desktop/My Work/Tools/PDF Tools/src/pages/ToolStudioPage.jsx:415>); [src/pages/ToolStudioPage.jsx:419](</Users/udbhavp/Desktop/My Work/Tools/PDF Tools/src/pages/ToolStudioPage.jsx:419>)

### 14. Malformed bookmark lines are silently discarded when replacing an outline

**Medium · Defect · Code confirmed**

**Reproduce:** Enter “1: Introduction” and “2 Results” in Bookmarks, then apply to a multi-page PDF.

**Actual:** The UI parser maps unmatched lines to null and filters them out. Because one valid entry remains, the engine succeeds and replaces the existing outline with that partial list.

**Expected:** Report the malformed line and require correction before replacing the outline. **Impact:** A small formatting mistake can silently remove intended bookmarks from a successful output.

**Suggested fix:** Validate every nonempty line with a line-numbered error instead of filtering invalid entries.

**Source:** [src/pages/ToolStudioPage.jsx:523](</Users/udbhavp/Desktop/My Work/Tools/PDF Tools/src/pages/ToolStudioPage.jsx:523>); [src/pdfEngine.js:936](</Users/udbhavp/Desktop/My Work/Tools/PDF Tools/src/pdfEngine.js:936>)

### 15. The PowerPoint picker offers legacy PPT although the converter rejects it

**Low · Defect · Code confirmed**

**Reproduce:** Open PowerPoint to PDF and choose a .ppt file in the file picker.

**Actual:** inputAccept includes .ppt and its legacy MIME type, while the engine immediately rejects that format and requires PPTX.

**Expected:** The picker should offer supported formats, with legacy conversion guidance before selection. **Impact:** A format the app explicitly lets the user select cannot be converted.

**Suggested fix:** Remove legacy PPT from the accept filter or implement a supported conversion route.

**Source:** [src/pages/ToolStudioPage.jsx:53](</Users/udbhavp/Desktop/My Work/Tools/PDF Tools/src/pages/ToolStudioPage.jsx:53>); [src/pdfEngine.js:1465](</Users/udbhavp/Desktop/My Work/Tools/PDF Tools/src/pdfEngine.js:1465>)

### 16. The Save shortcut cannot find standalone tool output controls

**Medium · Defect · Code confirmed**

**Reproduce:** Run a standalone tool to produce an output, then press the configured Save document shortcut.

**Actual:** The main shortcut handler searches .output-row .browse-button. OutputSaveControls is rendered as a sibling of .output-row, so its Save file button is outside that selector. The other selector alternatives target editor controls, which are absent on the standalone result page.

**Expected:** The Save shortcut should invoke the output save action. **Impact:** The app prevents the shortcut default but performs no save.

**Suggested fix:** Call a shared imperative save action or select the actual .output-save-controls submit button.

**Source:** [src/main.jsx:988](</Users/udbhavp/Desktop/My Work/Tools/PDF Tools/src/main.jsx:988>); [src/pages/ToolStudioPage.jsx:765](</Users/udbhavp/Desktop/My Work/Tools/PDF Tools/src/pages/ToolStudioPage.jsx:765>); [src/components/OutputSaveControls.jsx:11](</Users/udbhavp/Desktop/My Work/Tools/PDF Tools/src/components/OutputSaveControls.jsx:11>)

### 17. Opening from Recent Files or the palette drops the library record identity

**Medium · Defect · Code confirmed**

**Reproduce:** Open a library-only PDF from Recent Files or Command palette, edit it and save to the library.

**Actual:** RecentFilesPage attaches sourcePath but not record.id as libraryId; CommandPalette attaches neither. Home/NewDocument do preserve libraryId. With sourcePath=null, changed bytes are hashed to a new record instead of updating the original library entry.

**Expected:** Every library open route should preserve the same record identity. **Impact:** The original entry can remain stale while an edited duplicate is created.

**Suggested fix:** Attach libraryId=record.id and sourcePath on both open routes and use a shared record-to-File helper.

**Source:** [src/pages/RecentFilesPage.jsx:71](</Users/udbhavp/Desktop/My Work/Tools/PDF Tools/src/pages/RecentFilesPage.jsx:71>); [src/components/CommandPalette.jsx:48](</Users/udbhavp/Desktop/My Work/Tools/PDF Tools/src/components/CommandPalette.jsx:48>); [src/editor/save.js:14](</Users/udbhavp/Desktop/My Work/Tools/PDF Tools/src/editor/save.js:14>)

### 18. Files explicitly saved only in the app can be silently evicted as cache

**High · Defect · Code confirmed**

**Reproduce:** Choose PDF Dock library as the only output destination, then accumulate more than 50 library records or exceed its total-byte limit.

**Actual:** Explicit app saves use the recent-file backend. Both backends trim to 50 entries and delete older cached bytes; there is no distinction between disposable recent copies and the sole explicitly saved copy.

**Expected:** An explicit save destination should retain the document or warn/block before deleting it. **Impact:** A user relying on “save in app” can lose the only stored copy without having requested deletion.

**Suggested fix:** Separate durable library storage from recent-cache retention, or pin explicit saves and require an eviction decision.

**Source:** [src/outputStorage.js:23](</Users/udbhavp/Desktop/My Work/Tools/PDF Tools/src/outputStorage.js:23>); [src/recentFiles.js:107](</Users/udbhavp/Desktop/My Work/Tools/PDF Tools/src/recentFiles.js:107>); [electron/main.cjs:470](</Users/udbhavp/Desktop/My Work/Tools/PDF Tools/electron/main.cjs:470>)

### 19. Turning off recent copies immediately deletes the existing app library

**High · Defect · Code confirmed**

**Reproduce:** Save a PDF only to PDF Dock library, then turn off Keep local recent PDF copies in Settings.

**Actual:** The checkbox writes the preference and immediately calls handleClearCache, deleting all records and cached PDFs. Its explanatory text describes storing opened/exported PDFs, not deleting the existing library; there is no confirmation.

**Expected:** Disable future automatic retention separately from deleting existing explicitly saved documents. **Impact:** A preference toggle can destroy library-only documents unexpectedly.

**Suggested fix:** Do not clear durable records when the preference changes; make deletion a separately named, confirmed action.

**Source:** [src/pages/SettingsPage.jsx:332](</Users/udbhavp/Desktop/My Work/Tools/PDF Tools/src/pages/SettingsPage.jsx:332>); [electron/main.cjs:498](</Users/udbhavp/Desktop/My Work/Tools/PDF Tools/electron/main.cjs:498>); [src/recentFiles.js:196](</Users/udbhavp/Desktop/My Work/Tools/PDF Tools/src/recentFiles.js:196>)

### 20. Tab navigation is blocked outside text-entry controls

**High · Defect · UI reproduced**

**Reproduce:** On Home with an empty library, focus New document and press Tab. Also try Tab from non-input controls on other pages.

**Actual:** Focus stays on New document. The global handler prevents every unmodified Tab after the modal/editable guards; on Home it tries to focus the first file, and outside Home it has no replacement navigation.

**Expected:** Tab should advance through focusable controls unless a specific local widget intentionally handles it. **Impact:** Keyboard users can become stuck and cannot traverse normal app controls.

**Suggested fix:** Remove the unconditional global Tab interception and scope preview shortcuts to the focused library widget.

**Source:** [src/main.jsx:1018](</Users/udbhavp/Desktop/My Work/Tools/PDF Tools/src/main.jsx:1018>); [src/main.jsx:929](</Users/udbhavp/Desktop/My Work/Tools/PDF Tools/src/main.jsx:929>)

### 21. Tabbing out of a custom select leaves its popup open and jumps focus

**Medium · Defect · UI reproduced**

**Reproduce:** New document → open Page size → press Tab.

**Actual:** The listbox remains open with aria-expanded=true, but focus jumps to Close new document dialog. The menu is portaled outside the modal and the global trap treats its focused option as outside the dialog. The select has no Tab/blur dismissal path.

**Expected:** Tab should close the list and move logically to the next control, respecting the modal focus scope. **Impact:** Keyboard navigation skips the next form control and leaves a detached popup behind.

**Suggested fix:** Integrate portal menus with the dialog focus scope and close/commit appropriately on Tab and focus leaving the menu.

**Source:** [src/components/ThemedSelect.jsx:99](</Users/udbhavp/Desktop/My Work/Tools/PDF Tools/src/components/ThemedSelect.jsx:99>); [src/components/ThemedSelect.jsx:129](</Users/udbhavp/Desktop/My Work/Tools/PDF Tools/src/components/ThemedSelect.jsx:129>); [src/main.jsx:873](</Users/udbhavp/Desktop/My Work/Tools/PDF Tools/src/main.jsx:873>)

### 22. Collapsing the sidebar drops focus to the document body

**Low · Defect · UI reproduced**

**Reproduce:** Focus/activate Collapse sidebar and inspect the focused element after collapse.

**Actual:** The focused collapse button unmounts; document.activeElement becomes BODY. The replacement Expand sidebar button is a different DOM node and no focus handoff occurs.

**Expected:** Focus should move to the new expand control or remain on a persistent toggle. **Impact:** Keyboard users lose their place; the global Tab issue can compound recovery.

**Suggested fix:** Use one persistent toggle or explicitly focus its replacement after changing the layout.

**Source:** [src/components/Sidebar.jsx:114](</Users/udbhavp/Desktop/My Work/Tools/PDF Tools/src/components/Sidebar.jsx:114>); [src/components/Sidebar.jsx:119](</Users/udbhavp/Desktop/My Work/Tools/PDF Tools/src/components/Sidebar.jsx:119>)

### 23. Onboarding GitHub connection never displays the required device code

**High · Defect · Code confirmed**

**Reproduce:** During onboarding Setup, choose Connect GitHub; the browser opens GitHub device authorization.

**Actual:** The IPC response includes userCode, but Onboarding uses only verificationUri/sessionId and never renders or copies userCode. GitHub device authorization at the verification URI requires that code. The separate Settings flow does display it.

**Expected:** Show the code beside the authorization action, with copy and retry controls. **Impact:** The onboarding connection flow withholds the information needed to complete authorization.

**Suggested fix:** Reuse the Settings device-auth UI/state rather than maintaining a reduced onboarding-only loop.

**Source:** [src/components/Onboarding.jsx:144](</Users/udbhavp/Desktop/My Work/Tools/PDF Tools/src/components/Onboarding.jsx:144>); [electron/main.cjs:60](</Users/udbhavp/Desktop/My Work/Tools/PDF Tools/electron/main.cjs:60>); [src/components/FeedbackSettings.jsx:54](</Users/udbhavp/Desktop/My Work/Tools/PDF Tools/src/components/FeedbackSettings.jsx:54>)

### 24. The installed CLI launcher is not a working standalone CLI installation

**High · Defect · Code confirmed**

**Reproduce:** Select Install the command-line tools in onboarding, then invoke the generated launcher.

**Actual:** Installation copies only bin/pdf-dock.mjs to userData/cli and executes it with process.execPath, which is the Electron app executable. The script assumes a repository parent containing the app and a require('electron') value suitable for spawn. In that installed location the parent is userData; in an Electron main context require('electron') is the API object, not the npm binary path. No installed app-root/binary configuration is supplied.

**Expected:** The installed launcher should run the packaged app in CLI mode and resolve its resources correctly. **Impact:** The onboarding installation can report completion while the resulting command fails or starts the wrong entry path.

**Suggested fix:** Generate a launcher that invokes the packaged app with --pdf-dock-cli and an explicit request transport, or ship a supported Node entry with correct app/binary paths.

**Source:** [electron/main.cjs:20](</Users/udbhavp/Desktop/My Work/Tools/PDF Tools/electron/main.cjs:20>); [electron/main.cjs:27](</Users/udbhavp/Desktop/My Work/Tools/PDF Tools/electron/main.cjs:27>); [bin/pdf-dock.mjs:69](</Users/udbhavp/Desktop/My Work/Tools/PDF Tools/bin/pdf-dock.mjs:69>); [bin/pdf-dock.mjs:9](</Users/udbhavp/Desktop/My Work/Tools/PDF Tools/bin/pdf-dock.mjs:9>)

### 25. A failed optional CLI install leaves onboarding completion in an inconsistent state

**Medium · Defect · Code confirmed**

**Reproduce:** Finish onboarding with Install command-line tools checked when copying/writing the launcher or skill fails, for example because the destination is unwritable.

**Actual:** handleFinishOnboarding persists the completion marker before awaiting installCli; Onboarding.finish returns that promise with no error handling. A rejection prevents setShowOnboarding(false), surfaces no setupError, yet the next reload sees onboarding as completed.

**Expected:** Explain the failed optional step and allow retry or completion without it. **Impact:** The setup overlay can remain open with no useful error, then disappear on reload despite the failed installation.

**Suggested fix:** Catch the installation failure, show it in the setup panel, and only finalize the completion state after resolving the optional step.

**Source:** [src/main.jsx:912](</Users/udbhavp/Desktop/My Work/Tools/PDF Tools/src/main.jsx:912>); [src/main.jsx:913](</Users/udbhavp/Desktop/My Work/Tools/PDF Tools/src/main.jsx:913>); [src/components/Onboarding.jsx:19](</Users/udbhavp/Desktop/My Work/Tools/PDF Tools/src/components/Onboarding.jsx:19>)

### 26. Keyboard-only text selection has no highlight/underline/strike commit path

**Medium · Defect · Code confirmed**

**Reproduce:** Activate a text-markup tool and select text using keyboard selection instead of a pointer release.

**Actual:** AnnotationLayer creates markup only from pointerup on the page node. There is no keyboard activation or selection-confirm command for the markup tools.

**Expected:** Provide an accessible way to apply the selected markup to a keyboard-created text range. **Impact:** These annotation features cannot be completed through the keyboard-only path.

**Suggested fix:** Add an explicit Apply markup command/shortcut that consumes the current page-contained selection.

**Source:** [src/editor/AnnotationLayer.jsx:62](</Users/udbhavp/Desktop/My Work/Tools/PDF Tools/src/editor/AnnotationLayer.jsx:62>)

### 27. Form and annotation regions cannot be moved or resized from the keyboard

**Medium · Improvement · Improvement**

**Reproduce:** Tab to a RegionLayer field/annotation, press Enter to select it, then try to adjust its rectangle without a pointer.

**Actual:** The region is keyboard-focusable and Enter selects it, but movement and resize are implemented only by pointer gestures.

**Expected:** Offer arrow-key movement/resize or accessible numeric geometry controls. **Impact:** Keyboard and assistive-input users can select objects but cannot complete placement corrections.

**Suggested fix:** Add documented keyboard geometry actions, with modified arrows for resize/fine movement and an announced position.

**Source:** [src/editor/RegionLayer.jsx:32](</Users/udbhavp/Desktop/My Work/Tools/PDF Tools/src/editor/RegionLayer.jsx:32>)

### 28. Existing radio options require rebuilding the whole group to make corrections

**Low · Improvement · Improvement**

**Reproduce:** Create/apply a radio group, then use Manage fields to rename/remove one of its answer options.

**Actual:** The inspector explicitly fixes radio choices after creation; deleting a widget removes the entire field group. There is no widget/option edit flow.

**Expected:** Allow correcting one answer or provide a guided group rebuild that preserves placement and values. **Impact:** A small answer-label change can require recreating the entire group.

**Suggested fix:** Support option/widget updates or a clear rebuild operation that retains the existing geometry.

**Source:** [src/pages/ToolStudioPage.jsx:1664](</Users/udbhavp/Desktop/My Work/Tools/PDF Tools/src/pages/ToolStudioPage.jsx:1664>); [src/editor/operations.js:348](</Users/udbhavp/Desktop/My Work/Tools/PDF Tools/src/editor/operations.js:348>)

### 29. Shortening a Shift-selected file range keeps the old range selected

**Medium · Defect · UI reproduced**

**Reproduce:** With Gamma, Beta, Alpha rows: click Gamma, Shift-click Alpha, then Shift-click Beta to shorten the range.

**Actual:** All three checkboxes remain checked, including Alpha. selectFileRange unions each range into the existing Set instead of replacing the previous range.

**Expected:** A shortened Shift range should contain Gamma and Beta, preserving only separately intentional additive selections. **Impact:** Bulk processing/removal can include files the user tried to deselect.

**Suggested fix:** Track the anchor and the pre-range selection separately, then replace the active range on each Shift action.

**Source:** [src/pages/HomePage.jsx:280](</Users/udbhavp/Desktop/My Work/Tools/PDF Tools/src/pages/HomePage.jsx:280>)

### 30. Filtering should make hidden selected-file targets explicit before bulk actions

**Medium · Improvement · Improvement; UI behavior observed**

**Reproduce:** Select three library files, then filter to Beta so only one row remains.

**Actual:** The UI continues offering Merge 3 PDFs, Compress 3 PDFs and Remove 3 files. It does show the count, but the two hidden target names are not visible in the filtered list.

**Expected:** Retain selection only with a clear reveal/list of all action targets, or offer to limit the action to visible files. **Impact:** A bulk action can affect hidden files without a name-level review. The count reduces ambiguity but does not identify the targets.

**Suggested fix:** Add “Show selected”, list target filenames in confirmation, and offer clear-hidden-selection.

**Source:** [src/pages/HomePage.jsx:253](</Users/udbhavp/Desktop/My Work/Tools/PDF Tools/src/pages/HomePage.jsx:253>); [src/pages/HomePage.jsx:399](</Users/udbhavp/Desktop/My Work/Tools/PDF Tools/src/pages/HomePage.jsx:399>)

### 31. The library exposes metadata columns without a way to sort them

**Low · Improvement · Improvement**

**Reproduce:** Accumulate files and try to sort by filename, file size, page count or last opened.

**Actual:** Home filters by name and presents static column headers; it has no user-selectable sort state or controls.

**Expected:** Offer stable ascending/descending sort controls for the displayed metadata. **Impact:** Finding a document in a larger library requires manual scanning or knowing its filename.

**Suggested fix:** Add accessible sortable header buttons and persist the selected ordering.

**Source:** [src/pages/HomePage.jsx:253](</Users/udbhavp/Desktop/My Work/Tools/PDF Tools/src/pages/HomePage.jsx:253>); [src/pages/HomePage.jsx:622](</Users/udbhavp/Desktop/My Work/Tools/PDF Tools/src/pages/HomePage.jsx:622>)

### 32. Text size cannot be entered freely

**Low · Improvement · Improvement**

**Reproduce:** Add text and try to set a new size such as 13, 15 or 22 points.

**Actual:** TextInspector uses a noneditable ThemedSelect containing eight presets plus the current size. The floating ribbon uses the same preset approach.

**Expected:** Allow a numeric size to match the document while keeping useful presets. **Impact:** Users cannot choose common intermediate sizes unless a selected source object already contributes that exact size.

**Suggested fix:** Use an editable numeric combobox with finite/range validation.

**Source:** [src/components/TextInspector.jsx:8](</Users/udbhavp/Desktop/My Work/Tools/PDF Tools/src/components/TextInspector.jsx:8>); [src/pages/ToolStudioPage.jsx:3726](</Users/udbhavp/Desktop/My Work/Tools/PDF Tools/src/pages/ToolStudioPage.jsx:3726>)

### 33. The font-weight control reduces all weights to Regular or Bold

**Low · Improvement · Improvement**

**Reproduce:** Work with a font family/source text that uses medium, semibold or heavy weights and open Weight.

**Actual:** The control represents only 400 and 700 through a boolean bold state, even for fonts that provide more weights.

**Expected:** Preserve the source weight and expose supported numeric/named weights when available. **Impact:** Matching existing typography or choosing semibold/medium is not possible through the inspector.

**Suggested fix:** Retain numeric weight metadata and populate the control from available font faces/axes.

**Source:** [src/components/TextInspector.jsx:13](</Users/udbhavp/Desktop/My Work/Tools/PDF Tools/src/components/TextInspector.jsx:13>)

### 34. Rich-text paste silently discards source formatting

**Low · Improvement · Improvement**

**Reproduce:** Copy bold/colored text from a formatted document and paste it into the PDF rich-text input.

**Actual:** The paste handler prevents the normal paste and inserts only text/plain. There is no keep-formatting choice or explanation.

**Expected:** Offer a clear paste policy or a choice between text-only and supported source formatting. **Impact:** Users must manually reconstruct formatting after a paste.

**Suggested fix:** Document text-only paste and/or parse supported clipboard HTML into text style ranges.

**Source:** [src/editor/RichTextInput.jsx:152](</Users/udbhavp/Desktop/My Work/Tools/PDF Tools/src/editor/RichTextInput.jsx:152>)

### 35. Blank documents have no custom page-size option

**Low · Improvement · Improvement**

**Reproduce:** New document → Page size; try creating an A5 page, square document or custom-size form.

**Actual:** The dialog offers only A4, Letter and Legal plus orientation and page count.

**Expected:** Allow custom dimensions with units, alongside presets. **Impact:** Small-format forms, labels and custom layouts require another tool or later manual cropping.

**Suggested fix:** Add a Custom preset with width/height and units, validated before creation.

**Source:** [src/pages/NewDocumentPage.jsx:225](</Users/udbhavp/Desktop/My Work/Tools/PDF Tools/src/pages/NewDocumentPage.jsx:225>)

### 36. PDF-to-image export has no page-range control

**Medium · Improvement · Improvement**

**Reproduce:** Open a large PDF in PDF to JPG/PNG and try exporting only page 2.

**Actual:** The options contain format, resolution and JPEG quality only; the engine loops from 1 through every page.

**Expected:** Offer selected pages/ranges and show the expected output count. **Impact:** Users must render and handle unwanted images, increasing time and memory for large PDFs.

**Suggested fix:** Reuse the existing page-range selector and pass the chosen sequence to the export loop.

**Source:** [src/pages/ToolStudioPage.jsx:1762](</Users/udbhavp/Desktop/My Work/Tools/PDF Tools/src/pages/ToolStudioPage.jsx:1762>); [src/pdfEngine.js:1102](</Users/udbhavp/Desktop/My Work/Tools/PDF Tools/src/pdfEngine.js:1102>)

### 37. Multi-output tools require saving each result separately

**Medium · Improvement · Improvement**

**Reproduce:** Export many pages as images or split every PDF page, then try to save all results in one action.

**Actual:** The results panel maps every output to its own OutputSaveControls. There is no Save all/archive action.

**Expected:** Offer one batch save, with ZIP download in the browser and a destination-folder option on desktop. **Impact:** A 100-page result can require 100 save interactions and filenames/destinations to manage individually.

**Suggested fix:** Add a batch destination/naming flow and preserve per-output retry status.

**Source:** [src/pages/ToolStudioPage.jsx:758](</Users/udbhavp/Desktop/My Work/Tools/PDF Tools/src/pages/ToolStudioPage.jsx:758>); [src/components/OutputSaveControls.jsx:28](</Users/udbhavp/Desktop/My Work/Tools/PDF Tools/src/components/OutputSaveControls.jsx:28>)

### 38. Watermark controls cannot change text size or placement

**Low · Improvement · Improvement**

**Reproduce:** Add a watermark and try placing small text in a corner or matching a specific font size.

**Actual:** The UI exposes text, target pages, opacity and three angles, but no size, position or alignment controls.

**Expected:** Allow placement and scale choices, ideally with a preview. **Impact:** Users cannot adapt the watermark to common header/footer and corner-label layouts.

**Suggested fix:** Expose size and position presets with optional numeric offsets and a visual preview.

**Source:** [src/pages/ToolStudioPage.jsx:1759](</Users/udbhavp/Desktop/My Work/Tools/PDF Tools/src/pages/ToolStudioPage.jsx:1759>)

### 39. Bookmark editing cannot load/preserve an existing hierarchical outline

**Medium · Improvement · Improvement**

**Reproduce:** Open a PDF with nested bookmarks and choose Bookmarks to adjust one title or destination.

**Actual:** The tool accepts a new flat page:title list and replaces the outline. It does not populate existing bookmarks or represent nesting.

**Expected:** Offer existing-outline editing, or an explicit replace-only workflow with import/export of the current outline. **Impact:** A small change requires reconstructing the outline and can flatten its hierarchy.

**Suggested fix:** Read the existing outline into an editable tree and preserve untouched nodes/destinations.

**Source:** [src/pages/ToolStudioPage.jsx:1774](</Users/udbhavp/Desktop/My Work/Tools/PDF Tools/src/pages/ToolStudioPage.jsx:1774>); [src/pdfEngine.js:949](</Users/udbhavp/Desktop/My Work/Tools/PDF Tools/src/pdfEngine.js:949>)

### 40. OCR language menus do not distinguish installed packs from unavailable ones

**Medium · Improvement · Improvement**

**Reproduce:** Choose Spanish, French, German, Italian, Portuguese or Hindi on a default installation with a scanned PDF.

**Actual:** The menus offer all seven languages, but public/ocr contains only eng.traineddata.gz and workers load from that local directory. The OCR note mentions manually supplied packs; there is no installed-status check or in-app installation flow, and Word/PPTX conversion uses the same choices.

**Expected:** Identify which languages are ready before processing and guide installation of missing packs. **Impact:** A permitted language choice can spend time initializing OCR and then fail for missing data.

**Suggested fix:** Detect available packs, mark/disable unavailable choices, and provide a language-pack installation or selection workflow.

**Source:** [src/pages/ToolStudioPage.jsx:1788](</Users/udbhavp/Desktop/My Work/Tools/PDF Tools/src/pages/ToolStudioPage.jsx:1788>); [src/pdfEngine.js:439](</Users/udbhavp/Desktop/My Work/Tools/PDF Tools/src/pdfEngine.js:439>); [public/ocr/eng.traineddata.gz](</Users/udbhavp/Desktop/My Work/Tools/PDF Tools/public/ocr/eng.traineddata.gz>)

## Rejected or corrected leads

- The Cancel button in the unsaved dialog uses its dismiss callback; the earlier claim that Cancel discards edits was false. Escape is deliberately mapped to Don’t Save, which may merit separate UX review but is not counted here.
- Form detection is wired to a UI button; an earlier dead-code assertion was false.
- Image zero-width input passes through resizeImage clamping; it does not follow the raw normalization path claimed in an early report.
- The drawn signature’s 110/400 ratio matches its actual canvas. Blank-padding/cropping is a possible enhancement, not proof of an incorrect aspect ratio.
- DOM Range offsets and JavaScript text lengths both use UTF-16 units; using those units alone is not proof of a caret bug.
- Negative tracking was not discarded by Math.max on the character count; the actual tracking writer and layout problems are findings 3–4.
- Per-input history does not by itself prove document history is lost; document history exists separately.
- Nested labels do provide implicit accessible names to their inputs; a report claiming all candidate coordinate inputs were unlabeled was rejected.
- The feedback honeypot is checked by github-issues-worker/src/index.mjs; absence of a renderer-only check is not proof that the no-account anti-spam feature is broken.
- Skipping a beta update is intended behavior. Hypothetical loss of future, nonexistent updater preferences was not counted.
- A few delegates claimed saved reports that were absent on disk. Those claims contributed no findings; the tally above is based on this reviewed report and actual source/probe evidence.

## Suggested order of repair

1. Prevent library-only data loss (18–19), the form crash (2), and keyboard traversal blockage (20).
2. Restore font import, saved-text fidelity/history, identity propagation and promised batch behavior (1, 3–7, 12, 16–17).
3. Repair form validation and onboarding/CLI workflows (10–11, 23–25).
4. Address remaining defects and prioritize the 13 improvements according to actual user demand.
