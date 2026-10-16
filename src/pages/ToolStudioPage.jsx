import { RichTextInput } from '../editor/RichTextInput'
import { appendTextStyleRange, textStyleAt } from '../editor/textStyles'
import { captureRevision, assertRevision, sessionAfterWrite } from '../editor/revisionGuard'
import { displayRect, imagePlacement } from '../editor/coordinates'
import { prepareImageOperations } from '../editor/prepareImages'
import { RegionLayer } from '../editor/RegionLayer'
import { FormCandidatesPanel } from '../editor/FormCandidatesPanel'
import { PropertiesDialog } from '../editor/PropertiesDialog'
import { SignaturePanel } from '../editor/SignaturePanel'
import { AnnotationLayer } from '../editor/AnnotationLayer'
import { createDocumentSession, revisedSession, isSessionDirty, markSessionSaved } from '../editor/documentSession'
import { pushHistory, boundHistory } from '../editor/history'
import { commitOperations } from '../editor/commit'
import { getLocalFont, listLocalFonts } from '../editor/localFonts'
import { writeEditorDocument } from '../editor/save'
import React, { useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '../icons'
import { ToolCard } from '../components/ToolCard'
import { allTools } from '../toolsData'
import { forgetPdfCopy, rememberPdf, saveOutput } from '../fileServices'
import { Presence } from '../components/Presence'
import { loadShortcuts, matchesShortcut } from '../keyboardShortcuts'

const renderFileIds = new WeakMap()
let renderFileSequence = 0
const renderFileId = file => { if (!renderFileIds.has(file)) renderFileIds.set(file, ++renderFileSequence); return renderFileIds.get(file) }
const EMPTY_FILES = []
const DEFAULT_PDF_PAGE_SIZE = { width: 612, height: 792, rotation: 0 }
const DEFAULT_PDF_TEXT_STYLE = { fontSize: 14, fontFamily: 'Helvetica', color: '#111111', bold: false, italic: false }
const PDF_TEXT_FONTS = ['Arial', 'Arial Narrow', 'Aptos', 'Calibri', 'Cambria', 'Comic Sans MS', 'Courier New', 'DejaVu Sans', 'Georgia', 'Garamond', 'Helvetica', 'Impact', 'Liberation Sans', 'Noto Sans', 'Palatino', 'Tahoma', 'Times New Roman', 'Trebuchet MS', 'Verdana']
const pdfFileIdentity = (file) => file ? `${file.name}:${file.size}:${file.lastModified}` : ''

const inputAccept = (toolId) => {
  if (toolId === 'jpg-to-pdf') return 'image/jpeg,image/png,.jpg,.jpeg,.png'
  if (toolId === 'word-to-pdf') return '.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  if (toolId === 'powerpoint-to-pdf') return '.pptx,.ppt,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.ms-powerpoint'
  if (toolId === 'merge-pdf') return 'application/pdf,.pdf'
  return 'application/pdf,.pdf'
}

const formatBytes = (size) => size < 1024 ? `${size} B` : size < 1024 * 1024 ? `${(size / 1024).toFixed(1)} KB` : `${(size / 1024 / 1024).toFixed(2)} MB`
const escapePreviewHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character])
const pageSelectionTools = new Set(['delete-pages', 'extract-pages', 'duplicate-pages', 'rotate-pages', 'crop-pdf'])
const aggregateInputTools = new Set(['merge-pdf', 'jpg-to-pdf'])
const singleDocumentTools = new Set(['pdf-editor'])
const expandPageSequence = (value, pageCount) => {
  if (!String(value || '').trim()) return null
  const result = []
  for (const raw of String(value).split(',')) {
    const token = raw.trim()
    const range = token.match(/^(\d+)\s*-\s*(\d+)$/)
    if (range) {
      const start = Number(range[1]), end = Number(range[2])
      if (start < 1 || end < start || end > pageCount) return null
      for (let number = start; number <= end; number += 1) result.push(number)
    } else if (/^\d+$/.test(token) && Number(token) >= 1 && Number(token) <= pageCount) result.push(Number(token))
    else return null
  }
  return result
}

function OrganizePageThumbnail({ file, page, selected, selectable, reorderable, first, last, onToggle, onMove }) {
  const canvas = useRef(null)
  const [visible, setVisible] = useState(false)
  const [previewError, setPreviewError] = useState(false)
  useEffect(() => {
    const element = canvas.current
    if (!element) return undefined
    if (!('IntersectionObserver' in window)) { setVisible(true); return undefined }
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setVisible(true); observer.disconnect() }
    }, { rootMargin: '180px 0px' })
    observer.observe(element)
    return () => observer.disconnect()
  }, [file, page])
  useEffect(() => {
    if (!visible || !canvas.current) return
    const target = canvas.current, job = new AbortController()
    setPreviewError(false)
    import('../pdfEngine').then(({ renderPdfThumbnail }) => job.signal.aborted ? null : renderPdfThumbnail(file, page, target, 168, 5, { signal: job.signal }))
      .then(result => { if (!job.signal.aborted && result?.status === 'FAILED') setPreviewError(true) })
      .catch(() => { if (!job.signal.aborted) setPreviewError(true) })
    return () => { job.abort(); target.width = 0; target.height = 0 }
  }, [file, page, visible])
  return <article className={`organize-page-card ${selected ? 'is-selected' : ''}`}>
    <button className="organize-page-select" type="button" onClick={onToggle} aria-pressed={selectable ? selected : undefined} aria-label={selectable ? `${selected ? 'Deselect' : 'Select'} page ${page}` : `Preview page ${page}`} disabled={!selectable}>
      <span className="organize-page-paper"><canvas ref={canvas} />{previewError && <span className="thumbnail-error" role="img" aria-label={`Preview unavailable for page ${page}`}><Icon name="file" size={18} /></span>}<span className="organize-page-check"><Icon name="check" size={13} /></span></span>
      <span className="organize-page-meta"><strong>Page {page}</strong><small>{selected ? 'Selected' : reorderable ? 'Use arrows to move' : selectable ? 'Click to select' : 'Preview'}</small></span>
    </button>
    {reorderable && <div className="organize-page-order" aria-label={`Reorder page ${page}`}>
      <button type="button" onClick={() => onMove(-1)} disabled={first} aria-label={`Move page ${page} earlier`}><Icon name="arrowLeft" size={13} /></button>
      <button type="button" onClick={() => onMove(1)} disabled={last} aria-label={`Move page ${page} later`}><Icon name="arrow" size={13} /></button>
    </div>}
  </article>
}

function OutputPdfPreview({ file }) {
  const [pdfInfo, setPdfInfo] = useState(null)
  const [error, setError] = useState('')
  const [page, setPage] = useState(1)

  useEffect(() => {
    let active = true
    import('../pdfEngine').then(({ inspectPdfOverview }) => inspectPdfOverview(file)).then((info) => {
      if (active) { setPdfInfo(info); setPage(1); setError('') }
    }).catch((cause) => { if (active) setError(cause?.message || 'Could not render this PDF preview.') })
    return () => { active = false }
  }, [file])

  if (error) return <div className="output-preview-message" role="alert">{error}</div>
  if (!pdfInfo) return <div className="output-preview-message" role="status">Loading PDF preview…</div>
  return <div className="output-preview-pdf"><PdfViewer file={file} page={page} pageCount={pdfInfo.pageCount} pageSizes={pdfInfo.pages} onPageChange={setPage} /></div>
}

function OutputDocxPreview({ data, title }) {
  const container = useRef(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    const element = container.current
    if (!element) return undefined
    element.replaceChildren()
    setLoading(true)
    setError('')
    import('docx-preview').then(({ renderAsync }) => renderAsync(data, element, element, {
      className: 'docx-preview',
      inWrapper: true,
      breakPages: true,
      ignoreWidth: false,
      ignoreHeight: false,
      useBase64URL: true,
      renderHeaders: true,
      renderFooters: true,
    })).then(() => {
      if (!active) return
      // docx-preview otherwise leaves page-relative floating pictures inside
      // their source paragraph. Move those anchors to the page coordinate
      // system used by the downloaded DOCX so their size and placement agree.
      for (const page of element.querySelectorAll('section.docx-preview')) {
        page.style.position = 'relative'
        for (const anchor of page.querySelectorAll('div[style*="width: 0px"][style*="height: 0px"]')) {
          if (!anchor.querySelector('img')) continue
          anchor.style.position = 'absolute'
          anchor.style.zIndex = '2'
          anchor.style.margin = '0'
          page.append(anchor)
        }
      }
      setLoading(false)
    })
      .catch((cause) => { if (active) { setError(cause?.message || 'Could not render this Word document preview.'); setLoading(false) } })
    return () => { active = false; element.replaceChildren() }
  }, [data])

  return <div className="output-preview-docx" aria-label={`Word document preview of ${title}`}>
    {loading && <div className="output-preview-message" role="status">Rendering Word pages…</div>}
    {error && <div className="output-preview-message" role="alert">{error}</div>}
    <div ref={container} className="output-preview-docx-pages" />
  </div>
}

const createInitialOptions = () => ({
  pages: '', ranges: '1-3', splitMode: 'ranges', rotation: 90, watermarkText: 'CONFIDENTIAL',
  opacity: 35, angle: 45, position: 'bottom-center', startNumber: 1, format: '{n}', dpi: 144,
  quality: 'recommended', margins: { top: 10, right: 15, bottom: 10, left: 15 },
  language: 'eng', ocrDpi: 200,
  signature: '', annotationText: '', password: '', confirmPassword: '', pageSize: 'a4',
  redactPage: '1', redactX: 0, redactY: 0, redactWidth: 0, redactHeight: 0,
  signaturePage: '1', annotationPage: '1', bookmarksText: '',
})

export function ToolStudioPage({ toolId, initialFiles = EMPTY_FILES, initialDraft, tabId, onDraftChange = () => {}, openPicker = false, onNavigate, onSelectTool, editorRef, onDirtyChange = () => {}, onBeforeDiscard = (action) => action() }) {
  const tool = allTools.find((item) => item.id === toolId) || allTools[0]
  const restoredDraft = initialDraft?.toolId === toolId ? initialDraft : null
  const picker = useRef(null)
  const [files, setFiles] = useState(() => initialFiles.length ? initialFiles : restoredDraft?.files || EMPTY_FILES)
  const [options, setOptions] = useState(() => restoredDraft?.options || createInitialOptions())
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState(() => restoredDraft?.message || '')
  const [error, setError] = useState(() => restoredDraft?.error || '')
  const [outputs, setOutputs] = useState(() => restoredDraft?.outputs || [])
  const [preview, setPreview] = useState(null)
  const previewUrl = useRef(null)
  const savingRef = useRef(false)
  const [pageCount, setPageCount] = useState(null)
  const [pageSizes, setPageSizes] = useState([])
  const [formFields, setFormFields] = useState([])
  const [progress, setProgress] = useState(null)
  const [redactMarked, setRedactMarked] = useState(() => restoredDraft?.redactMarked || false)
  const [dragging, setDragging] = useState(false)
  const [fileSelectorOpen, setFileSelectorOpen] = useState(false)
  const [recentFiles, setRecentFiles] = useState([])
  const [fileSearch, setFileSearch] = useState('')
  const [filePickerActiveIndex, setFilePickerActiveIndex] = useState(0)
  const [filePickerKeyboardNav, setFilePickerKeyboardNav] = useState(false)
  const [filePickerDragging, setFilePickerDragging] = useState(false)
  const [filePickerBusy, setFilePickerBusy] = useState(false)
  const [selectedPages, setSelectedPages] = useState(() => restoredDraft?.selectedPages || [])
  const [pageOrder, setPageOrder] = useState(() => restoredDraft?.pageOrder || [])
  const jobId = useRef(0)
  const jobController = useRef(null)
  const jobInputs = useRef(null)
  jobInputs.current = { files, toolId, options }
  useEffect(() => () => {
    jobId.current += 1
    jobController.current?.abort()
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current)
  }, [])

  const openFileSelector = () => {
    setFileSearch('')
    setFilePickerActiveIndex(0)
    setFilePickerKeyboardNav(false)
    setFileSelectorOpen(true)
    Promise.resolve(window.pdfKing?.getRecentFiles?.()).then((records) => setRecentFiles(Array.isArray(records) ? records : [])).catch(() => setRecentFiles([]))
  }

  useEffect(() => {
    setFiles(initialFiles.length ? initialFiles : restoredDraft?.files || EMPTY_FILES)
    setOptions(restoredDraft?.options || createInitialOptions())
    setOutputs(restoredDraft?.outputs || [])
    setError(restoredDraft?.error || '')
    setMessage(restoredDraft?.message || '')
    setPageCount(null)
    setPageSizes([])
    setRedactMarked(restoredDraft?.redactMarked || false)
    setSelectedPages(restoredDraft?.selectedPages || [])
    setPageOrder(restoredDraft?.pageOrder || [])
    setPreview(null)
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current)
    previewUrl.current = null
  }, [toolId, initialFiles])

  useEffect(() => {
    onDraftChange(tabId, { toolId, files, options, outputs, redactMarked, selectedPages, pageOrder, error, message })
  }, [tabId, toolId, files, options, outputs, redactMarked, selectedPages, pageOrder, error, message, onDraftChange])

  useEffect(() => {
    if (['protect-pdf', 'unlock-pdf', 'redact-pdf'].includes(toolId)) return
    initialFiles.forEach((file) => rememberPdf(file).catch(() => {}))
  }, [toolId, initialFiles])

  useEffect(() => {
    if (!openPicker) return
    openFileSelector()
    onNavigate({ type: 'tool', toolId, openPicker: false })
  }, [openPicker, onNavigate, toolId])

  useEffect(() => {
    let active = true
    if (files.length === 1 && files[0].name.toLowerCase().endsWith('.pdf')) {
      import('../pdfEngine').then(({ inspectPdfOverview }) => inspectPdfOverview(files[0])).then((info) => { if (active) { setPageCount(info.pageCount); setPageSizes(info.pages) } }).catch(() => { if (active) { setPageCount(null); setPageSizes([]) } })
    } else { setPageCount(null); setPageSizes([]) }
    return () => { active = false }
  }, [files])

  const pageIdentity = files.map(renderFileId).join('|')
  const previousPageIdentity = useRef(pageIdentity)
  const initialPageIdentity = useRef(pageIdentity)
  useEffect(() => {
    if (restoredDraft && pageCount && pageIdentity === initialPageIdentity.current) return
    if (previousPageIdentity.current !== pageIdentity) {
      previousPageIdentity.current = pageIdentity
      setSelectedPages([])
      setPageOrder(pageCount ? Array.from({ length: pageCount }, (_, index) => index + 1) : [])
      setOptions((current) => ({ ...current, pages: '' }))
      setOutputs([])
    }
    // Parsing must not reset user options or invalidate an operation already
    // started on these files. Initialize order only; input changes reset above.
    if (pageCount) setPageOrder(current => current.length ? current : Array.from({ length: pageCount }, (_, index) => index + 1))
  }, [pageCount, pageIdentity])

  useEffect(() => {
    if (!pageCount) return
    if (toolId === 'organize-pdf') {
      const parsed = expandPageSequence(options.pages, pageCount)
      if (parsed) setPageOrder(parsed)
    } else if (pageSelectionTools.has(toolId)) {
      const parsed = expandPageSequence(options.pages, pageCount)
      setSelectedPages(parsed ? [...new Set(parsed)] : [])
    }
  }, [toolId, options.pages, pageCount])

  const togglePage = (page) => {
    setSelectedPages((current) => {
      const next = current.includes(page) ? current.filter((number) => number !== page) : [...current, page].sort((a, b) => a - b)
      setOptions((existing) => ({ ...existing, pages: next.join(', ') }))
      return next
    })
  }

  const movePage = (page, offset, occurrence = 0) => {
    setPageOrder((current) => {
      const index = current.reduce((found, value, position) => value === page && occurrence-- === 0 ? position : found, -1)
      const target = index + offset
      if (target < 0 || target >= current.length) return current
      const next = [...current]
      ;[next[index], next[target]] = [next[target], next[index]]
      setOptions((existing) => ({ ...existing, pages: next.join(', ') }))
      return next
    })
  }

  useEffect(() => {
    let active = true
    if (toolId === 'fill-forms' && files.length === 1) {
      import('../pdfEngine').then(({ inspectPdfForm }) => inspectPdfForm(files[0])).then((fields) => { if (active) setFormFields(fields) }).catch((cause) => { if (active) { setFormFields([]); setError(cause.message || 'Could not read PDF form fields.') } })
    } else setFormFields([])
    return () => { active = false }
  }, [toolId, files])

  const setOption = (key, value) => {
    setOptions((current) => ({ ...current, [key]: value }))
    setOutputs([])
    onDirtyChange(true)
  }
  const addFiles = (incoming) => {
    const picked = Array.from(incoming || [])
    if (!picked.length) return
    const multi = aggregateInputTools.has(tool.id) || !singleDocumentTools.has(tool.id)
    const next = multi ? [...files, ...picked] : picked.slice(0, 1)
    const allowed = next.find((file) => !accepts(toolId, file))
    if (allowed) {
      setError(`“${allowed.name}” is not a supported file for ${tool.name}.`)
      return
    }
    onBeforeDiscard(() => {
      jobId.current += 1
      setError('')
      setOutputs([])
      onDirtyChange(false)
      setFiles(next)
      if (!['protect-pdf', 'unlock-pdf', 'redact-pdf'].includes(toolId) && next.length === 1) rememberPdf(next[0]).catch(() => {})
    })
  }

  const openRecentFile = async (record) => {
    if (!window.pdfKing?.readRecentFile) return
    setFilePickerBusy(true)
    try {
      const data = await window.pdfKing.readRecentFile(record.id)
      if (!data) throw new Error('Could not read this recent file.')
      const file = new File([data], record.name, { type: 'application/pdf' })
      if (!accepts(toolId, file)) {
        setError(`“${file.name}” is not a supported file for ${tool.name}.`)
        return
      }
      addFiles([file])
      if (!(tool.kind === 'merge' || toolId === 'jpg-to-pdf')) setFileSelectorOpen(false)
    } catch (cause) {
      setError(cause.message || 'Could not open this recent file.')
    } finally { setFilePickerBusy(false) }
  }

  const filteredRecentFiles = recentFiles.filter((record) => record?.name?.toLowerCase().includes(fileSearch.trim().toLowerCase()) && accepts(toolId, { name: record.name, type: 'application/pdf' }))
  useEffect(() => {
    if (fileSelectorOpen) document.querySelector(`[data-file-picker-index="${filePickerActiveIndex}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [fileSelectorOpen, filePickerActiveIndex, filteredRecentFiles.length])

  const handleFilePickerKeyDown = (event) => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setFileSelectorOpen(false); return }
    if (event.key === 'Enter' && event.target instanceof HTMLInputElement) {
      event.preventDefault()
      if (filePickerBusy) return
      const record = filteredRecentFiles[filePickerActiveIndex]
      if (record) void openRecentFile(record)
      else picker.current?.click()
      return
    }
    if (!filteredRecentFiles.length) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      setFilePickerKeyboardNav(true)
      setFilePickerActiveIndex((index) => event.key === 'ArrowDown'
        ? Math.min(index + 1, filteredRecentFiles.length - 1)
        : Math.max(index - 1, 0))
    }
  }

  const handleFilePickerDrop = (event) => {
    event.preventDefault()
    event.stopPropagation()
    setFilePickerDragging(false)
    const incoming = Array.from(event.dataTransfer.files || [])
    addFiles(incoming)
    if (incoming.length && incoming.every((incomingFile) => accepts(toolId, incomingFile))) setFileSelectorOpen(false)
  }

  const run = async () => {
    if (!files.length) { openFileSelector(); return [] }
    const currentJob = ++jobId.current
    const controller = new AbortController()
    jobController.current = controller
    const source = { files, toolId, options }
    jobInputs.current = source
    setBusy(true)
    setError('')
    setProgress({ value: 0, message: 'Preparing the operation…' })
    setMessage('Processing on this device…')
    setOutputs([])
    onDirtyChange(true)
    try {
      const runOptions = {
        ...options,
        ...(toolId === 'crop-pdf' ? options.margins : {}),
        ...(toolId === 'add-watermark' ? { opacity: Number(options.opacity) / 100, text: options.watermarkText } : {}),
        ...(toolId === 'compress-pdf' ? { level: options.quality === 'lossless' ? 'lossless' : options.quality === 'small' ? 'extreme' : options.quality === 'high' ? 'light' : 'recommended', quality: options.quality === 'small' ? 0.42 : options.quality === 'high' ? 0.86 : 0.68 } : {}),
        ...(toolId === 'split-pdf' ? { mode: options.splitMode === 'each' ? 'all' : 'range' } : {}),
        ...(toolId === 'redact-pdf' ? { redactions: redactMarked ? [{ page: Number(options.redactPage), x: Number(options.redactX), y: Number(options.redactY), width: Number(options.redactWidth), height: Number(options.redactHeight), normalized: true }] : [] } : {}),
        ...(toolId === 'edit-bookmarks' ? { bookmarks: options.bookmarksText.split('\n').map((line) => { const match = line.match(/^\s*(\d+)\s*[:|]\s*(.+?)\s*$/); return match ? { page: Number(match[1]), title: match[2] } : null }).filter(Boolean) } : {}),
      }
      const { processTool } = await import('../pdfEngine')
      const result = await processTool({ toolId, files, options: runOptions, signal: controller.signal, onProgress: (state) => { if(jobId.current===currentJob&&!controller.signal.aborted){setProgress(state);setMessage(state.message)} } })
      if (jobId.current !== currentJob) return []
      if (controller.signal.aborted || jobInputs.current.files !== source.files || jobInputs.current.toolId !== source.toolId || jobInputs.current.options !== source.options) {setProgress(null);setMessage('Inputs changed during processing. Run the tool again.');return []}
      const nextOutputs = result.outputs || []
      setOutputs(nextOutputs)
      onDirtyChange(nextOutputs.length > 0 || (toolId === 'redact-pdf' && redactMarked))
      setMessage(result.message || `${nextOutputs.length} output file${nextOutputs.length === 1 ? '' : 's'} ready.`)
      setProgress(null)
      return nextOutputs
    } catch (cause) {
      if (jobId.current !== currentJob) return []
      setProgress(null)
      setMessage('')
      setError(cause?.message || 'The document could not be processed.')
      onDirtyChange(toolId === 'redact-pdf' && redactMarked)
      return []
    } finally {
      if (jobController.current === controller) jobController.current = null
      if (jobId.current === currentJob) setBusy(false)
    }
  }

  const save = async (output, pendingOutputs = outputs) => {
    if (savingRef.current) return false
    savingRef.current = true
    try {
      const result = await saveOutput(output, { recordRecent: !['unlock-pdf', 'compress-pdf'].includes(toolId) })
      if (!result) return false
      const remaining = pendingOutputs.filter((item) => item !== output)
      setOutputs(remaining)
      onDirtyChange(remaining.length > 0)
      setMessage(`Saved ${output.name}`)
      return remaining
    } catch (cause) { setError(cause?.message || 'Could not save the output file.'); return false }
    finally { savingRef.current = false }
  }

  const saveCurrentToDevice = async () => {
    const output = outputs[0] || (file && { name: file.name || 'document.pdf', data: new Uint8Array(await file.arrayBuffer()), mimeType: 'application/pdf' })
    if (!output) return
    if (outputs[0]) await save(output)
    else {
      try { await saveOutput(output); setMessage(`Saved ${output.name}`); setError('') }
      catch (cause) { setError(cause.message || 'Could not save the PDF to your device.') }
    }
  }

  const printPdf = async () => {
    if (!file) return
    const pdfOutput = outputs.find((item) => (item.mimeType || '').startsWith('application/pdf'))
    try {
      const data = pdfOutput?.data || new Uint8Array(await file.arrayBuffer())
      if (window.pdfKing?.printPdf) await window.pdfKing.printPdf({ name: pdfOutput?.name || file.name || 'document.pdf', data })
      else {
        const url = URL.createObjectURL(new Blob([data], { type: 'application/pdf' }))
        const frame = document.createElement('iframe')
        frame.title = 'Print PDF'
        frame.style.cssText = 'position:fixed;width:1px;height:1px;right:0;bottom:0;border:0;opacity:0'
        frame.src = url
        document.body.appendChild(frame)
        frame.onload = () => { frame.contentWindow?.print(); window.setTimeout(() => { frame.remove(); URL.revokeObjectURL(url) }, 60000) }
      }
    } catch (cause) { setError(cause.message || 'The PDF could not be sent to the print dialog.') }
  }

  const viewOutput = async (output) => {
    const mimeType = (output.mimeType || '').split(';')[0]
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current)
    previewUrl.current = null
    try {
      if (mimeType === 'application/pdf') {
        const file = new File([output.data], output.name, { type: mimeType })
        setPreview({ title: output.name, mimeType, file })
        return
      }
      if (mimeType.startsWith('image/')) {
        const url = URL.createObjectURL(new Blob([output.data], { type: mimeType }))
        previewUrl.current = url
        setPreview({ title: output.name, mimeType, url })
        return
      }
      if (mimeType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation') {
        const { PptxRenderer } = await import('pptx-browser')
        const renderer = new PptxRenderer()
        try {
          await renderer.load(new Uint8Array(output.data))
          const slides = []
          for (let index = 0; index < renderer.slideCount; index += 1) {
            const canvas = document.createElement('canvas')
            await renderer.renderSlide(index, canvas, 1280)
            slides.push(`<figure><img src="${canvas.toDataURL('image/png')}" alt="Slide ${index + 1}"><figcaption>Slide ${index + 1}</figcaption></figure>`)
          }
          setPreview({ title: output.name, mimeType: 'text/html', html: `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font:14px/1.5 system-ui,sans-serif;background:#181a20;color:#fff;margin:0;padding:24px;display:grid;gap:24px}figure{margin:0 auto;max-width:1280px;width:100%}img{width:100%;height:auto;background:#fff}figcaption{text-align:center;padding:8px;color:#c8cad2}</style></head><body>${slides.join('')}</body></html>` })
        } finally { renderer.destroy() }
        return
      }
      let title = output.name
      let content = ''
      if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
        setPreview({ title, mimeType, data: new Uint8Array(output.data) })
        return
      } else {
        content = `<pre>${escapePreviewHtml(new TextDecoder().decode(output.data))}</pre>`
      }
      const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapePreviewHtml(title)}</title><style>body{font:16px/1.55 system-ui,sans-serif;color:#222;max-width:900px;margin:40px auto;padding:0 24px}img{max-width:100%;height:auto}table{border-collapse:collapse;width:100%;margin:16px 0}td,th{border:1px solid #bbb;padding:7px 10px;text-align:left}pre{white-space:pre-wrap;overflow-wrap:anywhere}</style></head><body>${content}</body></html>`
      setPreview({ title, mimeType: 'text/html', html })
    } catch (cause) {
      setError(cause.message || `Could not preview ${output.name}.`)
    }
  }

  const previewInput = async (file) => {
    const extension = file.name.split('.').pop()?.toLowerCase()
    const inferredType = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', ppt: 'application/vnd.ms-powerpoint' }[extension]
    const mimeType = !file.type || file.type === 'application/octet-stream' ? inferredType || file.type || 'application/octet-stream' : file.type
    if (previewUrl.current) { URL.revokeObjectURL(previewUrl.current); previewUrl.current = null }
    if (mimeType === 'application/pdf') {
      setPreview({ title: file.name, mimeType, file })
      return
    }
    if (mimeType.startsWith('image/')) {
      const url = URL.createObjectURL(file)
      previewUrl.current = url
      setPreview({ title: file.name, mimeType, url })
      return
    }
    await viewOutput({ name: file.name, mimeType, data: new Uint8Array(await file.arrayBuffer()) })
  }

  const closePreview = () => {
    setPreview(null)
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current)
    previewUrl.current = null
  }

  const savePendingEdits = async () => {
    if (busy) return false
    let pending = outputs.length ? [...outputs] : await run()
    if (!pending?.length) return false
    while (pending.length) {
      const remaining = await save(pending[0], pending)
      if (remaining === false) return false
      pending = remaining
    }
    return true
  }

  const discardPendingEdits = () => {
    setOutputs([])
    setRedactMarked(false)
    onDirtyChange(false)
  }

  useImperativeHandle(editorRef, () => ({ savePendingEdits, discardPendingEdits }), [busy, outputs, files, toolId, options, redactMarked])

  const related = allTools.filter((item) => item.id !== tool.id && item.category === tool.category).slice(0, 4)
  const isMergeEmpty = tool.id === 'merge-pdf' && files.length === 0

  return (
    <div className={`page-content tool-studio-page ${tool.category === 'organize' ? 'organize-tool-page' : ''} ${tool.id === 'merge-pdf' ? 'merge-tool-page' : ''}`}>
      <div className="studio-header">
        <span className={`tool-icon ${tool.tone} studio-main-icon`}><Icon name={tool.icon} size={25} /></span>
        <div className="studio-header-details">
          <div className="studio-title-row"><h1>{tool.name}</h1></div>
          <p className="studio-description">{tool.description}</p>
        </div>
      </div>

      <div className={`studio-workspace functional-workspace ${isMergeEmpty ? 'single-column merge-empty-workspace' : ''}`}>
        <section className="studio-canvas-area functional-canvas">
          {!files.length ? (
            <div className={`studio-dropzone ${dragging ? 'dragging' : ''}`} onClick={openFileSelector}
              role="button" tabIndex={0} aria-label={`Choose a file for ${tool.name}`}
              onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openFileSelector() } }}
              onDragOver={(event) => { event.preventDefault(); setDragging(true) }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => { event.preventDefault(); setDragging(false); addFiles(event.dataTransfer.files) }}>
              <div className="studio-drop-icon"><Icon name="upload" size={27} /></div>
              <strong>Choose {tool.kind === 'merge' ? 'PDF files' : singleDocumentTools.has(toolId) ? 'a file' : 'one or more documents'} to begin</strong>
              <span>{tool.kind === 'merge' ? 'Select two or more PDFs and arrange their order below.' : singleDocumentTools.has(toolId) ? 'Drop a file here or use the file picker. Processing is local.' : 'Select multiple files together or add more after choosing the first. Processing is local.'}</span>
              <button className="browse-button studio-browse-btn" type="button" onClick={(event) => { event.stopPropagation(); openFileSelector() }}><Icon name="upload" size={15} /> Choose {singleDocumentTools.has(toolId) ? 'file' : 'files'}</button>
            </div>
          ) : (
            <div className="functional-file-panel">
              <div className="loaded-file-bar">
                <div className="file-info-badge"><Icon name="file" size={16} /><strong>{files.length === 1 ? files[0].name : `${files.length} files selected`}</strong>
                  <span className="file-size-pill">{files.length === 1 && pageCount ? `${pageCount} pages · ` : ''}{formatBytes(files.reduce((total, file) => total + file.size, 0))}</span></div>
                <div className="loaded-file-actions">
                  {tool.category === 'convert' && files.length === 1 && <button className="browse-button source-preview-button" type="button" onClick={() => previewInput(files[0])}>Preview</button>}
                  <button className="remove-file-button" type="button" aria-label="Remove file" title="Remove file" onClick={() => onBeforeDiscard(() => { setFiles([]); setPageCount(null); setOutputs([]); setError(''); setMessage(''); onDirtyChange(false) })}><Icon name="trash" size={16} /></button>
                </div>
              </div>
              {files.length > 1 && <ol className="selected-file-list">{files.map((file, index) => <li key={`${file.name}-${index}`}><span>{index + 1}. {file.name}</span><div className="file-order-actions">{tool.category === 'convert' && <button type="button" className="source-preview-button" onClick={() => previewInput(file)}>Preview</button>}<button type="button" aria-label={`Move ${file.name} up`} disabled={index === 0} onClick={() => { setOutputs([]); setFiles((current) => moveFile(current, index, -1)) }}>↑</button><button type="button" aria-label={`Move ${file.name} down`} disabled={index === files.length - 1} onClick={() => { setOutputs([]); setFiles((current) => moveFile(current, index, 1)) }}>↓</button><button type="button" aria-label={`Remove ${file.name}`} onClick={() => { setOutputs([]); setFiles((current) => current.filter((_, i) => i !== index)) }}>×</button></div></li>)}</ol>}
              {!singleDocumentTools.has(toolId) && <button className="browse-button add-file-button" type="button" onClick={openFileSelector}><Icon name="plus" size={16} /> Add file</button>}
              {tool.category === 'organize' && pageCount && tool.id !== 'merge-pdf' && <section className="organize-pages-workspace" aria-label="PDF pages">
                <div className="organize-pages-heading">
                  <div><span className="organize-eyebrow">PAGE WORKSPACE</span><h2>{tool.id === 'organize-pdf' ? 'Arrange your pages' : 'Choose pages'}</h2><p>{tool.id === 'organize-pdf' ? 'Use the arrows on each page to set the final order.' : 'Select thumbnails to apply this action to specific pages.'}</p></div>
                  <div className="organize-page-count"><strong>{pageCount}</strong><span>{pageCount === 1 ? 'page' : 'pages'}</span></div>
                </div>
                <div className="organize-pages-toolbar">
                  <span>{tool.id === 'organize-pdf' ? 'Final sequence' : selectedPages.length ? `${selectedPages.length} selected` : ['rotate-pages', 'crop-pdf'].includes(tool.id) ? 'All pages' : tool.id === 'split-pdf' ? 'Set page ranges in the options' : 'Choose pages to continue'}</span>
                  {pageSelectionTools.has(tool.id) && selectedPages.length > 0 && <button type="button" onClick={() => { setSelectedPages([]); setOptions((current) => ({ ...current, pages: '' })) }}>Clear selection</button>}
                  {tool.id === 'organize-pdf' && <button type="button" onClick={() => { const original = Array.from({ length: pageCount }, (_, index) => index + 1); setPageOrder(original); setOption('pages', '') }}>Restore original order</button>}
                </div>
                <div className="organize-page-grid">
                  {(tool.id === 'organize-pdf' ? pageOrder : Array.from({ length: pageCount }, (_, index) => index + 1)).map((page, index, visiblePages) => <OrganizePageThumbnail key={`${page}-${index}`} file={files[0]} page={page} selected={selectedPages.includes(page)} selectable={pageSelectionTools.has(tool.id)} reorderable={tool.id === 'organize-pdf'} first={index === 0} last={index === visiblePages.length - 1} onToggle={() => togglePage(page)} onMove={(offset) => movePage(page, offset, pageOrder.slice(0, index + 1).filter((value) => value === page).length - 1)} />)}
                </div>
              </section>}
              {pageCount && <div className="document-summary"><Icon name="pages" size={16} /><div><span className="document-summary-title">PDF loaded and readable</span><span>{pageCount} page{pageCount === 1 ? '' : 's'} · {formatBytes(files[0].size)}</span></div></div>}
              {['pdf-editor', 'sign-pdf'].includes(toolId) && files.length === 1 && pageCount && <PdfViewer file={files[0]} page={Number(toolId === 'sign-pdf' ? options.signaturePage : options.annotationPage) || 1} pageCount={pageCount} pageSizes={pageSizes} onPageChange={(page) => setOption(toolId === 'sign-pdf' ? 'signaturePage' : 'annotationPage', String(page))} />}
              {toolId === 'redact-pdf' && files.length === 1 && <RedactionPreview file={files[0]} page={Number(options.redactPage)} redaction={redactMarked ? options : null} onMark={(rect) => onBeforeDiscard(() => { setOption('redactX', rect.x); setOption('redactY', rect.y); setOption('redactWidth', rect.width); setOption('redactHeight', rect.height); setRedactMarked(true); onDirtyChange(true) })} />}
            </div>
          )}
          <input ref={picker} hidden type="file" multiple={!singleDocumentTools.has(toolId)} accept={inputAccept(toolId)} onChange={(event) => { if (event.target.files?.length) { addFiles(event.target.files); setFileSelectorOpen(false) } event.target.value = '' }} />
          {error && <div className="operation-error" role="alert">{error}</div>}
          {message && <div className="operation-message" role="status">{message}{progress && <progress value={progress.value} max="1" />}{busy && <button type="button" onClick={() => { jobController.current?.abort(); jobId.current += 1; setBusy(false); setProgress(null); setMessage('Cancel requested…') }}>Cancel</button>}</div>}
          {outputs.length > 0 && <div className="output-list"><h3>Ready to save</h3>{outputs.map((output) => <div className="output-item" key={output.name}>
            {output.compression && <div className="compression-summary" aria-label={`Compression result for ${output.name}`}>
              <span>Original size<strong>{formatBytes(output.compression.originalSize)}</strong></span>
              <span>Compressed size<strong>{formatBytes(output.compression.compressedSize)}</strong></span>
              <span>Size reduction<strong>{(output.compression.reduction * 100).toFixed(1)}%</strong></span>
            </div>}
            <div className="output-row"><span><Icon name="file" size={15} />{output.name}<small>{formatBytes(output.data.byteLength)}</small></span><div className="output-actions">{(tool.category === 'convert' || output.compression) && <button className="output-view-button" type="button" onClick={() => viewOutput(output)}>Preview</button>}<button className="browse-button" type="button" onClick={() => save(output)}>Save file <Icon name="arrow" size={14} /></button></div></div>
            {output.compression && output.message && <p className="compression-result-note">{output.message}</p>}
          </div>)}</div>}
        </section>

        {!isMergeEmpty && <aside className="studio-options-panel functional-options">
          <div className="panel-title-row"><Icon name="sliders" size={16} /><h3>{tool.category === 'organize' ? 'Operation settings' : 'Options'}</h3></div>
          <ToolOptions toolId={toolId} options={options} setOption={setOption} pageCount={pageCount} formFields={formFields} />
          <div className="studio-action-buttons">
            {files.length > 0 && <button className="primary-action-btn" type="button" onClick={() => outputs.length ? onBeforeDiscard(() => { void run() }) : run()} disabled={busy}>{busy && <span className="btn-spinner" />}<span>{busy ? 'Processing…' : tool.actionName}</span></button>}
            {files.length > 0 && <button className="reset-button" type="button" onClick={() => onBeforeDiscard(() => { setOptions(createInitialOptions()); if (pageCount) setPageOrder(Array.from({ length: pageCount }, (_, index) => index + 1)); setSelectedPages([]); setRedactMarked(false); setError(''); setMessage(''); setOutputs([]); onDirtyChange(false) })}>Reset options</button>}
          </div>
        </aside>}
      </div>

      <Presence present={fileSelectorOpen} exitDuration={180}>
        <div className="palette-backdrop file-picker-backdrop" onClick={(event) => { if (event.target === event.currentTarget) setFileSelectorOpen(false) }}>
          <section className={`palette-modal compact file-picker-modal ${filePickerKeyboardNav ? 'keyboard-nav' : ''}`} role="dialog" aria-modal="true" aria-label={`Choose a file for ${tool.name}`} onClick={(event) => event.stopPropagation()} onMouseMove={() => setFilePickerKeyboardNav(false)} onKeyDown={handleFilePickerKeyDown}>
            <div className="palette-search-row">
              <Icon name="search" size={18} className="palette-search-icon" />
              <input className="palette-input" autoFocus type="search" placeholder="Search recent files…" value={fileSearch} onChange={(event) => { setFileSearch(event.target.value); setFilePickerActiveIndex(0); setFilePickerKeyboardNav(false) }} aria-label="Search recent files" />
              <button className="palette-close-btn" type="button" onClick={() => setFileSelectorOpen(false)} aria-label="Close file selector"><kbd>Esc</kbd></button>
            </div>
            <div className="palette-results file-picker-results">
              <section className="palette-command-group">
                <div className="palette-section-title">Add a file</div>
                <div className="palette-list">
                  <button className="palette-item" type="button" onClick={() => picker.current?.click()} disabled={filePickerBusy}>
                    <span className="tool-icon neutral palette-item-icon"><Icon name="upload" size={18} /></span>
                    <div className="palette-item-text"><div className="palette-item-title-row"><strong>Choose a file on this device</strong></div><small>Browse your computer or drop a file below</small></div>
                    <span className="palette-item-category">Browse</span><Icon name="arrow" size={14} className="palette-item-arrow" />
                  </button>
                </div>
                {filteredRecentFiles.length > 0 && <div className={`file-picker-drop-area compact ${filePickerDragging ? 'is-dragging' : ''}`} role="button" tabIndex={0} aria-label="Drop a supported file here or browse your device" onClick={() => picker.current?.click()} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); picker.current?.click() } }} onDragEnter={(event) => { event.preventDefault(); setFilePickerDragging(true) }} onDragOver={(event) => { event.preventDefault(); setFilePickerDragging(true) }} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setFilePickerDragging(false) }} onDrop={handleFilePickerDrop}>
                  <strong>Drop a file here</strong><span>Drop a supported file here to add it instantly.</span>
                </div>}
                {filteredRecentFiles.length > 0 ? <>
                  <div className="palette-section-title">Recent files <span>{filteredRecentFiles.length}</span></div>
                  <div className="palette-list" id="file-picker-results">{filteredRecentFiles.map((record, index) => <button key={record.id} data-file-picker-index={index} className={`palette-item ${filePickerActiveIndex === index ? 'active' : ''}`} type="button" aria-current={filePickerActiveIndex === index ? 'true' : undefined} onMouseEnter={() => setFilePickerActiveIndex(index)} onClick={() => openRecentFile(record)} disabled={filePickerBusy}>
                    <span className="tool-icon neutral palette-item-icon"><Icon name="file" size={18} /></span>
                    <div className="palette-item-text"><div className="palette-item-title-row"><strong>{record.name}</strong></div><small>{record.size ? `${Math.max(1, Math.round(record.size / 1024))} KB` : 'PDF document'}</small></div>
                    <Icon name="arrow" size={14} className="palette-item-arrow" />
                  </button>)}</div>
                </> : <div className={`file-picker-drop-area ${filePickerDragging ? 'is-dragging' : ''}`} role="button" tabIndex={0} aria-label="Add a file by dropping it here or browsing your device" onClick={() => picker.current?.click()} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); picker.current?.click() } }} onDragEnter={(event) => { event.preventDefault(); setFilePickerDragging(true) }} onDragOver={(event) => { event.preventDefault(); setFilePickerDragging(true) }} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setFilePickerDragging(false) }} onDrop={handleFilePickerDrop}>
                  <strong><Icon name="plus" size={14} /> Add a file</strong>
                  <span>{fileSearch.trim() ? 'No matching files. Drop a supported file here or click to browse.' : 'Drop a supported file here or click to browse this device.'}</span>
                  <small>{inputAccept(toolId).replaceAll(',', ', ')}</small>
                </div>}
              </section>
              {error && <p className="form-error" role="alert">{error}</p>}
            </div>
            <div className="palette-footer"><span>{filteredRecentFiles.length ? 'Use ↑ and ↓ to select a recent file, then press Enter' : 'Drop a supported file here or click to browse this device'}</span><span><kbd>Esc</kbd> Close</span></div>
          </section>
        </div>
      </Presence>

      <Presence present={Boolean(preview)} exitDuration={180}>
        {preview && <div className="palette-backdrop output-preview-backdrop" onClick={(event) => { if (event.target === event.currentTarget) closePreview() }}>
          <section className="output-preview-dialog" role="dialog" aria-modal="true" aria-label={`Preview ${preview.title}`} onClick={(event) => event.stopPropagation()} onKeyDown={(event) => {
            if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closePreview() }
            else if (event.key === 'Enter' && !event.repeat && !event.target.closest('button, a, input, textarea, select')) { event.preventDefault(); closePreview() }
          }}>
            <header className="output-preview-header"><strong title={preview.title}>{preview.title}</strong><button type="button" autoFocus className="palette-close-btn" aria-label="Close preview" onClick={closePreview}><kbd>Esc</kbd></button></header>
            {preview.mimeType === 'application/pdf' ? <OutputPdfPreview file={preview.file} /> : preview.mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ? <OutputDocxPreview data={preview.data} title={preview.title} /> : preview.mimeType.startsWith('image/') ? <div className="output-preview-image-wrap"><img className="output-preview-image" src={preview.url} alt={preview.title} /></div> : <iframe className="output-preview-frame" title={`Preview of ${preview.title}`} srcDoc={preview.html} sandbox="" />}
          </section>
        </div>}
      </Presence>

    </div>
  )
}

