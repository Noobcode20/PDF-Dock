from pathlib import Path
import json,hashlib,datetime,shutil
ROOT=Path.cwd(); OUT=ROOT/'audit/2026-11-04'; S=OUT/'supervisor'
items=[]
def add(title,severity,status,repro,actual,expected,impact,fix,refs):
 items.append(dict(id=len(items)+1,title=title,severity=severity,status=status,kind='Improvement' if status.startswith('Improvement') else 'Defect',reproduction=repro,actual=actual,expected=expected,impact=impact,suggested_fix=fix,sources=refs))
add('Adding a valid local font fails with a Promise-cloning error','High','UI reproduced',
 'Settings → General → Add font; choose public/fonts/NotoSans-Regular.ttf.',
 'The UI reports: Failed to execute \'put\' on \'IDBObjectStore\': #<Promise> could not be cloned. readFontFamilyName is async, but addLocalFont passes its unawaited result as the stored name.',
 'A supported TTF should appear in the font library and be usable in text editing.',
 'The advertised font-import feature fails before a font can be stored.',
 'Await readFontFamilyName before constructing the record; close/abort the font transaction on synchronous action failures.',
 [('src/pages/SettingsPage.jsx','const name = readFontFamilyName'),('src/editor/localFonts.js','export async function readFontFamilyName')])
add('Manage fields crashes after accepting detected fields','High','UI reproduced',
 'Open supervisor/FormSuggestions.pdf → Form → Detect fields on this page → accept Name and Phone → Manage fields.',
 'The error boundary replaces the app with “Cannot read properties of null (reading \'x\')”. Detection and acceptance produce objects without key. RegionLayer compares preview?.key to item.key; both are undefined, so it picks null preview as the rectangle and reads r.x. Updates/deletions also identify annotations by key.',
 'Accepted fields should remain visible and independently editable.',
 'A normal form-building workflow crashes the workspace and requires a reload.',
 'Assign a stable unique key when accepting each candidate and require preview to exist before comparing keys.',
 [('src/pages/ToolStudioPage.jsx','<FormCandidatesPanel candidates='),('src/editor/RegionLayer.jsx','const r=preview?.key===item.key'),('src/editor/formDetection.js','candidates.push({')])
add('Character tracking is not written within PDF text runs','Medium','Engine reproduced',
 'Add a text box containing ABCD, set Tracking to 5 pt, save; compare with tracking 0.',
 'The engine probe generated identical page content streams for tracking 0 and 5, with no Tc operator. applyOperations passes characterSpacing to pdf-lib page.drawText, but the installed drawText implementation does not consume that option. Cursor offsets between separate runs do not add tracking within a word.',
 'Saved glyph spacing should match the editor preview.',
 'Text can look correct during editing and lose its tracking in the saved PDF.',
 'Emit PDF character-spacing operators around the text run, or position glyphs using a supported drawing path.',
 [('src/editor/operations.js','characterSpacing:'),('node_modules/pdf-lib/cjs/api/PDFPage.js','PDFPage.prototype.drawText = function')])
add('Text wrapping and alignment measure width without tracking','Medium','Engine reproduced',
 'Use a narrow text box and increase tracking enough that a line should wrap; also try centered text.',
 'layoutStyledText measures only font.widthOfTextAtSize. The probe returned the same 58.92-point width and one-line layout for AA AA at tracking 0 and 10 in a 75-point box. Four 10-point character gaps would make the latter exceed the box. Alignment and overflow checks consume these unadjusted widths.',
 'Wrapping, alignment and overflow checks should include the requested character gaps.',
 'Lines wrap at the wrong positions and centered/right-aligned text is positioned using the wrong width. This remains a separate layout defect after fixing the writer in finding 3.',
 'Include signed tracking in token, chunk and line widths, and account for gaps across run boundaries.',
 [('src/editor/styledText.js','const tokenWidth ='),('src/editor/operations.js','available - line.width')])
add('Opacity and line-height changes do not create text undo steps','Medium','Engine reproduced',
 'While editing text, change only opacity or line height, then try Undo.',
 'recordTextInput compares a signature that omits opacity and lineHeightScale. The probe changed both values and produced zero past entries while replacing present with the new style.',
 'Each committed user-visible formatting change should be undoable.',
 'The change cannot be undone by the active text history; a later undo can skip it.',
 'Include all editable formatting state in the history comparison, while still excluding transient selection metadata.',
 [('src/editor/textInputHistory.js','const signature ='),('src/editor/RichTextInput.jsx','recordTextInput(history.current, edit)')])
