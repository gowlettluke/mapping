"""Merge reviewed public BoM ordering evidence into the Geofabric reference.

The review file records explicit station identities and source-backed links.
It does not assign a channel from proximity, a river name or a water height.
"""
import collections
import copy
import datetime
import math
import re


def station_id(value):
    value = str(value)
    if not re.fullmatch(r"\d{6}", value) or int(value) == 0:
        raise ValueError("Reviewed station IDs must be six-digit BoM numbers")
    return value


def metres(a, b):
    return math.hypot((a[0] - b[0]) * 111195 * math.cos(math.radians((a[1] + b[1]) / 2)), (a[1] - b[1]) * 111195)


def same_river(a, b):
    return a["river"].casefold() == b["river"].casefold() and a["basin"] == b["basin"]


def same_dam(a, b):
    return bool(a.get("dam") and a.get("dam") == b.get("dam"))


def check_evidence(link, a, b, sources, alias=False):
    keys = link.get("sources", [])
    if not keys or any(key not in sources for key in keys):
        raise ValueError("Every reviewed connection needs recognised public sources")
    basis = link.get("basis")
    if same_dam(a, b) and a.get("side") and b.get("side"):
        if alias and a["side"] != b["side"] or not alias and a["side"] == "tailwater" and b["side"] == "headwater":
            raise ValueError("Reviewed evidence conflicts with a dam's headwater/tailwater identities")
    first, second = a.get("amtdKm"), b.get("amtdKm")
    numeric = lambda value: isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)
    if basis == "survey-amtd":
        if alias or not same_river(a, b) or not numeric(first) or not numeric(second) or first - second < .05:
            raise ValueError("Survey ordering needs distinct AMTD distances on the same watercourse")
    elif basis == "published-order":
        if alias or not same_river(a, b) or not isinstance(a.get("publishedRank"), int) or not isinstance(b.get("publishedRank"), int) or a["publishedRank"] >= b["publishedRank"]:
            raise ValueError("Published ordering needs ordered entries on the same watercourse")
        if numeric(first) and numeric(second) and first <= second:
            raise ValueError("Published ordering conflicts with the surveyed river distances")
        # A generic dam name does not establish its side of the structure.
        if same_dam(a, b) and (not a.get("side") or not b.get("side") or a["side"] == b["side"]):
            raise ValueError("The published list does not establish relative order within one dam site")
    elif basis == "survey-site":
        if not alias or not same_river(a, b) or not numeric(first) or first != second:
            raise ValueError("A surveyed-site equivalence needs the same river distance")
    elif basis == "documented-site":
        if not alias or not same_river(a, b):
            raise ValueError("A documented-site equivalence needs the same watercourse")
    elif basis == "dam-sides":
        if alias or not same_dam(a, b) or not same_river(a, b) or a.get("side") != "headwater" or b.get("side") != "tailwater":
            raise ValueError("Dam ordering requires identified headwater and tailwater gauges")
    elif basis == "network-map":
        if alias:
            raise ValueError("Map connections do not establish station equivalence")
    else:
        raise ValueError("Unknown reviewed ordering evidence")


