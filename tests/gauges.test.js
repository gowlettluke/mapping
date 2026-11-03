import test from 'node:test';
import assert from 'node:assert/strict';
import {normaliseGauges,selectGauges,gaugeCategory,gaugeGraphLink,gaugeTiming,retrieveGaugeGraphs,discoverGauges} from '../js/gauges.js';
import {ArcGISConnection} from '../js/arcgis.js';
import {floodPdfPlan,floodReportPdf} from '../js/flood-pdf.js';
import {setCanvasFactory} from '../js/utils.js';
import {projectedBounds,pixelPoint} from '../js/geometry.js';
import {CONFIG} from '../config.js';

const now=Date.parse('2026-11-03T14:00:00Z'),feature=(properties={},point=[153,-27])=>({type:'Feature',id:1,properties,geometry:{type:'Point',coordinates:point}}),collection=features=>({type:'FeatureCollection',features});
const sample={station_id:'0538001',station_name:'Barcoo River at Retreat',river_height:3.15,flood_classification:'Minor',trend:'Steady',observation_time:now-30*60000,last_update:now-5*60000};
const normalise=(properties=sample,extra={})=>normaliseGauges({collection:collection([feature(properties)]),...extra})[0];
test('the confirmed gauge item loads automatically by ID without a title search',async()=>{
  const connection=new ArcGISConnection(),seen=[];connection.portal={url:'https://organisation.maps.arcgis.com'};
  connection.search=async()=>{throw new Error('The exact gauge item must not depend on title search');};
  connection.sdk={PortalItem:class{constructor(options){seen.push(options);this.id=options.id;this.type='Feature Service';}async load(){this.loaded=true;}}};
  const item=await connection.featureItem(CONFIG.arcgis.gauges);assert.equal(item.id,'1d05b9f286334868a2dd70079d963810');assert.equal(item.loaded,true);assert.equal(seen[0].portal,connection.portal);assert.equal((await connection.featureItem(CONFIG.arcgis.gauges)),item);assert.equal(seen.length,1);
});
test('manual gauge source choices override the configured default and replace its cached item',async()=>{
  const connection=new ArcGISConnection();connection.sdk={PortalItem:class{constructor({id}){this.id=id;this.type='Feature Service';}async load(){}}};
  assert.equal((await connection.featureItem(CONFIG.arcgis.gauges)).id,CONFIG.arcgis.gauges.itemId);
  const other='abcdef0123456789abcdef0123456789';connection.setFeatureSelection(CONFIG.arcgis.gauges,other);assert.equal((await connection.featureItem(CONFIG.arcgis.gauges)).id,other);
});
test('an unavailable configured gauge item retains the source control and sign-out clears session overrides',async()=>{
  const connection=new ArcGISConnection();let fail=true;connection.sdk={identity:{destroyCredentials(){}},PortalItem:class{constructor({id}){this.id=id;this.type='Feature Service';}async load(){if(fail)throw new Error('Not shared with this account');}}};
  await assert.rejects(connection.featureItem(CONFIG.arcgis.gauges));assert.ok('gauges' in connection.featureChoices);connection.featureSelections.set('gauges','abcdef0123456789abcdef0123456789');connection.disconnect();fail=false;
  assert.equal((await connection.featureItem(CONFIG.arcgis.gauges)).id,CONFIG.arcgis.gauges.itemId);
});
test('the configured gauge feed retries its first startup failure without manual ID entry',async()=>{
  const connection=new ArcGISConnection(),ids=[],requests=[];connection.portal={url:'https://organisation.maps.arcgis.com'};
  connection.search=async()=>{throw new Error('No title search or user selection is needed');};
  connection.sdk={PortalItem:class{constructor({id}){ids.push(id);this.id=id;this.type='Feature Service';this.url='https://services.example/FeatureServer';}async load(){if(ids.length===1)throw new Error('Temporary initial-session failure');}},esriRequest:async(url)=>{requests.push(url);return {data:url.includes('/query')?collection([feature(sample)]):{geometryType:'esriGeometryPoint',fields:[{name:'station_name'}]}};}};
  const result=await connection.gaugeCollection();assert.equal(result.collection.features.length,1);assert.deepEqual(ids,[CONFIG.arcgis.gauges.itemId,CONFIG.arcgis.gauges.itemId]);assert.equal(connection.featureSelections.get('gauges'),CONFIG.arcgis.gauges.itemId);assert.equal(requests.length,2);
});
test('a saved gauge choice is restored per organisation and invalid saved IDs cannot replace the default',async()=>{
  const previous=globalThis.localStorage,storage=new Map(),id='abcdef0123456789abcdef0123456789',portal={url:'https://organisation.maps.arcgis.com'};
  globalThis.localStorage={getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value)};
  const make=url=>{const connection=new ArcGISConnection();connection.portal={url};connection.sdk={PortalItem:class{constructor({id}){this.id=id;this.type='Feature Service';}async load(){}}};return connection;};
  try{const first=make(portal.url);first.setFeatureSelection(CONFIG.arcgis.gauges,id);const restored=make(portal.url);assert.equal((await restored.featureItem(CONFIG.arcgis.gauges)).id,id);assert.equal((await make('https://other.maps.arcgis.com').featureItem(CONFIG.arcgis.gauges)).id,CONFIG.arcgis.gauges.itemId);
    storage.set('qldMapping.gaugeItem.'+portal.url,'not-an-item-id');assert.equal((await make(portal.url).featureItem(CONFIG.arcgis.gauges)).id,CONFIG.arcgis.gauges.itemId);
  }finally{if(previous===undefined)delete globalThis.localStorage;else globalThis.localStorage=previous;}
});
test('cancelling a failed gauge startup prevents the automatic retry',async()=>{
  const connection=new ArcGISConnection(),controller=new AbortController();let calls=0;connection.readGaugeCollection=async()=>{calls++;controller.abort();throw new Error('Stopped');};
  await assert.rejects(connection.gaugeCollection(controller.signal),{name:'AbortError'});assert.equal(calls,1);
});
test('gauge records preserve station IDs, source classification and separate observation/update times',()=>{
  const gauge=normalise();assert.equal(gauge.stationId,'0538001');assert.equal(gauge.height,3.15);assert.equal(gauge.category,'minor');assert.equal(gauge.trend,'Steady');assert.equal(+gauge.observedAt,now-30*60000);assert.equal(+gauge.updatedAt,now-5*60000);assert.equal(gauge.graphUrl,'');
  const zero=normalise({...sample,river_height:0});assert.equal(zero.height,0);
});
test('QFD table fields supply station ID, classification, tendency, observation and FME update times',()=>{
  const gauge=normalise({StationNum:'058234',Name:'Rocky Creek at Rocky Creek',Height:-.05,Class:'No Classification',Tendency:'Steady','Observation Time':now-30*60000,FMETimestamp:now-5*60000,URLChart:'https://graphs.example/actual-chart.png',URLPage:'https://graphs.example/station-page.shtml',ClassRank:-999});
  assert.equal(gauge.stationId,'058234');assert.equal(gauge.name,'Rocky Creek at Rocky Creek');assert.equal(gauge.height,-.05);assert.equal(gauge.reportedCategory,'No Classification');assert.equal(gauge.category,'unknown');assert.equal(gauge.trend,'Steady');assert.equal(+gauge.observedAt,now-30*60000);assert.equal(+gauge.updatedAt,now-5*60000);
  assert.equal(gauge.graphUrl,'https://graphs.example/actual-chart.png');assert.equal(gauge.sourceUrl,'https://graphs.example/station-page.shtml');
  for(const classification of ['Minor','Moderate','Major'])assert.equal(normalise({StationNum:538001,Name:'Source station',Height:3.15,Class:classification}).category,classification.toLowerCase());
});
test('QFD URLChart takes precedence over a popup page link and URLPage is never guessed to be an image',()=>{
  const popupInfo={mediaInfos:[{type:'image',value:{sourceURL:'{URLPage}'}}]},gauge=normalise({StationNum:538001,Name:'Source station',URLChart:'https://graphs.example/chart.png',URLPage:'https://graphs.example/page.shtml'}, {popupInfo});
  assert.equal(gauge.graphUrl,'https://graphs.example/chart.png');assert.equal(gauge.sourceUrl,'https://graphs.example/page.shtml');
  assert.equal(gaugeGraphLink({StationNum:538001,URLPage:'https://graphs.example/page.shtml'}),'');
  assert.equal(normalise({StationNum:538001,Name:'Source station',Height:8,ClassRank:3}).category,'unknown');
});
test('field aliases and coded domains supply source labels without inferring severity from height',()=>{
  const gauge=normalise({s:'538001',n:'Example station',h:'3.15 m',c:2,o:now,u:now},{fields:[{name:'s',alias:'Station ID'},{name:'n',alias:'Station name'},{name:'h',alias:'River height (m)'},{name:'c',alias:'Flood classification',domain:{codedValues:[{code:2,name:'Moderate'}]}},{name:'o',alias:'Observation time'},{name:'u',alias:'Last update'}]});
  assert.equal(gauge.stationId,'538001');assert.equal(gauge.name,'Example station');assert.equal(gauge.category,'moderate');assert.equal(gauge.height,3.15);assert.equal(+gauge.observedAt,now);
  for(const value of [null,-9999,'N/A','Not Available']){const unknown=normalise({...sample,river_height:value,flood_classification:null});assert.equal(unknown.height,null);assert.equal(unknown.category,'unknown');}
  assert.equal(normalise({...sample,river_height:50,flood_classification:null}).category,'unknown');
  for(const value of ['Below minor','Below Flood Level','No flooding','Not in flood'])assert.equal(gaugeCategory(value),'below');
});
test('direct, media and HTML graph templates resolve source fields without guessed graph paths or Arcade execution',()=>{
  assert.equal(gaugeGraphLink({Graph_URL:'https://graphs.example/actual.png'}),'https://graphs.example/actual.png');
  assert.equal(gaugeGraphLink({Graph_URL:'http://graphs.example/actual.png'}),'https://graphs.example/actual.png');
  const popup={mediaInfos:[{type:'image',value:{sourceURL:'https://graphs.example/{Station_ID}.png?period=week&amp;x={Mode}'}}]};
  assert.equal(gaugeGraphLink({Station_ID:'0538001',Mode:'a/b'},popup),'https://graphs.example/0538001.png?period=week&x=a%2Fb');
  assert.equal(gaugeGraphLink({url:'https://graphs.example/exact.png'},{mediaInfos:[{type:'image',value:{sourceURL:'{url}'}}]}),'https://graphs.example/exact.png');
  assert.equal(gaugeGraphLink({id:5},{description:'<p>Graph</p><img src="https://graphs.example/{id}.png">'}),'https://graphs.example/5.png');
  assert.equal(gaugeGraphLink({station_id:'5'},{mediaInfos:[{type:'image',value:{sourceURL:'https://graphs.example/{missing}.png'}}]}),'');
  assert.equal(gaugeGraphLink({station_id:'5'},{description:'{expression/expr1}',expressionInfos:[{name:'expr1',expression:'do not execute'}]}),'');
  assert.equal(gaugeGraphLink({Graph_URL:'javascript:alert(1)'}),'');
});
test('selected flood masks exclude neighbours, holes and outside stations while collocated stations remain distinct',()=>{
  const extent=projectedBounds([150,-28,154,-24]),visible=new Uint8Array(100);visible[22]=1;visible[23]=1;const mask={extent,width:10,height:10,visible};
  const at=(id,name,x,y,observed=now)=>normaliseGauges({collection:collection([feature({...sample,station_id:id,station_name:name,observation_time:observed},pixelPoint(x+.5,y+.5,extent,10,10))])})[0];
  const result=selectGauges([at('a','Alpha',2,2),at('b','Bravo',2,2),at('a','Alpha old',2,2,now-60000),at('c','Charlie neighbour',7,7),at('d','Hole',3,3),at('e','Outside',0,0)],[mask]);
  assert.deepEqual(result.map(g=>[g.stationId,g.label]),[['a','G1'],['b','G2']]);assert.equal(result[0].name,'Alpha');
});
test('old observations, stale feed updates and unknown/future times are labelled separately, never dropped',()=>{
  assert.deepEqual(gaugeTiming(normalise(),now),[]);
  const notes=gaugeTiming(normalise({...sample,observation_time:now-3*3600000,last_update:now-46*60000}),now);assert.ok(notes[0].startsWith('Observation over 2'));assert.ok(notes[1].startsWith('Feed update over 45'));
  assert.deepEqual(gaugeTiming(normalise({...sample,observation_time:'3/11/26 23:00',last_update:null}),now),['Observation time unverified','Feed update time unverified']);
  assert.equal(gaugeTiming(normalise({...sample,observation_time:now+10*60000}),now)[0],'Observation time unverified');
});
test('incomplete/unsupported gauge collections are errors and cancellation cannot become an empty match',async()=>{
  assert.throws(()=>normaliseGauges({collection:{...collection([]),exceededTransferLimit:true}}),/incomplete/);
  assert.throws(()=>normaliseGauges({collection:collection([feature({nonsense:2})])}),/no recognised/);
  const controller=new AbortController();controller.abort();let called=false;await assert.rejects(discoverGauges({gaugeCollection:async()=>{called=true;}},[],controller.signal),{name:'AbortError'});assert.equal(called,false);
});
test('gauge discovery uses authenticated query/metadata and item popup aliases, without fetching graph images',async()=>{
  const connection=new ArcGISConnection(),calls=[];connection.featureItem=async spec=>{assert.equal(spec.key,'gauges');return {url:'https://services.example/FeatureServer?registration=kept',fetchData:async()=>({layers:[{id:0,popupInfo:{fieldInfos:[{fieldName:'n',label:'Station name'}],mediaInfos:[{type:'image',value:{sourceURL:'https://graphs.example/{station_id}.png'}}]}}]})};};
  connection.sdk={esriRequest:async(url,options)=>{calls.push({url,options});return url.includes('/query')?{data:collection([feature({n:'Station',station_id:'5'})])}:{data:{geometryType:'esriGeometryPoint',fields:[{name:'n',alias:'Original name'}]}};}};
  const result=await connection.gaugeCollection();assert.equal(result.fields[0].alias,'Station name');assert.equal(result.collection.features.length,1);assert.equal(calls.length,2);assert.ok(calls.every(call=>new URL(call.url).searchParams.get('registration')==='kept'));assert.equal(normaliseGauges(result)[0].graphUrl,'https://graphs.example/5.png');
  connection.sdk.esriRequest=async()=>{throw new Error('https://private.example?token=SECRET');};await assert.rejects(connection.gaugeCollection(),error=>!error.message.includes('SECRET')&&!error.message.includes('private.example'));
});
test('graph retrieval preserves missing/failed stations, defers requests and uses SDK credentials only for ArcGIS hosts',async()=>{
  const oldFetch=globalThis.fetch,oldBitmap=globalThis.createImageBitmap,calls=[],progress=[];
  globalThis.fetch=async url=>{calls.push(String(url));if(String(url).includes('bad'))return new Response('unavailable',{status:503});return new Response('synthetic image');};globalThis.createImageBitmap=async()=>({width:1000,height:350,close(){}});
  setCanvasFactory((width,height)=>({width,height,getContext:()=>({fillRect(){},drawImage(){}}),toDataURL:()=> 'data:image/png;base64,c3ludGhldGlj'}));
  try{const gauges=[{...normalise(),graphUrl:''},{...normalise(),graphUrl:'https://graphs.example/bad.png'},{...normalise(),graphUrl:'https://graphs.example/good.png'},{...normalise(),graphUrl:'https://utility.arcgis.com/graph.png'}];let sdk=0;
    const result=await retrieveGaugeGraphs(gauges,{connection:{sdk:{esriRequest:async(url,options)=>{sdk++;assert.equal(options.authMode,'no-prompt');return {data:new Blob(['synthetic'])};}}},onProgress:n=>progress.push(n)});
    assert.equal(result.entries.length,4);assert.equal(result.unavailable,2);assert.equal(sdk,1);assert.equal(calls.length,2);assert.equal(progress.at(-1),4);assert.equal(result.entries[2].graph.format,'PNG');
    const controller=new AbortController();controller.abort();await assert.rejects(retrieveGaugeGraphs(gauges,{signal:controller.signal}),{name:'AbortError'});
  }finally{globalThis.fetch=oldFetch;globalThis.createImageBitmap=oldBitmap;}
});
test('combined flood PDF page targets handle gauges only, cameras only and multi-page reports',()=>{
  for(const [gauges,photos]of [[1,0],[0,1],[11,25],[101,49]]){const plan=floodPdfPlan(gauges,photos),targets=[];if(gauges){targets.push(plan.gaugeOverview,plan.gaugeSummary,plan.gaugeGraphs);assert.ok(plan.gaugeGraphs+Math.floor((gauges-1)/4)<=plan.total);}if(photos){targets.push(plan.cameraOverview,plan.cameraIndex,plan.cameraPhotos);assert.ok(plan.cameraPhotos+Math.floor((photos-1)/6)<=plan.total);}assert.ok(targets.every(target=>target>=1&&target<=plan.total));assert.equal(new Set(targets).size,targets.length);}
  assert.throws(()=>floodPdfPlan(0,0),/No gauges/);assert.equal(floodPdfPlan(1,0).total,3);assert.equal(floodPdfPlan(0,1).total,3);assert.equal(floodPdfPlan(11,25).total,13);
});
test('gauge-only PDF retains readings when graphs are missing and never embeds credential-bearing links',()=>{
  const texts=[],links=[];class PDF{addPage(){}setFont(){}setFontSize(){}setTextColor(){}setDrawColor(){}line(){}rect(){}text(value){texts.push(String(value));}link(x,y,w,h,target){links.push(target);}splitTextToSize(value){return [value];}addImage(){}}
  const gauge={...normalise(),label:'G1',sourceUrl:'https://graphs.example/source?token=SECRET'},snapshot={generated:new Date(now),scopeLabel:'Synthetic flood area'};
  const result=floodReportPdf({jsPDF:PDF,snapshot,gauges:[gauge],graphs:[],gaugeOverview:{data:'synthetic',width:100,height:100}});assert.ok(result);assert.ok(texts.some(text=>text.includes('3.15')));assert.ok(texts.some(text=>text.includes('Graph unavailable')));assert.equal(links.some(link=>link.url),false);assert.ok(links.every(link=>link.pageNumber>=1&&link.pageNumber<=3));
});
test('real BoM charts share four-panel pages with correct index targets and no overlapping image bounds',()=>{
  const pages=[],links=[],images=[];let page=0;class PDF{addPage(){page++;}setFont(){}setFontSize(){}setTextColor(){}setDrawColor(){}line(){}rect(){}text(value){pages.push({page,text:String(value)});}link(x,y,w,h,target){links.push({page,...target});}splitTextToSize(value){return [value];}addImage(data,type,x,y,width,height){images.push({page,x,y,width,height});}}
  const gauges=Array.from({length:7},(_,i)=>({...normalise({...sample,station_id:String(i),station_name:'Station '+i}),label:'G'+(i+1)})),graphs=gauges.map(gauge=>({gauge,graph:{data:'synthetic image',width:800,height:400,retrievedAt:new Date(now)}}));
  floodReportPdf({jsPDF:PDF,snapshot:{generated:new Date(now),scopeLabel:'Synthetic scope'},gauges,graphs,gaugeOverview:{data:'synthetic overview',width:100,height:100}});assert.equal(page+1,4);assert.equal(images.filter(image=>image.page===2).length,4);assert.equal(images.filter(image=>image.page===3).length,3);assert.ok(images.filter(image=>image.page>=2).every(image=>image.width>120&&image.width<132&&image.height>60&&image.height<66));assert.ok(links.some(link=>link.page===1&&link.pageNumber===4));assert.ok(links.every(link=>!link.pageNumber||link.pageNumber<=4));
  assert.equal(floodPdfPlan(7,0,{graphsPerPage:6}).gaugeGraphPages,2);assert.throws(()=>floodPdfPlan(2,0,{graphsPerPage:1}),/Unsupported/);
  for(const [i,a]of images.entries())for(const b of images.slice(i+1))if(a.page===b.page)assert.ok(a.x+a.width<=b.x||b.x+b.width<=a.x||a.y+a.height<=b.y||b.y+b.height<=a.y);
});
test('the compact gauge table paginates twenty rows and colours reported major, moderate and minor readings',()=>{
  const texts=[],links=[];let page=0,colour;class PDF{addPage(){page++;}setFont(){}setFontSize(){}setTextColor(...value){colour=value;}setDrawColor(){}line(){}rect(){}text(value){texts.push({page,text:String(value),colour});}link(x,y,w,h,target){links.push({page,...target});}splitTextToSize(value){return [value];}addImage(){}}
  const categories=['Major','Moderate','Minor','No Classification','Below minor'],gauges=Array.from({length:21},(_,i)=>({...normalise({...sample,station_id:String(i),station_name:'Station '+i,flood_classification:categories[i%5]}),label:'G'+(i+1)}));
  floodReportPdf({jsPDF:PDF,snapshot:{generated:new Date(now),scopeLabel:'Synthetic scope'},gauges,gaugeOverview:{data:'synthetic overview',width:100,height:100}});
  assert.equal(floodPdfPlan(21,0).gaugeSummaryPages,2);assert.equal(texts.filter(entry=>entry.page===1&&/^Station /.test(entry.text)).length,20);assert.equal(texts.filter(entry=>entry.page===2&&/^Station /.test(entry.text)).length,1);
  const table=texts.filter(entry=>[1,2].includes(entry.page));for(const header of ['Level (m)','Classification','Trend','Observed (AEST)'])assert.ok(table.some(entry=>entry.text===header));
  const row=name=>table.find(entry=>entry.text.startsWith(name+' ['));assert.deepEqual(row('Station 0').colour,[177,32,47]);assert.deepEqual(row('Station 1').colour,[148,111,0]);assert.deepEqual(row('Station 2').colour,[26,114,69]);assert.deepEqual(row('Station 3').colour,row('Station 4').colour);assert.ok(!table.some(entry=>/Feed updated:|Observation over/.test(entry.text)));assert.ok(links.some(link=>link.page===2&&link.pageNumber===9));
});
