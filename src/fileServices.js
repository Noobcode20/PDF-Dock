import { printPdfDocument, recentFileId, recentFilesBackend } from './recentFiles'

export async function saveOutput(output, { recordRecent = true } = {}) {
  let location = ''
  if (window.pdfKing?.saveFile) {
    const result = await window.pdfKing.saveFile({ name: output.name, data: output.data })
    if (result.canceled) return false
    location = result.filePath || ''
  } else {
    const blob = new Blob([output.data], { type: output.mimeType })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = output.name
    anchor.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  if (recordRecent && window.localStorage.getItem('pdfking-keep-recent') !== 'false' && /\.pdf$/i.test(output.name)) {
    const backend = recentFilesBackend()
    if (!backend?.addRecentFile) return location || true
    let pages = 0
    try {
      const { PDFDocument } = await import('pdf-lib')
      pages = (await PDFDocument.load(output.data, { ignoreEncryption: true })).getPageCount()
    } catch { /* Keep the output available even if metadata cannot be read. */ }
    try { await backend.addRecentFile({ name: output.name, data: output.data, size: output.data.byteLength, pages, sourcePath: location || null }) }
    catch (error) { console.warn('The PDF was saved, but it could not be added to recent files.', error) }
  }
  return location || true
}

const rememberedPdfs = new WeakMap()

export async function rememberPdf(file) {
  if (window.localStorage.getItem('pdfking-keep-recent') === 'false' || !file?.name?.toLowerCase().endsWith('.pdf')) return
  const backend = recentFilesBackend()
  if (!backend?.addRecentFile) return
  if (rememberedPdfs.has(file)) return rememberedPdfs.get(file)
  const pending = rememberPdfOnce(file, backend)
  rememberedPdfs.set(file, pending)
  try { return await pending } catch (error) { rememberedPdfs.delete(file); throw error }
}

async function rememberPdfOnce(file, backend) {
  const data = new Uint8Array(await file.arrayBuffer())
  let pages = 0
  try {
    const { PDFDocument } = await import('pdf-lib')
    pages = (await PDFDocument.load(data, { ignoreEncryption: true })).getPageCount()
  } catch { /* Keep history for damaged files too. */ }
  try { await backend.addRecentFile({ name: file.name, data, size: file.size, pages, sourcePath: file.sourcePath || null }) }
  catch (error) { console.warn('The PDF could not be added to recent files.', error) }
}

export async function forgetPdfCopy(file) {
  if (!file?.arrayBuffer) return
  const backend = recentFilesBackend()
  if (!backend?.removeRecentFile) return
  const identity = file.sourcePath ? new TextEncoder().encode(window.pdfKing?.platform === 'win32' ? file.sourcePath.toLowerCase().replaceAll('/', String.fromCharCode(92)) : file.sourcePath) : await file.arrayBuffer()
  const id = await recentFileId(identity)
  await backend.removeRecentFile(id)
}

export { printPdfDocument }
