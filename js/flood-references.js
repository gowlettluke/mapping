import {CONFIG} from '../config.js';
import {queryArcgis,cached} from './sources.js';
import {checkAbort,json,request,isCollection} from './utils.js';

const kinds=new Set(['floodWarnings','floodWatches']);
export function validateFloodReference(collection){
  if(!isCollection(collection)||!collection.features.length||collection.exceededTransferLimit||collection.features.some(f=>!/^QLD_/.test(f.properties?.aac||'')||!f.properties?.dist_name||!['Polygon','MultiPolygon'].includes(f.geometry?.type)||!Array.isArray(f.geometry.coordinates)||!f.geometry.coordinates.length))throw new Error('Queensland catchment reference boundaries are incomplete or invalid.');
  return collection;
}
export async function decodeReference(bytes,expectedHash,signal){
  checkAbort(signal);let plain=bytes;
  if(bytes[0]===31&&bytes[1]===139){const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));plain=new Uint8Array(await new Response(stream).arrayBuffer());}
  checkAbort(signal);const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',plain)),hash=[...digest].map(v=>v.toString(16).padStart(2,'0')).join('');
  if(hash!==expectedHash)throw new Error('Bundled catchment reference files do not match this application version.');
  return validateFloodReference(JSON.parse(new TextDecoder().decode(plain)));
}
async function bundledReference(key,signal){
  const manifest=await json(new URL('../data/flood-references.json',import.meta.url).href,{signal}),entry=manifest.files?.[key];
  if(!entry||!/^flood-(?:warning|watch)-catchments\.geojson\.gz$/.test(entry.path))throw new Error('Bundled catchment reference metadata is unavailable.');
  const response=await request(new URL('../data/'+entry.path,import.meta.url).href,{signal});
  const collection=await decodeReference(new Uint8Array(await response.arrayBuffer()),entry.sha256,signal);
  if(collection.features.length!==entry.featureCount)throw new Error('Bundled catchment reference count is incomplete.');
  return {collection,mode:'bundled',retrievedAt:manifest.retrievedUtc};
}
export async function loadFloodReference(key,signal,{live=queryArcgis,bundled=bundledReference}={}){
  if(!kinds.has(key))throw new Error('Unknown flood reference source.');checkAbort(signal);
  try{const collection=validateFloodReference(await live(CONFIG.publicSources[key],{where:"aac LIKE 'QLD_%'",signal,timeout:6000}));checkAbort(signal);return {collection,mode:'live'};}
  catch(error){checkAbort(signal);return bundled(key,signal);}
}
// These are catchment-name geometry, never a cache of active warnings. Active
// warnings/watches continue to be fetched through the authenticated WMS.
export const floodReference=(key,signal)=>cached('flood-reference:'+key,()=>loadFloodReference(key,signal));
