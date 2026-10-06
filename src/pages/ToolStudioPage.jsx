import React, { useEffect, useRef, useState } from 'react'
import { Icon } from '../icons'
import { ToolCard } from '../components/ToolCard'
import { allTools } from '../toolsData'
import { rememberPdf, saveOutput } from '../fileServices'

const EMPTY_FILES = []

const inputAccept = (toolId) => {
  if (toolId === 'jpg-to-pdf') return 'image/jpeg,image/png,.jpg,.jpeg,.png'
  if (toolId === 'word-to-pdf') return '.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  if (toolId === 'excel-to-pdf') return '.xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv'
  if (toolId === 'merge-pdf') return 'application/pdf,.pdf'
  return 'application/pdf,.pdf'
}

const formatBytes = (size) => size < 1024 * 1024 ? `${Math.max(1, Math.round(size / 1024))} KB` : `${(size / 1024 / 1024).toFixed(2)} MB`
const createInitialOptions = () => ({
  pages: '', ranges: '1-3', splitMode: 'ranges', rotation: 90, watermarkText: 'CONFIDENTIAL',
  opacity: 35, angle: 45, position: 'bottom-center', startNumber: 1, format: 'jpg', dpi: 144,
  quality: 'recommended', margins: { top: 10, right: 15, bottom: 10, left: 15 },
  language: 'eng', ocrDpi: 200,
  signature: '', annotationText: '', password: '', confirmPassword: '', pageSize: 'a4',
  redactPage: '1', redactX: 0, redactY: 0, redactWidth: 0, redactHeight: 0,
  signaturePage: '1', annotationPage: '1', bookmarksText: '',
})

