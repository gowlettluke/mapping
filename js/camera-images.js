import {checkAbort} from './utils.js';
import {featureQueryUrl} from './portal-features.js';

export function safeImageUrl(raw){try{const url=new URL(String(raw));return ['https:','http:'].includes(url.protocol)&&!url.username&&!url.password?url.href:'';}catch{return '';}}
export function cameraImageLinks(properties){
  const aliases=new Map(Object.entries(properties||{}).map(([name,value])=>[name.toLowerCase().replace(/[^a-z0-9]/g,''),value]));
  const images=[...aliases].filter(([name])=>/^imageurl(?:[1-9])?$/.test(name)).sort(([a],[b])=>Number(a.replace('imageurl','')||1)-Number(b.replace('imageurl','')||1));
  if(!images.some(([,value])=>safeImageUrl(value)))images.push(['image',properties?.image?.url||aliases.get('stillimageurl')||aliases.get('cameraurl')||aliases.get('webcamurl')||aliases.get('photourl')||aliases.get('url')]);
  const seen=new Set();return images.map(([field,value])=>({field,url:safeImageUrl(value)})).filter(image=>image.url&&!seen.has(image.url)&&seen.add(image.url));
}
function appendPath(base,path){const url=new URL(base);url.pathname=url.pathname.replace(/\/$/,'')+path;return url.href;}

// BCC's published map uses FeatureServer image attachments, not a guessed
// camera-ID/image-path template. Resolve attachment metadata with the same SDK
// session; photographs themselves still load only when requested.
export async function resolveCameraAttachments({collection,url,layerId,request,signal}){
  checkAbort(signal);
  const missing=collection.features.filter(f=>f.geometry?.type==='Point'&&!cameraImageLinks(f.properties).length);if(!missing.length)return collection;
  const layer=new URL(featureQueryUrl(url,layerId));layer.pathname=layer.pathname.replace(/\/query$/,'');
  const options={responseType:'json',authMode:'no-prompt',timeout:20000,signal};
  const metadata=(await request(layer.href,{...options,query:{f:'json'}})).data;checkAbort(signal);
  if(metadata?.error)throw new Error('Camera attachment metadata could not be read with this ArcGIS session.');
  if(!metadata?.hasAttachments)return collection;
  const oid=feature=>feature.properties?.[metadata.objectIdField]??feature.id??feature.properties?.OBJECTID??feature.properties?.objectid;
  const byId=new Map(missing.map(f=>[String(oid(f)),f]));
  if([...byId.keys()].some(id=>!/^\d+$/.test(id)))throw new Error('Camera source has no usable attachment object IDs.');
  const ids=[...byId.keys()],attachments=new Map();
  for(let start=0;start<ids.length;start+=50){
    let offset=0;const seen=new Set();
    for(let page=0;page<100;page++){
      checkAbort(signal);const response=(await request(appendPath(layer.href,'/queryAttachments'),{...options,query:{f:'json',objectIds:ids.slice(start,start+50).join(','),resultOffset:offset,resultRecordCount:1000}})).data;
      if(response?.error||!Array.isArray(response?.attachmentGroups))throw new Error('Camera image attachment list is unavailable.');
      let returned=0,added=0;
      for(const group of response.attachmentGroups){
        const parent=String(group.parentObjectId);if(!byId.has(parent))continue;
        for(const attachment of group.attachmentInfos||[]){returned++;const key=parent+':'+attachment.id;if(seen.has(key))continue;seen.add(key);added++;
          if(!/^\d+$/.test(String(attachment.id))||!/^image\/(?:jpeg|jpg|png|gif|webp|bmp|avif)$/i.test(attachment.contentType||'')||attachment.size===0)continue;
          if(!attachments.has(parent))attachments.set(parent,[]);attachments.get(parent).push(attachment);
        }
      }
      if(!response.exceededTransferLimit)break;
      if(!added||page===99)throw new Error('Camera image attachment list is incomplete.');offset+=returned;
    }
  }
  checkAbort(signal);const features=[];
  for(const feature of collection.features){const id=String(oid(feature)),images=attachments.get(id)||[];
    if(!images.length){features.push(feature);continue;}
    for(const attachment of images)features.push({...feature,id:id+':'+attachment.id,properties:{...feature.properties,
      image_url:appendPath(layer.href,'/'+id+'/attachments/'+attachment.id),
      _camera_view:images.length>1?attachment.name||'Image '+attachment.id:''}});
  }
  return {...collection,features};
}
