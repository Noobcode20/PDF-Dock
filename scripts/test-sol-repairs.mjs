import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {PDFDocument,PDFName,PDFArray,PDFDict,PDFNumber,StandardFonts,degrees,rgb} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import {createCanvas} from '@napi-rs/canvas';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import {applyOperations} from '../src/editor/operations.js';
import {displayFrame,displayRect,transformPoint,inversePoint,imagePlacement,normalizedPoint,gestureRegion} from '../src/editor/coordinates.js';
import {createDocumentSession,revisedSession} from '../src/editor/documentSession.js';
import {captureRevision,assertRevision,sessionAfterWrite} from '../src/editor/revisionGuard.js';
const original=new Uint8Array(await fs.readFile('tmp/sol-qa/master-original.pdf'));
const assets={unicode:new Uint8Array(await fs.readFile('public/fonts/NotoSans-Regular.ttf')),devanagari:new Uint8Array(await fs.readFile('public/fonts/NotoSansDevanagari-Regular.ttf'))};
const apply=ops=>applyOperations(original,ops,{fonts:assets});
async function extracted(bytes,page=1){const task=pdfjs.getDocument({data:bytes.slice(),useSystemFonts:true});try{return(await(await(await task.promise).getPage(page)).getTextContent()).items.map(i=>i.str).join(' ')}finally{await task.destroy()}}
const source=await PDFDocument.load(original);
for(const rotation of [0,90,180,270])for(const extra of [0,90,180,270])for(const zoom of [.25,.75,1,2,5]){
 const page=source.getPage(0);page.setCropBox(25,35,540,730);page.setRotation(degrees(rotation));const frame=displayFrame(page,extra);
 const task=pdfjs.getDocument({data:await source.save(),useSystemFonts:true});const doc=await task.promise;const v=(await doc.getPage(1)).getViewport({scale:zoom,rotation:rotation+extra});
 for(const point of [[0,0],[.23,.41],[1,1]]){
  const pdf=transformPoint(frame.matrix,point[0]*frame.width,(1-point[1])*frame.height),expected=v.convertToPdfPoint(point[0]*v.width,point[1]*v.height);
  assert.ok(pdf.every((n,i)=>Math.abs(n-expected[i])<1e-8));const back=inversePoint(frame.matrix,...pdf);assert.ok(Math.abs(back[0]/frame.width-point[0])<1e-8&&Math.abs(1-back[1]/frame.height-point[1])<1e-8);
 }
 await task.destroy();
}
assert.deepEqual(normalizedPoint({left:5,top:10,width:100,height:200},55,110),[.5,.5]);
assert.throws(()=>normalizedPoint({width:0,height:2},0,0));
assert.equal(gestureRegion({x:.2,y:.3,width:.1,height:.2},.2,.1).x,.4);
const file={},session=createDocumentSession(),lease=captureRevision(session,file);
assertRevision(lease,session,file);
assert.throws(()=>assertRevision(lease,revisedSession(session,'edit'),file),{name:'AbortError'});
assert.throws(()=>assertRevision(lease,createDocumentSession(),file),{name:'AbortError'});
assert.throws(()=>assertRevision(lease,session,{}),{name:'AbortError'});
const newer=revisedSession(session,'edit'),saved=sessionAfterWrite(newer,session,'/saved.pdf');assert.equal(saved.revision,newer.revision);assert.equal(saved.savedRevision,session.revision);
assert.equal(sessionAfterWrite(createDocumentSession(),session,'/wrong.pdf').sourcePath,null);
// Supported plain run removes source, while complex/subset cases stay visual.
const replacement=await apply([{type:'text',page:1,x:.06,y:.07,width:.5,height:.035,text:'Repaired short text',oldText:'Page 1 original short text',sourceLineCount:1,fontSize:14,isNew:false}]);
const replacementText=await extracted(replacement);
assert.ok(replacementText.includes('Repaired short text'));assert.ok(!replacementText.includes('Page 1 original short text'));
assert.ok(replacementText.includes('Multiple lines stay'));assert.ok(replacementText.includes('Nonwhite background text'));
const visual=await apply([{type:'text',page:1,x:.06,y:.07,width:.5,height:.035,text:'Visual edit',oldText:'Ambiguous unknown encoding',sourceLineCount:1,fontSize:14,isNew:false}]);assert.ok((await extracted(visual)).includes('Page 1 original short text'));
await assert.rejects(apply([{type:'text',page:1,x:.1,y:.1,width:.1,height:.02,text:'This long single line cannot fit',sourceLineCount:1,fontSize:14}]),/exceeds/);
const customDoc=await PDFDocument.create();customDoc.registerFontkit(fontkit);
const customFont=await customDoc.embedFont(assets.unicode,{subset:true});const customPage=customDoc.addPage([600,800]);
customPage.drawText('Custom subset source text',{x:40,y:730,size:16,font:customFont});
customPage.drawRectangle({x:35,y:610,width:300,height:45,color:rgb(.95,.84,.6)});
customPage.drawText('Nonwhite background text',{x:40,y:630,size:16,font:customFont});
customPage.drawText('Custom first line\ncustom second line',{x:40,y:560,size:16,lineHeight:20,font:customFont});
const customSource=await customDoc.save();
const customReplaced=await applyOperations(customSource,[{type:'text',page:1,x:.06,y:.08,width:.5,height:.035,text:'Custom replacement',oldText:'Custom subset source text',fontSize:16,isNew:false}],{});
const customReplacedText=await extracted(customReplaced);
assert.ok(customReplacedText.includes('Custom replacement'));assert.ok(!customReplacedText.includes('Custom subset source text'));
assert.ok(customReplacedText.includes('Nonwhite background text'));assert.ok(customReplacedText.includes('Custom first line'));
const multiline=await applyOperations(customSource,[{type:'text',page:1,x:.06,y:.27,width:.5,height:.075,text:'Multiline replacement',oldText:'Custom first line\ncustom second line',sourceLineCount:2,fontSize:16,isNew:false}],{});
const multilineText=await extracted(multiline);
assert.ok(multilineText.includes('Multiline replacement'));assert.ok(!multilineText.includes('Custom first line'));assert.ok(!multilineText.includes('custom second line'));
assert.ok(multilineText.includes('Custom subset source text'));assert.ok(multilineText.includes('Nonwhite background text'));
const covered=await applyOperations(customSource,[{type:'text',page:1,x:.055,y:.18,width:.51,height:.055,text:'',oldText:'Nonwhite background text',fontSize:16,isNew:false,backgroundColor:'#FFFFFF',sourceCoverRects:[{x:.055,y:.18,width:.51,height:.055,backgroundColor:'#FFFFFF'}]}],{});
const coveredText=await extracted(covered);
assert.ok(!coveredText.includes('Nonwhite background text'));
assert.ok(coveredText.includes('Custom subset source text'));assert.ok(coveredText.includes('Custom first line'));
const differencesMade=await PDFDocument.create();const differencesMadePage=differencesMade.addPage([612,792]);const differencesFont=await differencesMade.embedFont(StandardFonts.Helvetica);
differencesMadePage.drawText('\u00e9\u00e9\u00e9',{x:40,y:700,size:16,font:differencesFont});
differencesMadePage.drawText('Neighbor text stays',{x:40,y:670,size:16,font:differencesFont});
const differencesDoc=await PDFDocument.load(await differencesMade.save());
const differencesFonts=differencesDoc.getPage(0).node.Resources().lookup(PDFName.of('Font'),PDFDict);let differencesFontDict=null;
for(const [,value] of differencesFonts.entries()){const candidate=differencesDoc.context.lookup(value,PDFDict);if(candidate){differencesFontDict=candidate;break}}
assert.ok(differencesFontDict);
const differences=PDFArray.withContext(differencesDoc.context);
for(const code of new Set([...'Neighbor text stays'].map(ch=>ch.charCodeAt(0)))){differences.push(PDFNumber.of(code));differences.push(PDFName.of(code===32?'space':String.fromCharCode(code)))}
differences.push(PDFNumber.of(0xE9));differences.push(PDFName.of('z'));
const differencesEncoding=PDFDict.withContext(differencesDoc.context);differencesEncoding.set(PDFName.of('Type'),PDFName.of('Encoding'));differencesEncoding.set(PDFName.of('BaseEncoding'),PDFName.of('WinAnsiEncoding'));differencesEncoding.set(PDFName.of('Differences'),differences);
differencesFontDict.set(PDFName.of('Encoding'),differencesEncoding);
const differencesSource=await differencesDoc.save();
assert.ok((await extracted(differencesSource)).includes('zzz'));
const differencesRepaired=await applyOperations(differencesSource,[{type:'text',page:1,x:.06,y:.1,width:.5,height:.035,text:'Differences repaired',oldText:'zzz',sourceLineCount:1,fontSize:16,isNew:false}],{});
const differencesText=await extracted(differencesRepaired);
assert.ok(!differencesText.includes('zzz'));assert.ok(differencesText.includes('Differences repaired'));assert.ok(differencesText.includes('Neighbor text stays'));
const pixel=async(bytes,x,y)=>{const task=pdfjs.getDocument({data:bytes.slice()});try{const page=await(await(await task.promise).getPage(1));const viewport=page.getViewport({scale:1});const canvas=createCanvas(viewport.width,viewport.height),ctx=canvas.getContext('2d');await page.render({canvasContext:ctx,viewport}).promise;return Array.from(ctx.getImageData(x,viewport.height-y,1,1).data)}finally{await task.destroy()}};
const beforePixel=await pixel(customSource,300,620),afterPixel=await pixel(covered,300,620);
assert.ok(beforePixel.slice(0,3).every((value,index)=>Math.abs(value-afterPixel[index])<=2),'removing text must not paint over the source background');
// Native fields remain interactive through creation, edit, rename and deletion.
let fields=await apply(['text','checkbox','dropdown','list','radio'].map((kind,i)=>({type:'form-create',kind,name:`new_${kind}`,page:1,x:.1,y:.3+i*.09,width:.4,height:.05,choices:['A','B'],multiline:kind==='text',required:true})));
let pdf=await PDFDocument.load(fields);assert.equal(pdf.getForm().getFields().length,6);assert.equal(pdf.getForm().getRadioGroup('new_radio').getOptions().length,2);
const field=pdf.getForm().getTextField('new_text'),widget=field.acroField.getWidgets()[0],widgetId=`${pdf.context.getObjectRef(widget.dict).objectNumber}R`;
fields=await applyOperations(fields,[{type:'form-update',page:1,originalName:'new_text',name:'Renamed',widgetId,x:.2,y:.25,width:.3,height:.08,multiline:true},{type:'forms',page:1,values:{Renamed:'Filled after reopen',new_checkbox:true,new_dropdown:'B',new_list:['A'],new_radio:'B'}}],{fonts:assets});
pdf=await PDFDocument.load(fields);assert.equal(pdf.getForm().getTextField('Renamed').getText(),'Filled after reopen');assert.equal(pdf.getForm().getTextField('Renamed').acroField.getWidgets()[0].getRectangle().width,180);assert.equal(pdf.getForm().getRadioGroup('new_radio').getSelected(),'B');
fields=await applyOperations(fields,[{type:'form-update',page:1,name:'new_checkbox',deleted:true}]);assert.equal((await PDFDocument.load(fields)).getForm().getFields().length,5);
await assert.rejects(apply([{type:'form-create',page:1,name:'Name',kind:'text',x:.1,y:.1,width:.2,height:.03}]),/already exists/);
const frame={width:800,height:600},op={x:.2,y:.3,width:.3,height:.2,original:{x:.1,y:.2,width:.2,height:.3},replacementData:new Uint8Array([1]),imageTransform:[0,.3,-.2,0,.3,.2]};
// The placement maps the source unit square onto the rect: (0,0) is the bottom
// left of the rect in frame points and (1,1) is its top right.
const matrix=imagePlacement(frame,op),origin=transformPoint(matrix,0,0),far=transformPoint(matrix,1,1);assert.ok(Math.abs(origin[0]-op.x*frame.width)<1e-7);assert.ok(Math.abs(origin[1]-(1-op.y-op.height)*frame.height)<1e-7);assert.ok(Math.abs(far[0]-(op.x+op.width)*frame.width)<1e-7);assert.ok(Math.abs(far[1]-(1-op.y)*frame.height)<1e-7);
await fs.writeFile('tmp/sol-qa/engine-repaired.pdf',replacement);await fs.writeFile('tmp/sol-qa/engine-forms.pdf',fields);
console.log('PASS repair regressions: 80 rotated/cropped/zoom frames, revision fences/save race, constrained text removal/visual fallback/overflow, custom-font, custom-encoding and multiline source erasure, background-preserving fallback, five interactive field kinds, widget geometry/rename/delete, affine image placement.');
