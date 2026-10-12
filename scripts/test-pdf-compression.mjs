import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { PDFDocument, PDFName, PDFString, StandardFonts } from 'pdf-lib'
import { createPdfToolkit } from 'pdfstudio'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import fontkit from '@pdf-lib/fontkit'
import { compressPdfBytes, optimizePdfDocument, recompressPdfImages } from '../src/pdfCompression.js'

const toolkit = await createPdfToolkit({ wasmModule: await WebAssembly.compile(await readFile(new URL('../node_modules/pdfstudio/dist/wasm/qpdf.wasm', import.meta.url))) })
const directory = new URL('../tmp/compression-qa/', import.meta.url)
await mkdir(directory, { recursive: true })
const optimize = (data) => optimizePdfDocument(data, { toolkit })
// Text-only documents can be bloated by full embedded fonts repeated on each
// page, unused resources, uncompressed streams and uncompressed dictionaries.
const textOnly = await PDFDocument.create()
textOnly.registerFontkit(fontkit)
const fontBytes = await readFile('/System/Library/Fonts/Supplemental/Arial.ttf')
for (let number = 1; number <= 6; number += 1) {
  const font = await textOnly.embedFont(fontBytes)
  const page = textOnly.addPage([600, 800])
  for (let line = 0; line < 35; line += 1) page.drawText(`Page ${number}, line ${line + 1}: selectable text without images.`, { x: 40, y: 740 - line * 18, size: 11, font })
}
const textSource = await textOnly.save({ useObjectStreams: false })
const textResult = await compressPdfBytes(textSource, { optimize })
assert.ok(textResult.data.byteLength < textSource.byteLength * 0.4, 'Duplicate embedded font programs should be consolidated')
assert.equal(textResult.changedImages, 0)
const originalTask = pdfjs.getDocument({ data: textSource.slice(), useSystemFonts: true })
const outputTask = pdfjs.getDocument({ data: textResult.data.slice(), useSystemFonts: true })
const [originalDoc, outputDoc] = await Promise.all([originalTask.promise, outputTask.promise])
assert.equal(outputDoc.numPages, 6)
for (let page = 1; page <= 6; page += 1) {
  const before = await (await originalDoc.getPage(page)).getTextContent()
  const after = await (await outputDoc.getPage(page)).getTextContent()
  assert.deepEqual(after.items.map((item) => item.str), before.items.map((item) => item.str))
}
await Promise.all([originalTask.destroy(), outputTask.destroy()])
await writeFile(new URL('text-only-source.pdf', directory), textSource)
await writeFile(new URL('text-only-compressed.pdf', directory), textResult.data)
console.log(`Text-only PDF with repeated embedded fonts: ${textSource.byteLength} -> ${textResult.data.byteLength} bytes (${(100 * (1 - textResult.data.byteLength / textSource.byteLength)).toFixed(1)}% smaller); all 6 pages of text retained`)
const uncompressed = await toolkit.raw([textSource], ['--stream-data=uncompress', '--object-streams=disable', '$in0', '$out'])
const repacked = await compressPdfBytes(uncompressed, { optimize })
assert.ok(repacked.data.byteLength < uncompressed.byteLength * 0.4)
console.log(`Uncompressed text-only PDF: ${uncompressed.byteLength} -> ${repacked.data.byteLength} bytes`)
const picture = createCanvas(2400, 3200)
const ctx = picture.getContext('2d')
const pixels = ctx.createImageData(picture.width, picture.height)
let seed = 12345
for (let i = 0; i < pixels.data.length; i += 4) {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
  const noise = seed % 24
  pixels.data[i] = 220 + noise
  pixels.data[i + 1] = 215 + noise
  pixels.data[i + 2] = 205 + noise
  pixels.data[i + 3] = 255
}
ctx.putImageData(pixels, 0, 0)
ctx.fillStyle = '#222'
ctx.font = '64px Arial'
ctx.fillText('Scan compression fixture', 150, 220)
for (let i = 0; i < 28; i += 1) {
  ctx.font = '32px Arial'
  ctx.fillText(`Line ${i + 1}: readable scanned content for compression verification.`, 150, 400 + i * 85)
}

