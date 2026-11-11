import fs from 'node:fs/promises';
import { PDFDocument, PDFArray, decodePDFRawStream } from 'pdf-lib';
import { applyOperations } from '../../../src/editor/operations.js';
import { createTextInputHistory, recordTextInput } from '../../../src/editor/textInputHistory.js';
import { layoutStyledText } from '../../../src/editor/styledText.js';
const results={};
const base=await PDFDocument.create();base.addPage([612,792]);const input=await base.save();
async function content(bytes){const p=await PDFDocument.load(bytes);const c=p.getPage(0).node.Contents();const streams=c instanceof PDFArray?c.asArray():[c];return streams.map(ref=>Buffer.from(decodePDFRawStream(p.context.lookup(ref)).decode()).toString()).join('\n');}
const op={type:'text',page:1,isNew:true,x:.1,y:.1,width:.8,height:.3,text:'ABCD',fontSize:20,fontFamily:'Helvetica'};
const zero=await applyOperations(input,[{...op,letterSpacingPt:0}]);const spaced=await applyOperations(input,[{...op,letterSpacingPt:5}]);
results.tracking={identicalPageContent:await content(zero)===await content(spaced),hasTcOperator:/\bTc\b/.test(await content(spaced)),stream:await content(spaced)};
let h=createTextInputHistory({value:'Text',opacity:1,lineHeightScale:.02});h=recordTextInput(h,{value:'Text',opacity:.5,lineHeightScale:.04});results.history={undoEntries:h.past.length,presentOpacity:h.present.opacity};
const withFields=await applyOperations(input,[{type:'form-create',kind:'text',name:'Outside',page:1,x:.9,y:.2,width:.3,height:.05}]);const loaded=await PDFDocument.load(withFields);results.offPageField=loaded.getForm().getTextField('Outside').acroField.getWidgets()[0].getRectangle();
const pdf=await PDFDocument.create();const a=await layoutStyledText(pdf,'AA AA',{fontFamily:'Helvetica',fontSize:20,letterSpacingPt:0},{},20,75);const b=await layoutStyledText(pdf,'AA AA',{fontFamily:'Helvetica',fontSize:20,letterSpacingPt:10},{},20,75);results.wrap={zero:a.map(x=>({width:x.width,text:x.runs.map(r=>r.text).join('')})),spaced:b.map(x=>({width:x.width,text:x.runs.map(r=>r.text).join('')}))};
await fs.writeFile(new URL('./probe-results.json',import.meta.url),JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));
