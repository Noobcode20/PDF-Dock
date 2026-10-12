import { PDFDocument, PDFName } from 'pdf-lib'
import { groupPdfLines, inferPdfTables, lineBounds, pdfLineAlignment, isPdfListLine } from './pdfWordLayout.js'

function getPdfWordFont(item, style, embeddedFont) {
  const cssInfo = embeddedFont?.cssFontInfo || {}
  // PDF.js text styles carry the resolved family name, while embedded font
  // object names are often synthetic identifiers such as g_d0_f3.
  const sourceName = (cssInfo.fontFamily || embeddedFont?.name || style?.fontSubstitution?.split(',')[0] || '')
    .replace(/^['"]|['"]$/g, '').replace(/^[A-Z]{6}\+/, '')
  const rawNames = [sourceName, embeddedFont?.name, embeddedFont?.fallbackName].filter(Boolean).join(' ')
  const names = rawNames.toLowerCase()
  // Keep the actual family, including custom embedded fonts. Style metadata's
  // generic serif/sans-serif value is only a fallback, never the first choice.
  let font = sourceName.replace(/[-,](?:bolditalic|boldoblique|semibold|bold|italic|oblique|regular|roman|medium|light).*$/i, '')
  const aliases = { TimesNewRomanPSMT: 'Times New Roman', TimesNewRomanPS: 'Times New Roman', TimesNewRoman: 'Times New Roman',
    ArialMT: 'Arial', Arial: 'Arial', RobotoMono: 'Roboto Mono', CourierNewPSMT: 'Courier New', CourierNewPS: 'Courier New',
    Helvetica: 'Helvetica', Times: 'Times New Roman', Courier: 'Courier New' }
  font = aliases[font] || font
  if (!font || /^(?:g_d\d+_|sans-serif|serif|monospace)/i.test(font)) {
    font = /mono/i.test(style?.fontFamily || '') ? 'Courier New' : style?.fontFamily === 'serif' ? 'Times New Roman' : 'Arial'
  }
  const weight = Number(cssInfo.fontWeight)
  return {
    font,
    bold: Boolean(embeddedFont?.bold || embeddedFont?.black || (Number.isFinite(weight) && weight >= 600) || /bold|black|heavy|demi|semibold/i.test(names)),
    italics: Boolean(embeddedFont?.italic || /italic|oblique|slanted/i.test(names) || Math.abs(Number(cssInfo.italicAngle) || 0) > 0.01),
  }
}

function mergeOverlappingImageBounds(images) {
  const merged = []
  for (const image of images) {
    let bounds = { ...image }
    for (let index = 0; index < merged.length;) {
      const current = merged[index]
      const overlaps = bounds.left < current.right && bounds.right > current.left
        && bounds.bottom < current.top && bounds.top > current.bottom
      if (!overlaps) { index += 1; continue }
      bounds = {
        left: Math.min(bounds.left, current.left), right: Math.max(bounds.right, current.right),
        bottom: Math.min(bounds.bottom, current.bottom), top: Math.max(bounds.top, current.top),
      }
      merged.splice(index, 1)
      index = 0
    }
    merged.push(bounds)
  }
  return merged
}

async function pdfWordGraphics(pdfjs, page, viewport) {
  const { OPS, Util } = pdfjs
  const { fnArray, argsArray } = await page.getOperatorList()
  let state = { fill: '000000', stroke: '000000', width: 1, matrix: [1, 0, 0, 1, 0, 0], strokeAlpha: 1, fillAlpha: 1, clip: null }
  const stack = [], textRuns = [], rules = [], images = []
  let pendingClip = false
  const colorHex = (value) => {
    if (typeof value === 'string') {
      const hex = value.match(/^#?([\da-f]{6})$/i)
      if (hex) return hex[1].toUpperCase()
      const short = value.match(/^#([\da-f]{3})$/i)
      if (short) return [...short[1]].map((c) => c + c).join('').toUpperCase()
      const rgb = value.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i)
      if (rgb) return rgb.slice(1, 4).map((n) => Math.min(255, Number(n)).toString(16).padStart(2, '0')).join('').toUpperCase()
    }
    if (Array.isArray(value) || ArrayBuffer.isView(value)) return Array.from(value).slice(0, 3).map((n) => Math.round(Math.max(0, Math.min(1, n)) * 255).toString(16).padStart(2, '0')).join('').toUpperCase()
    return null
  }
  const point = (x, y) => {
    const transformed = [x, y]
    Util.applyTransform(transformed, Util.transform(viewport.transform, state.matrix))
    const [vx, vy] = transformed
    return [vx, viewport.height - vy]
  }
  const addSegment = (a, b, color, width) => {
    const start = point(...a), end = point(...b)
    if (color === 'FFFFFF') return
    const thickness = width * Math.hypot(state.matrix[0], state.matrix[1]) * viewport.scale
    if (Math.abs(start[1] - end[1]) < 1 && Math.abs(start[0] - end[0]) > 8) rules.push({ axis: 'h', at: (start[1] + end[1]) / 2, start: Math.min(start[0], end[0]), end: Math.max(start[0], end[0]), color, width: thickness })
    else if (Math.abs(start[0] - end[0]) < 1 && Math.abs(start[1] - end[1]) > 8) rules.push({ axis: 'v', at: (start[0] + end[0]) / 2, start: Math.min(start[1], end[1]), end: Math.max(start[1], end[1]), color, width: thickness })
  }
  for (let index = 0; index < fnArray.length; index += 1) {
    const op = fnArray[index], args = argsArray[index] || []
    if (op === OPS.save || op === OPS.paintFormXObjectBegin) {
      stack.push({ ...state, matrix: [...state.matrix], clip: state.clip && { ...state.clip } })
      if (op === OPS.paintFormXObjectBegin && args[0]) state.matrix = Util.transform(state.matrix, args[0])
    } else if (op === OPS.restore || op === OPS.paintFormXObjectEnd) state = stack.pop() || state
    else if (op === OPS.transform) state.matrix = Util.transform(state.matrix, args)
    else if (op === OPS.setLineWidth) state.width = args[0]
    else if (op === OPS.setFillRGBColor) state.fill = colorHex(args[0]) || state.fill
    else if (op === OPS.setStrokeRGBColor) state.stroke = colorHex(args[0]) || state.stroke
    else if (op === OPS.setGState) {
      for (const [key, value] of args[0] || []) {
        if (key === 'CA') state.strokeAlpha = value
        if (key === 'ca') state.fillAlpha = value
        if (key === 'LW') state.width = value
      }
    } else if (op === OPS.clip || op === OPS.eoClip) pendingClip = true
    else if (op === OPS.showText || op === OPS.showSpacedText || op === OPS.nextLineShowText || op === OPS.nextLineSetSpacingShowText) {
      const glyphs = args.find((value) => Array.isArray(value)) || []
      const text = glyphs.map((glyph) => typeof glyph === 'string' ? glyph : glyph?.unicode || '').join('')
      if (text) textRuns.push({ text, color: state.fill })
    } else if (op === OPS.paintImageXObject || op === OPS.paintInlineImageXObject) {
      const corners = [point(0, 0), point(0, 1), point(1, 0), point(1, 1)]
      let bounds = {
        left: Math.min(...corners.map(([x]) => x)), right: Math.max(...corners.map(([x]) => x)),
        bottom: Math.min(...corners.map(([, y]) => y)), top: Math.max(...corners.map(([, y]) => y)),
      }
      // PDF image XObjects are often larger than their visible crop. Intersect
      // their transformed bounds with the active clipping region so the DOCX
      // extent matches the visible image, rather than the hidden source bitmap.
      if (state.clip) bounds = {
        left: Math.max(bounds.left, state.clip.left), right: Math.min(bounds.right, state.clip.right),
        bottom: Math.max(bounds.bottom, state.clip.bottom), top: Math.min(bounds.top, state.clip.top),
      }
      if (bounds.right - bounds.left > 2 && bounds.top - bounds.bottom > 2) images.push(bounds)
    } else if (op === OPS.constructPath) {
      const [paint, data, bounds] = args
      if (pendingClip) {
        pendingClip = false
        if (bounds) {
          const corners = [point(bounds[0], bounds[1]), point(bounds[2], bounds[3])]
          const pathBounds = {
            left: Math.min(...corners.map(([x]) => x)), right: Math.max(...corners.map(([x]) => x)),
            bottom: Math.min(...corners.map(([, y]) => y)), top: Math.max(...corners.map(([, y]) => y)),
          }
          state.clip = state.clip ? {
            left: Math.max(state.clip.left, pathBounds.left), right: Math.min(state.clip.right, pathBounds.right),
            bottom: Math.max(state.clip.bottom, pathBounds.bottom), top: Math.min(state.clip.top, pathBounds.top),
          } : pathBounds
        }
      }
      const stroked = [OPS.stroke, OPS.closeStroke, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke].includes(paint)
      if (stroked && state.strokeAlpha > 0) {
        const path = data?.[0]
        if (!ArrayBuffer.isView(path) && !Array.isArray(path)) continue
        let cursor, origin
        for (let i = 0; i < path.length;) {
          const command = path[i++]
          if (command === 0) { cursor = [path[i++], path[i++]]; origin = cursor }
          else if (command === 1) { const next = [path[i++], path[i++]]; if (cursor) addSegment(cursor, next, state.stroke, state.width); cursor = next }
          else if (command === 2) { i += 4; cursor = [path[i++], path[i++]] }
          else if (command === 3) { i += 2; cursor = [path[i++], path[i++]] }
          else if (command === 4 && cursor && origin) { addSegment(cursor, origin, state.stroke, state.width); cursor = origin }
          else break
        }
      } else if ([OPS.fill, OPS.eoFill].includes(paint) && bounds && state.fillAlpha > 0) {
        // Some producers draw rules as thin filled rectangles.
        const [x0, y0, x1, y1] = bounds
        if (Math.abs(y1 - y0) <= 2) addSegment([x0, (y0 + y1) / 2], [x1, (y0 + y1) / 2], state.fill, Math.abs(y1 - y0))
        else if (Math.abs(x1 - x0) <= 2) addSegment([(x0 + x1) / 2, y0], [(x0 + x1) / 2, y1], state.fill, Math.abs(x1 - x0))
      }
    }
  }
  return { textRuns, rules, images: mergeOverlappingImageBounds(images) }
}

function applyPdfWordColors(items, runs) {
  const characters = [], colors = []
  for (const run of runs) for (const char of run.text.normalize('NFKC')) if (!/\s/.test(char)) { characters.push(char); colors.push(run.color) }
  const painted = characters.join('')
  let cursor = 0
  for (const item of items) {
    const needle = item.str.normalize('NFKC').replace(/\s/g, '')
    const found = painted.indexOf(needle, cursor)
    if (found < 0) { item.__pdfPaintSegments = [{ text: item.str, color: '000000' }]; continue }
    let offset = found
    const segments = []
    for (const char of item.str) {
      const color = colors[Math.min(offset, found + needle.length - 1)] || '000000'
      if (segments.at(-1)?.color === color) segments.at(-1).text += char
      else segments.push({ text: char, color })
      if (!/\s/.test(char)) offset += char.normalize('NFKC').length
    }
    item.__pdfPaintSegments = segments
    cursor = found + needle.length
  }
}

async function pdfWordEmbeddedFonts(file, pageData) {
  const { PDFDict, PDFRawStream, decodePDFRawStream } = await import('pdf-lib')
  const fontkit = (await import('@pdf-lib/fontkit')).default
  const source = await PDFDocument.load(new Uint8Array(await file.arrayBuffer()), { updateMetadata: false })
  const used = new Map()
  for (const page of pageData) for (const item of page.items) {
    const metadata = page.fontMetadata.get(item.fontName)
    if (!metadata?.name) continue
    let entry = used.get(metadata.name)
    if (!entry) used.set(metadata.name, entry = { ...getPdfWordFont(item, page.styles[item.fontName], metadata), text: '', items: [] })
    entry.text += item.str
    entry.items.push(item)
  }
  const fonts = []
  for (const [, object] of source.context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFDict) || object.get(PDFName.of('Type'))?.toString() !== '/FontDescriptor') continue
    const name = object.get(PDFName.of('FontName'))?.decodeText()
    const style = used.get(name)
    if (!style) continue
    // These families ship with Word/Windows/macOS. Embedding separate PDF
    // subsets of their faces can override a complete installed family with
    // an incomplete one in some readers.
    if (/^(Arial|Helvetica|Times New Roman|Georgia|Courier New|Calibri|Cambria|Verdana|Tahoma|Trebuchet MS|Palatino Linotype)$/i.test(style.font)) continue
    const stream = object.lookup(PDFName.of('FontFile2'))
    if (!(stream instanceof PDFRawStream)) continue
    try {
      const data = decodePDFRawStream(stream).decode()
      const parsed = fontkit.create(data)
      const permissions = parsed['OS/2']?.fsType
      if (permissions?.noEmbedding || permissions?.bitmapOnly || permissions?.viewOnly) continue
      // Keep the original Unicode cmap. PDF.js's renderer font bytes remap
      // glyphs to private-use codepoints and cannot be embedded in Word.
      if ([...style.text].some((char) => !/\s/.test(char) && !parsed.hasGlyphForCodePoint(char.codePointAt(0)))) continue
      // Keep regular, bold and italic subsets in their own font-table slots.
      const face = parsed.familyName || style.font
      style.items.forEach((item) => { item.__pdfWordFont = { font: face, bold: style.bold, italics: style.italics } })
      const variant = style.bold ? (style.italics ? 'BoldItalic' : 'Bold') : style.italics ? 'Italic' : 'Regular'
      if (fonts.some((font) => font.name === face && font.variant === variant)) continue
      fonts.push({ name: face, variant, data })
    } catch { /* Unsupported font streams retain their source family name. */ }
  }
  return fonts
}

function pdfWordFontTable(doc, fonts) {
  if (!fonts.length) return []
  const escape = (value) => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char])
  const families = new Map()
  doc.FontTable.fontOptionsWithKey.forEach((font, index) => {
    const variants = families.get(font.name) || []
    variants.push(`<w:embed${fonts[index].variant} r:id="rId${index + 1}" w:fontKey="{${font.fontKey.toUpperCase()}}" w:subsetted="1"/>`)
    families.set(font.name, variants)
  })
  return [{ path: 'word/fontTable.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:fonts xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${[...families].map(([name, variants]) => `<w:font w:name="${escape(name)}">${variants.join('')}</w:font>`).join('')}</w:fonts>` }]
}

function progress(callback, value, message) { if (typeof callback === 'function') callback({ value, message }) }

export async function convertPdfToWord({ pdfjs, pdf, file, options = {}, onProgress, extractTextByPage, renderPage, canvasBlob, createCanvas = () => document.createElement('canvas') }) {
  const { AlignmentType, BorderStyle, Document, ImageRun, HorizontalPositionRelativeFrom, VerticalPositionRelativeFrom, TextWrappingType, Packer, Paragraph, Table, TableCell, TableRow, TableLayoutType, Tab, TabStopType, TextRun, WidthType, XmlComponent } = await import('docx')
  const sections = []
  const pageData = []
  const scannedPages = []
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber)
    const viewport = page.getViewport({ scale: 1 })
    const content = await page.getTextContent()
    const items = content.items.filter((item) => 'str' in item && item.str.trim())
    const { textRuns, rules, images } = await pdfWordGraphics(pdfjs, page, viewport)
    applyPdfWordColors(items, textRuns)
    const styles = content.styles || {}
    const fontMetadata = new Map()
    for (const item of items) {
      if (!fontMetadata.has(item.fontName) && page.commonObjs.has(item.fontName)) {
        try { fontMetadata.set(item.fontName, page.commonObjs.get(item.fontName)) } catch {}
      }
    }
    if (!items.length) scannedPages.push(pageNumber)
    pageData.push({ pageNumber, width: viewport.width, height: viewport.height, items, styles, fontMetadata, viewport, rules, images })
  }

  // Use OCR only for pages with no extractable text layer. OCR output remains
  // normal editable Word text instead of a screenshot of the page.
  let ocrPages = []
  if (scannedPages.length) {
    const extracted = await extractTextByPage(file, options, onProgress)
    ocrPages = scannedPages.map((number) => extracted[number - 1] || [])
  }
  const embeddedFonts = await pdfWordEmbeddedFonts(file, pageData)
  let scannedIndex = 0
  let previousProgress = 0
  for (const pageInfo of pageData) {
    const { pageNumber, width: pageWidth, height: pageHeight, items, styles, fontMetadata, viewport, rules, images } = pageInfo
    let paragraphs = []
    if (items.length) {
      const rows = groupPdfLines(items, viewport)
      const tables = inferPdfTables(rows, rules, pageWidth)
      const tableMembers = new Set(tables.flatMap((table) => table.members))
      const bodyBounds = rows.filter((row) => !tableMembers.has(row) && !isPdfListLine(row))
        .map(lineBounds).filter((bounds) => bounds.right - bounds.left >= pageWidth * 0.5)
      const bodyCenter = bodyBounds.length >= 2
        ? (Math.min(...bodyBounds.map((bounds) => bounds.left)) + Math.max(...bodyBounds.map((bounds) => bounds.right))) / 2 : undefined
      const textRunsFor = (parts, list = false) => {
        const sorted = [...parts].sort((a, b) => a.x - b.x)
        const runs = []
        let endX = sorted[0]?.x || 0
        for (const part of sorted) {
          const gap = part.x - endX
          if (list && sorted.indexOf(part) === 1 && /^\s*(?:\d+[.)]|[a-zA-Z][.)])\s*$/.test(sorted[0].item.str)) runs.push(new TextRun({ children: [new Tab()] }))
          else if (gap > part.fontSize * 0.18) runs.push(new TextRun({ text: ' ' }))
          const fontStyle = part.item.__pdfWordFont || getPdfWordFont(part.item, styles[part.item.fontName] || {}, fontMetadata.get(part.item.fontName))
          for (const segment of part.item.__pdfPaintSegments || [{ text: part.item.str, color: '000000' }]) {
            runs.push(new TextRun({ ...fontStyle, text: segment.text,
              size: Math.max(2, Math.min(1638, Math.round(part.fontSize * 2))), color: segment.color }))
          }
          endX = Math.max(endX, part.x + part.width)
        }
        return runs
      }
      const paragraphForRow = (row, before = 0) => {
        const bounds = lineBounds(row)
        const alignment = isPdfListLine(row) ? AlignmentType.LEFT : pdfLineAlignment(row, 0, pageWidth, bodyCenter)
        const centerOffset = bounds.left + bounds.right - pageWidth
        return new Paragraph({
          alignment,
          indent: alignment === AlignmentType.CENTER
            ? { left: Math.round(Math.max(0, centerOffset) * 20), right: Math.round(Math.max(0, -centerOffset) * 20) }
            : { left: Math.round(Math.max(0, bounds.left) * 20), right: Math.round(Math.max(0, pageWidth - bounds.right - 6) * 20) },
          spacing: { before, after: 0, line: Math.round(row.fontSize * 1.2 * 20), lineRule: 'atLeast' },
          widowControl: false,
          ...(isPdfListLine(row) && row.items.length > 1 ? { tabStops: [{ type: TabStopType.LEFT, position: Math.round(row.items[1].x * 20) }] } : {}),
          children: textRunsFor(row.items, isPdfListLine(row)),
        })
      }
      const noBorder = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }
      const tableFor = (table) => {
        const columnWidths = table.rows[0].map((cell) => Math.max(100, Math.round((cell.right - cell.left) * 20)))
        const cellBorder = (cell, edge) => {
          const horizontal = edge === 'top' || edge === 'bottom'
          const coordinate = cell[edge]
          const start = horizontal ? cell.left : cell.bottom
          const end = horizontal ? cell.right : cell.top
          const rule = table.rules.find((line) => line.axis === (horizontal ? 'h' : 'v')
            && Math.abs(line.at - coordinate) < 3 && line.start <= start + 3 && line.end >= end - 3)
          return rule ? { style: BorderStyle.SINGLE, size: Math.max(1, Math.round(rule.width * 8)), color: rule.color } : noBorder
        }
        const tableRows = table.rows.map((cells) => new TableRow({
          cantSplit: true,
          height: { value: Math.max(1, Math.round((cells[0].top - cells[0].bottom) * 20)), rule: 'atLeast' },
          children: cells.map((cell, column) => {
            const lines = cell.lines
            const runs = []
            for (let index = 0; index < lines.length; index += 1) {
              if (index) runs.push(new TextRun({ break: 1 }))
              runs.push(...textRunsFor(lines[index].items))
            }
            const first = lines[0]
            const alignment = first ? pdfLineAlignment(first, cell.left, cell.right) : AlignmentType.LEFT
            const leftPadding = first ? Math.max(0, Math.min(...lines.map((row) => lineBounds(row).left)) - cell.left) : 0
            const fontSize = first ? Math.max(...lines.flatMap((row) => row.items.map((part) => part.fontSize))) : 9
            const gaps = lines.slice(1).map((row, index) => lines[index].baseline - row.baseline).filter((gap) => gap > fontSize * 0.6)
            const lineHeight = gaps.length ? Math.min(...gaps) : fontSize * 1.2
            return new TableCell({
              width: { size: columnWidths[column], type: WidthType.DXA },
              verticalAlign: 'top',
              margins: { top: 0, bottom: 0, left: alignment === AlignmentType.LEFT ? Math.round(leftPadding * 20) : 0, right: 0 },
              borders: Object.fromEntries(['top', 'bottom', 'left', 'right'].map((edge) => [edge, cellBorder(cell, edge)])),
              children: [new Paragraph({ alignment, spacing: { before: 0, after: 0, line: Math.round(lineHeight * 20), lineRule: 'atLeast' },
                widowControl: false, children: runs.length ? runs : [new TextRun({ text: '', size: Math.round(fontSize * 2) })] })],
            })
          }),
        }))
        return new Table({ rows: tableRows, layout: TableLayoutType.FIXED,
          width: { size: Math.round((table.right - table.left) * 20), type: WidthType.DXA },
          indent: { size: Math.round(table.left * 20), type: WidthType.DXA }, columnWidths,
          borders: Object.fromEntries(['top', 'bottom', 'left', 'right', 'insideHorizontal', 'insideVertical'].map((edge) => [edge, noBorder])),
        })
      }
      // Images in the source (such as code screenshots in class notes)
      // remain images; the surrounding PDF text stays editable.
      const imageBlocks = []
      if (images.length) {
        const scale = 2
        const rendered = await renderPage(pdf, pageNumber, scale)
        for (const image of images) {
          const crop = createCanvas()
          crop.width = Math.max(1, Math.round((image.right - image.left) * scale))
          crop.height = Math.max(1, Math.round((image.top - image.bottom) * scale))
          crop.getContext('2d').drawImage(rendered.canvas, image.left * scale, (pageHeight - image.top) * scale,
            crop.width, crop.height, 0, 0, crop.width, crop.height)
          const blob = await canvasBlob(crop, 'image/png')
          imageBlocks.push({ ...image, image: { data: new Uint8Array(await blob.arrayBuffer()),
            width: image.right - image.left, height: image.top - image.bottom } })
        }
      }
      const blocks = [
        ...rows.filter((row) => !tableMembers.has(row)).map((row) => ({ top: row.baseline + row.fontSize, bottom: row.baseline, row })),
        ...tables.map((table) => ({ top: table.top, bottom: table.bottom, table })),
      ].sort((a, b) => b.top - a.top)
      const children = []
      if (imageBlocks.length) children.push(new Paragraph({
        spacing: { before: 0, after: 0, line: 1, lineRule: 'exact' },
        children: imageBlocks.map((block) => new ImageRun({ type: 'png', data: block.image.data,
          transformation: { width: block.image.width * 96 / 72, height: block.image.height * 96 / 72 },
          floating: { horizontalPosition: { relative: HorizontalPositionRelativeFrom.PAGE, offset: Math.round(block.left * 12700) },
            verticalPosition: { relative: VerticalPositionRelativeFrom.PAGE, offset: Math.round((pageHeight - block.top) * 12700) },
            allowOverlap: true, layoutInCell: false, wrap: { type: TextWrappingType.NONE } },
        })),
      }))
      let previousBottom = pageHeight
      for (const block of blocks) {
        if (block.table) {
          const before = Math.max(0, Math.round((previousBottom - block.top) * 20))
          // Tables have no paragraph spacing property. A small spacer keeps
          // their vertical position without adding an extra table row.
          if (before > 0) children.push(new Paragraph({ spacing: { before: 0, after: 0, line: before, lineRule: 'exact' }, children: [new TextRun({ text: '', size: 2 })] }))
          children.push(tableFor(block.table))
        } else {
          const before = Math.max(0, Math.round((previousBottom - block.row.baseline - block.row.fontSize * 1.2) * 20))
          children.push(paragraphForRow(block.row, before))
        }
        previousBottom = block.bottom
      }
      paragraphs = children
    } else {
      const lines = ocrPages[scannedIndex++] || []
      paragraphs = lines.map((line) => new Paragraph({
        spacing: { before: 0, after: 80 },
        children: [new TextRun({ text: line, font: 'Arial', size: 20 })],
      }))
    }
    if (!paragraphs.length) paragraphs = [new Paragraph('')]
    sections.push({
      properties: {
        page: {
          size: { width: Math.round(pageWidth * 20), height: Math.round(pageHeight * 20) },
          margin: { top: 0, right: 0, bottom: 0, left: 0 },
        },
      },
      children: paragraphs,
    })
    const value = pageNumber / pdf.numPages
    if (value > previousProgress) progress(onProgress, value, `Rebuilding editable text on page ${pageNumber} of ${pdf.numPages}`)
    previousProgress = value
  }
  const doc = new Document({ sections, fonts: embeddedFonts })
  if (embeddedFonts.length) {
    doc.Settings.addChildElement(new XmlComponent('w:embedTrueTypeFonts'))
    doc.Settings.addChildElement(new XmlComponent('w:saveSubsetFonts'))
  }
  const blob = await Packer.toBlob(doc, false, pdfWordFontTable(doc, embeddedFonts))
  const result = { name: `${(file.name || 'document').replace(/\.[^.]+$/, '')}.docx`, data: new Uint8Array(await blob.arrayBuffer()), mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }
  result.message = 'PDF text is editable in Word. Table cells retain wrapped lines, and borders are retained only where detected; PDF font metadata is used for font family, bold, and italic styling. Scanned pages use OCR, and complex layouts or fonts unavailable in Word may need cleanup.'
  return [result]
}