const EDITOR_TOOLS = [
  ['sign-pdf', 'Sign'], ['add-watermark', 'Watermark'],
  ['page-numbers', 'Page numbers'], ['fill-forms', 'Fill forms'], ['edit-bookmarks', 'Bookmarks'],
      ['crop-pdf', 'Crop'],
]
const SECURE_EDITOR_TOOLS = [
  ['protect-pdf', 'Protect PDF', 'lock'], ['unlock-pdf', 'Unlock PDF', 'unlock'],
  ['redact-pdf', 'Redact PDF', 'shield'], ['flatten-pdf', 'Flatten PDF', 'fileText'],
  ['repair-pdf', 'Repair PDF', 'rotate'],
]
const EDITOR_TOOLBAR_TOOLS = [
  ['pdf-editor','Select','cursor'], ['edit-text','Edit text','edit'], ['add-text','Add text','type'],
  ['comment','Add comment','comment'], ['highlight','Highlight','edit'], ['draw','Draw','pen'],
  ['images','Add image','image'], ['sign-pdf','Sign','signature'],
  ['edit-bookmarks','Bookmarks','pages'], ['crop-pdf','Crop page','crop'], ['add-watermark','Watermark','layers'],
  ['page-numbers','Page numbers','pages'],
]
const PDF_EXPORT_TOOLS = [
  ['pdf-to-word', 'Word document'], ['pdf-to-pptx', 'PowerPoint presentation'], ['pdf-to-jpg', 'Images (JPG or PNG)'], ['ocr-pdf', 'Recognized text'],
]
const HOME_EDITOR_TOOLS = [
  ['edit-text', 'Edit text'], ['images', 'Image'], ['fill-forms', 'Fill forms'], ['edit-bookmarks', 'Bookmarks'], ['crop-pdf', 'Crop'],
]
const INSERT_EDITOR_TOOLS = [
  ['sign-pdf', 'Sign'], ['add-text', 'Add text'], ['highlight','Highlight'], ['underline','Underline'], ['strike','Strike-through'], ['draw','Draw'], ['rectangle','Rectangle'], ['ellipse','Ellipse'], ['line','Line'], ['arrow','Arrow'], ['comment','Comment'], ['form-text','Text field'], ['form-checkbox','Checkbox'], ['form-dropdown','Dropdown'], ['form-list','List'], ['form-radio','Radio group'], ['form-design','Manage fields'], ['annotation-select','Select marks'], ['redact-pdf', 'Redact'], ['page-numbers', 'Page numbers'], ['add-watermark', 'Watermark'], ['protect-pdf', 'Protect PDF'],
]
const EDITOR_MODE_LABELS = {
  'pdf-editor': 'Select', 'edit-text': 'Edit text', 'add-text': 'Add text', comment: 'Comment',
  highlight: 'Highlight', underline: 'Underline', strike: 'Strike-through', draw: 'Draw',
  rectangle: 'Rectangle', ellipse: 'Ellipse', line: 'Line', arrow: 'Arrow', images: 'Image',
  'sign-pdf': 'Sign', 'fill-forms': 'Fill forms', 'edit-bookmarks': 'Bookmarks', 'crop-pdf': 'Crop page',
  'add-watermark': 'Watermark', 'page-numbers': 'Page numbers', 'protect-pdf': 'Protect PDF', 'redact-pdf': 'Redact PDF',
  'unlock-pdf': 'Unlock PDF', 'flatten-pdf': 'Flatten PDF', 'repair-pdf': 'Repair PDF',
}

