# Recovery status

The original source could not be retrieved from the old GitHub account, its Pages deployment, accessible caches, or available file backups. The retained demo archive contained images and manifests, not a source checkout. This ZIP therefore contains freshly authored replacement source, not recovered Git history or proof of byte-for-byte equivalence.

The implementation follows the visible requests and recorded public endpoints, item titles, layer names and public OAuth identifier. Original private organisation URLs, authentication sessions, configuration secrets, build history, original utilities, historical tests and unrecorded features are not present. No credentials have been invented or embedded.

The authenticated adapter uses ArcGIS's JavaScript SDK and organisation portal items, so registered stored-credential WMS services can use the SDK's authentication and proxy handling. It has not been exercised against the user's organisation. In particular, the original organisation-specific warning-information lookup adapter was not recovered. Flood identity falls back to matching public catchment product IDs where possible and otherwise keeps detected raster areas separate. Raster-connected flood components are not guaranteed to correspond one-to-one to an official warning product.

Warning detection is based on coloured WMS pixels. It is an approximation of the rendered warning footprint, not an authoritative warning polygon. Statewide coarse detection can miss extremely small or unusually styled features; final regional detection uses the full output resolution. Reducing detection pixel size does not create finer meteorological observations. The SDK and external data schemas may require adjustment after live account verification.

The public outage pipeline is a separate project. Its source is not included. This app requires the recorded current-outage GeoJSON and a fresh matching run manifest; if those are absent or incompatible, the power report is withheld with a separate status note. Live datasets can be unavailable independently of this app.

Validation available for this replacement is documented in `ACCEPTANCE.md`. There is no claim that the original operational application has been restored exactly or that authenticated data has been validated.
