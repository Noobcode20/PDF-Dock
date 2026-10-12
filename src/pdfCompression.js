import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, PDFRef, decodePDFRawStream } from 'pdf-lib'

const name = (value) => PDFName.of(value)

// pdf-lib inflates image bytes but does not undo TIFF/PNG row prediction.
// Scanners and PDF producers commonly use these predictors for lossless images.
function undoImagePredictor(bytes, params, width, height, channels) {
  const predictor = params?.lookup?.(name('Predictor'))?.asNumber?.() || 1
  if (predictor === 1) return bytes
  const columns = params?.lookup?.(name('Columns'))?.asNumber?.() || 1
  const colors = params?.lookup?.(name('Colors'))?.asNumber?.() || 1
  const bits = params?.lookup?.(name('BitsPerComponent'))?.asNumber?.() || 8
  if (columns !== width || colors !== channels || bits !== 8) throw new Error('Unsupported image predictor layout')
  const stride = width * channels
  if (predictor === 2 && bytes.length === stride * height) {
    const pixels = bytes.slice()
    for (let row = 0; row < height; row += 1) {
      for (let col = channels; col < stride; col += 1) pixels[row * stride + col] += pixels[row * stride + col - channels]
    }
    return pixels
  }
  if (predictor < 10 || predictor > 15 || bytes.length !== (stride + 1) * height) throw new Error('Unsupported image predictor')
  const pixels = new Uint8Array(stride * height)
  for (let row = 0; row < height; row += 1) {
    const filter = bytes[row * (stride + 1)]
    if (filter > 4) throw new Error('Invalid PNG row filter')
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
        const a = Math.abs(p - left), b = Math.abs(p - above), c = Math.abs(p - upperLeft)
        prediction = a <= b && a <= c ? left : b <= c ? above : upperLeft
      }
      pixels[offset] = bytes[row * (stride + 1) + col + 1] + prediction
    }
  }
  return pixels
}

// qpdf compresses text/content and embedded-font streams, packs dictionaries
// into object streams, removes unused resources and drops unreachable objects.
const documentCompressionArgs = ['--compress-streams=y', '--recompress-flate', '--compression-level=9', '--object-streams=generate', '--remove-unreferenced-resources=yes', '--coalesce-contents', '$in0', '$out']

async function deduplicateStreams(source, onProgress) {
  const pdf = await PDFDocument.load(source, { updateMetadata: false })
  const streams = pdf.context.enumerateIndirectObjects().filter(([, object]) => object instanceof PDFRawStream)
  const known = new Map()
  const replacements = new Map()
  for (let index = 0; index < streams.length; index += 1) {
    const [ref, stream] = streams[index]
    // Match both bytes and semantics. Identical font programs, content streams,
    // and resources can share one object without changing their appearance.
    const dictionary = stream.dict.entries().filter(([key]) => key !== name('Length')).sort(([a], [b]) => a.toString().localeCompare(b.toString())).map(([key, value]) => `${key.toString()} ${value.toString()}`).join('\n')
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', stream.getContents()))
    const key = `${dictionary}\n${Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('')}`
    const existing = known.get(key)
    if (existing) replacements.set(ref, existing)
    else known.set(key, ref)
    onProgress?.({ value: (index + 1) / Math.max(1, streams.length), message: `Optimizing document resource ${index + 1} of ${streams.length}` })
  }
  if (!replacements.size) return source
  const visited = new Set()
  const rewrite = (object) => {
    if (object instanceof PDFRef) return replacements.get(object) || object
    if (visited.has(object)) return object
    visited.add(object)
    if (object instanceof PDFRawStream) rewrite(object.dict)
    else if (object instanceof PDFDict) for (const [key, value] of object.entries()) object.set(key, rewrite(value))
    else if (object instanceof PDFArray) for (let index = 0; index < object.size(); index += 1) object.set(index, rewrite(object.get(index)))
    return object
  }
  for (const [, object] of pdf.context.enumerateIndirectObjects()) rewrite(object)
  // The next qpdf pass removes the now-unreferenced duplicate objects.
  return pdf.save({ useObjectStreams: true })
}

