import React, { useState, useEffect, useRef } from 'react'
import { Icon } from '../icons'
import { allTools } from '../toolsData'

export function CommandPalette({ isOpen, onClose, onSelectTool }) {
  const [query, setQuery] = useState('')
  const inputRef = useRef(null)

  useEffect(() => {
    if (isOpen) {
      setQuery('')
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [isOpen])

  useEffect(() => {
    function handleKeyDown(e) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        if (isOpen) onClose()
        else onSelectTool(null, 'search-toggle')
      }
      if (e.key === 'Escape' && isOpen) {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose, onSelectTool])

  if (!isOpen) return null

  const filteredTools = allTools.filter((t) => {
    const q = query.toLowerCase().trim()
    if (!q) return true
    return (
      t.name.toLowerCase().includes(q) ||
      t.description.toLowerCase().includes(q) ||
      t.categoryLabel.toLowerCase().includes(q)
    )
  })

  return (
    <div className="palette-backdrop" onClick={onClose} role="dialog" aria-modal="true">
      <div className="palette-modal" onClick={(e) => e.stopPropagation()}>
        <div className="palette-search-row">
          <Icon name="search" size={18} className="palette-search-icon" />
          <input
            ref={inputRef}
            type="text"
            className="palette-input"
            placeholder="Search tools, actions, or workflows..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button className="palette-close-btn" type="button" onClick={onClose} aria-label="Close search">
            <kbd>ESC</kbd>
          </button>
        </div>

        <div className="palette-results">
          {filteredTools.length === 0 ? (
            <div className="palette-empty">
              <Icon name="search" size={24} />
              <p>No tools found for "{query}"</p>
              <span>Try searching for merge, split, compress, or sign</span>
            </div>
          ) : (
            <div className="palette-list">
              <div className="palette-section-title">
                {query ? `RESULTS (${filteredTools.length})` : 'ALL TOOLS & WORKFLOWS'}
              </div>
              {filteredTools.map((tool) => (
                <button
                  key={tool.id}
                  className="palette-item"
                  type="button"
                  onClick={() => {
                    onSelectTool(tool)
                    onClose()
                  }}
                >
                  <span className={`tool-icon ${tool.tone} palette-item-icon`}>
                    <Icon name={tool.icon} size={18} />
                  </span>
                  <div className="palette-item-text">
                    <div className="palette-item-title-row">
                      <strong>{tool.name}</strong>
                      <span className="palette-item-category">{tool.categoryLabel}</span>
                    </div>
                    <small>{tool.description}</small>
                  </div>
                  <Icon name="arrow" size={14} className="palette-item-arrow" />
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="palette-footer">
          <span>Navigate with click or arrow keys</span>
          <span><b>ESC</b> to close</span>
        </div>
      </div>
    </div>
  )
}
