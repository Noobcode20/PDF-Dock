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
  openExternal: (url) => ipcRenderer.invoke('pdfking:open-external', url),
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
  readQpdfWasm: (assetName) => ipcRenderer.invoke('pdfking:read-qpdf-wasm', assetName),
  convertType1Fonts: (data) => ipcRenderer.invoke('pdfking:convert-type1-fonts', data),
  readSystemFont: (face) => ipcRenderer.invoke('pdfking:read-system-font', face),
  platform: process.platform,
})
