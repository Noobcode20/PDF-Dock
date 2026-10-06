import React, { useState, useEffect, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import { Sidebar } from './components/Sidebar'
import { Topbar } from './components/Topbar'
import { TabBar } from './components/TabBar'
import { CommandPalette } from './components/CommandPalette'
import { Onboarding } from './components/Onboarding'
import { HomePage } from './pages/HomePage'
import { CategoryPage } from './pages/CategoryPage'
import { PdfEditorWorkspace, ToolStudioPage } from './pages/ToolStudioPage'
import { NewDocumentPage } from './pages/NewDocumentPage'
import { RecentFilesPage } from './pages/RecentFilesPage'
import { SettingsPage } from './pages/SettingsPage'
import { WorkspaceContextMenu } from './components/WorkspaceContextMenu'
import { ALL_THEME_IDS, DEFAULT_THEME, isLightTheme, normalizeTheme, pairedTheme, themeBrandAccent } from './themes'
import { allTools, categories } from './toolsData'
import { loadShortcuts } from './keyboardShortcuts'

const EMPTY_FILES = []

function App() {
  // Navigation State
  // { type: 'home' } | { type: 'category', categoryId } | { type: 'tool', toolId } |
  // { type: 'recent' } | { type: 'settings' }
  const [currentView, setCurrentView] = useState({ type: 'home' })
  const [tabs, setTabs] = useState([{ id: 1, view: { type: 'home' } }])
  const [activeTabId, setActiveTabId] = useState(1)
  const activeTabIdRef = useRef(1)
  const nextTabId = useRef(2)
  const [isSearchOpen, setIsSearchOpen] = useState(false)
  const [isNewDocumentOpen, setIsNewDocumentOpen] = useState(false)
  const [contextMenu, setContextMenu] = useState(null)
  const [showOnboarding, setShowOnboarding] = useState(() => {
    if (window.localStorage.getItem('pdfking-onboarding-complete') === 'true') return false
    const existingSetupKeys = ['pdf-king-theme', 'pdfking-user-name', 'pdf-king-auto-theme', 'pdfking-keep-recent']
    return !existingSetupKeys.some((key) => window.localStorage.getItem(key) !== null)
  })
  const [theme, setTheme] = useState(() => {
    const stored = window.localStorage.getItem('pdf-king-theme')
    return normalizeTheme(stored)
  })
  const [logoTheme, setLogoTheme] = useState(theme)
  const [autoTheme, setAutoTheme] = useState(() => {
    const v = window.localStorage.getItem('pdf-king-auto-theme')
    return v === 'true'
  })
  const [selectedDarkTheme, setSelectedDarkTheme] = useState(() => {
    return normalizeTheme(window.localStorage.getItem('pdf-king-dark'), 'violet-dark')
  })
  const [selectedLightTheme, setSelectedLightTheme] = useState(() => {
    return normalizeTheme(window.localStorage.getItem('pdf-king-light'), 'violet-light')
  })
  const [userName, setUserName] = useState(() => window.localStorage.getItem('pdfking-user-name') || 'User')
  const [userAvatar, setUserAvatar] = useState(() => window.localStorage.getItem('pdfking-user-avatar') || null)

  const handleSetUserName = (name) => { setUserName(name); window.localStorage.setItem('pdfking-user-name', name) }
  const handleSetAvatar = (avatar) => { setUserAvatar(avatar); window.localStorage.setItem('pdfking-user-avatar', avatar) }

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const initialTool = currentView.type === 'tool' ? allTools.find((tool) => tool.id === currentView.toolId) : null
  const isFullPdfEditor = currentView.type === 'tool' && (initialTool?.category === 'edit' || currentView.toolId === 'redact-pdf')

  useEffect(() => {
    if (currentView.type !== 'settings') setLogoTheme(theme)
  }, [currentView.type, theme])

  const handleNavigate = (view) => {
    setCurrentView(view)
    const activeId = activeTabIdRef.current
    setTabs((current) => current.map((tab) => tab.id === activeId ? { ...tab, view } : tab))
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const getTabTitle = (view) => {
    if (view.type === 'category') return categories.find((category) => category.id === view.categoryId)?.label || 'Category'
    if (view.type === 'tool') return allTools.find((tool) => tool.id === view.toolId)?.name || 'Tool'
    return ({ home: 'Home', recent: 'Recent files', settings: 'Settings' })[view.type] || 'Workspace'
  }

  const selectTab = (tab) => {
    activeTabIdRef.current = tab.id
    setActiveTabId(tab.id)
    setCurrentView(tab.view)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const createTab = () => {
    const tab = { id: nextTabId.current++, view: { type: 'home' } }
    setTabs((current) => [...current, tab])
    selectTab(tab)
  }

  const closeTab = (tabId) => {
    if (tabs.length === 1) return
    const index = tabs.findIndex((tab) => tab.id === tabId)
    const remaining = tabs.filter((tab) => tab.id !== tabId)
    setTabs(remaining)
    if (activeTabIdRef.current === tabId) selectTab(remaining[Math.max(0, index - 1)])
  }

  const handleOpenPdf = async () => {
    if (!window.pdfKing?.openPdf) {
      handleNavigate({ type: 'tool', toolId: 'pdf-editor', openPicker: true })
      return
    }
    try {
      const result = await window.pdfKing.openPdf()
      if (result) {
        const file = new File([result.data], result.name, { type: 'application/pdf' })
        handleNavigate({ type: 'tool', toolId: 'pdf-editor', files: [file] })
      }
    } catch (error) { console.error('Open PDF failed:', error) }
  }

  const handleSelectTool = (tool, special) => {
    if (special === 'search-toggle') {
      setIsSearchOpen(true)
      return
    }
    if (tool) {
      handleNavigate({ type: 'tool', toolId: tool.id })
    }
  }

  const handleWorkspaceContextMenu = (event) => {
    if (isSearchOpen || isNewDocumentOpen || showOnboarding) return
    event.preventDefault()
    const fileRow = event.target.closest('[data-pdf-id]')
    const categoryId = currentView.type === 'category' ? currentView.categoryId : allTools.find((tool) => tool.id === currentView.toolId)?.category
    let tools = currentView.type === 'settings' ? [] : categoryId ? allTools.filter((tool) => tool.category === categoryId) : allTools.filter((tool) => tool.popular)
    if (fileRow) tools = allTools.filter((tool) => ['compress-pdf', 'merge-pdf', 'split-pdf', 'organize-pdf', 'pdf-editor'].includes(tool.id))
    const items = []
    if (fileRow) items.push({ id: 'open-file', label: `Open ${fileRow.dataset.pdfName}`, icon: 'file', fileId: fileRow.dataset.pdfId, fileName: fileRow.dataset.pdfName })
    tools.slice(0, fileRow ? 8 : 7).forEach((tool) => items.push({ id: tool.id, label: tool.name, icon: tool.icon, type: 'tool', fileId: fileRow?.dataset.pdfId, fileName: fileRow?.dataset.pdfName }))
    if (currentView.type === 'home' || currentView.type === 'recent') {
      items.push({ separator: true })
      items.push({ id: 'new-document', label: 'New document', icon: 'plus', type: 'new' })
      items.push({ id: 'open-pdf', label: 'Open PDF…', icon: 'upload', type: 'open' })
    } else if (currentView.type === 'settings') {
      items.push({ separator: true }, { id: 'home', label: 'Go to Home', icon: 'home', type: 'home' })
    }
    setContextMenu({ x: Math.min(event.clientX, window.innerWidth - 290), y: Math.min(event.clientY, window.innerHeight - Math.min(items.length * 38, 430)), items })
  }

  const handleContextAction = async (item) => {
    setContextMenu(null)
    if (item.type === 'new') { setIsNewDocumentOpen(true); return }
    if (item.type === 'open') { handleOpenPdf(); return }
    if (item.type === 'home') { handleNavigate({ type: 'home' }); return }
    let files = []
    if (item.fileId && window.pdfKing?.readRecentFile) {
      try {
        const data = await window.pdfKing.readRecentFile(item.fileId)
        if (data) files = [new File([data], item.fileName, { type: 'application/pdf' })]
      } catch (error) { console.error('Could not open PDF from context menu:', error) }
    }
    if (item.id === 'open-file') handleNavigate({ type: 'tool', toolId: 'pdf-editor', files })
    else if (item.type === 'tool') handleNavigate({ type: 'tool', toolId: item.id, files })
  }

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handleSystemChange = () => {
      if (!autoTheme) return
      const newTheme = mq.matches ? selectedDarkTheme : selectedLightTheme
      if (newTheme && ALL_THEME_IDS.includes(newTheme)) {
        setTheme(newTheme)
        window.localStorage.setItem('pdf-king-theme', newTheme)
      }
    }
    mq.addEventListener('change', handleSystemChange)
    handleSystemChange()
    return () => mq.removeEventListener('change', handleSystemChange)
  }, [autoTheme, selectedDarkTheme, selectedLightTheme])

  const handleSelectTheme = (nextTheme) => {
    if (!ALL_THEME_IDS.includes(nextTheme)) return
    setTheme(nextTheme)
    if (!showOnboarding) window.localStorage.setItem('pdf-king-theme', nextTheme)
  }

  const handleToggleTheme = () => {
    handleSelectTheme(pairedTheme(theme))
  }

  const handleFinishOnboarding = ({ name, theme: chosenTheme, matchSystem, keepRecent }) => {
    const displayName = name.trim() || 'User'
    const darkTheme = isLightTheme(chosenTheme) ? pairedTheme(chosenTheme) : chosenTheme
    const lightTheme = pairedTheme(darkTheme)

    handleSetUserName(displayName)
    setSelectedDarkTheme(darkTheme)
    setSelectedLightTheme(lightTheme)
    setAutoTheme(matchSystem)
    window.localStorage.setItem('pdf-king-theme', chosenTheme)
    window.localStorage.setItem('pdf-king-dark', darkTheme)
    window.localStorage.setItem('pdf-king-light', lightTheme)
    window.localStorage.setItem('pdf-king-auto-theme', String(matchSystem))
    window.localStorage.setItem('pdfking-keep-recent', String(keepRecent))
    window.localStorage.setItem('pdfking-onboarding-complete', 'true')
    if (matchSystem) {
      const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? darkTheme : lightTheme
      setTheme(systemTheme)
      window.localStorage.setItem('pdf-king-theme', systemTheme)
    } else {
      setTheme(chosenTheme)
    }
    setShowOnboarding(false)
  }

  useEffect(() => {
    const shortcuts = loadShortcuts()
    const handleKeyDown = (e) => {
      for (const [action, cfg] of Object.entries(shortcuts)) {
        const match = (cfg.metaKey === !!e.metaKey || cfg.metaKey === !!e.ctrlKey) && (cfg.ctrlKey === !!e.ctrlKey) && (cfg.shiftKey === !!e.shiftKey) && cfg.key === e.key
        if (match) {
          e.preventDefault()
          if (action === 'search') setIsSearchOpen(prev => { if (!prev) setTimeout(() => document.querySelector('.palette-input')?.focus(), 50); return !prev })
          if (action === 'new-document') setIsNewDocumentOpen(true)
          if (action === 'open-file') handleOpenPdf()
          if (action === 'close-overlay') {
            if (isNewDocumentOpen) setIsNewDocumentOpen(false)
            else if (isSearchOpen) setIsSearchOpen(false)
            else if (currentView.type === 'tool') handleNavigate({ type: 'home' })
          }
          if (action === 'navigate-home') handleNavigate({ type: 'home' })
          if (action === 'navigate-recent') handleNavigate({ type: 'recent' })
          if (action === 'navigate-settings') handleNavigate({ type: 'settings' })
          if (action === 'new-tab') createTab()
          if (action === 'close-tab') closeTab(activeTabId)
          if (action === 'toggle-sidebar') setSidebarCollapsed(c => !c)
          if (action === 'toggle-theme') handleToggleTheme()
          if (action === 'save-export') { if (currentView.type === 'tool') alert('Export triggered') }
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [currentView.type, activeTabId, isNewDocumentOpen, isSearchOpen])

  return (
    <div className={`app-shell ${isLightTheme(theme) ? 'light-theme' : ''} ${sidebarCollapsed ? 'sidebar-collapsed' : ''} ${isFullPdfEditor ? 'full-pdf-editor-mode' : ''}`} data-theme={theme} data-platform={window.pdfKing?.platform || 'web'} style={{ '--logo-accent': themeBrandAccent(logoTheme) }}>
      <TabBar tabs={tabs} activeTabId={activeTabId} onSelectTab={selectTab} onCloseTab={closeTab} onNewTab={createTab} getTitle={getTabTitle} />
      <div className="tabs-spacer" style={{ height: '8px', background: 'transparent' }} />
      <div className="workspace-shell">
        <Sidebar currentView={currentView} onNavigate={handleNavigate} onOpenNewDocument={() => setIsNewDocumentOpen(true)} collapsed={sidebarCollapsed} userName={userName} userAvatar={userAvatar} />

      <main className="main-area" id={`workspace-panel-${activeTabId}`} role="tabpanel" aria-labelledby={`workspace-tab-${activeTabId}`} onContextMenu={handleWorkspaceContextMenu}>
        <Topbar
          currentView={currentView}
          onNavigate={handleNavigate}
          onOpenSearch={() => setIsSearchOpen(true)}
          theme={theme}
          onToggleTheme={handleToggleTheme}
          sidebarCollapsed={sidebarCollapsed}
          onToggleSidebar={() => setSidebarCollapsed((collapsed) => !collapsed)}
        />

        {currentView.type === 'home' && (
          <HomePage userName={userName} theme={theme} onNavigate={handleNavigate} onSelectTool={handleSelectTool} />
        )}

        {currentView.type === 'category' && (
          <CategoryPage
            categoryId={currentView.categoryId}
            onNavigate={handleNavigate}
            onSelectTool={handleSelectTool}
          />
        )}

        {isFullPdfEditor && <PdfEditorWorkspace initialFiles={currentView.files || EMPTY_FILES} openPicker={currentView.openPicker || false} initialTool={currentView.toolId} onExit={() => handleNavigate({ type: 'home' })} />}

        {currentView.type === 'tool' && !isFullPdfEditor && (
          <ToolStudioPage
            toolId={currentView.toolId}
            initialFiles={currentView.files || EMPTY_FILES}
            openPicker={currentView.openPicker || false}
            onNavigate={handleNavigate}
            onSelectTool={handleSelectTool}
          />
        )}

        {currentView.type === 'recent' && (
          <RecentFilesPage onNavigate={handleNavigate} />
        )}

        {currentView.type === 'settings' && (
        <SettingsPage
          theme={theme}
          onSelectTheme={handleSelectTheme}
          onNavigate={handleNavigate}
          autoTheme={autoTheme}
          onToggleAutoTheme={(val) => { setAutoTheme(val); window.localStorage.setItem('pdf-king-auto-theme', String(val)); }}
          selectedDarkTheme={selectedDarkTheme}
          selectedLightTheme={selectedLightTheme}
          onSelectDarkTheme={(t) => { setSelectedDarkTheme(t); window.localStorage.setItem('pdf-king-dark', t); if (autoTheme && window.matchMedia('(prefers-color-scheme: dark)').matches) setTheme(t); }}
          onSelectLightTheme={(t) => { setSelectedLightTheme(t); window.localStorage.setItem('pdf-king-light', t); if (autoTheme && !window.matchMedia('(prefers-color-scheme: dark)').matches) setTheme(t); }}
          userName={userName}
          userAvatar={userAvatar}
          onSetUserName={handleSetUserName}
          onSetAvatar={handleSetAvatar}
        />
        )}
      </main>
      </div>

      <WorkspaceContextMenu menu={contextMenu} onClose={() => setContextMenu(null)} onAction={handleContextAction} />

      {isNewDocumentOpen && <NewDocumentPage onNavigate={handleNavigate} onClose={() => setIsNewDocumentOpen(false)} />}

      <CommandPalette
        isOpen={isSearchOpen}
        onClose={() => setIsSearchOpen(false)}
        onSelectTool={handleSelectTool}
      />
      {showOnboarding && <Onboarding theme={theme} onSelectTheme={handleSelectTheme} onFinish={handleFinishOnboarding} />}
    </div>
  )
}

createRoot(document.getElementById('root')).render(<App />)
