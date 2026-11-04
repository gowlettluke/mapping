// Pixel-space label placement, independent of map projection and drawing APIs.
export function layoutOutageLabels(labels,width,height,{reserved=[],margin=8,gap=6,maxDistance=Infinity}={}) {
  const cells=new Map(),cellSize=64,placed=new Array(labels.length).fill(null);
  const intersects=(a,b)=>a.x<b.x+b.width&&a.x+a.width>b.x&&a.y<b.y+b.height&&a.y+a.height>b.y;
  const padded=box=>({x:box.x-gap/2,y:box.y-gap/2,width:box.width+gap,height:box.height+gap});
  const keys=box=>{const result=[];for(let x=Math.floor(box.x/cellSize);x<=Math.floor((box.x+box.width)/cellSize);x++)for(let y=Math.floor(box.y/cellSize);y<=Math.floor((box.y+box.height)/cellSize);y++)result.push(x+','+y);return result;};
  const occupy=box=>{const paddedBox=padded(box);for(const key of keys(paddedBox)){if(!cells.has(key))cells.set(key,[]);cells.get(key).push(paddedBox);}};
  const clear=box=>{const paddedBox=padded(box);return keys(paddedBox).every(key=>(cells.get(key)||[]).every(other=>!intersects(paddedBox,other)));};
  for(const box of reserved)occupy(box);
  // Keep labels clear of outage anchor points as well as other labels.
  for(const {anchor:[x,y]} of labels)occupy({x:x-3,y:y-3,width:6,height:6});
  const order=labels.map((label,index)=>({...label,index})).sort((a,b)=>b.width-a.width||a.anchor[1]-b.anchor[1]||a.anchor[0]-b.anchor[0]||a.index-b.index);
  for(const label of order){const {anchor:[x,y],width:w,height:h,index}=label;if(w>width-margin*2||h>height-margin*2)continue;
    const bounded=(bx,by)=>({x:Math.max(margin,Math.min(width-margin-w,bx)),y:Math.max(margin,Math.min(height-margin-h,by)),width:w,height:h});
    const nearby=box=>Math.hypot(Math.max(box.x-x,0,x-box.x-w),Math.max(box.y-y,0,y-box.y-h))<=maxDistance;
    let chosen=null;
    for(let radius=0;radius<=Math.min(Math.max(width,height),maxDistance)&&!chosen;radius+=16){
      const candidates=[[x+12+radius,y-h/2],[x-w-12-radius,y-h/2],[x-w/2,y-h-12-radius],[x-w/2,y+12+radius],
        [x+12+radius,y-h-12-radius],[x-w-12-radius,y-h-12-radius],[x+12+radius,y+12+radius],[x-w-12-radius,y+12+radius]];
      for(const [bx,by] of candidates){const box=bounded(bx,by);if(nearby(box)&&clear(box)){chosen=box;break;}}
    }
    // Search remaining space if the nearby radial slots are all occupied.
    if(!chosen){let best=Infinity;for(let by=margin;by+h<=height-margin;by+=8)for(let bx=margin;bx+w<=width-margin;bx+=8){const distance=(bx+w/2-x)**2+(by+h/2-y)**2;if(distance>=best)continue;const box={x:bx,y:by,width:w,height:h};if(nearby(box)&&clear(box)){chosen=box;best=distance;}}}
    if(chosen){placed[index]=chosen;occupy(chosen);}
  }
  return placed;
}
