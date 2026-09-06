import type { RiskLevel } from "../types/flood";

/**
 * Single source of truth for risk -> colour/label mapping. Every component that
 * needs a risk colour (map layers, badges, alert cards, legend) imports from here,
 * per the brief's instruction not to scatter classification/threshold logic across
 * components.
 *
 * Colours match the CSS custom properties in src/index.css (--color-risk-*), kept in
 * sync manually because MapLibre paint expressions need literal hex strings, not CSS
 * vars. If you change one, change the other.
 */
export const RISK_COLORS: Record<RiskLevel, string> = {
  LOW: "#3fa34d",
  MODERATE: "#e0a030",
  HIGH: "#d6473f",
};

export const RISK_SOFT_COLORS: Record<RiskLevel, string> = {
  LOW: "#16281a",
  MODERATE: "#2b2113",
  HIGH: "#2c1715",
};

export const RISK_RANK: Record<RiskLevel, number> = { LOW: 0, MODERATE: 1, HIGH: 2 };

export const RISK_LABELS: Record<RiskLevel, string> = {
  LOW: "Low",
  MODERATE: "Moderate",
  HIGH: "High",
};

export function riskAtLeast(a: RiskLevel, b: RiskLevel): boolean {
  return RISK_RANK[a] >= RISK_RANK[b];
}

export function worstRisk(risks: RiskLevel[]): RiskLevel {
  return risks.reduce<RiskLevel>((worst, r) => (RISK_RANK[r] > RISK_RANK[worst] ? r : worst), "LOW");
}

/** Human-readable label for a raw model feature key, per the brief's instruction not
 * to expose variable names like `distance_to_drain_m` directly in the UI. */
export const FACTOR_LABELS: Record<string, string> = {
  slope: "Ground slope",
  distanceToWaterwayM: "Distance to waterway",
  drainDensity: "Drain density nearby",
  distanceToDrainM: "Distance to drainage",
  rainTotalMm: "Rain accumulated",
  rainMaxHourlyMm: "Peak rain intensity",
  rainPeak3hrMm: "3-hour peak rainfall",
  maxTideHeightM: "Max tide height",
  numHighTides: "High tides in window",
};

export function formatFactorValue(key: string, value: number): string {
  switch (key) {
    case "slope":
      return `${(value * 100).toFixed(1)}%`;
    case "distanceToWaterwayM":
    case "distanceToDrainM":
      return `${Math.round(value)} m`;
    case "drainDensity":
      return value.toFixed(2);
    case "rainTotalMm":
    case "rainMaxHourlyMm":
    case "rainPeak3hrMm":
      return `${value.toFixed(1)} mm`;
    case "maxTideHeightM":
      return `${value.toFixed(1)} m`;
    case "numHighTides":
      return `${Math.round(value)}`;
    default:
      return `${value}`;
  }
}

export function formatMinutes(mins: number | null): string {
  if (mins === null) return "—";
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h} hr` : `${h} hr ${m} min`;
}

/**
 * Single source of truth for rendering a depth value anywhere in the UI. Always
 * reflects whatever the active FloodState/FloodZone actually returned for the
 * currently selected zone, offset, and mode — never a fixed fallback. If a future
 * backend response omits depth (null/undefined), this is the one place that decides
 * to show "Not Available" rather than inventing or defaulting to a number.
 */
export function formatDepth(cm: number | null | undefined): string {
  if (cm === null || cm === undefined || Number.isNaN(cm)) return "Not Available";
  return `${cm.toFixed(0)} cm`;
}

export function formatRelativeTime(isoTimestamp: string, nowMs: number = Date.now()): string {
  const diffMs = nowMs - new Date(isoTimestamp).getTime();
  const diffSec = Math.round(diffMs / 1000);
  if (diffSec < 5) return "just now";
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin} min ago`;
  const diffHr = Math.round(diffMin / 60);
  return `${diffHr} hr ago`;
}

export function formatClockTime(isoTimestamp: string): string {
  return new Date(isoTimestamp).toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}