add('Opacity applied to a text selection is stored but not rendered or exported','Medium','Code confirmed',
 'Edit a paragraph, select some characters, and change Text opacity.',
 'The inspector effect appends opacity to styleRanges for a nonempty selection. RichTextInput and renderStyledText do not apply range opacity; the PDF writer uses only operation.opacity, and font-run resolution drops range opacity.',
 'Either apply opacity to the selected characters or explicitly apply it to the whole text box.',
 'An enabled control accepts a selection-level change that has no visible or saved effect.',
 'Render/export per-run opacity, or treat opacity as a box property before the range-style branch.',
 [('src/pages/ToolStudioPage.jsx','if (end > start) return'),('src/pages/ToolStudioPage.jsx','function renderStyledText('),('src/editor/operations.js','Number(operation.opacity ?? 1)')])
add('100% and 115% line-height choices are overridden by a 120% minimum','Medium','Code confirmed',
 'Choose 100% or 115% line height before placing a new multiline text box, then type into it and let the input remeasure.',
 'TextInspector offers those choices, but fitTextInput raises the box lineHeightScale to at least maxFontScale * 1.2 whenever it measures a non-source-layout edit.',
 'The selected supported line height should persist and govern the text layout.',
 'Compact line spacing cannot be achieved despite the controls offering it.',
 'Separate minimum box height from requested line spacing; preserve the explicit line-height setting.',
 [('src/components/TextInspector.jsx',"span>Line height"),('src/pages/ToolStudioPage.jsx','Math.max(current.lineHeightScale || 0, maxFontScale * 1.2)')])
add('Placing a very tall or very wide image can distort its aspect ratio','Medium','Code confirmed',
 'Add a tall image, such as 100 × 10000 pixels, to an upright PDF page; compare its proportions to the source.',
 'placeImageFile fixes width at 0.4 of the page and separately clamps height to 0.02–0.95. When the calculated height hits either limit, width is not recomputed even though aspectLocked is true. The resulting rectangle has a different source aspect.',
 'A new image should be scaled uniformly to fit both limits.',
 'Valid images are stretched on insertion, requiring manual correction.',
 'Calculate one uniform fit scale from both page dimensions, then derive both width and height.',
 [('src/pages/ToolStudioPage.jsx','const width = 0.4'),('src/pages/ToolStudioPage.jsx','const height = Math.max(0.02')])
add('Uploading the same signature file cannot reliably retry a failed attempt','Low','Code confirmed',
 'Upload an invalid signature image, repair/replace that file externally, then choose the same path again.',
 'SignaturePanel does not clear the file input value after reading it, unlike ImageInspector. Reselecting the same path can produce no change event; its decode-error state is also never cleared on a later successful upload.',
 'Same-file retry should run decoding again and remove stale error messages on success.',
 'The signature flow can appear unresponsive or keep showing an error after recovery.',
 'Capture the File, reset the input value immediately, and clear the previous error before/successfully after decoding.',
 [('src/editor/SignaturePanel.jsx','const file = e.target.files?.[0]'),('src/components/ImageInspector.jsx',"event.target.value = ''")])
add('Invalid suggested field names are accepted and fail only during save/apply','Medium','Code confirmed',
 'Detect fields, clear a candidate name or give two candidates the same name, accept them, then Apply/Save.',
 'Acceptance removes the suggestion from the review panel and adds an operation without validating the name. The engine rejects empty/dotted names and collisions only when materializing all edits.',
 'Reject the bad name before acceptance and retain the candidate for correction.',
 'A late form error blocks the whole pending operation set after the user has done additional work. The candidate-key crash is a separate defect in finding 2.',
 'Validate nonempty unique names against existing fields and pending creates at acceptance, with an inline error.',
 [('src/editor/FormCandidatesPanel.jsx','value={candidate.name}'),('src/pages/ToolStudioPage.jsx','<FormCandidatesPanel candidates='),('src/editor/operations.js',"if (!name || name.includes('.'))")])
add('Suggested fields can be accepted partly or entirely outside the page','Medium','Engine reproduced',
 'Set a detected field to x=90% and width=30%, accept it, and apply. Negative coordinates can also be typed.',
 'The controlled inputs do not enforce their advisory min/max. displayRect requires finite coordinates and positive dimensions but not containment. The engine probe successfully created a widget whose right edge is about 735 points on a 612-point page.',
 'Reject or clamp the complete rectangle to the visible page.',
 'Created fields can be clipped or inaccessible in the output PDF.',
 'Validate x/y, dimensions and x+width/y+height at acceptance and at the operation boundary.',
 [('src/editor/FormCandidatesPanel.jsx','Number(e.target.value) / 100'),('src/editor/coordinates.js','export function displayRect'),('src/editor/operations.js','if (type === "form-create")')])
