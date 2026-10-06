import { PDFDocument, PDFHexString, PDFName, StandardFonts, rgb, degrees } from 'pdf-lib'
import './mapCompat'
import * as pdfjs from 'pdfjs-dist'
import pdfWorkerUrl from './pdfWorkerCompat.js?worker&url'
import qpdfWasmUrl from 'pdfstudio/qpdf.wasm?url'

// This module intentionally owns no UI state or filesystem access. All inputs and
// outputs are in-memory browser File/Uint8Array values so it can run in a renderer.
pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl


const PDF_MIME = 'application/pdf'
const JPG_MIME = 'image/jpeg'
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
let qpdfToolkitPromise

async function getQpdfToolkit() {
  if (!qpdfToolkitPromise) {
    qpdfToolkitPromise = import('pdfstudio').then(async ({ createPdfToolkit }) => {
      if (location.protocol === 'file:' && window.pdfKing?.readQpdfWasm) {
        const assetName = new URL(qpdfWasmUrl, location.href).pathname.split('/').pop()
        const bytes = await window.pdfKing.readQpdfWasm(assetName)
        const wasmModule = await WebAssembly.compile(bytes)
        return createPdfToolkit({ wasmModule })
      }
      return createPdfToolkit({ wasmUrl: qpdfWasmUrl })
    }).catch((error) => {
      qpdfToolkitPromise = null
      throw new Error(`The local PDF security engine could not start: ${error.message}`)
    })
  }
  return qpdfToolkitPromise
}

const TOOL_NAMES = {
  'merge-pdf': 'Merge PDF', 'split-pdf': 'Split PDF', 'extract-pages': 'Extract pages',
  'duplicate-pages': 'Duplicate pages', 'delete-pages': 'Delete pages', 'rotate-pages': 'Rotate pages',
  'crop-pdf': 'Crop PDF', 'add-watermark': 'Add watermark', 'page-numbers': 'Page numbers',
  'flatten-pdf': 'Flatten PDF', 'repair-pdf': 'Repair PDF', 'pdf-to-jpg': 'PDF to JPG',
  'jpg-to-pdf': 'JPG to PDF', 'pdf-to-word': 'PDF to Word', 'word-to-pdf': 'Word to PDF',
  'pdf-to-excel': 'PDF to Excel', 'excel-to-pdf': 'Excel to PDF', 'compress-pdf': 'Compress PDF',
  'redact-pdf': 'Redact PDF', 'ocr-pdf': 'OCR PDF',
}

function fail(message) { throw new Error(message) }

function asBytes(data) {
  if (data instanceof Uint8Array) return data
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
}

async function readFile(file) {
  if (!file || typeof file.arrayBuffer !== 'function') fail('Choose a file before starting this operation.')
  return new Uint8Array(await file.arrayBuffer())
}

function output(name, data, mimeType = PDF_MIME) {
  return { name, data: asBytes(data), mimeType }
}

function baseName(file) {
  return (file?.name || 'document').replace(/\.[^.]+$/, '')
}

function progress(onProgress, value, message) {
  if (typeof onProgress === 'function') onProgress({ value, message })
}

function pdfError(error, action = 'open this PDF') {
  const detail = String(error?.message || error)
  if (/password|encrypt/i.test(detail)) {
    return new Error(`This PDF is password-protected. Enter its password in a supported PDF reader and save an unlocked copy before trying to ${action}.`)
  }
  if (/worker|canvas|render/i.test(detail) && /pdfjs|canvas/i.test(detail)) {
    return new Error(`The PDF page renderer could not start. Check that the bundled PDF.js worker and browser canvas support are available. (${detail})`)
  }
  return new Error(`Could not ${action}: ${detail}`)
}

async function loadPdf(file) {
  const bytes = await readFile(file)
  try {
    const pdf = await PDFDocument.load(bytes, { updateMetadata: false, throwOnInvalidObject: false })
    return { pdf, bytes }
  } catch (error) { throw pdfError(error) }
}

function requirePdf(files, minimum = 1) {
  if (!Array.isArray(files) || files.length < minimum) {
    fail(minimum > 1 ? `Choose at least ${minimum} PDF files.` : 'Choose a PDF file first.')
  }
  const bad = files.find((file) => file.type && file.type !== PDF_MIME && !/\.pdf$/i.test(file.name || ''))
  if (bad) fail(`“${bad.name}” is not a PDF file.`)
}

function parsePageList(value, pageCount, fallbackAll = false) {
  if ((value == null || value === '') && fallbackAll) return Array.from({ length: pageCount }, (_, i) => i + 1)
  if (Array.isArray(value)) {
    const pages = value.map(Number)
    if (pages.some((p) => !Number.isInteger(p) || p < 1 || p > pageCount)) fail(`Page numbers must be between 1 and ${pageCount}.`)
    return [...new Set(pages)].sort((a, b) => a - b)
  }
  if (typeof value !== 'string' || !value.trim()) fail('Enter page numbers or ranges, for example 1-3, 5.')
  const pages = new Set()
  for (const raw of value.split(',')) {
    const token = raw.trim()
    const range = token.match(/^(\d+)\s*-\s*(\d+)$/)
    const single = token.match(/^(\d+)$/)
    if (range) {
      const start = Number(range[1]), end = Number(range[2])
      if (start < 1 || end < start || end > pageCount) fail(`Range “${token}” is invalid. Use pages 1-${pageCount}.`)
      for (let n = start; n <= end; n += 1) pages.add(n)
    } else if (single) {
      const n = Number(single[1])
      if (n < 1 || n > pageCount) fail(`Page ${n} is outside this PDF's 1-${pageCount} page range.`)
      pages.add(n)
    } else fail(`Could not read “${token}”. Use page numbers and ranges such as 1-3, 5.`)
  }
  return [...pages].sort((a, b) => a - b)
}

