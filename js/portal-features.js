import {checkAbort} from './utils.js';
import {lonLat} from './geometry.js';

export const CAMERA_ITEM_TYPES=['Feature Service','Map Service','Feature Collection','Web Map'];
export function featureQueryUrl(value,layerId){
  let url;try{url=new URL(value);}catch{throw new Error('Layer item has no valid service URL.');}
  if(url.protocol!=='https:')throw new Error('Layer service must use HTTPS.');
  url.pathname=url.pathname.replace(/\/$/,'');
  if(!/\/(FeatureServer|MapServer)\/\d+$/i.test(url.pathname))url.pathname+='/'+layerId;
  url.pathname+='/query';return url.href;
}
export function arcgisItemId(value){
  const text=String(value||'').trim();if(/^[a-f0-9]{32}$/i.test(text))return text;
  try{const url=new URL(text),id=url.searchParams.get('id');if(url.protocol==='https:'&&/(^|\.)arcgis\.com$/i.test(url.hostname)&&/^[a-f0-9]{32}$/i.test(id||''))return id;}catch{}
  throw new Error('Enter an ArcGIS item-page link or its 32-character item ID.');
}
export function distinctFeatureItems(items,layerId){
  const seen=new Set();return items.filter(item=>{
    let key='item:'+item.id;
    if(item.url)try{const url=new URL(item.url);url.pathname=url.pathname.replace(/\/$/,'');if(!/\/(?:FeatureServer|MapServer)\/\d+$/i.test(url.pathname))url.pathname+='/'+layerId;url.searchParams.sort();key=url.href;}catch{}
    if(seen.has(key))return false;seen.add(key);return true;
  });
}
function pointFeatures(layer){
  const set=layer.featureSet;if(!Array.isArray(set?.features))throw new Error('Camera feature collection has no feature set.');
  if(set.exceededTransferLimit)throw new Error('Camera feature collection is incomplete.');
  return set.features.map((feature,index)=>{
    const g=feature.geometry;if(!g||!Number.isFinite(g.x)||!Number.isFinite(g.y))return null;
    const wkid=g.spatialReference?.latestWkid||g.spatialReference?.wkid||set.spatialReference?.latestWkid||set.spatialReference?.wkid||layer.layerDefinition?.extent?.spatialReference?.wkid;
    let point;if([3857,102100,102113,900913].includes(wkid))point=lonLat([g.x,g.y]);
    else if(wkid===4326)point=[g.x,g.y];else throw new Error('Camera feature collection has an unsupported or missing coordinate system.');
    return {type:'Feature',id:feature.attributes?.OBJECTID??feature.attributes?.objectid??index,properties:feature.attributes||{},geometry:{type:'Point',coordinates:point}};
  }).filter(Boolean);
}
function leaves(layers,output=[]){for(const layer of layers||[]){if(layer.layers?.length)leaves(layer.layers,output);else output.push(layer);}return output;}
export async function embeddedCameraCollection(item,spec,query,signal){
  checkAbort(signal);const data=await item.fetchData('json',{signal});checkAbort(signal);
  if(data?.type==='FeatureCollection'&&Array.isArray(data.features))return data;
  let layers;
  if(item.type==='Web Map'){
    const candidates=leaves(data?.operationalLayers).filter(layer=>layer.featureCollection||/\/(?:FeatureServer|MapServer)(?:\/\d+)?(?:\?|$)/i.test(layer.url||''));
    layers=candidates.filter(layer=>/camera|webcam/i.test(layer.title||''));
    if(!layers.length&&candidates.length===1)layers=candidates;
    if(!layers.length)throw new Error('Selected web map has no identifiable camera layers. Choose its camera layer item.');
  }else{
    const available=data?.layers||data?.featureCollection?.layers||[];
    const selected=available.find(layer=>Number(layer.layerDefinition?.id)===spec.layer)||available[spec.layer];
    if(!selected)throw new Error('Selected camera item has no configured feature-collection layer.');layers=[selected];
  }
  const features=[];
  for(const layer of layers){checkAbort(signal);
    if(layer.url){const collection=await query({url:layer.url},spec.layer,signal);features.push(...collection.features);}
    else if(layer.featureCollection){for(const child of layer.featureCollection.layers||[])features.push(...pointFeatures(child));}
    else features.push(...pointFeatures(layer));
    if(features.length>100000)throw new Error('Camera item exceeded the feature limit.');
  }
  return {type:'FeatureCollection',features};
}
