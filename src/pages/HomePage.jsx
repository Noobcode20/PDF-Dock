import React, { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '../icons'
import { Presence } from '../components/Presence'
import { printPdfDocument } from '../fileServices'
import { recentFilesBackend } from '../recentFiles'

const formatBytes = (size) => size < 1024 * 1024 ? `${Math.max(1, Math.round(size / 1024))} KB` : `${(size / 1024 / 1024).toFixed(2)} MB`
const previewFrameForCanvas = (canvas, previousFrame = null) => {
  const rect = canvas.getBoundingClientRect()
  const ratio = canvas.width / Math.max(1, canvas.height)
  const height = Math.max(120, window.innerHeight - 20)
  const width = Math.min(height * ratio, window.innerWidth - 20)
  return {
    fromTop: previousFrame?.fromTop ?? rect.top,
    fromLeft: previousFrame?.fromLeft ?? rect.left,
    fromWidth: previousFrame?.fromWidth ?? rect.width,
    fromHeight: previousFrame?.fromHeight ?? rect.height,
    toTop: (window.innerHeight - height) / 2,
    toLeft: (window.innerWidth - width) / 2,
    toWidth: width,
    toHeight: height,
    controlsCenter: (window.innerWidth - width) / 2 + width / 2,
  }
}
const relativeDate = (value) => {
  const time = new Date(value).getTime()
  if (!Number.isFinite(time)) return ''
  const hours = Math.floor((Date.now() - time) / 3600000)
  if (hours < 1) return 'just now'
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.floor(hours / 24)
  return days === 1 ? 'yesterday' : `${days} days ago`
}

function DocumentPreview({ record, page = 1, expanded = false, onOpenPreview, onClosePreview, onNavigatePage, onPageCountChange, selectedCount, onRemoveSelected, onOpenPdf, onOpenSelected, onRunFileAction, onPrintSelected, onFilesDropped }) {
  const canvasRef = useRef(null)
  const previousPageButtonRef = useRef(null)
  const nextPageButtonRef = useRef(null)
  const previewImageRef = useRef(null)
  const [preview, setPreview] = useState({ status: 'idle', pageCount: 0, error: '' })
  const [dragging, setDragging] = useState(false)
  const [previewOverlay, setPreviewOverlay] = useState(null)

  useEffect(() => {
    if (!expanded || previewOverlay || !canvasRef.current || preview.status !== 'ready') return
    const canvas = canvasRef.current
    const frame = previewFrameForCanvas(canvas)
    setPreviewOverlay({ src: canvas.toDataURL('image/png'), frame, closing: false })
  }, [expanded, previewOverlay, preview.status])

  useEffect(() => {
    if (expanded || !previewOverlay || previewOverlay.closing) return
    setPreviewOverlay((current) => current ? { ...current, closing: true } : null)
  }, [expanded, previewOverlay])

  useEffect(() => {
    if (!previewOverlay?.closing) return undefined
    const timer = window.setTimeout(() => {
      setPreviewOverlay(null)
      canvasRef.current?.focus()
    }, 560)
    return () => window.clearTimeout(timer)
  }, [previewOverlay?.closing])

  useEffect(() => {
    if (!previewOverlay || previewOverlay.closing) return
    if (page > 1) previousPageButtonRef.current?.focus()
    else if ((preview.pageCount || record?.pages || 0) > 1) nextPageButtonRef.current?.focus()
    else previewImageRef.current?.focus()
  }, [previewOverlay?.closing])

  useEffect(() => {
    let cancelled = false
    const canvas = canvasRef.current
    const backend = recentFilesBackend()
    if (!record || !canvas || !backend?.readRecentFile) {
      setPreview({ status: 'idle', pageCount: 0, error: '' })
      return () => { cancelled = true }
    }
    setPreview((current) => ({ ...current, status: 'loading', error: '' }))
    const controller = new AbortController()
    ;(async () => {
      try {
        const data = await backend.readRecentFile(record.id)
        if (cancelled) return
        if (!data) throw new Error('The PDF could not be read.')
        const file = new File([data], record.name, { type: 'application/pdf' })
        const { renderPdfThumbnail } = await import('../pdfEngine')
        if (cancelled) return
        const result = await renderPdfThumbnail(file, page, canvas, expanded ? 1200 : 520, 8, { signal: controller.signal })
        if (cancelled || result.status === 'CANCELLED') return
        if (result.status !== 'SUCCESS') throw result.error || new Error('Could not render this page.')
        const pageCount = result.pageCount || record.pages || 0
        setPreview({ status: 'ready', pageCount, error: '' })
        if (expanded) setPreviewOverlay((current) => current ? {
          ...current,
          src: canvas.toDataURL('image/png'),
          frame: previewFrameForCanvas(canvas, current.frame),
        } : current)
        onPageCountChange?.(record.id, pageCount)
      } catch (error) {
        if (!cancelled) setPreview({ status: 'error', pageCount: 0, error: error?.message || 'Could not preview this PDF.' })
      }
    })()
    return () => { cancelled = true; controller.abort() }
  }, [record?.id, record?.name, record?.pages, page, expanded, onPageCountChange])

  return (
    <aside className={`home-inspector${expanded ? ' is-expanded' : ''}`} aria-label="Document preview" data-pdf-id={record?.id} data-pdf-name={record?.name}>
      <div className="home-inspector-heading">
        <span className="home-inspector-indicator" />
        <span>DOCUMENT PREVIEW</span>
        {record && <span className="home-inspector-page">PAGE {page}</span>}
      </div>
      {record ? <>
        <div className="home-preview-sheet">
          <canvas
            className={expanded ? 'is-overlay-source' : ''}
            ref={canvasRef}
            aria-label={`Page ${page} preview of ${record.name}. Activate for full preview.`}
            role="button"
            tabIndex={0}
            onClick={onOpenPreview}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                onOpenPreview?.()
              }
            }}
          />
          {preview.status === 'loading' && <div className="home-preview-message">Rendering preview…</div>}
          {preview.status === 'error' && <div className="home-preview-message is-error">{preview.error}</div>}
        </div>
        <div className="home-preview-meta">
          <strong title={record.name}>{record.name}</strong>
          <span>{formatBytes(record.size || 0)}{preview.pageCount ? ` · ${preview.pageCount} ${preview.pageCount === 1 ? 'page' : 'pages'}` : ''}</span>
        </div>
      <p className="home-preview-hint">{expanded ? 'Use ↑ and ↓ to move between files, ← and → to move between pages. Press Escape to close preview.' : 'Double-click the file or press Enter to open it. Press Tab for full preview.'}</p>
      </> : <div className="home-preview-empty">
        <div><Icon name="fileText" size={22} /></div>
        <strong>Select a PDF</strong>
        <span>Click a recent file to preview its first page here.</span>
      </div>}
      {selectedCount > 0 ? <div className="home-inspector-actions home-inspector-selected">
        <div className="home-selected-count">Selected files <span>{selectedCount}</span></div>
        <div className="home-inspector-section-title">FILE ACTIONS</div>
        {selectedCount === 1 && <>
          <button className="home-file-action is-primary" type="button" onClick={onOpenSelected}><Icon name="export" size={15} />Open in editor</button>
          <button className="home-file-action" type="button" onClick={() => onRunFileAction('compress-pdf')}><Icon name="compress" size={15} />Compress PDF</button>
          <button className="home-file-action" type="button" onClick={() => onRunFileAction('split-pdf')}><Icon name="split" size={15} />Split PDF</button>
          <button className="home-file-action" type="button" onClick={onPrintSelected}><Icon name="print" size={15} />Print PDF</button>
        </>}
        {selectedCount > 1 && <>
          <button className="home-file-action is-primary" type="button" onClick={() => onRunFileAction('merge-pdf')}><Icon name="merge" size={15} />Merge {selectedCount} PDFs</button>
          <button className="home-file-action" type="button" onClick={() => onRunFileAction('compress-pdf')}><Icon name="compress" size={15} />Compress {selectedCount} PDFs</button>
        </>}
        <button className="home-selected-remove" type="button" onClick={onRemoveSelected}><Icon name="trash" size={14} />Remove {selectedCount} {selectedCount === 1 ? 'file' : 'files'}</button>
      </div> : !record ? <div className={`home-dropzone ${dragging ? 'is-dragging' : ''}`} onDragEnter={(event) => { event.preventDefault(); setDragging(true) }} onDragOver={(event) => event.preventDefault()} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setDragging(false) }} onDrop={(event) => { event.preventDefault(); setDragging(false); onFilesDropped(event.dataTransfer.files) }}>
        <Icon name="upload" size={22} />
        <strong>Drop PDF files here</strong>
        <span>Add files to your workspace to get started.</span>
        <button type="button" onClick={onOpenPdf}>Browse files</button>
      </div> : null}
      {previewOverlay && createPortal(<div className={`home-preview-overlay${previewOverlay.closing ? ' is-closing' : ''}`} onClick={(event) => {
        if (event.target === event.currentTarget) onClosePreview?.()
      }} onKeyDown={(event) => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClosePreview?.() }
        else if (event.key === 'Enter' && !event.repeat && !event.target.closest('button, a, input, textarea, select')) { event.preventDefault(); onClosePreview?.() }
      }} style={{
        '--preview-from-top': `${previewOverlay.frame.fromTop}px`,
        '--preview-from-left': `${previewOverlay.frame.fromLeft}px`,
        '--preview-from-width': `${previewOverlay.frame.fromWidth}px`,
        '--preview-from-height': `${previewOverlay.frame.fromHeight}px`,
        '--preview-to-top': `${previewOverlay.frame.toTop}px`,
        '--preview-to-left': `${previewOverlay.frame.toLeft}px`,
        '--preview-to-width': `${previewOverlay.frame.toWidth}px`,
        '--preview-to-height': `${previewOverlay.frame.toHeight}px`,
        '--preview-controls-center': `${previewOverlay.frame.controlsCenter}px`,
      }}>
        <button className="home-preview-overlay-backdrop" type="button" aria-label="Close full page preview" onClick={onClosePreview} />
        <img
          ref={previewImageRef}
          className="home-preview-growing-image"
          src={previewOverlay.src}
          alt={`Page ${page} of ${record?.name || 'PDF'}`}
          tabIndex={-1}
          onAnimationEnd={(event) => {
            if (event.animationName === 'home-preview-grow') setPreviewOverlay((current) => current ? { ...current, grown: true } : current)
          }}
          data-grown={previewOverlay.grown ? 'true' : undefined}
        />
        <div className="home-preview-page-controls" role="group" aria-label="PDF page navigation">
          <span className="home-preview-page-count">{page} <i>/</i> {preview.pageCount || record?.pages || '—'}</span>
          <button ref={previousPageButtonRef} type="button" className="home-preview-page-button" aria-label="Previous page" disabled={page <= 1} onClick={(event) => { event.preventDefault(); event.stopPropagation(); onNavigatePage?.(-1) }}>
            <Icon name="arrowLeft" size={17} />
          </button>
          <button ref={nextPageButtonRef} type="button" className="home-preview-page-button" aria-label="Next page" disabled={!preview.pageCount && !record?.pages || page >= (preview.pageCount || record?.pages || 0)} onClick={(event) => { event.preventDefault(); event.stopPropagation(); onNavigatePage?.(1) }}>
            <Icon name="arrowLeft" size={17} />
          </button>
        </div>
      </div>, document.body)}
    </aside>
  )
}