function parsePageOrder(value, pageCount) {
  if ((value == null || value === '') && pageCount) return Array.from({ length: pageCount }, (_, i) => i + 1)
  const order = []
  for (const token of String(value).split(',')) {
    const value = token.trim()
    const range = value.match(/^(\d+)\s*-\s*(\d+)$/)
    if (range) {
      const start = Number(range[1]), end = Number(range[2])
      if (start < 1 || end < start || end > pageCount) fail(`Page order range “${value}” is invalid. Use pages 1-${pageCount}.`)
      for (let page = start; page <= end; page += 1) order.push(page)
    } else if (/^\d+$/.test(value)) {
      const page = Number(value)
      if (page < 1 || page > pageCount) fail(`Page ${page} is outside this PDF's 1-${pageCount} page range.`)
      order.push(page)
    } else fail(`Could not read “${value}”. Enter page numbers in the desired order.`)
  }
  if (!order.length) fail('Enter at least one page number.')
  return order
}

function parsedRanges(options, pageCount) {
  const value = options.ranges ?? options.pages ?? options.pageRanges
  if (options.mode === 'all' || options.splitMode === 'all') return Array.from({ length: pageCount }, (_, i) => [i + 1])
  const selected = parsePageList(value, pageCount)
  let groups
  if (options.groupRanges === false || typeof value !== 'string') groups = [selected]
  else groups = value.split(',').map((part) => parsePageList(part.trim(), pageCount)).filter((group) => group.length)
  if (!groups.length) fail('Select at least one page.')
  return groups
}

async function savePdf(pdf) {
  return new Uint8Array(await pdf.save({ useObjectStreams: true, addDefaultPage: false }))
}

async function extractGroups(file, options, onProgress) {
  const { pdf } = await loadPdf(file)
  const count = pdf.getPageCount()
  const groups = parsedRanges(options, count)
  const outputs = []
  for (let i = 0; i < groups.length; i += 1) {
    const result = await PDFDocument.create()
    const copied = await result.copyPages(pdf, groups[i].map((p) => p - 1))
    copied.forEach((page) => result.addPage(page))
    outputs.push(output(`${baseName(file)}_pages_${groups[i].join('-')}.pdf`, await savePdf(result)))
    progress(onProgress, (i + 1) / groups.length, `Created ${i + 1} of ${groups.length} PDF${groups.length === 1 ? '' : 's'}`)
  }
  return outputs
}

async function getPdfJsDocument(fileOrBytes) {
  try {
    const data = fileOrBytes instanceof Uint8Array ? fileOrBytes : await readFile(fileOrBytes)
    const task = pdfjs.getDocument({ data: data.slice() })
    return await task.promise
  } catch (error) { throw pdfError(error, 'read this PDF') }
}

async function renderPage(doc, pageNumber, scale = 1.5) {
  const page = await doc.getPage(pageNumber)
  const viewport = page.getViewport({ scale })
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.ceil(viewport.width))
  canvas.height = Math.max(1, Math.ceil(viewport.height))
  const context = canvas.getContext('2d', { alpha: false })
  if (!context) fail('This browser could not create a canvas for PDF rendering.')
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  await page.render({ canvas, canvasContext: context, viewport }).promise
  return { canvas, page, viewport }
}

function canvasBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('The browser failed to encode the rendered page image.')), type, quality))
}

async function pageToImage(pdfJsDoc, pageNumber, options = {}) {
  const dpi = Math.max(72, Math.min(300, Number(options.dpi) || 150))
  const rendered = await renderPage(pdfJsDoc, pageNumber, dpi / 72)
  const quality = Math.max(0.25, Math.min(1, Number(options.quality) || 0.82))
  const blob = await canvasBlob(rendered.canvas, options.format === 'png' ? 'image/png' : JPG_MIME, quality)
  return new Uint8Array(await blob.arrayBuffer())
}

async function rasterPdf(file, options, onProgress, redactions = null) {
  const doc = await getPdfJsDocument(file)
  const outputPdf = await PDFDocument.create()
  const dpi = Math.max(96, Math.min(300, Number(options.dpi) || (redactions ? 200 : 144)))
  const quality = Math.max(0.25, Math.min(1, Number(options.quality) || 0.8))
  const list = redactions || []
  for (let n = 1; n <= doc.numPages; n += 1) {
    const { canvas, viewport } = await renderPage(doc, n, dpi / 72)
    if (redactions) {
      // Masks are painted into the rendered pixels before image embedding. The resulting
      // PDF contains no original text/image objects, making these redactions irreversible.
      const ctx = canvas.getContext('2d')
      const masks = list.filter((rect) => Number(rect.page) === n)
      for (const rect of masks) {
        const normalized = rect.normalized !== false && [rect.x, rect.y, rect.width, rect.height].every((v) => Number(v) >= 0 && Number(v) <= 1)
        const sx = normalized ? canvas.width : Number(options.dpi || 200) / 72
        const sy = normalized ? canvas.height : Number(options.dpi || 200) / 72
        const x = Number(rect.x) * sx
        const y = Number(rect.y) * sy
        const width = Number(rect.width) * sx
        const height = Number(rect.height) * sy
        if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) fail(`Redaction on page ${n} has invalid coordinates.`)
        if (x < 0 || y < 0 || x + width > canvas.width || y + height > canvas.height) fail(`Redaction on page ${n} must fit within the page.`)
        ctx.fillStyle = '#000000'
        ctx.fillRect(Math.max(0, x), Math.max(0, y), Math.min(width, canvas.width - x), Math.min(height, canvas.height - y))
      }
    }
    const blob = await canvasBlob(canvas, JPG_MIME, quality)
    const image = await outputPdf.embedJpg(new Uint8Array(await blob.arrayBuffer()))
    const dims = viewport
    const page = outputPdf.addPage([dims.width / (dpi / 72), dims.height / (dpi / 72)])
    page.drawImage(image, { x: 0, y: 0, width: page.getWidth(), height: page.getHeight() })
    progress(onProgress, n / doc.numPages, `Rasterizing page ${n} of ${doc.numPages}`)
  }
  return savePdf(outputPdf)
}