add('Single-document tools accept multiple inputs and silently process only the first','Medium','Code confirmed',
 'Select several PDFs on Home and choose Compress N PDFs, or add multiple inputs to a conversion tool, then run it.',
 'The picker/addFiles path permits multiple inputs for almost every tool; processKnown assigns file = files[0] and most nonaggregate branches use only that file. Home explicitly advertises Compress N PDFs for the selection.',
 'Process every advertised input, or constrain the picker and wording to one input.',
 'Users can mistake one converted/compressed document for a completed batch.',
 'Define input cardinality per tool and either loop over inputs with per-file results or reject extra files visibly.',
 [('src/pages/ToolStudioPage.jsx',"const singleDocumentTools ="),('src/pages/ToolStudioPage.jsx','const multi = aggregateInputTools'),('src/pdfEngine.js','const file = files[0]'),('src/pages/HomePage.jsx','Compress {')])
add('Merge treats different PDFs with the same name and size as the same file','Medium','Code confirmed',
 'Prepare two different PDFs with the same filename and byte length in different folders; add both to Merge.',
 'Merge compares only name and size. Selecting a matching item removes the existing entry as a toggle instead of retaining the second document. Content and source path are not considered.',
 'Distinct files should remain distinct; toggling a recent entry should use its stable identity.',
 'The merged result can omit an intended input without a clear duplicate warning.',
 'Use source/library identity or a content digest, and distinguish explicit selection toggles from new file imports.',
 [('src/pages/ToolStudioPage.jsx','const sameFile ='),('src/pages/ToolStudioPage.jsx','if (existingIndex >= 0) return current.filter')])
add('Malformed bookmark lines are silently discarded when replacing an outline','Medium','Code confirmed',
 'Enter “1: Introduction” and “2 Results” in Bookmarks, then apply to a multi-page PDF.',
 'The UI parser maps unmatched lines to null and filters them out. Because one valid entry remains, the engine succeeds and replaces the existing outline with that partial list.',
 'Report the malformed line and require correction before replacing the outline.',
 'A small formatting mistake can silently remove intended bookmarks from a successful output.',
 'Validate every nonempty line with a line-numbered error instead of filtering invalid entries.',
 [('src/pages/ToolStudioPage.jsx',"toolId === 'edit-bookmarks' ?"),('src/pdfEngine.js','async function editBookmarks')])
add('The PowerPoint picker offers legacy PPT although the converter rejects it','Low','Code confirmed',
 'Open PowerPoint to PDF and choose a .ppt file in the file picker.',
 'inputAccept includes .ppt and its legacy MIME type, while the engine immediately rejects that format and requires PPTX.',
 'The picker should offer supported formats, with legacy conversion guidance before selection.',
 'A format the app explicitly lets the user select cannot be converted.',
 'Remove legacy PPT from the accept filter or implement a supported conversion route.',
 [('src/pages/ToolStudioPage.jsx',"if (toolId === 'powerpoint-to-pdf') return"),('src/pdfEngine.js',"if (/\\.ppt$/i.test")])
add('The Save shortcut cannot find standalone tool output controls','Medium','Code confirmed',
 'Run a standalone tool to produce an output, then press the configured Save document shortcut.',
 'The main shortcut handler searches .output-row .browse-button. OutputSaveControls is rendered as a sibling of .output-row, so its Save file button is outside that selector. The other selector alternatives target editor controls, which are absent on the standalone result page.',
 'The Save shortcut should invoke the output save action.',
 'The app prevents the shortcut default but performs no save.',
 'Call a shared imperative save action or select the actual .output-save-controls submit button.',
 [('src/main.jsx',".output-row .browse-button:not(:disabled)"),('src/pages/ToolStudioPage.jsx','<OutputSaveControls output='),('src/components/OutputSaveControls.jsx','className="output-save-controls"')])