export async function optimizePdfDocument(source, { toolkit, onProgress } = {}) {
  const optimized = await toolkit.raw([source], documentCompressionArgs)
  const deduplicated = await deduplicateStreams(optimized, onProgress)
  if (deduplicated === optimized) return optimized
  const packed = await toolkit.raw([deduplicated], documentCompressionArgs)
  return packed.byteLength < optimized.byteLength ? packed : optimized
}

// Transfer only compact Type 1 font programs. All page content, encodings,
// ToUnicode maps, destinations, annotations, and document dictionaries remain
// from the source. The native writer's rewritten pages are never used.
export async function optimizePdfType1Fonts(source, convertFonts) {
  const pdf = await PDFDocument.load(source, { updateMetadata: false })
  // Interactive forms may need glyphs that are not currently visible.
  if (pdf.catalog.has(name('AcroForm'))) return { data: source, changed: 0 }
  const descriptors = pdf.context.enumerateIndirectObjects().map(([, object]) => object).filter((object) => object instanceof PDFDict && object.has(name('FontFile')))
  if (!descriptors.length) return { data: source, changed: 0 }
  const convertedBytes = await convertFonts(source)
  if (!convertedBytes) return { data: source, changed: 0 }
  const converted = await PDFDocument.load(convertedBytes, { updateMetadata: false })
  const fontName = (dict) => dict.lookup(name('FontName'))?.decodeText?.()?.replace(/^[A-Z]{6}\+/, '')
  const sourceNames = new Map()
  for (const descriptor of descriptors) {
    const key = fontName(descriptor)
    sourceNames.set(key, (sourceNames.get(key) || 0) + 1)
  }
  const fonts = new Map()
  for (const [, descriptor] of converted.context.enumerateIndirectObjects()) {
    if (!(descriptor instanceof PDFDict) || !descriptor.has(name('FontFile3'))) continue
    const stream = descriptor.lookup(name('FontFile3'))
    if (!(stream instanceof PDFRawStream) || stream.dict.lookup(name('Subtype')) !== name('Type1C')) continue
    const key = fontName(descriptor)
    if (!key) continue
    // Ambiguous subsets must not replace a font with a different glyph set.
    fonts.set(key, fonts.has(key) ? null : stream)
  }
  let changed = 0
  for (const descriptor of descriptors) {
    const key = fontName(descriptor)
    if (sourceNames.get(key) !== 1) continue
    const compact = fonts.get(key)
    if (!compact) continue
    const replacement = pdf.context.flateStream(decodePDFRawStream(compact).decode(), { Subtype: 'Type1C' })
    if (replacement.getContents().byteLength >= descriptor.lookup(name('FontFile')).getContents().byteLength) continue
    descriptor.delete(name('FontFile'))
    descriptor.set(name('FontFile3'), pdf.context.register(replacement))
    changed += 1
  }
  return { data: changed ? await pdf.save({ useObjectStreams: true }) : source, changed }
}

