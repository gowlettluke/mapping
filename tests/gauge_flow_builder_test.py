"""Identity and topology checks for the public, static ordering reference."""
import importlib.util
import pathlib
import unittest

spec = importlib.util.spec_from_file_location("gauge_flow_builder", pathlib.Path(__file__).resolve().parents[1] / "scripts/refresh-gauge-flow.py")
flow = importlib.util.module_from_spec(spec)
spec.loader.exec_module(flow)


def station(identifier=538011, name="Powell Creek", position=(143.7047, -25.0678), awrc=None):
    return {"attributes": {"bom_stn_num": identifier, "name": name, "awrc_stateid": awrc}, "geometry": {"x": position[0], "y": position[1]}}


def node(name="Powell Creek at Test Bridge", position=(143.7047, -25.0678), stream=1, awrc="3802", flagged=None):
    return {"attributes": {"stnname": name, "stationno": awrc, "netwstrmid": stream, "flagissues": flagged}, "geometry": {"x": position[0], "y": position[1]}}


def record(placements, position=(145, -25)):
    return {"point": position, "placements": [{"stream": stream, "position": along} for stream, along in placements]}


class StationIdentityTests(unittest.TestCase):
    def test_explicit_watercourse_names(self):
        for name, expected in [("Powell Creek", "Powell Creek"), ("Eurombah Creek (Brookfield)", "Eurombah Creek"), ("Campbells Gully", "Campbells Gully"), ("Monal Creek at Upper Monal", "Monal Creek"), ("Retreat (Barcoo River)", "Barcoo River")]:
            self.assertEqual(flow.watercourse(name), expected)
        self.assertEqual(flow.watercourse("Upper Monal Alert"), "")

    def test_directory_is_matched_by_id_and_location_and_preserves_current_awrc(self):
        text = "<pre> 538011   003802 POWELL CREEK TM                POWELL CREEK            COOPER CREEK         250404S   1434217E    </pre>"
        directory = flow.directory_rows(text)
        rows = [station(), station(538012), station(position=(144, -25)), station(awrc="current")]
        flow.enrich_catalogue(rows, directory)
        self.assertEqual(rows[0]["attributes"]["directory_awrc"], "003802")
        self.assertEqual(rows[0]["attributes"]["directory_river"], "POWELL CREEK")
        self.assertNotIn("directory_awrc", rows[1]["attributes"])
        self.assertNotIn("directory_awrc", rows[2]["attributes"])
        self.assertEqual(rows[3]["attributes"]["awrc_stateid"], "current")
        self.assertNotIn("directory_awrc", rows[3]["attributes"])
        with self.assertRaises(RuntimeError):
            flow.directory_rows("<html>Error</html>")

    def test_directory_awrc_keeps_provenance(self):
        row = station()
        row["attributes"]["directory_awrc"] = "003802"
        match = flow.awrc_matches([row], [node()])[538011]
        self.assertEqual(match["method"], "directory-awrc-numeric")
        self.assertIsNone(row["attributes"]["awrc_stateid"])

    def test_named_station_requires_matching_site_and_a_unique_nearby_channel(self):
        row = station(name="Upper Monal Alert")
        nearby = node(name="Monal Creek at Upper Monal")
        self.assertIn(538011, flow.named_station_matches([row], [nearby], {}))
        for wrong in [node(name="Monal Creek at Lower Monal"), node(name="Monal Creek at Upper Monal", position=(144, -25)), node(name="Monal Creek at Upper Monal", flagged=1), node(name="Monal Creek at Upper Monal", stream=None)]:
            self.assertEqual(flow.named_station_matches([row], [wrong], {}), {})
        self.assertEqual(flow.named_station_matches([row], [nearby, node(name="Monal Creek at Upper Monal", stream=2)], {}), {})

    def test_matching_never_erases_dam_side_or_conflicting_river_or_awrc_suffix(self):
        hw = station(name="Example Dam (Headwater)")
        self.assertEqual(flow.station_name(hw["attributes"]["name"]), "EXAMPLE DAM HW")
        self.assertEqual(flow.named_station_matches([hw], [node(name="Test River at Example Dam TW")], {}), {})
        self.assertEqual(flow.named_station_matches([hw], [node(name="Test River at Example Dam HW")], {})[538011]["method"], "named-station-location")
        same_site = station(name="Test Bridge (Other River)")
        self.assertEqual(flow.named_station_matches([same_site], [node()], {}), {})
        self.assertEqual(flow.named_station_matches([station(name="Test Bridge", awrc="003802A")], [node(awrc="3802B")], {}), {})


