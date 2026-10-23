import { resolveFontFamilyStack } from "./editor/fonts.js"
import { extractTextColorStyles } from './editor/pdfTextColors.js'
import { abortable } from './editor/cancellation'
import { detectTextFormCandidates } from './editor/formDetection'
import { addOcrWords } from './editor/ocrTextLayer'
import { commitOperations, fontAssets } from './editor/commit'
import { displayFrame, pdfRect, reframeRegion } from './editor/coordinates'
import { captureImagePlacement } from './editor/imageCapture'
import { PDFDocument, PDFHexString, PDFName, StandardFonts, rgb, degrees, pushGraphicsState, popGraphicsState, concatTransformationMatrix } from 'pdf-lib'
import 'regenerator-runtime/runtime'
import './mapCompat'
import * as pdfjs from 'pdfjs-dist'
import pdfWorkerUrl from './pdfWorkerCompat.js?worker&url'
import qpdfWasmUrl from 'pdfstudio/qpdf.wasm?url'
import { compressPdfBytes, optimizePdfDocument, optimizePdfType1Fonts, recompressPdfImages } from './pdfCompression'

// This module intentionally owns no UI state or filesystem access. All inputs and
// outputs are in-memory browser File/Uint8Array values so it can run in a renderer.
pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl
const pdfImageWasmUrl = new URL('./pdfjs/wasm/', document.baseURI).href


const PDF_MIME = 'application/pdf'
const JPG_MIME = 'image/jpeg'
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
let qpdfToolkitPromise
async function textFont(doc, text, standard = StandardFonts.Helvetica) {
  const {resolveFont} = await import('./editor/fonts')
  const style = {fontFamily:standard, bold:/Bold/i.test(standard), italic:/Italic|Oblique/i.test(standard)}
  try {return await resolveFont(doc,text,style)} catch {return resolveFont(doc,text,style,await fontAssets())}
}

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
  'pdf-to-pptx': 'PDF to PowerPoint', 'powerpoint-to-pdf': 'PowerPoint to PDF', 'compress-pdf': 'Compress PDF',
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
  if (Number(file.size) > 512 * 1024 * 1024) fail('This file is larger than the 512 MB processing limit. Split it into smaller files and try again.')
  return new Uint8Array(await file.arrayBuffer())
}

function output(name, data, mimeType = PDF_MIME) {
  return { name, data: asBytes(data), mimeType }
}

function baseName(file) {
  return (file?.name || 'document').replace(/\.[^.]+$/, '')
}

