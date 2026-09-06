"""
routing_service.py

Loads the real Andheri road graph once at startup.

Supports:
  - Fixed demo origin/destination routes via compute_route()
  - Dynamic street-click routing via compute_dynamic_route()

Dynamic routing starts from the road node nearest the clicked street and
chooses the best of the existing configured destinations. Current per-street
flood risk is used when a graph edge can be matched by edge_id; zone risk
remains as a fallback.
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

    # MVP simplification: treat graph as undirected.
    return G.to_undirected()


def _norm_scalar(v):
    return v[0] if isinstance(v, list) and v else (None if isinstance(v, list) else v)


def _nearest_node(G: nx.Graph, lon: float, lat: float):
    best, best_d2 = None, float("inf")

    for n, data in G.nodes(data=True):
        try:
            x = float(data["x"])
            y = float(data["y"])
        except (KeyError, TypeError, ValueError):
            continue

        d2 = (x - lon) ** 2 + (y - lat) ** 2

        if d2 < best_d2:
            best, best_d2 = n, d2

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


def _path_metrics(G: nx.Graph, path_nodes: list) -> tuple[float, float]:
    length_m, time_hr = 0.0, 0.0

    for u, v in zip(path_nodes[:-1], path_nodes[1:]):
        edge_data = G.get_edge_data(u, v)

        if not edge_data:
            continue

        edata = min(
            edge_data.values(),
            key=lambda d: d.get("length", 1e9),
        )

        seg_len = float(edata.get("length", 0.0))

        length_m += seg_len

        time_hr += (
            seg_len
            / 1000.0
            / _edge_speed_kmh(edata.get("highway"))
        )

    return length_m, time_hr


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


def _edge_id_from_data(data: dict) -> str | None:
    """
    Try the common graph attribute names used for road identity.
    """
    for key in ("edge_id", "id"):
        value = data.get(key)

        if value is None:
            continue

        value = _norm_scalar(value)

        if value is not None:
            return str(value)

    return None


def _street_risk_lookup(street_risks: list[dict]):
    by_edge_id = {
        str(item.get("edge_id")): item
        for item in street_risks
        if item.get("edge_id") is not None
    }

    def lookup(edge_id: str | None):
        if not edge_id:
            return None

        item = by_edge_id.get(str(edge_id))

        if not item:
            return None

        return str(item.get("risk", "LOW"))

    return lookup


def _build_penalised_graph(
    G: nx.Graph,
    zones_geojson: dict,
    street_risks: list[dict],
) -> nx.Graph:
    """
    Build a routing graph where flooded streets are strongly penalised.

    Priority:
      1. Exact edge_id street risk
      2. Flood-zone risk at edge midpoint
    """
    zone_lookup = _zone_lookup_fn(zones_geojson)
    street_lookup = _street_risk_lookup(street_risks)

    G_penalised = G.copy()

    for u, v, data in G_penalised.edges(data=True):
        original_data = G.get_edge_data(u, v)

        if not original_data:
            risk = "LOW"
        else:
            base_edge = min(
                original_data.values(),
                key=lambda d: d.get("length", 1e9),
            )

            edge_id = _edge_id_from_data(base_edge)
            risk = street_lookup(edge_id)

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
            float(data.get("length", 1.0)) * multiplier
        )

    return G_penalised


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

        edata = min(
            edge_data.values(),
            key=lambda d: d.get("length", 1e9),
        )

        edge_id = _edge_id_from_data(edata)
        risk = street_lookup(edge_id)

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


def _build_route_response(
    G: nx.Graph,
    route_id: str,
    origin_label: str,
    origin_node,
    destination_node,
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


def compute_route(
    G: nx.Graph,
    route_id: str,
    zones_geojson: dict,
) -> dict | None:
    """
    Existing fixed demo routing.

    KEPT INTACT for the existing frontend/API contract.
    """
    od = config.ROUTE_OD_PAIRS.get(route_id)

    if od is None:
        return None

    zone_lookup = _zone_lookup_fn(zones_geojson)

    G_penalised = G.copy()

    for u, v, data in G_penalised.edges(data=True):
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

    fastest_len_m, fastest_time_hr = _path_metrics(
        G,
        fastest_path,
    )

    safe_len_m, safe_time_hr = _path_metrics(
        G,
        safe_path,
    )

    def worst_risk_on_path(path_nodes):
        return _worst_risk_on_path(
            G,
            path_nodes,
            zones_geojson,
        )

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


def compute_dynamic_route(
    G: nx.Graph,
    lon: float,
    lat: float,
    zones_geojson: dict,
    street_risks: list[dict],
) -> dict | None:
    """
    Calculate a route starting from the clicked street.

    The destination is selected from the existing configured destinations.
    This keeps the current app behavior intact while making the origin dynamic.
    """

    origin_node = _nearest_node(
        G,
        lon,
        lat,
    )

    if origin_node is None:
        return None

    G_penalised = _build_penalised_graph(
        G,
        zones_geojson,
        street_risks,
    )

    candidates = []

    for route_id, od in config.ROUTE_OD_PAIRS.items():
        destination_node = _nearest_node(
            G,
            *od["destination"],
        )

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
                G_penalised,
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

        # Prefer lower flood risk, then shorter safe travel time.
        candidates.append(
            (
                _risk_rank(safe_risk),
                safe_time_hr,
                route_id,
                od,
                fastest_path,
                safe_path,
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
        _,
        _,
        route_id,
        od,
        fastest_path,
        safe_path,
    ) = candidates[0]

    return _build_route_response(
        G=G,
        route_id=f"dynamic-{route_id}",
        origin_label=f"Dynamic route → {od['label']}",
        origin_node=origin_node,
        destination_node=None,
        fastest_path=fastest_path,
        safe_path=safe_path,
        zones_geojson=zones_geojson,
        street_risks=street_risks,
    )
