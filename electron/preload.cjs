const { contextBridge, ipcRenderer, webUtils } = require('electron')

contextBridge.exposeInMainWorld('pdfKing', {
  getFilePath: (file) => webUtils.getPathForFile(file),
  saveFile: (payload) => ipcRenderer.invoke('pdfking:save-file', payload),
  printPdf: (payload) => ipcRenderer.invoke('pdfking:print-pdf', payload),
  chooseOutputFolder: () => ipcRenderer.invoke('pdfking:choose-output-folder'),
  getDefaultOutputFolder: () => ipcRenderer.invoke('pdfking:get-output-folder'),
  addRecentFile: (payload) => ipcRenderer.invoke('pdfking:add-recent-file', payload),
  getRecentFiles: () => ipcRenderer.invoke('pdfking:get-recent-files'),
  readRecentFile: (id) => ipcRenderer.invoke('pdfking:read-recent-file', id),
  removeRecentFile: (id) => ipcRenderer.invoke('pdfking:remove-recent-file', id),
  clearRecentFiles: () => ipcRenderer.invoke('pdfking:clear-recent-files'),
  openPdf: () => ipcRenderer.invoke('pdfking:open-pdf'),
  readOpenedPdf: (filePath) => ipcRenderer.invoke('pdfking:read-opened-pdf', filePath),
  onOpenFile: (callback) => {
    const listener = (_event, filePath) => callback(filePath)
    ipcRenderer.on('pdfking:open-file', listener)
    ipcRenderer.invoke('pdfking:renderer-ready')
    return () => ipcRenderer.removeListener('pdfking:open-file', listener)
  },
  openExternal: (url) => ipcRenderer.invoke('pdfking:open-external', url),
  updateGetState: () => ipcRenderer.invoke('pdfking:update-get-state'),
  updateCheck: () => ipcRenderer.invoke('pdfking:update-check'),
  updateDownload: () => ipcRenderer.invoke('pdfking:update-download'),
  updateInstall: () => ipcRenderer.invoke('pdfking:update-install'),
  updateSkip: (version) => ipcRenderer.invoke('pdfking:update-skip', version),
  updateOpenDownload: () => ipcRenderer.invoke('pdfking:update-open-download'),
  onUpdateState: (callback) => {
    const listener = (_event, state) => callback(state)
    ipcRenderer.on('pdfking:update-state', listener)
    return () => ipcRenderer.removeListener('pdfking:update-state', listener)
  },
  githubGetAccount: () => ipcRenderer.invoke('pdfking:github-get-account'),
  githubClearToken: () => ipcRenderer.invoke('pdfking:github-clear-token'),
  githubCreateIssue: (payload) => ipcRenderer.invoke('pdfking:github-create-issue', payload),
  githubCreateProxyIssue: (proxyUrl, payload) => ipcRenderer.invoke('pdfking:github-create-proxy-issue', proxyUrl, payload),
  githubStartDeviceAuth: (clientId) => ipcRenderer.invoke('pdfking:github-start-device-auth', clientId),
  githubPollDeviceAuth: (sessionId) => ipcRenderer.invoke('pdfking:github-poll-device-auth', sessionId),
  getAppVersion: () => ipcRenderer.invoke('pdfking:app-version'),
  createWindow: () => ipcRenderer.invoke('pdfking:new-window'),
  closeWindow: () => ipcRenderer.invoke('pdfking:close-window'),
  allowCloseWindow: () => ipcRenderer.invoke('pdfking:allow-close-window'),
  cancelCloseWindow: () => ipcRenderer.invoke('pdfking:cancel-close-window'),
  switchWindow: (direction) => ipcRenderer.invoke('pdfking:switch-window', direction),
  beginTabDrag: (transferId, tabId) => ipcRenderer.invoke('pdfking:begin-tab-drag', transferId, tabId),
  publishTabDrag: (transferId, payload) => ipcRenderer.invoke('pdfking:publish-tab-drag', transferId, payload),
  cancelTabDrag: (transferId) => ipcRenderer.invoke('pdfking:cancel-tab-drag', transferId),
  receiveTabDrag: (transferId) => ipcRenderer.invoke('pdfking:receive-tab-drag', transferId),
  completeTabDrag: (transferId) => ipcRenderer.invoke('pdfking:complete-tab-drag', transferId),
  onTabDragComplete: (callback) => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('pdfking:tab-drag-complete', listener)
    return () => ipcRenderer.removeListener('pdfking:tab-drag-complete', listener)
  },
  onRequestClose: (callback) => {
    const listener = () => callback()
    ipcRenderer.on('pdfking:request-close', listener)
    return () => ipcRenderer.removeListener('pdfking:request-close', listener)
  },
  onRequestBugReport: (callback) => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('pdfking:request-bug-report', listener)
    return () => ipcRenderer.removeListener('pdfking:request-bug-report', listener)
  },
  readQpdfWasm: (assetName) => ipcRenderer.invoke('pdfking:read-qpdf-wasm', assetName),
  convertType1Fonts: (data) => ipcRenderer.invoke('pdfking:convert-type1-fonts', data),
  readSystemFont: (face) => ipcRenderer.invoke('pdfking:read-system-font', face),
  getCliRequest: () => ipcRenderer.invoke('pdfking:cli-get-request'),
  cliResult: (result) => ipcRenderer.invoke('pdfking:cli-result', result),
  cliProgress: (state) => ipcRenderer.invoke('pdfking:cli-progress', state),
  installCli: () => ipcRenderer.invoke('pdfking:install-cli'),
  cliMode: process.argv.includes('--pdf-dock-cli'),
  platform: process.platform,
})
