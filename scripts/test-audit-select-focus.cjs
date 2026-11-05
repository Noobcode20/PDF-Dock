const fs=require('node:fs/promises'), os=require('node:os'), path=require('node:path');
const {_electron:electron}=require('/opt/homebrew/lib/node_modules/openclaw/node_modules/playwright-core');
const {PDFDocument,StandardFonts}=require('pdf-lib');
(async()=>{
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),'pdfdock-review21-'));
 const env={...process.env,PDFKING_USE_BUILD:'1'};delete env.ELECTRON_RUN_AS_NODE;delete env.VITE_DEV_SERVER_URL;
 let app;const results=[];
 try{
 app=await electron.launch({executablePath:require('electron'),args:['.',`--user-data-dir=${path.join(temp,'profile')}`],env});
 const p=await app.firstWindow();p.setDefaultTimeout(12000);const errors=[];p.on('pageerror',e=>errors.push(e.message));
 const btn=n=>p.getByRole('button',{name:n,exact:true});
 const focus=()=>p.evaluate(()=>({tag:document.activeElement.tagName,id:document.activeElement.id,label:document.activeElement.getAttribute('aria-label'),text:document.activeElement.textContent.slice(0,70)}));
 const record=async(name,ok,details)=>{const r={name,pass:!!ok,details};results.push(r);console.log(JSON.stringify(r));};
 const fresh=async()=>{await p.reload();await btn('New document').waitFor();await btn('New document').click();await p.locator('.new-doc-page-setup [role=combobox]').first().waitFor();};
 await btn('Skip setup').click();await p.locator('.onboarding-panel').waitFor({state:'detached'});await fresh();
 const combos=p.locator('.new-doc-page-setup [role=combobox]');
 await combos.nth(0).click();await p.keyboard.press('Tab');await p.getByRole('listbox').waitFor({state:'detached'});await record('original modal Tab',await combos.nth(1).evaluate(n=>n===document.activeElement),await focus());
 await combos.nth(1).click();await p.keyboard.press('Shift+Tab');await record('modal reverse Tab',await combos.nth(0).evaluate(n=>n===document.activeElement),await focus());
 await combos.nth(0).focus();await p.keyboard.press('ArrowDown');await p.keyboard.press('End');await p.keyboard.press('ArrowDown');await record('arrow wraps End to first',await p.getByRole('option').first().evaluate(n=>n===document.activeElement),await focus());
 await p.keyboard.press('ArrowUp');await p.keyboard.press('Enter');await p.waitForFunction(()=>document.querySelector('.new-doc-page-setup [role=combobox]')===document.activeElement);await record('Enter selects Legal and restores trigger',(await combos.nth(0).innerText()).includes('Legal'),await focus());
 await combos.nth(0).click();await p.keyboard.press('Home');await p.keyboard.press('Escape');await p.waitForFunction(()=>!document.querySelector('[role=listbox]'));await p.waitForFunction(()=>document.querySelector('.new-doc-page-setup [role=combobox]')===document.activeElement);await record('Escape cancels selection without closing dialog',(await combos.nth(0).innerText()).includes('Legal')&&await combos.nth(0).evaluate(n=>n===document.activeElement),await focus());
 await combos.nth(0).click();await combos.nth(1).focus();await p.getByRole('listbox').waitFor({state:'detached'});await record('external focus dismisses',true,await focus());
 // Fixture controls inserted next to a real mounted select; application source remains unchanged.
 for(const kind of ['disabled','display-none','visibility-hidden','inert','disabled-tabindex']){
  await fresh();await combos.nth(0).evaluate((n,kind)=>{let b=document.createElement('button');b.id='probe-skip';b.textContent='skip';b.type='button';if(kind==='disabled'||kind==='disabled-tabindex')b.disabled=true;if(kind==='disabled-tabindex')b.tabIndex=0;if(kind==='display-none')b.style.display='none';if(kind==='visibility-hidden')b.style.visibility='hidden';if(kind==='inert')b.inert=true;n.closest('.themed-select-host').after(b)},kind);
  await combos.nth(0).click();await p.keyboard.press('Tab');await p.getByRole('listbox').waitFor({state:'detached'});await record(`Tab skips ${kind} fixture`,await combos.nth(1).evaluate(n=>n===document.activeElement),await focus());
 }
 for(const key of ['Tab','Shift+Tab']){
  await fresh();await combos.nth(0).evaluate(n=>{n.closest('.themed-select-host').setAttribute('role','dialog');n.style.outlineOffset='1px'});await p.waitForTimeout(150);await combos.nth(0).click();await p.keyboard.press(key);await p.getByRole('listbox').waitFor({state:'detached'});await record(`nested single-control modal wraps ${key}`,await combos.nth(0).evaluate(n=>n===document.activeElement),await focus());
 }
 await fresh();await combos.nth(0).evaluate(n=>{let s=n.closest('.new-doc-page-setup');s.setAttribute('role','dialog');n.style.outlineOffset='1px'});await p.waitForTimeout(150);await combos.nth(0).click();await p.keyboard.press('Tab');await record('nested modal forward stays inner',await combos.nth(1).evaluate(n=>n===document.activeElement),await focus());
 // Distinct first/last controls in nested dialog.
 await fresh();await combos.nth(0).evaluate(n=>{const s=n.closest('.new-doc-page-setup');s.setAttribute('role','dialog');s.style.outlineOffset='1px'});await p.waitForTimeout(150);
 await combos.nth(0).click();await p.keyboard.press('Shift+Tab');await record('nested first select Shift+Tab wraps to last input',await p.locator('.new-doc-page-setup input').evaluate(n=>n===document.activeElement),await focus());
 await p.locator('.new-doc-page-setup input').evaluate(n=>n.disabled=true);await combos.nth(1).click();await p.keyboard.press('Tab');await record('nested last select Tab wraps to first select',await combos.nth(0).evaluate(n=>n===document.activeElement),await focus());
 // Fixed-position portal geometry near a viewport edge and after resize.
 await fresh();await combos.nth(0).evaluate(n=>{n.style.position='fixed';n.style.top='650px';n.style.left='960px';n.style.width='160px'});
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1100,740));await combos.nth(0).click();
 const geometry=()=>p.evaluate(()=>{const r=document.querySelector('[role=listbox]').getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,w:innerWidth,h:innerHeight}});
 let g=await geometry();await record('popup fits edge viewport',g.x>=0&&g.y>=0&&g.right<=g.w&&g.bottom<=g.h,g);
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1000,720));await p.waitForTimeout(200);g=await geometry();await record('popup repositions after resize',g.x>=0&&g.y>=0&&g.right<=g.w&&g.bottom<=g.h,g);
 // Native real text-edit inspector, with no dialog open.
 await fresh();const pdf=await PDFDocument.create();const f=await pdf.embedFont(StandardFonts.Helvetica);pdf.addPage([600,800]).drawText('Review select text',{x:60,y:650,size:18,font:f});const file=path.join(temp,'text.pdf');await fs.writeFile(file,await pdf.save());await p.locator('.new-doc-backdrop input[type=file]').first().setInputFiles(file);await p.waitForSelector('canvas.is-rendered');await btn('Edit text').click();await p.locator('.pdf-text-layer span').filter({hasText:'Review select text'}).first().dblclick();
 const edit=p.getByRole('textbox',{name:'Replace PDF paragraph',exact:true});await edit.fill('Reviewed text preserved');
 const size=p.locator('.property-inspector').getByRole('spinbutton',{name:'Font size',exact:true});const height=p.locator('.property-inspector').getByRole('combobox',{name:'Line height',exact:true});
 await size.click();await p.keyboard.press('Tab');await record('outside dialog Tab advances and preserves active text',(await height.evaluate(n=>n===document.activeElement))&&await edit.isVisible()&&(await edit.innerText())==='Reviewed text preserved',await focus());
 await height.click();await p.keyboard.press('Shift+Tab');await record('outside dialog Shift+Tab returns size',await size.evaluate(n=>n===document.activeElement),await focus());
 await size.fill('24');await size.press('Tab');await record('inspector numeric size keeps active edit',await edit.isVisible()&&(await edit.innerText())==='Reviewed text preserved',{value:await size.inputValue()});
 // Compare browser-native closed-select traversal with popup traversal in the real inspector.
 const all=p.locator('.property-inspector [role=combobox]');
 for(let i=0;i<await all.count();i++)for(const key of ['Tab','Shift+Tab']){
  const c=all.nth(i);await c.focus();await p.keyboard.press(key);const expected=await focus();await c.click();await p.keyboard.press(key);const actual=await focus();await record(`native traversal parity ${await c.getAttribute('aria-label')} ${key}`,JSON.stringify(expected)===JSON.stringify(actual),{expected,actual});
 }
 // Capture scroll repositioning on the font menu without changing source layout.
 const family=p.locator('.property-inspector').getByRole('combobox',{name:'Font family',exact:true});await family.click();const beforeScroll=await geometry();await p.getByRole('listbox').evaluate(n=>n.scrollTop=50);await p.waitForTimeout(200);const afterScroll=await geometry();await record('portal stable on menu scrolling',Math.abs(beforeScroll.x-afterScroll.x)<2&&Math.abs(beforeScroll.y-afterScroll.y)<4,{beforeScroll,afterScroll});await p.keyboard.press('Escape');
 await edit.focus();await p.keyboard.press('Meta+Enter');await edit.waitFor({state:'detached'});await record('text commits after popup interactions',(await p.locator('.pdf-text-edit-preview').first().innerText()).includes('Reviewed text preserved'),await focus());
 await record('renderer errors',errors.length===0,errors);if(results.some(r=>!r.pass))process.exitCode=2;
 }finally{if(app){await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await app.close().catch(()=>{})}await fs.rm(temp,{recursive:true,force:true});await fs.writeFile('tmp/audit-select-focus-results.json',JSON.stringify(results,null,2)+'\n')}
})().catch(e=>{console.error(e);process.exitCode=1});
