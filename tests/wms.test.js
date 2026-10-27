import test from 'node:test';
import assert from 'node:assert/strict';
import {registeredWmsConfig,selectWmsLayers,wmsMapRequest,wmsPrintMap,renderRegisteredWms} from '../js/wms.js';
import {setCanvasFactory} from '../js/utils.js';

// No real private item IDs, service URLs or credentials belong in fixtures.
const item={id:'private-fixture',url:'https://registered.example/capabilities?registration=kept'};
const definition={mapUrl:'https://registered.example/map?route=kept&existing=a%2Bb&VERSION=1.1.1',version:'1.3.0',
  customParameters:{vendor:'shared',priority:'global'},customLayerParameters:{priority:'layer'},
  layers:[{name:'IDR00010',title:'Radar Rain Rate | Australia | raster',style:'native-radar'},{name:'IDZ20006',title:'Severe Thunderstorm Warning',style:'native-warning'}],spatialReferences:[3857]};
const config=()=>registeredWmsConfig(item,structuredClone(definition),{mapUrl:'https://advertised.example/raw',customParameters:{sdkVendor:'kept'}});
const extent=[0,0,200,100];
const task='https://print.example/GPServer/Export%20Web%20Map%20Task';
const metadata={executionType:'esriExecutionTypeSynchronous',parameters:[{name:'Web_Map_as_JSON'},{name:'Format',choiceList:['PDF','PNG32']},{name:'Output_File',direction:'esriGPParameterDirectionOutput',dataType:'GPDataFile'}]};
let draws=[];
setCanvasFactory((width,height)=>({width,height,getContext:()=>({drawImage:(...args)=>draws.push(args),getImageData:()=>({data:new Uint8ClampedArray(4)})})}));
const image=(width=200,height=100)=>({width,height,close(){this.closed=true;}});

