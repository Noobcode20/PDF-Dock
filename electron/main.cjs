const { atomicWrite } = require('./atomicWrite.cjs')
const { convertType1Fonts } = require('./fontCompression.cjs')
const { isAppRendererURL } = require('./rendererOrigin.cjs')
const { app, BrowserWindow, dialog, ipcMain, shell, safeStorage, Menu } = require('electron')
const path = require('node:path')
const fs = require('node:fs/promises')
const crypto = require('node:crypto')
const os = require('node:os')

const githubTokenFile = () => path.join(app.getPath('userData'), 'github-feedback-token.enc')
const githubAuthSessions = new Map()

async function readGithubToken() {
  if (!await safeStorage.isAsyncEncryptionAvailable()) throw new Error('Secure token storage is unavailable on this device.')
  const encrypted = await fs.readFile(githubTokenFile())
  const decrypted = await safeStorage.decryptStringAsync(encrypted)
  if (decrypted.shouldReEncrypt) await atomicWrite(githubTokenFile(), await safeStorage.encryptStringAsync(decrypted.result))
  return decrypted.result
}

async function githubRequest(url, token, options = {}) {
  const response = await fetch(url, { ...options, headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28', ...(options.headers || {}) } })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.message || `GitHub request failed (HTTP ${response.status}).`)
  return payload
}

ipcMain.handle('pdfking:github-start-device-auth', async (_event, clientId) => {
  if (typeof clientId !== 'string' || !/^[A-Za-z0-9]{20}$/.test(clientId)) throw new Error('The GitHub OAuth app client ID is invalid.')
  if (!await safeStorage.isAsyncEncryptionAvailable()) throw new Error('Secure token storage is unavailable on this device.')
  const response = await fetch('https://github.com/login/device/code', { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify({ client_id: clientId, scope: 'public_repo' }) })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok || !payload.device_code || !payload.user_code) throw new Error(payload.error_description || 'GitHub device authorization could not start.')
  const sessionId = crypto.randomUUID()
  githubAuthSessions.set(sessionId, { clientId, deviceCode: payload.device_code, interval: Math.max(Number(payload.interval) || 5, 5), expiresAt: Date.now() + (Number(payload.expires_in) || 900) * 1000 })
  return { sessionId, userCode: payload.user_code, verificationUri: payload.verification_uri, interval: Math.max(Number(payload.interval) || 5, 5), expiresIn: Number(payload.expires_in) || 900 }
})

ipcMain.handle('pdfking:github-poll-device-auth', async (_event, sessionId) => {
  const session = githubAuthSessions.get(sessionId)
  if (!session) throw new Error('GitHub authorization session has expired. Start again to get a new code.')
  if (Date.now() >= session.expiresAt) { githubAuthSessions.delete(sessionId); throw new Error('GitHub authorization expired. Start again to get a new code.') }
  const response = await fetch('https://github.com/login/oauth/access_token', { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify({ client_id: session.clientId, device_code: session.deviceCode, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }) })
  const payload = await response.json().catch(() => ({}))
  if (payload.error === 'authorization_pending') return { status: 'pending', interval: session.interval }
  if (payload.error === 'slow_down') { session.interval += 5; return { status: 'pending', interval: session.interval } }
  if (!response.ok || !payload.access_token) { githubAuthSessions.delete(sessionId); throw new Error(payload.error_description || payload.error || 'GitHub authorization failed.') }
  githubAuthSessions.delete(sessionId)
  if (!await safeStorage.isAsyncEncryptionAvailable()) throw new Error('Secure token storage is unavailable on this device.')
  await fs.mkdir(app.getPath('userData'), { recursive: true })
  await atomicWrite(githubTokenFile(), await safeStorage.encryptStringAsync(payload.access_token))
  const user = await githubRequest('https://api.github.com/user', payload.access_token)
  return { status: 'connected', account: { login: user.login, url: user.html_url } }
})

ipcMain.handle('pdfking:github-get-account', async () => {
  try {
    const token = await readGithubToken()
    const user = await githubRequest('https://api.github.com/user', token)
    return { login: user.login, url: user.html_url }
  } catch (error) {
    if (error.code === 'ENOENT') return null
    if (/Bad credentials|token expired|401/i.test(error.message)) await fs.rm(githubTokenFile(), { force: true }).catch(() => {})
    throw error
  }
})

ipcMain.handle('pdfking:github-clear-token', async () => { await fs.rm(githubTokenFile(), { force: true }); return true })

ipcMain.handle('pdfking:github-create-issue', async (_event, payload) => {
  const repository = String(payload?.repository || '')
  const title = String(payload?.title || '').trim()
  const body = String(payload?.body || '').trim()
  if (repository !== 'Noobcode20/PDF-Dock') throw new Error('The configured GitHub repository is invalid.')
  if (title.length < 4 || title.length > 256 || body.length < 10 || body.length > 60000) throw new Error('Add a valid issue title and description.')
  const token = await readGithubToken()
  const issue = await githubRequest(`https://api.github.com/repos/${repository}/issues`, token, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, body }) })
  return { ok: true, url: issue.html_url, number: issue.number }
})

