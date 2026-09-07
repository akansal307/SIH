"""
routing_service.py

Loads the real Andheri road graph once at startup.

Supports:
  - Existing fixed demo routes via compute_route()
  - Dynamic street-click routing via compute_dynamic_route()

Dynamic routing:
  - starts at the graph node nearest the clicked map position
  - uses current per-street flood risk when available
  - falls back to current flood-zone risk
  - chooses among the existing configured destinations
  - uses Dijkstra on the real road graph

The expensive flood-penalised graph is built once per live refresh cycle
and reused by dynamic route requests.
"""

from __future__ import annotations

import logging

import networkx as nx
from shapely.geometry import Point, shape

from . import config

logger = logging.getLogger("flood_backend.routing_service")


# --------------------------------------------------------------------------- #
# Graph loading
# --------------------------------------------------------------------------- #

def load_graph() -> nx.Graph:
    logger.info("Loading road graph: %s", config.GRAPHML_PATH)

    G = nx.read_graphml(config.GRAPHML_PATH)

    for _, _, _, data in G.edges(keys=True, data=True):
        data["length"] = float(data.get("length", 1.0))

    # MVP simplification: treat the network as undirected.
    return G.to_undirected()


# --------------------------------------------------------------------------- #
# Basic helpers
# --------------------------------------------------------------------------- #

def _norm_scalar(v):
    if isinstance(v, list):
        return v[0] if v else None
    return v


def _nearest_node(G: nx.Graph, lon: float, lat: float):
    best = None
    best_d2 = float("inf")

    for n, data in G.nodes(data=True):
        try:
            x = float(data["x"])
            y = float(data["y"])
        except (KeyError, TypeError, ValueError):
            continue

        d2 = (x - lon) ** 2 + (y - lat) ** 2

        if d2 < best_d2:
            best = n
            best_d2 = d2

    return best


def _edge_speed_kmh(highway):
    return config.SPEED_KMH.get(
        _norm_scalar(highway),
        config.DEFAULT_SPEED_KMH,
    )


def _path_to_coords(G: nx.Graph, path_nodes: list) -> list:
    return [
        [float(G.nodes[n]["x"]), float(G.nodes[n]["y"])]
        for n in path_nodes
    ]


def _path_metrics(
    G: nx.Graph,
    path_nodes: list,
) -> tuple[float, float]:
    length_m = 0.0
    time_hr = 0.0

    for u, v in zip(path_nodes[:-1], path_nodes[1:]):
        edge_data = G.get_edge_data(u, v)

        if not edge_data:
            continue

        data = min(
            edge_data.values(),
            key=lambda d: d.get("length", 1e9),
        )

        seg_len = float(data.get("length", 0.0))

        length_m += seg_len

        time_hr += (
            seg_len
            / 1000.0
            / _edge_speed_kmh(data.get("highway"))
        )

    return length_m, time_hr


# --------------------------------------------------------------------------- #
# Flood-zone helpers
# --------------------------------------------------------------------------- #

def _zone_lookup_fn(zones_geojson: dict):
    entries = [
        (
            f["properties"]["zone_id"],
            f["properties"]["risk"],
            shape(f["geometry"]),
        )
        for f in zones_geojson["features"]
    ]

    def lookup(lon: float, lat: float):
        pt = Point(lon, lat)

        for zone_id, risk, geom in entries:
            if geom.contains(pt) or geom.intersects(pt):
                return zone_id, risk

        return None, "LOW"

    return lookup


def _risk_rank(risk: str) -> int:
    return {
        "LOW": 0,
        "MODERATE": 1,
        "HIGH": 2,
    }.get(risk, 0)


# --------------------------------------------------------------------------- #
# Street-risk helpers
# --------------------------------------------------------------------------- #

def _street_risk_lookup(street_risks: list[dict]):
    by_edge_id = {
        str(item["edge_id"]): str(item.get("risk", "LOW"))
        for item in street_risks
        if item.get("edge_id") is not None
    }

    def lookup(edge_id: str | None):
        if not edge_id:
            return None
        return by_edge_id.get(str(edge_id))

    return lookup


def _candidate_edge_ids(u, v, key) -> list[str]:
    """
    GraphML edge IDs correspond to node_u_node_v_key.

    Because the graph is converted to an undirected MultiGraph, accept
    both directions when matching the street-risk edge ID.
    """
    return [
        f"{u}_{v}_{key}",
        f"{v}_{u}_{key}",
    ]


def _edge_risk(
    street_lookup,
    u,
    v,
    key,
    data: dict,
):
    for edge_id in _candidate_edge_ids(u, v, key):
        risk = street_lookup(edge_id)
        if risk is not None:
            return risk

    return None


# --------------------------------------------------------------------------- #
# Destination preparation
# --------------------------------------------------------------------------- #

