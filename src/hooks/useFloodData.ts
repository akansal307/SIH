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
import {
  getCurrentFloodState,
  getForecast,
  getStreetRisks,
} from "../api/floodApi";

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
  selectStreet: (
    edgeId: string | null,
    point?: [number, number] | null
  ) => void;
  selectedStreet: StreetRisk | null;

  activeSimulation: SimulationScenario | null;
  activeSimulationNotes: string[];
  applySimulationResult: (result: SimulationResult) => void;

  refreshNow: () => void;
}

export function useFloodData(): UseFloodDataResult {
  const [mode, setModeState] = useState<AppMode>("LIVE");

  const [liveCurrent, setLiveCurrent] =
    useState<FloodState | null>(null);
  const [liveForecast, setLiveForecast] =
    useState<ForecastSnapshot[]>([]);
  const [simulation, setSimulation] =
    useState<SimulationResult | null>(null);

  const [selectedOffset, setSelectedOffset] = useState(0);
  const [selectedZoneId, setSelectedZoneId] =
    useState<string | null>(null);

  const [streetRisks, setStreetRisks] =
    useState<StreetRisk[]>([]);
  const [selectedStreetId, setSelectedStreetId] =
    useState<string | null>(null);
  const [selectedStreetPoint, setSelectedStreetPoint] =
    useState<[number, number] | null>(null);

  const [connection, setConnection] =
    useState<ConnectionStatus>("mock");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] =
    useState<string | null>(null);
  const [lastUpdated, setLastUpdated] =
    useState<string | null>(null);

  const pollTimer =
    useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchLive = useCallback(async () => {
    setIsLoading(true);

    try {
      const [currentRes, forecastRes] =
        await Promise.all([
          getCurrentFloodState(),
          getForecast(),
        ]);

      setLiveCurrent(currentRes.data);
      setLiveForecast(forecastRes.data);

      setConnection(currentRes.connection);

      setError(
        currentRes.error ??
          forecastRes.error ??
          null
      );

      setLastUpdated(new Date().toISOString());
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to load flood data."
      );

      setConnection("offline");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (mode !== "LIVE") {
      if (pollTimer.current) {
        clearInterval(pollTimer.current);
      }

      return;
    }

    fetchLive();

    pollTimer.current = setInterval(
      fetchLive,
      LIVE_POLL_INTERVAL_MS
    );

    return () => {
      if (pollTimer.current) {
        clearInterval(pollTimer.current);
      }
    };
  }, [mode, fetchLive]);

  // Load per-street flood risks.
  useEffect(() => {
    getStreetRisks()
      .then((res) => {
        setStreetRisks(res.data);

        if (res.error) {
          setError(res.error);
        }
      })
      .catch((err) => {
        setError(
          err instanceof Error
            ? err.message
            : "Failed to load street flood risks."
        );

        setStreetRisks([]);
      });
  }, []);

  const setMode = useCallback(
    (next: AppMode) => {
      setModeState(next);
      setSelectedOffset(0);
      setSelectedZoneId(null);
      setSelectedStreetId(null);
      setSelectedStreetPoint(null);

      if (next === "LIVE") {
        setSimulation(null);
      }
    },
    []
  );

  const applySimulationResult = useCallback(
    (result: SimulationResult) => {
      setSimulation(result);
      setModeState("SIMULATION");
      setSelectedOffset(0);
      setSelectedZoneId(null);
      setSelectedStreetId(null);
      setSelectedStreetPoint(null);
    },
    []
  );

  const selectStreet = useCallback(
    (
      edgeId: string | null,
      point?: [number, number] | null
    ) => {
      setSelectedStreetId(edgeId);
      setSelectedStreetPoint(point ?? null);
    },
    []
  );

  const forecast =
    mode === "SIMULATION" && simulation
      ? simulation.forecast
      : liveForecast;

  const currentState = useMemo(() => {
    if (forecast.length === 0) {
      return mode === "SIMULATION"
        ? simulation?.current ?? null
        : liveCurrent;
    }

    return (
      forecast.find(
        (f) => f.offsetMinutes === selectedOffset
      ) ?? forecast[0]
    );
  }, [
    forecast,
    selectedOffset,
    mode,
    simulation,
    liveCurrent,
  ]);

  const selectedZone = useMemo(() => {
    if (!currentState || !selectedZoneId) {
      return null;
    }

    return (
      currentState.zones.find(
        (z) => z.id === selectedZoneId
      ) ?? null
    );
  }, [currentState, selectedZoneId]);

  // Which street-risk dataset is "active": the simulated scenario's own
  // per-street risk while in SIMULATION mode, otherwise the live-polled one.
  // Previously the map always used the live-polled streetRisks state, even
  // during a simulation run, which is why e.g. an Extreme Cloudburst run
  // showed correctly red zones but streets that stayed live-weather green.
  const effectiveStreetRisks = useMemo(() => {
    if (mode === "SIMULATION" && simulation) {
      return simulation.streets ?? [];
    }
    return streetRisks;
  }, [mode, simulation, streetRisks]);

 const selectedStreet = useMemo(() => {
  if (!selectedStreetId) {
    return null;
  }

  const street = effectiveStreetRisks.find(
    (s) => s.edgeId === selectedStreetId
  );

  if (!street) {
    return null;
  }

  /*
   * The map displays street color according to the containing zone.
   * Use the same zone risk for the selected street so Street Details
   * and RoutePanel never contradict what the user sees on the map.
   */
  const zone = selectedZone;

  if (!zone) {
    return street;
  }

  return {
    ...street,
    risk: zone.risk,
    probability: zone.probability,
    onsetMinutes: zone.onsetMinutes,
  };
}, [
  effectiveStreetRisks,
  selectedStreetId,
  selectedZone,
]);
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

    streetRisks: effectiveStreetRisks,
    selectedStreetId,
    selectedStreetPoint,
    selectStreet,
    selectedStreet,

    activeSimulation:
      mode === "SIMULATION"
        ? simulation?.scenario ?? null
        : null,

    activeSimulationNotes:
      mode === "SIMULATION"
        ? simulation?.scenario.modelNotes ?? []
        : [],

    applySimulationResult,
    refreshNow: fetchLive,
  };
}
