/**
 * Mock/dev data source. Loads the two static JSON bundles this repo ships with
 * (public/data/scenarios.json, public/data/routes.json — see scripts/generate_scenarios.py
 * and scripts/build_routes.py for how they were produced from the REAL model + REAL
 * Andheri road graph) and serves them through the same shape floodApi.ts / routeApi.ts
 * expect from a real backend.
 *
 * Important: this is not hand-authored fake data. Every zone risk value here is the
 * actual flood_nowcast_model.pkl's output for a documented rainfall scenario run
 * against the real, precomputed geography of Andheri's 33 zones. Only the rainfall/tide
 * *inputs* are synthetic (the real backend doesn't exist yet to supply live ones). See
 * README.md "Model Behaviour Notes" for the full, honest breakdown of what's real vs.
 * assumed.
 *
 * Both JSON files are fetched (not statically imported) so they behave like real
 * network responses — including exercising the same loading states components use for
 * a real backend — and so the ~4MB road-network GeoJSON doesn't bloat the JS bundle.
 */

import type {
  FloodDataBundle,
  FloodState,
  ForecastSnapshot,
  RouteRecommendation,
  ScenariosBundleWire,
  RoutesBundleWire,
  SimulationScenarioInput,
  SimulationResult,
} from "../types/flood";
import {
  adaptFloodState,
  adaptModelInfo,
  adaptRoute,
  adaptSimulationPreset,
  adaptZoneMeta,
} from "../api/adapters";
import { fetchJson } from "../api/client";

let bundlePromise: Promise<FloodDataBundle> | null = null;
let routesPromise: Promise<RouteRecommendation[]> | null = null;

async function loadBundleUncached(): Promise<FloodDataBundle> {
  const wire = await fetchJson<ScenariosBundleWire>("/data/scenarios.json", { timeoutMs: 15000 });
  return {
    generatedAt: wire.generated_at,
    modelInfo: adaptModelInfo(wire.model_info),
    liveDefault: {
      current: adaptFloodState(wire.live_default.current),
      forecast: wire.live_default.forecast.map(adaptFloodState),
    },
    simulationPresets: wire.simulation_presets.map(adaptSimulationPreset),
    zonesMeta: wire.zones_meta.map(adaptZoneMeta),
  };
}

/** Loads once per page session; every caller shares the same in-flight/resolved
 * promise instead of re-fetching the ~1MB bundle repeatedly. */
export function loadMockBundle(): Promise<FloodDataBundle> {
  if (!bundlePromise) bundlePromise = loadBundleUncached();
  return bundlePromise;
}

export function loadMockRoutes(): Promise<RouteRecommendation[]> {
  if (!routesPromise) {
    routesPromise = fetchJson<RoutesBundleWire>("/data/routes.json", { timeoutMs: 15000 }).then((wire) =>
      wire.routes.map(adaptRoute)
    );
  }
  return routesPromise;
}

/** Re-stamps a state's timestamp to "now" (offset-adjusted) so the LIVE badge's
 * "last updated" reads naturally across a real polling session, without pretending the
 * underlying risk numbers are re-computed live (they are precomputed — see module
 * docstring). A real backend response would carry a genuinely fresh timestamp instead. */
function restamp<T extends FloodState>(state: T, baseNow: number): T {
  const timestamp = new Date(baseNow + state.offsetMinutes * 60_000).toISOString();
  return { ...state, timestamp };
}

export async function mockGetCurrentFloodState(): Promise<FloodState> {
  const bundle = await loadMockBundle();
  return restamp(bundle.liveDefault.current, Date.now());
}

export async function mockGetForecast(): Promise<ForecastSnapshot[]> {
  const bundle = await loadMockBundle();
  const now = Date.now();
  return bundle.liveDefault.forecast.map((snap) => restamp(snap, now));
}

export async function mockRunSimulation(input: SimulationScenarioInput): Promise<SimulationResult> {
  const bundle = await loadMockBundle();
  const preset = bundle.simulationPresets.find((p) => p.scenario.id === input.scenario);
  if (!preset) {
    throw new Error(
      `Unknown simulation scenario "${input.scenario}". Available presets: ` +
        bundle.simulationPresets.map((p) => p.scenario.id).join(", ")
    );
  }
  // Mock mode can only serve the precomputed preset's own parameters — arbitrary
  // custom rainfall/duration/blockage values need a real backend inference call. We
  // still accept the fuller SimulationScenarioInput shape so this function signature
  // doesn't need to change when a real backend is wired in (see floodApi.ts).
  const now = Date.now();
  return {
    scenario: preset.scenario,
    current: restamp(preset.current, now),
    forecast: preset.forecast.map((snap) => restamp(snap, now)),
  };
}

export async function mockGetZoneDetails(zoneId: string): Promise<FloodState["zones"][number] | null> {
  const bundle = await loadMockBundle();
  const pools = [bundle.liveDefault.current, ...bundle.simulationPresets.map((p) => p.current)];
  for (const state of pools) {
    const match = state.zones.find((z) => z.id === zoneId);
    if (match) return match;
  }
  return null;
}

export async function mockGetSafeRoute(routeId?: string): Promise<RouteRecommendation | null> {
  const routes = await loadMockRoutes();
  if (routeId) return routes.find((r) => r.id === routeId) ?? null;
  return routes[0] ?? null;
}

export async function mockGetAllRoutes(): Promise<RouteRecommendation[]> {
  return loadMockRoutes();
}