ipcMain.handle('pdfking:github-create-proxy-issue', async (_event, proxyUrl, payload) => {
  try {
    const endpoint = new URL(String(proxyUrl || ''))
    if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password) throw new Error('The bug reporting service URL is invalid. Update the app configuration and rebuild.')
    const response = await fetch(endpoint.href, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const result = await response.json().catch(() => ({}))
    if (!response.ok || !result.url) throw new Error(result.error || `GitHub could not create the issue (HTTP ${response.status}).`)
    return result
  } catch (error) {
    if (error?.message === 'Failed to fetch' || error?.name === 'TypeError') {
      throw new Error('Could not connect to the bug reporting service. Check your internet connection and try again.')
    }
    throw error
  }
})

const recentDirectory = () => path.join(app.getPath('userData'), 'recent-files')
const recentIndex = () => path.join(recentDirectory(), 'index.json')
const updatePreferencesPath = () => path.join(app.getPath('userData'), 'update-preferences.json')
let skippedUpdateVersion = null
let updatePreferencesQueue = Promise.resolve()
let currentUpdateState = null
let updateIsDownloaded = false
let availableUpdateVersion = null

async function readUpdatePreferences() {
  try {
    const preferences = JSON.parse(await fs.readFile(updatePreferencesPath(), 'utf8'))
    skippedUpdateVersion = typeof preferences.skippedVersion === 'string' ? preferences.skippedVersion : null
  } catch { skippedUpdateVersion = null }
}

function saveSkippedUpdateVersion(version) {
  updatePreferencesQueue = updatePreferencesQueue.then(async () => {
    await fs.mkdir(app.getPath('userData'), { recursive: true })
    await fs.writeFile(updatePreferencesPath(), JSON.stringify({ skippedVersion: version }), 'utf8')
    skippedUpdateVersion = version
  })
  return updatePreferencesQueue
}

function broadcastUpdateState(state) {
  currentUpdateState = state
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send('pdfking:update-state', state)
  }
}

function configureAutoUpdates() {
  if (!app.isPackaged) return
  const { autoUpdater } = require('electron-updater')
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false
  autoUpdater.allowPrerelease = true
  autoUpdater.on('update-available', (info) => {
    if (info.version === skippedUpdateVersion) return
    availableUpdateVersion = info.version
    broadcastUpdateState({ status: 'available', version: info.version })
  })
  autoUpdater.on('download-progress', (progress) => {
    if (availableUpdateVersion !== skippedUpdateVersion) broadcastUpdateState({ status: 'downloading', version: availableUpdateVersion, percent: Math.round(progress.percent || 0) })
  })
  autoUpdater.on('update-downloaded', (info) => {
    if (info.version === skippedUpdateVersion) return
    updateIsDownloaded = true
    broadcastUpdateState({ status: 'downloaded', version: info.version })
  })
  autoUpdater.on('error', (error) => {
    if (availableUpdateVersion && availableUpdateVersion !== skippedUpdateVersion) broadcastUpdateState({ status: 'error', version: availableUpdateVersion, message: error?.message || 'The update could not be downloaded.' })
    else console.warn('Could not check for PDF Dock updates:', error?.message || error)
  })
  void autoUpdater.checkForUpdates().catch((error) => console.warn('Could not check for PDF Dock updates:', error?.message || error))
}

