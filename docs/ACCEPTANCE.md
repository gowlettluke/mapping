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

1. The initial page shows only the organisation-prefix sign-in form, with no app controls or OAuth client-ID field. OAuth redirects to ArcGIS and back to the correct HTTPS page. The app then opens and automatically checks connections. Both registered WMS items render through the signed-in session; unique items require no manual selection. Sign out during checks and confirm the prefix page returns without late results reopening the app. An expired session must also return to the prefix form. Missing optional layers must remain visible in the app without disabling successfully verified core map layers.
2. Compare current BoM warning extents with the map, including warnings near the coast and Queensland border. Both exports must show the same warning outline and surrounding regional context; LGA lines must stay inside the frame. The locator silhouette must follow the state coast/border.
3. Cross-check outage totals against the same feed snapshot. Include only unplanned outages affecting warning-intersected LGAs. Check shared and unknown totals; missing/stale provider data must produce a status note rather than a no-outage claim.
4. Compare the road text against QLDTraffic: major full closures, the LGA, road name and concise closure location. Lane reductions and 4WD-only access must not enter copied road text. Paste into the intended report editor and verify the three source links remain clickable.
5. Check separate flood warning/watch selections, especially adjacent or disconnected areas. Treat “detected area” labels as raster matches, not verified official product identities. Confirm a changing warning requires regeneration rather than reusing stale selection scope.
6. Check TMR and BCC cameras against the actual footprint. Ensure separate views at one location survive deduplication. Generate a PDF with a missing image, a known stale photo and an unverified capture time. Verify numbering, photo links and back-links after exclusions.
7. Cancel generation and change tabs while work is running. Old report/camera results must not replace the newly selected scope. Test a no-warning state and an unavailable optional feed.

The offline demo validates application composition with synthetic inputs. It cannot validate credentials, registered WMS proxy handling, private item permissions, live layer names, current provider schema, browser cross-origin access, or the meteorological accuracy of a warning.

## Login-flow revision — 27 October 2026

All 27 unit checks and syntax/asset checks passed. Additional Chromium checks, using an explicitly mocked ArcGIS SDK and public feeds, verified the prefix-only entry page, no pre-authentication layer requests, the configured public OAuth ID, automatic connection checks after authentication, required and optional connection failures, ambiguous weather selection, sign-out cancellation, cancelled sign-in, expired-session recovery, mobile layout and continued offline demo generation. Desktop and mobile screenshots were inspected. These mocks validate application sequencing and failure handling; live ArcGIS authorisation and private services remain unverified.

The interface styling was subsequently aligned with the current `qldpoweroutages` and `qld_only_isolation` dashboards. Chromium checks verified the shared red/grey palette, square panels, dark-mode persistence and theme button state, and continued sign-in/demo operation. Light/dark desktop and mobile screenshots were inspected. Existing map-export rendering and data processing were not changed by this styling revision.

## Registered WMS and print-fallback revision — 27 October 2026

The replacement now retains each private registered item's exact map URL, URL/custom parameters, WMS version, identity and native names/styles. The renderer uses authenticated SDK requests directly, with an organisation-configured Export Web Map fallback after browser failure. Capabilities failure does not by itself prevent image verification through that fallback. No generic sharing proxy or guessed upstream authentication is used.

The automated WMS checks cover registered-versus-advertised URLs, parameter precedence, separate item definitions, native style ordering, coordinate-system/version handling, transparent print definitions, extent cropping, direct and fallback request routes, failed-layer messages, synchronous and asynchronous print tasks, cancellation and independent concurrent selections. The full suite contains 47 checks. Chromium with mocked ArcGIS/private definitions verified capabilities and direct-image failure followed by successful print fallback, print failure keeping map generation disabled, parameter/style retention, cancellation on sign-out and continued login/mobile/demo behaviour. The browser reported no JavaScript errors.

These tests do not establish access to the actual private items or the organisation's print server. In the signed-in deployment, use **Recheck layers** and verify both WMS checks return an image. If fallback is used, the connection panel should say **through organisation print service**. Compare a real warning/radar output against the provider, including correct registration, styles and transparency over the basemap. An absent or inaccessible print service must leave the relevant check unavailable. Configuration must be rediscovered after sign-out and no private runtime parameters should appear in exported maps, copied reports or on-screen errors.

## Optional-source revision — 27 October 2026

The supplied live screenshot confirmed warning/radar rendering through the organisation print service and successful disaster-district queries. Remaining failures were a missing TMR camera item, multiple BCC matches and CORS-blocked BoM catchment reference queries. Camera discovery now tries preferred names first, supports feature collections/web maps, deduplicates aliases to the same service/layer, and permits an explicit source choice or private item-page link in the existing connection card. No camera/PDF diagnostic section was added. The catchment-name loader now falls back to the bundled, hash-verified public BoM reference geometry and identifies that route in connection status.

All 60 unit checks and syntax/asset checks passed. Added tests cover source priority and ambiguity, item-link parsing, embedded/Web Map camera data, Web Mercator conversion, native URL-query preservation, actual-record pagination and complete bundled Queensland datasets. Chromium with mocked private services verified a genuinely ambiguous camera picker, manual item-link lookup through the signed-in portal, sign-out clearing source choices, inline camera collections, CORS failure loading both actual bundled datasets, continued WMS print fallback, mobile layout and the synthetic demo, with no JavaScript errors. The real private camera items still require a signed-in recheck. If a camera item remains undiscoverable, supply its item-page link in that connection card; this does not require sharing it publicly.

## Live camera schemas and automatic flood selection — 27 October 2026

All 66 unit checks and syntax/asset checks passed. New coverage includes numbered camera image fields with an empty primary URL, multiple views, attachment metadata pagination and filtering, registered URL parameters, cancellation and rejection of incomplete attachment responses. The adapter was also exercised against complete current public source responses: 13 BCC locations resolved to 13 attachment image links; 501 Queensland flood-camera locations resolved to 595 views. This verified actual source metadata, not photograph retrieval through the user's authenticated session.

Chromium checks with mocked ArcGIS services verified the `QLD Flood Cameras` title alias, BCC attachment metadata, separate image views, automatic flood loading on tab entry and after authentication, single/multiple area selection, confirmed no-warning statewide generation, cancellation, scan failure and retry. Existing bundled-reference, registered-WMS/print fallback, sign-in, sign-out, mobile and demo checks continued to pass without browser JavaScript errors. Failed scans kept generation disabled. No new diagnostic section was added.

In the signed-in deployment, recheck both camera feeds and request photographs/PDF output for a current warning. Select Flooding and confirm areas load automatically; compare any selected warning/watch with the official product. Tests of mocked browser responses do not establish live private permissions or weather accuracy.
