import {CONFIG} from '../config.js';
import {json,isCollection,errorText} from './utils.js';
import {contains,bounds,overlap} from './geometry.js';
const cache=new Map();
export function cached(key,fn){if(!cache.has(key))cache.set(key,Promise.resolve().then(fn).catch(e=>{cache.delete(key);throw e;}));return cache.get(key);}
export async function queryArcgis(url,{where='1=1',fields='*',extent=null,offset=0,limit=2000,simplify=0,signal,timeout=22000}={}){
  const result=[],seen=new Set();
  for(let page=0;page<50;page++){
    const q=new URL(url.replace(/\/$/,'')+'/query');Object.entries({where,outFields:fields,returnGeometry:'true',outSR:'4326',f:'geojson',resultOffset:String(offset+page*limit),resultRecordCount:String(limit)}).forEach(([k,v])=>q.searchParams.set(k,v));
    if(extent){q.searchParams.set('geometry',extent.join(','));q.searchParams.set('geometryType','esriGeometryEnvelope');q.searchParams.set('inSR','4326');q.searchParams.set('spatialRel','esriSpatialRelIntersects');}
    if(simplify)q.searchParams.set('maxAllowableOffset',String(simplify));
    const d=await json(q.href,{signal,timeout});if(!isCollection(d))throw new Error('Reference source did not return GeoJSON polygons/features');
    let added=0;for(const f of d.features){const id=f.id??f.properties?.objectid??f.properties?.OBJECTID??JSON.stringify(f);if(seen.has(id))continue;seen.add(id);result.push(f);added++;}
    if(d.features.length<limit&&!d.exceededTransferLimit)return {type:'FeatureCollection',features:result};
    if(!added)throw new Error('Reference source did not honour pagination; incomplete data rejected');
  }throw new Error('Reference source exceeded the paging limit; incomplete data rejected');
}
export function validateLgas(collection){const f=collection?.features||[];if(!isCollection(collection)||f.length<50||f.some(x=>!['Polygon','MultiPolygon'].includes(x.geometry?.type)))throw new Error('Queensland LGA source is incomplete');
  if([[153.028,-27.47],[145.77,-16.92],[139.49,-20.72]].some(p=>!f.some(g=>contains(p,g.geometry)))||f.some(g=>contains([153.61,-28.65],g.geometry)))throw new Error('Queensland LGA coverage checks failed');return collection;
}
export const lgas=signal=>cached('lgas',()=>queryArcgis(CONFIG.publicSources.lga,{fields:'lga',signal}).then(validateLgas));
export const locator=signal=>cached('locator',()=>queryArcgis(CONFIG.publicSources.mainland,{where:"name = 'Queensland'",fields:'name,feature_type',simplify:.01,signal}).then(d=>{if(!d.features.length)throw new Error('Coastal state silhouette unavailable');return d;}));
export async function majorNames(signal){return cached('majorNames',async()=>{const q=new URL(CONFIG.publicSources.majorRoads+'/query');Object.entries({where:"symbol_class IN ('Motorway','Highway') AND road_name_full IS NOT NULL",outFields:'road_name_full',returnGeometry:'false',returnDistinctValues:'true',orderByFields:'road_name_full',f:'json'}).forEach(([k,v])=>q.searchParams.set(k,v));const d=await json(q.href,{signal,timeout:8000}),names=(d.features||[]).map(f=>f.attributes.road_name_full).filter(Boolean);if(!names.length||d.exceededTransferLimit)throw new Error('Major-road classification is incomplete');return names;});}
export async function majorRivers(extent,scopeText,signal,{read=json,query=queryArcgis}={}){
  if(!String(scopeText||'').trim())return {type:'FeatureCollection',features:[]};
  const q=new URL(CONFIG.publicSources.rivers+'/query');Object.entries({where:"hierarchy = 'Major' AND name IS NOT NULL",outFields:'name',returnGeometry:'false',returnDistinctValues:'true',resultRecordCount:'2000',geometry:extent.join(','),geometryType:'esriGeometryEnvelope',inSR:'4326',f:'json'}).forEach(([k,v])=>q.searchParams.set(k,v));
  const d=await read(q.href,{signal,timeout:12000});if(!Array.isArray(d.features)||d.exceededTransferLimit)throw new Error('Major river names are incomplete');
  const normalise=s=>' '+String(s).toLowerCase().replace(/[^a-z0-9]+/g,' ').trim()+' ',scope=normalise(scopeText);
  const names=[...new Set(d.features.map(f=>f.attributes?.name).filter(name=>{if(!name)return false;const stem=name.replace(/\s+(?:River|Creek|Channel)\b.*$/i,'');return stem.length>=3&&scope.includes(normalise(stem));}))];
  if(!names.length)return {type:'FeatureCollection',features:[]};
  const where="hierarchy = 'Major' AND name IN ("+names.map(name=>"'"+name.replace(/'/g,"''")+"'").join(',')+')';
  return query(CONFIG.publicSources.rivers,{extent,where,fields:'name,hierarchy',simplify:.001,signal,timeout:12000});
}
export async function loadPublic(extent,signal,{cartography=false,riverScope=''}={}){const src=CONFIG.publicSources,jobs={outages:()=>json(src.outages,{signal}),manifest:()=>json(src.outageManifest,{signal}),traffic:()=>json(src.traffic,{signal}),coastline:()=>queryArcgis(src.coastline,{extent,fields:'feature_type',simplify:.0004,signal}),border:()=>queryArcgis(src.border,{extent,fields:'border_desc,state_desc',simplify:.0004,signal}),locator:()=>locator(signal),credits:()=>cached('credits',()=>json(src.topoMetadata+'?f=json',{signal}))};
  if(cartography)Object.assign(jobs,{
    // Current populated places only; homesteads and historical settlements
    // would overwhelm a regional flood map. Hydrography is major channels only.
    places:()=>queryArcgis(src.places,{extent,where:"type = 'POPL'",fields:'place_name,type',signal,timeout:12000}),
    rivers:()=>majorRivers(extent,riverScope,signal),
    islands:()=>queryArcgis(src.islands,{extent,fields:'name',simplify:.001,signal,timeout:12000})
  });
  const entries=await Promise.allSettled(Object.entries(jobs).map(async([k,fn])=>[k,await fn()])),data={},notices=[];
  entries.forEach((r,i)=>{const key=Object.keys(jobs)[i];if(r.status==='fulfilled')data[key]=r.value[1];else notices.push(key+': '+errorText(r.reason));});return {data,notices};
}
export function inExtent(collection,extent){return {type:'FeatureCollection',features:(collection?.features||[]).filter(f=>overlap(bounds(f.geometry),extent))};}