add('Opening from Recent Files or the palette drops the library record identity','Medium','Code confirmed',
 'Open a library-only PDF from Recent Files or Command palette, edit it and save to the library.',
 'RecentFilesPage attaches sourcePath but not record.id as libraryId; CommandPalette attaches neither. Home/NewDocument do preserve libraryId. With sourcePath=null, changed bytes are hashed to a new record instead of updating the original library entry.',
 'Every library open route should preserve the same record identity.',
 'The original entry can remain stale while an edited duplicate is created.',
 'Attach libraryId=record.id and sourcePath on both open routes and use a shared record-to-File helper.',
 [('src/pages/RecentFilesPage.jsx','file.sourcePath=record.sourcePath'),('src/components/CommandPalette.jsx','files: [new File([data]'),('src/editor/save.js','let libraryId =')])
add('Files explicitly saved only in the app can be silently evicted as cache','High','Code confirmed',
 'Choose PDF Dock library as the only output destination, then accumulate more than 50 library records or exceed its total-byte limit.',
 'Explicit app saves use the recent-file backend. Both backends trim to 50 entries and delete older cached bytes; there is no distinction between disposable recent copies and the sole explicitly saved copy.',
 'An explicit save destination should retain the document or warn/block before deleting it.',
 'A user relying on “save in app” can lose the only stored copy without having requested deletion.',
 'Separate durable library storage from recent-cache retention, or pin explicit saves and require an eviction decision.',
 [('src/outputStorage.js','await library.addRecentFile'),('src/recentFiles.js','async function trimLibrary'),('electron/main.cjs','if (trimmed.length >= 50')])
add('Turning off recent copies immediately deletes the existing app library','High','Code confirmed',
 'Save a PDF only to PDF Dock library, then turn off Keep local recent PDF copies in Settings.',
 'The checkbox writes the preference and immediately calls handleClearCache, deleting all records and cached PDFs. Its explanatory text describes storing opened/exported PDFs, not deleting the existing library; there is no confirmation.',
 'Disable future automatic retention separately from deleting existing explicitly saved documents.',
 'A preference toggle can destroy library-only documents unexpectedly.',
 'Do not clear durable records when the preference changes; make deletion a separately named, confirmed action.',
 [('src/pages/SettingsPage.jsx',"if (!e.target.checked) handleClearCache()"),('electron/main.cjs',"ipcMain.handle('pdfking:clear-recent-files'"),('src/recentFiles.js','export async function clearRecentFiles')])
add('Tab navigation is blocked outside text-entry controls','High','UI reproduced',
 'On Home with an empty library, focus New document and press Tab. Also try Tab from non-input controls on other pages.',
 'Focus stays on New document. The global handler prevents every unmodified Tab after the modal/editable guards; on Home it tries to focus the first file, and outside Home it has no replacement navigation.',
 'Tab should advance through focusable controls unless a specific local widget intentionally handles it.',
 'Keyboard users can become stuck and cannot traverse normal app controls.',
 'Remove the unconditional global Tab interception and scope preview shortcuts to the focused library widget.',
 [('src/main.jsx',"if (e.key === 'Tab' && !e.metaKey"),('src/main.jsx',"const editing = target instanceof HTMLElement")])
add('Tabbing out of a custom select leaves its popup open and jumps focus','Medium','UI reproduced',
 'New document → open Page size → press Tab.',
 'The listbox remains open with aria-expanded=true, but focus jumps to Close new document dialog. The menu is portaled outside the modal and the global trap treats its focused option as outside the dialog. The select has no Tab/blur dismissal path.',
 'Tab should close the list and move logically to the next control, respecting the modal focus scope.',
 'Keyboard navigation skips the next form control and leaves a detached popup behind.',
 'Integrate portal menus with the dialog focus scope and close/commit appropriately on Tab and focus leaving the menu.',
 [('src/components/ThemedSelect.jsx','const onOptionKeyDown ='),('src/components/ThemedSelect.jsx','createPortal(<div'),('src/main.jsx','const trap = (event)')])
add('Collapsing the sidebar drops focus to the document body','Low','UI reproduced',
 'Focus/activate Collapse sidebar and inspect the focused element after collapse.',
 'The focused collapse button unmounts; document.activeElement becomes BODY. The replacement Expand sidebar button is a different DOM node and no focus handoff occurs.',
 'Focus should move to the new expand control or remain on a persistent toggle.',
 'Keyboard users lose their place; the global Tab issue can compound recovery.',
 'Use one persistent toggle or explicitly focus its replacement after changing the layout.',
 [('src/components/Sidebar.jsx','sidebar-expand-button'),('src/components/Sidebar.jsx','!isCollapsed && !phoneLayout')])
