"""
main.py

Entry point. Implements the four steps from the brief, in order:

  1. Load the Files       -> lifespan startup calls model_service.load_artifacts()
                              and routing_service.load_graph() ONCE, held on app.state.
  2. Fetch Live Weather    -> a background asyncio task polls weather_service every
                              WEATHER_POLL_INTERVAL_SECONDS and recomputes the current
                              flood-risk snapshot + forecast, without blocking requests.
  3. Run Predictions       -> model_service.build_live_series() runs the real model
                              against the real zone spatial cache + the live weather.
  4. Serve an API Endpoint -> FastAPI routes below, matching README.md "API Contract"
                              byte-for-byte so the existing frontend (src/api/*.ts)
                              works against this backend with zero frontend changes —
                              just set VITE_API_BASE_URL.

Run with:  uvicorn app.main:app --reload --port 8000   (from backend/)
"""

from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from . import config, model_service, routing_service, weather_service
from .schemas import SimulateRequest
from .state import AppState

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("flood_backend.main")


async def _refresh_live_state(app: FastAPI) -> None:
    """One full live-refresh cycle: fetch real rainfall (always), reuse the last
    cached tide reading (refreshed separately, far less often — see
    _tide_poll_loop), run the real model, store the result. Never raises — errors are
    logged and the previous good snapshot is kept."""
    st: AppState = app.state.flood
    try:
        live = await weather_service.fetch_live_conditions(cached_tide=st.cached_tide)
        base_time = datetime.now(timezone.utc).replace(microsecond=0)
        current, forecast = model_service.build_live_series(st.artifacts, live=live, base_time=base_time)
        now_rain = live.forecast_by_offset[0]
        streets = model_service.build_street_risks(
          st.artifacts,
          rain_total_mm=now_rain["rain_total_mm"],
          rain_hourly_mm=now_rain["rain_max_hourly_mm"],
          rain_peak_3hr_mm=now_rain["rain_peak_3hr_mm"],
          max_tide_height_m=live.max_tide_height_m,
          num_high_tides=live.num_high_tides,
        )
          
        async with st.lock:
            st.latest_current = current
            st.latest_forecast = forecast
            st.latest_streets = streets
            st.latest_live_conditions = live
            st.last_updated = base_time
        logger.info(
            "Live state refreshed: overall_risk=%s affected_zones=%d rain_source=%s tide_source=%s",
            current["overall_risk"], current["affected_zones"], live.rain_source, live.tide_source,
        )
    except Exception:
        logger.exception("Live state refresh failed — keeping previous snapshot in memory.")


async def _refresh_tide(app: FastAPI) -> None:
    """Independent, slow-cadence tide refresh (config.TIDE_POLL_INTERVAL_SECONDS).
    Just updates st.cached_tide — the next rain-poll cycle picks it up automatically.
    Never raises."""
    st: AppState = app.state.flood
    try:
        max_tide_height_m, num_high_tides, tide_source = await weather_service.fetch_live_tide()
        async with st.lock:
            st.cached_tide = (max_tide_height_m, num_high_tides, tide_source)
        logger.info(
            "Tide refreshed: max_tide_height_m=%.2f num_high_tides=%d source=%s",
            max_tide_height_m, num_high_tides, tide_source,
        )
    except Exception:
        logger.exception("Tide refresh failed — keeping previous cached tide reading.")


async def _poll_loop(app: FastAPI) -> None:
    while True:
        await _refresh_live_state(app)
        await asyncio.sleep(config.WEATHER_POLL_INTERVAL_SECONDS)


async def _tide_poll_loop(app: FastAPI) -> None:
    while True:
        await _refresh_tide(app)
        await asyncio.sleep(config.TIDE_POLL_INTERVAL_SECONDS)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Startup: loading model.pkl, edge_cache.pkl, and the road graph into memory...")
    artifacts = model_service.load_artifacts()
    graph = routing_service.load_graph()
    app.state.flood = AppState(artifacts=artifacts, graph=graph)
    logger.info(
        "Loaded model (%d zones, spatial cache source=%s) and road graph (%d nodes / %d edges).",
        len(artifacts.zones), artifacts.zones_source, graph.number_of_nodes(), graph.number_of_edges(),
    )

    # One synchronous tide fetch, then one synchronous rain+state refresh, before
    # accepting traffic, so the very first request doesn't race either poller.
    await _refresh_tide(app)
    await _refresh_live_state(app)

    app.state.flood.poller_task = asyncio.create_task(_poll_loop(app))
    app.state.flood.tide_poller_task = asyncio.create_task(_tide_poll_loop(app))
    logger.info(
        "Backend ready. Polling rainfall every %ds, tide every %ds.",
        config.WEATHER_POLL_INTERVAL_SECONDS, config.TIDE_POLL_INTERVAL_SECONDS,
    )

    yield

    app.state.flood.poller_task.cancel()
    app.state.flood.tide_poller_task.cancel()
    logger.info("Shutdown complete.")


