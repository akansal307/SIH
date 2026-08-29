"""
generate_scenarios.py

This is the heart of the frontend's "mock/dev data" layer — and it is NOT hand-authored
fake data. It runs the REAL flood_nowcast_model.pkl (LightGBM) against the REAL,
precomputed geographic features of all 33 Andheri zones (from zones_base.json, itself
built from edge_cache.pkl) for a handful of rainfall scenarios. The only thing that is
synthetic is the rainfall/tide input for each scenario — everything downstream (which
zones the model calls HIGH risk, their probabilities, etc.) is the actual model's output.

Why this exists at all: the real backend described in the frontend brief (rainfall
nowcast ingestion, live tide data, a hosted inference API) does not exist yet. Until it
does, the frontend needs *something* to render, and "the real model's real output for a
plausible input" is a far more honest placeholder than hand-picked polygon colors — and
it means the map/alerts/zone-detail UI is already wired to the exact response shape the
real backend will need to produce.

WHAT IS AND ISN'T "REAL" HERE (please read before treating this as ground truth):
  REAL:
    - The model (flood_nowcast_model.pkl), unmodified.
    - The 4 static features per zone: slope, drain_density, distance_to_drain_m,
      distance_to_waterway_m (aggregated from edge_cache.pkl's real per-edge values).
    - The thresholds (flood_nowcast_thresholds.pkl): yellow=0.35, red=0.55.
  ASSUMED / HEURISTIC (all flagged again inline, and in the generated JSON's
  "model_info.assumptions" block, and in README.md):
    - The rainfall/tide numbers for each scenario (nobody has told us what "Extreme
      Cloudburst" should mean in mm/hr — we used the frontend brief's own example:
      120 mm/hr for 60 min).
    - The class -> LOW/MODERATE/HIGH mapping. classes_ is [0, 1, 2] with no label
      metadata in the pickle and no training code was provided. We inferred 0=LOW,
      1=MODERATE, 2=HIGH empirically (see scripts/verify_class_mapping.py) from the
      fact that class 0's probability dominates at low rainfall and falls as rainfall
      rises, and from the class_weight the model was trained with ({0: 1.0, 1: 1.2,
      2: 1.5} — weight increases with class index, as you'd expect for a rarer/more
      severe class). This needs a one-line confirmation from whoever trained the
      model or wrote the label encoder.
    - depth_cm and onset_minutes are NOT outputs of the classifier (it only predicts a
      risk class). We derive both with a simple, documented formula from the model's
      own class probabilities and the zone's real drainage proximity. The real system
      should replace this with an actual hydraulic/hydrologic depth model.
    - The "drain blockage %" input for the Cloudburst + Drain Blockage preset is not a
      model feature. We approximate a blockage by degrading the zone's *effective*
      drain_density and distance_to_drain_m for that scenario only — a small
      compatibility adapter, not a change to the model itself.

Output: public/data/scenarios.json (the frontend's mock backend responses, in the same
snake_case wire shape a real backend would use — see README.md "API Contract").

PRESET CALIBRATION NOTE (read this if you change the rainfall numbers below):
Sweeping the real model against the real 33 zones shows a near-binary decision cliff at
~76.7mm accumulated rainfall (31 LOW/2 MODERATE just below it, 7 MODERATE/26 HIGH just
above it — nothing in between). We tested whether the blockage_percent adapter could
shift that cliff (0%, 30%, 50%, 70%, 90%, at rainfall from 40mm to 76.9mm) and it does
not move it in either direction for these zones' real feature ranges — rainfall
dominates the model's decision by a wide margin (its LightGBM split gain is roughly an
order of magnitude higher than drain_density's). Per the frontend brief: we do NOT
force a bigger blockage effect than the model actually has. Instead:
  - "Drainage Stress Test" uses moderate, still-falling rain that is calm at NOW and
    crosses the real ~76.7mm cliff around +60 min — an honest demonstration of the
    model's real decision boundary AND of genuine 0-3h lead-time nowcasting value.
  - "Cloudburst + Drain Blockage" uses the brief's own example numbers (120 mm/hr,
    60 min, 50% blockage). At that rainfall the classification is already saturated
    (identical to plain Extreme Cloudburst) — blockage's only measurable effect here is
    a small worsening of the depth/onset heuristic. We say so explicitly in the output
    (see `model_notes` on that preset) rather than hiding it.
"""

import json
import os
from datetime import datetime, timedelta, timezone

import joblib
import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

