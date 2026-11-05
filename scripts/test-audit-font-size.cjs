const fs=require('node:fs/promises'), os=require('node:os'), path=require('node:path');
const {_electron:electron}=require('/opt/homebrew/lib/node_modules/openclaw/node_modules/playwright-core');
const {PDFDocument,StandardFonts}=require('pdf-lib');
(async()=>{
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),'pdfdock-review21-'));
 const env={...process.env,PDFKING_USE_BUILD:'1'};delete env.ELECTRON_RUN_AS_NODE;delete env.VITE_DEV_SERVER_URL;
 let app;
 try{
 app=await electron.launch({executablePath:require('electron'),args:['.',`--user-data-dir=${path.join(temp,'profile')}`],env});
 const p=await app.firstWindow();p.setDefaultTimeout(12000);const errors=[];p.on('pageerror',e=>errors.push(e.message));
 const btn=n=>p.getByRole('button',{name:n,exact:true});
 const fresh=async()=>{await p.reload();await btn('New document').waitFor();await btn('New document').click();await p.locator('.new-doc-page-setup [role=combobox]').first().waitFor();};
 await btn('Skip setup').click();await p.locator('.onboarding-panel').waitFor({state:'detached'});
 // Native real text-edit inspector, with no dialog open.
 await fresh();const pdf=await PDFDocument.create();const f=await pdf.embedFont(StandardFonts.Helvetica);pdf.addPage([600,800]).drawText('Review select text',{x:60,y:650,size:18,font:f});const file=path.join(temp,'text.pdf');await fs.writeFile(file,await pdf.save());await p.locator('.new-doc-backdrop input[type=file]').first().setInputFiles(file);await p.waitForSelector('canvas.is-rendered');await btn('Edit text').click();await p.locator('.pdf-text-layer span').filter({hasText:'Review select text'}).first().dblclick();
 const edit=p.getByRole('textbox',{name:'Replace PDF paragraph',exact:true});await edit.fill('Reviewed text preserved');
 const size=p.locator('.property-inspector').getByRole('spinbutton',{name:'Font size',exact:true});
 const ribbon=p.locator('.pdf-text-format-ribbon').getByRole('spinbutton',{name:'Font size',exact:true});
 const assert=require('node:assert/strict');
 await size.fill('13');await size.press('Tab');assert.equal(await size.inputValue(),'13');assert.equal(await ribbon.inputValue(),'13');
 await ribbon.fill('22.5');await ribbon.press('Tab');assert.equal(await size.inputValue(),'22.5');
 await size.fill('999');await size.press('Tab');assert.equal(await size.inputValue(),'22.5');
 await size.fill('');await size.press('Tab');assert.equal(await size.inputValue(),'22.5');
 await edit.focus();await p.keyboard.press('Meta+Enter');await edit.waitFor({state:'detached'});
 assert.deepEqual(errors,[]);console.log('PASS inspector and ribbon custom 13/22.5 point sizes synchronize; invalid/empty sizes restore; text commits; no renderer errors');
 }finally{if(app){await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await app.close().catch(()=>{})}await fs.rm(temp,{recursive:true,force:true})}
})().catch(e=>{console.error(e);process.exitCode=1});
