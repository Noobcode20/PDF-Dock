import React from 'react'
import { Icon } from '../icons'
import { allTools, categories } from '../toolsData'

export function Topbar({ currentView, onNavigate, onOpenSearch, phoneLayout = false, mobileNavOpen = false, onToggleMobileNav }) {
  const isMac = window.pdfKing?.platform === 'darwin' || /Mac|iPhone|iPad/.test(navigator.platform || '')
  const isHome = currentView.type === 'home'
  // Build breadcrumb items based on current view
  const renderBreadcrumbs = () => {
    if (currentView.type === 'home') {
      return (
        <>
          <button className="crumb-btn" type="button" onClick={() => onNavigate({ type: 'home' })}>
            Workspace
          </button>
          <Icon name="chevron" size={13} />
          <strong>Home</strong>
        </>
      )
    }

    if (currentView.type === 'category') {
      const cat = categories.find((c) => c.id === currentView.categoryId)
      return (
        <>
          <button className="crumb-btn" type="button" onClick={() => onNavigate({ type: 'home' })}>
            Workspace
          </button>
          <Icon name="chevron" size={13} />
          <strong>{cat ? cat.label : 'Category'}</strong>
        </>
      )
    }

    if (currentView.type === 'tool') {
      const tool = allTools.find((t) => t.id === currentView.toolId)
      return (
        <>
          <button className="crumb-btn" type="button" onClick={() => onNavigate({ type: 'home' })}>
            Workspace
          </button>
          <Icon name="chevron" size={13} />
          {tool && (
            <>
              <button
                className="crumb-btn"
                type="button"
                onClick={() => onNavigate({ type: 'category', categoryId: tool.category })}
              >
                {tool.categoryLabel}
              </button>
              <Icon name="chevron" size={13} />
              <strong>{tool.name}</strong>
            </>
          )}
        </>
      )
    }

    if (currentView.type === 'recent') {
      return (
        <>
          <button className="crumb-btn" type="button" onClick={() => onNavigate({ type: 'home' })}>
            Workspace
          </button>
          <Icon name="chevron" size={13} />
          <strong>Recent files</strong>
        </>
      )
    }

    if (currentView.type === 'settings') {
      return (
        <>
          <button className="crumb-btn" type="button" onClick={() => onNavigate({ type: 'home' })}>
            Workspace
          </button>
          <Icon name="chevron" size={13} />
          <strong>Settings</strong>
        </>
      )
    }

    return <strong>Workspace</strong>
  }

  return (
    <header className="topbar">
      <div className="topbar-leading">
        {phoneLayout && <button className="mobile-nav-toggle" type="button" onClick={onToggleMobileNav} aria-label={mobileNavOpen ? 'Close navigation menu' : 'Open navigation menu'} aria-expanded={mobileNavOpen} aria-controls="workspace-sidebar"><Icon name="menu" size={19} /></button>}
        <div className="breadcrumbs">{renderBreadcrumbs()}</div>
      </div>

      <div className="topbar-actions">
        <button
          className="search-box"
          type="button"
          onClick={onOpenSearch}
          aria-label={`Open command palette (${isMac ? 'Command' : 'Ctrl'} K)`}
        >
          <Icon name="search" size={16} />
          <span>Command palette</span>
          <kbd>{isMac ? '⌘ + K' : 'Ctrl + K'}</kbd>
        </button>

      </div>
    </header>
  )
}
