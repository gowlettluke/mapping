import {checkAbort} from './utils.js';
import {renderWebMapPrintImage} from './wms.js';

// Only the public BoM PNG form confirmed by the user can use this fallback.
// No private service URL, credentials or arbitrary destination enters a map.
export function isBomGraphUrl(value){try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password&&!url.port&&!url.search&&!url.hash&&['www.bom.gov.au','bom.gov.au'].includes(url.hostname)&&/^\/fwo\/([A-Z]{3}\d{5})\/\1\.\d{6}\.png$/.test(url.pathname);}catch{return false;}}
export function graphPrintMap(url,naturalWidth,naturalHeight){
  if(!isBomGraphUrl(url))throw new Error('Unsupported graph image URL.');
  if(!Number.isInteger(naturalWidth)||!Number.isInteger(naturalHeight)||naturalWidth<150||naturalHeight<60||naturalWidth>10000||naturalHeight>10000)throw new Error('Graph image dimensions are unavailable.');
  const scale=Math.min(1,1200/naturalWidth,800/naturalHeight),width=Math.round(naturalWidth*scale),height=Math.round(naturalHeight*scale),dpi=600;
  // Marker sizes are points. A small physical marker at print DPI retains the
  // PNG's pixels while staying within picture-symbol size limits.
  const symbol={type:'esriPMS',url,contentType:'image/png',width:width*72/dpi,height:height*72/dpi,angle:0,xoffset:0,yoffset:0};
  return {width,height,webMap:{mapOptions:{extent:{xmin:-width/height,ymin:-1,xmax:width/height,ymax:1,spatialReference:{wkid:3857}},spatialReference:{wkid:3857},background:{color:[255,255,255,255]}},
    operationalLayers:[{id:'gauge-graph',opacity:1,visibility:true,featureCollection:{layers:[{layerDefinition:{name:'Gauge graph',geometryType:'esriGeometryPoint',fields:[{name:'OBJECTID',type:'esriFieldTypeOID',alias:'OBJECTID'}],objectIdField:'OBJECTID',drawingInfo:{renderer:{type:'simple',symbol}}},featureSet:{geometryType:'esriGeometryPoint',spatialReference:{wkid:3857},features:[{geometry:{x:0,y:0,spatialReference:{wkid:3857}},attributes:{OBJECTID:1}}]}}]}}],baseMap:{baseMapLayers:[]},exportOptions:{outputSize:[width,height],dpi}}};
}
export function graphDimensions(url,signal){
  checkAbort(signal);return new Promise((resolve,reject)=>{const image=new Image();let timer;
    const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',cancel);image.onload=null;image.onerror=null;};
    const cancel=()=>{cleanup();image.removeAttribute('src');try{checkAbort(signal);}catch(error){reject(error);}};
    image.onload=()=>{const size=[image.naturalWidth,image.naturalHeight];cleanup();resolve(size);};image.onerror=()=>{cleanup();reject(new Error('Graph image could not be opened.'));};
    timer=setTimeout(()=>{cleanup();image.removeAttribute('src');reject(new Error('Graph image dimensions timed out.'));},12000);signal?.addEventListener('abort',cancel,{once:true});
    // Display-only image loading exposes dimensions even when the source does
    // not permit pixel reads. Its pixels are never drawn into a local canvas.
    image.referrerPolicy='no-referrer';image.src=url;
  });
}
export async function renderGraphPrintImage({url,request,printTask,signal,dimensions=graphDimensions}){
  checkAbort(signal);if(!isBomGraphUrl(url))throw new Error('Unsupported graph image URL.');if(!printTask)throw new Error('No organisation image export service is available.');
  const size=await dimensions(url,signal);checkAbort(signal);const {webMap,width,height}=graphPrintMap(url,...size),image=await renderWebMapPrintImage({request,printTask,webMap,width,height,signal});
  const pixels=image.getContext('2d',{willReadFrequently:true}).getImageData(0,0,width,height).data;let left=width,right=-1,top=height,bottom=-1;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=(y*width+x)*4;if(pixels[i+3]>30&&Math.min(pixels[i],pixels[i+1],pixels[i+2])<225){left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}}
  if(right-left<width/3||bottom-top<height/4)throw new Error('The image export did not contain a readable graph.');checkAbort(signal);return image;
}