add('Onboarding GitHub connection never displays the required device code','High','Code confirmed',
 'During onboarding Setup, choose Connect GitHub; the browser opens GitHub device authorization.',
 'The IPC response includes userCode, but Onboarding uses only verificationUri/sessionId and never renders or copies userCode. GitHub device authorization at the verification URI requires that code. The separate Settings flow does display it.',
 'Show the code beside the authorization action, with copy and retry controls.',
 'The onboarding connection flow withholds the information needed to complete authorization.',
 'Reuse the Settings device-auth UI/state rather than maintaining a reduced onboarding-only loop.',
 [('src/components/Onboarding.jsx','const s = await window.pdfKing.githubStartDeviceAuth'),('electron/main.cjs','userCode: payload.user_code'),('src/components/FeedbackSettings.jsx','deviceCode.userCode')])
add('The installed CLI launcher is not a working standalone CLI installation','High','Code confirmed',
 'Select Install the command-line tools in onboarding, then invoke the generated launcher.',
 'Installation copies only bin/pdf-dock.mjs to userData/cli and executes it with process.execPath, which is the Electron app executable. The script assumes a repository parent containing the app and a require(\'electron\') value suitable for spawn. In that installed location the parent is userData; in an Electron main context require(\'electron\') is the API object, not the npm binary path. No installed app-root/binary configuration is supplied.',
 'The installed launcher should run the packaged app in CLI mode and resolve its resources correctly.',
 'The onboarding installation can report completion while the resulting command fails or starts the wrong entry path.',
 'Generate a launcher that invokes the packaged app with --pdf-dock-cli and an explicit request transport, or ship a supported Node entry with correct app/binary paths.',
 [('electron/main.cjs',"const cliTarget = path.join(root, 'pdf-dock.mjs')"),('electron/main.cjs','const content = process.platform'),('bin/pdf-dock.mjs',"const electron = require('electron')"),('bin/pdf-dock.mjs','const root = path.resolve')])
add('A failed optional CLI install leaves onboarding completion in an inconsistent state','Medium','Code confirmed',
 'Finish onboarding with Install command-line tools checked when copying/writing the launcher or skill fails, for example because the destination is unwritable.',
 'handleFinishOnboarding persists the completion marker before awaiting installCli; Onboarding.finish returns that promise with no error handling. A rejection prevents setShowOnboarding(false), surfaces no setupError, yet the next reload sees onboarding as completed.',
 'Explain the failed optional step and allow retry or completion without it.',
 'The setup overlay can remain open with no useful error, then disappear on reload despite the failed installation.',
 'Catch the installation failure, show it in the setup panel, and only finalize the completion state after resolving the optional step.',
 [('src/main.jsx',"window.localStorage.setItem('pdfking-onboarding-complete', 'true')"),('src/main.jsx','if (installCli) await'),('src/components/Onboarding.jsx','const finish =')])
add('Keyboard-only text selection has no highlight/underline/strike commit path','Medium','Code confirmed',
 'Activate a text-markup tool and select text using keyboard selection instead of a pointer release.',
 'AnnotationLayer creates markup only from pointerup on the page node. There is no keyboard activation or selection-confirm command for the markup tools.',
 'Provide an accessible way to apply the selected markup to a keyboard-created text range.',
 'These annotation features cannot be completed through the keyboard-only path.',
 'Add an explicit Apply markup command/shortcut that consumes the current page-contained selection.',
 [('src/editor/AnnotationLayer.jsx','node?.addEventListener("pointerup", select)')])
add('Form and annotation regions cannot be moved or resized from the keyboard','Medium','Improvement',
 'Tab to a RegionLayer field/annotation, press Enter to select it, then try to adjust its rectangle without a pointer.',
 'The region is keyboard-focusable and Enter selects it, but movement and resize are implemented only by pointer gestures.',
 'Offer arrow-key movement/resize or accessible numeric geometry controls.',
 'Keyboard and assistive-input users can select objects but cannot complete placement corrections.',
 'Add documented keyboard geometry actions, with modified arrows for resize/fine movement and an announced position.',
 [('src/editor/RegionLayer.jsx',"onKeyDown={e=>{if(e.key==='Enter')")])
add('Existing radio options require rebuilding the whole group to make corrections','Low','Improvement',
 'Create/apply a radio group, then use Manage fields to rename/remove one of its answer options.',
 'The inspector explicitly fixes radio choices after creation; deleting a widget removes the entire field group. There is no widget/option edit flow.',
 'Allow correcting one answer or provide a guided group rebuild that preserves placement and values.',
 'A small answer-label change can require recreating the entire group.',
 'Support option/widget updates or a clear rebuild operation that retains the existing geometry.',
 [('src/pages/ToolStudioPage.jsx','Radio choices are fixed after creation'),('src/editor/operations.js','form.removeField(field)')])
