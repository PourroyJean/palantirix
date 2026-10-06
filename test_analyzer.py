"""Exécuter avec : python3 -m unittest -v"""

import unittest
from datetime import datetime, timedelta, timezone

from analyzer import AnalysisError, analyze


def gpx_point(time, hr=None, cad=None, power=None, power_tag="power"):
    extensions = ""
    if power is not None:
        extensions += f"<ns3:{power_tag}>{power}</ns3:{power_tag}>"
    if hr is not None or cad is not None:
        extensions += "<gpxtpx:TrackPointExtension>"
        if hr is not None:
            extensions += f"<gpxtpx:hr>{hr}</gpxtpx:hr>"
        if cad is not None:
            extensions += f"<gpxtpx:cad>{cad}</gpxtpx:cad>"
        extensions += "</gpxtpx:TrackPointExtension>"
    instant = datetime(2026, 1, 1, tzinfo=timezone.utc) + timedelta(seconds=time)
    return f"<trkpt><time>{instant.isoformat()}</time><extensions>{extensions}</extensions></trkpt>"


def gpx(*segments):
    tracks = "".join("<trkseg>" + "".join(points) + "</trkseg>" for points in segments)
    return ("<gpx xmlns='urn:gpx' xmlns:gpxtpx='urn:garmin' xmlns:ns3='urn:extension'>"
            "<trk>" + tracks + "</trk></gpx>").encode()


