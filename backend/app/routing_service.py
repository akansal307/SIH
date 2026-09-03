"""
routing_service.py

Loads the real Andheri road graph (city_graph_with_elevation (1).graphml) into memory
once at startup, and computes real Dijkstra fastest-vs-flood-safe routes for the
fixed demo origin/destination pairs (config.ROUTE_OD_PAIRS) — same method
scripts/build_routes.py uses offline, but run live against whatever the current
zone-risk state actually is (live poll or last simulation), not a single frozen
scenario.
"""

from __future__ import annotations

import logging

import networkx as nx
from shapely.geometry import Point, shape

from . import config

logger = logging.getLogger("flood_backend.routing_service")


def load_graph() -> nx.Graph:
    logger.info("Loading road graph: %s", config.GRAPHML_PATH)
    G = nx.read_graphml(config.GRAPHML_PATH)
    for _, _, data in G.edges(data=True):
        data["length"] = float(data.get("length", 1.0))
    # Undirected: pedestrians/emergency vehicles aren't one-way constrained in this
    # MVP (documented simplification, same as scripts/build_routes.py).
    return G.to_undirected()


def _norm_scalar(v):
    return v[0] if isinstance(v, list) and v else (None if isinstance(v, list) else v)


def _nearest_node(G: nx.Graph, lon: float, lat: float):
    best, best_d2 = None, float("inf")
    for n, data in G.nodes(data=True):
        d2 = (float(data["x"]) - lon) ** 2 + (float(data["y"]) - lat) ** 2
        if d2 < best_d2:
            best, best_d2 = n, d2
    return best


def _edge_speed_kmh(highway):
    return config.SPEED_KMH.get(_norm_scalar(highway), config.DEFAULT_SPEED_KMH)


def _path_to_coords(G: nx.Graph, path_nodes: list) -> list:
    return [[float(G.nodes[n]["x"]), float(G.nodes[n]["y"])] for n in path_nodes]


def _path_metrics(G: nx.Graph, path_nodes: list) -> tuple[float, float]:
    length_m, time_hr = 0.0, 0.0
    for u, v in zip(path_nodes[:-1], path_nodes[1:]):
        edata = min(G.get_edge_data(u, v).values(), key=lambda d: d.get("length", 1e9))
        seg_len = float(edata.get("length", 0.0))
        length_m += seg_len
        time_hr += seg_len / 1000.0 / _edge_speed_kmh(edata.get("highway"))
    return length_m, time_hr


def _zone_lookup_fn(zones_geojson: dict):
    entries = [
        (f["properties"]["zone_id"], f["properties"]["risk"], shape(f["geometry"]))
        for f in zones_geojson["features"]
    ]

    def lookup(lon: float, lat: float):
        pt = Point(lon, lat)
        for zone_id, risk, geom in entries:
            if geom.contains(pt) or geom.intersects(pt):
                return zone_id, risk
        return None, "LOW"

    return lookup


def compute_route(G: nx.Graph, route_id: str, zones_geojson: dict) -> dict | None:
    """Real Dijkstra fastest vs. risk-penalised 'safe' route for one fixed demo OD
    pair, evaluated against whatever zone-risk state (zones_geojson, a
    FeatureCollection of ZoneFeatureWire) is passed in — typically the current live
    snapshot. Returns a RouteExampleWire dict, or None if route_id is unknown."""
    od = config.ROUTE_OD_PAIRS.get(route_id)
    if od is None:
        return None

    zone_lookup = _zone_lookup_fn(zones_geojson)

    G_penalised = G.copy()
    for u, v, data in G_penalised.edges(data=True):
        ux, uy = float(G.nodes[u]["x"]), float(G.nodes[u]["y"])
        vx, vy = float(G.nodes[v]["x"]), float(G.nodes[v]["y"])
        _, risk = zone_lookup((ux + vx) / 2, (uy + vy) / 2)
        data["penalised_length"] = float(data.get("length", 1.0)) * config.RISK_PENALTY_MULTIPLIER[risk]

    o_node = _nearest_node(G, *od["origin"])
    d_node = _nearest_node(G, *od["destination"])

    fastest_path = nx.shortest_path(G, o_node, d_node, weight="length")
    safe_path = nx.shortest_path(G_penalised, o_node, d_node, weight="penalised_length")

    fastest_len_m, fastest_time_hr = _path_metrics(G, fastest_path)
    safe_len_m, safe_time_hr = _path_metrics(G, safe_path)

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

    return {
        "id": route_id,
        "label": od["label"],
        "scenario_context": "live",
        "fastest": {
            "type": "fastest",
            "duration_min": round(fastest_time_hr * 60),
            "distance_km": round(fastest_len_m / 1000, 2),
            "risk": fastest_risk,
            "geometry": {"type": "LineString", "coordinates": _path_to_coords(G, fastest_path)},
        },
        "safe": {
            "type": "safe",
            "duration_min": round(safe_time_hr * 60),
            "distance_km": round(safe_len_m / 1000, 2),
            "risk": safe_risk,
            "geometry": {"type": "LineString", "coordinates": _path_to_coords(G, safe_path)},
        },
        "recommendation": "safe" if safe_risk != fastest_risk and fastest_risk in ("MODERATE", "HIGH") else "fastest",
    }