add('Shortening a Shift-selected file range keeps the old range selected','Medium','UI reproduced',
 'With Gamma, Beta, Alpha rows: click Gamma, Shift-click Alpha, then Shift-click Beta to shorten the range.',
 'All three checkboxes remain checked, including Alpha. selectFileRange unions each range into the existing Set instead of replacing the previous range.',
 'A shortened Shift range should contain Gamma and Beta, preserving only separately intentional additive selections.',
 'Bulk processing/removal can include files the user tried to deselect.',
 'Track the anchor and the pre-range selection separately, then replace the active range on each Shift action.',
 [('src/pages/HomePage.jsx','new Set([...current, ...rangeIds])')])
add('Filtering should make hidden selected-file targets explicit before bulk actions','Medium','Improvement; UI behavior observed',
 'Select three library files, then filter to Beta so only one row remains.',
 'The UI continues offering Merge 3 PDFs, Compress 3 PDFs and Remove 3 files. It does show the count, but the two hidden target names are not visible in the filtered list.',
 'Retain selection only with a clear reveal/list of all action targets, or offer to limit the action to visible files.',
 'A bulk action can affect hidden files without a name-level review. The count reduces ambiguity but does not identify the targets.',
 'Add “Show selected”, list target filenames in confirmation, and offer clear-hidden-selection.',
 [('src/pages/HomePage.jsx','const visibleFiles = files.filter'),('src/pages/HomePage.jsx','const selected = files.filter')])
add('The library exposes metadata columns without a way to sort them','Low','Improvement',
 'Accumulate files and try to sort by filename, file size, page count or last opened.',
 'Home filters by name and presents static column headers; it has no user-selectable sort state or controls.',
 'Offer stable ascending/descending sort controls for the displayed metadata.',
 'Finding a document in a larger library requires manual scanning or knowing its filename.',
 'Add accessible sortable header buttons and persist the selected ordering.',
 [('src/pages/HomePage.jsx','const visibleFiles = files.filter'),('src/pages/HomePage.jsx','Last opened')])
add('Text size cannot be entered freely','Low','Improvement',
 'Add text and try to set a new size such as 13, 15 or 22 points.',
 'TextInspector uses a noneditable ThemedSelect containing eight presets plus the current size. The floating ribbon uses the same preset approach.',
 'Allow a numeric size to match the document while keeping useful presets.',
 'Users cannot choose common intermediate sizes unless a selected source object already contributes that exact size.',
 'Use an editable numeric combobox with finite/range validation.',
 [('src/components/TextInspector.jsx','const sizes ='),('src/pages/ToolStudioPage.jsx','ariaLabel="Font size"')])
add('The font-weight control reduces all weights to Regular or Bold','Low','Improvement',
 'Work with a font family/source text that uses medium, semibold or heavy weights and open Weight.',
 'The control represents only 400 and 700 through a boolean bold state, even for fonts that provide more weights.',
 'Preserve the source weight and expose supported numeric/named weights when available.',
 'Matching existing typography or choosing semibold/medium is not possible through the inspector.',
 'Retain numeric weight metadata and populate the control from available font faces/axes.',
 [('src/components/TextInspector.jsx','ariaLabel="Font weight"')])
add('Rich-text paste silently discards source formatting','Low','Improvement',
 'Copy bold/colored text from a formatted document and paste it into the PDF rich-text input.',
 'The paste handler prevents the normal paste and inserts only text/plain. There is no keep-formatting choice or explanation.',
 'Offer a clear paste policy or a choice between text-only and supported source formatting.',
 'Users must manually reconstruct formatting after a paste.',
 'Document text-only paste and/or parse supported clipboard HTML into text style ranges.',
 [('src/editor/RichTextInput.jsx',"event.clipboardData.getData('text/plain')")])
add('Blank documents have no custom page-size option','Low','Improvement',
 'New document → Page size; try creating an A5 page, square document or custom-size form.',
 'The dialog offers only A4, Letter and Legal plus orientation and page count.',
 'Allow custom dimensions with units, alongside presets.',
 'Small-format forms, labels and custom layouts require another tool or later manual cropping.',
 'Add a Custom preset with width/height and units, validated before creation.',
 [('src/pages/NewDocumentPage.jsx',"value={pageSize}")])
