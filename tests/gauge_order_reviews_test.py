"""Reviewed evidence must add only supported station-order relationships."""
import copy
import importlib.util
import pathlib
import unittest

spec = importlib.util.spec_from_file_location("gauge_order_reviews", pathlib.Path(__file__).resolve().parents[1] / "scripts/gauge_order_reviews.py")
reviews = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reviews)


def identity(identifier, x=None, **extra):
    return {"id": str(identifier).zfill(6), "point": [145 + identifier * .01 if x is None else x, -25], "river": "Example River", "basin": "Example Basin", "amtdKm": 50 - identifier * 10, "publishedRank": identifier, **extra}


def catalogue(*rows):
    return [{"attributes": {"bom_stn_num": int(row["id"]), "basin": row.get("catalogueBasin", row["basin"]), "awrc_stateid": None}, "geometry": {"x": row["point"][0], "y": row["point"][1]}} for row in rows]


def existing(row, targets=()):
    return {**{key: copy.deepcopy(row[key]) for key in ("id", "point", "river", "basin")}, "method": "awrc", "downstream": [str(target).zfill(6) for target in targets]}


def edge(a, b, basis="survey-amtd", **extra):
    return {"from": str(a).zfill(6), "to": str(b).zfill(6), "basis": basis, "sources": ["test"], **extra}


def review(rows, links=(), aliases=()):
    return {"schemaVersion": 1, "reviewedDate": "2026-11-05", "sources": {"test": {"url": "https://example.invalid/synthetic-evidence"}}, "stations": rows, "links": list(links), "equivalentSites": list(aliases)}


