// Run: PDFKING_USE_BUILD=1 node_modules/.bin/electron scripts/measure-memory.cjs
// Uses a temporary profile, production renderer and deterministic generated PDFs.
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const assert = require('node:assert/strict')
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'pdfdock-memory-'))
app.setPath('userData', profile)
app.setAppPath(path.resolve(__dirname, '..'))
process.env.PDFKING_USE_BUILD = '1'
delete process.env.VITE_DEV_SERVER_URL
require('../electron/main.cjs')
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const samples = [], errors = []
async function waitFor(win, expression) {
  for (let i = 0; i < 150; i++) {
    if (await win.webContents.executeJavaScript(expression)) return
    await delay(200)
  }
  fs.mkdirSync(path.resolve('output/memory'), {recursive:true});
  fs.writeFileSync(path.resolve('output/memory/timeout.html'),await win.webContents.executeJavaScript('document.documentElement.outerHTML'));
  console.error(await win.webContents.executeJavaScript('document.body.innerText.slice(-6000)'));
  throw Error(`Timed out: ${expression}`)
}
async function sample(win, scenario) {
  for (let i = 0; i < 5; i++) {
    const metrics = app.getAppMetrics()
    const dom = await win.webContents.executeJavaScript(`(() => {
      const canvases = [...document.querySelectorAll('canvas')];
      return {canvases: canvases.length, pixels: canvases.reduce((n,c)=>n+c.width*c.height,0), tabs: document.querySelectorAll('[role=tab]').length,
        heapBytes: performance.memory?.usedJSHeapSize, error: document.querySelector('.renderer-error')?.textContent};
    })()`)
    assert.ok(!dom.error, dom.error)
    samples.push({ timestamp: new Date().toISOString(), scenario, ...dom, processes: metrics.map(m => ({pid:m.pid,type:m.type,...m.memory})) })
    await delay(1000)
  }
}
app.whenReady().then(async () => {
  try {
    let win
    for(let i=0;i<100&&!win;i++){win=BrowserWindow.getAllWindows()[0];if(!win)await delay(100)}
    assert.ok(win, 'App window created')
    // Keep RAF alive if the automated window is occluded by the user's editor.
    win.webContents.setBackgroundThrottling(false)
    win.webContents.on('console-message', (event) => { if(event.level === 'error' && !event.message.includes("frame-ancestors"))errors.push(event.message) })
    await waitFor(win, 'Boolean(document.querySelector("button"))')
    await win.webContents.executeJavaScript(`localStorage.setItem('pdfking-onboarding-complete','true'); location.reload()`)
    await delay(3000)
    await sample(win, 'home-idle')
    const { PDFDocument, StandardFonts } = require('pdf-lib')
    const pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.Helvetica)
    for(let i=0;i<20;i++) pdf.addPage([612,792]).drawText(`Memory test page ${i+1}`, {x:50,y:700,font,size:24})
    const base64 = Buffer.from(await pdf.save()).toString('base64')
    for(let n=1;n<=3;n++) {
      console.log('Opening PDF', n)
      if(n>1) { await win.webContents.executeJavaScript(`document.querySelector('.new-tab-button').click()`); await delay(500) }
      await win.webContents.executeJavaScript(`document.dispatchEvent(new KeyboardEvent('keydown', {key:'o',metaKey:true,ctrlKey:false,bubbles:true}))`)
      await waitFor(win, 'Boolean(document.querySelector(".file-picker-modal input[type=file]"))')
      await win.webContents.executeJavaScript(`(() => {const input=document.querySelector('.file-picker-modal input[type=file]'); const dt=new DataTransfer(); dt.items.add(new File([Uint8Array.from(atob(${JSON.stringify(base64)}),c=>c.charCodeAt(0))], 'memory-${n}.pdf', {type:'application/pdf'})); input.files=dt.files; input.dispatchEvent(new Event('change',{bubbles:true}));})()`)
      await waitFor(win, 'Boolean(document.querySelector("canvas.is-rendered"))')
      await delay(1500)
      await sample(win, `open-${n}-pdfs`)
    }
    for(let i=0;i<8;i++) {
      await win.webContents.executeJavaScript(`window.dispatchEvent(new CustomEvent('pdfking:editor-shortcut',{detail:{action:'editor-zoom-in'}}))`)
      await delay(150)
    }
    await delay(1000)
    await waitFor(win, 'Boolean(document.querySelector("canvas.is-rendered"))')
    assert.ok(await win.webContents.executeJavaScript(`[...document.querySelectorAll('.acrobat-document-page > canvas')].every(c=>c.width*c.height<=3000000)`), 'High-zoom page raster stays within budget')
    await sample(win, 'three-pdfs-high-zoom')
    await win.webContents.executeJavaScript(`const view=document.querySelector('.pdf-viewer-page'); view.scrollTop=view.scrollHeight;`)
    await waitFor(win, `Boolean(document.querySelector('canvas[aria-label="PDF page 20"].is-rendered'))`)
    await sample(win, 'three-pdfs-scrolled')
    // Leave a fresh Home tab so closing the final PDF does not quit the app.
    await win.webContents.executeJavaScript(`document.querySelector('.new-tab-button').click()`)
    await delay(500)
    for(let i=0;i<3;i++) {
      await win.webContents.executeJavaScript(`document.querySelector('.tab-close').click()`)
      await delay(500)
    }
    assert.equal(await win.webContents.executeJavaScript(`document.querySelectorAll('[role=tab]').length`), 1)
    assert.equal(await win.webContents.executeJavaScript(`document.querySelectorAll('.pdf-editor-workspace').length`), 0)
    await delay(3000)
    await sample(win, 'after-close')
    assert.equal(errors.length,0, errors.join('\n'))
    console.log('Memory scenarios passed; no renderer console errors.')
  } catch(error) { console.error(error); process.exitCode=1 }
  finally {
    fs.mkdirSync(path.resolve('output/memory'), {recursive:true})
    fs.writeFileSync(path.resolve('output/memory/latest.json'), JSON.stringify({electron:process.versions.electron,platform:process.platform,arch:process.arch,notes:'Production renderer under development Electron binary; background throttling disabled for automated rendering. workingSetSize is KiB; process totals can double-count shared pages. No forced GC.',samples,errors},null,2))
    console.log('Report: output/memory/latest.json')
    app.exit(process.exitCode || 0)
  }
})