function ConfirmDialog({ isOpen, onClose, fileName, bulkCount = 0, onDelete }) {
  const acceptButton = useRef(null)
  useEffect(() => { if (isOpen) acceptButton.current?.focus() }, [isOpen])
  useEffect(() => {
    if (!isOpen) return undefined
    const handleDialogKeys = (event) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose() }
      else if (event.key === 'Enter' && !event.repeat) { event.preventDefault(); event.stopPropagation(); onDelete() }
    }
    window.addEventListener('keydown', handleDialogKeys, true)
    return () => window.removeEventListener('keydown', handleDialogKeys, true)
  }, [isOpen, onClose, onDelete])
  return (
    <Presence present={isOpen} exitDuration={180}><div className="confirm-backdrop" onClick={onClose}>
      <div className={`confirm-panel${bulkCount > 0 ? ' confirm-panel-bulk' : ''}`} role="dialog" aria-modal="true" aria-labelledby="remove-dialog-title" onClick={(e) => e.stopPropagation()} onKeyDown={(event) => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose() }
        if (event.key === 'Tab') {
          const controls = [...event.currentTarget.querySelectorAll('button:not(:disabled)')]
          if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls.at(-1)?.focus() }
          else if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0]?.focus() }
        }
      }}>
        <div className="confirm-heading">
          <div className="confirm-icon"><Icon name="trash" size={21} /></div>
          <h2 className="confirm-title" id="remove-dialog-title">Remove from library?</h2>
        </div>
        <p className="confirm-message">{bulkCount > 0 ? <>Remove <strong>{bulkCount} selected {bulkCount === 1 ? 'file' : 'files'}</strong> from your library? Their cached data will be cleared, but the original files will remain on your computer.</> : <>Remove <strong>{fileName}</strong> from your library? It will be deleted from the app cache but stay on your computer.</>}</p>
        <div className="confirm-actions">
          <button type="button" className="confirm-btn confirm-btn-cancel" onClick={onClose}><span className="confirm-btn-icon"><Icon name="x" size={14} /></span> Cancel <kbd>Esc</kbd></button>
          <button ref={acceptButton} autoFocus type="button" className="confirm-btn confirm-btn-delete" onClick={onDelete}><span className="confirm-btn-icon"><Icon name="trash" size={14} /></span> {bulkCount > 0 ? 'Remove files' : 'Remove'} <kbd>↵</kbd></button>
        </div>
      </div>
    </div></Presence>
  )
}

