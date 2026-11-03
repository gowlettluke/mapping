# Data sources and adapter assumptions

All configured URLs are in `config.js`. Service accessibility and schema must be checked in the deployment environment.

| Data | Source / assumption |
| --- | --- |
| Warning WMS | Organisation portal item titled `BoM Severe Weather Warning WMS APIM PRD`; thunderstorm `IDZ20006`, severe weather `IDZ20005`, flood warning/watch `IDZ20013` / `IDZ20016`. |
| Radar WMS | Item titled `BoM Radar WMS APIM PRD`; native layer `IDR00010`. Warning and radar retain separate registered definitions even if their underlying gateway is the same. |
| Storm tracking | Optional `IDZ20007_track` / `IDZ20007`; Warning + Radar export only, drawn above the radar. |
| LGAs | Queensland Administrative Boundaries MapServer layer 1. GeoJSON paging must finish; basic statewide coverage is checked before use. |
| Queensland locator | Mainland geometry from Geographical Features layer 90, with separate Foundation Data coast layer 55 and state border layer 5. LGA polygons are used for analysis, not the locator silhouette. |
| Outages | Separate `gowlettluke/qldpoweroutages` current-outage GeoJSON for map geometry and `provider_council_counts` in its run manifest for report figures. Map health requires fresh matching metadata, record counts and provider success. Council counts require their own fresh publisher/retrieval timestamps and complete reconciled provider totals. |
| Roads | Public QLDTraffic events GeoJSON. Major-road names are checked against Foundation Data layer 23 (Motorway/Highway). Full closures appear in report text; restrictions remain map information. |
| Cameras | QLDTraffic public webcams, State Road Information layer 4 fallback, and portal camera items (Feature Service, Map Service, Feature Collection or Web Map). `QLD Flood Cameras` is an alias for the `Web Cameras - LIVE` service; it contains council flood cameras shared through Guardian IMS/QIT Plus. BCC images use ArcGIS attachments. Preferred names are checked before alternatives; distinct ambiguous items require a source choice. Matching uses warning pixels rather than the padded map extent. |
| Districts | Signed-in item `District_Disaster_Management_Groups_DDMG_Boundary_Status_Url`, layer 0, `PROP_DD`. Optional to map/report generation. |
| Flood references | Public BoM National Flood Gauge Network warning/watch catchment layers, with verified bundled Queensland geometry when browser requests are blocked. The 27 October 2026 snapshot contains 148 warning catchments and 74 watch catchments. These are static reference boundaries, never active warning data. Product identification remains best effort; unidentified connected areas stay separate. |
| Background | Esri World Topographic Map tiles. Credits are read from service metadata, with a fallback attribution. If unavailable, boundary context is labelled. |

Outage reports use the providers' own unplanned council customer counts, filtered to LGAs intersected by the warning. They do not claim that every affected customer lies under a warning pixel, or that the weather caused the outage. Each selected LGA appears once per provider; its provider-published count contributes once to the section total. There are no combined polygon-intersection rows or shared-count asterisks.

The upstream collector reads Energex's [emergency text council API](https://www.energex.com.au/api/outages-text/v1.0.ex/council?council=), reconciles its council sum with the summary endpoint, and rejects an update during collection. Ergon counts come from its [current text view](https://www.ergon.com.au/network/outages/outage-finder/outage-finder-text-view), summing council/event rows marked `UNPLN` or `FORCD`, excluding `PLN`. Cross-council events retain Ergon's published allocations. Its `hiddenDate` is the publisher update time.

The manifest's `provider_council_counts` schema version 1 must match its `generated_utc` snapshot. Both publisher and retrieval times must be within 45 minutes, with no more than five minutes of future clock skew. Complete successful entries have `scope: all_councils`, `outage_type: unplanned`, integer customer counts and a reconciled total. Council suffixes/renaming are matched against the current Queensland LGA catalogue (including Noosa, Sunshine Coast and Moreton Bay). Duplicate council names and malformed counts fail validation. An old manifest without this field cannot supply report counts; geometry/centroid estimates are never substituted. Failed sources are shown beside the report, not copied as fictitious no-impact statements.

