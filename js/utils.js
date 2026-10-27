export const clean=v=>String(v??'').replace(/\s+/g,' ').trim();
export function errorText(error) {return clean(error?.message||error||'Request failed').replace(/((?:access_)?token|api[_-]?key|key)=([^&\s]+)/gi,'$1=[redacted]');}
export function abortError(){return new DOMException('Cancelled','AbortError');}
export function checkAbort(signal){if(signal?.aborted)throw abortError();}
export function aest(value=new Date()) {return new Date(value).toLocaleString('en-AU',{timeZone:'Australia/Brisbane',day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:false})+' AEST';}
export function stamp(value=new Date()) {return new Date(value).toLocaleString('sv-SE',{timeZone:'Australia/Brisbane',hour12:false}).replace(/[-: ]/g,'').slice(0,12)+'-AEST';}
export function verifiedTime(raw) {
  if(typeof raw==='string'&&!/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d+)?)?(?:Z|[+-]\d\d:?\d\d)$/i.test(raw.trim()))return null;
  if(raw==null||raw==='')return null;const n=typeof raw==='number'?(raw<1e11?raw*1000:raw):raw,date=new Date(n);
  return Number.isFinite(date.getTime())&&date.getUTCFullYear()>=2000&&date.getUTCFullYear()<=2100?date:null;
}
export async function request(url,{signal,timeout=22000,...options}={}) {
  const controller=new AbortController(),cancel=()=>controller.abort();checkAbort(signal);signal?.addEventListener('abort',cancel,{once:true});
  const timer=setTimeout(cancel,timeout);
  try {const response=await fetch(url,{cache:'no-store',...options,signal:controller.signal});if(!response.ok)throw new Error('Request returned HTTP '+response.status);
    const body=await response.arrayBuffer();return new Response(body,{status:response.status,headers:response.headers});}
  finally {clearTimeout(timer);signal?.removeEventListener('abort',cancel);}
}
export async function json(url,options) {const r=await request(url,options),d=await r.json();if(d.error)throw new Error(d.error.message||'Service returned an error');return d;}
export function isCollection(data){return data?.type==='FeatureCollection'&&Array.isArray(data.features);}
export async function pooled(items,limit,fn) {const result=new Array(items.length);let cursor=0;await Promise.all(Array.from({length:Math.min(limit,items.length)},async()=>{for(;;){const i=cursor++;if(i>=items.length)return;result[i]=await fn(items[i],i);}}));return result;}
let canvasFactory=(w,h)=>{const c=document.createElement('canvas');c.width=w;c.height=h;return c;};
export function setCanvasFactory(factory){canvasFactory=factory;}
export function canvas(w,h){return canvasFactory(w,h);}
export async function imageFromBlob(blob) {if(typeof createImageBitmap==='function')return createImageBitmap(blob);const u=URL.createObjectURL(blob);try{return await new Promise((resolve,reject)=>{const im=new Image();im.onload=()=>resolve(im);im.onerror=()=>reject(new Error('Image could not be decoded'));im.src=u;});}finally{URL.revokeObjectURL(u);}}
export function canvasBlob(c,type='image/jpeg',quality=.93){if(c.toBlob)return new Promise((resolve,reject)=>c.toBlob(b=>b?resolve(b):reject(new Error('Image export failed')),type,quality));return Promise.resolve(new Blob([c.toBuffer(type)],{type}));}
export function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
