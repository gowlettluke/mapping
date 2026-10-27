import {canvas} from './utils.js';
import {path,transform,pixelPoint,projectedBounds,bounds,overlap,contains} from './geometry.js';
export function warningPixel(rgba,i){return rgba[i+3]>18&&Math.max(rgba[i],rgba[i+1],rgba[i+2])>80&&Math.max(rgba[i],rgba[i+1],rgba[i+2])-Math.min(rgba[i],rgba[i+1],rgba[i+2])>35;}
export function analysePixels(rgba,width,height,extent,{minimumHits=30}={}) {
  const visible=new Uint8Array(width*height);let hits=0,w=width,s=height,e=-1,n=-1;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(warningPixel(rgba,(y*width+x)*4)){visible[y*width+x]=1;hits++;w=Math.min(w,x);s=Math.min(s,y);e=Math.max(e,x);n=Math.max(n,y);}
  const mask={visible,width,height,extent:[...extent]};
  if(hits<minimumHits)return {active:false,hits,mask,extent:[...extent]};
  const dx=(extent[2]-extent[0])/width,dy=(extent[3]-extent[1])/height;
  return {active:true,hits,mask,extent:[extent[0]+w*dx,extent[3]-(n+1)*dy,extent[0]+(e+1)*dx,extent[3]-s*dy]};
}
export function landMask(land,width,height,extent){const c=canvas(width,height),ctx=c.getContext('2d'),p=transform(extent,width,height);ctx.fillStyle='#fff';for(const f of land.features||[]){ctx.beginPath();path(ctx,f.geometry,p);ctx.fill('evenodd');}return c;}
export function warningCanvas(image,width,height,extent,land){const c=canvas(width,height),ctx=c.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,0,0,width,height);ctx.globalCompositeOperation='destination-in';ctx.drawImage(landMask(land,width,height,extent),0,0);ctx.globalCompositeOperation='source-over';return c;}
export function analyseCanvas(c,extent){return analysePixels(c.getContext('2d',{willReadFrequently:true}).getImageData(0,0,c.width,c.height).data,c.width,c.height,extent);}
export function outlineCanvas(mask){const c=canvas(mask.width,mask.height),ctx=c.getContext('2d'),im=ctx.createImageData(mask.width,mask.height),{width:w,height:h,visible:v}=mask;
  for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){const i=y*w+x;if(!v[i]||v[i-1]&&v[i+1]&&v[i-w]&&v[i+w])continue;
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const q=((y+dy)*w+x+dx)*4;im.data[q]=147;im.data[q+1]=91;im.data[q+2]=20;im.data[q+3]=245;}}
  ctx.putImageData(im,0,0);return c;
}
export function components(mask,{limit=40,minCells=12}={}) {
  const {visible:v,width:w,height:h}=mask,seen=new Uint8Array(v.length),found=[];
  for(let root=0;root<v.length;root++)if(v[root]&&!seen[root]){
    const queue=[root];seen[root]=1;let cursor=0;
    while(cursor<queue.length){const i=queue[cursor++],x=i%w,y=Math.floor(i/w);for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
      if(!dx&&!dy)continue;const nx=x+dx,ny=y+dy,j=ny*w+nx;if(nx<0||ny<0||nx>=w||ny>=h||!v[j]||seen[j])continue;seen[j]=1;queue.push(j);
    }}
    if(queue.length>=minCells)found.push(queue);
  }
  return found.sort((a,b)=>b.length-a.length).slice(0,limit).map((cells,index)=>{const visible=new Uint8Array(v.length);let minX=w,minY=h,maxX=0,maxY=0;for(const i of cells){visible[i]=1;const x=i%w,y=Math.floor(i/w);minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);}
    const dx=(mask.extent[2]-mask.extent[0])/w,dy=(mask.extent[3]-mask.extent[1])/h;
    return {id:String(index),mask:{...mask,visible},hits:cells.length,sample:pixelPoint((cells[Math.floor(cells.length/2)]%w)+.5,Math.floor(cells[Math.floor(cells.length/2)]/w)+.5,mask.extent,w,h),
      extent:[mask.extent[0]+minX*dx,mask.extent[3]-(maxY+1)*dy,mask.extent[0]+(maxX+1)*dx,mask.extent[3]-minY*dy]};
  });
}
export function maskContains(mask,point){if(!mask)return false;const [x,y]=projectedBounds([point[0],point[1],point[0],point[1]]),e=mask.extent;
  const px=Math.floor((x-e[0])/(e[2]-e[0])*mask.width),py=Math.floor((e[3]-y)/(e[3]-e[1])*mask.height);
  return px>=0&&py>=0&&px<mask.width&&py<mask.height&&Boolean(mask.visible[py*mask.width+px]);
}
export function maskIntersects(mask,geometry){const b=bounds(geometry);if(!b)return false;const e=projectedBounds(b);if(!overlap(e,mask.extent))return false;
  const m=mask.extent,px=x=>(x-m[0])/(m[2]-m[0])*mask.width,py=y=>(m[3]-y)/(m[3]-m[1])*mask.height;
  const x0=Math.max(0,Math.floor(px(e[0]))-1),x1=Math.min(mask.width-1,Math.ceil(px(e[2]))+1),y0=Math.max(0,Math.floor(py(e[3]))-1),y1=Math.min(mask.height-1,Math.ceil(py(e[1]))+1);
  for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++)if(mask.visible[y*mask.width+x]&&contains(pixelPoint(x+.5,y+.5,m,mask.width,mask.height),geometry))return true;
  return false;
}
// Rasterise each candidate polygon once at the warning's native resolution.
// Repeated point-in-polygon checks over a detailed statewide LGA boundary can
// otherwise block the browser for millions of segment comparisons.
export function rasterIntersects(mask,geometry){
  const b=bounds(geometry);if(!b)return false;const e=projectedBounds(b),m=mask.extent;if(!overlap(e,m))return false;
  const px=x=>(x-m[0])/(m[2]-m[0])*mask.width,py=y=>(m[3]-y)/(m[3]-m[1])*mask.height;
  const x0=Math.max(0,Math.floor(px(e[0]))-1),x1=Math.min(mask.width,Math.ceil(px(e[2]))+1),y0=Math.max(0,Math.floor(py(e[3]))-1),y1=Math.min(mask.height,Math.ceil(py(e[1]))+1),w=x1-x0,h=y1-y0;
  if(w<=0||h<=0)return false;
  let possible=false;for(let y=y0;y<y1&&!possible;y++)for(let x=x0;x<x1;x++)if(mask.visible[y*mask.width+x]){possible=true;break;}if(!possible)return false;
  const c=canvas(w,h),ctx=c.getContext('2d',{willReadFrequently:true}),p=transform(m,mask.width,mask.height);ctx.fillStyle='#fff';ctx.beginPath();path(ctx,geometry,point=>{const [x,y]=p(point);return [x-x0,y-y0];});ctx.fill('evenodd');
  const data=ctx.getImageData(0,0,w,h).data;for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(mask.visible[(y+y0)*mask.width+x+x0]&&data[(y*w+x)*4+3]>=128)return true;
  return false;
}
