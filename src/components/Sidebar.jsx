import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '../icons'
import { allTools, categories } from '../toolsData'

const TOOL_CATEGORY_IDS = ['organize', 'convert', 'secure']

export function Sidebar({ currentView, onNavigate, onOpenNewDocument, onToggleCollapsed, collapsed, theme, phoneLayout = false, onCloseMobileNav }) {
  const [expandedCategory, setExpandedCategory] = useState(null)
  const [flyout, setFlyout] = useState(null)
  const closeTimer = useRef(null)
  const visibleCategories = categories.filter((category) => TOOL_CATEGORY_IDS.includes(category.id))
  const isCollapsed = collapsed && !phoneLayout
  const isEditorActive = currentView.type === 'tool' && currentView.toolId === 'pdf-editor'
  const isToolActive = (toolId) => currentView.type === 'tool' && currentView.toolId === toolId
  const cancelFlyoutClose = () => window.clearTimeout(closeTimer.current)
  const deferFlyoutClose = () => { closeTimer.current = window.setTimeout(() => setFlyout(null), 140) }
  const navigate = (view) => { setFlyout(null); onNavigate(view); onCloseMobileNav?.() }

  useEffect(() => {
    if (currentView.type !== 'tool') return
    const category = allTools.find((tool) => tool.id === currentView.toolId)?.category
    if (TOOL_CATEGORY_IDS.includes(category)) setExpandedCategory(category)
  }, [currentView.type, currentView.toolId])
  useEffect(() => () => window.clearTimeout(closeTimer.current), [])
  useEffect(() => {
    if (!flyout) return undefined
    const closeOnEscape = (event) => { if (event.key === 'Escape') { setFlyout(null); event.stopPropagation() } }
    window.addEventListener('keydown', closeOnEscape, true)
    return () => window.removeEventListener('keydown', closeOnEscape, true)
  }, [flyout])

  const showFlyout = (category, anchor) => {
    cancelFlyoutClose()
    const rect = anchor.getBoundingClientRect()
    const left = Math.min(rect.right + 10, Math.max(8, window.innerWidth - 568))
    const width = Math.max(280, Math.min(560, window.innerWidth - left - 8))
    const height = Math.min(window.innerHeight * 0.72, Math.max(150, allTools.filter((tool) => tool.category === category.id).length * 52 + 74))
    setFlyout({ categoryId: category.id, left, top: Math.max(8, Math.min(rect.top - 18, window.innerHeight - height - 8)), width })
  }

  const renderToolList = (category, flyoutMode = false) => allTools.filter((tool) => tool.category === category.id).map((tool) => (
    <button
      className={`nav-subitem ${flyoutMode ? 'flyout-tool' : ''} ${isToolActive(tool.id) ? 'active' : ''}`}
      key={tool.id}
      type="button"
      title={isCollapsed && !flyoutMode ? tool.name : undefined}
      onClick={() => { setFlyout(null); navigate({ type: 'tool', toolId: tool.id }) }}
    >
      <Icon name={tool.icon} size={flyoutMode ? 17 : 15} />
      <span>{tool.name}</span>
      {flyoutMode && isToolActive(tool.id) && <span className="sidebar-flyout-active-mark" aria-hidden="true" />}
    </button>
  ))

  const flyoutCategory = visibleCategories.find((category) => category.id === flyout?.categoryId)

  return <>
    <aside className={`sidebar ${isCollapsed ? 'collapsed' : ''} ${phoneLayout ? 'mobile-drawer' : ''}`} id="workspace-sidebar" aria-label="Main sidebar" data-theme={theme}>
      <div className="sidebar-brand-row">
        <button className="brand-row clickable" type="button" onClick={() => navigate({ type: 'home' })} aria-label="PDF Dock home" title={isCollapsed ? 'PDF Dock' : undefined}>
          <span className="brand-mark" aria-hidden="true"><i /><i /><i /><i /></span>
          <span className="brand-name">PDF <span>Dock</span></span>
        </button>
        {phoneLayout && <button className="sidebar-drawer-close" type="button" onClick={() => onCloseMobileNav?.()} aria-label="Close navigation menu"><Icon name="x" size={18} /></button>}
      </div>

      <button className="new-document" type="button" aria-label="New document" title={isCollapsed ? 'New document' : undefined} onClick={() => { onOpenNewDocument(); onCloseMobileNav?.() }}>
        <span className="new-document-icon"><Icon name="plus" size={20} /></span>
        <span className="new-document-label">New document</span>
        {!isCollapsed && <Icon name="arrow" size={16} className="new-document-arrow" />}
      </button>

      <nav className="sidebar-navigation" aria-label="Workspace navigation">
        <div className="sidebar-workspace-label">WORKSPACE</div>
        <button className={`nav-item ${currentView.type === 'home' ? 'active' : ''}`} type="button" aria-label="Home" title={isCollapsed ? 'Home' : undefined} onClick={() => navigate({ type: 'home' })}>
          <Icon name="home" size={19} /><span>Home</span>
        </button>
        <button className={`nav-item ${isEditorActive ? 'active' : ''}`} type="button" aria-label="Editor" title={isCollapsed ? 'Editor' : undefined} onClick={() => navigate({ type: 'tool', toolId: 'pdf-editor' })}>
          <Icon name="cursor" size={19} /><span>Editor</span>
        </button>

        <div className="sidebar-divider" />
        <div className="sidebar-tools-label">TOOLS</div>
        {visibleCategories.map((category) => {
          const expanded = expandedCategory === category.id
          const active = currentView.type === 'category' && currentView.categoryId === category.id
            || currentView.type === 'tool' && allTools.some((tool) => tool.id === currentView.toolId && tool.category === category.id)
          return <div className={`nav-group ${expanded ? 'expanded' : ''}`} key={category.id}>
            <button
              className={`nav-item ${active ? 'active' : ''} ${expanded ? 'is-expanded' : ''}`}
              type="button"
              aria-label={category.label}
              aria-expanded={isCollapsed ? undefined : expanded}
              aria-controls={isCollapsed ? undefined : `sidebar-tools-${category.id}`}
              title={isCollapsed ? category.label : undefined}
              onMouseEnter={(event) => { if (isCollapsed) showFlyout(category, event.currentTarget) }}
              onMouseLeave={() => { if (isCollapsed) deferFlyoutClose() }}
              onFocus={(event) => { if (isCollapsed) showFlyout(category, event.currentTarget) }}
              onClick={() => {
                if (isCollapsed) { expandedCategory === category.id ? setExpandedCategory(null) : setExpandedCategory(category.id); return }
                setExpandedCategory((current) => current === category.id ? null : category.id)
              }}
            >
              <Icon name={category.icon} size={19} /><span>{category.label}</span>
              <Icon name="chevron" size={15} className="nav-disclosure" />
            </button>
            {!isCollapsed && expanded && <div className="nav-submenu" id={`sidebar-tools-${category.id}`}>{renderToolList(category)}</div>}
          </div>
        })}
      </nav>

      <div className="sidebar-bottom">
        {isCollapsed && <button type="button" className="sidebar-collapse-button sidebar-expand-button" aria-label="Expand sidebar" title="Expand sidebar" onClick={onToggleCollapsed}><Icon name="sidebar" size={17} /></button>}
        <div className={`sidebar-footer-row ${isCollapsed ? 'is-collapsed' : ''}`}>
          <button className={`sidebar-settings ${currentView.type === 'settings' ? 'active' : ''}`} type="button" title={isCollapsed ? 'Settings' : undefined} onClick={() => navigate({ type: 'settings' })}>
            <Icon name="sliders" size={19} /><span>Settings</span>
          </button>
          {!isCollapsed && !phoneLayout && <button type="button" className="sidebar-collapse-button" aria-label="Collapse sidebar" title="Collapse sidebar" onClick={onToggleCollapsed}><Icon name="sidebar" size={17} /></button>}
        </div>
      </div>
    </aside>

    {isCollapsed && flyout && flyoutCategory && createPortal(
      <section
        className="sidebar-flyout"
        data-theme={theme}
        style={{ left: flyout.left, top: flyout.top, width: Math.max(280, flyout.width) }}
        aria-label={`${flyoutCategory.label} tools`}
        onMouseEnter={cancelFlyoutClose}
        onMouseLeave={deferFlyoutClose}
        onFocus={cancelFlyoutClose}
      >
        <header className="sidebar-flyout-header"><h2>{flyoutCategory.label}</h2><button type="button" aria-label="Close tools menu" onClick={() => setFlyout(null)}><Icon name="x" size={18} /></button></header>
        <div className="sidebar-flyout-list">{renderToolList(flyoutCategory, true)}</div>
      </section>, document.body
    )}
  </>
}
