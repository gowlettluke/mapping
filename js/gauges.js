import {CONFIG} from '../config.js';
import {clean,verifiedTime,checkAbort,pooled,request,imageFromBlob,canvas,aest} from './utils.js';
import {safeImageUrl} from './camera-images.js';
import {maskContains} from './raster.js';
import {isBomGraphUrl} from './graph-export.js';

const key=s=>String(s).toLowerCase().replace(/[^a-z0-9]/g,'');
const names={
  station:['stationnum','stationid','stationnumber','stationno','bomstationnumber','bomstationid','bomnumber','stnno','gaugenumber','gaugeid','siteid'],
  name:['stationname','gaugename','sitename','locationname','stationdescription','name','description','location'],
  height:['riverheight','riverheightm','heightm','waterlevelm','waterlevel','riverlevel','latestheight','latestlevel','height','level'],
  category:['floodclassification','floodclass','floodcategory','floodstatus','floodlevel','class','classification','category'],
  trend:['tendency','rivertrend','heighttrend','trend'],
  observed:['observationtime','observationdatetime','observedat','observedtime','observationdate','readingtime','readingdatetime','timestamp'],
  updated:['fmetimestamp','lastupdate','lastupdated','lastupdatedat','updatedat','updatedtime','updatetime','sourceupdated','sourceupdatedat','lastediteddate'],
  graph:['urlchart','graphurl','hydrographurl','charturl','riverheightgraph','riverheightgraphurl','graphimageurl','imageurl','graph','hydrograph'],
  source:['urlpage','sourceurl','stationurl','bomurl','bomlink','weblink','linkurl']
};
export const GAUGE_COLOURS={major:'#ba2434',moderate:'#e68025',minor:'#e4c745',below:'#157f73',unknown:'#697783'};

