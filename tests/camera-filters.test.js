import test from 'node:test';
import assert from 'node:assert/strict';
import {normalisePhotoFilter,photoEligibility,filterCameraPhotos,retrievePhotos} from '../js/cameras.js';
import {setCanvasFactory} from '../js/utils.js';

const now=Date.parse('2026-11-05T02:00:00Z'),camera=(id,age)=>({id,name:id,url:'https://images.example/'+id+'.jpg',capturedAt:age===null?null:new Date(now-age)}),hour=3600000;
const cameras=[camera('fresh',hour/4),camera('one-hour',hour),camera('two-hours',2*hour),camera('one-day',24*hour),camera('old',25*hour),camera('unknown',null),camera('future',-2*hour),{...camera('invalid',null),capturedAt:new Date(NaN)}];

test('floods default to all photos while weather profiles retain the one-hour filter',()=>{
  for(const value of [undefined,'','invalid','constructor']){assert.equal(normalisePhotoFilter(value,'flooding'),'all');for(const profile of ['thunderstorm','severeWeather'])assert.equal(normalisePhotoFilter(value,profile),'1h');}
  assert.equal(filterCameraPhotos(cameras,{profile:'flooding',now}).cameras.length,cameras.length);assert.equal(normalisePhotoFilter('24h','flooding'),'24h');
});
test('all six photo filters handle verified age and unverified times independently',()=>{
  const expected={all:['fresh','one-hour','two-hours','one-day','old','unknown','future','invalid'],'1h':['fresh','one-hour','unknown','future','invalid'],'24h':['fresh','one-hour','two-hours','one-day','unknown','future','invalid'],verified:['fresh','one-hour','two-hours','one-day','old'],'verified-1h':['fresh','one-hour'],'verified-24h':['fresh','one-hour','two-hours','one-day']};
  for(const [filter,ids]of Object.entries(expected)){const selected=filterCameraPhotos(cameras,{profile:'flooding',filter,now});assert.deepEqual(selected.cameras.map(c=>c.id),ids);assert.equal(selected.cameras.length+selected.stale+selected.unverified,cameras.length);}
});
test('one-hour and twenty-four-hour limits exclude only captures strictly older than the boundary',()=>{
  for(const [filter,hours]of [['1h',1],['verified-1h',1],['24h',24],['verified-24h',24]]){assert.equal(photoEligibility(camera('boundary',hours*hour),now,filter).included,true);assert.equal(photoEligibility(camera('older',hours*hour+1),now,filter).included,false);}
});
test('invalid, missing and future capture times remain unverified rather than becoming fresh photos',()=>{
  for(const camera of cameras.slice(5)){assert.equal(photoEligibility(camera,now,'all').capturedAt,null);assert.equal(photoEligibility(camera,now,'verified').reason,'unverified');}
  assert.equal(photoEligibility({capturedAt:'2026-11-05T01:00:00'},now,'verified').reason,'unverified');
});
test('retrieval skips filtered cameras before network requests and distinguishes exclusions from failed images',async t=>{
  const previous={fetch:globalThis.fetch,createImageBitmap:globalThis.createImageBitmap};t.after(()=>Object.assign(globalThis,previous));const requests=[],progress=[];
  globalThis.fetch=async url=>{requests.push(String(url));return new Response(String(url).includes('missing')?'':'synthetic image');};globalThis.createImageBitmap=async()=>({width:800,height:400,close(){}});setCanvasFactory((width,height)=>({width,height,getContext:()=>({fillRect(){},drawImage(){}}),toDataURL:()=> 'data:image/jpeg;base64,c3ludGhldGlj'}));
  const rows=[camera('fresh',hour/4),camera('old',2*hour),camera('unknown',null),camera('missing',hour/4)],result=await retrievePhotos(rows,{profile:'flooding',filter:'verified-1h',now,onProgress:n=>progress.push(n)});
  assert.deepEqual(requests.sort(),['https://images.example/fresh.jpg','https://images.example/missing.jpg']);assert.deepEqual(result.included.map(r=>r.camera.id),['fresh']);assert.equal(result.stale,1);assert.equal(result.unverified,1);assert.equal(result.unavailable,1);assert.equal(progress.at(-1),rows.length);assert.equal(+result.included[0].photo.capturedAt,now-hour/4);assert.ok(result.included[0].photo.retrievedAt instanceof Date);
  requests.length=0;const flood=await retrievePhotos([camera('old-flood',25*hour)],{profile:'flooding',now});assert.equal(flood.included.length,1);assert.equal(+flood.included[0].photo.capturedAt,now-25*hour);assert.equal(flood.stale,0);
});
test('an aborted photo export cannot turn into an empty successful filter result',async()=>{
  const controller=new AbortController();controller.abort();await assert.rejects(retrievePhotos([camera('unknown',null)],{profile:'flooding',filter:'verified',signal:controller.signal,now}),{name:'AbortError'});
});
