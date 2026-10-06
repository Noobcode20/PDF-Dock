const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('pdfKing', {
  saveFile: (payload) => ipcRenderer.invoke('pdfking:save-file', payload),
  chooseOutputFolder: () => ipcRenderer.invoke('pdfking:choose-output-folder'),
  getDefaultOutputFolder: () => ipcRenderer.invoke('pdfking:get-output-folder'),
  addRecentFile: (payload) => ipcRenderer.invoke('pdfking:add-recent-file', payload),
  getRecentFiles: () => ipcRenderer.invoke('pdfking:get-recent-files'),
  readRecentFile: (id) => ipcRenderer.invoke('pdfking:read-recent-file', id),
  clearRecentFiles: () => ipcRenderer.invoke('pdfking:clear-recent-files'),
  openPdf: () => ipcRenderer.invoke('pdfking:open-pdf'),
  readQpdfWasm: (assetName) => ipcRenderer.invoke('pdfking:read-qpdf-wasm', assetName),
  platform: process.platform,
})