function wrapTextToWidth(text, font, fontSize, maxWidth) {
  const outputLines = []
  for (const sourceLine of String(text).split(/\r?\n/)) {
    const words = sourceLine.trim().split(/\s+/).filter(Boolean)
    if (!words.length) { outputLines.push(''); continue }
    const splitWord = (word) => {
      if (font.widthOfTextAtSize(word, fontSize) <= maxWidth) return [word]
      const pieces = []
      let piece = ''
      for (const character of word) {
        if (piece && font.widthOfTextAtSize(piece + character, fontSize) > maxWidth) { pieces.push(piece); piece = character }
        else piece += character
      }
      if (piece) pieces.push(piece)
      return pieces
    }
    const expandedWords = words.flatMap(splitWord)
    let line = expandedWords.shift()
    for (const word of expandedWords) {
      const candidate = `${line} ${word}`
      if (font.widthOfTextAtSize(candidate, fontSize) <= maxWidth) line = candidate
      else { outputLines.push(line); line = word }
    }
    outputLines.push(line)
  }
  return outputLines
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

const pdfJsDocumentCache = new WeakMap()
const pdfJsLoadingTasks = new WeakMap()
const pdfCanvasRenderTasks = new WeakMap()
const pdfCanvasRenderVersions = new WeakMap()
const pdfCanvasQueuedJobs = new WeakMap()
const pdfTextLayerTasks = new WeakMap()
const pdfTextLayerMetadata = new WeakMap()
const pdfTextLayerVersions = new WeakMap()
const pdfTextPageCache = new WeakMap()
const pdfSearchTextCache = new WeakMap()
const pdfSearchResultCache = new WeakMap()
const pdfOutlineCache = new WeakMap()
const pdfLinkCache = new WeakMap()
const pdfFormWidgetCache = new WeakMap()
const canvasRenderQueue = []
let canvasRenderSequence = 0
let activeCanvasRenders = 0
const MAX_ACTIVE_CANVAS_RENDERS = 2

function pumpCanvasRenderQueue() {
  while (activeCanvasRenders < MAX_ACTIVE_CANVAS_RENDERS && canvasRenderQueue.length) {
    canvasRenderQueue.sort((a, b) => a.priority - b.priority || a.sequence - b.sequence)
    const job = canvasRenderQueue.shift()
    if (job.cancelled) continue
    activeCanvasRenders += 1
    job.started = true
    Promise.resolve().then(job.run).then(job.resolve, job.reject).finally(() => {
      activeCanvasRenders = Math.max(0, activeCanvasRenders - 1)
      if (pdfCanvasQueuedJobs.get(job.canvas) === job) pdfCanvasQueuedJobs.delete(job.canvas)
      pumpCanvasRenderQueue()
    })
  }
}

function cancelQueuedCanvasJob(canvas) {
  const queued = canvas && pdfCanvasQueuedJobs.get(canvas)
  if (!queued || queued.started) return
  queued.cancelled = true
  pdfCanvasQueuedJobs.delete(canvas)
  const index = canvasRenderQueue.indexOf(queued)
  if (index >= 0) canvasRenderQueue.splice(index, 1)
  queued.resolve({ status: 'CANCELLED', cancelled: true })
}

function enqueueCanvasRender(canvas, priority, run) {
  cancelQueuedCanvasJob(canvas)
  return new Promise((resolve, reject) => {
    const job = { canvas, priority: Number(priority) || 0, sequence: canvasRenderSequence++, run, resolve, reject, cancelled: false, started: false }
    pdfCanvasQueuedJobs.set(canvas, job)
    canvasRenderQueue.push(job)
    pumpCanvasRenderQueue()
  })
}

async function getPdfJsDocument(fileOrBytes) {
  try {
    if (!(fileOrBytes instanceof Uint8Array) && fileOrBytes && typeof fileOrBytes === 'object') {
      const cached = pdfJsDocumentCache.get(fileOrBytes)
      if (cached) return await cached
      const pending = readFile(fileOrBytes).then((data) => {
        const task = pdfjs.getDocument({ data: data.slice(), fontExtraProperties: true, wasmUrl: pdfImageWasmUrl })
        task.onPassword = (update,reason) => { window.dispatchEvent(new CustomEvent('pdfking-password',{detail:{incorrect:reason===pdfjs.PasswordResponses.INCORRECT_PASSWORD,resolve:password=>{if(password===null)void task.destroy();else{fileOrBytes.pdfPassword=password;update(password)}}}})) }
        pdfJsLoadingTasks.set(fileOrBytes, task)
        return task.promise
      }).catch((error) => { pdfJsDocumentCache.delete(fileOrBytes); pdfJsLoadingTasks.delete(fileOrBytes); throw error })
      pdfJsDocumentCache.set(fileOrBytes, pending)
      return await pending
    }
    const data = fileOrBytes instanceof Uint8Array ? fileOrBytes : await readFile(fileOrBytes)
    const task = pdfjs.getDocument({ data: data.slice(), fontExtraProperties: true, wasmUrl: pdfImageWasmUrl })
    return await task.promise
  } catch (error) { throw pdfError(error, 'read this PDF') }
}

export function disposePdfFile(file) {
  const task = pdfJsLoadingTasks.get(file)
  pdfJsLoadingTasks.delete(file)
  pdfJsDocumentCache.delete(file)
  if (task) void task.destroy().catch(() => {})
}

async function renderPage(doc, pageNumber, scale = 1.5) {
  const page = await doc.getPage(pageNumber)
  const viewport = page.getViewport({ scale })
  if (viewport.width * viewport.height > 80_000_000) fail('This page exceeds the 80 megapixel rendering limit. Reduce the output DPI and try again.')
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

function canvasPngDataUrl(canvas) {
  return canvas.toDataURL('image/png')
}

function pptxFontFace(font, style) {
  const raw = String(font?.name || style?.fontFamily || 'Arial').replace(/^[A-Z0-9]{6}\+/, '').trim()
  if (!raw || /^(?:g_[a-z\d_]+|sans-serif|serif|monospace)$/i.test(raw)) return 'Arial'
  const aliases = { ArialMT: 'Arial', Helvetica: 'Arial', Times: 'Times New Roman', TimesNewRomanPSMT: 'Times New Roman', Courier: 'Courier New', CourierNewPSMT: 'Courier New' }
  return aliases[raw] || raw.replace(/[-_](?:regular|roman|bolditalic|boldoblique|bold|italic|oblique|medium)$/i, '')
}

function pdfTextStyle(item, style, font) {
  const fontNames = `${font?.name || ''} ${font?.fallbackName || ''} ${style?.fontFamily || ''}`
  const weight = Number(style?.fontWeight || font?.cssFontInfo?.fontWeight)
  return {
    fontFace: pptxFontFace(font, style),
    bold: Boolean(font?.bold || font?.black || (Number.isFinite(weight) && weight >= 600) || /bold|black|heavy|demi|semibold/i.test(fontNames)),
    italic: Boolean(font?.italic || /italic|oblique|slanted/i.test(fontNames)),
  }
}

async function rasterPdf(file, options, onProgress, redactions = null) {
  const doc = await getPdfJsDocument(file)
  const outputPdf = await PDFDocument.create()
  const dpi = Math.max(96, Math.min(300, Number(options.dpi) || (redactions ? 200 : 144)))
  const quality = Math.max(0.25, Math.min(1, Number(options.quality) || 0.8))
  const list = redactions || []
  const sourcePdf = redactions ? (await loadPdf(file)).pdf : null
  for (let n = 1; n <= doc.numPages; n += 1) {
    if (redactions && !list.some(rect => Number(rect.page) === n)) { const [copy] = await outputPdf.copyPages(sourcePdf, [n-1]); outputPdf.addPage(copy); continue }
    const { canvas, viewport } = await renderPage(doc, n, dpi / 72)
    if (redactions) {
      // Masks are painted into pixels before embedding. Rebuilt affected pages
      // contain no source text/image objects; unaffected pages remain original
      // PDF pages. This is page-content removal, not a catalog-wide sanitization.
      const ctx = canvas.getContext('2d')
      const masks = list.filter((rect) => Number(rect.page) === n)
      for (const mark of masks) {
        const rect = mark.normalized !== false ? reframeRegion(sourcePdf.getPage(n-1),mark) : mark
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
      line.push({ x: item.transform?.[4] ?? 0, width: Number(item.width) || 0, text: item.str })
      rows.set(y, line)
    }
    const lines = [...rows.entries()].sort((a, b) => b[0] - a[0]).map(([, items]) => {
      let end = null
      return items.sort((a, b) => a.x - b.x).map((part) => {
        const gap = end == null ? 0 : part.x - end
        const separator = gap > 26 ? '  |  ' : gap > 10 ? '  ' : ' '
        end = part.x + (part.width || part.text.length * 3)
        return `${separator}${part.text}`
      }).join('').trim()
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
      const creation = createWorker(options.language || 'eng', 1, {
      workerPath:new URL('ocr/worker.min.js',document.baseURI).href, corePath:new URL('ocr/',document.baseURI).href, langPath:new URL('ocr/',document.baseURI).href, workerBlobURL:false,
        workerPath:new URL('ocr/worker.min.js',document.baseURI).href, corePath:new URL('ocr/',document.baseURI).href, langPath:new URL('ocr/',document.baseURI).href, workerBlobURL:false,
        logger: (state) => {
          const percent = Number(state.progress) || 0
          progress(onProgress, (currentPageIndex + percent) / imagePages.length, state.status === 'recognizing text' ? `Recognizing text on scanned page ${imagePages[currentPageIndex]} of ${doc.numPages}` : `Loading OCR ${state.status || 'engine'}…`)
        },
      })
      creation.then(created=>{if(options.signal?.aborted)void created.terminate()}).catch(()=>{})
    worker = await abortable(creation,options.signal)
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
  const { pdf: outputPdf } = await loadPdf(file)
  const sourceDoc = await getPdfJsDocument(file)
  const imagePages = []
  for (let n = 1; n <= sourceDoc.numPages; n += 1) {
    const page = await sourceDoc.getPage(n)
    const content = await page.getTextContent()
    if (!content.items.some((item) => 'str' in item && item.str.trim())) imagePages.push(n)
  }
  if (!imagePages.length) fail('This PDF already contains selectable text on every page.')

  let worker
  let currentPageIndex = 0
  let recognizedWords = 0
  try {
    progress(onProgress, 0, 'Loading the OCR engine and language data…')
    const { createWorker } = await import('tesseract.js')
    const creation = createWorker(options.language || 'eng', 1, {
      workerPath:new URL('ocr/worker.min.js',document.baseURI).href, corePath:new URL('ocr/',document.baseURI).href, langPath:new URL('ocr/',document.baseURI).href, workerBlobURL:false,
      logger: (state) => {
        if(options.signal?.aborted)return
        const percent = Number(state.progress) || 0
        progress(onProgress, (currentPageIndex + percent) / imagePages.length, state.status === 'recognizing text' ? `Recognizing text on scanned page ${imagePages[currentPageIndex]} of ${sourceDoc.numPages}` : `Loading OCR ${state.status || 'engine'}…`)
      },
    })
    creation.then(created=>{if(options.signal?.aborted)void created.terminate()}).catch(()=>{})
    worker = await abortable(creation,options.signal)
    const dpi = Math.max(120, Math.min(300, Number(options.ocrDpi || options.dpi) || 200))
    const scale = dpi / 72
    const font = await textFont(outputPdf, options.language === 'hin' ? 'हिंदी' : 'OCR')
    for (let index = 0; index < imagePages.length; index += 1) {
      currentPageIndex = index
      const pageNumber = imagePages[index]
      progress(onProgress, index / imagePages.length, `Preparing scanned page ${pageNumber} of ${sourceDoc.numPages} for OCR…`)
      const { canvas } = await renderPage(sourceDoc, pageNumber, scale)
      options.signal?.throwIfAborted()
      const terminate=()=>void worker.terminate()
      options.signal?.addEventListener('abort',terminate,{once:true})
      let data
      try { ({data}=await abortable(worker.recognize(canvas, {}, { blocks: true }),options.signal,terminate)) } finally {options.signal?.removeEventListener('abort',terminate)}
      const page = outputPdf.getPage(pageNumber - 1)
      const words = data.words || (data.blocks || []).flatMap(block => (block.paragraphs || []).flatMap(paragraph => (paragraph.lines || []).flatMap(line => line.words || [])))
      recognizedWords += addOcrWords(page, words, font, canvas.width, canvas.height)
      canvas.width = canvas.height = 0

    }
  } catch (error) {
    if(error?.name==='AbortError')throw error
    throw new Error(`OCR could not create a searchable PDF: ${error?.message || error}`)
  } finally {
    if (worker) await worker.terminate()
  }
  if (!recognizedWords) fail('OCR did not recognize any text in this PDF.')
  progress(onProgress, 1, 'Adding searchable text to the original PDF…')
  return output(`${baseName(file)}_searchable.pdf`, await savePdf(outputPdf))
}

async function textPdf(textPages, fileName, options = {}) {
  const doc = await PDFDocument.create()
  const allText = textPages.flat().join('\n')
  const font = await textFont(doc, allText)
  const fontSize = Math.min(12, Math.max(8, Number(options.fontSize) || 10))
  for (const lines of textPages) {
    let page = doc.addPage([612, 792])
    let y = 750
    for (const sourceLine of lines) {
      const chunks = String(sourceLine).match(/.{1,92}(?:\s|$)|.{1,92}/g) || [String(sourceLine)]
      for (const raw of chunks) {
        if (y < 45) { page = doc.addPage([612, 792]); y = 750 }
        page.drawText(raw.trim(), { x: 48, y, size: fontSize, font, color: rgb(0.08, 0.08, 0.08), maxWidth: 516 })
        y -= fontSize * 1.55
      }
    }
  }
  return output(fileName, await savePdf(doc))
}

async function docxHtmlPdf(html, fileName, tableWidths = []) {
  const doc = await PDFDocument.create()
  const fonts = {
    normal: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    italic: await doc.embedFont(StandardFonts.HelveticaOblique),
    boldItalic: await doc.embedFont(StandardFonts.HelveticaBoldOblique),
  }
  const textFonts = new Map()
  const pageWidth = 612, pageHeight = 792, margin = 54, contentWidth = pageWidth - margin * 2
  let page, y
  const newPage = () => { page = doc.addPage([pageWidth, pageHeight]); y = pageHeight - margin }
  const ensureSpace = (height) => { if (!page || y - height < margin) newPage() }
  const addBlock = async (element, defaults = {}) => {
    const headingLevel = /^H[1-6]$/.test(element.tagName) ? Number(element.tagName[1]) : null
    const size = defaults.size || (headingLevel ? [22, 18, 15, 13, 11, 10][headingLevel - 1] : 10)
    const before = headingLevel ? 9 : 1
    const after = headingLevel ? 5 : 7
    const lineHeight = size * 1.35
    // Mammoth emits embedded DOCX pictures as data URLs. Preserve those assets
    // in the PDF instead of reducing them to their alt text.
    const images = [...element.querySelectorAll('img')]
    for (const imageElement of images) {
      const source = imageElement.getAttribute('src') || ''
      const match = source.match(/^data:(image\/(?:png|jpe?g));base64,([\s\S]+)$/i)
      if (!match) continue
      try {
        const bytes = Uint8Array.from(atob(match[2]), (char) => char.charCodeAt(0))
        const image = /^image\/png$/i.test(match[1]) ? await doc.embedPng(bytes) : await doc.embedJpg(bytes)
        const maxWidth = contentWidth
        const maxHeight = pageHeight - margin * 2
        const points = (value) => {
          const match = String(value || '').trim().match(/^([\d.]+)\s*(px|pt|in|cm)?$/i)
          if (!match) return null
          const amount = Number(match[1])
          return match[2]?.toLowerCase() === 'in' ? amount * 72 : match[2]?.toLowerCase() === 'cm' ? amount * 72 / 2.54 : match[2]?.toLowerCase() === 'px' ? amount * 0.75 : amount
        }
        const requestedWidth = points(imageElement.getAttribute('width') || imageElement.style.width)
        const requestedHeight = points(imageElement.getAttribute('height') || imageElement.style.height)
        const scale = Math.min(maxWidth / image.width, maxHeight / image.height, requestedWidth ? requestedWidth / image.width : 1, requestedHeight ? requestedHeight / image.height : 1)
        const width = image.width * scale, height = image.height * scale
        const paragraph = imageElement.closest('p')
        const align = paragraph?.classList.contains('pdf-center') ? 'center' : paragraph?.classList.contains('pdf-right') ? 'right' : 'left'
        const x = margin + (align === 'center' ? (contentWidth - width) / 2 : align === 'right' ? contentWidth - width : 0)
        ensureSpace(height + 8)
        y -= height
        page.drawImage(image, { x, y, width, height })
        y -= 8
      } catch (cause) {
        throw new Error(`Could not render an embedded DOCX image: ${cause?.message || 'unsupported image data'}`)
      }
    }
    const runs = []
    const walk = (node, style = {}) => {
      if (node.nodeType === Node.TEXT_NODE) {
        const value = node.nodeValue.replace(/\s+/g, ' ')
        if (value) runs.push({ text: value, ...style })
        return
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return
      if (node.tagName === 'BR') { runs.push({ text: '\n', ...style }); return }
      if (node.tagName === 'UL' || node.tagName === 'OL') return
      if (node.tagName === 'IMG') return
      const next = { ...style, bold: style.bold || ['B', 'STRONG', 'TH'].includes(node.tagName), italic: style.italic || ['I', 'EM'].includes(node.tagName) }
      for (const child of node.childNodes) {
        if (['TD', 'TH'].includes(child.tagName) && runs.length) runs.push({ text: '    ', ...next })
        walk(child, next)
      }
    }
    walk(element, { bold: !!headingLevel })
    const words = []
    for (const run of runs) for (const part of run.text.split(/(\n|\s+)/).filter(Boolean)) words.push({ ...run, text: part })
    const lines = []
    let line = [], lineWidth = 0
    for (const word of words) {
      if (word.text === '\n') { if (line.length) lines.push(line); line = []; lineWidth = 0; continue }
      const standard = word.bold ? (word.italic ? StandardFonts.HelveticaBoldOblique : StandardFonts.HelveticaBold) : (word.italic ? StandardFonts.HelveticaOblique : StandardFonts.Helvetica)
      const key = /[\u0900-\u097f]/u.test(word.text) ? 'NotoDevanagari' : standard
      if (!textFonts.has(key)) textFonts.set(key, textFont(doc, word.text, standard))
      const font = await textFonts.get(key)
      if (/^\s+$/.test(word.text)) {
        if (line.length) { line.push({ ...word, font }); lineWidth += font.widthOfTextAtSize(word.text, size) }
        continue
      }
      const pieces = []
      let piece = ''
      for (const character of Array.from(word.text)) {
        const next = piece + character
        if (piece && font.widthOfTextAtSize(next, size) > contentWidth) { pieces.push(piece); piece = character }
        else piece = next
      }
      if (piece) pieces.push(piece)
      for (const part of pieces) {
        const width = font.widthOfTextAtSize(part, size)
        if (line.length && lineWidth + width > contentWidth) { lines.push(line); line = []; lineWidth = 0 }
        line.push({ ...word, text: part, font }); lineWidth += width
      }
    }
    if (line.length) lines.push(line)
    ensureSpace(before + lineHeight + after)
    y -= before
    for (const row of lines) {
      ensureSpace(lineHeight)
      // Wrapping can leave a space at the end of a line. Align visible text,
      // rather than including that invisible width in the centering calculation.
      while (row.length && /^\s+$/.test(row[row.length - 1].text)) row.pop()
      const rowWidth = row.reduce((sum, item) => sum + item.font.widthOfTextAtSize(item.text, size), 0)
      const align = defaults.align || (element.classList.contains('pdf-center') ? 'center' : element.classList.contains('pdf-right') ? 'right' : 'left')
      let x = margin + (defaults.indent || 0) + (align === 'center' ? Math.max(0, contentWidth - rowWidth) / 2 : align === 'right' ? Math.max(0, contentWidth - rowWidth) : 0)
      if (defaults.bullet) {
        page.drawText(defaults.bullet, { x, y, size, font: fonts.normal, color: rgb(0.08, 0.08, 0.08) })
        x += 15
      }
      for (const item of row) {
        page.drawText(item.text, { x, y, size, font: item.font, color: rgb(0.08, 0.08, 0.08) })
        x += item.font.widthOfTextAtSize(item.text, size)
      }
      y -= lineHeight
    }
    y -= after
  }
  const root = new DOMParser().parseFromString(html, 'text/html').body
  const htmlTables = [...root.querySelectorAll('table')]
  const scaledTableWidths = htmlTables.map((_, index) => {
    const columns = tableWidths[index]
    if (!columns?.length || columns.some((width) => !(width > 0))) return null
    const total = columns.reduce((sum, width) => sum + width, 0)
    return columns.map((width) => contentWidth * width / total)
  })
  let tableIndex = 0
  const renderTable = (table) => {
    const rows = [...table.querySelectorAll('tr')].map((row) => [...row.children].filter((cell) => ['TD', 'TH'].includes(cell.tagName)))
    const columnCount = Math.max(0, ...rows.map((row) => row.length))
    if (!columnCount) return
    const widths = scaledTableWidths[tableIndex++]
    const columnWidths = widths?.length === columnCount ? widths : Array(columnCount).fill(contentWidth / columnCount)
    const fontSize = 9, lineHeight = 12
    for (const cells of rows) {
      const prepared = Array.from({ length: columnCount }, (_, index) => {
        const cell = cells[index]
        const paragraphs = cell ? [...cell.querySelectorAll('p')].map((item) => item.innerText.trim()).filter(Boolean) : []
        const text = (paragraphs.length ? paragraphs : [cell?.innerText || '']).join('\n')
        const paragraph = cell?.querySelector('p')
        const align = paragraph?.classList.contains('pdf-center') ? 'center' : paragraph?.classList.contains('pdf-right') ? 'right' : 'left'
        const font = cell?.tagName === 'TH' || cell?.querySelector('strong,b') ? fonts.bold : cell?.querySelector('em,i') ? fonts.italic : fonts.normal
        const lines = []
        let current = ''
        for (const sourceLine of text.split(/\r?\n/)) {
          if (current) { lines.push(current); current = '' }
          for (let word of sourceLine.split(/\s+/).filter(Boolean)) {
            const maxWidth = Math.max(1, columnWidths[index] - 10)
            if (font.widthOfTextAtSize(word, fontSize) > maxWidth) {
              let piece = ''
              const pieces = []
              for (const character of word) {
                if (piece && font.widthOfTextAtSize(piece + character, fontSize) > maxWidth) { pieces.push(piece); piece = character }
                else piece += character
              }
              if (piece) pieces.push(piece)
              word = pieces.join(' ')
            }
            for (const part of word.split(' ')) {
              const candidate = current ? `${current} ${part}` : part
              if (current && font.widthOfTextAtSize(candidate, fontSize) > columnWidths[index] - 10) { lines.push(current); current = part }
              else current = candidate
            }
          }
        }
        if (current) lines.push(current)
        return { lines, font, align }
      })
      const maxLines = Math.max(1, ...prepared.map((cell) => cell.lines.length))
      const linesPerPage = Math.max(1, Math.floor((pageHeight - margin * 2 - 8) / lineHeight))
      for (let offset = 0; offset < maxLines; offset += linesPerPage) {
        const chunkLines = Math.min(linesPerPage, maxLines - offset)
        const height = Math.max(20, chunkLines * lineHeight + 8)
        ensureSpace(height)
        const top = y
        prepared.forEach((cell, index) => {
          const x = margin + columnWidths.slice(0, index).reduce((sum, width) => sum + width, 0)
          cell.lines.slice(offset, offset + linesPerPage).forEach((line, lineIndex) => {
            const textWidth = cell.font.widthOfTextAtSize(line, fontSize)
            const textX = cell.align === 'center' ? x + Math.max(5, (columnWidths[index] - textWidth) / 2) : cell.align === 'right' ? x + Math.max(5, columnWidths[index] - textWidth - 5) : x + 5
            page.drawText(line, { x: textX, y: top - 14 - lineIndex * lineHeight, size: fontSize, font: cell.font, color: rgb(0.08, 0.08, 0.08) })
          })
        })
        y = top - height
      }
    }
    y -= 8
  }
  for (const element of root.children) {
    if (element.tagName === 'TABLE') { renderTable(element); continue }
    if (/^H[1-6]$/.test(element.tagName) || ['P', 'BLOCKQUOTE', 'PRE'].includes(element.tagName)) {
      await addBlock(element, { indent: element.tagName === 'BLOCKQUOTE' ? 22 : 0 })
    } else if (element.tagName === 'UL' || element.tagName === 'OL') {
      const renderList = async (list, depth = 0) => {
        let index = Number(list.getAttribute('start')) || 1
        for (const item of [...list.children].filter((child) => child.tagName === 'LI')) {
          await addBlock(item, { indent: 12 + depth * 16, bullet: list.tagName === 'OL' ? `${index++}.` : '•' })
          for (const nested of [...item.children].filter((child) => child.tagName === 'UL' || child.tagName === 'OL')) await renderList(nested, depth + 1)
        }
      }
      await renderList(element)
    } else if (element.textContent.trim() || element.querySelector('img')) await addBlock(element)
  }
  if (!page && root.querySelector('img')) newPage()
  if (!page) fail('No text could be extracted from this DOCX file.')
  return output(fileName, await savePdf(doc))
}

async function readDocxLayout(file) {
  const JSZip = await import('jszip')
  const archive = await JSZip.default.loadAsync(await file.arrayBuffer())
  const parser = new DOMParser()
  const documentXml = parser.parseFromString(await archive.file('word/document.xml').async('string'), 'application/xml')
  const stylesEntry = archive.file('word/styles.xml')
  const stylesXml = stylesEntry ? parser.parseFromString(await stylesEntry.async('string'), 'application/xml') : null
  const styleMap = new Map()
  let defaultStyleId = 'Normal'
  for (const style of stylesXml?.getElementsByTagName('w:style') || []) {
    if (style.getAttribute('w:type') !== 'paragraph') continue
    const id = style.getAttribute('w:styleId')
    const alignment = style.getElementsByTagName('w:jc')[0]?.getAttribute('w:val')
    const basedOn = style.getElementsByTagName('w:basedOn')[0]?.getAttribute('w:val')
    if (style.getAttribute('w:default') === '1') defaultStyleId = id
    styleMap.set(id, { alignment, basedOn })
  }
  const alignmentForStyle = (styleId, visited = new Set()) => {
    if (!styleId || visited.has(styleId)) return null
    visited.add(styleId)
    const style = styleMap.get(styleId)
    return style?.alignment || alignmentForStyle(style?.basedOn, visited)
  }
  const defaultAlignment = stylesXml?.getElementsByTagName('w:docDefaults')[0]?.getElementsByTagName('w:jc')[0]?.getAttribute('w:val') || alignmentForStyle(defaultStyleId)
  const alignedStyles = []
  for (const paragraph of documentXml.getElementsByTagName('w:p')) {
    const properties = paragraph.getElementsByTagName('w:pPr')[0]
    const styleId = properties?.getElementsByTagName('w:pStyle')[0]?.getAttribute('w:val') || defaultStyleId
    const alignment = properties?.getElementsByTagName('w:jc')[0]?.getAttribute('w:val') || alignmentForStyle(styleId) || defaultAlignment
    if (alignment === 'center' || alignment === 'right') alignedStyles.push({ styleId, alignment })
  }
  const tableWidths = [...documentXml.getElementsByTagName('w:tbl')].map((table) => {
    const grid = [...table.getElementsByTagName('w:gridCol')].map((column) => Number(column.getAttribute('w:w')))
    if (grid.length && grid.every((width) => width > 0)) return grid
    const firstRow = table.getElementsByTagName('w:tr')[0]
    return [...(firstRow?.children || [])].filter((cell) => cell.localName === 'tc').map((cell) => Number(cell.getElementsByTagName('w:tcW')[0]?.getAttribute('w:w'))).filter((width) => width > 0)
  })
  return { tableWidths, alignmentForStyle, alignedStyles, defaultStyleId }
}

function alignedDocxStyle(styleId, alignment) {
  return `PdfKing${alignment === 'center' ? 'Center' : 'Right'}_${(styleId || 'Normal').replace(/[^A-Za-z0-9_]/g, '_')}`
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
  const text = String(options.text ?? options.watermarkText ?? 'CONFIDENTIAL')
  const font = await textFont(pdf, `${text}\n${options.format || ''}`)
  const selected = options.pages ? new Set(parsePageList(options.pages, pdf.getPageCount())) : null
  const start = Number(options.startNumber ?? options.startAt ?? 1)
  // Count only pages that receive a number, so selected subsets start at the configured value.
  let sequence = start
  if (mode === 'watermark' && !text.trim()) fail('Enter watermark text before applying it.')
  const opacity = Math.max(0.05, Math.min(1, Number(options.opacity ?? 0.25)))
  const angle = Number(options.angle ?? 45)
  const position = String(options.position || 'bottom-center')
  const fontSize = Math.max(6, Math.min(96, Number(options.fontSize) || (mode === 'watermark' ? 44 : 10)))
  const color = mode === 'watermark' ? rgb(0.48, 0.48, 0.5) : rgb(0.12, 0.12, 0.12)
  pdf.getPages().forEach((page, index) => {
    const n = index + 1
    if (selected && !selected.has(n)) return
    const frame=displayFrame(page),{width,height}=frame
    page.pushOperators(pushGraphicsState(),concatTransformationMatrix(...frame.matrix))
    if (mode === 'watermark') {
      page.drawText(text, { x: width * 0.13, y: height * 0.48, size: fontSize, font, color, opacity, rotate: degrees(angle), maxWidth: width * 0.75 })
    } else {
      const label = String(options.format || '{n}').replaceAll('{n}', String(sequence)).replaceAll('{total}', String(pdf.getPageCount()))
      sequence += 1
      const tw = font.widthOfTextAtSize(label, fontSize)
      const [vertical, horizontal] = position.split('-')
      const x = horizontal === 'left' ? 36 : horizontal === 'right' ? width - tw - 36 : (width - tw) / 2
      const y = vertical === 'top' ? height - 36 - fontSize : 28
      page.drawText(label, { x, y, size: fontSize, font, color, opacity: 1 })
    }
    page.pushOperators(popGraphicsState())
  })
  return output(`${baseName(file)}_${mode === 'watermark' ? 'watermarked' : 'numbered'}.pdf`, await savePdf(pdf))
}

async function normalizedRectToPage(file, pageNumber, page, rect) { return pdfRect(displayFrame(page, Number(rect.viewerRotation)||0), rect) }

async function cropPdf(file, options) {
  const { pdf } = await loadPdf(file)
  const mmToPt = 72 / 25.4
  const margin = (name) => Math.max(0, Number(options[name]) || 0) * (options.unit === 'pt' ? 1 : mmToPt)
  const top = margin('top'), bottom = margin('bottom'), left = margin('left'), right = margin('right')
  const selected = options.pages ? new Set(parsePageList(options.pages, pdf.getPageCount())) : null
  pdf.getPages().forEach((page, index) => {
    if (selected && !selected.has(index + 1)) return
    const frame=displayFrame(page),{width,height}=frame
    if (left + right >= width || top + bottom >= height) fail(`Crop margins leave no printable area on page ${index + 1}.`)
    const box=pdfRect(frame,{x:left/width,y:top/height,width:1-(left+right)/width,height:1-(top+bottom)/height})
    page.setCropBox(box.x,box.y,box.width,box.height)
  })
  return output(`${baseName(file)}_cropped.pdf`, await savePdf(pdf))
}

async function reorderPdf(file, options) {
  const { pdf } = await loadPdf(file)
  const order = parsePageOrder(options.pages, pdf.getPageCount())
  const result = await PDFDocument.create()
  const copied = await result.copyPages(pdf, order.map((n) => n - 1))
  copied.forEach((page, index) => {
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
  const font = await textFont(pdf, text, mode === 'signature' ? StandardFonts.TimesRomanItalic : StandardFonts.Helvetica)
  const size = mode === 'signature' ? 24 : 12
  page.drawText(text, { x: 54, y: Math.max(40, page.getHeight() - 110), size, font, color: rgb(0.08, 0.12, 0.24), maxWidth: page.getWidth() - 108 })
  return output(`${baseName(file)}_${mode === 'signature' ? 'signed' : 'annotated'}.pdf`, await savePdf(pdf))
}

async function editPdfText(file, edits = []) {
  const data = await commitOperations(file, edits.map(edit => ({...edit,type:'text'})))
  return output(`${baseName(file)}_edited.pdf`, data)
}

async function editPdfImages(file, edits = []) {
  if (!Array.isArray(edits) || !edits.length) fail('Select or change at least one image before saving.')
  // The editor and this tool share one placement path so the saved PDF always
  // matches the preview: same crop, rotation, flip, skew and cover behaviour.
  const { prepareImageOperations } = await import('./editor/prepareImages')
  const operations = await prepareImageOperations(edits.map((edit) => ({ ...edit, type: 'image' })))
  const data = await commitOperations(file, operations)
  return output(`${baseName(file)}_images-edited.pdf`, data)
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
      else if (typeof field.select === 'function') field.select(Array.isArray(value) ? value : String(value))
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
    const outputs = await extractGroups(file, { ...options, ranges: toolId === 'extract-pages' ? (options.pages ?? options.ranges) : options.ranges, groupRanges: toolId === 'extract-pages' ? false : options.groupRanges, mode: toolId === 'split-pdf' ? (options.mode || options.splitMode) : undefined }, onProgress)
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
    const angle = Number(options.rotation ?? options.angle ?? 90)
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
  if (toolId === 'edit-text') { requirePdf(files); return [await editPdfText(file, options.textEdits)] }
  if (toolId === 'add-text') { requirePdf(files); return [await editPdfText(file, options.textEdits)] }
  if (toolId === 'images') { requirePdf(files); return [await editPdfImages(file, options.imageEdits)] }
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
    const qualityByLevel = { extreme: 0.42, recommended: 0.68, light: 0.86 }
    const dimensionsByLevel = { extreme: 1400, recommended: 2000, light: 2800 }
    const quality = Math.max(0.25, Math.min(1, Number(options.quality) || qualityByLevel[level] || 0.68))
    const maxDimension = dimensionsByLevel[level] || 2000
    const targetReduction = level === 'recommended' ? 0.7 : level === 'extreme' ? 0.85 : 0
    const source = await readFile(file)
    const toolkit = await getQpdfToolkit()
    progress(onProgress, 0.05, 'Compressing document streams, fonts, and resources…')
    const compressed = await compressPdfBytes(source, {
      targetReduction,
      optimizeFonts: targetReduction && window.pdfKing?.convertType1Fonts ? (bytes) => optimizePdfType1Fonts(bytes, (data) => window.pdfKing.convertType1Fonts(data)) : undefined,
      imagePasses: level === 'recommended'
        ? [{ quality, maxDimension }, { quality: Math.min(quality, 0.55), maxDimension: 1700 }, { quality: Math.min(quality, 0.42), maxDimension: 1400 }, { quality: Math.min(quality, 0.32), maxDimension: 1100 }, { quality: Math.min(quality, 0.28), maxDimension: 900 }, { quality: Math.min(quality, 0.25), maxDimension: 750 }, { quality: Math.min(quality, 0.22), maxDimension: 650 }, { quality: Math.min(quality, 0.2), maxDimension: 550 }]
        : level === 'extreme'
          ? [{ quality, maxDimension }, { quality: Math.min(quality, 0.32), maxDimension: 1100 }, { quality: Math.min(quality, 0.25), maxDimension: 900 }, { quality: Math.min(quality, 0.25), maxDimension: 750 }, { quality: Math.min(quality, 0.22), maxDimension: 650 }, { quality: Math.min(quality, 0.2), maxDimension: 550 }]
          : [{ quality, maxDimension }],
      optimize: (bytes) => optimizePdfDocument(bytes, { toolkit, onProgress: (state) => onProgress?.({ ...state, value: 0.05 + state.value * 0.1 }) }),
      recompressImages: level === 'lossless' ? undefined : (bytes, settings) => recompressPdfImages(bytes, {
        ...settings,
        createCanvas: (width, height) => { const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height; return canvas },
        decodeJpeg: (bytes) => createImageBitmap(new Blob([bytes], { type: JPG_MIME })),
        decodePdfImage: async (bytes, scale) => {
          options.signal?.throwIfAborted()
          const task = pdfjs.getDocument({ data: bytes, wasmUrl: pdfImageWasmUrl, stopAtErrors: true })
          try {
            const doc = await task.promise
            const page = await doc.getPage(1)
            const viewport = page.getViewport({ scale })
            const canvas = document.createElement('canvas')
            canvas.width = Math.max(1, Math.round(viewport.width))
            canvas.height = Math.max(1, Math.round(viewport.height))
            await page.render({ canvas: null, canvasContext: canvas.getContext('2d', { alpha: true }), viewport, background: 'rgba(0,0,0,0)' }).promise
            // PDF.js can log an image decode failure and render a blank page
            // without rejecting render(). Never replace an image in that case.
            const operators = await page.getOperatorList()
            for (let index = 0; index < operators.fnArray.length; index += 1) {
              if (operators.fnArray[index] !== pdfjs.OPS.paintImageXObject) continue
              const id = operators.argsArray[index][0]
              const objects = id.startsWith('g_') ? page.commonObjs : page.objs
              const object = await abortable(new Promise((resolve) => objects.get(id, resolve)), options.signal)
              if (!object) throw new Error('Embedded image decoding failed.')
            }
            options.signal?.throwIfAborted()
            return canvas
          } finally { await task.destroy() }
        },
        encodeJpeg: async (canvas, quality) => new Uint8Array(await (await canvasBlob(canvas, JPG_MIME, quality)).arrayBuffer()),
        onProgress: (state) => onProgress?.({ ...state, value: 0.1 + state.value * 0.8 }),
      }),
    })
    const reduction = ((1 - compressed.data.byteLength / source.byteLength) * 100).toFixed(1)
    const result = output(`${baseName(file)}_${level === 'lossless' ? 'optimized' : 'compressed'}.pdf`, compressed.data)
    result.compression = { originalSize: compressed.originalSize, compressedSize: compressed.compressedSize, reduction: compressed.reduction, targetReduction, targetMet: compressed.targetMet }
    result.message = compressed.reduced
      ? `Reduced file size by ${reduction}%. ${compressed.changedImages ? `${compressed.changedImages} embedded image${compressed.changedImages === 1 ? '' : 's'} recompressed. ` : ''}${compressed.changedFonts ? `${compressed.changedFonts} embedded fonts optimized. ` : ''}Text, links, forms, and page content were preserved.`
      : 'The available optimizations did not produce a meaningfully smaller PDF. The original file was kept unchanged.'
    if (compressed.skippedImages) result.message += ` ${compressed.skippedImages} embedded image${compressed.skippedImages === 1 ? '' : 's'} could not be optimized safely.`
    if (targetReduction && !compressed.targetMet) result.message += ` The ${Math.round(targetReduction * 100)}% reduction target could not be reached while preserving normal PDF features and this mode’s image quality limits.`
    return [result]
  }

  if (toolId === 'redact-pdf') {
    requirePdf(files)
    if (!Array.isArray(options.redactions) || !options.redactions.length) fail('Mark at least one redaction rectangle before applying redactions. Coordinates should be normalized from 0 to 1 with a one-based page number.')
    const info = await inspectPdf(file)
    for (const rect of options.redactions) {
      const page = Number(rect.page)
      if (!Number.isInteger(page) || page < 1 || page > info.pageCount) fail(`Redaction page must be between 1 and ${info.pageCount}.`)
    }
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
    const { convertPdfToWord } = await import('./pdfToWord')
    return convertPdfToWord({ pdfjs, pdf, file, options, onProgress, extractTextByPage, renderPage, canvasBlob })
  }

  if (toolId === 'word-to-pdf') {
    if (!file) fail('Choose a .docx file first. This converter accepts DOCX; legacy .doc files are unsupported.')
    if (!/\.docx$/i.test(file.name || '') && file.type !== DOCX_MIME) fail('Choose a .docx document. Legacy .doc files need Microsoft Word or LibreOffice to convert.')
    try {
      const mammoth = await import('mammoth')
      const { tableWidths, alignmentForStyle, alignedStyles, defaultStyleId } = await readDocxLayout(file)
      const styleMap = [...new Set(alignedStyles.map(({ styleId, alignment }) => {
        const heading = styleId.match(/heading\s*([1-6])|heading([1-6])/i)
        const outputTag = heading ? `h${heading[1] || heading[2]}` : /title/i.test(styleId) ? 'h1' : 'p'
        return `p.${alignedDocxStyle(styleId, alignment)} => ${outputTag}.pdf-${alignment}:fresh`
      }))]
      const converted = await mammoth.convertToHtml({
        arrayBuffer: await file.arrayBuffer(),
      }, {
        styleMap,
        transformDocument: mammoth.transforms.paragraph((paragraph) => {
          const styleId = paragraph.styleId || defaultStyleId
          const alignment = paragraph.alignment || alignmentForStyle(styleId)
          if (alignment !== 'center' && alignment !== 'right') return paragraph
          return { ...paragraph, styleId: alignedDocxStyle(styleId, alignment) }
        }),
      })
      const hasText = converted.value.replace(/<[^>]*>/g, '').trim()
      const hasEmbeddedImages = /<img\b[^>]*>/i.test(converted.value)
      if (!hasText && !hasEmbeddedImages) fail('No text or supported images could be extracted from this DOCX file.')
      const result = await docxHtmlPdf(converted.value, `${baseName(file)}.pdf`, tableWidths)
      result.message = 'DOCX text styling and embedded images are retained. This local renderer substitutes unavailable fonts and may reflow pages or complex layouts.'
      return [result]
    } catch (error) { throw new Error(`Could not convert this DOCX: ${error.message}`) }
  }

  if (toolId === 'pdf-to-pptx') {
    requirePdf(files)
    const doc = await getPdfJsDocument(file)
    const pptxModule = await import('pptxgenjs')
    const pptx = new pptxModule.default()
    const firstPage = await doc.getPage(1)
    const firstViewport = firstPage.getViewport({ scale: 1 })
    const slideWidth = Math.max(1, firstViewport.width / 72)
    const slideHeight = Math.max(1, firstViewport.height / 72)
    pptx.defineLayout({ name: 'PDF_PAGE', width: slideWidth, height: slideHeight })
    pptx.layout = 'PDF_PAGE'
    pptx.author = 'PDF Dock'
    pptx.subject = 'Slides converted from PDF pages'
    let ocrWorker = null
    try { for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
      const page = await doc.getPage(pageNumber)
      const viewport = page.getViewport({ scale: 1 })
      const textContent = await page.getTextContent()
      const operatorList = await page.getOperatorList()
      const textColors = extractTextColorStyles(operatorList, pdfjs.OPS, textContent.items)
      const editableTexts = []
      textContent.items.forEach((item, index) => {
        if (!('str' in item) || !item.str.trim()) return
        const transform = item.transform || []
        const fontSize = Math.hypot(transform[2] || 0, transform[3] || 0)
        const widthPt = Number(item.width) || 0
        if (!Number.isFinite(fontSize) || fontSize < 1 || !Number.isFinite(widthPt) || widthPt <= 0) return
        const matrix = pdfjs.Util.transform(viewport.transform, transform)
        const angle = Math.atan2(matrix[1], matrix[0]) * 180 / Math.PI
        const baseline = viewport.convertToViewportPoint(transform[4], transform[5])
        const style = textContent.styles?.[item.fontName] || {}
        const ascent = Math.max(0.55, Math.min(1.15, Number(style.ascent) || 0.82))
        const descent = Math.max(0, Math.min(0.5, Math.abs(Number(style.descent) || 0.22)))
        let font = null
        try { if (page.commonObjs.has(item.fontName)) font = page.commonObjs.get(item.fontName) } catch {}
        const box = {
          text: item.str,
          x: baseline[0] / 72,
          y: (baseline[1] - fontSize * ascent) / 72,
          w: widthPt / 72,
          h: fontSize * (ascent + descent) / 72,
          fontSize,
          angle,
          color: textColors[index]?.color && /^#[\da-f]{6}$/i.test(textColors[index].color) ? textColors[index].color.slice(1) : '111111',
          ...pdfTextStyle(item, style, font),
        }
        const bullet = box.text.match(/^(\s*)([•◦▪‣⁃])\s+/u)
        if (bullet) { box.text = box.text.slice(bullet[0].length); box.bullet = true }
        if (box.x < -0.02 || box.y < -0.02 || box.x + box.w > viewport.width / 72 + 0.02 || box.y + box.h > viewport.height / 72 + 0.02) return
        editableTexts.push(box)
      })
      if (!editableTexts.length) {
        if (!ocrWorker) {
          progress(onProgress, (pageNumber - 1) / doc.numPages, 'Loading OCR to recognize scanned pages…')
          const { createWorker } = await import('tesseract.js')
          ocrWorker = await createWorker(options.language || 'eng', 1, {
            workerPath: new URL('ocr/worker.min.js', document.baseURI).href,
            corePath: new URL('ocr/', document.baseURI).href,
            langPath: new URL('ocr/', document.baseURI).href,
            workerBlobURL: false,
          })
        }
        const dpi = Math.max(120, Math.min(300, Number(options.ocrDpi) || 200))
        const { canvas } = await renderPage(doc, pageNumber, dpi / 72)
        const { data } = await ocrWorker.recognize(canvas, {}, { blocks: true })
        for (const word of data.words || []) {
          const value = String(word.text || '').trim()
          const bounds = word.bbox
          if (!value || !bounds || bounds.x1 <= bounds.x0 || bounds.y1 <= bounds.y0) continue
          const fontSize = Math.max(5, (bounds.y1 - bounds.y0) * 72 / dpi)
          editableTexts.push({ text: value, x: bounds.x0 / dpi, y: bounds.y0 / dpi, w: Math.max(0.02, (bounds.x1 - bounds.x0) / dpi), h: Math.max(0.05, (bounds.y1 - bounds.y0) / dpi), fontSize, color: '111111', fontFace: 'Arial', bold: false, italic: false, angle: 0 })
        }
        canvas.width = canvas.height = 0
      }
      const slide = pptx.addSlide()
      slide.background = { color: 'FFFFFF' }
      const imageWidth = viewport.width / 72
      const imageHeight = viewport.height / 72
      const scale = Math.min(slideWidth / imageWidth, slideHeight / imageHeight)
      const width = imageWidth * scale
      const height = imageHeight * scale
      const offsetX = (slideWidth - width) / 2
      const offsetY = (slideHeight - height) / 2
      // Ask PDF.js to decode image XObjects, then add the decoded source
      // objects individually. The rendered page canvas is never exported.
      const imageOps = new Set([pdfjs.OPS.paintImageXObject, pdfjs.OPS.paintInlineImageXObject, pdfjs.OPS.paintImageMaskXObject])
      const pendingImages = []
      const nativeShapes = []
      let ctm = [1, 0, 0, 1, 0, 0]
      const ctmStack = []
      let fillColor = '000000'
      let strokeColor = '000000'
      let lineWidth = 1
      let currentPath = null
      const multiply = (a, b) => [
        a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
        a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
        a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5],
      ]
      const point = (m, x, y) => ({ x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] })
      for (let opIndex = 0; opIndex < operatorList.fnArray.length; opIndex += 1) {
        const op = operatorList.fnArray[opIndex]
        const args = operatorList.argsArray[opIndex] || []
        if (op === pdfjs.OPS.save) ctmStack.push({ ctm, fillColor, strokeColor, lineWidth })
        else if (op === pdfjs.OPS.restore) {
          const state = ctmStack.pop()
          if (state) ({ ctm, fillColor, strokeColor, lineWidth } = state)
        }
        else if (op === pdfjs.OPS.transform && args.length >= 6) ctm = multiply(ctm, args.slice(0, 6))
        else if (op === pdfjs.OPS.setFillRGBColor && typeof args[0] === 'string') fillColor = args[0].replace('#', '')
        else if (op === pdfjs.OPS.setStrokeRGBColor && typeof args[0] === 'string') strokeColor = args[0].replace('#', '')
        else if (op === pdfjs.OPS.setLineWidth && Number.isFinite(args[0])) lineWidth = args[0]
        else if (op === pdfjs.OPS.constructPath) {
          const pathOps = args[0] || []
          const coords = args[1] || []
          const points = []
          let cursor = 0
          let start = null
          for (const command of pathOps) {
            if (command === 0 || command === 1) {
              const raw = point(ctm, coords[cursor++], coords[cursor++])
              const transformed = point(viewport.transform, raw.x, raw.y)
              points.push({ x: transformed.x / 72, y: transformed.y / 72, move: command === 0 })
              if (command === 0) start = points.at(-1)
            } else if (command === 2) cursor += 6
            else if (command === 3) cursor += 4
            else if (command === 4 && start) points.push({ ...start, close: true })
          }
          currentPath = points
        }
        else if ([pdfjs.OPS.fill, pdfjs.OPS.eoFill, pdfjs.OPS.fillStroke, pdfjs.OPS.eoFillStroke, pdfjs.OPS.closeFillStroke, pdfjs.OPS.closeEOFillStroke, pdfjs.OPS.stroke, pdfjs.OPS.closeStroke].includes(op)) {
          if (currentPath?.length >= 2) {
            const drawable = currentPath.filter((point) => !point.close)
            const close = currentPath.some((point) => point.close)
            const xs = drawable.map((point) => point.x), ys = drawable.map((point) => point.y)
            const left = Math.min(...xs), right = Math.max(...xs), top = Math.min(...ys), bottom = Math.max(...ys)
            const isRect = close && drawable.length === 4 && (right - left) > 0.002 && (bottom - top) > 0.002 && drawable.every((point, index) => Math.abs(point.x - (index % 2 ? right : left)) < 0.01 || Math.abs(point.x - (index % 2 ? left : right)) < 0.01)
            const isLine = drawable.length === 2 && !close
            if (isRect) nativeShapes.push({ type: 'rect', x: offsetX + left * scale, y: offsetY + top * scale, w: (right - left) * scale, h: (bottom - top) * scale, fill: fillColor, line: strokeColor, lineWidth, filled: [pdfjs.OPS.fill, pdfjs.OPS.eoFill, pdfjs.OPS.fillStroke, pdfjs.OPS.eoFillStroke, pdfjs.OPS.closeFillStroke, pdfjs.OPS.closeEOFillStroke].includes(op), stroked: [pdfjs.OPS.fillStroke, pdfjs.OPS.eoFillStroke, pdfjs.OPS.closeFillStroke, pdfjs.OPS.closeEOFillStroke, pdfjs.OPS.stroke, pdfjs.OPS.closeStroke].includes(op) })
            else if (isLine) nativeShapes.push({ type: 'line', x: offsetX + drawable[0].x * scale, y: offsetY + drawable[0].y * scale, w: (drawable[1].x - drawable[0].x) * scale, h: (drawable[1].y - drawable[0].y) * scale, line: strokeColor, lineWidth })
          }
          currentPath = null
        }
        else if (imageOps.has(op) && typeof args[0] === 'string') {
          const matrix = multiply(viewport.transform, ctm)
          const corners = [point(matrix, 0, 0), point(matrix, 1, 0), point(matrix, 0, 1), point(matrix, 1, 1)]
          const left = Math.max(0, Math.min(...corners.map(({ x }) => x)))
          const top = Math.max(0, Math.min(...corners.map(({ y }) => y)))
          const right = Math.min(viewport.width, Math.max(...corners.map(({ x }) => x)))
          const bottom = Math.min(viewport.height, Math.max(...corners.map(({ y }) => y)))
          if (right - left > 1 && bottom - top > 1) pendingImages.push({ id: args[0], x: left / 72, y: top / 72, w: (right - left) / 72, h: (bottom - top) / 72 })
        }
      }
      if (pendingImages.length) {
        const maxScale = Math.min(1, Math.sqrt(4_000_000 / Math.max(1, viewport.width * viewport.height)))
        const decoded = await renderPage(doc, pageNumber, maxScale)
        decoded.canvas.width = decoded.canvas.height = 1
        for (const image of pendingImages) {
          try {
            const source = page.objs.has(image.id) ? page.objs.get(image.id) : await new Promise((resolve) => page.objs.get(image.id, resolve))
            const imageWidth = Number(source?.width) || Number(source?.bitmap?.width)
            const imageHeight = Number(source?.height) || Number(source?.bitmap?.height)
            if (!imageWidth || !imageHeight) continue
            const imageCanvas = document.createElement('canvas')
            imageCanvas.width = imageWidth
            imageCanvas.height = imageHeight
            const imageContext = imageCanvas.getContext('2d')
            if (source.bitmap) imageContext.drawImage(source.bitmap, 0, 0)
            else if (typeof ImageBitmap !== 'undefined' && source instanceof ImageBitmap) imageContext.drawImage(source, 0, 0)
            else if (source.data?.length === imageWidth * imageHeight * 4) imageContext.putImageData(new ImageData(new Uint8ClampedArray(source.data), imageWidth, imageHeight), 0, 0)
            else if (source.data?.length === imageWidth * imageHeight * 3) {
              const rgba = new Uint8ClampedArray(imageWidth * imageHeight * 4)
              for (let p = 0, q = 0; p < source.data.length; p += 3, q += 4) { rgba[q] = source.data[p]; rgba[q + 1] = source.data[p + 1]; rgba[q + 2] = source.data[p + 2]; rgba[q + 3] = 255 }
              imageContext.putImageData(new ImageData(rgba, imageWidth, imageHeight), 0, 0)
            } else continue
            slide.addImage({ data: canvasPngDataUrl(imageCanvas), x: offsetX + image.x * scale, y: offsetY + image.y * scale, w: image.w * scale, h: image.h * scale })
          } catch (error) { console.warn(`PDF Dock could not extract PDF image ${image.id}:`, error) }
        }
      }
      for (const shape of nativeShapes) {
        if (shape.type === 'line') slide.addShape(pptx.ShapeType.line, { x: shape.x, y: shape.y, w: shape.w, h: shape.h, line: { color: shape.line, width: Math.max(0.25, shape.lineWidth) } })
        else slide.addShape(pptx.ShapeType.rect, { x: shape.x, y: shape.y, w: shape.w, h: shape.h, line: shape.stroked ? { color: shape.line, width: Math.max(0.25, shape.lineWidth) } : { color: shape.fill, transparency: 100 }, fill: shape.filled ? { color: shape.fill } : { color: 'FFFFFF', transparency: 100 } })
      }
      for (const text of editableTexts) {
        slide.addText(text.text, {
          x: offsetX + text.x * scale, y: offsetY + text.y * scale,
          w: Math.max(0.03, text.w * scale), h: Math.max(0.06, text.h * scale),
          fontFace: text.fontFace, fontSize: text.fontSize * scale,
          color: text.color, bold: text.bold, italic: text.italic,
          margin: 0, breakLine: false, valign: 'mid', fit: 'shrink',
          rotate: text.angle,
          ...(text.bullet ? { bullet: { indent: text.fontSize * scale }, hanging: Math.max(2, text.fontSize * scale * 0.2) } : {}),
          transparency: 0,
        })
      }
      progress(onProgress, pageNumber / doc.numPages, `Converted page ${pageNumber} of ${doc.numPages}; ${editableTexts.length} editable text items`)
    } } finally { if (ocrWorker) await ocrWorker.terminate() }
    const bytes = await pptx.write({ outputType: 'uint8array', compression: true })
    const result = output(`${baseName(file)}.pptx`, bytes, PPTX_MIME)
    result.message = 'Editable text, detected bullets, embedded images, and simple lines and rectangles are rebuilt as slide objects. Scanned pages use OCR to create editable text. Whole-page screenshots are not used. Complex vector paths, patterns, and gradients are not fully reconstructed.'
    return [result]
  }

  if (toolId === 'powerpoint-to-pdf') {
    if (!file) fail('Choose a PowerPoint presentation first.')
    if (/\.ppt$/i.test(file.name || '')) fail('Legacy .ppt files are not supported by the local renderer. Open the presentation in PowerPoint or LibreOffice and save it as .pptx, then try again.')
    if (!/\.pptx$/i.test(file.name || '') && file.type !== PPTX_MIME) fail('Choose a .pptx presentation. Legacy .ppt files must first be saved as .pptx.')
    let renderer
    try {
      const { PptxRenderer } = await import('pptx-browser')
      renderer = new PptxRenderer()
      await renderer.load(file, (fraction, message) => progress(onProgress, fraction * 0.2, message))
      if (!renderer.slideCount) fail('No slides were found in this presentation.')
      const pdfBytes = await renderer.toPdf({ width: 1920, quality: 0.92, onProgress: (done, total) => progress(onProgress, 0.2 + done / total * 0.8, `Rendered slide ${done} of ${total}`) })
      return [output(`${baseName(file)}.pdf`, pdfBytes)]
    } catch (error) {
      throw new Error(`Could not convert this PowerPoint presentation: ${error.message}`)
    } finally {
      renderer?.destroy()
    }
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
 * compress-pdf: level ('lossless'|'extreme'|'recommended'|'light'), quality
 * redact-pdf: redactions [{page, x, y, width, height, normalized?}], dpi
 * word-to-pdf: fontSize
 */
export async function processTool({ toolId, files = [], options = {}, onProgress, signal } = {}) {
  if (!toolId) fail('Choose a PDF tool first.')
  if (files.length > 20) fail('Choose no more than 20 files per operation.')
  if (files.reduce((sum, file) => sum + (Number(file?.size) || 0), 0) > 1024 * 1024 * 1024) fail('The selected files total more than 1 GB. Process a smaller batch at a time.')
  try {
    const reportProgress = (state) => {
      if (signal?.aborted) throw new DOMException('Operation canceled.', 'AbortError')
      onProgress?.(state)
    }
    const aggregateInput = ['merge-pdf', 'jpg-to-pdf'].includes(toolId)
    let outputs
    if (signal?.aborted) throw new DOMException('Operation canceled.', 'AbortError')
    if (aggregateInput || files.length < 2) outputs = await processKnown(toolId, files, {...options,signal}, reportProgress)
    else {
      outputs = []
      for (let index = 0; index < files.length; index += 1) {
        if (signal?.aborted) throw new DOMException('Operation canceled.', 'AbortError')
        const result = await processKnown(toolId, [files[index]], {...options,signal}, (state) => reportProgress({
          ...state,
          value: (index + (Number(state?.value) || 0)) / files.length,
          message: `Document ${index + 1} of ${files.length}: ${state?.message || 'Processing…'}`,
        }))
        outputs.push(...result)
      }
    }
    return { outputs, message: outputs.find((item) => item.message)?.message }
  } catch (error) {
    if (error instanceof Error) throw error
    throw new Error(String(error))
  }
}

/** Read the file name, byte size, page count, and page dimensions from a real PDF. */
export async function inspectPdf(file) {
  const size = file?.size || (await readFile(file)).byteLength
  const doc = await getPdfJsDocument(file)
  const pages = []
  for (let n = 1; n <= doc.numPages; n += 1) {
    const page = await doc.getPage(n)
    const { width, height } = page.getViewport({ scale: 1 })
    pages.push({ pageNumber: n, width, height, rotation: page.rotate })
    page.cleanup()
  }
  return { name: file.name || 'document.pdf', size, pageCount: doc.numPages, pages }
}

/** Openable metadata only. Page geometry after page one is resolved on demand by the viewer. */
export async function inspectPdfOverview(file) {
  const size = file?.size || (await readFile(file)).byteLength
  const doc = await getPdfJsDocument(file)
  const firstPage = await doc.getPage(1)
  const { width, height } = firstPage.getViewport({ scale: 1 })
  const first = { pageNumber: 1, width, height, rotation: firstPage.rotate }
  firstPage.cleanup()
  return { name: file.name || 'document.pdf', size, pageCount: doc.numPages, pages: [first] }
}

/** Resolve only the requested page dimensions, leaving the rest of a large document lazy. */
export async function inspectPdfPageSize(file, pageNumber, rotation = 0) {
  const doc = await getPdfJsDocument(file)
  const number = Number(pageNumber)
  if (!Number.isInteger(number) || number < 1 || number > doc.numPages) fail(`Choose a page between 1 and ${doc.numPages}.`)
  const page = await doc.getPage(number)
  const viewport = page.getViewport({ scale: 1, rotation: page.rotate + (Number(rotation) || 0) })
  const result = { pageNumber: number, width: viewport.width, height: viewport.height, rotation: ((page.rotate + (Number(rotation) || 0)) % 360 + 360) % 360 }
  page.cleanup()
  return result
}

/** Canvas jobs own a version, task and staging surface. Only the current job
 * may publish pixels. Abort never releases a different job's canvas/task. */
export async function renderPdfPage(file, pageNumber, canvas, scale = 1, renderOptions = {}) {
  if (!canvas) return { status: 'FAILED', error: new Error('PDF canvas is unavailable.') }
  const version = (pdfCanvasRenderVersions.get(canvas) || 0) + 1
  pdfCanvasRenderVersions.set(canvas, version)
  cancelQueuedCanvasJob(canvas)
  pdfCanvasRenderTasks.get(canvas)?.cancel()
  const signal = renderOptions.signal
  const current = () => !signal?.aborted && pdfCanvasRenderVersions.get(canvas) === version
  const cancelled = () => ({ status: 'CANCELLED', cancelled: true })
  const abort = () => { if (pdfCanvasRenderVersions.get(canvas) === version) cancelPdfCanvasRender(canvas) }
  signal?.addEventListener('abort', abort, { once: true })
  if (!current()) { signal?.removeEventListener('abort', abort); return cancelled() }
  try {
    return await enqueueCanvasRender(canvas, Number(renderOptions.priority) || 2, async () => {
      let staging
      try {
        if (!current()) return cancelled()
        const doc = await getPdfJsDocument(file)
        if (!current()) return cancelled()
        const number = Number(pageNumber)
        if (!Number.isInteger(number) || number < 1 || number > doc.numPages) fail(`Choose a page between 1 and ${doc.numPages}.`)
        const page = await doc.getPage(number)
        if (!current()) return cancelled()
        const viewport = page.getViewport({ scale: Math.max(0.01, Math.min(8, Number(scale) || 1)), rotation: page.rotate + (Number(renderOptions.rotation) || 0) })
        const deviceScale = renderOptions.thumbnail ? 1 : Math.min(2.5, Math.max(1, window.devicePixelRatio || 1))
        const outputScale = Math.max(0.5, Math.min(deviceScale, Math.sqrt(16_000_000 / Math.max(1, viewport.width * viewport.height))))
        staging = document.createElement('canvas')
        staging.width = Math.max(1, Math.ceil(viewport.width * outputScale))
        staging.height = Math.max(1, Math.ceil(viewport.height * outputScale))
        const context = staging.getContext('2d', { alpha: false })
        if (!context) fail('This browser could not create a canvas for PDF rendering.')
        const task = page.render({ canvas: staging, canvasContext: context, viewport, transform: outputScale === 1 ? null : [outputScale, 0, 0, outputScale, 0, 0] })
        pdfCanvasRenderTasks.set(canvas, task)
        try { await task.promise } finally { if (pdfCanvasRenderTasks.get(canvas) === task) pdfCanvasRenderTasks.delete(canvas) }
        if (!current()) return cancelled()
        const outputContext = canvas.getContext('2d', { alpha: false })
        if (!outputContext) fail('The PDF canvas was released before painting.')
        canvas.width = staging.width
        canvas.height = staging.height
        outputContext.drawImage(staging, 0, 0)
        canvas.dataset.painted = 'true'
        return { status: 'SUCCESS', width: canvas.width, height: canvas.height, pageCount: doc.numPages, version }
      } catch (error) {
        if (!current() || error.name === 'RenderingCancelledException' || error.name === 'AbortError') return cancelled()
        return { status: 'FAILED', error }
      } finally {
        if (staging) { staging.width = 0; staging.height = 0 }
      }
    })
  } finally { signal?.removeEventListener('abort', abort) }
}

export function cancelPdfCanvasRender(canvas) {
  if (!canvas) return
  pdfCanvasRenderVersions.set(canvas, (pdfCanvasRenderVersions.get(canvas) || 0) + 1)
  cancelQueuedCanvasJob(canvas)
  pdfCanvasRenderTasks.get(canvas)?.cancel()
  pdfCanvasRenderTasks.delete(canvas)
}

/** Build selectable text in an owned staging container; stale tasks cannot
 * repopulate or clear the current layer, even during asynchronous loading. */
export async function renderPdfTextLayer(file, pageNumber, container, scale = 1, renderOptions = {}) {
  if (!container) return { status: 'FAILED', error: new Error('Text layer is unavailable.') }
  const version = (pdfTextLayerVersions.get(container) || 0) + 1
  pdfTextLayerVersions.set(container, version)
  pdfTextLayerTasks.get(container)?.cancel()
  const signal = renderOptions.signal
  const current = () => !signal?.aborted && pdfTextLayerVersions.get(container) === version
  const abort = () => { if (pdfTextLayerVersions.get(container) === version) cancelPdfTextLayer(container) }
  signal?.addEventListener('abort', abort, { once: true })
  try {
    if (!current()) return { status: 'CANCELLED' }
    const doc = await getPdfJsDocument(file)
    if (!current()) return { status: 'CANCELLED' }
    const page = await doc.getPage(Number(pageNumber))
    const viewport = page.getViewport({ scale: Math.max(0.15, Math.min(8, Number(scale) || 1)), rotation: page.rotate + (Number(renderOptions.rotation) || 0) })
    const textContent = await page.getTextContent()
    const textColors = extractTextColorStyles(await page.getOperatorList(), pdfjs.OPS, textContent.items)
    if (!current()) return { status: 'CANCELLED' }
    const staging = document.createElement('div')
    const textLayer = new pdfjs.TextLayer({ textContentSource: textContent, container: staging, viewport })
    pdfTextLayerTasks.set(container, textLayer)
    try { await textLayer.render() } finally { if (pdfTextLayerTasks.get(container) === textLayer) pdfTextLayerTasks.delete(container) }
    if (!current()) return { status: 'CANCELLED' }
    // PDF.js also sets unrotated layer dimensions and main rotation. Publish
    // those with the children; dropping them misplaces selection on rotated pages.
    container.style.cssText = staging.style.cssText
    container.dataset.mainRotation = staging.dataset.mainRotation || '0'
    container.dataset.renderWidth = String(viewport.width)
    container.dataset.renderHeight = String(viewport.height)
    container.style.setProperty('--total-scale-factor', viewport.scale * (page.userUnit || 1))
    container.style.setProperty('--scale-round-x', '1px')
    container.style.setProperty('--scale-round-y', '1px')
    container.replaceChildren(...staging.childNodes)
    pdfTextLayerMetadata.set(container, { page, items: textContent.items, colors: textColors, textDivs: textLayer.textDivs, viewport })
    hydratePdfTextLayerStyles(container)
    return { status: 'SUCCESS', width: viewport.width, height: viewport.height }
  } catch (error) {
    if (!current() || error.name === 'AbortError' || error.name === 'AbortException') return { status: 'CANCELLED' }
    return { status: 'FAILED', error }
  } finally { signal?.removeEventListener('abort', abort) }
}

export function cancelPdfTextLayer(container) {
  if (!container) return
  pdfTextLayerVersions.set(container, (pdfTextLayerVersions.get(container) || 0) + 1)
  pdfTextLayerTasks.get(container)?.cancel()
  pdfTextLayerTasks.delete(container)
  pdfTextLayerMetadata.delete(container)
}

/** Return local PDF text for one page, cached for the lifetime of its File object. */
async function getSearchablePage(file, pageNumber) {
  let pages = pdfTextPageCache.get(file)
  if (!pages) { pages = new Map(); pdfTextPageCache.set(file, pages) }
  if (pages.has(pageNumber)) {
    const cached = pages.get(pageNumber)
    pages.delete(pageNumber)
    pages.set(pageNumber, cached)
    return cached
  }
  const doc = await getPdfJsDocument(file)
  const page = await doc.getPage(pageNumber)
  const viewport = page.getViewport({ scale: 1 })
  const content = await page.getTextContent()
  let text = ''
  const items = []
  for (const item of content.items || []) {
    if (!item.str) continue
    const separator = text ? (items.at(-1)?.hasEOL ? '\n' : ' ') : ''
    text += separator
    const start = text.length
    text += item.str
    const transform = item.transform || [1, 0, 0, 1, 0, 0]
    const [x, baseline] = viewport.convertToViewportPoint(transform[4], transform[5])
    const height = Math.max(1, Number(item.height) || Math.hypot(transform[2] || 0, transform[3] || 0) || 10)
    const width = Math.max(1, Number(item.width) || height * Math.max(1, item.str.length) * 0.45)
    items.push({ start, end: text.length, text: item.str, x, y: baseline - height, width, height, hasEOL: Boolean(item.hasEOL) })
  }
  const result = { text, items, width: viewport.width, height: viewport.height }
  pages.set(pageNumber, result)
  while (pages.size > 48) pages.delete(pages.keys().next().value)
  page.cleanup()
  return result
}

function getIndexedSearchText(file, pageNumber) {
  const index = pdfSearchTextCache.get(file)
  if (!index?.pages.has(pageNumber)) return null
  const text = index.pages.get(pageNumber)
  index.pages.delete(pageNumber)
  index.pages.set(pageNumber, text)
  return text
}

function rememberIndexedSearchText(file, pageNumber, text) {
  let index = pdfSearchTextCache.get(file)
  if (!index) { index = { pages: new Map(), bytes: 0 }; pdfSearchTextCache.set(file, index) }
  if (index.pages.has(pageNumber)) index.bytes -= index.pages.get(pageNumber).length * 2
  index.pages.delete(pageNumber)
  index.pages.set(pageNumber, text)
  index.bytes += text.length * 2
  while (index.bytes > 32 * 1024 * 1024 && index.pages.size > 1) {
    const [oldestPage, oldestText] = index.pages.entries().next().value
    index.pages.delete(oldestPage)
    index.bytes -= oldestText.length * 2
  }
}

/** Search progressively through local document text; repeated queries reuse page extraction. */
export async function searchPdfDocument(file, query, options = {}) {
  const value = String(query || '')
  if (!value) return { results: [], indexedPages: 0, pageCount: 0 }
  const doc = await getPdfJsDocument(file)
  const searchKey = JSON.stringify([value, Boolean(options.caseSensitive), Boolean(options.wholeWord), Boolean(options.regex)])
  let resultCache = pdfSearchResultCache.get(file)
  const candidatePages = options.candidatePages == null ? null : [...new Set(options.candidatePages.map(Number).filter((page) => Number.isInteger(page) && page >= 1 && page <= doc.numPages))]
  if (!candidatePages && resultCache?.has(searchKey)) {
    const cached = resultCache.get(searchKey)
    resultCache.delete(searchKey)
    resultCache.set(searchKey, cached)
    return cached
  }
  const flags = options.caseSensitive ? 'gu' : 'giu'
  let source
  try {
    const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    source = options.regex ? value : escaped
    if (options.wholeWord) source = `(?<![\\p{L}\\p{N}_])(?:${source})(?![\\p{L}\\p{N}_])`
    var matcher = new RegExp(source, flags)
  } catch (error) { throw new Error(`Invalid search pattern: ${error.message}`) }
  const results = []
  const pagesToSearch = candidatePages || Array.from({ length: doc.numPages }, (_, index) => index + 1)
  for (const pageNumber of pagesToSearch) {
    if (options.signal?.aborted) throw new DOMException('Search canceled.', 'AbortError')
    let pageText = getIndexedSearchText(file, pageNumber)
    let page = pdfTextPageCache.get(file)?.get(pageNumber) || null
    if (pageText == null) {
      page = await getSearchablePage(file, pageNumber)
      pageText = page.text
      rememberIndexedSearchText(file, pageNumber, pageText)
    }
    matcher.lastIndex = 0
    let match
    const pageMatches = []
    while ((match = matcher.exec(pageText)) !== null) {
      if (!match[0]) { matcher.lastIndex += 1; continue }
      const from = match.index, to = from + match[0].length
      pageMatches.push({ text: match[0], from, to })
    }
    if (pageMatches.length && !page) page = await getSearchablePage(file, pageNumber)
    for (const pageMatch of pageMatches) {
      const boxes = page.items.filter((item) => item.end > pageMatch.from && item.start < pageMatch.to).map((item) => {
        const segmentStart = Math.max(pageMatch.from, item.start) - item.start
        const segmentEnd = Math.min(pageMatch.to, item.end) - item.start
        const unit = item.width / Math.max(item.text.length, 1)
        return { x: (item.x + segmentStart * unit) / page.width, y: item.y / page.height, width: Math.max(0.003, (segmentEnd - segmentStart) * unit / page.width), height: Math.max(0.004, item.height / page.height) }
      })
      const contextStart = Math.max(0, pageMatch.from - 42)
      const contextEnd = Math.min(pageText.length, pageMatch.to + 42)
      results.push({ page: pageNumber, text: pageMatch.text, start: pageMatch.from, end: pageMatch.to, context: pageText.slice(contextStart, contextEnd).replace(/\s+/g, ' ').trim(), rects: boxes })
    }
    options.onProgress?.({ page: pageNumber, total: doc.numPages })
    if (results.length % 4 === 0 || pageNumber % 4 === 0) await new Promise((resolve) => setTimeout(resolve, 0))
  }
  const response = { results, indexedPages: candidatePages ? candidatePages.length : doc.numPages, pageCount: doc.numPages }
  if (!candidatePages && results.length <= 10_000) {
    resultCache ||= new Map()
    resultCache.set(searchKey, response)
    while (resultCache.size > 8) resultCache.delete(resultCache.keys().next().value)
    pdfSearchResultCache.set(file, resultCache)
  }
  return response
}

/** Read the PDF outline without blocking initial document display. */
export async function getPdfOutline(file) {
  const cached = pdfOutlineCache.get(file)
  if (cached) return cached
  const pending = (async () => {
    const doc = await getPdfJsDocument(file)
    const outline = await doc.getOutline()
    const rows = []
    const visit = async (items, depth = 0) => {
      for (const item of items || []) {
        let page = null
        try {
          const destination = typeof item.dest === 'string' ? await doc.getDestination(item.dest) : item.dest
          if (Array.isArray(destination) && destination[0]) page = (await doc.getPageIndex(destination[0])) + 1
        } catch { /* Keep outline entries even when the destination is malformed. */ }
        rows.push({ title: item.title || 'Untitled bookmark', page, depth, url: item.url || null })
        if (item.items?.length) await visit(item.items, depth + 1)
      }
    }
    await visit(outline)
    return rows
  })()
  pdfOutlineCache.set(file, pending)
  try { return await pending } catch (error) { pdfOutlineCache.delete(file); throw error }
}

/** Return link hit rectangles and local destinations for one requested page. */
export async function inspectPdfPageLinks(file, pageNumber, rotation = 0) {
  let byPage = pdfLinkCache.get(file)
  if (!byPage) { byPage = new Map(); pdfLinkCache.set(file, byPage) }
  const cacheKey = `${pageNumber}:${Number(rotation) || 0}`
  if (byPage.has(cacheKey)) return byPage.get(cacheKey)
  const doc = await getPdfJsDocument(file)
  const page = await doc.getPage(pageNumber)
  const viewport = page.getViewport({ scale: 1, rotation: page.rotate + (Number(rotation) || 0) })
  const annotations = await page.getAnnotations({ intent: 'display' })
  const links = []
  for (const annotation of annotations || []) {
    if (annotation.subtype !== 'Link' || !Array.isArray(annotation.rect)) continue
    const first = viewport.convertToViewportPoint(annotation.rect[0], annotation.rect[1])
    const second = viewport.convertToViewportPoint(annotation.rect[2], annotation.rect[3])
    const bounds = [first[0], first[1], second[0], second[1]]
    const left = Math.min(bounds[0], bounds[2]), top = Math.min(bounds[1], bounds[3])
    const right = Math.max(bounds[0], bounds[2]), bottom = Math.max(bounds[1], bounds[3])
    let destinationPage = null
    try {
      const destination = typeof annotation.dest === 'string' ? await doc.getDestination(annotation.dest) : annotation.dest
      if (Array.isArray(destination) && destination[0]) destinationPage = (await doc.getPageIndex(destination[0])) + 1
    } catch { /* Keep an unresolved link as a no-op link region. */ }
    links.push({ x: left / viewport.width, y: top / viewport.height, width: (right - left) / viewport.width, height: (bottom - top) / viewport.height, url: annotation.url || null, destinationPage, title: annotation.title || annotation.url || 'PDF link' })
  }
  byPage.set(cacheKey, links)
  page.cleanup()
  return links
}

/** Return positioned native AcroForm widgets for the visible-page interaction layer. */
export async function inspectPdfPageFormFields(file, pageNumber, rotation = 0) {
  let byPage = pdfFormWidgetCache.get(file)
  if (!byPage) { byPage = new Map(); pdfFormWidgetCache.set(file, byPage) }
  const cacheKey = `${pageNumber}:${Number(rotation) || 0}`
  if (byPage.has(cacheKey)) return byPage.get(cacheKey)
  const doc = await getPdfJsDocument(file)
  const page = await doc.getPage(pageNumber)
  const viewport = page.getViewport({ scale: 1, rotation: page.rotate + (Number(rotation) || 0) })
  const annotations = await page.getAnnotations({ intent: 'display' })
  const fields = []
  for (const annotation of annotations || []) {
    if (annotation.subtype !== 'Widget' || !Array.isArray(annotation.rect) || !annotation.fieldName || annotation.hidden) continue
    const first = viewport.convertToViewportPoint(annotation.rect[0], annotation.rect[1])
    const second = viewport.convertToViewportPoint(annotation.rect[2], annotation.rect[3])
    const bounds = [first[0], first[1], second[0], second[1]]
    const left = Math.min(bounds[0], bounds[2]), top = Math.min(bounds[1], bounds[3])
    const right = Math.max(bounds[0], bounds[2]), bottom = Math.max(bounds[1], bounds[3])
    const choices = Array.isArray(annotation.options)
      ? annotation.options.map((choice) => typeof choice === 'string' ? { label: choice, value: choice } : { label: choice?.displayValue ?? choice?.exportValue ?? '', value: choice?.exportValue ?? choice?.displayValue ?? '' })
      : []
    const fieldFlags = Number(annotation.fieldFlags) || 0
    fields.push({
      key: annotation.id || `${annotation.fieldName}-${fields.length}`,
      name: annotation.fieldName,
      type: annotation.fieldType || '',
      value: annotation.fieldValue ?? '',
      radioValue: annotation.radioButtonValue ?? annotation.buttonValue ?? '',
      choices,
      combo: Boolean(annotation.combo),
      multiSelect: Boolean(annotation.multiSelect),
      fontSize: Number(annotation.defaultAppearanceData?.fontSize) || 0,
      readOnly: Boolean(annotation.readOnly),
      required: Boolean(annotation.required),
      multiline: Boolean(annotation.multiline || (fieldFlags & (1 << 12))),
      password: Boolean(annotation.password),
      checkBox: Boolean(annotation.checkBox),
      radioButton: Boolean(annotation.radioButton),
      comb: Boolean(annotation.comb || (fieldFlags & (1 << 24))),
      x: left / viewport.width,
      y: top / viewport.height,
      width: (right - left) / viewport.width,
      height: (bottom - top) / viewport.height,
    })
  }
  byPage.set(cacheKey, fields)
  page.cleanup()
  return fields
}

/** Return PDF image paint bounds in normalized top-left page coordinates.
 * Each region also carries the exact painted quad and the source object id so
 * the editor can re-embed the original pixels instead of a page screenshot. */
export async function inspectPdfPageImages(file, pageNumber, rotation = 0) {
  const doc = await getPdfJsDocument(file)
  const number = Number(pageNumber)
  if (!Number.isInteger(number) || number < 1 || number > doc.numPages) fail(`Choose a page between 1 and ${doc.numPages}.`)
  const page = await doc.getPage(number)
  const viewport = page.getViewport({ scale: 1, rotation: page.rotate + rotation })
  const operators = await page.getOperatorList()
  const { OPS } = pdfjs
  const imageOps = new Set([OPS.paintImageMaskXObject, OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageXObjectRepeat, OPS.paintInlineImageXObjectGroup, OPS.paintImageMaskXObjectGroup, OPS.paintImageMaskXObjectRepeat])
  const multiply = (left, right) => [
    left[0] * right[0] + left[2] * right[1], left[1] * right[0] + left[3] * right[1],
    left[0] * right[2] + left[2] * right[3], left[1] * right[2] + left[3] * right[3],
    left[0] * right[4] + left[2] * right[5] + left[4], left[1] * right[4] + left[3] * right[5] + left[5],
  ]
  const point = (matrix, x, y) => ({ x: matrix[0] * x + matrix[2] * y + matrix[4], y: matrix[1] * x + matrix[3] * y + matrix[5] })
  let transform = [1, 0, 0, 1, 0, 0]
  const stack = []
  const images = []
  for (let index = 0; index < operators.fnArray.length; index += 1) {
    const operation = operators.fnArray[index]
    const args = operators.argsArray[index] || []
    if (operation === OPS.save) stack.push(transform)
    else if (operation === OPS.restore) transform = stack.pop() || transform
    else if (operation === OPS.transform && args.length >= 6) transform = multiply(transform, args.slice(0, 6))
    else if (imageOps.has(operation)) {
      const combined = multiply(viewport.transform, transform)
      const capture = captureImagePlacement(combined, Number(args[1]) || 0, Number(args[2]) || 0)
      const corners = [point(combined, 0, 0), point(combined, 1, 0), point(combined, 0, 1), point(combined, 1, 1)]
      const left = Math.max(0, Math.min(...corners.map((corner) => corner.x)))
      const top = Math.max(0, Math.min(...corners.map((corner) => corner.y)))
      const right = Math.min(viewport.width, Math.max(...corners.map((corner) => corner.x)))
      const bottom = Math.min(viewport.height, Math.max(...corners.map((corner) => corner.y)))
      if (right - left > 2 && bottom - top > 2) images.push({
        key: `image-${images.length}`,
        x: left / viewport.width,
        y: top / viewport.height,
        width: (right - left) / viewport.width,
        height: (bottom - top) / viewport.height,
        quad: corners.map((corner) => ({ x: corner.x / viewport.width, y: corner.y / viewport.height })),
        sourceId: typeof args[0] === 'string' ? args[0] : null,
        combined,
        tiled: operation === OPS.paintImageXObjectRepeat || operation === OPS.paintImageMaskXObjectRepeat,
        imageTransform: combined.map((n, i) => n / (i % 2 ? viewport.height : viewport.width)),
        /* The capture bakes the placement of the image into the pixels, so
         * the source size is the size of the capture: a rotated image is
         * captured rotated. */
        sourceWidth: capture.canvasWidth || null,
        sourceHeight: capture.canvasHeight || null,
        complexTransform: Math.abs(combined[0] * combined[2] + combined[1] * combined[3]) > .01,
      })
    }
  }
  return images
}

/** The store that holds a PDF.js image object.
 *
 * PDF.js keeps a page-local image in the page object store, but an image that
 * is used on more than one page is cached globally and delivered to the shared
 * store under an id that starts with "g_". Asking the page store for a shared
 * id leaves the request pending forever, because PDF.js only resolves an
 * object when the worker delivers it. */
export function pdfImageObjectStore(page, sourceId) {
  if (!page || !sourceId) return null
  return typeof sourceId === 'string' && sourceId.startsWith('g_')
    ? page.commonObjs
    : page.objs
}

/** Read a PDF.js image object, giving up after `timeoutMs`.
 *
 * The lookup is bounded on purpose: an object that PDF.js never delivers must
 * report a missing image instead of waiting for the next edit. */
export function readPdfImageObject(store, sourceId, timeoutMs = 1500) {
  if (!store || !sourceId) return Promise.resolve(null)
  try {
    if (store.has(sourceId)) return Promise.resolve(store.get(sourceId) || null)
  } catch {
    return Promise.resolve(null)
  }
  return new Promise((resolve) => {
    let settled = false
    let timer = null
    const finish = (value) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      resolve(value || null)
    }
    timer = setTimeout(() => finish(null), Math.max(1, Number(timeoutMs) || 1500))
    try {
      store.get(sourceId, (data) => finish(data))
    } catch {
      finish(null)
    }
  })
}

/** Decode one painted PDF image and bake it, with its own transform, into PNG
 * bytes. The result keeps the source pixels and orientation, so a moved or
 * rotated image is redrawn from the original artwork. */
export async function capturePdfImageSource(file, pageNumber, sourceId, combined, options = {}) {
  if (!sourceId || !Array.isArray(combined) || combined.length < 6)
    throw new Error('This image cannot be read from the PDF. Replace it with a file instead.')
  const doc = await getPdfJsDocument(file)
  const page = await doc.getPage(Number(pageNumber))
  const source = await readPdfImageObject(
    pdfImageObjectStore(page, sourceId),
    sourceId,
    options.timeoutMs,
  )
  if (!source) throw new Error('The image data is not ready. Try again in a moment.')
  const width = Number(source.width) || Number(source.bitmap?.width) || 0
  const height = Number(source.height) || Number(source.bitmap?.height) || 0
  if (!width || !height) throw new Error('This image has no readable pixels.')
  const { matrix, canvasWidth, canvasHeight } = captureImagePlacement(combined, width, height)
  const canvas = document.createElement('canvas')
  canvas.width = canvasWidth
  canvas.height = canvasHeight
  const context = canvas.getContext('2d')
  let sourceCanvas = null
  try {
    if (source.bitmap) sourceCanvas = source.bitmap
    else if (typeof ImageBitmap !== 'undefined' && source instanceof ImageBitmap) sourceCanvas = source
    else if (source.data?.length === width * height * 4) {
      sourceCanvas = document.createElement('canvas')
      sourceCanvas.width = width
      sourceCanvas.height = height
      sourceCanvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(source.data), width, height), 0, 0)
    } else if (source.data?.length === width * height * 3) {
      const rgba = new Uint8ClampedArray(width * height * 4)
      for (let p = 0, q = 0; p < source.data.length; p += 3, q += 4) { rgba[q] = source.data[p]; rgba[q + 1] = source.data[p + 1]; rgba[q + 2] = source.data[p + 2]; rgba[q + 3] = 255 }
      sourceCanvas = document.createElement('canvas')
      sourceCanvas.width = width
      sourceCanvas.height = height
      sourceCanvas.getContext('2d').putImageData(new ImageData(rgba, width, height), 0, 0)
    }
    if (!sourceCanvas) throw new Error('This image format cannot be decoded in the editor.')
    context.save()
    context.setTransform(...matrix)
    context.imageSmoothingQuality = 'high'
    context.drawImage(sourceCanvas, 0, 0, 1, 1)
    context.restore()
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
    canvas.width = 0
    canvas.height = 0
    if (!blob) throw new Error('Could not encode the image.')
    return { data: new Uint8Array(await blob.arrayBuffer()), type: 'image/png', width: canvasWidth, height: canvasHeight }
  } finally {
    if (sourceCanvas && sourceCanvas !== source.bitmap && sourceCanvas !== source) { sourceCanvas.width = 0; sourceCanvas.height = 0 }
  }
}

export function hydratePdfTextLayerStyles(container) {
  const metadata = pdfTextLayerMetadata.get(container)
  if (!metadata) return
  const { page, items, textDivs, viewport, colors } = metadata
  let divIndex = 0
  for (const [itemIndex, item] of items.entries()) {
    if (item.str === undefined) continue
    const textDiv = textDivs[divIndex++]
    if (!textDiv || !item.str) continue
    if (colors?.[itemIndex]?.color) { textDiv.dataset.pdfColor = colors[itemIndex].color; textDiv.dataset.pdfColorRanges = JSON.stringify(colors[itemIndex].ranges) }
    const fontSize = Math.hypot(item.transform?.[2] || 0, item.transform?.[3] || 0)
    if (fontSize > 0) textDiv.dataset.pdfFontSize = String(fontSize)
    if (viewport && item.transform?.length >= 6) {
      const [baselineX, baselineY] = viewport.convertToViewportPoint(item.transform[4], item.transform[5])
      textDiv.dataset.pdfBaselineX = String(baselineX)
      textDiv.dataset.pdfRotation = String(((Number.parseFloat(textDiv.style.getPropertyValue('--rotate')) || 0) + viewport.rotation + 360) % 360)
      textDiv.dataset.pdfBaselineY = String(baselineY)
    }
    try {
      const font = page.commonObjs.has(item.fontName) ? page.commonObjs.get(item.fontName) : null
      if (!font) continue
      textDiv.dataset.pdfFontSourceName = font.name || ''
      textDiv.dataset.pdfFontWeight = font.bold || font.black || Number(font.cssFontInfo?.fontWeight) >= 600 || /bold|black|heavy|demi|semibold/i.test(font.name || '') ? '700' : '400'
      const fontNames = `${font.name || ''} ${font.loadedName || ''} ${font.fallbackName || ''} ${font.cssFontInfo?.fontFamily || ''}`.toLowerCase()
      const italicAngle = Number.parseFloat(font.cssFontInfo?.italicAngle)
      const cssFontStyle = window.getComputedStyle(textDiv).fontStyle
      const [a = 0, b = 0, c = 0, d = 0] = item.transform || []
      const horizontalLength = Math.hypot(a, b)
      const verticalLength = Math.hypot(c, d)
      const normalizedShear = horizontalLength && verticalLength ? Math.abs((a * c + b * d) / (horizontalLength * verticalLength)) : 0
      const hasItalicStyle = Boolean(font.italic)
        || (Number.isFinite(italicAngle) && Math.abs(italicAngle) > 0.01)
        || /italic|oblique|slanted/i.test(fontNames)
        || /italic|oblique/i.test(cssFontStyle)
        // Some PDFs simulate italics by shearing text instead of using an italic font.
        || normalizedShear > 0.025
      textDiv.dataset.pdfFontStyle = hasItalicStyle ? 'italic' : 'normal'
      if (horizontalLength > 0) textDiv.dataset.pdfFontScaleX = String(horizontalLength)
      if (typeof item.width === "number") textDiv.dataset.pdfWidth = String(item.width)
      const rawFontName = String(font.name || font.loadedName || font.cssFontInfo?.fontFamily || "")
      const resolved = resolveFontFamilyStack(rawFontName, font.fallbackName)
      textDiv.dataset.pdfFontFamily = resolved.family
      textDiv.dataset.pdfPreviewFontFamily = font.loadedName ? `"${font.loadedName}", ${resolved.cssStack}` : resolved.cssStack
      textDiv.dataset.pdfFontCssStack = resolved.cssStack
    } catch {}
  }
}

/** Render a compact page thumbnail for the document page rail. */
export async function renderPdfThumbnail(file, pageNumber, canvas, targetWidth = 168, priority = 5, renderOptions = {}) {
  if (renderOptions.signal?.aborted) return { status: 'CANCELLED' }
  try {
    const size = await inspectPdfPageSize(file, pageNumber)
    if (renderOptions.signal?.aborted) return { status: 'CANCELLED' }
    return renderPdfPage(file, pageNumber, canvas, Math.min(1, targetWidth / size.width), { ...renderOptions, priority, thumbnail: true })
  } catch (error) { return renderOptions.signal?.aborted ? { status: 'CANCELLED' } : { status: 'FAILED', error } }
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

export async function unlockEditorPdf(file) { const toolkit=await getQpdfToolkit(); const data=await toolkit.unlock(await readFile(file),{password:file.pdfPassword});return new File([data],file.name,{type:PDF_MIME}) }

export async function encryptEditorPdf(file,password) {const toolkit=await getQpdfToolkit();return new File([await toolkit.lock(await readFile(file),{userPassword:password,ownerPassword:password,keyLength:256})],file.name,{type:PDF_MIME})}

export async function detectPdfFormFields(file,pageNumber,rotation=0) {const doc=await getPdfJsDocument(file),page=await doc.getPage(pageNumber),viewport=page.getViewport({scale:1,rotation:page.rotate+rotation});const text=await page.getTextContent();return detectTextFormCandidates(text.items,viewport).map(candidate=>({...candidate,page:pageNumber,viewerRotation:rotation}))}
