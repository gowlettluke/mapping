import {CONFIG} from '../config.js';
import {mercator,projectedBounds,transform,path,bounds,contains,scaleBar,WORLD,lonLat} from './geometry.js';
import {canvas,request,imageFromBlob,pooled,canvasBlob,checkAbort,aest} from './utils.js';
import {outlineCanvas,maskContains} from './raster.js';
import {markerPositions} from './cameras.js';
const CREDIT_FALLBACK='Esri, HERE, Garmin, Intermap, USGS, OpenStreetMap contributors and the GIS User Community';
export function wrap(ctx,text,width){const result=[];let line='';for(const word of String(text).split(/\s+/)){const candidate=line?line+' '+word:word;if(line&&ctx.measureText(candidate).width>width){result.push(line);line=word;}else line=candidate;}if(line)result.push(line);return result;}
export async function basemap(extent,width,height,signal){
  const c=canvas(width,height),ctx=c.getContext('2d');ctx.fillStyle='#edf2f3';ctx.fillRect(0,0,width,height);
  const mpp=(extent[2]-extent[0])/width,z=Math.max(0,Math.min(17,Math.floor(Math.log2(WORLD/(256*mpp))))),n=2**z,span=WORLD/n;
  const col0=Math.floor((extent[0]+WORLD/2)/span),col1=Math.floor((extent[2]+WORLD/2)/span),row0=Math.max(0,Math.floor((WORLD/2-extent[3])/span)),row1=Math.min(n-1,Math.floor((WORLD/2-extent[1])/span));
  const tiles=[];for(let row=row0;row<=row1;row++)for(let col=col0;col<=col1;col++)tiles.push({row,col});
  let failed=0;await pooled(tiles,6,async({row,col})=>{checkAbort(signal);try{
    const url=CONFIG.publicSources.tiles.replace('{z}',z).replace('{y}',row).replace('{x}',((col%n)+n)%n);
    const image=await imageFromBlob(await(await request(url,{signal,cache:'force-cache',timeout:15000})).blob());
    const x=(col*span-WORLD/2-extent[0])/(extent[2]-extent[0])*width,y=(extent[3]-(WORLD/2-row*span))/(extent[3]-extent[1])*height;
    ctx.drawImage(image,x,y,span/(extent[2]-extent[0])*width+.6,span/(extent[3]-extent[1])*height+.6);image.close?.();
  }catch(e){if(signal?.aborted)throw e;failed++;}});
  return {canvas:c,failed,total:tiles.length};
}
function features(ctx,collection,project,{stroke='#666',fill=null,width=1}={}){ctx.strokeStyle=stroke;ctx.fillStyle=fill||'transparent';ctx.lineWidth=width;for(const f of collection?.features||[]){ctx.beginPath();path(ctx,f.geometry,project);if(fill)ctx.fill('evenodd');if(stroke)ctx.stroke();}}
function labels(ctx,collection,project,width,height){ctx.font='bold 14px Arial';ctx.textAlign='center';ctx.lineWidth=3;const occupied=[];
  for(const f of collection?.features||[]){const b=bounds(f.geometry);if(!b)continue;const point=[(b[0]+b[2])/2,(b[1]+b[3])/2];if(!contains(point,f.geometry))continue;const [x,y]=project(point);if(x<50||x>width-50||y<25||y>height-25||occupied.some(p=>Math.abs(p[0]-x)<150&&Math.abs(p[1]-y)<28))continue;
    const name=f.properties?.lga||f.properties?.name;if(!name)continue;occupied.push([x,y]);ctx.strokeStyle='rgba(255,255,255,.85)';ctx.strokeText(name,x,y);ctx.fillStyle='#4b555b';ctx.fillText(name,x,y);
  }ctx.textAlign='left';
}
export function annotations(ctx,extent,width,height,locator){
  const bar=scaleBar(extent,width);ctx.save();ctx.fillStyle='rgba(255,255,255,.94)';ctx.fillRect(12,height-57,Math.max(150,bar.pixels+28),45);ctx.strokeStyle='#273842';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(24,height-27);ctx.lineTo(24+bar.pixels,height-27);ctx.moveTo(24,height-32);ctx.lineTo(24,height-22);ctx.moveTo(24+bar.pixels,height-32);ctx.lineTo(24+bar.pixels,height-22);ctx.stroke();ctx.font='12px Arial';ctx.fillStyle='#273842';ctx.fillText('0',24,height-37);ctx.fillText(bar.km+' km',24+bar.pixels-30,height-37);
  if(locator?.features?.length){const x=width-153,y=12,w=141,h=182,box=projectedBounds(CONFIG.rendering.qld),p=transform(box,w-16,h-33);ctx.save();ctx.beginPath();ctx.rect(x,y,w,h);ctx.clip();ctx.fillStyle='rgba(255,255,255,.96)';ctx.fillRect(x,y,w,h);ctx.fillStyle='#263842';ctx.fillText('Queensland',x+8,y+17);ctx.translate(x+8,y+25);features(ctx,locator,p,{fill:'#dce5e8',stroke:null});
    const lx=(extent[0]-box[0])/(box[2]-box[0])*(w-16),ly=(box[3]-extent[3])/(box[3]-box[1])*(h-33),lw=Math.max(5,(extent[2]-extent[0])/(box[2]-box[0])*(w-16)),lh=Math.max(5,(extent[3]-extent[1])/(box[3]-box[1])*(h-33));
    ctx.fillStyle='rgba(190,25,35,.15)';ctx.fillRect(lx,ly,lw,lh);ctx.strokeStyle='#b81e2b';ctx.lineWidth=1.4;ctx.strokeRect(lx,ly,lw,lh);ctx.restore();
  }ctx.restore();
}
const RADAR=[['<2','#f5f5ff'],['2-3','#b4b4ff'],['3-5','#7878ff'],['5-7','#1414ff'],['7-10','#00d8c3'],['10-15','#009690'],['15-25','#006666'],['25-35','#ffff00'],['35-55','#ffc800'],['55-80','#ff9600'],['80-120','#ff6400'],['120-180','#ff0000'],['180-270','#c80000'],['270-400','#780000'],['400+','#280000']];
function legend(ctx,width,y,radar){ctx.fillStyle='#333';ctx.font='12px Arial';ctx.fillText('Warning extent',46,y+24);ctx.fillStyle='#ffe26a';ctx.fillRect(16,y+13,24,14);ctx.strokeStyle='#935b14';ctx.strokeRect(16,y+13,24,14);ctx.strokeStyle='#50595f';ctx.beginPath();ctx.moveTo(260,y+20);ctx.lineTo(295,y+20);ctx.stroke();ctx.fillStyle='#333';ctx.fillText('Coast / state border',304,y+24);ctx.strokeStyle='#8c949a';ctx.beginPath();ctx.moveTo(520,y+20);ctx.lineTo(555,y+20);ctx.stroke();ctx.fillText('LGA boundary',564,y+24);
  if(radar){ctx.font='bold 11px Arial';ctx.fillText('Radar rain rate (mm/h)',16,y+54);const start=190,cell=(width-start-16)/RADAR.length;for(let i=0;i<RADAR.length;i++){ctx.fillStyle=RADAR[i][1];ctx.fillRect(start+i*cell,y+39,cell+1,15);ctx.fillStyle='#555';ctx.font='9px Arial';ctx.textAlign='center';ctx.fillText(RADAR[i][0],start+(i+.5)*cell,y+68);}ctx.textAlign='left';}
  else {ctx.font='12px Arial';ctx.fillStyle='rgba(194,29,45,.22)';ctx.fillRect(16,y+45,24,15);ctx.strokeStyle='#a92132';ctx.strokeRect(16,y+45,24,15);ctx.fillStyle='#333';ctx.fillText('Unplanned power outage (number = reported customers)',46,y+57);ctx.strokeStyle='#bd202d';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(520,y+52);ctx.lineTo(555,y+52);ctx.stroke();ctx.fillText('Road closed',564,y+57);ctx.strokeStyle='#c47b19';ctx.beginPath();ctx.moveTo(760,y+52);ctx.lineTo(795,y+52);ctx.stroke();ctx.fillText('Road restricted / conditional access',804,y+57);}
}
export function composeProducts({extent,background,warning,radar,tracking=null,mask,lgas,context,outages,roads,profile,active,generated,scopeLabel='',demo=false}){
  const width=warning.width,height=warning.height,p=transform(extent,width,height),outline=outlineCanvas(mask),probe=canvas(width,10).getContext('2d');probe.font='11px Arial';
  const footer=['Generated '+aest(generated),demo?'Sources: synthetic test fixtures - not operational observations.':'Sources: Bureau of Meteorology warning/radar via authenticated ArcGIS; Queensland Government boundaries; Queensland power outage feed; QLDTraffic.',demo?'Background: synthetic demo geometry.':context.basemapUnavailable?'Background: Queensland boundary context.':'Basemap: '+(context.credits?.copyrightText||CREDIT_FALLBACK)];
  const footerLines=footer.flatMap(t=>wrap(probe,t,width-30)),top=70,legendH=89,footerH=18+footerLines.length*16;
  const make=(withRadar)=>{
    const c=canvas(width,top+height+legendH+footerH),ctx=c.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,c.width,c.height);ctx.font='bold 25px Arial';ctx.fillStyle='#17222c';ctx.fillText((active?(profile==='flooding'?'Queensland Flood Warning / Watch':'Queensland '+CONFIG.profiles[profile].label+' Warning'):'Queensland Statewide')+' + '+(withRadar?'Radar':'Infrastructure Impacts'),16,29);ctx.font='13px Arial';ctx.fillStyle='#58636c';ctx.fillText(scopeLabel||(active?'Current warning extent with regional context':'No active warning detected in Queensland'),16,53);
    ctx.save();ctx.translate(0,top);ctx.beginPath();ctx.rect(0,0,width,height);ctx.clip();ctx.drawImage(background,0,0,width,height);
    features(ctx,lgas,p,{stroke:'rgba(100,108,114,.48)',width:1});features(ctx,context.coastline,p,{stroke:'#4a555c',width:1.2});features(ctx,context.border,p,{stroke:'#34424b',width:1.8});
    if(active&&(extent[2]-extent[0])<900000)labels(ctx,lgas,p,width,height);
    ctx.drawImage(warning,0,0);if(withRadar&&radar){ctx.imageSmoothingEnabled=false;ctx.drawImage(radar,0,0,width,height);ctx.imageSmoothingEnabled=true;}else if(tracking)ctx.drawImage(tracking,0,0,width,height);
    ctx.drawImage(outline,0,0);
    if(!withRadar){for(const f of outages?.features||[]){const prop=f.properties||{};if(String(prop.outage_type).toLowerCase()!=='unplanned'||!f.geometry)continue;const polygon=['Polygon','MultiPolygon'].includes(f.geometry.type);ctx.beginPath();path(ctx,f.geometry,p);ctx.fillStyle='rgba(190,35,52,.22)';ctx.strokeStyle='#a62133';ctx.lineWidth=1.7;if(polygon){ctx.fill('evenodd');ctx.stroke();}
        const b=bounds(f.geometry);if(!b)continue;const pos=p([(b[0]+b[2])/2,(b[1]+b[3])/2]);if(!polygon){ctx.beginPath();ctx.arc(...pos,7,0,Math.PI*2);ctx.fill();ctx.stroke();}
        if(prop.affected_customers_known!==false&&prop.affected_customers!=null&&Number.isFinite(Number(prop.affected_customers))){ctx.font='bold 14px Arial';ctx.lineWidth=3;ctx.strokeStyle='#fff';const label=String(prop.affected_customers);ctx.strokeText(label,pos[0]+8,pos[1]);ctx.fillStyle='#7b1220';ctx.fillText(label,pos[0]+8,pos[1]);}
      }
      for(const r of roads){ctx.beginPath();path(ctx,r.geometry,p);ctx.strokeStyle=r.condition==='closed'?'#bd202d':'#c47b19';ctx.lineWidth=r.condition==='closed'?3:2.5;const point=r.geometry.type==='Point';if(point){const pos=p(r.geometry.coordinates);ctx.arc(...pos,5,0,Math.PI*2);}ctx.stroke();}
    }
    annotations(ctx,extent,width,height,context.locator);if(demo){ctx.font='bold 38px Arial';ctx.fillStyle='rgba(145,25,35,.8)';ctx.textAlign='center';ctx.fillText('DEMO - SYNTHETIC DATA',width/2,60);ctx.textAlign='left';}ctx.strokeStyle='#61717b';ctx.lineWidth=1;ctx.strokeRect(.5,.5,width-1,height-1);ctx.restore();
    legend(ctx,width,top+height,withRadar);ctx.font='11px Arial';ctx.fillStyle='#4d5962';footerLines.forEach((s,i)=>ctx.fillText(s,15,top+height+legendH+17+i*16));return c;
  };
  return {radar:make(true),infrastructure:make(false),outline};
}
export async function exportProducts(products){return {radar:await canvasBlob(products.radar),infrastructure:await canvasBlob(products.infrastructure)};}
export function cameraMap(snapshot,cameras,width=1450,height=Math.round(width*(snapshot.extent[3]-snapshot.extent[1])/(snapshot.extent[2]-snapshot.extent[0]))){const c=canvas(width,height),ctx=c.getContext('2d');ctx.drawImage(snapshot.background,0,0,width,height);ctx.save();ctx.beginPath();ctx.rect(0,0,width,height);ctx.clip();ctx.globalAlpha=.8;ctx.drawImage(snapshot.warning,0,0,width,height);ctx.globalAlpha=1;
  const p=transform(snapshot.extent,width,height);ctx.font='bold 16px Arial';ctx.textAlign='center';const positions=markerPositions(cameras.map(c=>p(c.point)),width,height);
  cameras.forEach((camera,i)=>{const [ax,ay]=p(camera.point),[x,y]=positions[i];ctx.strokeStyle='#6a7b86';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(ax,ay);ctx.lineTo(x,y);ctx.stroke();ctx.beginPath();ctx.arc(x,y,13,0,Math.PI*2);ctx.fillStyle='#1c4c72';ctx.fill();ctx.strokeStyle='#fff';ctx.lineWidth=2;ctx.stroke();ctx.fillStyle='#fff';ctx.fillText(String(i+1),x,y+5);camera.marker={x,y};});
  ctx.textAlign='left';annotations(ctx,snapshot.extent,width,height,snapshot.context.locator);ctx.restore();return c;
}
