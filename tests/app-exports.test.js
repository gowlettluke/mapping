import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {setCanvasFactory} from '../js/utils.js';
import {projectedBounds} from '../js/geometry.js';

function fakeCanvas(width=400,height=300){
  // District fixtures below are axis-aligned rectangles. rasterIntersects
  // crops each rectangle to its pixel bounds before reading this opaque fill.
  const ctx={measureText:value=>({width:String(value).length*7}),createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)}),getImageData:(x,y,w,h)=>({data:new Uint8ClampedArray(w*h*4).fill(255)})};
  for(const method of ['save','restore','drawImage','fillRect','strokeRect','beginPath','closePath','rect','clip','translate','moveTo','lineTo','fill','stroke','strokeText','fillText','putImageData','arc','setLineDash'])ctx[method]=()=>{};
  return {width,height,getContext:()=>ctx,toDataURL:()=> 'data:image/png;base64,c3ludGhldGlj'};
}
function element(){return {value:'',checked:false,hidden:false,disabled:false,textContent:'',style:{},dataset:{},listeners:new Map(),classList:{add(){},remove(){},toggle(){}},setAttribute(){},addEventListener(name,fn){this.listeners.set(name,fn);},append(){},replaceChildren(){},focus(){}};}

test('actual application exports and selected-warning analysis',async t=>{
  const previous=Object.fromEntries(['document','localStorage','fetch','createImageBitmap','jspdf','setTimeout'].map(name=>[name,globalThis[name]])),html=await readFile(new URL('../index.html',import.meta.url),'utf8'),elements=new Map([...html.matchAll(/\bid="([^"]+)"/g)].map(match=>[match[1],element()])),downloads=[],documents=[],requests=[];
  const profiles=['thunderstorm','severeWeather','flooding'].map(profile=>({...element(),dataset:{profile}}));
  globalThis.document={body:{dataset:{},classList:{toggle(){}}},documentElement:{dataset:{}},getElementById:id=>{assert.ok(elements.has(id),'Missing UI element '+id);return elements.get(id);},querySelectorAll:()=>profiles,createElement:tag=>tag==='canvas'?fakeCanvas():{...element(),click(){if(this.download)downloads.push(this.download);}}};
  globalThis.localStorage={getItem:()=>null,setItem(){}};
  const immediateFetch=async url=>{requests.push(String(url));return new Response('synthetic image');};globalThis.fetch=immediateFetch;
  globalThis.createImageBitmap=async()=>({width:800,height:400,close(){}});
  globalThis.setTimeout=(fn,delay,...args)=>{const timer=previous.setTimeout(fn,delay,...args);if(delay>=30000)timer.unref();return timer;};
  class PDF {constructor(){this.texts=[];documents.push(this);}addPage(){}setFont(){}setFontSize(){}setTextColor(){}setDrawColor(){}line(){}rect(){}text(value){this.texts.push(String(value));}link(){}splitTextToSize(value){return [value];}addImage(){}output(){return new Blob(['synthetic PDF']);}}
  globalThis.jspdf={jsPDF:PDF};setCanvasFactory(fakeCanvas);
  t.after(()=>{for(const [name,value]of Object.entries(previous)){if(value===undefined)delete globalThis[name];else globalThis[name]=value;}});
  const appUrl=new URL('../app.js',import.meta.url),source=(await readFile(appUrl,'utf8')).replace(/(from\s+|import\()(['"])(\.\.?\/[^'"]+)\2/g,(_,prefix,quote,specifier)=>prefix+quote+new URL(specifier,appUrl).href+quote),app=await import('data:text/javascript;base64,'+Buffer.from(source+'\nexport {state,makePdf,updateButtons,invalidate,extras,connection};').toString('base64'));
  function reset(){
    downloads.length=documents.length=requests.length=0;globalThis.fetch=immediateFetch;const now=new Date();
    Object.assign(app.state,{profile:'flooding',ready:true,pdf:null,pdfKind:null,cameraPhase:'ready',gaugeStatus:'ready',cameraNotices:[],flowDiagrams:[],floodScanned:true,
      snapshot:{active:true,profile:'flooding',profileLabel:'Flooding',generated:now,scopeLabel:'Selected BoM warning',extent:projectedBounds([150,-28,154,-24]),background:fakeCanvas(),warning:fakeCanvas(),context:{locator:{features:[]}}},gaugeMap:fakeCanvas(),
      cameras:[{id:'camera-1',name:'Selected camera',source:'test',sourceLabel:'Synthetic camera',point:[151,-26],url:'https://cameras.example/selected.jpg',capturedAt:null}],
      gauges:[{id:'gauge-1',label:'G1',name:'Selected gauge',stationId:'000123',point:[151,-26],height:3.15,category:'minor',reportedCategory:'Minor',trend:'Rising',observedAt:now,updatedAt:now,graphUrl:'https://graphs.example/selected.png',sourceUrl:'https://graphs.example/station'}]});app.updateButtons();
  }
  await t.test('each button fetches only its own images and produces a distinctly named document',async()=>{
    reset();await app.makePdf('cameras');assert.deepEqual(requests,['https://cameras.example/selected.jpg']);assert.match(downloads[0],/^camera-situation-report-.*\.pdf$/);assert.match(documents[0].texts.join(' '),/Camera index/);assert.doesNotMatch(documents[0].texts.join(' '),/Gauge Index|Gauge Graphs/);
    requests.length=0;await app.makePdf('gauges');assert.deepEqual(requests,['https://graphs.example/selected.png']);assert.match(downloads[1],/^river-gauge-report-.*\.pdf$/);assert.match(documents[1].texts.join(' '),/River Gauge Index/);assert.doesNotMatch(documents[1].texts.join(' '),/Camera Index|Camera Photographs/);assert.equal(new Set(downloads).size,2);
  });
  await t.test('unavailable or pending gauges do not block camera exports',async()=>{
    for(const gaugeStatus of ['loading','error']){reset();app.state.gaugeStatus=gaugeStatus;app.state.gauges=[];app.updateButtons();assert.equal(elements.get('cameraPdf').disabled,false);assert.equal(elements.get('gaugePdf').disabled,true);await app.makePdf('cameras');assert.equal(downloads.length,1);assert.equal(requests.some(url=>url.includes('graphs.example')),false);}
  });
  await t.test('unavailable or pending cameras do not block gauge exports',async()=>{
    for(const cameraPhase of ['loading','error']){reset();app.state.cameraPhase=cameraPhase;app.state.cameras=[];app.updateButtons();assert.equal(elements.get('gaugePdf').disabled,false);assert.equal(elements.get('cameraPdf').disabled,true);await app.makePdf('gauges');assert.equal(downloads.length,1);assert.equal(requests.some(url=>url.includes('cameras.example')),false);}
  });
  await t.test('missing graphs retain gauge readings and never trigger a camera fallback',async()=>{
    reset();app.state.gauges[0].graphUrl='';await app.makePdf('gauges');assert.equal(downloads.length,1);assert.equal(requests.length,0);assert.match(documents[0].texts.join(' '),/3\.15/);assert.match(documents[0].texts.join(' '),/Graph link not supplied|Graph unavailable/);
  });
  await t.test('a camera export with no eligible photos cannot turn into a gauge document',async()=>{
    reset();app.state.cameras[0].capturedAt=new Date(Date.now()-2*3600000);await app.makePdf('cameras');assert.equal(downloads.length,0);assert.equal(documents.length,0);assert.match(elements.get('cameraStatus').textContent,/No camera PDF generated/);assert.equal(requests.length,0);
  });
  await t.test('changing the selection cancels either pending PDF without downloading old results',async()=>{
    for(const kind of ['cameras','gauges']){reset();let release;globalThis.fetch=()=>new Promise(resolve=>{release=resolve;});const pending=app.makePdf(kind);assert.equal(app.state.pdfKind,kind);assert.equal(elements.get(kind==='gauges'?'cancelGaugePdf':'cancelPdf').hidden,false);app.invalidate();release(new Response('synthetic image'));await pending;assert.equal(downloads.length,0);assert.equal(app.state.pdf,null);assert.equal(app.state.pdfKind,null);assert.equal(elements.get('pdfProgress').hidden,true);assert.equal(elements.get('gaugePdfProgress').hidden,true);}
  });
  await t.test('camera exports remain available on both existing storm/weather profiles',async()=>{
    for(const profile of ['thunderstorm','severeWeather']){reset();app.state.profile=app.state.snapshot.profile=profile;app.updateButtons();assert.equal(elements.get('gaugePanel').hidden,true);assert.equal(elements.get('gaugePdf').disabled,true);await app.makePdf('cameras');assert.equal(downloads.length,1);assert.match(downloads[0],/^camera-situation-report-/);}
  });
  const polygon=(w,s,e,n)=>({type:'Polygon',coordinates:[[[w,s],[e,s],[e,n],[w,n],[w,s]]]}),district=(name,w,e)=>({type:'Feature',properties:{PROP_DD:name},geometry:polygon(w,-26.6,e,-25.8)}),districts={type:'FeatureCollection',features:[district('Western district',150.4,150.9),district('Western district',150.6,150.8),district('Eastern district',152.8,153.3),district('Neighbouring district',151.6,152.2)]};
  function analysis(){reset();const snapshot=app.state.snapshot,width=80,height=80;snapshot.scopeMasks=[{width,height,extent:snapshot.extent,visible:Uint8Array.from({length:width*height},(_,i)=>{const x=i%width,y=Math.floor(i/width);return y>=25&&y<55&&(x>=6&&x<20||x>=55&&x<68)?1:0;})}];app.connection.cameraCollections=async()=>[];globalThis.fetch=async()=>new Response(JSON.stringify({type:'FeatureCollection',features:[]}),{headers:{'content-type':'application/json'}});return snapshot;}
  await t.test('district lookup includes every selected flood catchment and excludes visible neighbours on both flood products and weather profiles',async()=>{
    for(const [profile,kind]of [['flooding','Flood Warning'],['flooding','Flood Watch'],['thunderstorm','Severe Thunderstorm'],['severeWeather','Severe Weather']]){
      const snapshot=analysis(),controller=new AbortController();snapshot.profile=app.state.profile=profile;snapshot.floodDisplay={kind};let calls=0;app.connection.districts=async signal=>{assert.equal(signal,controller.signal);calls++;return districts;};await app.extras(snapshot,app.state.version,controller.signal);
      assert.equal(calls,1);assert.equal(elements.get('affectedDistricts').textContent,'Western district · Eastern district');assert.equal(app.state.cameraPhase,'ready');
    }
  });
  await t.test('district source failure and no intersections remain distinct without blocking other results',async()=>{
    for(const fail of [true,false]){const snapshot=analysis();app.connection.districts=async()=>{if(fail)throw new Error('District access denied');return {type:'FeatureCollection',features:[]};};await app.extras(snapshot,app.state.version,new AbortController().signal);assert.equal(elements.get('affectedDistricts').textContent,fail?'District source unavailable: District access denied':'No intersecting districts detected.');assert.equal(app.state.cameraPhase,'ready');assert.equal(app.state.gaugeStatus,'ready');assert.equal(app.state.snapshot,snapshot);}
  });
  await t.test('a changed flood selection cannot receive stale district results',async()=>{
    const snapshot=analysis(),controller=new AbortController();app.state.extra=controller;let release;app.connection.districts=()=>new Promise(resolve=>{release=resolve;});const pending=app.extras(snapshot,app.state.version,controller.signal);assert.match(elements.get('affectedDistricts').textContent,/Checking disaster districts/);app.invalidate();assert.equal(controller.signal.aborted,true);release(districts);await pending;assert.equal(elements.get('affectedDistricts').textContent,'Generate maps to analyse.');assert.equal(app.state.snapshot,null);
  });
  await t.test('a statewide map with no active warning does not invent affected districts',async()=>{
    const snapshot=analysis();snapshot.active=false;app.connection.districts=async()=>{throw new Error('No district query expected');};await app.extras(snapshot,app.state.version,new AbortController().signal);assert.equal(elements.get('affectedDistricts').textContent,'No active warning.');
  });
  await t.test('both entry pages offer separate exports without the combined-report checkboxes',async()=>{
    for(const entry of ['index.html','demo.html']){const body=await readFile(new URL('../'+entry,import.meta.url),'utf8');assert.equal([...body.matchAll(/id="cameraPdf"/g)].length,1);assert.equal([...body.matchAll(/id="gaugePdf"/g)].length,1);assert.doesNotMatch(body,/id="includeCameras"|id="includeGauges"|Generate Flood Report PDF/);}
  });
});
