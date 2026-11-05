# Real-document verification

## Documents and isolation
The parent used copies from the actual app library: `Experiment_8_Completed_Lab_Report_compressed.pdf` (3 pages), `Class notes.pdf` (3 pages), and `BJT.pdf` (44 pages). Two additional library documents were copied as candidates but are not counted as exercised. A local ignored manifest records all five source hashes; the original library documents remained unchanged.

Each runtime script launches built Electron with a disposable profile and exits without saving test edits into the user's profile. Native file dialogs are stubbed only at their selection/result boundary to supply real paths. Real controls, IPC, renderer operations, PDF bytes, storage and reopened output are exercised. Tests do not bypass app editing by directly invoking the writer. Private documents are external inputs and are not committed.

## Verified workflows
- **Text:** edit an actual bold first-page label, use typing undo/redo and a sidebar font-size dropdown, resize the real text box for the longer label, delete an added text box without re-entering edit mode, apply, inspect output text, and reopen. The replaced original label is no longer extractable, bold weight survives, and other pages retain text and embedded-image counts. The first longer replacement wrapped in its original narrow box; resizing resolved that layout constraint without discarding characters.
- **Images:** navigate the lab report's diagram pages without auto-selection; explicitly select the actual embedded diagram; rotate, undo/redo; use keyboard sidebar resizing; inspect 1280/760/390px layouts; delete/apply; capture produced bytes and reopen. The selected source region contained 5,209 dark pixels before deletion and zero afterwards across 37,449 sampled pixels. This exercises real image extraction and the corrected quad order.
- **Library:** import both real PDFs through Home's direct native multi-picker; verify a tab and persistent record per file; select both library rows and check compact delete-dialog bounds and Escape; save an edited actual PDF with automatic recent recording disabled; reload/reopen and save again. No duplicate records or device-save dialogs; originals unchanged.
- **Tools:** merge both real inputs into six pages; choose a custom output name; exercise library only, device only and both; compare disk and library bytes; cancel an export and retain its pending result. Add/Save icons contrast with their filled buttons, and Add file is centered. Compress the actual lab report and scroll the resulting PDF; scroll the actual 44-page electronics document. Check monotonic scroll and stable settled position at 1280/760/390px.

## Commands
Run from the repository root after `npm run build`. Install `playwright-core` externally or provide its module path through `PDFKING_PLAYWRIGHT`; it is a QA dependency, not a shipped app dependency.

```sh
PDFKING_PLAYWRIGHT=/path/to/playwright-core PDFKING_REAL_PDF=/path/to/actual-lab.pdf PDFKING_TEXT_TARGET=NAME node scripts/test-real-text-electron.cjs
PDFKING_PLAYWRIGHT=/path/to/playwright-core PDFKING_REAL_PDF=/path/to/actual-lab.pdf node scripts/test-real-images-electron.cjs
PDFKING_PLAYWRIGHT=/path/to/playwright-core node scripts/test-real-library-electron.cjs /path/to/actual-lab.pdf /path/to/actual-notes.pdf
PDFKING_PLAYWRIGHT=/path/to/playwright-core PDFKING_LONG_PDF=/path/to/actual-long.pdf node scripts/test-real-tools-electron.cjs /path/to/actual-lab.pdf /path/to/actual-notes.pdf
```

The text script needs a visible first-page label supplied through `PDFKING_TEXT_TARGET`. The image script expects embedded diagrams on page 2 and a third page for navigation. The paths above represent caller-owned external test documents, not generated fixtures. Generated fixtures remain supplemental regression coverage.

## Limits
Runtime verification took place on macOS. Windows installer execution, installed updating, arbitrary PDF encodings, all scan/OCR variants and every possible overlap/background combination are outside this evidence. Complex visual text replacement and image covers are not secure redaction. No new installer was published.
