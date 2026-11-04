import {CONFIG} from '../config.js';
import {projectedBounds,geographicBounds,fitExtent,contains,lgaName,path,transform} from './geometry.js';
import {warningCanvas,analyseCanvas,rasterIntersects} from './raster.js';
import {lgas,loadPublic,majorNames} from './sources.js';
import {basemap,composeProducts,exportProducts} from './renderer.js';
import {normaliseRoads,buildReport} from './report.js';
import {providerCouncils} from './council-counts.js';
import {aest,checkAbort} from './utils.js';
import {floodReference} from './flood-references.js';
import {nativeFloodLabels,catchmentFloodLabels,mapReservations} from './flood-display.js';
import {withDeadline} from './connections.js';
import {scopeFloodWeather} from './flood-scope.js';
import {currentFloodNotices,loadFloodNotices} from './flood-notices.js';
export function warningLgas(collection,masks){return collection.features.filter(f=>masks.some(m=>rasterIntersects(m,f.geometry)));}
async function scan(connection,names,titles,extent,boundary,width,height,signal){const im=await connection.render('warning',extent,width,height,names,titles,signal),c=warningCanvas(im,width,height,extent,boundary);im.close?.();return {...analyseCanvas(c,extent),canvas:c};}
export async function scanFloods(connection,signal,onProgress=()=>{}){
  onProgress('Loading current BoM flood warnings and watches...');return currentFloodNotices(signal);
}
export async function generateSnapshot({connection,profile='thunderstorm',selection=null,tracking=false,outageLabelMinimum,signal,onProgress=()=>{}}){
  const spec=CONFIG.profiles[profile],{width,height,detection,minimumRegionalKm,padding}=CONFIG.rendering;let floodSelection=profile==='flooding'?selection:null,floodNotices=[];
  if(profile==='flooding'){
    onProgress('Checking the selected BoM flood warning...');
    if(floodSelection){floodNotices=await loadFloodNotices(floodSelection.key,signal);const current=floodNotices.find(notice=>notice.id===floodSelection.id);
      if(!current||current.revision!==floodSelection.revision)throw new Error('The selected BoM flood warning changed. Refresh warnings and select it again.');floodSelection=current;
    }else if((await currentFloodNotices(signal)).length)throw new Error('A BoM flood warning/watch is current. Refresh warnings and select one first.');
  }
  onProgress('Loading Queensland LGA polygons...');const boundary=await lgas(signal);let active,extent,scopeMasks;
  if(floodSelection){active=true;extent=fitExtent(floodSelection.extent,width,height,{minimumKm:minimumRegionalKm,padding});scopeMasks=[];}
  else if(profile==='flooding'){active=false;extent=fitExtent(projectedBounds(CONFIG.rendering.qld),width,height);}
  else {onProgress('Detecting the current '+spec.label.toLowerCase()+' warning...');const initial=await scan(connection,spec.warning,spec.titles,projectedBounds(CONFIG.rendering.qld),boundary,...detection,signal);active=initial.active;extent=active?fitExtent(initial.extent,width,height,{minimumKm:minimumRegionalKm,padding}):fitExtent(projectedBounds(CONFIG.rendering.qld),width,height);}
  onProgress('Loading shared infrastructure data and map background...');const [{data:context,notices},background]=await Promise.all([loadPublic(geographicBounds(extent),signal),basemap(extent,width,height,signal)]);checkAbort(signal);
  if(background.failed){notices.push(background.failed+' of '+background.total+' background tiles were unavailable.');if(background.failed===background.total){context.basemapUnavailable=true;const ctx=background.canvas.getContext('2d'),p=transform(extent,width,height);ctx.fillStyle='#f2eee5';for(const f of boundary.features){ctx.beginPath();path(ctx,f.geometry,p);ctx.fill('evenodd');}}}
  onProgress('Rendering the same warning snapshot for both JPEG maps...');let [weather,radar]=await Promise.all([
    scan(connection,floodSelection?.names||spec.warning,floodSelection?.titles||spec.titles,extent,boundary,width,height,signal),connection.render('radar',extent,width,height,CONFIG.radar.names,CONFIG.radar.titles,signal)
  ]);
  if(profile!=='flooding'&&weather.active!==active)throw new Error('The warning changed during generation. Generate maps again.');
  if(profile==='flooding'&&!floodSelection&&weather.active)throw new Error('The BoM notice list and flood map are updating. Refresh warnings and try again.');
  const displayMask=weather.mask;
  if(active&&profile==='flooding'){
    // The report uses only the selected notice. The displayed WMS image keeps
    // neighbouring warnings in this viewport, with their original symbology.
    weather=scopeFloodWeather(weather,floodSelection.scopeGeometries);scopeMasks=[weather.mask];
  }
  if(active&&profile!=='flooding')scopeMasks=[weather.mask];if(!active)scopeMasks=[];
  let floodDisplay=null;
  if(active&&profile==='flooding'){
    onProgress('Adding flood area names and the source legend...');const index=floodSelection.names[0]===spec.warning[1]?1:0,kind=index?'Flood Watch':'Flood Warning';
    const optional=promise=>promise.catch(()=>{checkAbort(signal);return null;});
    const names=optional(withDeadline(async s=>{const image=await connection.render('warning',extent,width,height,[spec.labels[index]],[],s);try{return nativeFloodLabels(warningCanvas(image,width,height,extent,boundary));}finally{image?.close?.();}},signal,20000));
    const sourceLegend=optional(Promise.resolve().then(()=>connection.legend('warning',spec.warning[index],signal)));
    let [labels,legend]=await Promise.all([names,sourceLegend]);checkAbort(signal);
    if(!labels){let refs;try{refs=(await floodReference(index?'floodWatches':'floodWarnings',signal)).collection;}catch{checkAbort(signal);}
      const currentReferences=floodNotices.flatMap(notice=>notice.referenceFeatures||[]);
      labels=catchmentFloodLabels(displayMask,currentReferences.length?{features:currentReferences}:refs,{reserved:mapReservations(width,height,context.locator)});
      if(!labels.boxes.length)notices.push('Flood area names could not be loaded.');
    }
    if(!legend)notices.push('The source flood legend could not be loaded.');
    floodDisplay={kind,labels:labels.image,labelBoxes:labels.boxes,labelMode:labels.mode,legend};
  }
  let trackingImage=null;if(tracking&&active&&spec.tracking.length){try{trackingImage=await connection.render('warning',extent,width,height,spec.tracking,[],signal);}catch{notices.push('Storm tracking was unavailable; it was omitted.');}}
  const affected=active?warningLgas(boundary,scopeMasks):boundary.features;if(active&&!affected.length)throw new Error('No Queensland LGA intersection could be verified for this warning');
  const generated=new Date(),roads=normaliseRoads(context.traffic,generated.getTime());
  const snapshot={extent,active,profile,profileLabel:spec.label,generated,mask:weather.mask,scopeMasks,lgas:boundary,affected,context,background:background.canvas,warning:weather.canvas,radar,tracking:trackingImage,roads,demo:false,outageLabelMinimum,floodDisplay,floodNotice:floodSelection,
    scopeLabel:active?(floodSelection?.title||affected.slice(0,3).map(lgaName).join(' / ')+(affected.length>3?' and surrounds':'')):'No active warning detected in Queensland'};
  const products=composeProducts({...snapshot,outages:context.outages});const blobs=await exportProducts(products);radar.close?.();trackingImage?.close?.();
  return {snapshot,products,blobs,notices};
}
export async function snapshotReport(snapshot,signal){const {context,active,affected,lgas,generated}=snapshot;
  let names=[],majorAvailable=true;
  if(snapshot.demo)names=snapshot.demoMajorNames||[];else if(snapshot.roads.some(r=>r.condition==='closed'))try{names=await majorNames(signal);}catch{majorAvailable=false;}
  checkAbort(signal);const selected=active?affected:lgas.features;
  return buildReport({lgas:selected,allLgas:lgas,powerCounts:providerCouncils(context.manifest,generated.getTime()),roads:snapshot.roads,trafficAvailable:context.traffic?.type==='FeatureCollection',majorNames:names,majorAvailable,asAt:aest(generated),areaLabel:active?'the LGAs affected by this warning':'Queensland',statewide:!active,
    scope:active?'Unplanned outages and major road closures in warning LGAs; impacts may extend beyond the warning area.':'Queensland-wide unplanned outages and major road closures; no active warning detected.'});
}
