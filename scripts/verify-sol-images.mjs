import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createCanvas,loadImage} from '@napi-rs/canvas';
execFileSync('pdftoppm',['-f','2','-l','3','-cropbox','-r','96','-png','tmp/sol-qa/images-ui.pdf','tmp/sol-qa/image-independent']);
async function blueBox(file,frame){
 const image=await loadImage(file),canvas=createCanvas(image.width,image.height),ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);const data=ctx.getImageData(0,0,image.width,image.height).data;
 const scale=2,b=frame?{x:frame.x*scale,y:frame.y*scale,width:frame.width*scale,height:frame.height*scale}:{x:0,y:0,width:image.width,height:image.height};
 let left=Infinity,top=Infinity,right=-1,bottom=-1;
 for(let y=Math.max(0,Math.floor(b.y));y<Math.min(image.height,b.y+b.height);y++)for(let x=Math.max(0,Math.floor(b.x));x<Math.min(image.width,b.x+b.width);x++){
  const i=(y*image.width+x)*4;if(data[i]<100&&data[i+1]<140&&data[i+2]>150){left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x);bottom=Math.max(bottom,y)}
 }
 assert.ok(Number.isFinite(left),`Visible replacement pixels missing: ${file}`);
 return [(left-b.x)/b.width,(top-b.y)/b.height,(right+1-b.x)/b.width,(bottom+1-b.y)/b.height];
}
for(const page of [2,3]){
 const preview=await blueBox(`tmp/sol-qa/image-preview-page${page}.png`,JSON.parse(await fs.readFile(`tmp/sol-qa/image-preview-page${page}.json`)));
 const reopened=await blueBox(`tmp/sol-qa/image-reopened-page${page}.png`,JSON.parse(await fs.readFile(`tmp/sol-qa/image-reopened-page${page}.json`)));
 const independent=await blueBox(`tmp/sol-qa/image-independent-${page}.png`);
 for(const box of [preview,reopened])assert.ok(Math.max(...box.map((n,i)=>Math.abs(n-independent[i])))<.006,JSON.stringify({page,preview,reopened,independent}));
}
console.log('PASS independent Poppler: native preview and reopened image bounds agree within 0.6% of each page on 90-degree cropped page and 30-degree source image.');
