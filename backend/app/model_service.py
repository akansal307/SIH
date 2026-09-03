"""
model_service.py

Owns everything the task brief calls "Load the Files" + "Run Predictions":

  - Loads flood_nowcast_model.pkl, flood_nowcast_thresholds.pkl,
    flood_nowcast_feature_cols.pkl, and edge_cache.pkl into memory ONCE at server
    startup (see main.py's lifespan handler) — not per-request.
  - Builds the 33-zone spatial grid straight from edge_cache.pkl at startup (same
    aggregation scripts/build_zones.py uses), so the "spatial cache" the brief refers
    to is live in memory, not just a pre-baked JSON file.
  - Exposes evaluate_snapshot(), which is the exact same real-model logic
    scripts/generate_scenarios.py uses offline, refactored so both live polling and
    the /api/flood/simulate endpoint call the identical code path against the real
    model. Nothing about the model's behaviour is reimplemented or approximated here.

data/source/*.pkl and the GraphML are never modified.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

import joblib
import numpy as np
import pandas as pd

from . import config

logger = logging.getLogger("flood_backend.model_service")


@dataclass
class ModelArtifacts:
    model: Any
    thresholds: dict
    feature_cols: list
    zones: list[dict]          # each: zone_id, name, centroid, geometry, edge_count, static_factors
    zones_source: str          # "edge_cache" or "derived_fallback" — for observability


# --------------------------------------------------------------------------- #
# Loading
# --------------------------------------------------------------------------- #

def _build_zones_from_edge_cache() -> list[dict]:
    """Rebuilds the same 33-zone rectangular grid scripts/build_zones.py produces,
    aggregating REAL per-edge static features (slope, drain_density,
    distance_to_drain_m, distance_to_waterway_m) from edge_cache.pkl. Requires
    geopandas/shapely (declared in backend/requirements.txt)."""
    import geopandas as gpd
    from shapely.geometry import box, mapping

    GRID_COLS, GRID_ROWS, MIN_EDGES_PER_ZONE = 6, 6, 5

    LANDMARKS = [
        ("Andheri Station", 72.846944, 19.119167),
        ("Azad Nagar", 72.831431, 19.129134),
        ("Gundavali / Andheri East", 72.855170, 19.115020),
        ("Western Express Highway Junction", 72.856390, 19.115560),
        ("Marol Naka", 72.877000, 19.119000),
        ("Versova", 72.814000, 19.135000),
        ("D N Nagar", 72.831000, 19.124000),
        ("Sahar", 72.858000, 19.098000),
        ("MIDC", 72.870000, 19.111000),
    ]
    ANDHERI_STATION_LON = 72.846944

    def norm_scalar(v):
        if isinstance(v, list):
            return v[0] if v else None
        return v

    def zone_display_name(cell_edges: pd.DataFrame, centroid_lon: float, centroid_lat: float) -> str:
        named = cell_edges.dropna(subset=["name_norm"]).copy()
        if len(named):
            by_length = named.groupby("name_norm")["length"].sum().sort_values(ascending=False)
            top_name = by_length.index[0]
            if len(by_length) > 1:
                return f"{top_name} x {by_length.index[1]}"
            return f"{top_name} Belt"
        best = min(LANDMARKS, key=lambda lm: (lm[1] - centroid_lon) ** 2 + (lm[2] - centroid_lat) ** 2)
        side = "East" if centroid_lon >= ANDHERI_STATION_LON else "West"
        return f"Near {best[0]} (Andheri {side})"

    logger.info("Loading edge cache: %s", config.EDGE_CACHE_PATH)
    cache = joblib.load(config.EDGE_CACHE_PATH)
    edges = cache["edges"].copy()
    if edges.crs is None:
        edges = edges.set_crs(epsg=4326)
    edges["name_norm"] = edges["name"].apply(norm_scalar)

    minx, miny, maxx, maxy = edges.total_bounds
    xs = np.linspace(minx, maxx, GRID_COLS + 1)
    ys = np.linspace(miny, maxy, GRID_ROWS + 1)

    edges_proj = cache["edges_proj"].copy()
    mids_proj = edges_proj.geometry.interpolate(0.5, normalized=True)
    mids_wgs84 = gpd.GeoSeries(mids_proj, crs=edges_proj.crs).to_crs(epsg=4326)
    edges["mid_lon"] = mids_wgs84.x.values
    edges["mid_lat"] = mids_wgs84.y.values

    zones, zone_num = [], 0
    for i in range(GRID_COLS):
        for j in range(GRID_ROWS):
            x0, x1, y0, y1 = xs[i], xs[i + 1], ys[j], ys[j + 1]
            in_cell = edges[
                (edges["mid_lon"] >= x0) & (edges["mid_lon"] < x1) &
                (edges["mid_lat"] >= y0) & (edges["mid_lat"] < y1)
            ]
            if len(in_cell) < MIN_EDGES_PER_ZONE:
                continue
            zone_num += 1
            centroid_lon, centroid_lat = (x0 + x1) / 2, (y0 + y1) / 2
            zones.append({
                "zone_id": f"AND-{zone_num:02d}",
                "name": zone_display_name(in_cell, centroid_lon, centroid_lat),
                "centroid": [round(centroid_lon, 6), round(centroid_lat, 6)],
                "geometry": mapping(box(x0, y0, x1, y1)),
                "edge_count": int(len(in_cell)),
                "static_factors": {
                    "slope": float(in_cell["slope"].mean()),
                    "distance_to_waterway_m": float(in_cell["distance_to_waterway_m"].min()),
                    "drain_density": float(in_cell["drain_density"].mean()),
                    "distance_to_drain_m": float(in_cell["distance_to_drain_m"].min()),
                },
            })

    seen: dict[str, int] = {}
    for z in zones:
        seen[z["name"]] = seen.get(z["name"], 0) + 1
        if seen[z["name"]] > 1:
            z["name"] = f"{z['name']} ({seen[z['name']]})"

    logger.info("Built %d zones from edge_cache.pkl", len(zones))
    return zones


def load_artifacts() -> ModelArtifacts:
    """Loads model.pkl, thresholds.pkl, feature_cols.pkl, and the zone spatial cache
    into memory. Call once at server startup and keep the result on app.state — never
    reload per-request."""
    logger.info("Loading model: %s", config.MODEL_PATH)
    model = joblib.load(config.MODEL_PATH)
    thresholds = joblib.load(config.THRESHOLDS_PATH)
    feature_cols = joblib.load(config.FEATURE_COLS_PATH)
    assert list(model.classes_) == [0, 1, 2], f"Unexpected model.classes_: {model.classes_}"

    try:
        zones = _build_zones_from_edge_cache()
        zones_source = "edge_cache"
    except Exception:
        logger.exception(
            "Could not rebuild zones from edge_cache.pkl (missing geopandas/shapely?) "
            "— falling back to the checked-in data/derived/zones_base.json, which was "
            "itself built from the same edge_cache.pkl offline."
        )
        with open(config.ZONES_BASE_FALLBACK_PATH) as f:
            zones = json.load(f)["zones"]
        zones_source = "derived_fallback"

    return ModelArtifacts(
        model=model, thresholds=thresholds, feature_cols=feature_cols,
        zones=zones, zones_source=zones_source,
    )


# --------------------------------------------------------------------------- #
# Prediction (ported 1:1 from scripts/generate_scenarios.py so live + simulate
# endpoints run the exact same real-model logic as the offline pipeline)
# --------------------------------------------------------------------------- #

def rain_features_at(elapsed_min: float, rainfall_mm_hr: float, duration_min: float):
    if elapsed_min <= duration_min:
        total = rainfall_mm_hr * (elapsed_min / 60.0)
        hourly = rainfall_mm_hr
    else:
        total = rainfall_mm_hr * (duration_min / 60.0)
        decay = max(0.0, 1.0 - (elapsed_min - duration_min) / 60.0)
        hourly = rainfall_mm_hr * decay
    return round(total, 2), round(hourly, 2), round(total, 2)


def apply_blockage(zone_static: dict, blockage_percent: float) -> dict:
    if blockage_percent <= 0:
        return dict(zone_static)
    factor = blockage_percent / 100.0
    out = dict(zone_static)
    out["drain_density"] = zone_static["drain_density"] * (1 - 0.7 * factor)
    out["distance_to_drain_m"] = zone_static["distance_to_drain_m"] * (1 + 0.8 * factor)
    return out


def depth_and_onset(risk_class: int, prob_by_class: np.ndarray, thresholds: dict, zone_static: dict):
    yellow, red = thresholds["yellow_threshold"], thresholds["red_threshold"]
    p_low, p_mod, p_high = prob_by_class
    drainage_stress = float(np.clip(zone_static["distance_to_drain_m"] / 500.0, 0.0, 1.0))

    if risk_class == 0:
        return 0.0, None
    if risk_class == 1:
        span = max(1e-6, red - yellow)
        t = float(np.clip((p_mod + p_high - yellow) / span, 0.0, 1.0))
        depth = 5 + 10 * t + 3 * drainage_stress
        onset = 45 - 20 * t - 10 * drainage_stress
    else:
        t = float(np.clip((p_high - red) / max(1e-6, 1 - red), 0.0, 1.0))
        depth = 15 + 25 * t + 5 * drainage_stress
        onset = 20 - 12 * t - 6 * drainage_stress
    return round(float(depth), 1), max(3, round(float(onset)))


def build_alert_message(zone_name: str, risk: str, depth_cm: float, onset_minutes):
    if risk == "HIGH":
        onset_txt = f"Onset in ~{onset_minutes} min" if onset_minutes is not None else "Onset imminent"
        return f"HIGH FLOOD RISK — {zone_name}. Predicted depth {depth_cm:.0f} cm. {onset_txt}."
    if risk == "MODERATE":
        onset_txt = f"~{onset_minutes} min" if onset_minutes is not None else "shortly"
        return f"Rising water risk on {zone_name}. Predicted depth {depth_cm:.0f} cm, onset {onset_txt}."
    return f"{zone_name} clear."


def build_state_snapshot(
    artifacts: ModelArtifacts, *, offset_min: int, rain_total_mm: float, rain_hourly_mm: float,
    rain_peak_3hr_mm: float, blockage_percent: float, max_tide_height_m: float,
    num_high_tides: int, base_time: datetime,
) -> dict:
    """The real prediction path, taking the model's three dynamic rain features
    directly. Used by BOTH callers:
      - the live poller (weather_service.py gives real Open-Meteo-derived values), and
      - evaluate_snapshot() below (scenario-based /api/flood/simulate input, which
        derives these three features from a synthetic rainfall_mm_hr/duration_min
        via rain_features_at(), same as scripts/generate_scenarios.py).
    Returns a FloodStateWire dict, matching README's API Contract exactly."""
    rain_total, rain_hourly, rain_peak3 = rain_total_mm, rain_hourly_mm, rain_peak_3hr_mm

    rows, zones_static_eff = [], []
    for z in artifacts.zones:
        static_eff = apply_blockage(z["static_factors"], blockage_percent)
        zones_static_eff.append(static_eff)
        rows.append({
            "slope": static_eff["slope"],
            "distance_to_waterway_m": static_eff["distance_to_waterway_m"],
            "drain_density": static_eff["drain_density"],
            "distance_to_drain_m": static_eff["distance_to_drain_m"],
            "rain_total_mm": rain_total,
            "rain_max_hourly_mm": rain_hourly,
            "rain_peak_3hr_mm": rain_peak3,
            "max_tide_height_m": max_tide_height_m,
            "num_high_tides": num_high_tides,
        })

    X = pd.DataFrame(rows, columns=artifacts.feature_cols)
    proba = artifacts.model.predict_proba(X)  # (n_zones, 3), columns follow classes_ = [0,1,2]
    pred_class = proba.argmax(axis=1)

    zone_features, alerts = [], []
    max_depth, onset_candidates = 0.0, []
    risk_rank = {"LOW": 0, "MODERATE": 1, "HIGH": 2}
    overall_risk, affected = "LOW", 0

    for z, static_eff, p, c in zip(artifacts.zones, zones_static_eff, proba, pred_class):
        risk = config.CLASS_TO_RISK[int(c)]
        depth_cm, onset_minutes = depth_and_onset(int(c), p, artifacts.thresholds, static_eff)
        flood_probability = round(float(p[1] + p[2]), 4)

        if risk_rank[risk] > risk_rank[overall_risk]:
            overall_risk = risk
        if risk != "LOW":
            affected += 1
        max_depth = max(max_depth, depth_cm)
        if onset_minutes is not None:
            onset_candidates.append(onset_minutes)

        zone_features.append({
            "type": "Feature",
            "properties": {
                "zone_id": z["zone_id"],
                "zone_name": z["name"],
                "risk": risk,
                "probability": flood_probability,
                "class_probabilities": {
                    "low": round(float(p[0]), 4), "moderate": round(float(p[1]), 4), "high": round(float(p[2]), 4),
                },
                "depth_cm": depth_cm,
                "onset_minutes": onset_minutes,
                "factors": {
                    "slope": round(static_eff["slope"], 4),
                    "distance_to_waterway_m": round(static_eff["distance_to_waterway_m"], 1),
                    "drain_density": round(static_eff["drain_density"], 3),
                    "distance_to_drain_m": round(static_eff["distance_to_drain_m"], 1),
                    "rain_total_mm": rain_total, "rain_max_hourly_mm": rain_hourly, "rain_peak_3hr_mm": rain_peak3,
                    "max_tide_height_m": max_tide_height_m, "num_high_tides": num_high_tides,
                },
                "edge_count": z["edge_count"],
            },
            "geometry": z["geometry"],
        })

        if risk != "LOW":
            alerts.append({
                "id": f"alert-{z['zone_id']}-{offset_min}",
                "zone_id": z["zone_id"], "zone_name": z["name"], "severity": risk,
                "depth_cm": depth_cm, "onset_minutes": onset_minutes,
                "message": build_alert_message(z["name"], risk, depth_cm, onset_minutes),
                "issued_at": (base_time + timedelta(minutes=offset_min)).isoformat(),
            })

    alerts.sort(key=lambda a: (-risk_rank[a["severity"]], a["onset_minutes"] if a["onset_minutes"] is not None else 9999))
    snapshot_time = base_time + timedelta(minutes=offset_min)

    return {
        "timestamp": snapshot_time.isoformat(),
        "offset_minutes": offset_min,
        "label": "NOW" if offset_min == 0 else f"+{offset_min} MIN",
        "rainfall_mm_hr": rain_hourly,
        "overall_risk": overall_risk,
        "max_depth_cm": round(max_depth, 1),
        "affected_zones": affected,
        "earliest_onset_minutes": min(onset_candidates) if onset_candidates else None,
        "zones": {"type": "FeatureCollection", "features": zone_features},
        "alerts": alerts,
    }


