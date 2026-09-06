/**
 * The ONE module every component/hook talks to for flood data. Nothing else in this
 * app calls fetch() directly (brief section 12: "Do not call fetch() directly inside
 * every component. Centralize API behavior.").
 *
 * Behaviour:
 *  - If VITE_API_BASE_URL is set, every call tries the real backend first, using the
 *    exact endpoint paths documented in README.md "API Contract".
 *  - If it's unset, or the real call fails/times out, we fall back to the bundled mock
 *    data (src/data/mockFloodData.ts) and tag the result's `connection` field so the
 *    UI can show "LIVE DATA UNAVAILABLE — showing last known forecast" rather than
 *    silently presenting mock/stale data as live (brief section 13).
 *
 * Swapping to a real backend later means only implementing those endpoints — no
 * component in src/components needs to change.
 */

import type {
  ApiResult,
  FloodState,
  FloodStateWire,
  FloodZone,
  ForecastSnapshot,
  SimulationResult,
  SimulationPresetWire,
  SimulationScenarioInput,
  StreetRisk,
  StreetRiskWire,
  ZoneFeatureWire,
} from "../types/flood";
import { adaptFloodState, adaptSimulationPreset, adaptStreetRisk } from "./adapters";
import { API_BASE_URL, ApiError, fetchJson, IS_BACKEND_CONFIGURED } from "./client";
import {
  mockGetCurrentFloodState,
  mockGetForecast,
  mockGetZoneDetails,
  mockGetStreetRisks,
  mockRunSimulation,
} from "../data/mockFloodData";

// Last-known-good cache, kept in module scope so a failed poll can fall back to
// "showing last known forecast" (brief section 13) rather than blanking the UI.
let lastGoodCurrent: FloodState | null = null;
let lastGoodForecast: ForecastSnapshot[] | null = null;

export async function getCurrentFloodState(): Promise<ApiResult<FloodState>> {
  if (IS_BACKEND_CONFIGURED) {
    try {
      const wire = await fetchJson<FloodStateWire>(`${API_BASE_URL}/api/flood/current`);
      const data = adaptFloodState(wire);
      lastGoodCurrent = data;
      return { data, connection: "connected" };
    } catch (err) {
      return fallbackCurrent(err);
    }
  }
  return fallbackCurrent(null);
}

async function fallbackCurrent(err: unknown): Promise<ApiResult<FloodState>> {
  if (lastGoodCurrent) {
    return {
      data: lastGoodCurrent,
      connection: "offline",
      error: err instanceof Error ? err.message : "Backend not configured — showing last known forecast.",
    };
  }
  // No backend AND no prior successful fetch yet: serve mock data, clearly tagged.
  try {
    const data = await mockGetCurrentFloodState();
    return { data, connection: "mock" };
  } catch (mockErr) {
    throw mockErr instanceof ApiError ? mockErr : new ApiError("Unable to load flood data.", "network");
  }
}

export async function getForecast(): Promise<ApiResult<ForecastSnapshot[]>> {
  if (IS_BACKEND_CONFIGURED) {
    try {
      const wire = await fetchJson<FloodStateWire[]>(`${API_BASE_URL}/api/flood/forecast`);
      const data = wire.map(adaptFloodState);
      lastGoodForecast = data;
      return { data, connection: "connected" };
    } catch (err) {
      return fallbackForecast(err);
    }
  }
  return fallbackForecast(null);
}

async function fallbackForecast(err: unknown): Promise<ApiResult<ForecastSnapshot[]>> {
  if (lastGoodForecast) {
    return {
      data: lastGoodForecast,
      connection: "offline",
      error: err instanceof Error ? err.message : "Backend not configured — showing last known forecast.",
    };
  }
  const data = await mockGetForecast();
  return { data, connection: "mock" };
}

export async function runSimulation(input: SimulationScenarioInput): Promise<ApiResult<SimulationResult>> {
  if (IS_BACKEND_CONFIGURED) {
    try {
      const wire = await fetchJson<SimulationPresetWire>(`${API_BASE_URL}/api/flood/simulate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scenario: input.scenario,
          rainfall_mm_hr: input.rainfallMmHr,
          duration_min: input.durationMin,
          blockage_percent: input.blockagePercent,
        }),
        timeoutMs: 15000,
      });
      return { data: adaptSimulationPreset(wire), connection: "connected" };
    } catch {
      // Simulation has no meaningful "last known good" fallback (each run is a fresh
      // scenario) — fall through to mock so the demo can still proceed if the backend
      // is briefly unavailable, but say so plainly rather than pretending it's live.
      const data = await mockRunSimulation(input);
      return {
        data,
        connection: "mock",
        error: "Backend unavailable — showing precomputed demo scenario instead of a live model run.",
      };
    }
  }
  const data = await mockRunSimulation(input);
  return { data, connection: "mock" };
}

export async function getZoneDetails(zoneId: string): Promise<ApiResult<FloodZone | null>> {
  if (IS_BACKEND_CONFIGURED) {
    try {
      const wire = await fetchJson<ZoneFeatureWire>(`${API_BASE_URL}/api/flood/zones/${zoneId}`);
      const p = wire.properties;
      const data: FloodZone = {
        id: p.zone_id,
        name: p.zone_name,
        risk: p.risk,
        probability: p.probability,
        classProbabilities: p.class_probabilities,
        depthCm: p.depth_cm,
        onsetMinutes: p.onset_minutes,
        factors: {
          slope: p.factors.slope,
          distanceToWaterwayM: p.factors.distance_to_waterway_m,
          drainDensity: p.factors.drain_density,
          distanceToDrainM: p.factors.distance_to_drain_m,
          rainTotalMm: p.factors.rain_total_mm,
          rainMaxHourlyMm: p.factors.rain_max_hourly_mm,
          rainPeak3hrMm: p.factors.rain_peak_3hr_mm,
          maxTideHeightM: p.factors.max_tide_height_m,
          numHighTides: p.factors.num_high_tides,
        },
        edgeCount: p.edge_count,
        geometry: wire.geometry,
      };
      return { data, connection: "connected" };
    } catch {
      const data = await mockGetZoneDetails(zoneId);
      return { data, connection: "mock" };
    }
  }
  const data = await mockGetZoneDetails(zoneId);
  return { data, connection: "mock" };
}
let lastGoodStreetRisks: StreetRisk[] | null = null;

export async function getStreetRisks(): Promise<ApiResult<StreetRisk[]>> {
  if (IS_BACKEND_CONFIGURED) {
    try {
      const wire = await fetchJson<StreetRiskWire[]>(`${API_BASE_URL}/api/flood/streets`);
      const data = wire.map(adaptStreetRisk);
      lastGoodStreetRisks = data;
      return { data, connection: "connected" };
    } catch (err) {
      return fallbackStreetRisks(err);
    }
  }
  return fallbackStreetRisks(null);
}

async function fallbackStreetRisks(err: unknown): Promise<ApiResult<StreetRisk[]>> {
  if (lastGoodStreetRisks) {
    return {
      data: lastGoodStreetRisks,
      connection: "offline",
      error: err instanceof Error ? err.message : "Backend not configured — showing last known street forecast.",
    };
  }
  const data = await mockGetStreetRisks();
  return { data, connection: "mock" };
}
