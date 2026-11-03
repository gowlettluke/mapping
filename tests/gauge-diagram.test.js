import test from 'node:test';
import assert from 'node:assert/strict';
import {gaugeFlowNetwork,gaugeDiagramLayout,drawGaugeDiagram} from '../js/gauge-diagram.js';
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
  const page=gaugeDiagramLayout(fork).pages[0];assert.equal(page.nodes.length,4);assert.equal(new Set(page.nodes.map(node=>node.column)).size,2);
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
  const input=[gauge('G1'),gauge('G2')],layout=gaugeDiagramLayout(input);assert.equal(layout.edges.length,0);assert.ok(layout.pages.every(page=>page.unconnected));
  assert.equal(gaugeFlowNetwork([gauge('G1',['G2']),gauge('G2',['G1'])]).invalid,true);assert.equal(gaugeDiagramLayout([gauge('G1',['G2']),gauge('G2',['G1'])]).edges.length,0);
  assert.throws(()=>gaugeFlowNetwork([gauge('G1'),gauge('G1')]),/unique/);assert.deepEqual(gaugeDiagramLayout([]).pages,[]);
});
test('large networks paginate legibly and every cross-sheet connection retains both references',()=>{
  const input=[];for(let branch=0;branch<5;branch++)for(let position=0;position<13;position++){const label='G'+(branch*13+position+1),next=position<12?['G'+(branch*13+position+2)]:[];input.push(gauge(label,next));}
  input.push(gauge('G66',[],{flowOrder:'unconfirmed'}));const layout=gaugeDiagramLayout(input),placed=layout.pages.flatMap(page=>page.nodes);
  assert.equal(placed.length,input.length);assert.equal(new Set(placed.map(node=>node.label)).size,input.length);assert.ok(layout.pages.length>1);assert.ok(layout.pages.every(page=>page.nodes.length<=15));
  const location=new Map(layout.pages.flatMap(page=>page.nodes.map(node=>[node.label,{node,page}])));
  for(const edge of layout.edges){const a=location.get(edge.from),b=location.get(edge.to);if(a.page===b.page)assert.ok(a.node.railY<b.node.railY);else{assert.ok(a.node.to.some(item=>item.label===b.node.label&&item.sheet===b.page.number));assert.ok(b.node.from.some(item=>item.label===a.node.label&&item.sheet===a.page.number));}}
  for(const page of layout.pages)for(const [i,a]of page.nodes.entries()){assert.ok(a.x>=0&&a.y>=150&&a.x+a.width<1800&&a.y+a.height<943);for(const b of page.nodes.slice(i+1))assert.ok(a.x+a.width<=b.x||b.x+b.width<=a.x||a.y+a.height<=b.y||b.y+b.height<=a.y);}
});
test('diagram text retains source readings and times, flags old data and preserves map marker locations',()=>{
  const text=[],circles=[],ctx={measureText:value=>({width:String(value).length*8}),fillRect(){},strokeRect(){},beginPath(){},moveTo(){},lineTo(){},stroke(){},closePath(){},arc(){circles.push(this.fillStyle);},fill(){},fillText(value,x,y){text.push({value,x,y,colour:this.fillStyle});}};
  setCanvasFactory((width,height)=>({width,height,getContext:()=>ctx}));const snapshot={generated:new Date('2026-11-04T03:00:00Z'),scopeLabel:'Synthetic flood area',demo:true},input=[gauge('G1',[],{height:50,category:'unknown',reportedCategory:'No Classification',flowOrder:'unconfirmed',marker:{x:5,y:7}})],page=gaugeDiagramLayout(input).pages[0];
  const result=drawGaugeDiagram(snapshot,page);assert.equal(result.width,1800);assert.equal(result.height,1080);assert.deepEqual(input[0].marker,{x:5,y:7});assert.ok(text.some(item=>item.value.includes('50 m')&&item.colour==='#697783'));assert.ok(text.some(item=>item.value.includes('Observed')&&item.value.endsWith('*')));assert.ok(text.some(item=>item.value==='Connection unconfirmed'));assert.ok(text.some(item=>item.value.includes('SYNTHETIC')));assert.ok(text.every(item=>item.y>0&&item.y<1080));
  const controller=new AbortController();controller.abort();assert.throws(()=>drawGaugeDiagram(snapshot,page,{signal:controller.signal}),{name:'AbortError'});
});
test('PDF flow pages shift map, table, graph and camera destinations together',()=>{
  const gauges=Array.from({length:21},(_,index)=>gauge('G'+(index+1))),diagrams=[0,1].map(index=>({data:'synthetic flow '+index,width:1800,height:1080,nodes:[{label:gauges[index*20].label,x:100,y:200,width:400,height:138}]})),plan=floodPdfPlan(21,1,{flowDiagramPages:2}),links=[],titles=[],images=[];let page=1;
  class PDF{addPage(){page++;}setFont(){}setFontSize(){}setTextColor(){}setDrawColor(){}line(){}rect(){}text(value){titles.push({page,value:String(value)});}link(x,y,width,height,target){links.push({page,x,y,width,height,...target});}splitTextToSize(value){return [value];}addImage(data,type,x,y,width,height){images.push({page,data,x,y,width,height});}}
  const overview={data:'synthetic overview',width:100,height:100},photos=[{camera:{name:'Synthetic camera',sourceLabel:'Synthetic source',marker:{x:10,y:10}},photo:{...overview,retrievedAt:new Date()}}];
  floodReportPdf({jsPDF:PDF,snapshot:{generated:new Date('2026-11-04T00:00:00Z'),scopeLabel:'Synthetic scope'},gauges,flowDiagrams:diagrams,photos,gaugeOverview:overview,cameraOverview:overview});
  assert.equal(plan.gaugeFlow,2);assert.equal(plan.gaugeSummary,4);assert.equal(plan.gaugeGraphs,6);assert.equal(plan.cameraOverview,12);assert.equal(page,plan.total);assert.equal(titles.filter(item=>item.value.startsWith('River Gauge Flow')).length,2);
  assert.ok(links.some(item=>item.page===2&&item.pageNumber===plan.gaugeGraphs));assert.ok(links.some(item=>item.page===3&&item.pageNumber===plan.gaugeGraphs+5));assert.ok(links.every(item=>!item.pageNumber||item.pageNumber>=1&&item.pageNumber<=plan.total));
  assert.ok(images.filter(item=>String(item.data).startsWith('synthetic flow')).every(item=>item.x>=9&&item.y>=26&&item.x+item.width<=288&&item.y+item.height<=192));
  assert.throws(()=>floodPdfPlan(0,1,{flowDiagramPages:1}),/Invalid/);assert.throws(()=>floodPdfPlan(1,0,{flowDiagramPages:-1}),/Invalid/);
});
