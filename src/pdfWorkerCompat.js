// This entry runs in PDF.js's dedicated worker realm as well as bundling the
// worker implementation, so the runtime shim is available before messages are handled.
import './mapCompat'
import 'pdfjs-dist/build/pdf.worker.mjs'
