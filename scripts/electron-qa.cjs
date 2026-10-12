/** Read-only capture of bytes already produced by visible Electron controls.
 * Resolve the committed Fiber root: a DOM Fiber's return chain can reference
 * React's alternate tree and otherwise expose the previous document revision. */
async function captureUiBytes(page, outputs=false) {
 return page.evaluate(async outputs=>{
  const node=document.querySelector(outputs?'.tool-studio-page':'.pdf-editor-workspace');
  let root=node?.[Object.keys(node).find(k=>k.startsWith('__reactFiber'))];
  if(!root)throw Error('Editor UI is unavailable');while(root.return)root=root.return;
  const stack=[root.stateNode.current],name=outputs?'ToolStudioPage':'PdfEditorWorkspace';
  while(stack.length){const fiber=stack.pop();if(!fiber)continue;
   if(fiber.type?.name===name){for(let h=fiber.memoizedState;h;h=h.next){const value=h.memoizedState;
    if(Array.isArray(value)&&value[0] instanceof File&&!outputs)return Array.from(new Uint8Array(await value[0].arrayBuffer()));
    if(outputs&&Array.isArray(value)&&value[0]?.data)return value.map(o=>({name:o.name,mimeType:o.mimeType,data:Array.from(o.data)}));
   }}if(fiber.sibling)stack.push(fiber.sibling);if(fiber.child)stack.push(fiber.child);
  }throw Error('Current UI-produced bytes are missing');
 },outputs);
}
module.exports={captureUiBytes};
