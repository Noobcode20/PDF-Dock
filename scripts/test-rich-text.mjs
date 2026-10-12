import path from 'node:path'
import assert from 'node:assert/strict'
import { PDFDocument } from 'pdf-lib'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { appendTextStyleRange, rebaseTextStyleRanges, textStyleAt } from '../src/editor/textStyles.js'
import { applyOperations } from '../src/editor/operations.js'

let ranges = [{ start: 7, end: 18, fontWeight: '700' }]
ranges = appendTextStyleRange(ranges, 12, 18, { color: '#ff0000' })
assert.equal(textStyleAt(ranges, 13).fontWeight, '700')
assert.equal(textStyleAt(ranges, 13).color, '#ff0000')
assert.equal(textStyleAt(ranges, 8).color, undefined)
ranges = appendTextStyleRange(ranges, 7, 11, { fontFamily: 'Courier New', fontSize: 16 })
assert.equal(textStyleAt(ranges, 8).fontWeight, '700')
assert.equal(textStyleAt(ranges, 13).fontFamily, undefined)
const before = 'Normal bold phrase normal end'
const replaced = rebaseTextStyleRanges(ranges, before, 'Normal BOLD phrase normal end')
assert.equal(textStyleAt(replaced, 8).fontWeight, '700')
assert.equal(textStyleAt(replaced, 13).color, '#ff0000')
const inserted = rebaseTextStyleRanges([{start:7,end:18,fontWeight:'700'}], before, 'Normal bold phrase! normal end')
assert.equal(textStyleAt(inserted,18).fontWeight, '700')
const pdf = await PDFDocument.create(); pdf.addPage([600,800])
const bytes = await applyOperations(await pdf.save(), [{type:'text',isNew:true,page:1,x:.05,y:.1,width:.9,height:.15,text:before,fontFamily:'Times New Roman',fontSize:18,fontWeight:'400',color:'#000000',styleRanges:ranges}])
const loadingTask = pdfjs.getDocument({data:bytes,disableFontFace:true,standardFontDataUrl:path.resolve('node_modules/pdfjs-dist/standard_fonts') + path.sep})
const loaded = await loadingTask.promise
const page = await loaded.getPage(1), content = await page.getTextContent()
const items = content.items.filter(x=>x.str?.trim())
const words = items.map(x=>x.str).join(' ')
assert.match(words,/Normal/); assert.match(words,/bold/); assert.match(words,/phrase/); assert.match(words,/normal end/)
const normal = items.find(x=>x.str.includes('Normal')), bold = items.find(x=>x.str.includes('bold')), phrase = items.find(x=>x.str.includes('phrase'))
assert.notEqual(normal.fontName, bold.fontName)
assert.notEqual(normal.fontName, phrase.fontName)
assert.equal(Math.round(Math.hypot(bold.transform[2],bold.transform[3])),16)
const ops = await page.getOperatorList()
assert.ok(ops.fnArray.some((fn,index)=>fn===pdfjs.OPS.setFillRGBColor && ops.argsArray[index][0]=== '#ff0000'))
await loadingTask.destroy()
console.log('Rich text regressions passed: overlapping styles, inherited typing, replacement, PDF font/size/color preservation.')

