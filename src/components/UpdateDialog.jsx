import React, { useEffect, useRef } from 'react'
import { Icon } from '../icons'

export function UpdateDialog({ state, onDownload, onOpenDownload, onInstall, onSkip, onClose }) {
  const panel = useRef(null)
  useEffect(() => { panel.current?.focus() }, [state?.status])
  if (!state || !['available', 'downloading', 'downloaded', 'manual-download', 'error'].includes(state.status)) return null

  const mac = state.platform === 'darwin'
  const busy = state.status === 'downloading'
  const title = state.status === 'available' ? 'PDF Dock update available'
    : busy ? 'Downloading update'
      : state.status === 'downloaded' ? 'Update ready to install'
        : state.status === 'manual-download' ? 'Download the macOS installer'
          : 'Could not check for updates'
  const message = state.status === 'available'
    ? mac ? `Version ${state.version} is ready. macOS needs the installer to be opened manually on this beta build.` : `Version ${state.version} is ready to download. PDF Dock will restart to finish installing it.`
    : busy ? 'You can keep using PDF Dock while the update downloads.'
      : state.status === 'downloaded' ? `Version ${state.version} has downloaded. Restart PDF Dock to install it.`
        : state.status === 'manual-download' ? `The direct download for version ${state.version} is ready. Open the downloaded DMG, then replace PDF Dock in Applications.`
          : state.error || 'Try again later.'

  const escape = (event) => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (state.status === 'available' && state.version) onSkip(state.version); else onClose() }
    if (event.key === 'Enter' && !event.repeat && !event.target.closest('button')) {
      event.preventDefault()
      if (state.status === 'available') onDownload()
      else if (state.status === 'downloaded') onInstall()
    }
  }

  return <div className="confirm-backdrop" role="presentation">
    <section ref={panel} tabIndex={-1} className="confirm-panel update-panel" role="alertdialog" aria-modal="true" aria-labelledby="update-dialog-title" aria-describedby="update-dialog-message" onClick={(event) => event.stopPropagation()} onKeyDown={escape}>
      <div className="confirm-icon"><Icon name="download" size={18} /></div>
      <h2 className="confirm-title" id="update-dialog-title">{title}</h2>
      <p className="confirm-message" id="update-dialog-message">{message}</p>
      {busy && <div className="update-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={state.percent || 0}><div style={{ width: `${state.percent || 0}%` }} /><span>{state.percent || 0}%</span></div>}
      <div className="confirm-actions">
        {busy ? <button type="button" className="confirm-btn" onClick={onClose}>Continue in background</button>
          : <button type="button" className="confirm-btn" onClick={() => state.version ? onSkip(state.version) : onClose()}>{state.version ? 'Skip this version' : 'Close'}</button>}
        {state.status === 'available' && <button type="button" className="confirm-btn confirm-btn-primary" onClick={onDownload} data-dialog-accept>{mac ? 'Download installer' : 'Download update'}</button>}
        {state.status === 'downloaded' && <button type="button" className="confirm-btn confirm-btn-primary" onClick={onInstall} data-dialog-accept>Restart and install</button>}
        {state.status === 'manual-download' && <button type="button" className="confirm-btn confirm-btn-primary" onClick={onOpenDownload} data-dialog-accept>Open direct download</button>}
        {state.status === 'error' && <button type="button" className="confirm-btn confirm-btn-primary" onClick={onClose} data-dialog-accept>Dismiss</button>}
      </div>
    </section>
  </div>
}