export function ToolStudioPage({ toolId, initialFiles = EMPTY_FILES, openPicker = false, onNavigate, onSelectTool }) {
  const tool = allTools.find((item) => item.id === toolId) || allTools[0]
  const picker = useRef(null)
  const [files, setFiles] = useState(initialFiles)
  const [options, setOptions] = useState(createInitialOptions)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [outputs, setOutputs] = useState([])
  const [pageCount, setPageCount] = useState(null)
  const [formFields, setFormFields] = useState([])
  const [progress, setProgress] = useState(null)
  const [redactMarked, setRedactMarked] = useState(false)
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    setFiles(initialFiles)
    setOutputs([])
    setError('')
    setMessage('')
    setPageCount(null)
    setRedactMarked(false)
  }, [toolId, initialFiles])

  useEffect(() => {
    if (['protect-pdf', 'unlock-pdf', 'redact-pdf'].includes(toolId)) return
    initialFiles.forEach((file) => rememberPdf(file).catch(() => {}))
  }, [toolId, initialFiles])

  useEffect(() => {
    if (!openPicker) return
    picker.current?.click()
    onNavigate({ type: 'tool', toolId, openPicker: false })
  }, [openPicker, onNavigate, toolId])

  useEffect(() => {
    let active = true
    if (files.length === 1 && files[0].name.toLowerCase().endsWith('.pdf')) {
      import('../pdfEngine').then(({ inspectPdf }) => inspectPdf(files[0])).then((info) => { if (active) setPageCount(info.pageCount) }).catch(() => { if (active) setPageCount(null) })
    } else setPageCount(null)
    return () => { active = false }
  }, [files])

  useEffect(() => {
    let active = true
    if (toolId === 'fill-forms' && files.length === 1) {
      import('../pdfEngine').then(({ inspectPdfForm }) => inspectPdfForm(files[0])).then((fields) => { if (active) setFormFields(fields) }).catch((cause) => { if (active) { setFormFields([]); setError(cause.message || 'Could not read PDF form fields.') } })
    } else setFormFields([])
    return () => { active = false }
  }, [toolId, files])

  const setOption = (key, value) => setOptions((current) => ({ ...current, [key]: value }))
  const addFiles = (incoming) => {
    const picked = Array.from(incoming || [])
    if (!picked.length) return
    const multi = tool.kind === 'merge' || tool.id === 'jpg-to-pdf'
    const next = multi ? [...files, ...picked] : picked.slice(0, 1)
    const allowed = next.find((file) => !accepts(toolId, file))
    if (allowed) {
      setError(`“${allowed.name}” is not a supported file for ${tool.name}.`)
      return
    }
    setError('')
    setOutputs([])
    setFiles(next)
    if (!['protect-pdf', 'unlock-pdf', 'redact-pdf'].includes(toolId) && next.length === 1) rememberPdf(next[0]).catch(() => {})
  }

  const run = async () => {
    if (!files.length) { picker.current?.click(); return }
    setBusy(true)
    setError('')
    setProgress({ value: 0, message: 'Preparing the operation…' })
    setMessage('Processing on this device…')
    setOutputs([])
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
      const result = await processTool({ toolId, files, options: runOptions, onProgress: (state) => { setProgress(state); setMessage(state.message) } })
      setOutputs(result.outputs || [])
      setMessage(result.message || `${result.outputs?.length || 0} output file${result.outputs?.length === 1 ? '' : 's'} ready.`)
      setProgress(null)
    } catch (cause) {
      setProgress(null)
      setMessage('')
      setError(cause?.message || 'The document could not be processed.')
    } finally {
      setBusy(false)
    }
  }

  const save = async (output) => {
    try {
      const result = await saveOutput(output, { recordRecent: toolId !== 'unlock-pdf' })
      if (result) setMessage(`Saved ${output.name}`)
    } catch (cause) { setError(cause?.message || 'Could not save the output file.') }
  }

  useEffect(() => {
    const handleSaveShortcut = async (event) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 's' || !outputs.length) return
      event.preventDefault()
      for (const output of outputs) await save(output)
    }
    window.addEventListener('keydown', handleSaveShortcut)
    return () => window.removeEventListener('keydown', handleSaveShortcut)
  }, [outputs])

  const related = allTools.filter((item) => item.id !== tool.id && item.category === tool.category).slice(0, 4)

  return (
    <div className="page-content tool-studio-page">
      <div className="studio-header">
        <span className={`tool-icon ${tool.tone} studio-main-icon`}><Icon name={tool.icon} size={25} /></span>
        <div className="studio-header-details">
          <div className="studio-title-row"><h1>{tool.name}</h1></div>
          <p className="studio-description">{tool.description}</p>
        </div>
      </div>

      <div className="studio-workspace functional-workspace">
        <section className="studio-canvas-area functional-canvas">
          {!files.length ? (
            <div className={`studio-dropzone ${dragging ? 'dragging' : ''}`} onClick={() => picker.current?.click()}
              role="button" tabIndex={0} aria-label={`Choose a file for ${tool.name}`}
              onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); picker.current?.click() } }}
              onDragOver={(event) => { event.preventDefault(); setDragging(true) }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => { event.preventDefault(); setDragging(false); addFiles(event.dataTransfer.files) }}>
              <div className="studio-drop-icon"><Icon name="upload" size={27} /></div>
              <strong>Choose {tool.kind === 'merge' ? 'PDF files' : 'a file'} to begin</strong>
              <span>{tool.kind === 'merge' ? 'Select two or more PDFs and arrange their order below.' : 'Drop a file here or use the file picker. Processing is local.'}</span>
              <button className="browse-button studio-browse-btn" type="button" onClick={(event) => { event.stopPropagation(); picker.current?.click() }}>Choose file <Icon name="arrow" size={14} /></button>
            </div>
          ) : (
            <div className="functional-file-panel">
              <div className="loaded-file-bar">
                <div className="file-info-badge"><Icon name="file" size={16} /><strong>{files.length === 1 ? files[0].name : `${files.length} files selected`}</strong>
                  <span className="file-size-pill">{files.length === 1 && pageCount ? `${pageCount} pages · ` : ''}{formatBytes(files.reduce((total, file) => total + file.size, 0))}</span></div>
                <button className="ghost-button" type="button" onClick={() => { setFiles([]); setPageCount(null); setOutputs([]); setError(''); setMessage('') }}>Remove</button>
              </div>
              {files.length > 1 && <ol className="selected-file-list">{files.map((file, index) => <li key={`${file.name}-${index}`}><span>{index + 1}. {file.name}</span><div className="file-order-actions"><button type="button" aria-label={`Move ${file.name} up`} disabled={index === 0} onClick={() => setFiles((current) => moveFile(current, index, -1))}>↑</button><button type="button" aria-label={`Move ${file.name} down`} disabled={index === files.length - 1} onClick={() => setFiles((current) => moveFile(current, index, 1))}>↓</button><button type="button" aria-label={`Remove ${file.name}`} onClick={() => setFiles((current) => current.filter((_, i) => i !== index))}>×</button></div></li>)}</ol>}
              {tool.kind === 'merge' && <button className="ghost-button" type="button" onClick={() => picker.current?.click()}>Add another PDF</button>}
              {pageCount && <div className="document-summary"><Icon name="pages" size={18} /><div><strong>PDF loaded and readable</strong><span>{pageCount} page{pageCount === 1 ? '' : 's'} · {formatBytes(files[0].size)}</span></div></div>}
              {['pdf-editor', 'sign-pdf'].includes(toolId) && files.length === 1 && pageCount && <PdfViewer file={files[0]} page={Number(toolId === 'sign-pdf' ? options.signaturePage : options.annotationPage) || 1} pageCount={pageCount} onPageChange={(page) => setOption(toolId === 'sign-pdf' ? 'signaturePage' : 'annotationPage', String(page))} />}
              {toolId === 'redact-pdf' && files.length === 1 && <RedactionPreview file={files[0]} page={Number(options.redactPage)} redaction={redactMarked ? options : null} onMark={(rect) => { setOption('redactX', rect.x); setOption('redactY', rect.y); setOption('redactWidth', rect.width); setOption('redactHeight', rect.height); setRedactMarked(true) }} />}
            </div>
          )}
          <input ref={picker} hidden type="file" multiple={tool.kind === 'merge' || toolId === 'jpg-to-pdf'} accept={inputAccept(toolId)} onChange={(event) => { addFiles(event.target.files); event.target.value = '' }} />
          {error && <div className="operation-error" role="alert">{error}</div>}
          {message && <div className="operation-message" role="status">{message}{progress && <progress value={progress.value} max="1" />}</div>}
          {outputs.length > 0 && <div className="output-list"><h3>Ready to save</h3>{outputs.map((output) => <div className="output-row" key={output.name}><span><Icon name="file" size={15} />{output.name}<small>{formatBytes(output.data.byteLength)}</small></span><button className="browse-button" type="button" onClick={() => save(output)}>Save file <Icon name="arrow" size={14} /></button></div>)}</div>}
        </section>

        <aside className="studio-options-panel functional-options">
          <div className="panel-title-row"><Icon name="sliders" size={16} /><h3>Options</h3></div>
          <ToolOptions toolId={toolId} options={options} setOption={setOption} pageCount={pageCount} formFields={formFields} />
          <div className="studio-action-buttons">
            <button className="primary-action-btn" type="button" onClick={run} disabled={busy}>{busy && <span className="btn-spinner" />}<span>{busy ? 'Processing…' : files.length ? tool.actionName : 'Choose a file'}</span></button>
            {files.length > 0 && <button className="reset-button" type="button" onClick={() => { setOptions(createInitialOptions()); setRedactMarked(false); setError(''); setMessage(''); setOutputs([]) }}>Reset options</button>}
          </div>
        </aside>
      </div>

    </div>
  )
}

