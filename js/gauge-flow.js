import {checkAbort,json} from './utils.js';

const wordKey=value=>String(value||'').toLowerCase().replace(/[^a-z0-9]/g,'');
const stationKey=value=>/^\d{1,8}$/.test(String(value||''))&&Number(value)>0?String(Number(value)):null;
const byName=(a,b)=>a.name.localeCompare(b.name)||a.id.localeCompare(b.id);
const validPoint=point=>Array.isArray(point)&&point.length===2&&point.every(Number.isFinite)&&Math.abs(point[0])<=180&&Math.abs(point[1])<=90;
const riverValue=value=>/^(?:undefined|null|none|nan|n\/a|unknown)$/i.test(String(value||'').trim())?'':String(value||'').trim();
const sourceRiver=gauge=>riverValue(gauge.river)||/^(.+?\b(?:river|creek|brook|channel))\s+(?:at|@)\s+/i.exec(gauge.name)?.[1]||/\(([^()]+\b(?:river|creek|brook|channel))\)\s*$/i.exec(gauge.name)?.[1]||'';
function distance(a,b){const x=(a[0]-b[0])*111195*Math.cos((a[1]+b[1])/2*Math.PI/180),y=(a[1]-b[1])*111195;return Math.hypot(x,y);}
let cachedReference;

export function validateGaugeFlowReference(data){
  if(data?.schemaVersion!==1||!Array.isArray(data.stations)||!data.stations.length||data.stations.length!==data.stationCount||!Number.isFinite(Date.parse(data.retrievedUtc)))throw new Error('Gauge flow reference is unavailable.');
  const ids=new Set();for(const station of data.stations){const id=stationKey(station.id);
    if(!id||ids.has(id)||!validPoint(station.point)||!station.river||typeof station.river!=='string'||typeof station.basin!=='string'||!Array.isArray(station.downstream))throw new Error('Gauge flow reference contains an invalid station.');ids.add(id);
  }
  const incoming=new Map([...ids].map(id=>[id,0])),edges=new Map();for(const station of data.stations){const id=stationKey(station.id),targets=station.downstream.map(stationKey);if(targets.some(target=>!ids.has(target)||target===id)||new Set(targets).size!==targets.length)throw new Error('Gauge flow reference has invalid downstream connections.');edges.set(id,targets);for(const target of targets)incoming.set(target,incoming.get(target)+1);}
  const queue=[...ids].filter(id=>!incoming.get(id));let visited=0;for(let i=0;i<queue.length;i++){visited++;for(const next of edges.get(queue[i])){incoming.set(next,incoming.get(next)-1);if(!incoming.get(next))queue.push(next);}}
  if(visited!==ids.size)throw new Error('Gauge flow reference contains cyclic connections.');return data;
}

export async function loadGaugeFlowReference(signal){
  checkAbort(signal);if(cachedReference)return cachedReference;
  const url=new URL('../data/gauge-flow.json',import.meta.url);url.search=new URL(import.meta.url).search;
  const reference=validateGaugeFlowReference(await json(url.href,{signal,timeout:12000}));checkAbort(signal);cachedReference=reference;return reference;
}

// A river can fork. Cover its comparable gauges with separate directed chains;
// never turn an alphabetical tie between tributaries into a flow relationship.
function directedChains(rows,reference){
  const successors=new Map(rows.map(gauge=>[gauge,rows.filter(other=>other!==gauge&&reference.get(gauge).downstream.some(id=>stationKey(id)===stationKey(reference.get(other).id)))]));
  const remaining=new Set(rows),chains=[];
  while(remaining.size){
    const incoming=new Map([...remaining].map(gauge=>[gauge,0]));for(const gauge of remaining)for(const next of successors.get(gauge))if(remaining.has(next))incoming.set(next,incoming.get(next)+1);
    const queue=[...remaining].filter(gauge=>!incoming.get(gauge)).sort(byName),ordered=[];
    for(let i=0;i<queue.length;i++){const gauge=queue[i];ordered.push(gauge);for(const next of successors.get(gauge))if(remaining.has(next)){incoming.set(next,incoming.get(next)-1);if(!incoming.get(next))queue.push(next);}}
    if(ordered.length!==remaining.size)return null;
    const length=new Map(),choice=new Map();for(const gauge of ordered.reverse()){
      const next=successors.get(gauge).filter(item=>remaining.has(item)).sort((a,b)=>(length.get(b)||0)-(length.get(a)||0)||byName(a,b))[0];length.set(gauge,1+(length.get(next)||0));choice.set(gauge,next);
    }
    let gauge=[...remaining].sort((a,b)=>length.get(b)-length.get(a)||byName(a,b))[0];const chain=[];while(gauge){chain.push(gauge);remaining.delete(gauge);gauge=choice.get(gauge);}chains.push(chain);
  }
  return chains;
}

