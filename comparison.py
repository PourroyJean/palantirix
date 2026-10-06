"""Comparaison de deux traces GPX, sans dépendances externes."""

from __future__ import annotations

from bisect import bisect_left
from math import asin, ceil, cos, isfinite, radians, sin, sqrt

from analyzer import AnalysisError, MAX_INTERVAL_SECONDS, read_points


def meters(a, b):
    la1, lo1 = radians(a[0]), radians(a[1])
    la2, lo2 = radians(b[0]), radians(b[1])
    h = sin((la2-la1)/2)**2 + cos(la1)*cos(la2)*sin((lo2-lo1)/2)**2
    return 12742000 * asin(min(1, sqrt(h)))


def trace(data):
    points, kind, _ = read_points(data)
    if kind != "gpx":
        raise AnalysisError("La comparaison accepte uniquement deux fichiers GPX.")
    points.sort(key=lambda p: p.time)
    if len(points) < 2 or any(p.lat is None or p.lon is None or
                                  not all(isfinite(v) for v in (p.lat, p.lon)) or
                                  not -90 <= p.lat <= 90 or not -180 <= p.lon <= 180
                                  for p in points):
        raise AnalysisError("Chaque GPX doit contenir au moins deux points GPS horodatés.")
    distances = [0.0]
    for a, b in zip(points, points[1:]):
        distances.append(distances[-1] + (meters((a.lat, a.lon), (b.lat, b.lon))
                                          if a.segment == b.segment else 0))
    return points, distances


def at_distance(points, distances, target):
    if target < 0 or target > distances[-1]+1e-5:
        raise AnalysisError("La distance choisie dépasse la longueur d’une trace.")
    target = min(target,distances[-1])
    index = min(bisect_left(distances, target-1e-5), len(points)-1)
    # Exactly at a GPS point (including a repeated distance across a segment
    # break), use the first arrival rather than spanning a pause by interpolation.
    if index == 0 or abs(distances[index]-target)<1e-5:
        p = points[index]
        return {"index": index, "time": p.time, "lat": p.lat, "lon": p.lon, "ele": p.ele}
    a, b = points[index-1:index+1]
    if a.segment != b.segment:
        raise AnalysisError("La coupe tombe sur une interruption entre segments GPX.")
    fraction = (target-distances[index-1])/(distances[index]-distances[index-1]) if distances[index]>distances[index-1] else 0
    return {"index": index, "time": a.time+(b.time-a.time)*fraction,
            "lat": a.lat+(b.lat-a.lat)*fraction, "lon": a.lon+(b.lon-a.lon)*fraction,
            "ele": a.ele+(b.ele-a.ele)*fraction if a.ele is not None and b.ele is not None else None}


