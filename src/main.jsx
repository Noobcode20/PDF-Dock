import { PasswordDialog } from './editor/PasswordDialog'
import React, { useState, useEffect, useRef, useCallback } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/outfit/latin-400.css'
import '@fontsource/outfit/latin-500.css'
import '@fontsource/outfit/latin-600.css'
import '@fontsource/outfit/latin-700.css'
import '@fontsource/dm-sans/latin-400.css'
import '@fontsource/dm-sans/latin-500.css'
import '@fontsource/dm-sans/latin-600.css'
import '@fontsource/dm-sans/latin-700.css'
import '@fontsource/atkinson-hyperlegible/latin-400.css'
import '@fontsource/atkinson-hyperlegible/latin-700.css'
import '@fontsource/geist/latin-400.css'
import '@fontsource/geist/latin-500.css'
import '@fontsource/geist/latin-600.css'
import '@fontsource/geist/latin-700.css'
import '@fontsource/geist-mono/latin-400.css'
import '@fontsource/geist-mono/latin-500.css'
import '@fontsource/geist-mono/latin-600.css'
import '@fontsource/fredoka/latin-400.css'
import '@fontsource/fredoka/latin-500.css'
import '@fontsource/fredoka/latin-600.css'
import '@fontsource/fredoka/latin-700.css'
import '@fontsource/nunito-sans/latin-400.css'
import '@fontsource/nunito-sans/latin-500.css'
import '@fontsource/nunito-sans/latin-600.css'
import '@fontsource/nunito-sans/latin-700.css'
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
import { Icon } from './icons'
import { installBrowserBridge, recentFilesBackend } from './recentFiles'

const EMPTY_FILES = []

// The web build gets the same guarded bridge surface as the desktop build so
// recent files, printing and exports work in both places.
installBrowserBridge()

class AppErrorBoundary extends React.Component {
  state = { error: null }
  static getDerivedStateFromError(error) { return { error } }
  render() {
    if (this.state.error) return <main className="renderer-error" role="alert"><h1>PDF Dock hit a problem</h1><p>{this.state.error?.message || 'The workspace could not be displayed.'}</p><button type="button" onClick={() => { this.setState({ error: null }); window.location.reload() }}>Reload workspace</button></main>
    return this.props.children
  }
}

async function serializeFiles(files) {
  return Promise.all((Array.isArray(files) ? files : []).map(async (file) => {
    if (!file || typeof file.arrayBuffer !== 'function') throw new Error('This tab contains a file that cannot be moved between windows.')
    return { name: file.name || 'document.pdf', type: file.type || 'application/pdf', lastModified: file.lastModified || Date.now(), sourcePath:file.sourcePath||null, bytes: new Uint8Array(await file.arrayBuffer()) }
  }))
}

async function serializeTabForTransfer(tab, draft) {
  const view = { ...tab.view }
  const hadFiles = Object.prototype.hasOwnProperty.call(view, 'files')
  const files = await serializeFiles(view.files)
  delete view.files
  const serializedDraft = draft ? { ...draft, files: await serializeFiles(draft.files), session:draft.session?{...draft.session,originalFile:draft.session.originalFile?(await serializeFiles([draft.session.originalFile]))[0]:null}:null, editHistory:{past:await Promise.all((draft.editHistory?.past||[]).map(async snapshot=>({...snapshot,files:await serializeFiles(snapshot.files)}))),future:await Promise.all((draft.editHistory?.future||[]).map(async snapshot=>({...snapshot,files:await serializeFiles(snapshot.files)})))} } : null
  return { view, files, hadFiles, draft: serializedDraft }
}

function restoreTabView(payload) {
  const view = { ...payload.view }
  if (payload.hadFiles) {
    view.files = (payload.files || []).map((file) => Object.assign(new File([file.bytes], file.name, {
      type: file.type || 'application/pdf',
      lastModified: file.lastModified || Date.now(),
    }),{sourcePath:file.sourcePath||null}))
  }
  return view
}

function restoreDraft(payload) {
  if (!payload) return null
  return { ...payload, session:payload.session?{...payload.session,originalFile:payload.session.originalFile?restoreDraft({files:[payload.session.originalFile]}).files[0]:null}:null, editHistory:{past:(payload.editHistory?.past||[]).map(snapshot=>({...snapshot,files:restoreDraft({files:snapshot.files}).files})),future:(payload.editHistory?.future||[]).map(snapshot=>({...snapshot,files:restoreDraft({files:snapshot.files}).files}))}, files: (payload.files || []).map((file) => Object.assign(new File([file.bytes], file.name, { type: file.type || 'application/pdf', lastModified: file.lastModified || Date.now() }),{sourcePath:file.sourcePath||null})) }
}

function UnsavedChangesDialog({ onDismiss, stage = 'file', error, onAccept, onCancel }) {
  const applying = stage === 'apply'
  return <div className="confirm-backdrop" role="presentation">
    <section className="confirm-panel" role="alertdialog" aria-modal="true" aria-labelledby="unsaved-pdf-title" aria-describedby="unsaved-pdf-message" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => { event.stopPropagation(); if (event.key === 'Escape') { event.preventDefault(); onCancel() } else if (event.key === 'Enter' && !event.repeat && !event.target.closest('button, a, input, textarea, select')) { event.preventDefault(); onAccept() } }}>
      <div className="confirm-icon"><Icon name="file" size={18} /></div>
      <h2 className="confirm-title" id="unsaved-pdf-title">{applying ? 'Unsaved PDF changes' : 'Unsaved file'}</h2>
      <p className="confirm-message" id="unsaved-pdf-message">{applying ? 'Apply your changes to this PDF in PDF Dock before leaving?' : 'Do you want to save your work to a file before leaving?'}</p>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="confirm-actions">
        <button type="button" className="confirm-btn" onClick={onDismiss}>Cancel</button>
        <button type="button" className="confirm-btn confirm-btn-outline-danger" onClick={onCancel}><span>Don't Save</span><kbd className="confirm-key-hint">Esc</kbd></button>
        <button type="button" className="confirm-btn confirm-btn-primary" onClick={onAccept} data-dialog-accept autoFocus><span>Save</span><kbd className="confirm-key-hint" aria-label="Return">↵</kbd></button>
      </div>
    </section>
  </div>
}

