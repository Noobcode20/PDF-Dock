import fs from 'node:fs/promises';
import {createCanvas} from '@napi-rs/canvas';
import {PDFDocument,StandardFonts,rgb,degrees} from 'pdf-lib';
await fs.mkdir('tmp/sol-qa',{recursive:true});
const canvas=createCanvas(180,100),c=canvas.getContext('2d');c.fillStyle='#22a385';c.fillRect(0,0,180,100);c.fillStyle='#f6c345';c.beginPath();c.moveTo(30,20);c.lineTo(150,50);c.lineTo(30,80);c.fill();
const png=canvas.toBuffer('image/png');await fs.writeFile('tmp/sol-qa/arrow.png',png);
c.fillStyle='#2e61c9';c.fillRect(0,0,180,100);c.fillStyle='#fff';c.fillRect(10,10,50,30);await fs.writeFile('tmp/sol-qa/replacement.png',canvas.toBuffer('image/png'));
const doc=await PDFDocument.create(),font=await doc.embedFont(StandardFonts.Helvetica),bold=await doc.embedFont(StandardFonts.HelveticaBold),image=await doc.embedPng(png);
for(let i=0;i<5;i++){
 const p=doc.addPage([600,800]);p.drawText(`Page ${i+1} original short text`,{x:40,y:730,size:14,font});p.drawText('Multiple lines stay\nin their selected region',{x:40,y:685,size:12,lineHeight:18,font});
 p.drawRectangle({x:35,y:610,width:300,height:45,color:rgb(.95,.84,.6)});p.drawText('Nonwhite background text',{x:40,y:630,size:16,font:bold});
 p.drawImage(image,{x:70,y:380,width:180,height:100,rotate:degrees(i===2?30:0)});
 if(i===1){p.setCropBox(25,35,540,730);p.setRotation(degrees(90));}
 if(i===4)p.drawText('SECRET-SOL-49281',{x:40,y:270,size:18,font});
}
doc.getForm().createTextField('Name').addToPage(doc.getPage(0),{x:40,y:560,width:220,height:28});
const bytes=await doc.save();await fs.writeFile('tmp/sol-qa/master-input.pdf',bytes);await fs.writeFile('tmp/sol-qa/master-original.pdf',bytes);
await fs.copyFile('tmp/editor-qa/scanned.pdf','tmp/sol-qa/scanned.pdf');
console.log('Created five-page text/image/form, rotated crop, rotated source image and scanned OCR fixtures.');
