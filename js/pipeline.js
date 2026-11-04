import {CONFIG} from '../config.js';
import {projectedBounds,geographicBounds,fitExtent,contains,lgaName,path,transform,overlap} from './geometry.js';
import {warningCanvas,analyseCanvas,rasterIntersects} from './raster.js';
import {lgas,loadPublic,majorNames} from './sources.js';
import {basemap,composeProducts,exportProducts} from './renderer.js';
import {normaliseRoads,buildReport} from './report.js';
import {providerCouncils} from './council-counts.js';
import {aest,checkAbort,canvas} from './utils.js';
import {nativeFloodLabelsInAreas,catchmentFloodLabels,mapReservations,combinedFloodLegend} from './flood-display.js';
import {withDeadline} from './connections.js';
import {intersectFloodMask,clipFloodImage,floodSelectionOutline} from './flood-scope.js';
import {currentFloodNotices,loadFloodNotices} from './flood-notices.js';
export function warningLgas(collection,masks){return collection.features.filter(f=>masks.some(m=>rasterIntersects(m,f.geometry)));}
async function scan(connection,names,titles,extent,boundary,width,height,signal){const im=await connection.render('warning',extent,width,height,names,titles,signal),c=warningCanvas(im,width,height,extent,boundary);im.close?.();return {...analyseCanvas(c,extent),canvas:c};}
export async function scanFloods(connection,signal,onProgress=()=>{}){
  onProgress('Loading current BoM flood warnings and watches...');return currentFloodNotices(signal);
}
async function nearbyFloodLayer(connection,selection,extent,boundary,width,height,signal){
  const key=selection.key==='floodWarnings'?'floodWatches':'floodWarnings',index=key==='floodWarnings'?0:1,kind=index?'Flood Watch':'Flood Warning';
  try{return await withDeadline(async s=>{
    const areas=(await loadFloodNotices(key,s)).filter(area=>overlap(area.extent,extent));if(!areas.length)return null;
    const source=await scan(connection,[CONFIG.profiles.flooding.warning[index]],[CONFIG.profiles.flooding.titles[index]],extent,boundary,width,height,s),geometries=areas.flatMap(area=>area.scopeGeometries),scoped=intersectFloodMask(source.mask,geometries);
    if(!scoped.active)throw new Error('Nearby flood layer has not updated.');return {index,kind,areas,mask:scoped.mask,canvas:clipFloodImage(source.canvas,extent,geometries)};
  },signal,20000);}catch{checkAbort(signal);return {notice:'Nearby '+kind.toLowerCase()+' context could not be loaded. The selected warning is still shown.'};}
}
export async function generateSnapshot({connection,profile='thunderstorm',selection=null,tracking=false,outageLabelMinimum,signal,onProgress=()=>{}}){
  const spec=CONFIG.profiles[profile],{width,height,detection,minimumRegionalKm,padding}=CONFIG.rendering;let floodSelection=profile==='flooding'?selection:null,floodAreas=[],selectionOutline=null;
  if(profile==='flooding'){
    onProgress('Checking the selected BoM flood warning...');
    if(floodSelection){floodAreas=await loadFloodNotices(floodSelection.key,signal);const current=floodAreas.find(notice=>notice.id===floodSelection.id);
      if(!current||current.revision!==floodSelection.revision)throw new Error('The selected BoM flood warning changed. Refresh warnings and select it again.');floodSelection=current;
    }else if((await currentFloodNotices(signal)).length)throw new Error('A BoM flood warning/watch is current. Refresh warnings and select one first.');
  }
  onProgress('Loading Queensland LGA polygons...');const boundary=await lgas(signal);let active,extent,scopeMasks;
  if(floodSelection){active=true;extent=fitExtent(floodSelection.extent,width,height,{minimumKm:minimumRegionalKm,padding});scopeMasks=[];}
  else if(profile==='flooding'){active=false;extent=fitExtent(projectedBounds(CONFIG.rendering.qld),width,height);}
  else {onProgress('Detecting the current '+spec.label.toLowerCase()+' warning...');const initial=await scan(connection,spec.warning,spec.titles,projectedBounds(CONFIG.rendering.qld),boundary,...detection,signal);active=initial.active;extent=active?fitExtent(initial.extent,width,height,{minimumKm:minimumRegionalKm,padding}):fitExtent(projectedBounds(CONFIG.rendering.qld),width,height);}
  onProgress('Loading shared infrastructure data and map background...');const [{data:context,notices},background]=await Promise.all([loadPublic(geographicBounds(extent),signal),basemap(extent,width,height,signal)]);checkAbort(signal);
  if(background.failed){notices.push(background.failed+' of '+background.total+' background tiles were unavailable.');if(background.failed===background.total){context.basemapUnavailable=true;const ctx=background.canvas.getContext('2d'),p=transform(extent,width,height);ctx.fillStyle='#f2eee5';for(const f of boundary.features){ctx.beginPath();path(ctx,f.geometry,p);ctx.fill('evenodd');}}}
  onProgress('Rendering the same warning snapshot for both JPEG maps...');const [weather,radar,nearby]=await Promise.all([
    scan(connection,floodSelection?.names||spec.warning,floodSelection?.titles||spec.titles,extent,boundary,width,height,signal),connection.render('radar',extent,width,height,CONFIG.radar.names,CONFIG.radar.titles,signal),floodSelection?nearbyFloodLayer(connection,floodSelection,extent,boundary,width,height,signal):null
  ]);
  if(profile!=='flooding'&&weather.active!==active)throw new Error('The warning changed during generation. Generate maps again.');
  if(profile==='flooding'&&!floodSelection&&weather.active)throw new Error('The BoM notice list and flood map are updating. Refresh warnings and try again.');
  const floodLayers=[];if(nearby?.notice)notices.push(nearby.notice);
  if(active&&profile==='flooding'){
    const scoped=intersectFloodMask(weather.mask,floodSelection.scopeGeometries);
    if(!weather.active||!scoped.active||floodSelection.scopeGeometries.some(geometry=>!intersectFloodMask(weather.mask,[geometry]).active))throw new Error('The map does not yet show every catchment in this BoM warning. Refresh warnings and try again.');
    scopeMasks=[scoped.mask];selectionOutline=floodSelectionOutline(weather.mask,floodSelection.scopeGeometries);
    const allGeometries=floodAreas.flatMap(area=>area.scopeGeometries),index=floodSelection.key==='floodWarnings'?0:1;
    const selectedLayer={index,kind:floodSelection.kind,selected:true,areas:floodAreas,mask:intersectFloodMask(weather.mask,allGeometries).mask,canvas:clipFloodImage(weather.canvas,extent,allGeometries)};
    if(nearby?.canvas)floodLayers.push(nearby);floodLayers.push(selectedLayer);
    const image=canvas(width,height),ctx=image.getContext('2d');for(const layer of floodLayers)ctx.drawImage(layer.canvas,0,0);weather.canvas=image;weather.mask=scoped.mask;
  }
  if(active&&profile!=='flooding')scopeMasks=[weather.mask];if(!active)scopeMasks=[];
  let floodDisplay=null;
  if(active&&profile==='flooding'){
    onProgress('Adding warning names and source legends...');const labelsImage=canvas(width,height),labelsContext=labelsImage.getContext('2d'),boxes=[],legends=[];let labelMode='native';
    const optional=promise=>promise.catch(()=>{checkAbort(signal);return null;});
    const displays=await Promise.all(floodLayers.map(async layer=>{
      const geometries=layer.areas.flatMap(area=>area.scopeGeometries);
      const names=optional(withDeadline(async s=>{const image=await connection.render('warning',extent,width,height,[spec.labels[layer.index]],[],s);try{return nativeFloodLabelsInAreas(image,extent,geometries);}finally{image?.close?.();}},signal,20000));
      const sourceLegend=optional(Promise.resolve().then(()=>connection.legend('warning',spec.warning[layer.index],signal)));
      const [labels,legend]=await Promise.all([names,sourceLegend]);checkAbort(signal);return {layer,labels,legend};
    }));
    for(const display of displays){
      const {layer,legend}=display;let labels=display.labels;
      if(!labels){labels=catchmentFloodLabels(layer.mask,{features:layer.areas.flatMap(area=>area.referenceFeatures)},{reserved:[...mapReservations(width,height,context.locator),...boxes]});labelMode='catchments';if(!labels.boxes.length)notices.push(layer.kind+' area names could not be loaded.');}
      if(!legend)notices.push(layer.kind+' source legend could not be loaded.');legends.push({kind:layer.kind,selected:layer.selected,legend});labelsContext.drawImage(labels.image,0,0);boxes.push(...labels.boxes);
    }
    floodDisplay={kind:floodSelection.kind,labels:labelsImage,labelBoxes:boxes,labelMode,legend:combinedFloodLegend(legends)};
  }
  let trackingImage=null;if(tracking&&active&&spec.tracking.length){try{trackingImage=await connection.render('warning',extent,width,height,spec.tracking,[],signal);}catch{notices.push('Storm tracking was unavailable; it was omitted.');}}
  const affected=active?warningLgas(boundary,scopeMasks):boundary.features;if(active&&!affected.length)throw new Error('No Queensland LGA intersection could be verified for this warning');
  const generated=new Date(),roads=normaliseRoads(context.traffic,generated.getTime());
  const snapshot={extent,active,profile,profileLabel:spec.label,generated,mask:weather.mask,scopeMasks,lgas:boundary,affected,context,background:background.canvas,warning:weather.canvas,radar,tracking:trackingImage,roads,demo:false,outageLabelMinimum,floodDisplay,selectionOutline,floodNotice:floodSelection,
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