const EDITOR_TOOLS = [
  ['pdf-editor', 'Text'], ['sign-pdf', 'Sign'], ['add-watermark', 'Watermark'],
  ['page-numbers', 'Page numbers'], ['redact-pdf', 'Redact'], ['fill-forms', 'Fill forms'],
  ['crop-pdf', 'Crop'], ['rotate-pages', 'Rotate'],
]

/** Full-window document workspace used for opening and editing PDFs. */
export function PdfEditorWorkspace({ initialFiles = EMPTY_FILES, openPicker = false, initialTool = 'pdf-editor', onExit }) {
  const picker = useRef(null)
  const [files, setFiles] = useState(initialFiles)
  const [toolId, setToolId] = useState(initialTool)
  const [options, setOptions] = useState(createInitialOptions)
  const [pageCount, setPageCount] = useState(0)
  const [formFields, setFormFields] = useState([])
  const [outputs, setOutputs] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [redaction, setRedaction] = useState(null)
  const file = files[0]

  useEffect(() => { setFiles(initialFiles); setOutputs([]); setError(''); setMessage('') }, [initialFiles])
  useEffect(() => { setToolId(initialTool) }, [initialTool])
  useEffect(() => {
    if (openPicker) picker.current?.click()
  }, [openPicker])
  useEffect(() => {
    let active = true
    if (!file) { setPageCount(0); return () => { active = false } }
    import('../pdfEngine').then(({ inspectPdf }) => inspectPdf(file)).then((info) => { if (active) setPageCount(info.pageCount) })
      .catch((cause) => { if (active) setError(cause.message || 'Could not read this PDF.') })
    rememberPdf(file).catch(() => {})
    return () => { active = false }
  }, [file])
  useEffect(() => {
    let active = true
    if (toolId === 'fill-forms' && file) import('../pdfEngine').then(({ inspectPdfForm }) => inspectPdfForm(file))
      .then((fields) => { if (active) setFormFields(fields) }).catch((cause) => { if (active) setError(cause.message || 'Could not read form fields.') })
    else setFormFields([])
    return () => { active = false }
  }, [toolId, file])

  const setOption = (key, value) => setOptions((current) => ({ ...current, [key]: value }))
  const addFile = (incoming) => {
    const next = Array.from(incoming || []).find((item) => item.type === 'application/pdf' || /\.pdf$/i.test(item.name))
    if (!next) return
    setFiles([next]); setOutputs([]); setError(''); setMessage(''); setRedaction(null)
  }
  const run = async () => {
    if (!file) { picker.current?.click(); return }
    setBusy(true); setError(''); setMessage('Applying changes…'); setOutputs([])
    try {
      const runOptions = {
        ...options,
        ...(toolId === 'add-watermark' ? { opacity: Number(options.opacity) / 100, text: options.watermarkText } : {}),
        ...(toolId === 'redact-pdf' ? { redactions: redaction ? [{ ...redaction, page: Number(options.redactPage), normalized: true }] : [] } : {}),
      }
      const { processTool } = await import('../pdfEngine')
      const result = await processTool({ toolId, files, options: runOptions })
      setOutputs(result.outputs || []); setMessage(result.message || 'Your edited PDF is ready to save.')
    } catch (cause) { setMessage(''); setError(cause.message || 'Could not apply these changes.') }
    finally { setBusy(false) }
  }
  const save = async () => {
    if (!outputs[0]) return
    try { await saveOutput(outputs[0]); setMessage(`Saved ${outputs[0].name}`) }
    catch (cause) { setError(cause.message || 'Could not save the edited PDF.') }
  }
  const pageOptionKey = toolId === 'sign-pdf' ? 'signaturePage' : 'annotationPage'
  const viewerPage = Number(options[toolId === 'redact-pdf' ? 'redactPage' : pageOptionKey]) || 1
  const navPage = (page) => setOption(toolId === 'redact-pdf' ? 'redactPage' : pageOptionKey, String(page))

  return <main className="pdf-editor-workspace">
    <header className="pdf-editor-header">
      <button className="editor-exit" type="button" onClick={onExit} aria-label="Close PDF editor" title="Back to workspace"><Icon name="arrowLeft" size={17} /></button>
      <div className="editor-document-title"><Icon name="file" size={17} /><span title={file?.name || 'PDF editor'}>{file?.name || 'Open a PDF to begin editing'}</span></div>
      <div className="editor-header-actions">
        <button className="editor-open-button" type="button" onClick={() => picker.current?.click()}><Icon name="upload" size={15} /> Open PDF</button>
        <button className="editor-save-button" type="button" onClick={outputs.length ? save : run} disabled={busy || (!file && !outputs.length)}>{busy ? 'Applying…' : outputs.length ? 'Save edited PDF' : 'Apply & save'}</button>
      </div>
      <input ref={picker} hidden type="file" accept="application/pdf,.pdf" onChange={(event) => { addFile(event.target.files); event.target.value = '' }} />
    </header>

    <nav className="pdf-editor-tools" aria-label="PDF editing tools">
      {EDITOR_TOOLS.map(([id, label]) => <button type="button" key={id} className={toolId === id ? 'active' : ''} aria-pressed={toolId === id} onClick={() => { setToolId(id); setError(''); setMessage(''); setOutputs([]) }}>{label}</button>)}
    </nav>
    <div className="pdf-editor-options">
      <div className="editor-options-label">{EDITOR_TOOLS.find(([id]) => id === toolId)?.[1]} options</div>
      <div className="editor-options-fields"><ToolOptions toolId={toolId} options={options} setOption={setOption} pageCount={pageCount} formFields={formFields} /></div>
      <button className="editor-apply-inline" type="button" onClick={outputs.length ? save : run} disabled={busy || !file}>{outputs.length ? 'Save PDF' : busy ? 'Applying…' : 'Apply'}</button>
    </div>

    <section className="pdf-editor-stage" aria-label="PDF page viewer">
      {file && <>
        <aside className="acrobat-page-panel" aria-label="Page thumbnails">
          <div className="acrobat-panel-heading"><span>Pages</span><button type="button" title="Collapse page panel" aria-label="Collapse page panel">‹</button></div>
          <div className="acrobat-page-list">{Array.from({ length: Math.max(pageCount, 1) }, (_, index) => <button type="button" key={index} className={`acrobat-page-thumb ${viewerPage === index + 1 ? 'active' : ''}`} onClick={() => navPage(index + 1)} aria-label={`Go to page ${index + 1}`} aria-current={viewerPage === index + 1 ? 'page' : undefined}><span className="acrobat-thumb-paper"><i /><i /><i /><i /></span><span>{index + 1}</span></button>)}</div>
        </aside>
        <div className="acrobat-quick-tools" aria-label="Quick tools"><button type="button" className="selected" title="Select tool">↖</button><button type="button" title="Comment">▱</button><button type="button" title="Draw">✎</button><button type="button" title="Add text">T</button></div>
      </>}
      {!file ? <button type="button" className="editor-open-empty" onClick={() => picker.current?.click()}><span className="editor-empty-icon"><Icon name="upload" size={24} /></span><strong>Open a PDF to start editing</strong><span>Your document stays on this device while you work.</span><b>Choose PDF</b></button> : toolId === 'redact-pdf' ? <RedactionPreview file={file} page={viewerPage} redaction={redaction && { redactX: redaction.x, redactY: redaction.y, redactWidth: redaction.width, redactHeight: redaction.height }} onMark={setRedaction} /> : <PdfViewer file={file} page={viewerPage} pageCount={pageCount} onPageChange={navPage} />}
    </section>
    {(error || message) && <div className={`pdf-editor-status ${error ? 'is-error' : ''}`} role={error ? 'alert' : 'status'}>{error || message}</div>}
    {outputs.length > 0 && <div className="pdf-editor-output"><span>{outputs[0].name} is ready</span><button type="button" onClick={save}>Save PDF</button></div>}
  </main>
}