// Replace image streams at their existing references. Page content, text,
// annotations, links, and forms stay in the document rather than being rendered.
export async function recompressPdfImages(source, { quality = 0.68, maxDimension = 2000, createCanvas, decodeJpeg, decodePdfImage, encodeJpeg, onProgress } = {}) {
  const pdf = await PDFDocument.load(source, { updateMetadata: false })
  const images = pdf.context.enumerateIndirectObjects().filter(([, object]) => object instanceof PDFRawStream && object.dict.lookup(name('Subtype')) === name('Image'))
  const masks = new Set(images.flatMap(([, image]) => ['SMask', 'Mask'].map((key) => image.dict.lookup(name(key))).filter((mask) => mask instanceof PDFRawStream)))
  let changed = 0
  let skippedImages = 0
  for (let index = 0; index < images.length; index += 1) {
    const [ref, image] = images[index]
    const dict = image.dict
    const width = dict.lookup(name('Width'))?.asNumber?.()
    const height = dict.lookup(name('Height'))?.asNumber?.()
    const colorSpace = dict.lookup(name('ColorSpace'))
    const channels = colorSpace === name('DeviceRGB') ? 3 : colorSpace === name('DeviceGray') ? 1 : 0
    // Opacity masks are handled with their parent image. Unsupported large
    // images and stencils stay intact rather than risking appearance changes.
    if (masks.has(image)) continue
    if (!width || !height || width * height > 40_000_000 || dict.has(name('ImageMask'))) { skippedImages += 1; continue }
    const needsPdfDecoder = !channels || dict.lookup(name('BitsPerComponent'))?.asNumber?.() !== 8 || ['Mask', 'Decode'].some((key) => dict.has(name(key))) || (decodePdfImage && dict.has(name('SMask')))
    if (needsPdfDecoder && !decodePdfImage) { skippedImages += 1; continue }
    let decoded
    try {
      const filters = dict.lookup(name('Filter'))
      const filter = filters instanceof PDFArray && filters.size() === 1 ? filters.lookup(0) : filters
      if (decodePdfImage && (needsPdfDecoder || (filter && filter !== name('DCTDecode') && filter !== name('FlateDecode')))) {
        // Let the PDF renderer resolve color profiles, unusual image encodings,
        // decode maps, and transparency. Only this XObject is rendered.
        const page = pdf.addPage([width, height])
        page.node.set(name('Resources'), pdf.context.obj({ XObject: { Image: ref } }))
        page.node.set(name('Contents'), pdf.context.register(pdf.context.flateStream(`q ${width} 0 0 ${height} 0 0 cm /Image Do Q`)))
        try {
          const isolated = await PDFDocument.create()
          const [copy] = await isolated.copyPages(pdf, [pdf.getPageCount() - 1])
          isolated.addPage(copy)
          decoded = await decodePdfImage(await isolated.save(), Math.min(1, maxDimension / Math.max(width, height)))
        } finally {
          pdf.removePage(pdf.getPageCount() - 1)
        }
      } else if (filter === name('DCTDecode')) decoded = await decodeJpeg(image.getContents())
      else if (!filter || filter === name('FlateDecode')) {
        const parameters = dict.lookup(name('DecodeParms'))
        const params = parameters instanceof PDFArray ? parameters.lookup(0) : parameters
        const pixels = undoImagePredictor(decodePDFRawStream(image).decode(), params, width, height, channels)
        if (pixels.length !== width * height * channels) continue
        const canvas = createCanvas(width, height)
        const ctx = canvas.getContext('2d')
        const rgba = ctx.createImageData(width, height)
        for (let pixel = 0; pixel < width * height; pixel += 1) {
          rgba.data[pixel * 4] = pixels[pixel * channels]
          rgba.data[pixel * 4 + 1] = pixels[pixel * channels + (channels === 3 ? 1 : 0)]
          rgba.data[pixel * 4 + 2] = pixels[pixel * channels + (channels === 3 ? 2 : 0)]
          rgba.data[pixel * 4 + 3] = 255
        }
        ctx.putImageData(rgba, 0, 0)
        decoded = canvas
      } else continue
      // Keep the original pixel grid when a separate transparency mask uses it.
      const scale = dict.has(name('SMask')) && !decodePdfImage ? 1 : Math.min(1, maxDimension / Math.max(width, height))
      const targetWidth = Math.max(1, Math.round(width * scale))
      const targetHeight = Math.max(1, Math.round(height * scale))
      const canvas = createCanvas(targetWidth, targetHeight)
      const ctx = canvas.getContext('2d')
      ctx.drawImage(decoded, 0, 0, targetWidth, targetHeight)
      const rgba = ctx.getImageData(0, 0, targetWidth, targetHeight)
      const rgb = new Uint8Array(targetWidth * targetHeight * 3)
      const alpha = new Uint8Array(targetWidth * targetHeight)
      let transparent = false
      for (let pixel = 0; pixel < alpha.length; pixel += 1) {
        rgb.set(rgba.data.subarray(pixel * 4, pixel * 4 + 3), pixel * 3)
        alpha[pixel] = rgba.data[pixel * 4 + 3]
        transparent ||= alpha[pixel] !== 255
        // JPEG must encode straight RGB; opacity is stored in the PDF mask.
        rgba.data[pixel * 4 + 3] = 255
      }
      ctx.putImageData(rgba, 0, 0)
      const jpeg = await encodeJpeg(canvas, quality)
      const lossless = pdf.context.flateStream(rgb)
      const useLossless = lossless.getContents().byteLength < jpeg.byteLength
      const bytes = useLossless ? lossless.getContents() : jpeg
      const alphaStream = transparent ? pdf.context.flateStream(alpha, { Type: 'XObject', Subtype: 'Image', Width: targetWidth, Height: targetHeight, ColorSpace: 'DeviceGray', BitsPerComponent: 8 }) : null
      // Never replace an individual image with a larger encoding.
      const originalMask = dict.lookup(name('SMask'))
      const originalSize = image.getContents().byteLength + (decodePdfImage && originalMask instanceof PDFRawStream ? originalMask.getContents().byteLength : 0)
      if (bytes.byteLength + (alphaStream?.getContents().byteLength || 0) >= originalSize) continue
      const replacement = dict.clone(pdf.context)
      replacement.set(name('Width'), pdf.context.obj(targetWidth))
      replacement.set(name('Height'), pdf.context.obj(targetHeight))
      replacement.set(name('ColorSpace'), name('DeviceRGB'))
      replacement.set(name('Filter'), name(useLossless ? 'FlateDecode' : 'DCTDecode'))
      replacement.set(name('BitsPerComponent'), pdf.context.obj(8))
      replacement.delete(name('DecodeParms'))
      if (decodePdfImage) {
        replacement.delete(name('Decode'))
        replacement.delete(name('Mask'))
        replacement.delete(name('SMask'))
        if (alphaStream) replacement.set(name('SMask'), pdf.context.register(alphaStream))
      }
      replacement.set(name('Length'), pdf.context.obj(bytes.byteLength))
      pdf.context.assign(ref, PDFRawStream.of(replacement, bytes))
      changed += 1
    } catch (error) {
      skippedImages += 1
      console.warn('PDF compression kept an embedded image unchanged:', error?.message || error)
      // Unsupported or malformed image data stays intact; other images can
      // still be optimized. Parsing failures for the document itself propagate.
    } finally {
      decoded?.close?.()
      onProgress?.({ value: (index + 1) / Math.max(1, images.length), message: `Optimizing image ${index + 1} of ${images.length}` })
    }
  }
  return { data: changed ? await pdf.save({ useObjectStreams: true }) : source, changed, skippedImages }
}

