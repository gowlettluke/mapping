import test from 'node:test';
import assert from 'node:assert/strict';
import {layoutOutageLabels} from '../js/map-labels.js';
import {composeProducts} from '../js/renderer.js';
import {projectedBounds} from '../js/geometry.js';
import {setCanvasFactory} from '../js/utils.js';
import {buildReport} from '../js/report.js';

const overlaps=(a,b)=>a.x<b.x+b.width&&a.x+a.width>b.x&&a.y<b.y+b.height&&a.y+a.height>b.y;
function checkLabels(labels,width,height,reserved=[]){
  const positions=layoutOutageLabels(labels,width,height,{reserved});assert.equal(positions.length,labels.length);
  positions.forEach((box,i)=>{assert.ok(box,'Every count has a label position');assert.ok(box.x>=8&&box.y>=8&&box.x+box.width<=width-8&&box.y+box.height<=height-8);assert.equal(box.width,labels[i].width);assert.equal(box.height,labels[i].height);
    for(const other of positions.slice(0,i))assert.equal(overlaps(box,other),false,'Customer counts do not overlap');
    for(const other of reserved)assert.equal(overlaps(box,other),false,'Counts avoid map annotations');
  });return positions;
}
test('dense outage counts stay separate, including different widths at the same point',()=>{
  const labels=Array.from({length:60},(_,i)=>({anchor:[320+(i%3),240+(i%2)],width:30+(i%6)*9,height:26}));
  checkLabels(labels,800,600,[{x:647,y:12,width:141,height:182},{x:12,y:543,width:180,height:45}]);
});
test('labels near each corner remain inside the map and clear of the scale bar and locator',()=>{
  const labels=[[0,0],[799,0],[0,599],[799,599]].flatMap(anchor=>Array.from({length:6},(_,i)=>({anchor,width:40+i*7,height:26})));
  const reserved=[{x:647,y:12,width:141,height:182},{x:12,y:543,width:180,height:45}];
  const positions=checkLabels(labels,800,600,reserved);assert.deepEqual(layoutOutageLabels(labels,800,600,{reserved}),positions,'Placement is stable between exports');
});

