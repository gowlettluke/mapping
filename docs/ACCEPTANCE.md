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
3. Cross-check report figures against each provider's council text view/API at its recorded update time. Include only unplanned council counts for warning-intersected LGAs, once per council; no combined rows. Missing, stale, incomplete or unmatched council data must produce a status note rather than a no-outage claim. Outage map polygons/labels still show whole-outage source geometry and counts.
4. Compare the road text against QLDTraffic: major full closures, the LGA, road name and concise closure location. Lane reductions and 4WD-only access must not enter copied road text. Paste into the intended report editor and verify the three source links remain clickable.
5. Compare the flood selector against current BoM warning products, including combined notices, final warnings and watches. Confirm one selection includes all its current catchments, with gauges/cameras from each and none from neighbouring warnings. Confirm a changed notice or partially rendered map requires a refresh, and that the full BoM notice link works.
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

## Flood native-layer selection — 2 November 2026

Source checks and all 78 tests pass. Regression coverage verifies configured flood IDs absent from saved item layers, preservation of loaded sublayer hints, default flood styles, rejection of label-only substitutes, authenticated organisation print fallback, and rejection of service-reported missing layers. Saved/SDK display sublayers are not a complete service catalogue; see [Esri's WMSLayer sublayers documentation](https://developers.arcgis.com/javascript/latest/references/core/layers/WMSLayer/#sublayers).

A separate synthetic service run using native canvas exercised both warning/watch area scans and both JPEG exports for each selection. Each selected product generated successfully while the other flood layer was deliberately unavailable. Switching back to thunderstorm generation ignored an old flood selection and retained the thunderstorm layer/style. Service failures and cancellation remained errors; only successful empty scans yielded no active flood areas. This run did not use a browser or access the live private WMS. A signed-in Flooding scan and comparison with the official product remain required after deployment.

## Outage intensity and selective labels — 3 November 2026

Source checks and all 80 tests pass. Coverage includes the inclusive 100-customer default, all five label settings, safe handling of invalid saved settings, visibility of unlabelled small outages, distinct unknown-count styling, and complete report totals. The label threshold is passed through both live and demo snapshot generation, saved as a local display preference, and recorded in the infrastructure legend.

A native-canvas crowded fixture showed 57 number labels before this change, 13 at 100+ customers and 9 at 250+. Both map products were rendered and inspected. Pixel comparisons confirm the radar export is unchanged, and report text is identical across label thresholds. The synthetic flood scan/export/tab-switch integration check also passes. These are synthetic/export checks; the browser controls have not been exercised in this workspace because Chromium is unavailable.

## Provider council report revision

All 85 application checks and nine upstream collector tests pass. Reports use
provider-published council counts, with one row per selected LGA and no combined
rows or shared-count footnote. Coverage includes the 1 / 1,007 / 1 Ergon council
allocation, selected-versus-statewide sums, council aliases, verified zero
outages, independent provider failures, stale/future timestamps, mismatched
snapshots, malformed counts, duplicate councils and totals that do not reconcile.

Live retrieval from both official providers succeeded on 3 November 2026. All
returned names matched the current government LGA catalogue. The collected state
totals reconciled with the report, and a selected-LGA report retained only the
provider counts for those LGAs. These were dated source observations, not fixed
expected customer totals. Offline demo reports pass for all three profiles with
and without an active warning. Synthetic flood generation/export and crowded
outage rendering also pass; the report is independent of the label threshold.
Chromium is unavailable in this workspace, so the browser UI was not rechecked.

Deployment order: merge the upstream `qldpoweroutages` collector, verify a poll
has published successful `provider_council_counts` entries, then deploy Mapping.
Older or failed upstream entries produce an omitted-section status note.

## Flood display cleanup

All 93 unit checks and source/asset checks pass. Coverage verifies configured
warning/watch label IDs, native style selection, preservation of loaded legend
metadata, registered/advertised legend requests, cancellation and safe failure,
transparent label footprints, outage-number avoidance, foreground name order,
and the absence of the added brown tracing on both flood JPEGs.

Native-canvas synthetic scan/export checks pass for Flood Warning and Flood
Watch. Each selected type requests only its own polygon, label layer and legend.
Unavailable native names fall back to matching catchment references; unavailable
legends remain explicit while both JPEGs still export. Warning failures still
fail the scan, and an old flood selection is ignored on the storm tab.

A synthetic pale cyan chevron fixture reduced pixels matching the added brown
trace from 132,484 to zero. Its native pattern, colours and label remained clear;
native names and a sparse-hatch catchment fallback left the original detection
mask unchanged. All eight thunderstorm/severe-weather outputs (both products,
active and no-warning cases) are pixel-identical to the deployed renderer. The
synthetic flood export was visually inspected.

These checks do not access the private live WMS; Chromium is unavailable in this
workspace. In a signed-in deployment, verify the exact river/reach titles from
the native label layer, the source legend and original symbology for each flood
type. Missing legends must be labelled unavailable rather than replaced by a
guessed key. No background or infrastructure-style redesign is part of this
revision.

## Unmatched provider council rows

All 96 tests and source/asset checks pass. A provider row with an unmatched
council no longer suppresses the entire power section. Recognised warning-LGA
totals remain visible; unassigned customers are excluded from those totals and
explained in copied report text. A selection without matched impacts stays
explicitly incomplete when positive unassigned counts exist. Statewide reports
include those customers in separate rows, preserving the provider total.

The captured 3 November 2026 production snapshot contained 4,486 Ergon customers
in matched LGAs plus two under `Unknown`. The source text view independently
confirmed that unknown allocation. Integration with the captured manifest now
produces a 4,488-customer statewide total with a separate two-customer row, and
a Central Highlands warning-LGA total of 2,267 with the unassigned count clearly
excluded. These are dated regression observations, not permanent expected
outage counts. Freshness, reconciliation, duplicate detection and source
failure checks retain their existing behaviour.

## Flood camera reports

All 96 tests and source/asset checks pass. Camera discovery and PDF generation
now run for active flood warnings and watches using the selected snapshot's
scope masks. Flood products retain their existing district-analysis behaviour.
Changing the flood area or warning tab clears camera results and cancels pending
lookup/photo work. A no-active-warning statewide snapshot keeps PDFs disabled.

The actual application event handlers were exercised with a minimal DOM and
synthetic signed-in services. Separate warning/watch selections each included
only their own camera, excluded neighbouring and outside cameras, enabled the
PDF button and produced a three-page PDF through the bundled library. Camera
lookup fetched metadata only; photographs were requested on PDF generation.
Both PDFs were rendered and visually inspected. A pending lookup discarded its
results after a selection change, and thunderstorm/severe-weather camera paths
continued to work. The same flood-camera check fails against the previous app
at its explicit Flooding-tab exclusion.

The synthetic flood scan/export integration also passes. These checks do not
establish live private camera permissions or photograph availability; recheck a
selected flood area while signed in after deployment.

## River gauge maps and combined flood PDFs — 4 November 2026

All 106 unit tests and source/asset checks pass. Added coverage includes gauge
field aliases and source domains, leading-zero station IDs, zero/missing heights,
classification without height-based inference, separate/old/future timestamps,
direct/media/HTML graph URLs, safe template substitution, authenticated metadata
and feature requests, graph retrieval failures/cancellation, selected flood-mask
scope, collocated stations and duplicate observations. PDF page planning and
gauge-only missing-graph output are verified, including credential-free links.

The actual application event handlers were exercised with a minimal DOM,
native canvas, the bundled PDF library and synthetic signed-in services. Both
warning/watch selections produced a third map and included only their own gauge
and camera. Ten PDF exports covered combined, gauges-only and cameras-only
options, missing graphs, no cameras, inaccessible photographs, unavailable gauge
sources, and both existing storm/weather paths. Metadata/map generation fetched
no graph images. Pending gauge lookup and graph export were cancelled by a scope
change; old results/downloads could not replace the new selection. No-warning
statewide products kept gauge/PDF lookup disabled. The earlier synthetic flood
scan/export integration still passes.

A separate full-size synthetic run produced four gauge markers, a seven-page
combined report with six photos, and a four-page gauges-only report. Map, index
and two-graph pages were rendered and visually inspected. The missing graph
kept its reading and placeholder; the old observation retained its timestamp and
age notice. All 12 validation PDFs were checked for valid internal destinations,
credential-free external links and text inside page bounds. The seven-page
combined fixture contained 54 navigation links.

These checks do not access the user's private gauge layer or prove its live
field/popup schema, permissions or graph-image CORS access. In the signed-in
deployment, verify the discovered item (or choose its item-page link), compare
station IDs/readings/timestamps to the source popup, and export a graph for each
flood type. Image fields and popup image templates are supported; Arcade-built
or native interactive charts require an exposed image source. Unavailable graph
images must retain their station metadata instead of pretending a graph loaded.

## Confirmed gauge item default — 4 November 2026

The user confirmed the layer connected after entering the item ID visible in
their registered-service URL. That ID is now the default for authenticated gauge
loading; name-based discovery is no longer required. All 109 tests and source
checks pass, including direct ID selection on the current portal, manual source
override, cache reuse, a failed default retaining the source control, and
sign-out restoring the configured default.

The subsequent QFD attribute-table screenshots supplied the exact source fields:
`StationNum`, `Class`, `FMETimestamp`, `URLChart` and `URLPage`. Those fields now
populate station IDs, source classifications, processing times, graph images
and source-page links directly. All 111 tests pass. Added source-shape coverage
retains negative readings and leading-zero station IDs, separates observation
and processing timestamps, keeps `No Classification` unknown, ignores
`ClassRank`, and prefers `URLChart` when popup media points at `URLPage`.
The actual-app synthetic export checks also use this QFD field layout.

## Supplied BoM graph export — 4 November 2026

The user supplied `https://www.bom.gov.au/fwo/IDQ65398/IDQ65398.036169.png`.
Normal browser navigation loaded the actual 800 by 400 PNG. A direct request
from the validation environment returned HTTP 403. The standard ArcGIS Export
Web Map service successfully rendered the public PNG at its native dimensions;
the downloaded output was pixel-identical to the source (zero differing
channels). Its image response allowed the mapping site's origin.

Production now uses the signed-in portal's configured print task only after a
browser network/cross-origin error for a narrowly validated public BoM PNG URL.
Explicit readable HTTP refusals and private or unrelated image URLs do not use
this fallback. The production Web Map payload matched the successful live print
payload. A replay through the production retrieval helper embedded that actual
chart in a three-page PDF, with no invented readings or classification. The
full-page graph was rendered and inspected, including its axes, thresholds,
source copyright, timestamps and source hyperlink. Internal PDF destinations
and image bounds were valid.

All 120 tests and source/asset checks pass. Added coverage includes URL
validation, native chart dimensions, print payload and response handling,
browser-error fallback, unavailable/blank output, cancellation and adaptive
one- or two-graph pages with correct navigation. The existing registered-WMS
flood integration and QFD-shaped actual-app export checks also pass. The
organisation's private print helper and gauge feed still require a signed-in
deployment check; the public service test verifies the standard export route,
not the user's private permissions.

## Compact gauge report and automatic startup — 4 November 2026

The user confirmed that most graphs export, but one graph per page and the
multi-line station index made reports too long. The supplied BoM PNG was compared
at four and six graphs per landscape page. Four retains a larger, more readable
axis/legend and is now the default in a two-by-two grid. A 25-gauge fixture uses
two table pages and seven graph pages (ten pages including its map); its six-up
comparison uses smaller charts. Both include a missing chart, unknown data, a
long station name and an old observation. Rendered pages were visually inspected,
with all image/text bounds and internal destinations valid and no image overlap.

The index now has 20 table rows per page, retaining station name/ID, level,
classification, trend and observation time. Reported major, moderate and minor
rows are red, yellow and green respectively. Unknown/below-minor rows remain
neutral. Classification labels remain visible; colours do not infer severity
from height. A single compact footnote explains older/unverified time flags.

The latest screenshot's ID matches the configured ID. That rules out another
ID transcription change; the private-session startup failure could not be
reproduced here. Gauge loading now retries once automatically, remembered manual
gauge choices are scoped to their organisation, and the default is preselected
before loading. Invalid saved choices are ignored. Versioned entry/configuration,
connection and PDF module URLs refresh together through the HTML import map,
preventing an older cached configuration being reused with this release.

All 124 tests and syntax/asset checks pass, including automatic first-failure
recovery without ID entry, cancellation, saved-choice isolation, four-up graph
pagination/navigation, table overflow and source classification colours. Ten
QFD-shaped actual-app PDF exports pass for both flood types, gauge/camera-only
reports, source/image failures, cancellation and storm/weather regressions.
The signed-in source still needs the user's deployment check; these tests do
not establish their private service permissions.

## River/tributary gauge ordering — 4 November 2026

Gauge selection still uses the chosen flood mask, but numbering now follows
river/basin groups and directed upstream-to-downstream chains. Tributaries and
incomparable reaches stay separate. Unmatched IDs, moved locations, ambiguous
branches and unavailable references remain visible as **Order unconfirmed**.
The same ordered objects feed the gauge map, cards, 20-row table and four-panel
graph pages; the table and graph headers identify each river/tributary.

The bundled public reference contains 1,172 matched stations from 1,945 catalogue
locations in Queensland and the configured border extent. It combines BoM
station/AWRC identifiers with Geofabric V3.3, openly published by Digital Atlas
of Australia (Geoscience Australia). Cached BoM stream topology was compared with
the Digital Atlas copy before combining sources. Conflicting AWRC suffixes,
flagged source matches, ambiguous nearby channels and one cyclic match were
excluded. Further connector downloads were blocked by the execution environment;
the offline build publishes only explicit known directed station paths, records
one unresolved continuation and never invents a connection across that gap.
These are public-reference counts, not a measured match rate for the private
QFD observation feed. No private station data or live readings enter the bundle.

All 137 tests and syntax/asset checks pass. New checks cover river/tributary and
basin grouping, reverse alphabetical/numeric station order, forked reaches,
leading-zero IDs, moved/unknown locations, invalid/cyclic reference data,
source Stream/Basin retention, failure recovery, caching and cancellation.
The actual bundled reference confirms Coolagh (036169) upstream of Retreat
(538001) on the Barcoo River. Builder checks also distinguish conflicting station
suffixes, reversed segment geometry and confluences from one continuous channel.

The existing ten QFD-shaped application export scenarios still pass. Three new
actual-app exports verify identical map/card/PDF ordering for both flood warning
and flood watch selections, retained gauges when the reference fails, and
cancellation of a pending reference lookup. A separate seven-page PDF used
20 public-reference/synthetic validation gauges, one compact index page and five
four-panel graph pages. Index and graph pages were rendered and inspected;
image/text bounds, non-overlap and internal destinations were valid. Graphs and
readings in that layout fixture are explicitly synthetic/unavailable.


## BoM warning groups — 4 November 2026

The selector now uses current BoM catchment records grouped by the published warning product ID. Compact titles link to the full original notice. Final records remain until their AEST expiry; expired/cancelled/test records and areas from superseded issues are excluded. Watches group by issuing office and UTC issue time. River diagram layout is unchanged.

All 166 tests and 45 JavaScript syntax/asset checks pass. New unit checks cover combined disconnected catchments, similarly named rivers belonging to different warnings, latest-issue replacement, local expiry, cancellations, complete membership, source freshness/failure, watch grouping and abort handling. A fresh public-service query returned 21 Queensland catchment records and 14 warning groups, corresponding to the current BoM warning products. No live records are committed.

Native-canvas integration verifies both JPEGs for combined selections, gauges in both catchments, adjacent-warning exclusion, independent warning/watch rendering, rejection of partial maps and changed notices, confirmed empty statewide output, disagreement between an empty list and an active WMS, and cancellation. Actual app event handlers were exercised with a synthetic DOM/services for the selector, catchment summary, source link, deselection guard and map/report generation. These checks do not access the private WMS; after deployment compare a combined warning and its gauges/cameras with the signed-in production services.


## Separate PDF exports and neighbouring warning context — 4 November 2026

All 178 tests and JavaScript/asset checks pass. The actual application handlers
verify separate camera/gauge filenames and document contents, image-request
isolation, independent availability when the other source fails or is pending,
missing gauge graphs, stale camera photos, cancellation on a changed selection,
and the existing thunderstorm/severe-weather camera paths. Both entry pages
replace the combined-report checkboxes with a button in each source panel.

Flood analysis still intersects the selected notice's complete catchment set.
The display keeps the full source warning raster and its native names within
the same regional extent. Neighbouring notices remain visible and labelled, but
cannot satisfy missing selected catchments or add cameras/gauges to the report.
A white-backed navy dashed geometry outline marks only the selected notice on
both JPEGs and the camera/gauge overview maps; its key distinguishes selection
from the source's unchanged warning colours.

The browser's synthetic demo generated each report independently. A native-
canvas render through the production PDF modules produced a three-page camera
document and a four-page gauge document including its flow diagram, index and
four-graph page. Rendered pages and the neighbouring-warning map were inspected.
All 54 internal/external links have valid destinations and omit credentials;
text stays inside page bounds and camera/gauge sections remain in separate
documents. These fixtures use synthetic observations. The private live WMS,
camera permissions and gauge feed still require a signed-in deployment check.

## Flood map clarity — 5 November 2026

All 186 tests and 48 JavaScript/asset checks pass. Presentation changes keep
the selected notice's existing extent, warning image and analysis mask. The
single navy focus outline follows the rasterised union of the notice's
geometries, removing shared internal edges while preserving holes and separate
parts. Nearby warning imagery and names remain visible at lower opacity;
selected imagery retains its original opacity. Neither fading nor land-clipping
changes report, camera or gauge selection.

The native flood legend remains preferred. Flood-warning maps have a compact
standard BoM key verified from the published legend in FOI30-167 released
documents set 3, PDF page 169. Watch maps do not borrow warning categories when
their own key is unavailable. Gauge status and counts are independently derived
from the reported station classification, never the warning-area colour or
numeric water height. Flow-order caveats remain in the index/diagram output.

Optional public context queries add current populated-place labels and named
major channels in the selected warning. Source queries were checked for
browser CORS and pagination; broad hydrography is deliberately avoided. LGA
strokes are clipped to verified mainland/island land polygons. Closed roads
use white-cased dark red; restrictions use thinner neutral dashes. Titles lead
with the geographic area and purpose, with an explicit map-generation time.

Native-canvas checks used public Barcoo/Thomson catchment and station geography
with synthetic readings, roads and outages. Full-size gauge, infrastructure,
radar and camera maps were inspected. Pixel checks confirm no internal focus
seam, retained neighbouring warnings, original selected-source opacity,
landward-only LGA strokes, unchanged source imagery and correct header-adjusted
PDF marker positions. Separate camera and gauge PDFs were generated through
the production exporters; their links and page bounds were checked. No private
observations or signed-in WMS requests are committed; that live-source check
remains dependent on the organisation's ArcGIS session.
