import {canvas,clean} from './utils.js';
import {bounds,overlap,projectedBounds,path,transform} from './geometry.js';
import {floodGeometryPixels} from './flood-scope.js';

const intersects=(a,b)=>a.x<b.x+b.width&&a.x+a.width>b.x&&a.y<b.y+b.height&&a.y+a.height>b.y;
export function mapReservations(width,height,locator){const boxes=[{x:12,y:height-57,width:220,height:45}];if(locator?.features?.length)boxes.push({x:width-153,y:12,width:141,height:182});return boxes;}

// Native labels are separate from warning detection. Group small pixel tiles
// into text footprints so outage counts can keep clear of the existing names.
export function floodLabelBoxes(pixels,width,height){
  const step=16,cols=Math.ceil(width/step),rows=Math.ceil(height/step),tiles=new Uint8Array(cols*rows);let ink=0;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(pixels[(y*width+x)*4+3]>20){ink++;tiles[Math.floor(y/step)*cols+Math.floor(x/step)]=1;}
  if(!ink||ink>width*height*.25)return null; // Reject blank/opaque map substitutes.
  const boxes=[],seen=new Uint8Array(tiles.length);
  for(let root=0;root<tiles.length;root++)if(tiles[root]&&!seen[root]){const queue=[root];seen[root]=1;let minX=cols,minY=rows,maxX=0,maxY=0;
    for(let cursor=0;cursor<queue.length;cursor++){const i=queue[cursor],x=i%cols,y=Math.floor(i/cols);minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const nx=x+dx,ny=y+dy,j=ny*cols+nx;if(nx>=0&&nx<cols&&ny>=0&&ny<rows&&tiles[j]&&!seen[j]){seen[j]=1;queue.push(j);}}
    }boxes.push({x:Math.max(0,minX*step-4),y:Math.max(0,minY*step-4),width:Math.min(width,(maxX+1)*step+4)-Math.max(0,minX*step-4),height:Math.min(height,(maxY+1)*step+4)-Math.max(0,minY*step-4)});
  }
  return boxes;
}
export function nativeFloodLabels(image){
  const {width,height}=image,c=canvas(width,height),ctx=c.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,0,0);
  const boxes=floodLabelBoxes(ctx.getImageData(0,0,width,height).data,width,height);if(!boxes)return null;
  const halo=canvas(width,height),h=halo.getContext('2d');h.drawImage(c,0,0);h.globalCompositeOperation='source-in';h.fillStyle='rgba(255,255,255,.95)';h.fillRect(0,0,width,height);
  ctx.clearRect(0,0,width,height);for(const [dx,dy] of [[-2,0],[2,0],[0,-2],[0,2],[-1,-1],[1,-1],[-1,1],[1,1]])ctx.drawImage(halo,dx,dy);ctx.drawImage(image,0,0);
  return {image:c,boxes,mode:'native'};
}

