import { PDFName, PDFDict, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import {pdfRect} from './coordinates.js';
/** Conservative source removal for one plain, untransformed WinAnsi Tj run.
 * Reject subset/custom fonts, TJ, Form XObjects, clipping, graphics transforms,
 * repeated candidates, or unsupported stream syntax. Never rewrite resources. */
export function removeSimpleTextRun(pdf,page,operation,frame) {
 if(operation.isNew||!operation.oldText||operation.oldText.includes('\n'))return false;
 const resources=page.node.Resources(), fonts=resources?.lookupMaybe(PDFName.of('Font'),PDFDict);
 if(!fonts?.lookup)return false;
 const contents=page.node.Contents();
 const refs=contents?.asArray ? contents.asArray() : contents ? [contents] : [];
 const cover=pdfRect(frame,{x:operation.coverX??operation.x,y:operation.coverY??operation.y,width:operation.coverWidth||operation.width,height:operation.coverHeight||operation.height});
 const candidates=[];
 for(const ref of refs){
  const stream=pdf.context.lookup(ref);if(!(stream instanceof PDFRawStream))continue;
  let source;try{source=new TextDecoder('latin1').decode(decodePDFRawStream(stream).decode())}catch{continue}
  // A graphics-state transform or external object can change text geometry.
  if(/\b(?:gs|W|W\*|Tr|Tz|Tc|Tw|Ts|BI)\b|%|[()]/.test(source))return false;
  const stateAt = end => {
    const prefix=source.slice(0,end).replace(/\bBT\b[\s\S]*?\bET\b/g,' '),stack=[];
    let matrix=[1,0,0,1,0,0];
    const num='(-?\\d+(?:\\.\\d+)?)';
    const pattern=new RegExp('(?:'+Array(6).fill(num).join('\\s+')+'\\s+cm)|\\b(q|Q)\\b','g');
    for(const command of prefix.matchAll(pattern)){
      if(command[7]==='q')stack.push([...matrix]);
      else if(command[7]==='Q'){if(!stack.length)return null;matrix=stack.pop()}
      else {const [a,b,c,d,e,f]=command.slice(1,7).map(Number),m=matrix;matrix=[m[0]*a+m[2]*b,m[1]*a+m[3]*b,m[0]*c+m[2]*d,m[1]*c+m[3]*d,m[0]*e+m[2]*f+m[4],m[1]*e+m[3]*f+m[5]]}
    }
    return {matrix,depth:stack.length};
  };
  const final=stateAt(source.length);
  if(!final||final.depth||final.matrix.some((v,i)=>Math.abs(v-[1,0,0,1,0,0][i])>1e-9))return false;
  for(const match of source.matchAll(/\bBT\b([\s\S]*?)\bET\b/g)){
   const state=stateAt(match.index);if(!state||state.matrix.some((v,i)=>Math.abs(v-[1,0,0,1,0,0][i])>1e-9))continue;
   const block=match[1], tf=block.match(/\/([A-Za-z0-9_-]+)\s+([\d.]+)\s+Tf\b/),tm=block.match(/1\s+0\s+0\s+1\s+(-?[\d.]+)\s+(-?[\d.]+)\s+Tm\b/),tjs=[...block.matchAll(/<([0-9a-fA-F]+)>\s+Tj\b/g)];
   if(/\bT\*/.test(block.slice(0,tjs[0]?.index||0)))continue;
   if(!tf||!tm||[...block.matchAll(/\bTf\b/g)].length!==1||[...block.matchAll(/\bTm\b/g)].length!==1||tjs.length!==1||/\b(?:TJ|Td|TD)\b|\(|'|"/.test(block))continue;
   const dict=fonts.lookup(PDFName.of(tf[1]));
   const base=dict?.get?.(PDFName.of('BaseFont'))?.toString();
   if(!/^\/(?:Helvetica|Times-Roman|Courier)(?:-Bold|-Oblique|-Italic|-BoldOblique|-BoldItalic)?$/.test(base||''))continue;
   if(dict.get(PDFName.of('ToUnicode'))||dict.get(PDFName.of('Encoding'))?.toString()!=='/WinAnsiEncoding')continue;
   // Only plain ASCII is recognized: no inference about Unicode/font encoding.
   if(!/^[\x20-\x7e]+$/.test(operation.oldText))continue;
   const text=tjs[0][1].match(/../g)?.map(h=>String.fromCharCode(parseInt(h,16))).join('');
   if(text!==operation.oldText)continue;
   const x=Number(tm[1]),y=Number(tm[2]),size=Number(tf[2]);
   if(x<cover.x-.5||x>cover.x+cover.width+.5||y<cover.y-size*.25||y>cover.y+cover.height+size*.25)continue;
   candidates.push({ref,source,index:match.index,length:match[0].length});
  }
 }
 if(candidates.length!==1)return false;
 const {ref,source,index,length}=candidates[0];
 const replacement=source.slice(0,index)+source.slice(index+length);
 const stream=pdf.context.flateStream(new TextEncoder().encode(replacement));
 const fresh=pdf.context.register(stream);
 page.node.set(PDFName.of('Contents'),pdf.context.obj(refs.map(r=>r===ref?fresh:r)));
 return true;
}
