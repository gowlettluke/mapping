import {aest,checkAbort} from './utils.js';
import {externalPhotoLink} from './cameras.js';
import {photoLayout} from './pdf.js';
import {gaugeReading,gaugeTiming} from './gauges.js';
import {gaugeFlowLabel,gaugeFlowSummary} from './gauge-flow.js';
import {gaugeDiagramPdf} from './gauge-diagram.js';

const ascii=value=>String(value??'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[\u2010-\u2015]/g,'-').replace(/[^\x20-\x7e\n]/g,' ');
const gaugeRows=20,gaugeTextColours={major:[177,32,47],moderate:[148,111,0],minor:[26,114,69]};
const gaugeColour=gauge=>gaugeTextColours[gauge.category]||[45,56,65];
const shortTime=date=>date?aest(date).replace(/ AEST$/,''):'Not supplied';
export function floodPdfPlan(gaugeCount,photoCount,{graphsPerPage=4,flowDiagramPages=0}={}){
  if(!Number.isInteger(gaugeCount)||gaugeCount<0||!Number.isInteger(photoCount)||photoCount<0||gaugeCount+photoCount===0)throw new Error('No gauges or eligible camera photographs are available for this report.');
  if(![4,6].includes(graphsPerPage))throw new Error('Unsupported graph page layout.');
  if(!Number.isInteger(flowDiagramPages)||flowDiagramPages<0||!gaugeCount&&flowDiagramPages)throw new Error('Invalid river flow diagram pages.');let next=1;const plan={gaugeCount,photoCount,graphsPerPage};
  if(gaugeCount){plan.gaugeOverview=next++;if(flowDiagramPages){plan.gaugeFlow=next;plan.gaugeFlowPages=flowDiagramPages;next+=flowDiagramPages;}plan.gaugeSummary=next;plan.gaugeSummaryPages=Math.ceil(gaugeCount/gaugeRows);next+=plan.gaugeSummaryPages;plan.gaugeGraphs=next;plan.gaugeGraphPages=Math.ceil(gaugeCount/graphsPerPage);next+=plan.gaugeGraphPages;}
  if(photoCount){plan.cameraOverview=next++;plan.cameraIndex=next;plan.cameraIndexPages=Math.ceil(photoCount/24);next+=plan.cameraIndexPages;plan.cameraPhotos=next;plan.cameraPhotoPages=Math.ceil(photoCount/6);next+=plan.cameraPhotoPages;}
  plan.total=next-1;return plan;
}
export function floodReportPdf({jsPDF,snapshot,gauges=[],graphs=[],photos=[],gaugeOverview=null,flowDiagrams=[],cameraOverview=null,notes=[],signal,graphsPerPage=4}){
  const plan=floodPdfPlan(gauges.length,photos.length,{graphsPerPage,flowDiagramPages:flowDiagrams.length});checkAbort(signal);if(typeof jsPDF!=='function')throw new Error('The bundled PDF library did not load. Reload the page.');
  if(gauges.length&&!gaugeOverview||photos.length&&!cameraOverview)throw new Error('The report overview map is unavailable.');
  const doc=new jsPDF({orientation:'landscape',unit:'mm',format:'a4',compress:true}),graphFor=label=>graphs.find(entry=>entry.gauge.label===label),now=snapshot.generated.getTime();let page=0;
  function newPage(title){checkAbort(signal);if(page++)doc.addPage();doc.setFont('helvetica','bold');doc.setFontSize(15);doc.setTextColor(24,42,55);doc.text(ascii(title)+(snapshot.demo?' - DEMO / SYNTHETIC':''),9,12);
    doc.setFont('helvetica','normal');doc.setFontSize(8);doc.setTextColor(70);doc.text(ascii('Generated '+aest(snapshot.generated)),9,18);doc.setDrawColor(198,209,216);doc.line(9,21,288,21);doc.text('Page '+page+' of '+plan.total,288,204,{align:'right'});
    let x=9;for(const [label,target]of [['Gauge map',plan.gaugeOverview],['River flow',plan.gaugeFlow],['Gauge index',plan.gaugeSummary],['Camera map',plan.cameraOverview],['Camera index',plan.cameraIndex]])if(target){doc.text(label,x,204);doc.link(x,199,29,7,{pageNumber:target});x+=34;}
  }
  function imageFit(image,x,y,width,height,format='JPEG'){const scale=Math.min(width/image.width,height/image.height),w=image.width*scale,h=image.height*scale,ix=x+(width-w)/2,iy=y+(height-h)/2;doc.addImage(image.data,format,ix,iy,w,h);return {x:ix,y:iy,width:w,height:h};}
  function sourceLink(url,x,y,width,height){const link=externalPhotoLink(url);if(link)doc.link(x,y,width,height,{url:link});}
  if(gauges.length){
    newPage('Flood Situation Report - River Gauges');const box=imageFit(gaugeOverview,9,26,218,165);doc.setFontSize(9);doc.setTextColor(30,47,60);let y=31;
    for(const text of [snapshot.scopeLabel,gauges.length+' gauges in the selected flood area.','G numbers link to graph pages.',gaugeFlowSummary(gauges),...notes]){const lines=doc.splitTextToSize(ascii(text),53);doc.text(lines,233,y);y+=lines.length*4+7;}
    for(let i=0;i<gauges.length;i++){const marker=gauges[i].marker;if(marker)doc.link(box.x+marker.x/gaugeOverview.width*box.width-3,box.y+marker.y/gaugeOverview.height*box.height-3,6,6,{pageNumber:plan.gaugeGraphs+Math.floor(i/plan.graphsPerPage)});}
    for(const [index,diagram]of flowDiagrams.entries()){
      newPage('River Flow - '+(diagram.system||((index+1)+' of '+flowDiagrams.length)));
      if(diagram.layoutVersion===2){const targets=gaugeDiagramPdf(doc,snapshot,diagram);for(const node of targets){const gaugeIndex=gauges.findIndex(gauge=>gauge.label===node.label);if(gaugeIndex<0)continue;
          const target=node.context&&node.homeSheet&&node.homeSheet!==index+1?plan.gaugeFlow+node.homeSheet-1:plan.gaugeGraphs+Math.floor(gaugeIndex/plan.graphsPerPage);doc.link(node.x,node.y,node.width,node.height,{pageNumber:target});
        }continue;}
      const box=imageFit(diagram,9,26,279,166);
      for(const node of diagram.nodes||[]){const gaugeIndex=gauges.findIndex(gauge=>gauge.label===node.label);if(gaugeIndex<0)continue;
        doc.link(box.x+node.x/diagram.width*box.width,box.y+node.y/diagram.height*box.height,node.width/diagram.width*box.width,node.height/diagram.height*box.height,{pageNumber:plan.gaugeGraphs+Math.floor(gaugeIndex/plan.graphsPerPage)});
      }
    }
    for(let p=0;p<plan.gaugeSummaryPages;p++){
      newPage('River Gauge Index');const columns=[['Ref',12],['River / tributary',50],['Gauge / station ID',85],['Level (m)',21],['Classification',34],['Trend',23],['Observed (AEST)',54]],subset=gauges.slice(p*gaugeRows,(p+1)*gaugeRows),rowHeight=7.7,top=27;
      doc.setDrawColor(202,213,220);doc.rect(9,top,279,8+subset.length*rowHeight);doc.setFont('helvetica','bold');doc.setFontSize(8);doc.setTextColor(30,47,60);let x=9;
      for(const [title,width]of columns){doc.text(title,x+2,top+5);if(x>9)doc.line(x,top,x,top+8+subset.length*rowHeight);x+=width;}doc.line(9,top+8,288,top+8);
      subset.forEach((gauge,i)=>{const index=p*gaugeRows+i,y=top+8+i*rowHeight,flag=gaugeTiming(gauge,now).length?' *':'',values=[gauge.label,gaugeFlowLabel(gauge),gauge.name+(gauge.stationId?' ['+gauge.stationId+']':''),gauge.height===null?'Not supplied':gauge.height.toLocaleString('en-AU',{maximumFractionDigits:3}),gauge.reportedCategory,gauge.trend||'Not supplied',shortTime(gauge.observedAt)+flag];let x=9;
        if(i&&gauge.flowGroupId&&gauge.flowGroupId!==subset[i-1].flowGroupId){doc.setDrawColor(116,139,152);doc.line(9,y,288,y);doc.setDrawColor(202,213,220);}
        doc.setTextColor(...gaugeColour(gauge));values.forEach((value,col)=>{doc.setFont('helvetica',col<5?'bold':'normal');let size=7.5;doc.setFontSize(size);let lines=doc.splitTextToSize(ascii(value),columns[col][1]-4);while(lines.length>2&&size>6){size-=.5;doc.setFontSize(size);lines=doc.splitTextToSize(ascii(value),columns[col][1]-4);}if(lines.length>2)lines=[lines[0],lines[1].replace(/.{3}$/,'...')];doc.text(lines,x+2,y+3.1,{lineHeightFactor:1.1});x+=columns[col][1];});
        doc.link(9,y,279,rowHeight,{pageNumber:plan.gaugeGraphs+Math.floor(index/plan.graphsPerPage)});doc.line(9,y+rowHeight,288,y+rowHeight);
      });
      doc.setFont('helvetica','normal');doc.setFontSize(6.5);doc.setTextColor(80);if(subset.some(gauge=>gaugeTiming(gauge,now).length))doc.text('* Check observation or feed-update time in the source.',9,194);
      let legendX=202;for(const category of ['major','moderate','minor']){doc.setTextColor(...gaugeTextColours[category]);doc.text(category[0].toUpperCase()+category.slice(1),legendX,194);legendX+=29;}
    }
    const graphColumns=plan.graphsPerPage===6?3:2,graphWidth=(279-(graphColumns-1)*4)/graphColumns,graphHeight=82.5;
    for(let p=0;p<plan.gaugeGraphPages;p++){
      newPage('River Gauge Graphs');gauges.slice(p*plan.graphsPerPage,(p+1)*plan.graphsPerPage).forEach((gauge,i)=>{const x=9+i%graphColumns*(graphWidth+4),y=26+Math.floor(i/graphColumns)*(graphHeight+4),entry=graphFor(gauge.label);doc.setDrawColor(202,213,220);doc.rect(x,y,graphWidth,graphHeight);doc.setFont('helvetica','bold');doc.setFontSize(8);doc.setTextColor(30,47,60);const title=doc.splitTextToSize(ascii(gauge.label+' - '+gauge.name+(gauge.stationId?' ['+gauge.stationId+']':'')),graphWidth-6).slice(0,2);doc.text(title,x+3,y+4.5);doc.setFont('helvetica','normal');doc.setFontSize(6.5);doc.setTextColor(80);const group=doc.splitTextToSize(ascii(gaugeFlowLabel(gauge)),graphWidth-6).slice(0,2);doc.text(group,x+3,y+title.length*3.1+4.5,{lineHeightFactor:1.1});const titleHeight=title.length*3.1+group.length*2.5+3;
        if(entry?.graph){const box=imageFit(entry.graph,x+3,y+titleHeight,graphWidth-6,graphHeight-titleHeight-10,entry.graph.format||'PNG');sourceLink(gauge.sourceUrl||gauge.graphUrl,box.x,box.y,box.width,box.height);}
        else{doc.setFontSize(9);doc.setTextColor(110);doc.text(ascii(entry?.reason||'Graph unavailable'),x+graphWidth/2,y+graphHeight/2,{align:'center',maxWidth:graphWidth-6});doc.setFontSize(7);const link=externalPhotoLink(gauge.sourceUrl||gauge.graphUrl);if(link){doc.setTextColor(25,75,111);doc.text('Open source',x+3,y+graphHeight/2+8);sourceLink(link,x+3,y+graphHeight/2+3,35,8);}}
        doc.setFont('helvetica','normal');doc.setFontSize(6);doc.setTextColor(...gaugeColour(gauge));doc.text(ascii(gaugeReading(gauge)+' | Observed: '+shortTime(gauge.observedAt)),x+3,y+graphHeight-6,{maxWidth:graphWidth-6});doc.setTextColor(80);doc.text(ascii('Feed: '+shortTime(gauge.updatedAt)+' | Graph retrieved: '+(entry?.graph?shortTime(entry.graph.retrievedAt)+' AEST':'Unavailable')),x+3,y+graphHeight-3,{maxWidth:graphWidth-6});
      });
    }
  }
  if(photos.length){
    newPage('Flood Situation Report - Camera Overview');const box=imageFit(cameraOverview,9,26,235,165);doc.setFontSize(9);doc.setTextColor(40);let noteY=33;for(const text of [photos.length+' camera photographs.','Numbers link to photos.','Capture times may be unverified.',...notes]){const lines=doc.splitTextToSize(ascii(text),39);doc.text(lines,249,noteY);noteY+=lines.length*4+5;}
    for(let i=0;i<photos.length;i++){const marker=photos[i].camera.marker;if(marker)doc.link(box.x+marker.x/cameraOverview.width*box.width-2.5,box.y+marker.y/cameraOverview.height*box.height-2.5,5,5,{pageNumber:plan.cameraPhotos+Math.floor(i/6)});}
    for(let p=0;p<plan.cameraIndexPages;p++){
      newPage('Camera Index');photos.slice(p*24,(p+1)*24).forEach((entry,i)=>{const index=p*24+i,x=9+(i>=12?143:0),y=29+(i%12)*13.4;doc.setFontSize(9);doc.setTextColor(25,75,111);doc.text(ascii((index+1)+'. '+entry.camera.name),x,y,{maxWidth:134});doc.link(x,y-4,135,12,{pageNumber:plan.cameraPhotos+Math.floor(index/6)});});
    }
    for(let p=0;p<plan.cameraPhotoPages;p++){
      newPage('Camera Photographs');const subset=photos.slice(p*6,(p+1)*6),layout=photoLayout(subset.length);
      subset.forEach((entry,i)=>{const index=p*6+i,x=9+i%layout.columns*(layout.width+4),y=26+Math.floor(i/layout.columns)*(layout.height+4),photo=entry.photo;doc.setDrawColor(202,213,220);doc.rect(x,y,layout.width,layout.height);doc.setFont('helvetica','bold');doc.setFontSize(9);doc.setTextColor(30,47,60);const title=doc.splitTextToSize(ascii((index+1)+'. '+entry.camera.name),layout.width-6).slice(0,3);doc.text(title,x+3,y+5);const titleH=title.length*3.7+4,box=imageFit(photo,x+3,y+titleH,layout.width-6,layout.height-titleH-18);sourceLink(entry.camera.url,box.x,box.y,box.width,box.height);
        doc.setFont('helvetica','normal');doc.setFontSize(7);doc.setTextColor(80);doc.text([ascii(entry.camera.sourceLabel),photo.capturedAt?'Captured '+aest(photo.capturedAt):'Capture time unverified','Retrieved '+aest(photo.retrievedAt)],x+3,y+layout.height-12);
      });
    }
  }
  if(page!==plan.total)throw new Error('Report page layout could not be verified.');checkAbort(signal);return doc;
}
