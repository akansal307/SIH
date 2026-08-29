"""
build_routes.py

Computes REAL fastest-vs-flood-safe route pairs on the actual Andheri road graph
(data/source/city_graph_with_elevation (1).graphml), for a small, fixed set of
demo-relevant origin/destination pairs anchored to verified real landmarks.

This is deliberately not a general-purpose routing API (no geocoding, no arbitrary
origin/destination) — it produces a few pre-baked, real examples for the RoutePanel to
show, and is designed so a real POST /api/routes/safe backend can be swapped in without
changing the frontend's RouteRecommendation type (see src/types/flood.ts).

Method:
  - "Fastest" = Dijkstra shortest path by edge length on the full graph.
  - "Safe"    = Dijkstra shortest path by edge length on a graph where edges inside a
    zone currently at HIGH risk (in the Extreme Cloudburst scenario's "current" state,
    from public/data/scenarios.json) are heavily penalised (not removed, so a path
    always exists) rather than simply forbidden.
  - Travel time for both routes is estimated from real OSM `highway` class using
    typical Mumbai urban traffic speeds (a documented assumption — replace with a real
    routing/traffic engine when available).
  - A route's displayed "risk" is the worst zone risk any of its edges pass through,
    under the scenario used to compute the safe route.

Nothing under data/source/ is modified by this script.
"""

import json
import os
import joblib
import networkx as nx
import numpy as np
from shapely.geometry import shape, Point

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
GRAPHML_PATH = os.path.join(ROOT, "data", "source", "city_graph_with_elevation (1).graphml")
SCENARIOS_PATH = os.path.join(ROOT, "public", "data", "scenarios.json")
OUTPUT_PATH = os.path.join(ROOT, "public", "data", "routes.json")

# Typical urban Mumbai travel speeds by OSM highway class, km/h. Documented assumption
# used only to turn real route distance into an illustrative duration estimate.
SPEED_KMH = {
    "trunk": 32, "trunk_link": 28, "primary": 28, "primary_link": 24,
    "secondary": 26, "secondary_link": 22, "tertiary": 22, "tertiary_link": 20,
    "residential": 18, "living_street": 12, "unclassified": 18, "service": 12,
}
DEFAULT_SPEED_KMH = 20

# Verified real landmark coordinates (lon, lat) used only to snap to the nearest real
# graph node for each demo route endpoint.
ROUTE_OD_PAIRS = [
    {
        "id": "station-to-marol",
        "label": "Andheri Station -> Marol Naka (MIDC)",
        "origin": (72.846944, 19.119167),
        "destination": (72.877000, 19.119000),
    },
    {
        "id": "around-tilak-marg",
        "label": "Lokmanya Tilak Marg crossing (north Andheri West)",
        "origin": (72.818000, 19.145500),
        "destination": (72.840000, 19.145500),
    },
    {
        "id": "around-ns-road-5",
        "label": "N. S. Road No. 5 crossing (south Andheri West)",
        "origin": (72.818000, 19.104000),
        "destination": (72.840000, 19.104000),
    },
]

# Scenario used to decide which zones the "safe" route avoids. Chosen deliberately as
# Heavy Rain rather than Extreme Cloudburst: under Extreme Cloudburst 26/33 zones are
# HIGH simultaneously (a real, honest model finding — see generate_scenarios.py), which
# leaves no meaningful zone-avoiding detour to demonstrate between distant points. Heavy
# Rain elevates exactly 2 real zones, which is what actually lets "fastest" and "safe"
# differ. The routing UI is designed to work with whichever scenario is active though —
# this constant only controls what these 3 pre-baked demo examples were computed against.
SCENARIO_FOR_SAFE_ROUTING = "heavy_rain"
# Heavy, but not infinite, so a path always exists. HIGH is avoided almost at any cost;
# MODERATE is avoided only when a reasonably-priced alternative exists (mirrors how an
# emergency router should actually behave, rather than a binary avoid/don't-avoid).
RISK_PENALTY_MULTIPLIER = {"HIGH": 25.0, "MODERATE": 15.0, "LOW": 1.0}


def norm_scalar(v):
    if isinstance(v, list):
        return v[0] if v else None
    return v


def nearest_node(G, lon, lat):
    best, best_d2 = None, float("inf")
    for n, data in G.nodes(data=True):
        x, y = float(data["x"]), float(data["y"])
        d2 = (x - lon) ** 2 + (y - lat) ** 2
        if d2 < best_d2:
            best, best_d2 = n, d2
    return best


def edge_speed_kmh(highway):
    highway = norm_scalar(highway)
    return SPEED_KMH.get(highway, DEFAULT_SPEED_KMH)


def path_to_linestring_coords(G, path_nodes):
    coords = []
    for n in path_nodes:
        d = G.nodes[n]
        coords.append([float(d["x"]), float(d["y"])])
    return coords


def path_metrics(G, path_nodes):
    length_m = 0.0
    time_hr = 0.0
    for u, v in zip(path_nodes[:-1], path_nodes[1:]):
        edata = min(G.get_edge_data(u, v).values(), key=lambda d: d.get("length", 1e9))
        seg_len = float(edata.get("length", 0.0))
        length_m += seg_len
        time_hr += seg_len / 1000.0 / edge_speed_kmh(edata.get("highway"))
    return length_m, time_hr


