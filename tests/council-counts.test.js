import test from 'node:test';
import assert from 'node:assert/strict';
import {councilKey,providerCouncils} from '../js/council-counts.js';
import {buildReport} from '../js/report.js';

const stamp='2026-11-03T09:15:00Z',now=Date.parse(stamp);
const entry=(rows=[])=>({status:'ok',scope:'all_councils',outage_type:'unplanned',fetched_utc:stamp,source_updated_utc:stamp,total_customers:rows.reduce((sum,row)=>sum+row.affected_customers,0),rows});
const manifest=()=>({generated_utc:stamp,provider_council_counts:{schema_version:1,snapshot_utc:stamp,energex:entry([{lga_name:'Ipswich City',affected_customers:37},{lga_name:'Scenic Rim Regional',affected_customers:26}]),ergon:entry([])}});
test('provider council names match government suffixes and council renaming',()=>{
  for(const [a,b] of [['Noosa','Noosa Shire'],['Sunshine Coast','Sunshine Coast Regional'],['Moreton Bay Regional','Moreton Bay City'],['Mckinlay Shire Council','McKinlay Shire']])assert.equal(councilKey(a),councilKey(b));
  assert.notEqual(councilKey('Torres Shire'),councilKey('Torres Strait Island Regional'));
});
test('only fresh complete reconciled unplanned provider counts enter reports',()=>{
  const result=providerCouncils(manifest(),now);assert.deepEqual(result.energex.rows,[{label:'Ipswich City',count:37},{label:'Scenic Rim Regional',count:26}]);assert.deepEqual(result.ergon.rows,[]);
});
test('missing counts from an older feed and mismatched snapshots cannot become zero outages',()=>{
  for(const change of [m=>delete m.provider_council_counts,m=>m.provider_council_counts.schema_version=2,m=>m.provider_council_counts.snapshot_utc='2026-11-03T09:00:00Z',m=>m.generated_utc='2026-11-03T08:00:00Z']){
    const m=manifest();change(m);assert.deepEqual(providerCouncils(m,now),{energex:null,ergon:null});
  }
});
test('source failures and invalid or stale publisher data isolate only the affected provider',()=>{
  for(const change of [e=>e.status='error',e=>e.scope='selected_councils',e=>e.outage_type='planned',e=>e.source_updated_utc='2026-11-03T08:00:00Z',e=>e.source_updated_utc='2026-11-03T09:21:00Z',e=>e.fetched_utc='2026-11-03T08:00:00Z',e=>delete e.source_updated_utc,e=>e.total_customers=64,e=>e.rows=null,e=>e.rows.push(e.rows[0]),e=>e.rows[0].lga_name='']){
    const m=manifest();change(m.provider_council_counts.energex);const result=providerCouncils(m,now);assert.equal(result.energex,null);assert.deepEqual(result.ergon,{rows:[]});
  }
  for(const invalid of [null,false,'37',-1,1.5,NaN,Number.MAX_SAFE_INTEGER+1]){const m=manifest();m.provider_council_counts.energex.rows[0].affected_customers=invalid;assert.equal(providerCouncils(m,now).energex,null);}
});
test('provider name aliases cannot create duplicated LGA totals',()=>{
  const m=manifest();m.provider_council_counts.energex=entry([{lga_name:'Moreton Bay Regional',affected_customers:5},{lga_name:'Moreton Bay City',affected_customers:5}]);assert.equal(providerCouncils(m,now).energex,null);
});
test('Ergon provider split produces one row per warning LGA and the selected total',()=>{
  const names=['North Burnett Regional','South Burnett Regional','Western Downs Regional'],lgas=names.map(lga=>({type:'Feature',properties:{lga},geometry:null}));
  const m=manifest();m.provider_council_counts.energex=entry([]);m.provider_council_counts.ergon=entry(names.map((lga_name,i)=>({lga_name,affected_customers:[1,1007,1][i]})));
  const common={allLgas:{features:lgas},powerCounts:providerCouncils(m,now),trafficAvailable:true,asAt:'Test snapshot',scope:'Warning LGAs'};
  const selected=buildReport({...common,lgas:lgas.slice(0,2)});assert.match(selected.text,/Total: 1,008 customers/);assert.match(selected.text,/South Burnett Regional: 1,007 customers/);assert.match(selected.text,/North Burnett Regional: 1 customer/);assert.doesNotMatch(selected.text,/Western Downs|combined|\*/);
  assert.match(buildReport({...common,lgas}).text,/Total: 1,009 customers/);
});