ipcMain.handle('pdfking:skip-update-version', async (_event, version) => {
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+/.test(version)) return false
  await saveSkippedUpdateVersion(version)
  if (currentUpdateState?.version === version) currentUpdateState = null
  return true
})
ipcMain.handle('pdfking:get-update-state', () => currentUpdateState)
ipcMain.handle('pdfking:download-update', async () => {
  if (!app.isPackaged) return false
  const { autoUpdater } = require('electron-updater')
  if (process.platform === 'darwin') {
    if (!availableUpdateVersion || !/^\d+\.\d+\.\d+/.test(availableUpdateVersion)) return false
    await shell.openExternal(`https://github.com/Noobcode20/PDF-Dock/releases/tag/v${availableUpdateVersion}`)
    return true
  }
  if (updateIsDownloaded) {
    autoUpdater.quitAndInstall(false, true)
    return true
  }
  await autoUpdater.downloadUpdate()
  return true
})
const systemFontPaths = {
  'Arial-Regular': {
    darwin: ['/System/Library/Fonts/Supplemental/Arial.ttf'],
    win32: ['C:/Windows/Fonts/arial.ttf'],
    linux: ['/usr/share/fonts/truetype/msttcorefonts/Arial.ttf', '/usr/share/fonts/truetype/msttcorefonts/arial.ttf', '/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf'],
  },
  'Arial-Bold': {
    darwin: ['/System/Library/Fonts/Supplemental/Arial Bold.ttf'],
    win32: ['C:/Windows/Fonts/arialbd.ttf'],
    linux: ['/usr/share/fonts/truetype/msttcorefonts/Arial_Bold.ttf', '/usr/share/fonts/truetype/msttcorefonts/arialbd.ttf', '/usr/share/fonts/truetype/liberation2/LiberationSans-Bold.ttf'],
  },
  'Arial-Italic': {
    darwin: ['/System/Library/Fonts/Supplemental/Arial Italic.ttf'],
    win32: ['C:/Windows/Fonts/ariali.ttf'],
    linux: ['/usr/share/fonts/truetype/msttcorefonts/Arial_Italic.ttf', '/usr/share/fonts/truetype/msttcorefonts/ariali.ttf', '/usr/share/fonts/truetype/liberation2/LiberationSans-Italic.ttf'],
  },
  'Arial-BoldItalic': {
    darwin: ['/System/Library/Fonts/Supplemental/Arial Bold Italic.ttf'],
    win32: ['C:/Windows/Fonts/arialbi.ttf'],
    linux: ['/usr/share/fonts/truetype/msttcorefonts/Arial_Bold_Italic.ttf', '/usr/share/fonts/truetype/msttcorefonts/arialbi.ttf', '/usr/share/fonts/truetype/liberation2/LiberationSans-BoldItalic.ttf'],
  },
  'TimesNewRoman-Regular': {
    darwin: ['/System/Library/Fonts/Supplemental/Times New Roman.ttf'],
    win32: ['C:/Windows/Fonts/times.ttf'],
    linux: ['/usr/share/fonts/truetype/msttcorefonts/Times_New_Roman.ttf', '/usr/share/fonts/truetype/liberation2/LiberationSerif-Regular.ttf'],
  },
  'TimesNewRoman-Bold': {
    darwin: ['/System/Library/Fonts/Supplemental/Times New Roman Bold.ttf'],
    win32: ['C:/Windows/Fonts/timesbd.ttf'],
    linux: ['/usr/share/fonts/truetype/msttcorefonts/Times_New_Roman_Bold.ttf', '/usr/share/fonts/truetype/liberation2/LiberationSerif-Bold.ttf'],
  },
  'TimesNewRoman-Italic': {
    darwin: ['/System/Library/Fonts/Supplemental/Times New Roman Italic.ttf'],
    win32: ['C:/Windows/Fonts/timesi.ttf'],
    linux: ['/usr/share/fonts/truetype/msttcorefonts/Times_New_Roman_Italic.ttf', '/usr/share/fonts/truetype/liberation2/LiberationSerif-Italic.ttf'],
  },
  'TimesNewRoman-BoldItalic': {
    darwin: ['/System/Library/Fonts/Supplemental/Times New Roman Bold Italic.ttf'],
    win32: ['C:/Windows/Fonts/timesbi.ttf'],
    linux: ['/usr/share/fonts/truetype/msttcorefonts/Times_New_Roman_Bold_Italic.ttf', '/usr/share/fonts/truetype/liberation2/LiberationSerif-BoldItalic.ttf'],
  },
  'CourierNew-Regular': {
    darwin: ['/System/Library/Fonts/Supplemental/Courier New.ttf'],
    win32: ['C:/Windows/Fonts/cour.ttf'],
    linux: ['/usr/share/fonts/truetype/msttcorefonts/Courier_New.ttf', '/usr/share/fonts/truetype/liberation2/LiberationMono-Regular.ttf'],
  },
  'CourierNew-Bold': {
    darwin: ['/System/Library/Fonts/Supplemental/Courier New Bold.ttf'],
    win32: ['C:/Windows/Fonts/courbd.ttf'],
    linux: ['/usr/share/fonts/truetype/msttcorefonts/Courier_New_Bold.ttf', '/usr/share/fonts/truetype/liberation2/LiberationMono-Bold.ttf'],
  },
  'CourierNew-Italic': {
    darwin: ['/System/Library/Fonts/Supplemental/Courier New Italic.ttf'],
    win32: ['C:/Windows/Fonts/couri.ttf'],
    linux: ['/usr/share/fonts/truetype/msttcorefonts/Courier_New_Italic.ttf', '/usr/share/fonts/truetype/liberation2/LiberationMono-Italic.ttf'],
  },
  'CourierNew-BoldItalic': {
    darwin: ['/System/Library/Fonts/Supplemental/Courier New Bold Italic.ttf'],
    win32: ['C:/Windows/Fonts/courbi.ttf'],
    linux: ['/usr/share/fonts/truetype/msttcorefonts/Courier_New_Bold_Italic.ttf', '/usr/share/fonts/truetype/liberation2/LiberationMono-BoldItalic.ttf'],
  },
}
const tabDrags = new Map()
let recentQueue = Promise.resolve()
const originalHandle = ipcMain.handle.bind(ipcMain)
function trustedRendererFrame(frame) {
  if (!frame || frame.parent) return false
  return isAppRendererURL(frame.url, app.getAppPath())
}
ipcMain.handle = (channel, listener) => originalHandle(channel, (event, ...args) => {
  if (!trustedRendererFrame(event.senderFrame)) throw new Error('This request came from an untrusted renderer frame.')
  return listener(event, ...args)
})
const serializeRecentUpdate = (operation) => {
  const next = recentQueue.then(operation, operation)
  recentQueue = next.catch(() => {})
  return next
}

