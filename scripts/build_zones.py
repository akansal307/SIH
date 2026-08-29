"""
build_zones.py

Builds the two static (rain-independent) artifacts the rest of the pipeline needs:

  1. public/data/andheri_roads.geojson
     Every road-network edge in data/source/edge_cache.pkl as a LineString feature.
     This is the map's road-network context layer. We source it from edge_cache.pkl
     rather than the raw GraphML because edge_cache.pkl already carries the same
     geometry PLUS the precomputed static flood-model features (slope, drain_density,
     distance_to_drain_m, distance_to_waterway_m) for every edge — using it keeps the
     road layer and the risk model perfectly consistent and avoids recomputing
     anything. (scripts/convert_graph_to_geojson.py produces an equivalent layer
     straight from the raw GraphML, for teams that only have that file.)

  2. data/derived/zones_base.json
     A ~30-cell rectangular grid over the Andheri bounding box. Each cell becomes one
     "zone" — the spatial unit the flood model is evaluated on and the UI shows in the
     map, alerts, and zone-detail panel. For each zone we aggregate the REAL static
     features of every edge whose midpoint falls inside it (slope, drain_density,
     distance_to_drain_m, distance_to_waterway_m — i.e. 4 of the model's 9 features),
     and derive a human-readable zone name from the most prominent real OSM road name
     inside the cell (falling back to "near <verified landmark>" using a small set of
     hand-checked real coordinates when no named road is present).

     This file is intermediate — it has no rainfall/tide/risk info yet. It exists so
     generate_scenarios.py can run the actual LightGBM model against each zone's real
     geography for as many rainfall scenarios as needed without redoing the spatial
     aggregation every time.

Nothing under data/source/ is modified by this script.
"""

import json
import os
import joblib
import numpy as np
import pandas as pd
import geopandas as gpd
from shapely.geometry import box, mapping

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
EDGE_CACHE_PATH = os.path.join(ROOT, "data", "source", "edge_cache.pkl")
ROADS_OUTPUT_PATH = os.path.join(ROOT, "public", "data", "andheri_roads.geojson")
ZONES_BASE_OUTPUT_PATH = os.path.join(ROOT, "data", "derived", "zones_base.json")

GRID_COLS = 6
GRID_ROWS = 6
MIN_EDGES_PER_ZONE = 5  # drop near-empty cells (bbox slivers with almost no road graph)

# A small set of real, independently-verifiable landmark coordinates spread across the
# bbox, used ONLY as a naming fallback ("near X") for zones whose grid cell happens to
# contain no named OSM road. Coordinates are (lon, lat), sourced from public station
# reference data (Wikipedia / operator pages), not invented.
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

# Road classes we trust most for naming a zone (arterial-ish first).
HIGHWAY_NAME_PRIORITY = {
    "trunk": 0, "motorway": 0, "primary": 1, "secondary": 2,
    "tertiary": 3, "trunk_link": 4, "primary_link": 4, "secondary_link": 4,
    "residential": 5, "living_street": 6, "tertiary_link": 6,
}
ANDHERI_STATION_LON = 72.846944  # used only as an East/West fallback split


def norm_scalar(v):
    """OSMnx sometimes stores a list when multiple OSM ways were merged; take the first."""
    if isinstance(v, list):
        return v[0] if v else None
    return v


def zone_display_name(cell_edges: pd.DataFrame, centroid_lon: float, centroid_lat: float) -> str:
    named = cell_edges.dropna(subset=["name_norm"]).copy()
    if len(named):
        by_length = named.groupby("name_norm")["length"].sum().sort_values(ascending=False)
        top_name = by_length.index[0]

        # A long arterial (S.V. Road, Western Express Highway, ...) runs through many
        # grid cells, so naming zones after it alone produces duplicate zone names.
        # Real Indian addressing disambiguates a stretch of road by its nearest cross
        # street ("S.V. Road, near Four Bungalows Junction") — we do the same using the
        # next most prominent *different* real road name present in the same cell.
        if len(by_length) > 1:
            cross_name = by_length.index[1]
            return f"{top_name} x {cross_name}"
        return f"{top_name} Belt"

    # Fallback: nearest verified landmark (simple planar distance is fine at this scale).
    best = min(
        LANDMARKS,
        key=lambda lm: (lm[1] - centroid_lon) ** 2 + (lm[2] - centroid_lat) ** 2,
    )
    side = "East" if centroid_lon >= ANDHERI_STATION_LON else "West"
    return f"Near {best[0]} (Andheri {side})"


