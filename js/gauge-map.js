import {canvas} from './utils.js';
import {transform} from './geometry.js';
import {annotations} from './renderer.js';
import {layoutOutageLabels} from './map-labels.js';
import {floodLegendLayout,drawFloodLegend,drawWarningFocus,warningFocusLegend,mapReservations} from './flood-display.js';
import {GAUGE_COLOURS} from './gauges.js';
import {shortGaugeName} from './gauge-diagram.js';
import {MAP_TOP,drawMapBase,drawWarningAreas,drawContextImage,drawRivers,drawPlaces,drawMapHeading,mapFooter} from './map-presentation.js';

export function gaugeCounts(gauges){const counts={major:0,moderate:0,minor:0,below:0,unknown:0};for(const gauge of gauges)counts[gauge.category in counts?gauge.category:'unknown']++;return counts;}
export function drawGaugeMarkers(ctx,snapshot,gauges,width,height,{offsetY=0,reserved=[]}={}){
  const project=transform(snapshot.extent,width,height),boxes=[...mapReservations(width,height,snapshot.context?.locator),...(snapshot.floodDisplay?.labelBoxes||[]),...reserved];
  ctx.save();ctx.textAlign='left';ctx.textBaseline='middle';ctx.font='bold 14px Arial';
  const items=gauges.map(gauge=>{const significant=['minor','moderate','major'].includes(gauge.category),name=significant?shortGaugeName(gauge):'',short=name.length>24?name.slice(0,23)+'…':name,text=gauge.label+(short?' · '+short:'');return {anchor:project(gauge.point),width:Math.ceil(ctx.measureText(text).width)+25,height:significant?25:22,text,significant};});
  // Nearby short names are optional. If a cluster cannot accommodate them,
  // retain every G reference in a compact box rather than adding long leaders.
  let positions=layoutOutageLabels(items,width,height,{reserved:boxes,maxDistance:95});
  for(let i=0;i<items.length;i++)if(!positions[i]){items[i].text=gauges[i].label;items[i].width=Math.ceil(ctx.measureText(items[i].text).width)+25;}
  positions=layoutOutageLabels(items,width,height,{reserved:boxes});
  items.forEach((item,i)=>{const gauge=gauges[i],[ax,ay]=item.anchor,box=positions[i]||{x:Math.max(3,Math.min(width-item.width-3,ax+8)),y:Math.max(3,Math.min(height-item.height-3,ay-item.height/2)),width:item.width,height:item.height},x=box.x+box.width/2,y=box.y+box.height/2,colour=GAUGE_COLOURS[gauge.category]||GAUGE_COLOURS.unknown;
    const tx=Math.max(box.x,Math.min(box.x+box.width,ax)),ty=Math.max(box.y,Math.min(box.y+box.height,ay));ctx.strokeStyle='rgba(72,94,108,.65)';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(ax,ay);ctx.lineTo(tx,ty);ctx.stroke();
    ctx.fillStyle=colour;ctx.beginPath();ctx.arc(ax,ay,item.significant?4.5:3,0,Math.PI*2);ctx.fill();ctx.fillStyle='#fff';ctx.fillRect(box.x,box.y,box.width,box.height);ctx.strokeStyle=item.significant?colour:'#a8b5bd';ctx.lineWidth=item.significant?1.6:.8;ctx.strokeRect(box.x+.5,box.y+.5,box.width-1,box.height-1);ctx.fillStyle=colour;ctx.beginPath();ctx.arc(box.x+8,y,3.5,0,Math.PI*2);ctx.fill();ctx.fillStyle='#243e50';ctx.fillText(item.text,box.x+16,y);gauge.marker={x,y:y+offsetY};
  });ctx.restore();return positions;
}
export function gaugeMap(snapshot,gauges){
  const width=snapshot.warning.width,height=snapshot.warning.height,top=MAP_TOP,kind=snapshot.floodDisplay?.kind||'Flood Warning',floodLegend=floodLegendLayout(snapshot.floodDisplay?.legend,width,kind),legendHeight=floodLegend.height+98,probe=canvas(width,1).getContext('2d'),footer=mapFooter(probe,snapshot,width,{gauges:true}),c=canvas(width,top+height+legendHeight+footer.length*15+20),ctx=c.getContext('2d'),counts=gaugeCounts(gauges);
  ctx.fillStyle='#fff';ctx.fillRect(0,0,c.width,c.height);drawMapHeading(ctx,snapshot,'River gauges',width,{summary:gauges.length+' gauges · '+counts.major+' major · '+counts.moderate+' moderate · '+counts.minor+' minor'});
  ctx.save();ctx.translate(0,top);ctx.beginPath();ctx.rect(0,0,width,height);ctx.clip();drawMapBase(ctx,snapshot,width,height);drawWarningAreas(ctx,snapshot,width,height);drawRivers(ctx,snapshot,width,height);drawWarningFocus(ctx,snapshot,width,height);
  if(snapshot.floodDisplay?.labels)drawContextImage(ctx,snapshot,snapshot.floodDisplay.labels,width,height,.6);
  const townBoxes=drawPlaces(ctx,snapshot,width,height,{reserved:[...mapReservations(width,height,snapshot.context?.locator),...(snapshot.floodDisplay?.labelBoxes||[])]});
  drawGaugeMarkers(ctx,snapshot,gauges,width,height,{offsetY:top,reserved:townBoxes});annotations(ctx,snapshot.extent,width,height,snapshot.context?.locator);
  if(snapshot.demo){ctx.font='bold 26px Arial';ctx.fillStyle='#962632';ctx.fillText('DEMO — SYNTHETIC GAUGES',22,42);}ctx.strokeStyle='#9aa9b3';ctx.lineWidth=1;ctx.strokeRect(.5,.5,width-1,height-1);ctx.restore();
  let y=top+height;y+=drawFloodLegend(ctx,snapshot.floodDisplay?.legend,width,y,kind);ctx.strokeStyle='#e1e7eb';ctx.beginPath();ctx.moveTo(16,y);ctx.lineTo(width-16,y);ctx.stroke();ctx.font='bold 12px Arial';ctx.fillStyle='#334552';ctx.fillText('Gauge status — reported at each station',16,y+22);
  if(snapshot.floodNotice?.scopeGeometries?.length)warningFocusLegend(ctx,width-230,y+18,kind);ctx.font='12px Arial';
  for(const [index,[category,label]]of [['below','Below minor / no flooding'],['minor','Minor'],['moderate','Moderate'],['major','Major'],['unknown','Unknown / not supplied']].entries()){
    const x=16+index*(width-32)/5;ctx.fillStyle=GAUGE_COLOURS[category];ctx.beginPath();ctx.arc(x+5,y+43,4,0,Math.PI*2);ctx.fill();ctx.fillStyle='#334552';ctx.fillText(label+' ('+counts[category]+')',x+18,y+47);
  }
  ctx.fillStyle='#586875';ctx.fillText('G numbers link to station readings and graphs in the gauge PDF. Individual observation times are listed in the index.',16,y+75);
  ctx.font='11px Arial';footer.forEach((line,i)=>ctx.fillText(line,16,top+height+legendHeight+14+i*15));return c;
}
