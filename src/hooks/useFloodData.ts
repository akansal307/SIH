import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AppMode,
  ConnectionStatus,
  FloodState,
  FloodZone,
  ForecastSnapshot,
  SimulationResult,
  SimulationScenario,
} from "../types/flood";
import { getCurrentFloodState, getForecast } from "../api/floodApi";

/** Polling interval for LIVE mode. Brief section B: "Initial polling: 30-60 seconds
 * ... The actual polling interval should later be configurable according to the real
 * upstream data refresh rate." 45s sits in the middle of that range; change this one
 * constant when the real upstream cadence is known. */
export const LIVE_POLL_INTERVAL_MS = 45_000;

export interface UseFloodDataResult {
  mode: AppMode;
  setMode: (mode: AppMode) => void;

  /** The single FloodState currently being displayed — either the live/forecast
   * snapshot at `selectedOffset`, or the active simulation's snapshot at the same
   * offset, depending on `mode`. Every panel and the map read from this one value. */
  currentState: FloodState | null;
  forecast: ForecastSnapshot[];
  selectedOffset: number;
  selectOffset: (offsetMinutes: number) => void;

  connection: ConnectionStatus;
  isLoading: boolean;
  error: string | null;
  lastUpdated: string | null;

  selectedZoneId: string | null;
  selectZone: (zoneId: string | null) => void;
  selectedZone: FloodZone | null;

  activeSimulation: SimulationScenario | null;
  activeSimulationNotes: string[];
  applySimulationResult: (result: SimulationResult) => void;

  refreshNow: () => void;
}

export function useFloodData(): UseFloodDataResult {
  const [mode, setModeState] = useState<AppMode>("LIVE");

  const [liveCurrent, setLiveCurrent] = useState<FloodState | null>(null);
  const [liveForecast, setLiveForecast] = useState<ForecastSnapshot[]>([]);
  const [simulation, setSimulation] = useState<SimulationResult | null>(null);

  const [selectedOffset, setSelectedOffset] = useState(0);
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null);

  const [connection, setConnection] = useState<ConnectionStatus>("mock");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchLive = useCallback(async () => {
    setIsLoading(true);
    try {
      const [currentRes, forecastRes] = await Promise.all([getCurrentFloodState(), getForecast()]);
      setLiveCurrent(currentRes.data);
      setLiveForecast(forecastRes.data);
      setConnection(currentRes.connection);
      setError(currentRes.error ?? forecastRes.error ?? null);
      setLastUpdated(new Date().toISOString());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load flood data.");
      setConnection("offline");
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Initial load + LIVE-mode polling. Polling pauses entirely in SIMULATION mode
  // (brief: simulation is a controlled, judge-triggered scenario, not something that
  // should be silently overwritten by a live poll tick).
  useEffect(() => {
    if (mode !== "LIVE") {
      if (pollTimer.current) clearInterval(pollTimer.current);
      return;
    }
    fetchLive();
    pollTimer.current = setInterval(fetchLive, LIVE_POLL_INTERVAL_MS);
    return () => {
      if (pollTimer.current) clearInterval(pollTimer.current);
    };
  }, [mode, fetchLive]);

  const setMode = useCallback((next: AppMode) => {
    setModeState(next);
    setSelectedOffset(0);
    setSelectedZoneId(null);
    if (next === "LIVE") setSimulation(null);
  }, []);

  const applySimulationResult = useCallback((result: SimulationResult) => {
    setSimulation(result);
    setModeState("SIMULATION");
    setSelectedOffset(0);
    setSelectedZoneId(null);
  }, []);

  const forecast = mode === "SIMULATION" && simulation ? simulation.forecast : liveForecast;

  const currentState = useMemo(() => {
    if (forecast.length === 0) {
      return mode === "SIMULATION" ? simulation?.current ?? null : liveCurrent;
    }
    return forecast.find((f) => f.offsetMinutes === selectedOffset) ?? forecast[0];
  }, [forecast, selectedOffset, mode, simulation, liveCurrent]);

  const selectedZone = useMemo(() => {
    if (!currentState || !selectedZoneId) return null;
    return currentState.zones.find((z) => z.id === selectedZoneId) ?? null;
  }, [currentState, selectedZoneId]);

  return {
    mode,
    setMode,
    currentState,
    forecast,
    selectedOffset,
    selectOffset: setSelectedOffset,
    connection,
    isLoading,
    error,
    lastUpdated,
    selectedZoneId,
    selectZone: setSelectedZoneId,
    selectedZone,
    activeSimulation: mode === "SIMULATION" ? simulation?.scenario ?? null : null,
    activeSimulationNotes: mode === "SIMULATION" ? simulation?.scenario.modelNotes ?? [] : [],
    applySimulationResult,
    refreshNow: fetchLive,
  };
}
