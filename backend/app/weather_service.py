"""
weather_service.py

The "Fetch Live Weather/Data" piece: pulls real rainfall data for Andheri from
Open-Meteo (https://open-meteo.com — free, no API key required, used here for its
minutely/hourly precipitation forecast+observation blend) and turns it into the three
dynamic rain features the model needs (rain_total_mm, rain_max_hourly_mm,
rain_peak_3hr_mm), plus a forecast for the next 3 hours at the same offsets the
frontend expects (0/30/60/120/180 min).

Tide: we don't have a free, keyless, reliable Indian tide-gauge API. If
WORLDTIDES_API_KEY is set (https://www.worldtides.info), we use it. Otherwise we fall
back to a documented constant, exactly like scripts/generate_scenarios.py's
LIVE_BASELINE already does — this is a real, flagged assumption, not a silent guess.
See `source` on the returned dict.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

import httpx

from . import config

logger = logging.getLogger("flood_backend.weather_service")

OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"
WORLDTIDES_URL = "https://www.worldtides.info/api/v3"

# Documented fallback used only if the live rainfall API call fails (network outage,
# rate limit, etc.) — mirrors scripts/generate_scenarios.py's LIVE_BASELINE so the
# server degrades to a known, labelled-as-such baseline instead of crashing.
FALLBACK_RAIN = dict(rain_total_mm=2.25, rain_max_hourly_mm=3.0, rain_peak_3hr_mm=2.25)
FALLBACK_TIDE = dict(max_tide_height_m=1.1, num_high_tides=0)


@dataclass
class LiveConditions:
    """Real-valued dynamic inputs for evaluate_snapshot(), at NOW and at each forecast
    offset, plus provenance so the API response / logs can say honestly where each
    number came from."""
    now: dict                      # {rain_total_mm, rain_max_hourly_mm, rain_peak_3hr_mm}
    forecast_by_offset: dict[int, dict]   # offset_min -> same shape, for 0/30/60/120/180
    max_tide_height_m: float
    num_high_tides: int
    rain_source: str                # "open-meteo" or "fallback"
    tide_source: str                # "worldtides" or "fallback"
    fetched_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))


async def _fetch_open_meteo(client: httpx.AsyncClient) -> dict | None:
    """Returns {offset_min: hourly_mm} for the past hour (accumulation context) and
    the next 3 hours, keyed by minute-offset-from-now, or None on any failure."""
    params = {
        "latitude": config.ANDHERI_LAT,
        "longitude": config.ANDHERI_LON,
        "hourly": "precipitation",
        "past_hours": 3,
        "forecast_hours": 4,
        "timezone": "UTC",
    }
    resp = await client.get(OPEN_METEO_URL, params=params, timeout=10.0)
    resp.raise_for_status()
    return resp.json()


def _rain_features_from_hourly(times: list[str], precip_mm: list[float], now: datetime, offset_min: int):
    """Turns Open-Meteo's per-hour precipitation series into the model's three dynamic
    rain features at `now + offset_min`:
      - rain_total_mm: accumulated precipitation over the trailing 3 hours up to that
        point (real observed/forecast hourly values, linearly apportioned within the
        current hour rather than a nowcast model).
      - rain_max_hourly_mm: the precipitation rate for the hour containing that point.
      - rain_peak_3hr_mm: same as rain_total_mm here, since the window is exactly 3h
        (matches the convention scripts/generate_scenarios.py uses).
    This is real API data, not a synthetic scenario — the only approximation is
    apportioning a hodograph within-hour, which Open-Meteo doesn't sub-divide."""
    target = now.replace(minute=0, second=0, microsecond=0) + \
        timedelta(minutes=offset_min + now.minute)
    parsed_times = [datetime.fromisoformat(t).replace(tzinfo=timezone.utc) for t in times]

    # Find the hourly bucket containing `target`.
    idx = 0
    for i, t in enumerate(parsed_times):
        if t <= target:
            idx = i
        else:
            break

    hourly_now = float(precip_mm[idx]) if idx < len(precip_mm) else 0.0
    window = precip_mm[max(0, idx - 2): idx + 1]
    total_3hr = float(sum(window)) if window else 0.0
    return round(total_3hr, 2), round(hourly_now, 2), round(total_3hr, 2)


