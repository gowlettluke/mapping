import {canvas,checkAbort} from './utils.js';
import {bounds,overlap,projectedBounds,path,transform,pixelPoint} from './geometry.js';
import {components} from './raster.js';

export function floodGeometryPixels(mask,geometries){
  const c=canvas(mask.width,mask.height),ctx=c.getContext('2d',{willReadFrequently:true}),project=transform(mask.extent,mask.width,mask.height);
  ctx.fillStyle='#fff';for(const geometry of geometries){const b=bounds(geometry);if(!b||!overlap(projectedBounds(b),mask.extent))continue;ctx.beginPath();path(ctx,geometry,project);ctx.fill('evenodd');}
  const pixels=ctx.getImageData(0,0,c.width,c.height).data;return Uint8Array.from({length:mask.visible.length},(_,index)=>pixels[index*4+3]>=128?1:0);
}
export function intersectFloodPixels(mask,inside,{minimumHits=12}={}){
  const {width,height,extent}=mask,visible=new Uint8Array(mask.visible.length);let hits=0,interiorHits=0,x0=width,y0=height,x1=-1,y1=-1,first=-1;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=y*width+x;if(!mask.visible[i]||!inside[i])continue;visible[i]=1;hits++;if(first<0)first=i;x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x);y1=Math.max(y1,y);
    // A neighbouring warning's antialiased outline alone must not activate a
    // catchment. Keep boundary pixels once there is an interior match.
    if(x>0&&x<width-1&&y>0&&y<height-1&&inside[i-1]&&inside[i+1]&&inside[i-width]&&inside[i+width])interiorHits++;
  }
  const dx=(extent[2]-extent[0])/width,dy=(extent[3]-extent[1])/height,area=hits?[extent[0]+x0*dx,extent[3]-(y1+1)*dy,extent[0]+(x1+1)*dx,extent[3]-y0*dy]:[...extent];
  return {active:hits>=minimumHits&&interiorHits>=minimumHits&&interiorHits/hits>=.15,hits,interiorHits,mask:{...mask,visible},extent:area,sample:first<0?null:pixelPoint(first%width+.5,Math.floor(first/width)+.5,extent,width,height)};
}
export const intersectFloodMask=(mask,geometries)=>intersectFloodPixels(mask,floodGeometryPixels(mask,geometries));

// Adjacent active catchments can touch in WMS pixels. Identify products from
// their reference geometry before grouping, rather than naming a connected
// raster component from one arbitrarily chosen sample point.
export function partitionFloodAreas(mask,references,{key,kind,names,titles,signal,rasterise=floodGeometryPixels}={}){
  const grouped=new Map(),covered=new Uint8Array(mask.visible.length);
  for(const feature of references?.features||[]){checkAbort(signal);const p=feature.properties||{},aac=p.aac||p.AAC,id=p.product_id||p.PRODUCT_ID,name=p.dist_name||p.DIST_NAME,b=bounds(feature.geometry);if(!aac||!name||!b||!overlap(projectedBounds(b),mask.extent))continue;
    const groupKey=id?'product:'+id:'catchment:'+aac;if(!grouped.has(groupKey))grouped.set(groupKey,{id:key+':'+groupKey,kind,names,titles,identified:Boolean(id),referenceFeatures:[],parentNames:[],allNames:[]});
    const group=grouped.get(groupKey);group.referenceFeatures.push(feature);group.allNames.push(name);const parent=String(p.aac_parent||p.AAC_PARENT||'').trim();if(!parent||parent===aac)group.parentNames.push(name);
  }
  const areas=[];for(const group of grouped.values()){checkAbort(signal);const scopeGeometries=group.referenceFeatures.map(feature=>feature.geometry),inside=rasterise(mask,scopeGeometries);for(let i=0;i<inside.length;i++)if(inside[i])covered[i]=1;
    const detected=intersectFloodPixels(mask,inside);if(!detected.active)continue;const name=[...new Set(group.parentNames.length?group.parentNames:group.allNames)].join(' / ');
    areas.push({...group,title:kind+' - '+name,scopeGeometries,extent:detected.extent,components:[detected]});
  }
  const unknown={...mask,visible:new Uint8Array(mask.visible.length)};
  for(let y=0;y<mask.height;y++)for(let x=0;x<mask.width;x++){const i=y*mask.width+x;if(!mask.visible[i]||covered[i])continue;let nearby=false;
    // WMS antialiasing can leave a one-pixel fringe outside the reference
    // raster. It is not an additional unidentified flood product.
    for(let dy=-1;dy<=1&&!nearby;dy++)for(let dx=-1;dx<=1;dx++){const nx=x+dx,ny=y+dy;if(nx>=0&&ny>=0&&nx<mask.width&&ny<mask.height&&covered[ny*mask.width+nx]){nearby=true;break;}}
    if(!nearby)unknown.visible[i]=1;
  }
  for(const component of components(unknown,{minCells:30}))areas.push({id:key+':unidentified:'+component.id,title:kind+' - Unidentified detected area '+(Number(component.id)+1),kind,names,titles,identified:false,components:[component],extent:component.extent});
  return areas.sort((a,b)=>a.title.localeCompare(b.title));
}

export function clipFloodImage(image,extent,geometries){
  const c=canvas(image.width,image.height),ctx=c.getContext('2d'),clip=canvas(image.width,image.height),mask=clip.getContext('2d'),project=transform(extent,c.width,c.height);mask.fillStyle='#fff';
  for(const geometry of geometries){mask.beginPath();path(mask,geometry,project);mask.fill('evenodd');}
  ctx.drawImage(image,0,0);ctx.globalCompositeOperation='destination-in';ctx.drawImage(clip,0,0);ctx.globalCompositeOperation='source-over';return c;
}