async function extractTextByPage(file, options = {}, onProgress) {
  const doc = await getPdfJsDocument(file)
  const pages = []
  const imagePages = []
  for (let n = 1; n <= doc.numPages; n += 1) {
    const page = await doc.getPage(n)
    const content = await page.getTextContent()
    const rows = new Map()
    for (const item of content.items) {
      if (!('str' in item) || !item.str.trim()) continue
      const y = Math.round(item.transform?.[5] ?? 0)
      const line = rows.get(y) || []
      line.push({ x: item.transform?.[4] ?? 0, text: item.str })
      rows.set(y, line)
    }
    const lines = [...rows.entries()].sort((a, b) => b[0] - a[0]).map(([, items]) => {
      let end = null
      return items.sort((a, b) => a.x - b.x).map((part) => {
        const gap = end == null ? 0 : part.x - end
        const separator = gap > 26 ? '  |  ' : gap > 10 ? '  ' : ' '
        end = part.x + (part.width || part.text.length * 3)
        return `${separator}${part.text}`
      }).join('').replace(/\s+/g, ' ').trim()
    }).filter(Boolean)
    pages.push(lines)
    if (!lines.length) imagePages.push(n)
  }
  if (imagePages.length) {
    let worker
    let currentPageIndex = 0
    try {
      progress(onProgress, 0, 'Loading the OCR engine and language data…')
      const { createWorker } = await import('tesseract.js')
      worker = await createWorker(options.language || 'eng', 1, {
        logger: (state) => {
          const percent = Number(state.progress) || 0
          progress(onProgress, (currentPageIndex + percent) / imagePages.length, state.status === 'recognizing text' ? `Recognizing text on scanned page ${imagePages[currentPageIndex]} of ${doc.numPages}` : `Loading OCR ${state.status || 'engine'}…`)
        },
      })
      const dpi = Math.max(120, Math.min(300, Number(options.ocrDpi || options.dpi) || 200))
      for (let index = 0; index < imagePages.length; index += 1) {
        currentPageIndex = index
        const pageNumber = imagePages[index]
        progress(onProgress, index / imagePages.length, `Preparing scanned page ${pageNumber} of ${doc.numPages} for OCR…`)
        const { canvas } = await renderPage(doc, pageNumber, dpi / 72)
        const { data } = await worker.recognize(canvas)
        pages[pageNumber - 1] = String(data.text || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
      }
    } catch (error) {
      throw new Error(`OCR could not read this scanned PDF: ${error?.message || error}`)
    } finally {
      if (worker) await worker.terminate()
    }
  }
  if (pages.every((lines) => !lines.length)) fail('No text was found in this PDF. The pages may be blank or too faint for OCR.')
  return pages
}

async function ocrPdf(file, options, onProgress) {
  requirePdf([file])
  const pages = await extractTextByPage(file, options, onProgress)
  const text = pages.map((lines, index) => `Page ${index + 1}\n${lines.join('\n')}`).join('\n\n')
  if (!text.replace(/Page \d+/g, '').trim()) fail('OCR did not recognize any text in this PDF.')
  return output(`${baseName(file)}_ocr.txt`, new TextEncoder().encode(text), 'text/plain;charset=utf-8')
}

async function textPdf(textPages, fileName, options = {}) {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const fontSize = Math.min(12, Math.max(8, Number(options.fontSize) || 10))
  for (const lines of textPages) {
    let page = doc.addPage([612, 792])
    let y = 750
    for (const sourceLine of lines) {
      const chunks = String(sourceLine).match(/.{1,92}(?:\s|$)/g) || [String(sourceLine)]
      for (const raw of chunks) {
        if (y < 45) { page = doc.addPage([612, 792]); y = 750 }
        page.drawText(raw.trim(), { x: 48, y, size: fontSize, font, color: rgb(0.08, 0.08, 0.08), maxWidth: 516 })
        y -= fontSize * 1.55
      }
    }
  }
  return output(fileName, await savePdf(doc))
}

function parseTables(pages) {
  const rows = []
  for (const lines of pages) for (const line of lines) {
    const cells = line.split(/\t+|\s{2,}|\s*\|\s*/).map((cell) => cell.trim()).filter(Boolean)
    if (cells.length > 1) rows.push(cells)
  }
  if (!rows.length) fail('No table-like rows were detected. OCR can read scanned text, but this basic converter does not recognize table structure.')
  const width = Math.max(...rows.map((row) => row.length))
  return rows.map((row) => [...row, ...Array(Math.max(0, width - row.length)).fill('')])
}

async function imagePdf(files, options, onProgress) {
  const pdf = await PDFDocument.create()
  for (let i = 0; i < files.length; i += 1) {
    const file = files[i]
    const bytes = await readFile(file)
    const type = file.type || (/\.png$/i.test(file.name) ? 'image/png' : 'image/jpeg')
    let image
    if (type === 'image/png') image = await pdf.embedPng(bytes)
    else if (type === 'image/jpeg' || type === 'image/jpg') image = await pdf.embedJpg(bytes)
    else fail(`“${file.name}” is ${type}; JPG to PDF accepts JPEG and PNG image files.`)
    const pageSize = options.pageSize === 'letter' ? [612, 792] : options.pageSize === 'a4' ? [595.28, 841.89] : [image.width * 0.75, image.height * 0.75]
    const page = pdf.addPage(pageSize)
    const padding = Math.max(0, Math.min(72, Number(options.marginPt) || 18))
    const scale = Math.min((page.getWidth() - padding * 2) / image.width, (page.getHeight() - padding * 2) / image.height)
    const width = image.width * scale, height = image.height * scale
    page.drawImage(image, { x: (page.getWidth() - width) / 2, y: (page.getHeight() - height) / 2, width, height })
    progress(onProgress, (i + 1) / files.length, `Added image ${i + 1} of ${files.length}`)
  }
  return output('images.pdf', await savePdf(pdf))
}

async function applyTextOverlay(file, options, mode) {
  const { pdf } = await loadPdf(file)
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const selected = options.pages ? new Set(parsePageList(options.pages, pdf.getPageCount())) : null
  const start = Number(options.startNumber ?? options.startAt ?? 1)
  const text = String(options.text ?? options.watermarkText ?? 'CONFIDENTIAL')
  if (mode === 'watermark' && !text.trim()) fail('Enter watermark text before applying it.')
  const opacity = Math.max(0.05, Math.min(1, Number(options.opacity ?? 0.25)))
  const angle = Number(options.angle ?? 45)
  const position = String(options.position || 'bottom-center')
  const fontSize = Math.max(6, Math.min(96, Number(options.fontSize) || (mode === 'watermark' ? 44 : 10)))
  const color = mode === 'watermark' ? rgb(0.48, 0.48, 0.5) : rgb(0.12, 0.12, 0.12)
  pdf.getPages().forEach((page, index) => {
    const n = index + 1
    if (selected && !selected.has(n)) return
    const { width, height } = page.getSize()
    if (mode === 'watermark') {
      page.drawText(text, { x: width * 0.13, y: height * 0.48, size: fontSize, font, color, opacity, rotate: degrees(angle), maxWidth: width * 0.75 })
    } else {
      const label = String(options.format || '{n}').replaceAll('{n}', String(start + index)).replaceAll('{total}', String(pdf.getPageCount()))
      const tw = font.widthOfTextAtSize(label, fontSize)
      const [vertical, horizontal] = position.split('-')
      const x = horizontal === 'left' ? 36 : horizontal === 'right' ? width - tw - 36 : (width - tw) / 2
      const y = vertical === 'top' ? height - 36 - fontSize : 28
      page.drawText(label, { x, y, size: fontSize, font, color, opacity: 1 })
    }
  })
  return output(`${baseName(file)}_${mode === 'watermark' ? 'watermarked' : 'numbered'}.pdf`, await savePdf(pdf))
}

async function cropPdf(file, options) {
  const { pdf } = await loadPdf(file)
  const mmToPt = 72 / 25.4
  const margin = (name) => Math.max(0, Number(options[name]) || 0) * (options.unit === 'pt' ? 1 : mmToPt)
  const top = margin('top'), bottom = margin('bottom'), left = margin('left'), right = margin('right')
  const selected = options.pages ? new Set(parsePageList(options.pages, pdf.getPageCount())) : null
  pdf.getPages().forEach((page, index) => {
    if (selected && !selected.has(index + 1)) return
    const { width, height } = page.getSize()
    if (left + right >= width || top + bottom >= height) fail(`Crop margins leave no printable area on page ${index + 1}.`)
    page.setCropBox(left, bottom, width - left - right, height - top - bottom)
  })
  return output(`${baseName(file)}_cropped.pdf`, await savePdf(pdf))
}

async function reorderPdf(file, options) {
  const { pdf } = await loadPdf(file)
  const order = parsePageOrder(options.pages, pdf.getPageCount())
  const result = await PDFDocument.create()
  const copied = await result.copyPages(pdf, order.map((n) => n - 1))
  copied.forEach((page, index) => {
    const angle = Number(options.rotation || 0)
    if (angle) page.setRotation(degrees(((page.getRotation().angle + angle) % 360 + 360) % 360))
    result.addPage(page)
  })
  return output(`${baseName(file)}_organized.pdf`, await savePdf(result))
}

async function addVisibleText(file, options, mode) {
  const { pdf } = await loadPdf(file)
  const text = String(mode === 'signature' ? options.signature || '' : options.annotationText || '').trim()
  if (!text) fail(mode === 'signature' ? 'Enter the signature name to place on the PDF.' : 'Enter text to add to this PDF.')
  const pageNumber = Number(mode === 'signature' ? options.signaturePage || 1 : options.annotationPage || 1)
  if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > pdf.getPageCount()) fail(`Choose a page between 1 and ${pdf.getPageCount()}.`)
  const page = pdf.getPage(pageNumber - 1)
  const font = await pdf.embedFont(mode === 'signature' ? StandardFonts.TimesRomanItalic : StandardFonts.Helvetica)
  const size = mode === 'signature' ? 24 : 12
  page.drawText(text, { x: 54, y: Math.max(40, page.getHeight() - 110), size, font, color: rgb(0.08, 0.12, 0.24), maxWidth: page.getWidth() - 108 })
  return output(`${baseName(file)}_${mode === 'signature' ? 'signed' : 'annotated'}.pdf`, await savePdf(pdf))
}

