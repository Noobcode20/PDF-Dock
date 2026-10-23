import React, { useState, useEffect, useRef } from 'react'
import { Icon } from '../icons'
import { allTools, categories } from '../toolsData'
import { Presence } from './Presence'
import { loadShortcuts } from '../keyboardShortcuts'
import { recentFilesBackend } from '../recentFiles'

export function CommandPalette({ isOpen, onClose, onSelectTool, onNavigate, onNewDocument, onNewWindow, onOpenPdf, onToggleTheme, onToggleSidebar, onNewTab, size = 'compact' }) {
  const isMac = window.pdfKing?.platform === 'darwin' || /Mac|iPhone|iPad/.test(navigator.platform || '')
  const shortcutMod = isMac ? '⌘' : 'Ctrl'
  const shortcuts = loadShortcuts()
  const shortcutLabel = (action) => {
    const value = shortcuts[action]
    if (!value?.key) return undefined
    const parts = []
    if (value.metaKey && value.ctrlKey) parts.push(shortcutMod)
    else if (value.metaKey) parts.push('⌘')
    else if (value.ctrlKey) parts.push('Ctrl')
    if (value.altKey) parts.push(isMac ? '⌥' : 'Alt')
    if (value.shiftKey) parts.push('⇧')
    parts.push(value.key.length === 1 ? value.key.toUpperCase() : value.key)
    return parts.join(' ')
  }
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const [keyboardNavigation, setKeyboardNavigation] = useState(false)
  const [recentFiles, setRecentFiles] = useState([])
  const [recentError, setRecentError] = useState('')
  const inputRef = useRef(null)

  useEffect(() => {
    if (isOpen) {
      setQuery('')
      setActiveIndex(0)
      setKeyboardNavigation(false)
      setRecentError('')
      setTimeout(() => inputRef.current?.focus(), 50)
      Promise.resolve(recentFilesBackend().getRecentFiles?.()).then(setRecentFiles).catch(() => setRecentFiles([]))
    }
  }, [isOpen])

  const openRecent = async (file) => {
    try {
      const backend = recentFilesBackend()
      if (!backend?.readRecentFile) throw new Error('This PDF could not be opened because local file storage is unavailable.')
      const data = await backend.readRecentFile(file.id)
      if (!data) throw new Error('The selected recent PDF could not be read.')
      onNavigate?.({ type: 'tool', toolId: 'pdf-editor', files: [new File([data], file.name, { type: 'application/pdf' })] })
      return true
    } catch (error) { setRecentError(error.message || `Could not open ${file.name}.`); return false }
  }
  const commands = [
    { id: 'home', label: 'Go to Home', description: 'Open the workspace home', group: 'Navigation', icon: 'home', shortcut: shortcutLabel('navigate-home'), run: () => onNavigate?.({ type: 'home' }) },
    { id: 'recent', label: 'Open Recent Files', description: 'Browse recently opened PDFs', group: 'Navigation', icon: 'file', shortcut: shortcutLabel('navigate-recent'), run: () => onNavigate?.({ type: 'recent' }) },
    { id: 'settings', label: 'Open Settings', description: 'Manage appearance, privacy, and shortcuts', group: 'Navigation', icon: 'settings', shortcut: shortcutLabel('navigate-settings'), run: () => onNavigate?.({ type: 'settings' }) },
    { id: 'new-document', label: 'Create New Document', description: 'Open a PDF or create a blank document', group: 'Actions', icon: 'plus', run: onNewDocument },
    { id: 'new-window', label: 'New Window', description: 'Open another PDF Dock window', group: 'Actions', icon: 'plus', shortcut: shortcutLabel('new-window'), run: onNewWindow },
    { id: 'open-pdf', label: 'Open PDF', description: 'Choose a PDF from your device', group: 'Actions', icon: 'upload', shortcut: shortcutLabel('open-file'), run: onOpenPdf },
    { id: 'new-tab', label: 'New Workspace Tab', description: 'Open a fresh workspace tab', group: 'Actions', icon: 'plus', shortcut: shortcutLabel('new-tab'), run: onNewTab },
    { id: 'toggle-theme', label: 'Toggle Theme', description: 'Switch between light and dark appearance', group: 'Actions', icon: 'sun', shortcut: shortcutLabel('toggle-theme'), run: onToggleTheme },
    { id: 'toggle-sidebar', label: 'Toggle Sidebar', description: 'Show or hide workspace navigation', group: 'Actions', icon: 'sidebar', shortcut: shortcutLabel('toggle-sidebar'), run: onToggleSidebar },
    ...categories.map((category) => ({ id: `category-${category.id}`, label: `Browse ${category.label}`, description: `Show ${category.label.toLowerCase()} tools`, group: 'Categories', icon: category.icon, run: () => onNavigate?.({ type: 'category', categoryId: category.id }) })),
    ...recentFiles.map((file) => ({ id: `recent-${file.id}`, label: file.name, description: 'Open a recent PDF', group: 'Recent Documents', icon: 'file', run: () => openRecent(file) })),
    ...allTools.map((tool) => ({ id: `tool-${tool.id}`, label: tool.name, description: tool.description, group: 'Tools', icon: tool.icon, tone: tool.tone, categoryLabel: tool.categoryLabel, tool }))
  ]
  const filteredCommands = commands.filter((command) => {
    const q = query.toLowerCase().trim()
    if (!q) return true
    return [command.label, command.description, command.group, command.categoryLabel].filter(Boolean).join(' ').toLowerCase().includes(q)
  })
  const groupedCommands = filteredCommands.reduce((groups, command, index) => {
    if (!groups[command.group]) groups[command.group] = []
    groups[command.group].push({ command, index })
    return groups
  }, {})
  const showCommands = size === 'maximized' || query.trim().length > 0
  useEffect(() => {
    if (isOpen) document.querySelector(`[data-command-index="${activeIndex}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, isOpen])

  const selectActive = async () => {
    if (!showCommands || filteredCommands.length === 0) return
    const command = filteredCommands[activeIndex]
    if (!command) return
    if (command.id.startsWith('recent-')) {
      const file = recentFiles.find((entry) => `recent-${entry.id}` === command.id)
      if (file && await openRecent(file)) onClose()
      return
    }
    if (command.tool) onSelectTool(command.tool)
    else command.run?.()
    onClose()
  }

  return (
    <Presence present={isOpen} exitDuration={200}><div className="palette-backdrop" onClick={onClose}>
      <div className={`palette-modal ${size === 'maximized' ? 'maximized' : 'compact'} ${keyboardNavigation ? 'keyboard-nav' : ''}`} role="dialog" aria-modal="true" aria-label="Command palette" onClick={(e) => e.stopPropagation()} onMouseMove={() => setKeyboardNavigation(false)} onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose() } }}>
        <div className="palette-search-row">
          <Icon name="search" size={18} className="palette-search-icon" />
          <input
            ref={inputRef}
            type="text"
            className="palette-input"
            placeholder="Search tools, actions, pages, or recent PDFs…"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setActiveIndex(0) }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown' && showCommands && filteredCommands.length) { event.preventDefault(); setKeyboardNavigation(true); setActiveIndex((index) => Math.min(index + 1, filteredCommands.length - 1)) }
              if (event.key === 'ArrowUp' && showCommands && filteredCommands.length) { event.preventDefault(); setKeyboardNavigation(true); setActiveIndex((index) => Math.max(index - 1, 0)) }
              if (event.key === 'Enter') { event.preventDefault(); selectActive() }
            }}
          />
          <button className="palette-close-btn" type="button" onClick={onClose} aria-label="Close search">
            <kbd>Esc</kbd>
          </button>
        </div>

        {showCommands && <div className="palette-results">
          {recentError && <p className="form-error" role="alert">{recentError}</p>}
          {filteredCommands.length === 0 ? (
            <div className="palette-empty">
              <Icon name="search" size={24} />
              <p>No commands found for “{query}”</p>
              <span>Try a tool name, category, recent file, or action</span>
            </div>
          ) : (
            <>{Object.entries(groupedCommands).map(([group, entries]) => <section className="palette-command-group" key={group}>
              <div className="palette-section-title">{group} <span>{entries.length}</span></div>
              <div className="palette-list">
              {entries.map(({ command, index }) => (
                <button
                  key={command.id}
                  className={`palette-item ${command.tool ? 'is-tool-command' : ''} ${activeIndex === index ? 'active' : ''}`}
                  data-command-index={index}
                  aria-current={activeIndex === index ? 'true' : undefined}
                  onMouseEnter={() => setActiveIndex(index)}
                  type="button"
                  onClick={() => {
                    if (command.id.startsWith('recent-')) {
                      const file = recentFiles.find((entry) => `recent-${entry.id}` === command.id)
                      if (file) void openRecent(file).then((opened) => { if (opened) onClose() })
                      return
                    }
                    if (command.tool) onSelectTool(command.tool)
                    else command.run?.()
                    onClose()
                  }}
                >
                  <span className={`tool-icon ${command.tone || 'neutral'} palette-item-icon`}>
                    <Icon name={command.icon} size={18} />
                  </span>
                  <div className="palette-item-text">
                    <div className="palette-item-title-row">
                      <strong>{command.label}</strong>
                      {command.categoryLabel && <span className="palette-item-category">{command.categoryLabel}</span>}
                    </div>
                    <small>{command.description}</small>
                  </div>
                  {command.shortcut && <kbd className="palette-command-shortcut">{command.shortcut}</kbd>}
                  <Icon name="arrow" size={14} className="palette-item-arrow" />
                </button>
              ))}
              </div>
            </section>)}</>
          )}
        </div>}

        {showCommands && <div className="palette-footer">
          <span><kbd>↑</kbd> <kbd>↓</kbd> Navigate <kbd>↵</kbd> Run</span>
          <span><kbd>{shortcutLabel('search') || '—'}</kbd> Open <kbd>Esc</kbd> Close</span>
        </div>}
      </div>
    </div></Presence>
  )
}