ipcMain.handle('pdfking:begin-tab-drag', (event, transferId, tabId) => {
  if (typeof transferId !== 'string' || !/^[\w-]{16,80}$/.test(transferId)) return false
  const source = event.sender
  const entry = { source, tabId, payload: null, resolveReady: null, targetId: null }
  entry.ready = new Promise((resolve) => { entry.resolveReady = resolve })
  entry.expiry = setTimeout(() => {
    entry.resolveReady(null)
    tabDrags.delete(transferId)
  }, 120000)
  tabDrags.set(transferId, entry)
  return true
})

ipcMain.handle('pdfking:publish-tab-drag', (event, transferId, payload) => {
  const entry = tabDrags.get(transferId)
  if (!entry || entry.source.id !== event.sender.id || !payload || !payload.view || !Array.isArray(payload.files)) return false
  entry.payload = payload
  entry.resolveReady(payload)
  return true
})

ipcMain.handle('pdfking:cancel-tab-drag', (event, transferId) => {
  const entry = tabDrags.get(transferId)
  if (!entry || entry.source.id !== event.sender.id || entry.targetId) return false
  clearTimeout(entry.expiry)
  entry.resolveReady(null)
  tabDrags.delete(transferId)
  return true
})

ipcMain.handle('pdfking:receive-tab-drag', async (event, transferId) => {
  const entry = tabDrags.get(transferId)
  if (!entry || entry.source.id === event.sender.id) return null
  entry.targetId = event.sender.id
  const payload = await entry.ready
  return tabDrags.get(transferId) === entry ? payload : null
})

