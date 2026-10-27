# Queensland Warning Mapping — reconstructed replacement

This is a new reconstruction dated **25 October 2026**, based on the requirements and implementation details retained in the project conversation. It is **not an exact recovery** of the lost `giswatidid/Mapping` repository. The last recorded original commit was `3e1e35a132f7ebd0e14db338f56d0fa1900e8e3d`; its source was not available for comparison.

The complete app is static HTML, CSS and JavaScript. No build step, application server, npm dependencies or private credentials are included. Keep all files together.

## Try it locally

Extract the ZIP, open a terminal in this folder and run:

```sh
python3 -m http.server 8000
```

Open <http://localhost:8000/demo.html> to exercise the two JPEG exports, report text and camera PDF with clearly marked **synthetic** fixtures. This separate demonstration works without ArcGIS or live data. Open <http://localhost:8000/> for the actual app. Opening the HTML directly as a `file:` URL does not support its JavaScript modules.

For live operation, enter your ArcGIS organisation prefix and sign in. Select the organisation's registered BoM warning and radar WMS items, and verify the feeds. The app uses the recorded public OAuth client ID from `CONFIG.arcgis.clientId` in `config.js` automatically; users do not enter or edit it in the connection form. Its availability and registered redirect URL still need checking by the app administrator. Do not enter tokens, passwords or private API keys in `config.js`.

**Live authenticated warning/radar rendering and organisational camera/district layers have not been verified with your account.** Do the checks in [docs/ACCEPTANCE.md](docs/ACCEPTANCE.md) before operational use. A successful offline demo does not establish that the private connections work.

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
