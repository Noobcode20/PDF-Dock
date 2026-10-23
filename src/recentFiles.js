/* Recent PDF storage.
 *
 * The desktop build keeps recent PDFs on disk through the Electron preload
 * bridge. The web build keeps the same records in IndexedDB so PDF bytes
 * survive reloads without filling localStorage. Both backends expose the same
 * contract: add / list / read / remove / clear. */

const DATABASE_NAME = 'pdf-king-recent'
const DATABASE_VERSION = 1
const METADATA_STORE = 'documents'
const BLOB_STORE = 'blobs'
const MAX_ENTRIES = 50
const MAX_TOTAL_BYTES = 512 * 1024 * 1024
const MAX_FILE_BYTES = 256 * 1024 * 1024

let databasePromise = null

function toBytes(data) {
  if (!data) return new Uint8Array()
  if (data instanceof Uint8Array) return data
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  return new Uint8Array(data)
}

/** Stable id for a PDF. Matches the desktop digest so both builds agree. */
export async function recentFileId(data) {
  const bytes = toBytes(data)
  if (globalThis.crypto?.subtle) {
    const digest = await crypto.subtle.digest('SHA-256', bytes)
    return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('').slice(0, 40)
  }
  let hash = 0x811c9dc5
  for (let index = 0; index < bytes.length; index += 1) {
    hash ^= bytes[index]
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return `web-${hash.toString(16).padStart(8, '0')}-${bytes.length.toString(16)}`
}

function openDatabase() {
  if (typeof indexedDB === 'undefined') return Promise.reject(new Error('This browser cannot store PDFs on the device.'))
  if (databasePromise) return databasePromise
  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(METADATA_STORE)) database.createObjectStore(METADATA_STORE, { keyPath: 'id' })
      if (!database.objectStoreNames.contains(BLOB_STORE)) database.createObjectStore(BLOB_STORE, { keyPath: 'id' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => { databasePromise = null; reject(request.error || new Error('The local PDF library could not be opened.')) }
    request.onblocked = () => { databasePromise = null; reject(new Error('The local PDF library is open in another tab.')) }
  })
  return databasePromise
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('The local PDF library request failed.'))
  })
}

/** Attach before awaiting so a finished transaction is never missed. */
function trackTransaction(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onabort = () => reject(transaction.error || new Error('The local PDF library transaction was cancelled.'))
    transaction.onerror = () => reject(transaction.error || new Error('The local PDF library transaction failed.'))
  })
}

function sortEntries(entries) {
  return [...entries].sort((left, right) => (right.modifiedAt || 0) - (left.modifiedAt || 0) || (right.addedAt || 0) - (left.addedAt || 0))
}

function publicEntry(entry) {
  return {
    id: entry.id,
    name: entry.name,
    size: entry.size || 0,
    pages: entry.pages || 0,
    modified: entry.modified,
    sourcePath: entry.sourcePath || null,
  }
}

async function readAllMetadata() {
  const database = await openDatabase()
  const transaction = database.transaction(METADATA_STORE, 'readonly')
  const finished = trackTransaction(transaction)
  const entries = await requestResult(transaction.objectStore(METADATA_STORE).getAll())
  await finished
  return Array.isArray(entries) ? entries : []
}

async function readMetadata(id) {
  const database = await openDatabase()
  const transaction = database.transaction(METADATA_STORE, 'readonly')
  const finished = trackTransaction(transaction)
  const entry = await requestResult(transaction.objectStore(METADATA_STORE).get(id))
  await finished
  return entry || null
}

async function trimLibrary() {
  const entries = sortEntries(await readAllMetadata())
  let total = 0
  const kept = []
  for (const entry of entries) {
    const size = Number(entry.size) || 0
    if (kept.length >= MAX_ENTRIES || total + size > MAX_TOTAL_BYTES) continue
    kept.push(entry)
    total += size
  }
  const removed = entries.filter((entry) => !kept.some((keptEntry) => keptEntry.id === entry.id))
  if (!removed.length) return
  const database = await openDatabase()
  const transaction = database.transaction([METADATA_STORE, BLOB_STORE], 'readwrite')
  const finished = trackTransaction(transaction)
  const metadataStore = transaction.objectStore(METADATA_STORE)
  const blobStore = transaction.objectStore(BLOB_STORE)
  removed.forEach((entry) => { metadataStore.delete(entry.id); blobStore.delete(entry.id) })
  await finished
}