def evaluate_snapshot(
    artifacts: ModelArtifacts, *, offset_min: int, rainfall_mm_hr: float, duration_min: float,
    elapsed_at_now_min: float, blockage_percent: float, max_tide_height_m: float,
    num_high_tides: int, base_time: datetime,
) -> dict:
    """Scenario-based entry point (used by /api/flood/simulate and by the offline
    scripts/generate_scenarios.py-equivalent logic): turns a synthetic
    (rainfall_mm_hr, duration_min) into the model's dynamic rain features via
    rain_features_at(), then delegates to build_state_snapshot() for the real
    prediction."""
    elapsed = elapsed_at_now_min + offset_min
    rain_total, rain_hourly, rain_peak3 = rain_features_at(elapsed, rainfall_mm_hr, duration_min)
    return build_state_snapshot(
        artifacts, offset_min=offset_min, rain_total_mm=rain_total, rain_hourly_mm=rain_hourly,
        rain_peak_3hr_mm=rain_peak3, blockage_percent=blockage_percent,
        max_tide_height_m=max_tide_height_m, num_high_tides=num_high_tides, base_time=base_time,
    )


def build_scenario_series(artifacts: ModelArtifacts, *, rainfall_mm_hr, duration_min,
                           elapsed_at_now_min, blockage_percent, max_tide_height_m,
                           num_high_tides, base_time):
    """Scenario-based series (for /api/flood/simulate)."""
    forecast = [
        evaluate_snapshot(
            artifacts, offset_min=off, rainfall_mm_hr=rainfall_mm_hr, duration_min=duration_min,
            elapsed_at_now_min=elapsed_at_now_min, blockage_percent=blockage_percent,
            max_tide_height_m=max_tide_height_m, num_high_tides=num_high_tides, base_time=base_time,
        )
        for off in config.FORECAST_OFFSETS_MIN
    ]
    return forecast[0], forecast


def build_live_series(artifacts: ModelArtifacts, *, live, base_time):
    """Live-weather-based series (for /api/flood/current and /api/flood/forecast).
    `live` is a weather_service.LiveConditions — real Open-Meteo-derived rain features
    per forecast offset, not a synthetic scenario."""
    forecast = [
        build_state_snapshot(
            artifacts, offset_min=off,
            rain_total_mm=live.forecast_by_offset[off]["rain_total_mm"],
            rain_hourly_mm=live.forecast_by_offset[off]["rain_max_hourly_mm"],
            rain_peak_3hr_mm=live.forecast_by_offset[off]["rain_peak_3hr_mm"],
            blockage_percent=0, max_tide_height_m=live.max_tide_height_m,
            num_high_tides=live.num_high_tides, base_time=base_time,
        )
        for off in config.FORECAST_OFFSETS_MIN
    ]
    return forecast[0], forecast
