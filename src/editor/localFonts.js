import fontkit from '@pdf-lib/fontkit'

const DB_NAME = 'pdfking-font-library'
const STORE_NAME = 'fonts'

function openFontLibrary() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME, { keyPath: 'id' })
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('Could not open the local font library.'))
  })
}

async function withStore(mode, action) {
  const db = await openFontLibrary()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, mode)
    const request = action(transaction.objectStore(STORE_NAME))
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('Could not update the local font library.'))
    transaction.oncomplete = () => db.close()
    transaction.onerror = () => { db.close(); reject(transaction.error) }
  })
}

export const listLocalFonts = () => withStore('readonly', (store) => store.getAll()).then((fonts) => fonts.map(({ id, name, size }) => ({ id, name, size })))
export const getLocalFont = (id) => withStore('readonly', (store) => store.get(id))
export const saveLocalFont = (font) => withStore('readwrite', (store) => store.put(font))
export const removeLocalFont = (id) => withStore('readwrite', (store) => store.delete(id))

export function readFontFamilyName(data, fallback = 'Local font') {
  try { return fontkit.create(new Uint8Array(data)).familyName || fallback }
  catch { return fallback }
}
