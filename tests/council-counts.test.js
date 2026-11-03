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
test('one unknown council retains matched warning-LGA totals and carries the exclusion into copied text',()=>{
  const lgas=['Central Highlands Regional','Western Downs Regional'].map(lga=>({type:'Feature',properties:{lga},geometry:null}));
  const common={lgas:[lgas[0]],allLgas:{features:lgas},powerCounts:{energex:{rows:[]},ergon:{rows:[{label:'Central Highlands Regional',count:2267},{label:'Western Downs Regional',count:46},{label:'Unknown',count:2}]}},trafficAvailable:true,asAt:'Test snapshot',scope:'Warning LGAs',areaLabel:'the LGAs affected by this warning'};
  const result=buildReport(common),section=result.sections.find(s=>s.heading==='Power outages - Ergon');
  assert.equal(section.summary,'Total: 2,267 customers.');assert.deepEqual(section.rows,[{label:'Central Highlands Regional',detail:'2,267 customers'}]);assert.match(result.text,/2 customers reported without an identified Queensland LGA; excluded from the warning-area total/);assert.doesNotMatch(result.text,/Western Downs Regional|2,269|omitted/);assert.match(result.notes.join(' '),/Unknown/);
  const noMatched=buildReport({...common,lgas:[lgas[1]],powerCounts:{energex:{rows:[]},ergon:{rows:[{label:'Central Highlands Regional',count:2267},{label:'Unknown',count:2}]}}});
  const unknownSection=noMatched.sections.find(s=>s.heading==='Power outages - Ergon');assert.match(unknownSection.summary,/counts .* incomplete/);assert.doesNotMatch(unknownSection.summary,/No current unplanned outages/);assert.match(unknownSection.caveat,/2 customers/);
});
test('statewide reports reconcile the provider total while displaying unassigned customers separately',()=>{
  const lga={type:'Feature',properties:{lga:'Central Highlands Regional'},geometry:null};
  const result=buildReport({lgas:[lga],allLgas:{features:[lga]},powerCounts:{energex:{rows:[]},ergon:{rows:[{label:'Central Highlands Regional',count:2267},{label:'Unknown',count:2},{label:'Unassigned',count:1},{label:'New council name',count:4}]}},trafficAvailable:true,asAt:'Test snapshot',scope:'Queensland',areaLabel:'Queensland',statewide:true});
  const section=result.sections.find(s=>s.heading==='Power outages - Ergon');assert.equal(section.summary,'Total: 2,274 customers.');assert.deepEqual(section.rows,[{label:'Central Highlands Regional',detail:'2,267 customers'},{label:'LGA not specified',detail:'3 customers'},{label:'Unmatched LGA (New council name)',detail:'4 customers'}]);assert.equal(section.caveat,'');assert.match(result.notes.join(' '),/Included in the statewide total/);
});
test('a zero-customer unknown council does not suppress a verified empty section',()=>{
  const lga={type:'Feature',properties:{lga:'Central Highlands Regional'},geometry:null};
  const result=buildReport({lgas:[lga],allLgas:{features:[lga]},powerCounts:{energex:{rows:[]},ergon:{rows:[{label:'Unknown',count:0}]}},trafficAvailable:true,asAt:'Test snapshot',scope:'Warning LGAs'});
  const section=result.sections.find(s=>s.heading==='Power outages - Ergon');assert.match(section.summary,/No current unplanned outages reported/);assert.equal(section.caveat,'');assert.deepEqual(result.notes,[]);
});
