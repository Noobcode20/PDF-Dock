// Run against the real app launched with --remote-debugging-port=9224.
// PDFKING_PLAYWRIGHT points to an externally installed playwright-core package.
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs/promises')
const { chromium } = require(process.env.PDFKING_PLAYWRIGHT || 'playwright-core')
;(async () => {
 const browser = await chromium.connectOverCDP(process.env.PDFKING_CDP || 'http://127.0.0.1:9224')
 try {
  const page = browser.contexts()[0].pages().find(p => p.url().includes(':5174'))
  assert.ok(page, 'Native Electron renderer must be open')
  await page.reload()
  await page.getByRole('button',{name:'New document',exact:true}).first().click()
  await page.locator('input[type=file]').first().setInputFiles(path.resolve('tmp/editor-qa/source.pdf'))
  await page.waitForSelector('.acrobat-document-page > canvas.is-rendered')
  const errors = []; page.on('pageerror', error => errors.push(error.message))
  const painted = async () => {
   await page.waitForFunction(() => [...document.querySelectorAll('.acrobat-document-page > canvas')].some(c => {
    const r=c.getBoundingClientRect();return r.bottom>300&&r.top<innerHeight-70&&c.classList.contains('is-rendered')&&c.width>0&&c.height>0
   }), undefined, {timeout:15000})
   assert.ok(await page.locator('.acrobat-document-page > canvas.is-rendered').evaluateAll(cs=>cs.every(c=>c.width>0&&c.height>0)), 'Completed canvases have pixels')
  }
  const input = page.getByRole('spinbutton', {name:'Current page',exact:true})
  for(let round=0;round<4;round++) {
   for(const n of [4,2,1,3,4,1]) {await input.fill(String(n));await input.press('Enter')}
   await page.getByRole('button',{name:'Zoom in',exact:true}).click()
   await page.getByRole('button',{name:'Zoom out',exact:true}).click()
   await painted()
   await page.getByRole('button',{name:'Image',exact:true}).click()
   await page.getByRole('button',{name:'Edit text',exact:true}).click()
   await painted()
  }
  await page.getByRole('button',{name:'New tab',exact:true}).click()
  await page.getByRole('button',{name:'New document',exact:true}).first().click()
  await page.locator('input[type=file]').first().setInputFiles(path.resolve('tmp/editor-qa/sixty-pages.pdf'))
  await painted()
  for(let i=0;i<8;i++) {
   await page.getByRole('tab',{name:'PDF Editor',exact:true}).nth(i%2).click()
   await painted()
  }
  await page.getByRole('tab',{name:'PDF Editor',exact:true}).first().click()
  await page.getByRole('button',{name:'Organize pages',exact:true}).click()
  await page.getByRole('button',{name:'Rotate 90°',exact:true}).click()
  await page.getByRole('button',{name:'Home',exact:true}).last().click()
  await painted()
  // Deliberately canceled, superseded, failed and valid engine jobs on one canvas.
  const outcomes = await page.evaluate(async () => {
   const e=await import('/src/pdfEngine.js');const f=new File([await (await fetch('/tmp/editor-qa/source.pdf')).arrayBuffer()],'stress.pdf')
   const canvas=document.createElement('canvas'),old=new AbortController()
   const a=e.renderPdfPage(f,1,canvas,1,{signal:old.signal});old.abort()
   const b=e.renderPdfPage(f,2,canvas,1);const first=await a;const second=await b
   const fail=await e.renderPdfPage(f,99,canvas,1)
   return {first:first.status,second:second.status,fail:fail.status,width:canvas.width}
  })
  assert.equal(outcomes.first,'CANCELLED');assert.equal(outcomes.second,'SUCCESS');assert.equal(outcomes.fail,'FAILED');assert.ok(outcomes.width>0)
  assert.deepEqual(errors,[])
  await fs.mkdir('tmp/sol-qa',{recursive:true})
  await page.screenshot({path:'tmp/sol-qa/viewer-electron.png'})
  console.log('PASS native Electron: 24 rapid page jumps, zoom, tools, 8 document switches, page rotation; explicit cancellation/supersession/failure outcomes.')
 } finally {await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1})
