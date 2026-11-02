const assert = require('node:assert/strict')
const { chromium } = require(process.env.PDFKING_PLAYWRIGHT || 'playwright-core')

;(async () => {
  const browser = await chromium.connectOverCDP(process.env.PDFKING_CDP || 'http://127.0.0.1:9224')
  try {
    const page = browser.contexts()[0].pages().find((candidate) => candidate.url().includes(':5174'))
    assert.ok(page, 'Electron page on port 5174 is required')
    const button = (name) => page.getByRole('button', { name, exact: true })
    const stored = () => page.evaluate(() => JSON.parse(window.localStorage.getItem('pdfking-shortcuts') || '{}'))
    const openShortcuts = async () => {
      await button('Settings').first().click()
      await page.getByRole('tab', { name: 'Shortcuts', exact: true }).click()
      await button('Show all').click()
    }
    const assign = async (label, combo) => {
      await button(`Change shortcut for ${label}`).click()
      await page.keyboard.press(combo)
      await page.waitForFunction((name) => document.querySelector(`[aria-label="Change shortcut for ${name}"] kbd`)?.textContent !== 'Press shortcut…', label)
    }

    await page.reload()
    const skip = button('Skip setup')
    if (await skip.count() && await skip.isVisible()) await skip.click()
    await page.evaluate(() => window.localStorage.removeItem('pdfking-shortcuts'))
    await page.reload()
    if (await skip.count() && await skip.isVisible()) await skip.click()

    await openShortcuts()
    await assign('New document', 'Meta+Shift+U')
    let shortcuts = await stored()
    assert.equal(shortcuts['new-document']?.key?.toLowerCase(), 'u')
    assert.equal(shortcuts['new-document']?.metaKey, true)
    assert.equal(shortcuts['new-document']?.shiftKey, true)

    await page.reload()
    if (await skip.count() && await skip.isVisible()) await skip.click()
    await openShortcuts()
    assert.match(await button('Change shortcut for New document').innerText(), /U/)

    await assign('New window', 'Meta+Shift+U')
    shortcuts = await stored()
    assert.equal(shortcuts['new-window']?.key?.toLowerCase(), 'u')
    assert.equal(shortcuts['new-document']?.key, '')
    assert.match(await button('Change shortcut for New document').innerText(), /—/)

    await button('Clear shortcut for New window').click()
    shortcuts = await stored()
    assert.equal(shortcuts['new-window']?.key, '')

    await button('Reset defaults').click()
    shortcuts = await stored()
    assert.equal(Object.keys(shortcuts).length, 0)
    assert.match(await button('Change shortcut for New document').innerText(), /N/)

    await assign('New document', 'Meta+Shift+U')
    await button('Home').first().click()
    await page.keyboard.press('Meta+Shift+U')
    await page.getByRole('dialog').filter({ hasText: 'New document' }).waitFor()
    await button('Close new document dialog').click()

    await page.evaluate(() => window.localStorage.removeItem('pdfking-shortcuts'))
    console.log('PASS native shortcut UI: record, persist, conflict replacement, clear, reset, and recorded shortcut dispatch.')
  } finally {
    await browser.close()
  }
})().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
