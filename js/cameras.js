import {CONFIG} from '../config.js';
import {json,request,imageFromBlob,canvas,clean,verifiedTime,checkAbort,pooled,errorText} from './utils.js';
import {queryArcgis} from './sources.js';
import {maskContains} from './raster.js';
import {safeImageUrl,cameraImageLinks} from './camera-images.js';
const captureKeys=new Set(['imagecapturedat','imagecapturetime','photocapturedat','photocapturetime','phototakenat','imageexifdatetimeoriginal']);
export function captureTime(props){for(const [key,value] of Object.entries(props||{}))if(captureKeys.has(key.toLowerCase().replace(/[^a-z0-9]/g,'')))return verifiedTime(value);return null;}
export const safeUrl=safeImageUrl;
export function externalPhotoLink(raw){const url=safeUrl(raw);if(!url)return '';const u=new URL(url);return [...u.searchParams.keys()].some(k=>/token|api.?key|signature|^sig$|^key$|x-amz|credential/i.test(k))?'':url;}
export function normaliseCameras(payload,source,label){const rows=Array.isArray(payload)?payload:payload.features||payload.webcams||payload.data||[];if(!Array.isArray(rows))throw new Error(label+' returned an unknown camera format');
  return rows.flatMap((f,index)=>{const p=f.properties||f,aliases=Object.fromEntries(Object.entries(p).map(([k,v])=>[k.toLowerCase().replace(/[^a-z0-9]/g,''),v])),point=f.geometry?.type==='Point'?f.geometry.coordinates:
    [Number(p.longitude??p.lon??p.lng??p.location?.longitude),Number(p.latitude??p.lat??p.location?.latitude)];
    const links=cameraImageLinks(p),baseId=f.id??p.camera_id??p.id??p.objectid??index,baseName=clean(p.Location_Name||p.location_name||p.description||p.name||p.title||aliases.cameraname||aliases.sitename||aliases.locationname||'Camera '+(index+1));
    return links.map((image,i)=>({id:source+':'+baseId+(links.length>1?':'+image.field:''),source,sourceLabel:label,
      name:baseName+(p._camera_view?' · '+clean(p._camera_view):links.length>1?' · view '+(i+1):''),point,url:image.url,capturedAt:captureTime(p)}));
  }).filter(c=>c.url&&c.point.length>=2&&c.point.every(Number.isFinite)&&Math.abs(c.point[0])<=180&&Math.abs(c.point[1])<=90);
}
export function selectCameras(cameras,masks){const seen=new Set();return cameras.filter(c=>{
  if(!masks.some(mask=>maskContains(mask,c.point)))return false;const u=new URL(c.url);for(const k of ['_','timestamp','cacheBust'])u.searchParams.delete(k);const key=u.href;
  if(seen.has(key))return false;seen.add(key);return true;
}).sort((a,b)=>a.sourceLabel.localeCompare(b.sourceLabel)||a.name.localeCompare(b.name));}
export async function discoverCameras(connection,masks,signal){const collections=await connection.cameraCollections(signal),notices=[];let publicRows=[];
  try{publicRows=normaliseCameras(await json(CONFIG.publicSources.trafficCameras,{signal,timeout:12000}),'tmr','TMR traffic cameras');}
  catch{try{publicRows=normaliseCameras(await queryArcgis(CONFIG.publicSources.cameraFallback,{signal}),'tmr','TMR traffic cameras');}catch(e){notices.push('TMR traffic cameras: '+errorText(e));}}
  const rows=[...publicRows];for(const c of collections){if(c.error){notices.push(c.label+': '+errorText(c.error));continue;}try{rows.push(...normaliseCameras(c.collection,c.key,c.label));}catch(e){notices.push(errorText(e));}}
  return {cameras:selectCameras(rows,masks),notices};
}
export const CAMERA_PHOTO_FILTERS={
  all:{label:'Include all cameras',maxHours:null,verifiedOnly:false},
  '1h':{label:'Exclude photos older than 1 hour',maxHours:1,verifiedOnly:false},
  '24h':{label:'Exclude photos older than 24 hours',maxHours:24,verifiedOnly:false},
  verified:{label:'Exclude unverified capture times',maxHours:null,verifiedOnly:true},
  'verified-1h':{label:'Only verified photos within 1 hour',maxHours:1,verifiedOnly:true},
  'verified-24h':{label:'Only verified photos within 24 hours',maxHours:24,verifiedOnly:true}
};
export function normalisePhotoFilter(value,profile='thunderstorm'){return Object.hasOwn(CAMERA_PHOTO_FILTERS,value)?value:profile==='flooding'?'all':'1h';}
export function photoEligibility(camera,now=Date.now(),filter='1h'){const parsed=camera.capturedAt instanceof Date?camera.capturedAt:verifiedTime(camera.capturedAt),verified=parsed&&Number.isFinite(+parsed)&&+parsed<=now+5*60000?parsed:null,rule=CAMERA_PHOTO_FILTERS[normalisePhotoFilter(filter)];
  if(rule.verifiedOnly&&!verified)return {included:false,reason:'unverified'};
  if(verified&&rule.maxHours!==null&&+verified<now-rule.maxHours*3600000)return {included:false,reason:'stale'};
  return {included:true,capturedAt:verified,reason:verified?'verified':'unknown'};
}
export function filterCameraPhotos(cameras,{filter,profile='thunderstorm',now=Date.now()}={}){
  const selected=normalisePhotoFilter(filter,profile);let stale=0,unverified=0;const included=cameras.filter(camera=>{const result=photoEligibility(camera,now,selected);if(!result.included){if(result.reason==='stale')stale++;else unverified++;}return result.included;});
  return {cameras:included,stale,unverified,filter:selected};
}
export async function retrievePhotos(cameras,{connection=null,signal,onProgress=()=>{},now=Date.now(),profile='thunderstorm',filter}={}){
  checkAbort(signal);const selected=normalisePhotoFilter(filter,profile);
  let completed=0;const results=await pooled(cameras,4,async camera=>{checkAbort(signal);const eligibility=photoEligibility(camera,now,selected);if(!eligibility.included){onProgress(++completed,cameras.length);return {camera,excluded:eligibility.reason};}
    try{let blob;const url=new URL(camera.url);if(connection?.sdk&&/(^|\.)arcgis\.com$/i.test(url.hostname))blob=(await connection.sdk.esriRequest(camera.url,{responseType:'blob',timeout:20000,signal})).data;
      else blob=await(await request(camera.url,{signal,timeout:20000})).blob();checkAbort(signal);
      if(!blob?.size)throw new Error('Empty photograph');const image=await imageFromBlob(blob);if(!(image.width>0&&image.height>0))throw new Error('Photograph could not be decoded');
      const scale=Math.min(1,1000/image.width,680/image.height),c=canvas(Math.max(1,Math.round(image.width*scale)),Math.max(1,Math.round(image.height*scale))),ctx=c.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,c.width,c.height);ctx.drawImage(image,0,0,c.width,c.height);image.close?.();
      return {camera,photo:{data:c.toDataURL('image/jpeg',.80),width:c.width,height:c.height,capturedAt:eligibility.capturedAt,retrievedAt:new Date()}};
    }catch(error){if(signal?.aborted)throw error;return {camera,excluded:'unavailable'};}
    finally{onProgress(++completed,cameras.length);}
  });
  return {included:results.filter(r=>r.photo),stale:results.filter(r=>r.excluded==='stale').length,unverified:results.filter(r=>r.excluded==='unverified').length,unavailable:results.filter(r=>r.excluded==='unavailable').length,filter:selected};
}
export function markerPositions(points,width,height,spacing=28){const placed=[];for(const [ax,ay] of points){let picked=null;
  for(let attempt=0;attempt<4000;attempt++){const angle=attempt*2.39996323,r=attempt?spacing*.6*Math.sqrt(attempt):0,x=Math.max(16,Math.min(width-16,ax+Math.cos(angle)*r)),y=Math.max(16,Math.min(height-16,ay+Math.sin(angle)*r));if(!placed.some(p=>Math.hypot(p[0]-x,p[1]-y)<spacing)){picked=[x,y];break;}}
  if(!picked)throw new Error('Too many cameras to place distinct overview markers');placed.push(picked);
}return placed;}