add('PDF-to-image export has no page-range control','Medium','Improvement',
 'Open a large PDF in PDF to JPG/PNG and try exporting only page 2.',
 'The options contain format, resolution and JPEG quality only; the engine loops from 1 through every page.',
 'Offer selected pages/ranges and show the expected output count.',
 'Users must render and handle unwanted images, increasing time and memory for large PDFs.',
 'Reuse the existing page-range selector and pass the chosen sequence to the export loop.',
 [('src/pages/ToolStudioPage.jsx',"case 'pdf-to-jpg':"),('src/pdfEngine.js',"if (toolId === 'pdf-to-jpg')")])
add('Multi-output tools require saving each result separately','Medium','Improvement',
 'Export many pages as images or split every PDF page, then try to save all results in one action.',
 'The results panel maps every output to its own OutputSaveControls. There is no Save all/archive action.',
 'Offer one batch save, with ZIP download in the browser and a destination-folder option on desktop.',
 'A 100-page result can require 100 save interactions and filenames/destinations to manage individually.',
 'Add a batch destination/naming flow and preserve per-output retry status.',
 [('src/pages/ToolStudioPage.jsx','outputs.map((output, outputIndex)'),('src/components/OutputSaveControls.jsx','Save file')])
add('Watermark controls cannot change text size or placement','Low','Improvement',
 'Add a watermark and try placing small text in a corner or matching a specific font size.',
 'The UI exposes text, target pages, opacity and three angles, but no size, position or alignment controls.',
 'Allow placement and scale choices, ideally with a preview.',
 'Users cannot adapt the watermark to common header/footer and corner-label layouts.',
 'Expose size and position presets with optional numeric offsets and a visual preview.',
 [('src/pages/ToolStudioPage.jsx',"case 'add-watermark':")])
add('Bookmark editing cannot load/preserve an existing hierarchical outline','Medium','Improvement',
 'Open a PDF with nested bookmarks and choose Bookmarks to adjust one title or destination.',
 'The tool accepts a new flat page:title list and replaces the outline. It does not populate existing bookmarks or represent nesting.',
 'Offer existing-outline editing, or an explicit replace-only workflow with import/export of the current outline.',
 'A small change requires reconstructing the outline and can flatten its hierarchy.',
 'Read the existing outline into an editable tree and preserve untouched nodes/destinations.',
 [('src/pages/ToolStudioPage.jsx',"case 'edit-bookmarks':"),('src/pdfEngine.js','const root = context.obj({ Type: \'Outlines\'')])
add('OCR language menus do not distinguish installed packs from unavailable ones','Medium','Improvement',
 'Choose Spanish, French, German, Italian, Portuguese or Hindi on a default installation with a scanned PDF.',
 'The menus offer all seven languages, but public/ocr contains only eng.traineddata.gz and workers load from that local directory. The OCR note mentions manually supplied packs; there is no installed-status check or in-app installation flow, and Word/PPTX conversion uses the same choices.',
 'Identify which languages are ready before processing and guide installation of missing packs.',
 'A permitted language choice can spend time initializing OCR and then fail for missing data.',
 'Detect available packs, mark/disable unavailable choices, and provide a language-pack installation or selection workflow.',
 [('src/pages/ToolStudioPage.jsx','const OCR_LANGUAGES ='),('src/pdfEngine.js',"langPath:new URL('ocr/'"),('public/ocr/eng.traineddata.gz',None)])
assert len(items)==40
# Resolve line numbers from the owning current source; binary resource uses no line.
for item in items:
 resolved=[]
 for rel,needle in item['sources']:
  p=ROOT/rel; line=None
  if needle is not None:
   lines=p.read_text().splitlines(); line=next((i for i,s in enumerate(lines,1) if needle in s),None)
   if line is None: print('UNRESOLVED',item['id'],rel,needle)
  resolved.append({'path':rel,'line':line,'needle':needle})
 item['sources']=resolved
