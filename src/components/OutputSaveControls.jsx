import React, { useState } from 'react'
import { Icon } from '../icons'
import { outputFileName } from '../outputStorage'

export function OutputSaveControls({ output, onSave, onPreview, onSettingsChange }) {
  const name = output.saveName ?? output.name
  const destination = output.saveDestination || 'device'
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const pdf = output.mimeType === 'application/pdf'
  return <form className="output-save-controls" onSubmit={async event => {
    event.preventDefault()
    if (saving) return
    setError('')
    try {
      const finalName = outputFileName(name, output.name)
      setSaving(true)
      await onSave(finalName, destination)
    } catch (cause) { setError(cause.message) }
    finally { setSaving(false) }
  }}>
    <label>File name<input value={name} disabled={saving} onChange={event => onSettingsChange({ saveName: event.target.value })} required /></label>
    <label>Save to<select value={destination} disabled={saving} onChange={event => onSettingsChange({ saveDestination: event.target.value })}>
      <option value="device">My device</option>
      {pdf && <option value="app">PDF Dock library</option>}
      {pdf && <option value="both">Library and my device</option>}
    </select></label>
    <div className="output-actions"><button className="output-view-button" type="button" disabled={saving} onClick={onPreview}>Preview</button><button className="browse-button" type="submit" disabled={saving}><Icon name="download" size={16} />{saving ? 'Saving…' : 'Save file'}</button></div>
    {error && <p className="operation-error" role="alert">{error}</p>}
  </form>
}
