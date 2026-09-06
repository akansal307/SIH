/**
 * Translates the backend wire contract (snake_case, see types/flood.ts `*Wire` types
 * and README.md "API Contract") into the camelCase app-facing types every component
 * uses. This is the ONE place that needs to change if the real backend's field names
 * ever drift from what's documented — nothing else in the app touches wire shapes.
 *
 * Both the bundled mock data (public/data/scenarios.json, routes.json) and a real
 * backend are expected to speak the same wire shape, so this adapter works for either
 * without modification — that's the whole point of isolating it here.
 */

import type {
  Alert,
  AlertWire,
  FloodState,
  FloodStateWire,
  FloodZone,
  ModelInfo,
  ModelInfoWire,
  RouteOption,
  RouteOptionWire,
  RouteRecommendation,
  RouteExampleWire,
  SimulationPresetWire,
  SimulationResult,
  ZoneFeatureWire,
  ZoneMeta,
  ZoneMetaWire,
} from "../types/flood";

function adaptZone(feature: ZoneFeatureWire): FloodZone {
  const p = feature.properties;
  return {
    id: p.zone_id,
    name: p.zone_name,
    risk: p.risk,
    probability: p.probability,
    classProbabilities: {
      low: p.class_probabilities.low,
      moderate: p.class_probabilities.moderate,
      high: p.class_probabilities.high,
    },
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
    geometry: feature.geometry,
  };
}

function adaptAlert(a: AlertWire): Alert {
  return {
    id: a.id,
    zoneId: a.zone_id,
    zoneName: a.zone_name,
    severity: a.severity,
    depthCm: a.depth_cm,
    onsetMinutes: a.onset_minutes,
    message: a.message,
    issuedAt: a.issued_at,
  };
}

export function adaptFloodState(s: FloodStateWire): FloodState {
  return {
    timestamp: s.timestamp,
    offsetMinutes: s.offset_minutes,
    label: s.label,
    rainfallMmHr: s.rainfall_mm_hr,
    overallRisk: s.overall_risk,
    maxDepthCm: s.max_depth_cm,
    affectedZones: s.affected_zones,
    earliestOnsetMinutes: s.earliest_onset_minutes,
    zones: s.zones.features.map(adaptZone),
    alerts: s.alerts.map(adaptAlert),
  };
}

export function adaptSimulationPreset(p: SimulationPresetWire): SimulationResult {
  return {
    scenario: {
      id: p.id,
      label: p.label,
      description: p.description,
      rainfallMmHr: p.rainfall_mm_hr,
      durationMin: p.duration_min,
      blockagePercent: p.blockage_percent,
      maxTideHeightM: p.max_tide_height_m,
      numHighTides: p.num_high_tides,
      modelNotes: p.model_notes,
    },
    current: adaptFloodState(p.current),
    forecast: p.forecast.map(adaptFloodState),
  };
}

export function adaptModelInfo(m: ModelInfoWire): ModelInfo {
  return {
    modelType: m.model_type,
    featureColumns: m.feature_columns,
    thresholds: { yellow: m.thresholds.yellow_threshold, red: m.thresholds.red_threshold },
    classToRiskMapping: m.class_to_risk_mapping,
    classMappingConfidence: m.class_mapping_confidence,
    measuredRainfallDecisionBoundaryMm: m.measured_rainfall_decision_boundary_mm,
    measuredBoundaryNote: m.measured_boundary_note,
    assumptions: m.assumptions,
  };
}

export function adaptZoneMeta(z: ZoneMetaWire): ZoneMeta {
  return { zoneId: z.zone_id, name: z.name, centroid: z.centroid };
}

function adaptRouteOption(r: RouteOptionWire): RouteOption {
  return {
    type: r.type,
    durationMin: r.duration_min,
    distanceKm: r.distance_km,
    risk: r.risk,
    geometry: r.geometry,
  };
}

export function adaptRoute(r: RouteExampleWire): RouteRecommendation {
  return {
    id: r.id,
    label: r.label,
    scenarioContext: r.scenario_context,
    fastest: adaptRouteOption(r.fastest),
    safe: adaptRouteOption(r.safe),
    recommendation: r.recommendation,
  };
}
export function adaptStreetRisk(wire: StreetRiskWire): StreetRisk {
  return {
    edgeId: wire.edge_id,
    risk: wire.risk,
    probability: wire.probability,
    depthCm: wire.depth_cm,
    onsetMinutes: wire.onset_minutes,
  };
}