ZONES_BASE_PATH = os.path.join(ROOT, "data", "derived", "zones_base.json")
MODEL_PATH = os.path.join(ROOT, "data", "source", "flood_nowcast_model.pkl")
THRESHOLDS_PATH = os.path.join(ROOT, "data", "source", "flood_nowcast_thresholds.pkl")
FEATURE_COLS_PATH = os.path.join(ROOT, "data", "source", "flood_nowcast_feature_cols.pkl")
OUTPUT_PATH = os.path.join(ROOT, "public", "data", "scenarios.json")

FORECAST_OFFSETS_MIN = [0, 30, 60, 120, 180]

# Empirically-inferred class -> risk label mapping. See module docstring above and
# scripts/verify_class_mapping.py. TODO(model team): confirm against training code.
CLASS_TO_RISK = {0: "LOW", 1: "MODERATE", 2: "HIGH"}

# Real, measured decision boundary (see calibration note above). Used only to annotate
# output for the UI/README — the model itself is what actually gets evaluated.
MEASURED_CLIFF_MM = 76.7

# Each entry: (rainfall_mm_hr, duration_min, elapsed_at_now_min, blockage_percent,
# max_tide_height_m, num_high_tides). `elapsed_at_now_min` is how far into the storm's
# `duration_min` we are at the moment the dashboard shows "NOW" — it is what lets each
# scenario tell a different, deliberate story (see calibration note above):
#   - elapsed_at_now == duration_min : storm has just finished -> NOW shows the peak,
#     forecast shows recession. Used for Normal/Heavy/Cloudburst presets.
#   - elapsed_at_now < duration_min  : storm is still actively falling at NOW and
#     continues into the forecast -> used for Drainage Stress Test, so the map is calm
#     "now" and visibly crosses the model's real decision boundary partway through the
#     0-3h forecast, the way a genuine nowcast lead-time warning would.

# Ambient baseline used for LIVE mode's default snapshot. Andheri is in its monsoon
# season on the date this was generated (partly cloudy, chance of showers, no active
# heavy rain reported) — i.e. a quiet day, which is exactly the scenario the frontend
# brief's Simulation Mode exists to cover for demo day.
LIVE_BASELINE = dict(rainfall_mm_hr=3.0, duration_min=45, elapsed_at_now_min=45,
                      blockage_percent=0, max_tide_height_m=1.1, num_high_tides=0)

SIMULATION_PRESETS = [
    dict(id="normal_rain", label="Normal Rain",
         description="Typical monsoon drizzle. Most streets stay clear.",
         rainfall_mm_hr=15, duration_min=60, elapsed_at_now_min=60, blockage_percent=0,
         max_tide_height_m=1.2, num_high_tides=0),
    dict(id="heavy_rain", label="Heavy Rain",
         description="Sustained heavy showers across Andheri.",
         rainfall_mm_hr=50, duration_min=60, elapsed_at_now_min=60, blockage_percent=0,
         max_tide_height_m=1.4, num_high_tides=1),
    dict(id="drainage_stress_test", label="Drainage Stress Test",
         description=f"Moderate, sustained rain that keeps falling. Calm right now — "
                      f"watch the +60 min forecast step, where accumulated rainfall "
                      f"crosses the model's real decision boundary (~{MEASURED_CLIFF_MM:.0f}mm).",
         rainfall_mm_hr=45, duration_min=120, elapsed_at_now_min=45, blockage_percent=0,
         max_tide_height_m=1.5, num_high_tides=1),
    dict(id="extreme_cloudburst", label="Extreme Cloudburst",
         description="A cloudburst-intensity downpour, the kind that has shut down Andheri Subway before.",
         rainfall_mm_hr=120, duration_min=60, elapsed_at_now_min=60, blockage_percent=0,
         max_tide_height_m=1.8, num_high_tides=1),
    dict(id="cloudburst_drain_blockage", label="Cloudburst + Drain Blockage",
         description="Extreme cloudburst compounded by silted / blocked storm drains.",
         rainfall_mm_hr=120, duration_min=60, elapsed_at_now_min=60, blockage_percent=50,
         max_tide_height_m=1.8, num_high_tides=2),
]


