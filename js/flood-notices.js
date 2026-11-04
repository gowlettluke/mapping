import {CONFIG} from '../config.js';
import {queryArcgis} from './sources.js';
import {floodReference} from './flood-references.js';
import {bounds,projectedBounds} from './geometry.js';
import {checkAbort,clean,isCollection,json} from './utils.js';

const keys=['floodWarnings','floodWatches'],kindFor=key=>key==='floodWarnings'?'Flood Warning':'Flood Watch';
const field=(p,name)=>p[name]??p[name.toUpperCase()];
const millis=value=>typeof value==='number'&&Number.isFinite(value)&&value>=Date.UTC(2000,0,1)&&value<Date.UTC(2100,0,1)?value:null;
export function floodNoticeTimes(p){
  const issued=millis(field(p,'issue_time_utc')),start=millis(field(p,'start_time_utc')),local=millis(field(p,'start_time_local')),end=millis(field(p,'end_time_local'));
  // This feed stores local wall-clock fields as epoch milliseconds. Its UTC
  // start field confirms the offset; do not interpret end_time_local as UTC.
  if([issued,start,local,end].some(value=>value===null)||local-start!==10*3600000||end-local<=0)throw new Error('BoM flood notice dates could not be verified.');
  return {issued,expires:end-(local-start)};
}
function warningName(productId,records,references){
  const ids=new Set(records.map(record=>record.aac)),has=id=>ids.has('QLD_RC'+id);
  // These product IDs cover more than their commonly used notice title. The
  // explicit AACs distinguish, for example, Burnett's Boyne from Gladstone's.
  if(productId==='IDQ20770'&&has('074'))return records.length===1?'Stuart and Boyne Rivers':'Boyne and Burnett Rivers';
  if(productId==='IDQ20800'&&ids.size===1&&has('093'))return 'Stanley River';
  if(productId==='IDQ20815'&&!has('100')&&!has('025'))return 'Logan River';
  if(productId==='IDQ20835'&&ids.size===1&&has('115'))return 'Macintyre Brook';
  if(productId==='IDQ20840'&&ids.size===1&&has('119'))return 'Lower Moonie River';
  if(productId==='IDQ20850'&&ids.size===1&&has('124'))return 'Lower Paroo River (QLD)';
  if(productId==='IDQ20860'&&!has('034')){
    const names=[];if(has('128')||has('129'))names.push('Barcoo River');if(has('127'))names.push('Thomson River');if(has('130'))names.push('Cooper Creek');if(names.length)return names.join(' / ');
  }
  const parents=references.filter(feature=>{const p=feature.properties||{},aac=clean(field(p,'aac')),parent=clean(field(p,'aac_parent'));return !parent||aac===parent;});
  return [...new Set((parents.length?parents:records.map(record=>record.reference)).map(feature=>clean(field(feature.properties,'dist_name'))))].join(' / ');
}
export function groupFloodNotices(collection,references,{key,now=Date.now(),signal}={}){
  if(!keys.includes(key)||!isCollection(collection)||collection.exceededTransferLimit||!isCollection(references))throw new Error('The current BoM flood notice list is incomplete.');
  const lookup=new Map(references.features.map(feature=>[clean(field(feature.properties||{},'aac')),feature])),latest=new Map(),groups=new Map();
  for(const feature of collection.features){
    checkAbort(signal);const p=feature.properties||{},aac=clean(field(p,'aac'));
    if(!aac.startsWith('QLD_'))continue;
    const status=clean(field(p,'status')),phase=clean(field(p,'phase'));
    if(status!=='O'){if(['T','D'].includes(status))continue;throw new Error('BoM flood notice status could not be verified.');}
    if(!['NEW','UPD','FIN','CAN'].includes(phase))throw new Error('BoM flood notice phase could not be verified.');
    const times=phase==='CAN'?{issued:millis(field(p,'issue_time_utc')),expires:0}:floodNoticeTimes(p);
    if(times.issued===null||times.issued>now+300000)throw new Error('BoM flood notice issue time could not be verified.');
    const record={aac,feature,phase,...times},old=latest.get(aac);
    if(!old||record.issued>old.issued||record.issued===old.issued&&old.phase!=='CAN')latest.set(aac,record);
  }
  for(const record of latest.values()){
    checkAbort(signal);
    const {aac,feature}=record,reference=lookup.get(aac),productId=clean(field(reference?.properties||{},'product_id'));
    if(!reference||key==='floodWarnings'&&!/^IDQ\d{5}$/.test(productId)){
      if(record.phase==='CAN'||record.expires<=now)continue;throw new Error('A current BoM flood catchment could not be matched to its warning. Refresh warnings to retry.');
    }
    Object.assign(record,{reference,productId});
    const p=record.feature.properties,office=clean(field(p,'office'))||'QLD';
    // Warning membership is BoM's published product_id, never river names or
    // touching pixels. Watch references have no product_id: one issued watch
    // contains all the areas with the same office and UTC issue time.
    const identity=key==='floodWarnings'?record.productId:office+':'+record.issued;
    if(!groups.has(identity))groups.set(identity,[]);groups.get(identity).push(record);
  }
  return [...groups].flatMap(([identity,all])=>{
    // The mirror can retain an unexpired area from a superseded issue. It is
    // not part of the newest warning, even if that old area's expiry is later.
    const issued=Math.max(...all.map(record=>record.issued)),records=all.filter(record=>record.issued===issued&&record.phase!=='CAN'&&record.expires>now);
    if(!records.length)return [];
    for(const {feature} of records){const b=bounds(feature.geometry);if(!['Polygon','MultiPolygon'].includes(feature.geometry?.type)||!b||b[0]<-180||b[1]<-90||b[2]>180||b[3]>90||b[0]>=b[2]||b[1]>=b[3])throw new Error('A current BoM flood catchment boundary is unavailable.');}
    checkAbort(signal);records.sort((a,b)=>a.aac.localeCompare(b.aac));const kind=kindFor(key),productId=records[0].productId;
    const refs=references.features.filter(feature=>clean(field(feature.properties||{},'product_id'))===productId),name=key==='floodWarnings'?warningName(productId,records,refs):records.map(record=>clean(field(record.reference.properties,'dist_name'))).join(' / ');
    const final=records.every(record=>record.phase==='FIN'),scopeGeometries=records.map(record=>record.feature.geometry),boxes=scopeGeometries.map(geometry=>projectedBounds(bounds(geometry))),index=keys.indexOf(key);
    return {id:key+':notice:'+identity,key,kind,productId,identified:true,title:(final?'Final ':'')+kind+' — '+name,
      sourceUrl:key==='floodWarnings'?'https://www.bom.gov.au/warning/flood-warning/'+productId:'https://www.bom.gov.au/qld/warnings.shtml',
      issuedAt:Math.max(...records.map(record=>record.issued)),expiresAt:Math.min(...records.map(record=>record.expires)),
      revision:JSON.stringify(records.map(record=>[record.aac,record.issued,record.expires,record.phase,field(record.feature.properties,'severity')])),
      catchmentNames:records.map(record=>clean(field(record.reference.properties,'dist_name'))),
      referenceFeatures:records.map(record=>record.reference),scopeGeometries,
      extent:[Math.min(...boxes.map(b=>b[0])),Math.min(...boxes.map(b=>b[1])),Math.max(...boxes.map(b=>b[2])),Math.max(...boxes.map(b=>b[3]))],
      names:[CONFIG.profiles.flooding.warning[index]],titles:[CONFIG.profiles.flooding.titles[index]]};
  }).sort((a,b)=>a.title.localeCompare(b.title));
}
export async function loadFloodNotices(key,signal,{now=Date.now(),read=json,query=queryArcgis,reference=floodReference}={}){
  if(!keys.includes(key))throw new Error('Unknown flood notice source.');checkAbort(signal);
  try{
    const url=CONFIG.publicSources.floodNotices+'/'+keys.indexOf(key),metadata=await read(url+'?f=json',{signal,timeout:15000}),edited=millis(metadata?.editingInfo?.lastEditDate);
    if(!edited||edited>now+300000||now-edited>2*3600000)throw new Error('The current BoM flood notice feed has not updated recently.');
    const [collection,refs]=await Promise.all([query(url,{where:"aac LIKE 'QLD_%'",signal,timeout:15000}),reference(key,signal)]);checkAbort(signal);
    return groupFloodNotices(collection,refs.collection,{key,now,signal});
  }catch(error){checkAbort(signal);throw new Error(kindFor(key)+' notices could not be loaded. '+error.message);}
}
export async function currentFloodNotices(signal,options){
  const groups=await Promise.all(keys.map(key=>loadFloodNotices(key,signal,options)));checkAbort(signal);return groups.flat();
}