/** Full-window document workspace used for opening and editing PDFs. */
export function PdfEditorWorkspace({ initialFiles = EMPTY_FILES, initialDraft, onDraftChange = () => {}, openPicker = false, initialTool = 'pdf-editor', onExit, onOpenPdf, appChromeVisible = false, onToggleAppChrome = () => {}, editTextRequest = 0, editorRef, onDirtyChange = () => {}, onBeforeDiscard }) {
  const picker = useRef(null)
  const editorWorkspaceRef = useRef(null)
  const editorTooltipRef = useRef(null)
  const editorSearchInputRef = useRef(null)
  // A draft belongs to the PDF it was created for. Tabs can reopen a saved
  // draft with an equivalent File object, so compare stable local file metadata.
  const draftMatchesInitialFiles = !initialFiles.length || (initialDraft?.files?.length === initialFiles.length && initialDraft.files.every((draftFile, index) => pdfFileIdentity(draftFile) === pdfFileIdentity(initialFiles[index])))
  const editorDraft = draftMatchesInitialFiles ? initialDraft : null
  const restoredFiles = initialFiles.length ? initialFiles : editorDraft?.files || EMPTY_FILES
  const [files, setFiles] = useState(restoredFiles)
  const [session, setSession] = useState(() => editorDraft?.session || createDocumentSession(restoredFiles))
  const sessionRef = useRef(session); sessionRef.current = session
  const updateSession = value => { sessionRef.current = value; setSession(value); onDirtyChange(isSessionDirty(value)) }
  const filesRef = useRef(restoredFiles)
  filesRef.current = files
  const [toolId, setToolId] = useState(() => editorDraft?.toolId || initialTool)
  const [options, setOptions] = useState(() => editorDraft?.options || createInitialOptions())
  const [viewerState, setViewerState] = useState(() => editorDraft?.viewerState || {})
  const [currentViewerPage, setViewerPage] = useState(() => Number(editorDraft?.viewerState?.page || editorDraft?.options?.annotationPage) || 1)
  const [pageCount, setPageCount] = useState(0)
  const [pageSizes, setPageSizes] = useState([])
  const [formFields, setFormFields] = useState([])
  const [outputs, setOutputs] = useState(() => editorDraft?.outputs || [])
  const savingRef = useRef(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [redaction, setRedaction] = useState(() => {
    const saved = editorDraft?.redaction
    return Array.isArray(saved) ? saved : saved ? [{ ...saved, page: Number(saved.page) || 1 }] : []
  })
  const [textEditMode, setTextEditMode] = useState(() => editorDraft?.textEditMode || false)
  const [textEdits, setTextEdits] = useState(() => editorDraft?.textEdits || [])
  useEffect(() => {
    const darkPage = Boolean(viewerState?.darkPage)
    setTextEdits((current) => {
      let changed = false
      const next = current.map((edit) => {
        if (edit.isNew || !edit.backgroundColor) return edit
        const sourceBackgroundColor = edit.sourceBackgroundColor || edit.backgroundColor
        const backgroundColor = darkPage ? getDarkPageFill(sourceBackgroundColor) : sourceBackgroundColor
        if (edit.sourceBackgroundColor === sourceBackgroundColor && edit.backgroundColor === backgroundColor) return edit
        changed = true
        return { ...edit, sourceBackgroundColor, backgroundColor }
      })
      if (changed && currentEditSnapshot.current) currentEditSnapshot.current.textEdits = next
      return changed ? next : current
    })
  }, [viewerState?.darkPage])
  const [imageEdits, setImageEdits] = useState(() => editorDraft?.imageEdits || [])
  const [annotations,setAnnotations] = useState(() => editorDraft?.annotations || [])
  const [selectedAnnotation,setSelectedAnnotation]=useState(null)
  const [reusableSignature,setReusableSignature]=useState(editorDraft?.reusableSignature||null)
  const [signatureFieldTarget,setSignatureFieldTarget]=useState(null)
  useEffect(() => {
    const selectField = (event) => {
      const target = event.detail
      if (!target || target.page < 1) return
      setSignatureFieldTarget(target)
      setToolId('sign-pdf')
      setViewerPage(target.page)
      setMessage(`Signature field “${target.name}” selected. Choose a signature style to place it.`)
    }
    window.addEventListener('pdf-editor-signature-field', selectField)
    return () => window.removeEventListener('pdf-editor-signature-field', selectField)
  }, [])
  const [annotationStyle,setAnnotationStyle] = useState({color:'#ffcc00',thickness:2,opacity:.5})
  const organizerRoot = useRef(null)
  const [formCandidates,setFormCandidates]=useState([])
  const [showProperties,setShowProperties]=useState(false)
  const formTyping = useRef({at:0})
  const imagePicker = useRef(null)
  const insertPicker = useRef(null)
  const [selectedOrganizerPage,setSelectedOrganizerPage] = useState(0)
  const [selectedImage, setSelectedImage] = useState(() => editorDraft?.selectedImage || null)
  const [editHistory, setEditHistory] = useState(() => editorDraft?.editHistory || { past: [], future: [] })
  const currentEditSnapshot = useRef({ files: restoredFiles, revision: session.revision, annotations:editorDraft?.annotations||[], textEdits: editorDraft?.textEdits || [], imageEdits: editorDraft?.imageEdits || [], redaction: Array.isArray(editorDraft?.redaction) ? editorDraft.redaction : editorDraft?.redaction ? [{ ...editorDraft.redaction, page: Number(editorDraft.redaction.page) || 1 }] : [], options: editorDraft?.options || createInitialOptions() })
  const [textStyle, setTextStyle] = useState(() => editorDraft?.textStyle || DEFAULT_PDF_TEXT_STYLE)
  const [localFonts, setLocalFonts] = useState([])
  useEffect(() => { listLocalFonts().then(setLocalFonts).catch(() => {}) }, [])
  const selectTextFont = async (value) => {
    const savedFont = value.startsWith('local:') ? localFonts.find((font) => `local:${font.id}` === value) : null
    if (!savedFont) { setTextStyle((style) => ({ ...style, fontFamily: value, fontData: undefined, localFontId: undefined })); return }
    try {
      const font = await getLocalFont(savedFont.id)
      const fontData = new Uint8Array(font.data)
      if ('FontFace' in window) {
        const face = new FontFace(font.name, fontData)
        await face.load()
        document.fonts.add(face)
      }
      setTextStyle((style) => ({ ...style, fontFamily: font.name, fontData, localFontId: font.id }))
    } catch { setError('This local font could not be loaded. Try adding the font again from Settings.') }
  }
  const [editorMenuTab, setEditorMenuTab] = useState(() => SECURE_EDITOR_TOOLS.some(([id]) => id === (editorDraft?.toolId || initialTool)) ? 'secure' : INSERT_EDITOR_TOOLS.some(([id]) => id === (editorDraft?.toolId || initialTool)) ? 'insert' : PDF_EXPORT_TOOLS.some(([id]) => id === (editorDraft?.toolId || initialTool)) ? 'export' : 'home')
  const [editorSearchExpanded, setEditorSearchExpanded] = useState(() => Boolean(editorDraft?.viewerState?.searchQuery))
  const [rightSidebarCollapsed, setRightSidebarCollapsed] = useState(false)
  useEffect(() => {
    const root = editorWorkspaceRef.current
    const tooltip = editorTooltipRef.current
    if (!root || !tooltip) return undefined
    const labelButton = (button) => {
      const label = button.getAttribute('aria-label') || button.getAttribute('title') || button.innerText?.trim()
      if (!label) return
      button.dataset.editorTooltip = label
      if (!button.hasAttribute('aria-label')) button.setAttribute('aria-label', label)
      if (button.hasAttribute('title')) button.removeAttribute('title')
    }
    const labelButtons = () => root.querySelectorAll('button').forEach(labelButton)
    const locateButton = (target) => target instanceof Element ? target.closest('button') : null
    const showTooltip = (button) => {
      if (!button || !root.contains(button)) return
      labelButton(button)
      const label = button.dataset.editorTooltip
      if (!label) return
      const rect = button.getBoundingClientRect()
      tooltip.textContent = label
      tooltip.style.left = `${Math.min(window.innerWidth - 210, Math.max(8, rect.left + rect.width / 2 - 80))}px`
      tooltip.style.top = `${rect.bottom + 7 < window.innerHeight - 36 ? rect.bottom + 7 : Math.max(8, rect.top - 34)}px`
      tooltip.dataset.visible = 'true'
    }
    const hideTooltip = () => { delete tooltip.dataset.visible }
    const onPointerOver = (event) => showTooltip(locateButton(event.target))
    const onPointerOut = (event) => {
      const button = locateButton(event.target)
      if (button && !button.contains(event.relatedTarget)) hideTooltip()
    }
    const onFocusIn = (event) => showTooltip(locateButton(event.target))
    const onFocusOut = (event) => {
      const button = locateButton(event.target)
      if (button && !button.contains(event.relatedTarget)) hideTooltip()
    }
    labelButtons()
    const observer = new MutationObserver(labelButtons)
    observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-label', 'title'] })
    root.addEventListener('pointerover', onPointerOver)
    root.addEventListener('pointerout', onPointerOut)
    root.addEventListener('focusin', onFocusIn)
    root.addEventListener('focusout', onFocusOut)
    return () => {
      observer.disconnect()
      root.removeEventListener('pointerover', onPointerOver)
      root.removeEventListener('pointerout', onPointerOut)
      root.removeEventListener('focusin', onFocusIn)
      root.removeEventListener('focusout', onFocusOut)
    }
  }, [])
  const processingId = useRef(0)
  const processingController = useRef(null)
  const processingInputs = useRef(null)
  const latestDraft = useRef(null)
  const skipDraftSaveOnUnmount = useRef(false)
  const file = files[0]
  processingInputs.current = { file, toolId, options, textEdits, imageEdits, redaction }
  latestDraft.current = { reusableSignature, annotations, session, files, toolId, options, outputs, redaction, textEditMode, textEdits, imageEdits, selectedImage, textStyle, editHistory, viewerState: { ...viewerState, page: currentViewerPage } }
  const cancelCurrentOperation = () => { processingController.current?.abort(); processingId.current += 1 }
  useEffect(() => () => { processingId.current += 1; processingController.current?.abort() }, [])

  // Changes are kept as an in-app draft. They are not written to the source PDF
  // or the device until the user explicitly saves the generated output.
  const markAutosaved = () => onDirtyChange(true)

  const applyEditSnapshot = (snapshot) => {
    snapshot = { ...snapshot, files: snapshot.files || filesRef.current, revision: snapshot.revision || revisedSession(sessionRef.current, 'edit').revision }
    currentEditSnapshot.current = snapshot
    filesRef.current = snapshot.files
    setFiles(snapshot.files)
    updateSession({ ...sessionRef.current, revision: snapshot.revision, version: sessionRef.current.version + 1 })
    setAnnotations(snapshot.annotations||[])
    setTextEdits(snapshot.textEdits)
    setImageEdits(snapshot.imageEdits || [])
    setRedaction(snapshot.redaction || [])
    setOptions(snapshot.options || createInitialOptions())
    setOutputs([])
    setError('')
    setMessage('')
  }
  const commitEditSnapshot = (snapshot) => {
    const previousSnapshot = currentEditSnapshot.current
    setEditHistory((history) => pushHistory(history, previousSnapshot))
    const nextSession = revisedSession(sessionRef.current, {type:'edit', at:Date.now(), textCount:snapshot.textEdits?.length||0, imageCount:snapshot.imageEdits?.length||0, annotationCount:snapshot.annotations?.length||0})
    updateSession(nextSession)
    applyEditSnapshot({ ...snapshot, revision: nextSession.revision })
  }
  const undoEdit = () => {
    const { past, future } = editHistory
    if (!past.length) return
    const previous = past[past.length - 1]
    setEditHistory({ past: past.slice(0, -1), future: boundHistory([...future, currentEditSnapshot.current]) })
    applyEditSnapshot(previous)
  }
  const redoEdit = () => {
    const { past, future } = editHistory
    if (!future.length) return
    const next = future[future.length - 1]
    setEditHistory({ past: boundHistory([...past, currentEditSnapshot.current]), future: future.slice(0, -1) })
    applyEditSnapshot(next)
  }
  const resetEditHistory = (snapshot = { textEdits: [], imageEdits: [], redaction: [], options: createInitialOptions() }) => {
    setEditHistory({ past: [], future: [] })
    currentEditSnapshot.current = { ...snapshot, files: filesRef.current, revision: sessionRef.current.revision }
  }
  const resetForDocumentChange = (nextFiles) => {
    skipDraftSaveOnUnmount.current = false
    processingController.current?.abort()
    processingId.current += 1
    processingController.current = null
    setBusy(false)
    setFiles(nextFiles)
    filesRef.current = nextFiles
    updateSession(createDocumentSession(nextFiles))
    setToolId('pdf-editor')
    setViewerPage(1)
    setViewerState((current) => ({ ...current, page: 1, scrollTop: 0, searchQuery: '', history: { entries: [1], index: 0 } }))
    setPageCount(0)
    setPageSizes([])
    setFormFields([])
    setOptions(createInitialOptions())
    setOutputs([])
    setAnnotations([])
    setFormCandidates([])
    setReusableSignature(null)
    setSelectedAnnotation(null)
    setRedaction([])
    setTextEditMode(false)
    setTextEdits([])
    setImageEdits([])
    setSelectedImage(null)
    setTextStyle(DEFAULT_PDF_TEXT_STYLE)
    resetEditHistory()
    setError('')
    setMessage('')
    onDirtyChange(false)
  }

  useEffect(() => {
    const handleHistoryShortcut = (event) => {
      const shortcuts = loadShortcuts()
      const isMac = window.pdfKing?.platform === 'darwin' || /Mac|iPhone|iPad/.test(navigator.platform || '')
      const isRedo = matchesShortcut(event, shortcuts.redo, isMac)
      const nativeRedo = event.ctrlKey && !event.metaKey && !event.shiftKey && event.key.toLowerCase()==='y'
      if (event.isComposing || (!isRedo && !nativeRedo && !matchesShortcut(event, shortcuts.undo, isMac))) return
      const target = event.target
      if (target instanceof HTMLElement && (target.isContentEditable || target.closest('input, textarea, select, [contenteditable="true"]'))) return
      event.preventDefault()
      if (isRedo || nativeRedo) redoEdit()
      else undoEdit()
    }
    window.addEventListener('keydown', handleHistoryShortcut)
    return () => window.removeEventListener('keydown', handleHistoryShortcut)
  })

  useEffect(() => {
    if (!initialFiles.length || (filesRef.current.length === initialFiles.length && filesRef.current.every((item, index) => item === initialFiles[index]))) return
    resetForDocumentChange(initialFiles)
  }, [initialFiles])
  useEffect(() => {
    if (initialTool !== 'pdf-editor' || !editorDraft?.toolId) setToolId(initialTool)
  }, [initialTool])
  useEffect(() => {
    onDraftChange({ reusableSignature, annotations, session, files, toolId, options, outputs, redaction, textEditMode, textEdits, imageEdits, selectedImage, textStyle, editHistory, viewerState: { ...viewerState, page: currentViewerPage } })
    skipDraftSaveOnUnmount.current = false
  }, [reusableSignature, annotations, session, files, toolId, options, outputs, redaction, textEditMode, textEdits, imageEdits, selectedImage, textStyle, editHistory, viewerState, currentViewerPage])
  useEffect(() => () => { if (latestDraft.current && !skipDraftSaveOnUnmount.current) onDraftChange(latestDraft.current) }, [onDraftChange])
  useEffect(() => { if (editTextRequest) { setToolId('edit-text'); setTextEditMode(true); setError(''); setMessage('') } }, [editTextRequest])
  useEffect(() => {
    if (openPicker) picker.current?.click()
  }, [openPicker])
  useEffect(() => {
    let active = true
    if (!file) { setPageCount(0); setPageSizes([]); return () => { active = false } }
    import('../pdfEngine').then(({ inspectPdfOverview }) => inspectPdfOverview(file)).then((info) => { if (active) { setPageCount(info.pageCount); setPageSizes(info.pages); setSelectedOrganizerPage(current=>Math.min(current,info.pageCount-1)); setViewerPage((current) => Math.min(Math.max(current, 1), info.pageCount)) } })
      .catch((cause) => { if (active) setError(cause.message || 'Could not read this PDF.') })
    if (toolId === 'redact-pdf') forgetPdfCopy(file).catch(() => {})
    const historyTimer = toolId === 'redact-pdf' ? null : window.setTimeout(() => rememberPdf(file).catch(() => {}), 1000)
    return () => { active = false; if (historyTimer) window.clearTimeout(historyTimer) }
  }, [file, toolId])
  useEffect(() => {
    let active = true
    if (['fill-forms','form-design'].includes(toolId) && file) import('../pdfEngine').then(({ inspectPdfForm }) => inspectPdfForm(file))
      .then((fields) => { if (active) setFormFields(fields) }).catch((cause) => { if (active) setError(cause.message || 'Could not read form fields.') })
    else setFormFields([])
    return () => { active = false }
  }, [toolId, file])

  const setOption = (key, value) => { if(key === 'fields') { const snapshot={...currentEditSnapshot.current,options:{...options,[key]:value}}; const changed=Object.keys(value).find(name=>value[name]!==options.fields?.[name]); if(formTyping.current.name===changed&&Date.now()-formTyping.current.at<1000)applyEditSnapshot({...snapshot,revision:revisedSession(sessionRef.current,'form').revision});else commitEditSnapshot(snapshot);formTyping.current={name:changed,at:Date.now()} } else { setOptions((current) => ({ ...current, [key]: value })); currentEditSnapshot.current={...currentEditSnapshot.current,options:{...options,[key]:value}}; } setOutputs([]); cancelCurrentOperation(); setBusy(false) }
  const addFile = (incoming) => {
    const next = Array.from(incoming || []).find((item) => item.type === 'application/pdf' || /\.pdf$/i.test(item.name))
    if (!next) return
    if(!next.sourcePath&&window.pdfKing?.getFilePath)next.sourcePath=window.pdfKing.getFilePath(next)||null
    const replace = () => resetForDocumentChange([next])
    if (isSessionDirty(sessionRef.current) && onBeforeDiscard) onBeforeDiscard(replace); else replace()
  }
  const updateAnnotation = item => {
    const existing=currentEditSnapshot.current.annotations.find(a=>a.key===item.key)
    const next={...existing,...item}
    commitEditSnapshot({...currentEditSnapshot.current,annotations:[...currentEditSnapshot.current.annotations.filter(a=>a.key!==item.key),next]})
    setSelectedAnnotation(next)
  }
  const deleteAnnotation = () => {
    if(!selectedAnnotation)return
    if(selectedAnnotation.type==='form-update')updateAnnotation({...selectedAnnotation,deleted:true})
    else commitEditSnapshot({...currentEditSnapshot.current,annotations:currentEditSnapshot.current.annotations.filter(a=>a.key!==selectedAnnotation.key)})
    setSelectedAnnotation(null)
  }
  const selectedObject=selectedAnnotation ? annotations.find(a=>a.key===selectedAnnotation.key)||selectedAnnotation : null
  const pendingOperations = () => [
    ...annotations,
    ...textEdits.map(edit => ({...edit,type:'text'})),
    ...imageEdits.map(edit => ({...edit,type:'image'})),
    ...(Object.keys(options.fields||{}).length ? [{type:'forms',values:Object.fromEntries(Object.entries(options.fields).flatMap(([name,value])=>{const edit=annotations.find(a=>a.type==='form-update'&&a.originalName===name);return edit?.deleted?[]:[[edit?.name||name,value]]})),page:1}] : []),
  ]
  const commitCurrent = async (extra = []) => {
    if (!file) throw new Error('Open a PDF first.')
    if(file!==filesRef.current[0])throw new DOMException('Document changed. Try the operation again.','AbortError')
    if(processingController.current)throw new Error('Wait for the current operation to finish.')
    const expected=captureRevision(sessionRef.current,file)
    const controller = new AbortController(); processingController.current = controller
    setBusy(true); setError(''); setMessage('Applying changes…')
    try {
      let currentFile = file
      if(file.pdfPassword){const {unlockEditorPdf}=await import('../pdfEngine');currentFile=await unlockEditorPdf(file);assertRevision(expected,sessionRef.current,filesRef.current[0],controller.signal);updateSession({...sessionRef.current,password:file.pdfPassword})}
      const operations = await prepareImageOperations([...pendingOperations(), ...extra], controller.signal)
      if(operations.length) currentFile = new File([await commitOperations(currentFile,operations,controller.signal)],file.name,{type:'application/pdf'})
      assertRevision(expected,sessionRef.current,filesRef.current[0],controller.signal)
      if(currentFile !== file){
        currentFile.sourcePath=sessionRef.current.sourcePath
        const nextOptions={...options,fields:{}}
        const snapshot={...currentEditSnapshot.current,files:[currentFile],annotations:[],textEdits:[],imageEdits:[],options:nextOptions}
        // A commit materializes semantic edits without creating a duplicate undo step.
        // Destructive/page commands create their own strategic byte checkpoint.
        if(extra.length) commitEditSnapshot(snapshot); else applyEditSnapshot(snapshot)
        filesRef.current=[currentFile];setSelectedImage(null);setSelectedAnnotation(null)
      }
      setMessage('Changes applied to the current document.')
      return currentFile
    } finally { if(processingController.current===controller){processingController.current=null;setBusy(false)} }
  }
  const run = async () => {
    if(busy||!file||processingController.current)return null
    let runController
    try{
      let currentFile=await commitCurrent()
      if(['pdf-editor','select','edit-text','add-text','images','fill-forms','highlight','underline','strike','draw','rectangle','ellipse','line','arrow','comment','form-text','form-checkbox','form-dropdown','form-list','form-radio','form-design','annotation-select'].includes(toolId))return currentFile
      const {processTool}=await import('../pdfEngine')
      const runOptions={...options,...(['add-watermark','page-numbers'].includes(toolId)?{pages:undefined}:{}),...(toolId==='crop-pdf'?options.margins:{}),...(toolId==='edit-bookmarks'?{bookmarks:String(options.bookmarksText||'').split('\n').map(line=>{const match=line.match(/^\s*(\d+)\s*[:|]\s*(.+?)\s*$/);return match?{page:Number(match[1]),title:match[2]}:null}).filter(Boolean)}:{}),...(toolId==='add-watermark'?{opacity:Number(options.opacity)/100,text:options.watermarkText}:{}),redactions:redaction.map(mark=>({...mark,normalized:true}))}
      const expected=captureRevision(sessionRef.current,currentFile)
      const controller=new AbortController();runController=controller;processingController.current=controller;setBusy(true)
      const result=await processTool({toolId,files:[currentFile],options:runOptions,signal:controller.signal,onProgress:state=>{if(!controller.signal.aborted&&sessionRef.current.id===expected.id&&sessionRef.current.revision===expected.revision&&filesRef.current[0]===expected.file)setMessage(`${state.message||'Processing…'} ${Math.round((state.value||0)*100)}%`)}})
      if(controller.signal.aborted)return null
      assertRevision(expected,sessionRef.current,filesRef.current[0],controller.signal)
      const output=result.outputs?.[0]
      if(!output)throw new Error(result.message||'No output was produced.')
      if(PDF_EXPORT_TOOLS.some(([id])=>id===toolId)&&toolId!=='ocr-pdf'){setOutputs(result.outputs);setMessage(result.message||'Export ready.');return output}
      const updated=new File([output.data],file.name,{type:'application/pdf'});updated.sourcePath=sessionRef.current.sourcePath
      commitEditSnapshot({...currentEditSnapshot.current,files:[updated],annotations:[],textEdits:[],imageEdits:[],redaction:[],options:{...options,fields:{}}})
      filesRef.current=[updated];setToolId('pdf-editor');setTextEditMode(false);setMessage(result.message||'Changes applied.');return updated
    }catch(cause){if(cause.name==='AbortError'){setMessage('Cancelled.');setError('')}else{setError(cause.message||'Could not apply changes.');setMessage('')}return null}finally{if(!runController||processingController.current===runController){setBusy(false);processingController.current=null}}
  }
  const saveDocument = async (mode='save') => {
    if(busy||savingRef.current||!file)return false
    savingRef.current=true
    try{
      if(redaction.length)throw new Error('Apply Redactions to permanently remove marked content, or undo the marks before saving.')
      const currentFile=await commitCurrent()
      const writtenSession={...sessionRef.current}
      let writeFile=currentFile
      if(sessionRef.current.password){const {encryptEditorPdf}=await import('../pdfEngine');writeFile=await encryptEditorPdf(currentFile,sessionRef.current.password)}
      const result=await writeEditorDocument({file:writeFile,session:writtenSession,mode,bridge:window.pdfKing,download:output=>saveOutput(output,{recordRecent:false}),recordRecent:record=>window.localStorage.getItem('pdfking-keep-recent')!=='false'&&window.pdfKing?.addRecentFile?.(record)})
      if(!result)return false
      if(sessionRef.current.id!==writtenSession.id)return true
      if(result.saved){
        if(filesRef.current[0]===currentFile && sessionRef.current.revision===writtenSession.revision){
          const renamed=result.name===currentFile.name?currentFile:new File([currentFile],result.name,{type:'application/pdf'})
          renamed.sourcePath=result.path||writtenSession.sourcePath;setFiles([renamed]);filesRef.current=[renamed]
          currentEditSnapshot.current={...currentEditSnapshot.current,files:[renamed]}
        }
        updateSession(sessionAfterWrite(sessionRef.current,writtenSession,result.path))
      }
      setMessage(`${mode==='export'?'Exported':'Saved'} ${result.name}`);return true
    }catch(cause){setError(cause.message||'Could not save PDF.');return false}finally{savingRef.current=false}
  }
  const save = async () => {if(outputs[0]){try{return await saveOutput(outputs[0])}catch(cause){setError(cause.message);return false}}return saveDocument('export')}
  const savePendingEdits = () => saveDocument('save')
  const saveCurrentToDevice = () => saveDocument('save-as')
  const printPdf = async () => {if(busy||!file)return;try{if(redaction.length)throw new Error('Apply or remove redaction marks before printing.');const current=await commitCurrent();const data=new Uint8Array(await current.arrayBuffer());if(window.pdfKing?.printPdf){const printed=await window.pdfKing.printPdf({name:current.name,data});if(printed===false)setMessage('Printing cancelled.')}else{const url=URL.createObjectURL(new Blob([data],{type:'application/pdf'}));window.open(url);setTimeout(()=>URL.revokeObjectURL(url),60000)}}catch(cause){setError(cause.message)}}
  const applyChangesInApp = async () => {const result=await run();return {ok:Boolean(result),needsFileSave:isSessionDirty(sessionRef.current)}}
  const discardPendingEdits = () => {
    skipDraftSaveOnUnmount.current = true
    setAnnotations([]); setOutputs([]); setTextEdits([]); setImageEdits([]); setSelectedImage(null); setRedaction([]); setOptions((current) => ({ ...current, fields: {} })); resetEditHistory(); setError(''); setMessage(''); onDirtyChange(false)
  }

  const activateTool = (nextToolId) => { setToolId(nextToolId); setTextEditMode(false); setError(''); setMessage(''); setOutputs([]) }
  useImperativeHandle(editorRef, () => ({ applyChangesInApp, savePendingEdits, discardPendingEdits, printPdf, saveAs:saveCurrentToDevice, activateTool }), [busy, outputs, textEdits, imageEdits, redaction, toolId, options, files])
  useEffect(() => {
    const handleSaveShortcut = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase()==='s') { event.preventDefault(); void saveCurrentToDevice(); return }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase()==='p') { event.preventDefault(); void printPdf(); return }
      if (event.isComposing || !matchesShortcut(event, loadShortcuts()['save-export'], window.pdfKing?.platform === 'darwin' || /Mac|iPhone|iPad/.test(navigator.platform || ''))) return
      event.preventDefault()
      void savePendingEdits()
    }
    window.addEventListener('keydown', handleSaveShortcut)
    return () => window.removeEventListener('keydown', handleSaveShortcut)
  }, [busy, outputs, textEdits, redaction, toolId, options, files])
  const pageOptionKey = toolId === 'sign-pdf' ? 'signaturePage' : 'annotationPage'
  const selectedPageOption = Number(options[toolId === 'redact-pdf' ? 'redactPage' : pageOptionKey]) || 1
  const viewerPage = currentViewerPage
  const activeToolLabel = EDITOR_MODE_LABELS[toolId] || EDITOR_TOOLS.find(([id]) => id === toolId)?.[1] || PDF_EXPORT_TOOLS.find(([id]) => id === toolId)?.[1] || 'PDF'
  const selectedImageEdit = selectedImage && imageEdits.find((edit) => edit.page === selectedImage.page && edit.key === selectedImage.key)
  const navPage = (page) => {
    if (!Number.isInteger(page) || page < 1 || (pageCount && page > pageCount)) return
    setViewerPage(page)
    if (toolId === 'redact-pdf' || toolId === 'sign-pdf') setOptions((current) => ({ ...current, [toolId === 'redact-pdf' ? 'redactPage' : pageOptionKey]: String(page) }))
  }
  const activateTextMode = (mode) => {
    setToolId(mode)
    setTextEditMode(true)
    setError('')
    setMessage('')
    setOutputs([])
    cancelCurrentOperation(); setBusy(false)
  }
  const activateEditorTool = (id) => {
    if (id === 'edit-text' || id === 'add-text') { activateTextMode(id); return }
    setToolId(id)
    setTextEditMode(false)
    setError('')
    setMessage('')
    setOutputs([])
  }
  const selectEditorMenuTab = (tab) => {
    const previousTab = editorMenuTab
    if (tab === 'organize' && previousTab !== 'organize') {
      const viewport = editorWorkspaceRef.current?.querySelector('.pdf-viewer-page')
      if (viewport) {
        const targetY = viewport.scrollTop + Math.min(viewport.clientHeight * 0.36, 260)
        const visibleSlot = [...viewport.querySelectorAll('.pdf-viewer-virtual-slot')].find((slot) => (Number.parseFloat(slot.style.top) || 0) + slot.clientHeight >= targetY)
        const visiblePage = Number(visibleSlot?.dataset.page) || currentViewerPage
        setSelectedOrganizerPage(visiblePage - 1)
        setViewerState((current) => ({ ...current, scrollTop: viewport.scrollTop }))
      }
    }
    setEditorMenuTab(tab)
    setRightSidebarCollapsed(false)
    if (tab === 'home' && previousTab === 'organize') return
    if (tab === 'home' && !HOME_EDITOR_TOOLS.some(([id]) => id === toolId)) { setToolId('pdf-editor'); setTextEditMode(false) }
    if (tab === 'insert' && !INSERT_EDITOR_TOOLS.some(([id]) => id === toolId)) { setToolId('pdf-editor'); setTextEditMode(false) }
    if (tab === 'export' && !PDF_EXPORT_TOOLS.some(([id]) => id === toolId)) { setToolId('pdf-to-word'); setTextEditMode(false) }
    if (tab === 'secure' && !SECURE_EDITOR_TOOLS.some(([id]) => id === toolId)) { setToolId('protect-pdf'); setTextEditMode(false) }
  }
  const selectTextObject = () => {
    setToolId('edit-text')
    setTextEditMode(true)
    setError('')
    setMessage('')
    setOutputs([])
    cancelCurrentOperation(); setBusy(false)
  }
  const selectImageObject = (image) => {
    setSelectedImage(image)
    setOutputs([])
  }
  const saveImageEdit = (edit) => {
    const key = `${edit.page}:${edit.key}`
    const previous = imageEdits.find((item) => `${item.page}:${item.key}` === key)
    const next = [...imageEdits.filter((item) => `${item.page}:${item.key}` !== key), { ...edit, ...previous, ...edit }]
    commitEditSnapshot({ ...currentEditSnapshot.current, imageEdits: next })
    setSelectedImage(edit)
    cancelCurrentOperation(); setBusy(false)
  }
  const updateSelectedImage = patch => { if(selectedImage) saveImageEdit({...selectedImage,...selectedImageEdit,...patch}) }
  const placeSignature = async signature => {
    const expected=captureRevision(sessionRef.current,file),page=signatureFieldTarget?.page??currentViewerPage,viewerRotation=Number(viewerState.rotation)||0;
    try {
      const target = signatureFieldTarget?.page === page ? signatureFieldTarget : null
      if(signature.text) commitEditSnapshot({...currentEditSnapshot.current,textEdits:[...currentEditSnapshot.current.textEdits,{isNew:true,key:`signature-${Date.now()}`,page,x:target?.x??.15,y:target?.y??.65,width:target?.width??.45,height:target?.height??.08,text:signature.text,fontSize:target?Math.max(8,Math.min(24,(target.height*(pageSizes[page-1]?.height||792))*.72)):24,fontFamily:'Times',fontStyle:'italic',color:'#172231',viewerRotation}]});
      else {
        const {inspectPdfPageSize}=await import('../pdfEngine');const size=await inspectPdfPageSize(file,page,viewerRotation);
        assertRevision(expected,sessionRef.current,filesRef.current[0]);
        const maxWidth=target?.width??.4,maxHeight=target?.height??Math.min(.3,.4*(signature.aspect||.275)*size.width/size.height),aspect=signature.aspect||.275;
        const width=Math.min(maxWidth,maxHeight/(aspect||.275)*size.height/size.width),height=Math.min(maxHeight,width*aspect*size.width/size.height);
        saveImageEdit({isNew:true,key:`signature-${Date.now()}`,page,x:target?target.x+(target.width-width)/2:.15,y:target?target.y+(target.height-height)/2:.65,width,height,replacementData:signature.data,replacementType:signature.type,viewerRotation});
      }
      setSignatureFieldTarget(null)
      setToolId(signature.text?'edit-text':'images');
    }catch(cause){setError(cause.message||'Could not place the signature.')}
  }
  const handlePdfShortcut = (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey || event.isComposing) return
    const target = event.target
    if (target instanceof HTMLElement && (target.isContentEditable || target.closest('input, textarea, select, [contenteditable="true"]'))) return
    if (window.getSelection()?.toString()) return

    if(event.key==='Escape'){setToolId('pdf-editor');setTextEditMode(false);setSelectedImage(null);return}
    if(['Delete','Backspace'].includes(event.key)&&selectedImage&&toolId==='images'){event.preventDefault();updateSelectedImage({deleted:true});return}
    const nextTool = event.key === 't' || event.key === 'T'
      ? 'add-text'
      : event.shiftKey && event.key.toLowerCase() === 'e' ? 'edit-text' : null
    if (!nextTool || !file) return

    event.preventDefault()
    setToolId(nextTool)
    setTextEditMode(true)
    setError('')
    setMessage('')
    setOutputs([])
  }

  const toggleEditorSearch = () => {
    if (editorSearchExpanded) { setEditorSearchExpanded(false); return }
    setEditorSearchExpanded(true)
    window.dispatchEvent(new CustomEvent('pdf-editor-open-search'))
    requestAnimationFrame(() => editorSearchInputRef.current?.focus())
  }
  const editorToolbarTools = editorMenuTab === 'secure' ? SECURE_EDITOR_TOOLS : EDITOR_TOOLBAR_TOOLS

  return <main className={`pdf-editor-workspace ${file ? 'has-document' : 'no-document'} ${rightSidebarCollapsed ? 'right-sidebar-collapsed' : ''}`} ref={editorWorkspaceRef} onClickCapture={event => {
    if (file) return
    const target = event.target instanceof Element ? event.target : null
    if (target?.closest('.editor-open-empty, .editor-chrome-toggle, .editor-exit')) return
    if (target?.closest('button, input, select, textarea, [role="button"]')) { event.preventDefault(); event.stopPropagation() }
  }}>
    <div ref={editorTooltipRef} className="editor-tooltip" role="tooltip" />
    {showProperties&&file&&<PropertiesDialog file={file} onClose={()=>setShowProperties(false)} onCommit={commitCurrent}/>}
    <header className="pdf-editor-header">
      <button className="editor-chrome-toggle" type="button" onClick={onToggleAppChrome} aria-expanded={appChromeVisible} aria-label={appChromeVisible ? 'Focus PDF view' : 'Restore workspace layout'}><Icon name={appChromeVisible ? 'expand' : 'compress'} size={17} /></button>
      <button className="editor-exit" type="button" onClick={onExit} aria-label="Back to workspace"><Icon name="arrowLeft" size={17} /></button>
      <div className="editor-document-title"><span title={file?.name || 'PDF editor'}>{file?.name || 'Open a PDF to begin editing'}</span></div>
      <div className="editor-header-actions">
        <button className="editor-open-button" aria-label={isSessionDirty(session) ? 'Save changes' : 'Save'} disabled={!file||busy} onClick={()=>void savePendingEdits()}><Icon name="save" size={17} />{isSessionDirty(session) && <i className="editor-dirty-dot" />}</button>
        <button className="editor-open-button" aria-label="Save as" disabled={!file||busy} onClick={()=>void saveCurrentToDevice()}><Icon name="fileDown" size={17} /></button>
        <button className="editor-open-button" aria-label="Print" disabled={!file||busy} onClick={()=>void printPdf()}><Icon name="print" size={17} /></button>
      </div>
      <input ref={picker} hidden type="file" accept="application/pdf,.pdf" onChange={(event) => { addFile(event.target.files); event.target.value = '' }} />
    </header>
    <nav className="pdf-editor-task-nav" aria-label="Editor sections">
      <button type="button" aria-label="Edit" aria-pressed={['home','insert'].includes(editorMenuTab) && toolId !== 'fill-forms'} title="Edit" className={['home','insert'].includes(editorMenuTab) && toolId !== 'fill-forms' ? 'active' : ''} onClick={() => selectEditorMenuTab('home')}>Edit</button>
      <button type="button" aria-label="Organize" aria-pressed={editorMenuTab === 'organize'} title="Organize" className={editorMenuTab === 'organize' ? 'active' : ''} onClick={() => selectEditorMenuTab('organize')}>Organize</button>
      <button type="button" aria-label="Form" aria-pressed={toolId === 'fill-forms'} title="Form" className={toolId === 'fill-forms' ? 'active' : ''} onClick={() => { setToolId('fill-forms'); setTextEditMode(false); setEditorMenuTab('home') }}>Form</button>
      <button type="button" aria-label="Convert" aria-pressed={editorMenuTab === 'export'} title="Convert" className={editorMenuTab === 'export' ? 'active' : ''} onClick={() => selectEditorMenuTab('export')}>Convert</button>
      <button type="button" aria-label="Secure PDF" aria-pressed={editorMenuTab === 'secure'} title="Secure PDF" className={editorMenuTab === 'secure' ? 'active' : ''} onClick={() => selectEditorMenuTab('secure')}>Secure PDF</button>
      <div className="pdf-editor-nav-actions">
        <div className="pdf-editor-command-quick-actions" aria-label="Document actions">
          <button type="button" aria-label="Properties" title="Properties" disabled={!file || busy} onClick={() => setShowProperties(true)}>Properties</button>
          <span />
          <button type="button" aria-label="Undo" title="Undo PDF edit" disabled={busy || !editHistory.past.length} onClick={undoEdit}>Undo</button>
          <button type="button" aria-label="Redo" title="Redo PDF edit" disabled={busy || !editHistory.future.length} onClick={redoEdit}>Redo</button>
        </div>
        <div className={`pdf-editor-nav-search ${editorSearchExpanded ? 'is-expanded' : ''}`}>
          <button type="button" aria-label={editorSearchExpanded ? 'Collapse PDF search' : 'Search PDF'} onClick={toggleEditorSearch}>Search</button>
          <input ref={editorSearchInputRef} type="search" tabIndex={editorSearchExpanded ? 0 : -1} value={viewerState.searchQuery || ''} placeholder="Find in PDF" aria-label="Search PDF" onFocus={() => window.dispatchEvent(new CustomEvent('pdf-editor-open-search'))} onChange={(event) => { setViewerState((current) => ({ ...current, searchQuery: event.target.value })); window.dispatchEvent(new CustomEvent('pdf-editor-open-search')) }} />
        </div>
        <button type="button" className={`pdf-editor-right-sidebar-toggle ${rightSidebarCollapsed ? 'active' : ''}`} aria-label={rightSidebarCollapsed ? 'Expand right sidebar' : 'Collapse right sidebar'} aria-expanded={!rightSidebarCollapsed} title={rightSidebarCollapsed ? 'Expand right sidebar' : 'Collapse right sidebar'} onClick={() => setRightSidebarCollapsed((value) => !value)}>{rightSidebarCollapsed ? 'Show panel' : 'Hide panel'}</button>
      </div>
    </nav>

    <aside className="pdf-editor-command-sidebar" aria-label="PDF editing controls">
    <nav className="pdf-editor-tools" aria-label="PDF editing modes">
      {editorToolbarTools.map(([id,label,icon]) => <button type="button" key={id} title={label} aria-label={label} aria-pressed={toolId === id} className={toolId === id ? 'active' : ''} onClick={() => {
        if (id === 'add-text') { selectEditorMenuTab('insert'); activateTextMode(id); return }
        const tab = SECURE_EDITOR_TOOLS.some(([secureId]) => secureId === id) ? 'secure' : ['sign-pdf'].includes(id) ? 'insert' : 'home'
        selectEditorMenuTab(tab)
        if (id === 'pdf-editor') { setToolId(id); setTextEditMode(false) }
        else activateEditorTool(id)
      }}><Icon name={icon} size={17} /></button>)}
    </nav>
    {editorMenuTab==='organize'? <div className="pdf-editor-options"><div className="editor-options-label"><strong>Format &amp; Object</strong><small>Organize pages · Page {selectedOrganizerPage + 1}</small></div>{[['rotate','Rotate 90°'],['duplicate','Duplicate'],['delete','Delete'],['blank','Insert blank']].map(([action,label])=><button className="editor-open-button" key={action} disabled={!file||busy} onClick={()=>void commitCurrent([{type:'pages',action,index:selectedOrganizerPage}]).catch(cause=>setError(cause.message))}>{label}</button>)}<button className="editor-open-button" disabled={!file||busy} onClick={()=>insertPicker.current?.click()}>Insert PDF</button><button className="editor-open-button" disabled={!file||busy} onClick={async()=>{try{const current=await commitCurrent();const {processTool}=await import('../pdfEngine');const result=await processTool({toolId:'extract-pages',files:[current],options:{pages:String(selectedOrganizerPage+1)}});await saveOutput(result.outputs[0])}catch(cause){setError(cause.message)}}}>Extract page</button><input hidden ref={insertPicker} type="file" accept=".pdf,application/pdf" onChange={async event=>{const source=event.target.files?.[0];event.target.value='';if(source)try{await commitCurrent([{type:'insert',index:selectedOrganizerPage,bytes:new Uint8Array(await source.arrayBuffer())}])}catch(cause){setError(cause.message)}}}/></div> : ['home', 'insert'].includes(editorMenuTab) ? <div className="pdf-editor-options pdf-editor-context-options">
      <div className="editor-options-label"><strong>Format &amp; Object</strong></div>
      <div className="editor-options-fields contextual-options-content">
        <div className="contextual-tool-settings">
          {['highlight','underline','strike','draw','rectangle','ellipse','line','arrow','comment','form-text','form-checkbox','form-dropdown','form-list','form-radio','form-design','annotation-select'].includes(toolId)&&<><label>Color <input type="color" value={annotationStyle.color} onChange={e=>setAnnotationStyle({...annotationStyle,color:e.target.value})}/></label><label>Thickness <input type="number" min="1" max="20" value={annotationStyle.thickness} onChange={e=>setAnnotationStyle({...annotationStyle,thickness:Number(e.target.value)})}/></label><label>Opacity <input type="range" min=".1" max="1" step=".1" value={annotationStyle.opacity} onChange={e=>setAnnotationStyle({...annotationStyle,opacity:Number(e.target.value)})}/></label><span>Select text to mark it, or drag on the page.</span></>}
          {toolId==='images'&&<><button className="editor-open-button" onClick={()=>imagePicker.current?.click()}>Add image</button><input hidden type="file" accept="image/png,image/jpeg" ref={imagePicker} onChange={async e=>{const image=e.target.files?.[0];e.target.value='';if(!image)return;setBusy(true);try{const expected=captureRevision(sessionRef.current,file);const imagePage=currentViewerPage,imageViewerRotation=Number(viewerState.rotation)||0;const data=new Uint8Array(await image.arrayBuffer());const bitmap=await createImageBitmap(image);const aspect=bitmap.height/bitmap.width;bitmap.close();const {inspectPdfPageSize}=await import('../pdfEngine');const size=await inspectPdfPageSize(file,imagePage,imageViewerRotation);assertRevision(expected,sessionRef.current,filesRef.current[0]);saveImageEdit({isNew:true,key:`image-${Date.now()}`,page:imagePage,x:.15,y:.15,width:.3,height:Math.min(.6,.3*aspect*size.width/size.height),replacementData:data,replacementType:image.type,viewerRotation:Number(viewerState.rotation)||0})}catch(cause){setError(cause.message||'This image could not be decoded.')}finally{setBusy(false)}}}/></>}

          {['edit-text', 'add-text'].includes(toolId) && <>
            <label className="text-style-control">Font <select className="studio-input" value={textStyle.localFontId ? `local:${textStyle.localFontId}` : textStyle.fontFamily} onChange={(event) => void selectTextFont(event.target.value)}>{!PDF_TEXT_FONTS.includes(textStyle.fontFamily) && !textStyle.localFontId && <option value={textStyle.fontFamily}>{textStyle.fontFamily}</option>}{PDF_TEXT_FONTS.map((font) => <option key={font} value={font}>{font}</option>)}{localFonts.map((font) => <option key={font.id} value={`local:${font.id}`}>{font.name} · local</option>)}</select></label>
            <label className="text-style-control">Size <select className="studio-input" value={textStyle.fontSize} onChange={(event) => setTextStyle((style) => ({ ...style, fontSize: Number(event.target.value) }))}>{![8, 10, 12, 14, 16, 18, 24, 32, 48].includes(textStyle.fontSize) && <option value={textStyle.fontSize}>{textStyle.fontSize} pt</option>}{[8, 10, 12, 14, 16, 18, 24, 32, 48].map((size) => <option key={size} value={size}>{size} pt</option>)}</select></label>
            <label className="text-style-control">Color <input className="text-style-color" aria-label="Text color" type="color" value={textStyle.color} onChange={(event) => setTextStyle((style) => ({ ...style, color: event.target.value }))} /></label>
            <button type="button" className={`text-style-toggle ${textStyle.bold ? 'active' : ''}`} aria-pressed={textStyle.bold} onClick={() => setTextStyle((style) => ({ ...style, bold: !style.bold }))}><b>B</b></button>
            <button type="button" className={`text-style-toggle ${textStyle.italic ? 'active' : ''}`} aria-pressed={textStyle.italic} onClick={() => setTextStyle((style) => ({ ...style, italic: !style.italic }))}><i>I</i></button>
            {toolId === 'add-text' && <span className="edit-text-help">{textEdits.length ? `${textEdits.length} text box${textEdits.length === 1 ? '' : 'es'} ready` : 'Set a style, then click the page to place text.'}</span>}
          </>}
          {toolId==='images'&&selectedImage&&<><button className="editor-open-button" onClick={()=>updateSelectedImage({deleted:true})}>Delete image</button><label>Free resize <input type="checkbox" checked={Boolean(selectedImageEdit?.freeResize)} onChange={e=>updateSelectedImage({freeResize:e.target.checked})}/></label><button className="editor-open-button" onClick={()=>updateSelectedImage({imageRotation:((selectedImageEdit?.imageRotation||0)+90)%360})}>Rotate image</button></>}
          {toolId === 'images' && <ImageOptions selectedImage={selectedImage} imageEdit={selectedImageEdit} onReplaceImage={(replacementData, replacementType, replacementName) => {if(sessionRef.current.id!==session.id||sessionRef.current.revision!==session.revision||filesRef.current[0]!==file){setError('Document changed while reading the image. Select it and try again.');return}updateSelectedImage({ replacementData, replacementType, replacementName })}} onCropChange={(crop) => updateSelectedImage({ crop })} />}
          {toolId==='edit-text'&&<small style={{maxWidth:460}}>Complex text uses visual replacement and may remain extractable. Use Redact for secrets. Resize the box for longer text.</small>}
          {toolId==='fill-forms'&&<button className="editor-open-button" onClick={async()=>{try{const expected=captureRevision(sessionRef.current,file),page=currentViewerPage,rotation=Number(viewerState.rotation)||0;const {detectPdfFormFields}=await import('../pdfEngine');const candidates=await detectPdfFormFields(file,page,rotation);assertRevision(expected,sessionRef.current,filesRef.current[0]);setFormCandidates(candidates);setMessage(candidates.length?`Review ${candidates.length} field suggestions.`:'No blank-line or checkbox candidates were found on this page.')}catch(cause){setError(cause.message)}}}>Detect fields on this page</button>}
          {toolId==='fill-forms'&&<button className="editor-open-button" onClick={()=>activateEditorTool('form-design')}>Manage fields</button>}
          {selectedObject&&['form-design','annotation-select'].includes(toolId)&&<><span>{selectedObject.kind || 'Field'} on page {selectedObject.page}</span>
            {selectedObject.type.startsWith('form-')&&<><label>Field name <input aria-label="Field name" value={selectedObject.name||''} onChange={e=>updateAnnotation({...selectedObject,name:e.target.value})}/></label>
            {(['dropdown','list'].includes(selectedObject.kind)||(selectedObject.kind==='radio'&&selectedObject.type==='form-create'))&&<label>Choices (one per line)<textarea aria-label="Field choices" value={(selectedObject.choices||['Option 1','Option 2']).join('\n')} onChange={e=>updateAnnotation({...selectedObject,choices:e.target.value.split('\n').filter(Boolean)})}/></label>}
            <label>Required <input type="checkbox" checked={Boolean(selectedObject.required)} onChange={e=>updateAnnotation({...selectedObject,required:e.target.checked})}/></label>
            <label>Read only <input type="checkbox" checked={Boolean(selectedObject.readOnly)} onChange={e=>updateAnnotation({...selectedObject,readOnly:e.target.checked})}/></label>
            {selectedObject.kind==='radio'&&selectedObject.type==='form-update'&&<small>Radio choices are fixed after creation. Deleting removes the entire group.</small>}{selectedObject.kind==='text'&&<label>Multiline <input type="checkbox" checked={Boolean(selectedObject.multiline)} onChange={e=>updateAnnotation({...selectedObject,multiline:e.target.checked})}/></label>}</>}
            {selectedObject.type==='annotation'&&<><label>Mark color <input type="color" value={selectedObject.color||'#ffcc00'} onChange={e=>updateAnnotation({...selectedObject,color:e.target.value})}/></label>{selectedObject.kind==='comment'&&<label>Comment text <input value={selectedObject.text||''} onChange={e=>updateAnnotation({...selectedObject,text:e.target.value})}/></label>}</>}
            <button className="editor-open-button" onClick={deleteAnnotation}>Delete selected object</button></>}
          {['form-design','annotation-select'].includes(toolId)&&<span>Click an object to select it. Drag to move; drag its corner to resize. Committed marks are flattened; fields stay interactive.</span>}
          {toolId==='sign-pdf'&&<SignaturePanel key={session.id} targetLabel={signatureFieldTarget?.name} reusableSignature={reusableSignature} setReusableSignature={setReusableSignature} onPlace={placeSignature}/>}
          {((EDITOR_TOOLS.some(([id]) => id === toolId) && toolId !== 'sign-pdf') || toolId === 'fill-forms') && <ToolOptions editorPage={currentViewerPage} toolId={toolId} options={options} setOption={setOption} pageCount={pageCount} formFields={formFields} />}
          {toolId === 'pdf-editor' && <span className="edit-text-help">Choose a tool to see its settings.</span>}
        </div>
      </div>
    </div> : editorMenuTab === 'secure' ? <div className="pdf-editor-options pdf-editor-context-options pdf-editor-secure-options">
      <div className="editor-options-label"><strong>Secure PDF</strong></div>
      <div className="editor-options-fields contextual-options-content">
        <div className="contextual-tool-settings">
          <ToolOptions editorPage={currentViewerPage} toolId={toolId} options={options} setOption={setOption} pageCount={pageCount} formFields={formFields} />
        </div>
      </div>
    </div> : <div className="pdf-editor-options pdf-editor-export-options">
      <div className="editor-options-label"><strong>Format &amp; Object</strong></div>
      <div className="editor-options-fields export-options-content">
        <div className="export-tool-actions" aria-label="PDF export tools">
          {PDF_EXPORT_TOOLS.map(([id, label]) => <button type="button" key={id} className={toolId === id ? 'active' : ''} onClick={() => { setToolId(id); setTextEditMode(false); setError(''); setMessage(''); setOutputs([]) }}>{label}</button>)}
        </div>
        <p className="option-note">{toolId==='ocr-pdf'?'OCR edits the current document. Save the searchable PDF when recognition finishes.':'Generate separate output from the current document, including your edits.'}</p><div className="export-format-options">{PDF_EXPORT_TOOLS.some(([id]) => id === toolId) && <ToolOptions toolId={toolId} options={options} setOption={setOption} pageCount={pageCount} formFields={formFields} />}</div>
      </div>
    </div>}

    <FormCandidatesPanel candidates={formCandidates} onChange={(index,patch)=>setFormCandidates(current=>patch?current.map((candidate,i)=>i===index?{...candidate,...patch}:candidate):current.filter((_,i)=>i!==index))} onAccept={index=>{const candidate=formCandidates[index];commitEditSnapshot({...currentEditSnapshot.current,annotations:[...annotations,{...candidate,type:'form-create'}]});setFormCandidates(current=>current.filter((_,i)=>i!==index))}}/>
    <div className="pdf-editor-command-footer">
      {toolId !== 'pdf-editor' && <button type="button" className="pdf-editor-command-apply" disabled={!file || busy} onClick={() => outputs.length ? void save(outputs[0]) : void run()}>{busy ? 'Working…' : toolId === 'redact-pdf' ? 'Apply redactions' : outputs.length ? 'Save output' : `Run ${activeToolLabel}`}<Icon name="arrow" size={15} /></button>}
      {busy && <button type="button" className="pdf-editor-command-cancel" onClick={() => processingController.current?.abort()}>Cancel operation</button>}
    </div>
    </aside>
    <section className={`pdf-editor-stage ${file ? 'has-document' : 'empty'} ${editorMenuTab === 'organize' ? 'is-organizing' : ''}`} aria-label="PDF page viewer" tabIndex={0} onKeyDown={handlePdfShortcut}>
      {!file ? <button type="button" className="editor-open-empty" onClick={() => onOpenPdf ? onOpenPdf() : picker.current?.click()}><span className="editor-empty-icon"><Icon name="upload" size={24} /></span><strong>Open a PDF to start editing</strong><span>Choose a recent PDF or browse your device.</span><b>Choose PDF</b></button> : <>
        {editorMenuTab === 'organize' && <div className="editor-organizer-grid" ref={organizerRoot} aria-label="All pages">
          <header className="editor-organizer-heading"><div><span className="editor-organizer-heading-icon" aria-hidden="true" /><h2>All pages</h2></div><span>{selectedOrganizerPage + 1} of {pageCount} selected</span></header>
          <div className="editor-organizer-cards">
            {Array.from({ length: pageCount }, (_, index) => <div key={index} className={`editor-organizer-card ${selectedOrganizerPage === index ? 'selected' : ''}`} draggable onDragStart={event => event.dataTransfer.setData('application/pdfking-page', String(index))} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); const from = Number(event.dataTransfer.getData('application/pdfking-page')); if (!Number.isInteger(from) || from === index) return; const order = Array.from({ length: pageCount }, (_, pageIndex) => pageIndex); order.splice(index, 0, order.splice(from, 1)[0]); void commitCurrent([{ type: 'pages', action: 'reorder', order }]).catch(cause => setError(cause.message)) }} onClick={() => setSelectedOrganizerPage(index)} onDoubleClick={() => { setViewerPage(index + 1); setToolId('pdf-editor'); setTextEditMode(false); selectEditorMenuTab('home') }} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); setViewerPage(index + 1); setToolId('pdf-editor'); setTextEditMode(false); selectEditorMenuTab('home') } else if (event.key === ' ') { event.preventDefault(); setSelectedOrganizerPage(index) } }} role="button" tabIndex={0} aria-pressed={selectedOrganizerPage === index} aria-label={`Page ${index + 1}; double click to open in editor`}>
              <div className="editor-organizer-card-heading"><span>{String(index + 1).padStart(2, '0')}</span>{selectedOrganizerPage === index ? <span className="editor-organizer-selected-mark"><Icon name="check" size={13} /></span> : <span className="editor-organizer-drag-handle" aria-hidden="true" />}</div>
              <div className="editor-organizer-paper-frame"><PageThumbnail file={file} pageNumber={index + 1} pageSize={pageSizes[index]} root={organizerRoot} /></div>
              <span className="editor-organizer-page-label">Page {index + 1}</span>
            </div>)}
          </div>
        </div>}
        <PdfViewer redactionMarks={redaction} onRedactionAdd={mark=>commitEditSnapshot({...currentEditSnapshot.current,redaction:[...currentEditSnapshot.current.redaction,{...mark,key:crypto.randomUUID(),page:mark.page,viewerRotation:Number(viewerState.rotation)||0}]})} onRedactionChange={mark=>commitEditSnapshot({...currentEditSnapshot.current,redaction:currentEditSnapshot.current.redaction.map(m=>m.key===mark.key?mark:m)})} onRedactionDelete={key=>commitEditSnapshot({...currentEditSnapshot.current,redaction:currentEditSnapshot.current.redaction.filter(m=>m.key!==key)})} selectedAnnotation={selectedAnnotation} onAnnotationSelect={setSelectedAnnotation} onAnnotationChange={updateAnnotation} annotationMode={toolId} annotations={[...annotations,...formCandidates.map(candidate=>({...candidate,type:'candidate',color:'#2381dd',opacity:.8}))]} annotationStyle={annotationStyle} onAnnotationAdd={items=>{if(sessionRef.current.id!==session.id||filesRef.current[0]!==file)return;const added=items.map(item=>({...item,key:item.key||crypto.randomUUID()}));commitEditSnapshot({...currentEditSnapshot.current,annotations:[...currentEditSnapshot.current.annotations,...added]});setSelectedAnnotation(added.at(-1))}} file={file} page={viewerPage} pageCount={pageCount} pageSizes={pageSizes} viewerState={viewerState} onViewerStateChange={setViewerState} onPageChange={navPage} formValues={options.fields || {}} onFormValueChange={(name, value) => setOption('fields', { ...(options.fields || {}), [name]: value })} editTextMode={textEditMode} addTextMode={toolId === 'add-text'} imageSelectMode={toolId === 'images'} textStyle={textStyle} onTextStyleActivate={setTextStyle} localFonts={localFonts} onSelectTextFont={selectTextFont} onAddTextPlaced={() => { setToolId('add-text'); setTextEditMode(false) }} onTextObjectSelected={selectTextObject} imageEdits={imageEdits} selectedImage={selectedImage} onSelectImage={selectImageObject} onImageEdit={edit=>saveImageEdit({...edit,viewerRotation:Number(viewerState.rotation)||0})} textEdits={textEdits} onTextEdit={(edit) => commitEditSnapshot({ ...currentEditSnapshot.current, textEdits: [...textEdits.filter((item) => !(item.page === edit.page && item.key === edit.key)), { ...edit, viewerRotation: Number(viewerState.rotation)||0 }] })} onTextDelete={(edit) => commitEditSnapshot({ ...currentEditSnapshot.current, textEdits: textEdits.filter((item) => item.page !== edit.page || item.key !== edit.key) })} />
      </>}

    </section>
    {(error || message) && <div className={`pdf-editor-status ${error ? 'is-error' : ''}`} role={error ? 'alert' : 'status'}>{error || message}</div>}
  </main>
}

