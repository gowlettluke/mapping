# Validation and live acceptance

Automated checks run without external services:

```sh
npm run check
npm test
```

The unit suite covers geometry projection and holes, true intersection, context framing, raster masks and flood component separation, provider health and freshness, unplanned warning-LGA outage scope, shared and unknown counts, major full-closure filtering, concise locations, HTML escaping/hyperlinks, camera capture-time rules, collocated markers, photo deduplication, PDF layout and authentication-host validation.

## Checks completed for this archive — 25 October 2026

- JavaScript syntax and HTML asset references passed for all 15 authored JavaScript files.
- All 21 automated unit checks passed.
- Chromium exercised the offline demo: two JPEGs, warning-LGA report counts (120 Energex / 75 Ergon; the outside LGA's 900 excluded), three source hyperlinks, six-camera PDF download, tab invalidation, Flooding demo, no-warning state, and the main app's sign-in gate. No browser JavaScript errors were observed.
- Desktop (1440 px) and mobile (390 px) page screenshots were inspected. Mobile had no horizontal overflow.
- Both synthetic map products and the three-page camera PDF were rendered and visually inspected. The PDF had 30 navigation/source link annotations. This exercised composition and navigation with synthetic data, not live operational inputs.
- Live authenticated ArcGIS connections were not tested. The acceptance checks below remain necessary.

Before using a new deployment with live data, verify:

1. OAuth redirects back to the correct HTTPS page and sign out clears the app's connected state. Both selected registered WMS items render through the signed-in session.
2. Compare current BoM warning extents with the map, including warnings near the coast and Queensland border. Both exports must show the same warning outline and surrounding regional context; LGA lines must stay inside the frame. The locator silhouette must follow the state coast/border.
3. Cross-check outage totals against the same feed snapshot. Include only unplanned outages affecting warning-intersected LGAs. Check shared and unknown totals; missing/stale provider data must produce a status note rather than a no-outage claim.
4. Compare the road text against QLDTraffic: major full closures, the LGA, road name and concise closure location. Lane reductions and 4WD-only access must not enter copied road text. Paste into the intended report editor and verify the three source links remain clickable.
5. Check separate flood warning/watch selections, especially adjacent or disconnected areas. Treat “detected area” labels as raster matches, not verified official product identities. Confirm a changing warning requires regeneration rather than reusing stale selection scope.
6. Check TMR and BCC cameras against the actual footprint. Ensure separate views at one location survive deduplication. Generate a PDF with a missing image, a known stale photo and an unverified capture time. Verify numbering, photo links and back-links after exclusions.
7. Cancel generation and change tabs while work is running. Old report/camera results must not replace the newly selected scope. Test a no-warning state and an unavailable optional feed.

The offline demo validates application composition with synthetic inputs. It cannot validate credentials, registered WMS proxy handling, private item permissions, live layer names, current provider schema, browser cross-origin access, or the meteorological accuracy of a warning.
