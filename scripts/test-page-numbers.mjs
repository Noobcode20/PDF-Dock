import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { createServer } from 'vite'

// The engine is a renderer module: it reads document.baseURI at import time.
// Load the real src/pdfEngine.js through Vite's SSR pipeline with the tiny
// DOM surface it touches, so this exercises the exported processTool route
// and inspects the PDF the app would actually produce.
globalThis.document = { baseURI: 'http://localhost/' }
globalThis.location = { protocol: 'http:', href: 'http://localhost/' }
globalThis.window = globalThis

const root = fileURLToPath(new URL('..', import.meta.url))
const server = await createServer({
  root,
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
  optimizeDeps: { noDiscovery: true },
})

const overlayText = async (bytes) => {
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: true })
  const doc = await task.promise
  const pages = []
  for (let page = 1; page <= doc.numPages; page += 1) {
    const content = await (await doc.getPage(page)).getTextContent()
    const overlay = content.items
      .map((item) => item.str)
      .filter((text) => text && !text.startsWith('Body page'))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
    pages.push(overlay)
  }
  await task.destroy()
  return pages
}

try {
  const { processTool } = await server.ssrLoadModule('/src/pdfEngine.js')

  const source = await PDFDocument.create()
  const font = await source.embedFont(StandardFonts.Helvetica)
  for (let page = 1; page <= 5; page += 1) {
    source.addPage([600, 800]).drawText(`Body page ${page}`, { x: 40, y: 700, font, size: 14 })
  }
  const sourceBytes = await source.save()
  const file = new File([sourceBytes], 'sample.pdf', { type: 'application/pdf' })

  const number = async (options) => {
    const result = await processTool({ toolId: 'page-numbers', files: [file], options })
    assert.equal(result.outputs.length, 1)
    assert.equal(result.outputs[0].name, 'sample_numbered.pdf')
    return overlayText(result.outputs[0].data)
  }

  // A selected subset numbers only the chosen pages, and the first selected
  // page receives "First page number" instead of the source page index.
  assert.deepEqual(await number({ pages: '2-4', startNumber: 1, format: '{n}' }), ['', '1', '2', '3', ''])
  // Skipped pages keep their own numbering gap-free across the subset.
  assert.deepEqual(await number({ pages: '1,5', startNumber: 7, format: '{n}' }), ['7', '', '', '', '8'])
  // {total} still means the total pages of the source document.
  assert.deepEqual(await number({ pages: '2-4', startNumber: 1, format: '{n} of {total}' }), ['', '1 of 5', '2 of 5', '3 of 5', ''])
  // The legacy startAt option still sets the first number.
  assert.deepEqual(await number({ pages: '2-4', startAt: 10, format: '{n}' }), ['', '10', '11', '12', ''])
  // Numbering every page keeps the previous sequence.
  assert.deepEqual(await number({ startNumber: 1, format: '{n}' }), ['1', '2', '3', '4', '5'])
  assert.deepEqual(await number({ startNumber: 5, format: '{n}' }), ['5', '6', '7', '8', '9'])

  // Watermarks are unaffected by the numbering sequence.
  const watermarked = await processTool({ toolId: 'add-watermark', files: [file], options: { text: 'WM', pages: '2-3' } })
  const stamps = await overlayText(watermarked.outputs[0].data)
  assert.deepEqual(stamps, ['', 'WM', 'WM', '', ''])
  console.log('Page numbering: subsets start at "First page number" and advance one per numbered page; skipped pages stay blank; {total} counts source pages; startAt still honored; watermark unchanged')
} catch (error) {
  console.error(error)
  process.exitCode = 1
} finally {
  await server.close()
}