ipcMain.handle('pdfking:complete-tab-drag', (event, transferId) => {
  const entry = tabDrags.get(transferId)
  if (!entry || entry.targetId !== event.sender.id || !entry.payload) return false
  clearTimeout(entry.expiry)
  tabDrags.delete(transferId)
  if (!entry.source.isDestroyed()) entry.source.send('pdfking:tab-drag-complete', { tabId: entry.tabId })
  return true
})

async function readRecentIndex() {
  try {
    const value = JSON.parse(await fs.readFile(recentIndex(), 'utf8'))
    if (!Array.isArray(value)) return []
    return value.filter((entry) => entry && typeof entry === 'object' && typeof entry.id === 'string' && /^[\w-]{1,80}$/.test(entry.id) && typeof entry.name === 'string' && Number.isFinite(Number(entry.size)) && Number(entry.size) >= 0).slice(0, 50)
  } catch { return [] }
}

async function writeRecentIndex(entries) {
  const directory = recentDirectory()
  await fs.mkdir(directory, { recursive: true })
  await atomicWrite(recentIndex(), JSON.stringify(entries, null, 2))
}

ipcMain.handle('pdfking:get-recent-files', async () => { const entries=await readRecentIndex(); return Promise.all(entries.map(async entry=>({...entry,missing:await fs.access(entry.sourcePath||path.join(recentDirectory(),`${entry.id}.pdf`)).then(()=>false,()=>true)}))) })
ipcMain.handle('pdfking:new-window', () => { createWindow(); return true })
ipcMain.handle('pdfking:open-external', async (_event, value) => {
  try {
    const url = new URL(String(value || ''))
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return false
    await shell.openExternal(url.href)
    return true
  } catch { return false }
})
ipcMain.handle('pdfking:close-window', (event) => {
  const window = BrowserWindow.fromWebContents(event.sender)
  if (window && !window.isDestroyed()) window.close()
  return true
})
ipcMain.handle('pdfking:allow-close-window', (event) => {
  const window = BrowserWindow.fromWebContents(event.sender)
  if (!window || window.isDestroyed()) return false
  window.__pdfKingCloseAllowed = true
  clearTimeout(window.__pdfKingCloseFallback)
  window.close()
  return true
})
ipcMain.handle('pdfking:cancel-close-window', (event) => {
  const window = BrowserWindow.fromWebContents(event.sender)
  if (!window || window.isDestroyed()) return false
  window.__pdfKingClosePending = false
  clearTimeout(window.__pdfKingCloseFallback)
  return true
})
ipcMain.handle('pdfking:renderer-ready', (event) => {
  const window = BrowserWindow.fromWebContents(event.sender)
  if (!window || window.isDestroyed()) return false
  window.__pdfKingRendererReady = true
  return true
})
ipcMain.handle('pdfking:switch-window', (event, direction = 1) => {
  const windows = BrowserWindow.getAllWindows().filter((window) => !window.isDestroyed())
  if (windows.length < 2) return false
  const currentIndex = windows.indexOf(BrowserWindow.fromWebContents(event.sender))
  if (currentIndex < 0) return false
  const nextIndex = (currentIndex + (Number(direction) < 0 ? -1 : 1) + windows.length) % windows.length
  const nextWindow = windows[nextIndex]
  if (nextWindow.isMinimized()) nextWindow.restore()
  nextWindow.focus()
  return true
})

