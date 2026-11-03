import {clean,verifiedTime} from './utils.js';

// The provider sites omit some suffixes and still use Moreton Bay's former
// Regional name. Match these to the government's current LGA names.
export function councilKey(name){return clean(name).normalize('NFKC').toLowerCase().replace(/\s+council$/,'').replace(/\s+(regional|city|shire)$/,'').replace(/[^\p{L}\p{N}]+/gu,' ').trim();}
export function providerCouncils(manifest,now=Date.now()){
  const unavailable={energex:null,ergon:null},data=manifest?.provider_council_counts;
  const fresh=value=>{const date=verifiedTime(value);return date&&now-date<=45*60000&&date-now<=5*60000?date:null;};
  const stamp=fresh(manifest?.generated_utc);
  if(!stamp||data?.schema_version!==1||+verifiedTime(data.snapshot_utc)!==+stamp)return unavailable;
  const validCount=n=>Number.isSafeInteger(n)&&n>=0;
  return Object.fromEntries(['energex','ergon'].map(code=>{
    const entry=data[code],fetched=fresh(entry?.fetched_utc),updated=fresh(entry?.source_updated_utc);
    if(entry?.status!=='ok'||entry.scope!=='all_councils'||entry.outage_type!=='unplanned'||!fetched||!updated||updated-fetched>5*60000||!Array.isArray(entry.rows)||!validCount(entry.total_customers))return [code,null];
    const keys=new Set(),rows=[];let total=0;
    for(const row of entry.rows){const name=typeof row?.lga_name==='string'?clean(row.lga_name):'',key=councilKey(name),count=row?.affected_customers;
      if(!key||keys.has(key)||!validCount(count))return [code,null];
      keys.add(key);total+=count;rows.push({label:name,count});
    }
    return [code,Number.isSafeInteger(total)&&total===entry.total_customers?{rows}:null];
  }));
}