function fakeCanvas(width,height){
  const images=[],texts=[],arcs=[],fills=[],ctx={drawImage:(...args)=>images.push(args[0]),fillText:value=>texts.push(String(value)),measureText:value=>({width:String(value).length*9}),createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)}),arc:(x,y,r)=>arcs.push({x,y,r,fill:ctx.fillStyle}),fillRect:(x,y,width,height)=>fills.push({x,y,width,height,fill:ctx.fillStyle})};
  for(const method of ['save','restore','strokeRect','beginPath','closePath','rect','clip','translate','moveTo','lineTo','fill','stroke','strokeText','putImageData'])ctx[method]=()=>{};
  return {width,height,images,texts,arcs,fills,getContext:()=>ctx};
}
setCanvasFactory(fakeCanvas);
const collection=features=>({type:'FeatureCollection',features});
function fixture(){const width=400,height=300;return {
  extent:projectedBounds([150,-28,154,-24]),background:{},warning:{width,height},radar:{},tracking:{},mask:{width,height,visible:new Uint8Array(width*height)},
  lgas:collection([]),context:{locator:collection([])},outages:collection([]),roads:[],profile:'thunderstorm',active:true,generated:new Date('2026-11-02T07:00:00Z')
};}
test('storm tracking overlays radar only and remains optional when the radar image is unavailable',()=>{
  for(const withRadar of [true,false]){const input=fixture();if(!withRadar)input.radar=null;const result=composeProducts(input);
    assert.ok(result.radar.images.includes(input.tracking));assert.equal(result.infrastructure.images.includes(input.tracking),false);
    if(withRadar)assert.ok(result.radar.images.indexOf(input.tracking)>result.radar.images.indexOf(input.radar),'Tracking appears above radar');
  }
  const input=fixture();input.tracking=null;assert.equal(composeProducts(input).radar.images.includes(null),false);
});
test('flood exports retain native polygons and source labels without the extra brown mask tracing',()=>{
  const input=fixture();input.profile='flooding';input.floodDisplay={kind:'Flood Warning',labels:{},labelBoxes:[],legend:{width:200,height:70}};
  const products=composeProducts(input);
  for(const output of [products.radar,products.infrastructure]){assert.equal(output.images.filter(i=>i===input.warning).length,1);assert.equal(output.images.includes(products.outline),false);assert.ok(output.images.includes(input.background));assert.ok(output.images.includes(input.floodDisplay.labels));assert.ok(output.images.includes(input.floodDisplay.legend));assert.equal(output.texts.includes('Warning extent'),false);assert.ok(output.texts.includes('Flood Warning — source legend'));}
  const storm=composeProducts({...input,profile:'thunderstorm',floodDisplay:null});assert.ok(storm.radar.images.includes(storm.outline));assert.ok(storm.infrastructure.images.includes(storm.outline));
});
test('flood names render above infrastructure while outage counts keep clear of their reserved space',()=>{
  const input=fixture();input.profile='flooding';const reserved={x:160,y:115,width:120,height:50};input.floodDisplay={kind:'Flood Watch',labels:{},labelBoxes:[reserved],legend:null};
  input.outages=collection([{type:'Feature',geometry:{type:'Point',coordinates:[152,-26]},properties:{outage_type:'unplanned',affected_customers:1009}}]);
  const result=composeProducts(input),output=result.infrastructure;assert.equal(output.images.at(-1),input.floodDisplay.labels);assert.ok(output.texts.includes('1,009'));assert.ok(output.texts.includes('Flood Watch — source legend unavailable'));assert.equal(output.texts.includes('Warning extent'),false);
  const labels=output.fills.filter(b=>b.height===26);assert.equal(labels.length,1);const p=labels[0];assert.equal(overlaps(p,reserved),false);
});
test('outage labels default to 100 customers and omit smaller, unknown or planned counts',()=>{
  const input=fixture(),outage=(count,extra={})=>({type:'Feature',geometry:{type:'Point',coordinates:[152,-26]},properties:{outage_type:'unplanned',affected_customers:count,...extra}});
  input.outages=collection([outage(1241),outage(54),outage(100),outage(99),outage(null),outage(999,{affected_customers_known:'false'}),outage(888,{outage_type:'planned'})]);
  const result=composeProducts(input);assert.ok(result.infrastructure.texts.includes('1,241'));assert.ok(result.infrastructure.texts.includes('100'));
  for(const omitted of ['54','99','999','888','null'])assert.equal(result.infrastructure.texts.includes(omitted),false);
  assert.equal(result.radar.texts.includes('1,241'),false);
});
test('label thresholds are inclusive, configurable and recorded in the infrastructure legend',()=>{
  const input=fixture(),counts=[54,100,250,500,1000];input.outages=collection(counts.map(count=>({type:'Feature',geometry:{type:'Point',coordinates:[152,-26]},properties:{outage_type:'unplanned',affected_customers:count}})));
  for(const threshold of [0,100,250,500,1000]){const result=composeProducts({...input,outageLabelMinimum:threshold});for(const count of counts)assert.equal(result.infrastructure.texts.includes(count.toLocaleString('en-AU')),count>=threshold);assert.ok(result.infrastructure.texts.some(text=>text=== (threshold?'Number labels: '+threshold.toLocaleString('en-AU')+'+ customers per outage':'Number labels: all reported counts')));}
  const all=composeProducts({...input,outageLabelMinimum:'0'});assert.ok(all.infrastructure.texts.includes('54'));
  for(const invalid of ['',-1,150,NaN])assert.equal(composeProducts({...input,outageLabelMinimum:invalid}).infrastructure.texts.includes('54'),false);
});
test('unlabelled small outages remain drawn, unknown counts stay distinct and report counts are independent of map labels',()=>{
  const input=fixture(),outage=(id,count,extra={})=>({type:'Feature',geometry:{type:'Point',coordinates:[152,-26]},properties:{outage_id:id,provider_code:'au.qld.energex',outage_type:'unplanned',affected_customers:count,...extra}});
  input.outages=collection([outage('small-a',54),outage('small-b',99),outage('unknown',null),outage('unreported',999,{affected_customers_known:false}),outage('planned',888,{outage_type:'planned'})]);
  const result=composeProducts({...input,outageLabelMinimum:500});assert.equal(result.infrastructure.arcs.length,4);assert.equal(result.infrastructure.arcs[0].fill,result.infrastructure.arcs[1].fill);assert.equal(result.infrastructure.arcs[2].fill,result.infrastructure.arcs[3].fill);assert.notEqual(result.infrastructure.arcs[0].fill,result.infrastructure.arcs[2].fill);assert.equal(result.infrastructure.texts.includes('54'),false);
  const lga={type:'Feature',properties:{lga:'Test Regional'},geometry:{type:'Polygon',coordinates:[[[150,-28],[154,-28],[154,-24],[150,-24],[150,-28]]]}};
  const powerCounts={energex:{rows:[{label:'Test Regional',count:153}]},ergon:{rows:[]}};
  const report=buildReport({lgas:[lga],allLgas:collection([lga]),powerCounts,trafficAvailable:true,asAt:'Test snapshot',scope:'Selected LGAs'});assert.match(report.text,/153 customers/);assert.doesNotMatch(report.text,/888|999/);
});
