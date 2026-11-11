# Forms, pages, and save audit

Scope: source review of form suggestions/design/operations and editor organizer/save lifecycle. No app fixes made. Findings below are code-confirmed; no live browser reproduction was performed in this audit, so UI/runtime behavior is not claimed.

## Findings

### 1. Accepted suggestions can be saved with empty or duplicate field names

- **Severity:** High — code confirmed.
- **Repro:** In the live suggestions panel, clear a candidate's name or change two candidates to the same name, accept both, then Apply changes / Save.
- **Expected:** Reject invalid names before removing the suggestion or applying changes, with the candidate retained for correction.
- **Actual:** `FormCandidatesPanel` accepts any string; `onAccept` immediately commits the annotation and removes the candidate. The engine trims and rejects blank names and collisions only during commit. One bad item aborts materialization of the pending edit set.
- **Consequence:** User can lose the suggestion from its review list and encounter a late save/apply failure after doing more work.
- **Evidence:** `src/editor/FormCandidatesPanel.jsx:10-14,36-39`; `src/pages/ToolStudioPage.jsx:1678`; `src/editor/operations.js:366-371`.
- **Suggested change:** Validate the proposed name and collisions against existing fields and other pending creates before accepting; surface the error inline and retain the candidate.

### 2. Suggested coordinate controls do not constrain values and lack accessible names

- **Severity:** Medium — code confirmed.
- **Repro:** Edit a suggestion coordinate to a negative value or a value above 100%, or navigate the four controls with a screen reader.
- **Expected:** Keep each coordinate in range and identify each input accessibly (including its unit/meaning).
- **Actual:** `min`/`max` are advisory HTML attributes and no validation is applied; inputs are controlled and accept the numeric value. Each `<label>` contains only a terse coordinate token, and the inputs have no explicit accessible name association (`htmlFor`/`id` or `aria-label`).
- **Consequence:** Candidate geometry can be moved outside the page or made invalid; assistive technology may announce unlabeled inputs.
- **Evidence:** `src/editor/FormCandidatesPanel.jsx:21-33`; `src/pages/ToolStudioPage.jsx:1678`; `src/editor/coordinates.js:43-53` (positive-size validation only; no page-bound check).
- **Suggested change:** Add explicit field labels and enforce finite coordinates and `x/y >= 0`, positive dimensions, and `x+width,y+height <= 1` before acceptance.

### 3. Geometry validation does not keep fields within the visible page

- **Severity:** Medium — code confirmed.
- **Repro:** Set a suggestion's x to 90 and width to 30 in the review controls, accept, then apply.
- **Expected:** Clamp or reject the field because its right edge exceeds the page.
- **Actual:** The editor converts normalized values to PDF coordinates and checks only that dimensions are positive; it does not check that the rectangle fits within the page. The field widget can be partly or entirely off-page.
- **Consequence:** The created field may be difficult or impossible to see or interact with in the resulting PDF.
- **Evidence:** `src/editor/FormCandidatesPanel.jsx:21-33`; `src/editor/operations.js:366-381`; `src/editor/coordinates.js:43-53`.
- **Suggested change:** Validate full rectangle containment at acceptance and at the operation boundary, accounting for page rotation/crop frame.

### 4. “Dropdown” suggestion conversion creates a field with no options

- **Severity:** High — code confirmed.
- **Repro:** Detect an underline candidate, choose `Dropdown`, accept, and apply changes.
- **Expected:** A usable dropdown with editable choices or a clear prompt to define choices.
- **Actual:** The suggestion panel exposes no choices editor. The form-create path calls `addOptions` with default choices only when choices are explicitly absent; in practice the accepted candidate has no `choices`, so it gets generic `Option 1` and `Option 2` values that are not shown during suggestion review.
- **Consequence:** A form creator gets a dropdown whose values may be unrelated to the document's intended answers.
- **Evidence:** `src/editor/FormCandidatesPanel.jsx:15-20`; `src/pages/ToolStudioPage.jsx:1678`; `src/editor/operations.js:366-380`.
- **Suggested change:** Expose a choices editor for dropdown suggestions and make the default explicit in the review UI, or disallow conversion until choices are supplied.

### 5. Radio group choices cannot be edited after creation

