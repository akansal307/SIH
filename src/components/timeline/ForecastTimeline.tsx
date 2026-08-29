import { History } from "lucide-react";
import type { ForecastSnapshot } from "../../types/flood";
import { RISK_COLORS, formatClockTime } from "../../utils/riskUtils";

interface ForecastTimelineProps {
  forecast: ForecastSnapshot[];
  selectedOffset: number;
  onSelect: (offsetMinutes: number) => void;
  isLoading: boolean;
}

export function ForecastTimeline({ forecast, selectedOffset, onSelect, isLoading }: ForecastTimelineProps) {
  return (
    <div className="flex items-center gap-4 px-4 py-2.5 bg-panel border-t border-hairline shrink-0">
      <div className="flex items-center gap-1.5 text-text-faint text-[11px] font-semibold uppercase tracking-wide shrink-0">
        <History size={13} />
        0–3h forecast
      </div>

      <div className="flex items-stretch gap-1.5 flex-1 overflow-x-auto">
        {forecast.length === 0 && isLoading
          ? Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex-1 min-w-[92px] h-12 rounded-md bg-panel-raised animate-pulse" />
            ))
          : forecast.map((snap) => {
              const isSelected = snap.offsetMinutes === selectedOffset;
              const color = RISK_COLORS[snap.overallRisk];
              return (
                <button
                  key={snap.offsetMinutes}
                  type="button"
                  onClick={() => onSelect(snap.offsetMinutes)}
                  className={`flex-1 min-w-[92px] rounded-md border px-2.5 py-1.5 text-left transition-all ${
                    isSelected
                      ? "border-accent bg-panel-raised-2"
                      : "border-hairline bg-panel-raised hover:border-hairline-soft hover:bg-panel-raised-2"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span
                      className={`text-[11px] font-mono font-semibold ${
                        isSelected ? "text-text-primary" : "text-text-muted"
                      }`}
                    >
                      {snap.label}
                    </span>
                    <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: color }} />
                  </div>
                  <div className="text-[10px] text-text-faint mt-0.5">{formatClockTime(snap.timestamp)}</div>
                </button>
              );
            })}
      </div>
    </div>
  );
}