def precompute_destination_nodes(
    G: nx.Graph,
) -> dict[str, object]:
    """
    Resolve each configured destination to its nearest road-graph node once.
    """
    destination_nodes: dict[str, object] = {}

    for route_id, od in config.ROUTE_OD_PAIRS.items():
        node = _nearest_node(
            G,
            *od["destination"],
        )

        if node is not None:
            destination_nodes[route_id] = node

    logger.info(
        "Precomputed %d configured destination nodes.",
        len(destination_nodes),
    )

    return destination_nodes


# --------------------------------------------------------------------------- #
# Penalised routing graph
# --------------------------------------------------------------------------- #

def build_penalised_graph(
    G: nx.Graph,
    zones_geojson: dict,
    street_risks: list[dict],
) -> nx.Graph:
    """
    Build a graph whose edge weights are increased for flooded streets.

    Priority:
      1. Exact per-street risk using edge_id
      2. Flood-zone risk at edge midpoint
    """
    zone_lookup = _zone_lookup_fn(zones_geojson)
    street_lookup = _street_risk_lookup(street_risks)

    G_penalised = G.copy()

    if G_penalised.is_multigraph():
        for u, v, key, data in G_penalised.edges(
            keys=True,
            data=True,
        ):
            risk = _edge_risk(
                street_lookup,
                u,
                v,
                key,
                data,
            )

            if risk is None:
                ux = float(G.nodes[u]["x"])
                uy = float(G.nodes[u]["y"])
                vx = float(G.nodes[v]["x"])
                vy = float(G.nodes[v]["y"])

                _, risk = zone_lookup(
                    (ux + vx) / 2,
                    (uy + vy) / 2,
                )

            multiplier = config.RISK_PENALTY_MULTIPLIER.get(
                risk,
                config.RISK_PENALTY_MULTIPLIER["LOW"],
            )

            data["penalised_length"] = (
                float(data.get("length", 1.0))
                * multiplier
            )
    else:
        for u, v, data in G_penalised.edges(data=True):
            risk = None

            if risk is None:
                ux = float(G.nodes[u]["x"])
                uy = float(G.nodes[u]["y"])
                vx = float(G.nodes[v]["x"])
                vy = float(G.nodes[v]["y"])

                _, risk = zone_lookup(
                    (ux + vx) / 2,
                    (uy + vy) / 2,
                )

            multiplier = config.RISK_PENALTY_MULTIPLIER.get(
                risk,
                config.RISK_PENALTY_MULTIPLIER["LOW"],
            )

            data["penalised_length"] = (
                float(data.get("length", 1.0))
                * multiplier
            )

    return G_penalised


# --------------------------------------------------------------------------- #
# Path risk
# --------------------------------------------------------------------------- #

def _worst_risk_on_path(
    G: nx.Graph,
    path_nodes: list,
    zones_geojson: dict,
    street_risks: list[dict] | None = None,
) -> str:
    zone_lookup = _zone_lookup_fn(zones_geojson)
    street_lookup = _street_risk_lookup(street_risks or [])

    worst = "LOW"

    for u, v in zip(path_nodes[:-1], path_nodes[1:]):
        edge_data = G.get_edge_data(u, v)

        if not edge_data:
            continue

        if G.is_multigraph():
            selected_key, edata = min(
                edge_data.items(),
                key=lambda item: item[1].get("length", 1e9),
            )

            risk = _edge_risk(
                street_lookup,
                u,
                v,
                selected_key,
                edata,
            )
        else:
            edata = edge_data
            risk = None

        if risk is None:
            ux = float(G.nodes[u]["x"])
            uy = float(G.nodes[u]["y"])
            vx = float(G.nodes[v]["x"])
            vy = float(G.nodes[v]["y"])

            _, risk = zone_lookup(
                (ux + vx) / 2,
                (uy + vy) / 2,
            )

        if _risk_rank(risk) > _risk_rank(worst):
            worst = risk

    return worst


# --------------------------------------------------------------------------- #
# Response builder
# --------------------------------------------------------------------------- #

def _build_route_response(
    G: nx.Graph,
    route_id: str,
    origin_label: str,
    fastest_path: list,
    safe_path: list,
    zones_geojson: dict,
    street_risks: list[dict] | None = None,
) -> dict:
    fastest_len_m, fastest_time_hr = _path_metrics(
        G,
        fastest_path,
    )

    safe_len_m, safe_time_hr = _path_metrics(
        G,
        safe_path,
    )

    fastest_risk = _worst_risk_on_path(
        G,
        fastest_path,
        zones_geojson,
        street_risks,
    )

    safe_risk = _worst_risk_on_path(
        G,
        safe_path,
        zones_geojson,
        street_risks,
    )

    return {
        "id": route_id,
        "label": origin_label,
        "scenario_context": "live",
        "fastest": {
            "type": "fastest",
            "duration_min": round(fastest_time_hr * 60),
            "distance_km": round(fastest_len_m / 1000, 2),
            "risk": fastest_risk,
            "geometry": {
                "type": "LineString",
                "coordinates": _path_to_coords(
                    G,
                    fastest_path,
                ),
            },
        },
        "safe": {
            "type": "safe",
            "duration_min": round(safe_time_hr * 60),
            "distance_km": round(safe_len_m / 1000, 2),
            "risk": safe_risk,
            "geometry": {
                "type": "LineString",
                "coordinates": _path_to_coords(
                    G,
                    safe_path,
                ),
            },
        },
        "recommendation": (
            "safe"
            if (
                safe_risk != fastest_risk
                and fastest_risk in ("MODERATE", "HIGH")
            )
            else "fastest"
        ),
    }


