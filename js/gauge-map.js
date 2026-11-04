import {canvas,aest} from './utils.js';
import {path,transform,scaleBar} from './geometry.js';
import {annotations,wrap} from './renderer.js';
import {layoutOutageLabels} from './map-labels.js';
import {floodLegendLayout,drawWarningFocus,warningFocusLegend} from './flood-display.js';
import {GAUGE_COLOURS} from './gauges.js';
import {gaugeFlowSummary} from './gauge-flow.js';

function lines(ctx,collection,project,stroke,width){ctx.strokeStyle=stroke;ctx.lineWidth=width;for(const feature of collection?.features||[]){ctx.beginPath();path(ctx,feature.geometry,project);ctx.stroke();}}
export function drawGaugeMarkers(ctx,snapshot,gauges,width,height,{offsetY=0}={}){
  const project=transform(snapshot.extent,width,height),bar=scaleBar(snapshot.extent,width),reserved=[{x:12,y:height-57,width:Math.max(150,bar.pixels+28),height:45},...(snapshot.floodDisplay?.labelBoxes||[])];
  if(snapshot.context.locator?.features?.length)reserved.push({x:width-153,y:12,width:141,height:182});
  const items=gauges.map(gauge=>({anchor:project(gauge.point),width:Math.max(42,ctx.measureText(gauge.label).width+14),height:28})),positions=layoutOutageLabels(items,width,height,{reserved});
  ctx.save();ctx.textAlign='center';ctx.textBaseline='middle';ctx.font='bold 16px Arial';
  gauges.forEach((gauge,index)=>{const [ax,ay]=items[index].anchor,box=positions[index]||{x:Math.max(3,Math.min(width-items[index].width-3,ax+8)),y:Math.max(3,Math.min(height-31,ay-14)),width:items[index].width,height:28},x=box.x+box.width/2,y=box.y+box.height/2;
    ctx.strokeStyle='#344b5a';ctx.lineWidth=1.3;ctx.beginPath();ctx.moveTo(ax,ay);ctx.lineTo(x,y);ctx.stroke();ctx.fillStyle=GAUGE_COLOURS[gauge.category]||GAUGE_COLOURS.unknown;ctx.beginPath();ctx.arc(ax,ay,4,0,Math.PI*2);ctx.fill();
    ctx.fillRect(box.x,box.y,box.width,box.height);ctx.strokeStyle='#fff';ctx.lineWidth=2;ctx.strokeRect(box.x,box.y,box.width,box.height);ctx.fillStyle=['minor','moderate'].includes(gauge.category)?'#17222c':'#fff';ctx.fillText(gauge.label,x,y);gauge.marker={x,y:y+offsetY};
  });ctx.restore();
}
export function gaugeMap(snapshot,gauges){
  const width=snapshot.warning.width,height=snapshot.warning.height,top=70,floodLegend=floodLegendLayout(snapshot.floodDisplay?.legend,width),legendHeight=floodLegend.height+100,c=canvas(width,top+height+legendHeight+78),ctx=c.getContext('2d'),project=transform(snapshot.extent,width,height),kind=snapshot.floodDisplay?.kind||'Flood Warning / Watch';
  ctx.fillStyle='#fff';ctx.fillRect(0,0,c.width,c.height);ctx.fillStyle='#17222c';ctx.font='bold 25px Arial';ctx.fillText('Queensland '+kind+' + River Gauges',16,29);ctx.font='13px Arial';ctx.fillStyle='#58636c';ctx.fillText(snapshot.scopeLabel,16,53);
  ctx.save();ctx.translate(0,top);ctx.beginPath();ctx.rect(0,0,width,height);ctx.clip();ctx.drawImage(snapshot.background,0,0,width,height);
  lines(ctx,snapshot.lgas,project,'rgba(100,108,114,.48)',1);lines(ctx,snapshot.context.coastline,project,'#4a555c',1.2);lines(ctx,snapshot.context.border,project,'#34424b',1.8);ctx.drawImage(snapshot.warning,0,0,width,height);
  drawWarningFocus(ctx,snapshot,width,height);if(snapshot.floodDisplay?.labels)ctx.drawImage(snapshot.floodDisplay.labels,0,0,width,height);ctx.font='bold 16px Arial';drawGaugeMarkers(ctx,snapshot,gauges,width,height,{offsetY:top});annotations(ctx,snapshot.extent,width,height,snapshot.context.locator);
  if(snapshot.demo){ctx.font='bold 32px Arial';ctx.fillStyle='#962632';ctx.fillText('DEMO - SYNTHETIC GAUGES',22,48);}ctx.strokeStyle='#61717b';ctx.lineWidth=1;ctx.strokeRect(.5,.5,width-1,height-1);ctx.restore();
  let y=top+height;ctx.font='bold 12px Arial';ctx.fillStyle='#333';ctx.fillText(kind+' — '+(snapshot.floodDisplay?.legend?'source legend':'source legend unavailable'),16,y+20);
  if(snapshot.floodDisplay?.legend)ctx.drawImage(snapshot.floodDisplay.legend,16,y+27,floodLegend.width,floodLegend.imageHeight);y+=floodLegend.height;
  ctx.font='bold 12px Arial';ctx.fillText('Reported gauge classification',16,y+20);if(snapshot.floodNotice?.scopeGeometries?.length)warningFocusLegend(ctx,width-230,y+16,kind);ctx.font='12px Arial';
  for(const [index,[category,label]]of [['below','Below minor / no flooding'],['minor','Minor'],['moderate','Moderate'],['major','Major'],['unknown','Unknown / not supplied']].entries()){
    const x=16+index*(width-32)/5;ctx.fillStyle=GAUGE_COLOURS[category];ctx.fillRect(x,y+33,20,16);ctx.fillStyle='#333';ctx.fillText(label,x+27,y+46);
  }
  ctx.fillStyle='#58636c';ctx.fillText(gauges.length+' gauges. G numbers match the list/PDF. '+gaugeFlowSummary(gauges),16,y+72);
  const footer=['Generated '+aest(snapshot.generated),snapshot.demo?'Synthetic fixtures - not operational observations.':'Sources: BoM observations / QFD, flood warnings and National Flood Gauge Network; Geofabric © Commonwealth of Australia (BoM) 2022 via Digital Atlas, Geoscience Australia.',snapshot.context.credits?.copyrightText?'Basemap: '+snapshot.context.credits.copyrightText:'Basemap: Esri and contributors.'];
  ctx.font='11px Arial';let fy=top+height+legendHeight+15;for(const line of footer.flatMap(text=>wrap(ctx,text,width-30))){ctx.fillText(line,15,fy);fy+=15;}
  return c;
}
