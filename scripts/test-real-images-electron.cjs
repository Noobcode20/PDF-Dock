// External real PDF only. Never copies the input into version control.
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const crypto = require('node:crypto')
const { _electron: electron } = require(process.env.PDFKING_PLAYWRIGHT || 'playwright-core')
const { captureUiBytes } = require('./electron-qa.cjs')
const { createCanvas } = require('@napi-rs/canvas')
;(async () => {
  assert.ok(process.env.PDFKING_REAL_PDF, 'Set PDFKING_REAL_PDF to a real PDF with embedded images on page 2')
  const input = path.resolve(process.env.PDFKING_REAL_PDF)
  const original = await fs.readFile(input)
  const hash = data => crypto.createHash('sha256').update(data).digest('hex')
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'pdf-dock-real-images-'))
  const env = { ...process.env, PDFKING_USE_BUILD: '1' }; delete env.ELECTRON_RUN_AS_NODE
  const app = await electron.launch({ executablePath: require('electron'), args: ['.', `--user-data-dir=${profile}`], env })
  try {
    const page = await app.firstWindow(); page.setDefaultTimeout(20000)
    const errors = []; page.on('pageerror', error => errors.push(error.message))
    const button = name => page.getByRole('button', { name, exact: true })
    const open = async file => {
      await page.reload(); await page.waitForSelector('button')
      if (await button('Skip setup').count()) await button('Skip setup').evaluate(node => node.click())
      await button('New document').first().click()
      await page.locator('.new-doc-backdrop input[type=file], .file-picker-backdrop input[type=file]').first().setInputFiles(file)
      await page.waitForSelector('canvas.is-rendered')
    }
    const go = async n => {
      const field = page.getByRole('spinbutton', { name: 'Current page', exact: true })
      await field.fill(String(n)); await field.press('Enter')
      await page.waitForSelector(`canvas[aria-label="PDF page ${n}"].is-rendered`)
    }
    await open(input); await button('Images').click(); await go(2)
    const image = page.locator('.acrobat-document-page').filter({ has: page.locator('canvas[aria-label="PDF page 2"]') }).locator('.pdf-image-object').first()
    await image.waitFor()
    assert.equal(await page.locator('.pdf-image-object.selected').count(), 0)
    await go(3); await go(2)
    assert.equal(await page.locator('.pdf-image-object.selected').count(), 0)
    const rect = await image.evaluate(node => ({ x: parseFloat(node.style.left) / 100, y: parseFloat(node.style.top) / 100, width: parseFloat(node.style.width) / 100, height: parseFloat(node.style.height) / 100 }))
    await image.click()
    await page.locator('.image-inspector:not(.image-inspector-empty)').waitFor()
    const divider = page.getByRole('separator', {name:'Properties panel width'})
    const initialWidth = Number(await divider.getAttribute('aria-valuenow'))
    await divider.press('ArrowLeft'); assert.equal(Number(await divider.getAttribute('aria-valuenow')),initialWidth+8)
    await divider.press('Home'); assert.equal(Number(await divider.getAttribute('aria-valuenow')),240)
    await divider.dblclick(); assert.equal(Number(await divider.getAttribute('aria-valuenow')),286)
    await button('Rotate image right').click()
    const rotation = page.getByRole('spinbutton', { name: 'Rotation angle in degrees', exact: true })
    await page.waitForFunction(() => Number(document.querySelector('input[aria-label="Rotation angle in degrees"]')?.value) === 90)
    assert.equal(Number(await rotation.inputValue()), 90)
    await button('Undo').click()
    // Undo clears selection when its edit disappears; click the real object again.
    await image.click()
    assert.equal(Number(await rotation.inputValue()), 0)
    await button('Redo').click()
    await page.waitForFunction(() => Number(document.querySelector('input[aria-label="Rotation angle in degrees"]')?.value) === 90)
    assert.equal(Number(await rotation.inputValue()), 90)
    await button('Undo').click(); await image.click()
    for (const width of [1280, 760, 390]) {
      await page.setViewportSize({ width, height: 800 })
      await page.waitForTimeout(200)
      if (!await page.locator('.image-inspector').isVisible()) await button('Expand right sidebar').click()
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth) <= 2)
      const dimensions = await page.locator('.image-inspector').evaluate(node => ({ width:node.clientWidth, scroll:node.scrollWidth, overflowing:[...node.querySelectorAll('*')].filter(e=>e.getBoundingClientRect().right>node.getBoundingClientRect().right+2).map(e=>({tag:e.tagName,cls:e.className,width:e.clientWidth})) }))
      if (dimensions.scroll > dimensions.width+2) { await page.screenshot({path:'tmp/real-pdf-qa/inspector-overflow.png'}); console.log({viewport:width,dimensions}) }
      assert.ok(dimensions.scroll <= dimensions.width+2)
    }
    await page.setViewportSize({ width: 1280, height: 800 })
    if (!await page.locator('.image-inspector').isVisible()) await button('Expand right sidebar').click()
    await fs.mkdir('tmp/issue-sweep',{recursive:true}); await page.locator('.pdf-editor-options').screenshot({path:'tmp/issue-sweep/inspector-image.png'});
    await button('Delete image').click()
    await button('Apply changes').click()
    await page.waitForFunction(() => document.querySelector('.pdf-editor-status')?.textContent === 'Changes applied to the current document.')
    const output = Buffer.from(await captureUiBytes(page))
    assert.notEqual(hash(output), hash(original))
    const out = path.join(profile, 'edited.pdf'); await fs.writeFile(out, output)
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const render = async bytes => {
      const task = pdfjs.getDocument({ data: new Uint8Array(bytes), standardFontDataUrl: path.resolve('node_modules/pdfjs-dist/standard_fonts') + '/', wasmUrl: path.resolve('node_modules/pdfjs-dist/wasm') + '/' })
      const document = await task.promise
      const pdfPage = await document.getPage(2); const viewport = pdfPage.getViewport({ scale: 1 })
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height)); const ctx = canvas.getContext('2d')
      await pdfPage.render({ canvasContext: ctx, viewport }).promise
      const x = Math.ceil(rect.x * canvas.width) + 2, y = Math.ceil(rect.y * canvas.height) + 2
      const width = Math.floor(rect.width * canvas.width) - 4, height = Math.floor(rect.height * canvas.height) - 4
      const pixels = ctx.getImageData(x, y, width, height).data
      let dark = 0
      for (let i = 0; i < pixels.length; i += 4) if (Math.min(pixels[i], pixels[i+1], pixels[i+2]) < 210) dark++
      await task.destroy()
      return { dark, samples: pixels.length / 4 }
    }
    const before = await render(original), after = await render(output)
    assert.ok(before.dark > 50, 'Real source diagram must contain visible artwork')
    assert.ok(after.dark < Math.max(5, before.dark * .01), `Source artwork remains: ${JSON.stringify({ before, after })}`)
    await open(out); await go(2)
    assert.equal(await page.locator('.operation-error').count(), 0)
    assert.equal(hash(await fs.readFile(input)), hash(original), 'Original must remain untouched')
    assert.deepEqual(errors, [])
    console.log('PASS real PDF: page 2 diagram selection, page navigation without auto-selection, rotate/undo/redo, narrow inspector, delete/apply, exported source-region pixels, reopen, original hash unchanged.', { filename: path.basename(input), before, after })
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {}); await app.close().catch(() => {})
    await fs.rm(profile, { recursive: true, force: true })
  }
})().catch(error => { console.error(error); process.exitCode = 1 })
