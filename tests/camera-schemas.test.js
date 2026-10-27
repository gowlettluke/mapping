import test from 'node:test';
import assert from 'node:assert/strict';
import {cameraImageLinks,resolveCameraAttachments} from '../js/camera-images.js';
import {normaliseCameras,captureTime} from '../js/cameras.js';

const feature={type:'Feature',id:1,geometry:{type:'Point',coordinates:[152.98,-27.59]},properties:{OBJECTID:1,location_name:'Council crossing',camera1_id:'FP01',image_last_updated:1793086547000}};
const collection={type:'FeatureCollection',features:[feature]};
test('Queensland flood-camera schema retains all numbered image views even when the first field is empty',()=>{
  const rows=normaliseCameras({type:'FeatureCollection',features:[{...feature,properties:{Location_Name:'Bridge crossing',Image_Url:null,Image_Url2:'https://images.example/left.jpeg',Image_Url3:'https://images.example/deck.jpeg',Image_Url4:'https://images.example/marker.jpeg'}}]},'flood','Queensland flood cameras');
  assert.equal(rows.length,3);assert.equal(new Set(rows.map(row=>row.id)).size,3);assert.deepEqual(rows.map(row=>new URL(row.url).pathname),['/left.jpeg','/deck.jpeg','/marker.jpeg']);
});
test('numbered image fields do not duplicate the same photograph and legacy direct URLs still work',()=>{
  assert.equal(cameraImageLinks({Image_Url:'https://images.example/current.jpg',Image_Url2:'https://images.example/current.jpg'}).length,1);
  assert.equal(cameraImageLinks({Image_Url:null,camera_url:'https://images.example/current.jpg'}).length,1);
});
test('BCC ID-only records resolve actual ArcGIS image attachment IDs without fetching photographs',async()=>{
  const calls=[],request=async(url,options)=>{calls.push({url,options});return {data:url.includes('/queryAttachments')?{attachmentGroups:[{parentObjectId:1,attachmentInfos:[{id:17,contentType:'image/jpeg',size:500,name:'first.JPG'},{id:18,contentType:'image/jpeg',size:600,name:'second.JPG'},{id:19,contentType:'application/pdf',size:100,name:'notes.pdf'}]}]}:{hasAttachments:true,objectIdField:'OBJECTID'}};};
  const result=await resolveCameraAttachments({collection,url:'https://layers.example/FeatureServer?registration=kept',layerId:0,request});
  const cameras=normaliseCameras(result,'bcc','BCC');assert.equal(cameras.length,2);assert.equal(new Set(cameras.map(camera=>camera.id)).size,2);
  assert.equal(cameras[0].url,'https://layers.example/FeatureServer/0/1/attachments/17?registration=kept');assert.match(cameras[1].name,/second.JPG/);
  assert.equal(calls.length,2);assert.ok(calls.every(call=>call.options.responseType==='json'&&call.options.authMode==='no-prompt'));
  assert.equal(captureTime(result.features[0].properties),null);
});
test('attachment lookup is skipped for records that already supply image URLs',async()=>{
  const data={...collection,features:[{...feature,properties:{image_url:'https://images.example/current.jpg'}}]};
  assert.equal(await resolveCameraAttachments({collection:data,request:()=>{throw new Error('Unexpected metadata request');}}),data);
});
test('failed and incomplete attachment metadata cannot invent image links',async()=>{
  for(const body of [{error:{code:403}},{attachmentGroups:[{parentObjectId:1,attachmentInfos:[]}],exceededTransferLimit:true}]){
    const request=async url=>({data:url.includes('/queryAttachments')?body:{hasAttachments:true,objectIdField:'OBJECTID'}});
    await assert.rejects(resolveCameraAttachments({collection,url:'https://layers.example/FeatureServer',layerId:0,request}),/attachment list/);
  }
});
test('cancelled attachment checks do not make a network request',async()=>{
  const controller=new AbortController();controller.abort();let calls=0;
  await assert.rejects(resolveCameraAttachments({collection,signal:controller.signal,request:async()=>{calls++;}}),{name:'AbortError'});assert.equal(calls,0);
});
