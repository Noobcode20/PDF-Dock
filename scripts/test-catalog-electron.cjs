// Actual Electron catalog controls. Artifacts are read from UI-produced outputs;
// native Save is exercised separately by the master workflow.
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const {chromium}=require(process.env.PDFKING_PLAYWRIGHT||'playwright-core');
(async()=>{
 const {Document,Packer,Paragraph,TextRun,Table,TableRow,TableCell}=require('docx');
 await fs.writeFile('tmp/sol-qa/catalog.docx',await Packer.toBuffer(new Document({sections:[{children:[new Paragraph({children:[new TextRun({text:'Document conversion sample',bold:true})]}),new Paragraph('Long text and café remain editable.'),new Table({rows:[new TableRow({children:['Item','Amount'].map(s=>new TableCell({children:[new Paragraph(s)]}))}),new TableRow({children:['Invoice','123'].map(s=>new TableCell({children:[new Paragraph(s)]}))})]})]}]})));
 const XLSX=require('xlsx'),book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['Item','Amount'],['Invoice',123],['Long text café',456]]),'Data');await fs.writeFile('tmp/sol-qa/catalog.xlsx',XLSX.write(book,{type:'buffer',bookType:'xlsx'}));
 const browser=await chromium.connectOverCDP(process.env.PDFKING_CDP||'http://127.0.0.1:9224'),results=[];
 try{
  const p=browser.contexts()[0].pages().find(p=>p.url().includes(':5174'));
  const cases=[
   {name:'Merge PDF',files:['master-original.pdf','master-saved.pdf'],pages:10},
   {name:'Split PDF',pages:3},
   {name:'Extract pages',field:'Pages to extract',value:'1,3',pages:2},
   {name:'Duplicate pages',field:'Pages to duplicate',value:'1',pages:6},
   {name:'Delete pages',field:'Pages to remove',value:'2',pages:4},
   {name:'Organize pages',field:'Custom page order',value:'5,4,3,2,1',pages:5},
   {name:'Rotate pages',pages:5},
   {name:'Compress PDF',pages:5},
   {name:'Repair PDF',pages:5},
   {name:'Flatten PDF',files:['master-saved.pdf'],pages:5},
   {name:'PDF to Word',format:'docx'},
   {name:'Word to PDF',files:['catalog.docx'],pages:1},
   {name:'PDF to Excel',format:'xlsx'},
   {name:'Excel to PDF',files:['catalog.xlsx'],pages:1},
   {name:'PDF to JPG',format:'images'},
   {name:'JPG to PDF',files:['arrow.png','replacement.png'],pages:2},
   {name:'Protect PDF',password:true,encrypted:true},
   {name:'Unlock PDF',files:['catalog-protected.pdf'],unlock:true,pages:5},
  ];
  for(const test of cases){
   try{
    await p.reload();await p.getByRole('button',{name:'New document',exact:true}).first().waitFor();await p.getByRole('button',{name:/command palette/i}).click();await p.locator('.palette-input').fill(test.name);await p.locator('.palette-item.is-tool-command').filter({has:p.locator('strong').filter({hasText:new RegExp('^'+test.name+'$')})}).click();await p.locator('.tool-studio-page input[type=file]').setInputFiles((test.files||['master-original.pdf']).map(f=>path.resolve('tmp/sol-qa',f)));
    if(test.field)await p.getByRole('textbox',{name:new RegExp('^'+test.field)}).fill(test.value);
    if(test.password){await p.getByRole('textbox',{name:'New password',exact:true}).fill('sol-test-only-927');await p.getByRole('textbox',{name:'Confirm password',exact:true}).fill('sol-test-only-927')}
    if(test.unlock)await p.getByRole('textbox',{name:'Current PDF password',exact:true}).fill('sol-test-only-927');
    await p.locator('.primary-action-btn').click();await p.waitForFunction(()=>document.querySelector('.output-row')||document.querySelector('.operation-error'),undefined,{timeout:120000});
    const error=await p.locator('.operation-error').count()?await p.locator('.operation-error').textContent():null;if(error)throw Error(error);
    const outputs=await require('./electron-qa.cjs').captureUiBytes(p,true);
    const dir='tmp/sol-qa/catalog-'+test.name.replaceAll(' ','-');await fs.mkdir(dir,{recursive:true});
    for(const out of outputs){await fs.writeFile(path.join(dir,out.name),Buffer.from(out.data));if(out.mimeType==='application/pdf'&&!test.encrypted){const pdf=await require('pdf-lib').PDFDocument.load(Uint8Array.from(out.data));assert.equal(pdf.getPageCount(),test.pages)}}
    if(test.encrypted)await fs.writeFile('tmp/sol-qa/catalog-protected.pdf',Buffer.from(outputs[0].data));
    if(test.format==='docx'){const zip=await require('jszip').loadAsync(Buffer.from(outputs[0].data));const xml=await zip.file('word/document.xml').async('string');assert.ok(xml.includes('original short text'));await p.getByRole('button',{name:'Preview',exact:true}).last().click();await p.waitForSelector('section.docx-preview');await p.screenshot({path:dir+'/preview.png'})}
    if(test.format==='xlsx'){const b=XLSX.read(Buffer.from(outputs[0].data));assert.ok(b.SheetNames.length>0);const rows=XLSX.utils.sheet_to_json(b.Sheets[b.SheetNames[0]],{header:1});assert.ok(JSON.stringify(rows).includes('original short text'))}
    if(test.format==='images'){assert.equal(outputs.length,5);assert.ok(outputs.every(o=>o.data.length>1000))}
    results.push({tool:test.name,status:'PASS',outputs:outputs.map(o=>o.name),nativeSave:false});console.log('PASS catalog UI:',test.name,outputs.length,'outputs');
   }catch(e){results.push({tool:test.name,status:'FAIL',error:e.message});console.error('FAIL catalog UI:',test.name,e.message);}
  }
  await fs.writeFile('tmp/sol-qa/catalog-results.json',JSON.stringify(results,null,2));assert.ok(results.every(r=>r.status==='PASS'),'See catalog-results.json for failures');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
