import React, { useEffect, useRef, useState } from 'react'
import { Icon } from '../icons'
import { saveOutput } from '../fileServices'
import { Presence } from '../components/Presence'

const formatBytes = (size = 0) => size < 1024 * 1024 ? `${Math.max(1, Math.round(size / 1024))} KB` : `${(size / 1024 / 1024).toFixed(1)} MB`

export function NewDocumentPage({ isOpen = true, mode = 'new', onNavigate, onClose }) {
  const picker = useRef(null)
  const [pageSize, setPageSize] = useState('a4')
  const [orientation, setOrientation] = useState('portrait')
  const [pageCount, setPageCount] = useState(1)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [recentFiles, setRecentFiles] = useState([])
  const [recentLoading, setRecentLoading] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef(null)

  useEffect(() => {
    if (!isOpen) return
    setPageSize('a4')
    setOrientation('portrait')
    setPageCount(1)
    setError('')
    setDragging(false)
  }, [isOpen])

  useEffect(() => {
    if (!isOpen || mode !== 'open-pdf') return
    let active = true
    setQuery('')
    setActiveIndex(0)
    setRecentLoading(true)
    window.setTimeout(() => inputRef.current?.focus(), 50)
    Promise.resolve(window.pdfKing?.getRecentFiles?.())
      .then((files) => { if (active) setRecentFiles(Array.isArray(files) ? files : []) })
      .catch(() => { if (active) setRecentFiles([]) })
      .finally(() => { if (active) setRecentLoading(false) })
    return () => { active = false }
  }, [isOpen, mode])

  const filteredRecentFiles = recentFiles.filter((record) => typeof record?.name === 'string' && record.name.toLowerCase().includes(query.trim().toLowerCase()))

  useEffect(() => {
    if (isOpen && mode === 'open-pdf') document.querySelector(`[data-file-picker-index="${activeIndex}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, isOpen, mode])

  const selectFilePickerItem = () => {
    if (activeIndex === 0) chooseFromDevice()
    else if (filteredRecentFiles[activeIndex - 1]) openRecent(filteredRecentFiles[activeIndex - 1])
  }

  const handleFilePickerKeyDown = (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex((index) => Math.min(index + 1, filteredRecentFiles.length))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((index) => Math.max(index - 1, 0))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      selectFilePickerItem()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      onClose()
    }
  }

  const importFile = (file) => {
    if (!file) return
    if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) {
      setError('Choose a PDF file. Convert images and Office documents with the Convert tools.')
      return
    }
    if(!file.sourcePath && window.pdfKing?.getFilePath) file.sourcePath=window.pdfKing.getFilePath(file)||null
    setBusy(false)
    setError('')
    onClose()
    onNavigate({ type: 'tool', toolId: 'pdf-editor', files: [file] })
  }

  const openRecent = async (record) => {
    if (busy) return
    if (!window.pdfKing?.readRecentFile) return
    setBusy(true)
    setError('')
    try {
      const data = await window.pdfKing.readRecentFile(record.id)
      if (!data) throw new Error(`Could not read ${record.name}.`)
      const file = new File([data], record.name, { type: 'application/pdf' }); file.sourcePath = record.sourcePath; importFile(file)
    } catch (cause) {
      setError(cause?.message || `Could not open ${record.name}.`)
    } finally {
      setBusy(false)
    }
  }

  const chooseFromDevice = async () => {
    if (busy) return
    setBusy(true)
    if (window.pdfKing?.openPdf) {
      setError('')
      try {
        const selected = await window.pdfKing.openPdf()
        if (selected) { const file = new File([selected.data], selected.name, { type: 'application/pdf' }); file.sourcePath = selected.filePath; importFile(file) }
      } catch (cause) {
        setError(cause?.message || 'Could not open that PDF.')
      } finally {
        setBusy(false)
      }
      return
    }
    picker.current?.click()
  }

  const createBlank = async () => {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const { createBlankPdf } = await import('../pdfEngine')
      const created = await createBlankPdf({ pageSize, orientation, pageCount })
      const name = 'Untitled Document.pdf'
      const file = new File([created.data], name, { type: 'application/pdf' })
      const saved = await saveOutput({ ...created, name })
      if (!saved) return
      onClose()
      onNavigate({ type: 'tool', toolId: 'pdf-editor', files: [file] })
    } catch (cause) {
      setError(cause?.message || 'Could not create the blank PDF.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Presence present={isOpen} exitDuration={240}><div className={mode === 'open-pdf' ? 'palette-backdrop file-picker-backdrop' : 'new-doc-backdrop'} onClick={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className={mode === 'open-pdf' ? 'palette-modal file-picker-modal' : 'new-doc-dialog'} role="dialog" aria-modal="true" aria-label={mode === 'open-pdf' ? 'Open a PDF' : undefined} aria-labelledby={mode === 'new' ? 'new-doc-title' : undefined} onClick={(event) => event.stopPropagation()} onKeyDown={(event) => {
          if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose() }
          if (event.key === 'Enter' && mode !== 'open-pdf' && !busy && !event.target.closest('button, select')) { event.preventDefault(); createBlank() }
        }}>
        {mode === 'open-pdf' ? <>
          <input ref={picker} hidden type="file" accept="application/pdf,.pdf" onChange={(event) => { importFile(event.target.files?.[0]); event.target.value = '' }} />
          <div className="palette-search-row">
            <Icon name="search" size={18} className="palette-search-icon" />
            <input ref={inputRef} className="palette-input" type="search" placeholder="Search existing PDFs…" value={query} onChange={(event) => { const nextQuery = event.target.value; const hasMatch = recentFiles.some((record) => typeof record?.name === 'string' && record.name.toLowerCase().includes(nextQuery.trim().toLowerCase())); setQuery(nextQuery); setActiveIndex(nextQuery.trim() && hasMatch ? 1 : 0) }} onKeyDown={handleFilePickerKeyDown} aria-label="Search existing PDFs" />
            <button className="palette-close-btn" type="button" onClick={onClose} aria-label="Close PDF picker"><kbd>Esc</kbd></button>
          </div>
          <div className="palette-results file-picker-results">
            <section className="palette-command-group" aria-label="Open from device">
              <div className="palette-section-title">Open from</div>
              <div className="palette-list">
                <button className={`palette-item ${activeIndex === 0 ? 'active' : ''}`} data-file-picker-index="0" aria-current={activeIndex === 0 ? 'true' : undefined} type="button" onMouseEnter={() => setActiveIndex(0)} onClick={chooseFromDevice} disabled={busy}>
                  <span className="tool-icon neutral palette-item-icon"><Icon name="upload" size={18} /></span>
                  <div className="palette-item-text"><div className="palette-item-title-row"><strong>Choose a PDF on this device</strong></div><small>Browse files on your computer</small></div>
                  <span className="palette-item-category">Browse</span><Icon name="arrow" size={14} className="palette-item-arrow" />
                </button>
              </div>
            </section>

            <section className="palette-command-group" aria-label="Existing PDFs">
              <div className="palette-section-title">Existing PDFs <span>{recentLoading ? '…' : filteredRecentFiles.length}</span></div>
              {recentLoading ? <div className="palette-empty"><p>Loading your recent PDFs…</p></div> : filteredRecentFiles.length ? (
                <div className="palette-list">
                  {filteredRecentFiles.map((record, index) => <button className={`palette-item ${activeIndex === index + 1 ? 'active' : ''}`} data-file-picker-index={index + 1} aria-current={activeIndex === index + 1 ? 'true' : undefined} key={record.id} type="button" onMouseEnter={() => setActiveIndex(index + 1)} onClick={() => openRecent(record)} disabled={busy}>
                    <span className="tool-icon neutral palette-item-icon"><Icon name="file" size={18} /></span>
                    <div className="palette-item-text"><div className="palette-item-title-row"><strong>{record.name}</strong></div><small>{formatBytes(record.size)}{record.pages ? ` · ${record.pages} pages` : ''}</small></div>
                    <Icon name="arrow" size={14} className="palette-item-arrow" />
                  </button>)}
                </div>
              ) : <div className="palette-empty file-picker-empty"><Icon name={query ? 'search' : 'file'} size={22} /><p>{query ? `No PDFs found for “${query}”` : 'No existing PDFs yet'}</p><span>{query ? 'Try a different name, or choose a PDF from your device.' : 'PDFs you open or export will appear here.'}</span></div>}
            </section>
            {error && <p className="form-error" role="alert">{error}</p>}
          </div>
          <div className="palette-footer"><span><kbd>↑</kbd> <kbd>↓</kbd> Navigate <kbd>↵</kbd> Open selected</span><span><kbd>Esc</kbd> Close</span></div>
        </> : <>
        <header className="new-doc-dialog-header">
          <div>
            <span className="new-doc-kicker">PDF KING</span>
            <h2 id="new-doc-title">{mode === 'open-pdf' ? 'Open a PDF' : 'New document'}</h2>
            <p>{mode === 'open-pdf' ? 'Choose a recent PDF or browse your device.' : 'Open a PDF or start with a blank page.'}</p>
          </div>
          <button className="icon-button new-doc-close" type="button" onClick={onClose} aria-label="Close new document dialog">
            <Icon name="x" size={17} />
          </button>
        </header>

        <input
          ref={picker}
          type="file"
          accept="application/pdf,.pdf"
          hidden
          onChange={(event) => { importFile(event.target.files?.[0]); event.target.value = ''; setBusy(false) }}
          onCancel={() => setBusy(false)}
        />
        <button
          className={`new-doc-dropzone ${dragging ? 'dragging' : ''}`}
          type="button"
          onClick={chooseFromDevice}
          onDragOver={(event) => { event.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => { event.preventDefault(); setDragging(false); importFile(event.dataTransfer.files?.[0]) }}
        >
          <span className="new-doc-upload-icon"><Icon name="upload" size={21} /></span>
          <strong>Drop a PDF here</strong>
          <span>or browse files on your device</span>
        </button>

        <button className="browse-button new-doc-blank-btn" data-dialog-accept="true" autoFocus type="button" onClick={createBlank} disabled={busy}>
          <Icon name="plus" size={16} />
          {busy ? 'Creating PDF…' : 'Create blank PDF'}
        </button>

        <div className="new-doc-page-setup">
          <label>Page size
            <select className="studio-input" value={pageSize} onChange={(event) => setPageSize(event.target.value)}>
              <option value="a4">A4</option>
              <option value="letter">Letter</option>
              <option value="legal">Legal</option>
            </select>
          </label>
          <label>Orientation
            <select className="studio-input" value={orientation} onChange={(event) => setOrientation(event.target.value)}>
              <option value="portrait">Portrait</option>
              <option value="landscape">Landscape</option>
            </select>
          </label>
          <label>Pages
            <input className="studio-input" type="number" min="1" max="500" value={pageCount} onChange={(event) => setPageCount(Math.max(1, Math.min(500, Number(event.target.value) || 1)))} />
          </label>
        </div>
        </>}
        {error && <p className="form-error new-doc-error" role="alert">{error}</p>}
      </section>
    </div></Presence>
  )
}
