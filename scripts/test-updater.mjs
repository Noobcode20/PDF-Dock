import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { createUpdateController } = require('../electron/updateController.cjs')
const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'pdfking-updater-'))
const app = { isPackaged: true, getVersion: () => '0.1.0-beta.2', getPath: () => directory }
const updater = new EventEmitter()
updater.checkForUpdates = async () => ({ updateInfo: { version: '0.1.0-beta.3' } })
updater.downloadUpdate = async () => { updater.emit('download-progress', { percent: 35, transferred: 350, total: 1000 }); updater.emit('update-downloaded', { version: '0.1.0-beta.3' }) }
updater.quitAndInstall = (...args) => { updater.installArgs = args }
updater.setFeedURL = (feed) => { updater.feed = feed }
const sent = []
const waitFor = async (read, expected) => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (read() === expected) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  assert.equal(read(), expected)
}

try {
  const controller = createUpdateController({ updater, app, platform: 'win32', send: (state) => sent.push(state) })
  await controller.check()
  assert.equal(updater.allowPrerelease, true)
  assert.equal(updater.channel, 'beta')
  updater.emit('update-available', { version: '0.1.0-beta.3' })
  await waitFor(() => controller.getState().status, 'available')
  await controller.download()
  assert.equal(sent.some((state) => state.status === 'downloading' && state.percent === 35), true)
  assert.equal(controller.getState().status, 'downloaded')
  assert.equal(controller.install(), true)
  assert.deepEqual(updater.installArgs, [false, true])
  await controller.skip('0.1.0-beta.3')
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(directory, 'update-preferences.json'), 'utf8')), { skipVersion: '0.1.0-beta.3' })
  updater.emit('update-available', { version: '0.1.0-beta.3' })
  await waitFor(() => controller.getState().status, 'skipped')

  const macUpdater = new EventEmitter()
  const mac = createUpdateController({ updater: macUpdater, app, platform: 'darwin', send: () => {} })
  mac.initialize()
  macUpdater.emit('update-available', { version: '0.1.0-beta.4' })
  await waitFor(() => mac.getState().status, 'available')
  assert.equal((await mac.download()).status, 'manual-download')
  assert.equal(mac.install(), false)
  await assert.rejects(mac.skip('invalid'), /Invalid update version/)
  console.log('Updater checks passed: beta configuration, update prompt state, progress, install handoff, skipped-version persistence, and macOS manual-installer fallback.')
} finally {
  await fs.rm(directory, { recursive: true, force: true })
}