def merge_reviews(catalogue, records, review):
    if review.get("schemaVersion") != 1 or not isinstance(review.get("sources"), dict):
        raise ValueError("The reviewed BoM ordering file is unavailable")
    try:
        datetime.date.fromisoformat(review["reviewedDate"])
    except (KeyError, TypeError, ValueError) as error:
        raise ValueError("The reviewed BoM ordering date is invalid") from error
    source = review["sources"]
    if any(not isinstance(value, dict) or not isinstance(value.get("url"), str) or not value["url"].startswith("https://") for value in source.values()):
        raise ValueError("Reviewed source provenance is invalid")
    current = {str(row["attributes"]["bom_stn_num"]).zfill(6): row for row in catalogue}
    existing = {row["id"]: copy.deepcopy(row) for row in records}
    stations, valid = {}, set()
    for row in review.get("stations", []):
        identifier = station_id(row["id"])
        if identifier in stations or not row.get("river") or not row.get("basin"):
            raise ValueError("Reviewed station identities are invalid or duplicated")
        point = row.get("point")
        if not isinstance(point, list) or len(point) != 2 or any(isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) for value in point) or abs(point[0]) > 180 or abs(point[1]) > 90:
            raise ValueError("A reviewed station has an invalid reference location")
        stations[identifier] = row
        site_point = row.get("sitePoint")
        if site_point is not None:
            if not isinstance(site_point, list) or len(site_point) != 2 or any(isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) for value in site_point) or metres(point, site_point) > 1000 or row.get("sitePointSource") not in source:
                raise ValueError("A reviewed provider location needs a nearby point and a public source")
        live = current.get(identifier)
        if live:
            position = [live["geometry"]["x"], live["geometry"]["y"]]
            if metres(point, position) <= 250 and live["attributes"]["basin"] == row.get("catalogueBasin", row["basin"]):
                valid.add(identifier)
    links, aliases, used, stale_anchors = [], [], set(), []
    for name, output in [("links", links), ("equivalentSites", aliases)]:
        for link in review.get(name, []):
            a, b = station_id(link["from"]), station_id(link["to"])
            if a == b or a not in stations or b not in stations:
                raise ValueError("A reviewed connection has an unknown station")
            equivalent = name == "equivalentSites"
            check_evidence(link, stations[a], stations[b], source, alias=equivalent)
            if link["basis"] == "published-order":
                anchors = link.get("anchors", [])
                if len(anchors) != 2 or anchors[0] == anchors[1] or any(identifier not in stations for identifier in anchors):
                    raise ValueError("Published ordering requires two identified network anchors")
                upper, lower = (stations[identifier] for identifier in anchors)
                if not same_river(upper, stations[a]) or not same_river(lower, stations[b]) or upper.get("publishedRank", math.inf) > stations[a]["publishedRank"] or lower.get("publishedRank", -1) < stations[b]["publishedRank"]:
                    raise ValueError("The network anchors do not bracket the reviewed river interval")
                if any(identifier not in valid or identifier not in existing for identifier in anchors) or anchors[1] not in existing[anchors[0]]["downstream"]:
                    stale_anchors.append([a, b])
                    continue
            distance = metres(stations[a]["point"], stations[b]["point"])
            site_distance = metres(stations[a].get("sitePoint", stations[a]["point"]), stations[b].get("sitePoint", stations[b]["point"]))
            if equivalent and (distance > 1000 or site_distance > 250):
                raise ValueError("Reviewed equivalent sites are too far apart")
            if a in valid and b in valid and (equivalent or distance > 50):
                output.append((a, b))
                used.update((a, b))
    for identifier in used - existing.keys():
        row, live = stations[identifier], current[identifier]
        existing[identifier] = {"id": identifier, "point": [round(live["geometry"][axis], 6) for axis in ("x", "y")], "river": row["river"], "basin": row["basin"], "method": "bom-reviewed-order", "matchDistance": round(metres(row["point"], [live["geometry"]["x"], live["geometry"]["y"]])), "awrc": live["attributes"].get("awrc_stateid"), "downstream": []}
    # Equivalent sites retain their individual observations and G numbers. Only
    # their external ordering relationships are shared, never a relative order.
    parent = {identifier: identifier for identifier in existing}
    def root(identifier):
        while parent[identifier] != identifier:
            parent[identifier] = parent[parent[identifier]]
            identifier = parent[identifier]
        return identifier
    for a, b in aliases:
        parent[root(b)] = root(a)
    members = collections.defaultdict(set)
    for identifier in existing:
        members[root(identifier)].add(identifier)
    graph = {identifier: set() for identifier in members}
    internal_removed = 0
    for row in existing.values():
        for target in row["downstream"]:
            a, b = root(row["id"]), root(target)
            if a != b:
                graph[a].add(b)
            else:
                internal_removed += 1
    for a, b in links:
        if root(a) == root(b):
            raise ValueError("Reviewed order cannot distinguish two equivalent sites")
        graph[root(a)].add(root(b))
    incoming = {identifier: 0 for identifier in graph}
    for targets in graph.values():
        for target in targets:
            incoming[target] += 1
    ordered = [identifier for identifier in graph if incoming[identifier] == 0]
    for identifier in ordered:
        for target in graph[identifier]:
            incoming[target] -= 1
            if incoming[target] == 0:
                ordered.append(target)
    if len(ordered) != len(graph):
        raise ValueError("Reviewed BoM evidence conflicts with existing downstream connections")
    reachable = {}
    for identifier in reversed(ordered):
        targets = set(graph[identifier])
        for target in graph[identifier]:
            targets.update(reachable[target])
        reachable[identifier] = targets
    for identifier, row in existing.items():
        row["downstream"] = sorted(target for group in reachable[root(identifier)] for target in members[group] if metres(row["point"], existing[target]["point"]) > 50)
        if identifier in used:
            row["orderReview"] = {"reviewedDate": review["reviewedDate"], "file": "data/gauge-order-reviews.json"}
        if len(members[root(identifier)]) > 1:
            row["equivalentSite"] = min(members[root(identifier)])
    metadata = {"reviewedDate": review["reviewedDate"], "sources": source, "matchedReviewedStations": len(used), "newStations": len(existing) - len(records), "skippedMovedOrMissingStations": sorted(stations.keys() - valid), "skippedUnconfirmedAnchorPairs": stale_anchors, "equivalentSitePairs": len(aliases), "directReviewedLinks": len(links), "sameSiteRelationshipsRemoved": internal_removed}
    return sorted(existing.values(), key=lambda row: row["id"]), metadata
