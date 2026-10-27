import {CONFIG} from '../config.js';
import {projectedBounds,geographicBounds,fitExtent,contains,lgaName,path,transform} from './geometry.js';
import {warningCanvas,analyseCanvas,components,maskContains,rasterIntersects} from './raster.js';
import {lgas,loadPublic,queryArcgis,cached,majorNames} from './sources.js';
import {basemap,composeProducts,exportProducts} from './renderer.js';
import {normaliseRoads,powerHealth,buildReport} from './report.js';
import {aest,checkAbort} from './utils.js';
export function warningLgas(collection,masks){return collection.features.filter(f=>masks.some(m=>rasterIntersects(m,f.geometry)));}
async function scan(connection,names,titles,extent,boundary,width,height,signal){const im=await connection.render('warning',extent,width,height,names,titles,signal),c=warningCanvas(im,width,height,extent,boundary);im.close?.();return {...analyseCanvas(c,extent),canvas:c};}
export async function scanFloods(connection,signal,onProgress=()=>{}){
  const boundary=await lgas(signal),extent=projectedBounds(CONFIG.rendering.qld),[w,h]=CONFIG.rendering.detection,output=[];
  for(const [index,key] of ['floodWarnings','floodWatches'].entries()){
    checkAbort(signal);const names=[CONFIG.profiles.flooding.warning[index]],titles=[CONFIG.profiles.flooding.titles[index]],kind=index?'Flood Watch':'Flood Warning';onProgress('Scanning '+kind+' areas...');
    const detected=await scan(connection,names,titles,extent,boundary,w,h,signal);if(!detected.active)continue;
    let refs={features:[]};try{refs=await cached(key,()=>queryArcgis(CONFIG.publicSources[key],{signal}));}catch{}
    const groups=new Map();components(detected.mask).forEach((component,i)=>{const ref=refs.features.find(f=>contains(component.sample,f.geometry)),p=ref?.properties||{},id=p.product_id||p.PRODUCT_ID||'',title=p.dist_name||p.DIST_NAME||warningLgas(boundary,[component.mask]).map(lgaName).slice(0,2).join(' / '),groupKey=id||'area:'+i;
      if(!groups.has(groupKey))groups.set(groupKey,{id:key+':'+groupKey,title:kind+' - '+(title||'detected area '+(i+1)),kind,names,titles,components:[],identified:Boolean(id),extent:component.extent});
      const group=groups.get(groupKey);group.components.push(component);group.extent=[Math.min(group.extent[0],component.extent[0]),Math.min(group.extent[1],component.extent[1]),Math.max(group.extent[2],component.extent[2]),Math.max(group.extent[3],component.extent[3])];
    });output.push(...groups.values());
  }return output;
}
export async function generateSnapshot({connection,profile='thunderstorm',selection=null,tracking=false,signal,onProgress=()=>{}}){
  const spec=CONFIG.profiles[profile],{width,height,detection,minimumRegionalKm,padding}=CONFIG.rendering;
  onProgress('Loading Queensland LGA polygons...');const boundary=await lgas(signal);let active,extent,scopeMasks;
  if(profile==='flooding'&&selection){active=true;extent=fitExtent(selection.extent,width,height,{minimumKm:minimumRegionalKm,padding});scopeMasks=selection.components.map(c=>c.mask);}
  else {onProgress('Detecting the current '+spec.label.toLowerCase()+' warning...');const initial=await scan(connection,spec.warning,spec.titles,projectedBounds(CONFIG.rendering.qld),boundary,...detection,signal);active=initial.active;extent=active?fitExtent(initial.extent,width,height,{minimumKm:minimumRegionalKm,padding}):fitExtent(projectedBounds(CONFIG.rendering.qld),width,height);}
  onProgress('Loading shared infrastructure data and map background...');const [{data:context,notices},background]=await Promise.all([loadPublic(geographicBounds(extent),signal),basemap(extent,width,height,signal)]);checkAbort(signal);
  if(background.failed){notices.push(background.failed+' of '+background.total+' background tiles were unavailable.');if(background.failed===background.total){context.basemapUnavailable=true;const ctx=background.canvas.getContext('2d'),p=transform(extent,width,height);ctx.fillStyle='#f2eee5';for(const f of boundary.features){ctx.beginPath();path(ctx,f.geometry,p);ctx.fill('evenodd');}}}
  onProgress('Rendering the same warning snapshot for both JPEG maps...');const [weather,radar]=await Promise.all([
    scan(connection,spec.warning,spec.titles,extent,boundary,width,height,signal),connection.render('radar',extent,width,height,CONFIG.radar.names,CONFIG.radar.titles,signal)
  ]);
  if(profile!=='flooding'&&weather.active!==active)throw new Error('The warning changed during generation. Generate maps again.');
  if(profile==='flooding'&&!selection&&weather.active)throw new Error('A flood warning/watch is active. Refresh and select its area first.');
  if(active&&profile==='flooding'){
    const selected=await scan(connection,selection.names,selection.titles,extent,boundary,width,height,signal);
    const refined=components(selected.mask).filter(c=>selection.components.some(old=>maskContains(old.mask,c.sample)||maskContains(c.mask,old.sample)));
    if(!selected.active||!refined.length)throw new Error('The selected flood area changed. Refresh flood areas and select it again.');
    scopeMasks=refined.map(c=>c.mask);
  }
  if(active&&profile!=='flooding')scopeMasks=[weather.mask];if(!active)scopeMasks=[];
  let trackingImage=null;if(tracking&&active&&spec.tracking.length){try{trackingImage=await connection.render('warning',extent,width,height,spec.tracking,[],signal);}catch{notices.push('Storm tracking was unavailable; it was omitted.');}}
  const affected=active?warningLgas(boundary,scopeMasks):boundary.features;if(active&&!affected.length)throw new Error('No Queensland LGA intersection could be verified for this warning');
  const generated=new Date(),roads=normaliseRoads(context.traffic,generated.getTime());
  const snapshot={extent,active,profile,profileLabel:spec.label,generated,mask:weather.mask,scopeMasks,lgas:boundary,affected,context,background:background.canvas,warning:weather.canvas,radar,tracking:trackingImage,roads,demo:false,
    scopeLabel:active?(selection?.title||affected.slice(0,3).map(lgaName).join(' / ')+(affected.length>3?' and surrounds':'')):'No active warning detected in Queensland'};
  const products=composeProducts({...snapshot,outages:context.outages});const blobs=await exportProducts(products);radar.close?.();trackingImage?.close?.();
  return {snapshot,products,blobs,notices};
}
export async function snapshotReport(snapshot,signal){const {context,active,affected,lgas,generated}=snapshot;
  let names=[],majorAvailable=true;
  if(snapshot.demo)names=snapshot.demoMajorNames||[];else if(snapshot.roads.some(r=>r.condition==='closed'))try{names=await majorNames(signal);}catch{majorAvailable=false;}
  checkAbort(signal);const selected=active?affected:lgas.features;
  return buildReport({lgas:selected,allLgas:lgas,outages:context.outages,powerState:powerHealth(context.outages,context.manifest,generated.getTime()),roads:snapshot.roads,trafficAvailable:context.traffic?.type==='FeatureCollection',majorNames:names,majorAvailable,asAt:aest(generated),
    scope:active?'Scope: current unplanned outages and major-road closures across whole LGAs intersected by the selected warning; impacts may lie outside the warning footprint.':'Scope: Queensland statewide; no active warning was detected.'});
}
