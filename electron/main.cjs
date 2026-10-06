const { app, BrowserWindow, dialog, ipcMain } = require('electron')
const path = require('node:path')
const fs = require('node:fs/promises')

const recentDirectory = () => path.join(app.getPath('userData'), 'recent-files')
const recentIndex = () => path.join(recentDirectory(), 'index.json')

async function readRecentIndex() {
  try { return JSON.parse(await fs.readFile(recentIndex(), 'utf8')) } catch { return [] }
}

ipcMain.handle('pdfking:get-recent-files', readRecentIndex)

ipcMain.handle('pdfking:open-pdf', async () => {
  const result = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'PDF documents', extensions: ['pdf'] }] })
  if (result.canceled || !result.filePaths[0]) return null
  const filePath = result.filePaths[0]
  const data = await fs.readFile(filePath)
  return { name: path.basename(filePath), data }
})

ipcMain.handle('pdfking:read-qpdf-wasm', async (_event, assetName) => {
  if (typeof assetName !== 'string' || !/^qpdf(?:-[\w-]+)?\.wasm$/.test(assetName)) throw new Error('Invalid PDF engine asset.')
  return fs.readFile(path.join(app.getAppPath(), 'dist', 'assets', assetName))
})

ipcMain.handle('pdfking:add-recent-file', async (_event, { name, data, size, pages }) => {
  if (typeof name !== 'string' || !/\.pdf$/i.test(name)) return null
  await fs.mkdir(recentDirectory(), { recursive: true })
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
  const safeName = name.replace(/[\\/:*?"<>|]/g, '_')
  await fs.writeFile(path.join(recentDirectory(), `${id}.pdf`), Buffer.from(data))
  const previous = await readRecentIndex()
  for (const entry of previous.filter((item) => item.name === safeName || previous.indexOf(item) >= 49)) {
    if (entry.id !== id) await fs.rm(path.join(recentDirectory(), `${entry.id}.pdf`), { force: true })
  }
  const entries = previous.filter((entry) => entry.name !== safeName)
  entries.unshift({ id, name: safeName, size, pages, modified: new Date().toISOString() })
  const trimmed = entries.slice(0, 50)
  await fs.writeFile(recentIndex(), JSON.stringify(trimmed, null, 2))
  return trimmed[0]
})

ipcMain.handle('pdfking:read-recent-file', async (_event, id) => {
  if (typeof id !== 'string' || !/^[\w-]+$/.test(id)) throw new Error('Invalid recent file.')
  return fs.readFile(path.join(recentDirectory(), `${id}.pdf`))
})

ipcMain.handle('pdfking:clear-recent-files', async () => {
  await fs.rm(recentDirectory(), { recursive: true, force: true })
  return true
})

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

ipcMain.handle('pdfking:save-file', async (_event, { name, data }) => {
  if (typeof name !== 'string' || !/^[^/\\]+$/.test(name)) throw new Error('Invalid output filename.')
  const bytes = Buffer.from(data)
  const result = await dialog.showSaveDialog({
    defaultPath: path.join((await storedOutputFolder()) || app.getPath('downloads'), name),
    filters: [{ name: 'Output file', extensions: [path.extname(name).slice(1) || 'pdf'] }],
  })
  if (result.canceled || !result.filePath) return { canceled: true }
  await fs.writeFile(result.filePath, bytes)
  return { canceled: false, filePath: result.filePath }
})

function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1024,
    minHeight: 680,
    backgroundColor: '#17171b',
    title: 'PDF King',
    ...(process.platform === 'darwin' ? {
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 14, y: 16 },
    } : {}),
    icon: path.join(__dirname, '..', 'assets', 'pdf-king.png'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  })

  if (!app.isPackaged || process.env.VITE_DEV_SERVER_URL) {
    window.loadURL(process.env.VITE_DEV_SERVER_URL || 'http://127.0.0.1:5173')
  } else {
    window.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }
}

app.whenReady().then(() => {
  app.setName('PDF King')
  if (process.platform === 'darwin') {
    app.dock.setIcon(path.join(__dirname, '..', 'assets', 'pdf-king.png'))
  }
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