class ReviewedOrderTests(unittest.TestCase):
    def test_surveyed_distance_adds_order_and_transitive_connections(self):
        a, b, c = identity(1), identity(2), identity(3)
        original = [existing(a, [3]), existing(c)]
        result, metadata = reviews.merge_reviews(catalogue(a, b, c), original, review([a, b, c], [edge(1, 2), edge(2, 3)]))
        by_id = {row["id"]: row for row in result}
        self.assertEqual(by_id[a["id"]]["downstream"], [b["id"], c["id"]])
        self.assertEqual(by_id[b["id"]]["downstream"], [c["id"]])
        self.assertEqual(metadata["newStations"], 1)
        self.assertEqual(original, [existing(a, [3]), existing(c)])

    def test_equal_distances_reversed_distances_and_other_rivers_do_not_establish_order(self):
        a, b = identity(1), identity(2)
        for other in [{**b, "amtdKm": a["amtdKm"]}, {**b, "amtdKm": 100}, {**b, "river": "Other River"}, {**b, "basin": "Other Basin"}]:
            with self.assertRaisesRegex(ValueError, "Survey ordering"):
                reviews.merge_reviews(catalogue(a, other), [existing(a)], review([a, other], [edge(1, 2)]))

    def test_water_level_or_gauge_zero_cannot_replace_amtd(self):
        a, b = identity(1), identity(2)
        a.pop("amtdKm")
        a.update(height=100, gaugeZeroMetres=200)
        with self.assertRaisesRegex(ValueError, "Survey ordering"):
            reviews.merge_reviews(catalogue(a, b), [existing(a)], review([a, b], [edge(1, 2)]))

    def test_published_order_is_bracketed_by_existing_directed_anchors(self):
        a, b, c = identity(1), identity(2), identity(3)
        b.pop("amtdKm")
        links = [edge(1, 2, "published-order", anchors=[a["id"], c["id"]]), edge(2, 3, "published-order", anchors=[a["id"], c["id"]])]
        result, _ = reviews.merge_reviews(catalogue(a, b, c), [existing(a, [3]), existing(c)], review([a, b, c], links))
        self.assertIn(b["id"], next(row for row in result if row["id"] == a["id"])["downstream"])
        unchanged, metadata = reviews.merge_reviews(catalogue(a, b, c), [existing(a), existing(c)], review([a, b, c], links))
        self.assertEqual(len(unchanged), 2)
        self.assertEqual(len(metadata["skippedUnconfirmedAnchorPairs"]), 2)

    def test_missing_or_nonbracketing_anchor_evidence_is_rejected(self):
        a, b, c = identity(1), identity(2), identity(3)
        b.pop("amtdKm")
        for anchors in [[], [a["id"], a["id"]], [c["id"], a["id"]]]:
            with self.assertRaises(ValueError):
                reviews.merge_reviews(catalogue(a, b, c), [existing(a, [3]), existing(c)], review([a, b, c], [edge(1, 2, "published-order", anchors=anchors)]))

    def test_moved_missing_and_reused_station_ids_cannot_inherit_reviewed_links(self):
        a, b, c = identity(1), identity(2), identity(3)
        evidence = review([a, b, c], [edge(1, 2), edge(2, 3)])
        for current in [catalogue(a, c), catalogue(a, {**b, "point": [146, -25]}, c), catalogue(a, {**b, "basin": "Different Basin"}, c)]:
            result, metadata = reviews.merge_reviews(current, [existing(a, [3]), existing(c)], evidence)
            self.assertEqual(len(result), 2)
            self.assertIn(b["id"], metadata["skippedMovedOrMissingStations"])

    def test_equivalent_sites_share_external_connections_without_an_internal_arrow(self):
        a, b, c = identity(1), identity(2, x=145.0101, amtdKm=40), identity(3)
        result, _ = reviews.merge_reviews(catalogue(a, b, c), [existing(a, [3]), existing(c)], review([a, b, c], aliases=[edge(1, 2, "survey-site")]))
        by_id = {row["id"]: row for row in result}
        self.assertEqual(by_id[a["id"]]["equivalentSite"], a["id"])
        self.assertEqual(by_id[b["id"]]["equivalentSite"], a["id"])
        self.assertEqual(by_id[a["id"]]["downstream"], [c["id"]])
        self.assertEqual(by_id[b["id"]]["downstream"], [c["id"]])

    def test_provider_location_can_corroborate_an_approximate_catalogue_location(self):
        a, b = identity(1), identity(2, x=145.0127)
        a.update(sitePoint=[145.0126, -25], sitePointSource="test")
        result, _ = reviews.merge_reviews(catalogue(a, b), [existing(a)], review([a, b], aliases=[edge(1, 2, "documented-site")]))
        self.assertEqual(len(result), 2)
        self.assertTrue(all(row["equivalentSite"] == a["id"] for row in result))

    def test_dam_headwater_and_tailwater_are_never_equivalent_or_reversed_by_list_order(self):
        a, b = identity(1, dam="Example", side="tailwater"), identity(2, dam="Example", side="headwater")
        for evidence in [review([a, b], [edge(1, 2, "network-map")]), review([a, b], aliases=[edge(1, 2, "documented-site")])]:
            with self.assertRaisesRegex(ValueError, "headwater/tailwater"):
                reviews.merge_reviews(catalogue(a, b), [existing(a)], evidence)
        a["side"], b["side"] = "headwater", "tailwater"
        result, _ = reviews.merge_reviews(catalogue(a, b), [existing(b)], review([a, b], [edge(1, 2, "dam-sides")]))
        self.assertIn(b["id"], next(row for row in result if row["id"] == a["id"])["downstream"])

    def test_conflicting_evidence_fails_instead_of_publishing_a_cycle(self):
        a, b, c = identity(1), identity(2), identity(3)
        with self.assertRaisesRegex(ValueError, "conflicts"):
            reviews.merge_reviews(catalogue(a, b, c), [existing(a, [3]), existing(c)], review([a, b, c], [edge(3, 2, "network-map"), edge(2, 1, "network-map")]))

    def test_unknown_sources_and_invalid_reference_points_are_rejected(self):
        a, b = identity(1), identity(2)
        evidence = review([a, b], [edge(1, 2, sources=["unknown"])])
        with self.assertRaisesRegex(ValueError, "sources"):
            reviews.merge_reviews(catalogue(a, b), [existing(a)], evidence)
        for point in [[True, -25], [float("nan"), -25], [145], [200, -25]]:
            other = {**b, "point": point}
            with self.assertRaisesRegex(ValueError, "location"):
                reviews.merge_reviews(catalogue(a, b), [existing(a)], review([a, other], [edge(1, 2)]))

    def test_reviewed_watercourse_basin_correction_does_not_change_the_catalogue_guard(self):
        a, b = identity(1, basin="Correct Basin", catalogueBasin="Old Catalogue Basin"), identity(2, basin="Correct Basin")
        result, _ = reviews.merge_reviews(catalogue(a, b), [existing(b)], review([a, b], [edge(1, 2)]))
        self.assertEqual(next(row for row in result if row["id"] == a["id"])["basin"], "Correct Basin")


if __name__ == "__main__":
    unittest.main()