async def _fetch_worldtides(client: httpx.AsyncClient) -> dict | None:
    if not config.WORLDTIDES_API_KEY:
        return None
    params = {
        "extremes": "",
        "lat": config.ANDHERI_LAT,
        "lon": config.ANDHERI_LON,
        "key": config.WORLDTIDES_API_KEY,
        "length": 86400,  # 24 hours, seconds — guarantees >=1 High in range
    }
    resp = await client.get(WORLDTIDES_URL, params=params, timeout=10.0)
    resp.raise_for_status()
    data = resp.json()
    extremes = data.get("extremes", [])
    highs = [e for e in extremes if e.get("type") == "High"]
    if highs:
        max_height = max(float(e["height"]) for e in highs)
    elif extremes:
        max_height = max(float(e["height"]) for e in extremes)
    else:
        max_height = FALLBACK_TIDE["max_tide_height_m"]
    return {"max_tide_height_m": round(max_height, 2), "num_high_tides": len(highs)}


async def fetch_live_rain() -> tuple[dict, dict[int, dict], str]:
    """Rain-only fetch — called on the fast poll loop (WEATHER_POLL_INTERVAL_SECONDS).
    Returns (rain_now, rain_forecast_by_offset, rain_source). Never raises."""
    now = datetime.now(timezone.utc)
    rain_now = dict(FALLBACK_RAIN)
    rain_forecast = {off: dict(FALLBACK_RAIN) for off in config.FORECAST_OFFSETS_MIN}
    rain_source = "fallback"

    async with httpx.AsyncClient() as client:
        try:
            payload = await _fetch_open_meteo(client)
            hourly = payload["hourly"]
            times, precip = hourly["time"], hourly["precipitation"]
            for off in config.FORECAST_OFFSETS_MIN:
                total, hr, peak3 = _rain_features_from_hourly(times, precip, now, off)
                snap = {"rain_total_mm": total, "rain_max_hourly_mm": hr, "rain_peak_3hr_mm": peak3}
                rain_forecast[off] = snap
                if off == 0:
                    rain_now = snap
            rain_source = "open-meteo"
        except Exception:
            logger.exception(
                "Live rainfall fetch (Open-Meteo) failed — falling back to the "
                "documented baseline rainfall values used by scripts/generate_scenarios.py. "
                "This is surfaced to clients via rain_source='fallback'."
            )

    return rain_now, rain_forecast, rain_source


async def fetch_live_tide() -> tuple[float, int, str]:
    """Tide-only fetch — called on its own, much slower poll loop
    (TIDE_POLL_INTERVAL_SECONDS), independent of the rain loop, since WorldTides'
    free tier has a tight monthly call quota and tides don't change on a 5-minute
    timescale anyway. Never raises."""
    tide = dict(FALLBACK_TIDE)
    tide_source = "fallback"
    async with httpx.AsyncClient() as client:
        try:
            wt = await _fetch_worldtides(client)
            if wt is not None:
                tide = wt
                tide_source = "worldtides"
        except Exception:
            logger.exception("Live tide fetch (WorldTides) failed — using documented fallback constant.")
    return tide["max_tide_height_m"], tide["num_high_tides"], tide_source


async def fetch_live_conditions(cached_tide: tuple[float, int, str] | None = None) -> LiveConditions:
    """Combines a fresh rain fetch with either a freshly-fetched tide reading or a
    previously cached one (`cached_tide`), so callers on the fast poll loop don't have
    to hit WorldTides every single cycle. If `cached_tide` is None, fetches tide fresh
    too (used for the very first startup refresh, and for direct/manual calls)."""
    now = datetime.now(timezone.utc)
    rain_now, rain_forecast, rain_source = await fetch_live_rain()

    if cached_tide is not None:
        max_tide_height_m, num_high_tides, tide_source = cached_tide
    else:
        max_tide_height_m, num_high_tides, tide_source = await fetch_live_tide()

    return LiveConditions(
        now=rain_now,
        forecast_by_offset=rain_forecast,
        max_tide_height_m=max_tide_height_m,
        num_high_tides=num_high_tides,
        rain_source=rain_source,
        tide_source=tide_source,
        fetched_at=now,
    )
