import React, { useRef, useState } from 'react'
import { Icon } from '../icons'
import { saveOutput } from '../fileServices'

export function NewDocumentPage({ onNavigate, onClose }) {
  const picker = useRef(null)
  const [pageSize, setPageSize] = useState('a4')
  const [orientation, setOrientation] = useState('portrait')
  const [pageCount, setPageCount] = useState(1)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)

  const importFile = (file) => {
    if (!file) return
    if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) {
      setError('Choose a PDF file. Convert images and Office documents with the Convert tools.')
      return
    }
    setError('')
    onClose()
    onNavigate({ type: 'tool', toolId: 'pdf-editor', files: [file] })
  }

  const createBlank = async () => {
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
    <div className="new-doc-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="new-doc-dialog" role="dialog" aria-modal="true" aria-labelledby="new-doc-title">
        <header className="new-doc-dialog-header">
          <div>
            <span className="new-doc-kicker">PDF KING</span>
            <h2 id="new-doc-title">New document</h2>
            <p>Open a PDF or start with a blank page.</p>
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
          onChange={(event) => { importFile(event.target.files?.[0]); event.target.value = '' }}
        />
        <button
          className={`new-doc-dropzone ${dragging ? 'dragging' : ''}`}
          type="button"
          onClick={() => picker.current?.click()}
          onDragOver={(event) => { event.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => { event.preventDefault(); setDragging(false); importFile(event.dataTransfer.files?.[0]) }}
        >
          <span className="new-doc-upload-icon"><Icon name="upload" size={21} /></span>
          <strong>Drop a PDF here</strong>
          <span>or browse files on your device</span>
        </button>

        <button className="browse-button new-doc-blank-btn" type="button" onClick={createBlank} disabled={busy}>
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
        {error && <p className="form-error new-doc-error" role="alert">{error}</p>}
      </section>
    </div>
  )
}
