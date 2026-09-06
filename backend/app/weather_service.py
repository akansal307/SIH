"""

weather_service.py

The "Fetch Live Weather/Data" piece: pulls real rainfall data for Andheri and turns
it into the three dynamic rain features the model needs (rain_total_mm,
rain_max_hourly_mm, rain_peak_3hr_mm), plus a forecast at the same offsets the
frontend expects (0/30/60/120/180 min).

Rainfall source is resolved in order, never raises:
  1. Tomorrow.io (https://www.tomorrow.io), if TOMORROWIO_API_KEY is set — a native
     regional model, 1-hour resolution, past 3h + forecast 4h via the Timelines API.
  2. Open-Meteo (https://open-meteo.com), free and keyless — 15-minute resolution via
     `minutely_15`, interpolated from the hourly model for India (not a native
     high-res model, since that's only available for North America/Central Europe).
     Used automatically if no Tomorrow.io key is set, or if the Tomorrow.io call
     fails for any reason.
  3. A documented fallback constant (FALLBACK_RAIN), if both of the above fail.
The actual source used for a given fetch is always reported back via `rain_source`
("tomorrow.io" / "open-meteo" / "fallback") — see fetch_live_rain() and
fetch_live_conditions().

Tide: we don't have a free, keyless, reliable Indian tide-gauge API. If
WORLDTIDES_API_KEY is set (https://www.worldtides.info), we fetch real tide extremes
over a 24-hour window (wide enough to reliably include at least one real High tide —
a shorter window frequently contained none, which made a genuine-but-empty response
indistinguishable from failure). Tide refreshes on its own, much slower poll loop
than rainfall (see main.py's _tide_poll_loop), since WorldTides' free tier has a tight
monthly call quota and tides don't meaningfully change on a 5-minute timescale.
Otherwise we fall back to a documented constant, exactly like
scripts/generate_scenarios.py's LIVE_BASELINE already does — this is a real, flagged
assumption, not a silent guess. See `tide_source` on the returned dict.
"""


from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

import httpx

from . import config

logger = logging.getLogger("flood_backend.weather_service")

OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"
TOMORROWIO_URL = "https://api.tomorrow.io/v4/timelines"
WORLDTIDES_URL = "https://www.worldtides.info/api/v3"


FALLBACK_RAIN = dict(rain_total_mm=2.25, rain_max_hourly_mm=3.0, rain_peak_3hr_mm=2.25)
FALLBACK_TIDE = dict(max_tide_height_m=1.1, num_high_tides=0)


@dataclass
class LiveConditions:
    """Real-valued dynamic inputs for evaluate_snapshot(), at NOW and at each forecast
    offset, plus provenance so the API response / logs can say honestly where each
    number came from."""
    now: dict                      
    forecast_by_offset: dict[int, dict]   
    max_tide_height_m: float
    num_high_tides: int
    rain_source: str              
    tide_source: str               
    fetched_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))


async def _fetch_open_meteo(client: httpx.AsyncClient) -> dict | None:
    """Requests 15-minute-resolution precipitation instead of hourly. For Andheri
    (outside Open-Meteo's native North America/Central Europe high-res coverage) this
    is interpolated from the same underlying hourly model — so it's a smoothed curve,
    not independent finer-grained observations — but it still gives a genuinely
    different value every 15 minutes instead of a flat step that only changes once an
    hour, which is what NOW/+30min/+60min/etc. need to look meaningfully distinct."""
    params = {
        "latitude": config.ANDHERI_LAT,
        "longitude": config.ANDHERI_LON,
        "minutely_15": "precipitation",
        "past_minutely_15": 12,      # 3 hours of history, in 15-min steps
        "forecast_minutely_15": 16,  # 4 hours ahead, in 15-min steps
        "timezone": "UTC",
    }
    resp = await client.get(OPEN_METEO_URL, params=params, timeout=10.0)
    resp.raise_for_status()
    return resp.json()


BUCKET_MINUTES = 15
BUCKETS_PER_HOUR = 60 // BUCKET_MINUTES     
BUCKETS_PER_3HR = 180 // BUCKET_MINUTES     


