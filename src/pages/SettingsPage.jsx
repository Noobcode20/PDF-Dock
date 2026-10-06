import React, { useEffect, useRef, useState } from 'react'
import { Icon } from '../icons'
import { THEMES, isLightTheme } from '../themes'
import { loadShortcuts, saveShortcuts } from '../keyboardShortcuts'

function InteractiveShortcuts() {
  const [shortcuts, setShortcuts] = useState(loadShortcuts())
  const [recording, setRecording] = useState(null)

  const actions = [
    ['search', 'Quick Search / Command Palette'],
    ['new-document', 'New Document'],
    ['open-file', 'Open File in Multi Tool'],
    ['save-export', 'Save / Export Document'],
    ['close-overlay', 'Close Modals / Overlays'],
    ['navigate-home', 'Navigate to Home'],
    ['navigate-recent', 'Navigate to Recent Files'],
    ['navigate-settings', 'Navigate to Settings'],
    ['new-tab', 'New Tab'],
    ['close-tab', 'Close Tab'],
    ['toggle-sidebar', 'Toggle Sidebar'],
    ['toggle-theme', 'Toggle Theme']
  ]

  useEffect(() => {
    const handle = (e) => {
      if (!recording) return
      e.preventDefault()
      const comboStr = [
        e.ctrlKey ? 'ctrl' : '',
        e.metaKey ? 'meta' : '',
        e.altKey ? 'alt' : '',
        e.shiftKey ? 'shift' : '',
        e.key.length === 1 ? e.key.toLowerCase() : e.key
      ].filter(Boolean).join('+')
      const updated = { ...shortcuts, [recording]: { combo: comboStr, metaKey: !!e.metaKey, ctrlKey: !!e.ctrlKey, shiftKey: !!e.shiftKey, altKey: !!e.altKey, key: e.key } }
      setShortcuts(updated)
      saveShortcuts(updated)
      setRecording(null)
    }
    window.addEventListener('keydown', handle)
    return () => window.removeEventListener('keydown', handle)
  }, [recording, shortcuts])

  return (
    <div className="shortcuts-table">
      {actions.map(([key, label]) => (
        <button key={key} type="button" className="shortcut-item" style={{background:'transparent', border:0, display:'flex', justifyContent:'space-between', width:'100%', padding:0}} onClick={() => setRecording(key)}>
          <span>{label}</span>
          <kbd style={{background: recording === key ? 'var(--accent)' : undefined, color: recording === key ? '#fff' : undefined}}>{shortcuts[key]?.combo || '—'}</kbd>
        </button>
      ))}
    </div>
  )
}