def rain_features_at(elapsed_min: float, rainfall_mm_hr: float, duration_min: float):
    """
    Very simple, documented rain-accumulation/recession model used ONLY to turn a
    scenario's (rainfall_mm_hr, duration_min) into the model's three dynamic rain
    features at an arbitrary point in time. This is NOT a nowcast — the real system
    should replace this with actual radar-extrapolation / NWP nowcast output.

      - While elapsed <= duration: rain is actively falling at a constant intensity.
          rain_total_mm grows linearly; rain_max_hourly_mm stays at the peak intensity.
      - After elapsed > duration: rain has stopped. Total accumulation is fixed at the
          storm's final total; the *current* hourly intensity decays linearly to 0 over
          the following 60 minutes (runoff easing), which lets predicted risk recede in
          later forecast steps instead of staying stuck at its peak forever.
      - rain_peak_3hr_mm: since every preset here fits inside a 3-hour window, the peak
          3-hour accumulation simply equals the running/final total.
    """
    if elapsed_min <= duration_min:
        total = rainfall_mm_hr * (elapsed_min / 60.0)
        hourly = rainfall_mm_hr
    else:
        total = rainfall_mm_hr * (duration_min / 60.0)
        decay = max(0.0, 1.0 - (elapsed_min - duration_min) / 60.0)
        hourly = rainfall_mm_hr * decay
    peak_3hr = total
    return round(total, 2), round(hourly, 2), round(peak_3hr, 2)


def apply_blockage(zone_static: dict, blockage_percent: float) -> dict:
    """Compatibility adapter: 'drain blockage %' is not a trained model feature. We
    approximate its effect by degrading the zone's effective drainage capacity — more
    blockage reads as if the zone were farther from a working drain, and as if the
    surrounding drain network were sparser. See module docstring."""
    if blockage_percent <= 0:
        return dict(zone_static)
    factor = blockage_percent / 100.0
    out = dict(zone_static)
    out["drain_density"] = zone_static["drain_density"] * (1 - 0.7 * factor)
    out["distance_to_drain_m"] = zone_static["distance_to_drain_m"] * (1 + 0.8 * factor)
    return out


def depth_and_onset(risk_class: int, prob_by_class: np.ndarray, thresholds: dict, zone_static: dict):
    """
    Placeholder depth/onset model. The classifier only outputs a risk class + class
    probabilities — it does not predict standing-water depth or a time-to-onset. Both
    numbers below are a simple, documented function of (a) how far the model's
    probability sits past the relevant threshold, and (b) the zone's real drainage
    proximity (farther from a drain / lower drain density -> slower to clear -> a bit
    deeper, a bit faster onset). Replace with a real hydraulic/hydrologic model.
    """
    yellow, red = thresholds["yellow_threshold"], thresholds["red_threshold"]
    p_low, p_mod, p_high = prob_by_class

    # farther from the nearest drain (capped ~500m) => slower to clear => deeper water
    drainage_stress = np.clip(zone_static["distance_to_drain_m"] / 500.0, 0.0, 1.0)

    if risk_class == 0:
        return 0.0, None
    if risk_class == 1:
        span = max(1e-6, red - yellow)
        t = np.clip((p_mod + p_high - yellow) / span, 0.0, 1.0)
        depth = 5 + 10 * t + 3 * drainage_stress
        onset = 45 - 20 * t - 10 * drainage_stress
    else:
        t = np.clip((p_high - red) / max(1e-6, 1 - red), 0.0, 1.0)
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