function accepts(toolId, file) {
  if (toolId === 'jpg-to-pdf') return /^image\/(jpeg|png)$/.test(file.type) || /\.(jpe?g|png)$/i.test(file.name)
  if (toolId === 'word-to-pdf') return /\.docx$/i.test(file.name)
  if (toolId === 'powerpoint-to-pdf') return /\.(pptx|ppt)$/i.test(file.name)
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name)
}

function moveFile(files, index, offset) {
  const next = [...files]
  const target = index + offset
  if (target < 0 || target >= next.length) return next
  ;[next[index], next[target]] = [next[target], next[index]]
  return next
}

function ImageOptions({ selectedImage, imageEdit, onReplaceImage, onCropChange }) {
  const crop = imageEdit?.crop || { top: 0, right: 0, bottom: 0, left: 0 }
  const sourceReady = Boolean(selectedImage?.sourceData || imageEdit?.sourceData)
  if (!selectedImage) return <p className="option-note">Click an image on the page to select it. Drag it to move, or drag its corner to resize.</p>
  const handleReplacement = async (event) => {
    const file = event.target.files?.[0]
    if (!file) return
    onReplaceImage(new Uint8Array(await file.arrayBuffer()), file.type || 'image/png', file.name)
    event.target.value = ''
  }
  const setCrop = (side, value) => onCropChange({ ...crop, [side]: Number(value) })
  return <>
    <span className="image-selection-summary">Image on page {selectedImage.page}</span><small>Replacement keeps placement and orientation. Moving/deleting covers the source; complex backgrounds may need redaction.</small>
    <label className="image-replace-field">Replace image<input type="file" accept="image/png,image/jpeg,.png,.jpg,.jpeg" onChange={handleReplacement} /></label>
    {['top', 'right', 'bottom', 'left'].map((side) => <label className="image-crop-field" key={side}>Crop {side} · {crop[side]}%<input type="range" min="0" max="45" step="1" disabled={!sourceReady} value={crop[side] || 0} onChange={(event) => setCrop(side, event.target.value)} /></label>)}
    {!sourceReady && !imageEdit?.replacementData && <small className="edit-text-help">Image preview is loading…</small>}
  </>
}

function ToolOptions({ toolId, options, setOption, pageCount, formFields = [], editorPage = null }) {
  const field = (label, key, placeholder = '') => <label className="tool-field">{label}<input className="studio-input" value={options[key]} onChange={(event) => setOption(key, event.target.value)} placeholder={placeholder} /></label>
  const select = (label, key, choices) => <label className="tool-field">{label}<select className="studio-input" value={options[key]} onChange={(event) => setOption(key, event.target.value)}>{choices.map(([value, text]) => <option value={value} key={value}>{text}</option>)}</select></label>
  const note = (text) => <p className="option-note">{text}</p>
  switch (toolId) {
    case 'pdf-editor': return null
    case 'merge-pdf': return <>{note('Files are combined in the order listed. Use Add another PDF to include more.')}</>
    case 'split-pdf': return <>{select('Split mode', 'splitMode', [['ranges', 'By page ranges'], ['each', 'Every page separately']])}{options.splitMode === 'ranges' && field(`Page ranges${pageCount ? ` · 1–${pageCount}` : ''}`, 'ranges', '1-3, 5')}{note(options.splitMode === 'each' ? 'Creates one PDF for every page.' : 'Use commas for separate groups and hyphens for ranges.')}</>
    case 'extract-pages': return <>{field(`Pages to extract${pageCount ? ` · 1–${pageCount}` : ''}`, 'pages', 'Select thumbnails or enter 1-3, 5')}{note('The chosen pages are combined into one new PDF.')}</>
    case 'delete-pages': return <>{field(`Pages to remove${pageCount ? ` · 1–${pageCount}` : ''}`, 'pages', 'Select thumbnails or enter 2, 4-6')}{note('At least one page must remain in the document.')}</>
    case 'duplicate-pages': return <>{field('Pages to duplicate', 'pages', 'Select thumbnails or enter 1, 3')}{note('Copies are appended to the end of the document.')}</>
    case 'organize-pdf': return <>{field(`Custom page order${pageCount ? ` · 1–${pageCount}` : ''}`, 'pages', '3, 1-2, 4')}{note('Use the page arrows to reorder. Repeat a number to duplicate a page, or omit it to remove it.')}</>
    case 'rotate-pages': return <>{select('Rotation', 'rotation', [[90, '90° clockwise'], [180, '180°'], [270, '270° clockwise']])}{field('Pages to rotate', 'pages', 'Leave blank for all pages')}{note('Select page thumbnails or leave the field blank to rotate all pages.')}</>
    case 'crop-pdf': return <>{field('Pages to crop', 'pages', 'Leave blank for all pages')}{['top', 'right', 'bottom', 'left'].map((side) => <label className="tool-field" key={side}>{side} margin · mm<input className="studio-input" type="number" min="0" max="200" value={options.margins[side]} onChange={(event) => setOption('margins', { ...options.margins, [side]: Number(event.target.value) })} /></label>)}{note('Select thumbnails for specific pages, or leave the field blank to crop all.')}</>
    case 'add-watermark': return <>{field('Watermark text', 'watermarkText', 'CONFIDENTIAL')}<label className="tool-field">Opacity · {options.opacity}%<input type="range" min="10" max="100" value={options.opacity} onChange={(event) => setOption('opacity', Number(event.target.value))} /></label>{select('Angle', 'angle', [[0, 'Horizontal'], [45, '45°'], [90, '90°']])}</>
    case 'page-numbers': return <>{select('Position', 'position', ['top-left', 'top-center', 'top-right', 'bottom-left', 'bottom-center', 'bottom-right'].map((value) => [value, value.replace('-', ' ')]))}{field('First page number', 'startNumber', '1')}</>
    case 'compress-pdf': return <>{select('Compression mode', 'quality', [['lossless', 'Lossless · preserve page content'], ['high', 'High visual quality'], ['recommended', '70% target · preserve PDF features'], ['small', 'Smallest file']])}{note(options.quality === 'lossless' ? 'Compresses text and font streams, combines duplicate resources, and removes unused objects without changing image quality.' : options.quality === 'recommended' ? 'Targets 70% smaller while preserving selectable text, search, links, and interactive forms. Only embedded image quality and document resources are optimized. Actual reduction depends on the file; some PDFs cannot reach 70% without losing features.' : 'All modes preserve selectable text, search, links, forms, and page layout. High visual quality keeps more image detail; Smallest file uses stronger image compression.')}</>
    case 'pdf-to-jpg': return <>{select('Image format', 'format', [['jpg', 'JPEG'], ['png', 'PNG']])}{select('Resolution', 'dpi', [[72, '72 DPI'], [108, '108 DPI'], [144, '144 DPI'], [216, '216 DPI']])}</>
    case 'jpg-to-pdf': return <>{select('Page size', 'pageSize', [['a4', 'A4'], ['letter', 'Letter'], ['fit', 'Fit to image']])}{note('Each selected image becomes one PDF page.')}</>
    case 'ocr-pdf': return <>{select('OCR language', 'language', OCR_LANGUAGES)}{select('Recognition quality', 'ocrDpi', [[150, 'Fast · 150 DPI'], [200, 'Balanced · 200 DPI'], [300, 'High · 300 DPI']])}{note('Adds an invisible searchable text layer over scanned pages in the original PDF. The page appearance stays the same. OCR runs on this device; English OCR is bundled for offline use. Other languages require a local language pack in the ocr assets directory.')}</>
    case 'pdf-to-word': return <>{select('OCR language for scanned pages', 'language', OCR_LANGUAGES)}{note('Exports editable text with approximate font styling and placement. Scanned pages are recognized with OCR; complex layouts may need cleanup in Word.')}</>
    case 'pdf-to-pptx': return note('Creates one slide per PDF page. Selectable PDF text becomes editable text boxes; page artwork and complex vector objects remain in the background image.')
    case 'word-to-pdf': return note('Converts DOCX text and paragraphs to PDF. Original page layout, images, and advanced styling may not be preserved.')
    case 'powerpoint-to-pdf': return note('Converts .pptx presentations locally. Save legacy .ppt files as .pptx in PowerPoint or LibreOffice before converting.')
    case 'flatten-pdf': return note('Flattens interactive form fields into the page appearance.')
    case 'repair-pdf': return note('Reopens and rebuilds PDFs the parser can still read. Severely damaged files may not be recoverable.')
    case 'redact-pdf': return <>{editorPage ? note(`Mark on visible pages. Current page: ${editorPage}.`) : field('Page number', 'redactPage', '1')}{note('Drag to mark, select a mark to adjust it, or remove it before applying. Only marked pages are rasterized. Document forms, outlines, attachments and metadata may be discarded.')}</>
    case 'protect-pdf': return <><label className="tool-field">New password<input className="studio-input" type="password" autoComplete="new-password" value={options.password} onChange={(event) => setOption('password', event.target.value)} /></label><label className="tool-field">Confirm password<input className="studio-input" type="password" autoComplete="new-password" value={options.confirmPassword} onChange={(event) => setOption('confirmPassword', event.target.value)} /></label>{note('Applies AES-256 PDF encryption locally. Use at least 8 characters and keep the password safe; it cannot be recovered.')}</>
    case 'unlock-pdf': return <><label className="tool-field">Current PDF password<input className="studio-input" type="password" autoComplete="current-password" value={options.password} onChange={(event) => setOption('password', event.target.value)} /></label>{note('Removes PDF encryption using the password you provide. It does not bypass or guess passwords.')}</>
    case 'edit-bookmarks': return <><label className="tool-field">Bookmarks · one per line as “page: title”<textarea className="studio-input" rows="8" value={options.bookmarksText} onChange={(event) => setOption('bookmarksText', event.target.value)} placeholder={'1: Introduction\n3: Results\n8: Appendix'} /></label>{note('Creates a new top-level outline and replaces any existing bookmarks.')}</>
    case 'fill-forms': return formFields.length ? <>{note(`${formFields.length} interactive field${formFields.length === 1 ? '' : 's'} found.`)}{formFields.map((field) => {
      if (/signature/i.test(field.type)) return <p className="option-note" key={field.name}>{field.name}: signature fields are not supported.</p>
      const value = options.fields?.[field.name] ?? field.value ?? ''
      const update = (next) => setOption('fields', { ...(options.fields || {}), [field.name]: next })
      if (field.type.includes('CheckBox')) return <label className="option-check-row" key={field.name}><input type="checkbox" checked={Boolean(value)} onChange={(event) => update(event.target.checked)} /><span>{field.name}</span></label>
      if (field.choices?.length) return <label className="tool-field" key={field.name}>{field.name}<select className="studio-input" value={value} onChange={(event) => update(event.target.value)}>{field.choices.map((choice) => <option key={choice} value={choice}>{choice}</option>)}</select></label>
      return <label className="tool-field" key={field.name}>{field.name}<input className="studio-input" value={value} onChange={(event) => update(event.target.value)} /></label>
    })}</> : note('Select a PDF with interactive form fields. This PDF has no editable AcroForm fields, or its form could not be read.')
    case 'sign-pdf': return <>{field('Typed signature', 'signature', 'Your full name')}{field('Page number', 'signaturePage', '1')}{note('Adds a visible typed signature. It is not a certificate-based digital signature.')}</>
    default: return note('Choose a file to see available options.')
  }
}

const OCR_LANGUAGES = [
  ['eng', 'English'], ['spa', 'Spanish'], ['fra', 'French'], ['deu', 'German'],
  ['ita', 'Italian'], ['por', 'Portuguese'], ['hin', 'Hindi'],
]

function RedactionPreview({ file, page, redaction, onMark }) {
  const canvas = useRef(null)
  const dragStart = useRef(null)
  const [error, setError] = useState('')
  const [previewMark, setPreviewMark] = useState(null)

  useEffect(() => {
    const target=canvas.current, job=new AbortController()
    setPreviewMark(null)
    if(!target)return
    import('../pdfEngine').then(({renderPdfPage})=>job.signal.aborted?null:renderPdfPage(file,page,target,.95,{signal:job.signal}))
      .then(result=>{if(!job.signal.aborted)setError(result?.status==='FAILED'?result.error.message:'')})
      .catch(cause=>{if(!job.signal.aborted)setError(cause.message)})
    return ()=>{job.abort();target.width=0;target.height=0}
  }, [file,page])

  const point = (event) => {
    const bounds = canvas.current.getBoundingClientRect()
    return { x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)), y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)) }
  }
  const pointerDown = (event) => { event.currentTarget.setPointerCapture(event.pointerId); dragStart.current = point(event); setPreviewMark({ x: dragStart.current.x, y: dragStart.current.y, width: 0, height: 0 }) }
  const pointerMove = (event) => {
    if (!dragStart.current || !event.currentTarget.hasPointerCapture(event.pointerId)) return
    const end = point(event)
    setPreviewMark({ x: Math.min(dragStart.current.x, end.x), y: Math.min(dragStart.current.y, end.y), width: Math.abs(end.x - dragStart.current.x), height: Math.abs(end.y - dragStart.current.y) })
  }
  const pointerUp = (event) => {
    pointerMove(event)
    const end = point(event)
    const start = dragStart.current
    const mark = start && { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y) }
    if (mark?.width > 0 && mark?.height > 0) onMark(mark)
    dragStart.current = null
    setPreviewMark(null)
  }
  const visibleMarks = [...(Array.isArray(redaction) ? redaction : redaction ? [redaction] : []), ...(previewMark ? [previewMark] : [])]
  return <div className="redaction-preview-panel"><strong>Mark redaction on page {page}</strong><div className="redaction-canvas-wrap" style={{width:560,maxWidth:'100%'}}><canvas ref={canvas} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} />{visibleMarks.map((mark, index) => { const visible = { redactX: mark.redactX ?? mark.x, redactY: mark.redactY ?? mark.y, redactWidth: mark.redactWidth ?? mark.width, redactHeight: mark.redactHeight ?? mark.height }; return visible.redactWidth > 0 && visible.redactHeight > 0 ? <div key={index} className="redaction-mask-preview" style={{ left: `${visible.redactX * 100}%`, top: `${visible.redactY * 100}%`, width: `${visible.redactWidth * 100}%`, height: `${visible.redactHeight * 100}%` }} /> : null })}</div>{error && <p className="form-error">{error}</p>}<small>Drag a rectangle over the confidential content.</small></div>
}

