import { Radio, FlaskConical } from "lucide-react";
import type { AppMode } from "../../types/flood";

interface ModeToggleProps {
  mode: AppMode;
  onChange: (mode: AppMode) => void;
}

/**
 * The [ LIVE ] [ SIMULATION ] switch (brief section D). A judge needs to find and use
 * this within seconds, so it's a plain, unambiguous segmented control rather than
 * anything clever.
 */
export function ModeToggle({ mode, onChange }: ModeToggleProps) {
  return (
    <div className="inline-flex p-0.5 bg-void rounded-lg border border-hairline">
      <button
        type="button"
        onClick={() => onChange("LIVE")}
        aria-pressed={mode === "LIVE"}
        className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-md text-xs font-semibold tracking-wide transition-colors ${
          mode === "LIVE" ? "bg-accent-soft text-accent" : "text-text-faint hover:text-text-muted"
        }`}
      >
        <Radio size={13} />
        LIVE
      </button>
      <button
        type="button"
        onClick={() => onChange("SIMULATION")}
        aria-pressed={mode === "SIMULATION"}
        className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-md text-xs font-semibold tracking-wide transition-colors ${
          mode === "SIMULATION" ? "bg-sim-soft text-sim" : "text-text-faint hover:text-text-muted"
        }`}
      >
        <FlaskConical size={13} />
        SIMULATION
      </button>
    </div>
  );
}