def evaluate_snapshot(zones, model, feature_cols, thresholds, offset_min, rainfall_mm_hr,
                       duration_min, elapsed_at_now_min, blockage_percent, max_tide_height_m,
                       num_high_tides, base_time):
    elapsed = elapsed_at_now_min + offset_min
    rain_total, rain_hourly, rain_peak3 = rain_features_at(elapsed, rainfall_mm_hr, duration_min)

    rows = []
    zones_static_eff = []
    for z in zones:
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

    X = pd.DataFrame(rows, columns=feature_cols)
    proba = model.predict_proba(X)  # shape (n_zones, 3), columns follow model.classes_ = [0,1,2]
    pred_class = proba.argmax(axis=1)

    zone_features = []
    alerts = []
    max_depth = 0.0
    onset_candidates = []
    risk_rank = {"LOW": 0, "MODERATE": 1, "HIGH": 2}
    overall_risk = "LOW"
    affected = 0

    for z, static_eff, p, c in zip(zones, zones_static_eff, proba, pred_class):
        risk = CLASS_TO_RISK[int(c)]
        depth_cm, onset_minutes = depth_and_onset(int(c), p, thresholds, static_eff)
        flood_probability = round(float(p[1] + p[2]), 4)  # P(class >= MODERATE)

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
                    "low": round(float(p[0]), 4),
                    "moderate": round(float(p[1]), 4),
                    "high": round(float(p[2]), 4),
                },
                "depth_cm": depth_cm,
                "onset_minutes": onset_minutes,
                "factors": {
                    "slope": round(static_eff["slope"], 4),
                    "distance_to_waterway_m": round(static_eff["distance_to_waterway_m"], 1),
                    "drain_density": round(static_eff["drain_density"], 3),
                    "distance_to_drain_m": round(static_eff["distance_to_drain_m"], 1),
                    "rain_total_mm": rain_total,
                    "rain_max_hourly_mm": rain_hourly,
                    "rain_peak_3hr_mm": rain_peak3,
                    "max_tide_height_m": max_tide_height_m,
                    "num_high_tides": num_high_tides,
                },
                "edge_count": z["edge_count"],
            },
            "geometry": z["geometry"],
        })

        if risk != "LOW":
            alerts.append({
                "id": f"alert-{z['zone_id']}-{offset_min}",
                "zone_id": z["zone_id"],
                "zone_name": z["name"],
                "severity": risk,
                "depth_cm": depth_cm,
                "onset_minutes": onset_minutes,
                "message": build_alert_message(z["name"], risk, depth_cm, onset_minutes),
                "issued_at": (base_time + timedelta(minutes=offset_min)).isoformat(),
            })

    alerts.sort(key=lambda a: (-risk_rank[a["severity"]], a["onset_minutes"] if a["onset_minutes"] is not None else 9999))

    snapshot_time = base_time + timedelta(minutes=offset_min)
    label = "NOW" if offset_min == 0 else f"+{offset_min} MIN"

    state = {
        "timestamp": snapshot_time.isoformat(),
        "offset_minutes": offset_min,
        "label": label,
        "rainfall_mm_hr": rain_hourly,
        "overall_risk": overall_risk,
        "max_depth_cm": round(max_depth, 1),
        "affected_zones": affected,
        "earliest_onset_minutes": min(onset_candidates) if onset_candidates else None,
        "zones": {"type": "FeatureCollection", "features": zone_features},
        "alerts": alerts,
    }
    return state


def build_scenario_series(zones, model, feature_cols, thresholds, rainfall_mm_hr, duration_min,
                           elapsed_at_now_min, blockage_percent, max_tide_height_m, num_high_tides,
                           base_time):
    forecast = [
        evaluate_snapshot(zones, model, feature_cols, thresholds, off, rainfall_mm_hr, duration_min,
                           elapsed_at_now_min, blockage_percent, max_tide_height_m, num_high_tides, base_time)
        for off in FORECAST_OFFSETS_MIN
    ]
    current = forecast[0]
    return current, forecast


def zone_risk_signature(state):
    """A comparable fingerprint of which zones are at which risk, used to honestly
    detect whether an input (like blockage_percent) actually changed anything."""
    return tuple(sorted(
        (f["properties"]["zone_id"], f["properties"]["risk"])
        for f in state["zones"]["features"]
    ))


