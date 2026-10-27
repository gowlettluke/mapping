import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {ArcGISConnection} from '../js/arcgis.js';
import {arcgisItemId,distinctFeatureItems,embeddedCameraCollection,featureQueryUrl} from '../js/portal-features.js';
import {normaliseCameras} from '../js/cameras.js';
import {loadFloodReference,decodeReference,validateFloodReference} from '../js/flood-references.js';
import {mercator} from '../js/geometry.js';
const camera={type:'Feature',properties:{IMAGE_URL:'https://images.example/current.jpg',CAMERA_NAME:'River camera'},geometry:{type:'Point',coordinates:[153,-27]}};
const cameras={type:'FeatureCollection',features:[camera]};
const spec={key:'bcc',title:'Preferred camera view',alternatives:['Alternate camera feed'],layer:0};
test('camera discovery uses the preferred view without combining alternative source titles',async()=>{
  const connection=new ArcGISConnection(),queries=[];
  connection.search=async titles=>{queries.push(titles);return [{id:'preferred',title:titles[0],type:'Feature Service',url:'https://layers.example/FeatureServer'}];};
  assert.equal((await connection.featureItem(spec)).id,'preferred');assert.deepEqual(queries,[[spec.title]]);
});
test('camera discovery tries alternative names only when the preferred title is absent',async()=>{
  const connection=new ArcGISConnection(),queries=[];
  connection.search=async(titles,types)=>{queries.push(titles[0]);assert.ok(types.includes('Web Map'));assert.ok(types.includes('Feature Collection'));return titles[0]===spec.title?[]:[{id:'alternative'}];};
  assert.equal((await connection.featureItem(spec)).id,'alternative');assert.deepEqual(queries,[spec.title,spec.alternatives[0]]);
});
test('aliases to the same service and layer do not create false ambiguity',()=>{
  const same=distinctFeatureItems([{id:'one',url:'https://layers.example/FeatureServer/'},{id:'two',url:'https://layers.example/FeatureServer/0'},{id:'other-layer',url:'https://layers.example/FeatureServer/1'}],0);
  assert.deepEqual(same.map(i=>i.id),['one','other-layer']);
});
test('genuinely different matching camera sources require a choice and use the selected item consistently',async()=>{
  const connection=new ArcGISConnection();connection.search=async()=>[{id:'one',url:'https://one.example/FeatureServer'},{id:'two',url:'https://two.example/FeatureServer'}];
  await assert.rejects(connection.featureItem(spec),/Choose the correct source/);connection.setFeatureSelection(spec,'two');
  assert.equal((await connection.featureItem(spec)).id,'two');assert.equal(connection.featureSelections.get('bcc'),'two');
});
test('manual source links supply only an item ID to the signed-in portal',()=>{
  const id='0123456789abcdef0123456789abcdef';assert.equal(arcgisItemId('https://org.maps.arcgis.com/home/item.html?id='+id),id);assert.equal(arcgisItemId(id),id);
  assert.throws(()=>arcgisItemId('https://unrelated.example/item?id='+id));assert.throws(()=>arcgisItemId('token=secret'));
});
test('service query paths preserve registered URL parameters and explicit layer numbers',()=>{
  assert.equal(featureQueryUrl('https://layers.example/FeatureServer?registration=kept',0),'https://layers.example/FeatureServer/0/query?registration=kept');
  assert.equal(featureQueryUrl('https://layers.example/MapServer/4?registration=kept',0),'https://layers.example/MapServer/4/query?registration=kept');
});
test('embedded ArcGIS feature collections become camera points in longitude/latitude',async()=>{
  const [x,y]=mercator([153,-27]),item={type:'Feature Collection',fetchData:async()=>({layers:[{layerDefinition:{id:0},featureSet:{spatialReference:{wkid:102100},features:[{attributes:camera.properties,geometry:{x,y}}]}}]})};
  const result=await embeddedCameraCollection(item,spec,()=>{throw new Error('No service query expected');});
  const rows=normaliseCameras(result,'flood','TMR');assert.equal(rows.length,1);assert.equal(rows[0].name,'River camera');assert.ok(Math.abs(rows[0].point[0]-153)<1e-8);assert.ok(Math.abs(rows[0].point[1]+27)<1e-8);
});
test('web maps load camera layers from groups and ignore unrelated road layers',async()=>{
  const queries=[],item={type:'Web Map',fetchData:async()=>({operationalLayers:[{title:'Group',layers:[{title:'Web Cameras - LIVE',url:'https://layers.example/MapServer/3'},{title:'Roads',url:'https://layers.example/MapServer/4'}]}]})};
  const result=await embeddedCameraCollection(item,spec,async source=>{queries.push(source.url);return cameras;});
  assert.deepEqual(queries,['https://layers.example/MapServer/3']);assert.equal(result.features.length,1);
});
test('camera collections with an unknown coordinate system do not invent locations',async()=>{
  const item={type:'Feature Collection',fetchData:async()=>({layers:[{featureSet:{features:[{attributes:camera.properties,geometry:{x:500000,y:7000000}}]}}]})};
  await assert.rejects(embeddedCameraCollection(item,spec,()=>{}),/unsupported or missing coordinate system/);
});
test('private service pagination advances by actual returned records and rejects repeated pages',async()=>{
  const connection=new ArcGISConnection(),offsets=[];
  connection.sdk={esriRequest:async(url,options)=>{const offset=options.query.resultOffset;offsets.push(offset);return {data:{type:'FeatureCollection',features:[{...camera,id:offset+1}],exceededTransferLimit:offset===0}};}};
  assert.equal((await connection.featureCollection({url:'https://layers.example/FeatureServer'},0)).features.length,2);assert.deepEqual(offsets,[0,1]);
  connection.sdk.esriRequest=async()=>({data:{...cameras,exceededTransferLimit:true}});await assert.rejects(connection.featureCollection({url:'https://layers.example/FeatureServer'},0),/did not honour pagination/);
});
test('bundled BoM datasets decode with verified hashes and complete Queensland-only features',async()=>{
  const manifest=JSON.parse(await readFile(new URL('../data/flood-references.json',import.meta.url),'utf8'));
  for(const entry of Object.values(manifest.files)){
    const bytes=new Uint8Array(await readFile(new URL('../data/'+entry.path,import.meta.url))),collection=await decodeReference(bytes,entry.sha256);
    assert.equal(collection.features.length,entry.featureCount);assert.ok(collection.features.every(f=>f.properties.aac.startsWith('QLD_')));
    await assert.rejects(decodeReference(bytes,'incorrect-hash'),/do not match/);
  }
});
test('blocked live catchment requests fall back to reference geometry without claiming active warning data',async()=>{
  let fallback=0;const reference={type:'FeatureCollection',features:[{type:'Feature',properties:{aac:'QLD_fixture',dist_name:'Test catchment'},geometry:{type:'Polygon',coordinates:[[[152,-28],[154,-28],[154,-26],[152,-28]]]}}]};
  const result=await loadFloodReference('floodWarnings',undefined,{live:async()=>{throw new TypeError('Failed to fetch');},bundled:async()=>{fallback++;return {collection:reference,mode:'bundled',retrievedAt:'2026-10-27T00:00:00Z'};}});
  assert.equal(result.mode,'bundled');assert.equal(fallback,1);assert.equal(result.collection.features[0].properties.dist_name,'Test catchment');
  assert.throws(()=>validateFloodReference({type:'FeatureCollection',features:[]}));
});
test('cancelled catchment requests never start a bundled fallback',async()=>{
  const controller=new AbortController();let fallback=false;
  await assert.rejects(loadFloodReference('floodWatches',controller.signal,{live:async()=>{controller.abort();throw new Error('Cancelled');},bundled:async()=>{fallback=true;}}),{name:'AbortError'});assert.equal(fallback,false);
});
