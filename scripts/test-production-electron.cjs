// Run against PDFKING_USE_BUILD=1 Electron. Uses real native Save As.
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const { chromium } = require(process.env.PDFKING_PLAYWRIGHT || 'playwright-core');
(async () => {
 const browser=await chromium.connectOverCDP(process.env.PDFKING_CDP||'http://127.0.0.1:9224');
 const context=browser.contexts()[0];
 try {
  const p=context.pages().find(p=>p.url().startsWith('file:'));
  assert.ok(p,'Production dist/index.html must be loaded through file://');
  const errors=[];p.on('pageerror',e=>errors.push(e.message));
  const button=name=>p.getByRole('button',{name,exact:true});
  await p.waitForSelector('button');
  if(await button('Skip setup').count())await button('Skip setup').click();
  if(await button('Get started').count())await button('Get started').click();
  await button('New document').first().click();await p.locator('input[type=file]').first().setInputFiles(path.resolve('tmp/sol-qa/master-original.pdf'));
  await p.waitForSelector('.pdf-editor-workspace canvas.is-rendered');await button('Fit page').click();
  for(const n of [2,3,1,4,2,1]){
   const current=p.getByRole('spinbutton',{name:'Current page',exact:true});await current.fill(String(n));await current.press('Enter');
   await p.waitForFunction(n=>{const c=document.querySelector(`canvas[aria-label="PDF page ${n}"]`);return c?.classList.contains('is-rendered')&&c.width>0},n);
  }
  await button('Fill forms').click();await p.locator('.pdf-form-layer input[aria-label=Name]').fill('Built app form edit');await button('Apply tool').click();
  await p.waitForFunction(()=>document.querySelector('.pdf-editor-status')?.textContent==='Changes applied to the current document.');
  await p.reload();await button('New document').first().click();await p.locator('input[type=file]').first().setInputFiles(path.resolve('tmp/sol-qa/scanned.pdf'));
  await p.waitForSelector('.pdf-editor-workspace canvas.is-rendered');
  await context.setOffline(true);
  await button('Export').click();await button('Recognized text').click();await button('Run conversion').click();await button('Cancel').click();
  await p.waitForFunction(()=>document.querySelector('.pdf-editor-status')?.textContent==='Cancelled.');await button('Run conversion').click();
  await p.waitForFunction(()=>/Searchable PDF|Changes applied|OCR complete/i.test(document.querySelector('.pdf-editor-status')?.textContent||''),undefined,{timeout:120000});
  const destination='tmp/sol-qa/production-ocr-saved.pdf';await fs.rm(destination,{force:true});
  await button('Save As').click();console.log('NATIVE STAGE: Save built-app offline OCR as tmp/sol-qa/production-ocr-saved.pdf.');
  await p.waitForFunction(()=>document.querySelector('.pdf-editor-status')?.textContent==='Saved production-ocr-saved.pdf',undefined,{timeout:600000});
  await p.reload();await button('New document').first().click();await p.locator('input[type=file]').first().setInputFiles(path.resolve(destination));
  await p.waitForSelector('.pdf-editor-workspace canvas.is-rendered');await p.getByRole('searchbox',{name:'Search PDF',exact:true}).fill('Invoice');
  await p.waitForFunction(()=>document.querySelector('.pdf-search-highlight-layer span'));
  await p.screenshot({path:'tmp/sol-qa/production-offline-ocr-reopened.png'});assert.deepEqual(errors,[]);
  console.log('PASS built file:// Electron: mixed-page navigation, local worker form commit, OCR with renderer context offline, cancellation/restart, native Save As, reopen and search. Installer packaging and OS-wide offline mode not tested.');
 } finally {await context.setOffline(false);await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