function PdfViewer({ selectedAnnotation,onAnnotationSelect,onAnnotationChange, redactionMarks=[],onRedactionAdd,onRedactionChange,onRedactionDelete, annotationMode,annotations=[],annotationStyle,onAnnotationAdd, file, page, pageCount, pageSizes = [], viewerState = {}, onViewerStateChange = () => {}, onPageChange, formValues = {}, onFormValueChange = () => {}, editTextMode = false, addTextMode = false, imageSelectMode = false, textStyle, onTextStyleActivate, localFonts = [], onSelectTextFont, onAddTextPlaced = () => {}, onTextObjectSelected = () => {}, imageEdits = [], selectedImage, onSelectImage = () => {}, onImageEdit = () => {}, textEdits = [], onTextEdit = () => {}, onTextDelete = () => {} }) {
  const pageContainer = useRef(null)
  const pageNodes = useRef([])
  const pendingZoomAnchor = useRef(null)
  const lastPageProp = useRef(page)
  const lastScrollTop = useRef(0)
  const onPageChangeRef = useRef(onPageChange)
  const onViewerStateChangeRef = useRef(onViewerStateChange)
  const [zoom, setZoom] = useState(() => Math.max(0.1, Math.min(2.5, Number(viewerState.zoom) || 1)))
  const [viewMode, setViewMode] = useState(() => ['continuous', 'single', 'book'].includes(viewerState.viewMode) ? viewerState.viewMode : 'continuous')
  const [fitMode, setFitMode] = useState(() => ['fit-width', 'fit-page'].includes(viewerState.fitMode) ? viewerState.fitMode : Object.prototype.hasOwnProperty.call(viewerState, 'zoom') ? '' : 'fit-page')
  const [rotation, setRotation] = useState(() => ((Number(viewerState.rotation) || 0) % 360 + 360) % 360)
  const [darkPage, setDarkPage] = useState(() => Boolean(viewerState.darkPage))
  const [sidebarTab, setSidebarTab] = useState(() => ['pages', 'outline', 'search'].includes(viewerState.sidebarTab) ? viewerState.sidebarTab : 'pages')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => Boolean(viewerState.sidebarCollapsed))
  const [searchQuery, setSearchQuery] = useState(() => viewerState.searchQuery || '')
  const [searchOptions, setSearchOptions] = useState(() => viewerState.searchOptions || { caseSensitive: false, wholeWord: false, regex: false })
  const [searchResults, setSearchResults] = useState([])
  const [searchProgress, setSearchProgress] = useState(null)
  const [activeSearchIndex, setActiveSearchIndex] = useState(0)
  const [outline, setOutline] = useState([])
  const [outlineError, setOutlineError] = useState('')
  const [history, setHistory] = useState(() => viewerState.history || { entries: [Number(page) || 1], index: 0 })
  const [isInteracting, setIsInteracting] = useState(false)
  const [pageBox, setPageBox] = useState({ width: 900, height: 700 })
  const [windowRange, setWindowRange] = useState({ start: 0, end: 5 })
  const [pageSizeCache, setPageSizeCache] = useState(() => new Map(pageSizes.filter(Boolean).map((size) => [size.pageNumber, size])))
  const [selectedTextBox, setSelectedTextBox] = useState(null)
  const [presentationMode, setPresentationMode] = useState(false)
  const pageSizeRequest = useRef(0)
  const searchRequest = useRef(0)
  const lastCompletedSearch = useRef(null)
  const scrollTimer = useRef(0)
  const interactionTimer = useRef(0)
  const navigationTimer = useRef(0)
  const pendingNavigationPage = useRef(null)
  const initialPositionRestored = useRef(false)
  const previousViewMode = useRef(viewMode)
  const previousPageTops = useRef(new Map())
  const presentationSnapshot = useRef(null)
  const pageKey = renderFileId(file)

  useEffect(() => { onPageChangeRef.current = onPageChange }, [onPageChange])
  useEffect(() => { onViewerStateChangeRef.current = onViewerStateChange }, [onViewerStateChange])
  useEffect(() => { setSearchQuery(viewerState.searchQuery || '') }, [viewerState.searchQuery])
  useEffect(() => {
    const openSearch = () => { setSidebarTab('search'); setSidebarCollapsed(false) }
    window.addEventListener('pdf-editor-open-search', openSearch)
    return () => window.removeEventListener('pdf-editor-open-search', openSearch)
  }, [])
  useEffect(() => {
    const next = new Map(pageSizes.filter(Boolean).map((size) => [size.pageNumber, size]))
    setPageSizeCache((current) => {
      let changed = false
      const merged = new Map(current)
      for (const [number, size] of next) {
        const previous = current.get(number)
        if (!previous || previous.width !== size.width || previous.height !== size.height || previous.rotation !== size.rotation) {
          merged.set(number, size)
          changed = true
        }
      }
      return changed ? merged : current
    })
  }, [file, pageSizes])
  useEffect(() => {
    initialPositionRestored.current = false
    pageNodes.current = []
    setPageSizeCache(new Map(pageSizes.filter(Boolean).map((size) => [size.pageNumber, size])))
    setSelectedTextBox(null)
    setSearchResults([])
    lastCompletedSearch.current = null
    setOutline([])
    setHistory({ entries: [Number(page) || 1], index: 0 })
    lastPageProp.current = Number(page) || 1
  }, [file])

  useEffect(() => {
    if (!selectedTextBox) return undefined
    const handleKeyDown = (event) => {
      if (event.key !== 'Delete' && event.key !== 'Backspace') return
      const target = event.target
      if (target instanceof HTMLElement && target.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]')) return
      const selected = textEdits.find((edit) => edit.key === selectedTextBox.key && edit.page === selectedTextBox.page && edit.isNew)
      if (!selected) return
      event.preventDefault()
      onTextDelete(selected)
      setSelectedTextBox(null)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedTextBox, textEdits, onTextDelete])

  const defaultSize = pageSizeCache.get(1) || pageSizes[0] || DEFAULT_PDF_PAGE_SIZE
  const rotated = rotation % 180 !== 0
  const scaleFactor = zoom * (96 / 72)
  const pages = useMemo(() => Array.from({ length: Math.max(0, pageCount) }, (_, index) => {
    const pageNumber = index + 1
    const size = pageSizeCache.get(pageNumber) || defaultSize
    const width = (rotated ? size.height : size.width) * scaleFactor
    const height = (rotated ? size.width : size.height) * scaleFactor
    return { pageNumber, size: rotated ? { ...size, width: size.height, height: size.width } : size, width, height }
  }), [pageCount, pageSizeCache, defaultSize, rotated, scaleFactor])
  const searchHighlights = useMemo(() => {
    const byPage = new Map()
    searchResults.forEach((result, resultIndex) => {
      const list = byPage.get(result.page) || []
      result.rects.forEach((rect, rectIndex) => list.push({ ...rect, id: `${result.page}-${result.start}-${rectIndex}`, active: resultIndex === activeSearchIndex }))
      byPage.set(result.page, list)
    })
    return byPage
  }, [searchResults, activeSearchIndex])
  const entries = useMemo(() => {
    const groups = viewMode === 'single'
      ? (pages[page - 1] ? [[pages[page - 1]]] : [])
      : viewMode === 'book'
        ? [pages.slice(0, 1), ...Array.from({ length: Math.ceil(Math.max(0, pages.length - 1) / 2) }, (_, index) => pages.slice(1 + index * 2, 3 + index * 2))].filter((group) => group.length)
        : pages.map((item) => [item])
    let top = 28
    return groups.map((group, index) => {
      const width = group.reduce((sum, item) => sum + item.width, 0) + Math.max(0, group.length - 1) * 16
      const height = Math.max(...group.map((item) => item.height))
      const entry = { index, pages: group, top, width, height, page: group[0].pageNumber }
      top += height + 18
      return entry
    })
  }, [pages, viewMode, page])
  const totalHeight = entries.length ? entries[entries.length - 1].top + entries[entries.length - 1].height + 32 : 0
  const maxWidth = Math.max(pageBox.width, ...entries.map((entry) => entry.width), 0)
  const startEntry = windowRange.start
  const endEntry = Math.min(entries.length, windowRange.end)
  const mountedEntries = entries.slice(startEntry, endEntry)

  useEffect(() => {
    const container = pageContainer.current
    if (!container) return undefined
    const resize = () => {
      const style = getComputedStyle(container)
      const horizontalPadding = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0)
      const verticalPadding = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0)
      const next = { width: Math.max(0, container.clientWidth - horizontalPadding), height: Math.max(0, container.clientHeight - verticalPadding) }
      setPageBox((current) => current.width === next.width && current.height === next.height ? current : next)
    }
    resize()
    const observer = 'ResizeObserver' in window ? new ResizeObserver(resize) : null
    observer?.observe(container)
    if (!observer) window.addEventListener('resize', resize)
    return () => { observer?.disconnect(); if (!observer) window.removeEventListener('resize', resize) }
  }, [])

  const updateVirtualRange = () => {
    const container = pageContainer.current
    if (!container || !entries.length) { setWindowRange({ start: 0, end: Math.min(5, entries.length) }); return }
    const buffer = Math.max(700, container.clientHeight * 1.35)
    const from = Math.max(0, container.scrollTop - buffer)
    const to = container.scrollTop + container.clientHeight + buffer
    let start = 0
    while (start < entries.length - 1 && entries[start].top + entries[start].height < from) start += 1
    let end = start
    while (end < entries.length && entries[end].top < to) end += 1
    setWindowRange((current) => current.start === start && current.end === end ? current : { start, end })
  }

  useEffect(() => {
    const container = pageContainer.current
    if (!container) return undefined
    updateVirtualRange()
    let frame = 0
    const handleScroll = () => {
      lastScrollTop.current = container.scrollTop
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        updateVirtualRange()
        const targetY = container.scrollTop + Math.min(container.clientHeight * 0.36, 260)
        const currentEntry = entries.find((entry) => entry.top + entry.height >= targetY) || entries[entries.length - 1]
        const visiblePage = currentEntry?.page
        if (!pendingNavigationPage.current && visiblePage && visiblePage !== lastPageProp.current) {
          lastPageProp.current = visiblePage
          onPageChangeRef.current?.(visiblePage)
          setHistory((old) => {
            if (old.entries[old.index] === visiblePage) return old
            const entries = [...old.entries.slice(0, old.index + 1), visiblePage]
            return { entries: entries.slice(-100), index: Math.min(entries.length, 100) - 1 }
          })
        }
      })
      setIsInteracting(true)
      window.clearTimeout(scrollTimer.current)
      scrollTimer.current = window.setTimeout(() => setIsInteracting(false), 100)
      window.clearTimeout(interactionTimer.current)
      interactionTimer.current = window.setTimeout(() => {
        onViewerStateChangeRef.current?.({ page: lastPageProp.current, scrollTop: container.scrollTop, zoom, viewMode, fitMode, rotation, darkPage, sidebarTab, sidebarCollapsed, searchQuery, searchOptions, history })
      }, 240)
    }
    const finishNavigation = () => {
      if (!pendingNavigationPage.current) return
      window.clearTimeout(navigationTimer.current)
      lastPageProp.current = pendingNavigationPage.current
      pendingNavigationPage.current = null
    }
    container.addEventListener('scroll', handleScroll, { passive: true })
    container.addEventListener('scrollend', finishNavigation)
    return () => { container.removeEventListener('scroll', handleScroll); container.removeEventListener('scrollend', finishNavigation); cancelAnimationFrame(frame); window.clearTimeout(scrollTimer.current); window.clearTimeout(interactionTimer.current); window.clearTimeout(navigationTimer.current) }
  }, [entries, zoom, viewMode, fitMode, rotation, darkPage, sidebarTab, sidebarCollapsed, searchQuery, searchOptions, history])

  useEffect(() => {
    if (!entries.length) return
    if (!initialPositionRestored.current) {
      const container = pageContainer.current
      if (!container) return
      initialPositionRestored.current = true
      const restoredTop = Number(viewerState.scrollTop)
      if (Number.isFinite(restoredTop) && restoredTop > 0 && viewMode === (viewerState.viewMode || 'continuous')) container.scrollTop = restoredTop
      else if (viewMode !== 'single') container.scrollTop = Math.max(0, (entries.find((entry) => entry.pages.some((item) => item.pageNumber === page))?.top || 28) - 16)
      updateVirtualRange()
      return
    }
    if (page === lastPageProp.current) return
    lastPageProp.current = page
    if (viewMode === 'single') { pageContainer.current?.scrollTo({ top: 0, behavior: 'auto' }); updateVirtualRange(); return }
    const targetEntry = entries.find((entry) => entry.pages.some((item) => item.pageNumber === page))
    if (targetEntry) pageContainer.current?.scrollTo({ top: Math.max(0, targetEntry.top - 12), behavior: 'auto' })
    updateVirtualRange()
  }, [page, entries, viewMode, viewerState.scrollTop, viewerState.viewMode])

  useEffect(() => {
    if (previousViewMode.current === viewMode) return
    previousViewMode.current = viewMode
    const container = pageContainer.current
    if (!container) return
    const targetEntry = entries.find((entry) => entry.pages.some((item) => item.pageNumber === page))
    lastPageProp.current = page
    pendingNavigationPage.current = page
    window.clearTimeout(navigationTimer.current)
    if (viewMode === 'single') container.scrollTop = 0
    else if (targetEntry) container.scrollTo({ top: Math.max(0, targetEntry.top - 12), behavior: 'auto' })
    navigationTimer.current = window.setTimeout(() => {
      if (pendingNavigationPage.current === page) pendingNavigationPage.current = null
    }, 500)
    updateVirtualRange()
  }, [viewMode, entries, page])

  useEffect(() => {
    const timer = window.setTimeout(() => onViewerStateChangeRef.current?.({ page, scrollTop: pageContainer.current?.scrollTop || 0, zoom, viewMode, fitMode, rotation, darkPage, sidebarTab, sidebarCollapsed, searchQuery, searchOptions, history }), 180)
    return () => window.clearTimeout(timer)
  }, [page, zoom, viewMode, fitMode, rotation, darkPage, sidebarTab, sidebarCollapsed, searchQuery, searchOptions, history])

  useEffect(() => {
    const requestId = ++pageSizeRequest.current
    let active = true
    if (!entries.length) return () => { active = false }
    const requested = new Set()
    for (let index = Math.max(0, startEntry - 2); index < Math.min(entries.length, endEntry + 2); index += 1) {
      for (const item of entries[index].pages) if (!pageSizeCache.has(item.pageNumber)) requested.add(item.pageNumber)
    }
    if (!requested.size) return () => { active = false }
    import('../pdfEngine').then(async ({ inspectPdfPageSize }) => {
      for (const pageNumber of requested) {
        if (!active || requestId !== pageSizeRequest.current) return
        try {
          const size = await inspectPdfPageSize(file, pageNumber)
          if (!active || requestId !== pageSizeRequest.current) return
          setPageSizeCache((current) => current.has(pageNumber) ? current : new Map(current).set(pageNumber, size))
        } catch { /* The page render reports a useful error if geometry could not be read. */ }
      }
    })
    return () => { active = false }
  }, [file, entries, startEntry, endEntry, pageSizeCache])

  useEffect(() => {
    const container = pageContainer.current
    const currentEntry = entries.find((entry) => entry.pages.some((item) => item.pageNumber === page))
    if (!fitMode || !container || !currentEntry?.width || !currentEntry?.height) return
    const style = getComputedStyle(container)
    const horizontalPadding = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0)
    const verticalPadding = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0)
    const availableWidth = Math.max(120, container.clientWidth - horizontalPadding - 16)
    const availableHeight = Math.max(120, container.clientHeight - verticalPadding - 16)
    const widthAt100 = currentEntry.width / zoom
    const heightAt100 = currentEntry.height / zoom
    const fitZoom = fitMode === 'fit-width' ? availableWidth / widthAt100 : Math.min(availableWidth / widthAt100, availableHeight / heightAt100)
    const fitted = Math.max(0.1, Math.min(2.5, fitZoom))
    setZoom((current) => Math.abs(current - fitted) < 0.002 ? current : fitted)
  }, [fitMode, pageBox.width, pageBox.height, entries, page, zoom])

  useEffect(() => {
    if (sidebarTab !== 'outline' || !file || outline.length) return
    let active = true
    import('../pdfEngine').then(({ getPdfOutline }) => getPdfOutline(file)).then((items) => { if (active) { setOutline(items); setOutlineError(items.length ? '' : 'This PDF has no bookmarks.') } }).catch((cause) => { if (active) setOutlineError(cause.message || 'Bookmarks could not be loaded.') })
    return () => { active = false }
  }, [sidebarTab, file, outline.length])

  useEffect(() => {
    const request = ++searchRequest.current
    if (!searchQuery.trim()) { setSearchResults([]); setSearchProgress(null); return undefined }
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setSearchProgress({ page: 0, total: pageCount })
      const previous = lastCompletedSearch.current
      const normalizedQuery = searchOptions.caseSensitive ? searchQuery : searchQuery.toLocaleLowerCase()
      const previousQuery = previous && (searchOptions.caseSensitive ? previous.query : previous.query.toLocaleLowerCase())
      const canNarrow = Boolean(previous
        && !searchOptions.regex && !searchOptions.wholeWord
        && !previous.options.regex && !previous.options.wholeWord
        && previous.options.caseSensitive === searchOptions.caseSensitive
        && normalizedQuery.length > previousQuery.length
        && normalizedQuery.startsWith(previousQuery))
      const candidatePages = canNarrow ? [...new Set(previous.results.map((result) => result.page))] : undefined
      import('../pdfEngine').then(({ searchPdfDocument }) => searchPdfDocument(file, searchQuery, {
        ...searchOptions,
        ...(candidatePages ? { candidatePages } : {}),
        signal: controller.signal,
        onProgress: (progress) => { if (request === searchRequest.current) setSearchProgress(progress) },
      })).then(({ results }) => { if (request === searchRequest.current) { setSearchResults(results); setActiveSearchIndex(0); setSearchProgress(null); lastCompletedSearch.current = { query: searchQuery, options: { ...searchOptions }, results } } })
        .catch((cause) => { if (request === searchRequest.current && cause.name !== 'AbortError') { setSearchResults([]); setSearchProgress({ error: cause.message }) } })
    }, 180)
    return () => { window.clearTimeout(timer); controller.abort() }
  }, [file, searchQuery, searchOptions, pageCount])

  useEffect(() => {
    const result = searchResults[activeSearchIndex]
    if (result && page !== result.page) onPageChangeRef.current?.(result.page)
  }, [searchResults, activeSearchIndex])

  useLayoutEffect(() => {
    const container = pageContainer.current
    if (container && pendingNavigationPage.current && !pendingZoomAnchor.current) {
      const target=entries.find(entry=>entry.pages.some(item=>item.pageNumber===pendingNavigationPage.current));
      if(target){container.scrollTop=Math.max(0,target.top-12);updateVirtualRange()}
    } else if (container && previousPageTops.current.size && !pendingZoomAnchor.current) {
      const currentPage = lastPageProp.current
      const before = previousPageTops.current.get(currentPage)
      const after = entries.find((entry) => entry.pages.some((item) => item.pageNumber === currentPage))?.top
      if (Number.isFinite(before) && Number.isFinite(after) && Math.abs(after - before) > 0.5) container.scrollTop += after - before
    }
    previousPageTops.current = new Map(entries.flatMap((entry) => entry.pages.map((item) => [item.pageNumber, entry.top])))
    const anchor = pendingZoomAnchor.current
    if (!anchor) return
    pendingZoomAnchor.current = null
    const zoomContainer = pageContainer.current
    if (!zoomContainer || !anchor.pageElement?.isConnected) return
    const bounds = anchor.pageElement.getBoundingClientRect()
    const previousScrollBehavior = zoomContainer.style.scrollBehavior
    zoomContainer.style.scrollBehavior = 'auto'
    zoomContainer.scrollLeft += bounds.left + anchor.x * bounds.width - anchor.clientX
    zoomContainer.scrollTop += bounds.top + anchor.y * bounds.height - anchor.clientY
    zoomContainer.style.scrollBehavior = previousScrollBehavior
    updateVirtualRange()
  }, [zoom, entries])

  const updateInteraction = () => {
    setIsInteracting(true)
    window.clearTimeout(scrollTimer.current)
    scrollTimer.current = window.setTimeout(() => setIsInteracting(false), 100)
  }
  const setZoomAround = (nextZoom, clientX, clientY) => {
    const next = Math.max(0.1, Math.min(2.5, Number(nextZoom) || 1))
    if (Math.abs(next - zoom) < 0.001) return
    const rootBounds = pageContainer.current?.getBoundingClientRect()
    const anchorX = clientX ?? (rootBounds ? rootBounds.left + rootBounds.width / 2 : pageBox.width / 2)
    const anchorY = clientY ?? (rootBounds ? rootBounds.top + rootBounds.height / 2 : pageBox.height / 2)
    const target = document.elementFromPoint(anchorX, anchorY)?.closest('.acrobat-document-page')
    const bounds = target?.getBoundingClientRect()
    if (bounds?.width && bounds?.height) pendingZoomAnchor.current = { pageElement: target, x: (anchorX - bounds.left) / bounds.width, y: (anchorY - bounds.top) / bounds.height, clientX: anchorX, clientY: anchorY }
    setFitMode('')
    setZoom(next)
    updateInteraction()
  }
  const changePage = (next, addHistory = true) => {
    const target = Math.max(1, Math.min(pageCount || 1, Math.floor(Number(next) || 1)))
    lastPageProp.current = target
    onPageChangeRef.current?.(target)
    if (addHistory) setHistory((old) => {
      const entries = [...old.entries.slice(0, old.index + 1), target].slice(-100)
      return { entries, index: entries.length - 1 }
    })
    if (viewMode !== 'single') {
      const entry = entries.find((item) => item.pages.some((candidate) => candidate.pageNumber === target))
      if (entry) {
        pendingNavigationPage.current = target
        pageContainer.current?.scrollTo({ top: Math.max(0, entry.top - 12), behavior: 'auto' })
        updateVirtualRange()
        window.clearTimeout(navigationTimer.current)
        navigationTimer.current = window.setTimeout(() => {
          lastPageProp.current = target
          pendingNavigationPage.current = null
        }, 1100)
      }
    } else { pendingNavigationPage.current = null; updateVirtualRange() }
  }
  const goHistory = (delta) => {
    const index = Math.max(0, Math.min(history.entries.length - 1, history.index + delta))
    if (index === history.index) return
    const target = history.entries[index]
    setHistory((old) => ({ ...old, index }))
    changePage(target, false)
  }
  const onWheel = (event) => {
    if (!(event.ctrlKey || event.metaKey)) return
    event.preventDefault()
    setZoomAround(zoom * Math.exp(-event.deltaY * 0.003), event.clientX, event.clientY)
  }
  const goFit = (mode) => { setFitMode(mode); updateInteraction() }
  useEffect(() => {
    const runCustomEditorShortcut = (event) => {
      const action = event.detail?.action
      if (!action) return
      if (action === 'editor-page-next') changePage(page + 1)
      else if (action === 'editor-page-previous') changePage(page - 1)
      else if (action === 'editor-page-first') changePage(1)
      else if (action === 'editor-page-last') changePage(pageCount)
      else if (action === 'editor-zoom-in') setZoomAround(zoom * 1.2)
      else if (action === 'editor-zoom-out') setZoomAround(zoom / 1.2)
      else if (action === 'editor-zoom-reset') { setFitMode(''); setZoomAround(1) }
    }
    window.addEventListener('pdfking:editor-shortcut', runCustomEditorShortcut)
    return () => window.removeEventListener('pdfking:editor-shortcut', runCustomEditorShortcut)
  }, [page, pageCount, zoom, entries, viewMode])
  const toggleFullscreen = async (presentation = false) => {
    if (presentation) {
      setPresentationMode((current) => {
        const next = !current
        if (next) {
          presentationSnapshot.current = { viewMode, fitMode, zoom }
          setViewMode('single')
          setFitMode('fit-page')
        } else if (presentationSnapshot.current) {
          setViewMode(presentationSnapshot.current.viewMode)
          setFitMode(presentationSnapshot.current.fitMode)
          setZoom(presentationSnapshot.current.zoom)
          presentationSnapshot.current = null
        }
        return next
      })
    }
    const element = document.querySelector('.pdf-editor-workspace')
    if (document.fullscreenElement) { await document.exitFullscreen?.(); if (presentation) setPresentationMode(false) }
    else await element?.requestFullscreen?.().catch(() => {})
  }
  useEffect(() => {
    const onFullscreen = () => {
      if (document.fullscreenElement || !presentationMode) return
      setPresentationMode(false)
      if (presentationSnapshot.current) {
        setViewMode(presentationSnapshot.current.viewMode)
        setFitMode(presentationSnapshot.current.fitMode)
        setZoom(presentationSnapshot.current.zoom)
        presentationSnapshot.current = null
      }
    }
    document.addEventListener('fullscreenchange', onFullscreen)
    return () => document.removeEventListener('fullscreenchange', onFullscreen)
  }, [presentationMode])

  useEffect(() => {
    const handleKeys = (event) => {
      const target = event.target
      if (target instanceof HTMLElement && target.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]')) {
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') { event.preventDefault(); document.querySelector('.pdf-editor-menu-search input')?.focus() }
        return
      }
      if (event.isComposing || !(target instanceof HTMLElement && target.closest('.pdf-editor-workspace'))) return
      const modifier = event.metaKey || event.ctrlKey
      if (modifier && (event.key === '+' || event.key === '=' || event.key === 'Add')) { event.preventDefault(); setZoomAround(zoom * 1.2) }
      else if (modifier && (event.key === '-' || event.key === 'Subtract')) { event.preventDefault(); setZoomAround(zoom / 1.2) }
      else if (modifier && event.key === '0') { event.preventDefault(); setFitMode(''); setZoom(1) }
      else if (modifier && event.key.toLowerCase() === 'f') { event.preventDefault(); document.querySelector('.pdf-editor-menu-search input')?.focus() }
      else if (event.key === 'PageDown' || (presentationMode && event.key === 'ArrowRight')) { event.preventDefault(); changePage(page + 1) }
      else if (event.key === 'PageUp' || (presentationMode && event.key === 'ArrowLeft')) { event.preventDefault(); changePage(page - 1) }
      else if (event.key === 'Home') { event.preventDefault(); changePage(1) }
      else if (event.key === 'End') { event.preventDefault(); changePage(pageCount) }
      else if (event.key === 'Escape' && presentationMode) { event.preventDefault(); void toggleFullscreen(true) }
    }
    window.addEventListener('keydown', handleKeys)
    return () => window.removeEventListener('keydown', handleKeys)
  }, [zoom, page, pageCount, viewMode, presentationMode, history])

  const navigateSearchResult = (index) => {
    if (!searchResults.length) return
    const targetIndex = (index + searchResults.length) % searchResults.length
    setActiveSearchIndex(targetIndex)
    changePage(searchResults[targetIndex].page, false)
  }

  useEffect(() => {
    const container = pageContainer.current
    if (!container) return
    const zoomWheel = (event) => onWheel(event)
    container.addEventListener('wheel', zoomWheel, { passive: false })
    return () => container.removeEventListener('wheel', zoomWheel)
  }, [zoom, pageBox])

  const ariaMode = presentationMode ? 'presentation' : viewMode
  return <section className={`pdf-viewer ${darkPage ? 'has-dark-page' : ''} ${presentationMode ? 'is-presentation' : ''}`} aria-label="PDF viewer">
    <div className={`pdf-viewer-body ${sidebarCollapsed ? 'sidebar-is-collapsed' : ''} ${presentationMode ? 'presentation-body' : ''}`}>
      {!presentationMode && <aside className={`pdf-viewer-sidebar ${sidebarCollapsed ? 'is-collapsed' : ''}`} aria-label="PDF navigation sidebar">
        <div className="pdf-viewer-sidebar-tabs">
          {['pages', 'outline'].map((tab) => <button type="button" key={tab} className={sidebarTab === tab ? 'active' : ''} onClick={() => { setSidebarTab(tab); setSidebarCollapsed(false) }} title={tab[0].toUpperCase() + tab.slice(1)}>{tab === 'pages' ? 'Pages' : 'Contents'}</button>)}
          <button type="button" className="pdf-viewer-sidebar-collapse" onClick={() => setSidebarCollapsed((value) => !value)} title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}>{sidebarCollapsed ? '›' : '‹'}</button>
        </div>
        {!sidebarCollapsed && <div className="pdf-viewer-sidebar-content">
          {sidebarTab === 'pages' && <PageThumbnailList file={file} pageCount={pageCount} currentPage={page} onSelectPage={changePage} />}
          {sidebarTab === 'outline' && (outline.length ? <div className="pdf-viewer-outline">{outline.map((item, index) => <button type="button" key={`${item.title}-${index}`} style={{ paddingInlineStart: `${10 + item.depth * 12}px` }} disabled={!item.page} onClick={() => item.page && changePage(item.page)}>{item.title}<small>{item.page ? `Page ${item.page}` : ''}</small></button>)}</div> : <div className="pdf-viewer-sidebar-empty">{outlineError || 'Loading contents…'}</div>)}
          {sidebarTab === 'search' && <div className="pdf-viewer-search-panel">
            <div className="pdf-viewer-search-options">
              {[["caseSensitive", "Match case"], ["wholeWord", "Whole word"], ["regex", "Regex"]].map(([key, label]) => <label key={key} title={label}><input type="checkbox" checked={Boolean(searchOptions[key])} onChange={(event) => setSearchOptions((current) => ({ ...current, [key]: event.target.checked }))} /><span className="pdf-search-option-check" aria-hidden="true"><Icon name="check" size={13} /></span><span>{label}</span></label>)}
            </div>
            <div className={`pdf-viewer-search-summary ${!searchQuery && !searchProgress && !searchProgress?.error && !searchResults.length ? 'is-empty' : ''}`} aria-live="polite">{!searchQuery && !searchProgress && !searchProgress?.error && !searchResults.length ? <><Icon name="search" size={17} /><span>Search results will appear here</span></> : searchProgress?.error || (searchProgress ? `Searching page ${searchProgress.page} of ${searchProgress.total}…` : searchResults.length ? `${activeSearchIndex + 1} of ${searchResults.length} matches` : 'No matches')}</div>
            <div className={`pdf-viewer-search-navigation ${searchResults.length ? 'has-results' : ''}`}><button type="button" onClick={() => navigateSearchResult(activeSearchIndex - 1)} disabled={!searchResults.length}>Previous</button><button type="button" onClick={() => navigateSearchResult(activeSearchIndex + 1)} disabled={!searchResults.length}>Next</button></div>
            <div className="pdf-viewer-search-results">{searchResults.map((result, index) => <button type="button" className={activeSearchIndex === index ? 'active' : ''} key={`${result.page}-${result.start}-${index}`} onClick={() => navigateSearchResult(index)}><strong>Page {result.page}</strong><span>{result.context || result.text}</span></button>)}</div>
          </div>}
        </div>}
        {!sidebarCollapsed && sidebarTab === 'pages' && <div className="pdf-viewer-sidebar-footer"><span>Current page</span><strong>{page} <i>/</i> {pageCount}</strong></div>}
      </aside>}
      <div className={`pdf-viewer-page ${viewMode === 'single' ? 'is-single-page' : ''} ${viewMode === 'book' ? 'is-book-view' : ''} ${presentationMode ? 'is-presentation-page' : ''}`} ref={pageContainer} tabIndex={0} aria-label={`PDF pages, ${ariaMode} mode`}>
        <div className="pdf-viewer-virtual-space" style={{ height: totalHeight, minWidth: maxWidth }}>
          {mountedEntries.map((entry) => <div className="pdf-viewer-virtual-slot" data-page={entry.page} key={`${pageKey}-${entry.page}`} style={{ top: entry.top, height: entry.height, minWidth: maxWidth }}>
            <div className="pdf-viewer-virtual-spread" style={{ width: entry.width, height: entry.height }}>
              {entry.pages.map((item, sideIndex) => {
                const pageResults = searchHighlights.get(item.pageNumber) || []
                const actualVisible = entry.top + entry.height >= lastScrollTop.current && entry.top <= lastScrollTop.current + pageBox.height
                const priority = actualVisible ? (item.pageNumber === page ? 0 : 1) : item.pageNumber > page ? 2 : 3
                return <PdfViewerPage selectedAnnotation={selectedAnnotation} onAnnotationSelect={onAnnotationSelect} onAnnotationChange={onAnnotationChange} redactionMarks={redactionMarks.filter(m=>m.page===item.pageNumber)} onRedactionAdd={mark=>onRedactionAdd?.({...mark,page:item.pageNumber})} onRedactionChange={onRedactionChange} onRedactionDelete={onRedactionDelete} annotationMode={annotationMode} annotations={annotations.filter(a=>a.page===item.pageNumber)} annotationStyle={annotationStyle} onAnnotationAdd={onAnnotationAdd} key={`${pageKey}-${item.pageNumber}`} file={file} pageNumber={item.pageNumber} pageSize={item.size} displayWidth={item.width} displayHeight={item.height} pageNodes={pageNodes} root={pageContainer} zoom={zoom} rotation={rotation} renderQuality={isInteracting ? 'preview' : 'full'} renderPriority={priority} formValues={formValues} onFormValueChange={onFormValueChange} editTextMode={editTextMode} addTextMode={addTextMode} imageSelectMode={imageSelectMode} selectedImage={selectedImage} imageEdits={imageEdits.filter((edit) => edit.page === item.pageNumber)} onSelectImage={onSelectImage} onImageEdit={onImageEdit} onTextObjectSelected={onTextObjectSelected} textStyle={textStyle} onTextStyleActivate={onTextStyleActivate} localFonts={localFonts} onSelectTextFont={onSelectTextFont} onAddTextPlaced={onAddTextPlaced} textEdits={textEdits.filter((edit) => edit.page === item.pageNumber)} onTextEdit={onTextEdit} onTextDelete={onTextDelete} selectedTextBox={selectedTextBox} onSelectTextBox={setSelectedTextBox} searchRects={pageResults} onNavigateInternal={changePage} />
              })}
            </div>
          </div>)}
        </div>
      </div>
    </div>
    {!presentationMode && <nav className="pdf-viewer-floating-dock" aria-label="Page and zoom controls">
      <div className="pdf-dock-page-controls">
        <button type="button" aria-label="Previous page" title="Previous page" disabled={page <= 1} onClick={() => changePage(page - 1)}><Icon name="arrowLeft" size={16} /></button>
        <label className="pdf-dock-page-field"><input aria-label="Current page" type="number" min="1" max={pageCount} value={page} onChange={event => { const value = Number(event.target.value); if (value >= 1 && value <= pageCount) changePage(value, false) }} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur() }} /><span>/</span><b>{pageCount}</b></label>
        <button type="button" aria-label="Next page" title="Next page" disabled={page >= pageCount} onClick={() => changePage(page + 1)}><Icon name="arrow" size={16} /></button>
      </div>
      <span className="pdf-dock-divider" />
      <div className="pdf-dock-zoom-controls">
        <button type="button" aria-label="Zoom out" title="Zoom out" disabled={zoom <= .1} onClick={() => setZoomAround(zoom / 1.2)}><span aria-hidden="true">−</span></button>
        <label className="pdf-dock-zoom-track" title="Zoom level"><input aria-label="Zoom level" type="range" min="10" max="250" step="1" value={Math.round(zoom * 100)} style={{ '--zoom-progress': `${Math.max(0, Math.min(100, (zoom * 100 - 10) / 240 * 100))}%` }} onChange={event => setZoomAround(Number(event.target.value) / 100)} /></label>
        <button type="button" aria-label="Zoom in" title="Zoom in" disabled={zoom >= 2.5} onClick={() => setZoomAround(zoom * 1.2)}><Icon name="plus" size={15} /></button>
        <output className="pdf-dock-zoom-value">{Math.round(zoom * 50)}%</output>
      </div>
      <select className="pdf-dock-view-mode" aria-label="Page display mode" value={viewMode} onChange={event => { const mode = event.target.value; setViewMode(mode); if (mode === 'book') setFitMode('fit-page'); updateInteraction() }}><option value="continuous">Continuous</option><option value="single">Single page</option><option value="book">Book view</option></select>
      <button type="button" className={`pdf-dock-utility ${darkPage ? 'active' : ''}`} title="Toggle dark page appearance" aria-label="Toggle dark page appearance" aria-pressed={darkPage} onClick={() => setDarkPage(value => !value)}><Icon name={darkPage ? 'sun' : 'moon'} size={15} /></button>
      <button type="button" className="pdf-dock-utility" title="Full screen reading" aria-label="Full screen reading" onClick={() => void toggleFullscreen()}><Icon name="expand" size={15} /></button>
    </nav>}
  </section>
}

