import { AlertOctagon, FlaskConical } from "lucide-react";
import type { AppMode, ConnectionStatus } from "../../types/flood";
import { formatRelativeTime } from "../../utils/riskUtils";

interface StatusBannerProps {
  mode: AppMode;
  connection: ConnectionStatus;
  lastUpdated: string | null;
}

/**
 * Full-width banner directly under the top bar — deliberately placed above every
 * panel rather than nested inside one, since both cases it handles (brief section 13
 * "never silently show stale data as current"; brief section D "the UI must clearly
 * state SIMULATION MODE — CONTROLLED SCENARIO") apply to the whole screen, not just
 * one card.
 */
export function StatusBanner({ mode, connection, lastUpdated }: StatusBannerProps) {
  if (mode === "SIMULATION") {
    return (
      <div className="flex items-center gap-2 px-4 py-1.5 bg-sim-soft border-b border-sim/30 text-sim text-xs font-semibold tracking-wide shrink-0">
        <FlaskConical size={13} />
        SIMULATION MODE — CONTROLLED SCENARIO. Values below are a triggered what-if
        scenario, not live sensor data.
      </div>
    );
  }

  if (connection === "offline" || connection === "degraded") {
    return (
      <div className="flex items-center gap-2 px-4 py-1.5 bg-risk-high-soft border-b border-risk-high/30 text-risk-high text-xs font-semibold tracking-wide shrink-0">
        <AlertOctagon size={13} />
        LIVE DATA UNAVAILABLE — {lastUpdated ? `last update ${formatRelativeTime(lastUpdated)}` : "no successful update yet"}.
        Showing last known forecast.
      </div>
    );
  }

  return null;
}
