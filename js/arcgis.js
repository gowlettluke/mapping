import {CONFIG} from '../config.js';
import {checkAbort,clean} from './utils.js';
import {withDeadline} from './connections.js';
import {registeredWmsConfig,renderRegisteredWms,WmsError} from './wms.js';
import {CAMERA_ITEM_TYPES,arcgisItemId,distinctFeatureItems,embeddedCameraCollection,featureQueryUrl} from './portal-features.js';
import {resolveCameraAttachments} from './camera-images.js';
let modulesPromise;
const itemTitle=value=>String(value||'').toLowerCase().replace(/[^a-z0-9]/g,'');
function weatherFailure(role,stage,error){
  if(error?.name==='AbortError')return error;
  if(error instanceof WmsError)return new Error(`${role==='warning'?'Warning':'Radar'}: ${error.message}`);
  // SDK errors can contain service URLs, request options and credentials.
  // Display only the phase and an HTTP status, never the original payload.
  const status=Number(error?.details?.httpStatus);
  const reason=status>=400&&status<=599?`HTTP ${status}`:'request blocked or service unreachable';
  return new Error(`${role==='warning'?'Warning':'Radar'} ${stage} failed (${reason}). Sign-in succeeded; private service access has not been verified.`);
}
function sdk(){if(!modulesPromise)modulesPromise=new Promise((resolve,reject)=>{
  if(globalThis.$arcgis)return resolve();const script=document.createElement('script');script.type='module';script.src=CONFIG.arcgis.sdk;script.onload=resolve;script.onerror=()=>reject(new Error('ArcGIS SDK could not load'));document.head.append(script);
}).then(()=>globalThis.$arcgis.import(['@arcgis/core/identity/OAuthInfo.js','@arcgis/core/identity/IdentityManager.js','@arcgis/core/portal/Portal.js','@arcgis/core/portal/PortalItem.js','@arcgis/core/layers/WMSLayer.js','@arcgis/core/geometry/Extent.js','@arcgis/core/request.js'])).catch(e=>{modulesPromise=null;throw e;});return modulesPromise;}
export function organisationUrl(prefix){const value=clean(prefix).toLowerCase();if(!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(value))throw new Error('Enter only the organisation prefix, such as yourorg');return 'https://'+value+'.maps.arcgis.com';}
export class ArcGISConnection {
  constructor(){this.portal=null;this.layers={};this.choices={};this.featureChoices={};this.featureSelections=new Map();this.featureItems=new Map();}
  async connect(prefix,clientId,{resume=false}={}) {
    const [OAuthInfo,identity,Portal,PortalItem,WMSLayer,Extent,esriRequest]=await sdk();this.sdk={OAuthInfo,identity,Portal,PortalItem,WMSLayer,Extent,esriRequest};
    const url=organisationUrl(prefix);if(!/^[A-Za-z0-9_-]{8,128}$/.test(clientId))throw new Error('Enter a valid public ArcGIS OAuth client ID');
    const info=new OAuthInfo({appId:clientId,portalUrl:url,popup:false,flowType:'authorization-code',authNamespace:'qld-warning-reconstructed'});identity.registerOAuthInfos([info]);
    if(resume)await identity.checkSignInStatus(url+'/sharing');else await identity.getCredential(url+'/sharing');
    this.portal=new Portal({url,authMode:'immediate'});await this.portal.load();
    return {user:this.portal.user?.fullName||this.portal.user?.username||'Signed in'};
  }
  async discoverWeather(signal){const results=await Promise.allSettled(['warning','radar'].map(role=>this.search([CONFIG.arcgis.items[role]],'WMS',signal)));checkAbort(signal);
    ['warning','radar'].forEach((role,i)=>{this.choices[role]=results[i].status==='fulfilled'?results[i].value:[];});return this.choices;
  }
  async search(titles,type=['Feature Service','Map Service'],signal) {
    const types=Array.isArray(type)?type:[type],typeQuery='('+types.map(t=>`type:"${t.replace(/["\\]/g,'')}"`).join(' OR ')+')';
    const wanted=new Set(titles.map(itemTitle)),matches=new Map();
    for(const title of titles){
      checkAbort(signal);const escaped=title.replace(/["\\]/g,'');
      const queries=[`title:"${escaped}"`];
      // Portal tokenizes underscores and punctuation differently between items.
      // A token fallback still requires an exact normalized title match below.
      const words=title.match(/[A-Za-z0-9]+/g)||[];
      if(words.length)queries.push(words.map(word=>`title:"${word}"`).join(' AND '));
      let foundTitle=false;
      for(const titleQuery of [...new Set(queries)]){
        const r=await this.portal.queryItems({query:`(${titleQuery}) AND ${typeQuery}`,num:100,sortField:'modified',sortOrder:'desc'});checkAbort(signal);
        for(const item of r.results)if(wanted.has(itemTitle(item.title))){matches.set(item.id,item);if(itemTitle(item.title)===itemTitle(title))foundTitle=true;}
        if(foundTitle)break;
      }
    }return [...matches.values()];
  }
  async bind(role,id,signal){checkAbort(signal);const item=this.choices[role]?.find(i=>i.id===id);if(!item)throw new Error(this.choices[role]?.length?'Select the correct '+role+' item below, then recheck layers.':'No accessible '+role+' WMS item was found. Check sharing and access.');
    // Read private item configuration through its authenticated PortalItem.
    // In particular, item.mapUrl may differ from its visible service URL.
    let data={};
    try{await withDeadline(async s=>{if(item.load)await item.load({signal:s});if(item.fetchData)data=await item.fetchData('json',{signal:s})||{};checkAbort(s);},signal,20000);}
    catch(error){throw weatherFailure(role,'private item metadata',error);}
    const layer=new this.sdk.WMSLayer({portalItem:item,imageFormat:'image/png',imageTransparency:true});
    let loaded=false,sdkData={};
    try{
      // CORS-blocked/stalled capabilities must not prevent the organisation
      // print fallback from trying the authenticated registered definition.
      await withDeadline(s=>layer.load({signal:s}),signal,10000);checkAbort(signal);loaded=true;
      sdkData=layer.toJSON?.()||{url:layer.url,mapUrl:layer.mapUrl,version:layer.version,
        customParameters:layer.customParameters,customLayerParameters:layer.customLayerParameters,
        layers:(layer.allSublayers?.toArray()||[]).map(s=>({name:s.name,title:s.title,style:s.style}))};
    }catch(error){layer.destroy();checkAbort(signal);}
    let config;try{config=registeredWmsConfig(item,data,sdkData);}catch(error){if(loaded)layer.destroy();throw weatherFailure(role,'registered configuration',error);}
    if(signal?.aborted){if(loaded)layer.destroy();checkAbort(signal);}this.layers[role]?.base?.destroy();
    this.layers[role]={base:loaded?layer:null,config,route:null};
  }
  async render(role,extent,width,height,names,titles=[],signal){checkAbort(signal);if(!this.layers[role])throw new Error('Connect and verify the '+role+' layer first');
    // Each request owns its names/styles. Tracking and warning requests no
    // longer mutate the same SDK sublayer collection while images are pending.
    const record=this.layers[role];
    try{return await withDeadline(async s=>{
      const result=await renderRegisteredWms({request:this.sdk.esriRequest,printTask:this.portal?.helperServices?.printTask?.url,
        config:record.config,names,titles,extent,width,height,signal:s,preferPrint:record.route==='print'});
      checkAbort(s);record.route=result.route;return result.image;
    },signal,80000);}catch(error){throw weatherFailure(role,'map image',error);}
  }
  async verifyRole(role,signal){const e=[15330000,-3300000,17160000,-1000000],spec=role==='warning'?CONFIG.profiles.thunderstorm:CONFIG.radar;
    const image=await this.render(role,e,128,160,spec.warning||spec.names,spec.titles,signal);if(!image||!image.width||!image.height)throw new Error('The '+role+' service did not return an image');image.close?.();return this.layers[role].route;
  }
  async verify(signal){await this.verifyRole('warning',signal);await this.verifyRole('radar',signal);}
  setFeatureSelection(spec,value){const known=this.featureChoices[spec.key]?.find(item=>item.id===value),id=known?.id||arcgisItemId(value);this.featureSelections.set(spec.key,id);this.featureItems.delete(spec.key);}
  async featureItem(spec,signal){
    const key=spec.key||'districts';if(this.featureItems.has(key))return this.featureItems.get(key);
    const selected=this.featureSelections.get(key);let item;
    if(selected){item=this.featureChoices[key]?.find(candidate=>candidate.id===selected)||new this.sdk.PortalItem({id:selected,portal:this.portal});}
    else{
      for(const title of [spec.title,...(spec.alternatives||[])]){
        const items=distinctFeatureItems(await this.search([title],spec.key?CAMERA_ITEM_TYPES:undefined,signal),spec.layer);checkAbort(signal);this.featureChoices[key]=items;
        if(items.length>1)throw new Error('Multiple matching items. Choose the correct source below, then recheck layers.');
        if(items.length===1){item=items[0];break;}
      }
    }
    if(!item)throw new Error('No accessible layer item was found. Supply its ArcGIS item link below.');
    if(item.load)await item.load({signal});checkAbort(signal);
    if(spec.key&&item.type&&!CAMERA_ITEM_TYPES.includes(item.type))throw new Error('Selected item is not a supported camera layer or web map.');
    this.featureItems.set(key,item);return item;
  }
  async cameraServiceCollection(item,layerId,signal){const collection=await this.featureCollection(item,layerId,signal);return resolveCameraAttachments({collection,url:item.url,layerId,request:this.sdk.esriRequest,signal});}
  async cameraCollection(spec,signal){const item=await this.featureItem(spec,signal);
    return ['Feature Collection','Web Map'].includes(item.type)||!item.url?embeddedCameraCollection(item,spec,this.cameraServiceCollection.bind(this),signal):this.cameraServiceCollection(item,spec.layer,signal);
  }
  async probeFeature(spec,signal){if(spec.key)return this.cameraCollection(spec,signal);const item=await this.featureItem(spec,signal);
    const url=featureQueryUrl(item.url,spec.layer);
    const r=await this.sdk.esriRequest(url,{query:{where:'1=1',returnCountOnly:true,f:'json'},responseType:'json',timeout:20000,signal});checkAbort(signal);if(!Number.isInteger(r.data?.count)||r.data.count<0)throw new Error('Authenticated layer query failed');
  }
  async featureCollection(item,layerId,signal){const base=item.url?.replace(/\/$/,'');if(!base)throw new Error('Feature item has no service URL');
    // IdentityManager-aware esriRequest supplies credentials to hosted feature
    // services. Use a query-only request, never copy tokens into configuration.
    const url=featureQueryUrl(base,layerId),features=[],seen=new Set();
    for(let offset=0;offset<100000;){checkAbort(signal);const result=await this.sdk.esriRequest(url,{query:{where:'1=1',outFields:'*',returnGeometry:true,outSR:4326,f:'geojson',resultOffset:offset,resultRecordCount:2000},responseType:'json',timeout:20000,signal});const d=result.data;
      if(d.error||d.type!=='FeatureCollection'||!Array.isArray(d.features))throw new Error('Authenticated feature query failed');
      let added=0;for(const feature of d.features){const id=feature.id??feature.properties?.objectid??feature.properties?.OBJECTID??JSON.stringify(feature);if(seen.has(id))continue;seen.add(id);features.push(feature);added++;}
      if(d.features.length<2000&&!d.exceededTransferLimit)return {type:'FeatureCollection',features};if(!added)throw new Error('Authenticated feature source did not honour pagination');offset+=d.features.length;
    }throw new Error('Authenticated feature source exceeded the page limit');
  }
  async districts(signal){return this.featureCollection(await this.featureItem(CONFIG.arcgis.districts,signal),CONFIG.arcgis.districts.layer,signal);}
  async cameraCollections(signal){return Promise.all(CONFIG.arcgis.cameras.map(async spec=>{try{return {key:spec.key,label:spec.label,collection:await this.cameraCollection(spec,signal)};}catch(error){return {key:spec.key,label:spec.label,error};}}));}
  disconnect(){this.sdk?.identity.destroyCredentials();for(const v of Object.values(this.layers))v.base?.destroy();this.layers={};this.choices={};this.featureChoices={};this.featureSelections.clear();this.featureItems.clear();this.portal=null;}
}
