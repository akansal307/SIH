/**
 * Domain types for the Andheri Urban Flood Nowcasting frontend (SIH26085).
 *
 * There are two families of types here, deliberately kept separate:
 *
 *  1. "Wire" types (`*Wire`) — the exact snake_case JSON shape the backend contract
 *     uses (see README.md "API Contract"). public/data/scenarios.json and
 *     public/data/routes.json are written in this shape on purpose, so the same
 *     adapter (src/api/adapters.ts) that reads our bundled mock data will also read a
 *     real backend response without changes.
 *
 *  2. App-facing types (everything else below) — camelCase, used by every component,
 *     hook, and util in this app. Components never see wire types directly.
 */

// ---------------------------------------------------------------------------
// Core enums (as string unions — this project targets erasable-syntax-only TS,
// so no `enum`)
// ---------------------------------------------------------------------------

export type RiskLevel = "LOW" | "MODERATE" | "HIGH";

export type AppMode = "LIVE" | "SIMULATION";

/** Where the data currently on screen actually came from. */
export type ConnectionStatus =
  | "connected" // live backend responded successfully
  | "mock" // no VITE_API_BASE_URL configured / dev mode — bundled mock data
  | "degraded" // backend reachable but returned stale/partial data
  | "offline"; // backend unreachable — showing last-known-good data

// ---------------------------------------------------------------------------
// Wire types — mirror the backend contract exactly (see README.md)
// ---------------------------------------------------------------------------

export interface ZoneFactorsWire {
  slope: number;
  distance_to_waterway_m: number;
  drain_density: number;
  distance_to_drain_m: number;
  rain_total_mm: number;
  rain_max_hourly_mm: number;
  rain_peak_3hr_mm: number;
  max_tide_height_m: number;
  num_high_tides: number;
}

export interface ZoneClassProbabilitiesWire {
  low: number;
  moderate: number;
  high: number;
}

export interface ZoneFeaturePropertiesWire {
  zone_id: string;
  zone_name: string;
  risk: RiskLevel;
  probability: number;
  class_probabilities: ZoneClassProbabilitiesWire;
  depth_cm: number;
  onset_minutes: number | null;
  factors: ZoneFactorsWire;
  edge_count: number;
}

export interface ZoneFeatureWire {
  type: "Feature";
  properties: ZoneFeaturePropertiesWire;
  geometry: GeoJSON.Geometry;
}

export interface ZonesFeatureCollectionWire {
  type: "FeatureCollection";
  features: ZoneFeatureWire[];
}

export interface AlertWire {
  id: string;
  zone_id: string;
  zone_name: string;
  severity: RiskLevel;
  depth_cm: number;
  onset_minutes: number | null;
  message: string;
  issued_at: string;
}

export interface FloodStateWire {
  timestamp: string;
  offset_minutes: number;
  label: string;
  rainfall_mm_hr: number;
  overall_risk: RiskLevel;
  max_depth_cm: number;
  affected_zones: number;
  earliest_onset_minutes: number | null;
  zones: ZonesFeatureCollectionWire;
  alerts: AlertWire[];
}

export interface SimulationPresetWire {
  id: string;
  label: string;
  description: string;
  rainfall_mm_hr: number;
  duration_min: number;
  blockage_percent: number;
  max_tide_height_m: number;
  num_high_tides: number;
  current: FloodStateWire;
  forecast: FloodStateWire[];
  model_notes: string[];
}

export interface ZoneMetaWire {
  zone_id: string;
  name: string;
  centroid: [number, number];
}

export interface ModelInfoWire {
  model_type: string;
  feature_columns: string[];
  thresholds: { yellow_threshold: number; red_threshold: number };
  class_to_risk_mapping: Record<string, RiskLevel>;
  class_mapping_confidence: string;
  measured_rainfall_decision_boundary_mm: number;
  measured_boundary_note: string;
  assumptions: string[];
}

export interface ScenariosBundleWire {
  generated_at: string;
  model_info: ModelInfoWire;
  live_default: { current: FloodStateWire; forecast: FloodStateWire[] };
  simulation_presets: SimulationPresetWire[];
  zones_meta: ZoneMetaWire[];
}

export interface RouteOptionWire {
  type: "fastest" | "safe";
  duration_min: number;
  distance_km: number;
  risk: RiskLevel;
  geometry: GeoJSON.Geometry;
}