class AnalyzerTests(unittest.TestCase):
    def test_zones_boundaries_and_irregular_time_weights(self):
        data = gpx([gpx_point(0, 135, 0, 0), gpx_point(5, 136, 60, 100),
                    gpx_point(10, 151, 80, 200, "Watts"), gpx_point(20, 152, 90, 300),
                    gpx_point(30, 161, 100, 500), gpx_point(40, 162, 100, 500),
                    gpx_point(50, 169, 100, 500), gpx_point(60, 170, 100, 500),
                    gpx_point(70, 180, 100, 500)])
        result = analyze(data)
        self.assertEqual(result["duration_s"], 70)
        self.assertEqual(result["thresholds"], {"z2_min": 136, "z3_min": 152, "z4_min": 162, "z5_min": 170})
        self.assertEqual(result["zones"], {"z1_s": 5, "z2_s": 15, "z3_s": 20,
                                           "z4_s": 20, "z5_s": 10, "unknown_s": 0})
        self.assertAlmostEqual(result["metrics"]["hr"]["average"],
                               (135*5+136*5+151*10+152*10+161*10+162*10+169*10+170*10)/70)
        self.assertAlmostEqual(result["metrics"]["power"]["average"],
                               (0*5+100*5+200*10+300*10+500*40)/70)
        self.assertEqual(result["metrics"]["power"]["maximum"], 500)
        self.assertEqual(result["metrics"]["cadence"]["average"], (0*5+60*5+80*10+90*10+100*40)/70)

    def test_missing_measurements_and_gap_above_30_seconds(self):
        data = gpx([gpx_point(0, 162, 0, 0), gpx_point(30, None, None, None),
                    gpx_point(61, 170, 90, 150), gpx_point(62, 169, 0, 0)])
        result = analyze(data)
        self.assertEqual(result["duration_s"], 62)
        self.assertEqual(result["zones"]["z4_s"], 30)
        self.assertEqual(result["zones"]["z5_s"], 1)
        self.assertEqual(result["zones"]["unknown_s"], 31)
        self.assertEqual(result["metrics"]["power"]["average"], 150/31)
        self.assertEqual(result["metrics"]["cadence"]["average"], 90/31)

    def test_segment_boundary_is_not_interpolated(self):
        result = analyze(gpx([gpx_point(0, 170)], [gpx_point(5, 170), gpx_point(6, 170)]))
        self.assertEqual(result["zones"]["z5_s"], 1)
        self.assertEqual(result["zones"]["unknown_s"], 5)

    def test_one_point_and_no_power(self):
        result = analyze(gpx([gpx_point(0, 170, 80)]), sport="course")
        self.assertIsNone(result["metrics"]["hr"]["average"])
        self.assertIsNone(result["metrics"]["power"]["maximum"])
        self.assertEqual(result["cadence_unit"], "pas/min (estimés)")
        self.assertEqual(result["metrics"]["cadence"]["maximum"], 160)
        self.assertTrue(any("convention non inscrite" in w for w in result["warnings"]))

    def test_running_half_cadence_zero_excluded_and_walking_separate(self):
        data = gpx([gpx_point(0, 160, 0), gpx_point(5, 160, 80),
                    gpx_point(15, 160, 55), gpx_point(25, 160, 0), gpx_point(30)])
        result = analyze(data, sport="course")
        self.assertEqual(result["metrics"]["cadence"]["average"], 135)
        self.assertEqual(result["metrics"]["cadence"]["covered_s"], 20)
        self.assertEqual(result["zero_cadence_s"], 10)
        self.assertEqual(result["running_cadence"],
                         {"average": 160, "covered_s": 10, "threshold_spm": 130})
        self.assertEqual([p["cadence"] for p in result["chart"]], [None, 160, 110, None, None])
        self.assertEqual(result["metrics"]["hr"]["covered_s"], 30)

        direct = analyze(data, sport="course", cadence_mode="direct")
        self.assertEqual(direct["metrics"]["cadence"]["average"], 67.5)
        self.assertIsNone(direct["running_cadence"]["average"])
        self.assertEqual([p["cadence"] for p in direct["chart"]], [None, 80, 55, None, None])

    def test_invalid_cadence_mode(self):
        with self.assertRaisesRegex(AnalysisError, "Convention de cadence"):
            analyze(gpx([gpx_point(0)]), sport="course", cadence_mode="unknown")

    def test_tcx_activity_and_watts(self):
        data = b"""<TrainingCenterDatabase xmlns='urn:tcx' xmlns:ns3='urn:extension'>
          <Activities><Activity Sport='Running'><Lap><Track>
          <Trackpoint><Time>2026-01-01T00:00:00Z</Time><HeartRateBpm><Value>170</Value></HeartRateBpm>
          <Cadence>85</Cadence><Extensions><TPX><ns3:Watts>250</ns3:Watts></TPX></Extensions></Trackpoint>
          <Trackpoint><Time>2026-01-01T00:00:10Z</Time><HeartRateBpm><Value>170</Value></HeartRateBpm>
          <Extensions><TPX><RunCadence>86</RunCadence></TPX></Extensions></Trackpoint>
          </Track></Lap></Activity></Activities></TrainingCenterDatabase>"""
        result = analyze(data, sport="course")
        self.assertEqual(result["format"], "TCX")
        self.assertEqual(result["zones"]["z5_s"], 10)
        self.assertEqual(result["metrics"]["power"]["average"], 250)
        self.assertEqual(result["cadence_sources"], ["Cadence", "RunCadence"])

    def test_tcx_multiple_activities_rejected(self):
        data = b"<TrainingCenterDatabase><Activities><Activity/><Activity/></Activities></TrainingCenterDatabase>"
        with self.assertRaisesRegex(AnalysisError, "plusieurs activités"):
            analyze(data)

    def test_invalid_data_and_thresholds(self):
        for data in (b"", b"<gpx>", b"<gpx><trk><trkseg><trkpt><time>bad</time></trkpt></trkseg></trk></gpx>",
                     b"<!DOCTYPE gpx [<!ENTITY x 'test'>]><gpx/>"):
            with self.subTest(data=data), self.assertRaises(AnalysisError):
                analyze(data)
        with self.assertRaisesRegex(AnalysisError, "Seuils incohérents"):
            analyze(gpx([gpx_point(0)]), z4_min=172, z5_min=164)
        with self.assertRaisesRegex(AnalysisError, "Seuils incohérents"):
            analyze(gpx([gpx_point(0)]), z2_min=152, z3_min=152)

    def test_custom_zone_thresholds(self):
        data = gpx([gpx_point(0, 142), gpx_point(3, 158), gpx_point(7, 164),
                    gpx_point(13, 172), gpx_point(21, 172)])
        result = analyze(data, z2_min=140, z3_min=155, z4_min=164, z5_min=172)
        self.assertEqual(result["zones"], {"z1_s": 0, "z2_s": 3, "z3_s": 4,
                                           "z4_s": 6, "z5_s": 8, "unknown_s": 0})

    def test_valid_timestamp_missing_sensor_is_excluded_not_zero(self):
        result = analyze(gpx([gpx_point(0, 162, 60, 100), gpx_point(5),
                              gpx_point(10, 170, 80, 200), gpx_point(15)]))
        self.assertEqual(result["metrics"]["power"]["average"], 150)
        self.assertEqual(result["metrics"]["power"]["covered_s"], 10)
        self.assertEqual(result["zones"]["unknown_s"], 5)


if __name__ == "__main__":
    unittest.main()
