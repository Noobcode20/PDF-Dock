import { readFile, writeFile } from 'node:fs/promises'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { createPdfToolkit } from 'pdfstudio'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { compressPdfBytes, optimizePdfDocument, optimizePdfType1Fonts, recompressPdfImages } from '../src/pdfCompression.js'
import { convertType1Fonts } from '../electron/fontCompression.cjs'
if (!process.argv[2] || !process.argv[3]) throw new Error('Usage: node scripts/test-pdf-compression-file.mjs input.pdf output.pdf')
const source=new Uint8Array(await readFile(process.argv[2]));
const toolkit=await createPdfToolkit({wasmModule:await WebAssembly.compile(await readFile('node_modules/pdfstudio/dist/wasm/qpdf.wasm'))});
const decodePdfImage=async(bytes,scale)=>{const task=pdfjs.getDocument({data:bytes,wasmUrl:process.cwd()+'/node_modules/pdfjs-dist/wasm/',stopAtErrors:true});try{const doc=await task.promise;const page=await doc.getPage(1);const viewport=page.getViewport({scale});const canvas=createCanvas(Math.max(1,Math.round(viewport.width)),Math.max(1,Math.round(viewport.height)));await page.render({canvas:null,canvasContext:canvas.getContext('2d',{alpha:true}),viewport,background:'rgba(0,0,0,0)'}).promise;return canvas;}finally{await task.destroy()}};
const result=await compressPdfBytes(source,{targetReduction:0.7,optimizeFonts:data=>optimizePdfType1Fonts(data,convertType1Fonts),imagePasses:[{quality:0.68,maxDimension:2000},{quality:0.55,maxDimension:1700},{quality:0.42,maxDimension:1400},{quality:0.32,maxDimension:1100},{quality:0.28,maxDimension:900},{quality:0.25,maxDimension:750},{quality:0.22,maxDimension:650},{quality:0.2,maxDimension:550}],optimize:data=>optimizePdfDocument(data,{toolkit}),recompressImages:async(data,settings)=>{const r=await recompressPdfImages(data,{...settings,createCanvas,decodeJpeg:loadImage,decodePdfImage,encodeJpeg:async(canvas,quality)=>canvas.toBuffer('image/jpeg',Math.round(quality*100))});console.log(settings,r.data.length,r.changed);return r}});
await writeFile(process.argv[3],result.data);console.log({source:source.length,output:result.data.length,reduction:result.reduction,changedImages:result.changedImages,changedFonts:result.changedFonts});

// Validate native document behavior against the source, even when the target
// is unattainable. This harness accepts personal PDFs without checking them in.
const tasks = [source, result.data].map(data => pdfjs.getDocument({ data: data.slice(), useSystemFonts: true, wasmUrl: new URL('../node_modules/pdfjs-dist/wasm/', import.meta.url).pathname }))
const [before, after] = await Promise.all(tasks.map(task => task.promise))
const { default: assert } = await import('node:assert/strict')
try {
  assert.equal(after.numPages, before.numPages)
  for (let page = 1; page <= before.numPages; page++) {
    const [a, b] = await Promise.all([before.getPage(page), after.getPage(page)])
    assert.deepEqual(b.getViewport({ scale: 1 }).viewBox, a.getViewport({ scale: 1 }).viewBox)
    const [originalText, compressedText] = await Promise.all([a.getTextContent(), b.getTextContent()])
    assert.deepEqual(compressedText.items.map(item => item.str), originalText.items.map(item => item.str))
    const [originalAnnotations, compressedAnnotations] = await Promise.all([a.getAnnotations(), b.getAnnotations()])
    const meaningful = annotations => annotations.map(item => ({ subtype: item.subtype, url: item.url, dest: item.dest, rect: item.rect, fieldName: item.fieldName, fieldValue: item.fieldValue }))
    assert.deepEqual(meaningful(compressedAnnotations), meaningful(originalAnnotations))
  }
  console.log(`Verified ${after.numPages} pages: original text, page bounds, links, and form values preserved`)
} finally { await Promise.all(tasks.map(task => task.destroy())) }