export async function addRecentFile({ name, data, pages, sourcePath } = {}) {
  if (typeof name !== 'string' || !/\.pdf$/i.test(name)) return null
  const bytes = toBytes(data)
  if (!bytes.byteLength) throw new Error('This PDF has no content to store.')
  if (bytes.byteLength > MAX_FILE_BYTES) throw new Error('This PDF is larger than the browser limit for stored recent files.')
  const id = await recentFileId(bytes)
  const now = Date.now()
  const previous = await readMetadata(id)
  const entry = {
    id,
    name: name.replace(/[\\/:*?"<>|]/g, '_'),
    size: bytes.byteLength,
    pages: Number.isInteger(Number(pages)) ? Math.max(0, Number(pages)) : 0,
    sourcePath: typeof sourcePath === 'string' && sourcePath ? sourcePath : null,
    modified: new Date(now).toISOString(),
    modifiedAt: now,
    addedAt: previous?.addedAt ?? now,
  }
  const database = await openDatabase()
  const transaction = database.transaction([METADATA_STORE, BLOB_STORE], 'readwrite')
  const finished = trackTransaction(transaction)
  transaction.objectStore(METADATA_STORE).put(entry)
  transaction.objectStore(BLOB_STORE).put({ id, data: bytes.slice().buffer })
  await finished
  await trimLibrary()
  return publicEntry(entry)
}

export async function getRecentFiles() {
  const entries = await readAllMetadata()
  return sortEntries(entries).map(publicEntry)
}

export async function readRecentFile(id) {
  if (typeof id !== 'string' || !/^[\w-]+$/.test(id)) throw new Error('Invalid recent file.')
  const database = await openDatabase()
  const transaction = database.transaction([METADATA_STORE, BLOB_STORE], 'readonly')
  const finished = trackTransaction(transaction)
  const blobRequest = transaction.objectStore(BLOB_STORE).get(id)
  const metadataRequest = transaction.objectStore(METADATA_STORE).get(id)
  const [record, entry] = await Promise.all([requestResult(blobRequest), requestResult(metadataRequest)])
  await finished
  if (!record?.data) throw new Error('This file is no longer in your local library.')
  const now = Date.now()
  const update = database.transaction(METADATA_STORE, 'readwrite')
  const updateFinished = trackTransaction(update)
  update.objectStore(METADATA_STORE).put({
    ...(entry || { id, name: 'document.pdf', size: record.data.byteLength || 0, pages: 0, sourcePath: null, addedAt: now }),
    modified: new Date(now).toISOString(),
    modifiedAt: now,
  })
  await updateFinished
  return new Uint8Array(record.data)
}

export async function removeRecentFile(id) {
  if (typeof id !== 'string' || !/^[\w-]+$/.test(id)) throw new Error('Invalid recent file.')
  const existing = await readMetadata(id)
  const database = await openDatabase()
  const transaction = database.transaction([METADATA_STORE, BLOB_STORE], 'readwrite')
  const finished = trackTransaction(transaction)
  transaction.objectStore(METADATA_STORE).delete(id)
  transaction.objectStore(BLOB_STORE).delete(id)
  await finished
  return Boolean(existing)
}

export async function clearRecentFiles() {
  const database = await openDatabase()
  const transaction = database.transaction([METADATA_STORE, BLOB_STORE], 'readwrite')
  const finished = trackTransaction(transaction)
  transaction.objectStore(METADATA_STORE).clear()
  transaction.objectStore(BLOB_STORE).clear()
  await finished
  return true
}

export const browserRecentFiles = { addRecentFile, getRecentFiles, readRecentFile, removeRecentFile, clearRecentFiles }

/** Browser print fallback: hands the PDF to the browser print dialog. */
async function browserPrintPdf({ name = 'document.pdf', data } = {}) {
  const bytes = toBytes(data)
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))
  const frame = document.createElement('iframe')
  frame.title = `Print ${name}`
  frame.setAttribute('aria-hidden', 'true')
  frame.style.cssText = 'position:fixed;width:1px;height:1px;right:0;bottom:0;border:0;opacity:0'
  frame.src = url
  document.body.appendChild(frame)
  await new Promise((resolve) => {
    frame.addEventListener('load', resolve, { once: true })
    window.setTimeout(resolve, 2000)
  })
  frame.contentWindow?.focus()
  frame.contentWindow?.print()
  window.setTimeout(() => { frame.remove(); URL.revokeObjectURL(url) }, 60000)
}

/** The desktop bridge when it exists, the browser library otherwise. */
export function recentFilesBackend() {
  const bridge = typeof window !== 'undefined' ? window.pdfKing : null
  if (bridge?.getRecentFiles && bridge?.addRecentFile && bridge?.readRecentFile) return bridge
  return browserRecentFiles
}

/** Prints through the desktop dialog when present, the browser dialog otherwise. */
export function printPdfDocument(payload) {
  const bridge = typeof window !== 'undefined' ? window.pdfKing : null
  if (bridge?.printPdf) return bridge.printPdf(payload)
  return browserPrintPdf(payload)
}

/**
 * Gives the web build the same guarded bridge surface the desktop build has,
 * without touching an existing Electron bridge.
 */
export function installBrowserBridge() {
  if (typeof window === 'undefined') return null
  if (window.pdfKing?.getRecentFiles) return window.pdfKing
  const bridge = {
    platform: 'web',
    addRecentFile,
    getRecentFiles,
    readRecentFile,
    removeRecentFile,
    clearRecentFiles,
    printPdf: browserPrintPdf,
  }
  try { window.pdfKing = bridge }
  catch { /* The app still works, it simply keeps its own recent-file list. */ }
  return window.pdfKing
}
