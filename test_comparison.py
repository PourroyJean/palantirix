"""Tests de la coupe GPS, de la comparaison et de l'alignement."""

import math
import unittest

from analyzer import AnalysisError
from comparison import at_distance, compare, trace


def synthetic(distances, seconds, *, hr=150, cadence=80, power=None, elevation=None,
              lat_offsets=None):
    """Points sur l'équateur, en mètres, avec timestamps indépendants."""
    elements = []
    for i, (distance, time) in enumerate(zip(distances, seconds)):
        lon = math.degrees(distance / 6371000)
        lat = math.degrees((lat_offsets[i] if lat_offsets else 0) / 6371000)
        ele = elevation[i] if elevation is not None else 10 + i
        cadence_value = cadence[i] if isinstance(cadence, list) else cadence
        hr_value = hr[i] if isinstance(hr, list) else hr
        ext = f'<gpxtpx:TrackPointExtension><gpxtpx:hr>{hr_value}</gpxtpx:hr>'
        if cadence_value is not None:
            ext += f'<gpxtpx:cad>{cadence_value}</gpxtpx:cad>'
        ext += '</gpxtpx:TrackPointExtension>'
        if power is not None:
            ext += f'<power>{power}</power>'
        elements.append(f'<trkpt lat="{lat:.12f}" lon="{lon:.12f}"><ele>{ele}</ele>'
                        f'<time>2026-01-01T00:{time//60:02d}:{time%60:02d}Z</time>'
                        f'<extensions>{ext}</extensions></trkpt>')
    return ('<gpx xmlns:gpxtpx="urn:garmin"><trk><trkseg>' + ''.join(elements) +
            '</trkseg></trk></gpx>').encode()


