import test from 'node:test';
import assert from 'node:assert/strict';
import {boundarySegments,drawMapBase,drawPlaces,drawRoads,mapHeading,drawMapHeading,MAP_TOP,ROAD_STYLES} from '../js/map-presentation.js';
import {BOM_WARNING_KEY,drawFloodLegend} from '../js/flood-display.js';
import {gaugeCounts,drawGaugeMarkers} from '../js/gauge-map.js';
import {projectedBounds} from '../js/geometry.js';
import {majorRivers} from '../js/sources.js';
import {layoutOutageLabels} from '../js/map-labels.js';

const collection=features=>({type:'FeatureCollection',features}),polygon=(w,s,e,n)=>({type:'Polygon',coordinates:[[[w,s],[e,s],[e,n],[w,n],[w,s]]]}),extent=projectedBounds([150,-28,154,-24]);
function drawing(){const text=[],strokes=[],fills=[],events=[];let segments=[],dash=[],last=[];const ctx={save(){},restore(){},drawImage(){},fillRect:(...p)=>fills.push({p,colour:ctx.fillStyle}),strokeRect(){},rect(){},clip:()=>events.push('clip'),beginPath:()=>{segments=[];},closePath(){},moveTo:(...p)=>{last=p;},lineTo:(...p)=>{segments.push([last,p]);last=p;},setLineDash:d=>{dash=d;},stroke:()=>{events.push('stroke');strokes.push({colour:ctx.strokeStyle,width:ctx.lineWidth,dash:[...dash],segments});},fill(){},arc(){},strokeText(){},fillText:(value,x,y)=>text.push({value:String(value),x,y,colour:ctx.fillStyle}),measureText:value=>({width:String(value).length*7})};return {ctx,text,strokes,fills,events};}