- **Severity:** Medium — code confirmed.
- **Repro:** Create a radio group, apply it, select its field in Manage fields, and try to change its choices.
- **Expected:** Edit the group’s options or replace the group with a revised set.
- **Actual:** The inspector displays a fixed-choice notice for existing radio fields; `form-update` applies choices only when `field.setOptions` exists, while the creation branch builds one widget per choice.
- **Consequence:** A typo or changed option requires deleting and recreating the entire radio group, increasing rework and risking loss of placement.
- **Evidence:** `src/pages/ToolStudioPage.jsx:1649` and adjacent fixed-choice note; `src/editor/operations.js:362,377-381`.
- **Suggested change:** Implement a radio-group replacement operation that preserves group name/placement where possible, or provide an explicit “rebuild options” flow.

### 6. Existing radio groups cannot remove a single choice/widget

- **Severity:** Medium — code confirmed.
- **Repro:** Select one widget from a multi-option radio group and choose Delete selected object.
- **Expected:** Remove only the selected option, or make the group-level deletion consequence clear before proceeding.
- **Actual:** Each rendered native widget maps back to the same field. The inspector warns that deleting removes the entire group, and operation deletion calls `form.removeField(field)`.
- **Consequence:** Removing one obsolete answer destroys all answers in the group and requires recreation.
- **Evidence:** `src/pages/ToolStudioPage.jsx:3634-3638,1649`; `src/editor/operations.js:346-348`.
- **Suggested change:** Support widget-level deletion and preserve remaining export values; otherwise change the action to “Delete radio group” and require a clear confirmation.

### 7. Cancel operation does not stop editor apply/save work

- **Severity:** Medium — code confirmed.
- **Repro:** Start Apply changes on a large/complex document and press the footer’s Cancel operation button.
- **Expected:** Abort the active editor operation and leave the document unchanged.
- **Actual:** The footer button aborts `processingController`; editor `commitCurrent` uses that controller. But Save changes calls `saveDocument`, which invokes `commitCurrent` and then `writeEditorDocument`; `savingRef` is separate and no save controller is passed to the footer cancel action. During the file-write phase the footer's `busy` state can already be false, and there is no cancel control for that save phase.
- **Consequence:** A user cannot cancel a save/write or download prompt once the editor has begun saving; they may assume cancellation succeeded when only operation processing is cancellable.
- **Evidence:** `src/pages/ToolStudioPage.jsx:1231-1255,1281-1302,1681`; `src/editor/save.js` (write flow).
- **Suggested change:** Track save as a cancellable operation and keep its busy/cancel state active through `writeEditorDocument`, or label cancellation as apply-only and provide a save cancellation path where supported.

### 8. “Extract pages” commits pending edits to the open document before exporting selection

- **Severity:** Medium — code confirmed.
- **Repro:** Make an unsaved form or annotation edit, select pages in the organizer, then click Extract pages and cancel/abandon the extracted-file save.
- **Expected:** Extract the current edited content without unexpectedly changing the source document’s pending edit state, or clearly tell the user the source will be committed first.
- **Actual:** The handler calls `commitCurrent()` before extracting. That materializes pending edits into the current document and clears pending annotations/history representation before calling the separate extract operation.
- **Consequence:** An export action changes the source editor document and can make the extract flow appear to save the source edits despite the user only requesting an extracted copy.
- **Evidence:** `src/pages/ToolStudioPage.jsx:1637` (Extract pages handler); `src/pages/ToolStudioPage.jsx:1231-1254`.
- **Suggested change:** Build an in-memory committed copy for extraction without replacing the current session snapshot, or state that extraction commits source edits and provide a reversible workflow.

## Working paths confirmed from source

- Form detection is wired into the editor UI at `src/pages/ToolStudioPage.jsx:1645` (button handler) and the candidates panel is rendered at line 1678.
- Accepting a candidate creates an undoable semantic annotation; the engine creates AcroForm widgets only when pending operations are materialized (`src/pages/ToolStudioPage.jsx:1074-1082,1231-1254`; `src/editor/operations.js:366-381`).
- Save routes pending edits through `commitCurrent` before `writeEditorDocument` (`src/pages/ToolStudioPage.jsx:1281-1302`).
