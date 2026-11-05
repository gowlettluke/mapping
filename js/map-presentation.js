import {canvas,aest,clean} from './utils.js';
import {path,transform} from './geometry.js';
import {floodGeometryPixels} from './flood-scope.js';

export const MAP_TOP=88;
export const ROAD_STYLES={closed:{colour:'#a91f35',width:3.2,dash:[],casing:5.5},restricted:{colour:'#526474',width:1.9,dash:[7,5],casing:3.7}};
const selections=new WeakMap(),masks=new WeakMap();
export function selectionPixels(snapshot,width,height){
  const geometries=snapshot.floodNotice?.scopeGeometries;if(!snapshot.active||!geometries?.length)return null;
  const key=[width,height,...snapshot.extent].join(','),entries=selections.get(geometries)||new Map();
  if(!entries.has(key))entries.set(key,floodGeometryPixels({width,height,extent:snapshot.extent,visible:{length:width*height}},geometries));
  selections.set(geometries,entries);return entries.get(key);
}
// Runs along exposed cells of the UNION, so shared catchment edges disappear.
// Geometry, rather than WMS hatch pixels, determines the selected boundary.
export function boundarySegments(pixels,width,height){
  const segments=[],on=(x,y)=>x>=0&&y>=0&&x<width&&y<height&&pixels[y*width+x];
  for(let y=0;y<=height;y++){let start=-1;for(let x=0;x<=width;x++){const edge=x<width&&Boolean(on(x,y-1))!==Boolean(on(x,y));if(edge&&start<0)start=x;if(!edge&&start>=0){segments.push([start,y,x,y]);start=-1;}}}
  for(let x=0;x<=width;x++){let start=-1;for(let y=0;y<=height;y++){const edge=y<height&&Boolean(on(x-1,y))!==Boolean(on(x,y));if(edge&&start<0)start=y;if(!edge&&start>=0){segments.push([x,start,x,y]);start=-1;}}}
  return segments;
}
export function selectionMask(snapshot,width,height){
  const geometries=snapshot.floodNotice?.scopeGeometries;if(!snapshot.active||!geometries?.length)return false;
  const pixels=selectionPixels(snapshot,width,height);if(masks.has(pixels))return masks.get(pixels);
  const mask=canvas(width,height),m=mask.getContext('2d'),data=m.createImageData(width,height);
  for(let i=0;i<pixels.length;i++)if(pixels[i])data.data[i*4+3]=255;m.putImageData(data,0,0);masks.set(pixels,mask);return mask;
}
export function drawContextImage(ctx,snapshot,image,width,height,contextAlpha=.38){
  const focus=selectionMask(snapshot,width,height);if(!focus){ctx.drawImage(image,0,0,width,height);return;}
  const layer=canvas(width,height),l=layer.getContext('2d');l.drawImage(image,0,0,width,height);l.globalCompositeOperation='destination-out';l.drawImage(focus,0,0);ctx.save();ctx.globalAlpha=contextAlpha;ctx.drawImage(layer,0,0);ctx.restore();
  l.globalCompositeOperation='source-over';l.clearRect(0,0,width,height);l.drawImage(image,0,0,width,height);l.globalCompositeOperation='destination-in';l.drawImage(focus,0,0);ctx.drawImage(layer,0,0);
}
export const drawWarningAreas=(ctx,snapshot,width,height)=>drawContextImage(ctx,snapshot,snapshot.warning,width,height);
function strokeFeatures(ctx,collection,project,colour,width){ctx.strokeStyle=colour;ctx.lineWidth=width;for(const f of collection?.features||[]){ctx.beginPath();path(ctx,f.geometry,project);ctx.stroke();}}
export function drawMapBase(ctx,snapshot,width,height){
  const context=snapshot.context||{},project=transform(snapshot.extent,width,height);ctx.drawImage(snapshot.background,0,0,width,height);
  ctx.fillStyle='rgba(255,255,255,.22)';ctx.fillRect(0,0,width,height);
  // Offshore administrative boundaries are legal areas, not coastal features.
  // Clip their presentation to verified land polygons; analysis is untouched.
  const land=[...(context.locator?.features||[]),...(context.islands?.features||[])];
  if(land.length){ctx.save();ctx.beginPath();for(const f of land)path(ctx,f.geometry,project);ctx.clip();strokeFeatures(ctx,snapshot.lgas,project,'rgba(94,109,120,.30)',.7);ctx.restore();}
  strokeFeatures(ctx,context.coastline,project,'#647580',.9);strokeFeatures(ctx,context.border,project,'#647580',1.2);
}
export function drawRivers(ctx,snapshot,width,height){ctx.save();strokeFeatures(ctx,snapshot.context?.rivers,transform(snapshot.extent,width,height),'rgba(48,128,165,.65)',1.2);ctx.restore();}
const intersects=(a,b)=>a.x<b.x+b.width&&a.x+a.width>b.x&&a.y<b.y+b.height&&a.y+a.height>b.y;
export function drawPlaces(ctx,snapshot,width,height,{reserved=[]}={}){
  const project=transform(snapshot.extent,width,height),boxes=[...reserved],placed=[],seen=new Set();ctx.save();ctx.font='bold 14px Arial';ctx.textBaseline='middle';ctx.textAlign='left';
  for(const f of snapshot.context?.places?.features||[]){const name=clean(f.properties?.place_name);if(!name||seen.has(name)||f.geometry?.type!=='Point')continue;seen.add(name);const [x,y]=project(f.geometry.coordinates),w=ctx.measureText(name).width+10;
    if(x<8||y<12||x>width-8||y>height-12)continue;
    const candidates=[{x:x+7,y:y-10,width:w,height:20},{x:x-w-7,y:y-10,width:w,height:20},{x:x-w/2,y:y-28,width:w,height:20}];
    const box=candidates.find(b=>b.x>=8&&b.x+b.width<=width-8&&b.y>=8&&b.y+b.height<=height-8&&!boxes.some(other=>intersects(b,other)));
    if(!box)continue;boxes.push(box);placed.push(box);ctx.fillStyle='#445361';ctx.beginPath();ctx.arc(x,y,2.4,0,Math.PI*2);ctx.fill();ctx.strokeStyle='rgba(255,255,255,.98)';ctx.lineWidth=4;ctx.strokeText(name,box.x+4,box.y+10);ctx.fillText(name,box.x+4,box.y+10);
  }ctx.restore();return placed;
}
export function mapHeading(snapshot,purpose){
  const flood=snapshot.profile==='flooding'||snapshot.floodNotice,scope=clean(snapshot.scopeLabel||'');
  const title=flood&&snapshot.active?scope.replace(/^(?:Final\s+)?Flood (?:Warning|Watch)\s*[—–-]\s*/i,'').replace(/\s\/\s/g,' and ').replace(/^(.+?) River and (.+?) River$/,'$1 and $2 Rivers'):snapshot.active?scope||'Queensland warning area':'Queensland';
  const kind=snapshot.floodDisplay?.kind||snapshot.floodNotice?.kind||'Flood Warning',final=/^Final Flood (?:Warning|Watch)\b/i.test(scope);
  return {title,subtitle:purpose+(flood?' · '+(final?'Final ':'')+kind:'')};
}
export function wrapText(ctx,text,width){const result=[];let line='';for(const word of String(text).split(/\s+/)){const next=line?line+' '+word:word;if(line&&ctx.measureText(next).width>width){result.push(line);line=word;}else line=next;}if(line)result.push(line);return result;}
export function drawMapHeading(ctx,snapshot,purpose,width,{summary=''}={}){
  const {title,subtitle}=mapHeading(snapshot,purpose);ctx.save();ctx.fillStyle='#172d3d';let size=26;ctx.font='bold '+size+'px Arial';while(ctx.measureText(title).width>width-32&&size>16){ctx.font='bold '+(--size)+'px Arial';}let visibleTitle=title;while(ctx.measureText(visibleTitle).width>width-32&&visibleTitle.length>2)visibleTitle=visibleTitle.slice(0,-2).trimEnd()+'…';ctx.fillText(visibleTitle,16,31);
  ctx.font='14px Arial';ctx.fillStyle='#435665';ctx.fillText(subtitle,16,54);ctx.font='12px Arial';ctx.fillStyle='#586875';const stamp='Map generated '+aest(snapshot.generated);ctx.fillText(stamp,16,75);
  if(summary){ctx.textAlign='right';ctx.fillText(summary,width-16,75);}ctx.restore();
}
export function mapFooter(ctx,snapshot,width,{gauges=false,radar=false}={}){
  ctx.font='11px Arial';const sources=snapshot.demo?'Synthetic fixtures — not operational observations.':gauges?'Sources: BoM / QFD river observations; BoM warning areas; Queensland Government boundaries, places and watercourses.':radar?'Sources: BoM warning areas and radar; Queensland Government boundaries, places and watercourses.':'Sources: BoM warning areas; Queensland Government; QLDTraffic; Queensland power outage feed.',credits=snapshot.context?.credits?.copyrightText||'Esri and contributors.';
  return [sources,...(gauges?['Ordering: BoM / Geofabric; station index © State of Queensland 2024.']:[]),'Basemap: '+credits].flatMap(t=>wrapText(ctx,t,width-32));
}
export function drawRoads(ctx,roads,project){
  ctx.save();ctx.lineCap='round';ctx.lineJoin='round';for(const road of roads||[]){const style=ROAD_STYLES[road.condition==='closed'?'closed':'restricted'];
    for(const [colour,width]of [['rgba(255,255,255,.96)',style.casing],[style.colour,style.width]]){ctx.beginPath();path(ctx,road.geometry,project);if(road.geometry?.type==='Point'){const p=project(road.geometry.coordinates);ctx.arc(...p,4,0,Math.PI*2);}ctx.strokeStyle=colour;ctx.lineWidth=width;ctx.setLineDash(style.dash);ctx.stroke();}
  }ctx.restore();
}