export function SettingsPage({ theme, onSelectTheme, onNavigate, autoTheme, onToggleAutoTheme, selectedDarkTheme, selectedLightTheme, onSelectDarkTheme, onSelectLightTheme, userName = 'User', userAvatar, onSetUserName, onSetAvatar }) {
  const [savePath, setSavePath] = useState('')
  const [cacheCleared, setCacheCleared] = useState(false)
  const [keepRecent, setKeepRecent] = useState(() => window.localStorage.getItem('pdfking-keep-recent') !== 'false')
  const [cacheSize, setCacheSize] = useState(0)
  const [settingsError, setSettingsError] = useState('')
  const [editingName, setEditingName] = useState(false)
  const [draftName, setDraftName] = useState(userName)
  const avatarPicker = useRef(null)
  const nameInput = useRef(null)

  useEffect(() => {
    window.pdfKing?.getDefaultOutputFolder?.().then(setSavePath).catch(() => {})
    window.pdfKing?.getRecentFiles?.().then((files) => setCacheSize(files.reduce((sum, file) => sum + (file.size || 0), 0))).catch(() => {})
  }, [])

  const handleClearCache = async () => {
    try {
      await window.pdfKing?.clearRecentFiles?.()
      setCacheSize(0)
      setSettingsError('')
    } catch (cause) { setSettingsError(cause.message || 'Could not clear recent PDF copies.') }
    setCacheCleared(true)
    setTimeout(() => setCacheCleared(false), 3000)
  }

  const changeOutputFolder = async () => {
    try {
      const path = await window.pdfKing?.chooseOutputFolder?.()
      if (path) setSavePath(path)
    } catch (cause) { setSettingsError(cause.message || 'Could not choose an export folder.') }
  }

  const beginNameEdit = () => {
    setDraftName(userName)
    setEditingName(true)
    requestAnimationFrame(() => nameInput.current?.focus())
  }

  const saveName = () => {
    const nextName = draftName.trim()
    if (nextName && onSetUserName) onSetUserName(nextName)
    setEditingName(false)
  }

  const chooseAvatar = (event) => {
    const file = event.target.files?.[0]
    if (!file || !onSetAvatar) return
    const reader = new FileReader()
    reader.onload = () => onSetAvatar(reader.result)
    reader.readAsDataURL(file)
    event.target.value = ''
  }

  return (
    <div className="page-content settings-page">
      <div className="category-header">
        <div className="settings-greeting">
          <button className="greeting-avatar" type="button" onClick={() => avatarPicker.current?.click()} aria-label="Change profile picture" title="Change profile picture">
            {userAvatar ? <img src={userAvatar} alt="" /> : <span><Icon name="user" size={28} /></span>}
            <span className="greeting-avatar-edit"><Icon name="edit" size={12} /></span>
          </button>
          {editingName ? (
            <input
              ref={nameInput}
              className="greeting-name-input"
              aria-label="Edit your name"
              value={draftName}
              onChange={(event) => setDraftName(event.target.value)}
              onBlur={saveName}
              onKeyDown={(event) => {
                if (event.key === 'Enter') { event.preventDefault(); saveName() }
                if (event.key === 'Escape') { setDraftName(userName); setEditingName(false) }
              }}
            />
          ) : (
            <h1 className="settings-greeting-name">{userName}</h1>
          )}
          {!editingName && <button className="greeting-name-edit" type="button" onClick={beginNameEdit} aria-label="Edit your name" title="Edit your name"><Icon name="edit" size={14} /></button>}
          <input ref={avatarPicker} className="avatar-file-input" type="file" accept="image/*" aria-label="Choose a profile picture" onChange={chooseAvatar} />
        </div>
        <p className="category-desc">
          Manage local execution environment, privacy rules, theme preferences, and keyboard shortcuts.
        </p>
      </div>

      <div className="settings-sections">
        {/* Privacy & Engine */}
        <div className="settings-card">
          <div className="settings-card-header">
            <span className="tool-icon green">
              <Icon name="shield" size={18} />
            </span>
            <div>
              <strong>Privacy & Local Security</strong>
              <small>All operations are contained on this physical device</small>
            </div>
          </div>
          <div className="settings-card-body">
            <div className="setting-row">
              <div>
                <strong>On-device processing</strong>
                <p>PDF operations run locally in this app. Files are saved through your desktop file dialog.</p>
              </div>
            </div>
            <div className="setting-row">
              <div>
                <strong>Keep local recent PDF copies</strong>
                <p>Store opened and exported PDFs in this device’s recent files list.</p>
              </div>
              <label className="toggle-switch">
                <input
                  type="checkbox"
                  checked={keepRecent}
                  onChange={(e) => { setKeepRecent(e.target.checked); window.localStorage.setItem('pdfking-keep-recent', String(e.target.checked)); if (!e.target.checked) handleClearCache() }}
                />
                <span className="slider-round" />
              </label>
            </div>
          </div>
        </div>

        {/* Appearance */}
        <div className="settings-card">
          <div className="settings-card-header">
            <span className="tool-icon lilac">
              <Icon name={isLightTheme(theme) ? 'sun' : 'moon'} size={18} />
            </span>
            <div>
              <strong>Appearance & Theme</strong>
              <small>Customize the application visual style</small>
            </div>
          </div>
          <div className="settings-card-body theme-settings-body">
            <div className="theme-picker-heading">
              <div>
                <strong>Choose a palette</strong>
                <p>Five color families, each tuned for light and dark workspaces.</p>
              </div>
              <span className="current-theme-label">Current · {theme.replace('-', ' ')}</span>
            </div>

            <div className="setting-row">
              <div>
                <strong>Match system appearance</strong>
                <p>Automatically switch between your chosen dark and light themes when your OS changes mode.</p>
              </div>
              <label className="toggle-switch">
                <input type="checkbox" checked={!!autoTheme} onChange={(e) => onToggleAutoTheme && onToggleAutoTheme(e.target.checked)} />
                <span className="slider-round" />
              </label>
            </div>

            {autoTheme && (
              <div className="theme-auto-pair">
                <p style={{fontSize:10, color:'var(--muted)'}}>When auto is enabled, click any dark theme below to set it as the dark pair, and any light theme to set it as the light pair. By default violet dark and violet light are used.</p>
              </div>
            )}
            <div className="theme-pair-grid">
              {THEMES.map((option) => (
                <section className="theme-pair" key={option.id} aria-label={`${option.name} theme pair`}>
                  <div className="theme-pair-title">
                    <strong>{option.name}</strong>
                    <span>{option.description}</span>
                  </div>
                  <div className="theme-variants">
                    {[['light', option.light], ['dark', option.dark]].map(([mode, themeId]) => (
                      <button
                        key={themeId}
                        type="button"
                        className={`theme-choice ${theme === themeId ? 'selected' : ''} ${autoTheme && ((mode === 'dark' && selectedDarkTheme === themeId) || (mode === 'light' && selectedLightTheme === themeId)) ? 'auto-selected' : ''}`}
                        data-theme={themeId}
                        aria-pressed={theme === themeId}
                        aria-label={`${option.name} ${mode} theme${theme === themeId ? ', selected' : ''}${autoTheme && ((mode === 'dark' && selectedDarkTheme === themeId) || (mode === 'light' && selectedLightTheme === themeId)) ? ', auto pair' : ''}`}
                        onClick={() => {
                          if (autoTheme) {
                            if (mode === 'dark') onSelectDarkTheme && onSelectDarkTheme(themeId)
                            else onSelectLightTheme && onSelectLightTheme(themeId)
                          } else {
                            onSelectTheme(themeId)
                          }
                        }}
                      >
                        <span className="theme-preview" aria-hidden="true">
                          <span className="theme-preview-sidebar" />
                          <span className="theme-preview-content">
                            <i /><i /><i />
                            <b />
                          </span>
                        </span>
                        <span className="theme-choice-label">{mode === 'light' ? 'Light' : 'Dark'}</span>
                        {theme === themeId && <span className="theme-selected-mark"><Icon name="check" size={11} /></span>}
                        {autoTheme && ((mode === 'dark' && selectedDarkTheme === themeId) || (mode === 'light' && selectedLightTheme === themeId)) && <span className="theme-selected-mark" style={{background:'#d3ad78'}}><Icon name="star" size={9} /></span>}
                      </button>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </div>
        </div>

        {/* Storage & Output Directory */}
        <div className="settings-card">
          <div className="settings-card-header">
            <span className="tool-icon blue">
              <Icon name="file" size={18} />
            </span>
            <div>
              <strong>Storage & Output Destination</strong>
              <small>Where exported PDFs are saved by default</small>
            </div>
          </div>
          <div className="settings-card-body">
            <div className="setting-row">
              <div>
                <strong>Default Export Folder</strong>
                <p>Processed PDFs will be exported to this directory.</p>
              </div>
              <div className="folder-input-group">
                <input
                  type="text"
                  className="studio-input folder-input"
                  value={savePath}
                  readOnly
                />
                <button
                  className="ghost-button"
                  type="button"
                  onClick={changeOutputFolder}
                >
                  Change
                </button>
              </div>
            </div>

            <div className="setting-row">
              <div>
                <strong>Recent PDF copies ({(cacheSize / 1024 / 1024).toFixed(1)} MB)</strong>
                <p>Local copies used by the Recent Files page.</p>
              </div>
              <button
                className={`ghost-button ${cacheCleared ? 'cleared-btn' : ''}`}
                type="button"
                onClick={handleClearCache}
              >
                {cacheCleared ? 'History cleared' : 'Clear recent copies'}
              </button>
            </div>
          </div>
        </div>

        {/* Keyboard Shortcuts */}
        <div className="settings-card">
          <div className="settings-card-header">
            <span className="tool-icon amber">
              <Icon name="sliders" size={18} />
            </span>
            <div>
              <strong>Keyboard Shortcuts</strong>
              <small>Click any action and press a new combo to rebind it</small>
            </div>
          </div>
          <div className="settings-card-body">
            <InteractiveShortcuts />
          </div>
        </div>
      </div>
      {settingsError && <p className="form-error" role="alert">{settingsError}</p>}
    </div>
  )
}
