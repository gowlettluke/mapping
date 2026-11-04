import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {orderGaugesByFlow,validateGaugeFlowReference,gaugeFlowSummary,loadGaugeFlowReference} from '../js/gauge-flow.js';
import {normaliseGauges,discoverGauges} from '../js/gauges.js';
import {projectedBounds} from '../js/geometry.js';

const point=[145,-25],record=(id,downstream=[],extra={})=>({id:String(id),point,river:'Example River',basin:'Example Basin',downstream:downstream.map(String),...extra});
const reference=stations=>({schemaVersion:1,retrievedUtc:'2026-11-04T00:00:00Z',stationCount:stations.length,stations});
const gauge=(id,name,extra={})=>({id:String(id),stationId:String(id),name,point,label:'old-'+id,...extra});

test('upstream-to-downstream ordering overrides alphabetical, numeric and latitude order consistently',()=>{
  const stations=reference([record(30,[20,10]),record(20,[10]),record(10)]),input=[gauge(10,'Alpha downstream'),gauge(30,'Zulu upstream'),gauge(20,'Middle')];
  const output=orderGaugesByFlow(input,validateGaugeFlowReference(stations));assert.deepEqual(output.map(gauge=>gauge.stationId),['30','20','10']);assert.deepEqual(output.map(gauge=>gauge.label),['G1','G2','G3']);assert.ok(output.every(gauge=>gauge.flowOrder==='verified'));assert.equal(new Set(output.map(gauge=>gauge.flowGroupId)).size,1);assert.equal(input[0].label,'old-10');
});
test('tributaries and same-name rivers in different basins retain separate groups',()=>{
  const stations=reference([record(1,[2]),record(2),record(3,[2],{river:'Tributary Creek'}),record(4,[],{basin:'Another Basin'})]),input=[gauge(2,'Downstream'),gauge(3,'Tributary'),gauge(1,'Upstream'),gauge(4,'Different basin')],output=orderGaugesByFlow(input,stations);
  const groups=new Map(output.map(gauge=>[gauge.stationId,gauge.flowGroupId]));assert.notEqual(groups.get('1'),groups.get('3'));assert.notEqual(groups.get('1'),groups.get('4'));assert.equal(groups.get('1'),groups.get('2'));assert.ok(output.findIndex(gauge=>gauge.stationId==='1')<output.findIndex(gauge=>gauge.stationId==='2'));
});
test('a fork has separate directed reaches and no invented relationship between its branches',()=>{
  const stations=reference([record(1,[2,3,4]),record(2,[4]),record(3,[4]),record(4)]),output=orderGaugesByFlow([gauge(4,'Delta'),gauge(3,'Charlie'),gauge(2,'Bravo'),gauge(1,'Alpha')],stations),groups=new Map();for(const gauge of output){if(!groups.has(gauge.flowGroupId))groups.set(gauge.flowGroupId,[]);groups.get(gauge.flowGroupId).push(gauge);}
  assert.equal(output.length,4);assert.equal(new Set(output.map(gauge=>gauge.id)).size,4);assert.equal(groups.size,2);
  for(const rows of groups.values())for(let i=1;i<rows.length;i++)assert.ok(stations.stations.find(station=>station.id===rows[i-1].stationId).downstream.includes(rows[i].stationId));
  assert.ok(output.every(gauge=>gauge.flowOrder==='verified'));assert.ok(!gaugeFlowSummary(output).includes('unconfirmed'));
  const branches=[output.find(gauge=>gauge.stationId==='2'),output.find(gauge=>gauge.stationId==='3')];assert.ok(branches.every(gauge=>!gauge.flowDownstream.includes(branches.find(other=>other!==gauge).label)));
});
test('a matched but disconnected reach still has unconfirmed order',()=>{
  const stations=reference([record(1,[2]),record(2),record(3)]),output=orderGaugesByFlow([gauge(1,'Upper'),gauge(2,'Lower'),gauge(3,'Other channel')],stations),other=output.find(gauge=>gauge.stationId==='3');
  assert.equal(other.flowOrder,'unconfirmed');assert.deepEqual(other.flowDownstream,[]);assert.ok(gaugeFlowSummary(output).includes('1 order unconfirmed'));
});
test('a multi-channel match needs a confirmed connection to a selected gauge',()=>{
  const stations=reference([record(1,[2],{method:'named-river-consensus',river:'Branch Creek'}),record(2,[],{river:'Main River'})]);
  assert.equal(orderGaugesByFlow([gauge(1,'Branch')],stations)[0].flowOrder,'unconfirmed');
  const output=orderGaugesByFlow([gauge(1,'Branch'),gauge(2,'Receiving gauge')],stations);assert.ok(output.every(gauge=>gauge.flowOrder==='verified'));assert.deepEqual(output[0].flowDownstream,[output[1].label]);
});
test('leading-zero BoM IDs match only with a nearby source location',()=>{
  const stations=reference([record('036169')]);assert.equal(orderGaugesByFlow([gauge('36169','Coolagh')],stations)[0].flowOrder,'matched');
  const moved=orderGaugesByFlow([gauge('36169','Moved station',{point:[150,-25]})],stations)[0];assert.equal(moved.flowOrder,'unconfirmed');assert.ok(moved.flowGroup.includes('Order unconfirmed'));
  assert.equal(orderGaugesByFlow([gauge('36169','Bad location',{point:[145]})],stations)[0].flowOrder,'unconfirmed');
});
test('unmatched gauges stay visible with source river names and explicit unconfirmed ordering',()=>{
  const input=[gauge('new-1','Creek River at Example'),gauge('new-2','Another gauge',{river:'Source Creek',basin:'Source Basin'})],output=orderGaugesByFlow(input,reference([record(1)]));
  assert.equal(output.length,2);assert.ok(output.every(gauge=>gauge.flowOrder==='unconfirmed'));assert.equal(output.find(gauge=>gauge.id==='new-1').river,'Creek River');assert.ok(output.find(gauge=>gauge.id==='new-2').flowGroup.includes('Source Creek'));
});
test('missing reference data keeps every station and never claims a verified sequence',()=>{
  const output=orderGaugesByFlow([gauge(1,'B'),gauge(2,'A')]);assert.deepEqual(output.map(gauge=>gauge.name),['A','B']);assert.ok(output.every(gauge=>gauge.flowOrder==='unconfirmed'));assert.ok(output.every(gauge=>gauge.flowReason.includes('unavailable')));assert.deepEqual(orderGaugesByFlow([],null),[]);
});
test('invalid geometry, duplicate IDs, broken connections and cycles are rejected by reference validation',()=>{
  assert.throws(()=>validateGaugeFlowReference(reference([])),/unavailable/);
  for(const rows of [[record(1),record('01')],[record(1,[9])],[record(1,[1])],[record(1,[2]),record(2,[3]),record(3,[1])],[record(1,[],{point:[NaN,0]})]])assert.throws(()=>validateGaugeFlowReference(reference(rows)));
  const badCount=reference([record(1)]);badCount.stationCount=2;assert.throws(()=>validateGaugeFlowReference(badCount));
});
test('defensive ordering also preserves stations if supplied a cyclic fixture',()=>{
  const output=orderGaugesByFlow([gauge(1,'First'),gauge(2,'Second')],reference([record(1,[2]),record(2,[1])]));assert.equal(output.length,2);assert.ok(output.every(gauge=>gauge.flowOrder==='unconfirmed'));
});
test('source Stream and Basin fields are retained without treating CatchmentID as flow direction',()=>{
  const rows=normaliseGauges({collection:{type:'FeatureCollection',features:[{type:'Feature',properties:{StationNum:538001,Name:'Retreat',Stream:'Barcoo River',Basin:'Cooper Creek',CatchmentID:999},geometry:{type:'Point',coordinates:point}}]}});assert.equal(rows[0].river,'Barcoo River');assert.equal(rows[0].basin,'Cooper Creek');assert.equal(rows[0].flowOrder,undefined);
});
test('missing river names use the source watercourse label without inventing a flow connection',()=>{
  const stations=reference([record(1,[2],{river:'undefined'}),record(2,[],{river:'Example River'})]),output=orderGaugesByFlow([gauge(1,'Location (Tributary Creek)'),gauge(2,'Example River at Lower Bridge')],stations);
  const tributary=output.find(gauge=>gauge.stationId==='1');assert.equal(tributary.river,'Tributary Creek');assert.ok(tributary.flowDownstream.length===1);assert.ok(output.every(gauge=>!gauge.flowGroup.includes('undefined')));
});
const source={gaugeCollection:async()=>({collection:{type:'FeatureCollection',features:[{type:'Feature',properties:{StationNum:1,Name:'Selected station'},geometry:{type:'Point',coordinates:point}}]}})},mask={extent:projectedBounds([144,-26,146,-24]),width:1,height:1,visible:new Uint8Array([1])};
test('reference failure affects ordering only and cancellation cannot produce a stale gauge list',async()=>{
  const result=await discoverGauges(source,[mask],null,{flowReference:async()=>{throw new Error('Reference failed');}});assert.equal(result.length,1);assert.equal(result[0].flowOrder,'unconfirmed');
  const controller=new AbortController();await assert.rejects(discoverGauges(source,[mask],controller.signal,{flowReference:async()=>{controller.abort();throw new Error('Stopped');}}),{name:'AbortError'});
});
test('an empty flood-area match makes no ordering-reference request',async()=>{
  let called=false;const result=await discoverGauges(source,[],null,{flowReference:async()=>{called=true;}});assert.deepEqual(result,[]);assert.equal(called,false);
});
test('the bundled public reference is valid and confirms the supplied Barcoo example',async()=>{
  const data=validateGaugeFlowReference(JSON.parse(await readFile(new URL('../data/gauge-flow.json',import.meta.url),'utf8'))),coolagh=data.stations.find(station=>station.id==='036169'),retreat=data.stations.find(station=>station.id==='538001');assert.ok(data.stationCount>100);assert.ok(coolagh);assert.ok(retreat);assert.ok(coolagh.downstream.includes(retreat.id));assert.ok(!retreat.downstream.includes(coolagh.id));
});
test('the expanded reference confirms directory aliases, named sites and a rejoining channel',async()=>{
  const data=validateGaugeFlowReference(JSON.parse(await readFile(new URL('../data/gauge-flow.json',import.meta.url),'utf8'))),stations=new Map(data.stations.map(station=>[station.id,station]));
  assert.ok(data.sources.stationDirectory.includes('bom.gov.au'));assert.equal(data.stationDirectoryPublished,'2022-01-05');assert.ok(data.stations.every(station=>station.river.trim()));
  for(const [upper,lower]of [['536009','538001'],['537008','537004'],['539202','539198'],['538012','538010']]){assert.ok(stations.get(upper).downstream.includes(lower));assert.ok(!stations.get(lower).downstream.includes(upper));}
  assert.equal(stations.get('538012').method,'named-river-consensus');assert.equal(stations.get('538012').placements.length,2);assert.equal(stations.get('541103').river,'Campbells Gully');
});
test('a validated ordering reference is cached without starting requests after cancellation',async()=>{
  const prior=globalThis.fetch;let requests=0;globalThis.fetch=async()=>{requests++;return new Response(JSON.stringify(reference([record(1)])));};
  try{const first=await loadGaugeFlowReference();assert.equal(await loadGaugeFlowReference(),first);assert.equal(requests,1);const controller=new AbortController();controller.abort();await assert.rejects(loadGaugeFlowReference(controller.signal),{name:'AbortError'});assert.equal(requests,1);}
  finally{globalThis.fetch=prior;}
});