ipcMain.handle('pdfking:open-pdf', async () => {
  const result = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'PDF documents', extensions: ['pdf'] }] })
  if (result.canceled || !result.filePaths[0]) return null
  const filePath = result.filePaths[0]
  const data = await fs.readFile(filePath)
  return { name: path.basename(filePath), data, filePath }
})

ipcMain.handle('pdfking:convert-type1-fonts', async (_event, data) => convertType1Fonts(data))

ipcMain.handle('pdfking:read-qpdf-wasm', async (_event, assetName) => {
  if (typeof assetName !== 'string' || !/^qpdf(?:-[\w-]+)?\.wasm$/.test(assetName)) throw new Error('Invalid PDF engine asset.')
  return fs.readFile(path.join(app.getAppPath(), 'dist', 'assets', assetName))
})

ipcMain.handle('pdfking:read-system-font', async (_event, face) => {
  if (typeof face !== 'string' || !Object.hasOwn(systemFontPaths, face)) return null
  for (const filePath of systemFontPaths[face][process.platform] || []) {
    try { return new Uint8Array(await fs.readFile(filePath)) } catch { /* Try the next system font location. */ }
  }
  return null
})

ipcMain.handle('pdfking:add-recent-file', async (_event, { name, data, pages, sourcePath }) => serializeRecentUpdate(async () => {
  if (typeof name !== 'string' || !/\.pdf$/i.test(name)) return null
  await fs.mkdir(recentDirectory(), { recursive: true })
  const bytes = Buffer.from(data)
  if (bytes.byteLength > 1024 * 1024 * 1024) throw new Error('This PDF is larger than the 1 GB recent-file cache limit.')
  const stablePath = typeof sourcePath === 'string' && path.isAbsolute(sourcePath) ? path.normalize(sourcePath) : null
  const id = crypto.createHash('sha256').update(stablePath ? (process.platform === 'win32' ? stablePath.toLowerCase() : stablePath) : bytes).digest('hex').slice(0, 40)
  const safeName = name.replace(/[\\/:*?"<>|]/g, '_')
  const cachedPath = path.join(recentDirectory(), `${id}.pdf`)
  try {
    const existing = await fs.stat(cachedPath)
    if (stablePath || existing.size !== bytes.byteLength) await atomicWrite(cachedPath, bytes)
  } catch { await atomicWrite(cachedPath, bytes) }
  const previous = await readRecentIndex()
  const entries = previous.filter((entry) => entry.id !== id)
  entries.unshift({ id, sourcePath: stablePath, name: safeName, size: bytes.byteLength, pages: Number.isInteger(Number(pages)) ? Math.max(0, Number(pages)) : 0, modified: new Date().toISOString() })
  const maxBytes = 1024 * 1024 * 1024
  let totalBytes = 0
  const trimmed = []
  for (const entry of entries) {
    const entryBytes = entry.id === id ? bytes.byteLength : Number(entry.size) || 0
    if (trimmed.length >= 50 || totalBytes + entryBytes > maxBytes) continue
    trimmed.push(entry)
    totalBytes += entryBytes
  }
  await writeRecentIndex(trimmed)
  for (const entry of previous) if (!trimmed.some((kept) => kept.id === entry.id)) await fs.rm(path.join(recentDirectory(), `${entry.id}.pdf`), { force: true })
  return trimmed[0]
}))

ipcMain.handle('pdfking:read-recent-file', async (_event, id) => serializeRecentUpdate(async () => {
  if (typeof id !== 'string' || !/^[\w-]+$/.test(id)) throw new Error('Invalid recent file.')
  const entries=await readRecentIndex(),entry=entries.find(entry=>entry.id===id)
  let data
  try {data=await fs.readFile(entry?.sourcePath || path.join(recentDirectory(), `${id}.pdf`))} catch(error) {if(error.code==='ENOENT')throw new Error('This file has moved or is missing. Remove it from Recent Files or open its new location.');throw error}
  if(entry){entry.modified=new Date().toISOString();await writeRecentIndex([entry,...entries.filter(e=>e.id!==id)])}
  return data
}))

ipcMain.handle('pdfking:remove-recent-file', async (_event, id) => serializeRecentUpdate(async () => {
  if (typeof id !== 'string' || !/^[\w-]+$/.test(id)) throw new Error('Invalid recent file.')
  const entries = await readRecentIndex()
  const remaining = entries.filter((entry) => entry.id !== id)
  if (remaining.length === entries.length) return false
  await fs.rm(path.join(recentDirectory(), `${id}.pdf`), { force: true })
  await writeRecentIndex(remaining)
  return true
}))

ipcMain.handle('pdfking:clear-recent-files', async () => serializeRecentUpdate(async () => {
  await fs.rm(recentDirectory(), { recursive: true, force: true })
  return true
}))

let outputFolder = ''
const settingsPath = () => path.join(app.getPath('userData'), 'settings.json')

async function storedOutputFolder() {
  if (outputFolder) return outputFolder
  try {
    const settings = JSON.parse(await fs.readFile(settingsPath(), 'utf8'))
    outputFolder = settings.outputFolder || ''
  } catch { /* Use the system Downloads folder until a folder is selected. */ }
  return outputFolder
}

ipcMain.handle('pdfking:get-output-folder', async () => {
  return (await storedOutputFolder()) || app.getPath('downloads')
})

ipcMain.handle('pdfking:choose-output-folder', async () => {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })
  if (result.canceled || !result.filePaths[0]) return null
  outputFolder = result.filePaths[0]
  await fs.mkdir(app.getPath('userData'), { recursive: true })
  await fs.writeFile(settingsPath(), JSON.stringify({ outputFolder }, null, 2))
  return outputFolder
})

