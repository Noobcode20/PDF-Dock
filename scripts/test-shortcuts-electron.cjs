const assert = require('node:assert/strict')
const { spawn } = require('node:child_process')
const fs = require('node:fs/promises')
const net = require('node:net')
const os = require('node:os')
const path = require('node:path')

function loadPlaywright() {
  const candidates = [
    process.env.PDFKING_PLAYWRIGHT,
    'playwright-core',
    '/tmp/pdf-dock-issue-qa/node_modules/playwright-core',
  ].filter(Boolean)
  for (const candidate of candidates) {
    try { return require(candidate) } catch {}
  }
  throw new Error('playwright-core is unavailable. Set PDFKING_PLAYWRIGHT to its module path.')
}

const { chromium } = loadPlaywright()
const root = path.resolve(__dirname, '..')
const viteUrl = process.env.PDFKING_VITE_URL || 'http://127.0.0.1:5174'
const vitePort = Number(new URL(viteUrl).port || 80)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function canConnect(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port })
    const finish = (value) => { socket.destroy(); resolve(value) }
    socket.once('connect', () => finish(true))
    socket.once('error', () => finish(false))
    socket.setTimeout(750, () => finish(false))
  })
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port
      server.close(() => resolve(port))
    })
  })
}

function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null) return Promise.resolve()
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, timeoutMs)
    child.once('exit', () => { clearTimeout(timer); resolve() })
  })
}

async function stopChild(child) {
  if (!child || child.exitCode !== null) return
  child.kill('SIGTERM')
  await waitForExit(child, 3000)
  if (child.exitCode === null) {
    child.kill('SIGKILL')
    await waitForExit(child, 1000)
  }
}