async function fillForm(file, options) {
  const { pdf } = await loadPdf(file)
  let form
  try { form = pdf.getForm() } catch (error) { throw new Error(`Could not read interactive PDF form fields: ${error.message}`) }
  const fields = options.fields || {}
  const names = Object.keys(fields)
  if (!names.length) fail('Enter a value for at least one detected form field.')
  const known = new Map(form.getFields().map((field) => [field.getName(), field]))
  for (const name of names) {
    const field = known.get(name)
    if (!field) fail(`The form has no field named “${name}”. Refresh the field list and try again.`)
    const value = fields[name]
    try {
      if (typeof field.setText === 'function') field.setText(String(value))
      else if (typeof field.check === 'function') String(value).toLowerCase() === 'true' ? field.check() : field.uncheck()
      else if (typeof field.select === 'function') field.select(String(value))
      else fail(`Field “${name}” is not a supported text, checkbox, or choice field.`)
    } catch (error) { throw new Error(`Could not fill “${name}”: ${error.message}`) }
  }
  form.updateFieldAppearances()
  return output(`${baseName(file)}_filled.pdf`, await savePdf(pdf))
}

async function editBookmarks(file, options) {
  const { pdf } = await loadPdf(file)
  const entries = options.bookmarks
  if (!Array.isArray(entries) || !entries.length) fail('Add at least one bookmark using a page number and title.')
  const pageCount = pdf.getPageCount()
  const normalized = entries.map(({ page, title }) => {
    const pageNumber = Number(page)
    const label = String(title || '').trim()
    if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > pageCount) fail(`Bookmark page must be between 1 and ${pageCount}.`)
    if (!label) fail(`Add a title for the bookmark on page ${pageNumber}.`)
    return { pageNumber, title: label }
  })
  const context = pdf.context
  const root = context.obj({ Type: 'Outlines', Count: normalized.length })
  const rootRef = context.register(root)
  const refs = normalized.map(() => context.nextRef())
  normalized.forEach((entry, index) => {
    const item = context.obj({
      Title: PDFHexString.fromText(entry.title),
      Parent: rootRef,
      Dest: [pdf.getPages()[entry.pageNumber - 1].ref, PDFName.of('Fit')],
      ...(index > 0 ? { Prev: refs[index - 1] } : {}),
      ...(index < normalized.length - 1 ? { Next: refs[index + 1] } : {}),
    })
    context.assign(refs[index], item)
  })
  root.set(PDFName.of('First'), refs[0])
  root.set(PDFName.of('Last'), refs.at(-1))
  pdf.catalog.set(PDFName.of('Outlines'), rootRef)
  return output(`${baseName(file)}_bookmarks.pdf`, await savePdf(pdf))
}

