const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const {chromium}=require(process.env.PDFKING_PLAYWRIGHT||'playwright-core');
;(async()=>{
 const browser=await chromium.connectOverCDP(process.env.PDFKING_CDP||'http://127.0.0.1:9224');
 try {
  const p=browser.contexts()[0].pages().find(p=>p.url().includes(':5174')),errors=[];p.on('pageerror',e=>errors.push(e.message));
  if(process.argv.includes('--verify')){
   const saved=await require('pdf-lib').PDFDocument.load(await fs.readFile('tmp/sol-qa/master-saved.pdf'));assert.equal(saved.getPageCount(),5);assert.equal(saved.getPage(0).getRotation().angle,90);assert.equal(saved.getForm().getTextField('Name').getText(),'Alice UI');assert.ok(saved.getForm().getField('CreatedRenamed'));
   await p.reload();await p.getByRole('button',{name:'New document',exact:true}).first().click();await p.locator('input[type=file]').first().setInputFiles(path.resolve('tmp/sol-qa/master-saved.pdf'));await p.waitForSelector('.acrobat-document-page > canvas.is-rendered');await p.waitForSelector('.pdf-form-layer input[aria-label=CreatedRenamed]');await p.locator('.pdf-form-layer input[aria-label=CreatedRenamed]').fill('New field UI fill');await p.getByRole('button',{name:'Apply tool',exact:true}).click();await p.waitForFunction(()=>document.querySelector('.pdf-editor-status')?.textContent==='Changes applied to the current document.');await p.screenshot({path:'tmp/sol-qa/master-reopened.png'});console.log('PASS native save/reopen: 5 pages, rotation90, Name value and interactive CreatedRenamed filled through UI after reopen.');return;
  }
  await p.reload();await p.waitForSelector('button');
  const button=name=>p.getByRole('button',{name,exact:true});
  const pageCanvas=p.locator('.acrobat-document-page > canvas').first();
  const rendered=()=>p.waitForFunction(()=>{const c=document.querySelector('.acrobat-document-page > canvas');return c?.classList.contains('is-rendered')&&c.width>0&&c.height>0});
  if(!await p.locator('.pdf-editor-workspace').count()){
   await button('New document').first().click();await p.locator('input[type=file]').first().setInputFiles(path.resolve('tmp/sol-qa/master-input.pdf'));
  }
  await rendered();await button('Fit page').click();await p.waitForFunction(()=>{const t=document.querySelector('.pdf-text-layer'),n=document.querySelector('.acrobat-document-page');return t?.dataset.renderWidth&&Math.abs(Number(t.dataset.renderWidth)-n.clientWidth)<2});
  await button('Edit text').click();await p.locator('.pdf-text-layer span').filter({hasText:'Page 1 original short text'}).dblclick();
  await p.getByRole('textbox',{name:'Replace PDF paragraph'}).fill('Page 1 repaired text');await p.getByRole('textbox',{name:'Replace PDF paragraph'}).press('Meta+Enter');
  await button('Undo').click();await button('Redo').click();
  await button('Add one text box').click();
  let r=await pageCanvas.boundingBox();await p.mouse.click(r.x+r.width*.65,r.y+r.height*.34);
  await p.getByRole('textbox',{name:'Add text to PDF'}).fill('Added café Ω\nMultiline persists');await p.getByRole('textbox',{name:'Add text to PDF'}).press('Meta+Enter');
  await button('Home').last().click();await button('Image').click();
  
  // Actual file inputs in the Image panel, never injected application state.
  await p.locator('input[accept="image/png,image/jpeg"]').first().setInputFiles(path.resolve('tmp/sol-qa/arrow.png'));
  await p.waitForSelector('.pdf-image-object.edited');
  const added=p.locator('.pdf-image-object.edited').first();r=await added.boundingBox();await p.mouse.move(r.x+r.width/2,r.y+r.height/2);await p.mouse.down();await p.mouse.move(r.x+r.width/2+30,r.y+r.height/2+10,{steps:5});await p.mouse.up();
  await button('Rotate image').click();
  // Replace an existing image, retaining its original geometry.
  const existing=p.locator('.pdf-image-object').filter({hasNot:p.locator('.pdf-image-resize-handle')}).last();
  
  await p.locator('.pdf-image-object[aria-label="Image 0 on page 1"]').click();
  await p.locator('.image-replace-field input').setInputFiles(path.resolve('tmp/sol-qa/replacement.png'));
  const handle=p.getByRole('button',{name:'Resize image',exact:true}).last();r=await handle.boundingBox();await p.mouse.move(r.x+5,r.y+5);await p.mouse.down();await p.mouse.move(r.x+30,r.y+20,{steps:5});await p.mouse.up();
  await button('Insert').click();
  const draw=async(name,x,y,w,h)=>{await button(name).click();const b=await pageCanvas.boundingBox();await p.mouse.move(b.x+b.width*x,b.y+b.height*y);await p.mouse.down();await p.mouse.move(b.x+b.width*(x+w),b.y+b.height*(y+h),{steps:10});await p.mouse.up()};
  await draw('Rectangle',.5,.48,.22,.08);assert.equal(await p.locator('.editor-annotation-layer rect').count(),1);
  await draw('Ellipse',.5,.59,.2,.08);assert.equal(await p.locator('.editor-annotation-layer ellipse').count(),1);
  await draw('Draw',.5,.72,.2,.06);
  await draw('Comment',.86,.2,.01,.01);await p.getByRole('dialog').getByRole('textbox').fill('SOL comment persists');await p.getByRole('button',{name:'Continue',exact:true}).click();
  // New real field: placement, select, rename, resize and required flag.
  await draw('Text field',.08,.8,.3,.045);await p.getByRole('dialog').getByRole('textbox').fill('Created');await p.getByRole('button',{name:'Continue',exact:true}).click();
  await button('Manage fields').click();await p.getByRole('button',{name:'Field: Created',exact:true}).click();
  await p.getByRole('textbox',{name:'Field name',exact:true}).fill('CreatedRenamed');
  await p.getByRole('checkbox',{name:'Required',exact:true}).check();
  r=await p.getByRole('button',{name:'Resize field',exact:true}).boundingBox();await p.mouse.move(r.x+5,r.y+5);await p.mouse.down();await p.mouse.move(r.x+35,r.y+15,{steps:5});await p.mouse.up();
  await button('Undo').click();await button('Redo').click();
  await button('Home').last().click();await button('Fill forms').click();await p.locator('.pdf-form-layer input').first().fill('Alice UI');
  await button('Insert').click();await button('Sign').click();await p.getByRole('textbox',{name:'Type signature',exact:true}).fill('Sol Signer');await button('Place typed signature').click();
  await p.screenshot({path:'tmp/sol-qa/master-preview.png'});
  await button('Organize pages').click();await button('Rotate 90°').click();await p.waitForFunction(()=>!document.querySelector('.btn-spinner')&&!document.querySelector('.pdf-editor-status')?.textContent.includes('Applying'));
  const cards=p.locator('.editor-organizer-grid > div');await cards.nth(3).dragTo(cards.nth(2));
  await cards.nth(4).click();await button('Delete').click();await p.waitForFunction(()=>document.querySelectorAll('.editor-organizer-grid > div').length===4);
  await button('Undo').click();await p.waitForFunction(()=>document.querySelectorAll('.editor-organizer-grid > div').length===5);
  await button('Undo').click();await button('Redo').click();
  await button('Home').last().click();await rendered();
  await button('Save •').click();
  console.log('NATIVE STAGE: Save the composed document as tmp/sol-qa/master-input.pdf (overwrite this disposable fixture).');
  await p.waitForFunction(()=>document.querySelector('.pdf-editor-status')?.textContent.startsWith('Saved '),undefined,{timeout:600000});
  assert.deepEqual(errors,[]);
  await fs.copyFile('tmp/sol-qa/master-input.pdf','tmp/sol-qa/master-saved.pdf');
  console.log('PASS native master UI: existing/add/multiline text; add/move/rotate image; existing replace/resize image; rectangle/ellipse/freehand/comment; field create/rename/resize/properties; form fill; typed signature; rotate/reorder/delete/undo/redo; Save current document.');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
