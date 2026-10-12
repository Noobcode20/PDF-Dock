import assert from 'node:assert/strict'
import { createCanvas } from '@napi-rs/canvas'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import JSZip from 'jszip'
import { convertPdfToWord } from '../src/pdfToWord.js'

const source = await PDFDocument.create()
const regular = await source.embedFont(StandardFonts.Helvetica)
const bold = await source.embedFont(StandardFonts.HelveticaBold)
const draw = (page, text, x, y, size = 12, font = regular, color = rgb(0, 0, 0)) => page.drawText(text, { x, y, size, font, color })
const centered = (page, text, center, y, size = 24) => draw(page, text, center - bold.widthOfTextAtSize(text, size) / 2, y, size, bold, rgb(0, 0.5, 0.6))
const rule = (page, x1, y1, x2, y2) => page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: 0.75, color: rgb(0.2, 0.3, 0.4) })
const page1 = source.addPage([600, 800])
centered(page1, 'Centered heading', 300, 740, 28)
for (const [text, x] of [['Component', 50], ['Marks', 220], ['Description', 280]]) draw(page1, text, x, 660, 11, bold)
for (const [text, x] of [['First row', 50], ['3', 220], ['First cell paragraph', 280]]) draw(page1, text, x, 632, 11)
draw(page1, 'continued in the same cell.', 280, 618, 11)
for (const [text, x] of [['Second row', 50], ['5', 220], ['Another paragraph', 280]]) draw(page1, text, x, 590, 11)
draw(page1, 'with a second line.', 280, 576, 11)
draw(page1, '1.', 70, 490); draw(page1, 'Numbered item', 88, 490)
draw(page1, 'a.', 106, 474); draw(page1, 'Nested letter item', 124, 474)
draw(page1, 'b.', 106, 458); draw(page1, 'Another nested letter', 124, 458)
const page2 = source.addPage([600, 800])
centered(page2, 'Ruled table', 300, 740)
for (const x of [50, 200, 350, 550]) rule(page2, x, 600, x, 700)
for (const y of [600, 650, 700]) rule(page2, 50, y, 550, y)
for (const [x, text] of [[60, 'A'], [210, 'B'], [360, 'C']]) draw(page2, text, x, 680)
for (const [x, text] of [[60, 'Wrapped'], [210, 'Middle'], [360, 'Last']]) draw(page2, text, x, 630)
draw(page2, 'same cell', 60, 615)
const page3 = source.addPage([600, 800])
for (const [x, text] of [[90, 'Data'], [220, 'Process'], [350, 'Output'], [470, 'Alternative']]) draw(page3, text, x, 700, 12, bold)
rule(page3, 50, 690, 550, 690); rule(page3, 50, 600, 550, 600)
for (const [x, text] of [[60, 'Input'], [190, 'Processing'], [320, 'Result']]) draw(page3, text, x, 670)
for (const [y, text] of [[655, 'continues'], [640, 'in one cell'], [625, 'without new rows']]) draw(page3, text, 190, y)
const page4 = source.addPage([800, 900])
page4.setCropBox(100, 50, 600, 800)
centered(page4, 'Cropped centered title', 400, 780)
const body = 'Long text establishes the asymmetric document text area.'
const size = 400 / regular.widthOfTextAtSize(body, 1)
for (const y of [720, 700]) draw(page4, body, 240, y, size)
centered(page4, 'Body area centered', 440, 650, 18)
// Same-font color changes can be combined into one textContent item.
draw(page4, 'RED', 150, 580, 14, regular, rgb(1, 0, 0))
draw(page4, 'BLUE', 150 + regular.widthOfTextAtSize('RED', 14), 580, 14, regular, rgb(0, 0, 1))
const page5 = source.addPage([600, 800])
const picture = createCanvas(80, 60)
const context = picture.getContext('2d')
context.fillStyle = '#00a99d'; context.fillRect(0, 0, 80, 60)
const png = await source.embedPng(picture.toBuffer('image/png'))
page5.drawImage(png, { x: 100, y: 400, width: 160, height: 120 })
draw(page5, 'Editable text beside an image', 100, 580)
const renderPage = async (document, number, scale) => {
 const page = await document.getPage(number), viewport = page.getViewport({ scale })
 const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height))
 await page.render({ canvas, canvasContext: canvas.getContext('2d'), viewport }).promise
 return { canvas }
}
const data = await source.save()
const task = pdfjs.getDocument({ data: data.slice(), fontExtraProperties: true, useSystemFonts: true })
const pdf = await task.promise
const [result] = await convertPdfToWord({ pdfjs, pdf, file: { name: 'regression.pdf', arrayBuffer: async () => data.buffer }, renderPage, createCanvas: () => createCanvas(1, 1),
 canvasBlob: async (canvas) => new Blob([canvas.toBuffer('image/png')]) })
const zip = await JSZip.loadAsync(result.data)
const xml = await zip.file('word/document.xml').async('string')
const tables = xml.match(/<w:tbl>[\s\S]*?<\/w:tbl>/g) || []
assert.equal(tables.length, 3)
for (const [index, columns, rows] of [[0, 3, 3], [1, 3, 2], [2, 4, 2]]) {
 assert.equal((tables[index].match(/<w:gridCol /g) || []).length, columns)
 assert.equal((tables[index].match(/<w:tr[ >]/g) || []).length, rows)
}
assert.ok(!tables[0].includes('w:val="single"'), 'Borderless tables must stay borderless')
assert.ok(tables[1].includes('w:val="single"'), 'Source rules must be preserved')
assert.ok(tables[0].includes('continued in the same cell.'))
assert.ok(tables[2].includes('without new rows'))
assert.ok(!tables.some((table) => table.includes('Nested letter')))
assert.ok(xml.includes('<w:tab/>'), 'List text should retain its marker-to-text tab')
assert.ok(xml.includes('w:ascii="Helvetica"'))
assert.ok(xml.includes('w:sz w:val="56"'))
assert.ok(xml.includes('w:color w:val="FF0000"'))
assert.ok(xml.includes('w:color w:val="0000FF"'))
const paragraphs = xml.match(/<w:p[ >][\s\S]*?<\/w:p>/g) || []
for (const text of ['Centered heading', 'Cropped centered title', 'Body area centered']) {
 assert.ok(paragraphs.find((p) => p.includes(text))?.includes('w:jc w:val="center"'), text)
}
assert.equal(Object.keys(zip.files).filter((name) => /word\/media\/.*\.png$/.test(name)).length, 1)
assert.ok(xml.includes('wp:anchor'), 'Images should preserve page positions without pushing text to new pages')
assert.ok(xml.includes('Editable text beside an image'))
await task.destroy()
console.log('PDF-to-Word regression checks passed: borderless/ruled tables, wrapped cells, empty columns, nested lists, heading sizes, fonts, mixed colors, crop coordinates and centering.')
