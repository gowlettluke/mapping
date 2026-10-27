import test from 'node:test';
import assert from 'node:assert/strict';
import {FEEDS,readyForMaps,executeChecks,withDeadline} from '../js/connections.js';
import {ArcGISConnection} from '../js/arcgis.js';

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
  const connection=new ArcGISConnection(),controller=new AbortController();let release,destroyed=0;
  connection.choices.warning=[{id:'warning-item'}];connection.sdk={WMSLayer:class{async load(){await new Promise(r=>release=r);}destroy(){destroyed++;}}};
  const bind=connection.bind('warning','warning-item',controller.signal);controller.abort();release();await assert.rejects(bind,{name:'AbortError'});assert.equal(destroyed,1);assert.equal(connection.layers.warning,undefined);
});
test('already-aborted checks do not start a network operation',async()=>{const controller=new AbortController();controller.abort();let called=false;await assert.rejects(withDeadline(()=>{called=true;},controller.signal),{name:'AbortError'});assert.equal(called,false);});
