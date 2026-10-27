# Data sources and adapter assumptions

All configured URLs are in `config.js`. Service accessibility and schema must be checked in the deployment environment.

| Data | Source / assumption |
| --- | --- |
| Warning WMS | Organisation portal item titled `BoM Severe Weather Warning WMS APIM PRD`; thunderstorm `IDZ20006`, severe weather `IDZ20005`, flood warning/watch `IDZ20013` / `IDZ20016`. |
| Radar WMS | Item titled `BoM Radar WMS APIM PRD`; native layer `IDR00010`. Warning and radar retain separate registered definitions even if their underlying gateway is the same. |
| Storm tracking | Optional `IDZ20007_track` / `IDZ20007`; infrastructure export only. |
| LGAs | Queensland Administrative Boundaries MapServer layer 1. GeoJSON paging must finish; basic statewide coverage is checked before use. |
| Queensland locator | Mainland geometry from Geographical Features layer 90, with separate Foundation Data coast layer 55 and state border layer 5. LGA polygons are used for analysis, not the locator silhouette. |
| Outages | Separate `gowlettluke/qldpoweroutages` current-outage GeoJSON and run manifest. Canonical fields include `provider_code`, `outage_id`, `outage_type`, `affected_customers`, `affected_customers_known`, `snapshot_utc`. Requires fresh matching metadata, record counts and provider success. |
| Roads | Public QLDTraffic events GeoJSON. Major-road names are checked against Foundation Data layer 23 (Motorway/Highway). Full closures appear in report text; restrictions remain map information. |
| Cameras | QLDTraffic public webcams, State Road Information layer 4 fallback, and signed-in TMR/BCC feature portal items. Image URLs and geometry are normalised. Matching uses warning pixels rather than the padded map extent. |
| Districts | Signed-in item `District_Disaster_Management_Groups_DDMG_Boundary_Status_Url`, layer 0, `PROP_DD`. Optional to map/report generation. |
| Flood references | Public BoM National Flood Gauge Network warning/watch catchment layers. Product identification is best effort; unidentified connected areas stay separate. |
| Background | Esri World Topographic Map tiles. Credits are read from service metadata, with a fallback attribution. If unavailable, boundary context is labelled. |

Outage reports concern all unplanned outages affecting an LGA intersected by the warning. They do not claim that every outage itself lies under a warning pixel, or that the weather caused it. An outage crossing LGA boundaries has no defensible customer allocation unless the source supplies one; it is reported as a shared total without duplicating customers in LGA totals. Partial source failures are shown beside the report, not copied as fictitious no-impact statements.

Map footers include generation time and source credits. They omit missing observation/issue times. Camera PDFs distinguish verified capture timestamps from retrieval time and retain provider-hosted unavailable-camera images when successfully retrieved.

Relevant primary SDK documentation:

- <https://developers.arcgis.com/javascript/latest/programming-patterns/>
- <https://developers.arcgis.com/javascript/latest/references/core/identity/OAuthInfo/>
- <https://developers.arcgis.com/javascript/latest/references/core/layers/WMSLayer/>
- <https://github.com/parallax/jsPDF>

No third-party imagery or live observations are bundled as operational data. `demo.html` uses fictional synthetic fixtures and marks its output accordingly.

## Registered WMS rendering

The recovered implementation description supplied on 27 October 2026 confirmed separate warning/radar items and the need to preserve each item's map URL, URL query parameters, custom/global and custom/layer parameters, WMS version, native names and native styles. It also identified an organisation Export Web Map fallback. It did not recover item IDs or complete source. This replacement reads the actual private item definitions at runtime rather than substituting the visible upstream gateway URL or embedding credentials in the repository.

`js/wms.js` builds each render independently from that registered definition. It preserves vendor parameters and replaces only the fields that select the requested image operation, extent, native names/styles and pixel size. Direct image access uses ArcGIS `esriRequest`; if unavailable, the portal-configured print task receives the registered WMS definition via POST. Print output is a transparent PNG containing only the selected WMS layer, without a basemap or page surround. Aspect-ratio expansion is explicitly cropped back to the requested extent so warning pixels remain aligned with LGA analysis. Synchronous and asynchronous Export Web Map tasks are supported. Errors identifying failed layers are rejected even if the service also supplies an output image. No generic sharing proxy is used.

The organisation's print server still needs access to the registered WMS configuration. Adding the fallback does not itself grant that access or prove live operation. Runtime configuration, request URLs and GP messages can contain sensitive parameters; they are not persisted or included in exported maps/reports or user-facing errors.
