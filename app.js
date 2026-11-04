import {CONFIG} from './config.js';
import {ArcGISConnection} from './js/arcgis.js';
import {generateSnapshot,scanFloods,snapshotReport,warningLgas} from './js/pipeline.js';
import {reportHtml,clipboardHtml} from './js/report.js';
import {discoverCameras,retrievePhotos} from './js/cameras.js';
import {cameraMap} from './js/renderer.js';
import {cameraPdf} from './js/pdf.js';
import {discoverGauges,retrieveGaugeGraphs,gaugeReading,gaugeTime,gaugeTiming,GAUGE_COLOURS} from './js/gauges.js';
import {gaugeMap} from './js/gauge-map.js';
import {gaugeReportPdf} from './js/flood-pdf.js';
import {gaugeFlowLabel,gaugeFlowSummary} from './js/gauge-flow.js';
import {gaugeDiagramLayout,drawGaugeDiagram} from './js/gauge-diagram.js';
import {aest,stamp,errorText,download,checkAbort,canvasBlob} from './js/utils.js';
import {lgaName} from './js/geometry.js';
import {FEEDS,readyForMaps,withDeadline,checkLayerConnections} from './js/connections.js';
import {normaliseLabelMinimum} from './js/outage-style.js';
const $=id=>document.getElementById(id),demo=document.body.dataset.mode==='demo';
const connection=new ArcGISConnection(),state={profile:'thunderstorm',ready:demo,connected:demo,authVersion:0,checkVersion:0,checkController:null,feedStates:new Map(),version:0,gen:null,extra:null,pdf:null,pdfKind:null,snapshot:null,cameras:[],cameraPhase:'idle',cameraNotices:[],gauges:[],gaugeMap:null,flowDiagrams:[],gaugeStatus:'idle',floods:[],floodScanned:false,floodAttempted:false,urls:[],originalReport:''};
function save(key,value){try{localStorage.setItem('qldMapping.'+key,value);}catch{}}
function stored(key,fallback=''){try{return localStorage.getItem('qldMapping.'+key)||fallback;}catch{return fallback;}}
function status(text){$('generationStatus').textContent=text;}
function readyStatus(){if(!state.ready)return 'Checking the required warning, radar and LGA layers...';if(state.profile!=='flooding'||demo)return 'Core map layers are ready. Generate current warning maps.';if(!state.floodScanned)return 'Load current BoM warnings before generating maps.';if(!state.floods.length)return 'No current BoM flood warnings or watches in Queensland. Generate a statewide map.';return $('floodChoice').value?'BoM warning selected. Generate maps for all its catchments.':'Select a BoM flood warning or watch, then generate maps.';}
function showFloodNotice(){const notice=state.floods.find(area=>area.id===$('floodChoice').value);$('floodSource').hidden=!notice;if(!notice&&state.floods.length){$('floodStatus').textContent=state.floods.length+' current BoM flood warnings / watches found. Choose one to include all its catchments.';}if(notice){$('floodSource').href=notice.sourceUrl;$('floodStatus').textContent=notice.catchmentNames.length+' catchment'+(notice.catchmentNames.length===1?'':'s')+' included: '+notice.catchmentNames.join(' · ')+'. River diagrams stay grouped by river system.';}}
function resetFloodChoice(text){$('floodSource').hidden=true;const option=document.createElement('option');option.value='';option.textContent=text;$('floodChoice').replaceChildren(option);$('floodStatus').textContent=text;}
function updateButtons(){const busy=Boolean(state.gen),flood=state.profile==='flooding';
  $('generate').disabled=busy||!state.ready||(flood&&!demo&&(!state.floodScanned||(state.floods.length&&!$('floodChoice').value)));$('cancelGenerate').hidden=!busy;$('scanFloods').disabled=busy||!state.ready;$('floodChoice').disabled=!demo&&(busy||!state.ready||!state.floodScanned||!state.floods.length);
  $('cameraPdf').disabled=Boolean(state.pdf)||!state.snapshot?.active||state.cameraPhase!=='ready'||!state.cameras.length;
  $('gaugePdf').disabled=Boolean(state.pdf)||!state.snapshot?.active||!flood||state.gaugeStatus!=='ready'||!state.gauges.length;$('gaugePanel').hidden=!flood;
  $('cancelPdf').hidden=state.pdfKind!=='cameras';$('cancelGaugePdf').hidden=state.pdfKind!=='gauges';$('trackingControl').hidden=state.profile!=='thunderstorm';$('floodPanel').hidden=!flood;$('tracking').disabled=busy;$('outageLabelMinimum').disabled=busy;
}
function reportClear(text='Generate maps to prepare report text.'){state.originalReport='';$('reportEditor').value='';$('reportEditor').disabled=true;$('reportPreview').innerHTML='';$('reportPreview').hidden=true;$('copyReport').disabled=true;$('resetReport').disabled=true;$('reportNotices').textContent='';$('reportNotices').hidden=true;$('reportStatus').textContent=text;}
function preview(){const text=$('reportEditor').value;$('reportPreview').innerHTML=reportHtml(text,{newTab:true});$('reportPreview').hidden=!text.trim();$('copyReport').disabled=!text.trim();$('resetReport').disabled=text===state.originalReport;}
function showReport(result){state.originalReport=result.text;$('reportEditor').value=result.text;$('reportEditor').disabled=!result.text;$('reportNotices').textContent=result.notes.join(' ');$('reportNotices').hidden=!result.notes.length;$('reportStatus').textContent=result.text?'Ready to copy or edit.':'No copyable report is available for this snapshot.';preview();}
function invalidate(message='Generate maps for the selected warning type.') {state.version++;for(const key of ['gen','extra','pdf']){state[key]?.abort();state[key]=null;}for(const url of state.urls)URL.revokeObjectURL(url);state.urls=[];state.pdfKind=null;state.snapshot=null;state.cameras=[];state.cameraPhase='idle';state.cameraNotices=[];state.gauges=[];state.gaugeMap=null;state.flowDiagrams=[];state.gaugeStatus='idle';$('gaugeList').replaceChildren();$('gaugeStatus').textContent='Generate a selected flood area to find its river gauges.';$('mapCount').textContent='Two JPEG exports';$('maps').replaceChildren();$('mapEmpty').hidden=false;$('mapEmpty').textContent=message;$('affectedLgas').textContent='Generate maps to analyse.';$('affectedDistricts').textContent='Generate maps to analyse.';$('scopeBadge').textContent='Not generated';$('cameraList').replaceChildren();$('cameraStatus').textContent='Generate a warning map to find cameras inside its footprint.';$('pdfProgress').hidden=true;$('gaugePdfProgress').hidden=true;$('dataNotices').hidden=true;reportClear();updateButtons();}
function addProduct(blob,title,filename){const url=URL.createObjectURL(blob);state.urls.push(url);const card=document.createElement('article');card.className='map-card';const im=document.createElement('img');im.src=url;im.alt=title;const caption=document.createElement('div');caption.className='map-caption';const name=document.createElement('span');name.textContent=title;const a=document.createElement('a');a.href=url;a.download=filename;a.textContent='Download JPEG';caption.append(name,a);card.append(im,caption);$('maps').append(card);}
async function generate(){if(!state.ready)return;invalidate();const run=state.version,controller=new AbortController();state.gen=controller;updateButtons();reportClear('Generating report text with the new maps...');status('Preparing warning detection...');
  try{const selection=state.floods.find(f=>f.id===$('floodChoice').value)||null;
    const outageLabelMinimum=normaliseLabelMinimum($('outageLabelMinimum').value);
    const result=demo?await(await import('./js/demo.js')).demoProducts(state.profile,{noWarning:$('noWarning').checked,tracking:$('tracking').checked,outageLabelMinimum}):await generateSnapshot({connection,profile:state.profile,selection,tracking:$('tracking').checked,outageLabelMinimum,signal:controller.signal,onProgress:text=>{if(run===state.version)status(text);}});
    checkAbort(controller.signal);if(run!==state.version)return;const {snapshot,blobs,notices}=result;state.snapshot=snapshot;
    const base=(demo?'DEMO-':'')+state.profile+'-'+stamp(snapshot.generated);addProduct(blobs.radar,'Warning + Radar',base+'-radar.jpg');addProduct(blobs.infrastructure,'Warning + Infrastructure Impacts',base+'-infrastructure.jpg');$('mapEmpty').hidden=true;
    $('scopeBadge').textContent=snapshot.active?'Warning LGAs':'Statewide';$('affectedLgas').textContent=snapshot.active?snapshot.affected.map(lgaName).join(' · '):'No active warning detected in Queensland; statewide context is shown.';
    $('dataNotices').textContent=notices.join(' ');$('dataNotices').hidden=!notices.length;status((demo?'DEMO: ':'')+(snapshot.active?'Current warning maps generated':'Statewide maps generated')+' · '+aest(snapshot.generated));
    // The map links are usable before optional report/camera work begins.
    const extra=new AbortController();state.extra=extra;
    setTimeout(()=>{if(run!==state.version)return;void snapshotReport(snapshot,extra.signal).then(report=>{if(run===state.version)showReport(report);}).catch(error=>{if(run===state.version)reportClear('Report text could not complete: '+errorText(error));});void extras(snapshot,run,extra.signal);if(snapshot.profile==='flooding')void loadGauges(snapshot,run,extra.signal);},0);
  }catch(error){if(run!==state.version)return;reportClear('Generate maps again to prepare report text.');status(error.name==='AbortError'?'Generation cancelled.':errorText(error));$('mapEmpty').hidden=false;$('mapEmpty').textContent='No new maps were generated. '+(error.name==='AbortError'?'':errorText(error));}
  finally{if(run===state.version){state.gen=null;updateButtons();}}
}
async function extras(snapshot,run,signal){
  if(!snapshot.active){state.cameraPhase='ready';$('cameraStatus').textContent='No active warning: camera reports are disabled.';$('affectedDistricts').textContent='No active warning.';return;}
  state.cameraPhase='loading';updateButtons();$('cameraStatus').textContent='Checking cameras against the warning footprint...';$('affectedDistricts').textContent='Checking disaster districts against the warning footprint...';
  const cameraPromise=demo?import('./js/demo.js').then(d=>({cameras:d.demoCameras(snapshot),notices:[]})):discoverCameras(connection,snapshot.scopeMasks,signal);
  const districtPromise=demo?Promise.resolve('Example District (synthetic)'):connection.districts(signal).then(collection=>[...new Set(warningLgas(collection,snapshot.scopeMasks).map(f=>f.properties?.[CONFIG.arcgis.districts.nameField]||f.properties?.name).filter(Boolean))].join(' · ')||'No intersecting districts detected.').catch(error=>'District source unavailable: '+errorText(error));
  const [cameras,districts]=await Promise.allSettled([cameraPromise,districtPromise]);if(run!==state.version||signal.aborted)return;
  $('affectedDistricts').textContent=districts.status==='fulfilled'?districts.value:'District analysis unavailable.';
  if(cameras.status==='rejected'){state.cameraPhase='error';$('cameraStatus').textContent='Camera analysis unavailable: '+errorText(cameras.reason);updateButtons();return;}
  state.cameraPhase='ready';state.cameraNotices=cameras.value.notices;state.cameras=cameras.value.cameras;$('cameraStatus').textContent=state.cameras.length+' cameras inside the actual warning footprint. '+cameras.value.notices.join(' ');
  for(const camera of state.cameras){const card=document.createElement('article');card.className='camera-item';const title=document.createElement('strong');title.textContent=camera.name;const source=document.createElement('small');source.textContent=camera.sourceLabel;const a=document.createElement('a');a.href=camera.url;a.target='_blank';a.rel='noopener noreferrer';a.textContent='Open source image';card.append(title,source,a);$('cameraList').append(card);}updateButtons();
}
async function loadGauges(snapshot,run,signal){
  if(!snapshot.active){state.gaugeStatus='ready';$('gaugeStatus').textContent='No active flood area: gauge reports are disabled.';updateButtons();return;}
  state.gaugeStatus='loading';$('gaugeStatus').textContent='Checking river gauges inside the selected flood area...';updateButtons();
  try{const gauges=demo?(await import('./js/demo.js')).demoGauges(snapshot):await discoverGauges(connection,snapshot.scopeMasks,signal);checkAbort(signal);if(run!==state.version)return;
    const map=gaugeMap(snapshot,gauges),blob=await canvasBlob(map),diagrams=[],diagramProducts=[];let flowNotice='';
    try{const layout=gaugeDiagramLayout(gauges);flowNotice=layout.unconnected.length?layout.unconnected.length+' gauges have no verified selected connection; their readings remain in the index.':'';
      for(const page of layout.pages){checkAbort(signal);const image=drawGaugeDiagram(snapshot,page,{signal}),flowBlob=await canvasBlob(image);checkAbort(signal);if(run!==state.version)return;
        diagrams.push({...page,data:image.toDataURL('image/jpeg',.94),width:image.width,height:image.height});diagramProducts.push(flowBlob);
      }
    }catch(error){checkAbort(signal);diagrams.length=0;diagramProducts.length=0;flowNotice='The river diagram could not be laid out. Gauge readings remain available in the index.';}
    checkAbort(signal);if(run!==state.version)return;state.gauges=gauges;state.gaugeMap=map;state.flowDiagrams=diagrams;state.gaugeStatus='ready';
    const base=(demo?'DEMO-':'')+'flooding-'+stamp(snapshot.generated);addProduct(blob,'Flood Warning / Watch + River Gauges',base+'-gauges.jpg');
    diagramProducts.forEach((product,index)=>addProduct(product,'River gauge flow — '+(index+1)+' of '+diagrams.length,base+'-river-flow-'+(index+1)+'.jpg'));$('mapCount').textContent=(3+diagrams.length)+' JPEG exports';
    $('gaugeStatus').textContent=gauges.length+' river gauges inside the selected flood area. '+gaugeFlowSummary(gauges)+' '+flowNotice+' Graphs load on request.';
    for(const gauge of gauges){const card=document.createElement('article');card.className='camera-item gauge-item';card.style.borderLeftColor=GAUGE_COLOURS[gauge.category];const title=document.createElement('strong');title.textContent=gauge.label+' · '+gauge.name+(gauge.stationId?' ['+gauge.stationId+']':'');const reading=document.createElement('p');reading.textContent=gaugeReading(gauge);const observed=document.createElement('small');observed.textContent='Observed: '+gaugeTime(gauge.observedAt);const updated=document.createElement('small');updated.textContent='Feed updated: '+gaugeTime(gauge.updatedAt);card.append(title,reading,observed,updated);
      const flow=document.createElement('small');flow.textContent=gaugeFlowLabel(gauge);card.append(flow);
      const timing=gaugeTiming(gauge,snapshot.generated.getTime());if(timing.length){const warning=document.createElement('small');warning.className='gauge-age';warning.textContent=timing.join(' · ');card.append(warning);}
      if(gauge.graphUrl){const link=document.createElement('a');link.href=gauge.graphUrl;link.target='_blank';link.rel='noopener noreferrer';link.textContent='Open source graph';card.append(link);}else{const note=document.createElement('small');note.textContent='Graph link not supplied by the layer.';card.append(note);}$('gaugeList').append(card);
    }
  }catch(error){if(run!==state.version||signal.aborted)return;state.gaugeStatus='error';$('gaugeStatus').textContent='River gauges unavailable: '+errorText(error);}
  finally{if(run===state.version)updateButtons();}
}
async function makePdf(kind){const snapshot=state.snapshot,gaugeDocument=kind==='gauges',items=gaugeDocument?[...state.gauges]:[...state.cameras];
  if(state.pdf||!snapshot?.active||!items.length||(gaugeDocument?(snapshot.profile!=='flooding'||state.gaugeStatus!=='ready'):state.cameraPhase!=='ready'))return;
  const run=state.version,controller=new AbortController(),message=$(gaugeDocument?'gaugeStatus':'cameraStatus'),progressBar=$(gaugeDocument?'gaugePdfProgress':'pdfProgress');state.pdf=controller;state.pdfKind=kind;updateButtons();progressBar.hidden=false;progressBar.value=0;progressBar.max=items.length;
  const progress=n=>{if(run===state.version){progressBar.value=n;message.textContent='Loading '+(gaugeDocument?'gauge graphs ':'camera photographs ')+n+' / '+items.length+'...';}};
  try{const fixtures=demo?await import('./js/demo.js'):null;let doc,summary;
    if(gaugeDocument){const graphs=fixtures?{entries:fixtures.demoGaugeGraphs(items),unavailable:0}:await retrieveGaugeGraphs(items,{connection,signal:controller.signal,onProgress:progress});checkAbort(controller.signal);if(run!==state.version)return;
      const map=state.gaugeMap,notes=graphs.unavailable?[graphs.unavailable+' graphs unavailable; their station readings remain in the report.']:[];
      message.textContent='Composing the river gauge report...';doc=gaugeReportPdf({jsPDF:globalThis.jspdf?.jsPDF,snapshot,gauges:items,graphs:graphs.entries,gaugeOverview:map?{data:map.toDataURL('image/jpeg',.94),width:map.width,height:map.height}:null,flowDiagrams:state.flowDiagrams,notes,signal:controller.signal});summary=items.length+' gauges. '+notes.join(' ');
    }else{const photos=fixtures?{included:fixtures.demoPhotos(items),stale:0,unavailable:0}:await retrievePhotos(items,{connection,signal:controller.signal,onProgress:progress});checkAbort(controller.signal);if(run!==state.version)return;
      if(!photos.included.length)throw new Error('No eligible photographs were retrieved. Stale: '+photos.stale+'; inaccessible: '+photos.unavailable+'. No camera PDF generated.');
      message.textContent='Composing the camera report...';const map=cameraMap(snapshot,photos.included.map(entry=>entry.camera)),overview={data:map.toDataURL('image/jpeg',.88),width:map.width,height:map.height};
      doc=cameraPdf({jsPDF:globalThis.jspdf?.jsPDF,snapshot,photos:photos.included,overview,signal:controller.signal});summary=photos.included.length+' photographs. '+(photos.stale||photos.unavailable?photos.stale+' stale and '+photos.unavailable+' inaccessible images omitted. ':'')+(state.cameraNotices.length?'Some camera sources were unavailable.':'');
    }
    checkAbort(controller.signal);if(run!==state.version)return;download(doc.output('blob'),(demo?'DEMO-':'')+(gaugeDocument?'river-gauge-report-':'camera-situation-report-')+stamp(snapshot.generated)+'.pdf');message.textContent='PDF generated: '+summary;
  }catch(error){if(run===state.version)message.textContent=error.name==='AbortError'?'PDF generation cancelled.':errorText(error);}
  finally{if(run===state.version){state.pdf=null;state.pdfKind=null;progressBar.hidden=true;updateButtons();}}
}
const feedCards=new Map();
function cameraSourceControl(result,card){
  const spec=result.id==='gauges'?CONFIG.arcgis.gauges:CONFIG.arcgis.cameras.find(spec=>'camera-'+spec.key===result.id);card.source?.remove();card.source=null;
  if(!spec||result.status!=='error'||!(spec.key in connection.featureChoices))return;
  const candidates=connection.featureChoices[spec.key]||[],group=document.createElement('div');group.className='feed-source';
  const label=document.createElement('label');label.textContent=candidates.length>1?'Choose the ArcGIS layer source':'ArcGIS layer item link or ID';
  const input=document.createElement(candidates.length>1?'select':'input');input.setAttribute('aria-label',spec.label+' ArcGIS source');
  if(candidates.length>1){const blank=document.createElement('option');blank.value='';blank.textContent='Choose the correct source';input.append(blank);for(const item of candidates){const option=document.createElement('option');option.value=item.id;option.textContent=item.title+' ('+(item.owner||'owner unavailable')+')';input.append(option);}}
  else{input.type='text';input.placeholder='Paste the item-page link from ArcGIS';}
  input.value=connection.featureSelections.get(spec.key)||'';const button=document.createElement('button');button.textContent='Use item and recheck';button.type='button';
  button.addEventListener('click',()=>{try{connection.setFeatureSelection(spec,input.value);void verify();}catch(error){card.detail.textContent=errorText(error);}});
  label.append(input);group.append(label,button);card.element.append(group);card.source=group;
}
function showSession(connected){$('connectionPanel').hidden=connected;$('appView').hidden=!connected;$('signOut').hidden=!connected||demo;}
function updateFeed(result){const previous=state.feedStates.get(result.id)||{};state.feedStates.set(result.id,{...previous,...result});const card=feedCards.get(result.id);if(!card)return;
  card.element.dataset.status=result.status;card.badge.textContent=({ok:'Connected',error:'Unavailable',checking:'Checking',pending:'Waiting'})[result.status]||'Waiting';card.detail.textContent=result.detail||'';cameraSourceControl(result,card);
  state.ready=state.connected&&readyForMaps(state.feedStates);const values=[...state.feedStates.values()],finished=values.filter(v=>['ok','error'].includes(v.status)).length,errors=values.filter(v=>v.status==='error').length;
  $('connectionStatus').textContent=finished===FEEDS.length?`${finished-errors} connections passed${errors?`; ${errors} need attention`:''}. ${state.ready?'Core map layers are ready.':'Required map layers must connect before generation.'}`:`Checking layer connections: ${finished} / ${FEEDS.length} complete.`;
  if(!state.gen&&!state.snapshot)status(readyStatus());updateButtons();
}
function resetFeedCards(){state.feedStates.clear();feedCards.clear();$('feedChecks').replaceChildren();for(const feed of FEEDS){const element=document.createElement('article');element.className='feed-card';const title=document.createElement('strong');title.textContent=feed.label+(feed.required?' · required':'');const badge=document.createElement('span');badge.className='badge';const detail=document.createElement('p');element.append(title,badge,detail);$('feedChecks').append(element);feedCards.set(feed.id,{element,badge,detail});updateFeed({id:feed.id,status:'pending',detail:'Waiting to check...'});}}
function weatherChoices(){let needsChoice=false;for(const role of ['warning','radar']){const items=connection.choices[role]||[],select=$(role+'Item'),selected=select.value;select.replaceChildren();if(items.length!==1){needsChoice=true;const option=document.createElement('option');option.value='';option.textContent=items.length?'Choose the correct portal item':'No accessible item found';select.append(option);}for(const item of items){const option=document.createElement('option');option.value=item.id;option.textContent=item.title+' ('+item.owner+')';select.append(option);}if(items.some(item=>item.id===selected))select.value=selected;}$('layerChoices').hidden=!needsChoice;}
async function verify(){if(!state.connected||demo)return;state.checkController?.abort();connection.featureItems.clear();const controller=new AbortController(),run=++state.checkVersion;state.checkController=controller;state.ready=false;state.floods=[];state.floodScanned=false;state.floodAttempted=false;resetFloodChoice('Waiting for map connections...');invalidate();$('verifyFeeds').disabled=true;resetFeedCards();
  const current=()=>run===state.checkVersion&&state.connected&&!controller.signal.aborted;
  try{
    try{await withDeadline(signal=>connection.discoverWeather(signal),controller.signal);}
    catch(error){if(!current())return;connection.choices={warning:[],radar:[]};$('connectionStatus').textContent='Weather item discovery failed: '+errorText(error);}
    if(!current())return;weatherChoices();
    await checkLayerConnections(connection,{warningId:$('warningItem').value,radarId:$('radarItem').value,signal:controller.signal,onUpdate:result=>{if(current())updateFeed(result);}});
    if(current()&&!state.ready)status('Required map layers are unavailable. Review their connection status and recheck layers.');
  }catch(error){if(current())$('connectionStatus').textContent='Layer checks could not finish: '+errorText(error);}
  finally{if(current()){state.checkController=null;$('verifyFeeds').disabled=false;updateButtons();if(state.profile==='flooding'&&state.ready&&!state.floodAttempted&&!state.gen)void scanFlood();}}
}
async function connect(resume=false){const run=++state.authVersion;state.checkVersion++;state.checkController?.abort();state.connected=false;state.ready=false;showSession(false);invalidate();$('signIn').disabled=true;$('orgPrefix').disabled=true;$('loginStatus').textContent=resume?'Checking your ArcGIS session...':'Opening ArcGIS sign-in...';const prefix=$('orgPrefix').value;save('orgPrefix',prefix);
  try{const result=await connection.connect(prefix,CONFIG.arcgis.clientId,{resume});if(run!==state.authVersion)return;state.connected=true;state.floods=[];state.floodScanned=false;$('account').textContent=result.user;showSession(true);void verify();}
  catch(error){if(run!==state.authVersion)return;$('loginStatus').textContent=resume?'Sign in to your ArcGIS organisation to continue.':errorText(error);state.ready=false;showSession(false);updateButtons();}
  finally{if(run===state.authVersion){$('signIn').disabled=false;$('orgPrefix').disabled=false;}}
}
async function scanFlood(){
  if(!state.ready||state.gen||state.profile!=='flooding')return;
  invalidate('Loading current BoM flood warnings and watches...');const run=state.version,controller=new AbortController();
  state.floods=[];state.floodScanned=false;state.floodAttempted=true;state.gen=controller;resetFloodChoice('Loading current BoM warnings...');
  $('floodStatus').textContent='Loading current BoM flood warnings and watches...';status('Loading current BoM flood warnings and watches...');updateButtons();
  try{
    const areas=demo?[]:await scanFloods(connection,controller.signal,text=>{if(run===state.version){$('floodStatus').textContent=text;status(text);}});
    checkAbort(controller.signal);if(run!==state.version)return;
    state.floods=areas;state.floodScanned=true;resetFloodChoice(areas.length?'Select a BoM flood warning or watch':'No current BoM flood warnings or watches');
    for(const area of areas){const option=document.createElement('option');option.value=area.id;option.textContent=area.title;$('floodChoice').append(option);}
    if(areas.length===1)$('floodChoice').value=areas[0].id;
    $('floodStatus').textContent=areas.length?areas.length+' current BoM flood warnings / watches found. Choose one to include all its catchments.':'No current BoM flood warnings or watches in Queensland. A statewide map is available.';$('mapEmpty').textContent=areas.length?'Select a BoM warning, then generate maps.':'No current BoM flood warnings or watches. Generate a statewide map.';showFloodNotice();status(readyStatus());
  }catch(error){if(run===state.version){state.floodScanned=false;resetFloodChoice('Refresh BoM warnings to retry');const text=error.name==='AbortError'?'BoM warning loading cancelled. Refresh BoM warnings to retry.':errorText(error);$('floodStatus').textContent=text;$('mapEmpty').textContent='Refresh BoM warnings before generating maps.';status(text);}}
  finally{if(run===state.version){state.gen=null;updateButtons();}}
}
let eventCopiedHtml=false;
function richCopyEvent(event){if(!event.clipboardData)return;const editor=$('reportEditor'),text=editor.value.slice(editor.selectionStart,editor.selectionEnd);if(!text)return;try{event.clipboardData.setData('text/plain',text);event.clipboardData.setData('text/html',clipboardHtml(text));event.preventDefault();eventCopiedHtml=true;}catch{}}
async function copyReport(){const text=$('reportEditor').value;if(!text.trim())return;try{if(navigator.clipboard?.write&&globalThis.ClipboardItem){await navigator.clipboard.write([new ClipboardItem({'text/plain':new Blob([text],{type:'text/plain'}),'text/html':new Blob([clipboardHtml(text)],{type:'text/html'})})]);$('reportStatus').textContent='Copied with source hyperlinks.';return;}}catch{}
  const edit=$('reportEdit'),was=edit.open;edit.open=true;$('reportEditor').focus();$('reportEditor').select();eventCopiedHtml=false;try{if(document.execCommand('copy')){edit.open=was;$('reportStatus').textContent=eventCopiedHtml?'Copied with source hyperlinks.':'Copied as plain text with source URLs.';return;}}catch{}
  try{if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(text);edit.open=was;$('reportStatus').textContent='Copied as plain text with source URLs.';return;}}catch{}$('reportStatus').textContent='Copy was blocked. The text is selected; use your device’s Copy command.';
}
$('orgPrefix').value=stored('orgPrefix');
$('tracking').checked=stored('tracking')==='true';$('tracking').addEventListener('change',()=>save('tracking',String($('tracking').checked)));
$('outageLabelMinimum').value=String(normaliseLabelMinimum(stored('outageLabelMinimum')));$('outageLabelMinimum').addEventListener('change',()=>{save('outageLabelMinimum',$('outageLabelMinimum').value);if(state.snapshot)status('Outage labels changed. Generate maps to update the map.');});
function applyTheme(theme){const dark=theme==='dark';document.documentElement.dataset.theme=dark?'dark':'light';document.body.classList.toggle('dark',dark);$('theme').textContent=dark?'Light mode':'Dark mode';$('theme').setAttribute('aria-pressed',String(dark));}
applyTheme(stored('theme','light'));$('theme').addEventListener('click',()=>{const theme=document.documentElement.dataset.theme==='dark'?'light':'dark';applyTheme(theme);save('theme',theme);});
document.querySelectorAll('[data-profile]').forEach(button=>button.addEventListener('click',()=>{state.profile=button.dataset.profile;if(state.profile==='flooding'&&!demo){state.floods=[];state.floodScanned=false;state.floodAttempted=false;resetFloodChoice('Waiting for current flood areas...');}invalidate();document.querySelectorAll('[data-profile]').forEach(b=>{const active=b===button;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));});status(readyStatus());if(state.profile==='flooding'&&state.ready&&!demo)void scanFlood();}));
$('loginForm').addEventListener('submit',event=>{event.preventDefault();void connect();});$('verifyFeeds').addEventListener('click',verify);$('signOut').addEventListener('click',()=>{state.authVersion++;state.checkVersion++;state.checkController?.abort();state.checkController=null;state.connected=false;state.ready=false;state.floods=[];state.floodScanned=false;invalidate();connection.disconnect();$('account').textContent='Not connected';$('layerChoices').hidden=true;$('loginStatus').textContent='Signed out. Choose your organisation to sign in again.';showSession(false);$('orgPrefix').focus();updateButtons();});
for(const role of ['warning','radar'])$(role+'Item').addEventListener('change',()=>{state.checkVersion++;state.checkController?.abort();state.checkController=null;state.ready=false;state.feedStates.set(role,{id:role,status:'pending'});invalidate();$('verifyFeeds').disabled=false;$('connectionStatus').textContent='Weather item selection changed. Recheck layers to verify access.';});
$('generate').addEventListener('click',generate);$('cancelGenerate').addEventListener('click',()=>state.gen?.abort());$('cameraPdf').addEventListener('click',()=>makePdf('cameras'));$('gaugePdf').addEventListener('click',()=>makePdf('gauges'));for(const id of ['cancelPdf','cancelGaugePdf'])$(id).addEventListener('click',()=>state.pdf?.abort());$('scanFloods').addEventListener('click',scanFlood);$('floodChoice').addEventListener('change',()=>{invalidate();showFloodNotice();status(readyStatus());});
$('reportEditor').addEventListener('input',()=>{preview();$('reportStatus').textContent='Edited report text. Copy includes your changes.';});$('reportEditor').addEventListener('copy',richCopyEvent);$('copyReport').addEventListener('click',copyReport);$('resetReport').addEventListener('click',()=>{$('reportEditor').value=state.originalReport;preview();$('reportStatus').textContent='Generated text restored.';});
showSession(demo);
if(demo){$('feedPanel').hidden=true;$('demoBanner').hidden=false;$('demoNoWarning').hidden=false;$('account').textContent='Offline demonstration';status('DEMO: Generate maps to test synthetic outputs.');$('floodStatus').textContent='Demo uses one synthetic warning area.';}else if($('orgPrefix').value)void connect(true);
updateButtons();
