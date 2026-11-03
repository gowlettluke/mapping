import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {gaugeFlowNetwork,gaugeDiagramLayout,drawGaugeDiagram,shortGaugeName,gaugeDiagramPdf} from '../js/gauge-diagram.js';
import {orderGaugesByFlow} from '../js/gauge-flow.js';
import {floodPdfPlan,floodReportPdf} from '../js/flood-pdf.js';
import {setCanvasFactory} from '../js/utils.js';

const gauge=(label,flowDownstream=[],extra={})=>({label,id:label,stationId:label,name:'Example River at '+label,river:'Example River',point:[145,-25],height:3.15,reportedCategory:'Minor',category:'minor',trend:'Steady',observedAt:new Date('2026-11-04T00:00:00Z'),updatedAt:new Date('2026-11-04T00:00:00Z'),flowDownstream,...extra});
const edgeKeys=network=>network.edges.map(edge=>edge.from+'>'+edge.to).sort();

test('the schematic reduces downstream reachability to the next selected gauges',()=>{
  const network=gaugeFlowNetwork([gauge('G1',['G2','G3']),gauge('G2',['G3']),gauge('G3')]);
  assert.deepEqual(edgeKeys(network),['G1>G2','G2>G3']);
  assert.deepEqual(edgeKeys(gaugeFlowNetwork([gauge('G1',['G3']),gauge('G3')])),['G1>G3']);
});
test('tributary joins and river forks survive without invented links between their branches',()=>{
  const input=[gauge('G1',['G3','G4']),gauge('G2',['G3','G4'],{river:'Tributary Creek'}),gauge('G3',['G4']),gauge('G4')];
  assert.deepEqual(edgeKeys(gaugeFlowNetwork(input)),['G1>G3','G2>G3','G3>G4']);
  const fork=[gauge('G1',['G2','G3','G4']),gauge('G2',['G4']),gauge('G3',['G4']),gauge('G4')];
  assert.deepEqual(edgeKeys(gaugeFlowNetwork(fork)),['G1>G2','G1>G3','G2>G4','G3>G4']);
  const page=gaugeDiagramLayout(fork).pages[0];assert.equal(page.nodes.length,4);assert.equal(new Set(page.nodes.map(node=>node.railX)).size,2);
  const node=label=>page.nodes.find(node=>node.label===label);assert.ok(node('G1').y<node('G2').y&&node('G1').y<node('G3').y&&node('G3').y<node('G4').y);
});
test('verified connections cross river groups but moved or unmatched gauges never inherit arrows',()=>{
  const point=[145,-25],reference={schemaVersion:1,retrievedUtc:'2026-11-04T00:00:00Z',stationCount:3,stations:[{id:'1',point,river:'Tributary Creek',basin:'Basin',downstream:['2','3']},{id:'2',point,river:'Main River',basin:'Basin',downstream:['3']},{id:'3',point,river:'Main River',basin:'Basin',downstream:[]}]};
  const input=[gauge('old',[],{id:'1',stationId:'1'}),gauge('old',[],{id:'2',stationId:'2'}),gauge('old',[],{id:'3',stationId:'3',point:[150,-25]})];
  const output=orderGaugesByFlow(input,reference),a=output.find(gauge=>gauge.stationId==='1'),b=output.find(gauge=>gauge.stationId==='2'),moved=output.find(gauge=>gauge.stationId==='3');
  assert.deepEqual(a.flowDownstream,[b.label]);assert.deepEqual(moved.flowDownstream,[]);assert.deepEqual(edgeKeys(gaugeFlowNetwork(output)),[a.label+'>'+b.label]);
  assert.ok(orderGaugesByFlow(input,null).every(gauge=>!gauge.flowDownstream.length));
  reference.stations[2].downstream=['1'];assert.ok(orderGaugesByFlow(input,reference).every(gauge=>!gauge.flowDownstream.length&&gauge.flowOrder==='unconfirmed'));
});
test('same names and nearby locations do not create river connections; invalid cycles have no arrows',()=>{
  const input=[gauge('G1'),gauge('G2')],layout=gaugeDiagramLayout(input);assert.equal(layout.edges.length,0);assert.equal(layout.pages.length,0);assert.equal(layout.unconnected.length,2);
  assert.equal(gaugeFlowNetwork([gauge('G1',['G2']),gauge('G2',['G1'])]).invalid,true);assert.equal(gaugeDiagramLayout([gauge('G1',['G2']),gauge('G2',['G1'])]).edges.length,0);
  assert.throws(()=>gaugeFlowNetwork([gauge('G1'),gauge('G1')]),/unique/);assert.deepEqual(gaugeDiagramLayout([]).pages,[]);
});
test('long river reaches use balanced panels with receiving gauges and no isolated-gauge pages',()=>{
  const input=[];for(let branch=0;branch<5;branch++)for(let position=0;position<13;position++){const label='G'+(branch*13+position+1),next=position<12?['G'+(branch*13+position+2)]:[];input.push(gauge(label,next));}
  input.push(gauge('G66',[],{flowOrder:'unconfirmed'}));const layout=gaugeDiagramLayout(input),placed=layout.pages.flatMap(page=>page.nodes),home=placed.filter(node=>!node.context);
  assert.equal(home.length,65);assert.equal(new Set(home.map(node=>node.label)).size,65);assert.deepEqual(layout.unconnected.map(gauge=>gauge.label),['G66']);assert.ok(layout.pages.length<=5);assert.ok(layout.pages.every(page=>page.nodes.filter(node=>!node.context).length>=5));
  const location=new Map(layout.pages.flatMap(page=>page.nodes.filter(node=>!node.context).map(node=>[node.label,page.number])));
  for(const node of placed.filter(node=>node.context))assert.equal(node.homeSheet,location.get(node.label));
  for(const edge of layout.edges)assert.ok(layout.pages.some(page=>page.edges.some(candidate=>candidate.from===edge.from&&candidate.to===edge.to)),'Missing connection '+edge.from+'>'+edge.to);
  for(const page of layout.pages)for(const [i,a]of page.nodes.entries()){assert.ok(a.x>=0&&a.y>=150&&a.x+a.width<1800&&a.y+a.height<946);assert.ok(a.fontSize>=(a.context?20:24));for(const b of page.nodes.slice(i+1))assert.ok(a.x+a.width<=b.x||b.x+b.width<=a.x||a.y+a.height<=b.y||b.y+b.height<=a.y);}
});
test('diagram systems do not mix unrelated basins and unconnected gauges add no sheets',()=>{
  const input=[gauge('G1',['G2'],{basin:'Condamine basin'}),gauge('G2',[],{basin:'Condamine basin'}),gauge('G3',['G4'],{basin:'Burnett basin'}),gauge('G4',[],{basin:'Burnett basin'})],layout=gaugeDiagramLayout(input);assert.equal(layout.pages.length,2);for(const page of layout.pages)assert.equal(new Set(page.nodes.map(node=>node.gauge.basin)).size,1);
  const unknown=Array.from({length:59},(_,i)=>gauge('U'+i,[],{flowOrder:'unconfirmed'})),unconnected=gaugeDiagramLayout(unknown);assert.equal(unconnected.pages.length,0);assert.equal(unconnected.unconnected.length,59);
});
test('the Lower Condamine example stays on one connected diagram with all sixteen selected gauges',async()=>{
  const reference=JSON.parse(await readFile(new URL('../data/gauge-flow.json',import.meta.url),'utf8')),ids=new Set(['541054','541156','541071','041517','542008','542019','042098','541122','541154','541204','541117','541162','541118','541203','541205','542036']);
  const input=reference.stations.filter(station=>ids.has(station.id)).map(station=>gauge('old',[],{id:station.id,stationId:station.id,point:station.point,basin:station.basin,name:station.id==='541118'?'Jandowae (Jandowae Creek)':station.river+' at Example '+station.id,river:''})),ordered=orderGaugesByFlow(input,reference),layout=gaugeDiagramLayout(ordered);
  assert.equal(ordered.length,16);assert.equal(layout.pages.length,1);assert.equal(layout.pages[0].panels.length,1);assert.equal(layout.pages[0].nodes.length,16);assert.ok(layout.pages[0].nodes.every(node=>!node.context&&node.fontSize>=24));assert.ok(layout.pages[0].nodes.some(node=>node.riverHead&&node.gauge.river==='Jandowae Creek'));
});
test('compact diagram names retain station identity and source readings without repeating index fields',()=>{
  assert.equal(shortGaugeName(gauge('G1',[],{name:'Example River at Brigalow Bridge'})),'Brigalow Bridge');assert.equal(shortGaugeName(gauge('G1',[],{name:'Brigalow Bridge (Example River)'})),'Brigalow Bridge');
  const text=[],ctx={measureText:value=>({width:String(value).length*8}),fillRect(){},strokeRect(){},beginPath(){},moveTo(){},lineTo(){},stroke(){},closePath(){},arc(){},fill(){},fillText(value,x,y){text.push({value,x,y,colour:this.fillStyle});}};
  setCanvasFactory((width,height)=>({width,height,getContext:()=>ctx}));const snapshot={generated:new Date('2026-11-04T03:00:00Z'),scopeLabel:'Synthetic flood area',demo:true},input=[gauge('G1',['G2'],{height:50,category:'unknown',reportedCategory:'No Classification',marker:{x:5,y:7}}),gauge('G2')],page=gaugeDiagramLayout(input).pages[0];
  const result=drawGaugeDiagram(snapshot,page);assert.equal(result.width,1800);assert.equal(result.height,1080);assert.deepEqual(input[0].marker,{x:5,y:7});assert.ok(text.some(item=>item.value.includes('50 m')&&item.colour==='#697783'));assert.ok(text.some(item=>item.value.includes('50 m')&&item.value.endsWith('*')));assert.ok(!text.some(item=>item.value.includes('No Classification')));assert.ok(text.some(item=>item.value.includes('SYNTHETIC')));assert.ok(text.every(item=>item.y>0&&item.y<1080));
  const controller=new AbortController();controller.abort();assert.throws(()=>drawGaugeDiagram(snapshot,page,{signal:controller.signal}),{name:'AbortError'});
});
test('PDF river stations are readable vector text with preserved graph-link areas',()=>{
  const texts=[],snapshot={generated:new Date('2026-11-04T00:00:00Z')},page=gaugeDiagramLayout([gauge('G1',['G2'],{name:'Example River at Upper Bridge'}),gauge('G2',[],{name:'Example River at Lower Bridge'})]).pages[0];let size=0;
  const pdf={setDrawColor(){},setLineWidth(){},line(){},setFillColor(){},rect(){},circle(){},setFont(){},setFontSize(value){size=value;},setTextColor(){},splitTextToSize(value){return [value];},text(value){texts.push({value:String(value),size});}};
  const links=gaugeDiagramPdf(pdf,snapshot,page);assert.equal(links.length,2);assert.ok(texts.some(text=>text.value.includes('Upper Bridge')&&text.size>=9));assert.ok(texts.some(text=>text.value.includes('3.15 m')&&text.size>=9));assert.ok(links.every(link=>link.x>=9&&link.y>=26&&link.x+link.width<=288&&link.y+link.height<=192));
});
test('PDF flow pages shift map, table, graph and camera destinations together',()=>{
  const gauges=Array.from({length:21},(_,index)=>gauge('G'+(index+1))),diagrams=[0,1].map(index=>({data:'synthetic flow '+index,width:1800,height:1080,nodes:[{label:gauges[index*20].label,x:100,y:200,width:400,height:138}]})),plan=floodPdfPlan(21,1,{flowDiagramPages:2}),links=[],titles=[],images=[];let page=1;
  class PDF{addPage(){page++;}setFont(){}setFontSize(){}setTextColor(){}setDrawColor(){}line(){}rect(){}text(value){titles.push({page,value:String(value)});}link(x,y,width,height,target){links.push({page,x,y,width,height,...target});}splitTextToSize(value){return [value];}addImage(data,type,x,y,width,height){images.push({page,data,x,y,width,height});}}
  const overview={data:'synthetic overview',width:100,height:100},photos=[{camera:{name:'Synthetic camera',sourceLabel:'Synthetic source',marker:{x:10,y:10}},photo:{...overview,retrievedAt:new Date()}}];
  floodReportPdf({jsPDF:PDF,snapshot:{generated:new Date('2026-11-04T00:00:00Z'),scopeLabel:'Synthetic scope'},gauges,flowDiagrams:diagrams,photos,gaugeOverview:overview,cameraOverview:overview});
  assert.equal(plan.gaugeFlow,2);assert.equal(plan.gaugeSummary,4);assert.equal(plan.gaugeGraphs,6);assert.equal(plan.cameraOverview,12);assert.equal(page,plan.total);assert.equal(titles.filter(item=>item.value.startsWith('River Flow')).length,2);
  assert.ok(links.some(item=>item.page===2&&item.pageNumber===plan.gaugeGraphs));assert.ok(links.some(item=>item.page===3&&item.pageNumber===plan.gaugeGraphs+5));assert.ok(links.every(item=>!item.pageNumber||item.pageNumber>=1&&item.pageNumber<=plan.total));
  assert.ok(images.filter(item=>String(item.data).startsWith('synthetic flow')).every(item=>item.x>=9&&item.y>=26&&item.x+item.width<=288&&item.y+item.height<=192));
  assert.throws(()=>floodPdfPlan(0,1,{flowDiagramPages:1}),/Invalid/);assert.throws(()=>floodPdfPlan(1,0,{flowDiagramPages:-1}),/Invalid/);
});
