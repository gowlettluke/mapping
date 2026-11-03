import {aest,checkAbort} from './utils.js';
import {externalPhotoLink} from './cameras.js';
import {photoLayout} from './pdf.js';
import {gaugeReading,gaugeTime,gaugeTiming} from './gauges.js';

const ascii=value=>String(value??'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[\u2010-\u2015]/g,'-').replace(/[^\x20-\x7e\n]/g,' ');
export function floodPdfPlan(gaugeCount,photoCount){
  if(!Number.isInteger(gaugeCount)||gaugeCount<0||!Number.isInteger(photoCount)||photoCount<0||gaugeCount+photoCount===0)throw new Error('No gauges or eligible camera photographs are available for this report.');
  let next=1;const plan={gaugeCount,photoCount};
  if(gaugeCount){plan.gaugeOverview=next++;plan.gaugeSummary=next;plan.gaugeSummaryPages=Math.ceil(gaugeCount/10);next+=plan.gaugeSummaryPages;plan.gaugeGraphs=next;plan.gaugeGraphPages=Math.ceil(gaugeCount/2);next+=plan.gaugeGraphPages;}
  if(photoCount){plan.cameraOverview=next++;plan.cameraIndex=next;plan.cameraIndexPages=Math.ceil(photoCount/24);next+=plan.cameraIndexPages;plan.cameraPhotos=next;plan.cameraPhotoPages=Math.ceil(photoCount/6);next+=plan.cameraPhotoPages;}
  plan.total=next-1;return plan;
}
export function floodReportPdf({jsPDF,snapshot,gauges=[],graphs=[],photos=[],gaugeOverview=null,cameraOverview=null,notes=[],signal}){
  const plan=floodPdfPlan(gauges.length,photos.length);checkAbort(signal);if(typeof jsPDF!=='function')throw new Error('The bundled PDF library did not load. Reload the page.');
  if(gauges.length&&!gaugeOverview||photos.length&&!cameraOverview)throw new Error('The report overview map is unavailable.');
  const doc=new jsPDF({orientation:'landscape',unit:'mm',format:'a4',compress:true}),graphFor=label=>graphs.find(entry=>entry.gauge.label===label),now=snapshot.generated.getTime();let page=0;
  function newPage(title){checkAbort(signal);if(page++)doc.addPage();doc.setFont('helvetica','bold');doc.setFontSize(15);doc.setTextColor(24,42,55);doc.text(ascii(title)+(snapshot.demo?' - DEMO / SYNTHETIC':''),9,12);
    doc.setFont('helvetica','normal');doc.setFontSize(8);doc.setTextColor(70);doc.text(ascii('Generated '+aest(snapshot.generated)),9,18);doc.setDrawColor(198,209,216);doc.line(9,21,288,21);doc.text('Page '+page+' of '+plan.total,288,204,{align:'right'});
    let x=9;for(const [label,target]of [['Gauge map',plan.gaugeOverview],['Gauge index',plan.gaugeSummary],['Camera map',plan.cameraOverview],['Camera index',plan.cameraIndex]])if(target){doc.text(label,x,204);doc.link(x,199,29,7,{pageNumber:target});x+=34;}
  }
  function imageFit(image,x,y,width,height,format='JPEG'){const scale=Math.min(width/image.width,height/image.height),w=image.width*scale,h=image.height*scale,ix=x+(width-w)/2,iy=y+(height-h)/2;doc.addImage(image.data,format,ix,iy,w,h);return {x:ix,y:iy,width:w,height:h};}
  function sourceLink(url,x,y,width,height){const link=externalPhotoLink(url);if(link)doc.link(x,y,width,height,{url:link});}
  if(gauges.length){
    newPage('Flood Situation Report - River Gauges');const box=imageFit(gaugeOverview,9,26,218,165);doc.setFontSize(9);doc.setTextColor(30,47,60);let y=31;
    for(const text of [snapshot.scopeLabel,gauges.length+' gauges in the selected flood area.','G numbers link to graph pages.','Heights, classifications and trends are reported by the source.',...notes]){const lines=doc.splitTextToSize(ascii(text),53);doc.text(lines,233,y);y+=lines.length*4+7;}
    for(let i=0;i<gauges.length;i++){const marker=gauges[i].marker;if(marker)doc.link(box.x+marker.x/gaugeOverview.width*box.width-3,box.y+marker.y/gaugeOverview.height*box.height-3,6,6,{pageNumber:plan.gaugeGraphs+Math.floor(i/2)});}
    for(let p=0;p<plan.gaugeSummaryPages;p++){
      newPage('River Gauge Index');doc.setFontSize(8);doc.setTextColor(50);doc.text('Observation time and feed update time are separate. Graphs may show a different update time.',9,29);
      gauges.slice(p*10,(p+1)*10).forEach((gauge,i)=>{const index=p*10+i,y=39+i*15.2;doc.setFont('helvetica','bold');doc.setFontSize(9);doc.setTextColor(25,75,111);doc.text(ascii(gauge.label+'  '+gauge.name+(gauge.stationId?' ['+gauge.stationId+']':'')),9,y,{maxWidth:275});doc.link(9,y-4,279,15,{pageNumber:plan.gaugeGraphs+Math.floor(index/2)});
        doc.setFont('helvetica','normal');doc.setFontSize(8);doc.setTextColor(45);doc.text(ascii(gaugeReading(gauge)),9,y+4.5,{maxWidth:275});doc.setTextColor(80);doc.setFontSize(7);doc.text(ascii('Observed: '+gaugeTime(gauge.observedAt)+' | Feed updated: '+gaugeTime(gauge.updatedAt)),9,y+8.3,{maxWidth:275});
        const timing=gaugeTiming(gauge,now);if(timing.length){doc.setTextColor(155,83,15);doc.text(ascii(timing.join('; ')),9,y+12,{maxWidth:275});}
      });
    }
    for(let p=0;p<plan.gaugeGraphPages;p++){
      newPage('River Gauge Graphs');gauges.slice(p*2,(p+1)*2).forEach((gauge,i)=>{const y=26+i*84,entry=graphFor(gauge.label);doc.setDrawColor(202,213,220);doc.rect(9,y,279,80);doc.setFont('helvetica','bold');doc.setFontSize(9);doc.setTextColor(30,47,60);doc.text(ascii(gauge.label+' - '+gauge.name+(gauge.stationId?' ['+gauge.stationId+']':'')),12,y+5,{maxWidth:273});
        doc.setFont('helvetica','normal');doc.setFontSize(7);doc.text(ascii(gaugeReading(gauge)+' | Observed: '+gaugeTime(gauge.observedAt)),12,y+10,{maxWidth:273});
        if(entry?.graph){const box=imageFit(entry.graph,12,y+13,273,57,entry.graph.format||'PNG');sourceLink(gauge.sourceUrl||gauge.graphUrl,box.x,box.y,box.width,box.height);doc.setTextColor(80);doc.text(ascii('Graph retrieved: '+aest(entry.graph.retrievedAt)+' | Feed updated: '+gaugeTime(gauge.updatedAt)),12,y+75,{maxWidth:273});}
        else{doc.setFontSize(11);doc.setTextColor(110);doc.text(ascii(entry?.reason||'Graph unavailable'),148,y+43,{align:'center'});doc.setFontSize(8);const link=externalPhotoLink(gauge.sourceUrl||gauge.graphUrl);if(link){doc.setTextColor(25,75,111);doc.text('Open source',12,y+75);sourceLink(link,12,y+70,35,8);}}
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
