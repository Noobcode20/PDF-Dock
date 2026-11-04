import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
const source = await fs.readFile(new URL('../src/outputStorage.js', import.meta.url), 'utf8')
const { outputFileName, saveToolOutput } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)
assert.equal(outputFileName('My report', 'merged.pdf'), 'My report.pdf')
assert.equal(outputFileName('REPORT.PDF', 'merged.pdf'), 'REPORT.PDF')
for (const name of ['', '  ', '../report', 'folder\\report', 'bad:name', 'report.']) assert.throws(() => outputFileName(name, 'merged.pdf'))
const output = { name: 'My report.pdf', mimeType: 'application/pdf', data: new Uint8Array([37, 80, 68, 70]) }
let writes = [], exports = []
const library = { addRecentFile: async record => { writes.push(record) } }
const exportFile = async (file, options) => { exports.push({ file, options }); return '/tmp/report.pdf' }
assert.equal(await saveToolOutput(output, { destination: 'app', library, exportFile }), true)
assert.equal(exports.length, 0, 'app-only saves must never open the system export dialog')
assert.equal(writes[0].name, output.name)
assert.equal(writes[0].sourcePath, null, 'library copies must stay independent of exported paths')
writes = []
await saveToolOutput(output, { destination: 'device', library, exportFile })
assert.equal(writes.length, 0, 'device-only exports must never add to the library')
assert.equal(exports[0].options.recordRecent, false)
exports = []
await saveToolOutput(output, { destination: 'both', library, exportFile })
assert.equal(writes.length, 1)
assert.equal(exports.length, 1)
writes = []
assert.equal(await saveToolOutput(output, { destination: 'both', library, exportFile: async () => false }), false)
assert.equal(writes.length, 0, 'canceling export leaves the result pending without a partial library write')
await assert.rejects(saveToolOutput(output, { destination: 'both', exportFile, library: { addRecentFile: async () => { throw Error('Disk full') } } }), /Exported to your device.*saving in the app failed.*Disk full/)
await assert.rejects(saveToolOutput(output, { destination: 'app', exportFile }), /library is unavailable/)
await assert.rejects(saveToolOutput({ ...output, mimeType: 'image/png' }, { destination: 'app', library, exportFile }), /Only PDFs/)
console.log('PASS output storage: names, app/device/both, independent library copies, cancellation, partial failures, and unsupported formats.')
