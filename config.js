// Public identifiers and public data sources only. Never put passwords,
// API secrets, organisation tokens or private service URLs in this file.
export const CONFIG = {
  reconstruction: {date:"2026-10-25", lastRecordedOriginalCommit:"3e1e35a132f7ebd0e14db338f56d0fa1900e8e3d"},
  arcgis: {
    sdk:"https://js.arcgis.com/5.1/",
    clientId:"PoEOYlSa1Jm7IaeQ", // Recorded public OAuth ID; redirect registration must be checked.
    items:{warning:"BoM Severe Weather Warning WMS APIM PRD",radar:"BoM Radar WMS APIM PRD"},
    cameras:[
      {key:"flood",title:"Web Cameras - LIVE",layer:0,label:"TMR flood cameras"},
      {key:"bcc",title:"BCC_City_Resilience_cameras_view",alternatives:["BCC City Resilience cameras DataShare","BCC City Resilience cameras"],layer:0,label:"BCC City Resilience cameras"}
    ],
    districts:{title:"District_Disaster_Management_Groups_DDMG_Boundary_Status_Url",layer:0,nameField:"PROP_DD"}
  },
  publicSources:{
    lga:"https://spatial-gis.information.qld.gov.au/arcgis/rest/services/Boundaries/AdministrativeBoundaries/MapServer/1",
    mainland:"https://spatial-gis.information.qld.gov.au/arcgis/rest/services/Location/GeographicalFeatures/FeatureServer/90",
    coastline:"https://spatial-gis.information.qld.gov.au/arcgis/rest/services/Basemaps/FoundationData/FeatureServer/55",
    border:"https://spatial-gis.information.qld.gov.au/arcgis/rest/services/Basemaps/FoundationData/FeatureServer/5",
    majorRoads:"https://spatial-gis.information.qld.gov.au/arcgis/rest/services/Basemaps/FoundationData/FeatureServer/23",
    outages:"https://raw.githubusercontent.com/gowlettluke/qldpoweroutages/main/data/current_outages.geojson",
    outageManifest:"https://raw.githubusercontent.com/gowlettluke/qldpoweroutages/main/data/run_manifest.json",
    traffic:"https://data.qldtraffic.qld.gov.au/events_v2.geojson",
    trafficCameras:"https://api.qldtraffic.qld.gov.au/v1/webcams?apikey=3e83add325cbb69ac4d8e5bf433d770b", // TMR's published public developer key.
    cameraFallback:"https://spatial-gis.information.qld.gov.au/arcgis/rest/services/Transportation/StateRoadInformation/MapServer/4",
    tiles:"https://services.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}",
    topoMetadata:"https://services.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer"
    ,floodWarnings:"https://hosting.wsapi.cloud.bom.gov.au/arcgis/rest/services/flood/National_Flood_Gauge_Network/FeatureServer/1"
    ,floodWatches:"https://hosting.wsapi.cloud.bom.gov.au/arcgis/rest/services/flood/National_Flood_Gauge_Network/FeatureServer/0"
  },
  rendering:{qld:[137.7,-29.3,154.2,-9],detection:[720,950],width:1500,height:1120,minimumRegionalKm:180,padding:.4},
  profiles:{
    thunderstorm:{label:"Severe Thunderstorm",warning:["IDZ20006"],titles:["Severe Thunderstorm Warning | Australia"],tracking:["IDZ20007_track","IDZ20007"]},
    severeWeather:{label:"Severe Weather",warning:["IDZ20005"],titles:["Severe Weather Warning | Australia"],tracking:[]},
    flooding:{label:"Flooding",warning:["IDZ20013","IDZ20016"],titles:["Flood Warning | Australia","Flood Watch | Australia"],tracking:[]}
  },
  radar:{names:["IDR00010"],titles:["Radar Rain Rate | Australia | raster"]}
};