for (const encoding of ['jpeg', 'png']) {
  const pdf = await PDFDocument.create()
  const image = encoding === 'jpeg' ? await pdf.embedJpg(picture.toBuffer('image/jpeg', 98)) : await pdf.embedPng(picture.toBuffer('image/png'))
  const page = pdf.addPage([600, 800])
  page.drawImage(image, { x: 0, y: 0, width: 600, height: 800 })
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  page.drawText('Selectable text survives compression', { x: 30, y: 770, size: 14, font })
  const link = pdf.context.register(pdf.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [30, 750, 300, 780], A: { S: 'URI', URI: PDFString.of('https://example.com') } }))
  page.node.addAnnot(link)
  const field = pdf.getForm().createTextField('name')
  field.setText('Preserved form value')
  field.addToPage(page, { x: 30, y: 20, width: 220, height: 24 })
  const source = await pdf.save()
  await writeFile(new URL(`${encoding}-source.pdf`, directory), source)
  let previousSize = Infinity
  for (const [level, quality, maxDimension] of [['light', 0.86, 2800], ['recommended', 0.68, 2000], ['extreme', 0.42, 1400]]) {
    const result = await compressPdfBytes(source, {
      optimize,
      recompressImages: (data) => recompressPdfImages(data, { quality, maxDimension, createCanvas, decodeJpeg: loadImage, encodeJpeg: async (canvas, quality) => canvas.toBuffer('image/jpeg', Math.round(quality * 100)) }),
    })
    assert.ok(result.reduced, `${encoding}/${level} should reduce the fixture`)
    assert.equal(result.changedImages, 1)
    assert.ok(result.data.byteLength < source.byteLength * 0.5, 'Image-heavy fixtures should shrink substantially')
    assert.ok(result.data.byteLength <= previousSize, 'Stronger presets should yield smaller fixture output')
    previousSize = result.data.byteLength
    const reopened = await PDFDocument.load(result.data)
    assert.equal(reopened.getPageCount(), 1)
    assert.equal(reopened.getForm().getTextField('name').getText(), 'Preserved form value')
    assert.equal(reopened.getPages()[0].node.Annots().size(), 2)
    const annotation = reopened.getPages()[0].node.Annots().lookup(0)
    assert.equal(annotation.lookup(PDFName.of('A')).lookup(PDFName.of('URI')).decodeText(), 'https://example.com')
    const loading = pdfjs.getDocument({ data: result.data.slice(), useSystemFonts: true })
    const loaded = await loading.promise
    const text = await (await loaded.getPage(1)).getTextContent()
    assert.ok(text.items.some((item) => item.str === 'Selectable text survives compression'))
    await loading.destroy()
    await writeFile(new URL(`${encoding}-${level}.pdf`, directory), result.data)
    console.log(`${encoding}/${level}: ${source.byteLength} -> ${result.data.byteLength} bytes (${(100 * (1 - result.data.byteLength / source.byteLength)).toFixed(1)}% smaller); text, links and form retained`)
  }
}
// A compact PDF must never grow or be returned as a rasterized page.
const tiny = await PDFDocument.create()
tiny.addPage([300, 300]).drawText('Small text PDF')
const source = await tiny.save()
const result = await compressPdfBytes(source, { optimize, recompressImages: (data) => recompressPdfImages(data, { createCanvas, decodeJpeg: loadImage, encodeJpeg: async (canvas, quality) => canvas.toBuffer('image/jpeg', Math.round(quality * 100)) }) })
assert.ok(result.data.byteLength <= source.byteLength)
assert.equal(result.changedImages, 0)
console.log(`Compact text PDF: ${source.byteLength} -> ${result.data.byteLength} bytes; no rasterization`)

