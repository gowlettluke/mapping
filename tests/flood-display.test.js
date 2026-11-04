import test from 'node:test';
import assert from 'node:assert/strict';
import {floodLabelBoxes,floodLegendLayout,drawWarningFocus,warningFocusLegend} from '../js/flood-display.js';
import {layoutOutageLabels} from '../js/map-labels.js';
import {projectedBounds} from '../js/geometry.js';

test('the focus outline traces only selected notice geometry and identifies the selected warning/watch',()=>{
  const strokes=[],labels=[];let points=[],dash=[];const ctx={save(){},restore(){},beginPath(){points=[];},closePath(){},moveTo:(...point)=>points.push(point),lineTo:(...point)=>points.push(point),setLineDash:value=>{dash=value;},stroke(){strokes.push({points:[...points],colour:this.strokeStyle,width:this.lineWidth,dash});},fillText:value=>labels.push(value)},geometry={type:'Polygon',coordinates:[[[150,-28],[151,-28],[151,-27],[150,-27],[150,-28]]]},snapshot={active:true,extent:projectedBounds([150,-28,154,-24]),floodNotice:{scopeGeometries:[geometry]}};
  assert.equal(drawWarningFocus(ctx,snapshot,1000,800),true);assert.equal(strokes.length,2);assert.equal(strokes[1].colour,'#173f63');assert.equal(strokes[1].width,3);assert.deepEqual(strokes[1].dash,[12,7]);assert.ok(strokes.every(stroke=>stroke.points.every(([x])=>x<=251)),'A warning farther east receives no selection outline.');
  warningFocusLegend(ctx,10,20,'Flood Warning');warningFocusLegend(ctx,10,40,'Flood Watch');assert.deepEqual(labels,['Selected warning','Selected watch']);const count=strokes.length;assert.equal(drawWarningFocus(ctx,{...snapshot,active:false},1000,800),false);assert.equal(drawWarningFocus(ctx,{...snapshot,floodNotice:null},1000,800),false);assert.equal(strokes.length,count);
});

test('native flood name footprints preserve separate names and keep outage labels clear',()=>{
  const w=600,h=400,pixels=new Uint8ClampedArray(w*h*4),ink=(x0,y0,x1,y1)=>{for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++)pixels[(y*w+x)*4+3]=255;};
  ink(80,100,160,110);ink(83,118,157,128);ink(350,210,450,223);
  const boxes=floodLabelBoxes(pixels,w,h);assert.equal(boxes.length,2);
  for(const box of boxes)assert.ok(box.x>=0&&box.y>=0&&box.x+box.width<=w&&box.y+box.height<=h);
  const positions=layoutOutageLabels([{anchor:[120,115],width:70,height:26},{anchor:[390,215],width:50,height:26}],w,h,{reserved:boxes});
  for(const p of positions){assert.ok(p);for(const b of boxes)assert.ok(p.x+p.width<=b.x||p.x>=b.x+b.width||p.y+p.height<=b.y||p.y>=b.y+b.height);}
});
test('blank and opaque map substitutes cannot be drawn as flood names',()=>{
  assert.equal(floodLabelBoxes(new Uint8ClampedArray(100*80*4),100,80),null);
  assert.equal(floodLabelBoxes(new Uint8ClampedArray(100*80*4).fill(255),100,80),null);
});
test('native flood legend keeps its aspect ratio within the export and reserves explicit unavailable space',()=>{
  const layout=floodLegendLayout({width:300,height:120},1500);assert.equal(layout.width/layout.imageHeight,2.5);assert.ok(layout.height>=layout.imageHeight+30);
  const tall=floodLegendLayout({width:1000,height:1800},1500);assert.ok(tall.imageHeight<=400&&tall.width<=1468);assert.equal(floodLegendLayout(null,1500).height,35);
});