function accepts(toolId, file) {
  if (toolId === 'jpg-to-pdf') return /^image\/(jpeg|png)$/.test(file.type) || /\.(jpe?g|png)$/i.test(file.name)
  if (toolId === 'word-to-pdf') return /\.docx$/i.test(file.name)
  if (toolId === 'excel-to-pdf') return /\.(xlsx|csv)$/i.test(file.name)
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name)
}

function moveFile(files, index, offset) {
  const next = [...files]
  const target = index + offset
  if (target < 0 || target >= next.length) return next
  ;[next[index], next[target]] = [next[target], next[index]]
  return next
}

function ToolOptions({ toolId, options, setOption, pageCount, formFields = [] }) {
  const field = (label, key, placeholder = '') => <label className="tool-field">{label}<input className="studio-input" value={options[key]} onChange={(event) => setOption(key, event.target.value)} placeholder={placeholder} /></label>
  const select = (label, key, choices) => <label className="tool-field">{label}<select className="studio-input" value={options[key]} onChange={(event) => setOption(key, event.target.value)}>{choices.map(([value, text]) => <option value={value} key={value}>{text}</option>)}</select></label>
  const note = (text) => <p className="option-note">{text}</p>
  switch (toolId) {
    case 'merge-pdf': return <>{note('Files are combined in the order listed. Use Add another PDF to include more.')}</>
    case 'split-pdf': return <>{select('Split method', 'splitMode', [['ranges', 'Extract page ranges'], ['each', 'One PDF per page']])}{options.splitMode === 'ranges' && field('Page ranges', 'ranges', '1-3, 5')}</>
    case 'extract-pages': return <>{field(`Pages to extract${pageCount ? ` (1–${pageCount})` : ''}`, 'pages', '1-3, 5')}{note('Use commas for separate pages and hyphens for ranges.')}</>
    case 'delete-pages': return <>{field(`Pages to delete${pageCount ? ` (1–${pageCount})` : ''}`, 'pages', '2, 4-6')}</>
    case 'duplicate-pages': return <>{field('Pages to duplicate', 'pages', '1, 3')}{note('Copies are appended to the end of the document.')}</>
    case 'organize-pdf': return <>{field(`New page order${pageCount ? ` (1–${pageCount})` : ''}`, 'pages', '3, 1-2, 4')}{note('Enter every page in the order you want, separated by commas. Repeat a page number to duplicate it, or leave a page out to remove it.')}</>
    case 'rotate-pages': return <>{select('Rotation', 'rotation', [[90, '90° clockwise'], [180, '180°'], [270, '270° clockwise']])}{field('Pages (blank means all)', 'pages', '1, 3-5')}</>
    case 'crop-pdf': return <>{['top', 'right', 'bottom', 'left'].map((side) => <label className="tool-field" key={side}>{side} margin (mm)<input className="studio-input" type="number" min="0" max="200" value={options.margins[side]} onChange={(event) => setOption('margins', { ...options.margins, [side]: Number(event.target.value) })} /></label>)}</>
    case 'add-watermark': return <>{field('Watermark text', 'watermarkText', 'CONFIDENTIAL')}<label className="tool-field">Opacity · {options.opacity}%<input type="range" min="10" max="100" value={options.opacity} onChange={(event) => setOption('opacity', Number(event.target.value))} /></label>{select('Angle', 'angle', [[0, 'Horizontal'], [45, '45°'], [90, '90°']])}</>
    case 'page-numbers': return <>{select('Position', 'position', ['top-left', 'top-center', 'top-right', 'bottom-left', 'bottom-center', 'bottom-right'].map((value) => [value, value.replace('-', ' ')]))}{field('First page number', 'startNumber', '1')}</>
    case 'compress-pdf': return <>{select('Compression mode', 'quality', [['lossless', 'Lossless · preserve page content'], ['high', 'High visual quality'], ['recommended', 'Balanced'], ['small', 'Smallest raster output']])}{note(options.quality === 'lossless' ? 'Recompresses streams without rasterizing pages. Size reduction depends on the source PDF.' : 'Raster modes rebuild pages as images. Text selection, links, vectors, forms, and accessibility data are removed.')}</>
    case 'pdf-to-jpg': return <>{select('Image format', 'format', [['jpg', 'JPEG'], ['png', 'PNG']])}{select('Resolution', 'dpi', [[72, '72 DPI'], [108, '108 DPI'], [144, '144 DPI'], [216, '216 DPI']])}</>
    case 'jpg-to-pdf': return <>{select('Page size', 'pageSize', [['a4', 'A4'], ['letter', 'Letter'], ['fit', 'Fit to image']])}{note('Each selected image becomes one PDF page.')}</>
    case 'ocr-pdf': return <>{select('OCR language', 'language', OCR_LANGUAGES)}{select('Recognition quality', 'ocrDpi', [[150, 'Fast · 150 DPI'], [200, 'Balanced · 200 DPI'], [300, 'High · 300 DPI']])}{note('Extracts text from scanned pages into a plain-text file. OCR runs on this device; language data downloads the first time you use each language.')}</>
    case 'pdf-to-word': return <>{select('OCR language for scanned pages', 'language', OCR_LANGUAGES)}{note('Exports editable text with approximate font styling and placement. Scanned pages are recognized with OCR; complex layouts may need cleanup in Word.')}</>
    case 'pdf-to-excel': return <>{select('OCR language for scanned pages', 'language', OCR_LANGUAGES)}{note('Exports text into a workbook and uses OCR for scanned pages. It does not detect or reconstruct table structure.')}</>
    case 'word-to-pdf': return note('Converts DOCX text and paragraphs to PDF. Original page layout, images, and advanced styling may not be preserved.')
    case 'excel-to-pdf': return note('Exports workbook cell values as a simple paginated PDF table.')
    case 'flatten-pdf': return note('Flattens interactive form fields into the page appearance.')
    case 'repair-pdf': return note('Reopens and rebuilds PDFs the parser can still read. Severely damaged files may not be recoverable.')
    case 'redact-pdf': return <>{field('Page number', 'redactPage', '1')}{note('Drag across the page preview to mark the area. Applying redaction rasterizes the document and removes its searchable content.')}</>
    case 'protect-pdf': return <><label className="tool-field">New password<input className="studio-input" type="password" autoComplete="new-password" value={options.password} onChange={(event) => setOption('password', event.target.value)} /></label><label className="tool-field">Confirm password<input className="studio-input" type="password" autoComplete="new-password" value={options.confirmPassword} onChange={(event) => setOption('confirmPassword', event.target.value)} /></label>{note('Applies AES-256 PDF encryption locally. Use at least 8 characters and keep the password safe; it cannot be recovered.')}</>
    case 'unlock-pdf': return <><label className="tool-field">Current PDF password<input className="studio-input" type="password" autoComplete="current-password" value={options.password} onChange={(event) => setOption('password', event.target.value)} /></label>{note('Removes PDF encryption using the password you provide. It does not bypass or guess passwords.')}</>
    case 'edit-bookmarks': return <><label className="tool-field">Bookmarks · one per line as “page: title”<textarea className="studio-input" rows="8" value={options.bookmarksText} onChange={(event) => setOption('bookmarksText', event.target.value)} placeholder={'1: Introduction\n3: Results\n8: Appendix'} /></label>{note('Creates a new top-level outline and replaces any existing bookmarks.')}</>
    case 'fill-forms': return formFields.length ? <>{note(`${formFields.length} interactive field${formFields.length === 1 ? '' : 's'} found.`)}{formFields.map((field) => {
      const value = options.fields?.[field.name] ?? field.value ?? ''
      const update = (next) => setOption('fields', { ...(options.fields || {}), [field.name]: next })
      if (field.type.includes('CheckBox')) return <label className="option-check-row" key={field.name}><input type="checkbox" checked={Boolean(value)} onChange={(event) => update(event.target.checked)} /><span>{field.name}</span></label>
      if (field.choices?.length) return <label className="tool-field" key={field.name}>{field.name}<select className="studio-input" value={value} onChange={(event) => update(event.target.value)}>{field.choices.map((choice) => <option key={choice} value={choice}>{choice}</option>)}</select></label>
      return <label className="tool-field" key={field.name}>{field.name}<input className="studio-input" value={value} onChange={(event) => update(event.target.value)} /></label>
    })}</> : note('Select a PDF with interactive form fields. This PDF has no editable AcroForm fields, or its form could not be read.')
    case 'sign-pdf': return <>{field('Typed signature', 'signature', 'Your full name')}{field('Page number', 'signaturePage', '1')}{note('Adds a visible typed signature. It is not a certificate-based digital signature.')}</>
    case 'pdf-editor': return <>{field('Text to add', 'annotationText', 'Add a note to this PDF')}{field('Page number', 'annotationPage', '1')}{note('Adds text to the selected page. Existing page text is not directly editable.')}</>
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

  useEffect(() => {
    let active = true
    if (!canvas.current) return () => { active = false }
    import('../pdfEngine').then(({ renderPdfPage }) => renderPdfPage(file, page, canvas.current, 0.95)).then(() => { if (active) setError('') }).catch((cause) => { if (active) setError(cause.message || 'Could not render this PDF page.') })
    return () => { active = false }
  }, [file, page])

  const point = (event) => {
    const bounds = canvas.current.getBoundingClientRect()
    return { x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)), y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)) }
  }
  const pointerDown = (event) => { event.currentTarget.setPointerCapture(event.pointerId); dragStart.current = point(event); onMark({ x: dragStart.current.x, y: dragStart.current.y, width: 0, height: 0 }) }
  const pointerMove = (event) => {
    if (!dragStart.current || !event.currentTarget.hasPointerCapture(event.pointerId)) return
    const end = point(event)
    onMark({ x: Math.min(dragStart.current.x, end.x), y: Math.min(dragStart.current.y, end.y), width: Math.abs(end.x - dragStart.current.x), height: Math.abs(end.y - dragStart.current.y) })
  }
  const pointerUp = (event) => {
    pointerMove(event)
    dragStart.current = null
  }
  return <div className="redaction-preview-panel"><strong>Mark redaction on page {page}</strong><div className="redaction-canvas-wrap"><canvas ref={canvas} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} />{redaction && redaction.redactWidth > 0 && redaction.redactHeight > 0 && <div className="redaction-mask-preview" style={{ left: `${redaction.redactX * 100}%`, top: `${redaction.redactY * 100}%`, width: `${redaction.redactWidth * 100}%`, height: `${redaction.redactHeight * 100}%` }} />}</div>{error && <p className="form-error">{error}</p>}<small>Drag a rectangle over the confidential content.</small></div>
}

function PdfViewer({ file, page, pageCount, onPageChange }) {
  const canvas = useRef(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    if (!canvas.current) return () => { active = false }
    import('../pdfEngine').then(({ renderPdfPage }) => renderPdfPage(file, page, canvas.current, 1.25))
      .then(() => { if (active) setError('') })
      .catch((cause) => { if (active) setError(cause.message || 'Could not render this PDF page.') })
    return () => { active = false }
  }, [file, page])

  return <section className="pdf-viewer" aria-label="PDF viewer">
    <div className="pdf-viewer-toolbar">
      <strong>Document preview</strong>
      <div className="pdf-viewer-pagination">
        <button type="button" aria-label="Previous page" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>‹</button>
        <span>Page <b>{page}</b> of {pageCount}</span>
        <button type="button" aria-label="Next page" disabled={page >= pageCount} onClick={() => onPageChange(page + 1)}>›</button>
      </div>
    </div>
    <div className="pdf-viewer-page"><canvas ref={canvas} />{error && <p className="form-error" role="alert">{error}</p>}</div>
  </section>
}
