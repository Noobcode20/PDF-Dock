// Run against an actual Electron renderer with --remote-debugging-port=9224.
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs/promises')
const { chromium } = require(process.env.PDFKING_PLAYWRIGHT || 'playwright-core')
;(async () => {
  const browser = await chromium.connectOverCDP(process.env.PDFKING_CDP || 'http://127.0.0.1:9224')
  try {
    const page = browser.contexts()[0].pages().find(p => /file:|:5174/.test(p.url()))
    assert.ok(page, 'Electron renderer must be running')
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.reload()
    const skip = page.getByRole('button', { name: 'Skip setup', exact: true })
    if (await skip.count()) await skip.click()
    await page.getByRole('button', { name: 'New document', exact: true }).first().click()
    const dialog = page.getByRole('dialog', { name: 'New document', exact: true })
    await dialog.waitFor()
    await dialog.locator('input[type=file]').setInputFiles(path.resolve('tmp/editor-qa/sixty-pages.pdf'))
    await page.waitForSelector('canvas.is-rendered')
    const current = page.getByRole('spinbutton', { name: 'Current page', exact: true })
    for (const n of [4, 2, 15, 30, 60, 1]) {
      await current.fill(String(n))
      await page.waitForSelector(`canvas[aria-label="PDF page ${n}"].is-rendered`)
      await page.waitForTimeout(250)
    }
    const memory = await page.locator('.acrobat-document-page > canvas').evaluateAll(cs => ({ mounted: cs.length, bytes: cs.reduce((sum,c) => sum+c.width*c.height*4,0) }))
    assert.ok(memory.mounted < 20 && memory.bytes < 256*1024*1024, JSON.stringify(memory))
    const viewer = page.locator('.pdf-viewer-page')
    await viewer.hover()
    let previous = await viewer.evaluate(el => el.scrollTop)
    for (let i=0;i<10;i++) {
      await page.mouse.wheel(0, 220)
      await page.waitForTimeout(150)
      const top = await viewer.evaluate(el => el.scrollTop)
      assert.ok(top >= previous-2, `Scrolling moved backwards: ${previous} -> ${top}`)
      previous = top
    }
    const settled = previous
    await page.waitForTimeout(600)
    assert.ok(Math.abs(await viewer.evaluate(el=>el.scrollTop)-settled)<3, 'Scroll position must remain stable')
    await fs.mkdir('tmp/shipping-qa', { recursive: true })
    for (const width of [1280, 1024, 760, 390]) {
      await page.setViewportSize({ width, height: 800 })
      await page.waitForFunction(() => {
        const root = document.querySelector('.pdf-viewer-page')?.getBoundingClientRect()
        return root && [...document.querySelectorAll('.acrobat-document-page > canvas')].some(c => {
          const r=c.getBoundingClientRect()
          return c.classList.contains('is-rendered') && c.width>0 && r.bottom>root.top && r.top<root.bottom && r.right>root.left && r.left<root.right
        })
      })
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth-innerWidth)
      assert.ok(overflow <= 2, `Window ${width}px has ${overflow}px horizontal overflow`)
      assert.ok(await viewer.evaluate(el => el.clientWidth>100), 'Viewer remains usable')
      await page.screenshot({ path:`tmp/shipping-qa/editor-${width}.png` })
    }
    assert.deepEqual(errors, [])
    console.log('PASS actual Electron: 60-page bounded rendering, page navigation, monotonic scrolling and settled position, 1280/1024/760/390 layouts; no renderer errors.', memory)
  } finally { await browser.close() }
})().catch(error => { console.error(error); process.exitCode=1 })