function PdfNativeFormLayer({ fields, pageNumber, pageSize, pageHeight, values = {}, onChange = () => {} }) {
  const currentValue = (field) => Object.prototype.hasOwnProperty.call(values, field.name) ? values[field.name] : field.value
  const isChecked = (value) => value === true || (value !== false && !['', 'off', 'false', '0', '/off'].includes(String(value ?? '').toLowerCase()))
  return <div className="pdf-form-layer" aria-label={`Interactive form fields on page ${pageNumber}`}>
    {fields.map((field) => {
      const value = currentValue(field)
      const fieldLabel = field.radioButton ? `${field.name}: ${field.radioValue}` : field.name
      const common = { 'aria-label': fieldLabel, required: field.required, disabled: field.readOnly, title: fieldLabel, onPointerDown: (event) => event.stopPropagation(), onClick: (event) => event.stopPropagation() }
      const style = {
        left: `${field.x * 100}%`, top: `${field.y * 100}%`, width: `${field.width * 100}%`, height: `${field.height * 100}%`,
        ...(field.fontSize > 0 && pageSize?.height ? { fontSize: `${Math.max(6, field.fontSize * pageHeight / pageSize.height)}px` } : {}),
      }
      if (field.type === 'Sig') return <button type="button" className="pdf-form-signature-placeholder" key={field.key} style={style} title={`Click to sign ${field.name}`} onPointerDown={(event) => event.stopPropagation()} onClick={() => window.dispatchEvent(new CustomEvent('pdf-editor-signature-field', { detail: { name: field.name, page: pageNumber, x: field.x, y: field.y, width: field.width, height: field.height } }))}>Click to sign</button>
      if (field.type === 'Btn' && field.radioButton) return <input {...common} key={field.key} className="pdf-form-widget is-radio" style={style} type="radio" name={`pdf-form-${pageNumber}-${field.name}`} checked={String(value) === String(field.radioValue)} onChange={() => onChange(field.name, field.radioValue || value)} />
      if (field.type === 'Btn' && field.checkBox) return <input {...common} key={field.key} className="pdf-form-widget is-checkbox" style={style} type="checkbox" checked={isChecked(value)} onChange={(event) => onChange(field.name, event.target.checked)} />
      if (field.type === 'Ch' && field.choices.length) {
        const multiple = field.multiSelect
        const selected = multiple ? (Array.isArray(value) ? value.map(String) : value == null || value === '' ? [] : [String(value)]) : String(Array.isArray(value) ? value[0] ?? '' : value ?? '')
        return <select {...common} key={field.key} className="pdf-form-widget" style={style} value={selected} multiple={multiple} size={!field.combo ? Math.max(2, Math.min(4, field.choices.length)) : undefined} onChange={(event) => onChange(field.name, multiple ? Array.from(event.target.selectedOptions, (option) => option.value) : event.target.value)}>{field.choices.map((choice) => <option key={`${field.name}-${choice.value}`} value={choice.value}>{choice.label}</option>)}</select>
      }
      if (field.type === 'Tx') {
        const onValue = (event) => onChange(field.name, event.target.value)
        const textValue = Array.isArray(value) ? value.join(', ') : String(value ?? '')
        if (field.multiline) return <textarea {...common} key={field.key} className="pdf-form-widget" style={style} value={textValue} onChange={onValue} />
        return <input {...common} key={field.key} className="pdf-form-widget" style={style} type={field.password ? 'password' : 'text'} value={textValue} onChange={onValue} />
      }
      return null
    })}
  </div>
}

async function capturePdfImageRegion(pageCanvas, region) {
  if (!pageCanvas || !pageCanvas.width || !pageCanvas.height) return null
  const sx = Math.max(0, Math.floor(region.x * pageCanvas.width))
  const sy = Math.max(0, Math.floor(region.y * pageCanvas.height))
  const sw = Math.min(pageCanvas.width - sx, Math.max(1, Math.ceil(region.width * pageCanvas.width)))
  const sh = Math.min(pageCanvas.height - sy, Math.max(1, Math.ceil(region.height * pageCanvas.height)))
  if (!sw || !sh) return null
  const copy = document.createElement('canvas')
  copy.width = sw
  copy.height = sh
  copy.getContext('2d')?.drawImage(pageCanvas, sx, sy, sw, sh, 0, 0, sw, sh)
  return new Promise((resolve) => copy.toBlob(resolve, 'image/png'))
}

function PdfImageObject({ pageNumber, pageCanvas, region, imageEdit, selected, selectedImage, onSelect, onChange }) {
  const [preview, setPreview] = useState(null)
  const [previewUrl, setPreviewUrl] = useState('')
  const gesture = useRef(null)
  useEffect(()=>setPreview(null),[imageEdit])
  const geometry = preview || imageEdit || region
  const selectedData = selectedImage?.page === pageNumber && selectedImage?.key === region.key ? selectedImage.sourceData : null
  const select = (sourceData) => onSelect({ ...region, ...imageEdit, page: pageNumber, original: imageEdit?.original || region, sourceData: sourceData || imageEdit?.sourceData || selectedData || null })

  useEffect(() => {
    const source = imageEdit?.replacementData || imageEdit?.sourceData || selectedData
    if (!source) { setPreviewUrl(''); return undefined }
    let url,active=true
    const job=new AbortController()
    prepareImageOperations([{...region,...imageEdit,type:'image',sourceData:source}],job.signal).then(([prepared])=>{
      if(!active)return
      const data=prepared.replacementData||prepared.sourceData
      url=URL.createObjectURL(data instanceof Blob?data:new Blob([data],{type:prepared.replacementType||'image/png'}));setPreviewUrl(url)
    }).catch(()=>{if(active)setPreviewUrl('')})
    return () => {active=false;job.abort();if(url)URL.revokeObjectURL(url)}
  }, [imageEdit?.replacementData,imageEdit?.replacementType,imageEdit?.sourceData,JSON.stringify(imageEdit?.crop),selectedData])

  const start = (event, mode = 'move') => {
    event.preventDefault()
    event.stopPropagation()
    const bounds = pageCanvas?.getBoundingClientRect()
    if (!bounds) return
    event.currentTarget.setPointerCapture?.(event.pointerId)
    gesture.current = { pointerId: event.pointerId, mode, startX: event.clientX, startY: event.clientY, bounds, initial: { x: geometry.x, y: geometry.y, width: geometry.width, height: geometry.height }, moved: false }
    select()
    if (!imageEdit?.sourceData && !imageEdit?.replacementData && !selectedData) void capturePdfImageRegion(pageCanvas, region).then(select)
  }

  const move = (event) => {
    const active = gesture.current
    if (!active || active.pointerId !== event.pointerId) return
    const dx = (event.clientX - active.startX) / active.bounds.width
    const dy = (event.clientY - active.startY) / active.bounds.height
    if (Math.abs(dx) + Math.abs(dy) < 0.002) return
    active.moved = true
    let next
    if (active.mode === 'resize') next = { ...active.initial, width: Math.max(0.015, Math.min(1 - active.initial.x, active.initial.width + dx)), height: Math.max(0.015, Math.min(1 - active.initial.y, imageEdit?.freeResize ? active.initial.height+dy : (active.initial.width+dx)*active.initial.height/active.initial.width)) }
    else next = { ...active.initial, x: Math.max(0, Math.min(1 - active.initial.width, active.initial.x + dx)), y: Math.max(0, Math.min(1 - active.initial.height, active.initial.y + dy)) }
    setPreview(next)
  }

  const finish = async (event) => {
    const active = gesture.current
    if (!active || active.pointerId !== event.pointerId) return
    gesture.current = null
    if (!active.moved || !preview) return
    const sourceData = imageEdit?.sourceData || imageEdit?.replacementData || selectedData || await capturePdfImageRegion(pageCanvas, region)
    const edit = { ...region, page: pageNumber, original: region, ...imageEdit, ...preview, sourceData, crop: imageEdit?.crop || { top: 0, right: 0, bottom: 0, left: 0 } }
    onChange(edit)
  }

  return <div className={`pdf-image-object ${selected ? 'selected' : ''} ${imageEdit ? 'edited' : ''}`} role="button" tabIndex={0} aria-label={`Image ${region.key.replace('image-', '')} on page ${pageNumber}`} title="Select image; drag to move" style={{ left: `${geometry.x * 100}%`, top: `${geometry.y * 100}%`, width: `${geometry.width * 100}%`, height: `${geometry.height * 100}%` }} onPointerDown={start} onPointerMove={move} onPointerUp={finish} onPointerCancel={finish} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select() } }}>
    {imageEdit?.deleted&&<span style={{position:'absolute',inset:0,background:'#fff'}}/>}
    {previewUrl&&!imageEdit?.deleted && <ImagePlacementPreview url={previewUrl} geometry={geometry} operation={{...region,...imageEdit,...geometry,original:imageEdit?.original||region}} pageCanvas={pageCanvas}/>}

    {selected && <span className="pdf-image-object-label">Image</span>}
    {selected && <button type="button" className="pdf-image-resize-handle" title="Resize image" aria-label="Resize image" onPointerDown={(event) => start(event, 'resize')} onPointerMove={move} onPointerUp={finish} onPointerCancel={finish} />}
  </div>
}

function ImagePlacementPreview({url,geometry,operation,pageCanvas}) {
  const bounds=pageCanvas?.getBoundingClientRect()||{width:816,height:1056}
  const frame={width:bounds.width,height:bounds.height}
  const box=displayRect(frame,geometry),m=imagePlacement(frame,operation)
  // SVG uses image top-left; PDF image unit space uses bottom-left.
  const matrix=[m[0],-m[1],-m[2],m[3],m[4]+m[2]-box.x,box.y+box.height-m[5]-m[3]]
  return <svg viewBox={`0 0 ${box.width} ${box.height}`} preserveAspectRatio="none" style={{position:'absolute',inset:0,width:'100%',height:'100%',pointerEvents:'none',overflow:'hidden'}}><image href={url} width="1" height="1" preserveAspectRatio="none" transform={`matrix(${matrix.join(' ')})`}/></svg>
}

const editableTextGroupCache = new WeakMap()

function getTextLayerRotation(layer) {
  const transform = window.getComputedStyle(layer).transform
  const values = transform && transform !== 'none' ? transform.match(/matrix\(([^)]+)\)/)?.[1]?.split(',').map(Number) : null
  if (!values || values.length < 4 || !values.slice(0, 4).every(Number.isFinite)) return 0
  const degrees = Math.round(Math.atan2(values[1], values[0]) * 180 / Math.PI / 90) * 90
  return (degrees + 360) % 360
}

function collectEditableTextGroups(layer, pageSize) {
  const currentSpans = layer.querySelectorAll('span')
  const firstSpan = currentSpans[0] || null
  const lastSpan = currentSpans[currentSpans.length - 1] || null
  const bounds = layer.getBoundingClientRect()
  const canvas = layer.parentElement?.querySelector('canvas')
  const cached = editableTextGroupCache.get(layer)
  if (cached && cached.count === currentSpans.length && cached.first === firstSpan && cached.last === lastSpan && cached.width === bounds.width && cached.height === bounds.height) return cached.groups
  const rotation = ((Number(firstSpan?.dataset.pdfRotation)||getTextLayerRotation(layer))%360+360)%360
  const verticalText = rotation === 90 || rotation === 270
  const usesCodeFont = (entry) => /mono|courier|consolas|menlo|monaco|inconsolata|cascadia|source code/i.test(
    `${entry.element.dataset.pdfFontFamily || ''} ${entry.style.fontFamily || ''}`,
  )
  const spans = Array.from(layer.querySelectorAll('span'))
  const entries = spans.map((element, index) => {
    const rect = element.getBoundingClientRect()
    const style = window.getComputedStyle(element)
    return { element, index, text: element.textContent || '', rect, style, centerY: verticalText ? rect.left + rect.width / 2 : rect.top + rect.height / 2 }
  }).filter((entry) => entry.text && entry.rect.width > 0 && entry.rect.height > 0)
    .sort((a, b) => a.centerY - b.centerY || (verticalText ? a.rect.top - b.rect.top : a.rect.left - b.rect.left))

  const lines = []
  for (const entry of entries) {
    let line = null
    for (let lineIndex = lines.length - 1; lineIndex >= 0; lineIndex -= 1) {
      const candidate = lines[lineIndex]
      const distance = entry.centerY - candidate.anchorY
      if (distance > Math.max(2, candidate.height * 0.32)) break
      if (Math.abs(distance) <= Math.max(2, Math.min(candidate.height, verticalText ? entry.rect.width : entry.rect.height) * 0.32)) { line = candidate; break }
    }
    if (line) {
      line.entries.push(entry)
      line.height = Math.max(line.height, verticalText ? entry.rect.width : entry.rect.height)
    } else lines.push({ anchorY: entry.centerY, centerY: entry.centerY, height: verticalText ? entry.rect.width : entry.rect.height, entries: [entry] })
  }

  const visualLines = []
  for (const line of lines) {
    line.entries.sort((a, b) => verticalText ? a.rect.top - b.rect.top : a.rect.left - b.rect.left)
    const segments = []
    let segment = []
    const flushSegment = () => {
      if (!segment.length) return
      const content = []
      for (let index = 0; index < segment.length; index += 1) {
        const entry = segment[index]
        const previous = segment[index - 1]
        const value = entry.text.replace(/\s+/g, ' ')
        if (!value) continue
        if (previous) {
          const gap = verticalText ? entry.rect.top - previous.rect.bottom : entry.rect.left - previous.rect.right
          const previousWidth = (verticalText ? previous.rect.height : previous.rect.width) / Math.max(1, Array.from(previous.text.trim()).length)
          const entryWidth = (verticalText ? entry.rect.height : entry.rect.width) / Math.max(1, Array.from(entry.text.trim()).length)
          const fontHeight = Math.min(verticalText ? previous.rect.width : previous.rect.height, verticalText ? entry.rect.width : entry.rect.height)
          const wordGapLimit = Math.max(1.5, Math.min(4.5, fontHeight * 0.28, Math.min(previousWidth, entryWidth) * 0.45))
          const textAlreadyHasSpace = /\s$/.test(previous.text) || /^\s/.test(entry.text)
          if (!textAlreadyHasSpace && gap > wordGapLimit) content.push(' ')
        }
        content.push(value)
      }
      const visibleEntries = segment.filter((entry) => entry.text.trim())
      const first = visibleEntries[0]
      if (first && content.length) {
        const text = content.join('').trim().replace(/\s+/g, ' ')
        const layerHeight = Math.max(1, layer.getBoundingClientRect().height)
        const sourcePageHeight = Number(pageSize?.height) || layerHeight
        const sourceStyle = (entry) => {
          const fontSize = Number(entry.element.dataset.pdfFontSize) || (Number.parseFloat(entry.style.fontSize) || entry.rect.height) * sourcePageHeight / layerHeight
          entry.editColors ||= samplePdfTextColors(layer.parentElement?.querySelector('canvas'), layer.parentElement, entry.rect, getVisibleEditColor(entry.style.color))
          const rawColor = entry.element.dataset.pdfColor || entry.editColors.color
          const rgbChannels = rawColor.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i)?.slice(1, 4)
          const color = rgbChannels ? `#${rgbChannels.map((channel) => Math.max(0, Math.min(255, Number(channel))).toString(16).padStart(2, '0')).join('')}` : rawColor
          return {
            fontWeight: entry.element.dataset.pdfFontWeight || entry.style.fontWeight || '400',
            fontStyle: entry.element.dataset.pdfFontStyle || entry.style.fontStyle || 'normal',
            fontFamily: entry.element.dataset.pdfFontFamily || entry.style.fontFamily || 'sans-serif',
            previewFontFamily: entry.element.dataset.pdfPreviewFontFamily || entry.style.fontFamily,
            sourceFontName: entry.element.dataset.pdfFontSourceName || '',
            fontSize,
            color,
          }
        }
        const baseStyle = sourceStyle(first)
        const styleRanges = []
        const layoutRuns = []
        let searchFrom = 0
        for (const entry of visibleEntries) {
          const value = entry.text.replace(/\s+/g, ' ').trim()
          if (!value) continue
          const start = text.indexOf(value, searchFrom)
          if (start < 0) continue
          const end = start + value.length
          searchFrom = end
          const currentStyle = sourceStyle(entry)
          const layerBounds = layer.getBoundingClientRect()
          const baseline = Number(entry.element.dataset.pdfBaselineY)
          layoutRuns.push({ start, end, x: (entry.rect.left - layerBounds.left) / layerBounds.width, baseline: Number.isFinite(baseline) ? baseline / layerBounds.height : null, top: (entry.rect.top - layerBounds.top) / layerBounds.height, width: entry.rect.width / layerBounds.width, height: entry.rect.height / layerBounds.height, backgroundColor: entry.editColors.backgroundColor || '#ffffff', style: currentStyle })
          const sourceColors = JSON.parse(entry.element.dataset.pdfColorRanges || '[]')
          if (sourceColors.length) {
            const rawText = entry.element.textContent || entry.text
            for (const range of sourceColors) {
              const colorStart = Math.min(value.length, rawText.slice(0, range.start).replace(/\s+/g, ' ').trimStart().length)
              const colorEnd = Math.min(value.length, rawText.slice(0, range.end).replace(/\s+/g, ' ').trimStart().length)
              if (colorEnd > colorStart) styleRanges.push({ ...currentStyle, color: range.color, start: start + colorStart, end: start + colorEnd })
            }
            continue
          }
          // PDF.js can combine adjacent words with different fill colors into one
          // text item. Sample each word's own bounds so colored runs survive edits.
          const rawText = entry.element.textContent || entry.text
          const wordPattern = /\S+/g
          let word
          while ((word = wordPattern.exec(rawText))) {
            const prefixLength = rawText.slice(0, word.index).replace(/\s+/g, ' ').trimStart().length
            const wordStart = Math.min(end, start + prefixLength)
            const wordEnd = Math.min(end, wordStart + word[0].replace(/\s+/g, ' ').length)
            if (wordEnd <= wordStart) continue
            let wordBounds = entry.rect
            try {
              const node = entry.element.firstChild
              if (node?.nodeType === Node.TEXT_NODE) {
                const range = document.createRange()
                range.setStart(node, Math.min(word.index, node.length))
                range.setEnd(node, Math.min(word.index + word[0].length, node.length))
                wordBounds = range.getBoundingClientRect()
              }
            } catch {}
            const wordColor = samplePdfTextColors(canvas, layer.parentElement, wordBounds, currentStyle.color).color
            styleRanges.push({ start: wordStart, end: wordEnd, ...currentStyle, color: wordColor })
          }
        }
        segments.push({
          entries: visibleEntries,
          text,
          styleRanges,
          layoutRuns,
          left: Math.min(...visibleEntries.map((entry) => entry.rect.left)),
          alignment: Math.min(...visibleEntries.map((entry) => verticalText ? entry.rect.top : entry.rect.left)),
          top: Math.min(...visibleEntries.map((entry) => entry.rect.top)),
          right: Math.max(...visibleEntries.map((entry) => entry.rect.right)),
          bottom: Math.max(...visibleEntries.map((entry) => entry.rect.bottom)),
          centerY: visibleEntries.reduce((sum, entry) => sum + entry.centerY, 0) / visibleEntries.length,
          height: Math.max(...visibleEntries.map((entry) => verticalText ? entry.rect.width : entry.rect.height)),
          first,
        })
      }
      segment = []
    }
    let previous = null
    for (const entry of line.entries) {
      if (previous) {
        const gap = verticalText ? entry.rect.top - previous.rect.bottom : entry.rect.left - previous.rect.right
        const previousWidth = (verticalText ? previous.rect.height : previous.rect.width) / Math.max(1, Array.from(previous.text.trim()).length)
        const entryWidth = (verticalText ? entry.rect.height : entry.rect.width) / Math.max(1, Array.from(entry.text.trim()).length)
        const fontHeight = Math.min(verticalText ? previous.rect.width : previous.rect.height, verticalText ? entry.rect.width : entry.rect.height)
        const columnGapLimit = Math.max(8, fontHeight * 0.72, Math.min(previousWidth, entryWidth) * 1.2)
        const codeStyleBoundary = usesCodeFont(entry) !== usesCodeFont(previous)
        if (codeStyleBoundary || gap > columnGapLimit) flushSegment()
      }
      segment.push(entry)
      previous = entry
    }
    flushSegment()
    visualLines.push(...segments)
  }

  visualLines.sort((a, b) => a.centerY - b.centerY || a.alignment - b.alignment)
  const paragraphs = []
  // Short all-caps labels such as "OBJECTIVE:" are standalone headings,
  // even when the following body line shares their style and alignment.
  const isStandaloneLabel = (text) => text.trim().length <= 48 && /^[A-Z][A-Z0-9 /&()'-]*:\s*$/.test(text.trim())
  // PDF.js exposes each visual line separately. Keep a new list marker in its
  // own editable block instead of joining it to the previous item as prose.
  const isListItem = (text) => /^(?:(?:\d{1,4}|[A-Za-z])[.)]|[•●▪◦‣⁃-])\s+/.test(text.trim())
  for (const line of visualLines) {
    const first = line.first
    if (isStandaloneLabel(line.text) || isListItem(line.text)) {
      paragraphs.push({ lines: [line] })
      continue
    }
    const candidates = paragraphs.map((paragraph) => {
      const previous = paragraph.lines[paragraph.lines.length - 1]
      if (isStandaloneLabel(previous.text)) return null
      const priorStyle = previous.first.style
      const sameStyle = priorStyle.fontFamily === first.style.fontFamily && priorStyle.fontWeight === first.style.fontWeight && priorStyle.fontStyle === first.style.fontStyle
      const previousFontSize = Number(previous.first.element.dataset.pdfFontSize) || Number.parseFloat(previous.first.style.fontSize) || previous.first.rect.height
      const currentFontSize = Number(first.element.dataset.pdfFontSize) || Number.parseFloat(first.style.fontSize) || first.rect.height
      // Different-sized headings and body lines can share family and weight.
      // Keep them as separate edit boxes instead of stretching one box over
      // both baselines and then deriving its style from only the first line.
      const sameFontSize = Math.abs(previousFontSize - currentFontSize) <= Math.max(0.5, Math.max(previousFontSize, currentFontSize) * 0.08)
      const centerGap = line.centerY - previous.centerY
      const maxLineStep = Math.max(previous.height, line.height) * 1.65
      const columnAlignment = Math.abs(line.alignment - previous.alignment) <= Math.max(10, line.height * 1.8)
      if (!sameStyle || !sameFontSize || !columnAlignment || centerGap < Math.max(previous.height, line.height) * 0.55 || centerGap > maxLineStep) return null
      return { paragraph, centerGap, alignment: Math.abs(line.alignment - previous.alignment) }
    }).filter(Boolean).sort((a, b) => a.alignment - b.alignment || a.centerGap - b.centerGap)
    if (candidates.length) candidates[0].paragraph.lines.push(line)
    else paragraphs.push({ lines: [line] })
  }

  const layerBounds = layer.getBoundingClientRect()
  const layerHeight = Math.max(1, layerBounds.height)
  const groups = paragraphs.map(({ lines: paragraphLines }) => {
    const firstLine = paragraphLines[0]
    const first = firstLine.first
    const entries = paragraphLines.flatMap((line) => line.entries)
    const lineSteps = paragraphLines.slice(1).map((line, index) => line.centerY - paragraphLines[index].centerY)
    const lineHeight = lineSteps.length ? lineSteps.reduce((sum, step) => sum + step, 0) / lineSteps.length : firstLine.height * (verticalText ? 1 : 1.2)
    const sourceFontSize = Number(first.element.dataset.pdfFontSize) || 0
    const pageHeight = Number(pageSize?.height) || layerHeight
    const baselineMetrics = verticalText ? { offset: 0, source: 0 } : getSourceTextBaselineOffset(first, lineHeight, layerHeight, Math.min(...paragraphLines.map((line) => line.top)) - layerBounds.top)
    const text = paragraphLines.map((line) => line.text).join('\n').trim()
    const styleRanges = []
    const sourceLayout = []
    let textOffset = 0
    paragraphLines.forEach((line, index) => {
      for (const run of line.layoutRuns || []) sourceLayout.push({ ...run, start: run.start + textOffset, end: run.end + textOffset })
      for (const range of line.styleRanges || []) styleRanges.push({ ...range, start: range.start + textOffset, end: range.end + textOffset })
      textOffset += line.text.length + (index < paragraphLines.length - 1 ? 1 : 0)
    })
    return {
      key: String(first.index),
      spans: entries.map((entry) => entry.element),
      text,
      sourceLineCount: paragraphLines.length,
      styleRanges,
      sourceLayout: rotation === 0 ? sourceLayout : undefined,
      sourceCoverRects: entries.map(entry => { const colors = entry.editColors; return { x: (entry.rect.left - layerBounds.left) / bounds.width, y: (entry.rect.top - layerBounds.top) / layerHeight, width: entry.rect.width / bounds.width, height: entry.rect.height / layerHeight, backgroundColor: colors.backgroundColor || '#ffffff' } }),
      left: Math.min(...paragraphLines.map((line) => line.left)),
      top: Math.min(...paragraphLines.map((line) => line.top)),
      right: Math.max(...paragraphLines.map((line) => line.right)),
      bottom: Math.max(...paragraphLines.map((line) => line.bottom)),
      fontFamily: first.element.dataset.pdfFontFamily || first.style.fontFamily,
      previewFontFamily: first.element.dataset.pdfPreviewFontFamily || first.style.fontFamily,
      sourceFontName: first.element.dataset.pdfFontSourceName || '',
      fontWeight: first.element.dataset.pdfFontWeight || first.style.fontWeight,
      fontStyle: first.element.dataset.pdfFontStyle || first.style.fontStyle,
      color: getVisibleEditColor(first.style.color),
      rotation,
      fontSize: sourceFontSize || (Number.parseFloat(first.style.fontSize) || first.rect.height) * pageHeight / layerHeight,
      fontScale: sourceFontSize ? sourceFontSize / pageHeight : (Number.parseFloat(first.style.fontSize) || first.rect.height) / layerHeight,
      previewFontScale: sourceFontSize ? sourceFontSize / pageHeight : (Number.parseFloat(first.style.fontSize) || first.rect.height) / layerHeight,
      displayFontSize: sourceFontSize ? sourceFontSize * layerHeight / pageHeight : Number.parseFloat(first.style.fontSize) || first.rect.height,
      letterSpacing: getEditTextCharacterSpacing(
        paragraphLines.map((line) => ({ text: line.text, width: verticalText ? line.bottom - line.top : line.right - line.left })),
        first.element.dataset.pdfPreviewFontFamily || first.element.dataset.pdfFontFamily || first.style.fontFamily,
        first.element.dataset.pdfFontWeight || first.style.fontWeight,
        first.element.dataset.pdfFontStyle || first.style.fontStyle,
        sourceFontSize ? sourceFontSize * layerHeight / pageHeight : Number.parseFloat(first.style.fontSize) || first.rect.height,
      ),
      letterSpacingPt: (getEditTextCharacterSpacing(
        paragraphLines.map((line) => ({ text: line.text, width: verticalText ? line.bottom - line.top : line.right - line.left })),
        first.element.dataset.pdfPreviewFontFamily || first.element.dataset.pdfFontFamily || first.style.fontFamily,
        first.element.dataset.pdfFontWeight || first.style.fontWeight,
        first.element.dataset.pdfFontStyle || first.style.fontStyle,
        sourceFontSize ? sourceFontSize * layerHeight / pageHeight : Number.parseFloat(first.style.fontSize) || first.rect.height,
      )) * pageHeight / layerHeight,
      horizontalScale: getEditTextWidthScale(
        paragraphLines.map((line) => ({ text: line.text, width: verticalText ? line.bottom - line.top : line.right - line.left })),
        first.element.dataset.pdfPreviewFontFamily || first.element.dataset.pdfFontFamily || first.style.fontFamily,
        first.element.dataset.pdfFontWeight || first.style.fontWeight,
        first.element.dataset.pdfFontStyle || first.style.fontStyle,
        sourceFontSize ? sourceFontSize * layerHeight / pageHeight : Number.parseFloat(first.style.fontSize) || first.rect.height,
        getEditTextCharacterSpacing(
          paragraphLines.map((line) => ({ text: line.text, width: verticalText ? line.bottom - line.top : line.right - line.left })),
          first.element.dataset.pdfPreviewFontFamily || first.element.dataset.pdfFontFamily || first.style.fontFamily,
          first.element.dataset.pdfFontWeight || first.style.fontWeight,
          first.element.dataset.pdfFontStyle || first.style.fontStyle,
          sourceFontSize ? sourceFontSize * layerHeight / pageHeight : Number.parseFloat(first.style.fontSize) || first.rect.height,
        )
      ),
      // Position the browser edit line against this PDF run's actual baseline.
      baselineOffset: baselineMetrics.offset,
      sourceBaselineOffset: baselineMetrics.source,
      lineHeightScale: lineHeight / layerHeight,
    }
  })
  editableTextGroupCache.set(layer, { count: currentSpans.length, first: firstSpan, last: lastSpan, width: bounds.width, height: bounds.height, groups })
  return groups
}

