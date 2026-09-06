import { MapPin, X } from "lucide-react";
import type { FloodZone } from "../../types/flood";
import { Panel } from "../common/Panel";
import { RiskBadge } from "../common/RiskBadge";
import { FACTOR_LABELS, RISK_COLORS, formatFactorValue, formatMinutes } from "../../utils/riskUtils";

interface ZoneDetailsProps {
  zone: FloodZone | null;
  onClose: () => void;
}

const FACTOR_ORDER: (keyof FloodZone["factors"])[] = [
  "rainTotalMm",
  "rainMaxHourlyMm",
  "rainPeak3hrMm",
  "slope",
  "distanceToWaterwayM",
  "drainDensity",
  "distanceToDrainM",
  "maxTideHeightM",
  "numHighTides",
];

function ProbabilityBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] text-text-faint w-14 shrink-0">{label}</span>
      <div className="flex-1 h-1.5 bg-void rounded-full overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${value * 100}%`, background: color }} />
      </div>
      <span className="text-[10px] font-mono text-text-muted w-9 text-right shrink-0">
        {(value * 100).toFixed(0)}%
      </span>
    </div>
  );
}

export function ZoneDetails({ zone, onClose }: ZoneDetailsProps) {
  if (!zone) return null;

  return (
    <Panel
      title="Zone Details"
      icon={<MapPin size={13} />}
      action={
        <button
          type="button"
          onClick={onClose}
          className="text-text-faint hover:text-text-primary transition-colors"
          aria-label="Close zone details"
        >
          <X size={14} />
        </button>
      }
      className="animate-sweep-in"
    >
      <div className="space-y-3">
        <div>
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-text-primary leading-tight">{zone.name}</h3>
            <RiskBadge risk={zone.risk} size="sm" />
          </div>
          <p className="text-[10px] font-mono text-text-faint mt-0.5">{zone.id}</p>
        </div>

        <div className="py-2 border-y border-hairline-soft text-xs">
          <div className="text-text-faint">Expected onset</div>
          <div className="font-mono text-text-primary text-sm">{formatMinutes(zone.onsetMinutes)}</div>
        </div>

        <div className="space-y-1.5">
          <div className="text-[10px] text-text-faint uppercase tracking-wide">Flood probability by class</div>
          <ProbabilityBar label="Low" value={zone.classProbabilities.low} color={RISK_COLORS.LOW} />
          <ProbabilityBar label="Moderate" value={zone.classProbabilities.moderate} color={RISK_COLORS.MODERATE} />
          <ProbabilityBar label="High" value={zone.classProbabilities.high} color={RISK_COLORS.HIGH} />
        </div>

        <div className="space-y-1">
          <div className="text-[10px] text-text-faint uppercase tracking-wide pb-0.5">Contributing factors</div>
          {FACTOR_ORDER.map((key) => (
            <div key={key} className="flex items-center justify-between py-0.5">
              <span className="text-[11px] text-text-muted">{FACTOR_LABELS[key]}</span>
              <span className="text-[11px] font-mono text-text-primary">
                {formatFactorValue(key, zone.factors[key])}
              </span>
            </div>
          ))}
        </div>

        <p className="text-[10px] text-text-faint pt-1 border-t border-hairline-soft leading-relaxed">
          Onset is estimated from the model's risk probability and this zone's
          real drainage proximity (see README "Model Behaviour Notes") — the classifier
          itself predicts risk class, not depth.
        </p>
      </div>
    </Panel>
  );
}
