"""
convert_graph_to_geojson.py

Converts the raw OSMnx road-network GraphML (data/source/city_graph_with_elevation (1).graphml)
into a plain GeoJSON FeatureCollection of road-segment LineStrings, preserving the
attributes called out in the frontend brief (highway, length, grade, oneway, source, target).

This is a *general-purpose* converter that only depends on the GraphML file — it does not
require the model or edge_cache.pkl. It exists so the pipeline is reproducible even if only
the raw graph is available.

For the actual map layer shipped with the frontend, generate_scenarios.py uses
data/source/edge_cache.pkl instead, because that file already contains the same
road-network geometry PLUS the precomputed static model features (slope, drain_density,
distance_to_drain_m, distance_to_waterway_m) for every edge. Using it avoids recomputing
those features and keeps the frontend's road layer and risk model perfectly consistent.
Run this script only if you need a lightweight, feature-free roads layer from the raw graph.

Usage:
    python scripts/convert_graph_to_geojson.py

Output:
    public/data/andheri_roads.geojson   (LineString per directed edge)

The original GraphML file is only ever opened for reading and is never modified.
"""

import json
import os
import networkx as nx

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SOURCE_GRAPHML = os.path.join(ROOT, "data", "source", "city_graph_with_elevation (1).graphml")
OUTPUT_PATH = os.path.join(ROOT, "public", "data", "andheri_roads.geojson")

# Attributes we keep on each edge feature, per the frontend brief (section 26).
KEEP_EDGE_ATTRS = ["highway", "length", "grade", "oneway", "name", "osmid", "maxspeed", "lanes"]


def to_float(v, default=None):
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


def main():
    print(f"Reading GraphML: {SOURCE_GRAPHML}")
    G = nx.read_graphml(SOURCE_GRAPHML)
    print(f"  nodes: {G.number_of_nodes()}  edges: {G.number_of_edges()}")

    features = []

    for u, v, key, data in G.edges(keys=True, data=True):
        u_data = G.nodes[u]
        v_data = G.nodes[v]

        ux, uy = to_float(u_data.get("x")), to_float(u_data.get("y"))
        vx, vy = to_float(v_data.get("x")), to_float(v_data.get("y"))
        if ux is None or uy is None or vx is None or vy is None:
            continue  # skip malformed nodes rather than guessing coordinates

        # OSMnx stores a full geometry string for curved edges; straight edges only
        # have their endpoint nodes, so we fall back to a two-point LineString.
        geometry_wkt = data.get("geometry")
        coords = None
        if geometry_wkt and geometry_wkt.startswith("LINESTRING"):
            body = geometry_wkt[len("LINESTRING ("):-1]
            coords = []
            for pair in body.split(", "):
                lon_str, lat_str = pair.strip().split(" ")
                coords.append([float(lon_str), float(lat_str)])
        else:
            coords = [[ux, uy], [vx, vy]]

        highway = data.get("highway")
        if isinstance(highway, list):
            highway = highway[0] if highway else None

        props = {
            "source": u,
            "target": v,
            "edge_key": key,
        }
        for attr in KEEP_EDGE_ATTRS:
            val = data.get(attr)
            if attr == "length" or attr == "grade":
                val = to_float(val)
            props[attr] = val
        props["highway"] = highway  # normalized above

        features.append(
            {
                "type": "Feature",
                "properties": props,
                "geometry": {"type": "LineString", "coordinates": coords},
            }
        )

    fc = {"type": "FeatureCollection", "features": features}

    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    with open(OUTPUT_PATH, "w") as f:
        json.dump(fc, f)

    print(f"Wrote {len(features)} LineString features -> {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
