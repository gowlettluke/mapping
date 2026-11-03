import {canvas,aest,checkAbort} from './utils.js';
import {gaugeReading,gaugeTiming} from './gauges.js';

const width=1800,height=1080,columns=3,rows=5,cardWidth=484,cardHeight=138;
const blue='#187da6',ink='#203e50',muted='#526b79';
const colours={major:'#b1202f',moderate:'#927000',minor:'#1a7245',below:'#387f84',unknown:'#697783'};
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

export function gaugeDiagramLayout(gauges){
  const network=gaugeFlowNetwork(gauges),lookup=new Map(network.nodes.map(node=>[node.label,node])),next=new Map(network.nodes.map(node=>[node,[]])),previous=new Map(network.nodes.map(node=>[node,[]]));
  for(const edge of network.edges){const a=lookup.get(edge.from),b=lookup.get(edge.to);next.get(a).push(b);previous.get(b).push(a);}
  const remaining=new Set(network.nodes.filter(node=>next.get(node).length||previous.get(node).length)),lanes=[];
  while(remaining.size){
    const start=[...remaining].sort(compare)[0],component=new Set([start]),queue=[start];remaining.delete(start);
    for(let i=0;i<queue.length;i++)for(const neighbour of [...next.get(queue[i]),...previous.get(queue[i])])if(!component.has(neighbour)){component.add(neighbour);queue.push(neighbour);remaining.delete(neighbour);}
    const degree=new Map([...component].map(node=>[node,previous.get(node).length])),top=[...component].filter(node=>!degree.get(node)).sort(compare);
    for(const node of top)node.level=0;
    for(let i=0;i<top.length;i++)for(const target of next.get(top[i])){target.level=Math.max(target.level||0,top[i].level+1);degree.set(target,degree.get(target)-1);if(!degree.get(target))top.push(target);}
    const depth=Math.max(...top.map(node=>node.level)),distanceToOutlet=new Map();
    for(const node of [...top].reverse()){const distance=Math.max(0,...next.get(node).map(target=>distanceToOutlet.get(target)+1));distanceToOutlet.set(node,distance);node.level=depth-distance;}
    // Keep the longest main stem on the right, with tributaries in adjacent
    // lanes. Forks remain separate lanes with explicit connections.
    const unused=new Set(component),componentLanes=[];
    while(unused.size){
      let node=[...unused].sort((a,b)=>b.level-a.level||compare(a,b))[0];const lane=[];
      while(node){lane.unshift(node);unused.delete(node);const river=node.gauge.river;
        node=previous.get(node).filter(other=>unused.has(other)).sort((a,b)=>Number(b.gauge.river===river)-Number(a.gauge.river===river)||b.level-a.level||compare(a,b))[0];
      }
      const first=lane[0].level,last=lane.at(-1).level,reusable=componentLanes.find(existing=>existing.at(-1).level<first||last<existing[0].level);
      if(reusable){reusable.push(...lane);reusable.sort((a,b)=>a.level-b.level);}else componentLanes.unshift(lane);
    }
    lanes.push(...componentLanes);
  }
  const pages=[];
  for(let left=0;left<lanes.length;left+=columns){const subset=lanes.slice(left,left+columns),levels=[...new Set(subset.flat().map(node=>node.level))].sort((a,b)=>a-b);
    for(let top=0;top<levels.length;top+=rows){const selected=levels.slice(top,top+rows),nodes=[];
      subset.forEach((lane,column)=>{for(const node of lane){const row=selected.indexOf(node.level);if(row>=0)nodes.push({...node,column,row});}});
      const active=[...new Set(nodes.map(node=>node.column))].sort((a,b)=>a-b);for(const node of nodes)node.column=active.indexOf(node.column);
      pages.push({nodes,edges:network.edges,columns:active.length,unconnected:false});
    }
  }
  const isolated=network.nodes.filter(node=>!next.get(node).length&&!previous.get(node).length);
  for(let start=0;start<isolated.length;start+=columns*rows)pages.push({nodes:isolated.slice(start,start+columns*rows).map((node,index)=>({...node,column:index%columns,row:Math.floor(index/columns)})),edges:[],columns:Math.min(columns,isolated.length-start),unconnected:true});
  const sheetFor=new Map();pages.forEach((page,index)=>page.nodes.forEach(node=>sheetFor.set(node.label,index+1)));
  pages.forEach((page,index)=>{page.number=index+1;page.total=pages.length;page.invalid=network.invalid;page.nodes=page.nodes.map(node=>{
    const x=42+(columns-page.columns)*286+node.column*572,y=168+node.row*154;
    const from=network.edges.filter(edge=>edge.to===node.label&&sheetFor.get(edge.from)!==page.number).map(edge=>({label:edge.from,sheet:sheetFor.get(edge.from)}));
    const to=network.edges.filter(edge=>edge.from===node.label&&sheetFor.get(edge.to)!==page.number).map(edge=>({label:edge.to,sheet:sheetFor.get(edge.to)}));
    return {...node,x:x+47,y,width:cardWidth,height:cardHeight,railX:x+20,railY:y+35,from,to};
  });});
  return {pages,edges:network.edges,invalid:network.invalid};
}

