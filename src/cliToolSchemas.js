const string = (description) => ({ type: 'string', description })
const number = (description) => ({ type: 'number', description })
const boolean = (description) => ({ type: 'boolean', description })
const choices = (description, values) => ({ type: 'string', enum: values, description })
const pageList = string('One-based page numbers and ranges, for example "1,3-5". Leave empty where documented to select all pages.')

export const CLI_TOOL_OPTIONS = {
  'merge-pdf': { properties: { mergeMode: choices('Merge order strategy.', ['sequential', 'interlaced', 'custom']), mergePageOrder: { type: 'array', description: 'For custom mode, ordered page references using fileIndex (zero-based input index) and page (one-based). Unlisted pages are appended in source order.', items: { type: 'object', properties: { fileIndex: number('Zero-based index in files.'), page: number('One-based page number.') }, required: ['fileIndex', 'page'] } } } },
  'split-pdf': { properties: { ranges: string('Comma-separated page groups such as "1-3,5".'), mode: choices('Use "all" for one PDF per page, otherwise split by ranges.', ['range', 'all']) } },
  'compress-pdf': { properties: { level: choices('Compression tradeoff.', ['lossless', 'light', 'recommended', 'extreme']), quality: number('Embedded image JPEG quality from 0.25 to 1.') } },
  'pdf-editor': { required: ['annotationText'], properties: { annotationText: string('Visible text to add.'), annotationPage: number('One-based target page.') } },
  'sign-pdf': { required: ['signature'], properties: { signature: string('Typed signature mark.'), signaturePage: number('One-based target page.') } },
  'crop-pdf': { properties: { pages: pageList, unit: choices('Margin units.', ['mm', 'pt']), top: number('Top margin.'), right: number('Right margin.'), bottom: number('Bottom margin.'), left: number('Left margin.') } },
  'extract-pages': { properties: { pages: pageList, extractMode: choices('Set to "each" to create one output per selected page.', ['selected', 'each']) } },
  'duplicate-pages': { required: ['pages'], properties: { pages: pageList, copies: number('Number of duplicate sets, from 1 to 20.') } },
  'organize-pdf': { required: ['pages'], properties: { pages: string('Page order, e.g. "3,1-2,4". Repeats duplicate; omitted pages are removed.') } },
  'delete-pages': { required: ['pages'], properties: { pages: pageList } },
  'edit-bookmarks': { required: ['bookmarks'], properties: { bookmarks: { type: 'array', items: { type: 'object', properties: { page: number('One-based target page.'), title: string('Bookmark title.') }, required: ['page', 'title'] } } } },
  'page-numbers': { properties: { pages: pageList, position: choices('Page number placement.', ['top-left', 'top-center', 'top-right', 'bottom-left', 'bottom-center', 'bottom-right']), startNumber: number('First page number.'), format: string('Use {n} for current number and {total} for page count.'), fontSize: number('Number font size in points.') } },
  'add-watermark': { required: ['text'], properties: { text: string('Watermark text.'), pages: pageList, opacity: number('Opacity from 0 to 1.'), angle: number('Rotation angle in degrees.'), fontSize: number('Watermark font size in points.') } },
  'fill-forms': { required: ['fields'], properties: { fields: { type: 'object', description: 'Map exact field names to text, boolean checkbox, or choice values.' } } },
  'redact-pdf': { required: ['redactions'], properties: { redactions: { type: 'array', description: 'Marked regions are rasterized to remove their underlying page content. Coordinates are normalized from 0 to 1.', items: { type: 'object', properties: { page: number('One-based page number.'), x: number('Left coordinate from 0 to 1.'), y: number('Top coordinate from 0 to 1.'), width: number('Width from 0 to 1.'), height: number('Height from 0 to 1.'), normalized: boolean('Set true when coordinates are normalized.') }, required: ['page', 'x', 'y', 'width', 'height'] } }, dpi: number('Rasterization resolution.') } },
  'rotate-pages': { properties: { pages: pageList, rotation: { type: 'number', enum: [90, 180, 270, -90, -180, -270], description: 'Clockwise rotation in degrees.' } } },
  'ocr-pdf': { properties: { language: string('Tesseract language code; English is bundled.'), ocrDpi: number('Recognition render resolution, normally 150, 200, or 300.') } },
  'pdf-to-word': { properties: { language: string('OCR language for scanned pages.') } },
  'word-to-pdf': { properties: { fontSize: number('Base text size, when supported.') } },
  'pdf-to-jpg': { properties: { format: choices('Page image output format.', ['jpg', 'png']), dpi: number('Render resolution from 72 to 300 DPI.'), quality: number('JPEG quality from 0.25 to 1.') } },
  'jpg-to-pdf': { properties: { pageSize: choices('Output page sizing.', ['a4', 'letter', 'fit']), marginPt: number('Page margin in points.') } },
  'pdf-to-pptx': { properties: { language: string('OCR language for scanned pages.'), ocrDpi: number('OCR render resolution.') } },
  'powerpoint-to-pdf': { properties: {} },
  'protect-pdf': { required: ['password', 'confirmPassword'], properties: { password: string('AES-256 user/owner password; use at least 8 characters.'), confirmPassword: string('Must exactly match password.') } },
  'unlock-pdf': { required: ['password'], properties: { password: string('Existing PDF password. Password guessing is not performed.') } },
  'flatten-pdf': { properties: {} },
  'repair-pdf': { properties: {} },
}

export function toolOptionsSchema(toolId) {
  const definition = CLI_TOOL_OPTIONS[toolId] || { properties: {} }
  return {
    type: 'object',
    description: 'Parameter hints for the shared PDF Dock engine. Options are forwarded as supplied; engine validation and errors are authoritative.',
    additionalProperties: true,
    ...definition,
  }
}
