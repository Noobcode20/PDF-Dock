/** Decode/crop locally, then use the SAME image operation path as ordinary
 * placement. Crop must never send a transformed image to the legacy writer. */
export async function prepareImageOperations(operations, signal) {
 const output=[];
 for(const operation of operations){
  signal?.throwIfAborted();
  if(operation.type!=='image'||operation.deleted||!Object.values(operation.crop||{}).some(Number)){output.push(operation);continue}
  const data=operation.replacementData||operation.sourceData;
  if(!data)throw new Error('The image source has not loaded. Select it again before cropping.');
  const blob=data instanceof Blob?data:new Blob([data],{type:operation.replacementType||'image/png'});
  const bitmap=await createImageBitmap(blob);
  try {
   const crop=operation.crop,top=(Number(crop.top)||0)/100,left=(Number(crop.left)||0)/100,
     width=1-left-(Number(crop.right)||0)/100,height=1-top-(Number(crop.bottom)||0)/100;
   if(width<=0||height<=0)throw new Error('Keep a nonempty image crop.');
   const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*width));canvas.height=Math.max(1,Math.round(bitmap.height*height));
   canvas.getContext('2d').drawImage(bitmap,bitmap.width*left,bitmap.height*top,bitmap.width*width,bitmap.height*height,0,0,canvas.width,canvas.height);
   const cropped=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));canvas.width=0;canvas.height=0;
   if(!cropped)throw new Error('Could not encode cropped image.');
   signal?.throwIfAborted();
   output.push({...operation,replacementData:new Uint8Array(await cropped.arrayBuffer()),replacementType:'image/png',crop:{},imageTransform:operation.replacementData?operation.imageTransform:undefined});
  } finally {bitmap.close()}
 }
 return output;
}