ipcMain.handle('pdfking:save-file', async (_event, { name, data, filePath }) => {
  if (typeof name !== 'string' || !/^[^/\\]+$/.test(name)) throw new Error('Invalid output filename.')
  const bytes = Buffer.from(data)
  if (filePath != null) {
    if (typeof filePath !== 'string' || !path.isAbsolute(filePath) || !/\.pdf$/i.test(filePath) || filePath.includes('\0')) throw new Error('Invalid PDF destination.')
    await atomicWrite(filePath, bytes)
    return { canceled: false, filePath }
  }
  const result = await dialog.showSaveDialog({
    defaultPath: path.join((await storedOutputFolder()) || app.getPath('downloads'), name),
    filters: [{ name: 'Output file', extensions: [path.extname(name).slice(1) || 'pdf'] }],
  })
  if (result.canceled || !result.filePath) return { canceled: true }
  await atomicWrite(result.filePath, bytes)
  return { canceled: false, filePath: result.filePath }
})

ipcMain.handle('pdfking:print-pdf', async (_event, { name, data }) => {
  if (typeof name !== 'string' || !/\.pdf$/i.test(name) || !data) throw new Error('A PDF file is required for printing.')
  const bytes = Buffer.from(data)
  if (!bytes.byteLength || bytes.byteLength > 1024 * 1024 * 1024) throw new Error('This PDF is empty or larger than the 1 GB print limit.')
  const temporaryPath = path.join(os.tmpdir(), `pdf-dock-print-${crypto.randomUUID()}.pdf`)
  await fs.writeFile(temporaryPath, bytes)
  const printWindow = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } })
  const cleanup = async () => {
    if (!printWindow.isDestroyed()) printWindow.close()
    await fs.rm(temporaryPath, { force: true }).catch(() => {})
  }
  try {
    await printWindow.loadFile(temporaryPath)
    await new Promise((resolve) => setTimeout(resolve, 900))
    return await new Promise((resolve, reject) => {
      printWindow.webContents.print({}, (success, failureReason) => {
        if (success) resolve(true)
        else if (/^Print job cancel(?:ed|led)$/i.test(failureReason || '')) resolve(false)
        else reject(new Error(failureReason || 'The PDF could not be sent to the print dialog.'))
      })
    })
  } finally { await cleanup() }
})

