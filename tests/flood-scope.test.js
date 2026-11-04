import test from 'node:test';
import assert from 'node:assert/strict';
import {partitionFloodAreas,intersectFloodPixels,floodSelectionOutline} from '../js/flood-scope.js';
import {projectedBounds,pixelPoint,contains} from '../js/geometry.js';
import {components,maskContains} from '../js/raster.js';
import {setCanvasFactory} from '../js/utils.js';
import {selectGauges} from '../js/gauges.js';

const polygon=(w,s,e,n)=>({type:'Polygon',coordinates:[[[w,s],[e,s],[e,n],[w,n],[w,s]]]}),feature=(aac,name,product,geometry,parent='')=>({type:'Feature',properties:{aac,dist_name:name,product_id:product,aac_parent:parent},geometry});
const width=80,height=80,extent=projectedBounds([150,-28,154,-24]),mask={width,height,extent,visible:Uint8Array.from({length:width*height},(_,i)=>{const x=i%width,y=Math.floor(i/width);return x>4&&x<75&&y>4&&y<75?1:0;})};
const rasterise=(mask,geometries)=>Uint8Array.from(mask.visible,(_,i)=>geometries.some(geometry=>contains(pixelPoint(i%mask.width+.5,Math.floor(i/mask.width)+.5,mask.extent,mask.width,mask.height),geometry))?1:0);
const references={features:[feature('QLD_C','Lower Condamine River','IDQ_C',polygon(150,-28,152,-24)),feature('QLD_C_CHILD','Lower reach','IDQ_C',polygon(150,-28,151,-26),'QLD_C'),feature('QLD_B','Burnett River','IDQ_B',polygon(152,-28,154,-24))]},options={key:'floodWarnings',kind:'Flood Warning',names:['IDZ20013'],titles:[],rasterise};
test('touching active warnings remain separate products with their own gauge and camera footprints',()=>{
  assert.equal(components(mask).length,1,'The original connected-component approach merges both products.');const areas=partitionFloodAreas(mask,references,options);assert.equal(areas.length,2);const condamine=areas.find(area=>area.title.endsWith('Lower Condamine River')),burnett=areas.find(area=>area.title.endsWith('Burnett River'));assert.ok(condamine&&burnett);assert.equal(condamine.referenceFeatures.length,2);
  const west=[151,-26],east=[153,-26];assert.ok(maskContains(condamine.components[0].mask,west));assert.equal(maskContains(condamine.components[0].mask,east),false);assert.ok(maskContains(burnett.components[0].mask,east));assert.equal(maskContains(burnett.components[0].mask,west),false);
  const gauges=selectGauges([{id:'c',name:'Condamine gauge',point:west},{id:'b',name:'Burnett gauge',point:east}],condamine.components.map(component=>component.mask));assert.deepEqual(gauges.map(gauge=>gauge.id),['c']);
});
test('regional refinement cannot expand the selected product to a touching current warning',()=>{
  const areas=partitionFloodAreas(mask,references,options),selected=areas.find(area=>area.title.includes('Lower Condamine'));
  const refined=intersectFloodPixels(mask,rasterise(mask,selected.scopeGeometries));assert.equal(refined.active,true);assert.equal(maskContains(refined.mask,[153,-26]),false);assert.ok(maskContains(refined.mask,[151,-26]));
  const onlyBurnett={...mask,visible:Uint8Array.from(mask.visible,(value,index)=>index%width>40?value:0)};assert.equal(intersectFloodPixels(onlyBurnett,rasterise(onlyBurnett,selected.scopeGeometries)).active,false);
});
test('flood watches without product IDs use separate catchment IDs and unknown regions remain explicit',()=>{
  const watches={features:references.features.filter(feature=>!feature.properties.aac_parent).map(feature=>({...feature,properties:{...feature.properties,product_id:''}}))},areas=partitionFloodAreas(mask,watches,{...options,key:'floodWatches',kind:'Flood Watch'});assert.equal(areas.length,2);assert.equal(new Set(areas.map(area=>area.id)).size,2);assert.ok(areas.every(area=>!area.identified));
  const unknown=partitionFloodAreas(mask,{features:[]},options);assert.equal(unknown.length,1);assert.ok(unknown[0].title.includes('Unidentified'));assert.equal(unknown[0].scopeGeometries,undefined);
});
test('boundary colour bleed alone cannot activate a neighbouring catchment and cancellation is preserved',()=>{
  const inside=rasterise(mask,[references.features[2].geometry]),bleed={...mask,visible:Uint8Array.from(mask.visible,(_,i)=>i%width===40?1:0)};assert.equal(intersectFloodPixels(bleed,inside).active,false);
  const controller=new AbortController();controller.abort();assert.throws(()=>partitionFloodAreas(mask,references,{...options,signal:controller.signal}),{name:'AbortError'});
});
test('small interior slivers and antialiased fringes do not add spurious flood products',()=>{
  const inside=rasterise(mask,[references.features[2].geometry]),sliver={...mask,visible:Uint8Array.from(mask.visible,(_,i)=>{const x=i%width,y=Math.floor(i/width);return x===40||y===0||y===height-1||x===41&&y>=20&&y<40?1:0;})};
  const detected=intersectFloodPixels(sliver,inside);assert.ok(detected.interiorHits>=12);assert.equal(detected.active,false);
  const fringe={...mask,visible:Uint8Array.from(mask.visible,(_,i)=>{const x=i%width,y=Math.floor(i/width);return x>=10&&x<=40&&y>=10&&y<=70?1:0;})},areas=partitionFloodAreas(fringe,{features:[references.features[0]]},options);assert.equal(areas.length,1);assert.equal(areas[0].identified,true);
});

test('selected outline follows the catchment union without internal seams or hatch outlines',()=>{
  const strokes=[],segments=[];let last;setCanvasFactory((width,height)=>({width,height,getContext:()=>({beginPath(){},moveTo(x,y){last=[x,y];},lineTo(x,y){segments.push([last,[x,y]]);},stroke(){strokes.push(this.strokeStyle);}})}));
  const outlines=floodSelectionOutline({...mask,visible:new Uint8Array(mask.visible.length)},[references.features[0].geometry,references.features[2].geometry],{rasterise});assert.equal(outlines.width,80);assert.deepEqual(strokes,['#fff','#173e65']);
  assert.ok(segments.length>100);assert.ok(segments.every(([a,b])=>a[0]===b[0]&&(a[0]===0||a[0]===80)||a[1]===b[1]&&(a[1]===0||a[1]===80)),'Only the outside perimeter is traced, despite a shared catchment boundary and a blank coloured-pixel mask.');
});
