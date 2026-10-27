import {CONFIG} from '../config.js';
import {json,isCollection,checkAbort,abortError,pooled,errorText} from './utils.js';
import {lgas,locator,majorNames} from './sources.js';
import {normaliseCameras} from './cameras.js';
import {powerHealth} from './report.js';
import {floodReference} from './flood-references.js';

export const FEEDS=[
  {id:'warning',label:'Warning WMS',required:true},
  {id:'radar',label:'Radar WMS',required:true},
  {id:'lgas',label:'Queensland LGAs',required:true},
  {id:'energex',label:'Energex outages'},{id:'ergon',label:'Ergon outages'},
  {id:'roads',label:'QLDTraffic events'},{id:'majorRoads',label:'Major-road classification'},
  {id:'locator',label:'Queensland locator'},{id:'coast',label:'Queensland coastline'},
  {id:'border',label:'State border'},{id:'basemap',label:'Topographic basemap'},
  {id:'trafficCameras',label:'TMR traffic cameras'},
  ...CONFIG.arcgis.cameras.map(s=>({id:'camera-'+s.key,label:s.label})),
  {id:'districts',label:'Disaster districts'},
  {id:'floodWarnings',label:'Flood warning catchment names'},
  {id:'floodWatches',label:'Flood watch catchment names'}
];
export const readyForMaps=states=>FEEDS.filter(f=>f.required).every(f=>states.get(f.id)?.status==='ok');

// Bound even a stalled SDK promise. Abort prevents its eventual result from
// modifying a superseded session; callbacks only belong to this check run.
export async function withDeadline(fn,signal,timeout=30000){
  checkAbort(signal);const controller=new AbortController();let timer,cancel;
  const stopped=new Promise((_,reject)=>{cancel=()=>{controller.abort();reject(abortError());};signal?.addEventListener('abort',cancel,{once:true});timer=setTimeout(()=>{controller.abort();reject(new Error('Connection check timed out. Retry this connection.'));},timeout);});
  try{return await Promise.race([Promise.resolve().then(()=>fn(controller.signal)),stopped]);}
  finally{clearTimeout(timer);signal?.removeEventListener('abort',cancel);}
}
export async function executeChecks(jobs,{signal,onUpdate=()=>{},timeout=30000}={}){
  const results=new Map();for(const job of jobs)onUpdate({...job,run:undefined,status:'pending',detail:'Waiting to check...'});
  await pooled(jobs,4,async job=>{
    checkAbort(signal);onUpdate({id:job.id,status:'checking',detail:'Checking connection...'});
    let result;try{const detail=await withDeadline(job.run,signal,job.timeout||timeout);result={id:job.id,status:'ok',detail:detail||'Connected'};}
    catch(error){if(signal?.aborted)throw error;result={id:job.id,status:'error',detail:errorText(error)};}
    checkAbort(signal);results.set(job.id,result);onUpdate(result);
  });return results;
}
async function countLayer(url,signal){const u=new URL(url.replace(/\/$/,'')+'/query');u.search=new URLSearchParams({where:'1=1',returnCountOnly:'true',f:'json'});const d=await json(u.href,{signal});if(!Number.isInteger(d.count)||d.count<0)throw new Error('Layer did not return a valid feature count');return 'Query connected';}
function collection(d,label){if(!isCollection(d))throw new Error(label+' did not return a valid feature collection');return d;}
export async function checkLayerConnections(connection,{warningId,radarId,signal,onUpdate}={}){
  const src=CONFIG.publicSources;
  let powerPromise;
  const power=()=>powerPromise??=(async()=>{const [feed,manifest]=await Promise.all([json(src.outages,{signal}),json(src.outageManifest,{signal})]);return powerHealth(feed,manifest);})();
  const jobs=[
    {id:'warning',timeout:115000,run:async s=>{await connection.bind('warning',warningId,s);const route=await connection.verifyRole('warning',s);return 'Registered warning layer rendered'+(route==='print'?' through organisation print service':'');}},
    {id:'radar',timeout:115000,run:async s=>{await connection.bind('radar',radarId,s);const route=await connection.verifyRole('radar',s);return 'Registered radar layer rendered'+(route==='print'?' through organisation print service':'');}},
    {id:'lgas',run:async s=>{await lgas(s);return 'Statewide LGA coverage verified';}},
    ...['energex','ergon'].map(code=>({id:code,run:async()=>{const healthy=await power();if(!healthy[code])throw new Error('Current outage snapshot could not be verified');return 'Current outage snapshot verified';}})),
    {id:'roads',run:async s=>{collection(await json(src.traffic,{signal:s}),'QLDTraffic');return 'Current events feed connected';}},
    {id:'majorRoads',run:async s=>{await majorNames(s);return 'Highway and motorway names available';}},
    {id:'locator',run:async s=>{await locator(s);return 'Coastal state shape available';}},
    {id:'coast',run:s=>countLayer(src.coastline,s)},
    {id:'border',run:s=>countLayer(src.border,s)},
    {id:'basemap',run:async s=>{const d=await json(src.topoMetadata+'?f=json',{signal:s});if(!d.tileInfo)throw new Error('Basemap tile service metadata unavailable');return 'Tile service connected; tiles load during generation';}},
    {id:'trafficCameras',run:async s=>{try{normaliseCameras(await json(src.trafficCameras,{signal:s,timeout:12000}),'tmr','TMR');return 'Camera list connected; photographs load on request';}catch(error){checkAbort(s);await countLayer(src.cameraFallback,s);return 'Fallback camera list connected; photographs load on request';}}},
    ...CONFIG.arcgis.cameras.map(spec=>({id:'camera-'+spec.key,run:async s=>{const cameras=await connection.probeFeature(spec,s),views=normaliseCameras(cameras,spec.key,spec.label);if(cameras.features.length&&!views.length)throw new Error('Camera source returned no usable image links and point locations.');return 'Camera list connected · '+views.length+' image views; photos load on request';}})),
    {id:'districts',run:async s=>{await connection.probeFeature(CONFIG.arcgis.districts,s);return 'Authenticated district layer connected';}},
    ...['floodWarnings','floodWatches'].map(key=>({id:key,run:async s=>{const result=await floodReference(key,s);return result.mode==='bundled'?'Bundled BoM catchment reference boundaries · '+new Date(result.retrievedAt).toLocaleDateString('en-AU',{timeZone:'Australia/Brisbane'}):'Current BoM catchment reference boundaries connected';}}))
  ];
  return executeChecks(jobs,{signal,onUpdate});
}