def _rain_features_from_series(times: list[str], precip_mm: list[float], now: datetime,
                                offset_min: int, bucket_minutes: int = BUCKET_MINUTES):
    """Turns a per-bucket precipitation series (bucket width = bucket_minutes) into the
    model's three dynamic rain features at `now + offset_min`:
      - rain_max_hourly_mm: the trailing 1-hour sum ending at that point — computed
        from however many buckets make up an hour at this source's resolution, so it
        actually changes at every bucket step instead of only once an hour.
      - rain_total_mm: the trailing 3-hour sum ending at that point.
      - rain_peak_3hr_mm: the highest 3-hour trailing sum found anywhere in the
        available series up to that point — a real rolling-max, not a copy of
        rain_total_mm. Stays elevated if a real spike happened earlier even after
        rain has since tapered off.
    """
    buckets_per_hour = max(1, 60 // bucket_minutes)
    buckets_per_3hr = max(1, 180 // bucket_minutes)

    target = now + timedelta(minutes=offset_min)
    parsed_times = [datetime.fromisoformat(t.replace("Z", "+00:00")).astimezone(timezone.utc) for t in times]

    idx = 0
    for i, t in enumerate(parsed_times):
        if t <= target:
            idx = i
        else:
            break

    hourly_window = precip_mm[max(0, idx - (buckets_per_hour - 1)): idx + 1]
    hourly_now = float(sum(hourly_window)) if hourly_window else 0.0

    trailing_window = precip_mm[max(0, idx - (buckets_per_3hr - 1)): idx + 1]
    total_3hr = float(sum(trailing_window)) if trailing_window else 0.0

    peak_3hr = 0.0
    for end in range(0, idx + 1):
        w = precip_mm[max(0, end - (buckets_per_3hr - 1)): end + 1]
        peak_3hr = max(peak_3hr, sum(w))

    return round(total_3hr, 2), round(hourly_now, 2), round(float(peak_3hr), 2)


async def _fetch_tomorrowio(client: httpx.AsyncClient) -> dict | None:
    """Tomorrow.io's Timelines API — 1-hour resolution, past 3h + forecast 4h, using
    a native regional model rather than Open-Meteo's hourly-interpolated minutely_15
    for India. Returns the raw parsed JSON, or raises on failure (caller handles
    fallback). Free tier: ~100 requests/day — fine at a 5-minute poll interval
    (~288/day) only if you raise WEATHER_POLL_INTERVAL_SECONDS; see README."""
    now = datetime.now(timezone.utc)
    body = {
        "location": f"{config.ANDHERI_LAT},{config.ANDHERI_LON}",
        "fields": ["precipitationIntensity"],
        "timesteps": ["1h"],
        "startTime": (now - timedelta(hours=3)).strftime("%Y-%m-%dT%H:00:00Z"),
        "endTime": (now + timedelta(hours=4)).strftime("%Y-%m-%dT%H:00:00Z"),
        "units": "metric",
    }
    resp = await client.post(
        TOMORROWIO_URL, params={"apikey": config.TOMORROWIO_API_KEY}, json=body, timeout=10.0,
    )
    resp.raise_for_status()
    data = resp.json()
    intervals = data["data"]["timelines"][0]["intervals"]
    times = [iv["startTime"] for iv in intervals]

    precip = [float(iv["values"]["precipitationIntensity"]) for iv in intervals]
    return times, precip


async def _fetch_worldtides(client: httpx.AsyncClient) -> dict | None:
    """Fetches tide extremes for the next 24 hours (not just 3) so the window reliably
    contains at least one real High tide — tides cycle roughly every ~12.4 hours, so a
    3-hour window frequently contains zero Highs (or nothing at all), which made
    correctly-fetched-but-empty results look identical to the fallback constant. Takes
    the highest High-tide height in that 24h window as max_tide_height_m, and counts
    Highs for num_high_tides — matching the semantics scripts/generate_scenarios.py's
    presets use (a "how much high-tide pressure is there today" signal), rather than
    an arbitrary short lookout window."""
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
    Prefers Tomorrow.io (1-hour resolution, native regional model) if
    TOMORROWIO_API_KEY is set; otherwise uses Open-Meteo (15-minute resolution,
    interpolated for India). Falls back to the documented constant if both fail.
    Returns (rain_now, rain_forecast_by_offset, rain_source). Never raises."""
    now = datetime.now(timezone.utc)
    rain_now = dict(FALLBACK_RAIN)
    rain_forecast = {off: dict(FALLBACK_RAIN) for off in config.FORECAST_OFFSETS_MIN}
    rain_source = "fallback"

    async with httpx.AsyncClient() as client:
        times, precip, bucket_minutes, source_name = None, None, BUCKET_MINUTES, None

        if config.TOMORROWIO_API_KEY:
            try:
                times, precip = await _fetch_tomorrowio(client)
                bucket_minutes, source_name = 60, "tomorrow.io"
            except Exception:
                logger.exception(
                    "Live rainfall fetch (Tomorrow.io) failed — falling back to Open-Meteo."
                )

        if times is None:
            try:
                payload = await _fetch_open_meteo(client)
                block = payload["minutely_15"]
                times, precip = block["time"], block["precipitation"]
                bucket_minutes, source_name = BUCKET_MINUTES, "open-meteo"
            except Exception:
                logger.exception(
                    "Live rainfall fetch (Open-Meteo) failed — falling back to the "
                    "documented baseline rainfall values used by scripts/generate_scenarios.py. "
                    "This is surfaced to clients via rain_source='fallback'."
                )

        if times is not None:
            for off in config.FORECAST_OFFSETS_MIN:
                total, hr, peak3 = _rain_features_from_series(times, precip, now, off, bucket_minutes)
                snap = {"rain_total_mm": total, "rain_max_hourly_mm": hr, "rain_peak_3hr_mm": peak3}
                rain_forecast[off] = snap
                if off == 0:
                    rain_now = snap
            rain_source = source_name

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
