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
   await page.waitForFunction(() => {
    const root=document.querySelector('.pdf-viewer-page')?.getBoundingClientRect();
    if(!root)return false;
    const visible=[...document.querySelectorAll('.acrobat-document-page > canvas')].filter(c=>{const r=c.getBoundingClientRect();return r.bottom>root.top+1&&r.top<root.bottom-1});
    return visible.length>0&&visible.every(c=>c.classList.contains('is-rendered')&&c.width>0&&c.height>0);
   }, undefined, {timeout:15000})
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
  const memory = await page.evaluate(()=>{
   const canvases=[...document.querySelectorAll('.acrobat-document-page > canvas')];
   return {mounted:canvases.length,painted:canvases.filter(c=>c.width&&c.height).length,rasterBytes:canvases.reduce((sum,c)=>sum+c.width*c.height*4,0),heapBytes:performance.memory?.usedJSHeapSize};
  });
  assert.ok(memory.mounted<20&&memory.rasterBytes<256*1024*1024,JSON.stringify(memory));
  console.log('60-page bounded snapshot:',JSON.stringify(memory));
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
  const layers = await page.evaluate(async () => {
   const e=await import('/src/pdfEngine.js'),{applyOperations}=await import('/src/editor/operations.js');
   const source=new Uint8Array(await (await fetch('/tmp/editor-qa/source.pdf')).arrayBuffer()),cases=[];
   for(const rotation of [0,90,180,270])for(const scale of [.5,1,2]){
    const file=new File([await applyOperations(source,rotation?[{type:'pages',action:'rotate',index:0,angle:rotation}]:[])],'layer.pdf');
    const canvas=document.createElement('canvas');await e.renderPdfPage(file,1,canvas,scale);
    const layer=document.createElement('div');layer.className='pdf-text-layer';layer.style.left='0';layer.style.top='0';document.body.append(layer);
    const result=await e.renderPdfTextLayer(file,1,layer,scale),span=layer.querySelector('span'),b=span.getBoundingClientRect(),bounds=layer.getBoundingClientRect();
    const x=Number(span.dataset.pdfBaselineX),y=Number(span.dataset.pdfBaselineY);
    cases.push({status:result.status,rotation:Number(layer.dataset.mainRotation),expected:rotation,dimensions:Math.abs(bounds.width-result.width)<2&&Math.abs(bounds.height-result.height)<2,aligned:x>=b.left-2&&x<=b.right+2&&y>=b.top-2&&y<=b.bottom+2});
    layer.remove();canvas.width=0;canvas.height=0;e.disposePdfFile(file);
   }return cases;
  });
  assert.ok(layers.every(c=>c.status==='SUCCESS'&&c.rotation===c.expected&&c.dimensions&&c.aligned),JSON.stringify(layers));
  // Reopening a mixed portrait/rotated/cropped document exposed an obsolete
  // second IntersectionObserver decision: the visible center page stayed blank.
  for(let round=0;round<3;round++) {
   await page.reload();await page.getByRole('button',{name:'New document',exact:true}).first().click();
   await page.locator('input[type=file]').first().setInputFiles(path.resolve('tmp/sol-qa/master-original.pdf'));
   await painted();await page.getByRole('button',{name:'Fit page',exact:true}).click();
   for(const n of [2,3,4,2,1]) {
    const current=page.getByRole('spinbutton',{name:'Current page',exact:true});await current.fill(String(n));await current.press('Enter');
    await painted();await page.waitForFunction(n=>{
     const c=document.querySelector(`canvas[aria-label="PDF page ${n}"]`),root=document.querySelector('.pdf-viewer-page')?.getBoundingClientRect(),r=c?.getBoundingClientRect();
     return c?.width>0&&c?.classList.contains('is-rendered')&&r.bottom>root.top&&r.top<root.bottom;
    },n);
   }
  }
  assert.deepEqual(errors,[])
  await fs.mkdir('tmp/sol-qa',{recursive:true})
  await page.screenshot({path:'tmp/sol-qa/viewer-electron.png'})
  console.log('PASS native Electron: 24 rapid page jumps, zoom, tools, 8 document switches, page rotation; explicit cancellation/supersession/failure outcomes; 12 text-layer rotation/zoom dimension and baseline checks; 3 mixed-size reopen cycles and 15 fit/page jumps; every visible canvas painted.')
 } finally {await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1})
