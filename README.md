# Queensland Warning Mapping — reconstructed replacement

This is a new reconstruction dated **25 October 2026**, based on the requirements and implementation details retained in the project conversation. It is **not an exact recovery** of the lost `giswatidid/Mapping` repository. The last recorded original commit was `3e1e35a132f7ebd0e14db338f56d0fa1900e8e3d`; its source was not available for comparison.

The complete app is static HTML, CSS and JavaScript. No build step, application server, npm dependencies or private credentials are included. Keep all files together.

The interface follows the shared situation-board styling in [qldpoweroutages](https://github.com/gowlettluke/qldpoweroutages) and [qld_only_isolation](https://github.com/gowlettluke/qld_only_isolation): neutral grey/white surfaces, red accents, compact square panels and controls, and a persistent light/dark theme. Theme colours are defined in `styles.css`; map-export symbology is defined separately in `js/renderer.js`.

## Try it locally

Extract the ZIP, open a terminal in this folder and run:

```sh
python3 -m http.server 8000
```

Open <http://localhost:8000/demo.html> to exercise the two JPEG exports, report text and camera PDF with clearly marked **synthetic** fixtures. This separate demonstration works without ArcGIS or live data. Open <http://localhost:8000/> for the actual app. Opening the HTML directly as a `file:` URL does not support its JavaScript modules.

For live operation, the entry page asks only for your ArcGIS organisation prefix. Continue to ArcGIS's own sign-in page; after authentication, the app opens and automatically checks its data connections. A unique registered warning/radar item is selected automatically. Only ambiguous or missing weather items expose a selection control; choose the correct owner and use **Recheck layers**. The app uses the recorded public OAuth client ID from `CONFIG.arcgis.clientId` in `config.js` automatically; users do not enter or edit it. Its availability and registered redirect URL still need checking by the app administrator. Do not enter tokens, passwords or private API keys in `config.js`.

The connection panel checks warning/radar rendering, LGA coverage, both outage providers, traffic events and major-road names, coast/border/locator sources, basemap metadata, camera lists and authenticated camera/district queries, plus flood reference layers. It does not fetch camera photographs. Warning, radar and LGAs must pass before map generation is enabled; optional failures are reported separately. Checks have deadlines and are cancelled on sign-out or a superseding check. No layer requests are made before sign-in, except in the separate synthetic demo which uses no live connections.

Private warning/radar definitions are read through authenticated ArcGIS PortalItems. Their registered `mapUrl`, existing query values, custom parameters, WMS version, item identity, native layer names and styles are retained for image requests. Direct images use IdentityManager-aware ArcGIS requests. If browser access fails, the renderer uses only the signed-in portal's configured `helperServices.printTask` Export Web Map task, with a transparent MAP_ONLY PNG overlay. It does not use a generic `/sharing/proxy` route or a hard-coded public printing service. Capabilities failure alone does not block this fallback. Both connection checks and map generation use this same renderer, and checks pass only after a correctly sized, canvas-readable image is returned. A successful fallback is identified in the connection panel.

A successful portal login alone does not prove the backing WMS can be reached. Private metadata and image failures are reported without request URLs or credentials. To investigate a remaining failure, provide the ArcGIS **item details page link** and the connection-panel message; never send tokens, private API keys or passwords. District discovery accepts Feature Service and Map Service items; cameras also support Web Map and Feature Collection items. Recorded camera names are tried in priority order, and aliases to the same service/layer are deduplicated. If distinct sources still match, choose the correct item in its connection card. A missing source can be supplied as an ArcGIS item-page link or ID; it is loaded through the signed-in portal and kept only for that session. Runtime WMS definitions and source choices are discarded on sign-out.

The two flood catchment-name checks use live BoM reference geometry where browser access is available, with verified bundled Queensland boundary data as a fallback. A fallback is explicitly labelled **Bundled BoM catchment reference boundaries**, with its retrieval date. These are static reference shapes for matching catchment names and product IDs; active warnings and watches always come from the authenticated WMS. Refresh the bundled geometry with `python3 scripts/refresh-flood-references.py`, then commit both compressed datasets and their manifest together.

The user's 27 October screenshot confirms successful warning/radar image checks through the organisation print service, connected disaster districts and generated statewide maps. The revised private camera lookups and active-storm output still need a signed-in check. [docs/ACCEPTANCE.md](docs/ACCEPTANCE.md) records completed validation and the remaining live checks; the synthetic demo alone does not verify private services.

## Included behaviour

- Severe Thunderstorm, Severe Weather and Flooding tabs, with warning detection and regional context. Flood products can be selected separately; unidentified raster components are labelled as detected areas.
- Warning + Radar and Warning + Infrastructure Impacts JPEGs composed from the same warning raster and outline. Map layers are clipped to the map frame. The small Queensland locator uses the mainland coast/state shape, independently of LGAs.
- Native-resolution local warning detection, a scale bar, contextual framing, optional storm tracking, and source credits without filler such as “not supplied by source”. Radar retains its source resolution.
- Copyable report text grouped under Energex, Ergon and roads. Only unplanned outages affecting warning-intersected LGAs enter the warning report. Shared outage counts are identified and excluded from per-LGA totals. Failed or stale sources do not become zero-impact claims.
- Roads in the text are major-road full closures with short locations. Restrictions can remain on the infrastructure map. Friendly source names are clickable in the preview and rich clipboard; plain-text clipboard fallback retains URLs.
- Cameras inside the actual warning footprint, loaded photos only on request, and a landscape PDF with overview, camera index, numbered photo links and back-links. Verified photos older than one hour are excluded; unknown capture times remain explicitly unverified. Upstream unavailable-camera images are not rejected just because of their appearance.
- Cancellable generation, independent report preparation, theme control and responsive layout. No camera/PDF diagnostic section in the main app.

## Restore and maintain

See [docs/RESTORE.md](docs/RESTORE.md) for publishing to a new GitHub repository and registering OAuth. See [docs/DATA-SOURCES.md](docs/DATA-SOURCES.md) for adapter assumptions and [docs/RECOVERY-STATUS.md](docs/RECOVERY-STATUS.md) for reconstruction limits.

Node.js 20 or newer is needed only for development checks:

```sh
npm run check
npm test
```

The GitHub Actions workflow runs those checks on pushes and pull requests. The bundled jsPDF distribution is MIT licensed; see `vendor/jspdf.LICENSE`. This reconstruction does not assert a licence for the unavailable original source or for third-party map and camera data. Retain provider credits and comply with each provider's terms.
