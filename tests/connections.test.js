import test from 'node:test';
import assert from 'node:assert/strict';
import {FEEDS,readyForMaps,executeChecks,withDeadline} from '../js/connections.js';
import {ArcGISConnection} from '../js/arcgis.js';
import {registeredWmsConfig} from '../js/wms.js';

test('optional connection failure does not block verified core layers',async()=>{
  const states=new Map();await executeChecks(FEEDS.map(feed=>({id:feed.id,run:async()=>{if(feed.id==='camera-bcc')throw new Error('Not shared with this account');return 'Connected';}})),{onUpdate:r=>states.set(r.id,r)});
  assert.equal(states.size,FEEDS.length);assert.equal(states.get('camera-bcc').status,'error');assert.equal(readyForMaps(states),true);
  states.set('lgas',{status:'error'});assert.equal(readyForMaps(states),false);
});
test('a stalled SDK promise times out and other connection checks still finish',async()=>{
  const controller=new AbortController();const states=await executeChecks([{id:'stalled',run:()=>new Promise(()=>{})},{id:'working',run:async()=> 'Ready'}],{signal:controller.signal,timeout:10});
  assert.equal(states.get('stalled').status,'error');assert.match(states.get('stalled').detail,/timed out/);assert.equal(states.get('working').status,'ok');
});
test('signing out cancels pending checks without publishing a late success',async()=>{
  let finish;const controller=new AbortController(),updates=[];
  const checks=executeChecks([{id:'late',run:()=>new Promise(r=>finish=r)}],{signal:controller.signal,onUpdate:r=>updates.push(r)});
  await Promise.resolve();controller.abort();await assert.rejects(checks,{name:'AbortError'});finish('Late result');await Promise.resolve();assert.equal(updates.some(r=>r.status==='ok'),false);
});
test('layer discovery records missing items after authentication without dropping the session',async()=>{
  const connection=new ArcGISConnection();connection.portal={user:{username:'signed-in'},queryItems:async()=>({results:[]})};
  const choices=await connection.discoverWeather();assert.deepEqual(choices,{warning:[],radar:[]});assert.equal(connection.portal.user.username,'signed-in');
});
test('an aborted layer load is destroyed instead of becoming the active session layer',async()=>{
  const connection=new ArcGISConnection(),controller=new AbortController();let release,started,destroyed=0;const loading=new Promise(r=>started=r);
  connection.choices.warning=[{id:'warning-item',url:'https://registered.example/wms'}];connection.sdk={WMSLayer:class{async load(){await new Promise(r=>{release=r;started();});}destroy(){destroyed++;}}};
  const bind=connection.bind('warning','warning-item',controller.signal);await loading;controller.abort();release();await assert.rejects(bind,{name:'AbortError'});assert.equal(destroyed,1);assert.equal(connection.layers.warning,undefined);
});
test('already-aborted checks do not start a network operation',async()=>{const controller=new AbortController();controller.abort();let called=false;await assert.rejects(withDeadline(()=>{called=true;},controller.signal),{name:'AbortError'});assert.equal(called,false);});

test('private service search accepts punctuation variants and Map Service items without fuzzy selection',async()=>{
  const connection=new ArcGISConnection(),queries=[];
  connection.portal={queryItems:async({query})=>{queries.push(query);return {results:queries.length===1?[]:[{id:'match',title:'District Disaster (DDMG) Boundary'},{id:'unrelated',title:'District Disaster (DDMG) Boundary Archive'}]};}};
  const items=await connection.search(['District_Disaster_DDMG_Boundary']);
  assert.deepEqual(items.map(i=>i.id),['match']);assert.equal(queries.length,2);
  assert.match(queries[0],/type:"Feature Service" OR type:"Map Service"/);
});
test('matching private items remain ambiguous rather than selecting an arbitrary owner',async()=>{
  const connection=new ArcGISConnection();connection.portal={queryItems:async()=>({results:[{id:'one',title:'Web Cameras - LIVE'},{id:'two',title:'Web Cameras LIVE'}]})};
  await assert.rejects(connection.probeFeature({title:'Web Cameras - LIVE',layer:0}),/Multiple matching items/);
});
test('weather metadata and capabilities use the selected private portal item and abort signal',async()=>{
  const connection=new ArcGISConnection(),controller=new AbortController(),calls=[];
  const item={id:'private',url:'https://registered.example/wms',load:async options=>calls.push(['item',options]),fetchData:async(type,options)=>{calls.push(['data',{type,...options}]);return {mapUrl:'https://registered.example/map?route=private'};}};
  connection.choices.warning=[item];connection.sdk={WMSLayer:class{constructor(options){calls.push(['constructor',options]);}async load(options){calls.push(['capabilities',options]);}destroy(){}}};
  await connection.bind('warning','private',controller.signal);
  assert.ok(calls[0][1].signal instanceof AbortSignal);assert.equal(calls[1][1].type,'json');assert.equal(calls[1][1].signal,calls[0][1].signal);assert.equal(calls[2][1].portalItem,item);assert.ok(calls[3][1].signal instanceof AbortSignal);
  assert.equal(connection.layers.warning.config.mapUrl,'https://registered.example/map?route=private');
});
test('weather failure identifies the stage and HTTP status without exposing private request details',async()=>{
  const connection=new ArcGISConnection();
  connection.choices.radar=[{id:'private',load:async()=>{throw Object.assign(new Error('https://private.example/?token=SECRET'),{details:{httpStatus:403,requestOptions:{token:'SECRET'}}});}}];
  await assert.rejects(connection.bind('radar','private'),error=>/Radar private item metadata failed \(HTTP 403\)/.test(error.message)&&!error.message.includes('SECRET')&&!error.message.includes('private.example'));
  assert.equal(connection.layers.radar,undefined);
});
test('weather image errors identify rendering separately from private metadata',async()=>{
  const connection=new ArcGISConnection();
  connection.sdk={esriRequest:async()=>{throw new TypeError('Failed to fetch');}};connection.layers.warning={config:registeredWmsConfig({id:'w',url:'https://registered.example/wms'})};
  await assert.rejects(connection.render('warning',[0,0,1,1],128,128,['warning']),/Warning: Browser WMS rendering failed/);
});
test('blocked capabilities retain private registered configuration for real image verification',async()=>{
  const connection=new ArcGISConnection();let destroyed=0;
  connection.choices.warning=[{id:'private',url:'https://registered.example/wms',fetchData:async()=>({mapUrl:'https://registered.example/private-map?route=kept',customParameters:{registration:'kept'}})}];
  connection.sdk={WMSLayer:class{async load(){throw new TypeError('Failed to fetch');}destroy(){destroyed++;}}};
  await connection.bind('warning','private');assert.equal(destroyed,1);assert.equal(connection.layers.warning.base,null);assert.equal(connection.layers.warning.route,null);
  assert.equal(connection.layers.warning.config.mapUrl,'https://registered.example/private-map?route=kept');assert.equal(connection.layers.warning.config.customParameters.registration,'kept');
});
