"""Sélections manuelles indépendantes et préchargement local."""

import math
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from analyzer import AnalysisError
from app import default_trace, load_default_files
from comparison import compare_ranges, pace_profile, preview, thin_hr_series, trace
from test_comparison import synthetic


class SegmentSelectionTests(unittest.TestCase):
    def test_start_and_end_are_interpolated_independently(self):
        first = synthetic([0, 80, 120, 200, 280], [0, 10, 20, 30, 40],
                          hr=[100, 120, 140, 160, 180], cadence=[0, 80, 90, 100, 110],
                          elevation=[10, 15, 12, 18, 20])
        second = synthetic([0, 80, 120, 200, 280], [0, 12, 24, 36, 48], power=200)
        result = compare_ranges(first, second, 100, 220, 40, 160)
        a, b = result['reference'], result['challenger']
        self.assertAlmostEqual(a['duration_s'], 17.5)
        self.assertAlmostEqual(b['duration_s'], 24)
        self.assertAlmostEqual(result['delta_s'], 6.5)
        self.assertAlmostEqual(a['distance_km'], 0.12)
        self.assertAlmostEqual(a['metrics']['hr']['average'], (120*5+140*10+160*2.5)/17.5)
        self.assertEqual(a['metrics']['hr']['maximum'], 160)
        self.assertAlmostEqual(a['metrics']['cadence']['average'], (160*5+180*10+200*2.5)/17.5)
        self.assertAlmostEqual(a['elevation_gain_m'], 6.5)
        self.assertAlmostEqual(a['elevation_loss_m'], 1.5)
        self.assertIsNone(a['metrics']['power']['average'])
        self.assertEqual(b['metrics']['power']['average'], 200)
        self.assertNotEqual(a['start'], b['start'])
        self.assertNotEqual(a['finish'], b['finish'])

    def test_zero_cadence_gap_and_stationary_pause(self):
        data = synthetic([0, 50, 50, 100, 150], [0, 10, 15, 25, 70],
                         hr=[100, 110, 120, 130, 140], cadence=[80, 0, 60, 90, 100])
        result = compare_ranges(data, data, 0, 100, 0, 150)
        first, second = result['reference'], result['challenger']
        self.assertEqual(first['duration_s'], 25)
        self.assertAlmostEqual(first['metrics']['hr']['covered_s'], 25, places=5)
        self.assertAlmostEqual(first['metrics']['cadence']['covered_s'], 20, places=5)
        self.assertAlmostEqual(first['metrics']['cadence']['average'], (160*10+120*10)/20)
        self.assertEqual(second['duration_s'], 70)
        self.assertAlmostEqual(second['metrics']['hr']['covered_s'], 25, places=5)
        self.assertAlmostEqual(second['metrics']['cadence']['covered_s'], 20, places=5)

    def test_invalid_bounds_and_independent_cadence(self):
        data = synthetic([0, 50, 100, 150], [0, 10, 20, 30], cadence=80)
        for pair in [(-10, 100), (0, 0), (90, 95), (100, 200), (float('nan'), 100)]:
            with self.subTest(pair=pair), self.assertRaises(AnalysisError):
                compare_ranges(data, data, *pair, 0, 100)
        result = compare_ranges(data, data, 0, 100, 0, 150, 'double', 'direct')
        self.assertEqual(result['reference']['metrics']['cadence']['average'], 160)
        self.assertAlmostEqual(result['challenger']['metrics']['cadence']['average'], 80)
        self.assertNotEqual(result['reference']['distance_km'], result['challenger']['distance_km'])

    def test_preview_full_route_and_breaks(self):
        data = synthetic([0, 100, 200, 300], [0, 10, 20, 30])
        broken = data.replace(b'</trkpt><trkpt', b'</trkpt></trkseg><trkseg><trkpt', 1)
        result = preview(broken)
        self.assertEqual(result['points'], 4)
        self.assertEqual(len(result['geometry']), 2)
        self.assertAlmostEqual(result['geometry'][0][0][0], 0)
        self.assertAlmostEqual(result['geometry'][-1][-1][0], result['distance_m'])
        with self.assertRaises(AnalysisError):
            preview(synthetic([0, 5], [0, 1]))

    def test_full_trace_finishes_at_last_timestamp_after_stationary_points(self):
        data = synthetic([0, 50, 100, 100, 100], [0, 10, 20, 25, 30],
                         hr=[100, 120, 140, 160, 180])
        result = compare_ranges(data, data, 0, preview(data)['distance_m'],
                                0, preview(data)['distance_m'])['reference']
        self.assertEqual(result['duration_s'], 30)
        self.assertAlmostEqual(result['metrics']['hr']['covered_s'], 30)
        self.assertAlmostEqual(result['metrics']['hr']['average'],
                               (100*10+120*10+140*5+160*5)/30)
        self.assertEqual(result['metrics']['hr']['maximum'], 180)

    def test_exact_end_does_not_count_stationary_time_beyond_selection(self):
        data = synthetic([0, 50, 100, 100, 150], [0, 10, 20, 25, 30])
        result = compare_ranges(data, data, 0, 100, 0, 150)['reference']
        self.assertEqual(result['duration_s'], 20)
        self.assertAlmostEqual(result['metrics']['hr']['covered_s'], 20)

    def test_broken_track_excludes_missing_interval(self):
        data = synthetic([0, 50, 100, 150], [0, 10, 20, 30])
        broken = data.replace(b'</trkpt><trkpt', b'</trkpt></trkseg><trkseg><trkpt', 1)
        result = compare_ranges(broken, broken, 0, preview(broken)['distance_m'],
                                0, preview(broken)['distance_m'])['reference']
        self.assertEqual(result['duration_s'], 30)
        self.assertAlmostEqual(result['metrics']['hr']['covered_s'], 20)

    def test_rejects_invalid_and_unusable_gpx(self):
        for data in [b'<gpx><trk>', b'<gpx/>', b'<gpx><trk><trkseg><trkpt lat="0" lon="0"><ele>1</ele>'
                     b'<time>not a timestamp</time></trkpt></trkseg></trk></gpx>']:
            with self.subTest(data=data), self.assertRaises(AnalysisError):
                preview(data)

    def test_missing_altitude_keeps_sensor_metrics_and_reports_unknown_elevation(self):
        data = synthetic([0, 50, 100], [0, 10, 20])
        data = data.replace(b'<ele>10</ele>', b'').replace(b'<ele>11</ele>', b'').replace(b'<ele>12</ele>', b'')
        result = compare_ranges(data, data, 0, 100, 0, 100)['reference']
        self.assertEqual(result['duration_s'], 20)
        self.assertEqual(result['metrics']['hr']['average'], 150)
        self.assertIsNone(result['elevation_gain_m'])
        self.assertIsNone(result['elevation_loss_m'])

    def test_hr_series_uses_absolute_distance_and_common_minimum(self):
        first = synthetic([0, 80, 120, 200, 280], [0, 10, 20, 30, 40],
                          hr=[115, 120, 140, 160, 180])
        second = synthetic([0, 80, 120, 200, 280], [0, 10, 20, 30, 40],
                           hr=[90, 100, 110, 120, 130])
        result = compare_ranges(first, second, 100, 220, 40, 160)
        self.assertEqual(result['hr_common_min_bpm'], 90)
        a = result['reference']['hr_series']
        b = result['challenger']['hr_series']
        self.assertAlmostEqual(a['segments'][0][0][0], 100)
        self.assertAlmostEqual(a['segments'][-1][-1][0], 220)
        self.assertAlmostEqual(b['segments'][0][0][0], 40)
        self.assertAlmostEqual(b['segments'][-1][-1][0], 160)
        self.assertEqual(a['minimum_bpm'], 120)
        self.assertEqual(b['minimum_bpm'], 90)
        self.assertEqual(a['segments'][0][0][1] - result['hr_common_min_bpm'], 30)
        self.assertEqual(-(b['segments'][0][0][1] - result['hr_common_min_bpm']), 0)

    def test_hr_chart_does_not_join_long_gap_missing_hr_or_track_break(self):
        data = synthetic([0, 50, 100, 150, 200, 250], [0, 10, 20, 60, 70, 80],
                         hr=[100, 110, 120, None, 130, 140])
        # hr=None becomes an invalid sensor reading and is treated as missing.
        broken = data.replace(b'</trkpt><trkpt', b'</trkpt></trkseg><trkseg><trkpt', 1)
        result = compare_ranges(broken, data, 0, preview(broken)['distance_m'],
                                0, preview(data)['distance_m'])
        first = result['reference']['hr_series']
        second = result['challenger']['hr_series']
        self.assertEqual(result['hr_common_min_bpm'], 100)
        self.assertEqual(len(first['segments']), 2)
        self.assertEqual(len(second['segments']), 2)
        self.assertTrue(any(abs(point[0] - 100) < 0.01 for point in second['isolated']))
        for series, distance in ((first, preview(broken)['distance_m']),
                                 (second, preview(data)['distance_m'])):
            self.assertTrue(all(run[0][0] >= 0 and run[-1][0] <= distance + 1e-5
                                for run in series['segments']))

    def test_hr_chart_keeps_exact_30_second_interval_and_breaks_longer_gap(self):
        exact = synthetic([0, 50, 100], [0, 30, 40], hr=[110, 120, 130])
        long = synthetic([0, 50, 100], [0, 31, 41], hr=[110, 120, 130])
        result = compare_ranges(exact, long, 0, 100, 0, 100)
        self.assertEqual(len(result['reference']['hr_series']['segments']), 1)
        self.assertEqual(len(result['challenger']['hr_series']['segments']), 1)
        self.assertAlmostEqual(result['reference']['hr_series']['segments'][0][0][0], 0)
        self.assertAlmostEqual(result['challenger']['hr_series']['segments'][0][0][0], 50)
        self.assertTrue(any(abs(distance) < 1e-5 for distance, _ in
                            result['challenger']['hr_series']['isolated']))

    def test_hr_maximum_point_on_curve_and_at_final_sample(self):
        first = synthetic([0, 50, 100, 150], [0, 10, 20, 30], hr=[110, 180, 135, 120])
        second = synthetic([0, 50, 100, 150], [0, 10, 20, 30], hr=[100, 120, 140, 190])
        result = compare_ranges(first, second, 0, 150, 0, 150)
        blue = result['reference']['hr_series']
        orange = result['challenger']['hr_series']
        self.assertEqual(blue['maximum_point']['bpm'], 180)
        self.assertAlmostEqual(blue['maximum_point']['distance_m'], 50, delta=.001)
        self.assertEqual(orange['maximum_point']['bpm'], 190)
        self.assertAlmostEqual(orange['maximum_point']['distance_m'], 150, delta=.001)
        self.assertTrue(any(abs(point[0] - 150) < .001 and point[1] == 190
                            for point in orange['isolated']))

    def test_hr_maximum_point_on_isolated_sample_and_missing_hr(self):
        gap = synthetic([0, 50, 100, 150], [0, 10, 50, 60], hr=[100, 180, 130, 140])
        missing = synthetic([0, 50, 100, 150], [0, 10, 20, 30],
                            hr=[None, None, None, None])
        result = compare_ranges(gap, missing, 0, 150, 0, 150)
        series = result['reference']['hr_series']
        self.assertEqual(series['maximum_point']['bpm'], 180)
        self.assertAlmostEqual(series['maximum_point']['distance_m'], 50, delta=.001)
        self.assertTrue(any(abs(point[0] - 50) < .001 and point[1] == 180
                            for point in series['isolated']))
        self.assertIsNone(result['challenger']['hr_series']['maximum_point'])

    def test_hr_maximum_point_is_earliest_location_when_tied(self):
        data = synthetic([0, 50, 100, 150], [0, 10, 20, 30], hr=[180, 120, 180, 130])
        series = compare_ranges(data, data, 0, 150, 0, 150)['reference']['hr_series']
        self.assertAlmostEqual(series['maximum_point']['distance_m'], 0, delta=.001)

    def test_hr_chart_missing_on_one_or_both_tracks(self):
        good = synthetic([0, 100, 200], [0, 10, 20], hr=[100, 110, 120])
        missing = synthetic([0, 100, 200], [0, 10, 20], hr=[None, None, None])
        one = compare_ranges(good, missing, 0, 200, 0, 200)
        self.assertEqual(one['hr_common_min_bpm'], 100)
        self.assertIsNone(one['challenger']['hr_series']['minimum_bpm'])
        self.assertEqual(one['challenger']['hr_series']['segments'], [])
        both = compare_ranges(missing, missing, 0, 200, 0, 200)
        self.assertIsNone(both['hr_common_min_bpm'])

    def test_hr_series_thinning_retains_extrema_endpoints_and_separate_runs(self):
        long_run = [[i, 150] for i in range(1000)]
        long_run[433][1] = 90
        long_run[766][1] = 190
        runs, isolated = thin_hr_series([long_run, [[1200, 155], [1210, 160]]],
                                        [[1100, 130]], maximum=100)
        self.assertEqual(len(runs), 2)
        self.assertEqual(runs[0][0], [0, 150])
        self.assertEqual(runs[0][-1], [999, 150])
        self.assertIn([433, 90], runs[0])
        self.assertIn([766, 190], runs[0])
        self.assertEqual(isolated, [[1100, 130]])

    def test_pace_profile_100m_interpolation_and_moving_mean(self):
        # 0–50 m: 10 s, 50–100 m: 20 s, 100–150 m: 10 s.
        data = synthetic([0, 50, 100, 150], [0, 10, 30, 40])
        result = compare_ranges(data, data, 0, 150, 0, 150)
        series = result['reference']['pace_series']
        self.assertAlmostEqual(series['average_s_per_km'], 40 / .15, places=5)
        samples = series['segments'][0]
        self.assertAlmostEqual(samples[0][0], 0)
        self.assertAlmostEqual(samples[0][1], 300)
        self.assertAlmostEqual(samples[1][1], 300)
        self.assertAlmostEqual(samples[2][1], 300)
        self.assertAlmostEqual(samples[-1][0], 150)
        self.assertAlmostEqual(samples[-1][1], 300)
        self.assertAlmostEqual(result['pace_common_slowest_s_per_km'], 300)
        self.assertAlmostEqual(series['fastest_point']['distance_m'], 0)

    def test_pace_clips_both_segment_bounds_and_keeps_absolute_kilometers(self):
        data = synthetic([0, 50, 100, 150, 200, 250], [0, 5, 10, 15, 20, 25])
        result = compare_ranges(data, data, 25, 175, 75, 225)
        for side, start, finish in (('reference', 25, 175), ('challenger', 75, 225)):
            series = result[side]['pace_series']
            self.assertAlmostEqual(series['average_s_per_km'], 100)
            self.assertAlmostEqual(series['segments'][0][0][0], start, delta=.001)
            self.assertAlmostEqual(series['segments'][0][-1][0], finish, delta=.001)
        self.assertAlmostEqual(result['pace_common_slowest_s_per_km'], 100)

    def test_pace_breaks_at_gap_stop_and_track_segment(self):
        data = synthetic([0, 50, 100, 150, 150, 200, 250, 300, 350],
                         [0, 5, 10, 50, 55, 60, 65, 70, 75])
        broken = data.replace(b'</trkpt><trkpt', b'</trkpt></trkseg><trkseg><trkpt', 1)
        result = compare_ranges(broken, data, 0, preview(broken)['distance_m'],
                                0, preview(data)['distance_m'])
        first = result['reference']['pace_series']['segments']
        second = result['challenger']['pace_series']['segments']
        self.assertEqual(len(first), 1)  # first 50 m before the GPX break cannot be smoothed
        self.assertEqual(len(second), 2)
        self.assertTrue(second[0][-1][0] < second[1][0][0])
        self.assertAlmostEqual(result['challenger']['pace_series']['average_s_per_km'], 100)

    def test_pace_short_runs_and_zero_distance_do_not_generate_samples(self):
        data = synthetic([0, 10, 10, 20, 20, 30], [0, 2, 4, 6, 8, 10])
        series = compare_ranges(data, data, 0, 30, 0, 30)['reference']['pace_series']
        self.assertEqual(series['segments'], [])
        self.assertIsNone(series['average_s_per_km'])
        self.assertIsNone(series['fastest_point'])
        self.assertIsNone(series['slowest_s_per_km'])

    def test_pace_30_second_interval_valid_and_longer_gap_excluded(self):
        exact = synthetic([0, 50, 100], [0, 30, 40])
        gap = synthetic([0, 50, 100], [0, 31, 41])
        result = compare_ranges(exact, gap, 0, 100, 0, 100)
        self.assertAlmostEqual(result['reference']['pace_series']['average_s_per_km'], 400)
        series = result['challenger']['pace_series']
        self.assertEqual(series['segments'], [])
        self.assertIsNone(series['average_s_per_km'])

    def test_pace_stop_stubs_are_not_displayed_at_internal_breaks(self):
        data = synthetic([0, 50, 100, 150, 150, 200, 250, 300, 300, 350, 400, 450],
                         [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55])
        series = compare_ranges(data, data, 0, 450, 0, 450)['reference']['pace_series']
        # The 150 m opening run has a full 100 m window. The 150 m middle
        # run only has interior windows; the 150 m ending run has an edge.
        self.assertEqual(len(series['segments']), 3)
        self.assertAlmostEqual(series['segments'][0][-1][0], 150, delta=.001)
        self.assertAlmostEqual(series['segments'][1][0][0], 150, delta=.001)
        self.assertAlmostEqual(series['segments'][1][-1][0], 300, delta=.001)
        self.assertAlmostEqual(series['segments'][2][0][0], 300, delta=.001)

    def test_pace_stop_fragments_50_to_99m_need_selection_edge(self):
        # A short internal run is not sufficient to justify a local pace.
        data = synthetic([0, 50, 100, 100, 150, 175, 175, 225, 275],
                         [0, 5, 10, 15, 20, 25, 30, 35, 40])
        series = compare_ranges(data, data, 0, 275, 0, 275)['reference']['pace_series']
        self.assertEqual(len(series['segments']), 2)
        self.assertTrue(all(not (100 + .001 < point[0] < 175 - .001)
                            for run in series['segments'] for point in run))

    def test_short_segment_only_permitted_if_both_ends_are_selection_edges(self):
        data = synthetic([0, 50, 75, 75, 125, 175], [0, 5, 8, 13, 18, 23])
        short = compare_ranges(data, data, 0, 75, 0, 75)['reference']['pace_series']
        self.assertEqual(len(short['segments']), 1)
        self.assertAlmostEqual(short['segments'][0][-1][0], 75, delta=.001)
        whole = compare_ranges(data, data, 0, 175, 0, 175)['reference']['pace_series']
        self.assertEqual(len(whole['segments']), 1)
        self.assertAlmostEqual(whole['segments'][0][0][0], 75, delta=.001)

    def test_pace_window_shifts_inward_at_stop_without_crossing_it(self):
        # 100 m on each side of a 10 s GPS standstill, with different speeds.
        data = synthetic([0, 50, 100, 100, 150, 200], [0, 5, 10, 20, 40, 60])
        series = compare_ranges(data, data, 0, 200, 0, 200)['reference']['pace_series']
        self.assertEqual(len(series['segments']), 2)
        self.assertAlmostEqual(series['segments'][0][-1][0], 100, delta=.001)
        self.assertAlmostEqual(series['segments'][0][-1][1], 100, delta=.001)
        self.assertAlmostEqual(series['segments'][1][0][0], 100, delta=.001)
        self.assertAlmostEqual(series['segments'][1][0][1], 400, delta=.001)
        self.assertAlmostEqual(series['average_s_per_km'], 250, delta=.001)

    def test_short_gps_freeze_with_cadence_and_power_stays_on_pace_curve(self):
        data = synthetic([0, 50, 100, 100, 100, 150, 200],
                         [0, 5, 10, 11, 12, 17, 22], cadence=60, power=110)
        series = compare_ranges(data, data, 0, 200, 0, 200)['reference']['pace_series']
        self.assertEqual(len(series['segments']), 1)
        self.assertEqual(series['gps_freeze_s'], 2)
        self.assertAlmostEqual(series['average_s_per_km'], 110)
        self.assertTrue(any(abs(sample[0] - 100) < .001 for sample in series['segments'][0]))

    def test_freeze_requires_continuous_effort_and_gps_movement_on_both_sides(self):
        base = synthetic([0, 50, 100, 100, 100, 150, 200],
                         [0, 5, 10, 11, 12, 17, 22], cadence=60, power=110)
        for data in (base.replace(b'<power>110</power>', b'<power>0</power>', 4),
                     synthetic([0, 50, 100, 100, 100, 150, 200],
                               [0, 5, 10, 11, 12, 17, 22],
                               cadence=[60, 60, 60, 0, 60, 60, 60], power=110),
                     synthetic([0, 50, 100, 100, 100, 150, 200],
                               [0, 5, 10, 11, 12, 17, 22], cadence=60)):
            with self.subTest(data=data[:120]):
                series = compare_ranges(data, data, 0, 200, 0, 200)['reference']['pace_series']
                self.assertEqual(series['gps_freeze_s'], 0)
                self.assertEqual(len(series['segments']), 2)

    def test_long_freeze_and_track_break_never_stitched(self):
        long = synthetic([0, 50, 100, 100, 100, 150, 200],
                         [0, 5, 10, 20, 30, 35, 40], cadence=60, power=110)
        broken = synthetic([0, 50, 100, 100, 100, 150, 200],
                           [0, 5, 10, 11, 12, 17, 22], cadence=60, power=110)
        broken = broken.replace(b'</trkpt><trkpt', b'</trkpt></trkseg><trkseg><trkpt', 3)
        for data in (long, broken):
            series = compare_ranges(data, data, 0, preview(data)['distance_m'],
                                    0, preview(data)['distance_m'])['reference']['pace_series']
            self.assertEqual(series['gps_freeze_s'], 0)
            self.assertGreaterEqual(len(series['segments']), 1)

    def test_pace_fastest_tie_is_earliest_and_no_window_while_stationary(self):
        data = synthetic([0, 50, 100, 150, 200], [0, 10, 20, 30, 40])
        series = pace_profile(*trace(data), 0, 200, trace(data)[0][0].time)
        self.assertAlmostEqual(series['fastest_point']['distance_m'], 0)

    def test_preload_accepts_only_named_entries_and_no_substitution(self):
        first = synthetic([0, 100], [0, 10])
        with tempfile.TemporaryDirectory() as folder:
            existing = Path(folder) / 'first.gpx'
            existing.write_bytes(first)
            missing = Path(folder) / 'second.gpx'
            with patch('app.DEFAULT_FILES', {'first': existing, 'second': missing}):
                self.assertEqual(default_trace('first'), first)
                with self.assertRaisesRegex(AnalysisError, 'absent de Downloads'):
                    default_trace('second')
                with self.assertRaisesRegex(AnalysisError, 'inconnue'):
                    default_trace('../first.gpx')

    def test_optional_local_preload_configuration(self):
        with tempfile.TemporaryDirectory() as folder:
            config = Path(folder) / 'local-traces.json'
            self.assertEqual(load_default_files(config), {})
            config.write_text('{"first": "reference.gpx", "second": "comparaison.gpx"}')
            paths = load_default_files(config)
            self.assertEqual(paths['first'], Path.home() / 'Downloads' / 'reference.gpx')
            self.assertEqual(paths['second'], Path.home() / 'Downloads' / 'comparaison.gpx')
            for name in ('../secret.gpx', '/tmp/secret.gpx', 'folder' + chr(92) + 'secret.gpx', 'trace.tcx'):
                with self.subTest(name=name):
                    config.write_text('{"first": ' + json.dumps(name) + '}')
                    with self.assertRaisesRegex(AnalysisError, 'noms de GPX'):
                        load_default_files(config)
            config.write_text('{"other": "trace.gpx"}')
            with self.assertRaisesRegex(AnalysisError, 'first et second'):
                load_default_files(config)
            config.write_text('not JSON')
            with self.assertRaisesRegex(AnalysisError, 'invalide'):
                load_default_files(config)


if __name__ == '__main__':
    unittest.main()