def main():
    print(f"Loading edge cache: {EDGE_CACHE_PATH}")
    cache = joblib.load(EDGE_CACHE_PATH)
    edges = cache["edges"].copy()
    if edges.crs is None:
        edges = edges.set_crs(epsg=4326)

    edges["name_norm"] = edges["name"].apply(norm_scalar)
    edges["highway_norm"] = edges["highway"].apply(norm_scalar)

    # ---- 1. Road-network GeoJSON (map context / optional drainage-proximity layer) ----
    os.makedirs(os.path.dirname(ROADS_OUTPUT_PATH), exist_ok=True)
    road_features = []
    for idx, row in edges.iterrows():
        geom = row.geometry
        if geom is None or geom.geom_type != "LineString":
            continue
        road_features.append(
            {
                "type": "Feature",
                "properties": {
                    "edge_id": row.get("edge_id"),
                    "source": row.get("u"),
                    "target": row.get("v"),
                    "highway": row.get("highway_norm"),
                    "name": row.get("name_norm"),
                    "length_m": None if pd.isna(row.get("length")) else round(float(row.get("length")), 1),
                    "oneway": bool(row.get("oneway")) if not pd.isna(row.get("oneway")) else None,
                    "slope": None if pd.isna(row.get("slope")) else round(float(row.get("slope")), 4),
                    "distance_to_drain_m": None if pd.isna(row.get("distance_to_drain_m")) else round(float(row.get("distance_to_drain_m")), 1),
                    "distance_to_waterway_m": None if pd.isna(row.get("distance_to_waterway_m")) else round(float(row.get("distance_to_waterway_m")), 1),
                    "drain_density": None if pd.isna(row.get("drain_density")) else round(float(row.get("drain_density")), 3),
                },
                "geometry": mapping(geom),
            }
        )
    with open(ROADS_OUTPUT_PATH, "w") as f:
        json.dump({"type": "FeatureCollection", "features": road_features}, f)
    print(f"  Wrote {len(road_features)} road features -> {ROADS_OUTPUT_PATH}")

    # ---- 2. Zone grid ----
    minx, miny, maxx, maxy = edges.total_bounds
    xs = np.linspace(minx, maxx, GRID_COLS + 1)
    ys = np.linspace(miny, maxy, GRID_ROWS + 1)

    # Use the metric-projected copy for an accurate edge midpoint, then carry the
    # WGS84 geometry/index back through for map-facing output.
    edges_proj = cache["edges_proj"].copy()
    mids_proj = edges_proj.geometry.interpolate(0.5, normalized=True)
    mids_wgs84 = gpd.GeoSeries(mids_proj, crs=edges_proj.crs).to_crs(epsg=4326)
    edges["mid_lon"] = mids_wgs84.x.values
    edges["mid_lat"] = mids_wgs84.y.values

    zones = []
    zone_num = 0
    for i in range(GRID_COLS):
        for j in range(GRID_ROWS):
            x0, x1 = xs[i], xs[i + 1]
            y0, y1 = ys[j], ys[j + 1]
            in_cell = edges[
                (edges["mid_lon"] >= x0) & (edges["mid_lon"] < x1) &
                (edges["mid_lat"] >= y0) & (edges["mid_lat"] < y1)
            ]
            if len(in_cell) < MIN_EDGES_PER_ZONE:
                continue

            zone_num += 1
            zone_id = f"AND-{zone_num:02d}"
            centroid_lon = (x0 + x1) / 2
            centroid_lat = (y0 + y1) / 2
            cell_poly = box(x0, y0, x1, y1)

            zones.append(
                {
                    "zone_id": zone_id,
                    "name": zone_display_name(in_cell, centroid_lon, centroid_lat),
                    "grid": {"col": i, "row": j},
                    "centroid": [round(centroid_lon, 6), round(centroid_lat, 6)],
                    "geometry": mapping(cell_poly),
                    "edge_count": int(len(in_cell)),
                    # Static (rain-independent) model features aggregated from the real
                    # per-edge values. Distances use the minimum (closest hazard/drain
                    # edge in the zone); slope and drain_density use the mean.
                    "static_factors": {
                        "slope": float(in_cell["slope"].mean()),
                        "distance_to_waterway_m": float(in_cell["distance_to_waterway_m"].min()),
                        "drain_density": float(in_cell["drain_density"].mean()),
                        "distance_to_drain_m": float(in_cell["distance_to_drain_m"].min()),
                    },
                }
            )

    # Safety net: guarantee unique display names even in the rare case two zones still
    # land on the same "primary x cross-street" combination.
    seen = {}
    for z in zones:
        name = z["name"]
        seen[name] = seen.get(name, 0) + 1
        if seen[name] > 1:
            z["name"] = f"{name} ({seen[name]})"

    os.makedirs(os.path.dirname(ZONES_BASE_OUTPUT_PATH), exist_ok=True)
    with open(ZONES_BASE_OUTPUT_PATH, "w") as f:
        json.dump({"grid_cols": GRID_COLS, "grid_rows": GRID_ROWS, "zones": zones}, f, indent=2)

    print(f"  Built {len(zones)} zones (of {GRID_COLS * GRID_ROWS} grid cells) -> {ZONES_BASE_OUTPUT_PATH}")
    for z in zones[:5]:
        print(f"    {z['zone_id']:8s} {z['name']:40s} edges={z['edge_count']:4d}  slope~{z['static_factors']['slope']:.3f}")
    print("    ...")


if __name__ == "__main__":
    main()
