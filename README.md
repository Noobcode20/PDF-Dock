# PDF King

PDF King is a local-first Electron workspace for common PDF operations. PDF and image processing runs in the renderer, including a bundled qpdf WebAssembly engine for password security and structural recovery. The desktop main process provides native open/save dialogs and stores optional recent-file copies in the app data directory.

## Run locally

```sh
npm install
npm run dev
```

Create a production renderer build with `npm run build`.

## Supported workflows

- Merge PDFs in a chosen order; split into page ranges or one file per page; extract, duplicate, delete, rotate, and organize pages by entering a custom sequence.
- Crop pages, add text watermarks and page numbers, create bookmarks, fill supported interactive form fields, and flatten forms.
- Add visible text or a typed signature, redact by masking a chosen rectangle on a rasterized page, and optimize PDFs losslessly or with raster recompression.
- Encrypt PDFs with AES-256 or remove encryption using a password supplied by the user; best-effort structural repair uses qpdf.
- Extract text from scanned PDFs with OCR, convert PDF pages to JPG/PNG, combine JPG/PNG images into a PDF, and make basic DOCX/XLSX conversions. OCR runs in the renderer on this device; Tesseract.js downloads its worker, core, and selected language data the first time OCR is used.
- Create blank documents and template starter PDFs with a selected page size, orientation, and page count.

Use page numbers starting at 1. Range fields accept values such as `1-3, 5`. Split creates one output for each comma-separated range. Organize Pages accepts a sequence such as `3, 1, 2`; repeating a number duplicates that page and leaving one out removes it.

## Limits

- Unlocking requires the document password; PDF King does not guess or bypass passwords.
- PDF-to-Word and PDF-to-Excel use selectable text and OCR for scanned pages. They do not preserve complex layout or reconstruct table structure. Word/Excel-to-PDF conversion is text-only.
- Raster compression and redaction replace page content with images, removing selectable text, vectors, links, forms, and accessibility data. Lossless optimization preserves page content but may not reduce size.
- The editor adds text to a page; it cannot change existing PDF text. The typed signature is a visual mark, not a certificate-backed digital signature.
- Repair is best effort; badly damaged documents may not be recoverable.

PDF outputs are written through a save dialog. The Recent Files page keeps local PDF copies while “Keep local recent PDF copies” is enabled in Settings.

## Open-source reference

The PDF workflow coverage was reviewed against [BentoPDF](https://github.com/alam00000/bentopdf), an AGPL-3.0 project. PDF King's processing code is implemented in this app using its existing libraries; BentoPDF source files are not bundled or copied here.
