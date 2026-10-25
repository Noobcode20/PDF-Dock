const path = require('node:path')
const fs = require('node:fs/promises')

function createUpdateController({ updater, app, send, platform = process.platform }) {
  let state = { status: 'idle', currentVersion: app.getVersion(), platform }
  let initialized = false
  let checkPromise = null

  const publish = (next) => {
    state = { ...state, ...next, currentVersion: app.getVersion(), platform }
    send(state)
    return state
  }
  const settingsFile = () => path.join(app.getPath('userData'), 'update-preferences.json')
  const readPreferences = async () => {
    try { return JSON.parse(await fs.readFile(settingsFile(), 'utf8')) }
    catch { return {} }
  }
  const writePreferences = async (value) => {
    await fs.mkdir(app.getPath('userData'), { recursive: true })
    await fs.writeFile(settingsFile(), `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  }

  function initialize() {
    if (initialized) return
    initialized = true
    updater.autoDownload = false
    updater.autoInstallOnAppQuit = false
    updater.allowPrerelease = true
    updater.channel = 'beta'
    updater.on('checking-for-update', () => publish({ status: 'checking', error: null }))
    updater.on('update-available', async (info) => {
      const preferences = await readPreferences()
      if (preferences.skipVersion === info.version) return publish({ status: 'skipped', version: info.version })
      publish({ status: 'available', version: info.version, releaseName: info.releaseName || '', releaseNotes: info.releaseNotes || '', error: null })
    })
    updater.on('update-not-available', (info) => publish({ status: 'up-to-date', version: info?.version || app.getVersion(), error: null }))
    updater.on('download-progress', (progress) => publish({ status: 'downloading', percent: Math.max(0, Math.min(100, Math.round(progress.percent || 0))), transferred: progress.transferred || 0, total: progress.total || 0 }))
    updater.on('update-downloaded', (info) => publish({ status: 'downloaded', version: info.version, error: null }))
    updater.on('error', (error) => publish({ status: 'error', error: error?.message || 'The update check failed.' }))
  }

  async function check() {
    initialize()
    if (!app.isPackaged && !process.env.PDFKING_TEST_UPDATER_FEED) {
      return publish({ status: 'unavailable', error: 'Update checks are available in the installed app.' })
    }
    if (!['darwin', 'win32'].includes(platform)) return publish({ status: 'unavailable', error: 'Updates are not configured for this platform.' })
    if (checkPromise) return checkPromise
    checkPromise = (async () => {
      try {
        if (process.env.PDFKING_TEST_UPDATER_FEED) updater.setFeedURL({ provider: 'generic', url: process.env.PDFKING_TEST_UPDATER_FEED })
        await updater.checkForUpdates()
        return state
      } catch (error) {
        return publish({ status: 'error', error: error?.message || 'The update check failed.' })
      } finally { checkPromise = null }
    })()
    return checkPromise
  }

  async function skip(version) {
    if (typeof version !== 'string' || !/^\d+\.\d+\.\d+/.test(version)) throw new Error('Invalid update version.')
    await writePreferences({ skipVersion: version })
    return publish({ status: 'skipped', version })
  }

  async function download() {
    if (state.status !== 'available') throw new Error('There is no update ready to download.')
    if (platform === 'darwin') return publish({ status: 'manual-download', version: state.version })
    await updater.downloadUpdate()
    return state
  }

  function install() {
    if (platform === 'darwin') return false
    if (state.status !== 'downloaded') throw new Error('The update has not finished downloading.')
    updater.quitAndInstall(false, true)
    return true
  }

  return { check, download, install, skip, getState: () => ({ ...state }), initialize }
}

module.exports = { createUpdateController }
