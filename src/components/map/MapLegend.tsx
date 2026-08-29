import { RISK_COLORS, RISK_LABELS } from "../../utils/riskUtils";
import type { RiskLevel } from "../../types/flood";

const LEVELS: RiskLevel[] = ["LOW", "MODERATE", "HIGH"];

export function MapLegend() {
  return (
    <div className="absolute left-3 bottom-3 bg-panel/90 backdrop-blur-sm border border-hairline rounded-lg px-3 py-2.5 shadow-lg">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-text-faint mb-1.5">
        Flood risk
      </div>
      <div className="flex items-center gap-3">
        {LEVELS.map((level) => (
          <div key={level} className="flex items-center gap-1.5">
            <span
              className="w-2.5 h-2.5 rounded-sm shrink-0"
              style={{ background: RISK_COLORS[level], boxShadow: `0 0 0 1px ${RISK_COLORS[level]}88` }}
            />
            <span className="text-[11px] text-text-muted">{RISK_LABELS[level]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