export interface RouteExampleWire {
  id: string;
  label: string;
  scenario_context: string;
  fastest: RouteOptionWire;
  safe: RouteOptionWire;
  recommendation: "fastest" | "safe";
}

export interface RoutesBundleWire {
  note: string;
  routes: RouteExampleWire[];
}

// ---------------------------------------------------------------------------
// App-facing types
// ---------------------------------------------------------------------------

export interface ZoneFactors {
  slope: number;
  distanceToWaterwayM: number;
  drainDensity: number;
  distanceToDrainM: number;
  rainTotalMm: number;
  rainMaxHourlyMm: number;
  rainPeak3hrMm: number;
  maxTideHeightM: number;
  numHighTides: number;
}

export interface ClassProbabilities {
  low: number;
  moderate: number;
  high: number;
}

export interface FloodZone {
  id: string;
  name: string;
  risk: RiskLevel;
  /** P(risk >= MODERATE), i.e. overall probability this zone floods at all. */
  probability: number;
  classProbabilities: ClassProbabilities;
  depthCm: number;
  onsetMinutes: number | null;
  factors: ZoneFactors;
  edgeCount: number;
  geometry: GeoJSON.Geometry;
}

export interface Alert {
  id: string;
  zoneId: string;
  zoneName: string;
  severity: RiskLevel;
  depthCm: number;
  onsetMinutes: number | null;
  message: string;
  issuedAt: string;
}

export interface FloodState {
  timestamp: string;
  offsetMinutes: number;
  label: string;
  rainfallMmHr: number;
  overallRisk: RiskLevel;
  maxDepthCm: number;
  affectedZones: number;
  earliestOnsetMinutes: number | null;
  zones: FloodZone[];
  alerts: Alert[];
}

/** One step of the 0-180 minute forecast timeline. Structurally the same as
 * FloodState plus the offset/label used to render the timeline scrubber — kept as a
 * distinct alias so component props read clearly about intent. */
export type ForecastSnapshot = FloodState;

export interface SimulationScenario {
  id: string;
  label: string;
  description: string;
  rainfallMmHr: number;
  durationMin: number;
  blockagePercent: number;
  maxTideHeightM: number;
  numHighTides: number;
  modelNotes: string[];
}

export interface SimulationScenarioInput {
  scenario: string;
  rainfallMmHr: number;
  durationMin: number;
  blockagePercent: number;
}

export interface SimulationResult {
  scenario: SimulationScenario;
  current: FloodState;
  forecast: ForecastSnapshot[];
}

export interface RouteOption {
  type: "fastest" | "safe";
  durationMin: number;
  distanceKm: number;
  risk: RiskLevel;
  geometry: GeoJSON.Geometry;
}

export interface RouteRecommendation {
  id: string;
  label: string;
  scenarioContext: string;
  fastest: RouteOption;
  safe: RouteOption;
  recommendation: "fastest" | "safe";
}

export interface ModelInfo {
  modelType: string;
  featureColumns: string[];
  thresholds: { yellow: number; red: number };
  classToRiskMapping: Record<string, RiskLevel>;
  classMappingConfidence: string;
  measuredRainfallDecisionBoundaryMm: number;
  measuredBoundaryNote: string;
  assumptions: string[];
}

export interface ZoneMeta {
  zoneId: string;
  name: string;
  centroid: [number, number];
}

/** Everything the dashboard needs for one "session" of data: live defaults, every
 * simulation preset (already computed), and reference metadata. Loaded once. */
export interface FloodDataBundle {
  generatedAt: string;
  modelInfo: ModelInfo;
  liveDefault: { current: FloodState; forecast: ForecastSnapshot[] };
  simulationPresets: SimulationResult[];
  zonesMeta: ZoneMeta[];
}

// ---------------------------------------------------------------------------
// API layer wrapper
// ---------------------------------------------------------------------------

/** Every floodApi/routeApi call returns data tagged with where it actually came from,
 * so the UI can honestly represent live/mock/stale/offline state (brief section 13:
 * "never silently show stale data as if it were current") instead of the hook layer
 * having to guess. */
export interface ApiResult<T> {
  data: T;
  connection: ConnectionStatus;
  /** Present when connection is "offline"/"degraded" and `data` is a last-known-good
   * fallback rather than a fresh response. */
  error?: string;
}