test('registered mapUrl wins over advertised capabilities and preserves each parameter family',()=>{
  const c=config(),original=structuredClone(c),selected=selectWmsLayers(c,['IDR00010']);
  const url=new URL(wmsMapRequest(c,selected,extent,200,100));
  assert.equal(url.origin,'https://registered.example');assert.equal(url.pathname,'/map');
  for(const [key,value] of Object.entries({route:'kept',existing:'a+b',sdkVendor:'kept',vendor:'shared',priority:'layer',version:'1.3.0',layers:'IDR00010',styles:'native-radar',crs:'EPSG:3857',format:'image/png',transparent:'TRUE'}))assert.equal(url.searchParams.get(key),value,key);
  assert.equal([...url.searchParams.keys()].filter(key=>key.toLowerCase()==='version').length,1);
  assert.deepEqual(c,original);
});
test('separate items retain separate map routes even when their visible gateway matches',()=>{
  const a=config(),b=registeredWmsConfig({...item,id:'other'}, {...definition,mapUrl:'https://registered.example/radar?different=kept'});
  assert.notEqual(a.mapUrl,b.mapUrl);assert.equal(b.itemId,'other');
});
test('native styles are reordered with selected layer names rather than reset to defaults',()=>{
  const c=registeredWmsConfig(item,{...definition,visibleLayers:['IDR00010','IDZ20006'],customLayerParameters:{STYLES:'rain-style,warning-style'}});
  const selected=selectWmsLayers(c,['IDZ20006','IDR00010']);
  assert.equal(new URL(wmsMapRequest(c,selected,extent,200,100)).searchParams.get('styles'),'warning-style,rain-style');
  assert.deepEqual(wmsPrintMap(c,selected,extent,200,100).webMap.operationalLayers[0].styles,['warning-style','rain-style']);
});
test('older WMS versions and Web Mercator aliases use SRS without contradictory CRS fields',()=>{
  const c=registeredWmsConfig(item,{...definition,version:'1.1.1',spatialReferences:[900913],mapUrl:definition.mapUrl+'&CRS=old&SRS=old'});
  const url=new URL(wmsMapRequest(c,selectWmsLayers(c,['IDR00010']),extent,200,100));
  assert.equal(url.searchParams.get('srs'),'EPSG:900913');assert.equal([...url.searchParams.keys()].some(k=>k.toLowerCase()==='crs'),false);
});
test('known catalogues reject absent native layers instead of producing a partial warning image',()=>{
  assert.throws(()=>selectWmsLayers(config(),['IDZ20006','missing']),/required native WMS sublayer/);
  assert.throws(()=>registeredWmsConfig(item,{mapUrl:'http://insecure.example/wms'}),/HTTPS/);
});
test('print specification is a transparent map-only overlay and crops expanded extents exactly',()=>{
  const c=config(),{webMap,crop}=wmsPrintMap(c,selectWmsLayers(c,['IDR00010']),[0,0,100,100],200,100);
  assert.deepEqual(webMap.exportOptions.outputSize,[200,100]);assert.deepEqual(webMap.mapOptions.background.color,[0,0,0,0]);
  assert.deepEqual(webMap.baseMap.baseMapLayers,[]);assert.deepEqual(crop,[50,0,100,100]);
  assert.deepEqual(webMap.mapOptions.extent,{xmin:-50,ymin:0,xmax:150,ymax:100,spatialReference:{wkid:3857}});
  const layer=webMap.operationalLayers[0];assert.equal(layer.itemId,item.id);assert.equal(layer.transparentBackground,true);
  assert.equal(layer.customParameters.vendor,'shared');assert.equal(new URL(layer.url).searchParams.get('route'),'kept');
  assert.equal(new URL(layer.url).searchParams.get('version'),layer.version);assert.equal(new URL(layer.url).searchParams.get('transparent'),'TRUE');
});
test('readable direct images do not invoke a print service and requests use SDK credentials',async()=>{
  const calls=[],source=image();
  const result=await renderRegisteredWms({request:async(url,options)=>{calls.push({url,options});return {data:source};},printTask:task,config:config(),names:['IDR00010'],extent,width:200,height:100});
  assert.equal(result.route,'direct');assert.equal(result.image.width,200);assert.equal(calls.length,1);assert.equal(calls[0].options.authMode,'no-prompt');
  assert.equal(calls[0].options.headers,undefined);assert.equal(source.closed,true);
});
test('CORS failure uses only the portal-configured print task and retrieves its PNG',async()=>{
  const calls=[],source=image();draws=[];
  const request=async(url,options)=>{
    calls.push({url,options});
    if(url.startsWith('https://registered.example'))throw new TypeError('Failed to fetch');
    if(url===task)return {data:metadata};
    if(url===task+'/execute')return {data:{results:[{dataType:'GPDataFile',value:{url:'https://print.example/output.png'}}]}};
    if(url==='https://print.example/output.png')return {data:source};
    throw new Error('Unexpected request');
  };
  const result=await renderRegisteredWms({request,printTask:task,config:config(),names:['IDR00010'],extent,width:200,height:100});
  assert.equal(result.route,'print');assert.equal(calls.length,4);
  const executed=calls[2];assert.equal(executed.options.method,'post');assert.equal(executed.options.query.Layout_Template,'MAP_ONLY');assert.equal(executed.options.query.Format,'PNG32');
  const layer=JSON.parse(executed.options.query.Web_Map_as_JSON).operationalLayers[0];assert.equal(layer.itemId,item.id);assert.deepEqual(layer.visibleLayers,['IDR00010']);assert.deepEqual(layer.styles,['native-radar']);
  assert.equal(source.closed,true);assert.equal(calls.some(call=>call.url.includes('/sharing/proxy')),false);
});
test('print errors or failed-layer warnings cannot become a successful blank weather image',async()=>{
  for(const payload of [{error:{code:403,message:'secret request URL'}},{messages:[{type:'esriJobMessageTypeWarning',description:'Failed to create layer secret request URL'}],results:[{value:{url:'https://print.example/blank.png'}}]}]){
    const request=async(url)=>{if(url===task)return {data:metadata};return {data:payload};};
    await assert.rejects(renderRegisteredWms({request,printTask:task,config:config(),names:['IDR00010'],extent,width:200,height:100,preferPrint:true}),error=>/print service could not render/.test(error.message)&&!error.message.includes('secret'));
  }
});
test('absence of an organisation print service never switches to an arbitrary public renderer',async()=>{
  let calls=0;const request=async()=>{calls++;throw new Error('CORS');};
  await assert.rejects(renderRegisteredWms({request,config:config(),names:['IDR00010'],extent,width:200,height:100}),/no print service is configured/);assert.equal(calls,1);
});
test('cancellation stops direct rendering before any fallback request',async()=>{
  const controller=new AbortController();let calls=0;
  const request=async()=>{calls++;controller.abort();throw new DOMException('Cancelled','AbortError');};
  await assert.rejects(renderRegisteredWms({request,printTask:task,config:config(),names:['IDR00010'],extent,width:200,height:100,signal:controller.signal}),{name:'AbortError'});assert.equal(calls,1);
});
test('asynchronous print jobs use declared output names and preserve task URL parameters',async()=>{
  const urls=[],printTask=task+'?route=kept';
  const request=async(url)=>{
    urls.push(url);const path=new URL(url).pathname;
    if(path.endsWith('/output.png'))return {data:image()};
    assert.equal(new URL(url).searchParams.get('route'),'kept');
    if(path.endsWith('/submitJob'))return {data:{jobId:'fixture_job',jobStatus:'esriJobSucceeded'}};
    if(path.endsWith('/results/Output_File'))return {data:{value:{url:'https://print.example/output.png'}}};
    return {data:{...metadata,executionType:'esriExecutionTypeAsynchronous'}};
  };
  const result=await renderRegisteredWms({request,printTask,config:config(),names:['IDR00010'],extent,width:200,height:100,preferPrint:true});
  assert.equal(result.route,'print');assert.equal(urls.length,4);assert.equal(urls.some(url=>url.includes('/sharing/proxy')),false);
});
test('cancelling an asynchronous print cancels its server job without reopening sign-in',async()=>{
  const controller=new AbortController(),calls=[];
  const request=async(url,options)=>{
    calls.push({url,options});
    if(url.endsWith('/submitJob')){controller.abort();return {data:{jobId:'pending_fixture',jobStatus:'esriJobExecuting'}};}
    if(url.endsWith('/cancel'))return {data:{jobStatus:'esriJobCancelled'}};
    return {data:{...metadata,executionType:'esriExecutionTypeAsynchronous'}};
  };
  await assert.rejects(renderRegisteredWms({request,printTask:task,config:config(),names:['IDR00010'],extent,width:200,height:100,preferPrint:true,signal:controller.signal}),{name:'AbortError'});
  assert.equal(calls.length,3);assert.ok(calls[2].url.endsWith('/jobs/pending_fixture/cancel'));assert.equal(calls[2].options.authMode,'no-prompt');assert.equal(calls[2].options.signal,undefined);
});
test('overlapping warning and tracking requests keep their own names and styles',async()=>{
  const calls=[];let release;const first=new Promise(r=>release=r);
  const c=registeredWmsConfig(item,{...definition,layers:[{name:'IDZ20006',style:'warning-style'},{name:'IDZ20007',style:'cell-style'},{name:'IDZ20007_track',style:'track-style'}]});
  const request=async(url)=>{calls.push(new URL(url));if(calls.length===1)await first;return {data:image()};};
  const warning=renderRegisteredWms({request,config:c,names:['IDZ20006'],extent,width:200,height:100});
  const tracking=renderRegisteredWms({request,config:c,names:['IDZ20007_track','IDZ20007'],extent,width:200,height:100});
  await tracking;release();await warning;
  assert.equal(calls[0].searchParams.get('layers'),'IDZ20006');assert.equal(calls[0].searchParams.get('styles'),'warning-style');
  assert.equal(calls[1].searchParams.get('layers'),'IDZ20007_track,IDZ20007');assert.equal(calls[1].searchParams.get('styles'),'track-style,cell-style');
});
