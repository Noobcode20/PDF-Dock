import React, { useRef } from 'react'
import { Icon } from '../icons'

const TAB_TRANSFER_TYPE = 'application/x-pdf-king-tab'

export function TabBar({ tabs, activeTabId, dirtyTabIds = new Set(), onSelectTab, onCloseTab, onNewTab, getTitle, onStartTabDrag, onCancelTabDrag, onReorderTab, onImportTab }) {
  const draggedTabId = useRef(null)

  const handleDragStart = (event, tab) => {
    draggedTabId.current = tab.id
    const transferId = crypto.randomUUID()
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData(TAB_TRANSFER_TYPE, transferId)
    if (onStartTabDrag?.(tab, transferId) === false) {
      event.preventDefault()
      draggedTabId.current = null
    }
  }

  const handleDragOver = (event) => {
    if (!Array.from(event.dataTransfer.types).includes(TAB_TRANSFER_TYPE)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
  }

  const handleDrop = (event) => {
    const transferId = event.dataTransfer.getData(TAB_TRANSFER_TYPE)
    if (!transferId) return
    event.preventDefault()
    const target = event.target.closest('[data-workspace-tab-index]')
    let insertionIndex = tabs.length
    if (target) {
      insertionIndex = Number(target.dataset.workspaceTabIndex)
      const bounds = target.getBoundingClientRect()
      if (event.clientX >= bounds.left + bounds.width / 2) insertionIndex += 1
    }

    if (draggedTabId.current !== null) {
      onReorderTab?.(draggedTabId.current, insertionIndex)
      onCancelTabDrag?.(transferId)
    }
    else onImportTab?.(transferId, insertionIndex)
    draggedTabId.current = null
  }

  return (
    <div className="tabs-bar" onDragOver={handleDragOver} onDrop={handleDrop}>
      <div className="tabs-list" role="tablist" aria-label="Workspace tabs">
        {tabs.map((tab) => {
          const active = tab.id === activeTabId
          return (
            <div className={`workspace-tab ${active ? 'active' : ''}`} role="presentation" key={tab.id} data-workspace-tab-index={tabs.findIndex((item) => item.id === tab.id)} draggable onDragStart={(event) => handleDragStart(event, tab)} onDragEnd={() => { draggedTabId.current = null }}>
              <button
                className="tab-select"
                type="button"
                role="tab"
                id={`workspace-tab-${tab.id}`}
                aria-selected={active}
                aria-controls={`workspace-panel-${tab.id}`}
                onClick={() => onSelectTab(tab)}
                onKeyDown={(event) => {
                  if ((event.metaKey || event.ctrlKey) && ['ArrowLeft', 'ArrowRight'].includes(event.key)) {
                    event.preventDefault()
                    return
                  }
                  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
                  event.preventDefault()
                  const index = tabs.findIndex((item) => item.id === tab.id)
                  const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowLeft' ? tabs.length - 1 : 1)) % tabs.length
                  const nextTab = tabs[nextIndex]
                  onSelectTab(nextTab)
                  requestAnimationFrame(() => document.getElementById(`workspace-tab-${nextTab.id}`)?.focus())
                }}
                title={getTitle(tab.view)}
              >
                <span>{getTitle(tab.view)}</span>
                {dirtyTabIds.has(tab.id) && <span className="tab-unsaved-indicator" title="Unsaved PDF edits" aria-label="Unsaved PDF edits" />}
              </button>
              <button
                className="tab-close"
                type="button"
                onClick={() => onCloseTab(tab.id)}
                aria-label={`Close ${getTitle(tab.view)} tab`}
                title="Close tab"
              >
                <Icon name="x" size={12} />
              </button>
            </div>
          )
        })}
      </div>
      <button className="new-tab-button" type="button" onClick={onNewTab} aria-label="New tab" title="New tab">
        <Icon name="plus" size={15} />
      </button>
    </div>
  )
}
