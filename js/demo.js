// Explicit offline/synthetic fixtures. This module is never a live-data fallback.
import {CONFIG} from '../config.js';
import {canvas,aest} from './utils.js';
import {projectedBounds,fitExtent,path,transform} from './geometry.js';
import {analyseCanvas} from './raster.js';
import {normaliseRoads} from './report.js';
import {composeProducts,exportProducts} from './renderer.js';
import {warningLgas} from './pipeline.js';
const polygon=(w,s,e,n)=>({type:'Polygon',coordinates:[[[w,s],[e,s],[e,n],[w,n],[w,s]]]});
const feature=(geometry,properties={})=>({type:'Feature',geometry,properties});
const collection=features=>({type:'FeatureCollection',features});
export function demoSnapshot(profile='thunderstorm',{noWarning=false}={}){
  const width=1500,height=1120,extent=fitExtent(projectedBounds([150.5,-28.7,153.8,-25.8]),width,height),p=transform(extent,width,height),generated=new Date();
  const lgas=collection([feature(polygon(150.5,-28.6,152,-25.9),{lga:'Example Inland LGA'}),feature(polygon(152,-28.6,153.4,-25.9),{lga:'Example Coast LGA'}),feature(polygon(153.4,-28.6,153.9,-25.9),{lga:'Outside Warning LGA'})]);
  const background=canvas(width,height),bg=background.getContext('2d');bg.fillStyle='#e7edf0';bg.fillRect(0,0,width,height);bg.strokeStyle='#cbd6d9';bg.lineWidth=1;
  for(let x=0;x<width;x+=80){bg.beginPath();bg.moveTo(x,0);bg.lineTo(x,height);bg.stroke();}for(let y=0;y<height;y+=80){bg.beginPath();bg.moveTo(0,y);bg.lineTo(width,y);bg.stroke();}
  const warning=canvas(width,height),ctx=warning.getContext('2d');if(!noWarning){ctx.beginPath();const [x,y]=p([151.8,-27.1]);ctx.ellipse(x,y,260,215,-.25,0,Math.PI*2);ctx.fillStyle='rgba(255,215,48,.65)';ctx.fill();ctx.strokeStyle='#a36b12';ctx.lineWidth=3;ctx.stroke();}
  const mask=analyseCanvas(warning,extent).mask,affected=noWarning?lgas.features:warningLgas(lgas,[mask]);
  const radar=canvas(width,height),rctx=radar.getContext('2d'),radarColors=['#b4b4ff','#1414ff','#00d8c3','#009690','#ffff00','#ff9600','#ff0000'];
  for(let i=0;i<9;i++){const [x,y]=p([151.35+i*.09,-26.8-i*.065]);for(let j=0;j<radarColors.length;j++){rctx.fillStyle=radarColors[j];rctx.beginPath();rctx.ellipse(x,y,(7-j)*12,(7-j)*10,.3,0,Math.PI*2);rctx.fill();}}
  const snapshotTime=generated.toISOString(),outages=collection([
    feature(polygon(151.2,-27.3,151.35,-27.12),{provider_code:'au.qld.energex',outage_id:'demo-1',outage_type:'unplanned',affected_customers:120,affected_customers_known:true,snapshot_utc:snapshotTime}),
    feature(polygon(152.1,-26.9,152.25,-26.75),{provider_code:'au.qld.ergon',outage_id:'demo-2',outage_type:'unplanned',affected_customers:75,affected_customers_known:true,snapshot_utc:snapshotTime}),
    feature(polygon(153.55,-27.6,153.7,-27.4),{provider_code:'au.qld.energex',outage_id:'demo-outside',outage_type:'unplanned',affected_customers:900,affected_customers_known:true,snapshot_utc:snapshotTime})]);
  const traffic=collection([
    feature({type:'LineString',coordinates:[[151.3,-26.95],[151.9,-27.35]]},{id:'demo-road',status:'Published',road_summary:{road_name:'Example Highway',locality:'Example Town'},impact:{impact_type:'Closures',impact_subtype:'Road closed to all traffic'},description:'Between Example Road and Sample Street due to flooding.'}),
    feature({type:'LineString',coordinates:[[152.1,-27],[152.3,-27.2]]},{id:'demo-restriction',status:'Published',road_summary:{road_name:'Example Highway'},impact:{impact_type:'Road restricted',impact_subtype:'Four wheel drive access only'}})]);
  const locator=collection([feature({type:'Polygon',coordinates:[[[138,-16.5],[142,-10.7],[145,-14],[146.8,-18],[153.6,-27.7],[151,-29],[141,-29],[141,-26],[138,-26],[138,-16.5]]]})]);
  return {demo:true,extent,active:!noWarning,profile,profileLabel:CONFIG.profiles[profile].label,generated,mask,scopeMasks:noWarning?[]:[mask],affected,lgas,background,warning,radar,roads:normaliseRoads(traffic,generated.getTime()),context:{outages,manifest:{generated_utc:snapshotTime,current_outage_records:outages.features.length,provider_fetch_errors:{}},traffic,locator,coastline:collection([]),border:collection([])},demoMajorNames:['Example Highway'],scopeLabel:'DEMO - synthetic warning and impact fixtures'};
}
export async function demoProducts(profile,options){const snapshot=demoSnapshot(profile,options),products=composeProducts({...snapshot,outages:snapshot.context.outages}),blobs=await exportProducts(products);return {snapshot,products,blobs,notices:['DEMO: all warning, radar, outage, road and camera data are synthetic.']};}
export function demoCameras(snapshot){return Array.from({length:6},(_,i)=>({id:'demo-camera-'+i,source:'demo',sourceLabel:'Synthetic test camera',name:'Example camera '+(i+1)+' - synthetic demonstration image',point:[151.6+i*.05,-27.0-i*.04],url:'https://example.invalid/synthetic-'+i+'.jpg',capturedAt:null}));}
export function demoPhotos(cameras){return cameras.map((camera,i)=>{const c=canvas(900,560),ctx=c.getContext('2d');ctx.fillStyle=['#c7dce6','#d2e5d4','#e7dcc8'][i%3];ctx.fillRect(0,0,900,560);ctx.fillStyle='#52616a';ctx.beginPath();ctx.moveTo(50,560);ctx.lineTo(400,180);ctx.lineTo(500,180);ctx.lineTo(850,560);ctx.fill();ctx.strokeStyle='#fff';ctx.lineWidth=6;ctx.setLineDash([30,25]);ctx.beginPath();ctx.moveTo(450,560);ctx.lineTo(450,200);ctx.stroke();ctx.setLineDash([]);ctx.font='bold 32px Arial';ctx.fillStyle='#8b2433';ctx.fillText('SYNTHETIC CAMERA '+(i+1),35,60);ctx.font='22px Arial';ctx.fillText('Not a live photograph',35,95);return {camera,photo:{data:c.toDataURL('image/jpeg',.8),width:900,height:560,capturedAt:null,retrievedAt:new Date()}};});}