def shared_waypoints(reference, other, limit=None):
    """Sequential nearest positions in a bounded progress window; never jump to a later loop."""
    rp, rd = reference
    op, od = other
    max_reference = min(rd[-1], limit if limit is not None else rd[-1])
    waypoints = [(0.0, 0.0, meters((rp[0].lat, rp[0].lon), (op[0].lat, op[0].lon)))]
    if waypoints[0][2] > 60:
        raise AnalysisError("Les départs sont trop éloignés pour comparer un même parcours.")
    previous_index = 0
    origin_lat = (rp[0].lat + op[0].lat)/2
    scale_lon = 111195*cos(radians(origin_lat))
    def cell(p):
        return (int(p.lat*111195//25), int(p.lon*scale_lon//25))
    bins = {}
    for index, point in enumerate(op):
        key = cell(point)
        bins.setdefault(key, []).append(index)
    for step in range(1, int(max_reference//100)+1):
        ref_distance = step*100.0
        ref = at_distance(rp, rd, ref_distance)
        expected = ref_distance + (waypoints[-1][1]-waypoints[-1][0])
        start = max(previous_index+1, bisect_left(od, max(0, expected-450)))
        end = min(len(op), bisect_left(od, expected+450)+1)
        if start >= end:
            break
        cy,cx = cell(rp[ref["index"]])
        candidates = []
        for dy in range(-3,4):
            for dx in range(-3,4):
                for j in bins.get((cy+dy,cx+dx), ()):
                    if start <= j < end:
                        candidates.append(j)
        if not candidates:
            break
        index = min(candidates, key=lambda j: meters((ref["lat"], ref["lon"]), (op[j].lat, op[j].lon)))
        separation = meters((ref["lat"], ref["lon"]), (op[index].lat, op[index].lon))
        if separation > 60 or od[index] <= waypoints[-1][1]:
            break
        waypoints.append((ref_distance, od[index], separation))
        previous_index = index
    return waypoints


def clipped_stats(trace_data, endpoint, factor):
    points, distances = trace_data
    finish = at_distance(points, distances, endpoint)
    start_time = points[0].time
    duration = (finish["time"] - start_time).total_seconds()
    if duration <= 0:
        raise AnalysisError("Aucun temps exploitable sur ce tronçon.")
    total = {k: 0.0 for k in ("hr", "power", "cadence")}
    covered = total.copy()
    maxima = {k: None for k in total}
    ascent = descent = 0.0
    chart = []
    for i, p in enumerate(points):
        if distances[i] > endpoint+1e-5 or p.time > finish["time"]:
            break
        values = {"hr": p.hr, "power": p.power,
                  "cadence": p.cadence*factor if p.cadence is not None and p.cadence > 0 else None}
        for key, value in values.items():
            if value is not None:
                maxima[key] = max(maxima[key], value) if maxima[key] is not None else value
        chart.append({"distance_m": distances[i], "hr": values["hr"], "cadence": values["cadence"],
                      "segment": p.segment, "time_s": (p.time-start_time).total_seconds()})
        if i == len(points)-1 or distances[i] >= endpoint:
            continue
        q = points[i+1]
        if p.segment != q.segment:
            continue
        delta = (q.time-p.time).total_seconds()
        span = distances[i+1]-distances[i]
        share = min(1.0, max(0.0, (endpoint-distances[i])/span)) if span > 0 else 1.0
        seconds = delta*share
        if delta <= 0 or delta > MAX_INTERVAL_SECONDS:
            continue
        if p.ele is not None and q.ele is not None:
            elevation = (q.ele-p.ele)*share
            ascent += max(0, elevation)
            descent += max(0, -elevation)
        for key, value in values.items():
            if value is not None:
                total[key] += value*seconds
                covered[key] += seconds
    chart.append({"distance_m": endpoint, "hr": None, "cadence": None,
                  "segment": points[finish["index"]].segment, "time_s": duration})
    # A sample exactly on the finish line is part of the measured section.
    final_point = points[finish["index"]]
    if distances[finish["index"]] <= endpoint+1e-5 and final_point.time <= finish["time"]:
        for key, value in (("hr", final_point.hr), ("power", final_point.power),
                           ("cadence", final_point.cadence*factor if final_point.cadence is not None
                            and final_point.cadence > 0 else None)):
            if value is not None:
                maxima[key] = max(maxima[key], value) if maxima[key] is not None else value
    return {"distance_km": endpoint/1000, "duration_s": duration, "pace_s_per_km": duration/(endpoint/1000),
            "elevation_gain_m": ascent, "elevation_loss_m": descent,
            "metrics": {key: {"average": total[key]/covered[key] if covered[key] else None,
                               "maximum": maxima[key], "covered_s": covered[key]} for key in total},
            "chart": chart, "finish": finish}


def trim_chart(chart, maximum=2400):
    """Bound the JSON/SVG size while retaining breaks and the finish sample."""
    if len(chart) <= maximum:
        return chart
    stride = (len(chart)-1)//(maximum-1)+1
    selected = {0, len(chart)-1}
    selected.update(range(0,len(chart),stride))
    for i in range(1,len(chart)):
        before, after = chart[i-1], chart[i]
        if ((before["hr"] is None) != (after["hr"] is None) or
            (before["cadence"] is None) != (after["cadence"] is None) or
            before["segment"] != after["segment"] or
            after["time_s"]-before["time_s"]>MAX_INTERVAL_SECONDS):
            selected.update((i-1,i))
    return [chart[i] for i in sorted(selected)]


def clipped_geometry(trace_data, endpoint, maximum=2400):
    """GPS geometry up to the selected finish, including an interpolated end.

    Segments remain separate so the map never draws across a track break.
    """
    points, distances = trace_data
    finish = at_distance(points, distances, endpoint)
    segments = []
    current = []
    previous_segment = None
    previous_time = None
    for point, distance in zip(points, distances):
        if point.time > finish["time"] or distance > endpoint + 1e-5:
            break
        if current and (point.segment != previous_segment or
                        (point.time-previous_time).total_seconds() > MAX_INTERVAL_SECONDS):
            segments.append(current)
            current = []
        current.append([point.lat, point.lon])
        previous_segment = point.segment
        previous_time = point.time
    end_coordinate = [finish["lat"], finish["lon"]]
    if not current:
        current = [end_coordinate]
    elif current[-1] != end_coordinate:
        current.append(end_coordinate)
    segments.append(current)
    count = sum(map(len, segments))
    if count > maximum:
        stride = (count - 1) // (maximum - len(segments)) + 1
        segments = [part if len(part) <= 2 else [part[0], *part[1:-1:stride], part[-1]]
                    for part in segments]
    return segments


def preview(data: bytes) -> dict:
    """Whole route for local map/slider interaction, without retaining the GPX."""
    route = trace(data)
    points, distances = route
    if distances[-1] < 10:
        raise AnalysisError("Cette trace est trop courte pour sélectionner un segment de 10 m.")
    groups = []
    current = []
    previous = None
    for point, distance in zip(points, distances):
        if current and (point.segment != previous.segment or
                        (point.time - previous.time).total_seconds() > MAX_INTERVAL_SECONDS):
            groups.append(current)
            current = []
        current.append([distance, point.lat, point.lon])
        previous = point
    if current:
        groups.append(current)
    # Keep exact endpoints and track breaks, thin only the geometry sent to the browser.
    count = sum(map(len, groups))
    stride = max(1, (count - 1) // max(1, 2400 - len(groups)) + 1)
    groups = [group if len(group) < 3 else [group[0], *group[1:-1:stride], group[-1]]
              for group in groups]
    return {"distance_m": distances[-1], "geometry": groups, "points": len(points)}


def thin_hr_series(runs, isolated, maximum=5000):
    """Bound SVG/JSON size without joining gaps or losing local extrema."""
    count = sum(len(run) for run in runs) + len(isolated)
    if count <= maximum:
        return runs, isolated
    stride = ceil(count / (maximum // 2))
    reduced = []
    for run in runs:
        if len(run) <= 2:
            reduced.append(run)
            continue
        selected = {0, len(run) - 1}
        for start in range(1, len(run) - 1, stride):
            bucket = range(start, min(start + stride, len(run) - 1))
            selected.add(min(bucket, key=lambda i: run[i][1]))
            selected.add(max(bucket, key=lambda i: run[i][1]))
        reduced.append([run[i] for i in sorted(selected)])
    if isolated:
        keep = {0, len(isolated) - 1, min(range(len(isolated)), key=lambda i: isolated[i][1]),
                max(range(len(isolated)), key=lambda i: isolated[i][1])}
        keep.update(range(0, len(isolated), stride))
        isolated = [isolated[i] for i in sorted(keep)]
    return reduced, isolated


def pace_profile(points, distances, start_m, end_m, start_time):
    """100 m local moving pace; never smooth across stops or GPS/time gaps.

    A full 100 m window stays inside each moving run. Near a stop, shift the
    full window towards the run's interior instead of discarding 50 m on both
    sides of the break. A 50-99 m run is eligible only when BOTH ends are
    actual selection boundaries, never as a short post-stop fragment.
    Mean moving pace uses ALL valid moving intervals, including short runs,
    whenever at least one local window is available.
    """
    runs = []
    run = []
    moving_seconds = moving_meters = 0.0
    gps_freeze_s = 0.0

    def flush():
        nonlocal run
        if len(run) > 1:
            runs.append(run)
        run = []

    i = 0
    while i < len(points) - 1:
        a, b = points[i], points[i + 1]
        d0, d1 = distances[i:i + 2]
        if d0 >= end_m:
            break
        seconds = (b.time - a.time).total_seconds()
        if d1 <= d0 and a.segment == b.segment and 0 < seconds <= MAX_INTERVAL_SECONDS:
            # One or several identical GPS coordinates are not necessarily a
            # stop. Only stitch a short freeze with sustained cadence (and no
            # measured zero power) and actual GPS movement on BOTH sides.
            j = i
            while (j < len(points) - 1 and distances[j + 1] <= distances[j] and
                   points[j].segment == points[j + 1].segment and
                   0 < (points[j + 1].time - points[j].time).total_seconds() <= MAX_INTERVAL_SECONDS):
                j += 1
            freeze_s = (points[j].time - points[i].time).total_seconds()
            next_moving = (j < len(points) - 1 and points[j].segment == points[j + 1].segment and
                           distances[j + 1] > distances[j] and
                           0 < (points[j + 1].time - points[j].time).total_seconds() <= MAX_INTERVAL_SECONDS)
            supported = all(point.cadence is not None and point.cadence > 0 and
                            point.power is not None and point.power > 0
                            for point in points[i:j + 1])
            if (run and abs(run[-1][0] - d0) < 1e-5 and next_moving and
                    0 < freeze_s <= 15 and supported and start_m <= d0 < end_m):
                moving_seconds += freeze_s
                gps_freeze_s += freeze_s
                i = j
                continue
            flush()
            i = j
            continue
        if (a.segment != b.segment or not 0 < seconds <= MAX_INTERVAL_SECONDS or
                d1 <= d0 or d1 <= start_m):
            flush()
            i += 1
            continue
        lo, hi = max(d0, start_m), min(d1, end_m)
        if hi <= lo:
            i += 1
            continue
        t0 = (a.time - start_time).total_seconds()
        lo_time = t0 + seconds * (lo - d0) / (d1 - d0)
        hi_time = t0 + seconds * (hi - d0) / (d1 - d0)
        moving_seconds += hi_time - lo_time
        moving_meters += hi - lo
        if run and abs(run[-1][0] - lo) > 1e-5:
            flush()
        if not run:
            run.append([lo, lo_time])
        run.append([hi, hi_time])
        i += 1
    flush()

    def time_at(run, positions, distance):
        j = min(max(1, bisect_left(positions, distance)), len(run) - 1)
        (d0, t0), (d1, t1) = run[j - 1:j + 1]
        return t0 + (t1 - t0) * (distance - d0) / (d1 - d0)

    curves = []
    for run in runs:
        at_start = abs(run[0][0] - start_m) < 1e-5
        at_end = abs(run[-1][0] - end_m) < 1e-5
        required = 50 if at_start and at_end else 100
        if run[-1][0] - run[0][0] < required - 1e-5:
            continue
        positions = [sample[0] for sample in run]
        curve = []
        run_start, run_end = positions[0], positions[-1]
        for distance, _ in run:
            if run_end - run_start < 100 - 1e-5:
                lo, hi = run_start, run_end
            else:
                lo = min(max(distance - 50, run_start), run_end - 100)
                hi = lo + 100
            pace = 1000 * (time_at(run, positions, hi) - time_at(run, positions, lo)) / (hi - lo)
            if pace > 0 and isfinite(pace):
                curve.append([distance, pace])
        # A single endpoint value has no curve to draw and would create a
        # misleading isolated stub after a stop (typically <100 m of travel).
        if len(curve) >= 2:
            curves.append(curve)

    samples = [sample for run in curves for sample in run]
    fastest_pace = min((sample[1] for sample in samples), default=None)
    # Uniform pace can differ by tiny amounts after GPS/time interpolation;
    # prefer the first position when the values are numerically equivalent.
    fastest = min((sample for sample in samples if sample[1] <= fastest_pace + 1e-5),
                  key=lambda sample: sample[0], default=None) if fastest_pace is not None else None
    slowest = max((sample[1] for sample in samples), default=None)
    reduced, _ = thin_hr_series(curves, [])
    # The earliest equivalent minimum might not be the bucket's strict minimum
    # in the SVG reduction. Keep the highlighted point ON the displayed line.
    if fastest is not None:
        for original, rendered in zip(curves, reduced):
            if fastest in original:
                if fastest not in rendered:
                    rendered.append(fastest)
                    rendered.sort(key=lambda sample: sample[0])
                break
    return {"segments": reduced,
            "average_s_per_km": 1000 * moving_seconds / moving_meters if samples and moving_meters else None,
            "fastest_point": {"distance_m": fastest[0], "pace_s_per_km": fastest[1]} if fastest else None,
            "slowest_s_per_km": slowest, "gps_freeze_s": gps_freeze_s}


def range_stats(route, start_m: float, end_m: float, factor: int) -> dict:
    """Time-weighted measurements strictly inside the selected GPS-distance range."""
    points, distances = route
    if not (isfinite(start_m) and isfinite(end_m) and
            0 <= start_m < end_m <= distances[-1] + 1e-5 and end_m-start_m >= 10 - 1e-5):
        raise AnalysisError("Bornes invalides : choisissez au moins 10 m dans chaque trace.")
    end_m = min(end_m, distances[-1])
    start = at_distance(points, distances, start_m)
    finish = at_distance(points, distances, end_m)
    # A full-route selection includes the final timestamp, even when the
    # athlete stood still at the final GPS coordinate or a segment restarted
    # there (the last few cumulative distances can therefore be identical).
    if abs(end_m - distances[-1]) < 1e-5:
        last = points[-1]
        finish = {"index": len(points) - 1, "time": last.time,
                  "lat": last.lat, "lon": last.lon, "ele": last.ele}
    duration = (finish["time"] - start["time"]).total_seconds()
    if duration <= 0:
        raise AnalysisError("Les timestamps du segment ne permettent pas un chrono positif.")
    totals = {key: 0.0 for key in ("hr", "power", "cadence")}
    coverage = totals.copy()
    maxima = {key: None for key in totals}
    gain = loss = elevation_covered_s = 0.0
    hr_segments = []
    hr_covered_starts = set()
    previous_hr_end = None
    for i in range(max(0, bisect_left(distances, start_m) - 1), len(points) - 1):
        a, b = points[i:i+2]
        d0, d1 = distances[i:i+2]
        if d0 > end_m or (d0 == end_m and end_m < distances[-1] - 1e-5):
            break
        if a.segment != b.segment:
            previous_hr_end = None
            continue
        seconds = (b.time - a.time).total_seconds()
        if seconds <= 0 or seconds > MAX_INTERVAL_SECONDS:
            previous_hr_end = None
            continue
        span = d1 - d0
        if span > 0:
            lo = max(start_m, d0)
            hi = min(end_m, d1)
            if hi <= lo:
                continue
            fraction = (hi-lo)/span
        else:
            # Stationary points can still account for elapsed time in the range.
            if not start_m <= d0 <= end_m or b.time > finish["time"]:
                continue
            fraction = 1.0
            lo = hi = d0
        weighted_seconds = seconds * fraction
        if a.ele is not None and b.ele is not None and isfinite(a.ele) and isfinite(b.ele):
            delta_ele = (b.ele-a.ele) * fraction
            gain += max(0, delta_ele)
            loss += max(0, -delta_ele)
            elevation_covered_s += weighted_seconds
        values = {"hr": a.hr, "power": a.power,
                  "cadence": a.cadence * factor if a.cadence is not None and a.cadence > 0 else None}
        if a.hr is not None:
            # The last measured HR holds until the next valid timestamp. A
            # broken/missing interval starts a NEW run; never bridge it in SVG.
            if previous_hr_end != i or not hr_segments:
                hr_segments.append([])
            run = hr_segments[-1]
            if not run or run[-1] != [lo, a.hr]:
                run.append([lo, a.hr])
            run.append([hi, a.hr])
            hr_covered_starts.add(i)
            previous_hr_end = i + 1
        else:
            previous_hr_end = None
        for key, value in values.items():
            if value is not None:
                totals[key] += value * weighted_seconds
                coverage[key] += weighted_seconds
                maxima[key] = value if maxima[key] is None else max(maxima[key], value)
    # Include an endpoint sample only if the selected finish is an actual measured point.
    last = finish["index"]
    if abs(distances[last]-end_m) < 1e-5:
        point = points[last]
        for key, value in (("hr", point.hr), ("power", point.power),
                           ("cadence", point.cadence * factor if point.cadence is not None
                            and point.cadence > 0 else None)):
            if value is not None:
                maxima[key] = value if maxima[key] is None else max(maxima[key], value)
    metrics = {key: {"average": totals[key]/coverage[key] if coverage[key] else None,
                     "maximum": maxima[key], "covered_s": coverage[key]}
               for key in totals}
    measured_hr = [(i, max(start_m, min(end_m, distances[i])), point.hr)
                   for i, point in enumerate(points)
                   if point.hr is not None and start["time"] <= point.time <= finish["time"]
                   and start_m - 1e-5 <= distances[i] <= end_m + 1e-5]
    # Include the held value at an interpolated start; other uncoupled samples
    # are drawn as dots rather than connected across a missing interval.
    hr_values = [point[2] for point in measured_hr]
    if hr_segments:
        hr_values.extend(run[0][1] for run in hr_segments)
    # A valid sample in a long GPS gap is still an observed peak, even though
    # it contributes no time to the average. Keep the table and marker aligned.
    metrics["hr"]["maximum"] = max(hr_values) if hr_values else None
    hr_isolated = [[distance, hr] for i, distance, hr in measured_hr if i not in hr_covered_starts]
    # Select the earliest plotted occurrence, before thinning the line. This
    # also retains maxima that appear only as an isolated/end-point sample.
    candidates = [point for run in hr_segments for point in run] + hr_isolated
    peak = next((point for point in candidates if point[1] == metrics["hr"]["maximum"]), None)
    if peak is not None:
        peak = min((point for point in candidates if point[1] == peak[1]),
                   key=lambda point: point[0])
    hr_segments, hr_isolated = thin_hr_series(hr_segments, hr_isolated)
    pace_series = pace_profile(points, distances, start_m, end_m, start["time"])
    return {"start_m": start_m, "end_m": end_m, "distance_km": (end_m-start_m)/1000,
            "duration_s": duration, "pace_s_per_km": duration/((end_m-start_m)/1000),
            "elevation_gain_m": gain if elevation_covered_s else None,
            "elevation_loss_m": loss if elevation_covered_s else None, "metrics": metrics,
            "hr_series": {"segments": hr_segments, "isolated": hr_isolated,
                          "minimum_bpm": min(hr_values) if hr_values else None,
                          "maximum_point": {"distance_m": peak[0], "bpm": peak[1]} if peak else None},
            "pace_series": pace_series,
            "start": {"lat": start["lat"], "lon": start["lon"]},
            "finish": {"lat": finish["lat"], "lon": finish["lon"]}}


def compare_ranges(first: bytes, second: bytes, first_start_m: float, first_end_m: float,
                   second_start_m: float, second_end_m: float,
                   cadence_first: str = "double", cadence_second: str = "double") -> dict:
    if cadence_first not in ("double", "direct") or cadence_second not in ("double", "direct"):
        raise AnalysisError("Convention de cadence inconnue.")
    a = range_stats(trace(first), first_start_m, first_end_m, 2 if cadence_first == "double" else 1)
    b = range_stats(trace(second), second_start_m, second_end_m, 2 if cadence_second == "double" else 1)
    minima = [value for value in (a["hr_series"]["minimum_bpm"], b["hr_series"]["minimum_bpm"])
              if value is not None]
    slowest = [value for value in (a["pace_series"]["slowest_s_per_km"],
                                  b["pace_series"]["slowest_s_per_km"]) if value is not None]
    return {"reference": a, "challenger": b, "delta_s": b["duration_s"] - a["duration_s"],
            "hr_common_min_bpm": min(minima) if minima else None,
            "pace_common_slowest_s_per_km": max(slowest) if slowest else None,
            "distance_delta_m": (b["distance_km"]-a["distance_km"])*1000,
            "start_separation_m": meters((a["start"]["lat"], a["start"]["lon"]),
                                         (b["start"]["lat"], b["start"]["lon"])),
            "finish_separation_m": meters((a["finish"]["lat"], a["finish"]["lon"]),
                                          (b["finish"]["lat"], b["finish"]["lon"])),
            "warnings": ["Sélection libre : un écart de chrono ne démontre pas une vitesse supérieure si les parcours diffèrent.",
                         "Cadence estimée selon la conversion choisie par fichier ; zéros exclus.",
                         "D+/D− issus des variations d’altitude brutes, sensibles au bruit GPS."]}


def compare(first: bytes, second: bytes, distance_km: float = 3.1, mode: str = "shared",
            cadence_first: str = "double", cadence_second: str = "double"):
    if mode not in ("shared", "distance"):
        raise AnalysisError("Mode de comparaison inconnu.")
    if cadence_first not in ("double", "direct") or cadence_second not in ("double", "direct"):
        raise AnalysisError("Convention de cadence inconnue.")
    if not 0.1 <= distance_km <= 100 or abs(distance_km*10-round(distance_km*10)) > 1e-7:
        raise AnalysisError("Choisissez une distance de 0,1 à 100 km par pas de 0,1 km.")
    reference, challenger = trace(first), trace(second)
    target = round(distance_km*1000)
    if target > reference[1][-1]+1e-5 or (mode == "distance" and target > challenger[1][-1]+1e-5):
        raise AnalysisError("Une des traces est plus courte que la distance demandée.")
    anchors = shared_waypoints(reference, challenger, min(target, reference[1][-1])) if mode == "shared" else []
    if mode == "shared":
        if anchors[-1][0] < target:
            raise AnalysisError(f"Parcours commun fiable jusqu’à {anchors[-1][0]/1000:.1f} km de la référence ; réduisez la distance ou utilisez « même distance GPS ».")
        challenger_end = anchors[-1][1]
    else:
        challenger_end = target
    left = clipped_stats(reference, target, 2 if cadence_first == "double" else 1)
    right = clipped_stats(challenger, challenger_end, 2 if cadence_second == "double" else 1)
    geometry = {"reference": clipped_geometry(reference, target),
                "challenger": clipped_geometry(challenger, challenger_end)}
    if mode == "distance":
        anchors = [(0,0,None)] + [(float(d),float(d),None) for d in range(100,target+1,100)]
    checkpoints = []
    for ref_m, other_m, offset in anchors:
        if ref_m > target: break
        t1 = (at_distance(*reference, ref_m)["time"]-reference[0][0].time).total_seconds()
        t2 = (at_distance(*challenger, other_m)["time"]-challenger[0][0].time).total_seconds()
        checkpoints.append({"distance_km": ref_m/1000, "other_distance_km": other_m/1000,
                            "offset_m": offset, "delta_s": t2-t1})
    if mode == "shared":
        # Project the challenger onto the reference's distance axis, preserving detours.
        mapped = []
        cursor = 0
        for sample in right["chart"]:
            d = sample["distance_m"]
            while cursor+1 < len(anchors)-1 and anchors[cursor+1][1] < d:
                cursor += 1
            a,b = anchors[cursor:cursor+2]
            fraction = (d-a[1])/(b[1]-a[1]) if b[1]>a[1] else 0
            mapped.append({**sample, "distance_m": a[0]+(b[0]-a[0])*fraction})
        right["chart"] = mapped
    else:
        finish_positions = (left["finish"], right["finish"])
        offset = meters((finish_positions[0]["lat"], finish_positions[0]["lon"]),
                        (finish_positions[1]["lat"], finish_positions[1]["lon"]))
    for result in (left,right):
        result.pop("finish")
        result["chart"] = trim_chart(result["chart"])
    return {"mode": mode, "distance_km": distance_km, "reference": left, "challenger": right,
            "geometry": geometry,
            "delta_s": right["duration_s"]-left["duration_s"], "checkpoints": checkpoints,
            "finish_separation_m": anchors[-1][2] if mode == "shared" else offset,
            "warnings": (["Même arrivée GPS estimée ; les traces ne sont pas parfaitement identiques, comparez aussi les distances parcourues."]
                         if mode == "shared" else ["Même distance cumulée, mais les arrivées peuvent être à des endroits différents."]) +
                        ["Cadence : ×2 ou ×1 selon chaque réglage ; zéros exclus, unité non certifiée par les GPX.",
                         "D+/D− issus des variations d’altitude brutes ; sensibles au bruit GPS."]}
