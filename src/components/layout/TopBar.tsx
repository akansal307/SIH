import { RefreshCw, Droplets } from "lucide-react";
import type { AppMode, ConnectionStatus } from "../../types/flood";
import { ModeToggle } from "../controls/ModeToggle";
import { ConnectionStatusBadge } from "../common/ConnectionStatusBadge";
import { formatRelativeTime } from "../../utils/riskUtils";

interface TopBarProps {
  mode: AppMode;
  onModeChange: (mode: AppMode) => void;
  connection: ConnectionStatus;
  lastUpdated: string | null;
  onRefresh: () => void;
  isLoading: boolean;
}

export function TopBar({ mode, onModeChange, connection, lastUpdated, onRefresh, isLoading }: TopBarProps) {
  return (
    <header className="flex items-center justify-between gap-4 px-4 py-2.5 bg-panel border-b border-hairline shrink-0">
      <div className="flex items-center gap-3 min-w-0">
        <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-accent-soft text-accent shrink-0">
          <Droplets size={17} strokeWidth={2.25} />
        </div>
        <div className="min-w-0">
          <h1 className="font-display text-sm font-semibold tracking-wide text-text-primary leading-tight truncate">
            URBAN FLOOD NOWCAST
          </h1>
          <p className="text-[11px] text-text-faint leading-tight">Andheri, Mumbai — SIH26085</p>
        </div>
      </div>

      <div className="flex items-center gap-4 shrink-0">
        <div className="hidden sm:flex flex-col items-end leading-tight">
          <ConnectionStatusBadge mode={mode} connection={connection} />
          {mode === "LIVE" && (
            <span className="text-[10px] text-text-faint mt-0.5">
              {lastUpdated ? `Updated ${formatRelativeTime(lastUpdated)}` : "—"}
            </span>
          )}
        </div>

        {mode === "LIVE" && (
          <button
            type="button"
            onClick={onRefresh}
            disabled={isLoading}
            title="Refresh now"
            className="flex items-center justify-center w-8 h-8 rounded-lg border border-hairline text-text-muted hover:text-accent hover:border-accent-dim transition-colors disabled:opacity-40"
          >
            <RefreshCw size={14} className={isLoading ? "animate-spin" : ""} />
          </button>
        )}

        <ModeToggle mode={mode} onChange={onModeChange} />
      </div>
    </header>
  );
}
