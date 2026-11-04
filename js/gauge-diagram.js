import {canvas,aest,checkAbort} from './utils.js';
import {gaugeTiming,GAUGE_COLOURS,GAUGE_TEXT_COLOURS,gaugeBadgeTextColour} from './gauges.js';

const width=1800,height=1080,body={x:40,y:132,width:1720,height:800},rowPitch=68;
const blue='#187da6',ink='#203e50',muted='#526b79';
const colours=GAUGE_TEXT_COLOURS;
const compare=(a,b)=>a.index-b.index;

// The reference gives downstream reachability, not the location of each
// confluence. Reduce it to the next selected gauges; never connect equal river
// names or nearby coordinates by inference.
export function gaugeFlowNetwork(gauges){
  const nodes=gauges.map((gauge,index)=>({gauge,label:gauge.label,index})),lookup=new Map(nodes.map(node=>[node.label,node]));
  if(lookup.size!==nodes.length)throw new Error('Gauge diagram references must be unique.');
  const next=new Map(nodes.map(node=>[node,new Set((node.gauge.flowDownstream||[]).map(label=>lookup.get(label)).filter(other=>other&&other!==node))]));
  const incoming=new Map(nodes.map(node=>[node,0]));for(const targets of next.values())for(const target of targets)incoming.set(target,incoming.get(target)+1);
  const ordered=nodes.filter(node=>!incoming.get(node));for(let i=0;i<ordered.length;i++)for(const target of next.get(ordered[i])){incoming.set(target,incoming.get(target)-1);if(!incoming.get(target))ordered.push(target);}
  if(ordered.length!==nodes.length)return {nodes,edges:[],invalid:true};
  const reachable=new Map();for(const node of [...ordered].reverse()){const targets=new Set(next.get(node));for(const target of next.get(node))for(const further of reachable.get(target))targets.add(further);reachable.set(node,targets);}
  const edges=[];for(const node of nodes)for(const target of next.get(node))if(![...next.get(node)].some(other=>other!==target&&reachable.get(other).has(target)))edges.push({from:node.label,to:target.label});
  return {nodes,edges,invalid:false};
}