class DirectedPathTests(unittest.TestCase):
    def test_farther_plausible_side_channel_is_not_discarded(self):
        def reach(identifier, next_id):
            return {"attributes": {"hydroid": identifier, "nextdownid": next_id}}
        self.assertFalse(flow.one_channel([(10, reach(1, 3)), (110, reach(2, 3))]))
        self.assertTrue(flow.one_channel([(10, reach(1, 2)), (110, reach(2, 3))]))

    def test_rejoining_channels_confirm_only_their_shared_downstream_order(self):
        graph = {1: {3}, 2: {3}, 3: {4}, 4: set()}
        trace = {identifier: flow.descendants(identifier, graph) for identifier in graph}
        uncertain = record([(1, 100), (2, 100)])
        receiving = record([(3, 100)], (145.01, -25))
        one_branch = record([(1, 200)], (145.02, -25))
        self.assertTrue(flow.confirmed_downstream(uncertain, receiving, trace))
        self.assertFalse(flow.confirmed_downstream(uncertain, one_branch, trace))
        self.assertFalse(flow.confirmed_downstream(receiving, uncertain, trace))
        self.assertFalse(any(cyclic for reached, cyclic in trace.values()))

    def test_every_placement_of_the_receiving_station_must_agree(self):
        trace = {1: ({1, 3}, False)}
        self.assertFalse(flow.confirmed_downstream(record([(1, 0)]), record([(3, 100), (4, 100)], (145.01, -25)), trace))
        self.assertFalse(flow.confirmed_downstream(record([]), record([(3, 100)], (145.01, -25)), trace))

    def test_same_segment_uses_direction_and_colocated_stations_are_not_ordered(self):
        trace = {1: ({1}, False)}
        upper, lower = record([(1, 10)]), record([(1, 100)], (145.01, -25))
        self.assertTrue(flow.confirmed_downstream(upper, lower, trace))
        self.assertFalse(flow.confirmed_downstream(lower, upper, trace))
        self.assertFalse(flow.confirmed_downstream(upper, record([(1, 100)]), trace))
        self.assertFalse(flow.confirmed_downstream(upper, record([(1, 40)], (145.01, -25)), trace))

    def test_cycles_are_detected_but_rejoining_branches_are_not_cycles(self):
        self.assertFalse(flow.descendants(1, {1: {2, 3}, 2: {4}, 3: {4}, 4: set()})[1])
        self.assertTrue(flow.descendants(1, {1: {2}, 2: {3}, 3: {2}})[1])

    def test_channel_location_tolerance_and_indeterminate_direction_are_not_relaxed(self):
        shape = {"attributes": {"flowdir": 1}, "geometry": {"paths": [[[145, -25], [145.01, -25]]]}}
        self.assertTrue(flow.placements({"point": [145, -25], "stream": 1, "candidateStreams": [1]}, {1: shape}))
        self.assertEqual(flow.placements({"point": [145, -25.01], "stream": 1, "candidateStreams": [1]}, {1: shape}), [])
        shape["attributes"]["flowdir"] = 0
        self.assertEqual(flow.placements({"point": [145, -25], "stream": 1}, {1: shape}), [])

    def test_connector_downloads_stop_outside_the_region_without_inventing_a_path(self):
        shape = {"geometry": {"paths": [[[143, -35], [143.1, -35.1]]]}}
        self.assertFalse(flow.regional_stream(shape))
        shape["geometry"]["paths"] = [[[143, -25], [143.1, -25.1]]]
        self.assertTrue(flow.regional_stream(shape))
        shape["geometry"]["paths"] = [[[136, -25], [155, -25]]]
        self.assertTrue(flow.regional_stream(shape))
        trace = {1: flow.descendants(1, {1: {2}})}
        self.assertFalse(flow.confirmed_downstream(record([(1, 0)]), record([(3, 100)], (145.01, -25)), trace))


if __name__ == "__main__":
    unittest.main()
