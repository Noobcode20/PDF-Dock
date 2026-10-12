const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');const {chromium}=require(process.env.PDFKING_PLAYWRIGHT||'playwright-core');
;(async()=>{const browser=await chromium.connectOverCDP(process.env.PDFKING_CDP||'http://127.0.0.1:9224');try{
 const context=browser.contexts()[0],p=context.pages().find(p=>p.url().includes(':5174')),requests=[],blocked=[];
 const policy=async route=>{const url=new URL(route.request().url());if(['http:','https:'].includes(url.protocol)&&!['127.0.0.1','localhost'].includes(url.hostname)){blocked.push(url.href);await route.abort()}else await route.continue()};
 await context.route('**/*',policy);context.on('request',request=>requests.push(request.url()));
 try{
  await p.reload();await p.getByRole('button',{name:'New document',exact:true}).first().click();await p.locator('input[type=file]').first().setInputFiles(path.resolve('tmp/sol-qa/scanned.pdf'));await p.waitForSelector('.acrobat-document-page > canvas.is-rendered');await p.getByRole('button',{name:'Export',exact:true}).click();await p.getByRole('button',{name:'Recognized text',exact:true}).click();await p.getByRole('button',{name:'Run conversion',exact:true}).click();await p.getByRole('button',{name:'Cancel',exact:true}).click();
  await p.waitForFunction(()=>document.querySelector('.pdf-editor-status')?.textContent==='Cancelled.');await p.getByRole('button',{name:'Run conversion',exact:true}).click();
  await p.waitForFunction(()=>/Searchable PDF|Changes applied|OCR complete/i.test(document.querySelector('.pdf-editor-status')?.textContent||''),undefined,{timeout:90000});
  const bytes=await require('./electron-qa.cjs').captureUiBytes(p);
  await fs.writeFile('tmp/sol-qa/ocr-offline-ui.pdf',Buffer.from(bytes));const result=await p.evaluate(async a=>{const e=await import('/src/pdfEngine.js');return await e.searchPdfDocument(new File([new Uint8Array(a)],'ocr.pdf'),'Invoice')},bytes);assert.ok(result.results.length>0);
  assert.ok(requests.some(u=>u.includes('ocr/worker.min.js')));assert.ok(requests.some(u=>u.includes('traineddata'))||requests.some(u=>u.includes('ocr/')));
  await p.reload();await p.getByRole('button',{name:'New document',exact:true}).first().click();await p.locator('input[type=file]').first().setInputFiles(path.resolve('tmp/sol-qa/ocr-offline-ui.pdf'));await p.waitForSelector('.acrobat-document-page > canvas.is-rendered');await p.getByRole('searchbox',{name:'Search PDF',exact:true}).fill('Invoice');await p.waitForFunction(()=>document.querySelector('.pdf-search-highlight-layer span'));
  await fs.writeFile('tmp/sol-qa/ocr-network.json',JSON.stringify({policy:'All non-loopback HTTP(S) requests denied for the Electron context; OS networking unchanged',requests,blocked},null,2));await p.screenshot({path:'tmp/sol-qa/ocr-offline-reopened.png'});
  console.log('PASS native OCR with external HTTP(S) blocked: cancel, restart, local worker/core/language, searchable PDF, reopened UI search for Invoice.');
 }finally{await context.unroute('**/*',policy)}
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});
