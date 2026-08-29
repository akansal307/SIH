import { useCallback, useState } from "react";
import type { SimulationResult } from "../types/flood";
import { runSimulation } from "../api/floodApi";
import { presetToSimulationInput, SIMULATION_PRESET_META, type SimulationPresetMeta } from "../data/simulationPresets";

export interface UseSimulationResult {
  presets: SimulationPresetMeta[];
  selectedPresetId: string | null;
  isRunning: boolean;
  error: string | null;
  /** Set when the run succeeded but had to fall back to precomputed demo data because
   * a configured backend was unreachable — surfaced as a small inline note, not an
   * error, so the demo can still proceed (brief: judging may happen without live
   * connectivity). */
  fallbackNote: string | null;
  run: (presetId: string, onResult: (result: SimulationResult) => void) => Promise<void>;
}

/**
 * Owns the "which preset is selected, is a run in flight, did it fail" state for
 * SimulationPanel. Deliberately does NOT own the resulting FloodState/forecast data
 * itself — that's applied straight into useFloodData via the `onResult` callback, so
 * there is exactly one place (useFloodData) holding "what's currently displayed."
 */
export function useSimulation(): UseSimulationResult {
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fallbackNote, setFallbackNote] = useState<string | null>(null);

  const run = useCallback(async (presetId: string, onResult: (result: SimulationResult) => void) => {
    const preset = SIMULATION_PRESET_META.find((p) => p.id === presetId);
    if (!preset) {
      setError(`Unknown scenario "${presetId}".`);
      return;
    }
    setSelectedPresetId(presetId);
    setIsRunning(true);
    setError(null);
    setFallbackNote(null);
    try {
      const res = await runSimulation(presetToSimulationInput(preset));
      onResult(res.data);
      if (res.connection === "mock" && res.error) {
        setFallbackNote(res.error);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to run simulation.");
    } finally {
      setIsRunning(false);
    }
  }, []);

  return { presets: SIMULATION_PRESET_META, selectedPresetId, isRunning, error, fallbackNote, run };
}
