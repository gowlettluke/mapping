import test from 'node:test';
import assert from 'node:assert/strict';
import {isBomGraphUrl,graphPrintMap,graphDimensions,renderGraphPrintImage} from '../js/graph-export.js';
import {retrieveGaugeGraphs} from '../js/gauges.js';
import {setCanvasFactory} from '../js/utils.js';

const url='https://www.bom.gov.au/fwo/IDQ65398/IDQ65398.036169.png',task='https://print.example/GPServer/Export%20Web%20Map%20Task';
const metadata={executionType:'esriExecutionTypeSynchronous',parameters:[{name:'Web_Map_as_JSON'},{name:'Format',choiceList:['PDF','PNG32']},{name:'Output_File',direction:'esriGPParameterDirectionOutput',dataType:'GPDataFile'}]};
function image(width=800,height=400,blank=false){const data=new Uint8ClampedArray(width*height*4).fill(255);if(!blank)for(let x=15;x<width-15;x++)for(const y of [15,height-15]){const i=(y*width+x)*4;data[i]=20;data[i+1]=60;data[i+2]=90;}return {width,height,data,close(){this.closed=true;}};}
function factory(width,height){const c={width,height,data:new Uint8ClampedArray(width*height*4).fill(255),toDataURL:()=> 'data:image/png;base64,c3ludGhldGlj'},ctx={drawImage:source=>{if(source.data)c.data.set(source.data);},getImageData:()=>({data:c.data}),fillRect(){}};c.getContext=()=>ctx;return c;}
setCanvasFactory(factory);
function service({blank=false}={}){const calls=[],source=image(800,400,blank),request=async(address,options)=>{calls.push({address,options});assert.equal(options.authMode,'no-prompt');if(address===task)return {data:metadata};if(address===task+'/execute')return {data:{results:[{dataType:'GPDataFile',value:{url:'https://print.example/output.png'}}]}};assert.equal(address,'https://print.example/output.png');return {data:source};};return {calls,source,request};}

test('the graph image fallback accepts only the confirmed public BoM PNG form',()=>{
  assert.equal(isBomGraphUrl(url),true);
  for(const other of ['https://www.bom.gov.au/fwo/IDQ65398/IDQ65398.036169.plt.shtml','https://private.example/graph.png','https://www.bom.gov.au.evil.example/fwo/IDQ65398/IDQ65398.036169.png',url+'?token=secret',url+'?url=http://internal.example',url+'#fragment',url.replace('https:','http:'),url.replace('IDQ65398.036169','IDQ65399.036169')])assert.equal(isBomGraphUrl(other),false,other);
});
test('the source graph is printed at its native aspect ratio with no invented history or private feature fields',()=>{
  const {webMap,width,height}=graphPrintMap(url,800,400),symbol=webMap.operationalLayers[0].featureCollection.layers[0].layerDefinition.drawingInfo.renderer.symbol;
  assert.deepEqual([width,height],[800,400]);assert.deepEqual(webMap.exportOptions.outputSize,[800,400]);assert.equal(symbol.url,url);assert.equal(symbol.width*webMap.exportOptions.dpi/72,800);assert.equal(symbol.height*webMap.exportOptions.dpi/72,400);assert.equal(webMap.baseMap.baseMapLayers.length,0);
  const large=graphPrintMap(url,2400,1200);assert.deepEqual([large.width,large.height],[1200,600]);assert.throws(()=>graphPrintMap(url,0,0),/dimensions/);assert.throws(()=>graphPrintMap('https://private.example/x.png',800,400),/Unsupported/);
});
test('print fallback uses the authenticated organisation service and returns readable full-size pixels',async()=>{
  const s=service(),result=await renderGraphPrintImage({url,request:s.request,printTask:task,dimensions:async()=>[800,400]});assert.deepEqual([result.width,result.height],[800,400]);assert.equal(s.calls.length,3);assert.equal(s.source.closed,true);
  const execution=s.calls[1],map=JSON.parse(execution.options.query.Web_Map_as_JSON);assert.equal(execution.options.method,'post');assert.equal(execution.options.query.Layout_Template,'MAP_ONLY');assert.equal(execution.options.query.Format,'PNG32');assert.equal(map.operationalLayers[0].featureCollection.layers[0].layerDefinition.drawingInfo.renderer.symbol.url,url);
});
test('a browser CORS failure falls back once and embeds the returned graph in the PDF image payload',async()=>{
  const prior=globalThis.fetch,s=service();let fallback=0,progress=0;globalThis.fetch=async()=>{throw new TypeError('Failed to fetch');};
  try{const gauge={label:'G1',graphUrl:url},result=await retrieveGaugeGraphs([gauge],{connection:{graphImage:async(value,signal)=>{fallback++;return renderGraphPrintImage({url:value,signal,request:s.request,printTask:task,dimensions:async()=>[800,400]});}},onProgress:n=>progress=n});assert.equal(fallback,1);assert.equal(result.unavailable,0);assert.equal(result.entries[0].gauge,gauge);assert.equal(result.entries[0].graph.format,'PNG');assert.equal(result.entries[0].graph.width,800);assert.equal(progress,1);
  }finally{globalThis.fetch=prior;}
});
test('explicit HTTP refusals and non-BoM/private URLs do not use the print fallback',async()=>{
  const prior=globalThis.fetch;let fallback=0;const connection={graphImage:async()=>{fallback++;throw new Error('Must not be called');}};
  try{globalThis.fetch=async()=>new Response('Forbidden',{status:403});assert.equal((await retrieveGaugeGraphs([{graphUrl:url}],{connection})).unavailable,1);assert.equal(fallback,0);
    globalThis.fetch=async()=>{throw new TypeError('Failed to fetch');};assert.equal((await retrieveGaugeGraphs([{graphUrl:'https://private.example/image.png?token=secret'}],{connection})).unavailable,1);assert.equal(fallback,0);
  }finally{globalThis.fetch=prior;}
});
test('empty print images fail rather than pretending the graph was retrieved',async()=>{const s=service({blank:true});await assert.rejects(renderGraphPrintImage({url,request:s.request,printTask:task,dimensions:async()=>[800,400]}),/readable graph/);});
test('display-only dimension lookup never draws cross-origin source pixels and cleans up after cancellation',async()=>{
  const prior=globalThis.Image;let instance;globalThis.Image=class{constructor(){instance=this;this.naturalWidth=800;this.naturalHeight=400;}set src(value){this.source=value;}removeAttribute(){this.removed=true;}};
  try{const pending=graphDimensions(url);assert.equal(instance.crossOrigin,undefined);assert.equal(instance.source,url);instance.onload();assert.deepEqual(await pending,[800,400]);assert.equal(instance.onload,null);
    const controller=new AbortController(),cancelled=graphDimensions(url,controller.signal);controller.abort();await assert.rejects(cancelled,{name:'AbortError'});assert.equal(instance.removed,true);assert.equal(instance.onload,null);
  }finally{globalThis.Image=prior;}
});
test('cancelled graph export cannot start a print request or turn into a successful image',async()=>{
  let requests=0;const controller=new AbortController();controller.abort();await assert.rejects(renderGraphPrintImage({url,printTask:task,request:async()=>{requests++;},signal:controller.signal,dimensions:async()=>[800,400]}),{name:'AbortError'});assert.equal(requests,0);
});
