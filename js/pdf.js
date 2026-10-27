import {aest,checkAbort} from './utils.js';
import {externalPhotoLink} from './cameras.js';
const ascii=s=>String(s).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[\u2010-\u2015]/g,'-').replace(/[\u2018\u2019]/g,"'").replace(/[\u201c\u201d]/g,'"').replace(/[^\x20-\x7e\n]/g,'?');
export function photoLayout(count){const columns=count<=2?count:count<=4?2:3,rows=count<=2?1:2;return {columns,rows,width:(279-(columns-1)*4)/columns,height:(169-(rows-1)*4)/rows};}
export function cameraPdf({jsPDF,snapshot,photos,overview,signal}){
  if(!photos.length)throw new Error('No eligible photographs were retrieved; no PDF was generated');checkAbort(signal);
  if(typeof jsPDF!=='function')throw new Error('The bundled PDF library did not load. Reload the page.');
  const doc=new jsPDF({orientation:'landscape',unit:'mm',format:'a4',compress:true}),indexPages=Math.ceil(photos.length/24),photoStart=2+indexPages,photoPages=Math.ceil(photos.length/6),total=1+indexPages+photoPages;
  const pageFor=i=>photoStart+Math.floor(i/6),pad=9;
  function header(title,page){doc.setFont('helvetica','bold');doc.setFontSize(15);doc.setTextColor(24,42,55);doc.text(ascii(title),pad,12);doc.setFont('helvetica','normal');doc.setFontSize(8);doc.setTextColor(78,90,100);doc.text('Generated '+aest(snapshot.generated),pad,18);doc.setDrawColor(198,209,216);doc.line(pad,21,288,21);doc.setFontSize(8);doc.text('Page '+page+' of '+total,288,204,{align:'right'});doc.text('Camera index',pad,204);doc.link(pad,199,23,6,{pageNumber:2});doc.text('Overview',42,204);doc.link(42,199,21,6,{pageNumber:1});}
  header('Queensland Camera Situation Report'+(snapshot.demo?' - DEMO / SYNTHETIC':''),1);
  const ix=9,iy=26,iw=235,ih=158,ratio=Math.min(iw/overview.width,ih/overview.height),dw=overview.width*ratio,dh=overview.height*ratio;
  doc.addImage(overview.data,'JPEG',ix,iy,dw,dh);
  photos.forEach((entry,i)=>{const m=entry.camera.marker;if(m)doc.link(ix+m.x/overview.width*dw-2.5,iy+m.y/overview.height*dh-2.5,5,5,{pageNumber:pageFor(i)});});
  doc.setFontSize(9);doc.setTextColor(30,47,60);doc.text(ascii(snapshot.profileLabel+' warning area'),250,30,{maxWidth:38});
  const summary=[photos.length+' included photographs','Camera numbers link to photos.','Only the warning footprint is used.','Capture dates are distinguished from retrieval times.','Images may include an upstream unavailable-camera graphic.'];
  let sy=49;for(const line of summary){const wrapped=doc.splitTextToSize(ascii(line),37);doc.text(wrapped,250,sy);sy+=wrapped.length*4+5;}
  doc.setFontSize(7);doc.setTextColor(90);doc.text('Sources: TMR / BCC camera services; BoM warning via authenticated ArcGIS; Queensland boundaries; Esri basemap.',9,191);
  for(let page=0;page<indexPages;page++){checkAbort(signal);doc.addPage();header('Camera index',2+page);const subset=photos.slice(page*24,(page+1)*24);
    subset.forEach((entry,k)=>{const index=page*24+k,col=k>=12?1:0,row=k%12,x=9+col*143,y=29+row*13.4;doc.setFont('helvetica','bold');doc.setFontSize(9);doc.setTextColor(25,75,111);doc.text(String(index+1)+'.',x,y);doc.setFont('helvetica','normal');doc.setTextColor(35);const name=doc.splitTextToSize(ascii(entry.camera.name),125).slice(0,2);doc.text(name,x+8,y);doc.link(x,y-4,135,12,{pageNumber:pageFor(index)});});
  }
  for(let page=0;page<photoPages;page++){checkAbort(signal);doc.addPage();header('Camera photographs',photoStart+page);const subset=photos.slice(page*6,(page+1)*6),layout=photoLayout(subset.length);
    subset.forEach((entry,k)=>{const index=page*6+k,x=9+(k%layout.columns)*(layout.width+4),y=26+Math.floor(k/layout.columns)*(layout.height+4),photo=entry.photo;
      doc.setDrawColor(202,213,220);doc.rect(x,y,layout.width,layout.height);doc.setFont('helvetica','bold');doc.setTextColor(26,48,65);doc.setFontSize(9);
      const title=doc.splitTextToSize(ascii((index+1)+'. '+entry.camera.name),layout.width-6).slice(0,3);doc.text(title,x+3,y+5);const titleH=title.length*3.7+4,availableH=layout.height-titleH-18,scale=Math.min((layout.width-6)/photo.width,availableH/photo.height),pw=photo.width*scale,ph=photo.height*scale;
      const px=x+(layout.width-pw)/2,py=y+titleH;doc.addImage(photo.data,'JPEG',px,py,pw,ph);const link=externalPhotoLink(entry.camera.url);if(link)doc.link(px,py,pw,ph,{url:link});
      doc.setFont('helvetica','normal');doc.setFontSize(7);doc.setTextColor(75);const caption=[entry.camera.sourceLabel,photo.capturedAt?'Captured '+aest(photo.capturedAt):'Capture time unverified','Retrieved '+aest(photo.retrievedAt)].map(ascii);
      doc.text(caption,x+3,y+layout.height-12);doc.setTextColor(30,85,125);doc.text('Index',x+layout.width-13,y+layout.height-3);doc.link(x+layout.width-16,y+layout.height-7,15,7,{pageNumber:2+Math.floor(index/24)});
    });
  }
  checkAbort(signal);return doc;
}