(OUT/'findings.json').write_text(json.dumps(items,indent=2))
counts={k:sum(x['status']==k for x in items) for k in ['UI reproduced','Engine reproduced','Code confirmed']}; counts['Improvements']=sum(x['kind']=='Improvement' for x in items)
lines=['# PDF Dock adversarial audit — 40 reviewed findings','',
'Completed: 2026-11-05. Audit started 2026-11-04. This is the consolidated, reviewed report; the earlier scoped reports are raw inputs and include rejected leads.','',
'**27 defects and 13 concrete feature/usability improvements.** Six defects were reproduced through the UI, four through focused engine probes, and 17 are confirmed from reachable source paths without a full UI reproduction. Improvements describe current limitations, not promises the app necessarily makes.','',
'## Scope and evidence','',
'- Multiple GPT-6 Luna audits ran concurrently through the **Codex provider (`providerInstanceId: codex`)**, not Jovin. The supervisor traced call chains, rejected false positives, and performed additional runtime probes.',
'- Runtime UI checks used an empty incognito profile and disposable generated PDFs. Browser DOM/control interactions, rather than injected React state, were used to reproduce UI failures. Engine probes are separately labeled.',
'- The shared checkout was changing during the audit. UI checks therefore used the copied source under `supervisor/runtime`, captured on November 4; `supervisor/source-manifest.json` records its hashes. Source references below were rechecked against the November 5 working tree. The tested snapshot is retained as `supervisor/tested-source.tar.gz`.',
'- Native installed-app behavior, real GitHub authorization, CLI installation, and every conversion/output permutation were not exercised. Source-confirmed items must not be described as end-to-end runtime failures.',
'- The audit did not implement fixes. Existing application edits were preserved; audit fixtures, scripts and reports are under this directory.',
'',
'## Reproduction evidence','',
'- [Engine probe script](supervisor/probe.mjs) and [results](supervisor/probe-results.json): identical tracked PDF streams, missing style undo steps, off-page field creation, and tracking-independent layout widths.',
'- [UI observations](supervisor/ui-observations.json): font import, form-management crash, Tab handling, custom select, sidebar focus and library range selection.',
'- [Form crash screenshot](supervisor/form-management-crash.png). Disposable fixtures: [form suggestions](supervisor/FormSuggestions.pdf), [Alpha](supervisor/Alpha.pdf), [Beta](supervisor/Beta.pdf), [Gamma](supervisor/Gamma.pdf).',
'',
'## Findings','']
for item in items:
 lines += [f"### {item['id']:02d}. {item['title']}",'',f"**{item['severity']} · {item['kind']} · {item['status']}**",'',f"**Reproduce:** {item['reproduction']}",'',f"**Actual:** {item['actual']}",'',f"**Expected:** {item['expected']} **Impact:** {item['impact']}",'',f"**Suggested fix:** {item['suggested_fix']}",'']
 refs=[]
 for r in item['sources']:
  label=r['path']+(f":{r['line']}" if r['line'] else '')
  target=str(ROOT/r['path'])+(f":{r['line']}" if r['line'] else '')
  refs.append(f'[{label}](<{target}>)')
 lines += ['**Source:** '+ '; '.join(refs), '']
lines += ['## Rejected or corrected leads','',
'- The Cancel button in the unsaved dialog uses its dismiss callback; the earlier claim that Cancel discards edits was false. Escape is deliberately mapped to Don’t Save, which may merit separate UX review but is not counted here.',
'- Form detection is wired to a UI button; an earlier dead-code assertion was false.',
'- Image zero-width input passes through resizeImage clamping; it does not follow the raw normalization path claimed in an early report.',
'- The drawn signature’s 110/400 ratio matches its actual canvas. Blank-padding/cropping is a possible enhancement, not proof of an incorrect aspect ratio.',
'- DOM Range offsets and JavaScript text lengths both use UTF-16 units; using those units alone is not proof of a caret bug.',
'- Negative tracking was not discarded by Math.max on the character count; the actual tracking writer and layout problems are findings 3–4.',
'- Per-input history does not by itself prove document history is lost; document history exists separately.',
'- Nested labels do provide implicit accessible names to their inputs; a report claiming all candidate coordinate inputs were unlabeled was rejected.',
'- The feedback honeypot is checked by github-issues-worker/src/index.mjs; absence of a renderer-only check is not proof that the no-account anti-spam feature is broken.',
'- Skipping a beta update is intended behavior. Hypothetical loss of future, nonexistent updater preferences was not counted.',
'- A few delegates claimed saved reports that were absent on disk. Those claims contributed no findings; the tally above is based on this reviewed report and actual source/probe evidence.',
'', '## Suggested order of repair','',
'1. Prevent library-only data loss (18–19), the form crash (2), and keyboard traversal blockage (20).',
'2. Restore font import, saved-text fidelity/history, identity propagation and promised batch behavior (1, 3–7, 12, 16–17).',
'3. Repair form validation and onboarding/CLI workflows (10–11, 23–25).',
'4. Address remaining defects and prioritize the 13 improvements according to actual user demand.','']
(OUT/'REPORT.md').write_text('\n'.join(lines))
print('Wrote',len(items),'findings:',counts)
