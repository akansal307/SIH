"""
verify_class_mapping.py

flood_nowcast_model.pkl is a 3-class LGBMClassifier with classes_ = [0, 1, 2] and no
label metadata anywhere in the pickle — nothing tells you which integer means LOW,
MODERATE, or HIGH. No training code was provided alongside the model. This script is
the empirical check we ran to infer the mapping (used throughout generate_scenarios.py
as CLASS_TO_RISK), so the actual model team can rerun it in 30 seconds and confirm
(or correct) it against their own training code / label encoder.

Method: run the real model over the real 33 Andheri zones (data/derived/zones_base.json)
while sweeping accumulated rainfall from 0mm to 150mm, holding other dynamic features
at plausible mid-monsoon values. Two independent signals both point the same direction:

  1. class_weight the model was trained with: {0: 1.0, 1: 1.2, 2: 1.5}. Weight rises
     with class index — expected when class 0 is the common case (no flooding), and
     classes 1/2 are progressively rarer, more severe events upweighted to compensate
     for class imbalance.
  2. Class-probability response to rainfall: class 0's probability should dominate at
     low rainfall and fall as rainfall rises; classes 1 and 2 should rise together.

If both signals agree with CLASS_TO_RISK = {0: "LOW", 1: "MODERATE", 2: "HIGH"} printed
below, the mapping used throughout this codebase is corroborated. This is still an
inference, not a certainty — please confirm against the actual training script/label
encoder if you have access to it.

Usage:
    python scripts/verify_class_mapping.py
"""

import os
import joblib
import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
MODEL_PATH = os.path.join(ROOT, "data", "source", "flood_nowcast_model.pkl")
FEATURE_COLS_PATH = os.path.join(ROOT, "data", "source", "flood_nowcast_feature_cols.pkl")
ZONES_BASE_PATH = os.path.join(ROOT, "data", "derived", "zones_base.json")

ASSUMED_MAPPING = {0: "LOW", 1: "MODERATE", 2: "HIGH"}


def main():
    model = joblib.load(MODEL_PATH)
    feature_cols = joblib.load(FEATURE_COLS_PATH)

    print("=" * 70)
    print("SIGNAL 1: class_weight the model was trained with")
    print("=" * 70)
    params = model.get_params()
    class_weight = params.get("class_weight")
    print(f"classes_    = {list(model.classes_)}")
    print(f"class_weight = {class_weight}")
    if class_weight and isinstance(class_weight, dict):
        weights_ascending = list(class_weight.values()) == sorted(class_weight.values())
        print(f"Weight increases monotonically with class index: {weights_ascending}")
        print("  -> consistent with class index = severity/rarity rank (0=common/LOW ... 2=rare/HIGH)"
              if weights_ascending else
              "  -> INCONSISTENT with a simple ascending-severity mapping. Investigate further.")
    else:
        print("  (no class_weight recorded on the estimator — signal unavailable)")

    print()
    print("=" * 70)
    print("SIGNAL 2: class-probability response to rainfall, real zones")
    print("=" * 70)

    import json
    with open(ZONES_BASE_PATH) as f:
        zones = json.load(f)["zones"]

    print(f"{'rain_total_mm':>14} | {'mean P(class=0)':>16} | {'mean P(class=1)':>16} | {'mean P(class=2)':>16}")
    print("-" * 70)
    means_by_rain = []
    for rain_total in [0, 15, 30, 45, 60, 76, 90, 120, 150]:
        rows = []
        for z in zones:
            s = z["static_factors"]
            rows.append({
                "slope": s["slope"],
                "distance_to_waterway_m": s["distance_to_waterway_m"],
                "drain_density": s["drain_density"],
                "distance_to_drain_m": s["distance_to_drain_m"],
                "rain_total_mm": rain_total,
                "rain_max_hourly_mm": rain_total,  # matches generate_scenarios.py's convention
                "rain_peak_3hr_mm": rain_total,
                "max_tide_height_m": 1.4,
                "num_high_tides": 1,
            })
        df = pd.DataFrame(rows)[feature_cols]
        proba = model.predict_proba(df)
        means = proba.mean(axis=0)
        means_by_rain.append(means)
        print(f"{rain_total:>14d} | {means[0]:>16.4f} | {means[1]:>16.4f} | {means[2]:>16.4f}")

    means_by_rain = np.array(means_by_rain)
    class0_falls = means_by_rain[0, 0] > means_by_rain[-1, 0]
    class2_rises = means_by_rain[-1, 2] > means_by_rain[0, 2]

    print()
    print(f"P(class=0) falls as rainfall rises (0mm -> 150mm): {class0_falls}")
    print(f"P(class=2) rises as rainfall rises (0mm -> 150mm): {class2_rises}")

    print()
    print("=" * 70)
    print("CONCLUSION")
    print("=" * 70)
    if class0_falls and class2_rises:
        print(f"Both signals corroborate the assumed mapping: {ASSUMED_MAPPING}")
        print("This is what CLASS_TO_RISK in scripts/generate_scenarios.py uses.")
    else:
        print("Signals do NOT clearly corroborate the assumed mapping — do not trust")
        print(f"{ASSUMED_MAPPING} until you can confirm against training code.")


if __name__ == "__main__":
    main()
