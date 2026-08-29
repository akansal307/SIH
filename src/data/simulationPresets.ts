/**
 * Display metadata for the Simulation Mode preset buttons. This is deliberately a
 * frontend-only concept — "which buttons to show" is a UI decision, not backend
 * state, so there's no API round-trip just to render the panel. The actual risk
 * numbers behind each preset ALWAYS come from calling runSimulation(id) (floodApi.ts),
 * which fetches the real precomputed scenario (or, once wired up, a live backend
 * response) — nothing here is a source of truth for flood risk, only for labels.
 *
 * The `id` values must exactly match the `id` field of each entry in
 * SIMULATION_PRESETS in scripts/generate_scenarios.py — that's what runSimulation()
 * looks up. rainfall/duration/blockage shown here are for display only (e.g. the
 * preset card subtitle); mirrored from that script and should be kept in sync if the
 * script's numbers change.
 */

import type { SimulationScenarioInput } from "../types/flood";

export interface SimulationPresetMeta {
  id: string;
  label: string;
  shortDescription: string;
  rainfallMmHr: number;
  durationMin: number;
  blockagePercent: number;
}

export const SIMULATION_PRESET_META: SimulationPresetMeta[] = [
  {
    id: "normal_rain",
    label: "Normal Rain",
    shortDescription: "Typical monsoon drizzle",
    rainfallMmHr: 15,
    durationMin: 60,
    blockagePercent: 0,
  },
  {
    id: "heavy_rain",
    label: "Heavy Rain",
    shortDescription: "Sustained heavy showers",
    rainfallMmHr: 50,
    durationMin: 60,
    blockagePercent: 0,
  },
  {
    id: "drainage_stress_test",
    label: "Drainage Stress Test",
    shortDescription: "Calm now — crosses the model's real decision threshold by +60 min",
    rainfallMmHr: 45,
    durationMin: 120,
    blockagePercent: 0,
  },
  {
    id: "extreme_cloudburst",
    label: "Extreme Cloudburst",
    shortDescription: "Cloudburst-intensity downpour",
    rainfallMmHr: 120,
    durationMin: 60,
    blockagePercent: 0,
  },
  {
    id: "cloudburst_drain_blockage",
    label: "Cloudburst + Drain Blockage",
    shortDescription: "Extreme rain, silted storm drains",
    rainfallMmHr: 120,
    durationMin: 60,
    blockagePercent: 50,
  },
];

export function presetToSimulationInput(preset: SimulationPresetMeta): SimulationScenarioInput {
  return {
    scenario: preset.id,
    rainfallMmHr: preset.rainfallMmHr,
    durationMin: preset.durationMin,
    blockagePercent: preset.blockagePercent,
  };
}
