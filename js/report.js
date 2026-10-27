import {bounds,overlap,intersects,lgaName} from './geometry.js';
import {clean,verifiedTime} from './utils.js';
export const LINKS={energex:'https://www.energex.com.au/outages/outage-finder/outage-finder-map',ergon:'https://www.ergon.com.au/network/outages/outage-finder',roads:'https://qldtraffic.qld.gov.au/'};
const sort=(a,b)=>a.localeCompare(b,'en-AU'),num=n=>n.toLocaleString('en-AU');
export function provider(p){const s=clean(p.provider_code||p.provider_name).toLowerCase();return /(^|[.\s])energex($|\s)/.test(s)?'energex':/(^|[.\s])ergon($|\s)/.test(s)?'ergon':null;}
export function customers(p){const v=p.affected_customers;if(p.affected_customers_known===false||String(p.affected_customers_known).toLowerCase()==='false'||!['number','string'].includes(typeof v)||clean(v)==='')return null;const n=Number(v);return Number.isSafeInteger(n)&&n>=0?n:null;}
export function powerHealth(feed,manifest,now=Date.now()) {
  const bad={energex:false,ergon:false},date=verifiedTime(manifest?.generated_utc),errors=manifest?.provider_fetch_errors;
  if(feed?.type!=='FeatureCollection'||!Array.isArray(feed.features)||!date||now-date>45*60000||date-now>5*60000||manifest.current_outage_records!==feed.features.length||!errors||typeof errors!=='object'||Array.isArray(errors)||feed.features.some(f=>Date.parse(f.properties?.snapshot_utc)!==+date))return bad;
  const keys=Object.keys(errors).map(k=>k.toLowerCase());return Object.fromEntries(['energex','ergon'].map(p=>[p,!keys.some(k=>k.includes(p)||!/energex|ergon|essential/.test(k))]));
}
export function roadKey(value){return clean(value).toLowerCase().replace(/\([^)]*\)/g,'').replace(/\bhwy\b/g,'highway').replace(/\bmwy\b/g,'motorway').replace(/\brd\b/g,'road').replace(/[^a-z0-9]+/g,' ').trim();}
export function currentRoad(p,now=Date.now()) {
  if(p.status&&clean(p.status).toLowerCase()!=='published')return false;
  // QLDTraffic timezone-free local dates are Queensland/AEST, never the browser's local timezone.
  const time=s=>{if(!s)return NaN;return Date.parse(/(?:Z|[+-]\d\d:?\d\d)$/i.test(s)?s:s+'+10:00');};
  const start=time(p.duration?.start),end=time(p.duration?.end);return (!Number.isFinite(start)||start<=now)&&(!Number.isFinite(end)||end>=now);
}
export function roadCondition(p){const t=clean(p.impact?.impact_type).toLowerCase(),s=clean(p.impact?.impact_subtype).toLowerCase(),all=[t,s,clean(p.description).toLowerCase()].join(' ');
  if(/\b(lanes?|shoulder|partial|4wd|four[ -]wheel|high[ -]clearance|conditional|local traffic)\b/.test(s))return 'restricted';
  if(/road closed|closed to all traffic|closed to all vehicles/.test(s))return 'closed';
  if(t==='closures')return /lanes?|shoulder|partial/.test(all)?'restricted':'closed';
  if(/road restricted|lanes affected/.test(t))return 'restricted';
  if(/road closed to all traffic|closed to all vehicles/.test(all))return 'closed';return null;
}
export function normaliseRoads(feed,now=Date.now()){const rows=[];for(const f of feed?.features||[]){const p=f.properties||{},condition=roadCondition(p);if(!condition||!currentRoad(p,now)||!f.geometry)continue;
    const area=p.area_alert===true||/^(true|1|yes)$/i.test(String(p.area_alert));if(area&&!['LineString','MultiLineString'].includes(f.geometry.type))continue;
    const r=p.road_summary||{};rows.push({id:p.id??f.id,geometry:f.geometry,name:clean(r.road_name||p.road_name),locality:clean(r.locality||p.locality),location:[r.road_location,r.location,p.road_location].find(x=>typeof x==='string'&&x.trim())||'',description:clean(p.description),condition});
  }return rows;
}
export function closureLocation(r){const explicit=clean(r.location),match=r.description?.match(/\b(between|from|near|at)\s+[^.;]+/i);let p=explicit||(match?match[0].replace(/\s+(due to|because of|owing to|following)\b.*$/i,'').replace(/,\s*(traffic|access|lanes|vehicles|motorists|drivers)\b.*$/i,'').trim():'');
  if(!explicit&&(/^between\b/i.test(p)&&!(/\b(and|to)\b|&/i.test(p))||/^at this time\b/i.test(p)||/^from\b/i.test(p)&&/\d\d:\d\d/.test(p)))p='';p=p||r.locality||'';
  return !p?'':/^(between|from|near|at)\b/i.test(p)?p[0].toLowerCase()+p.slice(1):'at '+p;
}
function countText(rows){const known=rows.filter(x=>x.count!==null),missing=rows.length-known.length,total=known.reduce((s,x)=>s+x.count,0);return !known.length?`${rows.length} outage${rows.length===1?'':'s'}; customer counts unavailable`:`${num(total)} customer${total===1?'':'s'}${missing?`, plus ${missing} outage${missing===1?'':'s'} with unreported customer counts`:''}`;}
export function buildReport({lgas,allLgas,outages,powerState,roads=[],trafficAvailable,majorNames=[],majorAvailable=true,asAt,scope}){
  const started=Date.now();let steps=0;const budget=()=>{if((++steps&1023)===0&&Date.now()-started>10000)throw new Error('Report processing exceeded ten seconds');};
  const selected=new Set(lgas.map(lgaName)),all=(allLgas.features||allLgas).map(f=>({name:lgaName(f),geometry:f.geometry,b:bounds(f.geometry)}));
  const membership=(g,restricted=false)=>all.filter(f=>(!restricted||selected.has(f.name))&&overlap(bounds(g),f.b)&&intersects(g,f.geometry,budget)).map(f=>f.name);
  const sections=[],notes=[],unique=new Map(),groups={energex:new Map(),ergon:new Map()};let omitted=0;
  for(const f of outages?.features||[]){const p=f.properties||{},code=provider(p);if(!code||!powerState[code]||clean(p.outage_type).toLowerCase()!=='unplanned'||/^(restored|completed|cancelled|closed|resolved)$/i.test(clean(p.status)))continue;
    const id=code+'|'+(p.outage_key||p.outage_id||f.id||JSON.stringify([f.geometry,p])),count=customers(p);
    if(unique.has(id)){const old=unique.get(id);old.geometries.push(f.geometry);if(old.count!==count)old.count=null;}else unique.set(id,{code,count,geometries:[f.geometry],sourceLga:clean(p.lga_name)});
  }
  let sharedOutside=false;
  for(const outage of unique.values()){let names=[...new Set(outage.geometries.flatMap(g=>membership(g)))].sort(sort);
    if(!names.length&&!outage.geometries.some(bounds)&&selected.has(outage.sourceLga))names=[outage.sourceLga];
    const inside=names.filter(n=>selected.has(n));if(!inside.length){if(!names.length)omitted++;continue;}
    outage.crosses=inside.length!==names.length;sharedOutside ||= outage.crosses;
    const label=inside.join(' / ')+(outage.crosses?' (shared outage across LGA boundary)':inside.length>1?' (joint outage count)':'');
    if(!groups[outage.code].has(label))groups[outage.code].set(label,[]);groups[outage.code].get(label).push(outage);
  }
  for(const code of ['energex','ergon']){const name=code==='energex'?'Energex':'Ergon';if(!powerState[code]){notes.push(name+' outage data could not be verified as current; its section is omitted.');continue;}const g=groups[code];if(!g.size)continue;
    const items=[...g.values()].flat(),within=items.filter(x=>!x.crosses),crossing=items.length-within.length;
    let summary=within.length?`Reported unplanned power outages within these LGAs: ${countText(within)}.`:'';
    if(crossing)summary+=(summary?' ':'')+`${crossing} ${within.length?'additional ':''}unplanned outage${crossing===1?'':'s'} also extend${crossing===1?'s':''} outside the scope; shared totals are listed separately.`;
    sections.push({heading:'Power outages - '+name,summary,rows:[...g].sort(([a],[b])=>sort(a,b)).map(([label,items])=>({label,detail:countText(items)+(items[0].crosses?' across the full outage; the count within these LGAs cannot be separated':'')})),link:LINKS[code],linkLabel:name+' Outage Finder'});
  }
  const major=new Set(majorNames.map(roadKey)),roadGroups=new Map(),roadEvents=new Map();
  for(const r of trafficAvailable&&majorAvailable?roads:[]){if(r.condition!=='closed'||!major.has(roadKey(r.name)))continue;const id=r.id??JSON.stringify([r.geometry,r.name,r.location,r.locality]);if(roadEvents.has(id))roadEvents.get(id).geometries.push(r.geometry);else roadEvents.set(id,{...r,geometries:[r.geometry]});}
  for(const r of roadEvents.values()){const names=[...new Set(r.geometries.flatMap(g=>membership(g,true)))];const location=closureLocation(r),detail=r.name+' - closed'+(location?' '+location:'');for(const name of names){if(!roadGroups.has(name))roadGroups.set(name,new Set());roadGroups.get(name).add(detail);}}
  if(!trafficAvailable)notes.push('QLDTraffic was unavailable; the roads section is omitted.');else if(!majorAvailable)notes.push('Major-road classification was unavailable; the roads section is omitted.');else if(roadGroups.size)sections.push({heading:'Major road closures',rows:[...roadGroups].sort(([a],[b])=>sort(a,b)).map(([label,items])=>({label,detail:[...items].sort(sort).join('; ')})),link:LINKS.roads,linkLabel:'QLDTraffic'});
  if(omitted)notes.push(omitted+' outage record(s) could not be assigned to an LGA and were omitted.');
  const text=['As at '+asAt+'.',scope];if(sharedOutside)text.push('Shared outage totals include customers outside this scope and are excluded from warning-LGA totals.');
  for(const s of sections)text.push('',s.heading,...(s.summary?[s.summary]:[]),...s.rows.map(r=>'- '+r.label+': '+r.detail),'Further information: '+s.linkLabel+' - '+s.link);
  if(!sections.length&&!notes.length)text.push('','No current unplanned power outages or major-road closures were reported in the retrieved feeds for this scope.');
  return {text:sections.length||!notes.length?text.join('\n'):'',sections,notes};
}
const esc=s=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
export function reportHtml(text,{newTab=false}={}){return String(text).split(/\r?\n/).map(line=>{if(!line)return '<p><br></p>';const attrs=newTab?' target="_blank" rel="noopener noreferrer"':'';
  for(const url of Object.values(LINKS)){const suffix=' - '+url;if(line.startsWith('Further information: ')&&line.endsWith(suffix))return `<p>Further information: <a href="${url}"${attrs}>${esc(line.slice(21,-suffix.length))}</a></p>`;}
  if(/^(Power outages - (Energex|Ergon)|Major road closures)$/.test(line))return '<p><strong>'+esc(line)+'</strong></p>';
  let value=esc(line);for(const url of Object.values(LINKS))value=value.split(url).join(`<a href="${url}"${attrs}>${url}</a>`);return '<p>'+value+'</p>';
}).join('');}
export const clipboardHtml=text=>'<html><head><meta charset="utf-8"></head><body>'+reportHtml(text)+'</body></html>';