async function processKnown(toolId, files, options, onProgress) {
  const file = files[0]
  if (['merge-pdf'].includes(toolId)) {
    requirePdf(files, 2)
    const result = await PDFDocument.create()
    for (let i = 0; i < files.length; i += 1) {
      const { pdf } = await loadPdf(files[i])
      const pages = await result.copyPages(pdf, pdf.getPageIndices())
      pages.forEach((page) => result.addPage(page))
      progress(onProgress, (i + 1) / files.length, `Merged ${i + 1} of ${files.length} files`)
    }
    return [output('merged.pdf', await savePdf(result))]
  }

  if (['split-pdf', 'extract-pages'].includes(toolId)) {
    requirePdf(files)
    const outputs = await extractGroups(file, { ...options, groupRanges: toolId === 'extract-pages' ? false : options.groupRanges, mode: toolId === 'split-pdf' ? (options.mode || options.splitMode) : undefined }, onProgress)
    if (toolId === 'extract-pages' && outputs.length !== 1) fail('Extract pages creates one PDF. Use split mode “all” to create a separate PDF for each page.')
    return outputs
  }

  if (toolId === 'duplicate-pages') {
    requirePdf(files)
    const { pdf } = await loadPdf(file)
    const count = pdf.getPageCount()
    const selected = parsePageList(options.pages ?? options.ranges, count)
    if (!selected.length) fail('Choose at least one page to duplicate.')
    const outputPdf = await PDFDocument.create()
    const repeats = Math.max(1, Math.min(20, Number(options.copies) || 1))
    const order = options.append === false ? [...Array.from({ length: count }, (_, i) => i + 1)] : [...Array.from({ length: count }, (_, i) => i + 1)]
    // Existing page order is preserved, then selected pages are appended once or more.
    const original = await outputPdf.copyPages(pdf, order.map((n) => n - 1))
    original.forEach((p) => outputPdf.addPage(p))
    for (let i = 0; i < repeats; i += 1) {
      const copies = await outputPdf.copyPages(pdf, selected.map((n) => n - 1))
      copies.forEach((p) => outputPdf.addPage(p))
    }
    return [output(`${baseName(file)}_duplicated.pdf`, await savePdf(outputPdf))]
  }

  if (toolId === 'delete-pages') {
    requirePdf(files)
    const { pdf } = await loadPdf(file)
    const removed = new Set(parsePageList(options.pages ?? options.ranges, pdf.getPageCount()))
    if (removed.size >= pdf.getPageCount()) fail('At least one page must remain in a PDF.')
    for (const n of [...removed].sort((a, b) => b - a)) pdf.removePage(n - 1)
    return [output(`${baseName(file)}_pages_removed.pdf`, await savePdf(pdf))]
  }

  if (toolId === 'organize-pdf') {
    requirePdf(files)
    const organized = await reorderPdf(file, options)
    return [output(`${baseName(file)}_organized.pdf`, organized.data)]
  }

  if (toolId === 'rotate-pages') {
    requirePdf(files)
    const { pdf } = await loadPdf(file)
    const selected = options.pages ? new Set(parsePageList(options.pages, pdf.getPageCount())) : null
    const angle = Number(options.angle ?? options.rotation ?? 90)
    if (![90, 180, 270, -90, -180, -270].includes(angle)) fail('Rotation must be 90°, 180°, or 270° clockwise.')
    pdf.getPages().forEach((page, index) => {
      if (selected && !selected.has(index + 1)) return
      page.setRotation(degrees(((page.getRotation().angle + angle) % 360 + 360) % 360))
    })
    return [output(`${baseName(file)}_rotated.pdf`, await savePdf(pdf))]
  }

  if (toolId === 'crop-pdf') { requirePdf(files); return [await cropPdf(file, options)] }
  if (toolId === 'add-watermark') { requirePdf(files); return [await applyTextOverlay(file, options, 'watermark')] }
  if (toolId === 'page-numbers') { requirePdf(files); return [await applyTextOverlay(file, options, 'numbers')] }
  if (toolId === 'pdf-editor') { requirePdf(files); return [await addVisibleText(file, options, 'annotation')] }
  if (toolId === 'sign-pdf') { requirePdf(files); return [await addVisibleText(file, options, 'signature')] }
  if (toolId === 'fill-forms') { requirePdf(files); return [await fillForm(file, options)] }
  if (toolId === 'edit-bookmarks') { requirePdf(files); return [await editBookmarks(file, options)] }

  if (toolId === 'flatten-pdf') {
    requirePdf(files)
    const { pdf } = await loadPdf(file)
    try { pdf.getForm().flatten({ updateFieldAppearances: true }) }
    catch (error) { throw new Error(`Could not flatten this PDF's interactive form fields: ${error.message}`) }
    return [output(`${baseName(file)}_flattened.pdf`, await savePdf(pdf))]
  }

  if (toolId === 'repair-pdf') {
    requirePdf(files)
    const bytes = await readFile(file)
    try {
      const toolkit = await getQpdfToolkit()
      const repaired = await toolkit.repair(bytes)
      await PDFDocument.load(repaired, { updateMetadata: false, throwOnInvalidObject: false })
      return [output(`${baseName(file)}_repaired.pdf`, repaired)]
    } catch (qpdfError) {
      try {
      const pdf = await PDFDocument.load(bytes, { updateMetadata: false, throwOnInvalidObject: false, capNumbers: false })
        const resaved = await savePdf(pdf)
        if (!resaved.length) fail('The PDF parser returned an empty file.')
        return [output(`${baseName(file)}_repaired.pdf`, resaved)]
      } catch (error) {
        throw new Error(`Automatic repair was unsuccessful. qpdf and the built-in parser could not recover this document. Details: ${qpdfError.message}; ${error.message}`)
      }
    }
  }

  if (toolId === 'pdf-to-jpg') {
    requirePdf(files)
    const doc = await getPdfJsDocument(file)
    const outputs = []
    for (let n = 1; n <= doc.numPages; n += 1) {
      outputs.push(output(`${baseName(file)}_page_${n}.${options.format === 'png' ? 'png' : 'jpg'}`, await pageToImage(doc, n, options), options.format === 'png' ? 'image/png' : JPG_MIME))
      progress(onProgress, n / doc.numPages, `Exported page ${n} of ${doc.numPages}`)
    }
    return outputs
  }

  if (toolId === 'ocr-pdf') {
    requirePdf(files)
    return [await ocrPdf(file, options, onProgress)]
  }

  if (toolId === 'jpg-to-pdf') {
    if (!files.length) fail('Choose at least one JPG or PNG image.')
    return [await imagePdf(files, options, onProgress)]
  }

  if (toolId === 'compress-pdf') {
    requirePdf(files)
    const level = options.level || options.compressLevel || 'recommended'
    if (level === 'lossless') {
      try {
        const toolkit = await getQpdfToolkit()
        const compressed = await toolkit.compress(await readFile(file))
        const delta = Math.round((compressed.byteLength / file.size - 1) * 100)
        const result = output(`${baseName(file)}_optimized.pdf`, compressed)
        result.message = delta < 0 ? `Lossless optimization reduced file size by ${Math.abs(delta)}% while preserving page content.` : delta > 0 ? `Lossless optimization preserved page content but increased file size by ${delta}%.` : 'Lossless optimization preserved page content; file size was unchanged.'
        return [result]
      } catch (error) { throw new Error(`Lossless optimization failed: ${error.message}`) }
    }
    const qualityByLevel = { extreme: 0.42, recommended: 0.68, light: 0.86 }
    const dpiByLevel = { extreme: 110, recommended: 150, light: 200 }
    const compressed = await rasterPdf(file, { dpi: options.dpi || dpiByLevel[level] || 150, quality: options.quality || qualityByLevel[level] || 0.68 }, onProgress)
    const reduction = Math.round((1 - compressed.byteLength / file.size) * 100)
    const result = output(`${baseName(file)}_compressed.pdf`, compressed)
    result.message = reduction > 0 ? `Raster recompression reduced the file by ${reduction}%. Text, vectors, links, forms, and accessibility data were flattened into page images.` : `The rasterized output is ${Math.abs(reduction)}% larger. This scan-friendly compression cannot make every PDF smaller; text, vectors, links, forms, and accessibility data were flattened.`
    return [result]
  }

  if (toolId === 'redact-pdf') {
    requirePdf(files)
    if (!Array.isArray(options.redactions) || !options.redactions.length) fail('Mark at least one redaction rectangle before applying redactions. Coordinates should be normalized from 0 to 1 with a one-based page number.')
    const redacted = await rasterPdf(file, { ...options, dpi: options.dpi || 200, quality: 1 }, onProgress, options.redactions)
    return [output(`${baseName(file)}_redacted.pdf`, redacted)]
  }

  if (toolId === 'protect-pdf') {
    requirePdf(files)
    const password = String(options.password || '')
    if (password.length < 8) fail('Choose a password with at least 8 characters.')
    if (password !== String(options.confirmPassword || '')) fail('The password confirmation does not match.')
    const toolkit = await getQpdfToolkit()
    try {
      const encrypted = await toolkit.lock(await readFile(file), { userPassword: password, ownerPassword: password, keyLength: 256 })
      return [output(`${baseName(file)}_protected.pdf`, encrypted)]
    } catch (error) { throw new Error(`Could not encrypt this PDF: ${error.message}`) }
  }

  if (toolId === 'unlock-pdf') {
    requirePdf(files)
    const password = String(options.password || '')
    if (!password) fail('Enter the current PDF password. This operation requires the file owner’s authorization and will not bypass encryption.')
    const toolkit = await getQpdfToolkit()
    try {
      const unlocked = await toolkit.unlock(await readFile(file), { password })
      return [output(`${baseName(file)}_unlocked.pdf`, unlocked)]
    } catch (error) { throw new Error(`Could not unlock this PDF with that password: ${error.message}`) }
  }

  if (toolId === 'pdf-to-word') {
    requirePdf(files)
    const pdf = await getPdfJsDocument(file)
    const { Document, Packer, Paragraph, TextRun } = await import('docx')
    const sections = []
    const pageData = []
    const scannedPages = []
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber)
      const viewport = page.getViewport({ scale: 1 })
      const content = await page.getTextContent()
      const items = content.items.filter((item) => 'str' in item && item.str.trim())
      const styles = content.styles || {}
      if (!items.length) scannedPages.push(pageNumber)
      pageData.push({ pageNumber, width: viewport.width, height: viewport.height, items, styles })
    }

    // Use OCR only for pages with no extractable text layer. OCR output remains
    // normal editable Word text instead of a screenshot of the page.
    let ocrPages = []
    if (scannedPages.length) {
      const extracted = await extractTextByPage(file, options, onProgress)
      ocrPages = scannedPages.map((number) => extracted[number - 1] || [])
    }
    let scannedIndex = 0
    let previousProgress = 0
    for (const pageInfo of pageData) {
      const { pageNumber, width: pageWidth, height: pageHeight, items, styles } = pageInfo
      let paragraphs = []
      if (items.length) {
        const rows = []
        for (const item of items) {
          const baseline = Number(item.transform?.[5]) || 0
          const fontSize = Math.max(5, Math.min(96, Math.hypot(Number(item.transform?.[0]) || 0, Number(item.transform?.[1]) || 0) || Number(item.height) || 10))
          let row = rows.find((entry) => Math.abs(entry.baseline - baseline) <= Math.max(1.5, Math.min(4, fontSize * 0.22)))
          if (!row) {
            row = { baseline, items: [], fontSize }
            rows.push(row)
          }
          row.items.push({ item, x: Number(item.transform?.[4]) || 0, width: Number(item.width) || 0, fontSize })
          row.fontSize = Math.max(row.fontSize, fontSize)
          row.baseline = (row.baseline * (row.items.length - 1) + baseline) / row.items.length
        }
        rows.sort((a, b) => b.baseline - a.baseline)
        let previousBaseline = pageHeight
        paragraphs = rows.map((row) => {
          row.items.sort((a, b) => a.x - b.x)
          const firstX = Math.max(0, row.items[0]?.x || 0)
          const runs = []
          let endX = firstX
          for (const part of row.items) {
            const gap = part.x - endX
            if (gap > part.fontSize * 0.18) {
              const spaces = Math.max(1, Math.min(64, Math.round(gap / Math.max(1.5, part.fontSize * 0.25))))
              runs.push(new TextRun({ text: ' '.repeat(spaces) }))
            }
            const item = part.item
            const style = styles[item.fontName] || {}
            const fontName = String(style.fontFamily || item.fontName || 'Arial').replace(/^\w{6}\+/, '')
            const descriptor = `${fontName} ${item.fontName || ''}`
            runs.push(new TextRun({
              text: item.str,
              font: fontName,
              size: Math.round(part.fontSize * 2),
              bold: /bold|black|heavy|demi|semibold/i.test(descriptor),
              italics: /italic|oblique/i.test(descriptor),
            }))
            endX = Math.max(endX, part.x + part.width)
          }
          const before = Math.max(0, Math.round((previousBaseline - row.baseline - row.fontSize * 1.15) * 20))
          previousBaseline = row.baseline
          return new Paragraph({
            indent: { left: Math.round(firstX * 20) },
            spacing: { before, after: 0 },
            children: runs,
          })
        })
      } else {
        const lines = ocrPages[scannedIndex++] || []
        paragraphs = lines.map((line) => new Paragraph({
          spacing: { before: 0, after: 80 },
          children: [new TextRun({ text: line, font: 'Arial', size: 20 })],
        }))
      }
      if (!paragraphs.length) paragraphs = [new Paragraph('')]
      sections.push({
        properties: {
          page: {
            size: { width: Math.round(pageWidth * 20), height: Math.round(pageHeight * 20) },
            margin: { top: 0, right: 0, bottom: 0, left: 0 },
          },
        },
        children: paragraphs,
      })
      const value = pageNumber / pdf.numPages
      if (value > previousProgress) progress(onProgress, value, `Rebuilding editable text on page ${pageNumber} of ${pdf.numPages}`)
      previousProgress = value
    }
    const doc = new Document({ sections })
    const blob = await Packer.toBlob(doc)
    const result = output(`${baseName(file)}.docx`, new Uint8Array(await blob.arrayBuffer()), DOCX_MIME)
    result.message = 'PDF text is editable in Word. Font styling and approximate text placement are retained; scanned pages use OCR and complex layouts may need cleanup.'
    return [result]
  }

  if (toolId === 'word-to-pdf') {
    if (!file) fail('Choose a .docx file first. This converter accepts DOCX; legacy .doc files are unsupported.')
    if (!/\.docx$/i.test(file.name || '') && file.type !== DOCX_MIME) fail('Choose a .docx document. Legacy .doc files need Microsoft Word or LibreOffice to convert.')
    try {
      const mammoth = await import('mammoth')
      const pages = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })
      const content = pages.value.split(/\n\s*\n/).map((p) => [p.trim()]).filter((p) => p[0])
      if (!content.length) fail('No text could be extracted from this DOCX file.')
      const result = await textPdf(content, `${baseName(file)}.pdf`, options)
      result.message = 'Basic text-only conversion. Original fonts, images, tables, page layout, headers, and footers are not preserved.'
      return [result]
    } catch (error) { throw new Error(`Could not convert this DOCX: ${error.message}`) }
  }

  if (toolId === 'pdf-to-excel') {
    requirePdf(files)
    const pages = await extractTextByPage(file, options, onProgress)
    const rows = parseTables(pages)
    const XLSX = await import('xlsx')
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'Extracted text')
    const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' })
    return [output(`${baseName(file)}.xlsx`, bytes, XLSX_MIME)]
  }

  if (toolId === 'excel-to-pdf') {
    if (!file) fail('Choose an .xlsx or .csv spreadsheet first.')
    const XLSX = await import('xlsx')
    const workbook = XLSX.read(await readFile(file), { type: 'array' })
    const pages = workbook.SheetNames.map((sheetName) => {
      const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, raw: false })
      return [sheetName, ...rows.map((row) => row.map((v) => String(v ?? '')).join('  |  '))]
    }).filter((lines) => lines.length > 1)
    if (!pages.length) fail('No non-empty worksheet data was found.')
    const result = await textPdf(pages, `${baseName(file)}.pdf`, options)
    result.message = 'Basic text-only export. Cell formatting, formulas, charts, images, print areas, and sheet sizing are not preserved.'
    return [result]
  }

  const unsupported = {
  }
  if (unsupported[toolId]) fail(unsupported[toolId])
  fail(`“${TOOL_NAMES[toolId] || toolId || 'This tool'}” is not supported by the local processing engine.`)
}

