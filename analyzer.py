"""Analyse locale d'un fichier GPX/TCX, sans dépendance externe."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from io import BytesIO
import math
import re
import xml.etree.ElementTree as ET

MAX_FILE_BYTES = 50 * 1024 * 1024
MAX_INTERVAL_SECONDS = 30


class AnalysisError(ValueError):
    """Données ou paramètres non exploitables."""


@dataclass(frozen=True)
class Point:
    time: datetime
    segment: int
    hr: float | None
    power: float | None
    cadence: float | None
    cadence_source: str | None
    lat: float | None = None
    lon: float | None = None
    ele: float | None = None


def name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def direct(element: ET.Element, wanted: str) -> str | None:
    return next((child.text for child in element if name(child.tag) == wanted), None)


def nested(element: ET.Element, wanted: tuple[str, ...]) -> str | None:
    for label in wanted:
        for child in element.iter():
            if child is not element and name(child.tag) == label:
                return child.text
    return None


def number(value: str | None, *, zero_valid: bool = True) -> float | None:
    if value is None:
        return None
    try:
        result = float(value.strip())
    except ValueError:
        return None
    return result if math.isfinite(result) and result >= 0 and (zero_valid or result > 0) else None


def timestamp(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        result = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
    except ValueError:
        return None
    return (result if result.tzinfo else result.replace(tzinfo=timezone.utc)).astimezone(timezone.utc)


def parse_point(element: ET.Element, kind: str, segment: int) -> Point | None:
    time = timestamp(direct(element, "time" if kind == "gpx" else "Time"))
    if time is None:
        return None
    if kind == "tcx":
        hr_container = next((c for c in element if name(c.tag) == "HeartRateBpm"), None)
        hr = direct(hr_container, "Value") if hr_container is not None else nested(element, ("hr",))
        cadence_candidates = (("Cadence", direct(element, "Cadence")),
                              ("RunCadence", nested(element, ("RunCadence",))))
    else:
        hr = nested(element, ("hr",))
        cadence_candidates = (("cad", nested(element, ("cad",))),
                              ("RunCadence", nested(element, ("RunCadence",))))
    cadence = None
    source = None
    for label, raw in cadence_candidates:
        cadence = number(raw)
        if cadence is not None:
            source = label
            break
    latitude = None
    longitude = None
    if kind == "gpx":
        try:
            latitude = float(element.get("lat", ""))
            longitude = float(element.get("lon", ""))
        except ValueError:
            pass
    else:
        position = next((c for c in element if name(c.tag) == "Position"), None)
        if position is not None:
            try:
                latitude = float(direct(position, "LatitudeDegrees") or "")
                longitude = float(direct(position, "LongitudeDegrees") or "")
            except ValueError:
                pass
    elevation = direct(element, "ele" if kind == "gpx" else "AltitudeMeters")
    try:
        ele = float(elevation) if elevation is not None else None
    except ValueError:
        ele = None
    return Point(time, segment, number(hr, zero_valid=False),
                 number(nested(element, ("power", "Watts"))), cadence, source,
                 latitude, longitude, ele)


def read_points(data: bytes) -> tuple[list[Point], str, int]:
    if not data or len(data) > MAX_FILE_BYTES:
        raise AnalysisError("Le fichier est vide ou dépasse la limite de 50 Mio.")
    if re.search(rb"<!\s*(?:DOCTYPE|ENTITY)\b", data, re.IGNORECASE):
        raise AnalysisError("Les fichiers XML contenant une DTD ou des entités sont refusés.")

    points: list[Point] = []
    stack: list[str] = []
    kind: str | None = None
    activities = segment = invalid = 0
    try:
        for event, element in ET.iterparse(BytesIO(data), events=("start", "end")):
            label = name(element.tag)
            if event == "start":
                stack.append(label)
                if kind is None:
                    kind = {"gpx": "gpx", "TrainingCenterDatabase": "tcx"}.get(label)
                    if kind is None:
                        raise AnalysisError("Format non reconnu : un fichier GPX ou TCX est attendu.")
                if kind == "tcx" and label == "Activity" and "Activities" in stack:
                    activities += 1
                if (kind == "gpx" and label == "trkseg") or (kind == "tcx" and label == "Track"):
                    segment += 1
            else:
                is_point = (kind == "gpx" and label == "trkpt" and "trk" in stack) or (
                    kind == "tcx" and label == "Trackpoint" and "Activity" in stack)
                if is_point:
                    point = parse_point(element, kind, segment)
                    if point is None:
                        invalid += 1
                    else:
                        points.append(point)
                    element.clear()
                stack.pop()
    except ET.ParseError as exc:
        raise AnalysisError("XML invalide : vérifiez que l'export est complet.") from exc

    if kind == "tcx" and activities != 1:
        raise AnalysisError("Ce TCX contient plusieurs activités : exportez-en une seule." if activities > 1
                            else "Ce TCX ne contient aucune activité exploitable.")
    if not points:
        raise AnalysisError("Aucun point de trace avec un timestamp valide n'a été trouvé.")
    return points, kind, invalid


def analyze(data: bytes, sport: str = "velo", z2_min: int = 136, z3_min: int = 152,
            z4_min: int = 162, z5_min: int = 170, cadence_mode: str = "double") -> dict:
    if sport not in ("velo", "course"):
        raise AnalysisError("Choisissez « vélo » ou « course ».")
    if cadence_mode not in ("double", "direct"):
        raise AnalysisError("Convention de cadence inconnue : choisissez demi-cadence ou pas/min.")
    if not (0 < z2_min < z3_min < z4_min < z5_min <= 300):
        raise AnalysisError("Seuils incohérents : 0 < début Z2 < début Z3 < début Z4 < début Z5 ≤ 300 bpm.")
    points, kind, invalid = read_points(data)
    points.sort(key=lambda point: point.time)
    start, end = points[0].time, points[-1].time
    duration = (end - start).total_seconds()
    totals = {key: 0.0 for key in ("hr", "power", "cadence")}
    coverage = totals.copy()
    cadence_factor = 2 if sport == "course" and cadence_mode == "double" else 1
    running_total = running_coverage = zero_cadence_s = 0.0
    zones = {f"z{i}_s": 0.0 for i in range(1, 6)}
    for first, second in zip(points, points[1:]):
        delta = (second.time - first.time).total_seconds()
        if first.segment != second.segment or not 0 < delta <= MAX_INTERVAL_SECONDS:
            continue
        for key in totals:
            value = getattr(first, key)
            if value is not None:
                if key == "cadence" and sport == "course" and value == 0:
                    zero_cadence_s += delta
                    continue
                display_value = value * cadence_factor if key == "cadence" else value
                totals[key] += display_value * delta
                coverage[key] += delta
                if key == "cadence" and sport == "course" and display_value >= 130:
                    running_total += display_value * delta
                    running_coverage += delta
        if first.hr is not None:
            zone = ("z5_s" if first.hr >= z5_min else
                    "z4_s" if first.hr >= z4_min else
                    "z3_s" if first.hr >= z3_min else
                    "z2_s" if first.hr >= z2_min else "z1_s")
            zones[zone] += delta

    metrics = {}
    for key in totals:
        values = [getattr(point, key) * (cadence_factor if key == "cadence" else 1)
                  for point in points if getattr(point, key) is not None
                  and not (key == "cadence" and sport == "course" and point.cadence == 0)]
        metrics[key] = {
            "average": totals[key] / coverage[key] if coverage[key] else None,
            "maximum": max(values) if values else None,
            "covered_s": coverage[key], "samples": len(values),
        }
    zones["unknown_s"] = max(0.0, duration - coverage["hr"])
    sources = sorted({point.cadence_source for point in points if point.cadence is not None})
    warnings = []
    if invalid:
        warnings.append(f"{invalid} point(s) sans timestamp valide ignoré(s).")
    if duration == 0:
        warnings.append("Un seul instant horodaté : moyennes et temps de zone non calculables.")
    for key, label in (("hr", "FC"), ("power", "puissance"), ("cadence", "cadence")):
        if not metrics[key]["samples"]:
            warnings.append(f"Aucune mesure de {label} disponible.")
        elif not coverage[key] and duration:
            warnings.append(f"Aucun intervalle exploitable pour la moyenne de {label}.")
    if zones["unknown_s"]:
        warnings.append("Le temps sans couverture FC inclut les mesures absentes et les interruptions de plus de 30 s.")
    if sport == "course" and sources:
        warnings.append(
            "Cadence course : " + ("conversion supposée ×2 des cycles/min en pas/min" if cadence_factor == 2
                                    else "valeurs supposées déjà en pas/min")
            + "; convention non inscrite dans ce GPX/TCX. Les zéros sont exclus des moyennes, "
            "mais peuvent représenter une pause ou un défaut de mesure.")
        if running_coverage:
            warnings.append("« Foulée ≥ 130 pas/min » est un repère de cadence, pas une détection certaine de la course ou de la marche.")
    chart = [{"t": (p.time - start).total_seconds(), "segment": p.segment,
              "hr": p.hr, "power": p.power,
              "cadence": (p.cadence * cadence_factor if p.cadence is not None
                          and (sport != "course" or p.cadence > 0) else None)} for p in points]
    return {
        "format": kind.upper(), "sport": sport, "points": len(points),
        "start": start.isoformat(), "end": end.isoformat(), "duration_s": duration,
        "metrics": metrics, "zones": zones,
        "thresholds": {"z2_min": z2_min, "z3_min": z3_min, "z4_min": z4_min, "z5_min": z5_min},
        "cadence_unit": "tr/min" if sport == "velo" else "pas/min (estimés)",
        "cadence_mode": cadence_mode if sport == "course" else None,
        "running_cadence": {"average": running_total / running_coverage if running_coverage else None,
                            "covered_s": running_coverage, "threshold_spm": 130},
        "zero_cadence_s": zero_cadence_s,
        "cadence_sources": sources, "max_interval_s": MAX_INTERVAL_SECONDS,
        "warnings": warnings, "chart": chart,
    }