async function waitForCdp(url) {
  const deadline = Date.now() + 30000
  let lastError = ''
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${url}/json/version`)
      if (response.ok) return
      lastError = `HTTP ${response.status}`
    } catch (error) { lastError = error.message }
    await sleep(250)
  }
  throw new Error(`Electron debugging endpoint did not start at ${url}: ${lastError}`)
}

async function findPage(browser) {
  const deadline = Date.now() + 30000
  let page = null
  while (Date.now() < deadline) {
    page = browser.contexts()[0]?.pages().find((candidate) => candidate.url().includes(`:${vitePort}`))
    if (page) return page
    await sleep(250)
  }
  throw new Error(`Electron renderer for ${viteUrl} was not found`)
}

;(async () => {
  let browser = null
  let electron = null
  let vite = null
  let profile = null
  let fixturePath = null
  let electronStderr = ''

  try {
    if (!await canConnect(vitePort)) {
      const env = { ...process.env }
      delete env.ELECTRON_RUN_AS_NODE
      vite = spawn(path.join(root, 'node_modules', '.bin', 'vite'), ['--host', '127.0.0.1', '--port', String(vitePort), '--strictPort'], { cwd: root, env, stdio: 'ignore' })
      const deadline = Date.now() + 30000
      while (!await canConnect(vitePort) && Date.now() < deadline) await sleep(250)
      if (!await canConnect(vitePort)) throw new Error(`Vite did not start at ${viteUrl}`)
    }

    let cdpUrl = process.env.PDFKING_CDP
    const launched = !cdpUrl
    if (launched) {
      const debugPort = Number(process.env.PDFKING_DEBUG_PORT) || await freePort()
      cdpUrl = `http://127.0.0.1:${debugPort}`
      profile = await fs.mkdtemp(path.join(os.tmpdir(), 'pdfdock-shortcuts-qa-'))
      const env = { ...process.env, VITE_DEV_SERVER_URL: viteUrl }
      delete env.ELECTRON_RUN_AS_NODE
      electron = spawn(require('electron'), ['.', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`], { cwd: root, env, stdio: ['ignore', 'ignore', 'pipe'] })
      electron.stderr.on('data', (chunk) => { electronStderr = (electronStderr + chunk).slice(-4000) })
    }

    try { await waitForCdp(cdpUrl) }
    catch (error) { throw new Error(`${error.message}\n${electronStderr}`) }

    browser = await chromium.connectOverCDP(cdpUrl)
    const page = await findPage(browser)

    const button = (name) => page.getByRole('button', { name, exact: true })
    const stored = () => page.evaluate(() => JSON.parse(window.localStorage.getItem('pdfking-shortcuts') || '{}'))
    const shortcutButton = (label) => page.getByRole('button', { name: `Change shortcut for ${label}` })
    const binding = (label) => shortcutButton(label).locator('kbd').innerText()

    const dismissOnboarding = async () => {
      const skip = button('Skip setup')
      if (await skip.count()) {
        await skip.waitFor({ state: 'visible', timeout: 3000 }).catch(() => {})
        if (await skip.isVisible()) await skip.click()
      }
    }

    const openShortcuts = async () => {
      await button('Settings').first().click()
      await page.getByRole('tab', { name: 'Shortcuts', exact: true }).click()
      const showAll = button('Show all')
      if (await showAll.count() && await showAll.isVisible()) await showAll.click()
    }

    const assign = async (label, combo) => {
      await shortcutButton(label).click()
      await page.waitForFunction((name) => document.querySelector(`[aria-label="Change shortcut for ${name}"] kbd`)?.textContent === 'Press shortcut…', label)
      await page.keyboard.press(combo)
      await page.waitForFunction((name) => document.querySelector(`[aria-label="Change shortcut for ${name}"] kbd`)?.textContent !== 'Press shortcut…', label)
    }

    const reload = async () => {
      await page.reload()
      await dismissOnboarding()
    }

    await reload()
    await page.evaluate(() => window.localStorage.removeItem('pdfking-shortcuts'))
    await reload()

    const catalog = await page.evaluate(async () => {
      const module = await import('/src/keyboardShortcuts.js')
      return module.SHORTCUT_ACTIONS.map(([action, label]) => ({ action, label }))
    })
    assert.equal(catalog.length, 30, 'the UI catalog must expose all 30 customizable actions')

    await openShortcuts()
    assert.equal(await page.locator('.shortcut-setting-row').count(), 30, 'Show all must render all 30 shortcut rows')
    for (const { label } of catalog) {
      assert.equal(await shortcutButton(label).count(), 1, `missing shortcut row for ${label}`)
      assert.notEqual((await binding(label)).trim(), '—', `${label} must show its current default binding`)
    }

    await assign('New document', 'Meta+Shift+U')
    let shortcuts = await stored()
    assert.equal(shortcuts['new-document']?.key?.toLowerCase(), 'u')
    assert.equal(shortcuts['new-document']?.metaKey, true)
    assert.equal(shortcuts['new-document']?.shiftKey, true)
    assert.match(await binding('New document'), /U/)

    await reload()
    await openShortcuts()
    assert.match(await binding('New document'), /U/, 'a recorded shortcut must survive reload')

    await assign('New window', 'Meta+Shift+U')
    shortcuts = await stored()
    assert.equal(shortcuts['new-window']?.key?.toLowerCase(), 'u')
    assert.equal(shortcuts['new-window']?.metaKey, true)
    assert.equal(shortcuts['new-window']?.shiftKey, true)
    assert.equal(shortcuts['new-document']?.key, '', 'assigning a duplicate must clear the previous owner')
    assert.match(await binding('New document'), /—/, 'the replaced action must display as unassigned')

    await button('Clear shortcut for New window').click()
    shortcuts = await stored()
    assert.equal(shortcuts['new-window']?.key, '', 'Clear must remove the action binding')
    assert.match(await binding('New window'), /—/)

    await button('Reset defaults').click()
    shortcuts = await stored()
    assert.equal(Object.keys(shortcuts).length, 0, 'Reset defaults must clear custom overrides')
    assert.match(await binding('New document'), /N/)

    await assign('Next PDF page', 'Meta+Shift+J')
    await assign('Zoom in', 'Meta+Shift+K')
    shortcuts = await stored()
    assert.equal(shortcuts['editor-page-next']?.key?.toLowerCase(), 'j')
    assert.equal(shortcuts['editor-zoom-in']?.key?.toLowerCase(), 'k')

    await reload()
    shortcuts = await stored()
    assert.equal(shortcuts['editor-page-next']?.key?.toLowerCase(), 'j')
    assert.equal(shortcuts['editor-zoom-in']?.key?.toLowerCase(), 'k')

    const { PDFDocument } = require('pdf-lib')
    const fixture = await PDFDocument.create()
    fixture.addPage()
    fixture.addPage()
    fixture.addPage()
    fixturePath = path.join(profile || os.tmpdir(), `pdfdock-shortcuts-${process.pid}.pdf`)
    await fs.writeFile(fixturePath, await fixture.save())

    await button('New document').first().click()
    await page.locator('input[type=file]').first().setInputFiles(fixturePath)
    await page.waitForSelector('canvas.is-rendered')
    await page.waitForFunction(() => document.querySelector('input[aria-label="Current page"]')?.value === '1')

    await page.locator('.pdf-editor-stage').focus()
    await page.keyboard.press('Meta+Shift+J')
    await page.waitForFunction(() => document.querySelector('input[aria-label="Current page"]')?.value === '2')
    assert.equal(await page.getByRole('spinbutton', { name: 'Current page', exact: true }).inputValue(), '2', 'custom Next PDF page binding must dispatch')

    const zoomBefore = Number(await page.getByRole('slider', { name: 'Zoom level', exact: true }).inputValue())
    await page.locator('.pdf-editor-stage').focus()
    await page.keyboard.press('Meta+Shift+K')
    await page.waitForFunction((before) => Number(document.querySelector('input[aria-label="Zoom level"]')?.value) > before, zoomBefore)
    const zoomAfter = Number(await page.getByRole('slider', { name: 'Zoom level', exact: true }).inputValue())
    assert.ok(zoomAfter > zoomBefore, 'custom Zoom in binding must dispatch')

    await page.evaluate(() => window.localStorage.removeItem('pdfking-shortcuts'))
    console.log('PASS native shortcut UI: 30-action catalog, Settings recording, reload persistence, clear, duplicate replacement, reset, and custom PDF page/zoom dispatch.')
  } finally {
    if (browser) await browser.close().catch(() => {})
    await stopChild(electron)
    await stopChild(vite)
    if (fixturePath) await fs.rm(fixturePath, { force: true }).catch(() => {})
    if (profile) await fs.rm(profile, { recursive: true, force: true }).catch(() => {})
  }
})().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