function graphMetrics(nodes,edges){
  const lookup=new Map(nodes.map(node=>[node.label,node])),next=new Map(nodes.map(node=>[node,[]])),previous=new Map(nodes.map(node=>[node,[]]));
  for(const edge of edges){const a=lookup.get(edge.from),b=lookup.get(edge.to);if(a&&b){next.get(a).push(b);previous.get(b).push(a);}}
  const degree=new Map(nodes.map(node=>[node,previous.get(node).length])),top=nodes.filter(node=>!degree.get(node)).sort(compare),level=new Map();for(const node of top)level.set(node,0);
  for(let i=0;i<top.length;i++)for(const target of next.get(top[i])){level.set(target,Math.max(level.get(target)||0,level.get(top[i])+1));degree.set(target,degree.get(target)-1);if(!degree.get(target))top.push(target);}
  const depth=Math.max(0,...level.values()),distance=new Map();for(const node of [...top].reverse()){const value=Math.max(0,...next.get(node).map(target=>distance.get(target)+1));distance.set(node,value);level.set(node,depth-value);}
  const unused=new Set(nodes),lanes=[];
  while(unused.size){let node=[...unused].sort((a,b)=>level.get(b)-level.get(a)||compare(a,b))[0];const lane=[];
    while(node){lane.unshift(node);unused.delete(node);const river=node.gauge.river;node=previous.get(node).filter(other=>unused.has(other)).sort((a,b)=>Number(b.gauge.river===river)-Number(a.gauge.river===river)||level.get(b)-level.get(a)||compare(a,b))[0];}
    const first=level.get(lane[0]),last=level.get(lane.at(-1)),reusable=lanes.find(existing=>level.get(existing.at(-1))<first||last<level.get(existing[0]));
    if(reusable){reusable.push(...lane);reusable.sort((a,b)=>level.get(a)-level.get(b));}else lanes.unshift(lane);
  }
  const outlet=nodes.filter(node=>!next.get(node).length).sort((a,b)=>level.get(b)-level.get(a)||compare(a,b))[0];return {lanes,level,rows:depth+1,outlet};
}
function makePanel(nodes,edges,title){const metrics=graphMetrics(nodes,edges);return {nodes,edges,title,metrics,width:Math.min(body.width,metrics.lanes.length*500),height:44+metrics.rows*rowPitch};}
function packPanels(panels){
  const pages=[];
  for(const panel of [...panels].sort((a,b)=>b.height-a.height||b.width-a.width)){
    let placed=false;for(const page of pages){const slot=page.free.filter(rect=>rect.width>=panel.width&&rect.height>=panel.height).sort((a,b)=>a.width*a.height-b.width*b.height)[0];if(!slot)continue;
      page.free.splice(page.free.indexOf(slot),1);page.panels.push({...panel,x:slot.x,y:slot.y});const gap=18;
      if(slot.width-panel.width>gap)page.free.push({x:slot.x+panel.width+gap,y:slot.y,width:slot.width-panel.width-gap,height:panel.height});
      if(slot.height-panel.height>gap)page.free.push({x:slot.x,y:slot.y+panel.height+gap,width:slot.width,height:slot.height-panel.height-gap});placed=true;break;
    }
    if(!placed){const page={panels:[],free:[{...body}]};pages.push(page);const slot=page.free.pop();page.panels.push({...panel,x:slot.x,y:slot.y});
      if(slot.width-panel.width>18)page.free.push({x:slot.x+panel.width+18,y:slot.y,width:slot.width-panel.width-18,height:panel.height});
      if(slot.height-panel.height>18)page.free.push({x:slot.x,y:slot.y+panel.height+18,width:slot.width,height:slot.height-panel.height-18});
    }
  }return pages;
}
export function gaugeDiagramLayout(gauges){
  const network=gaugeFlowNetwork(gauges),lookup=new Map(network.nodes.map(node=>[node.label,node])),neighbours=new Map(network.nodes.map(node=>[node,[]]));
  for(const edge of network.edges){const a=lookup.get(edge.from),b=lookup.get(edge.to);neighbours.get(a).push(b);neighbours.get(b).push(a);}
  const remaining=new Set(network.nodes.filter(node=>neighbours.get(node).length)),systems=new Map();
  while(remaining.size){const start=[...remaining].sort(compare)[0],nodes=[start],seen=new Set(nodes);remaining.delete(start);
    for(let i=0;i<nodes.length;i++)for(const next of neighbours.get(nodes[i]))if(!seen.has(next)){seen.add(next);nodes.push(next);remaining.delete(next);}
    const edges=network.edges.filter(edge=>seen.has(lookup.get(edge.from))&&seen.has(lookup.get(edge.to))),metrics=graphMetrics(nodes,edges),river=metrics.outlet.gauge.river||'River network',basin=metrics.outlet.gauge.basin||river;
    if(!systems.has(basin))systems.set(basin,[]);const panels=systems.get(basin),whole=makePanel(nodes,edges,river);
    if(metrics.lanes.length<=5&&whole.height<=body.height){if(nodes.some(node=>node.gauge.river!==river))whole.title+=' and tributaries';panels.push(whole);continue;}
    // Large networks use complete river/reach panels ending at an actual
    // receiving gauge. A receiver can repeat, with a link to its home diagram.
    const groups=new Map();for(const node of nodes){const key=node.gauge.flowGroupId||node.gauge.river||river;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(node);}
    for(const group of groups.values()){
      group.sort((a,b)=>metrics.level.get(a)-metrics.level.get(b)||compare(a,b));const count=Math.ceil(group.length/9),size=Math.ceil(group.length/count);
      for(let start=0;start<group.length;start+=size){const home=group.slice(start,start+size),homeLabels=new Set(home.map(node=>node.label)),receivers=[];
        for(const edge of edges)if(homeLabels.has(edge.from)&&!homeLabels.has(edge.to)){const target=lookup.get(edge.to);if(!receivers.some(node=>node.label===target.label))receivers.push({...target,context:true});}
        const selected=[...home,...receivers],selectedLabels=new Set(selected.map(node=>node.label)),panelEdges=edges.filter(edge=>selectedLabels.has(edge.from)&&selectedLabels.has(edge.to)),name=group[0].gauge.river||river,panel=makePanel(selected,panelEdges,name+(count>1?' — reach '+(Math.floor(start/size)+1)+' of '+count:''));
        if(panel.height>body.height)throw new Error('This river network exceeds the readable diagram layout. Gauge readings remain in the index.');panels.push(panel);
      }
    }
  }
  const pages=[];for(const [system,panels]of systems)for(const page of packPanels(panels)){page.system=system;pages.push(page);}
  const homeSheet=new Map();pages.forEach((page,index)=>page.panels.forEach(panel=>panel.nodes.forEach(node=>{if(!node.context)homeSheet.set(node.label,index+1);})));
  for(const [index,page]of pages.entries()){
    if(page.panels.length===1){const panel=page.panels[0];panel.x=body.x;panel.y=body.y;panel.width=body.width;panel.height=body.height;}
    page.number=index+1;page.total=pages.length;page.layoutVersion=2;page.invalid=network.invalid;page.nodes=[];page.edges=[];
    for(const [panelIndex,panel]of page.panels.entries()){const columns=panel.metrics.lanes.length,pitch=Math.min(128,(panel.height-44)/panel.metrics.rows),columnWidth=panel.width/columns,cardWidth=Math.min(520,columnWidth-58),cardHeight=Math.min(88,pitch-6);panel.heading={x:panel.x+8,y:panel.y+27};
      panel.metrics.lanes.forEach((lane,column)=>{for(const [position,original]of lane.entries()){const centre=panel.x+(column+.5)*columnWidth,railX=centre-(cardWidth+40)/2,y=panel.y+38+panel.metrics.level.get(original)*pitch,previous=lane[position-1],riverHead=!original.context&&(!previous||previous.gauge.river!==original.gauge.river||!panel.edges.some(edge=>edge.from===previous.label&&edge.to===original.label));
        page.nodes.push({...original,key:panelIndex+':'+original.label,x:railX+34,y,width:cardWidth,height:cardHeight,railX,railY:y+23,fontSize:original.context?20:24,readingSize:original.context?18:22,riverHead,homeSheet:homeSheet.get(original.label)});
      }});page.edges.push(...panel.edges.map(edge=>({...edge,fromKey:panelIndex+':'+edge.from,toKey:panelIndex+':'+edge.to})));
    }delete page.free;
  }
  return {pages,edges:network.edges,invalid:network.invalid,unconnected:network.nodes.filter(node=>!neighbours.get(node).length).map(node=>node.gauge)};
}
export function shortGaugeName(gauge){
  let name=String(gauge.name||''),river=String(gauge.river||'').trim();
  if(river){const escaped=river.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');name=name.replace(new RegExp('^'+escaped+'\\s+(?:at|@)\\s+','i'),'').replace(new RegExp('\\s*\\('+escaped+'\\s*\\)\\s*$','i'),'');}
  return name.trim()||gauge.name||'Unnamed gauge';
}
const levelText=gauge=>Number.isFinite(gauge.height)?gauge.height.toLocaleString('en-AU',{maximumFractionDigits:3})+' m':'Height unavailable';
function stationText(node,snapshot){const gauge=node.gauge,flag=gaugeTiming(gauge,snapshot.generated.getTime()).length?' *':'';return {name:shortGaugeName(gauge),context:node.context?'Joins '+node.label+(node.homeSheet?' · diagram '+node.homeSheet:''):'',reading:levelText(gauge)+(gauge.trend?' · '+gauge.trend:'')+flag};}
function textLines(ctx,value,maxWidth,maxLines=1){
  const words=String(value||'').split(/\s+/),lines=[];let line='';
  for(const word of words){const next=line?line+' '+word:word;if(line&&ctx.measureText(next).width>maxWidth){lines.push(line);line=word;}else line=next;}if(line)lines.push(line);
  const result=lines.slice(0,maxLines);if(lines.length>maxLines&&result.length)result[result.length-1]+='…';
  for(let i=0;i<result.length;i++)if(ctx.measureText(result[i]).width>maxWidth){let text=result[i];while(text&&ctx.measureText(text+'…').width>maxWidth)text=text.slice(0,-1);result[i]=text+'…';}return result;
}
function edgeSegments(from,to){const bend=to.y-4;return [[from.railX,from.railY,from.railX,bend],[from.railX,bend,to.railX,bend],[to.railX,bend,to.railX,to.railY-20]];}
function arrow(ctx,x,y){ctx.fillStyle=blue;ctx.beginPath();ctx.moveTo(x,y+7);ctx.lineTo(x-7,y-6);ctx.lineTo(x+7,y-6);ctx.closePath();ctx.fill();}
export function drawGaugeDiagram(snapshot,page,{signal}={}){
  checkAbort(signal);const c=canvas(width,height),ctx=c.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,width,height);ctx.fillStyle=ink;ctx.font='bold 32px Arial';ctx.fillText('River flow · '+page.system,40,44);ctx.font='18px Arial';ctx.fillStyle=muted;ctx.fillText(textLines(ctx,snapshot.scopeLabel,width-330)[0]||'',40,76);ctx.fillText('Arrows point downstream · schematic, not to scale · G numbers match the index and graphs',40,106);
  ctx.textAlign='right';ctx.font='bold 18px Arial';ctx.fillText('Diagram '+page.number+' of '+page.total,width-40,44);ctx.textAlign='left';if(snapshot.demo){ctx.fillStyle='#b1202f';ctx.fillText('DEMO — SYNTHETIC READINGS',width-390,106);}
  const lookup=new Map(page.nodes.map(node=>[node.key,node]));for(const edge of page.edges){const from=lookup.get(edge.fromKey),to=lookup.get(edge.toKey);if(!from||!to)continue;const segments=edgeSegments(from,to);ctx.lineJoin='round';ctx.beginPath();for(const [x1,y1,x2,y2]of segments){ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);}ctx.strokeStyle='#fff';ctx.lineWidth=12;ctx.stroke();ctx.strokeStyle=blue;ctx.lineWidth=6;ctx.stroke();arrow(ctx,to.railX,to.railY-24);}
  ctx.fillStyle=ink;ctx.font='bold 23px Arial';for(const panel of page.panels)ctx.fillText(textLines(ctx,panel.title,panel.width-16)[0],panel.heading.x,panel.heading.y);
  for(const node of page.nodes){checkAbort(signal);const colour=colours[node.gauge.category]||colours.unknown,text=stationText(node,snapshot);ctx.fillStyle=node.context?'#eaf4f9':'#f7fafb';ctx.strokeStyle=node.context?blue:'#cedce3';ctx.lineWidth=1.4;ctx.fillRect(node.x,node.y,node.width,node.height);ctx.strokeRect(node.x,node.y,node.width,node.height);
    ctx.fillStyle=GAUGE_COLOURS[node.gauge.category]||GAUGE_COLOURS.unknown;ctx.beginPath();ctx.arc(node.railX,node.railY,18,0,Math.PI*2);ctx.fill();ctx.fillStyle=gaugeBadgeTextColour(node.gauge.category);ctx.font='bold 17px Arial';ctx.textAlign='center';ctx.fillText(node.label,node.railX,node.railY+5);ctx.textAlign='left';
    ctx.fillStyle=ink;ctx.font='bold '+node.fontSize+'px Arial';const title=node.context?[text.context,text.name]:textLines(ctx,text.name,node.width-20,1);title.forEach((line,index)=>ctx.fillText(textLines(ctx,line,node.width-20)[0]||'',node.x+10,node.y+(node.context?18:26)+index*18));
    ctx.fillStyle=colour;ctx.font='bold '+node.readingSize+'px Arial';const readingWidth=ctx.measureText(text.reading).width;ctx.fillText(textLines(ctx,text.reading,node.width-20)[0],node.x+10,node.y+node.height-8);
    if(node.riverHead){ctx.font='18px Arial';if(readingWidth+ctx.measureText(node.gauge.river).width+24<node.width-20){ctx.fillStyle=blue;ctx.textAlign='right';ctx.fillText(node.gauge.river,node.x+node.width-10,node.y+node.height-8);ctx.textAlign='left';}}
  }
  ctx.strokeStyle='#cedce3';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(40,946);ctx.lineTo(width-40,946);ctx.stroke();let x=40;ctx.font='18px Arial';
  for(const [category,label]of [['major','Major'],['moderate','Moderate'],['minor','Minor'],['below','Below minor'],['unknown','Unknown / not supplied']]){ctx.fillStyle=GAUGE_COLOURS[category];ctx.beginPath();ctx.arc(x+8,970,8,0,Math.PI*2);ctx.fill();ctx.fillStyle=ink;ctx.fillText(label,x+25,976);x+=ctx.measureText(label).width+66;}
  ctx.fillStyle=muted;ctx.font='17px Arial';ctx.fillText('Levels and trends are source readings. Observation times, classification and unconnected gauges are in the index. * Check data time.',40,1005);ctx.fillText('Connections are verified; junction positions are simplified and intermediate locations may be omitted.',40,1030);ctx.font='14px Arial';ctx.fillText('Generated '+aest(snapshot.generated)+' · BoM / QFD observations · BoM Geofabric © Commonwealth of Australia 2022 via Digital Atlas, Geoscience Australia.',40,1058);checkAbort(signal);return c;
}
const rgb=hex=>[1,3,5].map(offset=>parseInt(hex.slice(offset,offset+2),16));
const pdfText=value=>String(value??'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[\u2010-\u2015]/g,'-').replace(/·/g,'|').replace(/[^\x20-\x7e]/g,' ');
function pdfOneLine(doc,value,width){const text=pdfText(value),parts=doc.splitTextToSize(text,width);if(parts.length<=1)return text;let first=parts[0];while(first&&doc.getTextWidth&&doc.getTextWidth(first+'...')>width)first=first.slice(0,-1);return first+'...';}
// PDF labels and lines remain vector content, so zooming does not enlarge a
// JPEG of already-small text. Canvas is retained for the standalone download.
export function gaugeDiagramPdf(doc,snapshot,page,{x=9,y=26,width:availableWidth=279,height:availableHeight=166}={}){
  const scale=Math.min(availableWidth/body.width,(availableHeight-25)/body.height),px=value=>x+(value-body.x)*scale,py=value=>y+(value-body.y)*scale,points=pixels=>pixels*scale*72/25.4,lookup=new Map(page.nodes.map(node=>[node.key,node])),links=[];
  function line(x1,y1,x2,y2,colour=blue,size=6){doc.setDrawColor(...rgb(colour));doc.setLineWidth(size*scale);doc.line(px(x1),py(y1),px(x2),py(y2));}
  for(const edge of page.edges){const from=lookup.get(edge.fromKey),to=lookup.get(edge.toKey);if(!from||!to)continue;const segments=edgeSegments(from,to);for(const colour of ['#ffffff',blue])for(const segment of segments)line(...segment,colour,colour===blue?6:12);line(to.railX-7,to.railY-30,to.railX,to.railY-17);line(to.railX+7,to.railY-30,to.railX,to.railY-17);}
  doc.setFont('helvetica','bold');doc.setFontSize(points(23));doc.setTextColor(...rgb(ink));for(const panel of page.panels)doc.text(pdfText(panel.title),px(panel.heading.x),py(panel.heading.y),{maxWidth:panel.width*scale-3});
  for(const node of page.nodes){const colour=colours[node.gauge.category]||colours.unknown,text=stationText(node,snapshot);doc.setFillColor(...rgb(node.context?'#eaf4f9':'#f7fafb'));doc.setDrawColor(...rgb(node.context?blue:'#cedce3'));doc.setLineWidth(.2);doc.rect(px(node.x),py(node.y),node.width*scale,node.height*scale,'FD');doc.setFillColor(...rgb(GAUGE_COLOURS[node.gauge.category]||GAUGE_COLOURS.unknown));doc.circle(px(node.railX),py(node.railY),18*scale,'F');doc.setFont('helvetica','bold');doc.setFontSize(points(17));doc.setTextColor(...rgb(gaugeBadgeTextColour(node.gauge.category)));doc.text(node.label,px(node.railX),py(node.railY+5),{align:'center'});
    doc.setFontSize(points(node.fontSize));doc.setTextColor(...rgb(ink));const maxWidth=(node.width-20)*scale,title=(node.context?[text.context,text.name]:[text.name]).map(value=>pdfOneLine(doc,value,maxWidth));doc.text(title,px(node.x+10),py(node.y+(node.context?18:26)),{lineHeightFactor:18/node.fontSize});
    doc.setFontSize(points(node.readingSize));doc.setTextColor(...rgb(colour));const readingWidth=doc.getTextWidth?.(pdfText(text.reading))??Infinity;doc.text(pdfOneLine(doc,text.reading,maxWidth),px(node.x+10),py(node.y+node.height-8));
    if(node.riverHead){doc.setFont('helvetica','normal');doc.setFontSize(points(18));const name=pdfText(node.gauge.river),riverWidth=doc.getTextWidth?.(name)??Infinity;if(readingWidth+riverWidth+24*scale<maxWidth){doc.setTextColor(...rgb(blue));doc.text(name,px(node.x+node.width-10),py(node.y+node.height-8),{align:'right'});}}
    links.push({label:node.label,x:px(node.x-34),y:py(node.y),width:(node.width+34)*scale,height:node.height*scale,context:node.context,homeSheet:node.homeSheet});
  }
  const footer=y+body.height*scale+7;doc.setFont('helvetica','normal');doc.setFontSize(8);let legendX=x;for(const [category,label]of [['major','Major'],['moderate','Moderate'],['minor','Minor'],['below','Below minor'],['unknown','Unknown / not supplied']]){doc.setFillColor(...rgb(GAUGE_COLOURS[category]));doc.circle(legendX+1,footer-1,1,'F');doc.setTextColor(...rgb(ink));doc.text(label,legendX+4,footer);legendX+=category==='unknown'?44:category==='below'?30:25;}
  doc.setTextColor(...rgb(muted));doc.setFontSize(7.5);doc.text('G numbers match the index and graphs. Times and unconnected gauges remain in the index. * Check data time.',x,footer+5);doc.text('Verified connections; junctions and spacing are schematic. Receiving gauges may repeat at tributary joins.',x,footer+9);doc.text('BoM / QFD observations. Geofabric (c) Commonwealth of Australia (BoM) 2022 via Digital Atlas, Geoscience Australia.',x,footer+13);return links;
}
