#!/usr/bin/env python3
"""Build a public, static gauge-order reference; never store live readings.

Uses BoM flood-station IDs/AWRC aliases, Geofabric gauging stations, named
stream geometry and explicit downstream links (including flow splits).
Ambiguous matches and cyclic/indeterminate flow paths remain unconfirmed.
"""
import argparse
import collections
import concurrent.futures
import datetime
import gzip
import gc
import hashlib
import json
import math
import pathlib
import re
import sys
import time
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
SERVICE = "https://hosting.wsapi.cloud.bom.gov.au/arcgis/rest/services/"
ORIGINAL_NETWORK = SERVICE + "ahgf/Geofabric_V3x_All_Products/MapServer/"
NETWORK = "https://services-ap1.arcgis.com/ypkPEy1AmwPKGNNv/arcgis/rest/services/Geofabric_Surface_Hydrology_Network/FeatureServer/"
CATALOGUE = SERVICE + "flood/National_Flood_Gauge_Network/FeatureServer/5/"
EXTENT = [137.7, -29.3, 154.2, -9]
STREAM_FIELDS = "hydroid,name,nextdownid,flowdir,from_node,to_node"


def features(data):
    rows = data if isinstance(data, list) else data["features"]
    return [{**row, "attributes": {sys.intern(name.lower()): value for name, value in row["attributes"].items()}} for row in rows]


def key(value):
    return re.sub("[^A-Z0-9]", "", str(value or "").upper())


def awrc_base(value):
    match = re.fullmatch(r"0*(\d+)[A-Z]?", key(value))
    return str(int(match[1])) if match else key(value)


def compatible_awrc_suffix(a, b):
    first = re.fullmatch(r"\d+([A-Z])?", key(a))
    second = re.fullmatch(r"\d+([A-Z])?", key(b))
    return not (first and second and first[1] and second[1] and first[1] != second[1])


def metres(a, b):
    x = (a[0] - b[0]) * 111195 * math.cos(math.radians((a[1] + b[1]) / 2))
    return math.hypot(x, (a[1] - b[1]) * 111195)


def point(feature):
    geometry = feature.get("geometry") or {}
    return [geometry["x"], geometry["y"]]


def watercourse(name):
    parts = re.findall(r"\(([^()]*)\)", name)
    return parts[-1].strip() if parts and re.search(r"\b(RIVER|CREEK|BROOK|CHANNEL|WATER)\b", parts[-1], re.I) else ""


def projection(position, stream):
    """Distance and downstream distance along one explicitly directed stream."""
    paths = (stream.get("geometry") or {}).get("paths", [])
    if len(paths) != 1 or stream["attributes"].get("flowdir") not in (1, 2):
        return None
    path = paths[0]
    scale = math.cos(math.radians(position[1]))
    best = (math.inf, 0)
    length = 0
    for a, b in zip(path, path[1:]):
        ax, ay = (a[0] - position[0]) * 111195 * scale, (a[1] - position[1]) * 111195
        bx, by = (b[0] - position[0]) * 111195 * scale, (b[1] - position[1]) * 111195
        dx, dy = bx - ax, by - ay
        segment = math.hypot(dx, dy)
        t = max(0, min(1, -(ax * dx + ay * dy) / (segment * segment))) if segment else 0
        distance = math.hypot(ax + t * dx, ay + t * dy)
        if distance < best[0]:
            best = (distance, length + t * segment)
        length += segment
    return best[0], best[1] if stream["attributes"]["flowdir"] == 1 else length - best[1]


def one_channel(candidates):
    """Close consecutive segments are one channel; a fork/confluence is not."""
    identifiers = {stream["attributes"]["hydroid"] for distance, stream in candidates if distance < candidates[0][0] + 60}
    onward = {stream["attributes"]["hydroid"]: stream["attributes"].get("nextdownid") for distance, stream in candidates if stream["attributes"]["hydroid"] in identifiers}
    incoming = collections.Counter(target for target in onward.values() if target in identifiers)
    if any(count > 1 for count in incoming.values()):
        return False
    heads = identifiers - incoming.keys()
    if len(heads) != 1:
        return False
    visited, current = set(), next(iter(heads))
    while current in identifiers and current not in visited:
        visited.add(current)
        current = onward.get(current)
    return visited == identifiers