export function orderGaugesByFlow(gauges,reference=null){
  if(!gauges.length)return [];
  // Connections are also used by the schematic across river/tributary groups.
  // A corrupt reference must not leave any apparently verified flow arrows.
  if(reference)try{validateGaugeFlowReference(reference);}catch{reference=null;}
  const lookup=new Map((reference?.stations||[]).map(station=>[stationKey(station.id),station])),matched=new Map(),buckets=new Map(),unknown=[];
  for(const gauge of gauges){const station=lookup.get(stationKey(gauge.stationId));
    if(!station||!validPoint(gauge.point)||distance(gauge.point,station.point)>1000){unknown.push(gauge);continue;}
    const namedStation={...station,river:riverValue(station.river)||sourceRiver(gauge)||'Unnamed tributary'};matched.set(gauge,namedStation);const group=wordKey(station.basin)+'|'+wordKey(namedStation.river);if(!buckets.has(group))buckets.set(group,[]);buckets.get(group).push(gauge);
  }
  const riverBasins=new Map();for(const station of matched.values()){const river=wordKey(station.river);if(!riverBasins.has(river))riverBasins.set(river,new Set());riverBasins.get(river).add(wordKey(station.basin));}
  const output=[];for(const [key,rows]of [...buckets].sort(([a],[b])=>a.localeCompare(b))){
    const first=matched.get(rows[0]),chains=directedChains(rows,matched);if(!chains){unknown.push(...rows);continue;}
    chains.forEach((chain,index)=>{const split=chains.length>1,uncertain=split&&chain.length===1,group=first.river+(riverBasins.get(wordKey(first.river)).size>1&&first.basin?' ('+first.basin+')':'')+(split?' — reach '+(index+1):'');
      for(const gauge of chain)output.push({...gauge,river:first.river,basin:first.basin,flowGroup:(uncertain?'Order unconfirmed — ':'')+group,flowGroupId:key+'|'+index,flowOrder:uncertain?'unconfirmed':chain.length>1?'verified':'matched',flowReason:uncertain?'No confirmed sequence connects this gauge to the other selected reaches.':'BoM river-network connections',flowReferenceDate:reference.retrievedUtc});
    });
  }
  unknown.sort((a,b)=>wordKey(a.basin).localeCompare(wordKey(b.basin))||wordKey(sourceRiver(a)).localeCompare(wordKey(sourceRiver(b)))||byName(a,b));
  for(const gauge of unknown){const river=sourceRiver(gauge);output.push({...gauge,river,flowGroup:'Order unconfirmed'+(river?' — '+river:''),flowGroupId:'unconfirmed|'+wordKey(gauge.basin)+'|'+wordKey(river),flowOrder:'unconfirmed',flowReason:reference?'No verified station and location match in the river-network reference.':'River-network reference unavailable.'});}
  const ordered=output.map((gauge,index)=>({...gauge,label:'G'+(index+1)}));
  const stationFor=gauge=>{const station=lookup.get(stationKey(gauge.stationId));return reference&&station&&validPoint(gauge.point)&&distance(gauge.point,station.point)<=1000?station:null;};
  for(const gauge of ordered){const station=stationFor(gauge),targets=new Set((station?.downstream||[]).map(stationKey));
    gauge.flowDownstream=ordered.filter(other=>other!==gauge&&stationFor(other)&&targets.has(stationKey(other.stationId))).map(other=>other.label);
  }
  return ordered;
}

export const gaugeFlowLabel=gauge=>gauge.flowGroup||'Order unconfirmed';
export function gaugeFlowSummary(gauges){const unknown=gauges.filter(gauge=>!gauge.flowOrder||gauge.flowOrder==='unconfirmed').length;return 'River/tributary groups, upstream to downstream where confirmed.'+(unknown?' '+unknown+' order unconfirmed.':'');}