function UpdateDialog({ update, onSkip, onUpdate }) {
  const downloading = update.status === 'downloading'
  const downloaded = update.status === 'downloaded'
  const failed = update.status === 'error'
  const macDownload = window.pdfKing?.platform === 'darwin'
  const updateLabel = downloaded ? 'Restart to Update' : downloading ? 'Downloading…' : failed ? 'Retry Update' : macDownload ? 'Download Update' : 'Update'
  return <div className="confirm-backdrop update-backdrop" role="presentation">
    <section className="confirm-panel update-dialog" role="alertdialog" aria-modal="true" aria-labelledby="update-dialog-title" aria-describedby="update-dialog-message" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => {
      event.stopPropagation()
      if (event.key === 'Escape') { event.preventDefault(); onSkip() }
      else if (event.key === 'Enter' && !event.repeat) { event.preventDefault(); onUpdate() }
    }}>
      <div className="confirm-icon"><Icon name="fileDown" size={18} /></div>
      <h2 className="confirm-title" id="update-dialog-title">A new version is available</h2>
      <p className="confirm-message" id="update-dialog-message">PDF Dock {update.version} is ready. Update now to get the latest improvements.</p>
      {downloading && <div className="update-progress" aria-label={`Downloading update ${update.percent || 0}%`}><span style={{ width: `${Math.max(0, Math.min(100, update.percent || 0))}%` }} /></div>}
      {downloading && <p className="update-status" aria-live="polite">Downloading update… {update.percent || 0}%</p>}
      {failed && <p className="form-error" role="alert">{update.message || 'The update could not be downloaded. Try again.'}</p>}
      <div className="confirm-actions">
        <button type="button" className="confirm-btn" onClick={onSkip}>Skip this version<kbd className="confirm-key-hint">Esc</kbd></button>
        <button type="button" className="confirm-btn confirm-btn-primary" onClick={onUpdate} data-dialog-accept autoFocus disabled={downloading}><span>{updateLabel}</span>{!downloading && <kbd className="confirm-key-hint" aria-label="Return">↵</kbd>}</button>
      </div>
    </section>
  </div>
}

