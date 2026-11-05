export function outputFileName(name, originalName) {
  const value = String(name || '').trim()
  if (!value || /[<>:"/\\|?*\x00-\x1f]/.test(value) || /[. ]$/.test(value)) {
    throw new Error('Enter a file name without folder paths or special characters.')
  }
  const extension = originalName.match(/\.[a-z0-9]+$/i)?.[0] || ''
  return extension && !value.toLowerCase().endsWith(extension.toLowerCase()) ? value + extension : value
}

/** Explicit destinations never depend on automatic recent-file preferences. */
export async function saveToolOutput(output, { destination = 'device', exportFile, library }) {
  if (!['device', 'app', 'both'].includes(destination)) throw new Error('Choose where to save this file.')
  const inApp = destination !== 'device'
  if (inApp && output.mimeType !== 'application/pdf') throw new Error('Only PDFs can be saved in the app. Export this file to your device.')
  if (inApp && !library?.addRecentFile) throw new Error('The PDF library is unavailable. Your output is still ready to export.')
  let exported = false
  if (destination !== 'app') {
    exported = await exportFile(output, { recordRecent: false })
    if (!exported) return false
  }
  if (inApp) {
    try {
      const entry = await library.addRecentFile({ name: output.name, data: output.data, size: output.data.byteLength, pages: output.pages || 0, sourcePath: null })
      if (!entry?.id) throw new Error('The library did not accept this PDF.')
    } catch (cause) {
      throw new Error(`${exported ? 'Exported to your device, but saving in the app failed.' : 'Could not save in the app.'} Your output is still available. ${cause?.message || ''}`.trim())
    }
  }
  return true
}