app = FastAPI(title="Andheri Urban Flood Nowcast API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[config.FRONTEND_ORIGIN] if config.FRONTEND_ORIGIN != "*" else ["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def _get_state() -> AppState:
    return app.state.flood


@app.get("/health")
async def health():
    st = _get_state()
    return {
        "status": "ok" if st.is_ready() else "starting",
        "last_updated": st.last_updated.isoformat() if st.last_updated else None,
        "zones_source": st.artifacts.zones_source,
        "rain_source": st.latest_live_conditions.rain_source if st.latest_live_conditions else None,
        "tide_source": st.latest_live_conditions.tide_source if st.latest_live_conditions else None,
        "rain_poll_interval_seconds": config.WEATHER_POLL_INTERVAL_SECONDS,
        "tide_poll_interval_seconds": config.TIDE_POLL_INTERVAL_SECONDS,
    }


@app.get("/api/flood/current")
async def get_current():
    st = _get_state()
    if not st.is_ready():
        raise HTTPException(status_code=503, detail="Live flood state not ready yet — try again shortly.")
    async with st.lock:
        return st.latest_current


@app.get("/api/flood/forecast")
async def get_forecast():
    st = _get_state()
    if not st.is_ready():
        raise HTTPException(status_code=503, detail="Live flood forecast not ready yet — try again shortly.")
    async with st.lock:
        return st.latest_forecast


@app.post("/api/flood/simulate")
async def post_simulate(body: SimulateRequest):
    st = _get_state()
    preset = config.SIMULATION_PRESETS.get(body.scenario) if body.scenario else None

    rainfall_mm_hr = body.rainfall_mm_hr if body.rainfall_mm_hr is not None else (preset["rainfall_mm_hr"] if preset else None)
    duration_min = body.duration_min if body.duration_min is not None else (preset["duration_min"] if preset else None)
    blockage_percent = body.blockage_percent if body.blockage_percent is not None else (preset["blockage_percent"] if preset else 0)
    max_tide_height_m = body.max_tide_height_m if body.max_tide_height_m is not None else (preset["max_tide_height_m"] if preset else 1.2)
    num_high_tides = body.num_high_tides if body.num_high_tides is not None else (preset["num_high_tides"] if preset else 0)
    elapsed_at_now_min = preset["elapsed_at_now_min"] if preset else duration_min

    if rainfall_mm_hr is None or duration_min is None:
        raise HTTPException(
            status_code=422,
            detail="Provide either a known 'scenario' preset id, or explicit rainfall_mm_hr + duration_min.",
        )

    base_time = datetime.now(timezone.utc).replace(microsecond=0)
    current, forecast = model_service.build_scenario_series(
        st.artifacts, rainfall_mm_hr=rainfall_mm_hr, duration_min=duration_min,
        elapsed_at_now_min=elapsed_at_now_min, blockage_percent=blockage_percent,
        max_tide_height_m=max_tide_height_m, num_high_tides=num_high_tides, base_time=base_time,
    )

    return {
        "id": body.scenario or "custom",
        "label": preset["label"] if preset else "Custom scenario",
        "description": preset["description"] if preset else (
            f"Custom run: {rainfall_mm_hr} mm/hr for {duration_min} min, {blockage_percent}% blockage."
        ),
        "rainfall_mm_hr": rainfall_mm_hr,
        "duration_min": duration_min,
        "blockage_percent": blockage_percent,
        "max_tide_height_m": max_tide_height_m,
        "num_high_tides": num_high_tides,
        "current": current,
        "forecast": forecast,
        "model_notes": [],
    }


@app.get("/api/flood/zones/{zone_id}")
async def get_zone(zone_id: str):
    st = _get_state()
    if not st.is_ready():
        raise HTTPException(status_code=503, detail="Live flood state not ready yet — try again shortly.")
    async with st.lock:
        for feature in st.latest_current["zones"]["features"]:
            if feature["properties"]["zone_id"] == zone_id:
                return feature
    raise HTTPException(status_code=404, detail=f"Unknown zone_id: {zone_id}")

@app.get("/api/flood/streets")
async def get_streets():
    st = _get_state()
    if not st.is_ready():
        raise HTTPException(status_code=503, detail="Live flood state not ready yet — try again shortly.")
    async with st.lock:
        return st.latest_streets or []


@app.get("/api/routes/safe")
async def get_safe_route(route_id: str = Query(...)):
    st = _get_state()
    if route_id not in config.ROUTE_OD_PAIRS:
        raise HTTPException(status_code=404, detail=f"Unknown route_id: {route_id}")
    async with st.lock:
        zones_geojson = st.latest_current["zones"] if st.is_ready() else None
    if zones_geojson is None:
        raise HTTPException(status_code=503, detail="Live flood state not ready yet — try again shortly.")

    route = await asyncio.to_thread(routing_service.compute_route, st.graph, route_id, zones_geojson)
    if route is None:
        raise HTTPException(status_code=404, detail=f"Unknown route_id: {route_id}")
    return route

@app.get("/api/routes/dynamic")
async def get_dynamic_route(
    lon: float = Query(...),
    lat: float = Query(...),
):
    st = _get_state()

    if not st.is_ready():
        raise HTTPException(
            status_code=503,
            detail="Live flood state not ready yet — try again shortly.",
        )

    async with st.lock:
        zones_geojson = st.latest_current["zones"]
        street_risks = st.latest_streets or []

    route = await asyncio.to_thread(
        routing_service.compute_dynamic_route,
        st.graph,
        lon,
        lat,
        zones_geojson,
        street_risks,
    )

    if route is None:
        raise HTTPException(
            status_code=404,
            detail="No dynamic safe route available from this location.",
        )

    return route
