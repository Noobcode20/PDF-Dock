import React, {useRef, useState} from 'react';
import {normalizedPoint, regionFromPoints, gestureRegion} from './coordinates';
/** Page-bound normalized object management. Commits one semantic edit per gesture. */
export function RegionLayer({items=[], drawing=false, active=true, selectedKey, onSelect=()=>{}, onChange=()=>{}, onAdd=()=>{}, label='Region', fill='rgba(20,100,200,.12)'}) {
 const layer=useRef(null),drag=useRef(null),[preview,setPreview]=useState(null);
 const start=(event,item=null,resize=false)=>{
  if(!active||event.button!==0)return;
  event.preventDefault();event.stopPropagation();event.currentTarget.setPointerCapture(event.pointerId);
  const p=normalizedPoint(layer.current.getBoundingClientRect(),event.clientX,event.clientY);
  drag.current={id:event.pointerId,start:p,item,resize}; if(item)onSelect(item);
 };
 const move=event=>{
  const g=drag.current;if(!g||g.id!==event.pointerId)return;
  const p=normalizedPoint(layer.current.getBoundingClientRect(),event.clientX,event.clientY);
  const rect=g.item?gestureRegion(g.item,p[0]-g.start[0],p[1]-g.start[1],g.resize):regionFromPoints(g.start,p);
  setPreview({...rect,key:g.item?.key||'live'});
 };
 const end=event=>{
  const g=drag.current;if(!g||g.id!==event.pointerId)return;
  const p=normalizedPoint(layer.current.getBoundingClientRect(),event.clientX,event.clientY);
  const rect=g.item?gestureRegion(g.item,p[0]-g.start[0],p[1]-g.start[1],g.resize):regionFromPoints(g.start,p);
  drag.current=null;setPreview(null);
  if(g.item){if(Math.abs(p[0]-g.start[0])+Math.abs(p[1]-g.start[1])>.001)onChange(rect)}
  else if(rect.width>.003&&rect.height>.003)onAdd(rect);
 };
 return <div ref={layer} style={{position:'absolute',inset:0,zIndex:12,pointerEvents:active?'auto':'none',touchAction:'none',cursor:drawing?'crosshair':undefined}}
  onPointerDown={e=>{if(drawing&&e.target===e.currentTarget)start(e)}} onPointerMove={move} onPointerUp={end} onPointerCancel={()=>{drag.current=null;setPreview(null)}}>
  {[...items,...(preview?.key==='live'?[preview]:[])].map(item=>{
   const r=preview?.key===item.key?preview:item;
   return <div key={item.key} role="button" tabIndex={active?0:-1} aria-label={`${label}: ${item.name||item.key}`}
    style={{position:'absolute',left:`${r.x*100}%`,top:`${r.y*100}%`,width:`${r.width*100}%`,height:`${r.height*100}%`,background:fill,border:`${selectedKey===item.key?2:1}px solid #2381dd`,boxSizing:'border-box',pointerEvents:active?'auto':'none'}}
    onPointerDown={e=>start(e,item)} onKeyDown={e=>{if(e.key==='Enter')onSelect(item)}}>
    {label==='Field'&&<span style={{fontSize:11,color:'#173a67',lineHeight:1,pointerEvents:'none'}}>{item.name}</span>}
    {selectedKey===item.key&&active&&<button type="button" aria-label={`Resize ${label.toLowerCase()}`} style={{position:'absolute',right:-4,bottom:-4,width:10,height:10,padding:0,background:'#2381dd',cursor:'nwse-resize'}} onPointerDown={e=>start(e,item,true)}/>}
   </div>
  })}
 </div>;
}
