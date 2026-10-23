import React, { useEffect, useRef, useState } from 'react'
import { Icon } from '../icons'
import { THEMES, isLightTheme } from '../themes'
import { DEFAULT_SHORTCUTS, loadShortcuts, saveShortcuts } from '../keyboardShortcuts'
import { listLocalFonts, readFontFamilyName, removeLocalFont, saveLocalFont } from '../editor/localFonts'
import { recentFilesBackend } from '../recentFiles'

function InteractiveShortcuts({ showAll, setShowAll }) {
  const [shortcuts, setShortcuts] = useState(loadShortcuts())
  const [recording, setRecording] = useState(null)
  const [savedAction, setSavedAction] = useState(null)

  const actions = [
    ['search', 'Quick search'],
    ['new-window', 'New window'],
    ['open-file', 'Open PDF'],
    ['save-export', 'Save document'],
    ['undo', 'Undo'],
    ['redo', 'Redo'],
    ['close-overlay', 'Close dialog or menu'],
    ['navigate-home', 'Go to Home'],
    ['navigate-recent', 'Go to Recent files'],
    ['navigate-settings', 'Go to Settings'],
    ['navigate-editor', 'Go to Editor'],
    ['new-document', 'New document'],
    ['new-tab', 'New tab'],
    ['close-tab', 'Close tab'],
    ['close-window', 'Close window'],
    ['toggle-sidebar', 'Toggle sidebar'],
    ['toggle-theme', 'Toggle light/dark theme'],
    ['print-document', 'Print PDF'],
    ['toggle-right-sidebar', 'Toggle editor properties panel'],
    ['focus-editor-search', 'Find in PDF'],
    ['editor-page-next', 'Next PDF page'],
    ['editor-page-previous', 'Previous PDF page'],
    ['editor-page-first', 'First PDF page'],
    ['editor-page-last', 'Last PDF page'],
    ['editor-zoom-in', 'Zoom in'],
    ['editor-zoom-out', 'Zoom out'],
    ['editor-zoom-reset', 'Reset zoom']
  ]
  const repeatActions = new Set(['search', 'open-file'])

  const setToggleOnRepeat = (key, enabled) => {
    const updated = { ...shortcuts, [key]: { ...shortcuts[key], toggleOnRepeat: enabled } }
    setShortcuts(updated)
    saveShortcuts(updated)
  }

  useEffect(() => {
    const handle = (e) => {
      if (!recording) return
      e.preventDefault()
      e.stopImmediatePropagation()
      if (e.key === 'Escape') { setRecording(null); delete document.body.dataset.shortcutRecording; return }
      if (['Backspace', 'Delete'].includes(e.key) && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        const updated = { ...shortcuts, [recording]: { ...shortcuts[recording], combo: '—', metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, key: '' } }
        setShortcuts(updated); saveShortcuts(updated); setRecording(null); setSavedAction(recording); delete document.body.dataset.shortcutRecording; return
      }
      if (['Control', 'Meta', 'Shift', 'Alt', 'AltGraph'].includes(e.key) || e.repeat) return
      const comboStr = [e.metaKey ? 'meta' : '', e.ctrlKey ? 'ctrl' : '', e.altKey ? 'alt' : '', e.shiftKey ? 'shift' : '', e.key.length === 1 ? e.key.toLowerCase() : e.key].filter(Boolean).join('+')
      const captured = { combo: comboStr, metaKey: !!e.metaKey, ctrlKey: !!e.ctrlKey, shiftKey: !!e.shiftKey, altKey: !!e.altKey, key: e.key }
      const isMac = window.pdfKing?.platform === 'darwin' || /Mac|iPhone|iPad/.test(navigator.platform || '')
      const signature = (shortcut) => {
        if (!shortcut?.key) return ''
        const modifier = shortcut.metaKey && shortcut.ctrlKey
          ? 'platform'
          : shortcut.metaKey
            ? (isMac ? 'platform' : 'meta')
            : shortcut.ctrlKey
              ? (isMac ? 'ctrl' : 'platform')
              : ''
        return [modifier, !!shortcut.altKey, !!shortcut.shiftKey, shortcut.key.toLowerCase()].join('|')
      }
      const nextSignature = signature(captured)
      const updated = { ...shortcuts, [recording]: { ...shortcuts[recording], ...captured } }
      for (const [action, shortcut] of Object.entries(updated)) {
        if (action !== recording && signature(shortcut) === nextSignature) {
          updated[action] = { ...shortcut, combo: '—', metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, key: '' }
        }
      }
      setShortcuts(updated)
      saveShortcuts(updated)
      setRecording(null)
      setSavedAction(recording)
      window.setTimeout(() => setSavedAction((current) => current === recording ? null : current), 1400)
      delete document.body.dataset.shortcutRecording
    }
    window.addEventListener('keydown', handle)
    return () => window.removeEventListener('keydown', handle)
  }, [recording, shortcuts])

  useEffect(() => () => { delete document.body.dataset.shortcutRecording }, [])

  useEffect(() => {
    const syncShortcuts = (event) => { if (event.key === 'pdfking-shortcuts') setShortcuts(loadShortcuts()) }
    window.addEventListener('storage', syncShortcuts)
    return () => window.removeEventListener('storage', syncShortcuts)
  }, [])

  const formatShortcut = (shortcut = {}) => {
    if (!shortcut.key) return '—'
    const parts = []
    const commandOrControl = shortcut.metaKey && shortcut.ctrlKey
    const isMac = window.pdfKing?.platform === 'darwin' || /Mac|iPhone|iPad/.test(navigator.platform || '')
    if (commandOrControl) parts.push(isMac ? '⌘' : 'Ctrl')
    else {
      if (shortcut.metaKey) parts.push('⌘')
      if (shortcut.ctrlKey) parts.push('Ctrl')
    }
    if (shortcut.altKey) parts.push('⌥')
    if (shortcut.shiftKey) parts.push('⇧')
    parts.push(shortcut.key.length === 1 ? shortcut.key.toUpperCase() : shortcut.key)
    return parts.join(' + ')
  }

  const clearShortcut = (key) => {
    const updated = { ...shortcuts, [key]: { ...shortcuts[key], combo: '—', metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, key: '' } }
    setShortcuts(updated); saveShortcuts(updated); setRecording(null); delete document.body.dataset.shortcutRecording
  }
  const resetShortcuts = () => { setShortcuts(DEFAULT_SHORTCUTS); saveShortcuts(DEFAULT_SHORTCUTS); setRecording(null); delete document.body.dataset.shortcutRecording }
  const visibleActions = showAll ? actions : actions.slice(0, 5)

  return (
    <div className="shortcuts-table">
      {visibleActions.map(([key, label]) => (
        <div key={key} className="shortcut-setting-row">
          <button type="button" className={`shortcut-item ${recording === key ? 'is-recording' : ''}`} onClick={() => { setSavedAction(null); document.body.dataset.shortcutRecording = 'true'; setRecording(key) }} aria-label={`Change shortcut for ${label}`}>
            <span>{label}</span>
            <span className="shortcut-binding-value">
              <kbd>{recording === key ? 'Press shortcut…' : formatShortcut(shortcuts[key])}</kbd>
              <span className="shortcut-saved" aria-live="polite">{savedAction === key ? 'Saved' : ''}</span>
            </span>
          </button>
          {repeatActions.has(key) && <label className="shortcut-repeat-toggle"><input type="checkbox" checked={shortcuts[key]?.toggleOnRepeat !== false} onChange={(event) => setToggleOnRepeat(key, event.target.checked)} /><span>Press again to close</span></label>}
          {showAll && shortcuts[key]?.key && <button type="button" className="shortcut-clear" onClick={() => clearShortcut(key)} aria-label={`Clear shortcut for ${label}`}>Clear</button>}
        </div>
      ))}
      <div className="shortcut-list-actions">
        {showAll && <button type="button" onClick={resetShortcuts}>Reset defaults</button>}
      </div>
      {recording && <p className="shortcut-recording-hint">Press a key combination to assign it. Press Escape to cancel or Backspace to clear.</p>}
    </div>
  )
}

