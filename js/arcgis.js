import {CONFIG} from '../config.js';
import {checkAbort,clean} from './utils.js';
import {queryArcgis} from './sources.js';
let modulesPromise;
function sdk(){if(!modulesPromise)modulesPromise=new Promise((resolve,reject)=>{
  if(globalThis.$arcgis)return resolve();const script=document.createElement('script');script.type='module';script.src=CONFIG.arcgis.sdk;script.onload=resolve;script.onerror=()=>reject(new Error('ArcGIS SDK could not load'));document.head.append(script);
}).then(()=>globalThis.$arcgis.import(['@arcgis/core/identity/OAuthInfo.js','@arcgis/core/identity/IdentityManager.js','@arcgis/core/portal/Portal.js','@arcgis/core/portal/PortalItem.js','@arcgis/core/layers/WMSLayer.js','@arcgis/core/geometry/Extent.js','@arcgis/core/request.js'])).catch(e=>{modulesPromise=null;throw e;});return modulesPromise;}
export function organisationUrl(prefix){const value=clean(prefix).toLowerCase();if(!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(value))throw new Error('Enter only the organisation prefix, such as yourorg');return 'https://'+value+'.maps.arcgis.com';}
export class ArcGISConnection {
  constructor(){this.portal=null;this.layers={};this.choices={};this.districtItem=null;this.cameraItems=[];this.serial={};}
  async connect(prefix,clientId,{resume=false}={}) {
    const [OAuthInfo,identity,Portal,PortalItem,WMSLayer,Extent,esriRequest]=await sdk();this.sdk={OAuthInfo,identity,Portal,PortalItem,WMSLayer,Extent,esriRequest};
    const url=organisationUrl(prefix);if(!/^[A-Za-z0-9_-]{8,128}$/.test(clientId))throw new Error('Enter a valid public ArcGIS OAuth client ID');
    const info=new OAuthInfo({appId:clientId,portalUrl:url,popup:false,flowType:'authorization-code',authNamespace:'qld-warning-reconstructed'});identity.registerOAuthInfos([info]);
    if(resume)await identity.checkSignInStatus(url+'/sharing');else await identity.getCredential(url+'/sharing');
    this.portal=new Portal({url,authMode:'immediate'});await this.portal.load();
    const discovered=await Promise.all(['warning','radar'].map(async role=>[role,await this.search([CONFIG.arcgis.items[role]],'WMS')]));
    for(const [role,items] of discovered){if(!items.length)throw new Error('The signed-in account cannot find '+CONFIG.arcgis.items[role]);this.choices[role]=items;}
    return {user:this.portal.user?.fullName||this.portal.user?.username||'Signed in',choices:this.choices};
  }
  async search(titles,type='Feature Service') {
    const matches=new Map();for(const title of titles){const escaped=title.replace(/["\\]/g,'');const r=await this.portal.queryItems({query:`title:"${escaped}" AND type:"${type}"`,num:100,sortField:'modified',sortOrder:'desc'});
      for(const item of r.results)if(titles.some(t=>item.title.toLowerCase()===t.toLowerCase()))matches.set(item.id,item);
    }return [...matches.values()];
  }
  async bind(role,id){const item=this.choices[role]?.find(i=>i.id===id);if(!item)throw new Error('Select an accessible '+role+' portal item');
    const layer=new this.sdk.WMSLayer({portalItem:item,imageFormat:'image/png',imageTransparency:true});await layer.load();
    this.layers[role]={base:layer,all:[...(layer.allSublayers?.toArray()||layer.sublayers?.toArray()||[])]};
  }
  async render(role,extent,width,height,names,titles=[],signal){checkAbort(signal);if(!this.layers[role])throw new Error('Connect and verify the '+role+' layer first');
    // One mutable SDK WMSLayer per role. Serializing selections prevents an
    // optional tracking request from changing an in-flight warning GetMap.
    const previous=this.serial[role]||Promise.resolve();const operation=previous.catch(()=>{}).then(async()=>{
      checkAbort(signal);const {base,all}=this.layers[role];const selected=all.filter(s=>names.includes(s.name)||titles.some(t=>String(s.title).toLowerCase()===t.toLowerCase()));
      if(!selected.length)throw new Error('The selected WMS item has none of the required sublayers: '+names.join(', '));
      const actualNames=new Set(selected.map(s=>s.name));if(names.length>1&&!names.every(n=>actualNames.has(n))&&selected.length<names.length)throw new Error('A required WMS sublayer is unavailable');
      base.sublayers=selected.map(s=>{const clone=s.clone();clone.visible=true;return clone;});
      const controller=new AbortController(),abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});const timer=setTimeout(abort,30000);
      try{return await base.fetchImage(new this.sdk.Extent({xmin:extent[0],ymin:extent[1],xmax:extent[2],ymax:extent[3],spatialReference:{wkid:3857}}),width,height,{signal:controller.signal});}
      finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
    });this.serial[role]=operation;return operation;
  }
  async verify(signal){const e=[15330000,-3300000,17160000,-1000000];await this.render('warning',e,128,160,CONFIG.profiles.thunderstorm.warning,CONFIG.profiles.thunderstorm.titles,signal);await this.render('radar',e,128,160,CONFIG.radar.names,CONFIG.radar.titles,signal);}
  async featureCollection(item,layerId,signal){const base=item.url?.replace(/\/$/,'');if(!base)throw new Error('Feature item has no service URL');
    // IdentityManager-aware esriRequest supplies credentials to hosted feature
    // services. Use a query-only request, never copy tokens into configuration.
    const url=/\/(FeatureServer|MapServer)\/\d+$/i.test(base)?base:base+'/'+layerId,features=[];
    for(let offset=0;offset<100000;offset+=2000){checkAbort(signal);const result=await this.sdk.esriRequest(url+'/query',{query:{where:'1=1',outFields:'*',returnGeometry:true,outSR:4326,f:'geojson',resultOffset:offset,resultRecordCount:2000},responseType:'json',timeout:20000,signal});const d=result.data;
      if(d.error||d.type!=='FeatureCollection')throw new Error('Authenticated feature query failed');features.push(...d.features);if(d.features.length<2000&&!d.exceededTransferLimit)return {type:'FeatureCollection',features};
    }throw new Error('Authenticated feature source exceeded the page limit');
  }
  async districts(signal){const items=await this.search([CONFIG.arcgis.districts.title]);if(items.length!==1)throw new Error(items.length?'District layer is ambiguous':'District layer is unavailable');return this.featureCollection(items[0],CONFIG.arcgis.districts.layer,signal);}
  async cameraCollections(signal){return Promise.all(CONFIG.arcgis.cameras.map(async spec=>{try{const items=await this.search([spec.title,...(spec.alternatives||[])]);if(items.length!==1)throw new Error(items.length?'Multiple matching camera items; no item selected automatically':'No accessible camera item');return {key:spec.key,label:spec.label,collection:await this.featureCollection(items[0],spec.layer,signal)};}catch(error){return {key:spec.key,label:spec.label,error};}}));}
  disconnect(){this.sdk?.identity.destroyCredentials();for(const v of Object.values(this.layers))v.base.destroy();this.layers={};this.portal=null;}
}
