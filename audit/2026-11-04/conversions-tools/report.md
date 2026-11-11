# PDF Dock conversions and processing audit

Date: 2026-11-04  
Scope: tool catalog and standalone conversions/processing; editor interactive tools excluded.  
Checkout HEAD: `2bbfe0139eb3568f9aeef52d5cf0b23c07ebf05c`. Existing user modifications were preserved.

## Runtime status and constraints

I attempted the required T3 browser preview workflow. `preview_status` returned `available: false`, with no tab, so no app controls could be exercised in this run. Per task instructions I did not switch to a different browser or fabricate interaction evidence. No user PDFs, library records, browser storage, or app source were changed. Consequently, findings below are code-confirmed only; all runtime behavior remains unverified. This audit did not reach the requested 10–14 runtime-backed findings and does not claim a complete adversarial feature sweep.

## Findings

### 1. Conversion drop zone advertises multi-file intake for single-input converters

- Severity: low
- Classification: code confirmed
- Reproduction: Open any `kind: 'convert'` tool other than JPG-to-PDF; observe the empty state, then select/drop multiple files.
- Expected: UI states that only one source is accepted when that is the converter's actual contract.
- Actual: Empty state says “one or more documents”; `singleDocumentTools` includes only `pdf-editor`. Most converters use only `files[0]` in `processKnown`, so extra selected files are silently ignored.
- Consequence: Users may believe a batch was processed when only the first file is converted.
- Source: [ToolStudioPage.jsx](../../../src/pages/ToolStudioPage.jsx#L706), [pdfEngine.js](../../../src/pdfEngine.js#L968).
- Evidence: deterministic code path; runtime not exercised.
- Suggested fix: Model single-input converters explicitly and make copy, picker affordance, and `addFiles` constraints match the contract; alternatively implement true batch output.

### 2. PowerPoint converter accepts legacy `.ppt` in picker despite engine requiring PPTX

- Severity: low
- Classification: code confirmed
- Reproduction: Open PowerPoint to PDF and choose a `.ppt` file from the picker.
- Expected: Picker filters to formats the converter supports, or a legacy format is converted.
- Actual: `inputAccept` includes `.ppt` and `application/vnd.ms-powerpoint`; engine branch documents that legacy PPT is unsupported and requires PPTX first.
- Consequence: A valid picker choice predictably fails after selection instead of being filtered or explained before work begins.
- Source: [ToolStudioPage.jsx](../../../src/pages/ToolStudioPage.jsx#L53), [pdfEngine.js](../../../src/pdfEngine.js#L1463).
- Evidence: deterministic accept/engine mismatch; runtime not exercised.
- Suggested fix: Remove `.ppt`/legacy MIME from accept and show a clear conversion requirement beside the picker.

### 3. Compression “lossless” option is routed to lossy image recompression

- Severity: medium
- Classification: code confirmed
- Reproduction: Choose Compress PDF, select the lossless quality option, process a PDF containing embedded images, then compare extracted image content with the source.
- Expected: Lossless mode preserves embedded image samples exactly.
- Actual: The UI maps lossless to `level: 'lossless'`, which disables the dedicated `recompressImages` pass. However, `compressPdfBytes` is still called with `targetReduction: 0`, and the implementation path must be inspected for any default image pass before making stronger loss claims. I cannot establish image mutation from the available code excerpt alone, so this is **not counted as a confirmed defect** and is retained as an unverified probe only.
- Source: [ToolStudioPage.jsx](../../../src/pages/ToolStudioPage.jsx#L520), [pdfEngine.js](../../../src/pdfEngine.js#L1123), [pdfCompression.js](../../../src/pdfCompression.js#L137).
- Evidence: configuration path only; no runtime/output comparison. Do not treat as a confirmed finding pending full implementation trace.

## Interaction probes

No actual feature interaction probe was possible because T3 preview was unavailable. The code paths above are static source inspection, not UI reproduction. Converters audited in source include PDF-to-Word, Word-to-PDF, PDF-to-JPG, JPG-to-PDF, PDF-to-PowerPoint, PowerPoint-to-PDF, OCR, and compression; merge/split and batch output were not exhaustively exercised.

## Coverage and confidence

Only two actionable findings are reported; the compression note is explicitly unverified and should not be counted. This is below the requested 10–14 target because the required running-app interaction surface was unavailable and I am not inventing failures to meet a quota. A rerun with T3 preview available is needed for actual controls, representative disposable fixtures, output inspection, and broader merge/split/OCR/PPTX processing coverage.