class Download:
    def __init__(self, cache, offline=False):
        self.cache = cache
        self.offline = offline
        cache.mkdir(parents=True, exist_ok=True)

    def paged(self, name, endpoint, params):
        file = self.cache / (name + ".json")
        if file.exists():
            data = json.loads(file.read_text())
            if isinstance(data, list):
                return features(data)
            if not data.get("exceededTransferLimit"):
                return features(data)
        if self.offline:
            raise RuntimeError("Offline build is missing a complete cached source: " + name)
        output = []
        while True:
            query = {"f": "json", "resultRecordCount": 5000, "orderByFields": "objectid ASC", **params, "resultOffset": len(output)}
            url = endpoint + "query?" + urllib.parse.urlencode(query)
            checkpoint = self.cache / (name + ".page-" + str(len(output)) + ".json")
            if checkpoint.exists():
                data = json.loads(checkpoint.read_text())
            else:
                for attempt in range(3):
                    try:
                        request = urllib.request.Request(url, headers={"Accept-Encoding": "gzip"})
                        with urllib.request.urlopen(request, timeout=45) as response:
                            body = response.read()
                            if response.headers.get("Content-Encoding") == "gzip":
                                body = gzip.decompress(body)
                            data = json.loads(body)
                        if (data.get("error") or {}).get("code") in (401, 403, 498, 499):
                            raise PermissionError("Reference access is restricted; no credentials are requested or bypassed")
                        if data.get("error") or "features" not in data:
                            raise RuntimeError("Public reference query failed: " + str(data.get("error")))
                        checkpoint.write_text(json.dumps(data, separators=(",", ":")))
                        break
                    except PermissionError:
                        raise
                    except Exception:
                        if attempt == 2:
                            raise
                        time.sleep(.5)
            rows = features(data)
            output.extend(rows)
            if name == "flow-splits":
                print("Flow-split reference: " + str(len(output)) + " rows", flush=True)
            if not data.get("exceededTransferLimit"):
                break
            if not rows:
                raise RuntimeError("Reference pagination did not make progress")
        file.write_text(json.dumps(output, separators=(",", ":")))
        return output

    def streams(self, ids, geometry=False):
        ids = sorted(ids)
        batches = [ids[i:i + 150] for i in range(0, len(ids), 150)]
        def read(batch):
            digest = hashlib.sha256(json.dumps(batch).encode()).hexdigest()[:12]
            return self.paged(("stream-shapes-" if geometry else "stream-links-") + digest, NETWORK + "7/", {
                "where": "hydroid IN (" + ",".join(map(str, batch)) + ")", "outFields": STREAM_FIELDS,
                "returnGeometry": str(geometry).lower(), "outSR": 4326, "maxAllowableOffset": .0001})
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
            return [feature for rows in executor.map(read, batches) for feature in rows]

    def tiles(self, streams):
        # Long unnamed tails otherwise require one remote request per segment.
        # Small geographic tiles return topology only, not national geometry.
        cells = set()
        for stream in streams:
            coordinates = [point for path in (stream.get("geometry") or {}).get("paths", []) for point in path]
            if coordinates:
                centre = coordinates[len(coordinates) // 2]
                cells.add((math.floor(centre[0] * 4), math.floor(centre[1] * 4)))
        def read(cell):
            x, y = cell
            extent = [x / 4, y / 4, (x + 1) / 4, (y + 1) / 4]
            return self.paged("topology-tile-" + str(x) + "-" + str(y), NETWORK + "7/", {
                "where": "1=1", "geometry": ",".join(map(str, extent)), "geometryType": "esriGeometryEnvelope",
                "inSR": 4326, "spatialRel": "esriSpatialRelIntersects", "outFields": STREAM_FIELDS, "returnGeometry": "false"})
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
            return [feature for rows in executor.map(read, sorted(cells)) for feature in rows]


def awrc_matches(catalogue, nodes):
    exact, numeric = collections.defaultdict(list), collections.defaultdict(list)
    for node in nodes:
        if not isinstance(node["attributes"].get("netwstrmid"), int) or node["attributes"]["netwstrmid"] <= 0:
            continue
        identifier = node["attributes"]["stationno"]
        exact[key(identifier)].append(node)
        numeric[awrc_base(identifier)].append(node)
    matches = {}
    for station in catalogue:
        attributes = station["attributes"]
        identifier = attributes["awrc_stateid"]
        if not identifier:
            continue
        for method, candidates in [("awrc", exact[key(identifier)]), ("awrc-numeric", numeric[awrc_base(identifier)])]:
            near = sorted([(metres(point(station), point(node)), node) for node in candidates
                           if compatible_awrc_suffix(identifier, node["attributes"]["stationno"]) and not node["attributes"].get("flagissues") and metres(point(station), point(node)) <= 1500], key=lambda entry: entry[0])
            if not near:
                continue
            if len({node["attributes"]["netwstrmid"] for distance, node in near}) == 1 or len(near) == 1 or near[0][0] < 250 and near[1][0] - near[0][0] > 300:
                distance, node = near[0]
                matches[attributes["bom_stn_num"]] = {"stream": node["attributes"]["netwstrmid"], "point": point(node), "method": method, "matchDistance": round(distance), "networkName": node["attributes"]["stnname"], "networkStationId": node["attributes"]["stationno"]}
            break
    return matches


def graph_for(streams, splits):
    graph = {}
    for identifier, stream in streams.items():
        attributes = stream["attributes"]
        graph[identifier] = set()
        if attributes.get("flowdir") in (1, 2):
            graph[identifier].update(value for value in [attributes.get("nextdownid"), *splits.get(identifier, [])] if isinstance(value, int) and value > 0)
            if attributes.get("nextdownid") == identifier:
                graph[identifier].add(identifier)
    return graph


def descendants(start, graph):
    """Explicit-stack DFS distinguishes rejoining branches from cycles."""
    colour = {start: 1}
    stack = [(start, iter(graph.get(start, [])))]
    while stack:
        identifier, children = stack[-1]
        child = next(children, None)
        if child is None:
            colour[identifier] = 2
            stack.pop()
        elif colour.get(child) == 1:
            return set(colour), True
        elif child not in colour:
            colour[child] = 1
            stack.append((child, iter(graph.get(child, []))))
    return set(colour), False


def build(cache, output, offline=False):
    download = Download(cache, offline=offline)
    catalogue = download.paged("public-gauges", CATALOGUE, {"where": "1=1", "geometry": ",".join(map(str, EXTENT)), "geometryType": "esriGeometryEnvelope", "inSR": 4326, "spatialRel": "esriSpatialRelIntersects", "outFields": "bom_stn_num,awrc_stateid,name,basin,state", "returnGeometry": "true", "outSR": 4326})
    if len({station["attributes"]["bom_stn_num"] for station in catalogue}) != len(catalogue):
        raise RuntimeError("The public catalogue contains duplicate station IDs")
    legacy = [cache / ("nodes-" + str(offset) + ".json") for offset in (0, 2000, 4000, 6000)]
    nodes = [feature for file in legacy for feature in features(json.loads(file.read_text()))] if all(file.exists() for file in legacy) else download.paged("network-gauges", NETWORK + "3/", {"where": "1=1", "outFields": "hydroid,stationno,stnname,netwstrmid,flagissues", "returnGeometry": "true", "outSR": 4326})
    matches = awrc_matches(catalogue, nodes)
    names = {watercourse(station["attributes"]["name"]).upper() for station in catalogue} - {""}
    for match in matches.values():
        name = re.split(r"\s+(?:at|@)\s+", match["networkName"], maxsplit=1, flags=re.I)[0]
        if re.search(r"\b(RIVER|CREEK|BROOK|CHANNEL)\b", name, re.I):
            names.add(name.upper())
    # Reuse complete licensed V3.3 downloads, verifying their HydroID topology
    # against Digital Atlas before combining the two published service copies.
    existing = set(json.loads((cache / "names.json").read_text())) if (cache / "names.json").exists() else set()
    old_batches = [sorted(existing)[i:i + 18] for i in range(0, len(existing), 18)]
    old_files = [cache / ("named-" + hashlib.sha256(json.dumps(batch).encode()).hexdigest()[:12] + ".json") for batch in old_batches]
    reuse = bool(existing) and all(file.exists() for file in old_files)
    streams = {row["attributes"]["hydroid"]: row for file in old_files for row in features(json.loads(file.read_text()))} if reuse else {}
    if reuse:
        sample = [110855354, 110870201, 110907780]
        compatibility = download.paged("atlas-seed", NETWORK + "7/", {"where": "hydroid IN (" + ",".join(map(str, sample)) + ")", "outFields": STREAM_FIELDS, "returnGeometry": "false"})
        if len(compatibility) != len(sample) or any(streams[row["attributes"]["hydroid"]]["attributes"][name] != row["attributes"][name] for row in compatibility for name in ("nextdownid", "flowdir")):
            raise RuntimeError("The published network copies have incompatible HydroID topology")
    needed = sorted(names - existing) if reuse else sorted(names)
    batches = [needed[i:i + 18] for i in range(0, len(needed), 18)]
    def named(batch):
        digest = hashlib.sha256(json.dumps(batch).encode()).hexdigest()[:12]
        return download.paged("named-" + digest, NETWORK + "7/", {"where": "name IN (" + ",".join("'" + name.replace("'", "''") + "'" for name in batch) + ")", "outFields": STREAM_FIELDS, "returnGeometry": "true", "outSR": 4326, "maxAllowableOffset": .0001})
    print("Loading named stream reference", flush=True)
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
        streams.update({feature["attributes"]["hydroid"]: feature for rows in executor.map(named, batches) for feature in rows})
    if not reuse:
        (cache / "names.json").write_text(json.dumps(sorted(names)))
    absent = {match["stream"] for match in matches.values()} - streams.keys()
    streams.update({feature["attributes"]["hydroid"]: feature for feature in download.streams(absent, geometry=True)})
    by_name = collections.defaultdict(list)
    for stream in streams.values():
        by_name[key(stream["attributes"].get("name"))].append(stream)
    for station in catalogue:
        identifier = station["attributes"]["bom_stn_num"]
        if identifier in matches:
            continue
        river = watercourse(station["attributes"]["name"])
        candidates = []
        for stream in by_name.get(key(river), []):
            projected = projection(point(station), stream)
            if projected and projected[0] <= 120:
                candidates.append((projected[0], stream))
        candidates.sort(key=lambda entry: entry[0])
        if not candidates:
            continue
        nearest = candidates[0][1]
        if one_channel(candidates):
            matches[identifier] = {"stream": nearest["attributes"]["hydroid"], "point": point(station), "method": "named-river-location", "matchDistance": round(candidates[0][0])}
    seeds = {match["stream"] for match in matches.values()}
    # Geometry is needed for station matching only. Keep seed shapes for the
    # final linear position check, not all national named-stream geometry.
    for identifier, stream in streams.items():
        if identifier not in seeds:
            stream.pop("geometry", None)
    by_name.clear()
    gc.collect()
    print("Matched " + str(len(matches)) + " public stations; loading flow-split connections", flush=True)
    split_rows = download.paged("flow-splits", NETWORK + "15/", {"where": "1=1", "outFields": "featureid,nextdownid", "returnGeometry": "false"})
    splits = collections.defaultdict(set)
    for row in split_rows:
        attributes = row["attributes"]
        splits[attributes["featureid"]].add(attributes["nextdownid"])
    if offline:
        for file in cache.glob("stream-links-*.json"):
            if ".page-" in file.name:
                continue
            for feature in features(json.loads(file.read_text())):
                streams.setdefault(feature["attributes"]["hydroid"], feature)
    print("Completing downstream connections for " + str(len(seeds)) + " gauge reaches", flush=True)
    fetched = 0
    unresolved = set()
    for attempt in range(200):
        graph = graph_for(streams, splits)
        reachable, pending = set(), list(seeds)
        while pending:
            identifier = pending.pop()
            if identifier in reachable:
                continue
            reachable.add(identifier)
            pending.extend(graph.get(identifier, []))
        missing = reachable - streams.keys()
        if not missing:
            break
        if offline:
            unresolved = missing
            print("Offline reference retains " + str(len(missing)) + " unresolved downstream continuations; only explicit known station paths are published", flush=True)
            break
        fetched += len(missing)
        if fetched > 80000:
            raise RuntimeError("Downstream reference exceeded its build limit")
        rows = download.streams(missing, geometry=len(missing) <= 64)
        returned = {feature["attributes"]["hydroid"] for feature in rows}
        if returned != missing:
            raise RuntimeError("Downstream links refer to missing stream IDs")
        streams.update({feature["attributes"]["hydroid"]: feature for feature in rows})
        if len(missing) <= 64:
            for feature in download.tiles(rows):
                streams.setdefault(feature["attributes"]["hydroid"], feature)
        print("Downstream pass " + str(attempt + 1) + ": " + str(len(rows)) + " connector reaches", flush=True)
    else:
        raise RuntimeError("Downstream reference could not be completed")
    records = []
    for station in catalogue:
        attributes = station["attributes"]
        identifier = attributes["bom_stn_num"]
        match = matches.get(identifier)
        if not match:
            continue
        stream = streams[match["stream"]]
        projected = projection(match["point"], stream)
        if not projected or projected[0] > 1500:
            continue
        public_name = watercourse(attributes["name"])
        native_name = stream["attributes"].get("name")
        river = public_name if not native_name or key(public_name) == key(native_name) else native_name.title()
        if not river:
            continue
        records.append({"id": str(identifier).zfill(6), "point": [round(value, 6) for value in point(station)], "river": river, "basin": attributes["basin"] or "", "stream": match["stream"], "position": round(projected[1], 2), "method": match["method"], "matchDistance": match["matchDistance"], "awrc": attributes["awrc_stateid"], "networkStationId": match.get("networkStationId")})
    trace = {identifier: descendants(identifier, graph) for identifier in {record["stream"] for record in records}}
    cyclic = [record for record in records if trace[record["stream"]][1]]
    records = [record for record in records if not trace[record["stream"]][1]]
    for record in records:
        visited = trace[record["stream"]][0]
        record["downstream"] = sorted(other["id"] for other in records if other is not record and metres(record["point"], other["point"]) > 50 and (other["stream"] in visited and other["stream"] != record["stream"] or other["stream"] == record["stream"] and other["position"] - record["position"] > 50))
    # A reciprocal relationship is never published as upstream/downstream order.
    lookup = {record["id"]: record for record in records}
    if any(record["id"] in lookup[target]["downstream"] for record in records for target in record["downstream"]):
        raise RuntimeError("Reference contains reciprocal station ordering")
    result = {"schemaVersion": 1, "retrievedUtc": datetime.datetime.now(datetime.timezone.utc).isoformat(), "extent": EXTENT, "attribution": "Commonwealth of Australia (Bureau of Meteorology) 2022; Geofabric V3.3 via Digital Atlas of Australia, Geoscience Australia; National Flood Gauge Network", "sources": {"stations": CATALOGUE, "networkGauges": NETWORK + "3/", "networkStreams": NETWORK + "7/", "flowSplits": NETWORK + "15/", "originalNetwork": ORIGINAL_NETWORK}, "catalogueCount": len(catalogue), "stationCount": len(records), "cyclicMatchesOmitted": len(cyclic), "unresolvedDownstreamContinuations": len(unresolved), "relationshipBasis": "Explicit directed paths present in the reference; missing continuations do not establish an order", "methods": dict(collections.Counter(record["method"] for record in records)), "stations": sorted(records, key=lambda record: record["id"])}
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, separators=(",", ":")) + "\n")
    print(json.dumps({key: value for key, value in result.items() if key not in ("stations", "sources")}))
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache-dir", type=pathlib.Path, default=pathlib.Path("/tmp/qld-gauge-flow-cache"))
    parser.add_argument("--output", type=pathlib.Path, default=ROOT / "data/gauge-flow.json")
    parser.add_argument("--offline", action="store_true", help="Use complete cached source downloads and publish only relationships proven by their known paths")
    arguments = parser.parse_args()
    build(arguments.cache_dir, arguments.output, offline=arguments.offline)
