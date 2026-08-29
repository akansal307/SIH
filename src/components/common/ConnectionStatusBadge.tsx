import { Radio, WifiOff, FlaskConical } from "lucide-react";
import type { AppMode, ConnectionStatus } from "../../types/flood";

interface ConnectionStatusBadgeProps {
  mode: AppMode;
  connection: ConnectionStatus;
}

/**
 * Small status pill in the top bar. Deliberately distinguishes "mock" (no backend
 * configured — normal for local dev, not alarming) from "offline" (a backend WAS
 * configured and failed — this is the brief section 13 "LIVE DATA UNAVAILABLE" case
 * and should read as a warning, not routine).
 */
export function ConnectionStatusBadge({ mode, connection }: ConnectionStatusBadgeProps) {
  if (mode === "SIMULATION") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-sim">
        <FlaskConical size={13} />
        Simulation
      </span>
    );
  }

  if (connection === "connected") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-risk-low">
        <span className="relative flex w-2 h-2">
          <span className="absolute inline-flex w-full h-full rounded-full bg-risk-low animate-live-pulse" />
        </span>
        Live
      </span>
    );
  }

  if (connection === "mock") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-accent">
        <Radio size={13} />
        Live (demo data)
      </span>
    );
  }

  // offline / degraded
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-risk-high">
      <WifiOff size={13} />
      Data unavailable
    </span>
  );
}
