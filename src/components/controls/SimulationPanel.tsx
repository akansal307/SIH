import { useState } from "react";
import { CloudRain, Info, Play, Loader2 } from "lucide-react";
import type { SimulationPresetMeta } from "../../data/simulationPresets";
import { Panel } from "../common/Panel";
import { InlineError } from "../common/StateNotices";

interface SimulationPanelProps {
  presets: SimulationPresetMeta[];
  isRunning: boolean;
  error: string | null;
  fallbackNote: string | null;
  activeNotes: string[];
  onRun: (presetId: string) => void;
}

/**
 * The judge-facing control for Simulation Mode (brief sections D/E/15). Selecting a
 * preset only highlights it (shows its rainfall/duration/blockage) — the model only
 * ever runs when "RUN NOWCAST" is pressed, which calls the same runSimulation() API
 * function a real backend would serve (brief section 15: no direct polygon-colouring
 * shortcuts).
 */
export function SimulationPanel({ presets, isRunning, error, fallbackNote, activeNotes, onRun }: SimulationPanelProps) {
  const [pendingId, setPendingId] = useState<string>(presets[0]?.id ?? "");
  const pending = presets.find((p) => p.id === pendingId) ?? presets[0];

  return (
    <Panel title="Simulation Controls" icon={<CloudRain size={13} />} className="border-sim/30">
      <div className="space-y-3">
        <div className="grid grid-cols-1 gap-1.5">
          {presets.map((preset) => {
            const isSelected = preset.id === pendingId;
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => setPendingId(preset.id)}
                className={`text-left rounded-md border px-2.5 py-2 transition-colors ${
                  isSelected ? "border-sim bg-sim-soft" : "border-hairline bg-panel-raised hover:bg-panel-raised-2"
                }`}
              >
                <div className={`text-xs font-semibold ${isSelected ? "text-sim" : "text-text-primary"}`}>
                  {preset.label}
                </div>
                <div className="text-[10px] text-text-faint mt-0.5">{preset.shortDescription}</div>
              </button>
            );
          })}
        </div>

        {pending && (
          <div className="flex items-center gap-3 text-[11px] font-mono text-text-muted bg-void rounded-md px-2.5 py-2">
            <span>{pending.rainfallMmHr} mm/hr</span>
            <span className="text-hairline">·</span>
            <span>{pending.durationMin} min</span>
            {pending.blockagePercent > 0 && (
              <>
                <span className="text-hairline">·</span>
                <span>{pending.blockagePercent}% blockage</span>
              </>
            )}
          </div>
        )}

        <button
          type="button"
          onClick={() => pending && onRun(pending.id)}
          disabled={isRunning || !pending}
          className="w-full flex items-center justify-center gap-2 rounded-md bg-sim text-void font-display font-semibold text-sm py-2.5 hover:brightness-110 transition-all disabled:opacity-50"
        >
          {isRunning ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />}
          {isRunning ? "Running nowcast…" : "Run Nowcast"}
        </button>

        {error && <InlineError message={error} />}

        {fallbackNote && (
          <div className="flex items-start gap-1.5 text-[10px] text-text-faint bg-panel-raised rounded-md px-2.5 py-2">
            <Info size={11} className="shrink-0 mt-0.5" />
            {fallbackNote}
          </div>
        )}

        {activeNotes.map((note, i) => (
          <div
            key={i}
            className="flex items-start gap-1.5 text-[10px] text-text-muted bg-panel-raised rounded-md px-2.5 py-2 border border-hairline-soft"
          >
            <Info size={11} className="shrink-0 mt-0.5 text-accent" />
            {note}
          </div>
        ))}
      </div>
    </Panel>
  );
}