function textLines(ctx,value,maxWidth,maxLines=1){
  const words=String(value||'').split(/\s+/),lines=[];let line='';
  for(const word of words){const next=line?line+' '+word:word;if(line&&ctx.measureText(next).width>maxWidth){lines.push(line);line=word;}else line=next;}if(line)lines.push(line);
  const result=lines.slice(0,maxLines);if(lines.length>maxLines&&result.length)result[result.length-1]+='…';
  for(let i=0;i<result.length;i++)if(ctx.measureText(result[i]).width>maxWidth){let text=result[i];while(text&&ctx.measureText(text+'…').width>maxWidth)text=text.slice(0,-1);result[i]=text+'…';}return result;
}
function arrow(ctx,x,y){ctx.fillStyle=blue;ctx.beginPath();ctx.moveTo(x,y+9);ctx.lineTo(x-8,y-5);ctx.lineTo(x+8,y-5);ctx.closePath();ctx.fill();}
function connection(ctx,from,to){
  const bend=to.y-8;ctx.lineJoin='round';ctx.beginPath();ctx.moveTo(from.railX,from.railY);ctx.lineTo(from.railX,bend);ctx.lineTo(to.railX,bend);ctx.lineTo(to.railX,to.railY);
  // A white casing makes line crossings distinct from river joins.
  ctx.strokeStyle='#fff';ctx.lineWidth=13;ctx.stroke();ctx.strokeStyle=blue;ctx.lineWidth=7;ctx.stroke();
  arrow(ctx,to.railX,to.railY-25);
}
export function drawGaugeDiagram(snapshot,page,{signal}={}){
  checkAbort(signal);const c=canvas(width,height),ctx=c.getContext('2d'),now=snapshot.generated.getTime();
  ctx.fillStyle='#fff';ctx.fillRect(0,0,width,height);ctx.fillStyle=ink;ctx.font='bold 34px Arial';ctx.fillText('River gauge flow',40,46);ctx.font='18px Arial';ctx.fillStyle=muted;ctx.fillText(textLines(ctx,snapshot.scopeLabel,width-80)[0]||'',40,77);
  ctx.font='20px Arial';ctx.fillStyle=ink;ctx.fillText(page.unconnected?'Other selected gauges — no confirmed connection shown':'Upstream at top · arrows point downstream · schematic, not to scale',40,113);
  ctx.textAlign='right';ctx.font='bold 18px Arial';ctx.fillText('Sheet '+page.number+' of '+page.total,width-40,46);ctx.textAlign='left';
  if(snapshot.demo){ctx.fillStyle='#b1202f';ctx.font='bold 18px Arial';ctx.fillText('DEMO — SYNTHETIC READINGS',width-400,113);}
  const lookup=new Map(page.nodes.map(node=>[node.label,node]));
  for(const edge of page.edges){const from=lookup.get(edge.from),to=lookup.get(edge.to);if(from&&to)connection(ctx,from,to);}
  for(const node of page.nodes){checkAbort(signal);const gauge=node.gauge,colour=colours[gauge.category]||colours.unknown,notes=gaugeTiming(gauge,now),time=gauge.observedAt?aest(gauge.observedAt):'Not supplied';
    if(node.from.length){ctx.strokeStyle=blue;ctx.lineWidth=7;ctx.beginPath();ctx.moveTo(node.railX,node.y+4);ctx.lineTo(node.railX,node.railY);ctx.stroke();arrow(ctx,node.railX,node.railY-25);}
    if(node.to.length){ctx.strokeStyle=blue;ctx.lineWidth=7;ctx.beginPath();ctx.moveTo(node.railX,node.railY);ctx.lineTo(node.railX,node.y+126);ctx.stroke();arrow(ctx,node.railX,node.y+125);}
    ctx.fillStyle='#f7fafb';ctx.strokeStyle='#cedce3';ctx.lineWidth=1.5;ctx.fillRect(node.x,node.y,node.width,node.height);ctx.strokeRect(node.x,node.y,node.width,node.height);
    ctx.fillStyle=colour;ctx.beginPath();ctx.arc(node.railX,node.railY,13,0,Math.PI*2);ctx.fill();ctx.strokeStyle='#fff';ctx.lineWidth=3;ctx.stroke();
    ctx.fillStyle=ink;ctx.font='bold 21px Arial';textLines(ctx,gauge.label+' · '+gauge.name,node.width-24,2).forEach((line,index)=>ctx.fillText(line,node.x+12,node.y+24+index*23));
    ctx.font='16px Arial';ctx.fillStyle=muted;ctx.fillText(textLines(ctx,(gauge.river||'River not supplied')+(gauge.stationId?' · '+gauge.stationId:''),node.width-24)[0],node.x+12,node.y+66);
    ctx.fillStyle=colour;ctx.font='bold 19px Arial';ctx.fillText(textLines(ctx,gaugeReading(gauge),node.width-24)[0],node.x+12,node.y+88);
    ctx.fillStyle=muted;ctx.font='15px Arial';ctx.fillText(textLines(ctx,'Observed '+time+(notes.length?' *':''),node.width-24)[0],node.x+12,node.y+108);
    const continuations=[...node.from.map(item=>'From '+item.label+' (sheet '+item.sheet+')'),...node.to.map(item=>'To '+item.label+' (sheet '+item.sheet+')')];
    const detail=continuations.join(' · ')||(page.unconnected?(gauge.flowOrder==='unconfirmed'?'Connection unconfirmed':'No link to another selected gauge'):'');
    ctx.fillStyle=continuations.length?blue:muted;ctx.fillText(textLines(ctx,detail,node.width-24)[0]||'',node.x+12,node.y+128);
  }
  ctx.strokeStyle='#cedce3';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(40,943);ctx.lineTo(width-40,943);ctx.stroke();
  let x=40;ctx.font='17px Arial';for(const [category,label]of [['major','Major'],['moderate','Moderate'],['minor','Minor'],['below','Below minor'],['unknown','Unknown / not supplied']]){ctx.fillStyle=colours[category];ctx.beginPath();ctx.arc(x+9,968,8,0,Math.PI*2);ctx.fill();ctx.fillStyle=ink;ctx.fillText(label,x+26,974);x+=ctx.measureText(label).width+68;}
  ctx.fillStyle=muted;ctx.font='16px Arial';ctx.fillText(page.unconnected?'No arrows are inferred from gauge names or proximity.': 'Blue arrows show verified downstream connections; junctions and spacing are simplified. Intermediate locations may be omitted.',40,1002);
  ctx.fillText('* Check observation / feed-update time in the index or source. G numbers match the map, index and graph pages.',40,1026);
  ctx.font='14px Arial';ctx.fillText('Generated '+aest(snapshot.generated)+' · Observations: BoM / QFD · Network: BoM Geofabric © Commonwealth of Australia 2022 via Digital Atlas, Geoscience Australia.',40,1055);
  checkAbort(signal);return c;
}
