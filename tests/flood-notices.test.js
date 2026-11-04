import test from 'node:test';
import assert from 'node:assert/strict';
import {groupFloodNotices,floodNoticeTimes,loadFloodNotices,currentFloodNotices} from '../js/flood-notices.js';
import {CONFIG} from '../config.js';
import {contains,projectedBounds,pixelPoint} from '../js/geometry.js';
import {intersectFloodPixels} from '../js/flood-scope.js';
import {selectGauges} from '../js/gauges.js';

const now=Date.UTC(2026,10,4,10),hour=3600000,key='floodWarnings';
const polygon=(w,s,e,n)=>({type:'Polygon',coordinates:[[[w,s],[e,s],[e,n],[w,n],[w,s]]]}),fc=features=>({type:'FeatureCollection',features});
const ref=(aac,dist_name,product_id,geometry,parent='')=>({type:'Feature',geometry,properties:{aac,dist_name,product_id,aac_parent:parent}});
const west=polygon(150,-28,151,-27),east=polygon(152,-28,153,-27),other=polygon(151,-28,152,-27);
const references=fc([ref('QLD_RC034','Thomson and Barcoo Rivers and Cooper Creek','IDQ20860',polygon(150,-28,154,-27)),ref('QLD_RC127','Thomson River','IDQ20860',west,'QLD_RC034'),ref('QLD_RC128','Barcoo River to Isisford','IDQ20860',east,'QLD_RC034'),ref('QLD_RC130','Cooper Creek','IDQ20860',polygon(153,-28,154,-27),'QLD_RC034'),ref('QLD_RC080','Baffle Creek','IDQ20775',other)]);
function notice(aac,geometry,overrides={}){return {type:'Feature',geometry,properties:{aac,status:'O',phase:'UPD',severity:'MIN',name:'Display name is not used for membership',issue_time_utc:now-hour,start_time_utc:now-hour,start_time_local:now+9*hour,end_time_local:now+34*hour,...overrides}};}
const rows=()=>fc([notice('QLD_RC127',west),notice('QLD_RC128',east,{severity:'MOD'}),notice('QLD_RC080',other)]);
const options={key,now};
test('one BoM warning combines disconnected named catchments and excludes inactive parent/child catchments',()=>{
  const groups=groupFloodNotices(rows(),references,options);assert.equal(groups.length,2);const group=groups.find(g=>g.productId==='IDQ20860');
  assert.match(group.title,/Barcoo River \/ Thomson River/);assert.deepEqual(group.catchmentNames,['Thomson River','Barcoo River to Isisford']);assert.equal(group.scopeGeometries.length,2);assert.equal(group.referenceFeatures.length,2);assert.equal(group.id,'floodWarnings:notice:IDQ20860');assert.equal(group.sourceUrl,'https://www.bom.gov.au/warning/flood-warning/IDQ20860');
  assert.ok(group.scopeGeometries.some(g=>contains([150.5,-27.5],g)));assert.ok(group.scopeGeometries.some(g=>contains([152.5,-27.5],g)));assert.ok(!group.scopeGeometries.some(g=>contains([153.5,-27.5],g)),'The broad reference parent cannot add unwarned Cooper Creek.');
});
test('combined report footprints retain gauges in both catchments and omit an unrelated warning between them',()=>{
  const selected=groupFloodNotices(rows(),references,options).find(g=>g.productId==='IDQ20860'),mask={width:120,height:60,extent:projectedBounds([150,-28,154,-27]),visible:new Uint8Array(7200).fill(1)};
  const inside=Uint8Array.from(mask.visible,(_,i)=>selected.scopeGeometries.some(geometry=>contains(pixelPoint(i%mask.width+.5,Math.floor(i/mask.width)+.5,mask.extent,mask.width,mask.height),geometry))?1:0),scoped=intersectFloodPixels(mask,inside);
  const gauges=selectGauges([{id:'thomson',name:'Thomson',point:[150.5,-27.5]},{id:'barcoo',name:'Barcoo',point:[152.5,-27.5]},{id:'neighbour',name:'Neighbour',point:[151.5,-27.5]},{id:'inactive-cooper',name:'Inactive',point:[153.5,-27.5]}],[scoped.mask]);assert.deepEqual(gauges.map(g=>g.id),['barcoo','thomson']);
});
test('membership uses AAC/product IDs, including the correct Boyne, despite duplicate river names',()=>{
  const refs=fc([ref('QLD_RC017','Burnett River','IDQ20770',west),ref('QLD_RC074','Stuart and Boyne Rivers','IDQ20770',west,'QLD_RC017'),ref('QLD_RC073','Burnett River to Mundubbera','IDQ20770',east,'QLD_RC017'),ref('QLD_RC081','Boyne River','IDQ20775',other)]);
  const groups=groupFloodNotices(fc([notice('QLD_RC074',west),notice('QLD_RC073',east),notice('QLD_RC081',other)]),refs,options);assert.equal(groups.length,2);const burnett=groups.find(g=>g.productId==='IDQ20770');assert.match(burnett.title,/Boyne and Burnett Rivers/);assert.equal(burnett.scopeGeometries.length,2);assert.ok(!burnett.referenceFeatures.some(f=>f.properties.aac==='QLD_RC081'));
});
test('local wall-clock expiry is converted to AEST independently of the browser timezone',()=>{
  const times=floodNoticeTimes(rows().features[0].properties);assert.equal(times.expires,now+24*hour);assert.equal(times.issued,now-hour);
  const expired=notice('QLD_RC127',west,{issue_time_utc:now-3*hour,start_time_utc:now-3*hour,start_time_local:now+7*hour,end_time_local:now+9*hour});assert.deepEqual(groupFloodNotices(fc([expired]),references,options),[],'An expiry displayed 9 hours ahead as UTC is already expired in Queensland.');
  assert.throws(()=>floodNoticeTimes({...expired.properties,start_time_local:now+6*hour}),/dates could not be verified/);
});
test('Final warnings stay selectable until their real expiry, but cancelled, expired and test notices do not',()=>{
  const final=notice('QLD_RC127',west,{phase:'FIN'}),groups=groupFloodNotices(fc([final]),references,options);assert.equal(groups.length,1);assert.match(groups[0].title,/^Final Flood Warning/);
  for(const change of [{phase:'CAN'},{status:'T'},{status:'D'},{end_time_local:now+10*hour}])assert.deepEqual(groupFloodNotices(fc([notice('QLD_RC127',west,change)]),references,options),[]);
});
test('new cancellations/expired versions replace older duplicate records instead of reviving them',()=>{
  const old=notice('QLD_RC127',west,{issue_time_utc:now-2*hour}),cancel=notice('QLD_RC127',west,{phase:'CAN'});assert.deepEqual(groupFloodNotices(fc([old,cancel]),references,options),[]);assert.deepEqual(groupFloodNotices(fc([cancel,old]),references,options),[]);const sameTime=notice('QLD_RC127',west);assert.deepEqual(groupFloodNotices(fc([cancel,sameTime]),references,options),[]);assert.deepEqual(groupFloodNotices(fc([sameTime,cancel]),references,options),[]);
  const expired=notice('QLD_RC127',west,{end_time_local:now+10*hour});assert.deepEqual(groupFloodNotices(fc([old,expired]),references,options),[]);
});
test('a newer issue replaces older catchment membership, including cancellation of the whole product',()=>{
  const old=notice('QLD_RC127',west,{issue_time_utc:now-2*hour}),current=notice('QLD_RC128',east),groups=groupFloodNotices(fc([old,current]),references,options);assert.equal(groups.length,1);assert.deepEqual(groups[0].catchmentNames,['Barcoo River to Isisford']);
  const cancelled=notice('QLD_RC128',east,{phase:'CAN'});assert.deepEqual(groupFloodNotices(fc([old,cancelled]),references,options),[]);
});
test('revision is stable across row order and changes when notice scope, phase or issue changes',()=>{
  const data=rows(),first=groupFloodNotices(data,references,options).find(g=>g.productId==='IDQ20860');data.features.reverse();assert.equal(groupFloodNotices(data,references,options).find(g=>g.id===first.id).revision,first.revision);
  for(const changed of [fc([data.features.find(f=>f.properties.aac==='QLD_RC127')]),fc([notice('QLD_RC127',west,{phase:'FIN'}),notice('QLD_RC128',east,{severity:'MOD'})]),fc([notice('QLD_RC127',west,{issue_time_utc:now}),notice('QLD_RC128',east,{severity:'MOD'})])])assert.notEqual(groupFloodNotices(changed,references,options).find(g=>g.id===first.id).revision,first.revision);
});
test('unmapped current catchments, missing geometry, partial responses and malformed dates fail instead of reducing the notice',()=>{
  for(const data of [fc([notice('QLD_RC999',west)]),fc([notice('QLD_RC127',null)]),{...rows(),exceededTransferLimit:true},fc([notice('QLD_RC127',west,{end_time_local:null})]),fc([notice('QLD_RC127',west,{issue_time_utc:now+hour})]),fc([notice('QLD_RC127',west,{phase:'???'})])])assert.throws(()=>groupFloodNotices(data,references,options));
  assert.deepEqual(groupFloodNotices(fc([notice('NSW_RC127',west)]),references,options),[]);
});
test('flood watches combine catchments in an issuance, separately from warnings and other watch issuances',()=>{
  const refs=fc([ref('QLD_FL001','First catchment','',west),ref('QLD_FL002','Second catchment','',east),ref('QLD_FL003','Third catchment','',other)]),data=fc([notice('QLD_FL001',west,{office:'QLDRO'}),notice('QLD_FL002',east,{office:'QLDRO'}),notice('QLD_FL003',other,{office:'QLDRO',issue_time_utc:now-2*hour})]);
  const groups=groupFloodNotices(data,refs,{...options,key:'floodWatches'});assert.equal(groups.length,2);assert.equal(groups.find(g=>g.scopeGeometries.length===2).catchmentNames.length,2);assert.ok(groups.every(g=>g.kind==='Flood Watch'&&g.names[0]==='IDZ20016'));
});
test('refresh fetches fresh metadata and a complete current list without caching active notices',async()=>{
  let calls=0;const signal=new AbortController().signal,read=async()=>({editingInfo:{lastEditDate:now}}),query=async(url,opts)=>{calls++;assert.equal(url,CONFIG.publicSources.floodNotices+'/0');assert.equal(opts.signal,signal);assert.match(opts.where,/QLD/);return calls===1?rows():fc([]);},reference=async()=>({collection:references}),dependencies={now,read,query,reference};
  assert.equal((await loadFloodNotices(key,signal,dependencies)).length,2);assert.deepEqual(await loadFloodNotices(key,signal,dependencies),[]);assert.equal(calls,2);
});
test('stale, failed and incomplete feeds cannot become an empty warning list',async()=>{
  const reference=async()=>({collection:references}),read=async()=>({editingInfo:{lastEditDate:now}}),query=async()=>fc([]);
  await assert.rejects(loadFloodNotices(key,null,{now,reference,query,read:async()=>({editingInfo:{lastEditDate:now-3*hour}})}),/has not updated recently/);
  await assert.rejects(loadFloodNotices(key,null,{now,reference,query:async()=>({...rows(),exceededTransferLimit:true}),read}),/incomplete/);
  await assert.rejects(currentFloodNotices(null,{now,reference,read,query:async url=>{if(url.endsWith('/1'))throw new Error('Synthetic failure');return fc([]);}}),/Flood Watch notices could not be loaded/);
  assert.deepEqual(await currentFloodNotices(null,{now,reference,read,query}),[]);
});
test('cancellation stops grouping, source loading and a superseded in-flight query',async()=>{
  const controller=new AbortController();controller.abort();assert.throws(()=>groupFloodNotices(rows(),references,{...options,signal:controller.signal}),{name:'AbortError'});await assert.rejects(loadFloodNotices(key,controller.signal),{name:'AbortError'});
  const pending=new AbortController();await assert.rejects(loadFloodNotices(key,pending.signal,{now,read:async()=>({editingInfo:{lastEditDate:now}}),query:async()=>{pending.abort();return rows();},reference:async()=>({collection:references})}),{name:'AbortError'});
});
