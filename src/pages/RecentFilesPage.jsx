import React, { useEffect, useRef, useState } from 'react'
import { Icon } from '../icons'
import { Presence } from '../components/Presence'
import { recentFilesBackend } from '../recentFiles'

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
  const acceptButton = useRef(null)
  useEffect(() => { if (isOpen) acceptButton.current?.focus() }, [isOpen])
  return (
    <Presence present={isOpen} exitDuration={180}><div className="confirm-backdrop" onClick={onClose}>
      <div className="confirm-panel" role="dialog" aria-modal="true" aria-labelledby="remove-dialog-title" onClick={(e) => e.stopPropagation()} onKeyDown={(event) => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose() }
        if (event.key === 'Enter' && !event.target.closest('button, a, input, textarea, select')) { event.preventDefault(); event.stopPropagation(); if (!event.repeat) onDelete() }
        if (event.key === 'Tab') {
          const controls = [...event.currentTarget.querySelectorAll('button:not(:disabled)')]
          if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls.at(-1)?.focus() }
          else if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0]?.focus() }
        }
      }}>
        <div className="confirm-icon"><Icon name="trash" size={21} /></div>
        <h2 className="confirm-title" id="remove-dialog-title">Remove from library?</h2>
        <p className="confirm-message">Remove <strong>{fileName}</strong> from your library? It will be deleted from the app cache but stay on your computer.</p>
        <div className="confirm-actions">
          <button type="button" className="confirm-btn confirm-btn-cancel" onClick={onClose}><Icon name="x" size={14} /> Cancel</button>
          <button ref={acceptButton} autoFocus type="button" className="confirm-btn confirm-btn-delete" onClick={onDelete}><Icon name="trash" size={14} /> Remove</button>
        </div>
      </div>
    </div></Presence>
  )
}

export function RecentFilesPage({ onNavigate }) {
  const [files, setFiles] = useState([])
  const [error, setError] = useState('')
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [pendingFile, setPendingFile] = useState(null)

  const refresh = async () => {
    const backend = recentFilesBackend()
    if (!backend?.getRecentFiles) { setFiles([]); return }
    try { setFiles(await backend.getRecentFiles()) } catch { setError('Could not load local file history.') }
  }
  useEffect(() => {
    void refresh()
    const sync = () => { if (document.visibilityState === 'visible') void refresh() }
    window.addEventListener('focus', sync)
    document.addEventListener('visibilitychange', sync)
    return () => {
      window.removeEventListener('focus', sync)
      document.removeEventListener('visibilitychange', sync)
    }
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

  const cancelEdit = () => { setConfirmOpen(false); setPendingFile(null) }

  const deleteFile = async () => {
    const backend = recentFilesBackend()
    if (!pendingFile?.id || !backend?.removeRecentFile) return
    try {
      await backend.removeRecentFile(pendingFile.id)
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
    <div className="page-content recent-page">
      <div className="category-header">
        <h1>Recent files</h1>
        <p className="category-desc">PDFs you have opened or exported are stored locally for quick access on this device.</p>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      {files.length === 0 ? (
        <div className="recent-empty-state"><div className="empty-icon-wrap"><Icon name="pages" size={32} /></div><h3>No recent documents yet</h3><p>PDFs you open or export are stored on this device and will appear here.</p><button className="browse-button" type="button" onClick={() => onNavigate({ type: 'home' })}>Back to Home <Icon name="arrow" size={15} /></button></div>
      ) : (
        <div className="recent-files-list">{files.map((file) => <div key={file.id} data-pdf-id={file.id} data-pdf-name={file.name} className="recent-file-card clickable" onClick={() => open(file)} role="button" tabIndex={0} onKeyDown={(event) => { if (event.target.closest('button, a, input, textarea, select')) return; if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(file) } }}>
          <button type="button" className="delete-card-btn" onClick={(event) => { event.stopPropagation(); showDeleteConfirm(file) }} aria-label={`Remove ${file.name} from library`}>
            <Icon name="trash" size={14} />
          </button>
          <div className="recent-file-icon"><Icon name="file" size={20} /></div><div className="recent-file-details"><strong>{file.name}</strong><div className="recent-file-meta"><span>{formatBytes(file.size || 0)}</span><span>•</span><span>{file.pages || '—'} pages</span><span>•</span><span>Opened {relativeDate(file.modified)}</span></div></div>
          <div className="recent-file-actions"><button className="open-file-btn" type="button" onClick={(event) => { event.stopPropagation(); open(file) }}>Open in Workspace <Icon name="arrow" size={14} /></button></div>
        </div>)}</div>
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