// Adaptive selection keeps the smallest complete PDF, stops at the target,
// and evaluates each quality setting against original bytes.
const adaptiveSource = new Uint8Array(1000)
const attempts = []
const adaptive = await compressPdfBytes(adaptiveSource, {
  targetReduction: 0.7,
  imagePasses: [{ size: 700 }, { size: 280 }, { size: 200 }],
  optimize: async (data) => data,
  recompressImages: async (data, settings) => {
    assert.equal(data, adaptiveSource)
    attempts.push(settings.size)
    return { data: new Uint8Array(settings.size), changed: 1 }
  },
})
assert.deepEqual(attempts, [700, 280])
assert.equal(adaptive.targetMet, true)
assert.equal(adaptive.originalSize, 1000)
assert.equal(adaptive.compressedSize, 280)
assert.equal(adaptive.reduction, 0.72)
const limited = await compressPdfBytes(adaptiveSource, {
  targetReduction: 0.7,
  imagePasses: [{ size: 600 }, { size: 800 }, { size: 1100 }],
  optimize: async (data) => data,
  recompressImages: async (_, settings) => ({ data: new Uint8Array(settings.size), changed: 1 }),
})
assert.equal(limited.compressedSize, 600)
assert.equal(limited.targetMet, false)
console.log('Adaptive compression: stops at 70% target; retains smallest output when target is unattainable')

// Encode scan pixels with TIFF prediction and each PNG row filter. Assert the
// exact decoded colors passed to JPEG, catching silent corruption before lossy encoding.
const width = 128, height = 96
for (const channels of [1, 3]) for (const predictor of [2, 15]) {
  const pixels = new Uint8Array(width * height * channels)
  let noiseSeed = 47
  for (let i = 0; i < pixels.length; i += 1) {
    noiseSeed = (Math.imul(noiseSeed, 1664525) + 1013904223) >>> 0
    pixels[i] = noiseSeed >>> 24
  }
  const stride = width * channels
  const encoded = new Uint8Array((stride + (predictor === 15 ? 1 : 0)) * height)
  for (let row = 0; row < height; row += 1) {
    const filter = predictor === 2 ? 1 : row % 5
    const start = row * (stride + (predictor === 15 ? 1 : 0))
    if (predictor === 15) encoded[start] = filter
    for (let col = 0; col < stride; col += 1) {
      const offset = row * stride + col
      const left = col >= channels ? pixels[offset - channels] : 0
      const above = row ? pixels[offset - stride] : 0
      const upperLeft = row && col >= channels ? pixels[offset - stride - channels] : 0
      let prediction = 0
      if (filter === 1) prediction = left
      if (filter === 2) prediction = above
      if (filter === 3) prediction = Math.floor((left + above) / 2)
      if (filter === 4) {
        const p = left + above - upperLeft
        const distances = [Math.abs(p - left), Math.abs(p - above), Math.abs(p - upperLeft)]
        prediction = [left, above, upperLeft][distances.indexOf(Math.min(...distances))]
      }
      encoded[start + col + (predictor === 15 ? 1 : 0)] = pixels[offset] - prediction
    }
  }
  const pdf = await PDFDocument.create()
  const image = pdf.context.flateStream(encoded, {
    Type: 'XObject', Subtype: 'Image', Width: width, Height: height,
    BitsPerComponent: 8, ColorSpace: channels === 3 ? 'DeviceRGB' : 'DeviceGray',
    DecodeParms: { Predictor: predictor, Columns: width, Colors: channels, BitsPerComponent: 8 },
  })
  // Single-element filter/parameter arrays also occur in producer output.
  if (predictor === 15) {
    image.dict.set(PDFName.of('Filter'), pdf.context.obj(['FlateDecode']))
    image.dict.set(PDFName.of('DecodeParms'), pdf.context.obj([image.dict.get(PDFName.of('DecodeParms'))]))
  }
  const ref = pdf.context.register(image)
  const page = pdf.addPage([width, height])
  page.node.set(PDFName.of('Resources'), pdf.context.obj({ XObject: { Scan: ref } }))
  page.node.set(PDFName.of('Contents'), pdf.context.register(pdf.context.flateStream(`q ${width} 0 0 ${height} 0 0 cm /Scan Do Q`)))
  const scanSource = await pdf.save()
  let verified = false
  const result = await recompressPdfImages(scanSource, {
    maxDimension: width,
    createCanvas, decodeJpeg: loadImage,
    encodeJpeg: async (canvas) => {
      const actual = canvas.getContext('2d').getImageData(0, 0, width, height).data
      for (let pixel = 0; pixel < width * height; pixel += 1) for (let channel = 0; channel < 3; channel += 1) {
        assert.equal(actual[pixel * 4 + channel], pixels[pixel * channels + (channels === 3 ? channel : 0)])
      }
      verified = true
      return canvas.toBuffer('image/jpeg', 42)
    },
  })
  assert.equal(verified, true, `Predictor ${predictor}/${channels} must be decoded`)
  assert.equal(result.changed, 1)
  const reopened = await PDFDocument.load(result.data)
  assert.equal(reopened.getPageCount(), 1)
  await writeFile(new URL(`predictor-${predictor}-${channels}.pdf`, directory), result.data)
}
console.log('TIFF and PNG scan predictors (RGB and grayscale): exact pixel reconstruction verified')

