"""Refresh public BoM catchment-name geometry; never download active warnings."""
from datetime import datetime, timezone
from pathlib import Path
import gzip
import hashlib
import json
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
BASE = 'https://hosting.wsapi.cloud.bom.gov.au/arcgis/rest/services/flood/National_Flood_Gauge_Network/FeatureServer/'


def read_json(url, query):
    with urllib.request.urlopen(url + '?' + urllib.parse.urlencode(query), timeout=40) as response:
        data = json.load(response)
    if data.get('error'):
        raise RuntimeError('BoM reference query failed')
    return data


def main():
    output = ROOT / 'data'
    output.mkdir(exist_ok=True)
    manifest = {
        'retrievedUtc': datetime.now(timezone.utc).isoformat(),
        'description': 'Static Queensland catchment-name boundaries, not active warnings or watches. Source polygon geometry requested at five decimal places; no polygon simplification.',
        'attribution': '© Commonwealth of Australia (Bureau of Meteorology) 2025',
        'files': {},
    }
    pending = {}
    for key, layer, filename in [('floodWarnings', 1, 'flood-warning-catchments.geojson.gz'), ('floodWatches', 0, 'flood-watch-catchments.geojson.gz')]:
        source = BASE + str(layer) + '/query'
        where = "aac LIKE 'QLD_%'"
        count = read_json(source, {'where': where, 'returnCountOnly': 'true', 'f': 'json'})['count']
        data = read_json(source, {'where': where, 'outFields': '*', 'outSR': '4326', 'returnGeometry': 'true', 'f': 'geojson', 'resultRecordCount': '2000', 'geometryPrecision': '5'})
        features = data.get('features', [])
        assert data.get('type') == 'FeatureCollection' and len(features) == count and count > 0 and not data.get('exceededTransferLimit')
        assert all(f['properties']['aac'].startswith('QLD_') and f['properties']['dist_name'] and f['geometry']['type'] in ['Polygon', 'MultiPolygon'] for f in features)
        raw = json.dumps(data, separators=(',', ':')).encode()
        packed = gzip.compress(raw, compresslevel=9, mtime=0)
        pending[filename] = packed
        manifest['files'][key] = {'path': filename, 'source': source, 'where': where, 'featureCount': count, 'sha256': hashlib.sha256(raw).hexdigest(), 'gzipSha256': hashlib.sha256(packed).hexdigest()}
        print(f'{key}: {count} reference boundaries, {len(packed)} compressed bytes')
    # Download and validate both datasets before changing tracked files.
    for filename, packed in pending.items():
        (output / filename).write_bytes(packed)
    (output / 'flood-references.json').write_text(json.dumps(manifest, indent=2) + '\n')


if __name__ == '__main__':
    main()
