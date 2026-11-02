import test from 'node:test';
import assert from 'node:assert/strict';
import {layoutOutageLabels} from '../js/map-labels.js';
import {composeProducts} from '../js/renderer.js';
import {projectedBounds} from '../js/geometry.js';
import {setCanvasFactory} from '../js/utils.js';

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
  const images=[],texts=[],ctx={drawImage:(...args)=>images.push(args[0]),fillText:value=>texts.push(String(value)),measureText:value=>({width:String(value).length*9}),createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)})};
  for(const method of ['save','restore','fillRect','strokeRect','beginPath','closePath','rect','clip','translate','moveTo','lineTo','arc','fill','stroke','strokeText','putImageData'])ctx[method]=()=>{};
  return {width,height,images,texts,getContext:()=>ctx};
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
test('outage labels show valid customer counts with thousands separators and omit unknown or planned counts',()=>{
  const input=fixture(),outage=(count,extra={})=>({type:'Feature',geometry:{type:'Point',coordinates:[152,-26]},properties:{outage_type:'unplanned',affected_customers:count,...extra}});
  input.outages=collection([outage(1241),outage(54),outage(null),outage(999,{affected_customers_known:'false'}),outage(888,{outage_type:'planned'})]);
  const result=composeProducts(input);assert.ok(result.infrastructure.texts.includes('1,241'));assert.ok(result.infrastructure.texts.includes('54'));
  for(const omitted of ['999','888','null'])assert.equal(result.infrastructure.texts.includes(omitted),false);
  assert.equal(result.radar.texts.includes('1,241'),false);
});