function getEditTextCharacterSpacing(lines, fontFamily, fontWeight, fontStyle, fontSize) {
  const measureCanvas = document.createElement('canvas')
  const context = measureCanvas.getContext('2d')
  if (!context || !fontSize || !lines.length) return 0
  context.font = `${fontStyle || 'normal'} ${fontWeight || '400'} ${fontSize}px ${fontFamily || 'sans-serif'}`
  const validLines = lines.filter((l) => l.text && l.text.length > 1 && l.width > 0)
  if (!validLines.length) return 0
  const maxWidth = Math.max(...validLines.map((l) => l.width))
  const fullLines = validLines.filter((l) => l.width >= maxWidth * 0.8)
  const targetLines = fullLines.length ? fullLines : validLines
  let totalDiff = 0, totalGaps = 0, minSpacingNeeded = Infinity
  for (const line of targetLines) {
    const naturalWidth = context.measureText(line.text).width
    const gaps = line.text.length - 1
    const diff = line.width - naturalWidth
    totalDiff += diff
    totalGaps += gaps
    const neededToFit = (maxWidth - naturalWidth) / gaps
    if (neededToFit < minSpacingNeeded) minSpacingNeeded = neededToFit
  }
  const avgSpacing = totalGaps > 0 ? totalDiff / totalGaps : 0
  const spacing = Number.isFinite(minSpacingNeeded) ? Math.min(avgSpacing, minSpacingNeeded) : avgSpacing
  return Math.max(-0.25 * fontSize, Math.min(0.3 * fontSize, spacing))
}

function getEditTextWidthScale(lines, fontFamily, fontWeight, fontStyle, fontSize, letterSpacing = 0) {
  const measureCanvas = document.createElement('canvas')
  const context = measureCanvas.getContext('2d')
  if (!context || !fontSize || !lines.length) return 1
  context.font = `${fontStyle || 'normal'} ${fontWeight || '400'} ${fontSize}px ${fontFamily || 'sans-serif'}`
  const measurements = lines.map(({ text, width }) => {
    let measured = context.measureText(text).width
    if (letterSpacing && text.length > 1) {
      measured += (text.length - 1) * letterSpacing
    }
    return { actual: width, measured }
  })
  const measuredWidth = measurements.reduce((sum, line) => sum + line.measured, 0)
  const targetWidth = measurements.reduce((sum, line) => sum + line.actual, 0)
  const scale = measuredWidth > 0 ? targetWidth / measuredWidth : 1
  if (Math.abs(scale - 1) < 0.025) return 1
  return Math.max(0.6, Math.min(1.25, scale))
}

function getSourceTextBaselineOffset(entry, lineHeight, layerHeight, groupTop) {
  if (getTextLayerRotation(entry.element.parentElement) === 90 || getTextLayerRotation(entry.element.parentElement) === 270) return { offset: 0, source: 0 }
  const sourceBaselineY = Number(entry.element.dataset.pdfBaselineY)
  if (!Number.isFinite(sourceBaselineY)) return { offset: 0, source: null }
  const fontSize = Number.parseFloat(entry.style.fontSize) || entry.rect.height
  const context = document.createElement('canvas').getContext('2d')
  if (!context) return { offset: 0, source: null }
  context.font = `${entry.element.dataset.pdfFontStyle || entry.style.fontStyle} ${entry.element.dataset.pdfFontWeight || entry.style.fontWeight} ${fontSize}px ${entry.element.dataset.pdfPreviewFontFamily || entry.element.dataset.pdfFontFamily || entry.style.fontFamily}`
  const metrics = context.measureText(entry.text)
  const ascent = metrics.fontBoundingBoxAscent ?? fontSize * 0.8
  const descent = metrics.fontBoundingBoxDescent ?? fontSize * 0.2
  const browserBaseline = (lineHeight - ascent - descent) / 2 + ascent
  const offset = (sourceBaselineY - groupTop - browserBaseline) / layerHeight
  return {
    offset,
    source: (sourceBaselineY - groupTop) / layerHeight,
  }
}

function getEditTextBaselineOffset(edit) {
  return Number(edit?.baselineOffset) || 0
}

function getTextEditDisplayLayout(edit, pageWidth, pageHeight) {
  const x = Number(edit?.x) || 0
  const y = Number(edit?.y) || 0
  const visualWidth = Math.max(Number(edit?.width) || 0, edit?.isNew ? 0.025 : 0.005)
  const visualHeight = Math.max(Number(edit?.height) || 0, edit?.isNew ? 0.04 : 0.005)
  const rotation = ((Math.round(Number(edit?.rotation) || 0) % 360) + 360) % 360
  const scale = Number(edit?.horizontalScale) || 1
  const rotated = rotation === 90 || rotation === 270
  const width = rotated ? visualHeight * pageHeight / Math.max(1, pageWidth) : Math.min(1 - x, visualWidth)
  const height = rotated ? visualWidth * pageWidth / Math.max(1, pageHeight) : visualHeight
  const left = rotation === 90 ? x + visualWidth : x
  const top = rotation === 90 ? y : rotation === 270 ? y + visualHeight : y + (rotated ? 0 : getEditTextBaselineOffset(edit))
  return {
    left,
    top,
    width,
    height,
    rotation,
    visualLeft: x,
    visualTop: y + (rotated ? 0 : getEditTextBaselineOffset(edit)),
    visualWidth,
    visualHeight,
    transform: `${rotated ? `rotate(${rotation}deg) ` : ''}scaleX(${scale})`,
  }
}

