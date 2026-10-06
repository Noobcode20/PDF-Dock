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
    await window.pdfKing.addRecentFile({ name: output.name, data: output.data, size: output.data.byteLength, pages })
  }
  return location || true
}

export async function rememberPdf(file) {
  if (window.localStorage.getItem('pdfking-keep-recent') === 'false' || !window.pdfKing?.addRecentFile || !file?.name?.toLowerCase().endsWith('.pdf')) return
  const data = new Uint8Array(await file.arrayBuffer())
  let pages = 0
  try {
    const { PDFDocument } = await import('pdf-lib')
    pages = (await PDFDocument.load(data, { ignoreEncryption: true })).getPageCount()
  } catch { /* Keep history for damaged files too. */ }
  await window.pdfKing.addRecentFile({ name: file.name, data, size: file.size, pages })
}