function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1024,
    minHeight: 680,
    backgroundColor: '#17171b',
    title: 'PDF Dock',
    ...(process.platform === 'darwin' ? {
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 14, y: 16 },
    } : {}),
    icon: path.join(__dirname, '..', 'assets', 'pdf-dock.png'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  })

  window.on('close', (event) => {
    if (window.__pdfKingCloseAllowed) { clearTimeout(window.__pdfKingCloseFallback); return }
    // A close request can arrive before React has installed its unsaved-work
    // listener (startup, a failed chunk load, or a renderer reload). Nothing
    // can be dirty yet, so let Electron close instead of trapping the user.
    if (!window.__pdfKingRendererReady) return
    event.preventDefault()
    if (window.__pdfKingClosePending) return
    window.__pdfKingClosePending = true
    window.webContents.send('pdfking:request-close')
  })

  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('did-finish-load', () => {
    if (currentUpdateState && !window.isDestroyed()) window.webContents.send('pdfking:update-state', currentUpdateState)
  })
  window.webContents.on('context-menu', (event, params) => {
    // The renderer owns the normal workspace context menu. Keep Electron's native
    // editing menu for text inputs and selections so its Report a bug item stays available.
    if (!params.isEditable && !params.selectionText) return
    event.preventDefault()
    const template = []
    if (params.isEditable) {
      const editFlags = params.editFlags || {}
      template.push(
        { role: 'undo', enabled: !!editFlags.canUndo },
        { role: 'redo', enabled: !!editFlags.canRedo },
        { type: 'separator' },
        { role: 'cut', enabled: !!editFlags.canCut },
        { role: 'copy', enabled: !!editFlags.canCopy },
        { role: 'paste', enabled: !!editFlags.canPaste },
        { role: 'selectAll', enabled: !!editFlags.canSelectAll },
        { type: 'separator' },
      )
    } else if (params.selectionText) {
      template.push({ role: 'copy', enabled: !!params.editFlags?.canCopy }, { type: 'separator' })
    }
    template.push({ label: 'Report a bug', click: () => window.webContents.send('pdfking:request-bug-report', { context: params.isEditable ? 'Text field' : 'Selected text' }) })
    Menu.buildFromTemplate(template).popup({ window })
  })
  window.webContents.on('will-navigate', (event, target) => {
    if (!isAppRendererURL(target, app.getAppPath())) event.preventDefault()
  })
  window.webContents.on('render-process-gone', () => {
    if (window.isDestroyed()) return
    window.__pdfKingClosePending = false
    window.__pdfKingCloseAllowed = true
    window.close()
  })

  // Exercise the packaged file:// asset path without creating an installer.
  if (process.env.VITE_DEV_SERVER_URL || (!app.isPackaged && process.env.PDFKING_USE_BUILD !== '1')) {
    window.loadURL(process.env.VITE_DEV_SERVER_URL || 'http://127.0.0.1:5174')
  } else {
    window.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }
}

app.whenReady().then(async () => {
  app.setName('PDF Dock')
  await readUpdatePreferences()
  if (process.platform === 'darwin') {
    app.dock.setIcon(path.join(__dirname, '..', 'assets', 'pdf-dock.png'))
  }
  createWindow()
  configureAutoUpdates()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  app.quit()
})