// Recompress transparent image colors without altering alpha or its pixel grid.
const transparent = createCanvas(400, 400)
const transparentCtx = transparent.getContext('2d')
const transparentPixels = transparentCtx.createImageData(400, 400)
for (let i = 0; i < transparentPixels.data.length; i += 4) {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
  transparentPixels.data[i] = seed >>> 24
  transparentPixels.data[i + 1] = (seed >>> 16) & 255
  transparentPixels.data[i + 2] = (seed >>> 8) & 255
  transparentPixels.data[i + 3] = 128 + ((i / 4) % 64)
}
transparentCtx.putImageData(transparentPixels, 0, 0)
const transparentPdf = await PDFDocument.create()
const transparentImage = await transparentPdf.embedPng(transparent.toBuffer('image/png'))
transparentPdf.addPage([400, 400]).drawImage(transparentImage, { x: 0, y: 0, width: 400, height: 400 })
const transparentSource = await transparentPdf.save()
const beforeTransparent = await PDFDocument.load(transparentSource)
const imageBefore = beforeTransparent.context.enumerateIndirectObjects().find(([, object]) => object.dict?.has(PDFName.of('SMask')))[1]
const alphaBefore = imageBefore.dict.lookup(PDFName.of('SMask')).getContents()
const transparentResult = await recompressPdfImages(transparentSource, { maxDimension: 100, quality: 0.42, createCanvas, decodeJpeg: loadImage, encodeJpeg: async (canvas) => canvas.toBuffer('image/jpeg', 42) })
assert.equal(transparentResult.changed, 1)
const afterTransparent = await PDFDocument.load(transparentResult.data)
const imageAfter = afterTransparent.context.enumerateIndirectObjects().find(([, object]) => object.dict?.has(PDFName.of('SMask')))[1]
assert.equal(imageAfter.dict.lookup(PDFName.of('Width')).asNumber(), 400)
assert.equal(imageAfter.dict.lookup(PDFName.of('Height')).asNumber(), 400)
assert.deepEqual(imageAfter.dict.lookup(PDFName.of('SMask')).getContents(), alphaBefore)
await writeFile(new URL('transparent-compressed.pdf', directory), transparentResult.data)
console.log('Transparent image: color compressed; alpha bytes and original pixel grid preserved')

