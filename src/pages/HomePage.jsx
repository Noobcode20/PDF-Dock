import React, { useEffect, useState } from 'react'
import { Icon } from '../icons'

const formatBytes = (size) => size < 1024 * 1024 ? `${Math.max(1, Math.round(size / 1024))} KB` : `${(size / 1024 / 1024).toFixed(2)} MB`
const relativeDate = (value) => {
  const time = new Date(value).getTime()
  if (!Number.isFinite(time)) return ''
  const hours = Math.floor((Date.now() - time) / 3600000)
  if (hours < 1) return 'just now'
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.floor(hours / 24)
  return days === 1 ? 'yesterday' : `${days} days ago`
}

function ConfirmDialog({ isOpen, onClose, fileName, onDelete }) {
  if (!isOpen) return null
  return (
    <div className="confirm-backdrop" onClick={onClose}>
      <div className="confirm-panel" role="dialog" aria-modal="true" aria-labelledby="remove-dialog-title" onClick={(e) => e.stopPropagation()}>
        <div className="confirm-icon"><Icon name="trash" size={21} /></div>
        <h2 className="confirm-title" id="remove-dialog-title">Remove from library?</h2>
        <p className="confirm-message">Remove <strong>{fileName}</strong> from your library? It will be deleted from the app cache but stay on your computer.</p>
        <div className="confirm-actions">
          <button type="button" className="confirm-btn confirm-btn-cancel" onClick={onClose}><Icon name="x" size={14} /> Cancel</button>
          <button type="button" className="confirm-btn confirm-btn-delete" onClick={onDelete}><Icon name="trash" size={14} /> Remove</button>
        </div>
      </div>
    </div>
  )
}

export function HomePage({ userName = 'User', theme, onNavigate }) {
  const [files, setFiles] = useState([])
  const [error, setError] = useState('')
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [pendingFile, setPendingFile] = useState(null)
  const [selectedFiles, setSelectedFiles] = useState(() => new Set())

  const refresh = async () => {
    if (!window.pdfKing?.getRecentFiles) { setFiles([]); return }
    try { setFiles(await window.pdfKing.getRecentFiles()) } catch { setError('Could not load local file history.') }
  }
  useEffect(() => { refresh() }, [])

  const open = async (record) => {
    try {
      const data = await window.pdfKing?.readRecentFile(record.id)
      if (!data) throw new Error('Recent file storage is only available in the desktop app.')
      const file = new File([data], record.name, { type: 'application/pdf' })
      onNavigate({ type: 'tool', toolId: 'pdf-editor', files: [file] })
    } catch (cause) { setError(cause.message || 'Could not open this recent PDF.') }
  }

  const cancelEdit = () => { setConfirmOpen(false); setPendingFile(null) }

  const deleteFile = async () => {
    if (!pendingFile?.id || !window.pdfKing?.removeRecentFile) return
    try {
      await window.pdfKing.removeRecentFile(pendingFile.id)
      setFiles((current) => current.filter((f) => f.id !== pendingFile.id))
    } catch (e) { setError('Could not remove file from library.') }
    setConfirmOpen(false)
    setPendingFile(null)
  }

  const showDeleteConfirm = (record) => { setPendingFile({ file: null, name: record.name, id: record.id, isDelete: true }); setConfirmOpen(true) }

  const confirmDelete = () => {
    setConfirmOpen(false)
    deleteFile()
  }

  return (
    <div className="page-content">
      <section className="welcome-row" style={{ alignItems: 'flex-start', minHeight: 'auto', paddingTop: 24 }}>
        <div>
          <h1 style={{ color: 'var(--text)', fontSize: 28, letterSpacing: -1.2 }}>
            Hello, <span style={{ color: 'var(--accent)' }}>{userName}</span>
          </h1>
        </div>
      </section>

      <div className="category-header" style={{ marginTop: '16px' }}>
        <h1>Pick up where you left off</h1>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      {files.length === 0 ? (
        <div className="recent-empty-state" style={{ padding: '32px 0' }}>
          <div className="empty-icon-wrap"><Icon name="pages" size={32} /></div>
          <h3>No recent documents yet</h3>
          <p>PDF files you open or export in the desktop app will appear here.</p>
        </div>
      ) : (
        <div className="recent-files-table" role="grid" aria-label="Recent documents">
          <div className="home-file-header" role="row">
            <span className="home-file-select-cell" role="columnheader"><span className="sr-only">Select</span></span>
            <span role="columnheader">Name</span><span role="columnheader">File size</span><span role="columnheader">Pages</span><span role="columnheader">Last opened</span><span className="home-file-delete-cell" role="columnheader"><span className="sr-only">Actions</span></span>
          </div>
          {files.map((file) => (
            <div key={file.id} data-pdf-id={file.id} data-pdf-name={file.name} className={`recent-file-card home-file-row clickable ${selectedFiles.has(file.id) ? 'is-selected' : ''}`} onClick={(event) => { if (event.target.closest('button, input')) return; setSelectedFiles((current) => { const next = new Set(current); next.has(file.id) ? next.delete(file.id) : next.add(file.id); return next }) }} onDoubleClick={(event) => { if (!event.target.closest('button, input')) open(file) }} role="row" tabIndex={0} aria-label={`${file.name}; double-click to open`} onKeyDown={(event) => { if (event.target.closest('button, input')) return; if (event.key === 'Enter') { event.preventDefault(); open(file) } }}>
              <div className="home-file-select-cell" role="gridcell"><input type="checkbox" checked={selectedFiles.has(file.id)} onChange={(event) => setSelectedFiles((current) => { const next = new Set(current); event.target.checked ? next.add(file.id) : next.delete(file.id); return next })} aria-label={`Select ${file.name}`} /></div>
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
      <ConfirmDialog
        isOpen={confirmOpen}
        onClose={cancelEdit}
        fileName={pendingFile?.name}
        onDelete={confirmDelete}
      />
    </div>
  )
}