function App() {
  // Navigation State
  // { type: 'home' } | { type: 'category', categoryId } | { type: 'tool', toolId } |
  // { type: 'recent' } | { type: 'settings' }
  const [currentView, setCurrentView] = useState({ type: 'home' })
  const [tabs, setTabs] = useState([{ id: 1, view: { type: 'home' } }])
  const [pendingMovedTabId, setPendingMovedTabId] = useState(null)
  const [activeTabId, setActiveTabId] = useState(1)
  const activeTabIdRef = useRef(1)
  const tabsRef = useRef(tabs)
  tabsRef.current = tabs
  const dialogReturnFocusRef = useRef(null)
  const dirtyTabIdsRef = useRef(new Set())
  const editorRef = useRef(null)
  const [dirtyTabIds, setDirtyTabIds] = useState(() => new Set())
  const [editorDrafts, setEditorDrafts] = useState({})
  const editorDraftsRef = useRef(editorDrafts)
  editorDraftsRef.current = editorDrafts
  const [toolDrafts, setToolDrafts] = useState({})
  const [leaveRequest, setLeaveRequest] = useState(null)
  const [leaveError, setLeaveError] = useState('')
  const leaveResolvingRef = useRef(false)
  const nextTabId = useRef(2)
  const [isSearchOpen, setIsSearchOpen] = useState(false)
  const [isNewDocumentOpen, setIsNewDocumentOpen] = useState(false)
  const [newDocumentMode, setNewDocumentMode] = useState('new')
  const [commandPaletteSize, setCommandPaletteSize] = useState(() => window.localStorage.getItem('pdfking-command-palette-size') === 'maximized' ? 'maximized' : 'compact')
  const [contextMenu, setContextMenu] = useState(null)
  const [actionError, setActionError] = useState('')
  const [updateInfo, setUpdateInfo] = useState(null)
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

  useEffect(() => {
    if (!window.pdfKing?.onUpdateState) return undefined
    const applyUpdateState = (state) => {
      if (state?.status === 'available' || state?.status === 'downloading' || state?.status === 'downloaded' || state?.status === 'error') setUpdateInfo(state)
    }
    const unsubscribe = window.pdfKing.onUpdateState(applyUpdateState)
    void window.pdfKing.getUpdateState?.().then(applyUpdateState)
    return unsubscribe
  }, [])

  const skipUpdate = useCallback(() => {
    const version = updateInfo?.version
    if (version) void window.pdfKing?.skipUpdateVersion?.(version)
    setUpdateInfo(null)
  }, [updateInfo])

  const startUpdate = useCallback(() => {
    if (updateInfo?.status === 'downloading') return
    if (window.pdfKing?.platform !== 'darwin' && updateInfo?.status !== 'downloaded') setUpdateInfo((current) => current ? { ...current, status: 'downloading', percent: 0 } : current)
    void window.pdfKing?.downloadUpdate?.().catch((error) => setUpdateInfo((current) => current ? { ...current, status: 'error', message: error?.message } : current))
  }, [updateInfo])

  useEffect(() => {
    const syncStorage = (event) => {
      if (event.key === 'pdf-king-theme') setTheme(normalizeTheme(event.newValue))
      if (event.key === 'pdf-king-dark') setSelectedDarkTheme(normalizeTheme(event.newValue, 'violet-dark'))
      if (event.key === 'pdf-king-light') setSelectedLightTheme(normalizeTheme(event.newValue, 'violet-light'))
      if (event.key === 'pdf-king-auto-theme') setAutoTheme(event.newValue === 'true')
      if (event.key === 'pdfking-user-name') setUserName(event.newValue || 'User')
      if (event.key === 'pdfking-user-avatar') setUserAvatar(event.newValue || null)
      if (event.key === 'pdfking-command-palette-size') setCommandPaletteSize(event.newValue === 'maximized' ? 'maximized' : 'compact')
      if (event.key === 'pdfking-onboarding-complete' && event.newValue === 'true') setShowOnboarding(false)
    }
    window.addEventListener('storage', syncStorage)
    return () => window.removeEventListener('storage', syncStorage)
  }, [])

  const handleSetUserName = (name) => { setUserName(name); window.localStorage.setItem('pdfking-user-name', name) }
  const handleSetAvatar = (avatar) => {
    try { window.localStorage.setItem('pdfking-user-avatar', avatar); setUserAvatar(avatar) }
    catch { throw new Error('The profile photo could not be saved because local storage is full. Remove some browser data and try again.') }
  }

  const reportTabDirty = (tabId, isDirty) => {
    const next = new Set(dirtyTabIdsRef.current)
    if (isDirty) next.add(tabId)
    else next.delete(tabId)
    dirtyTabIdsRef.current = next
    setDirtyTabIds(next)
  }

  const saveEditorDraft = useCallback((tabId, draft) => {
    setEditorDrafts((current) => current[tabId] === draft ? current : { ...current, [tabId]: draft })
    setTabs((current) => current.map((tab) => tab.id === tabId && tab.view.type === 'tool' && tab.view.files !== draft.files
      ? { ...tab, view: { ...tab.view, files: draft.files } } : tab))
  }, [])

  const saveActiveEditorDraft = useCallback((draft) => saveEditorDraft(activeTabId, draft), [saveEditorDraft, activeTabId])

  const saveToolDraft = useCallback((tabId, draft) => {
    const key = `${tabId}:${draft.toolId}`
    setToolDrafts((current) => current[key] === draft ? current : { ...current, [key]: draft })
    setTabs((current) => current.map((tab) => tab.id === tabId && tab.view.type === 'tool' && tab.view.toolId === draft.toolId
      ? { ...tab, view: { ...tab.view, files: draft.files } } : tab))
  }, [])

  const requestLeave = (tabId, action, requestOptions = {}) => {
    if (!dirtyTabIdsRef.current.has(tabId)) {
      action()
      return true
    }
    const target = tabsRef.current.find((tab) => tab.id === tabId)
    const targetTool = target?.view?.type === 'tool' ? allTools.find((tool) => tool.id === target.view.toolId) : null
    const isPdfViewer = target?.view?.type === 'tool' && (targetTool?.category === 'edit' || target.view.toolId === 'redact-pdf')
    const draft = editorDraftsRef.current[tabId]
    const hasEditorChanges = Boolean(draft?.textEdits?.length || draft?.imageEdits?.length || (Array.isArray(draft?.redaction) ? draft.redaction.length : draft?.redaction) || (draft?.toolId && !['pdf-editor', 'select'].includes(draft.toolId)))
    setLeaveError('')
    setLeaveRequest({ tabId, action, ...requestOptions, stage: 'file' })
    if(tabId!==activeTabIdRef.current && target) selectTabNow(target)
    return false
  }

  useEffect(() => window.pdfKing?.onRequestClose?.(() => {
    const guardNext = () => { const tabId = [...dirtyTabIdsRef.current][0]; if(tabId === undefined) window.pdfKing?.allowCloseWindow?.(); else requestLeave(tabId, guardNext, {windowClose:true}) }; guardNext()
  }), [])

  const cancelLeaveRequest = () => {
    if (!leaveRequest) return
    const request = leaveRequest
    if (request.tabId === activeTabIdRef.current) editorRef.current?.discardPendingEdits()
    reportTabDirty(request.tabId, false)
    setEditorDrafts((current) => { const next = { ...current }; delete next[request.tabId]; return next })
    setToolDrafts((current) => Object.fromEntries(Object.entries(current).filter(([key]) => !key.startsWith(`${request.tabId}:`))))
    setLeaveRequest(null)
    setLeaveError('')
    request.action()
  }

  const resolveLeaveRequest = async () => {
    if (!leaveRequest || leaveResolvingRef.current) return
    const request = leaveRequest
    if (request.tabId !== activeTabIdRef.current) {
      const target = tabs.find((tab) => tab.id === request.tabId)
      if (target) selectTabNow(target)
      return
    }
    leaveResolvingRef.current = true
    try {
      if (request.stage === 'apply') {
        try {
          const result = await editorRef.current?.applyChangesInApp()
          if (!result?.ok) {
            setLeaveError(result?.error || 'The edits could not be applied. Try again.')
            return
          }
          if (result.needsFileSave) {
            setLeaveError('')
            setLeaveRequest({ ...request, stage: 'file' })
            return
          }
        } catch {
          setLeaveError('The edits could not be applied. Try again.')
          return
        }
      } else {
        try {
          const saved = await editorRef.current?.savePendingEdits()
          if (!saved) {
            setLeaveError('The PDF could not be saved. Try again or cancel to keep it open in PDF Dock.')
            return
          }
        } catch {
          setLeaveError('The PDF could not be saved. Try again or cancel to keep it open in PDF Dock.')
          return
        }
      }
      reportTabDirty(request.tabId, false)
      setEditorDrafts((current) => { const next = { ...current }; delete next[request.tabId]; return next })
      setToolDrafts((current) => Object.fromEntries(Object.entries(current).filter(([key]) => !key.startsWith(`${request.tabId}:`))))
      setLeaveRequest(null)
      request.action()
    } finally {
      leaveResolvingRef.current = false
    }
  }

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [phoneLayout, setPhoneLayout] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 620px)').matches)
  const [editorChromeVisible, setEditorChromeVisible] = useState(false)
  const [editTextRequest, setEditTextRequest] = useState(0)
  const initialTool = currentView.type === 'tool' ? allTools.find((tool) => tool.id === currentView.toolId) : null
  const isFullPdfEditor = currentView.type === 'tool' && (initialTool?.category === 'edit' || currentView.toolId === 'redact-pdf')

  useEffect(() => {
    const query = window.matchMedia('(max-width: 620px)')
    const handleChange = (event) => { setPhoneLayout(event.matches); if (!event.matches) setMobileNavOpen(false) }
    query.addEventListener('change', handleChange)
    return () => query.removeEventListener('change', handleChange)
  }, [])

  useEffect(() => { setMobileNavOpen(false) }, [currentView])

  useEffect(() => {
    if (!mobileNavOpen) return undefined
    const closeOnEscape = (event) => { if (event.key === 'Escape') { event.preventDefault(); setMobileNavOpen(false) } }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [mobileNavOpen])

  useEffect(() => {
    if (isFullPdfEditor) setEditorChromeVisible(false)
  }, [activeTabId, isFullPdfEditor])

  useEffect(() => window.pdfKing?.onTabDragComplete?.(({ tabId }) => setPendingMovedTabId(tabId)), [])

  useEffect(() => {
    if (pendingMovedTabId === null) return
    const index = tabs.findIndex((tab) => tab.id === pendingMovedTabId)
    if (index < 0) {
      setPendingMovedTabId(null)
      return
    }
    const remaining = tabs.filter((tab) => tab.id !== pendingMovedTabId)
    const movedFiles = [...(tabs[index]?.view?.files || []), ...(editorDrafts[pendingMovedTabId]?.files || [])]
    if (movedFiles.length) import('./pdfEngine').then(({ disposePdfFile }) => movedFiles.forEach(disposePdfFile))
    setTabs(remaining)
    setEditorDrafts((current) => { const next = { ...current }; delete next[pendingMovedTabId]; return next })
    setToolDrafts((current) => Object.fromEntries(Object.entries(current).filter(([key]) => !key.startsWith(`${pendingMovedTabId}:`))))
    reportTabDirty(pendingMovedTabId, false)
    if (activeTabIdRef.current === pendingMovedTabId) {
      if (remaining.length) selectTabNow(remaining[Math.max(0, index - 1)])
      else window.pdfKing?.closeWindow?.()
    }
    setPendingMovedTabId(null)
  }, [pendingMovedTabId, tabs, editorDrafts])

  useEffect(() => {
    if (currentView.type !== 'settings') setLogoTheme(theme)
  }, [currentView.type, theme])

  const handleNavigateNow = (view) => {
    setCurrentView(view)
    const activeId = activeTabIdRef.current
    setTabs((current) => current.map((tab) => tab.id === activeId ? { ...tab, view } : tab))
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const handleNavigate = (view) => {
    if (view.type === 'category' && view.categoryId === 'edit' && currentView.type === 'tool' && currentView.toolId === 'pdf-editor') {
      handleOpenPdf()
      return
    }
    requestLeave(activeTabIdRef.current, () => handleNavigateNow(view))
  }

  const handlePaletteNavigate = (view) => {
    const staysInSameTool = view.type === 'tool' && view.toolId === currentView.toolId && !view.files && !view.openPicker
    if (currentView.type === 'tool' && staysInSameTool) return
    if (currentView.type === 'tool') {
      createTabNow()
      handleNavigateNow(view)
      return
    }
    requestLeave(activeTabIdRef.current, () => {
      handleNavigateNow(view)
    })
  }

  const handleOpenNewDocument = () => {
    if (currentView.type === 'tool') {
      createTabNow()
      setNewDocumentMode('new')
      setIsNewDocumentOpen(true)
      return
    }
    requestLeave(activeTabIdRef.current, () => {
      setNewDocumentMode('new')
      setIsNewDocumentOpen(true)
    })
  }

  const getTabTitle = (view) => {
    if (view.type === 'category') return categories.find((category) => category.id === view.categoryId)?.label || 'Category'
    if (view.type === 'tool') return allTools.find((tool) => tool.id === view.toolId)?.name || 'Tool'
    return ({ home: 'Home', recent: 'Recent files', settings: 'Settings' })[view.type] || 'Workspace'
  }

  const selectTabNow = (tab) => {
    activeTabIdRef.current = tab.id
    setActiveTabId(tab.id)
    setCurrentView(tab.view)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const selectTab = (tab) => {
    selectTabNow(tab)
  }

  const createTabNow = () => {
    const tab = { id: nextTabId.current++, view: { type: 'home' } }
    setTabs((current) => [...current, tab])
    selectTabNow(tab)
  }

  const createTab = () => createTabNow()

  const closeTabNow = (tabId) => {
    if (tabs.length === 1) {
      const lastDraft = editorDrafts[tabId]
      const lastTab = tabs[0]
      const files = [...(lastTab?.view?.files || []), ...(lastDraft?.files || [])]
      if (files.length) import('./pdfEngine').then(({ disposePdfFile }) => files.forEach(disposePdfFile))
      setEditorDrafts((current) => { const next = { ...current }; delete next[tabId]; return next })
      setToolDrafts((current) => Object.fromEntries(Object.entries(current).filter(([key]) => !key.startsWith(`${tabId}:`))))
      if (window.pdfKing?.closeWindow) window.pdfKing.closeWindow()
      else window.close()
      return
    }
    const index = tabs.findIndex((tab) => tab.id === tabId)
    const closingTab = tabs[index]
    const draft = editorDrafts[tabId]
    const filesToDispose = [...(closingTab?.view?.files || []), ...(draft?.files || [])]
    if (filesToDispose.length) import('./pdfEngine').then(({ disposePdfFile }) => filesToDispose.forEach(disposePdfFile))
    const remaining = tabs.filter((tab) => tab.id !== tabId)
    setTabs(remaining)
    setEditorDrafts((current) => { const next = { ...current }; delete next[tabId]; return next })
    setToolDrafts((current) => Object.fromEntries(Object.entries(current).filter(([key]) => !key.startsWith(`${tabId}:`))))
    reportTabDirty(tabId, false)
    if (activeTabIdRef.current === tabId) selectTabNow(remaining[Math.max(0, index - 1)])
  }

  const closeTab = (tabId) => requestLeave(tabId, () => closeTabNow(tabId))

  const startTabDrag = (tab, transferId) => {
    if (dirtyTabIdsRef.current.has(tab.id)) {
      setLeaveError('Save or discard this PDF’s edits before moving its tab. Try dragging it again afterward.')
      setLeaveRequest({ tabId: tab.id, action: () => {} })
      return false
    }
    if (!window.pdfKing?.beginTabDrag || !window.pdfKing?.publishTabDrag) return true
    void (async () => {
      try {
        const started = await window.pdfKing.beginTabDrag(transferId, tab.id)
        if (!started) return
        const draft = tab.view.type === 'tool'
          ? (tab.view.toolId === 'pdf-editor' ? editorDrafts[tab.id] : toolDrafts[`${tab.id}:${tab.view.toolId}`])
          : null
        const payload = await serializeTabForTransfer(tab, draft)
        await window.pdfKing.publishTabDrag(transferId, payload)
      } catch (error) {
        console.error('Could not prepare tab for moving between windows:', error)
      }
    })()
    return true
  }

  const cancelTabDrag = (transferId) => window.pdfKing?.cancelTabDrag?.(transferId)

  const reorderTab = (tabId, insertionIndex) => {
    setTabs((current) => {
      const fromIndex = current.findIndex((tab) => tab.id === tabId)
      if (fromIndex < 0) return current
      const next = [...current]
      const [movedTab] = next.splice(fromIndex, 1)
      const destination = Math.max(0, Math.min(current.length - 1, insertionIndex - (fromIndex < insertionIndex ? 1 : 0)))
      if (destination === fromIndex) return current
      next.splice(destination, 0, movedTab)
      return next
    })
  }

  const importTabNow = async (transferId, insertionIndex) => {
    if (!window.pdfKing?.receiveTabDrag || !window.pdfKing?.completeTabDrag) return
    try {
      const payload = await window.pdfKing.receiveTabDrag(transferId)
      if (!payload?.view || !Array.isArray(payload.files)) return
      const tab = { id: nextTabId.current++, view: restoreTabView(payload) }
      const draft = restoreDraft(payload.draft)
      if (draft && tab.view.type === 'tool') {
        if (tab.view.toolId === 'pdf-editor') setEditorDrafts((current) => ({ ...current, [tab.id]: draft }))
        else setToolDrafts((current) => ({ ...current, [`${tab.id}:${tab.view.toolId}`]: draft }))
      }
      setTabs((current) => {
        const index = Math.max(0, Math.min(current.length, insertionIndex))
        return [...current.slice(0, index), tab, ...current.slice(index)]
      })
      selectTab(tab)
      await window.pdfKing.completeTabDrag(transferId)
    } catch (error) {
      console.error('Could not move tab into this window:', error)
    }
  }

  const importTabFromWindow = (transferId, insertionIndex) => { void importTabNow(transferId, insertionIndex) }

  const handleOpenPdf = () => {
    requestLeave(activeTabIdRef.current, () => {
      setNewDocumentMode('open-pdf')
      setIsNewDocumentOpen(true)
    })
  }

  const handleOpenNewWindow = async () => {
    if (window.pdfKing?.createWindow) {
      try { await window.pdfKing.createWindow() } catch (error) { console.error('Could not open a new window:', error) }
      return
    }
    window.open(window.location.href, '_blank', 'noopener,noreferrer')
  }

  const handleCloseWindow = () => requestLeave(activeTabIdRef.current, () => {
    if (window.pdfKing?.closeWindow) window.pdfKing.closeWindow()
    else window.close()
  })

  const handleSelectTool = (tool, special) => {
    if (special === 'search-toggle') {
      setIsSearchOpen(true)
      return
    }
    if (tool) {
      handleNavigate({ type: 'tool', toolId: tool.id })
    }
  }

  const handleSelectToolPreservingCurrentTool = (tool, special) => {
    if (special === 'search-toggle') {
      handleSelectTool(tool, special)
      return
    }
    if (currentView.type === 'tool' && tool?.id === currentView.toolId) {
      if (tool.id === 'pdf-editor') handleOpenPdf()
      return
    }
    if (currentView.type === 'tool' && tool) {
      createTabNow()
      handleNavigateNow({ type: 'tool', toolId: tool.id })
      return
    }
    requestLeave(activeTabIdRef.current, () => {
      handleSelectTool(tool, special)
    })
  }

  const handleWorkspaceContextMenu = (event) => {
    if (isSearchOpen || isNewDocumentOpen || showOnboarding) return
    const nativeTarget = event.target.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]')
    if (nativeTarget) return
    const target = event.target
    const pdfPage = target.closest('.acrobat-document-page')
    const fileRow = target.closest('[data-pdf-id]')
    const themeChoice = target.closest('.theme-choice[data-theme]')
    const toolCard = target.closest('.tool-card')
    const organizerCard = target.closest('.editor-organizer-card')
    const textBox = target.closest('.pdf-text-edit-preview')
    const textSpan = target.closest('.pdf-text-layer span')
    const imageObject = target.closest('.pdf-image-object')
    event.preventDefault()
    const fileContext = fileRow ? { fileId: fileRow.dataset.pdfId, fileName: fileRow.dataset.pdfName } : {}
    let items = []
    if (themeChoice) {
      items = [{ id: 'apply-theme', label: 'Apply this theme', icon: 'check', type: 'theme', themeId: themeChoice.dataset.theme }, { id: 'settings-home', label: 'Go to Home', icon: 'home', type: 'home' }]
    } else if (toolCard) {
      const toolName = toolCard.querySelector('.tool-copy strong')?.textContent?.trim() || 'tool'
      items = [{ id: 'open-tool-card', label: `Open ${toolName}`, icon: 'arrow', type: 'tool-card', element: toolCard }, { id: 'open-pdf', label: 'Choose a PDF…', icon: 'upload', type: 'open' }]
    } else if (organizerCard) {
      const pageLabel = organizerCard.querySelector('.editor-organizer-page-label')?.textContent || 'page'
      items = [{ id: 'select-page', label: `Select ${pageLabel}`, icon: 'check', type: 'element-click', element: organizerCard }, { id: 'open-page', label: `Open ${pageLabel} in editor`, icon: 'file', type: 'element-double-click', element: organizerCard }]
    } else if (pdfPage && isFullPdfEditor) {
      if (imageObject) {
        items = [{ id: 'edit-this-image', label: 'Open image editing controls', icon: 'image', type: 'editor-tool', toolId: 'images' }]
      } else if (textBox) {
        items = [{ id: 'edit-this-text', label: 'Edit this text', icon: 'pen', type: 'edit-text' }]
        if (textBox.classList.contains('is-new-text')) items.push({ id: 'delete-this-text', label: 'Delete this text box', icon: 'trash', type: 'element-click-child', element: textBox, selector: '.pdf-text-box-delete' })
      } else if (textSpan) {
        items = [{ id: 'edit-pdf-text', label: 'Edit text on this page', icon: 'pen', type: 'edit-text' }, { id: 'copy-pdf-text', label: 'Copy text', icon: 'copy', type: 'copy-text', text: textSpan.textContent || '' }, { separator: true }, { id: 'highlight-text', label: 'Highlight text', icon: 'edit', type: 'editor-tool', toolId: 'highlight' }]
      } else {
        items = [{ id: 'edit-text-mode', label: 'Edit text on this page', icon: 'pen', type: 'edit-text' }, { id: 'add-text-here', label: 'Add text to this page', icon: 'plus', type: 'editor-tool', toolId: 'add-text' }, { separator: true }, { id: 'highlight-page', label: 'Highlight text', icon: 'edit', type: 'editor-tool', toolId: 'highlight' }, { id: 'underline-page', label: 'Underline text', icon: 'pen', type: 'editor-tool', toolId: 'underline' }, { id: 'add-image-page', label: 'Add or edit images', icon: 'image', type: 'editor-tool', toolId: 'images' }]
      }
    } else if (fileRow) {
      const open = { id: 'open-file', label: `Open ${fileContext.fileName}`, icon: 'file', type: 'open-file', ...fileContext }
      const fileActions = currentView.type === 'recent'
        ? [['compress-pdf', 'Compress PDF'], ['split-pdf', 'Split pages'], ['organize-pdf', 'Organize pages'], ['pdf-to-word', 'Convert to Word']]
        : [['compress-pdf', 'Compress PDF'], ['split-pdf', 'Split pages'], ['organize-pdf', 'Organize pages']]
      items = [open, { separator: true }, ...fileActions.map(([id, label]) => ({ id, label, icon: allTools.find((tool) => tool.id === id)?.icon, type: 'tool', ...fileContext }))]
    } else if (currentView.type === 'home') {
      items = [{ id: 'new-document', label: 'New document', icon: 'plus', type: 'new' }, { id: 'open-pdf', label: 'Open PDF…', icon: 'upload', type: 'open' }, { separator: true }, { id: 'home-settings', label: 'Open Settings', icon: 'settings', type: 'settings' }]
    } else if (currentView.type === 'recent') {
      items = [{ id: 'open-pdf', label: 'Open another PDF…', icon: 'upload', type: 'open' }, { id: 'recent-home', label: 'Go to Home', icon: 'home', type: 'home' }]
    } else if (currentView.type === 'settings') {
      items = [{ id: 'toggle-theme', label: 'Switch light/dark theme', icon: 'sun', type: 'toggle-theme' }, { id: 'settings-home', label: 'Go to Home', icon: 'home', type: 'home' }]
    } else if (currentView.type === 'category') {
      items = [{ id: 'open-pdf', label: 'Open PDF…', icon: 'upload', type: 'open' }, { id: 'category-home', label: 'Go to Home', icon: 'home', type: 'home' }]
    } else if (currentView.type === 'tool') {
      const currentTool = allTools.find((tool) => tool.id === currentView.toolId)
      items = [{ id: 'open-pdf', label: 'Choose a PDF…', icon: 'upload', type: 'open' }, ...(currentTool ? [{ id: 'repeat-tool', label: `Restart ${currentTool.name}`, icon: 'redo', type: 'tool', toolId: currentTool.id }] : [])]
    }
    if (!items.length) return
    setContextMenu({ x: Math.min(event.clientX, window.innerWidth - 290), y: Math.min(event.clientY, window.innerHeight - Math.min(items.length * 38, 430)), items })
  }

  const handleContextAction = async (item) => {
    setContextMenu(null)
    setActionError('')
    if (item.type === 'edit-text') { setEditTextRequest((request) => request + 1); return }
    if (item.type === 'editor-tool') { editorRef.current?.activateTool?.(item.toolId); return }
    if (item.type === 'theme') { handleSelectTheme(item.themeId); return }
    if (item.type === 'toggle-theme') { handleToggleTheme(); return }
    if (item.type === 'settings') { handlePaletteNavigate({ type: 'settings' }); return }
    if (item.type === 'copy-text') { try { await navigator.clipboard.writeText(item.text) } catch { setActionError('Could not copy text to the clipboard.') }; return }
    if (item.type === 'element-click') { item.element?.click(); return }
    if (item.type === 'element-double-click') { item.element?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); return }
    if (item.type === 'element-click-child') { item.element?.querySelector(item.selector)?.click(); return }
    if (item.type === 'new') { handleOpenNewDocument(); return }
    if (item.type === 'open') { handleOpenPdf(); return }
    if (item.type === 'home') { handlePaletteNavigate({ type: 'home' }); return }
    let files = []
    if (item.fileId) {
      try {
        const backend = recentFilesBackend()
        if (!backend?.readRecentFile) throw new Error('This PDF could not be opened because local file storage is unavailable.')
        const data = await backend.readRecentFile(item.fileId)
        if (!data) throw new Error('The selected recent PDF could not be read.')
        files = [new File([data], item.fileName, { type: 'application/pdf' })]
      } catch (error) { setActionError(error.message || 'Could not open this recent PDF.'); return }
    }
    if (item.id === 'open-file') handlePaletteNavigate({ type: 'tool', toolId: 'pdf-editor', files })
    else if (item.type === 'tool-card') item.element?.click()
    else if (item.type === 'tool') handlePaletteNavigate({ type: 'tool', toolId: item.toolId || item.id, files })
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

  useEffect(() => {
    const topDialog = () => [...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')].filter((el) => el.getClientRects().length).at(-1)
    const focusables = () => [...(topDialog()?.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]') || [])].filter((el) => el.getClientRects().length)
    const captureReturnFocus = (event) => {
      if (!(event.target instanceof HTMLElement) || topDialog()?.contains(event.target)) return
      dialogReturnFocusRef.current = event.target
    }
    document.addEventListener('focusin', captureReturnFocus, true)
    let activeDialog = null
    const syncDialogFocus = () => {
      const dialog = topDialog()
      if (dialog === activeDialog) return
      activeDialog = dialog
      if (dialog) {
        const first = dialog.querySelector('[data-dialog-accept], [autofocus]') || focusables()[0]
        first?.focus()
      } else if (dialogReturnFocusRef.current?.isConnected) {
        dialogReturnFocusRef.current.focus()
        dialogReturnFocusRef.current = null
      }
    }
    const observer = new MutationObserver(syncDialogFocus)
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'aria-hidden'] })
    syncDialogFocus()
    const trap = (event) => {
      if (event.key !== 'Tab') return
      const items = focusables()
      if (!items.length) return
      const firstItem = items[0], lastItem = items[items.length - 1]
      if (event.shiftKey && (document.activeElement === firstItem || !items.includes(document.activeElement))) { event.preventDefault(); lastItem.focus() }
      else if (!event.shiftKey && (document.activeElement === lastItem || !items.includes(document.activeElement))) { event.preventDefault(); firstItem.focus() }
    }
    document.addEventListener('keydown', trap, true)
    return () => { observer.disconnect(); document.removeEventListener('keydown', trap, true); document.removeEventListener('focusin', captureReturnFocus, true) }
  }, [isSearchOpen, isNewDocumentOpen, showOnboarding, leaveRequest])

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
    const handleKeyDown = (e) => {
      const shortcuts = loadShortcuts()
      const target = e.target
      if (document.body.dataset.shortcutRecording === 'true') return
      const editing = target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
      if (editing && e.key !== 'Escape' && !e.metaKey && !e.ctrlKey) return
      const modalOpen = [...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')].some((dialog) => dialog.getClientRects().length)
      if (modalOpen) return
      for (const [action, cfg] of Object.entries(shortcuts)) {
        if (!cfg.key) continue
        const isMac = window.pdfKing?.platform === 'darwin' || /Mac|iPhone|iPad/.test(navigator.platform || '')
        const universalModifier = cfg.metaKey && cfg.ctrlKey
        const modifierMatch = universalModifier
          ? (isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey)
          : cfg.metaKey
            ? e.metaKey && !e.ctrlKey
            : cfg.ctrlKey
              ? e.ctrlKey && !e.metaKey
              : !e.metaKey && !e.ctrlKey
        const match = modifierMatch && (!!cfg.altKey === e.altKey) && (!!cfg.shiftKey === e.shiftKey) && cfg.key.toLowerCase() === e.key.toLowerCase()
        if (match) {
          e.preventDefault()
          e.stopPropagation()
          if (action === 'search') setIsSearchOpen((isOpen) => {
            const next = cfg.toggleOnRepeat === false ? true : !isOpen
            if (next) setTimeout(() => document.querySelector('.palette-input')?.focus(), 50)
            return next
          })
          if (action === 'new-document') {
            if (cfg.toggleOnRepeat === false) handleOpenNewDocument()
            else if (isNewDocumentOpen) setIsNewDocumentOpen(false)
            else handleOpenNewDocument()
          }
          if (action === 'new-window') handleOpenNewWindow()
          if (action === 'open-file') {
            if (cfg.toggleOnRepeat === false) handleOpenPdf()
            else if (isNewDocumentOpen) setIsNewDocumentOpen(false)
            else handleOpenPdf()
          }
          if (action === 'close-overlay') {
            if (contextMenu) setContextMenu(null)
            else if (isNewDocumentOpen) setIsNewDocumentOpen(false)
            else if (isSearchOpen) setIsSearchOpen(false)
            else if (document.querySelector('.file-picker-modal')) document.querySelector('.file-picker-modal .palette-close-btn')?.click()
          }
          if (action === 'navigate-home') handlePaletteNavigate({ type: 'home' })
          if (action === 'navigate-recent') handlePaletteNavigate({ type: 'recent' })
          if (action === 'navigate-settings') handlePaletteNavigate({ type: 'settings' })
          if (action === 'navigate-editor') handlePaletteNavigate({ type: 'tool', toolId: 'pdf-editor' })
          if (action === 'new-tab') createTab()
          if (action === 'close-tab') closeTab(activeTabId)
          if (action === 'close-window') {
            handleCloseWindow()
          }
          if (action === 'toggle-sidebar') setSidebarCollapsed(c => !c)
          if (action === 'toggle-theme') handleToggleTheme()
          if (action === 'print-document') {
            if (currentView.type === 'tool' && currentView.toolId === 'pdf-editor') void editorRef.current?.printPdf?.()
            else document.querySelector('.pdf-editor-workspace .editor-open-button[aria-label="Print PDF"]')?.click()
          }
          if (action === 'toggle-right-sidebar') document.querySelector('.pdf-editor-right-sidebar-toggle')?.click()
          if (action === 'focus-editor-search') document.querySelector('.pdf-editor-menu-search input, .pdf-editor-workspace input[aria-label*="Search"]')?.focus()
          if (action.startsWith('editor-')) window.dispatchEvent(new CustomEvent('pdfking:editor-shortcut', { detail: { action } }))
          if (action === 'save-export' && currentView.type === 'tool' && !isFullPdfEditor) {
            const saveButton = document.querySelector('.editor-save-button:not(:disabled), .editor-apply-inline:not(:disabled), .output-row .browse-button:not(:disabled)')
            saveButton?.click()
          }
          break
        }
      }
      if (e.key === 'Tab' && e.ctrlKey && !e.metaKey) {
        e.preventDefault()
        const index = tabs.findIndex((tab) => tab.id === activeTabIdRef.current)
        const direction = e.shiftKey ? -1 : 1
        if (tabs.length > 1) {
          const nextIndex = (index + direction + tabs.length) % tabs.length
          selectTab(tabs[nextIndex])
        } else {
          window.pdfKing?.switchWindow?.(direction)
        }
      }
      if (e.key === 'a' && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) {
        e.preventDefault()
        if (currentView.type === 'home') {
          const firstFile = document.querySelector('.home-file-row')
          if (firstFile) firstFile.focus()
        }
      }
      if (e.key === 's' && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) {
        e.preventDefault()
        if (currentView.type === 'home') {
          const sidebar = document.querySelector('.sidebar')
          if (sidebar) sidebar.focus()
        }
      }
      if (e.key === 'Tab' && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) {
        e.preventDefault()
        if (currentView.type === 'home') {
          const firstFile = document.querySelector('.home-file-row')
          if (firstFile) firstFile.focus()
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [currentView, activeTabId, isNewDocumentOpen, isSearchOpen, contextMenu, tabs, showOnboarding, theme])

  return (
    <div className={`app-shell ${currentView.type !== 'home' ? 'theme-font-scope' : ''} ${isLightTheme(theme) ? 'light-theme' : ''} ${sidebarCollapsed ? 'sidebar-collapsed' : ''} ${phoneLayout ? 'phone-layout' : ''} ${mobileNavOpen ? 'mobile-nav-open' : ''} ${isFullPdfEditor ? 'full-pdf-editor-mode' : ''} ${isFullPdfEditor && !editorChromeVisible && !phoneLayout ? 'editor-chrome-hidden' : ''}`} data-theme={theme} data-platform={window.pdfKing?.platform || 'web'} style={{ '--logo-accent': themeBrandAccent(logoTheme) }}>
      <a className="skip-link" href={`#workspace-panel-${activeTabId}`}>Skip to workspace</a>
      <TabBar tabs={tabs} activeTabId={activeTabId} dirtyTabIds={dirtyTabIds} onSelectTab={selectTab} onCloseTab={closeTab} onNewTab={createTab} getTitle={getTabTitle} onStartTabDrag={startTabDrag} onCancelTabDrag={cancelTabDrag} onReorderTab={reorderTab} onImportTab={importTabFromWindow} />
      <div className="tabs-spacer" style={{ height: '8px', background: 'transparent' }} />
      <div className="workspace-shell">
        {mobileNavOpen && <div className="mobile-nav-backdrop" onClick={() => setMobileNavOpen(false)} aria-hidden="true" />}
        <Sidebar currentView={currentView} onNavigate={handleNavigate} onOpenNewDocument={handleOpenNewDocument} onToggleCollapsed={() => setSidebarCollapsed((collapsed) => !collapsed)} collapsed={sidebarCollapsed} theme={theme} userName={userName} phoneLayout={phoneLayout} onCloseMobileNav={() => setMobileNavOpen(false)} />

      <main className="main-area" id={`workspace-panel-${activeTabId}`} tabIndex={-1} role="tabpanel" aria-labelledby={`workspace-tab-${activeTabId}`} onContextMenu={handleWorkspaceContextMenu}>
        <Topbar
          currentView={currentView}
          onNavigate={handlePaletteNavigate}
          onOpenSearch={() => setIsSearchOpen(true)}
          phoneLayout={phoneLayout}
          mobileNavOpen={mobileNavOpen}
          onToggleMobileNav={() => setMobileNavOpen((open) => !open)}
        />

        {currentView.type === 'home' && (
          <HomePage userName={userName} theme={theme} onNavigate={handleNavigate} onOpenPdf={handleOpenPdf} />
        )}

        {currentView.type === 'category' && (
          <CategoryPage
            categoryId={currentView.categoryId}
            onNavigate={handleNavigate}
            onSelectTool={handleSelectToolPreservingCurrentTool}
          />
        )}

        {isFullPdfEditor && <PdfEditorWorkspace key={activeTabId} editorRef={editorRef} initialDraft={editorDrafts[activeTabId]} onDraftChange={saveActiveEditorDraft} onDirtyChange={(dirty) => reportTabDirty(activeTabId, dirty)} onBeforeDiscard={(action) => requestLeave(activeTabId, action)} initialFiles={currentView.files || EMPTY_FILES} openPicker={currentView.openPicker || false} initialTool={currentView.toolId} onExit={() => handleNavigate({ type: 'home' })} onOpenPdf={handleOpenPdf} appChromeVisible={editorChromeVisible} onToggleAppChrome={() => setEditorChromeVisible((visible) => !visible)} editTextRequest={editTextRequest} />}

        {currentView.type === 'tool' && !isFullPdfEditor && (
          <ToolStudioPage
            key={`${activeTabId}-${currentView.toolId}`}
            toolId={currentView.toolId}
            initialFiles={currentView.files || EMPTY_FILES}
            initialDraft={toolDrafts[`${activeTabId}:${currentView.toolId}`]}
            tabId={activeTabId}
            onDraftChange={saveToolDraft}
            openPicker={currentView.openPicker || false}
            onNavigate={handlePaletteNavigate}
            onSelectTool={handleSelectToolPreservingCurrentTool}
            editorRef={editorRef}
            onDirtyChange={(dirty) => reportTabDirty(activeTabId, dirty)}
            onBeforeDiscard={(action) => requestLeave(activeTabId, action)}
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
          commandPaletteSize={commandPaletteSize}
          onSetCommandPaletteSize={(size) => { setCommandPaletteSize(size); window.localStorage.setItem('pdfking-command-palette-size', size) }}
        />
        )}
      </main>
      </div>

      <WorkspaceContextMenu menu={contextMenu} onClose={() => setContextMenu(null)} onAction={handleContextAction} />
      {actionError && <div className="app-action-error" role="alert"><span>{actionError}</span><button type="button" onClick={() => setActionError('')} aria-label="Dismiss error">×</button></div>}

      <NewDocumentPage isOpen={isNewDocumentOpen} mode={newDocumentMode} onNavigate={handleNavigate} onClose={() => setIsNewDocumentOpen(false)} />

      <CommandPalette
        isOpen={isSearchOpen}
        onClose={() => setIsSearchOpen(false)}
        onSelectTool={handleSelectToolPreservingCurrentTool}
        onNavigate={handlePaletteNavigate}
        onNewDocument={handleOpenNewDocument}
        onNewWindow={handleOpenNewWindow}
        onOpenPdf={handleOpenPdf}
        onToggleTheme={handleToggleTheme}
        onToggleSidebar={() => setSidebarCollapsed((collapsed) => !collapsed)}
        onNewTab={createTab}
        size={commandPaletteSize}
      />
      <Onboarding isOpen={showOnboarding} theme={theme} onSelectTheme={handleSelectTheme} onFinish={handleFinishOnboarding} />
      <PasswordDialog />
      {leaveRequest && <UnsavedChangesDialog stage={leaveRequest.stage} error={leaveError} onDismiss={() => {setLeaveRequest(null); setLeaveError(''); window.pdfKing?.cancelCloseWindow?.()}} onAccept={() => resolveLeaveRequest()} onCancel={cancelLeaveRequest} />}
      {updateInfo && <UpdateDialog update={updateInfo} onSkip={skipUpdate} onUpdate={startUpdate} />}
    </div>
  )
}

createRoot(document.getElementById('root')).render(<AppErrorBoundary><App /></AppErrorBoundary>)