/**
 * Process a tool using in-memory browser File objects.
 *
 * Common options: pages/ranges (one-based list like "1-3, 5"). Tool options:
 * split-pdf: mode ('range'|'all'), ranges, groupRanges (default true)
 * duplicate-pages: pages/ranges, copies (1-20, appended to originals)
 * rotate-pages: angle/rotation (90, 180, 270), optional pages
 * crop-pdf: top/bottom/left/right in mm (or unit:'pt'), optional pages
 * add-watermark: text/watermarkText, opacity (0..1), angle, fontSize, pages
 * page-numbers: startNumber/startAt, format ('{n}' tokens {n}/{total}), position, fontSize, pages
 * pdf-to-jpg: dpi (72..300), quality (0..1), format ('jpg'|'png')
 * jpg-to-pdf: pageSize ('a4'|'letter'|image-sized), marginPt
 * compress-pdf: level ('extreme'|'recommended'|'light'), dpi, quality
 * redact-pdf: redactions [{page, x, y, width, height, normalized?}], dpi
 * word-to-pdf/excel-to-pdf: fontSize
 */
export async function processTool({ toolId, files = [], options = {}, onProgress } = {}) {
  if (!toolId) fail('Choose a PDF tool first.')
  try {
    const outputs = await processKnown(toolId, files, options || {}, onProgress)
    return { outputs, message: outputs.find((item) => item.message)?.message }
  } catch (error) {
    if (error instanceof Error) throw error
    throw new Error(String(error))
  }
}

