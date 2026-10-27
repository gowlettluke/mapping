import {canvas,checkAbort,abortError} from './utils.js';

// Registered service details are session data. Never persist, log, or expose
// this configuration: existing URL/custom parameters may contain credentials.
export class WmsError extends Error {}
const entries=value=>value&&typeof value==='object'&&!Array.isArray(value)?Object.entries(value):[];
const list=value=>Array.isArray(value)?value:typeof value==='string'?value.split(','):[];
function parameter(url,key){return [...url.searchParams].find(([name])=>name.toLowerCase()===key.toLowerCase())?.[1];}
function setParameter(url,key,value){
  if(value==null)return;
  for(const name of [...url.searchParams.keys()])if(name.toLowerCase()===key.toLowerCase())url.searchParams.delete(name);
  url.searchParams.set(key,String(value));
}
function httpsUrl(value){
  let url;try{url=new URL(value);}catch{throw new WmsError('Registered WMS URL is missing or invalid.');}
  if(url.protocol!=='https:'||url.username||url.password)throw new WmsError('Registered WMS URL must use HTTPS without a username or password.');
  return url;
}
function definition(data,itemId){
  if(!data||typeof data!=='object')return {};
  const wrappers=[...(data.operationalLayers||[]),...(data.layers||[])].filter(layer=>layer.layerType==='WMS'||layer.type==='WMS');
  const matches=wrappers.filter(layer=>layer.itemId===itemId);
  if(matches.length===1)return matches[0];
  if(wrappers.length===1&&!data.mapUrl&&!data.url)return wrappers[0];
  return data;
}
function nativeLayers(layers,result=new Map()){
  for(const layer of layers||[]){
    if(typeof layer==='string')result.set(layer,{name:layer});
    else if(layer?.name)result.set(layer.name,{...result.get(layer.name),...layer});
    if(layer?.sublayers)nativeLayers(layer.sublayers,result);
  }return result;
}
export function registeredWmsConfig(item,data={},sdkData={}){
  if(data?.error)throw new WmsError('Private ArcGIS item configuration could not be read.');
  const raw=definition(data,item.id),loaded=definition(sdkData,item.id);
  const config={...loaded,...raw,itemId:item.id,url:raw.url||item.url||loaded.url,
    mapUrl:raw.mapUrl||loaded.mapUrl||raw.url||item.url||loaded.url,
    customParameters:{...loaded.customParameters,...raw.customParameters},
    customLayerParameters:{...loaded.customLayerParameters,...raw.customLayerParameters}};
  config.layers=[...nativeLayers(raw.layers,nativeLayers(loaded.layers)).values()];
  const url=mapUrl(config);
  config.version=raw.version||parameter(url,'version')||loaded.version||'1.3.0';
  if(!['1.1.0','1.1.1','1.3.0'].includes(config.version))throw new WmsError('Registered WMS version is not supported.');
  return config;
}
function mapUrl(config){
  const url=httpsUrl(config.mapUrl||config.url);
  for(const [key,value] of [...entries(config.customParameters),...entries(config.customLayerParameters)])setParameter(url,key,value);
  return url;
}
export function selectWmsLayers(config,names,titles=[]){
  // Use native WMS names, with exact title matching only as a fallback. A
  // missing catalogue (e.g. CORS-blocked capabilities) still permits a real
  // GetMap verification of the recorded native IDs; it never implies success.
  const catalogue=config.layers||[];
  const selected=names.map((name,index)=>catalogue.find(layer=>layer.name===name)||catalogue.find(layer=>titles[index]&&String(layer.title).toLowerCase()===titles[index].toLowerCase())||(!catalogue.length?{name}:null));
  if(!selected.length||selected.some(layer=>!layer?.name)||new Set(selected.map(layer=>layer.name)).size!==selected.length)throw new WmsError('A required native WMS sublayer is unavailable.');
  return selected;
}
function selectedStyles(config,layers){
  const url=mapUrl(config),specified=parameter(url,'styles'),styles=specified==null?list(config.styles):specified.split(',');
  const queryOrder=list(parameter(url,'layers'));
  const order=list(config.visibleLayers).length?list(config.visibleLayers):queryOrder.length?queryOrder:config.layers.map(layer=>layer.name);
  return layers.map(layer=>{
    if(specified!=null||styles.length){const index=order.indexOf(layer.name);if(index>=0&&index<styles.length)return String(styles[index]??'');if(specified!=null&&styles.length===1&&layers.length===1)return String(styles[0]);}
    return typeof layer.style==='string'?layer.style:layer.style?.name||'';
  });
}
function spatialReference(config){
  const supported=list(config.spatialReferences);
  if(!supported.length)return 3857;
  const wkid=[3857,102100,102113,900913].find(id=>supported.some(value=>Number(value)===id));
  if(!wkid)throw new WmsError('Registered WMS does not advertise a supported Web Mercator coordinate system.');
  return wkid;
}
function validateFrame(extent,width,height){
  if(extent.length!==4||!extent.every(Number.isFinite)||extent[2]<=extent[0]||extent[3]<=extent[1]||!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>4096||height>4096)throw new WmsError('Invalid WMS image extent or dimensions.');
}
export function wmsMapRequest(config,layers,extent,width,height){
  validateFrame(extent,width,height);const url=mapUrl(config),wkid=spatialReference(config);
  // Retain vendor/query parameters, then replace only image-operation fields.
  for(const name of [...url.searchParams.keys()])if(['srs','crs'].includes(name.toLowerCase()))url.searchParams.delete(name);
  const query={service:'WMS',request:'GetMap',version:config.version,layers:layers.map(layer=>layer.name).join(','),styles:selectedStyles(config,layers).join(','),
    format:'image/png',transparent:'TRUE',width,height,bbox:extent.join(','),[config.version==='1.3.0'?'crs':'srs']:'EPSG:'+wkid};
  for(const [key,value] of Object.entries(query))setParameter(url,key,value);
  return url.href;
}
export function wmsPrintMap(config,layers,extent,width,height){
  validateFrame(extent,width,height);
  // ExportWebMap expands extents to its output aspect ratio. Request that
  // expansion explicitly, then crop back so pixels keep their original bounds.
  let w=extent[2]-extent[0],h=extent[3]-extent[1];const ratio=width/height;
  if(w/h<ratio)w=h*ratio;else h=w/ratio;
  const cx=(extent[0]+extent[2])/2,cy=(extent[1]+extent[3])/2,e=[cx-w/2,cy-h/2,cx+w/2,cy+h/2];
  const url=mapUrl(config),names=layers.map(layer=>layer.name),styles=selectedStyles(config,layers);
  // STYLES/LAYERS are selected per render; all other registered parameters
  // remain on the URL as well as in the web-map definition.
  const operationFields=['service','version','format','transparent','layers','styles','bbox','width','height','request','crs','srs'];
  for(const name of [...url.searchParams.keys()])if(operationFields.includes(name.toLowerCase()))url.searchParams.delete(name);
  // Carry native selection in both representations for print services that
  // consume only the URL; duplicate standard fields then have equal values.
  for(const [key,value] of Object.entries({service:'WMS',version:config.version,format:'image/png',transparent:'TRUE',layers:names.join(','),styles:styles.join(',')}))setParameter(url,key,value);
  const printParameters=value=>Object.fromEntries(entries(value).filter(([key])=>!operationFields.includes(key.toLowerCase())));
  const webMap={mapOptions:{extent:{xmin:e[0],ymin:e[1],xmax:e[2],ymax:e[3],spatialReference:{wkid:3857}},spatialReference:{wkid:3857},background:{color:[0,0,0,0]}},
    operationalLayers:[{id:config.itemId,itemId:config.itemId,type:'wms',layerType:'WMS',url:url.href,mapUrl:url.href,version:config.version,
      customParameters:printParameters(config.customParameters),customLayerParameters:printParameters(config.customLayerParameters),layers:names.map(name=>({name})),visibleLayers:names,styles,
      opacity:1,visibility:true,format:'png32',transparentBackground:true}],
    exportOptions:{outputSize:[width,height],dpi:96},baseMap:{baseMapLayers:[]}};
  return {webMap,crop:[(extent[0]-e[0])/w*width,(e[3]-extent[3])/h*height,(extent[2]-extent[0])/w*width,(extent[3]-extent[1])/h*height]};
}
function readableImage(image,width,height,crop){
  if(!image||image.width!==width||image.height!==height)throw new WmsError('Weather service returned an unexpected image size.');
  const output=canvas(width,height),ctx=output.getContext('2d');
  if(crop)ctx.drawImage(image,...crop,0,0,width,height);else ctx.drawImage(image,0,0);
  // A displayable cross-origin image can still taint canvas and prevent both
  // warning detection and JPEG export. Verify read access before accepting it.
  ctx.getImageData(0,0,1,1);return output;
}
function printError(data){
  if(data?.error||data?.messages?.some(message=>message.type==='esriJobMessageTypeError'||/unable to|failed to|cannot (?:create|load|draw)|could not (?:create|load|draw)/i.test(message.description||'')))throw new WmsError('Organisation print service could not render the registered WMS layer.');
}
function waitForPoll(signal){return new Promise((resolve,reject)=>{
  checkAbort(signal);const cancel=()=>{clearTimeout(timer);reject(abortError());},timer=setTimeout(()=>{signal?.removeEventListener('abort',cancel);resolve();},1000);signal?.addEventListener('abort',cancel,{once:true});
});}
function taskPath(base,suffix){const url=new URL(base);url.pathname=url.pathname.replace(/\/$/,'')+suffix;return url.href;}
export async function renderWmsPrintImage({request,printTask,config,layers,extent,width,height,signal}){
  if(!printTask)throw new WmsError('Browser WMS rendering failed and no print service is configured for this ArcGIS organisation.');
  const task=httpsUrl(printTask);task.pathname=task.pathname.replace(/\/$/,'');
  const taskUrl=task.href,options={responseType:'json',authMode:'no-prompt',timeout:20000,signal};
  const metadata=(await request(taskUrl,{...options,query:{f:'json'}})).data;checkAbort(signal);printError(metadata);
  if(!metadata?.parameters?.some(p=>p.name==='Web_Map_as_JSON'))throw new WmsError('Organisation print service does not expose an Export Web Map task.');
  const formats=metadata.parameters.find(p=>p.name==='Format')?.choiceList||[];
  const format=formats.find(f=>String(f).toUpperCase()==='PNG32')||formats.find(f=>String(f).toUpperCase()==='PNG')||(!formats.length?'PNG32':null);
  if(!format)throw new WmsError('Organisation print service does not support PNG map images.');
  const {webMap,crop}=wmsPrintMap(config,layers,extent,width,height),query={f:'json',Web_Map_as_JSON:JSON.stringify(webMap),Format:format,Layout_Template:'MAP_ONLY'};
  let result,jobUrl;
  try{
    if(metadata.executionType==='esriExecutionTypeAsynchronous'){
      const submitted=(await request(taskPath(taskUrl,'/submitJob'),{...options,method:'post',query})).data;printError(submitted);
      if(!/^[A-Za-z0-9_-]+$/.test(submitted?.jobId||''))throw new WmsError('Organisation print service did not return a valid job.');
      jobUrl=taskPath(taskUrl,'/jobs/'+submitted.jobId);let job=submitted;
      for(let i=0;i<60;i++){
        checkAbort(signal);printError(job);
        if(job.jobStatus==='esriJobSucceeded')break;
        if(['esriJobFailed','esriJobCancelled','esriJobTimedOut','esriJobDeleted'].includes(job.jobStatus))throw new WmsError('Organisation print job did not complete.');
        await waitForPoll(signal);job=(await request(jobUrl,{...options,query:{f:'json'}})).data;
      }
      if(job.jobStatus!=='esriJobSucceeded')throw new WmsError('Organisation print job timed out.');
      const name=metadata.parameters.find(p=>p.direction==='esriGPParameterDirectionOutput'&&p.dataType==='GPDataFile')?.name;
      if(!name)throw new WmsError('Organisation print service has no image output.');
      result=(await request(taskPath(jobUrl,'/results/'+encodeURIComponent(name)),{...options,query:{f:'json'}})).data;printError(result);
    }else{
      const executed=(await request(taskPath(taskUrl,'/execute'),{...options,method:'post',timeout:45000,query})).data;checkAbort(signal);printError(executed);
      result=executed.results?.find(r=>r.dataType==='GPDataFile'||r.value?.url);
    }
    checkAbort(signal);if(!result?.value?.url)throw new WmsError('Organisation print service returned no image output.');const imageUrl=httpsUrl(result.value.url).href;
    const image=(await request(imageUrl,{responseType:'image',authMode:'no-prompt',timeout:20000,signal})).data;
    try{checkAbort(signal);return readableImage(image,width,height,crop);}finally{image?.close?.();}
  }catch(error){
    if(jobUrl)try{await request(taskPath(jobUrl,'/cancel'),{responseType:'json',authMode:'no-prompt',method:'post',query:{f:'json'},timeout:5000});}catch{}
    throw error;
  }
}
export async function renderRegisteredWms({request,printTask,config,names,titles,extent,width,height,signal,preferPrint=false}){
  checkAbort(signal);validateFrame(extent,width,height);const layers=selectWmsLayers(config,names,titles);
  if(!preferPrint){
    let image;
    try{
      image=(await request(wmsMapRequest(config,layers,extent,width,height),{responseType:'image',authMode:'no-prompt',timeout:10000,signal})).data;
      checkAbort(signal);return {image:readableImage(image,width,height),route:'direct'};
    }catch(error){checkAbort(signal);}
    finally{image?.close?.();}
  }
  try{return {image:await renderWmsPrintImage({request,printTask,config,layers,extent,width,height,signal}),route:'print'};}
  catch(error){checkAbort(signal);if(error instanceof WmsError)throw error;throw new WmsError('Registered WMS rendering failed through the browser and organisation print service.');}
}
