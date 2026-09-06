import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AppMode,
  ConnectionStatus,
  FloodState,
  FloodZone,
  ForecastSnapshot,
  SimulationResult,
  SimulationScenario,
  StreetRisk,
} from "../types/flood";
import { getCurrentFloodState, getForecast, getStreetRisks } from "../api/floodApi";

export const LIVE_POLL_INTERVAL_MS = 45_000;

export interface UseFloodDataResult {
  mode: AppMode;
  setMode: (mode: AppMode) => void;

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

  streetRisks: StreetRisk[];
  selectedStreetId: string | null;
  selectedStreetPoint: [number, number] | null;
  selectStreet: (edgeId: string | null, point?: [number, number] | null) => void;
  selectedStreet: StreetRisk | null;

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

  const [streetRisks, setStreetRisks] = useState<StreetRisk[]>([]);
  const [selectedStreetId, setSelectedStreetId] = useState<string | null>(null);
  const [selectedStreetPoint, setSelectedStreetPoint] = useState<[number, number] | null>(null);

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

  useEffect(() => {
    getStreetRisks().then((res) => setStreetRisks(res.data));
  }, []);

  const setMode = useCallback((next: AppMode) => {
    setModeState(next);
    setSelectedOffset(0);
    setSelectedZoneId(null);
    setSelectedStreetId(null);
    setSelectedStreetPoint(null);
    if (next === "LIVE") setSimulation(null);
  }, []);

  const applySimulationResult = useCallback((result: SimulationResult) => {
    setSimulation(result);
    setModeState("SIMULATION");
    setSelectedOffset(0);
    setSelectedZoneId(null);
    setSelectedStreetId(null);
    setSelectedStreetPoint(null);
  }, []);

  const selectStreet = useCallback((edgeId: string | null, point?: [number, number] | null) => {
    setSelectedStreetId(edgeId);
    setSelectedStreetPoint(point ?? null);
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

  const selectedStreet = useMemo(() => {
    if (!selectedStreetId) return null;
    return streetRisks.find((s) => s.edgeId === selectedStreetId) ?? null;
  }, [streetRisks, selectedStreetId]);

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
    streetRisks,
    selectedStreetId,
    selectedStreetPoint,
    selectStreet,
    selectedStreet,
    activeSimulation: mode === "SIMULATION" ? simulation?.scenario ?? null : null,
    activeSimulationNotes: mode === "SIMULATION" ? simulation?.scenario.modelNotes ?? [] : [],
    applySimulationResult,
    refreshNow: fetchLive,
  };
}