/** Read the file name, byte size, page count, and page dimensions from a real PDF. */
export async function inspectPdf(file) {
  const bytes = await readFile(file)
  const doc = await getPdfJsDocument(bytes)
  const pages = []
  for (let n = 1; n <= doc.numPages; n += 1) {
    const page = await doc.getPage(n)
    const { width, height } = page.getViewport({ scale: 1 })
    pages.push({ pageNumber: n, width, height, rotation: page.rotate })
  }
  return { name: file.name || 'document.pdf', size: bytes.byteLength, pageCount: doc.numPages, pages }
}

/** Render one PDF page into a supplied canvas for interactive page tools. */
export async function renderPdfPage(file, pageNumber, canvas, scale = 1) {
  const doc = await getPdfJsDocument(file)
  const number = Number(pageNumber)
  if (!Number.isInteger(number) || number < 1 || number > doc.numPages) fail(`Choose a page between 1 and ${doc.numPages}.`)
  const page = await doc.getPage(number)
  const viewport = page.getViewport({ scale: Math.max(0.5, Math.min(2, Number(scale) || 1)) })
  canvas.width = Math.ceil(viewport.width)
  canvas.height = Math.ceil(viewport.height)
  const context = canvas.getContext('2d', { alpha: false })
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  await page.render({ canvas, canvasContext: context, viewport }).promise
  return { width: canvas.width, height: canvas.height, pageCount: doc.numPages }
}