A valid source can publish a positive count under `Unknown` or another unmatched council name. This does not invalidate its matched LGA rows. In warning-scoped reports, unmatched customer counts are excluded from the LGA total, identified in the copied text and flagged beside the report. If there are no matched impacts but positive unassigned counts, the section says coverage is incomplete rather than claiming no current outages. Zero-customer unmatched rows do not suppress verified empty sections. Statewide mode includes all provider customers, with `LGA not specified` for missing-name placeholders and labelled rows for other unmatched source names. Counts are never geographically allocated by inference.

Map footers include generation time and source credits. They omit missing observation/issue times. Camera PDFs distinguish verified capture timestamps from retrieval time and retain provider-hosted unavailable-camera images when successfully retrieved.

Infrastructure outage styling uses fixed customer-count bands: 0–99, 100–499, 500–999 and 1,000+, with neutral grey for unknown counts. This heat-style shading follows the supplied outage areas/points; it does not interpolate new affected areas or infer household locations. Number labels default to 100 customers and can be changed to all, 100, 250, 500 or 1,000 using the Outage labels control before generating maps. This is a display threshold, not an operational significance classification or a report filter. Full eligible outage counts continue into the report independently of the label setting.

## Camera schemas checked — 27 October 2026

The [QLD Flood Cameras item](https://www.arcgis.com/home/item.html?id=586b27c10999490eb4314fecfe322612) exposes the `Web Cameras - LIVE` service. Fields `Image_Url` through `Image_Url9` can contain separate views, and the first field may be empty. The adapter retains each distinct valid image URL. The source covers council cameras and is labelled **Queensland flood cameras**, rather than attributing every camera to TMR.

The official BrisbaneCityCouncil [BCC City Resilience cameras view](https://www.arcgis.com/home/item.html?id=f9d72710619f401da3c7bce598ce523f) has point locations and camera IDs, but no photograph URL field. Council's [published dashboard map](https://www.arcgis.com/home/item.html?id=76f042edeb4a463c846e1f8a0edc5996) resolves photographs using feature attachments. The adapter reads layer metadata, pages `queryAttachments` by feature object ID, and builds image links from the returned attachment IDs. Attachment IDs are never pinned and camera IDs are not converted into guessed image URLs. Registered URL parameters are retained. Connection checks fetch only metadata; photographs remain on request. `image_last_updated` and general edit dates are not treated as verified photo capture times.

The public metadata snapshot checked during this revision contained 13 BCC locations with 13 attachment image links and 501 Queensland locations with 595 image views. These are validation observations, not expected permanent counts. Runtime discovery continues through the signed-in portal; these public item IDs are documentation, not hard-coded source overrides.

Relevant primary SDK documentation:

- <https://developers.arcgis.com/javascript/latest/programming-patterns/>
- <https://developers.arcgis.com/javascript/latest/references/core/identity/OAuthInfo/>
- <https://developers.arcgis.com/javascript/latest/references/core/layers/WMSLayer/>
- <https://github.com/parallax/jsPDF>

No third-party imagery or live observations are bundled as operational data. `demo.html` uses fictional synthetic fixtures and marks its output accordingly.

Bundled catchment geometry is attributed to © Commonwealth of Australia (Bureau of Meteorology) 2025. `data/flood-references.json` records the official query endpoints, Queensland filter, retrieval time, feature counts and SHA-256 hashes. The source polygon geometry is retained at five decimal places without simplification; gzip only reduces transfer size. Both the live and bundled routes filter to Queensland catchments. Hash/count/shape validation failures are rejected. `scripts/refresh-flood-references.py` refreshes both complete datasets before replacing the local files. Connection checks and flood-name matching share the same loader so a successful check verifies the data actually used by the application.

## Registered WMS rendering

The recovered implementation description supplied on 27 October 2026 confirmed separate warning/radar items and the need to preserve each item's map URL, URL query parameters, custom/global and custom/layer parameters, WMS version, native names and native styles. It also identified an organisation Export Web Map fallback. It did not recover item IDs or complete source. This replacement reads the actual private item definitions at runtime rather than substituting the visible upstream gateway URL or embedding credentials in the repository.

`js/wms.js` builds each render independently from that registered definition. It preserves vendor parameters and replaces only the fields that select the requested image operation, extent, native names/styles and pixel size. Direct image access uses ArcGIS `esriRequest`; if unavailable, the portal-configured print task receives the registered WMS definition via POST. Print output is a transparent PNG containing only the selected WMS layer, without a basemap or page surround. Aspect-ratio expansion is explicitly cropped back to the requested extent so warning pixels remain aligned with LGA analysis. Synchronous and asynchronous Export Web Map tasks are supported. Errors identifying failed layers are rejected even if the service also supplies an output image. No generic sharing proxy is used.

The organisation's print server still needs access to the registered WMS configuration. Adding the fallback does not itself grant that access or prove live operation. Runtime configuration, request URLs and GP messages can contain sensitive parameters; they are not persisted or included in exported maps/reports or user-facing errors.

## Flood display

Flood JPEGs retain the original WMS image. They skip the additional brown
`outlineCanvas` pass: tracing every edge in a colour-detection mask also traces
internal hatching and can turn fine source patterns into dense brown shading.
Storm and severe-weather rendering retain their existing outline. Basemap,
LGA/coast/state styling, road symbology, outage shading and label thresholds are
unchanged.

`IDZ20013_label` / `IDZ20016_label` are requested separately for the selected
warning/watch type. Their readable transparent image gets a white halo and is
drawn above the map overlays in both JPEGs. Blank/opaque substitutes are rejected.
Name footprints reserve space in the existing outage-number layout. None of the
label pixels enter warning detection, area selection, affected-LGA calculations
or report totals. If native labels are unavailable or blank at the requested
scale, names from the corresponding BoM reference catchments are placed only
where those catchments overlap actual detected warning pixels. This fallback
provides catchment names; it does not invent finer river-reach titles or imply
that an inactive reference polygon is a warning.

The flood legend is the source's image, selected for the same warning/watch
layer and native style. The registered GetLegendGraphic operation is tried
first, followed by the advertised `legendUrl` if provided. Both use the
authenticated SDK; registered request parameters are never copied to an
advertised endpoint. [Esri documents this WMS sublayer legend URL](https://developers.arcgis.com/javascript/latest/references/core/layers/support/WMSSublayer/#legendUrl).
An unreadable, blank or unavailable source legend produces an explicit notice
in the export and interface. The app never guesses severity meanings from pixel
colours or substitutes the old yellow warning swatch. Optional name/legend
failures do not turn an active flood area into a no-warning result.

## River gauges and graph images

The optional gauge source is the signed-in organisation's **BOM Flood Gauges
15min QFD DataShare** item, the point layer shown in the user's 4 November 2026
screenshots. The item title and layer number are configured; private service
URLs and credentials are not committed. The user-confirmed item ID
`1d05b9f286334868a2dd70079d963810` is loaded directly through the current portal
session. Manual item choices override this default for the session, and remain
available if the configured item cannot load. A failed gauge check never
blocks the two existing map products or camera-only exports.

Service metadata, coded domains, field aliases and saved popup labels resolve
station names/IDs, heights, source classifications, trends and timestamps.
Numeric heights do not determine severity. Missing classifications/timestamps
stay unknown; timezone-free timestamp strings are not silently treated as AEST.
Gauge inclusion uses the selected snapshot's flood masks rather than entire
intersecting LGAs. Duplicate station records retain the latest observation;
distinct stations at the same location remain separate.

Graph links are read from graph/image fields, popup image media or HTML image
templates. Field substitutions preserve source station IDs, including leading
zeroes. Legacy HTTP image links use HTTPS on the same host. No BoM image paths,
thresholds, history or graphs are fabricated from current readings. Popup
Arcade expressions and native interactive charts are not evaluated into graphs;
those need a source image URL before they can be embedded. See Esri's
[popupInfo](https://developers.arcgis.com/web-map-specification/objects/popupInfo/)
and [image value](https://developers.arcgis.com/web-map-specification/objects/value/)
specifications.

Only graph export retrieves image bodies. ArcGIS-hosted images use the current
SDK session; public image requests do not receive ArcGIS credentials. Missing,
blocked or unreadable graph images keep their station readings and an explicit
unavailable placeholder. A graph's retrieval time is distinct from both the
station observation time and the layer update time; retrieving a graph does not
establish that its plotted observations are current.

Age notices currently mark observations older than 120 minutes and layer updates
older than 45 minutes; both values are in `CONFIG.gauges`. These notices retain
the data and its reported classification. They are not the camera photograph
one-hour exclusion rule and do not declare the observation invalid. Gauges-only
PDFs remain available with no cameras and with missing graph images.