export function SettingsPage({ theme, onSelectTheme, onNavigate, autoTheme, onToggleAutoTheme, selectedDarkTheme, selectedLightTheme, onSelectDarkTheme, onSelectLightTheme, userName = 'User', userAvatar, onSetUserName, onSetAvatar, commandPaletteSize = 'compact', onSetCommandPaletteSize }) {
  const activeTheme = THEMES.find((option) => theme === option.light || theme === option.dark)
  const activeVariant = theme.endsWith('-light') ? 'Light' : 'Dark'
  const [activeSection, setActiveSection] = useState('appearance')
  const [showAllShortcuts, setShowAllShortcuts] = useState(false)
  const [savePath, setSavePath] = useState('')
  const [cacheCleared, setCacheCleared] = useState(false)
  const [keepRecent, setKeepRecent] = useState(() => window.localStorage.getItem('pdfking-keep-recent') !== 'false')
  const [cacheSize, setCacheSize] = useState(0)
  const [settingsError, setSettingsError] = useState('')
  const [localFonts, setLocalFonts] = useState([])
  const [fontMessage, setFontMessage] = useState('')
  const fontPicker = useRef(null)
  const [editingName, setEditingName] = useState(false)
  const [draftName, setDraftName] = useState(userName)
  const avatarPicker = useRef(null)
  const nameInput = useRef(null)
  const hasNativeOutputFolder = Boolean(window.pdfKing?.chooseOutputFolder)

  useEffect(() => {
    const refreshSettings = () => {
      window.pdfKing?.getDefaultOutputFolder?.().then(setSavePath).catch(() => {})
      Promise.resolve(recentFilesBackend().getRecentFiles?.()).then((files) => setCacheSize((files || []).reduce((sum, file) => sum + (file.size || 0), 0))).catch(() => {})
    }
    refreshSettings()
    window.addEventListener('focus', refreshSettings)
    document.addEventListener('visibilitychange', refreshSettings)
    return () => { window.removeEventListener('focus', refreshSettings); document.removeEventListener('visibilitychange', refreshSettings) }
  }, [])

  useEffect(() => { listLocalFonts().then(setLocalFonts).catch(() => setSettingsError('Could not load local fonts.')) }, [])

  const addLocalFont = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!/\.(ttf|otf|woff|woff2)$/i.test(file.name)) { setSettingsError('Choose a TTF, OTF, WOFF, or WOFF2 font file.'); return }
    try {
      const data = await file.arrayBuffer()
      const id = crypto.randomUUID()
      const name = readFontFamilyName(data, file.name.replace(/\.(ttf|otf|woff2?)$/i, ''))
      await saveLocalFont({ id, name, fileName: file.name, size: file.size, data })
      setLocalFonts(await listLocalFonts())
      setSettingsError('')
      setFontMessage(`${name} added to your local font library.`)
    } catch (cause) { setSettingsError(cause.message || 'Could not add this font.') }
  }

  const deleteLocalFont = async (id) => {
    try { await removeLocalFont(id); setLocalFonts(await listLocalFonts()) }
    catch (cause) { setSettingsError(cause.message || 'Could not remove this font.') }
  }

  useEffect(() => {
    const syncRecentPreference = (event) => {
      if (event.key === 'pdfking-keep-recent') setKeepRecent(event.newValue !== 'false')
    }
    window.addEventListener('storage', syncRecentPreference)
    return () => window.removeEventListener('storage', syncRecentPreference)
  }, [])

  const handleClearCache = async () => {
    setCacheCleared(false)
    try {
      const backend = recentFilesBackend()
      if (!backend?.clearRecentFiles) throw new Error('Clearing local PDF copies is not available in this build.')
      await backend.clearRecentFiles()
      setCacheSize(0)
      setSettingsError('')
      setCacheCleared(true)
      setTimeout(() => setCacheCleared(false), 3000)
    } catch (cause) { setSettingsError(cause.message || 'Could not clear recent PDF copies.') }
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
    event.target.value = ''
    if (!file.type.startsWith('image/')) { setSettingsError('Choose an image file for your profile photo.'); return }
    if (file.size > 20 * 1024 * 1024) { setSettingsError('Choose an image smaller than 20 MB.'); return }
    createImageBitmap(file).then((bitmap) => {
      const canvas = document.createElement('canvas')
      const scale = Math.min(1, 512 / Math.max(bitmap.width, bitmap.height))
      canvas.width = Math.max(1, Math.round(bitmap.width * scale))
      canvas.height = Math.max(1, Math.round(bitmap.height * scale))
      canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height)
      bitmap.close()
      onSetAvatar(canvas.toDataURL('image/jpeg', 0.86))
      setSettingsError('')
    }).catch(() => setSettingsError('Could not read this image. Choose another photo.'))
  }

  const selectThemeVariant = (themeId, mode) => {
    if (autoTheme) {
      if (mode === 'light') onSelectLightTheme?.(themeId)
      else onSelectDarkTheme?.(themeId)
    } else onSelectTheme?.(themeId)
  }

  const renderThemeChoice = (option, mode) => {
    const themeId = mode === 'light' ? option.light : option.dark
    const selected = theme === themeId
    return <button
      key={mode}
      type="button"
      className={`theme-choice ${selected ? 'selected' : ''}`}
      data-theme={themeId}
      aria-pressed={selected}
      aria-label={`${option.name} ${mode} theme${selected ? ', selected' : ''}`}
      onClick={() => selectThemeVariant(themeId, mode)}
    >
      <span className="theme-preview" aria-hidden="true">
        <span className="theme-preview-sidebar"><i className="theme-preview-brand" /><i /><i /><i /></span>
        <span className="theme-preview-content">
          <span className="theme-preview-topbar"><i /><b /></span>
          <span className="theme-preview-heading" />
          <span className="theme-preview-lines"><i /><i /><i /></span>
          <span className="theme-preview-action" />
        </span>
      </span>
      <span className="theme-choice-label">{mode === 'light' ? 'Light' : 'Dark'}</span>
      {selected && <span className="theme-selected-mark"><Icon name="check" size={11} /></span>}
    </button>
  }

  return (
    <div className="page-content settings-page settings-redesign">
      <header className="settings-page-heading">
        <div><h1>Settings</h1><p>Personalize your PDF Dock workspace</p></div>
      </header>
      <div className="settings-tabs" role="tablist" aria-label="Settings sections">
        {[
          ['appearance', 'Appearance', 'sun'],
          ['general', 'General', 'sliders'],
          ['shortcuts', 'Shortcuts', 'keyboard'],
        ].map(([id, label, icon]) => <button key={id} type="button" role="tab" id={`settings-tab-${id}`} aria-selected={activeSection === id} aria-controls={`settings-panel-${id}`} className={activeSection === id ? 'active' : ''} onClick={() => setActiveSection(id)}><Icon name={icon} size={14} />{label}</button>)}
      </div>

      <div className="settings-sections" id={`settings-panel-${activeSection}`} role="tabpanel" aria-labelledby={`settings-tab-${activeSection}`}>
        {activeSection === 'general' && <div className="settings-card">
          <div className="settings-card-header"><span className="tool-icon lilac"><Icon name="user" size={18} /></span><div><strong>Profile</strong><small>Personalize your workspace</small></div></div>
          <div className="settings-card-body settings-profile-body">
            <button className="greeting-avatar" type="button" onClick={() => avatarPicker.current?.click()} aria-label="Change profile picture" title="Change profile picture">
              {userAvatar ? <img src={userAvatar} alt="" /> : <span><Icon name="user" size={24} /></span>}
              <span className="greeting-avatar-edit"><Icon name="edit" size={12} /></span>
            </button>
            {editingName ? <input ref={nameInput} className="greeting-name-input" aria-label="Edit your name" value={draftName} onChange={(event) => setDraftName(event.target.value)} onBlur={saveName} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); saveName() } if (event.key === 'Escape') { setDraftName(userName); setEditingName(false) } }} /> : <div className="settings-profile-name"><strong>{userName}</strong><small>Local profile</small></div>}
            {!editingName && <button className="ghost-button" type="button" onClick={beginNameEdit}><Icon name="edit" size={14} />Edit name</button>}
            <input ref={avatarPicker} className="avatar-file-input" type="file" accept="image/*" aria-label="Choose a profile picture" onChange={chooseAvatar} />
          </div>
        </div>}

        {activeSection === 'general' && <div className="settings-card">
          <div className="settings-card-header">
            <span className="tool-icon blue"><Icon name="type" size={18} /></span>
            <div><strong>Local fonts</strong></div>
            <button className="ghost-button" type="button" onClick={() => fontPicker.current?.click()}>Add font</button>
            <input ref={fontPicker} hidden type="file" accept=".ttf,.otf,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2" onChange={addLocalFont} />
          </div>
          <div className="settings-card-body">
            <p className="settings-description">Fonts stay on this device and are available in PDF text editing. TTF, OTF, WOFF, and WOFF2 files can be embedded when saving edited text.</p>
            {fontMessage && <p role="status">{fontMessage}</p>}
            {localFonts.length ? localFonts.map((font) => <div className="setting-row" key={font.id}><div><strong>{font.name}</strong><p>{font.fileName} · {(font.size / 1024).toFixed(0)} KB</p></div><button className="ghost-button" type="button" onClick={() => void deleteLocalFont(font.id)}>Remove</button></div>) : <p>No local fonts added yet.</p>}
          </div>
        </div>}

        {/* Privacy & Engine */}
        {activeSection === 'general' && <div className="settings-card">
          <div className="settings-card-header">
            <span className="tool-icon green">
              <Icon name="shield" size={18} />
            </span>
            <div>
              <strong>Privacy & Local Security</strong>
            </div>
          </div>
          <div className="settings-card-body">
            <div className="setting-row">
              <div>
                <strong>On-device processing</strong>
                <p>{hasNativeOutputFolder ? 'PDF operations run locally in this app. Files are saved through your desktop file dialog.' : 'PDF operations run locally in this tab. Exports are downloaded by your browser.'}</p>
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
        </div>}

        {/* Appearance */}
        {activeSection === 'appearance' && <div className="settings-card">
          <div className="settings-card-header">
            <span className="tool-icon lilac">
              <Icon name={isLightTheme(theme) ? 'sun' : 'moon'} size={18} />
            </span>
            <div>
              <strong>Appearance & Theme</strong>
            </div>
            <span className="current-theme-label">Current · {activeTheme?.name || 'Daylight'} {activeVariant}</span>
          </div>
          <div className="settings-card-body theme-settings-body">
            <div className="setting-row settings-color-mode-row">
              <strong>Color mode</strong>
              <div className="theme-toggle-group" role="group" aria-label="Color mode">
                {['light', 'dark'].map((mode) => <button key={mode} type="button" className={`settings-mode-button ${isLightTheme(theme) === (mode === 'light') ? 'selected' : ''}`} aria-pressed={isLightTheme(theme) === (mode === 'light')} onClick={() => { onToggleAutoTheme?.(false); onSelectTheme?.(mode === 'light' ? selectedLightTheme : selectedDarkTheme) }}>{mode === 'light' ? 'Light' : 'Dark'}</button>)}
              </div>
            </div>
            <div className="setting-row theme-auto-toggle-row">
              <div>
                <strong>Match system appearance</strong>
                <p>Automatically switch between your chosen dark and light themes when your OS changes mode.</p>
              </div>
              <label className="toggle-switch">
                <input type="checkbox" checked={!!autoTheme} onChange={(e) => onToggleAutoTheme && onToggleAutoTheme(e.target.checked)} />
                <span className="slider-round" />
              </label>
            </div>

            <div className="theme-collection-heading"><strong>Theme collection</strong><span>{THEMES.length} themes</span></div>
            <div className="theme-pair-grid">
              {THEMES.map((option) => <section className="theme-pair settings-theme-option" key={option.id} aria-label={`${option.name} theme`}>
                <div className="theme-pair-title"><strong>{option.name}</strong></div>
                <div className="theme-variants">{renderThemeChoice(option, 'light')}{renderThemeChoice(option, 'dark')}</div>
              </section>)}
            </div>
          </div>
        </div>}

        {/* Storage & Output Directory */}
        {activeSection === 'general' && <div className="settings-card">
          <div className="settings-card-header">
            <span className="tool-icon blue">
              <Icon name="file" size={18} />
            </span>
            <div>
              <strong>Storage & Output Destination</strong>
            </div>
          </div>
          <div className="settings-card-body">
            <div className="setting-row">
              <div>
                <strong>{hasNativeOutputFolder ? 'Default Export Folder' : 'Export Destination'}</strong>
                <p>{hasNativeOutputFolder ? 'Processed PDFs will be exported to this directory.' : 'Processed PDFs are downloaded by your browser to its default download location.'}</p>
              </div>
              {hasNativeOutputFolder ? <div className="folder-input-group">
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
              </div> : <span className="settings-native-note">Browser download</span>}
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
        </div>}

        {/* Keyboard Shortcuts */}
        {activeSection === 'shortcuts' && <div className="settings-card">
          <div className="settings-card-header"><span className="tool-icon amber"><Icon name="keyboard" size={18} /></span><div><strong>Keyboard shortcuts</strong><small>Click a shortcut to change it</small></div><button className="shortcut-show-all" type="button" onClick={() => setShowAllShortcuts((value) => !value)}>{showAllShortcuts ? 'Show fewer' : 'Show all'}</button></div>
          <div className="settings-card-body">
            <InteractiveShortcuts showAll={showAllShortcuts} setShowAll={setShowAllShortcuts} />
          </div>
        </div>}
        {activeSection === 'general' && <div className="settings-card">
          <div className="settings-card-header">
            <span className="tool-icon lilac"><Icon name="search" size={18} /></span>
            <div>
              <strong>Command Palette</strong>
            </div>
          </div>
          <div className="settings-card-body">
            <div className="setting-row command-palette-size-row">
              <div>
                <strong>Palette size</strong>
                <p>Compact keeps the palette short. Maximized shows more commands at once.</p>
              </div>
              <div className="palette-size-options" role="group" aria-label="Command palette size">
                {['compact', 'maximized'].map((size) => <button key={size} type="button" className={`ghost-button ${commandPaletteSize === size ? 'selected' : ''}`} aria-pressed={commandPaletteSize === size} onClick={() => onSetCommandPaletteSize?.(size)}>{size === 'compact' ? 'Compact' : 'Maximized'}</button>)}
              </div>
            </div>
          </div>
        </div>}
      </div>
      {settingsError && <p className="form-error" role="alert">{settingsError}</p>}
    </div>
  )
}