/** Return AcroForm field details that can be edited in the Fill Forms tool. */
export async function inspectPdfForm(file) {
  const { pdf } = await loadPdf(file)
  const form = pdf.getForm()
  return form.getFields().map((field) => {
    const type = field.constructor.name
    let value = ''
    try { value = typeof field.getText === 'function' ? field.getText() || '' : typeof field.isChecked === 'function' ? field.isChecked() : typeof field.getSelected === 'function' ? field.getSelected() || '' : '' } catch { /* Leave unsupported field values empty for editing. */ }
    let choices = []
    try { choices = typeof field.getOptions === 'function' ? field.getOptions() : [] } catch { /* Some field types have no option list. */ }
    return { name: field.getName(), type, value, choices }
  })
}

/** Create a blank PDF; pageSize may be 'a4', 'letter', or [widthPt, heightPt]. */
export async function createBlankPdf({ pageSize = 'a4', orientation = 'portrait', pageCount = 1 } = {}) {
  const sizes = { a4: [595.28, 841.89], letter: [612, 792], legal: [612, 1008] }
  let size = Array.isArray(pageSize) ? pageSize.map(Number) : sizes[String(pageSize).toLowerCase()]
  if (!size || size.length !== 2 || size.some((v) => !Number.isFinite(v) || v <= 0)) fail('Choose a4, letter, legal, or a [widthPt, heightPt] page size.')
  if (!['portrait', 'landscape'].includes(orientation)) fail('Orientation must be portrait or landscape.')
  if ((orientation === 'landscape' && size[0] < size[1]) || (orientation === 'portrait' && size[0] > size[1])) size = [size[1], size[0]]
  const count = Math.floor(Number(pageCount))
  if (!Number.isInteger(count) || count < 1 || count > 500) fail('Page count must be between 1 and 500.')
  const pdf = await PDFDocument.create()
  for (let i = 0; i < count; i += 1) pdf.addPage(size)
  return output('blank.pdf', await savePdf(pdf))
}

/** Create a blank document with optional PDF metadata; returns the PDF bytes. */
export async function createDocument({ pageSize = 'a4', orientation = 'portrait', pageCount = 1, title = '' } = {}) {
  const blank = await createBlankPdf({ pageSize, orientation, pageCount })
  const pdf = await PDFDocument.load(blank.data)
  if (title) pdf.setTitle(String(title))
  return savePdf(pdf)
}
