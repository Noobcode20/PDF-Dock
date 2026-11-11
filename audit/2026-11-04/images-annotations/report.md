# Images, annotations, signatures and redaction audit

Scope: image placement/inspector and annotation/signature/redaction code. Source review at current dirty worktree; no files outside this report were changed. HEAD reported by task: `2bbfe0139eb3568f9aeef52d5cf0b23c07ebf05c`.

## Findings

### 1. Width/height inspector accepts zero but model silently replaces it with default size
- **Severity:** medium · **Classification:** code confirmed
- **Reproduction:** select an image, set `Image width in points` or height to `0`, commit with Enter/blur.
- **Expected:** zero is rejected/clamped to the documented minimum, or image becomes hidden consistently.
- **Actual:** inspector permits 0 at lines 154/164 and sends normalized 0; `normalizeImageEdit` uses `Number(edit.width) || 0.2` then clamps, producing 20% page width rather than the minimum. The control can visibly jump to a different value after commit.
- **Consequence:** unexpectedly large image after trying to collapse it.
- **Source:** [ImageInspector.jsx](../../../src/components/ImageInspector.jsx:150), [imageModel.js](../../../src/editor/imageModel.js:110)
- **Evidence:** deterministic source path; UI reproduction unverified.
- **Suggested fix:** align input min with model minimum and avoid truthiness defaults for numeric zero.

### 2. Position and size controls advertise page-edge bounds but constrain only the origin/size separately
- **Severity:** low · **Classification:** improvement
- **Reproduction:** set width to page width then set X to a positive value (or set X near right edge then increase width).
- **Expected:** controls describe and enforce a coherent valid rectangle.
- **Actual:** separate input maxima allow X=page width and width=page width; normalization later silently moves/clamps the rectangle.
- **Consequence:** entered values do not persist and controls can appear to reject edits without explanation.
- **Source:** [ImageInspector.jsx](../../../src/components/ImageInspector.jsx:150), [imageModel.js](../../../src/editor/imageModel.js:110)
- **Evidence:** deterministic source review; runtime not verified.
- **Suggested fix:** calculate dynamic max from the other dimension and explain clamping.

### 3. Comment and form creation can commit zero-area gestures
- **Severity:** medium · **Classification:** code confirmed
- **Reproduction:** choose Comment or a form mode and click once without dragging; complete the prompt.
- **Expected:** no object is created for a click without a region, unless click-to-place is explicitly supported.
- **Actual:** `end` always prompts and commits; the minimum .018 rectangle applies even to zero movement. Comment is then forced to .035.
- **Consequence:** accidental tiny objects/fields and confusing placement behavior.
- **Source:** [AnnotationLayer.jsx](../../../src/editor/AnnotationLayer.jsx:65)
- **Evidence:** deterministic code path; runtime not verified.
- **Suggested fix:** explicitly define click-to-place for these modes or reject sub-threshold gestures before prompting.

### 4. Annotation pointer capture is not released/cleared on component unmount
- **Severity:** low · **Classification:** improvement
- **Reproduction:** begin drawing and switch page/tool or close editor while pointer is down; repeat with pointer cancellation.
- **Expected:** gesture state is discarded on teardown and cannot commit stale points.
- **Actual:** pointer cancel clears state, but there is no unmount cleanup for `drag`/preview; browser pointer capture is left to implicit teardown.
- **Consequence:** edge-case stale preview/gesture state when same layer instance survives mode/page transitions.
- **Source:** [AnnotationLayer.jsx](../../../src/editor/AnnotationLayer.jsx:26)
- **Evidence:** code review only.
- **Suggested fix:** cleanup effect clearing drag and preview, and explicitly release capture when appropriate.

### 5. Drawn signature uses a fixed aspect ratio unrelated to actual canvas bitmap dimensions
- **Severity:** medium · **Classification:** code confirmed
- **Reproduction:** draw a signature using only a narrow horizontal stroke, place it, compare sizing to a tall/diagonal signature.
- **Expected:** placed bitmap sizing should preserve its actual canvas aspect or crop to ink bounds.
- **Actual:** every drawn signature is labeled `aspect: 110 / 400`, even when sparse ink occupies a much smaller/taller area.
- **Consequence:** large blank padding and inconsistent visible signature scale.
- **Source:** [SignaturePanel.jsx](../../../src/editor/SignaturePanel.jsx:16)
- **Evidence:** deterministic source review; runtime not verified.
- **Suggested fix:** compute ink bounds and use their aspect, or make the fixed canvas aspect an explicit placement contract.

### 6. Signature upload does not clear the file input after selection
- **Severity:** low · **Classification:** improvement
- **Reproduction:** upload a signature, then choose the same file again after changing it externally or after a failed attempt.
- **Expected:** selecting the same file retriggers change and reports current decode result.
- **Actual:** unlike image replacement, the signature input retains its value, so reselecting the identical file may not emit `change`.
- **Consequence:** user cannot retry the same file without selecting a different file first.
- **Source:** [SignaturePanel.jsx](../../../src/editor/SignaturePanel.jsx:85)
- **Evidence:** browser behavior expectation from input semantics; runtime not verified.
- **Suggested fix:** reset `e.target.value` after capturing the selected File.

### 7. Annotation selection uses a single pointer-up on the page node for text markup
- **Severity:** low · **Classification:** improvement
- **Reproduction:** select text and release pointer outside the page, or select text with keyboard only while highlight/underline/strike mode is active.
- **Expected:** selected text markup commits regardless of pointer release location/input method.
- **Actual:** listener only handles `pointerup` on the page node; keyboard selection has no commit path and outside release may not bubble through the node.
- **Consequence:** text selection appears to do nothing for common accessibility and drag-out cases.
- **Source:** [AnnotationLayer.jsx](../../../src/editor/AnnotationLayer.jsx:32)
- **Evidence:** code review only.
- **Suggested fix:** support selectionchange/keyboard activation and document-level pointerup with page containment validation.

## Runtime probes and constraints

- Preview tool status was checked first; a fresh owned tab opened at `http://localhost:5174/`.
- `preview_snapshot` timed out after 15 seconds, so no actual control interaction could be completed. Runtime reproduction is therefore unverified for all findings.
- No tests, builds, source edits, PDF fixtures, or profile/storage changes were performed. Dirty worktree preserved.
