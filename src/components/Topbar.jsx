import React from 'react'
import { Icon } from '../icons'
import { categories, allTools } from '../toolsData'
import { isLightTheme } from '../themes'

export function Topbar({ currentView, onNavigate, onOpenSearch, theme, onToggleTheme, sidebarCollapsed, onToggleSidebar }) {
  const isLight = isLightTheme(theme)
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
        <button
          className="icon-button sidebar-toggle"
          type="button"
          onClick={onToggleSidebar}
          aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <Icon name="sidebar" size={18} />
        </button>
        <div className="breadcrumbs">{renderBreadcrumbs()}</div>
      </div>

      <div className="topbar-actions">
        <button
          className="search-box"
          type="button"
          onClick={onOpenSearch}
          aria-label="Search tools (Command K)"
        >
          <Icon name="search" size={16} />
          <span>Search tools</span>
          <kbd>⌘ K</kbd>
        </button>

        <div className="topbar-divider" />

        <button
          className="top-avatar-btn"
          type="button"
          onClick={() => onNavigate({ type: 'settings' })}
          title="Workspace Settings"
          aria-label="Open Workspace Settings"
        >
          <div className="top-avatar">K</div>
        </button>
      </div>
    </header>
  )
}
