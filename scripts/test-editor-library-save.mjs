import assert from 'node:assert/strict'
import { writeEditorDocument } from '../src/editor/save.js'

const file = new File([new Uint8Array([1, 2, 3])], 'original.pdf', { type: 'application/pdf' })
let diskWrites = 0
let libraryRecord
const result = await writeEditorDocument({
  file,
  session: { sourcePath: '/private/original.pdf', revision: 8 },
  mode: 'library',
  bridge: { saveFile: async () => { diskWrites += 1; throw new Error('must not write source') } },
  download: async () => { diskWrites += 1 },
  recordRecent: async (record) => { libraryRecord = record },
})
assert.equal(diskWrites, 0)
assert.equal(result.saved, true)
assert.equal(result.name, 'original.pdf')
assert.equal(libraryRecord.name, 'original.pdf')
assert.equal(libraryRecord.sourcePath, '/private/original.pdf')
assert.deepEqual([...libraryRecord.data], [1, 2, 3])

let exportTarget
await writeEditorDocument({
  file,
  session: { sourcePath: '/private/original.pdf' },
  mode: 'export',
  bridge: { saveFile: async (payload) => { exportTarget = payload.filePath; return { filePath: '/tmp/export.pdf' } } },
  recordRecent: async () => {},
})
assert.equal(exportTarget, null)
console.log('Editor library save checks passed')