# --------------------------------------------------------------------------- #
# Existing fixed demo routes
# --------------------------------------------------------------------------- #

def compute_route(
    G: nx.Graph,
    route_id: str,
    zones_geojson: dict,
) -> dict | None:
    """
    Existing fixed route behavior.

    Kept for compatibility with /api/routes/safe.
    """
    od = config.ROUTE_OD_PAIRS.get(route_id)

    if od is None:
        return None

    zone_lookup = _zone_lookup_fn(zones_geojson)

    G_penalised = G.copy()

    for u, v, key, data in G_penalised.edges(
        keys=True,
        data=True,
    ):
        ux = float(G.nodes[u]["x"])
        uy = float(G.nodes[u]["y"])
        vx = float(G.nodes[v]["x"])
        vy = float(G.nodes[v]["y"])

        _, risk = zone_lookup(
            (ux + vx) / 2,
            (uy + vy) / 2,
        )

        data["penalised_length"] = (
            float(data.get("length", 1.0))
            * config.RISK_PENALTY_MULTIPLIER[risk]
        )

    o_node = _nearest_node(
        G,
        *od["origin"],
    )

    d_node = _nearest_node(
        G,
        *od["destination"],
    )

    if o_node is None or d_node is None:
        return None

    fastest_path = nx.shortest_path(
        G,
        o_node,
        d_node,
        weight="length",
    )

    safe_path = nx.shortest_path(
        G_penalised,
        o_node,
        d_node,
        weight="penalised_length",
    )

    return _build_route_response(
        G=G,
        route_id=route_id,
        origin_label=od["label"],
        fastest_path=fastest_path,
        safe_path=safe_path,
        zones_geojson=zones_geojson,
        street_risks=None,
    )


# --------------------------------------------------------------------------- #
# Dynamic route
# --------------------------------------------------------------------------- #

def compute_dynamic_route(
    G: nx.Graph,
    lon: float,
    lat: float,
    zones_geojson: dict,
    street_risks: list[dict],
    penalised_graph: nx.Graph | None = None,
    destination_nodes: dict[str, object] | None = None,
) -> dict | None:
    """
    Calculate a route starting from the clicked street.

    The destination is selected from the existing configured destinations.
    The safest candidate is selected by:
      1. lowest worst-case flood risk
      2. shortest safe travel time
    """

    origin_node = _nearest_node(
        G,
        lon,
        lat,
    )

    if origin_node is None:
        return None

    # Reuse the cached graph from the live refresh when available.
    if penalised_graph is None:
        penalised_graph = build_penalised_graph(
            G,
            zones_geojson,
            street_risks,
        )

    # Reuse precomputed destination nodes when available.
    if destination_nodes is None:
        destination_nodes = precompute_destination_nodes(G)

    candidates = []

    for route_id, od in config.ROUTE_OD_PAIRS.items():
        destination_node = destination_nodes.get(route_id)

        if destination_node is None:
            continue

        try:
            fastest_path = nx.shortest_path(
                G,
                origin_node,
                destination_node,
                weight="length",
            )

            safe_path = nx.shortest_path(
                penalised_graph,
                origin_node,
                destination_node,
                weight="penalised_length",
            )
        except nx.NetworkXNoPath:
            continue

        safe_len_m, safe_time_hr = _path_metrics(
            G,
            safe_path,
        )

        safe_risk = _worst_risk_on_path(
            G,
            safe_path,
            zones_geojson,
            street_risks,
        )

        candidates.append(
            (
                _risk_rank(safe_risk),
                safe_time_hr,
                route_id,
                od,
                fastest_path,
                safe_path,
                safe_len_m,
            )
        )

    if not candidates:
        return None

    candidates.sort(
        key=lambda item: (
            item[0],
            item[1],
        )
    )

    (
        _risk,
        _time,
        route_id,
        od,
        fastest_path,
        safe_path,
        _safe_len,
    ) = candidates[0]

    return _build_route_response(
        G=G,
        route_id=f"dynamic-{route_id}",
        origin_label=f"Dynamic route → {od['label']}",
        fastest_path=fastest_path,
        safe_path=safe_path,
        zones_geojson=zones_geojson,
        street_risks=street_risks,
    )
