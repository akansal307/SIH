# Flood Nowcast Backend

A real FastAPI backend for the [frontend](../README.md), implementing exactly the four
steps of the brief:

1. **Load the Files** — `app/model_service.load_artifacts()` and
   `app/routing_service.load_graph()` load `flood_nowcast_model.pkl`,
   `flood_nowcast_thresholds.pkl`, `flood_nowcast_feature_cols.pkl`, `edge_cache.pkl`,
   and the road `.graphml` into memory **once**, at server startup — not per request.
   The 33-zone spatial grid is rebuilt live from `edge_cache.pkl` at startup (falls
   back to the checked-in `data/derived/zones_base.json` if `geopandas`/`shapely`
   aren't installed).
2. **Fetch Live Weather/Data** — a background `asyncio` task (`app/main.py::_poll_loop`)
   calls [Open-Meteo](https://open-meteo.com) (free, no API key) every
   `WEATHER_POLL_INTERVAL_SECONDS` (default 300s) for real rainfall at Andheri's
   coordinates, and optionally [WorldTides](https://www.worldtides.info) for tide
   extremes if you set `WORLDTIDES_API_KEY`. If either call fails, the server falls
   back to a documented constant (same honesty pattern as
   `scripts/generate_scenarios.py`'s `LIVE_BASELINE`) rather than crashing — check
   `GET /health` to see which source (`open-meteo`/`fallback`, `worldtides`/`fallback`)
   is actually live.
3. **Run Predictions** — `app/model_service.build_state_snapshot()` runs the real,
   unmodified LightGBM model against the real static zone features + the live rain/
   tide inputs. This is the exact same prediction logic `scripts/generate_scenarios.py`
   uses offline; nothing about the model is reimplemented.
4. **Serve an API Endpoint** — see below. Every route matches README.md's "API
   Contract" section byte-for-byte, so the existing frontend works against this
   backend with **zero frontend code changes** — just set `VITE_API_BASE_URL`.

## Quick start

```bash
cd backend
python -m venv .venv && source .venv/bin/activate     # optional but recommended
pip install -r requirements.txt
cp .env.example .env                                    # optional, has working defaults
uvicorn app.main:app --reload --port 8000
```

Then point the frontend at it:

```bash
# in the repo root
echo "VITE_API_BASE_URL=http://localhost:8000" >> .env
npm run dev
```

Check `curl http://localhost:8000/health` — `"status": "ok"` means the model, spatial
cache, and road graph all loaded and at least one live-weather refresh has completed
(possibly using the documented fallback, see `rain_source`/`tide_source`).

## Endpoints

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/flood/current` | Latest live snapshot (real model, live rainfall). |
| `GET` | `/api/flood/forecast` | 5 snapshots at +0/30/60/120/180 min, from Open-Meteo's own forecast. |
| `POST` | `/api/flood/simulate` | Body: `{scenario?, rainfall_mm_hr?, duration_min?, blockage_percent?, max_tide_height_m?, num_high_tides?}`. Pass a known `scenario` id (`normal_rain`, `heavy_rain`, `drainage_stress_test`, `extreme_cloudburst`, `cloudburst_drain_blockage`) or explicit `rainfall_mm_hr`+`duration_min` for a custom run. |
| `GET` | `/api/flood/zones/{zone_id}` | One zone's current `ZoneFeatureWire`, 404 if unknown. |
| `GET` | `/api/routes/safe?route_id=...` | Real Dijkstra fastest-vs-safe route for one of the 3 fixed demo pairs (`station-to-marol`, `around-tilak-marg`, `around-ns-road-5`), evaluated against the **current live** zone risk (not a frozen scenario). |
| `GET` | `/health` | Readiness + data-source provenance. |

## What's real vs. assumed here (read this)

Same spirit as the main README's "Model Behaviour Notes" — carried through to the live
backend:

- **Real:** the model, the 4 static zone features (from `edge_cache.pkl`), the class→
  risk mapping, live rainfall (when Open-Meteo is reachable), and route Dijkstra
  shortest paths on the real graph.
- **Assumed / heuristic, same as before:** `depth_cm`/`onset_minutes` (placeholder
  formula, not a model output), the class→risk label mapping (empirically inferred,
  see `scripts/verify_class_mapping.py`), and tide (constant fallback unless
  `WORLDTIDES_API_KEY` is set).
- **New assumption specific to this backend:** Open-Meteo's hourly precipitation series
  is apportioned into the model's `rain_total_mm` / `rain_max_hourly_mm` /
  `rain_peak_3hr_mm` features by summing the trailing 3 hourly buckets
  (`app/weather_service.py::_rain_features_from_hourly`) — a real-data-driven
  approximation, not a nowcast model. Swap in radar-extrapolation/NWP nowcast output
  here when available, per the main README's TODOs.
- **`/api/routes/safe`** currently re-runs Dijkstra on the full in-memory graph per
  request (fine for 3 fixed demo pairs; a production version serving many arbitrary
  routes per second would want to cache/index this).

## Deployment notes

- `WEATHER_POLL_INTERVAL_SECONDS` controls both live-data freshness and Open-Meteo/
  WorldTides call volume — 300s (5 min) is a reasonable default given weather data
  itself doesn't update much faster than that.
- Set `FRONTEND_ORIGIN` to your deployed frontend's real origin in production instead
  of the default `*`.
- The model was pickled with an older scikit-learn (`joblib.load` prints an
  `InconsistentVersionWarning` against `scikit-learn==1.8.0` in `requirements.txt`).
  It still loads and predicts correctly, but if you see different numbers than the
  offline `scripts/generate_scenarios.py` output, pin `scikit-learn` to match whatever
  version trained the model.