test('the warning union removes internal joins and retains holes and disconnected areas',()=>{
  const joined=Uint8Array.from([1,1,1,1,1,1,1,1]),edges=boundarySegments(joined,4,2);assert.equal(edges.length,4);assert.deepEqual(edges,[[0,0,4,0],[0,2,4,2],[0,0,0,2],[4,0,4,2]]);
  const hole=Uint8Array.from([1,1,1,1,0,1,1,1,1]);assert.equal(boundarySegments(hole,3,3).length,8);
  const separate=boundarySegments(Uint8Array.from([1,0,1]),3,1);assert.equal(separate.length,8);assert.ok(separate.some(edge=>edge[0]===1&&edge[2]===1));
});
test('BoM warning-area key and reported gauge status remain separate meanings',()=>{
  const {ctx,text}=drawing();drawFloodLegend(ctx,null,1500,0,'Flood Warning');assert.deepEqual(BOM_WARNING_KEY.map(e=>e.label),['Major','Moderate','Minor','Generalised','Below minor','Final warning']);assert.ok(text.some(t=>t.value.includes('standard key')));assert.ok(text.some(t=>t.value==='Below minor'));
  const watch=drawing();drawFloodLegend(watch.ctx,null,1500,0,'Flood Watch');assert.ok(watch.text.some(t=>t.value.includes('Source key unavailable')));assert.equal(watch.text.some(t=>t.value==='Major'),false,'Do not apply warning severities to a watch.');
  assert.deepEqual(gaugeCounts([{category:'major'},{category:'minor'},{category:'below'},{category:'unrecognised'},{category:'unknown'}]),{major:1,moderate:0,minor:1,below:1,unknown:2});
});
test('land context clips LGA strokes before they are drawn and leaves coastline independent',()=>{
  const {ctx,events}=drawing(),land=collection([{geometry:polygon(150,-28,152,-24)}]),snapshot={extent,background:{},lgas:collection([{geometry:polygon(150,-28,154,-24)}]),context:{locator:land,coastline:collection([{geometry:{type:'LineString',coordinates:[[152,-28],[152,-24]]}}])}};
  drawMapBase(ctx,snapshot,1000,800);assert.ok(events.indexOf('clip')<events.indexOf('stroke'));
});
test('town names above warning fill reserve space for gauge references',()=>{
  const {ctx,text}=drawing(),snapshot={extent,context:{places:collection([{geometry:{type:'Point',coordinates:[152,-26]},properties:{place_name:'Synthetic town'}},{geometry:{type:'Point',coordinates:[152,-26]},properties:{place_name:'Synthetic town'}}])}},boxes=drawPlaces(ctx,snapshot,1000,800);
  assert.equal(boxes.length,1);assert.equal(text.length,1);const gauge=layoutOutageLabels([{anchor:[500,400],width:48,height:22}],1000,800,{reserved:boxes})[0];assert.ok(gauge.x+gauge.width<=boxes[0].x||gauge.x>=boxes[0].x+boxes[0].width||gauge.y+gauge.height<=boxes[0].y||gauge.y>=boxes[0].y+boxes[0].height);
});
test('gauge boxes are white, keep every reference and put PDF links at the header-adjusted positions',()=>{
  const {ctx,text,fills}=drawing(),snapshot={extent,context:{locator:collection([])}},gauges=[{label:'G1',name:'Test River at Crossing',river:'Test River',category:'major',point:[151,-26]},{label:'G2',name:'Unknown site',category:'unknown',point:[153,-26]}];
  const positions=drawGaugeMarkers(ctx,snapshot,gauges,1000,800,{offsetY:MAP_TOP});assert.ok(text.some(t=>t.value==='G1 · Crossing'));assert.ok(text.some(t=>t.value==='G2'));assert.equal(fills.filter(f=>f.colour==='#fff').length,2);gauges.forEach((g,i)=>{assert.equal(g.marker.x,positions[i].x+positions[i].width/2);assert.equal(g.marker.y,positions[i].y+positions[i].height/2+MAP_TOP);});
});
test('road closures have white casing and restrictions use a neutral dashed line',()=>{
  const {ctx,strokes}=drawing(),geometry={type:'LineString',coordinates:[[0,0],[10,10]]};drawRoads(ctx,[{condition:'closed',geometry},{condition:'restricted',geometry}],p=>p);assert.equal(strokes.length,4);assert.match(strokes[0].colour,/255,255,255/);assert.equal(strokes[1].colour,ROAD_STYLES.closed.colour);assert.deepEqual(strokes[1].dash,[]);assert.deepEqual(strokes[3].dash,[7,5]);assert.ok(strokes[3].width<strokes[1].width);assert.notEqual(strokes[3].colour,'#ffaa00');
});
test('geographic headings distinguish map generation from observation time',()=>{
  const snapshot={active:true,profile:'flooding',scopeLabel:'Flood Warning — Barcoo River / Thomson River',generated:new Date('2026-11-04T12:08:00Z'),floodDisplay:{kind:'Flood Warning'}},heading=mapHeading(snapshot,'River gauges');assert.equal(heading.title,'Barcoo and Thomson Rivers');assert.equal(heading.subtitle,'River gauges · Flood Warning');const {ctx,text}=drawing();drawMapHeading(ctx,snapshot,'River gauges',1500);assert.ok(text.some(t=>t.value==='Map generated 04 Nov 2026, 22:08 AEST'));assert.ok(text.every(t=>t.y<MAP_TOP));assert.equal(text.some(t=>t.value.includes('observed')),false);
  assert.equal(mapHeading({...snapshot,scopeLabel:'Final Flood Warning — Barcoo River'},'River gauges').subtitle,'River gauges · Final Flood Warning');
});
test('major-channel loading selects names from the warning and escapes source apostrophes',async()=>{
  let query;await majorRivers([141,-27,147,-21],"Flood Warning — Barcoo River / Thomson River / O'Brien Creek",null,{read:async()=>({features:['Barcoo River','Thomson River','Thomsonia Creek','Tiny Creek',"O'Brien Creek"].map(name=>({attributes:{name}}))}),query:async(url,options)=>{query=options;return collection([]);}});assert.equal(query.where,"hierarchy = 'Major' AND name IN ('Barcoo River','Thomson River','O''Brien Creek')");assert.ok(query.simplify>0);
  await assert.rejects(majorRivers([141,-27,147,-21],'Barcoo River',null,{read:async()=>({features:[],exceededTransferLimit:true})}),/incomplete/);
});