function valuesFor(properties,fields){
  const values=new Map(Object.entries(properties).map(([name,value])=>[key(name),value]));
  for(const field of fields||[]){if(!(field.name in properties))continue;let value=properties[field.name];
    const coded=field.domain?.codedValues?.find(entry=>String(entry.code)===String(value));if(coded)value=coded.name;
    for(const alias of [field.alias,...(field.aliases||[])])if(alias&&!values.has(key(alias)))values.set(key(alias),value);
    // Coded source categories/trends use their published domain labels.
    if(coded)values.set(key(field.name),value);
  }return values;
}
function pick(values,role){for(const name of names[role]){const value=values.get(name);if(value!==undefined&&value!==null&&clean(value)!=='')return value;}return null;}
export function gaugeCategory(value){const text=key(value||'');if(/belowminor|noflood|notinflood|normal/.test(text))return 'below';if(/major/.test(text))return 'major';if(/moderate/.test(text))return 'moderate';if(/minor/.test(text))return 'minor';return 'unknown';}
function heightValue(value){if(value===null||value===undefined||clean(value)==='')return null;const text=clean(value);if(!/^[+-]?\d+(?:\.\d+)?\s*(?:m|metres?|meters?)?$/i.test(text))return null;const height=Number(text.replace(/\s*(?:m|metres?|meters?)$/i,''));return Number.isFinite(height)&&![-9999,-999,-99.99].includes(height)?height:null;}
function expand(template,properties){
  if(typeof template!=='string')return '';const values=new Map(Object.entries(properties).map(([name,value])=>[key(name),value]));let missing=false;
  const whole=/^\{([^{}]+)\}$/.exec(template.trim());if(whole)return clean(values.get(key(whole[1]))||'');
  const result=template.replace(/\{([^{}]+)\}/g,(_,name)=>{const value=values.get(key(name));if(value===undefined||value===null||clean(value)===''){missing=true;return '';}return encodeURIComponent(String(value));});
  return missing?'':result.replace(/&amp;/gi,'&');
}
export function gaugeGraphLink(properties,popupInfo={},fields=[]){
  const direct=pick(valuesFor(properties,fields),'graph'),candidates=direct?[direct]:[];
  const media=[...(popupInfo.mediaInfos||[]),...(popupInfo.popupElements||popupInfo.content||[]).flatMap(element=>element.mediaInfos||[])];
  for(const item of media)if(item.type==='image')candidates.push(item.value?.sourceURL||item.value?.sourceUrl);
  const html=[popupInfo.description,...(popupInfo.popupElements||popupInfo.content||[]).map(element=>element.text||element.description)].filter(s=>typeof s==='string').join(' ');
  for(const match of html.matchAll(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi))candidates.push(match[1]);
  for(const candidate of candidates){const value=safeImageUrl(expand(candidate,properties));if(value){const url=new URL(value);if(url.protocol==='http:')url.protocol='https:';return url.href;}}return '';
}
export function normaliseGauges({collection,fields=[],popupInfo={},sourceLabel='BoM river gauges'}){
  if(collection?.type!=='FeatureCollection'||!Array.isArray(collection.features)||collection.exceededTransferLimit)throw new Error('River gauge source is incomplete or invalid.');
  const rows=[];for(const feature of collection.features){const p=feature.properties||{},values=valuesFor(p,fields),point=feature.geometry?.type==='Point'?feature.geometry.coordinates:null;
    if(!point||point.length<2||!point.slice(0,2).every(Number.isFinite)||Math.abs(point[0])>180||Math.abs(point[1])>90)continue;
    const stationId=clean(pick(values,'station')??''),name=clean(pick(values,'name')||(stationId?'Station '+stationId:''));if(!name)continue;
    const reportedCategory=clean(pick(values,'category')??'Classification not supplied'),observedAt=verifiedTime(pick(values,'observed')),updatedAt=verifiedTime(pick(values,'updated'));
    rows.push({id:stationId||'feature:'+(feature.id??p.OBJECTID??p.objectid??point.join(',')),stationId,name,point:point.slice(0,2),height:heightValue(pick(values,'height')),reportedCategory,category:gaugeCategory(reportedCategory),trend:clean(pick(values,'trend')||''),observedAt,updatedAt,
      graphUrl:gaugeGraphLink(p,popupInfo,fields),sourceUrl:safeImageUrl(pick(values,'source'))||safeImageUrl(expand(popupInfo.mediaInfos?.find(media=>media.type==='image')?.value?.linkURL,p)),sourceLabel});
  }
  if(collection.features.length&&!rows.length)throw new Error('The gauge layer has no recognised station names and point locations.');return rows;
}
export function selectGauges(rows,masks){
  const byStation=new Map();for(const gauge of rows){if(!masks.some(mask=>maskContains(mask,gauge.point)))continue;
    const previous=byStation.get(gauge.id),time=gauge.observedAt?.getTime()??gauge.updatedAt?.getTime()??-Infinity,oldTime=previous?.observedAt?.getTime()??previous?.updatedAt?.getTime()??-Infinity;
    if(!previous||time>oldTime)byStation.set(gauge.id,gauge);
  }return [...byStation.values()].sort((a,b)=>a.name.localeCompare(b.name)||a.id.localeCompare(b.id)).map((gauge,index)=>({...gauge,label:'G'+(index+1)}));
}
export async function discoverGauges(connection,masks,signal){checkAbort(signal);const source=await connection.gaugeCollection(signal);checkAbort(signal);return selectGauges(normaliseGauges(source),masks);}
export function gaugeTiming(gauge,now=Date.now()){
  const old=(date,minutes)=>date&&now-date.getTime()>minutes*60000,future=date=>date&&date.getTime()>now+5*60000,notes=[];
  if(!gauge.observedAt||future(gauge.observedAt))notes.push('Observation time unverified');else if(old(gauge.observedAt,CONFIG.gauges.observationAgeMinutes))notes.push('Observation over '+CONFIG.gauges.observationAgeMinutes/60+' hours old');
  if(!gauge.updatedAt||future(gauge.updatedAt))notes.push('Feed update time unverified');else if(old(gauge.updatedAt,CONFIG.gauges.feedAgeMinutes))notes.push('Feed update over '+CONFIG.gauges.feedAgeMinutes+' minutes old');
  return notes;
}
export function gaugeReading(gauge){return (gauge.height===null?'Height unavailable':gauge.height.toLocaleString('en-AU',{maximumFractionDigits:3})+' m')+' · '+gauge.reportedCategory+(gauge.trend?' · '+gauge.trend:'');}
export function gaugeTime(date){return date?aest(date):'Not supplied / unverified';}
export async function retrieveGaugeGraphs(gauges,{connection,signal,onProgress=()=>{}}={}){
  let completed=0;const entries=await pooled(gauges,4,async gauge=>{checkAbort(signal);let image;
    try{if(!gauge.graphUrl)return {gauge,graph:null,reason:'Graph link not supplied by the layer'};
      try{const url=new URL(gauge.graphUrl),blob=connection?.sdk&&/(^|\.)arcgis\.com$/i.test(url.hostname)?(await connection.sdk.esriRequest(gauge.graphUrl,{responseType:'blob',authMode:'no-prompt',timeout:20000,signal})).data:await(await request(gauge.graphUrl,{signal,timeout:20000})).blob();
        checkAbort(signal);if(!blob?.size)throw new Error('Empty graph');image=await imageFromBlob(blob);
      }catch(error){checkAbort(signal);if(!connection?.graphImage||!isBomGraphUrl(gauge.graphUrl)||!['TypeError','SecurityError','NetworkError'].includes(error.name))throw error;image=await connection.graphImage(gauge.graphUrl,signal);}
      checkAbort(signal);if(image.width<150||image.height<60)throw new Error('Unreadable graph');
      const scale=Math.min(1,1800/image.width,1000/image.height),c=canvas(Math.round(image.width*scale),Math.round(image.height*scale)),ctx=c.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,c.width,c.height);ctx.drawImage(image,0,0,c.width,c.height);
      return {gauge,graph:{data:c.toDataURL('image/png'),width:c.width,height:c.height,format:'PNG',retrievedAt:new Date()}};
    }catch(error){checkAbort(signal);return {gauge,graph:null,reason:'Graph could not be retrieved'};}
    finally{image?.close?.();onProgress(++completed,gauges.length);}
  });checkAbort(signal);return {entries,unavailable:entries.filter(entry=>!entry.graph).length};
}