def main():
    print("Loading model + thresholds + feature columns (unmodified originals)...")
    model = joblib.load(MODEL_PATH)
    thresholds = joblib.load(THRESHOLDS_PATH)
    feature_cols = joblib.load(FEATURE_COLS_PATH)
    assert list(model.classes_) == [0, 1, 2], f"Unexpected classes_: {model.classes_}"

    with open(ZONES_BASE_PATH) as f:
        zones = json.load(f)["zones"]
    print(f"Loaded {len(zones)} zones.")

    base_time = datetime.now(timezone.utc).replace(microsecond=0)

    print("Running live baseline...")
    live_current, live_forecast = build_scenario_series(
        zones, model, feature_cols, thresholds, base_time=base_time, **LIVE_BASELINE
    )

    presets_out = []
    for preset in SIMULATION_PRESETS:
        print(f"Running simulation preset: {preset['label']} "
              f"({preset['rainfall_mm_hr']} mm/hr, {preset['duration_min']} min, "
              f"{preset['blockage_percent']}% blockage)...")
        current, forecast = build_scenario_series(
            zones, model, feature_cols, thresholds,
            rainfall_mm_hr=preset["rainfall_mm_hr"],
            duration_min=preset["duration_min"],
            elapsed_at_now_min=preset["elapsed_at_now_min"],
            blockage_percent=preset["blockage_percent"],
            max_tide_height_m=preset["max_tide_height_m"],
            num_high_tides=preset["num_high_tides"],
            base_time=base_time,
        )

        model_notes = []
        if preset["blockage_percent"] > 0:
            # Honest self-check: does blockage actually change anything vs. the same
            # rainfall with no blockage? See calibration note at top of file.
            no_blockage_current, _ = build_scenario_series(
                zones, model, feature_cols, thresholds,
                rainfall_mm_hr=preset["rainfall_mm_hr"], duration_min=preset["duration_min"],
                elapsed_at_now_min=preset["elapsed_at_now_min"], blockage_percent=0,
                max_tide_height_m=preset["max_tide_height_m"], num_high_tides=preset["num_high_tides"],
                base_time=base_time,
            )
            if zone_risk_signature(current) == zone_risk_signature(no_blockage_current):
                depth_delta = current["max_depth_cm"] - no_blockage_current["max_depth_cm"]
                model_notes.append(
                    f"At {preset['rainfall_mm_hr']} mm/hr, rainfall alone already saturates the model's "
                    f"decision boundary (~{MEASURED_CLIFF_MM:.0f}mm accumulated) — simulated "
                    f"{preset['blockage_percent']}% drain blockage did not change any zone's risk "
                    f"classification versus the same rainfall with no blockage. Its only measured effect "
                    f"here is a +{depth_delta:.1f}cm shift in the (heuristic, non-model) depth estimate. "
                    f"We surface this rather than overstate blockage's effect — see README 'Model Behaviour "
                    f"Notes'."
                )

        presets_out.append({
            "id": preset["id"],
            "label": preset["label"],
            "description": preset["description"],
            "rainfall_mm_hr": preset["rainfall_mm_hr"],
            "duration_min": preset["duration_min"],
            "blockage_percent": preset["blockage_percent"],
            "max_tide_height_m": preset["max_tide_height_m"],
            "num_high_tides": preset["num_high_tides"],
            "current": current,
            "forecast": forecast,
            "model_notes": model_notes,
        })
        print(f"    overall_risk={current['overall_risk']}  affected_zones={current['affected_zones']}  "
              f"max_depth_cm={current['max_depth_cm']}")
        for n in model_notes:
            print(f"    NOTE: {n}")

    zones_meta = [
        {"zone_id": z["zone_id"], "name": z["name"], "centroid": z["centroid"]}
        for z in zones
    ]

    output = {
        "generated_at": base_time.isoformat(),
        "model_info": {
            "model_type": "LGBMClassifier (LightGBM), 3-class",
            "feature_columns": feature_cols,
            "thresholds": thresholds,
            "class_to_risk_mapping": CLASS_TO_RISK,
            "class_mapping_confidence": "empirically inferred, not confirmed by training code — see scripts/verify_class_mapping.py",
            "measured_rainfall_decision_boundary_mm": MEASURED_CLIFF_MM,
            "measured_boundary_note": (
                "The model's classification is a near-binary step at ~76.7mm accumulated rainfall across "
                "the real 33 Andheri zones (31 LOW/2 MODERATE just below, 7 MODERATE/26 HIGH just above), "
                "not a smooth gradient. We tested blockage_percent (0-90%) at rainfall from 40mm to 76.9mm "
                "and it does not shift this boundary for these zones' real feature ranges. This is a "
                "property of the trained model, not a frontend limitation."
            ),
            "assumptions": [
                "Rainfall/tide values per simulation preset are illustrative, chosen from the frontend brief's own examples and IMD-informed monsoon intensities — not measured data.",
                "depth_cm and onset_minutes are derived with a documented placeholder formula (scripts/generate_scenarios.py:depth_and_onset), not model outputs.",
                "'Drain blockage %' is a frontend/demo concept only; it is applied as a compatibility adapter that degrades effective drain_density / distance_to_drain_m, not a trained model feature.",
                "'probability' on each zone is P(risk >= MODERATE) = 1 - P(class=LOW), not the confidence of the predicted class.",
            ],
        },
        "live_default": {"current": live_current, "forecast": live_forecast},
        "simulation_presets": presets_out,
        "zones_meta": zones_meta,
    }

    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    with open(OUTPUT_PATH, "w") as f:
        json.dump(output, f)

    size_mb = os.path.getsize(OUTPUT_PATH) / (1024 * 1024)
    print(f"\nWrote {OUTPUT_PATH} ({size_mb:.2f} MB)")
    print(f"Live baseline: overall_risk={live_current['overall_risk']}, affected_zones={live_current['affected_zones']}")


if __name__ == "__main__":
    main()