export function HomePage({ theme, onNavigate, onOpenPdf }) {
  const [files, setFiles] = useState([])
  const [error, setError] = useState('')
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [pendingFile, setPendingFile] = useState(null)
  const [selectedFiles, setSelectedFiles] = useState(() => new Set())
  const [query, setQuery] = useState('')
  const visibleFiles = files.filter((file) => file.name.toLowerCase().includes(query.trim().toLowerCase()))
  const [activeFileId, setActiveFileId] = useState(null)
  const [previewMode, setPreviewMode] = useState(false)
  const [previewPage, setPreviewPage] = useState(1)
  const [previewPageCount, setPreviewPageCount] = useState(0)
  const selectionAnchorId = useRef(null)
  const [selectionNotice, setSelectionNotice] = useState(false)
  const noticeTimer = useRef(null)
  const repeatClickTimer = useRef(null)
  const clickSequence = useRef({ fileId: null, count: 0 })
  const handlePreviewPageCount = useCallback((id, count) => {
    if (id === activeFileId) setPreviewPageCount(count)
  }, [activeFileId])

  useEffect(() => () => {
    window.clearTimeout(noticeTimer.current)
    window.clearTimeout(repeatClickTimer.current)
  }, [])

  const selectFileRange = (fileId) => {
    const anchorIndex = visibleFiles.findIndex((item) => item.id === selectionAnchorId.current)
    const targetIndex = visibleFiles.findIndex((item) => item.id === fileId)
    if (targetIndex < 0) return
    const start = anchorIndex < 0 ? targetIndex : Math.min(anchorIndex, targetIndex)
    const end = anchorIndex < 0 ? targetIndex : Math.max(anchorIndex, targetIndex)
    const rangeIds = visibleFiles.slice(start, end + 1).map((item) => item.id)
    setSelectedFiles((current) => new Set([...current, ...rangeIds]))
    setActiveFileId(fileId)
    setSelectionNotice(false)
    window.clearTimeout(repeatClickTimer.current)
    clickSequence.current = { fileId: null, count: 0 }
  }

  const selectFile = (event, file) => {
    if (event.target.closest('button, input')) return
    event.currentTarget.focus()
    if (event.shiftKey) {
      event.preventDefault()
      selectFileRange(file.id)
      return
    }
    if (event.metaKey || event.ctrlKey) {
      setActiveFileId(file.id)
      setSelectedFiles((current) => {
        const next = new Set(current)
        next.has(file.id) ? next.delete(file.id) : next.add(file.id)
        return next
      })
      setSelectionNotice(false)
      window.clearTimeout(repeatClickTimer.current)
      clickSequence.current = { fileId: null, count: 0 }
      return
    }
    selectionAnchorId.current = file.id
    setActiveFileId(file.id)
    const repeated = clickSequence.current.fileId === file.id
    clickSequence.current = { fileId: file.id, count: repeated ? clickSequence.current.count + 1 : 1 }
    window.clearTimeout(repeatClickTimer.current)
    if (repeated) {
      repeatClickTimer.current = window.setTimeout(() => {
        setSelectionNotice(true)
        window.clearTimeout(noticeTimer.current)
        noticeTimer.current = window.setTimeout(() => setSelectionNotice(false), 3200)
      }, 360)
    } else {
      setSelectionNotice(false)
      window.clearTimeout(noticeTimer.current)
    }
  }

  const openOnDoubleClick = (event, file) => {
    if (event.target.closest('button, input')) return
    window.clearTimeout(repeatClickTimer.current)
    clickSequence.current = { fileId: null, count: 0 }
    setSelectionNotice(false)
    open(file)
  }

  const moveFileSelection = (event, file) => {
    if (event.key === ' ' || event.key === 'Spacebar') {
      event.preventDefault()
      setActiveFileId(file.id)
      if (event.shiftKey) {
        if (!selectionAnchorId.current) selectionAnchorId.current = file.id
        selectFileRange(file.id)
      } else {
        selectionAnchorId.current = file.id
        setSelectedFiles((current) => {
          const next = new Set(current)
          next.has(file.id) ? next.delete(file.id) : next.add(file.id)
          return next
        })
      }
      return
    }
    if (activeFileId !== file.id) return
    const direction = event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? -1
      : event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1
        : 0
    if (!direction) return
    event.preventDefault()
    const index = visibleFiles.findIndex((item) => item.id === file.id)
    const nextIndex = index + direction
    if (index < 0 || nextIndex < 0 || nextIndex >= visibleFiles.length) return
    const nextFile = visibleFiles[nextIndex]
    if (event.shiftKey) {
      if (!selectionAnchorId.current) selectionAnchorId.current = file.id
      selectFileRange(nextFile.id)
      document.querySelectorAll('.home-file-row')[nextIndex]?.focus()
      return
    }
    setActiveFileId(nextFile.id)
    document.querySelectorAll('.home-file-row')[nextIndex]?.focus()
  }

  const refresh = async () => {
    const backend = recentFilesBackend()
    if (!backend?.getRecentFiles) { setFiles([]); return }
    try {
      const records = await backend.getRecentFiles()
      setFiles(records)
      const available = new Set(records.map((record) => record.id))
      setSelectedFiles((current) => new Set([...current].filter((id) => available.has(id))))
    } catch { setError('Could not load local file history.') }
  }
  useEffect(() => {
    refresh()
    const refreshWhenVisible = () => { if (document.visibilityState === 'visible') refresh() }
    window.addEventListener('focus', refreshWhenVisible)
    document.addEventListener('visibilitychange', refreshWhenVisible)
    return () => { window.removeEventListener('focus', refreshWhenVisible); document.removeEventListener('visibilitychange', refreshWhenVisible) }
  }, [])

  const open = async (record) => {
    try {
      const backend = recentFilesBackend()
      if (!backend?.readRecentFile) throw new Error('This PDF could not be opened because local file storage is unavailable.')
      const data = await backend.readRecentFile(record.id)
      if (!data) throw new Error('The selected recent PDF could not be read.')
      const file = new File([data], record.name, { type: 'application/pdf' }); file.sourcePath=record.sourcePath
      onNavigate({ type: 'tool', toolId: 'pdf-editor', files: [file] })
    } catch (cause) { setError(cause.message || 'Could not open this recent PDF.') }
  }

  const readSelectedFiles = async () => {
    const selected = files.filter((record) => selectedFiles.has(record.id))
    const backend = recentFilesBackend()
    if (!selected.length || !backend?.readRecentFile) throw new Error('Selected PDFs are unavailable in this workspace.')
    const result = await Promise.all(selected.map(async (record) => {
      const data = await backend.readRecentFile(record.id)
      if (!data) throw new Error(`Could not read ${record.name}.`)
      const file = new File([data], record.name, { type: 'application/pdf' })
      file.sourcePath = record.sourcePath
      return file
    }))
    return result
  }

  const runSelectedTool = async (toolId) => {
    try {
      const selected = await readSelectedFiles()
      onNavigate({ type: 'tool', toolId, files: selected })
    } catch (cause) { setError(cause.message || 'Could not load the selected PDFs.') }
  }

  const printSelected = async () => {
    try {
      const [file] = await readSelectedFiles()
      await printPdfDocument({ name: file.name, data: new Uint8Array(await file.arrayBuffer()) })
    } catch (cause) { setError(cause.message || 'Could not print the selected PDF.') }
  }

  const cancelEdit = () => { setConfirmOpen(false); setPendingFile(null) }

  const deleteFile = async () => {
    const backend = recentFilesBackend()
    if (!pendingFile?.id || !backend?.removeRecentFile) return
    try {
      await backend.removeRecentFile(pendingFile.id)
      setFiles((current) => current.filter((f) => f.id !== pendingFile.id))
      setSelectedFiles((current) => { const next = new Set(current); next.delete(pendingFile.id); return next })
      setActiveFileId((current) => current === pendingFile.id ? null : current)
    } catch (e) { setError('Could not remove file from library.') }
    setConfirmOpen(false)
    setPendingFile(null)
  }

  const showDeleteConfirm = (record) => {
    const ids = selectedFiles.has(record.id) && selectedFiles.size > 1 ? [...selectedFiles] : [record.id]
    setPendingFile({ ids, id: ids.length === 1 ? record.id : undefined, name: ids.length === 1 ? record.name : '', bulk: ids.length > 1 })
    setConfirmOpen(true)
  }

  useEffect(() => {
    const handleDeleteShortcut = (event) => {
      if (!(event.metaKey || event.ctrlKey) || !['Backspace', 'Delete'].includes(event.key)) return
      if (event.target?.closest?.('input, textarea, select, [contenteditable="true"]') || confirmOpen) return
      const chosen = selectedFiles.size > 1 ? files.filter((file) => selectedFiles.has(file.id)) : files.filter((file) => file.id === activeFileId)
      const record = chosen[0]
      if (!record) return
      event.preventDefault()
      if (chosen.length > 1) {
        setPendingFile({ ids: chosen.map((file) => file.id), bulk: true, name: '' })
        setConfirmOpen(true)
      } else showDeleteConfirm(record)
    }
    window.addEventListener('keydown', handleDeleteShortcut)
    return () => window.removeEventListener('keydown', handleDeleteShortcut)
  }, [files, activeFileId, confirmOpen, selectedFiles])

  useEffect(() => {
    const handleHomeShortcut = (event) => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      if (event.target instanceof HTMLElement && (event.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName))) return
      if (event.key === 'Escape') {
        if (confirmOpen) return
        event.preventDefault()
        if (previewMode) {
          setPreviewMode(false)
          setPreviewPage(1)
        } else {
          setActiveFileId(null)
          setSelectedFiles(new Set())
        }
      } else if (event.key === 'a') {
        const firstRecord = files.find((file) => file.name.toLowerCase().includes(query.trim().toLowerCase()))
        const firstRow = document.querySelector('.home-file-row')
        if (firstRecord && firstRow) {
          event.preventDefault()
          selectionAnchorId.current = firstRecord.id
          setActiveFileId(firstRecord.id)
          setPreviewMode(false)
          setPreviewPage(1)
          firstRow.focus()
        }
      } else if (event.key === 's') {
        event.preventDefault()
        const sidebar = document.querySelector('.sidebar')
        if (sidebar) sidebar.focus()
      } else if (event.key === 'Tab') {
        if (!previewMode) { event.preventDefault(); setPreviewMode(true); setPreviewPage(1) }
      }
    }
    window.addEventListener('keydown', handleHomeShortcut)
    return () => window.removeEventListener('keydown', handleHomeShortcut)
  }, [files, previewMode, query, confirmOpen])

  useEffect(() => {
    const handleArrowKeys = (event) => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      if (event.target instanceof HTMLElement && (event.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName))) return
      if (!previewMode) return
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        const currentIndex = visibleFiles.findIndex((item) => item.id === activeFileId)
        if (currentIndex < 0) return
        event.preventDefault()
        event.stopPropagation()
        const nextIndex = currentIndex + (event.key === 'ArrowUp' ? -1 : 1)
        if (nextIndex < 0 || nextIndex >= visibleFiles.length) return
        setActiveFileId(visibleFiles[nextIndex].id)
        setPreviewPage(1)
        setPreviewPageCount(0)
        return
      }
      const activeFile = files.find((f) => f.id === activeFileId)
      const pageCount = activeFile?.pages || previewPageCount
      const direction = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
      if (!direction) return
      event.preventDefault()
      event.stopPropagation()
      if (pageCount > 0) setPreviewPage((current) => Math.max(1, Math.min(pageCount, current + direction)))
    }
    window.addEventListener('keydown', handleArrowKeys)
    return () => window.removeEventListener('keydown', handleArrowKeys)
  }, [files, visibleFiles, previewMode, activeFileId, previewPage, previewPageCount])

  const removeFiles = async (ids) => {
    const targets = [...new Set(ids)]
    const backend = recentFilesBackend()
    if (!backend?.removeRecentFile || !targets.length) return
    const removed = new Set()
    for (const id of targets) {
      try {
        // The desktop bridge returns false when the recent-file ID was not present.
        if (await backend.removeRecentFile(id)) removed.add(id)
      } catch { /* continue so one failed ID does not block the rest */ }
    }
    if (removed.size) {
      setFiles((current) => current.filter((record) => !removed.has(record.id)))
      setSelectedFiles((current) => { const next = new Set(current); removed.forEach((id) => next.delete(id)); return next })
      setActiveFileId((current) => removed.has(current) ? null : current)
    }
    if (removed.size !== targets.length) setError(`Removed ${removed.size} of ${targets.length} selected files. Refresh the library and try again.`)
  }

  const showRemoveSelectedConfirm = (ids = [...selectedFiles]) => {
    if (!ids.length) return
    const existingIds = files.filter((record) => ids.includes(record.id)).map((record) => record.id)
    if (!existingIds.length) return
    setPendingFile({ ids: existingIds, name: existingIds.length === 1 ? files.find((record) => record.id === existingIds[0])?.name : '', bulk: existingIds.length > 1 })
    setConfirmOpen(true)
  }

  const confirmDelete = () => {
    setConfirmOpen(false)
    if (pendingFile?.ids?.length) {
      const ids = new Set(pendingFile.ids)
      setPendingFile(null)
      void removeFiles(ids)
      return
    }
    setPendingFile(null)
    deleteFile()
  }

  const handleDroppedFiles = (fileList) => {
    const incoming = Array.from(fileList || [])
    const pdfs = incoming.filter((file) => file.type === 'application/pdf' || /\.pdf$/i.test(file.name))
    if (!pdfs.length) { setError('Drop one or more PDF files to open them here.'); return }
    if (pdfs.length !== incoming.length) setError('Only PDF files were added; other file types were skipped.')
    else setError('')
    onNavigate({ type: 'tool', toolId: 'pdf-editor', files: pdfs })
  }

  return (
    <div className="page-content" onClick={(event) => {
      if (event.target.closest('[data-pdf-id], .home-inspector')) return
      setActiveFileId(null)
      setSelectedFiles((current) => current.size ? new Set() : current)
    }}>
      <section className="welcome-row home-hero" style={{ alignItems: 'flex-start', minHeight: 'auto', paddingTop: 24 }}>
        <div>
          <div className="home-breadcrumb"><span>WORKSPACE</span><span>/</span><strong>PDF LIBRARY</strong></div>
          <h1 className="home-greeting">Your PDF <span>workspace</span></h1>
          <p className="home-subtitle">Pick up where you left off.</p>
        </div>
      </section>

      <div className="home-library-toolbar">
        <div className="category-header home-documents-heading">
          <div><h1>Recent files</h1><span className="home-file-count">{files.length} {files.length === 1 ? 'document' : 'documents'}</span></div>
        </div>
        <label className="home-search"><Icon name="search" size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search your PDFs..." aria-label="Search recent PDFs" /></label>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="home-library-layout">
      <div className="home-library-main">{files.length === 0 ? (
        <div className="recent-empty-state" style={{ padding: '32px 0' }}>
          <div className="empty-icon-wrap"><Icon name="pages" size={32} /></div>
          <h3>No recent documents yet</h3>
          <p>PDFs you open or export are stored on this device and will appear here.</p>
        </div>
      ) : (
        <div className="recent-files-table" role="grid" aria-label="Recent documents">
          <div className="home-file-header" role="row">
            <span className="home-file-select-cell" role="columnheader"><span className="sr-only">Select</span></span>
            <span role="columnheader">Name</span><span role="columnheader">File size</span><span role="columnheader">Pages</span><span role="columnheader">Last opened</span><span className="home-file-delete-cell" role="columnheader"><span className="sr-only">Actions</span></span>
          </div>
          {visibleFiles.length === 0 ? <div className="home-no-results">No PDFs match “{query}”.</div> : visibleFiles.map((file) => (
            <div key={file.id} data-pdf-id={file.id} data-pdf-name={file.name} className={`recent-file-card home-file-row clickable ${activeFileId === file.id ? 'is-selected' : ''}`} onMouseDown={(event) => { if ((event.shiftKey || event.metaKey || event.ctrlKey) && !event.target.closest('button, input')) event.preventDefault() }} onClick={(event) => selectFile(event, file)} onDoubleClick={(event) => openOnDoubleClick(event, file)} role="row" tabIndex={0} aria-label={`${file.name}; double click or press Enter to open`} aria-selected={activeFileId === file.id} onKeyDown={(event) => { if (previewMode && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return; moveFileSelection(event, file); if (event.defaultPrevented) return; if (event.target.closest('button')) return; if (event.key === 'Enter' && !event.target.closest('input')) { event.preventDefault(); open(file) } }}>
              <div className="home-file-select-cell" role="gridcell"><input type="checkbox" checked={selectedFiles.has(file.id)} onClick={(event) => {
                if (event.shiftKey) { event.preventDefault(); selectFileRange(file.id) }
              }} onChange={(event) => {
                selectionAnchorId.current = file.id
                setActiveFileId(file.id)
                setSelectedFiles((current) => { const next = new Set(current); event.target.checked ? next.add(file.id) : next.delete(file.id); return next })
              }} aria-label={`Select ${file.name}`} /></div>
              <div className="home-file-name-cell" role="gridcell"><div className="recent-file-icon"><Icon name="file" size={18} /></div><div className="recent-file-details"><strong>{file.name}</strong></div></div>
              <span role="gridcell">{formatBytes(file.size || 0)}</span>
              <span role="gridcell">{file.pages || '—'}</span>
              <span role="gridcell">Opened {relativeDate(file.modified)}</span>
              <div className="home-file-delete-cell" role="gridcell"><button type="button" className="delete-card-btn" onClick={(event) => { event.stopPropagation(); showDeleteConfirm(file) }} aria-label={`Remove ${file.name} from library`}>
                <Icon name="trash" size={14} />
              </button></div>
            </div>
          ))}
        </div>
      )}
      </div>
      <DocumentPreview record={files.find((file) => file.id === activeFileId) || null} page={previewPage} expanded={previewMode} onOpenPreview={() => setPreviewMode(true)} onClosePreview={() => { setPreviewMode(false); setPreviewPage(1) }} onNavigatePage={(direction) => setPreviewPage((current) => Math.max(1, current + direction))} onPageCountChange={handlePreviewPageCount} selectedCount={selectedFiles.size} onRemoveSelected={() => showRemoveSelectedConfirm([...selectedFiles])} onOpenPdf={onOpenPdf} onOpenSelected={() => { const record = files.find((file) => file.id === [...selectedFiles][0]); if (record) void open(record) }} onRunFileAction={runSelectedTool} onPrintSelected={printSelected} onFilesDropped={handleDroppedFiles} />
      </div>
      <Presence present={selectionNotice} exitDuration={180}>
        <div className="file-open-hint" role="status">Selected — double-click to open this PDF</div>
      </Presence>
      <ConfirmDialog
        isOpen={confirmOpen}
        onClose={cancelEdit}
        fileName={pendingFile?.name}
        bulkCount={pendingFile?.bulk ? pendingFile.ids.length : 0}
        onDelete={confirmDelete}
      />
    </div>
  )
}
