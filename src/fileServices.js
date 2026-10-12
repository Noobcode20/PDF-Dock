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
  if (recordRecent && window.localStorage.getItem('pdfking-keep-recent') !== 'false' && /\.pdf$/i.test(output.name) && window.pdfKing?.addRecentFile) {
    let pages = 0
    try {
      const { PDFDocument } = await import('pdf-lib')
      pages = (await PDFDocument.load(output.data, { ignoreEncryption: true })).getPageCount()
    } catch { /* Keep the output available even if metadata cannot be read. */ }
    try { await window.pdfKing.addRecentFile({ name: output.name, data: output.data, size: output.data.byteLength, pages, sourcePath: location || null }) }
    catch (error) { console.warn('The PDF was saved, but it could not be added to recent files.', error) }
  }
  return location || true
}

const rememberedPdfs = new WeakMap()

export async function rememberPdf(file) {
  if (window.localStorage.getItem('pdfking-keep-recent') === 'false' || !window.pdfKing?.addRecentFile || !file?.name?.toLowerCase().endsWith('.pdf')) return
  if (rememberedPdfs.has(file)) return rememberedPdfs.get(file)
  const pending = rememberPdfOnce(file)
  rememberedPdfs.set(file, pending)
  try { return await pending } catch (error) { rememberedPdfs.delete(file); throw error }
}

async function rememberPdfOnce(file) {
  const data = new Uint8Array(await file.arrayBuffer())
  let pages = 0
  try {
    const { PDFDocument } = await import('pdf-lib')
    pages = (await PDFDocument.load(data, { ignoreEncryption: true })).getPageCount()
  } catch { /* Keep history for damaged files too. */ }
  try { await window.pdfKing.addRecentFile({ name: file.name, data, size: file.size, pages, sourcePath: file.sourcePath || null }) }
  catch (error) { console.warn('The PDF could not be added to recent files.', error) }
}

export async function forgetPdfCopy(file) {
  if (!window.pdfKing?.removeRecentFile || !file?.arrayBuffer) return
  const identity = file.sourcePath ? new TextEncoder().encode(window.pdfKing?.platform === 'win32' ? file.sourcePath.toLowerCase().replaceAll('/', String.fromCharCode(92)) : file.sourcePath) : await file.arrayBuffer()
  const digest = await crypto.subtle.digest('SHA-256', identity)
  const id = [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('').slice(0, 40)
  await window.pdfKing.removeRecentFile(id)
}