def zone_lookup_fn(zones_geojson):
    """Returns a function mapping (lon, lat) -> zone_id ('' if none), using the same
    rectangular zone polygons the rest of the pipeline uses."""
    entries = []
    for feat in zones_geojson["features"]:
        entries.append((feat["properties"]["zone_id"], feat["properties"]["risk"], shape(feat["geometry"])))

    def lookup(lon, lat):
        pt = Point(lon, lat)
        for zone_id, risk, geom in entries:
            if geom.contains(pt) or geom.intersects(pt):
                return zone_id, risk
        return None, "LOW"

    return lookup


def main():
    print(f"Reading graph: {GRAPHML_PATH}")
    G = nx.read_graphml(GRAPHML_PATH)

    # GraphML stores every attribute as a string by default; numeric attrs we route on
    # (length) need to be coerced to float before they can be used as edge weights.
    for _, _, data in G.edges(data=True):
        data["length"] = float(data.get("length", 1.0))

    # networkx read_graphml on a MultiDiGraph-shaped export keeps it directed; treat as
    # undirected for routing since pedestrians/emergency vehicles are not one-way
    # constrained in this MVP (documented simplification).
    G_undirected = G.to_undirected()

    with open(SCENARIOS_PATH) as f:
        scenarios = json.load(f)
    preset = next(p for p in scenarios["simulation_presets"] if p["id"] == SCENARIO_FOR_SAFE_ROUTING)
    zones_geojson = preset["current"]["zones"]
    zone_lookup = zone_lookup_fn(zones_geojson)

    # Build a risk-penalised copy of the graph for "safe" routing: edges whose midpoint
    # falls inside a HIGH-risk zone (under the Extreme Cloudburst scenario) get a heavy
    # length penalty rather than being removed, guaranteeing a path always exists.
    G_penalised = G_undirected.copy()
    for u, v, data in G_penalised.edges(data=True):
        ux, uy = float(G.nodes[u]["x"]), float(G.nodes[u]["y"])
        vx, vy = float(G.nodes[v]["x"]), float(G.nodes[v]["y"])
        mx, my = (ux + vx) / 2, (uy + vy) / 2
        _, risk = zone_lookup(mx, my)
        base_len = float(data.get("length", 1.0))
        data["penalised_length"] = base_len * RISK_PENALTY_MULTIPLIER[risk]

    routes_out = []
    for od in ROUTE_OD_PAIRS:
        print(f"Routing: {od['label']}")
        o_node = nearest_node(G, *od["origin"])
        d_node = nearest_node(G, *od["destination"])

        fastest_path = nx.shortest_path(G_undirected, o_node, d_node, weight="length")
        safe_path = nx.shortest_path(G_penalised, o_node, d_node, weight="penalised_length")

        fastest_len_m, fastest_time_hr = path_metrics(G_undirected, fastest_path)
        safe_len_m, safe_time_hr = path_metrics(G_undirected, safe_path)  # real length/time, not penalised

        def worst_risk_on_path(path_nodes):
            rank = {"LOW": 0, "MODERATE": 1, "HIGH": 2}
            worst = "LOW"
            for u, v in zip(path_nodes[:-1], path_nodes[1:]):
                ux, uy = float(G.nodes[u]["x"]), float(G.nodes[u]["y"])
                vx, vy = float(G.nodes[v]["x"]), float(G.nodes[v]["y"])
                _, risk = zone_lookup((ux + vx) / 2, (uy + vy) / 2)
                if rank[risk] > rank[worst]:
                    worst = risk
            return worst

        fastest_risk = worst_risk_on_path(fastest_path)
        safe_risk = worst_risk_on_path(safe_path)

        routes_out.append({
            "id": od["id"],
            "label": od["label"],
            "scenario_context": SCENARIO_FOR_SAFE_ROUTING,
            "fastest": {
                "type": "fastest",
                "duration_min": round(fastest_time_hr * 60),
                "distance_km": round(fastest_len_m / 1000, 2),
                "risk": fastest_risk,
                "geometry": {"type": "LineString", "coordinates": path_to_linestring_coords(G, fastest_path)},
            },
            "safe": {
                "type": "safe",
                "duration_min": round(safe_time_hr * 60),
                "distance_km": round(safe_len_m / 1000, 2),
                "risk": safe_risk,
                "geometry": {"type": "LineString", "coordinates": path_to_linestring_coords(G, safe_path)},
            },
            "recommendation": "safe" if safe_risk != fastest_risk and fastest_risk in ("MODERATE", "HIGH") else "fastest",
        })
        print(f"    fastest: {round(fastest_time_hr*60)} min / {round(fastest_len_m/1000,2)} km / risk={fastest_risk}")
        print(f"    safe:    {round(safe_time_hr*60)} min / {round(safe_len_m/1000,2)} km / risk={safe_risk}")

    with open(OUTPUT_PATH, "w") as f:
        json.dump({
            "note": (
                "Fastest/safe routes are computed with real Dijkstra shortest-path search on the actual "
                "Andheri road graph (edge lengths from OSM). 'Safe' avoids HIGH-risk zones under the "
                "Extreme Cloudburst scenario. Travel times use typical urban-speed assumptions by road "
                "class, not live traffic. This is a small fixed demo set (2 OD pairs), not a general "
                "routing API — see README 'Assumptions & TODOs'."
            ),
            "routes": routes_out,
        }, f)

    print(f"\nWrote {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
