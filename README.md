# Andheri Urban Flood Nowcast — SIH26085

A street-level, 0–3 hour urban flood nowcasting dashboard for Andheri, Mumbai, built for
Smart India Hackathon 2026, problem statement **SIH26085**.

This is the **frontend** for the project. It ships with a full mock/demo data layer so it
runs standalone with no backend — but every number in that demo layer comes from actually
running the team's real `flood_nowcast_model.pkl` against the real Andheri road network,
not hand-typed placeholder values. See [Model Behaviour Notes](#model-behaviour-notes)
below for exactly what's real and what's a documented assumption.

---

## Contents

- [Quick start](#quick-start)
- [What's real vs. assumed](#model-behaviour-notes)
- [Project structure](#project-structure)
- [How the demo data was generated](#how-the-demo-data-was-generated)
- [API contract](#api-contract) — connecting a real backend
- [Simulation mode](#simulation-mode)
- [Demo script](#demo-script)
- [Known issues](#known-issues)
- [Assumptions & TODOs](#assumptions--todos)

---

## Quick start

Requires Node.js 20+.

```bash
npm install
npm run dev
```

Open the printed local URL (typically `http://localhost:5173`). The app runs entirely on
bundled demo data (`public/data/*.json`) — no backend, no API keys, no configuration
needed. You should see the Andheri map load with 33 zones, mostly green, one amber
("chronic flood point" zone — see below), and a working Simulation Mode.

```bash
npm run build      # production build -> dist/
npm run preview    # serve the production build locally
```

### Regenerating the demo data

The three files in `public/data/` (`andheri_roads.geojson`, `scenarios.json`,
`routes.json`) are pre-generated and checked in — you don't need Python to run the
frontend. If you want to regenerate them (e.g. after retraining the model):

```bash
pip install -r scripts/requirements.txt --break-system-packages
python scripts/build_zones.py          # -> public/data/andheri_roads.geojson, data/derived/zones_base.json
python scripts/generate_scenarios.py   # -> public/data/scenarios.json (runs the REAL model)
python scripts/build_routes.py         # -> public/data/routes.json (real Dijkstra routing)
python scripts/verify_class_mapping.py # sanity-checks the LOW/MODERATE/HIGH class mapping
```

None of these scripts modify anything under `data/source/` (the five original model/data
files) — verify with `md5sum data/source/*.pkl "data/source/city_graph_with_elevation (1).graphml"`.

---

## Model Behaviour Notes

**What's real:**
- The model (`data/source/flood_nowcast_model.pkl`, an unmodified LightGBM 3-class
  classifier) is genuinely executed for every zone/scenario in `scenarios.json` — this
  isn't hand-authored mock data.
- The 4 static features per zone (`slope`, `drain_density`, `distance_to_drain_m`,
  `distance_to_waterway_m`) are real, aggregated from `edge_cache.pkl`'s real per-edge
  values across the actual Andheri road graph (3,936 nodes / 8,691 edges).
- The 33 zone names are derived from real OpenStreetMap road names in the graph (e.g.
  *"Western Express Highway x Swami Vivekanand Road"*), not invented.
- Route examples in `routes.json` are real Dijkstra shortest paths on the actual road
  graph, not fabricated numbers.

**What's assumed / heuristic (all flagged again inline in code):**
1. **Class → risk label mapping.** The model's `classes_` is `[0, 1, 2]` with no label
   metadata and no training code provided. We inferred `0=LOW, 1=MODERATE, 2=HIGH`
   empirically — see `scripts/verify_class_mapping.py` (runnable, ~2s, prints its
   evidence). **Please have whoever trained the model confirm this in one line.**
2. **Rainfall/tide values per simulation preset** are illustrative (chosen from the
   original frontend brief's own examples plus IMD-informed monsoon intensities), not
   measured data.
3. **`depth_cm` and `onset_minutes` are not model outputs.** The classifier only
   predicts a risk class + probabilities — it does not predict standing-water depth or
   time-to-onset. Both are derived by a small, documented placeholder formula
   (`scripts/generate_scenarios.py:depth_and_onset`) from the model's own class
   probabilities and the zone's real drainage proximity. **Replace with a real
   hydraulic/hydrologic model when available.**
4. **A real, measured finding, not a limitation of this frontend:** sweeping the actual
   model across realistic rainfall shows a near-binary decision cliff at **~76.7mm**
   accumulated rainfall (see `model_info.measured_boundary_note` in `scenarios.json`).
   Below it, the model reads almost entirely LOW/MODERATE; above it, most zones jump to
   HIGH. We tested `blockage_percent` (0–90%) at rainfall from 40mm to 76.9mm and it
   **does not shift this boundary** for these zones' real feature ranges — rainfall
   dominates the model's decision by roughly an order of magnitude in LightGBM split
   gain. Two consequences we chose to surface honestly rather than paper over:
   - **"Drainage Stress Test"** preset uses moderate, *still-falling* rain that is calm
     "now" and crosses that real ~76.7mm boundary around **+60 min** into the forecast —
     an honest demonstration of both the model's real decision boundary and genuine
     0–3h nowcasting lead time (the map visibly flips from green to red mid-timeline).
   - **"Cloudburst + Drain Blockage"** uses the original brief's own example numbers
     (120mm/hr, 60min, 50% blockage). At that rainfall the classification is already
     saturated — blockage's only measurable effect is a small depth/onset increase. The
     app surfaces this as an explicit `model_notes` string on that scenario rather than
     silently pretending blockage changed the outcome. This is a genuine limitation of
     the current feature set (no engineered blockage/capacity feature at training time)
     worth raising with the model team.
5. **One zone (`AND-06`, "N. S. Road No. 5 x Vaikunthlal Mehta Road") shows elevated
   risk even in LIVE mode's light-drizzle baseline.** This is the real model's output
   for a zone whose real static features put it 8.6m from a mapped waterway with ~0
   nearby drain density — a plausible chronic flood point, not a bug. Worth a sanity
   check against local knowledge of that intersection.
6. **Route examples are a small fixed set** (3 origin/destination pairs), not general
   geocoding/routing — see [Assumptions & TODOs](#assumptions--todos).

---

## Project structure

```
scripts/                     Python data pipeline (offline — not part of the app runtime)
  requirements.txt
  convert_graph_to_geojson.py  Raw GraphML -> GeoJSON (standalone, graph-only)
  build_zones.py               edge_cache.pkl -> roads GeoJSON + 33-zone grid w/ real static features
  generate_scenarios.py        Runs the REAL model over real zones for 5 presets + LIVE baseline
  build_routes.py              Real Dijkstra routing for 3 OD pairs
  verify_class_mapping.py      Empirical evidence for the LOW/MODERATE/HIGH class mapping

data/
  source/                    The 5 original files, UNTOUCHED (checksums preserved)
  derived/zones_base.json    Intermediate: 33 zone polygons + real static features (no rain yet)

public/data/                 Generated artifacts the frontend actually fetches at runtime
  andheri_roads.geojson      8,691 real road-segment features
  scenarios.json             LIVE baseline + 5 simulation presets, each with current + 5-step forecast
  routes.json                3 real fastest-vs-safe route examples

src/
  types/flood.ts             Wire types (backend contract) + app-facing camelCase types
  api/
    client.ts                 fetchJson() with timeout + typed errors; VITE_API_BASE_URL
    adapters.ts                Wire (snake_case) -> app (camelCase) translation — the ONE place
                                 that needs to change if the real backend's field names drift
    floodApi.ts                getCurrentFloodState / getForecast / runSimulation / getZoneDetails
                                 — tries real backend if configured, falls back to mock, tags
                                 every result with connection status (never silently shows stale
                                 data as live)
    routeApi.ts                getSafeRoute / getAllRoutes
  data/
    mockFloodData.ts           Loads/serves the bundled JSON in mock mode
    simulationPresets.ts       Frontend-only preset button metadata (labels), mirrors
                                 generate_scenarios.py's SIMULATION_PRESETS
  hooks/
    useFloodData.ts            Mode, polling (45s), forecast/offset selection, zone selection,
                                 connection/staleness state — the single source of truth for
                                 "what's currently displayed"
    useSimulation.ts           Preset selection + run-trigger state for SimulationPanel
  components/
    map/FloodMap.tsx           MapLibre GL map — see Known Issues re: maplibre-gl version pin
    map/MapLegend.tsx
    layout/TopBar.tsx, StatusBanner.tsx
    controls/ModeToggle.tsx, SimulationPanel.tsx
    panels/RiskPanel.tsx, WeatherPanel.tsx, LiveAlerts.tsx, ZoneDetails.tsx, RoutePanel.tsx
    timeline/ForecastTimeline.tsx
    common/                    RiskBadge, Panel, ConnectionStatusBadge, StateNotices
  utils/
    riskUtils.ts                Risk colour/label single source of truth, human-readable factor labels
    mapUtils.ts                 GeoJSON helpers, Andheri bounds/center
  App.tsx                     Top-level layout (top bar -> status banner -> map + right rail -> timeline)
```

---

## How the demo data was generated

```
data/source/*.pkl, GraphML         (original team assets — never modified)
        |
        v
scripts/build_zones.py             6x6 grid over the real bbox -> 33 zones (>=5 real edges each),
        |                          named from real OSM road intersections, static features
        |                          (slope/drain_density/distance_to_drain/distance_to_waterway)
        |                          aggregated from edge_cache.pkl's real per-edge values
        v
data/derived/zones_base.json       (rain-independent — geography only)
        |
        v
scripts/generate_scenarios.py      For LIVE baseline + 5 presets x 5 forecast offsets:
        |                          build the model's 9-feature input (4 real static +
        |                          5 scenario-derived dynamic) per zone, run the REAL
        |                          model, derive depth/onset/alerts
        v
public/data/scenarios.json         Frontend's mock "backend responses", real snake_case
                                    wire contract (see API Contract below)
```

`scripts/build_routes.py` runs independently, loading the raw GraphML directly and
computing real Dijkstra shortest paths for `public/data/routes.json`.

---

## API Contract

The frontend is built against this contract (`src/types/flood.ts` `*Wire` types are the
authoritative definition; `src/api/adapters.ts` is the only place that translates it).
**Any real backend only needs to match this shape** — nothing else in `src/components` or
`src/hooks` needs to change.

```
GET  /api/flood/current              -> FloodStateWire
GET  /api/flood/forecast             -> FloodStateWire[]        (5 snapshots, offsets 0/30/60/120/180)
POST /api/flood/simulate             -> SimulationPresetWire
     body: { scenario, rainfall_mm_hr, duration_min, blockage_percent }
GET  /api/flood/zones/{id}           -> ZoneFeatureWire
GET  /api/routes/safe?route_id=...   -> RouteExampleWire
```

`FloodStateWire` (current or one forecast snapshot):

```jsonc
{
  "timestamp": "2026-08-29T06:16:00Z",
  "offset_minutes": 0,
  "label": "NOW",
  "rainfall_mm_hr": 3.0,
  "overall_risk": "MODERATE",           // "LOW" | "MODERATE" | "HIGH"
  "max_depth_cm": 15.3,
  "affected_zones": 1,
  "earliest_onset_minutes": 24,          // or null
  "zones": { "type": "FeatureCollection", "features": [ /* ZoneFeatureWire */ ] },
  "alerts": [ /* AlertWire */ ]
}
```

Each zone is a GeoJSON `Feature` (Polygon) with:

```jsonc
{
  "properties": {
    "zone_id": "AND-06",
    "zone_name": "N. S. Road No. 5 x Vaikunthlal Mehta Road",
    "risk": "MODERATE",
    "probability": 0.6489,               // P(risk >= MODERATE), NOT confidence of predicted class
    "class_probabilities": { "low": 0.35, "moderate": 0.65, "high": 0.0 },
    "depth_cm": 15.3,
    "onset_minutes": 24,
    "factors": { "slope": 0.02, "distance_to_waterway_m": 8.6, "drain_density": 0.0,
                 "distance_to_drain_m": 54.7, "rain_total_mm": 2.25, "rain_max_hourly_mm": 3.0,
                 "rain_peak_3hr_mm": 2.25, "max_tide_height_m": 1.1, "num_high_tides": 0 },
    "edge_count": 143
  },
  "geometry": { "type": "Polygon", "coordinates": [...] }
}
```

Environment: set `VITE_API_BASE_URL` (see `.env.example`) to point at a real backend. Every
API function in `src/api/floodApi.ts` tries the real endpoint first, then falls back to the
bundled mock data — tagging the result's `connection` field (`connected` / `mock` /
`degraded` / `offline`) so the UI can show **"LIVE DATA UNAVAILABLE — showing last known
forecast"** rather than silently presenting stale data as current (this is wired end-to-end
already; see `StatusBanner.tsx`).

---

## Simulation Mode

Required because the SIH demo may happen on a dry day. Toggle **[ LIVE ] [ SIMULATION ]** in
the top bar. Selecting a preset only highlights it; the model only actually runs when you
press **Run Nowcast**, which calls the same `runSimulation()` function a real backend would
serve (no direct polygon-recolouring shortcuts — see `src/hooks/useSimulation.ts`).

| Preset | What it demonstrates |
|---|---|
| Normal Rain | Calm baseline, stays essentially all-clear |
| Heavy Rain | Two real zones show mild elevated risk |
| **Drainage Stress Test** | Calm at NOW — **crosses the model's real ~76.7mm decision boundary at +60 min**. Move the timeline slider to watch the map flip live. This is the single best demo of the 0–3h nowcasting value proposition. |
| Extreme Cloudburst | Immediate, dramatic HIGH risk across most zones |
| Cloudburst + Drain Blockage | Same rainfall as above; surfaces an honest `model_notes` explanation of blockage's real (limited) effect at that intensity |

---

## Demo script

1. Open in **LIVE** mode — Andheri map, current conditions, one real alert already
   showing (the AND-06 chronic-point zone).
2. Click that zone on the map (or its alert card) — Zone Details panel opens with
   human-readable factors, probability breakdown, depth/onset.
3. Switch to **SIMULATION** — banner appears, preset list shown.
4. Select **Drainage Stress Test**, click **Run Nowcast** — map starts mostly calm.
5. Move the forecast timeline to **+60 MIN** — watch the map flip from green to
   red/amber live, demonstrating genuine lead-time warning.
6. Switch to **Extreme Cloudburst**, **Run Nowcast** — immediate, dramatic city-wide
   HIGH risk (26/33 zones), for the "instant disaster" beat.
7. Open **Flood-Safe Route**, pick "Lokmanya Tilak Marg crossing" — a real computed
   detour (MODERATE -> LOW, +4 min) with a genuine "Use safe route" recommendation.
8. Return to **LIVE**.

---

## Known Issues

- **`maplibre-gl` is pinned to `^4.7.1`, not the latest `6.x`.** During development,
  `6.6.0`'s GeoJSON source worker did not reach a "loaded" state in a constrained
  (single-CPU-core) headless test environment — sources received valid data via
  `setData()` (confirmed via `querySourceFeatures`/serialize inspection) but never
  rendered, and the map's internal worker was observed being destroyed shortly after
  creation with no corresponding error event. `4.7.1` does not exhibit this in the same
  environment. This may be specific to constrained/low-core environments rather than a
  general `6.x` regression — if your dev/demo machine has more than 1 CPU core
  available (virtually certain for a laptop), it's worth trying `npm install
  maplibre-gl@latest` and re-testing before the actual SIH demo, but we shipped on the
  version we could actually verify end-to-end.
- **CARTO basemap tiles require outbound network access** to `basemaps.cartocdn.com`.
  If blocked (corporate firewall, offline venue), the map still works perfectly — zones,
  roads, and routes are separate same-origin/data sources and render regardless (this
  was a deliberate architecture decision, see `FloodMap.tsx` module docstring) — you'll
  just see a plain dark background instead of street-level basemap context.
- Production bundle is ~1MB, ~283KB gzipped, mostly `maplibre-gl` itself. Not
  code-split; fine for a demo, worth addressing (`React.lazy` around `FloodMap`) if this
  becomes a real deployed product.

---

## Assumptions & TODOs

- [ ] **Confirm the class-to-risk mapping** with the model training code/label encoder
      (`scripts/verify_class_mapping.py` gives strong circumstantial evidence but isn't
      a substitute for ground truth).
- [ ] Replace the placeholder `depth_cm`/`onset_minutes` heuristic with a real
      hydraulic/hydrologic model once available.
- [ ] Real rainfall nowcast ingestion (radar extrapolation / NWP) — `rain_features_at()`
      in `generate_scenarios.py` is a simple linear accumulation/recession placeholder.
- [ ] Real tide data ingestion (currently a scenario-level assumed constant).
- [ ] **Flood-safe routing is a fixed set of 3 demo OD pairs**, not general
      geocoding/routing to an arbitrary address — needs a real routing backend
      (`POST /api/routes/safe` already defined; `RoutePanel.tsx` is ready to consume a
      richer response without changes).
- [ ] Consider whether `blockage_percent`, as currently modelled (degrading effective
      `drain_density`/`distance_to_drain_m`), is the right proxy — our testing shows it
      has ~no effect on this model's classification in the tested range; a real
      engineered drainage-capacity feature at training time would likely do better.
- [ ] Wire up a real backend and confirm `VITE_API_BASE_URL` fallback/retry behaviour
      under real network conditions (currently only tested against the bundled mock
      data and simulated failures).
- [ ] Re-verify the `maplibre-gl` version pin (see Known Issues) on the actual
      demo/deployment hardware.