class ComparisonTests(unittest.TestCase):
    def test_interpolation_and_missing_power(self):
        first = synthetic([0, 80, 120, 200], [0, 10, 20, 30],
                          hr=[100, 120, 140, 160], cadence=[0, 80, 90, 100],
                          elevation=[10, 15, 12, 18])
        second = synthetic([0, 80, 120, 200], [0, 12, 24, 36], power=200)
        result = compare(first, second, .1, 'distance')
        self.assertAlmostEqual(result['reference']['duration_s'], 15, places=3)
        self.assertAlmostEqual(result['challenger']['duration_s'], 18, places=3)
        self.assertAlmostEqual(result['delta_s'], 3, places=3)
        self.assertIsNone(result['reference']['metrics']['power']['average'])
        self.assertAlmostEqual(result['reference']['metrics']['hr']['average'], (100*10+120*5)/15, places=3)
        self.assertAlmostEqual(result['reference']['metrics']['cadence']['average'], 160)
        self.assertAlmostEqual(result['reference']['metrics']['cadence']['covered_s'], 5, places=3)
        self.assertAlmostEqual(result['reference']['elevation_gain_m'], 5)
        self.assertAlmostEqual(result['reference']['elevation_loss_m'], 1.5, places=3)
        point = at_distance(*trace(first), 100)
        self.assertAlmostEqual(point['ele'], 13.5, places=3)
        left = result['geometry']['reference']
        self.assertEqual(len(left), 1)
        self.assertEqual(len(left[0]), 3)
        self.assertAlmostEqual(left[0][-1][1], math.degrees(100/6371000), places=8)
        self.assertEqual(result['geometry']['challenger'][0][-1], left[0][-1])

    def test_same_place_can_have_different_gps_distance(self):
        first = synthetic([0, 100, 200, 300], [0, 10, 20, 30])
        # Second trace visits a 40 m detour and returns to the shared 100 m point.
        second = synthetic([0, 50, 100, 200, 300], [0, 5, 15, 25, 35],
                           lat_offsets=[0, 40, 0, 0, 0])
        result = compare(first, second, .2, 'shared')
        self.assertGreater(result['challenger']['distance_km'], .2)
        self.assertAlmostEqual(result['challenger']['duration_s'], 25, places=2)
        self.assertAlmostEqual(result['delta_s'], 5, places=2)
        self.assertAlmostEqual(result['checkpoints'][-1]['distance_km'], .2)
        self.assertLess(result['checkpoints'][-1]['offset_m'], 2)
        self.assertGreater(len(result['geometry']['challenger'][0]),len(result['geometry']['reference'][0]))
        self.assertEqual(result['geometry']['reference'][0][-1],result['geometry']['challenger'][0][-1])

    def test_shared_divergence_rejected_and_distance_mode_available(self):
        first = synthetic([0, 100, 200, 300, 400], [0, 10, 20, 30, 40])
        second = synthetic([0, 100, 200, 300, 400], [0, 10, 20, 30, 40])
        # The final waypoint is >60 m from the reference path.
        second = second.replace(b'lon="0.003597286424"', b'lon="0.004497286424"')
        with self.assertRaisesRegex(AnalysisError, 'Parcours commun fiable'):
            compare(first, second, .4, 'shared')
        self.assertEqual(compare(first, second, .3, 'distance')['mode'], 'distance')

    def test_invalid_distance_and_short_trace(self):
        data = synthetic([0, 100, 200], [0, 10, 20])
        for distance in (0, .15, 100.1, float('nan')):
            with self.subTest(distance=distance), self.assertRaises(AnalysisError):
                compare(data, data, distance)
        with self.assertRaisesRegex(AnalysisError, 'plus courte'):
            compare(data, data, .3, 'distance')
        with self.assertRaises(AnalysisError):
            compare(b'<TrainingCenterDatabase/>', data)

    def test_independent_cadence_and_missing_samples(self):
        first = synthetic([0, 60, 120], [0, 10, 20], cadence=[80, 0, 80])
        second = synthetic([0, 60, 120], [0, 10, 20], cadence=[160, 0, 160])
        result = compare(first, second, .1, 'distance', 'double', 'direct')
        self.assertEqual(result['reference']['metrics']['cadence']['average'], 160)
        self.assertEqual(result['challenger']['metrics']['cadence']['average'], 160)
        self.assertAlmostEqual(result['reference']['metrics']['cadence']['covered_s'], 10)

    def test_long_gap_does_not_fill_sensor_coverage(self):
        first = synthetic([0, 100, 200], [0, 45, 55])
        result = compare(first, first, .2, 'distance')
        self.assertEqual(result['reference']['duration_s'], 55)
        self.assertAlmostEqual(result['reference']['metrics']['hr']['covered_s'], 10, places=5)
        self.assertAlmostEqual(result['reference']['metrics']['cadence']['covered_s'], 10, places=5)

    def test_finish_on_exact_point_keeps_last_maximum(self):
        data = synthetic([0, 100, 200], [0, 10, 20], hr=[100, 120, 180])
        result = compare(data, data, .2, 'distance')
        self.assertEqual(result['reference']['metrics']['hr']['maximum'], 180)

    def test_missing_coordinates_and_far_departure(self):
        good = synthetic([0, 100, 200], [0, 10, 20])
        bad = good.replace(b'lat="0.000000000000"', b'lat="bad"', 1)
        with self.assertRaisesRegex(AnalysisError, 'points GPS'):
            compare(bad, good)
        far = synthetic([0, 100, 200], [0, 10, 20], lat_offsets=[200, 200, 200])
        with self.assertRaisesRegex(AnalysisError, 'départs sont trop éloignés'):
            compare(good, far, .2, 'shared')

    def test_map_geometry_keeps_track_segments_separate(self):
        first = synthetic([0, 100, 200, 300], [0, 10, 20, 30])
        second = first.replace(b'</trkpt><trkpt', b'</trkpt></trkseg><trkseg><trkpt', 1)
        result = compare(second, second, .2, 'distance')
        self.assertEqual(len(result['geometry']['reference']), 2)
        self.assertEqual(len(result['geometry']['challenger']), 2)


if __name__ == '__main__':
    unittest.main()
