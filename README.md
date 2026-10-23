# PDF Dock

PDF Dock is a local-first Electron workspace for common PDF operations. PDF and image processing runs in the renderer, including a bundled qpdf WebAssembly engine for password security and structural recovery. The desktop main process provides native open/save dialogs and stores optional recent-file copies in the app data directory.

## Download the beta

PDF Dock beta installers are available for macOS and Windows. Choose the installer for your computer:

- [Download for macOS (.dmg)](https://github.com/Noobcode20/PDF-King-Desktop/releases/download/v0.1.0-beta.1/PDF-Dock-macOS.dmg)
- [Download for Windows (.exe)](https://github.com/Noobcode20/PDF-King-Desktop/releases/download/v0.1.0-beta.1/PDF-Dock-Windows.exe)
- [View all beta releases](https://github.com/Noobcode20/PDF-King-Desktop/releases)

These beta builds are unsigned. macOS may ask you to approve opening the app in Privacy & Security, and Windows may show a SmartScreen prompt.

## Run locally

```sh
npm install
npm run dev
```

Create a production renderer build with `npm run build`.

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