// A paragraph can be narrow beside a table and wide below it. Its bounding
// rectangle includes the table, so only the actual source runs may be erased.
const { StandardFonts, rgb } = await import('pdf-lib')
const { createCanvas } = await import('@napi-rs/canvas')
const fixture = await PDFDocument.create(), fixturePage = fixture.addPage([600,800])
const fixtureFont = await fixture.embedFont(StandardFonts.TimesRoman)
fixturePage.drawText('Selected first line', {x:30,y:630,size:14,font:fixtureFont})
fixturePage.drawText('Selected wide last line', {x:30,y:350,size:14,font:fixtureFont})
fixturePage.drawRectangle({x:320,y:450,width:150,height:160,color:rgb(0,.8,.3)})
fixturePage.drawText('NEIGHBORING TABLE', {x:325,y:550,size:12,font:fixtureFont})
const fixtureBytes = await fixture.save()
const erased = await applyOperations(fixtureBytes,[{type:'text',page:1,text:'',oldText:'Selected first line\nSelected wide last line',x:.05,y:.2,width:.85,height:.4,sourceCoverRects:[{x:.05,y:.19,width:.4,height:.035,backgroundColor:'#ffffff'},{x:.05,y:.54,width:.8,height:.035,backgroundColor:'#ffffff'}]}])
async function pixels(bytes) {
  const task=pdfjs.getDocument({data:new Uint8Array(bytes),standardFontDataUrl:path.resolve('node_modules/pdfjs-dist/standard_fonts')+path.sep})
  const doc=await task.promise, page=await doc.getPage(1), viewport=page.getViewport({scale:1})
  const canvas=createCanvas(viewport.width,viewport.height), ctx=canvas.getContext('2d')
  await page.render({canvasContext:ctx,viewport}).promise
  const data=ctx.getImageData(320,190,150,160).data
  await task.destroy()
  return data
}
assert.deepEqual(await pixels(erased),await pixels(fixtureBytes),'Erasing the selected paragraph must leave the neighboring table pixel-for-pixel unchanged')
const { layoutStyledText } = await import('../src/editor/styledText.js')
const layout = await layoutStyledText(fixture,'A long original PDF line\nAnother original PDF line',{fontFamily:'Times New Roman',sourceLineCount:2}, {},14,40)
assert.equal(layout.length,2,'Explicit PDF lines must not acquire extra soft wraps')
console.log('Layout regressions passed: original line breaks and neighboring table pixels are preserved.')

const { extractTextColors } = await import('../src/editor/pdfTextColors.js')
const colored = await PDFDocument.create(), colorPage=colored.addPage([600,800]), colorFont=await colored.embedFont(StandardFonts.TimesRoman)
colorPage.drawText('Black text', {x:30,y:650,font:colorFont,size:14})
colorPage.drawText('[10]', {x:120,y:650,font:colorFont,size:14,color:rgb(0,1,0)})
colorPage.drawText('2', {x:150,y:655,font:colorFont,size:8,color:rgb(0,0,1)})
const colorTask=pdfjs.getDocument({data:await colored.save(),standardFontDataUrl:path.resolve('node_modules/pdfjs-dist/standard_fonts')+path.sep})
const colorDoc=await colorTask.promise, colorPdfPage=await colorDoc.getPage(1), colorItems=(await colorPdfPage.getTextContent()).items
const actualColors=extractTextColors(await colorPdfPage.getOperatorList(),pdfjs.OPS,colorItems)
assert.equal(actualColors[colorItems.findIndex(x=>x.str==='[10]')],'#00ff00')
assert.equal(actualColors[colorItems.findIndex(x=>x.str==='2')],'#0000ff')
const { extractTextColorStyles } = await import('../src/editor/pdfTextColors.js')
const combinedStyle = extractTextColorStyles(await colorPdfPage.getOperatorList(),pdfjs.OPS,[{str:'Black text[10]2'}])[0]
assert.equal(combinedStyle.ranges.find(range=>range.start===10).color,'#00ff00')
assert.equal(combinedStyle.ranges.at(-1).color,'#0000ff')
await colorTask.destroy()
console.log('Source color regression passed: original green citations and blue superscripts are retained exactly.')

const { normalizeFont } = await import('../src/editor/fonts.js')
assert.equal(normalizeFont('NimbusRomNo9L-Regu'), StandardFonts.TimesRoman)
assert.equal(normalizeFont('NimbusRomNo9L-Medi',true), StandardFonts.TimesRomanBold)

const { resolveFontFamilyStack } = await import("../src/editor/fonts.js")
const resolvedNimbus = resolveFontFamilyStack("TWFYRS+NimbusRomNo9L-Regu")
assert.equal(resolvedNimbus.family, "Times New Roman")
assert.ok(resolvedNimbus.cssStack.includes("Times New Roman"))
assert.ok(resolvedNimbus.cssStack.includes("Nimbus Roman No9 L"))

const { systemFontKey } = await import("../src/editor/fontNames.js")
assert.equal(systemFontKey("NimbusRomNo9L-Regu"), "TimesNewRoman-Regular")
assert.equal(systemFontKey("NimbusRomNo9L-Medi", "700"), "TimesNewRoman-Bold")
console.log("Font mapping and character spacing regressions passed.")