export async function compressPdfBytes(source, { optimize, optimizeFonts, recompressImages, targetReduction = 0, imagePasses = [{}] } = {}) {
  // Compare complete PDFs, since rewriting a small PDF can add overhead even
  // when individual image streams shrink.
  let data = source
  let changedImages = 0
  let changedFonts = 0
  let imageSource = source
  let skippedImages = 0
  const optimized = await optimize(source)
  if (optimized.byteLength < data.byteLength) data = optimized
  if (optimizeFonts && (!targetReduction || data.byteLength > source.byteLength * (1 - targetReduction))) {
    const fonts = await optimizeFonts(source)
    if (fonts.changed) {
      const packed = await optimize(fonts.data)
      if (packed.byteLength < data.byteLength) {
        data = packed
        imageSource = packed
        changedFonts = fonts.changed
      }
    }
  }
  if (recompressImages) for (const settings of imagePasses) {
    if (targetReduction > 0 && data.byteLength <= source.byteLength * (1 - targetReduction)) break
    // Each pass starts from the original to avoid repeated JPEG degradation.
    const recompressed = await recompressImages(imageSource, settings)
    skippedImages = recompressed.skippedImages || 0
    if (recompressed.changed) {
      const packed = await optimize(recompressed.data)
      const candidate = packed.byteLength < recompressed.data.byteLength ? packed : recompressed.data
      if (candidate.byteLength < data.byteLength) {
        data = candidate
        changedImages = recompressed.changed
      }
    }
  }
  // A byte-level rewrite saving less than 0.05% rounds to 0.0% in the UI.
  // Keep the source in that case rather than claim a meaningful reduction.
  if (data.byteLength > source.byteLength * 0.9995) { data = source; changedImages = 0; changedFonts = 0 }
  const reduction = source.byteLength ? 1 - data.byteLength / source.byteLength : 0
  return { data, changedImages, changedFonts, skippedImages, reduced: data.byteLength < source.byteLength, originalSize: source.byteLength, compressedSize: data.byteLength, reduction, targetReduction, targetMet: reduction >= targetReduction }
}
