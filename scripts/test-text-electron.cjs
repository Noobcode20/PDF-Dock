const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { chromium } = require(process.env.PDFKING_PLAYWRIGHT || 'playwright-core')
const { captureUiBytes } = require('./electron-qa.cjs')

const FIXTURE = path.resolve('tmp/sol-qa/master-original.pdf')
const OUTPUT = path.resolve('tmp/sol-qa/text-ui.pdf')

;(async () => {
  const browser = await chromium.connectOverCDP(process.env.PDFKING_CDP || 'http://127.0.0.1:9224')
  try {
    const page = browser.contexts()[0].pages().find((candidate) => candidate.url().includes(':5174'))
    assert.ok(page, 'Electron page on port 5174 is required')
    const button = (name) => page.getByRole('button', { name, exact: true })

    const dismissOnboarding = async () => {
      const skip = button('Skip setup')
      if (await skip.count()) await skip.evaluate((element) => element.click()).catch(() => {})
      await page.waitForFunction(() => !document.querySelector('.onboarding-skip')).catch(() => {})
    }

    const openDocument = async (filePath) => {
      await dismissOnboarding()
      await button('New document').first().click()
      await page.locator('input[type=file]').first().setInputFiles(filePath)
      await page.waitForSelector('canvas.is-rendered', { timeout: 30000 })
      await page.waitForFunction(() => document.querySelectorAll('.pdf-text-layer span').length > 0)
    }

    const go = async (number) => {
      const input = page.getByRole('spinbutton', { name: 'Current page', exact: true })
      await input.fill(String(number))
      await input.press('Enter')
      await page.waitForSelector(`canvas[aria-label="PDF page ${number}"].is-rendered`, { timeout: 30000 })
      await page.waitForFunction((expected) => {
        const canvas = document.querySelector(`canvas[aria-label="PDF page ${expected}"]`)
        const layer = canvas?.parentElement?.querySelector('.pdf-text-layer')
        return layer?.dataset.renderWidth && Math.abs(Number(layer.dataset.renderWidth) - canvas.parentElement.clientWidth) < 2
      }, number)
    }

    const replace = async (number, source, value) => {
      await go(number)
      const pageRoot = page.locator('.acrobat-document-page').filter({ has: page.locator(`canvas[aria-label="PDF page ${number}"]`) })
      const span = pageRoot.locator('.pdf-text-layer span').filter({ hasText: source }).first()
      await span.waitFor({ state: 'visible' })
      await span.dblclick()
      const editor = page.getByRole('textbox', { name: 'Replace PDF paragraph', exact: true })
      await editor.waitFor({ state: 'visible' })
      await editor.fill(value)
      await editor.press('Meta+Enter')
      await editor.waitFor({ state: 'hidden' })
    }

    const searchPdf = async (bytes, terms) => {
      const data = Array.from(bytes)
      return page.evaluate(async ({ data, terms }) => {
        const engine = await import('/src/pdfEngine.js')
        const file = new File([new Uint8Array(data)], 'text.pdf', { type: 'application/pdf' })
        const found = {}
        for (const term of terms) found[term] = (await engine.searchPdfDocument(file, term)).results.map((result) => result.page)
        return found
      }, { data, terms })
    }

    const samplePixel = async (bytes, pageNumber, x, y) => {
      const data = Array.from(bytes)
      return page.evaluate(async ({ data, pageNumber, x, y }) => {
        const engine = await import('/src/pdfEngine.js')
        const file = new File([new Uint8Array(data)], 'sample.pdf', { type: 'application/pdf' })
        const canvas = document.createElement('canvas')
        const result = await engine.renderPdfPage(file, pageNumber, canvas, 1)
        if (result.status !== 'SUCCESS') throw new Error(result.error?.message || 'Could not render the saved page.')
        const pixel = canvas.getContext('2d').getImageData(Math.round(x * canvas.width), Math.round(y * canvas.height), 1, 1).data
        return Array.from(pixel.slice(0, 3))
      }, { data, pageNumber, x, y })
    }

    const pages = (found, term) => [...new Set(found[term] || [])].sort((a, b) => a - b)
    const assertPages = (found, term, expected) => assert.deepEqual(pages(found, term), expected, `${term} pages`)

    await page.reload()
    await dismissOnboarding()
    await openDocument(FIXTURE)
    await button('Edit text').click()
    await button('Run Edit text').waitFor({ state: 'visible' })

    await replace(1, 'Multiple lines stay', 'Two lines\nstay in place')
    await replace(3, 'Nonwhite background text', 'Yellow text')
    await replace(2, 'Page 2 original short text', 'Rotated text')
    await replace(4, 'Page 4 original short text', '')
    await button('Undo').click()
    await button('Redo').click()
    await button('Run Edit text').click()
    await page.waitForFunction(() => document.querySelector('.pdf-editor-status')?.textContent === 'Changes applied to the current document.', undefined, { timeout: 60000 })

    const bytes = await captureUiBytes(page)
    assert.ok(bytes.length > 1000, 'The editor must expose the committed PDF bytes')
    await fs.writeFile(OUTPUT, Buffer.from(bytes))

    const found = await searchPdf(bytes, [
      'Multiple lines stay', 'in their selected region', 'Two lines', 'stay in place',
      'Nonwhite background text', 'Yellow text',
      'Page 2 original short text', 'Rotated text',
      'Page 4 original short text',
      'Page 1 original short text', 'Page 3 original short text', 'Page 5 original short text',
    ])
    assertPages(found, 'Multiple lines stay', [2, 3, 4, 5])
    assertPages(found, 'in their selected region', [2, 3, 4, 5])
    assertPages(found, 'Two lines', [1])
    assertPages(found, 'stay in place', [1])
    assertPages(found, 'Nonwhite background text', [1, 2, 4, 5])
    assertPages(found, 'Yellow text', [3])
    assertPages(found, 'Page 2 original short text', [])
    assertPages(found, 'Rotated text', [2])
    assertPages(found, 'Page 4 original short text', [])
    assertPages(found, 'Page 1 original short text', [1])
    assertPages(found, 'Page 3 original short text', [3])
    assertPages(found, 'Page 5 original short text', [5])

    const background = await samplePixel(bytes, 3, 0.3, 0.23)
    assert.ok(background.every((channel, index) => Math.abs(channel - [242, 214, 153][index]) <= 8), `colored source background must survive, got rgb(${background.join(',')})`)

    await page.reload()
    await dismissOnboarding()
    await openDocument(OUTPUT)
    await go(2)
    await page.screenshot({ path: 'tmp/sol-qa/text-rotated-reopened.png' })
    const reopened = await captureUiBytes(page)
    const reopenedFound = await searchPdf(reopened, ['Rotated text', 'Page 2 original short text', 'Yellow text', 'Two lines'])
    assertPages(reopenedFound, 'Rotated text', [2])
    assertPages(reopenedFound, 'Page 2 original short text', [])
    assertPages(reopenedFound, 'Yellow text', [3])
    assertPages(reopenedFound, 'Two lines', [1])
    const reopenedBackground = await samplePixel(reopened, 3, 0.3, 0.23)
    assert.ok(reopenedBackground.every((channel, index) => Math.abs(channel - [242, 214, 153][index]) <= 8), `reopened colored background must survive, got rgb(${reopenedBackground.join(',')})`)

    console.log('PASS native text UI: multiline replacement, nonwhite colored background, rotated/cropped page, deletion, undo/redo, committed export, extraction, and reopened output all verified with the visible controls.')
  } finally {
    await browser.close()
  }
})().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