function getVisibleEditColor(color) {
  const value = String(color || '').trim()
  if (!value || value.toLowerCase() === 'transparent') return '#111111'
  const hex = value.match(/^#([\da-f]{3}|[\da-f]{6})$/i)?.[1]
  if (hex?.length === 3) return `#${[...hex].map(channel => channel + channel).join('')}`
  if (hex) return `#${hex.toLowerCase()}`
  const match = value.match(/^rgba?\((.*)\)$/i)
  if (match) {
    const channels = match[1].split(/[\s,\/]+/).filter(Boolean)
    if (channels.length >= 4 && Number.parseFloat(channels[3]) === 0) return '#111111'
    if (channels.length >= 3) {
      const toByte = channel => Math.max(0, Math.min(255, Math.round(channel.endsWith('%') ? Number.parseFloat(channel) * 2.55 : Number.parseFloat(channel))))
      return `#${channels.slice(0, 3).map(channel => toByte(channel).toString(16).padStart(2, '0')).join('')}`
    }
  }
  return value
}

function samplePdfTextColors(canvas, wrapper, box, fallbackColor) {
  if (!canvas || !wrapper || !canvas.width || !canvas.height) return { color: fallbackColor, backgroundColor: null }
  try {
    const canvasBounds = canvas.getBoundingClientRect()
    const scaleX = canvas.width / Math.max(1, canvasBounds.width)
    const scaleY = canvas.height / Math.max(1, canvasBounds.height)
    const left = Math.max(0, Math.floor((box.left - canvasBounds.left) * scaleX))
    const top = Math.max(0, Math.floor((box.top - canvasBounds.top) * scaleY))
    const right = Math.min(canvas.width, Math.ceil((box.right - canvasBounds.left) * scaleX))
    const bottom = Math.min(canvas.height, Math.ceil((box.bottom - canvasBounds.top) * scaleY))
    if (right <= left || bottom <= top) return { color: fallbackColor, backgroundColor: null }
    const width = right - left
    const height = bottom - top
    const sampleScale = Math.min(1, 224 / Math.max(width, height))
    const sampleWidth = Math.max(1, Math.floor(width * sampleScale))
    const sampleHeight = Math.max(1, Math.floor(height * sampleScale))
    const sampleCanvas = document.createElement('canvas')
    sampleCanvas.width = sampleWidth
    sampleCanvas.height = sampleHeight
    const sampleContext = sampleCanvas.getContext('2d', { willReadFrequently: true })
    sampleContext.drawImage(canvas, left, top, width, height, 0, 0, sampleWidth, sampleHeight)
    const pixels = sampleContext.getImageData(0, 0, sampleWidth, sampleHeight).data
    const stride = 1
    const frequencies = new Map()
    for (let y = 0; y < sampleHeight; y += stride) {
      for (let x = 0; x < sampleWidth; x += stride) {
        const offset = (y * sampleWidth + x) * 4
        const key = (pixels[offset] << 16) | (pixels[offset + 1] << 8) | pixels[offset + 2]
        frequencies.set(key, (frequencies.get(key) || 0) + 1)
      }
    }
    const colors = [...frequencies.entries()].sort((a, b) => b[1] - a[1])
    if (!colors.length) return { color: fallbackColor, backgroundColor: null }
    const background = colors[0][0]
    const backgroundChannels = [(background >> 16) & 255, (background >> 8) & 255, background & 255]
    const foreground = colors.reduce((best, [value, count]) => {
      const channels = [(value >> 16) & 255, (value >> 8) & 255, value & 255]
      const distance = Math.sqrt(channels.reduce((sum, channel, index) => sum + (channel - backgroundChannels[index]) ** 2, 0))
      return distance > 72 && (!best || distance > best.distance || (distance === best.distance && count > best.count)) ? { value, count, distance } : best
    }, null)?.value
    const toHex = (value) => `#${value.toString(16).padStart(6, '0')}`
    // The sampled page color is used only to erase the source glyphs beneath
    // the replacement. The replacement text itself remains transparent.
    const backgroundColor = toHex(background)
    return { color: foreground === undefined ? fallbackColor : toHex(foreground), backgroundColor }
  } catch {
    return { color: fallbackColor, backgroundColor: null }
  }
}

function getDarkPageFill(color) {
  // Keep source-cover fills in step with the PDF canvas dark-page filter.
  try {
    const probe = document.createElement('canvas')
    probe.width = probe.height = 1
    const context = probe.getContext('2d', { willReadFrequently: true })
    context.filter = 'invert(.9) hue-rotate(180deg)'
    context.fillStyle = color || '#fff'
    context.fillRect(0, 0, 1, 1)
    const [r, g, b] = context.getImageData(0, 0, 1, 1).data
    return `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, '0')).join('')}`
  } catch { return '#1a1a1a' }
}

function renderStyledText(text, ranges, displayHeight, pageHeight, defaults) {
  const chars = text.split('')
  const groups = []
  const orderedRanges = [...(ranges || [])].sort((a, b) => a.start - b.start)
  let rangeIndex = 0
  for (let index = 0; index < chars.length; index += 1) {
    while (rangeIndex < orderedRanges.length && orderedRanges[rangeIndex].end <= index) rangeIndex += 1
    const range = orderedRanges[rangeIndex]
    const overrides = range && index >= range.start && index < range.end ? range : {}
    const hasRangeFontScale = Boolean(overrides.fontScale)
    const style = { ...defaults, ...overrides }
    const previous = groups[groups.length - 1]
    const signature = `${JSON.stringify(style)}|${hasRangeFontScale}`
    if (previous && previous.signature === signature) previous.text += chars[index]
    else groups.push({ text: chars[index], style, signature, hasRangeFontScale })
  }
  return groups.map((group, index) => {
    const displayScale = group.hasRangeFontScale ? group.style.fontScale : (group.style.fontSize ? group.style.fontSize / pageHeight : group.style.previewFontScale || group.style.fontScale)
    const letterSpacingVal = group.style.letterSpacing != null
      ? (typeof group.style.letterSpacing === "number" ? `${group.style.letterSpacing}px` : group.style.letterSpacing)
      : group.style.letterSpacingPt != null
      ? `${group.style.letterSpacingPt * displayHeight / pageHeight}px`
      : defaults?.letterSpacingPt != null
      ? `${defaults.letterSpacingPt * displayHeight / pageHeight}px`
      : defaults?.letterSpacing != null
      ? (typeof defaults.letterSpacing === "number" ? `${defaults.letterSpacing}px` : defaults.letterSpacing)
      : "inherit"
    return <span key={index} style={{ fontFamily: group.style.previewFontFamily || group.style.fontFamily, fontWeight: group.style.fontWeight, fontStyle: group.style.fontStyle, color: group.style.color, backgroundColor: "transparent", fontSize: `${Math.max(.1, displayScale * displayHeight)}px`, letterSpacing: letterSpacingVal }}>{group.text}</span>
  })
}

function PdfViewerPage({ selectedAnnotation,onAnnotationSelect,onAnnotationChange, redactionMarks=[],onRedactionAdd,onRedactionChange,onRedactionDelete, annotationMode,annotations=[],annotationStyle,onAnnotationAdd, file, pageNumber, pageSize, displayWidth, displayHeight, pageNodes, root, zoom = 1, rotation = 0, renderQuality = 'full', renderPriority = 2, searchRects = [], onNavigateInternal = () => {}, formValues = {}, onFormValueChange = () => {}, editTextMode = false, addTextMode = false, imageSelectMode = false, selectedImage, imageEdits = [], onSelectImage = () => {}, onImageEdit = () => {}, onTextObjectSelected = () => {}, textStyle, onTextStyleActivate, localFonts = [], onSelectTextFont, onAddTextPlaced = () => {}, textEdits = [], onTextEdit = () => {}, onTextDelete = () => {}, selectedTextBox, onSelectTextBox = () => {} }) {
  const wrapper = useRef(null)
  const canvas = useRef(null)
    const textLayer = useRef(null)
  const textInput = useRef(null)
  const lastClickedTextSpan = useRef(null)
  const pendingTextSelection = useRef(null)
  const [rendered, setRendered] = useState(false)
  const [renderRetry, setRenderRetry] = useState(0)
  useEffect(()=>{const target=canvas.current;return ()=>{if(target){target.width=0;target.height=0;delete target.dataset.painted}}},[])
  const [imageRegions, setImageRegions] = useState([])
  const [linkRegions, setLinkRegions] = useState([])
  const [formFields, setFormFields] = useState([])
  const [error, setError] = useState('')
  const [activeTextEdit, setActiveTextEdit] = useState(null)
  const [selectedText, setSelectedText] = useState(null)
  const [selectedRedaction,setSelectedRedaction]=useState(null)
  const [highlightColor, setHighlightColor] = useState('#fff176')
  const [snapGuides, setSnapGuides] = useState([])
  const boxGesture = useRef(null)
  const resolvedSelectedText = selectedText
    ? (boxGesture.current?.edit?.key === selectedText.key
      ? selectedText
      : textEdits.find((edit) => edit.key === selectedText.key) || (selectedText.selectedFromPreview || selectedText.isNew ? null : selectedText))
    : null
  const lastTextStyle = useRef(textStyle)
  useEffect(()=>{const key=event=>{if(!selectedText||activeTextEdit||!['Delete','Backspace'].includes(event.key))return;if(event.target?.closest?.('input,textarea,select,[contenteditable=true]'))return;event.preventDefault();onTextEdit({...selectedText,page:pageNumber,text:''});setSelectedText(null)};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key)},[selectedText,activeTextEdit,pageNumber,onTextEdit])

  useEffect(() => () => window.clearTimeout(pendingTextSelection.current), [])

  useEffect(() => {
    setSelectedText((current) => current ? textEdits.find((edit) => edit.key === current.key) || current : current)
  }, [textEdits])

  const fitTextInput = ({ width: requiredWidth, height: requiredHeight, left = 0, top = 0 }) => {
    if (!wrapper.current) return
    const pageWidth = wrapper.current.clientWidth, pageHeight = wrapper.current.clientHeight
    setActiveTextEdit(current => {
      if (!current) return current
      const preservesSourceLayout = Boolean(current.sourceLayout?.length && current.value === current.sourceLayoutText && !current.hasStyleEdits && !current.userBoxEdited && (current.alignment || 'left') === (current.originalAlignment || 'left'))
      const scale = preservesSourceLayout ? 1 : current.horizontalScale || 1
      const maxFontScale = Math.max(current.fontSize ? current.fontSize / (pageSize?.height || 792) : current.fontScale || 0, ...(current.styleRanges || []).map(run => run.fontSize ? run.fontSize / (pageSize?.height || 792) : run.fontScale || 0))
      const lineHeightScale = preservesSourceLayout ? current.lineHeightScale : Math.max(current.lineHeightScale || 0, maxFontScale * 1.2)
      if (lineHeightScale > (current.lineHeightScale || 0) + .00001) return { ...current, lineHeightScale }
      const rotated = [90, 270].includes(((current.rotation || 0) + 360) % 360)
      // Source runs can rise above the extracted glyph box (superscripts and
      // font ascenders). Expand the box without moving their PDF baselines.
      const dx = rotated ? 0 : Math.max(-current.x, Math.min(0, left / pageWidth))
      const dy = rotated ? 0 : Math.max(-current.y, Math.min(0, top / pageHeight))
      const x = current.x + dx, y = current.y + dy
      const width = Math.min(1 - x, Math.max(current.width, (rotated ? requiredHeight : requiredWidth * scale) / pageWidth - dx))
      const height = Math.min(1 - y, Math.max(current.height, (rotated ? requiredWidth * scale : requiredHeight) / pageHeight - dy))
      if (Math.abs(dx) < .0001 && Math.abs(dy) < .0001 && width <= current.width + .0001 && height <= current.height + .0001) return current
      return { ...current, x, y, width, height, baselineOffset: (current.baselineOffset || 0) - dy, sourceBaselineOffset: (current.sourceBaselineOffset || 0) - dy }
    })
  }

  useEffect(() => {
    const previous = lastTextStyle.current || {}
    lastTextStyle.current = textStyle
    const changed = Object.fromEntries(['fontFamily', 'fontSize', 'fontData', 'color', 'bold', 'italic'].filter((key) => previous[key] !== textStyle?.[key]).map((key) => [key, textStyle[key]]))
    if (!Object.keys(changed).length) return
    setActiveTextEdit((current) => {
      if (!current) return current
      const style = {
        ...('fontData' in changed ? {fontData:changed.fontData} : {}),
        ...('fontFamily' in changed ? { fontFamily: changed.fontFamily, sourceFontName: '', previewFontFamily: '', horizontalScale: 1, letterSpacing: 0, letterSpacingPt: 0 } : {}),
        ...('fontSize' in changed ? { fontSize: changed.fontSize, fontScale: changed.fontSize / (pageSize?.height || 792), previewFontScale: changed.fontSize / (pageSize?.height || 792), displayFontSize: changed.fontSize * ((wrapper.current?.clientHeight || 800) / (pageSize?.height || 792)) } : {}),
        ...('color' in changed ? { color: changed.color } : {}),
        ...('bold' in changed ? { fontWeight: changed.bold ? '700' : '400', previewFontFamily: '' } : {}),
        ...('italic' in changed ? { fontStyle: changed.italic ? 'italic' : 'normal', previewFontFamily: '' } : {}),
      }
      const start = current.selectionStart ?? 0
      const end = current.selectionEnd ?? 0

      if (end > start) return { ...current, styleRanges: appendTextStyleRange(current.styleRanges, start, end, style), hasStyleEdits: true }
      if (current.selectionStart != null) return { ...current, typingStyle: { ...current.typingStyle, ...style }, hasStyleEdits: true }
      const rangeStyle = { ...style }
      delete rangeStyle.color
      const styleRanges = (current.styleRanges || []).map(range => ({
        ...range,
        ...rangeStyle,
        ...('color' in style && (!range.color || range.color.toLowerCase() === String(current.color || '#111111').toLowerCase()) ? { color: style.color } : {}),
      }))
      return { ...current, ...style, styleRanges, hasStyleEdits: true }
    })
  }, [textStyle, pageSize?.height])

  const handleTextSelection = (selection) => {
    setActiveTextEdit(current => current && (current.selectionStart !== selection.selectionStart || current.selectionEnd !== selection.selectionEnd)
      ? { ...current, ...selection, typingStyle: undefined } : current)
    if (!activeTextEdit) return
    const offset = selection.selectionEnd > selection.selectionStart ? selection.selectionStart : Math.max(0, selection.selectionStart - 1)
    const selectedStyle = textStyleAt(activeTextEdit.styleRanges, offset, activeTextEdit)
    const style = { ...textStyle, fontFamily: selectedStyle.fontFamily, fontSize: selectedStyle.fontSize || textStyle?.fontSize || 14, color: getVisibleEditColor(selectedStyle.color), bold: parseInt(selectedStyle.fontWeight) >= 600, italic: /italic|oblique/i.test(selectedStyle.fontStyle || '') }
    lastTextStyle.current = style
    onTextStyleActivate?.(style)
  }

  const beginTextEdit = (event, editImmediately = true, clickedSpan = null) => {
    if (!wrapper.current) return
    const pageBounds = wrapper.current.getBoundingClientRect()
    const layer = textLayer.current
    const span = clickedSpan || event.target.closest('.pdf-text-layer span')
    if (addTextMode && !span) {
      event.preventDefault()
      const x = Math.max(0.02, Math.min(0.96, (event.clientX - pageBounds.left) / pageBounds.width))
      const width = Math.min(0.32, 1 - x)
      const fontScale = Number(textStyle?.fontSize || 14) / (pageSize?.height || 792)
      const height = Math.min(0.4, Math.max(0.045, fontScale * 2.4))
      const y = Math.max(0.02, Math.min(1 - height, (event.clientY - pageBounds.top) / pageBounds.height))
      setActiveTextEdit({ key: `new-${Date.now()}-${Math.random().toString(36).slice(2)}`, oldText: '', isNew: true, x, y, width, height, initialHeight: height, fontData:textStyle?.fontData, fontFamily: textStyle?.fontFamily || 'Helvetica', fontWeight: textStyle?.bold ? '700' : '400', fontStyle: textStyle?.italic ? 'italic' : 'normal', color: textStyle?.color || '#111111', fontScale, lineHeightScale: fontScale * 1.2, value: '' })
      onAddTextPlaced()
      return
    }
    if (!span) return
    if (editImmediately) event.preventDefault()
    if (Math.abs(Number(layer.dataset.renderWidth)-wrapper.current.clientWidth)>2) return
    const group = collectEditableTextGroups(layer, pageSize).find((candidate) => candidate.spans.includes(span))
    if (!group) return
    const { key, oldText } = { key: group.key, oldText: group.text }
    const previousEdit = textEdits.find((edit) => edit.key === key)
    if (!oldText.trim()) return
    onTextObjectSelected()
    const sampledColors = samplePdfTextColors(canvas.current, wrapper.current, group, getVisibleEditColor(group.color))
    const editFontScale = 1
    const previousScale = previousEdit?.editFontScale || 1
    const restorePreviousScale = (value) => Number(value) / previousScale
    const sourceWidth = previousEdit?.coverWidth || (group.right - group.left) / pageBounds.width
    const sourceHeight = previousEdit?.coverHeight || (group.bottom - group.top) / pageBounds.height
    const sourceX = previousEdit?.coverX ?? (group.left - pageBounds.left) / pageBounds.width
    const sourceY = previousEdit?.coverY ?? (group.top - pageBounds.top) / pageBounds.height
    const editBoxWidth = previousEdit?.width || Math.min(1 - sourceX, sourceWidth)
    const activatedStyle = {
      fontFamily: previousEdit?.fontFamily || group.fontFamily || 'Helvetica',
      fontSize: restorePreviousScale(previousEdit?.fontSize || group.fontSize || 14) * editFontScale,
      color: previousEdit?.color || group.color || sampledColors.color,
      bold: Number.parseInt(previousEdit?.fontWeight || group.fontWeight, 10) >= 600,
      italic: /italic|oblique/i.test(String(previousEdit?.fontStyle || group.fontStyle || '')),
    }
    lastTextStyle.current = activatedStyle
    onTextStyleActivate?.(activatedStyle)
    const nextTextEdit = {
      key, oldText,
      alignment: previousEdit?.alignment || 'left',
      originalAlignment: previousEdit?.alignment || 'left',
      sourceLayout: previousEdit ? previousEdit.sourceLayout : group.sourceLayout,
      sourceLayoutText: previousEdit ? previousEdit.sourceLayoutText : oldText,
      sourceCoverRects: previousEdit?.sourceCoverRects || group.sourceCoverRects,
      sourceLineCount: previousEdit?.sourceLineCount ?? group.sourceLineCount,
      x: previousEdit?.x ?? sourceX,
      y: previousEdit?.y ?? sourceY,
      width: editBoxWidth,
      boxWidthTightened: true,
      height: sourceHeight * editFontScale,
      coverX: sourceX,
      coverY: sourceY,
      coverWidth: sourceWidth,
      coverHeight: sourceHeight,
      baselineOffset: group.baselineOffset,
      sourceBaselineOffset: previousEdit?.sourceBaselineOffset ?? group.sourceBaselineOffset,
      sourceAnchorX: previousEdit?.sourceAnchorX ?? sourceX,
      sourceAnchorY: previousEdit?.sourceAnchorY ?? sourceY,
      rotation: previousEdit?.rotation ?? group.rotation,
      initialWidth: editBoxWidth,
      initialHeight: sourceHeight * editFontScale,
      editFontScale,
      fontFamily: previousEdit?.fontFamily || group.fontFamily,
      previewFontFamily: previousEdit?.previewFontFamily ?? group.previewFontFamily,
      sourceFontName: previousEdit?.sourceFontName || group.sourceFontName,
      fontWeight: previousEdit?.fontWeight || group.fontWeight,
      fontStyle: previousEdit?.fontStyle || group.fontStyle,
      color: previousEdit?.color || group.color || sampledColors.color,
      // Most PDFs have a white page. Always cover the source glyphs when
      // canvas sampling is unavailable, otherwise the replacement is drawn
      // directly over the original and appears doubled.
      backgroundColor: wrapper.current?.closest('.has-dark-page') ? getDarkPageFill(previousEdit?.sourceBackgroundColor || previousEdit?.backgroundColor || sampledColors.backgroundColor || '#FFFFFF') : sampledColors.backgroundColor || '#FFFFFF',
      sourceBackgroundColor: previousEdit?.sourceBackgroundColor || previousEdit?.backgroundColor || sampledColors.backgroundColor || '#FFFFFF',
      fontSize: restorePreviousScale(previousEdit?.fontSize || group.fontSize) * editFontScale,
      fontScale: restorePreviousScale(previousEdit?.fontScale || group.fontScale) * editFontScale,
      previewFontScale: restorePreviousScale(previousEdit?.previewFontScale || group.previewFontScale) * editFontScale,
      displayFontSize: restorePreviousScale(previousEdit?.displayFontSize || group.displayFontSize) * editFontScale,
      horizontalScale: previousEdit?.horizontalScale || group.horizontalScale,
      letterSpacing: previousEdit?.letterSpacing ?? group.letterSpacing ?? 0,
      letterSpacingPt: previousEdit?.letterSpacingPt ?? group.letterSpacingPt ?? 0,
      letterSpacingEm: previousEdit?.letterSpacingEm ?? group.letterSpacingEm ?? 0,
      lineHeightScale: restorePreviousScale(previousEdit?.lineHeightScale || group.lineHeightScale) * editFontScale,
      styleRanges: (previousEdit ? previousEdit.styleRanges || [] : group.styleRanges || []).map((range) => ({
        ...range,
        ...(range.fontSize ? { fontSize: restorePreviousScale(range.fontSize) * editFontScale } : {}),
        ...(range.fontScale ? { fontScale: restorePreviousScale(range.fontScale) * editFontScale } : {}),
        letterSpacing: range.letterSpacing ?? group.letterSpacing ?? 0,
        letterSpacingPt: range.letterSpacingPt ?? group.letterSpacingPt ?? 0,
      })),
      text: previousEdit?.text ?? oldText,
      value: previousEdit?.text ?? oldText,
      fontData: previousEdit?.fontData,
    }
    if (editImmediately) {
      window.clearTimeout(pendingTextSelection.current)
      setSelectedText(null)
      setActiveTextEdit(nextTextEdit)
    } else {
      window.clearTimeout(pendingTextSelection.current)
      pendingTextSelection.current = window.setTimeout(() => {
        if (window.getSelection()?.toString()) return
        setSelectedText(nextTextEdit)
      }, 260)
    }
  }

  const commitTextEdit = (event) => {
    if (!activeTextEdit) return
    const bounds = textInput.current?.getBoundingClientRect() || event?.currentTarget?.getBoundingClientRect()
    const pageBounds = wrapper.current?.getBoundingClientRect()
    const resizedEdit = bounds && pageBounds ? {
      width: bounds.width / pageBounds.width,
      height: bounds.height / pageBounds.height,
    } : activeTextEdit
    const savedBoxSize = activeTextEdit.userBoxEdited ? activeTextEdit : {width:activeTextEdit.width,height:activeTextEdit.height}
    const text = activeTextEdit.value
    if (!text && !activeTextEdit.isNew) {
      onTextEdit({ ...activeTextEdit, ...savedBoxSize, page: pageNumber, text: '' })
    } else if (text && (activeTextEdit.isNew || text !== activeTextEdit.oldText || activeTextEdit.userBoxEdited || activeTextEdit.hasStyleEdits || (activeTextEdit.alignment || 'left') !== (activeTextEdit.originalAlignment || 'left'))) {
      onTextEdit({ ...activeTextEdit, ...savedBoxSize, page: pageNumber, text })
      onSelectTextBox(activeTextEdit.isNew ? { key: activeTextEdit.key, page: pageNumber } : null)
    }
    setSelectedText(null)
    setActiveTextEdit(null)
  }


  useEffect(() => {
    if (!activeTextEdit) return undefined
    const handleOutsidePointerDown = (event) => {
      const target = event.target
      if (!(target instanceof Element)) return
      if (textInput.current?.contains(target) || target.closest('.pdf-text-format-ribbon, .text-style-control, .text-style-toggle, .pdf-text-box-resize, .pdf-text-highlight-controls')) return
      if (document.activeElement === textInput.current) textInput.current.blur()
      else commitTextEdit()
    }
    window.addEventListener('pointerdown', handleOutsidePointerDown, true)
    return () => window.removeEventListener('pointerdown', handleOutsidePointerDown, true)
  }, [activeTextEdit, textEdits, onTextEdit, onSelectTextBox])

  const openEditedText = (event, edit) => {
    event.stopPropagation()
    onSelectTextBox(null)
    onTextObjectSelected()
    const style = {
      fontFamily: edit.fontFamily || 'Helvetica',
      fontSize: edit.fontSize || edit.displayFontSize || 14,
      color: edit.color || '#111111',
      bold: Number.parseInt(edit.fontWeight, 10) >= 600,
      italic: /italic|oblique/i.test(String(edit.fontStyle || '')),
    }
    lastTextStyle.current = style
    onTextStyleActivate?.(style)
    setSelectedText(null)
    setActiveTextEdit({ ...edit, originalAlignment: edit.alignment || 'left', oldText: edit.text, value: edit.text, initialWidth: edit.width, initialHeight: edit.height, coverX: edit.coverX ?? edit.x, coverY: edit.coverY ?? edit.y, coverWidth: edit.coverWidth || edit.width, coverHeight: edit.coverHeight || edit.height })
  }

  const handleTextLayerPointerDown = (event) => {
    const span = event.target.closest('.pdf-text-layer span')
    lastClickedTextSpan.current = span || null
    if (!resolvedSelectedText) return
    if (!span) return
    const group = collectEditableTextGroups(textLayer.current, pageSize).find((candidate) => candidate.spans.includes(span))
    if (group?.key === resolvedSelectedText.key) startBoxGesture(event, resolvedSelectedText)
  }

  const startBoxGesture = (event, edit, mode = 'move') => {
    if (event.button !== 0 || !wrapper.current) return
    event.preventDefault()
    event.stopPropagation()
    onSelectTextBox(edit.isNew ? { key: edit.key, page: pageNumber } : null)
    event.currentTarget.setPointerCapture(event.pointerId)
    boxGesture.current = { pointerId: event.pointerId, mode, startX: event.clientX, startY: event.clientY, edit, original: edit, editing: activeTextEdit?.key === edit.key }
  }

  const moveBoxGesture = (event) => {
    const gesture = boxGesture.current
    const bounds = wrapper.current?.getBoundingClientRect()
    if (!gesture || gesture.pointerId !== event.pointerId || !bounds) return
    const dx = (event.clientX - gesture.startX) / bounds.width
    const dy = (event.clientY - gesture.startY) / bounds.height
    const { edit } = gesture
    let next
    if (gesture.mode === 'move') {
      let x = Math.max(0, Math.min(1 - edit.width, edit.x + dx)), y = Math.max(0, Math.min(1 - edit.height, edit.y + dy))
      const thresholdX = 8 / bounds.width, thresholdY = 8 / bounds.height, guides = []
      const peers = textEdits.filter(item => item.page === pageNumber && item.key !== edit.key)
      const targetsX = [0, .5, 1, ...peers.flatMap(item => [item.x, item.x + item.width / 2, item.x + item.width])]
      const targetsY = [0, .5, 1, ...peers.flatMap(item => [item.y, item.y + item.height / 2, item.y + item.height])]
      const snap = (position, size, targets, threshold, axis) => {
        let best = null
        for (const target of targets) for (const edge of [0, size / 2, size]) {
          const distance = target - (position + edge)
          if (Math.abs(distance) <= threshold && (!best || Math.abs(distance) < Math.abs(best.distance))) best = { distance, target }
        }
        if (best) { guides.push({ axis, position: best.target }); return position + best.distance }
        return position
      }
      x = Math.max(0, Math.min(1 - edit.width, snap(x, edit.width, targetsX, thresholdX, 'vertical')))
      y = Math.max(0, Math.min(1 - edit.height, snap(y, edit.height, targetsY, thresholdY, 'horizontal')))
      setSnapGuides(guides)
      next = { ...edit, x, y }
    } else {
      let { x, y, width, height } = edit
      if (gesture.mode.includes('e')) width = Math.max(0.06, Math.min(1 - x, width + dx))
      if (gesture.mode.includes('s')) height = Math.max(0.025, Math.min(1 - y, height + dy))
      if (gesture.mode.includes('w')) {
        const right = x + width
        x = Math.max(0, Math.min(right - 0.06, x + dx))
        width = right - x
      }
      if (gesture.mode.includes('n')) {
        const bottom = y + height
        y = Math.max(0, Math.min(bottom - 0.025, y + dy))
        height = bottom - y
      }
      next = { ...edit, x, y, width, height }
    }
    gesture.startX = event.clientX
    gesture.startY = event.clientY
    gesture.edit = next
    if (gesture.editing) setActiveTextEdit((current) => current ? { ...current, ...next, userBoxEdited: true } : current)
    else setSelectedText(next)
  }

  const endBoxGesture = (event) => {
    const gesture = boxGesture.current
    if (gesture?.pointerId !== event.pointerId) return
    boxGesture.current = null
    setSnapGuides([])
    if (gesture.editing) return
    const { original, edit } = gesture
    const changed = ['x', 'y', 'width', 'height'].some((key) => Math.abs((edit[key] || 0) - (original[key] || 0)) > 0.0005)
    if (changed) onTextEdit({ ...edit, page: pageNumber, text: edit.text })
  }

  const handlePagePointerDown = (event) => {
    const target = event.target
    if (!(target instanceof Element)) return
    if (!target.closest('.pdf-text-edit-preview')) onSelectTextBox(null)
    // Clicking empty page space should leave text selection/edit mode. Text
    // spans can still be clicked to select another text box immediately.
    if (!target.closest('.pdf-text-edit-preview, .pdf-text-layer span')) setSelectedText(null)
  }

  useEffect(() => {
    const targetCanvas = canvas.current, targetText = textLayer.current, node = wrapper.current
    // The parent's buffered virtual window owns visibility. A second observer
    // can retain an obsolete offscreen decision while mixed page sizes settle,
    // leaving a mounted, visible page permanently blank. Paint mounted pages;
    // virtualization still bounds work and unmount releases their canvases.
    if (!targetCanvas || !targetText || !node) { setRendered(false); return undefined }
    let active = true, frame = 0, resizeTimer = 0, currentJob = null
    const draw = () => {
      cancelAnimationFrame(frame)
      currentJob?.abort()
      const job = new AbortController()
      currentJob = job
      setRendered(false)
      targetText.replaceChildren(); delete targetText.dataset.renderWidth
      // Keep same-page object overlays while its owned canvas rerenders.
      setError('')
      frame = requestAnimationFrame(async () => {
        if (!active || job.signal.aborted) return
        const scale = (node.clientWidth || 760) / (pageSize?.width || 612)
        try {
          const engine = await import('../pdfEngine')
          if (!active || job.signal.aborted) return
          // Paint independently of slow object inspection; it must not delay page visibility.
          const result = await engine.renderPdfPage(file, pageNumber, targetCanvas, scale * (renderQuality === 'preview' ? 0.66 : 1), { priority: renderPriority, rotation, signal: job.signal })
          if (!active || job.signal.aborted || currentJob !== job) return
          if (result.status === 'CANCELLED') return
          if (result.status !== 'SUCCESS' || !targetCanvas.width || !targetCanvas.height) throw result.error || new Error('No pixels were painted.')
          setRendered(true)
          const results = await Promise.allSettled([
            engine.renderPdfTextLayer(file, pageNumber, targetText, scale, { rotation, signal: job.signal }),
            imageSelectMode ? engine.inspectPdfPageImages(file, pageNumber, rotation) : Promise.resolve([]),
            engine.inspectPdfPageLinks(file, pageNumber, rotation),
            engine.inspectPdfPageFormFields(file, pageNumber, rotation),
          ])
          if (!active || job.signal.aborted || currentJob !== job) return
          if (results[0].status === 'fulfilled' && results[0].value?.status === 'SUCCESS') engine.hydratePdfTextLayerStyles(targetText)
          setImageRegions(results[1].status === 'fulfilled' ? results[1].value : [])
          setLinkRegions(results[2].status === 'fulfilled' ? results[2].value : [])
          setFormFields(results[3].status === 'fulfilled' ? results[3].value : [])
          if (results[0].status === 'rejected' || results[0].value?.status === 'FAILED') setError('Text selection is unavailable on this page.')
        } catch (cause) {
          if (active && !job.signal.aborted && currentJob === job) setError(cause.message || `Could not render page ${pageNumber}.`)
        }
      })
    }
    const scheduleDraw = () => { currentJob?.abort();setRendered(false);targetText.replaceChildren();delete targetText.dataset.renderWidth;window.clearTimeout(resizeTimer);resizeTimer=window.setTimeout(draw,renderQuality==='preview'?280:180) }
    const observer = 'ResizeObserver' in window ? new ResizeObserver(scheduleDraw) : null
    observer?.observe(node)
    if (!observer) window.addEventListener('resize', scheduleDraw)
    draw()
    return () => {
      active = false
      currentJob?.abort()
      cancelAnimationFrame(frame)
      window.clearTimeout(resizeTimer)
      observer?.disconnect()
      if (!observer) window.removeEventListener('resize', scheduleDraw)
      // Synchronous, instance-owned release before the next effect starts.
      targetText.replaceChildren()
    }
  }, [file, pageNumber, pageSize?.width, renderQuality, renderPriority, rotation, imageSelectMode, renderRetry])

  const nativeDesignFields=formFields.filter(f=>f.type!=='Sig').map(f=>({
    ...f,key:`field-${f.key}`,type:'form-update',originalName:f.name,widgetId:f.key,page:pageNumber,viewerRotation:rotation,
    kind:f.type==='Tx'?'text':f.checkBox?'checkbox':f.radioButton?'radio':f.combo?'dropdown':'list',choices:f.choices.map(c=>c.value),
  }))
  const designFields=[...nativeDesignFields.map(f=>({...f,...annotations.find(a=>a.key===f.key)})),...annotations.filter(a=>a.type==='form-create')].filter(f=>!f.deleted)
  const aspectRatio = pageSize?.width && pageSize?.height ? `${pageSize.width} / ${pageSize.height}` : '0.773'
  const pageWidth = wrapper.current?.clientWidth || 990
  const pageHeight = wrapper.current?.clientHeight || 800
  const preserveSourceLayout = Boolean(activeTextEdit?.sourceLayout?.length && activeTextEdit.value === activeTextEdit.sourceLayoutText && !activeTextEdit.hasStyleEdits && !activeTextEdit.userBoxEdited && (activeTextEdit.alignment || 'left') === (activeTextEdit.originalAlignment || 'left'))
  const activeDisplayEdit = preserveSourceLayout ? { ...activeTextEdit, horizontalScale: 1, baselineOffset: 0 } : activeTextEdit
  const activeInputLayout = activeDisplayEdit ? getTextEditDisplayLayout(activeDisplayEdit, pageWidth, pageHeight) : null
  const selectedToolbarEdit = resolvedSelectedText || (selectedTextBox?.page === pageNumber ? textEdits.find(edit => edit.key === selectedTextBox.key && edit.page === pageNumber) : null)
  const selectedToolbarLayout = selectedToolbarEdit ? getTextEditDisplayLayout(selectedToolbarEdit, pageWidth, pageHeight) : null
  return <div className="acrobat-document-page" style={{ aspectRatio, width: `${displayWidth || pageSize?.width * zoom * (96 / 72) || 816}px`, height: `${displayHeight || pageSize?.height * zoom * (96 / 72) || 1056}px` }} ref={(node) => { wrapper.current = node; pageNodes.current[pageNumber - 1] = node }} onPointerDown={handlePagePointerDown}>
    {snapGuides.map((guide, index) => <span key={`${guide.axis}-${index}`} className={`pdf-text-snap-guide ${guide.axis}`} style={guide.axis === 'vertical' ? { left: `${guide.position * 100}%` } : { top: `${guide.position * 100}%` }} aria-hidden="true" />)}
    {!rendered && !canvas.current?.dataset.painted && <div className="acrobat-page-placeholder" aria-hidden="true" />}
    <canvas ref={canvas} className={rendered ? 'is-rendered' : canvas.current?.dataset.painted ? 'is-stale' : 'is-pending'} aria-label={`PDF page ${pageNumber}`} />
    {annotationMode==='redact-pdf'&&<><RegionLayer active={Boolean(rendered||canvas.current?.dataset.painted)} items={redactionMarks} drawing selectedKey={selectedRedaction} onSelect={mark=>setSelectedRedaction(mark.key)} onAdd={onRedactionAdd} onChange={onRedactionChange} label="Redaction" fill="rgba(0,0,0,.75)"/>{selectedRedaction&&<button type="button" style={{position:'absolute',top:5,right:5,zIndex:14}} onClick={()=>{onRedactionDelete?.(selectedRedaction);setSelectedRedaction(null)}}>Remove redaction mark</button>}</>}
    {annotationMode==='form-design'&&<RegionLayer items={designFields} selectedKey={selectedAnnotation?.key} onSelect={onAnnotationSelect} onChange={onAnnotationChange} label="Field"/>}
    {annotationMode==='annotation-select'&&<RegionLayer items={annotations.filter(a=>a.type==='annotation')} selectedKey={selectedAnnotation?.key} onSelect={onAnnotationSelect} onChange={item=>{
      const original=annotations.find(a=>a.key===item.key)
      const points=original?.points?.map(([x,y])=>[item.x+(x-original.x)*item.width/original.width,item.y+(y-original.y)*item.height/original.height])
      onAnnotationChange?.({...item,...(points?{points}:{})})
    }} label="Mark" fill="transparent"/>}
    <AnnotationLayer page={pageNumber} mode={annotationMode} items={annotations.filter(a=>!a.deleted&&a.type!=='form-update')} style={{...annotationStyle,pageWidth:pageSize?.width}} onAdd={onAnnotationAdd||(()=>{})} rotation={rotation} pageNode={wrapper}/>
    {imageEdits.filter(edit=>!edit.isNew).map(edit=><span key={`image-cover-${edit.key}`} style={{position:'absolute',zIndex:3,pointerEvents:'none',background:edit.backgroundColor||'#fff',left:`${(edit.original||edit).x*100}%`,top:`${(edit.original||edit).y*100}%`,width:`${(edit.original||edit).width*100}%`,height:`${(edit.original||edit).height*100}%`}}/>)}
    <div className="pdf-image-object-layer">{imageEdits.filter(edit=>(edit.isNew||!imageSelectMode)&&!edit.deleted).map(edit=><PdfImageObject key={edit.key} pageNumber={pageNumber} pageCanvas={canvas.current} region={edit} imageEdit={edit} selected={selectedImage?.key===edit.key} selectedImage={selectedImage} onSelect={onSelectImage} onChange={onImageEdit}/>)}</div>
    {searchRects.length > 0 && <div className="pdf-search-highlight-layer" aria-hidden="true">{searchRects.map((rect) => <span key={rect.id} className={rect.active ? 'is-active' : ''} style={{ left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.width * 100}%`, height: `${rect.height * 100}%` }} />)}</div>}
    <div ref={textLayer} className={`pdf-text-layer is-text-editing ${addTextMode ? 'is-adding-text' : ''}`} aria-label={`Selectable text on page ${pageNumber}`} onPointerDown={handleTextLayerPointerDown} onPointerMove={moveBoxGesture} onPointerUp={endBoxGesture} onPointerCancel={endBoxGesture} onClick={(event) => { if(['highlight','underline','strike'].includes(annotationMode))return; const span = event.target.closest('.pdf-text-layer span'); lastClickedTextSpan.current = span || null; if (!span) { if (addTextMode) beginTextEdit(event, true); return } const group = collectEditableTextGroups(textLayer.current, pageSize).find((candidate) => candidate.spans.includes(span)); if (group?.key !== selectedText?.key) beginTextEdit(event, false, span) }} onDoubleClick={(event) => { if(['highlight','underline','strike'].includes(annotationMode))return; window.clearTimeout(pendingTextSelection.current); beginTextEdit(event, true, event.target.closest('.pdf-text-layer span') || lastClickedTextSpan.current) }} />
    {linkRegions.length > 0 && <div className="pdf-link-layer" aria-label={`Links on page ${pageNumber}`}>{linkRegions.map((link, index) => <a key={`${link.x}-${link.y}-${index}`} href={link.url || '#'} title={link.title} aria-label={link.title} style={{ left: `${link.x * 100}%`, top: `${link.y * 100}%`, width: `${link.width * 100}%`, height: `${link.height * 100}%` }} onClick={(event) => { event.stopPropagation(); if (link.destinationPage) onNavigateInternal(link.destinationPage); else if (link.url && event.metaKey) {/* Cmd+click - let browser open in new tab naturally */} else if (link.url) { event.preventDefault(); window.pdfKing?.openExternal?.(link.url).catch?.(() => {}) } } } />)}</div>}
    {annotationMode!=='form-design' && formFields.length > 0 && <PdfNativeFormLayer fields={formFields} pageNumber={pageNumber} pageSize={pageSize} pageHeight={pageHeight} values={formValues} onChange={onFormValueChange} />}
    {imageSelectMode && imageRegions.length > 0 && <div className="pdf-image-object-layer" aria-label={`Images on page ${pageNumber}`}>
      {imageRegions.map((region) => <PdfImageObject key={region.key} file={file} pageNumber={pageNumber} pageCanvas={canvas.current} region={region} imageEdit={imageEdits.find((edit) => edit.key === region.key)} selected={selectedImage?.page === pageNumber && selectedImage?.key === region.key} selectedImage={selectedImage} onSelect={onSelectImage} onChange={onImageEdit} />)}
    </div>}
    {textEdits.filter((edit) => !edit.isNew && edit.backgroundColor && !edit.sourceCoverRects?.length).map((edit) => <span className="pdf-text-source-cover" key={`cover-${edit.key}`} aria-hidden="true" style={{ left: `${(edit.coverX ?? edit.x) * 100}%`, top: `${(edit.coverY ?? edit.y) * 100}%`, width: `${Math.min(1 - (edit.coverX ?? edit.x), edit.coverWidth || edit.width) * 100}%`, height: `${Math.min(1 - (edit.coverY ?? edit.y), edit.coverHeight || edit.height) * 100}%`, backgroundColor: edit.backgroundColor }} />)}
    {textEdits.filter(edit => !edit.isNew).flatMap(edit => (edit.sourceCoverRects || []).map((rect, index) => <span key={`${edit.key}-cover-${index}`} className="pdf-text-source-cover" aria-hidden="true" style={{ left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.width * 100}%`, height: `${rect.height * 100}%`, backgroundColor: rect.backgroundColor }} />))}
    {textEdits.map((edit) => {
      const preview = resolvedSelectedText?.key === edit.key ? resolvedSelectedText : edit
      const layout = getTextEditDisplayLayout(preview, pageWidth, pageHeight)
      return <span className={`pdf-text-edit-preview ${edit.isNew ? 'is-new-text' : ''} ${edit.isNew && selectedTextBox?.page === pageNumber && selectedTextBox?.key === edit.key ? 'is-selected-text' : ''} `} key={edit.key} style={{ left: `${layout.left * 100}%`, top: `${layout.top * 100}%`, width: `${layout.width / (edit.horizontalScale || 1) * 100}%`, height: `${layout.height * 100}%`, fontSize: `${Math.max(.1, (edit.previewFontScale || edit.fontScale || edit.height * 0.8) * pageHeight)}px`, letterSpacing: edit.letterSpacingPt ? `${edit.letterSpacingPt * pageHeight / (pageSize?.height || 792)}px` : edit.letterSpacing ? `${edit.letterSpacing}px` : 'normal', transformOrigin: '0 0', transform: layout.transform, lineHeight: `${Math.max(.1, (edit.lineHeightScale || edit.fontScale * 1.2) * pageHeight)}px`, fontFamily: edit.previewFontFamily || edit.fontFamily || 'sans-serif', fontWeight: edit.fontWeight || '400', fontStyle: edit.fontStyle || 'normal', color: edit.color || '#111', textAlign: edit.alignment || 'left', backgroundColor: 'transparent', textTransform: 'none', whiteSpace: edit.isNew || !edit.sourceLineCount ? 'pre-wrap' : 'pre', overflow: 'hidden' }} onClick={!edit.isNew ? (event) => { event.stopPropagation(); onTextObjectSelected(); if (selectedText?.key !== edit.key) setSelectedText(edit) } : undefined} onDoubleClick={!edit.isNew ? (event) => openEditedText(event, edit) : undefined} onPointerDown={(event) => { if (edit.isNew || !event.target.closest('.pdf-text-box-resize')) startBoxGesture(event, edit) }} onPointerMove={moveBoxGesture} onPointerUp={endBoxGesture} onPointerCancel={endBoxGesture} title={edit.isNew ? 'Click to select; Delete or Backspace to remove; drag to move; drag an edge or corner to resize' : 'Click to select, drag to move, drag a handle to resize, and double-click to edit'}><span className="pdf-text-edit-content">{renderStyledText(edit.text, edit.styleRanges, pageHeight, pageSize?.height || 792, edit)}</span>{edit.isNew && <button type="button" className="pdf-text-box-delete" aria-label="Delete text box" title="Delete text box" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onSelectTextBox(null); onTextDelete({ ...edit, page: pageNumber }) }}>×</button>}{edit.isNew && ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'].map((edge) => <span key={edge} className={`pdf-text-box-resize edge-${edge}`} role="presentation" onPointerDown={(event) => { event.stopPropagation(); startBoxGesture(event, edit, edge) }} onPointerMove={moveBoxGesture} onPointerUp={endBoxGesture} onPointerCancel={endBoxGesture} />)}</span>
    })}
    {resolvedSelectedText && !resolvedSelectedText.isNew && <span className="pdf-selected-text-box" style={{ left: `${resolvedSelectedText.x * 100}%`, top: `${getTextEditDisplayLayout(resolvedSelectedText, pageWidth, pageHeight).visualTop * 100}%`, width: `${resolvedSelectedText.width * 100}%`, height: `${resolvedSelectedText.height * 100}%` }} aria-label="Selected text box" title="Double-click to edit; drag to reposition; use the handles to resize" onDoubleClick={(event) => openEditedText(event, resolvedSelectedText)} onPointerDown={(event) => startBoxGesture(event, resolvedSelectedText)} onPointerMove={moveBoxGesture} onPointerUp={endBoxGesture} onPointerCancel={endBoxGesture}>{['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'].map((edge) => <span key={edge} className={`pdf-text-box-resize edge-${edge}`} role="presentation" onPointerDown={(event) => { event.stopPropagation(); startBoxGesture(event, resolvedSelectedText, edge) }} onPointerMove={moveBoxGesture} onPointerUp={endBoxGesture} onPointerCancel={endBoxGesture} />)}</span>}
    {selectedToolbarEdit && !activeTextEdit && <div className="pdf-text-selection-toolbar" style={{ left: `${selectedToolbarLayout.visualLeft * 100}%`, top: `${Math.max(6, selectedToolbarLayout.visualTop * pageHeight - 44)}px` }} aria-label="Selected text box quick actions" onPointerDown={event => event.preventDefault()}><span>Text box</span><button type="button" onClick={event => openEditedText(event, selectedToolbarEdit)}>Edit</button><button type="button" className="danger" onClick={() => { onTextEdit({ ...selectedToolbarEdit, page: pageNumber, text: '' }); setSelectedText(null); onSelectTextBox(null) }}>Delete</button></div>}
    {activeTextEdit && !preserveSourceLayout && !activeTextEdit.isNew && !activeTextEdit.sourceCoverRects?.length && activeTextEdit.backgroundColor && <span className="pdf-text-edit-cover" aria-hidden="true" style={{ left: `${(activeTextEdit.coverX ?? activeTextEdit.x) * 100}%`, top: `${(activeTextEdit.coverY ?? activeTextEdit.y) * 100}%`, width: `${Math.min(1 - (activeTextEdit.coverX ?? activeTextEdit.x), activeTextEdit.coverWidth || activeTextEdit.width) * 100}%`, height: `${Math.min(1 - (activeTextEdit.coverY ?? activeTextEdit.y), activeTextEdit.coverHeight || activeTextEdit.height) * 100}%`, backgroundColor: activeTextEdit.backgroundColor }} />}
    {activeTextEdit && !preserveSourceLayout && !activeTextEdit.isNew && activeTextEdit.sourceCoverRects?.map((rect, index) => <span key={`active-cover-${index}`} className="pdf-text-edit-cover" aria-hidden="true" style={{ left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.width * 100}%`, height: `${rect.height * 100}%`, backgroundColor: rect.backgroundColor }} />)}
    {activeTextEdit && <>
      <div className="pdf-text-format-ribbon" style={{ left: `${activeInputLayout.visualLeft * 100}%`, top: `${Math.max(6, activeInputLayout.visualTop * pageHeight - 46)}px` }} aria-label="Text formatting controls">
        <select aria-label="Font family" value={textStyle?.localFontId ? `local:${textStyle.localFontId}` : textStyle?.fontFamily || 'Helvetica'} onChange={event => onSelectTextFont?.(event.target.value)}>{!PDF_TEXT_FONTS.includes(textStyle?.fontFamily) && !textStyle?.localFontId && <option value={textStyle.fontFamily}>{textStyle.fontFamily}</option>}{PDF_TEXT_FONTS.map(font => <option key={font} value={font}>{font}</option>)}{localFonts.map(font => <option key={font.id} value={`local:${font.id}`}>{font.name} · local</option>)}</select>
        <select aria-label="Font size" value={textStyle?.fontSize || 14} onChange={event => onTextStyleActivate?.({...textStyle,fontSize:Number(event.target.value)})}>{[...new Set([8,10,12,14,16,18,24,32,48,textStyle?.fontSize || 14])].sort((a,b)=>a-b).map(size=><option key={size} value={size}>{size} pt</option>)}</select>
        <span className="pdf-text-format-divider" />
        {['left','center','right'].map(alignment => <button key={alignment} type="button" className={`pdf-text-align-button align-${alignment} ${(activeTextEdit.alignment || 'left') === alignment ? 'active' : ''}`} aria-label={`${alignment} align`} aria-pressed={(activeTextEdit.alignment || 'left') === alignment} onMouseDown={event=>event.preventDefault()} onClick={()=>setActiveTextEdit(current=>current?{...current,alignment}:current)} />)}
        <button type="button" className={Boolean(textStyle?.bold) ? 'active' : ''} aria-label="Bold" aria-pressed={Boolean(textStyle?.bold)} onMouseDown={event=>event.preventDefault()} onClick={()=>onTextStyleActivate?.({...textStyle,bold:!textStyle?.bold})}><b>B</b></button>
        <button type="button" className={Boolean(textStyle?.italic) ? 'active' : ''} aria-label="Italic" aria-pressed={Boolean(textStyle?.italic)} onMouseDown={event=>event.preventDefault()} onClick={()=>onTextStyleActivate?.({...textStyle,italic:!(Boolean(textStyle?.italic))})}><i>I</i></button>
        <label className="pdf-text-format-color" title="Text color"><input aria-label="Text color" type="color" value={textStyle?.color || activeTextEdit.color || '#17233b'} onChange={event=>onTextStyleActivate?.({...textStyle,color:event.target.value})}/><span style={{backgroundColor:textStyle?.color || activeTextEdit.color || '#17233b'}} /></label>
        <button type="button" className="pdf-text-format-done" onClick={()=>commitTextEdit()}>Done</button>
      </div>
      <RichTextInput key={activeTextEdit.key} ref={textInput} edit={activeTextEdit} preserveSourceLayout={preserveSourceLayout} displayWidth={pageWidth} displayHeight={pageHeight} pageHeight={pageSize?.height || 792} onEdit={setActiveTextEdit} onFit={fitTextInput} onSelection={handleTextSelection} className={`pdf-text-edit-input ${activeTextEdit.isNew ? 'is-new-text' : ''}`} style={{ left: `${activeInputLayout.left * 100}%`, top: `${activeInputLayout.top * 100}%`, width: `${activeInputLayout.width / (activeDisplayEdit.horizontalScale || 1) * 100}%`, height: `${activeInputLayout.height * 100}%`, fontSize: `${Math.max(.1, activeTextEdit.fontScale * pageHeight || activeTextEdit.displayFontSize)}px`, letterSpacing: activeTextEdit.letterSpacingPt ? `${activeTextEdit.letterSpacingPt * pageHeight / (pageSize?.height || 792)}px` : activeTextEdit.letterSpacing ? `${activeTextEdit.letterSpacing}px` : 'normal', transformOrigin: '0 0', transform: activeInputLayout.transform, lineHeight: `${Math.max(.1, (activeTextEdit.lineHeightScale || activeTextEdit.fontScale * 1.2) * pageHeight)}px`, fontFamily: activeTextEdit.previewFontFamily || activeTextEdit.fontFamily || 'sans-serif', fontWeight: activeTextEdit.fontWeight || '400', fontStyle: activeTextEdit.fontStyle || 'normal', color: activeTextEdit.color || '#111', textAlign: activeTextEdit.alignment || 'left', backgroundColor: 'transparent', textTransform: 'none', whiteSpace: activeTextEdit.isNew || !activeTextEdit.sourceLineCount ? 'pre-wrap' : 'pre', overflowWrap: 'anywhere', overflow: 'hidden' }} aria-label={activeTextEdit.isNew ? 'Add text to PDF' : 'Replace PDF paragraph'} placeholder={activeTextEdit.isNew ? 'Type text…' : ''} onBlur={(event) => { if (event.relatedTarget?.closest?.('.pdf-text-format-ribbon, .text-style-control, .text-style-toggle, .pdf-text-box-resize, .pdf-text-highlight-controls')) return; commitTextEdit(event) }} onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && ['b', 'i'].includes(event.key.toLowerCase())) { event.preventDefault(); const key = event.key.toLowerCase() === 'b' ? 'bold' : 'italic'; onTextStyleActivate?.({ ...textStyle, [key]: !textStyle?.[key] }); return } if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); commitTextEdit(event) } if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setActiveTextEdit(null); setSelectedText(null) } }} />
      <span className="pdf-text-live-handles" style={{ left: `${activeInputLayout.visualLeft * 100}%`, top: `${activeInputLayout.visualTop * 100}%`, width: `${activeInputLayout.visualWidth * 100}%`, height: `${activeInputLayout.visualHeight * 100}%` }}>{['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'].map((edge) => <span key={edge} className={`pdf-text-box-resize edge-${edge}`} role="presentation" onPointerDown={(event) => startBoxGesture(event, { ...activeTextEdit, text: activeTextEdit.value }, edge)} onPointerMove={moveBoxGesture} onPointerUp={endBoxGesture} onPointerCancel={endBoxGesture} />)}</span>
    </>}
    {error && <p className="form-error" role="alert">{error} <button type="button" onClick={() => setRenderRetry(n => n + 1)}>Retry page</button></p>}
  </div>
}

function PageThumbnailList({ file, pageCount, currentPage, onSelectPage }) {
  const list = useRef(null)
  const [scrollTop, setScrollTop] = useState(0)
  const totalPages = Math.max(pageCount, 0)
  const itemHeight = 184
  const visibleCount = Math.ceil((list.current?.clientHeight || 500) / itemHeight) + 6
  const start = Math.max(0, Math.floor(scrollTop / itemHeight) - 3)
  const end = Math.min(totalPages, start + visibleCount)
  useEffect(() => {
    const element = list.current
    if (!element || !currentPage) return
    const top = (currentPage - 1) * itemHeight
    if (top < element.scrollTop || top + itemHeight > element.scrollTop + element.clientHeight) element.scrollTop = Math.max(0, top - element.clientHeight / 2)
  }, [currentPage, pageCount])
  return <div className="acrobat-page-list" ref={list} onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}>
    <div aria-hidden="true" style={{ height: start * itemHeight }} />
    {Array.from({ length: Math.max(0, end - start) }, (_, offset) => {
      const pageNumber = start + offset + 1
      return <button type="button" key={pageNumber} className={`acrobat-page-thumb ${currentPage === pageNumber ? 'active' : ''}`} style={{ height: itemHeight }} onClick={() => onSelectPage(pageNumber)} aria-label={`Go to page ${pageNumber}`} aria-current={currentPage === pageNumber ? 'page' : undefined}>
        <PageThumbnail file={file} pageNumber={pageNumber} root={list} />
        <span>{pageNumber}</span>
      </button>
    })}
    <div aria-hidden="true" style={{ height: Math.max(0, totalPages - end) * itemHeight }} />
  </div>
}

function PageThumbnail({ file, pageNumber, pageSize, root }) {
  const canvas = useRef(null)
  const [visible, setVisible] = useState(false)
  const [previewError, setPreviewError] = useState(false)
  useEffect(() => {
    const element = canvas.current
    if (!element) return
    if (!('IntersectionObserver' in window)) { setVisible(true); return }
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setVisible(true); observer.disconnect() }
    }, { root: root.current, rootMargin: '160px 0px' })
    observer.observe(element)
    return () => observer.disconnect()
  }, [root])
  useEffect(() => {
    if (!visible || !canvas.current) return
    const target = canvas.current, job = new AbortController()
    setPreviewError(false)
    import('../pdfEngine').then(({ renderPdfThumbnail }) => job.signal.aborted ? null : renderPdfThumbnail(file, pageNumber, target, 168, 5, { signal: job.signal }))
      .then(result => { if (!job.signal.aborted && result?.status === 'FAILED') setPreviewError(true) })
      .catch(() => { if (!job.signal.aborted) setPreviewError(true) })
    return () => { job.abort(); target.width = 0; target.height = 0 }
  }, [file, pageNumber, visible])
  return <span className="acrobat-thumb-paper" aria-hidden="true"><canvas ref={canvas} aria-hidden="true" />{previewError && <span className="thumbnail-error">Preview unavailable</span>}</span>
}