// Missing the target must never cause text pages to become images.
const nativeResult = await compressPdfBytes(textResult.data, {
  optimize, targetReduction: 0.7, imagePasses: [{ quality: 0.32, maxDimension: 1100 }],
  recompressImages: (data, settings) => recompressPdfImages(data, { ...settings, createCanvas, decodeJpeg: loadImage, encodeJpeg: async (canvas, quality) => canvas.toBuffer('image/jpeg', Math.round(quality * 100)) }),
})
assert.equal(nativeResult.targetMet, false)
assert.equal(nativeResult.changedImages, 0)
const nativeTask = pdfjs.getDocument({ data: nativeResult.data.slice(), useSystemFonts: true })
const nativeDoc = await nativeTask.promise
assert.equal(nativeDoc.numPages, 6)
for (let page = 1; page <= 6; page += 1) {
  const text = await (await nativeDoc.getPage(page)).getTextContent()
  assert.ok(text.items.some(item => item.str.includes(`Page ${page}, line 1: selectable text without images.`)))
}
await nativeTask.destroy()
console.log('Unattainable 70% target: all 6 pages retain selectable/searchable text; no page rasterization')

// Renderer-backed image decoding must preserve transparency while downscaling
// both color and alpha, without changing the native text/page structure.
const decodePdfImage = async (bytes, scale) => {
  const task = pdfjs.getDocument({ data: bytes, wasmUrl: new URL('../node_modules/pdfjs-dist/wasm/', import.meta.url).pathname, stopAtErrors: true })
  try {
    const doc = await task.promise
    const page = await doc.getPage(1)
    const viewport = page.getViewport({ scale })
    const canvas = createCanvas(Math.max(1, Math.round(viewport.width)), Math.max(1, Math.round(viewport.height)))
    await page.render({ canvas: null, canvasContext: canvas.getContext('2d', { alpha: true }), viewport, background: 'rgba(0,0,0,0)' }).promise
    return canvas
  } finally { await task.destroy() }
}
const scaledTransparent = await recompressPdfImages(transparentSource, {
  quality: 0.42, maxDimension: 100, createCanvas, decodeJpeg: loadImage, decodePdfImage,
  encodeJpeg: async (canvas) => canvas.toBuffer('image/jpeg', 42),
})
assert.equal(scaledTransparent.changed, 1)
assert.equal(scaledTransparent.skippedImages, 0)
const scaledPdf = await PDFDocument.load(scaledTransparent.data)
assert.equal(scaledPdf.getPageCount(), 1)
const scaledImage = scaledPdf.context.enumerateIndirectObjects().find(([, object]) => object.dict?.has(PDFName.of('SMask')))[1]
const scaledMask = scaledImage.dict.lookup(PDFName.of('SMask'))
assert.equal(scaledImage.dict.lookup(PDFName.of('Width')).asNumber(), 100)
assert.equal(scaledMask.dict.lookup(PDFName.of('Width')).asNumber(), 100)
assert.equal(scaledMask.dict.lookup(PDFName.of('Height')).asNumber(), 100)
const scaledAlpha = (await import('pdf-lib')).decodePDFRawStream(scaledMask).decode()
assert.ok(scaledAlpha.some(value => value > 0 && value < 255), 'Transparency must not be flattened')
console.log('Renderer image compression: transparency preserved; image and opacity mask scaled together')

// Font conversion is optional and must not run on interactive form documents.
const { optimizePdfType1Fonts } = await import('../src/pdfCompression.js')
const guardedForm = await PDFDocument.create()
guardedForm.addPage([300, 300])
guardedForm.getForm().createTextField('native-field').setText('Still editable')
const formBytes = await guardedForm.save()
const guarded = await optimizePdfType1Fonts(formBytes, async () => { throw Error('Form font conversion must not run') })
assert.equal(guarded.changed, 0)
assert.equal((await PDFDocument.load(guarded.data)).getForm().getTextField('native-field').getText(), 'Still editable')
const marginal = await compressPdfBytes(new Uint8Array(10000), { optimize: async () => new Uint8Array(9999) })
assert.equal(marginal.reduced, false)
assert.equal(marginal.compressedSize, 10000)
console.log('Interactive forms skip font subsetting; negligible byte savings do not claim 0.0% compression')
