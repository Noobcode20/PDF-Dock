# PDF Dock

PDF Dock is a local-first Electron workspace for common PDF operations. PDF and image processing runs in the renderer, including a bundled qpdf WebAssembly engine for password security and structural recovery. The desktop main process provides native open/save dialogs and stores optional recent-file copies in the app data directory.

## Download the beta

PDF Dock beta installers are available for macOS and Windows. Choose the installer for your computer:

- [Download for macOS (Apple Silicon)](https://github.com/Noobcode20/PDF-King-Desktop/releases/download/v0.1.0-beta.2/PDF-Dock-macOS-arm64.dmg)
- [Download for macOS (Intel)](https://github.com/Noobcode20/PDF-King-Desktop/releases/download/v0.1.0-beta.2/PDF-Dock-macOS-x64.dmg)
- [Download for Windows (.exe)](https://github.com/Noobcode20/PDF-King-Desktop/releases/download/v0.1.0-beta.2/PDF-Dock-Windows.exe)
- [View all beta releases](https://github.com/Noobcode20/PDF-King-Desktop/releases)

These beta builds are unsigned. macOS may ask you to approve opening the app in Privacy & Security, and Windows may show a SmartScreen prompt.

## Run locally

```sh
npm install
npm run dev
```

Create a production renderer build with `npm run build`.

## Command-line interface

The `pdf-dock` CLI runs the same local PDF processing engine as the desktop app in a hidden Electron renderer. Build the app first, then run it from this checkout:

```sh
npm run build
node bin/pdf-dock.mjs tools
```

Requests are JSON so scripts and agents can pass options without relying on interactive prompts. Provide a request file or pipe JSON on standard input:

```sh
echo '{"command":"run","tool":"compress-pdf","files":["report.pdf"],"options":{"level":"lossless"},"output":"report-small.pdf"}' | node bin/pdf-dock.mjs run
node bin/pdf-dock.mjs inspect <<'JSON'
{"file":"report.pdf"}
JSON
node bin/pdf-dock.mjs search <<'JSON'
{"file":"report.pdf","query":"invoice","options":{"wholeWord":true}}
JSON
node bin/pdf-dock.mjs run <<'JSON'
{"tool":"merge-pdf","files":["cover.pdf","report.pdf"],"options":{"mergeMode":"sequential"},"output":"combined.pdf"}
JSON
```

Supported commands are `tools`, `run`, `edit`, `inspect`, `search`, and `create`. `run` accepts any tool ID returned by `tools`; each tool entry includes option hints and the `tools` result includes schemas for every command. Options are forwarded to the shared engine, which reports validation errors. The `edit` command applies the editor's native operation format directly, covering text, annotations, images, form fields, and page edits. `files[0]` is the source PDF; insert operations use `fileIndex` (default 1) to select another PDF, image operations may use `sourceFileIndex` or `replacementFileIndex`, and text operations may use `fontDataFileIndex` to provide a custom font. These file-index fields reference other paths in the `files` array. Set `output` to a file for a single result or a directory for multiple results. Without `output`, files are written to the current directory. Existing outputs are preserved unless the request sets `"force": true`. `--progress` writes progress JSON lines to stderr; stdout contains one machine-readable JSON result. `--pretty` formats that result for humans.

Example editor operation (coordinates are normalized from 0 to 1):

```json
{"command":"edit","files":["report.pdf"],"operations":[{"type":"annotation","kind":"highlight","page":1,"x":0.12,"y":0.24,"width":0.36,"height":0.03,"color":"#ffe600","opacity":0.45}],"output":"report-highlighted.pdf"}
```

Example form fill:

```json
{"command":"run","tool":"fill-forms","files":["application.pdf"],"options":{"fields":{"Applicant name":"Ada Lovelace","Consent":true}},"output":"completed.pdf"}
```

Processing remains local. The CLI expects a production build (`npm run build`) and an installed Electron runtime from this project; it does not open the visible desktop window.

## Bugs and feature requests

The Settings page submits bugs and feature requests to GitHub Issues, either through the reporter's GitHub account or through the no-account GitHub App Worker. See [FEEDBACK_SETUP.md](FEEDBACK_SETUP.md) for setup.

## Supported workflows

- Merge PDFs in a chosen order; split into page ranges or one file per page; extract, duplicate, delete, rotate, and organize pages by entering a custom sequence.
- Crop pages, add text watermarks and page numbers, create bookmarks, fill supported interactive form fields, and flatten forms.
- Add visible text or a typed signature, redact by masking a chosen rectangle on a rasterized page, and optimize PDFs losslessly or by recompressing embedded images while preserving native page content.
- Encrypt PDFs with AES-256 or remove encryption using a password supplied by the user; best-effort structural repair uses qpdf.
- Extract text from scanned PDFs with OCR, convert PDF pages to JPG/PNG, combine JPG/PNG images into a PDF, and convert between PDF and DOCX. English OCR runs locally with bundled assets; additional languages require a local Tesseract language pack.
- Create blank documents with a selected page size, orientation, and page count.

Use page numbers starting at 1. Range fields accept values such as `1-3, 5`. Split creates one output for each comma-separated range. Organize Pages accepts a sequence such as `3, 1, 2`; repeating a number duplicates that page and leaving one out removes it.

## Limits

- Unlocking requires the document password; PDF Dock does not guess or bypass passwords.
- PDF-to-Word exports editable text with approximate placement and styling. DOCX-to-PDF conversion preserves basic text formatting, alignment, and table layout; complex layouts, images, and advanced styling may differ. Spreadsheet conversion is not currently provided.
- PDF compression preserves native text, vectors, links, and forms. Recommended mode targets a 70% reduction with adaptive embedded-image compression, including colour profiles and transparency. In the desktop app, an available local Ghostscript installation can additionally convert embedded Type 1 fonts to compact CFF programs; only font streams are transferred and form documents skip this step. Without Ghostscript, the image/resource optimizer still runs. Reduction depends on the input and may fall short of the target. Redaction rasterizes affected pages to remove marked content.
- The editor can add and restyle detected page text approximately; complex fonts, rotations, and layouts may need cleanup. The typed signature is a visual mark, not a certificate-backed digital signature.
- Repair is best effort; badly damaged documents may not be recoverable.

PDF outputs are written through a save dialog. The Recent Files page keeps local PDF copies while “Keep local recent PDF copies” is enabled in Settings.

## Open-source reference

The PDF workflow coverage was reviewed against [BentoPDF](https://github.com/alam00000/bentopdf), an AGPL-3.0 project. PDF Dock's processing code is implemented in this app using its existing libraries; BentoPDF source files are not bundled or copied here.