function lines(ctx,name,maxWidth){const result=[];let line='';for(const word of name.split(/\s+/)){const next=line?line+' '+word:word;if(line&&ctx.measureText(next).width>maxWidth){result.push(line);line=word;}else line=next;}if(line)result.push(line);return result;}
export function nativeFloodLabelsInAreas(image,extent,geometries){
  const labels=nativeFloodLabels(image);if(!labels)return null;
  const {width,height}=image,inside=floodGeometryPixels({width,height,extent,visible:new Uint8Array(width*height)},geometries);
  const boxes=labels.boxes.filter(box=>{for(let y=Math.max(0,Math.floor(box.y));y<Math.min(height,box.y+box.height);y++)for(let x=Math.max(0,Math.floor(box.x));x<Math.min(width,box.x+box.width);x++)if(inside[y*width+x])return true;return false;});
  if(!boxes.length)return null;
  // Keep a whole label when it overlaps a current warning. Clipping individual
  // glyphs to a narrow catchment cuts river names off at the boundary.
  const c=canvas(width,height),ctx=c.getContext('2d');ctx.beginPath();for(const box of boxes)ctx.rect(box.x,box.y,box.width,box.height);ctx.clip();ctx.drawImage(labels.image,0,0);return {...labels,image:c,boxes};
}
export function catchmentFloodLabels(mask,collection,{reserved=[]}={}){
  const {width,height,extent}=mask,c=canvas(width,height),ctx=c.getContext('2d');ctx.font='bold 17px Arial';ctx.textAlign='center';ctx.textBaseline='middle';ctx.lineJoin='round';
  const step=4,w=Math.ceil(width/step),h=Math.ceil(height/step),project=transform(extent,w,h),candidates=new Map(),visible=new Int32Array(w*h).fill(-1);
  // Use any coloured pixel in each cell, avoiding aliasing away thin hatching.
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=y*width+x,j=Math.floor(y/step)*w+Math.floor(x/step);if(mask.visible[i]&&visible[j]<0)visible[j]=i;}
  for(const f of collection?.features||[]){const name=clean(f.properties?.dist_name||f.properties?.DIST_NAME),b=bounds(f.geometry);if(!name||!b||!overlap(projectedBounds(b),extent))continue;
    const probe=canvas(w,h),pctx=probe.getContext('2d',{willReadFrequently:true});pctx.fillStyle='#fff';pctx.beginPath();path(pctx,f.geometry,project);pctx.fill('evenodd');const pixels=pctx.getImageData(0,0,w,h).data,points=[];let sx=0,sy=0;
    for(let i=0;i<visible.length;i++)if(pixels[i*4+3]>=128&&visible[i]>=0){const px=visible[i]%width,py=Math.floor(visible[i]/width);points.push([px,py]);sx+=px;sy+=py;}
    if(points.length<6)continue;const old=candidates.get(name);if(old&&old.points.length>=points.length)continue;
    candidates.set(name,{name,points,cx:sx/points.length,cy:sy/points.length});
  }
  const boxes=[...reserved],placed=[];
  for(const entry of [...candidates.values()].sort((a,b)=>b.points.length-a.points.length)){
    const text=lines(ctx,entry.name,Math.min(240,width-32)),bw=Math.ceil(Math.max(...text.map(s=>ctx.measureText(s).width)))+12,bh=text.length*20+8;
    entry.points.sort((a,b)=>(a[0]-entry.cx)**2+(a[1]-entry.cy)**2-((b[0]-entry.cx)**2+(b[1]-entry.cy)**2));
    let chosen;for(const [x,y] of entry.points){const box={x:x-bw/2,y:y-bh/2,width:bw,height:bh};if(box.x<8||box.y<8||box.x+bw>width-8||box.y+bh>height-8||boxes.some(b=>intersects(box,b)))continue;chosen={...box,name:entry.name,lines:text};break;}
    if(!chosen)continue;boxes.push(chosen);placed.push(chosen);const x=chosen.x+bw/2,y=chosen.y+bh/2-(text.length-1)*10;
    ctx.lineWidth=4;ctx.strokeStyle='rgba(255,255,255,.96)';ctx.fillStyle='#153f5b';text.forEach((line,i)=>{ctx.strokeText(line,x,y+i*20);ctx.fillText(line,x,y+i*20);});
  }
  return {image:c,boxes:placed,mode:'catchments'};
}

export function floodLegendLayout(image,width){if(!image)return {height:35};const scale=Math.min(1.5,(width-32)/image.width,400/image.height);return {height:Math.ceil(image.height*scale)+34,width:image.width*scale,imageHeight:image.height*scale};}

export function combinedFloodLegend(layers){
  if(layers.length===1)return layers[0].legend;
  const width=Math.max(300,...layers.map(layer=>layer.legend?.width||0)),height=layers.reduce((sum,layer)=>sum+30+(layer.legend?.height||22),0),c=canvas(width,height),ctx=c.getContext('2d');let y=0;
  for(const layer of layers){ctx.font='bold 12px Arial';ctx.fillStyle='#333';ctx.fillText(layer.kind+(layer.selected?'':' (nearby)'),0,y+14);y+=22;if(layer.legend){ctx.drawImage(layer.legend,0,y);y+=layer.legend.height;}else{ctx.font='12px Arial';ctx.fillText('Source legend unavailable',0,y+14);y+=22;}y+=8;}
  return c;
}
