import { Route, X } from "lucide-react";
import type { StreetRisk } from "../../types/flood";
import { Panel } from "../common/Panel";
import { RiskBadge } from "../common/RiskBadge";
import { RISK_COLORS, formatMinutes } from "../../utils/riskUtils";

interface StreetDetailsProps {
  street: StreetRisk | null;
  onClose: () => void;
}

export function StreetDetails({ street, onClose }: StreetDetailsProps) {
  if (!street) return null;

  return (
    <Panel
      title="Street Details"
      icon={<Route size={13} />}
      action={
        <button
          type="button"
          onClick={onClose}
          className="text-text-faint hover:text-text-primary transition-colors"
          aria-label="Close street details"
        >
          <X size={14} />
        </button>
      }
      className="animate-sweep-in"
    >
      <div className="space-y-3">
        <div>
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-text-primary leading-tight">
              Street
            </h3>
            <RiskBadge risk={street.risk} size="sm" />
          </div>
          <p className="text-[10px] font-mono text-text-faint mt-0.5">
            {street.edgeId}
          </p>
        </div>

        <div className="py-2 border-y border-hairline-soft">
          <div className="text-text-faint text-xs">Expected onset</div>
          <div className="font-mono text-text-primary text-sm">
            {formatMinutes(street.onsetMinutes)}
          </div>
        </div>

        <div className="space-y-1.5">
          <div className="text-[10px] text-text-faint uppercase tracking-wide">
            Flood probability
          </div>
          <div className="flex items-center gap-2">
            <div className="flex-1 h-1.5 bg-void rounded-full overflow-hidden">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${street.probability * 100}%`,
                  background: RISK_COLORS[street.risk],
                }}
              />
            </div>
            <span className="text-[10px] font-mono text-text-muted w-9 text-right shrink-0">
              {(street.probability * 100).toFixed(0)}%
            </span>
          </div>
        </div>
      </div>
    </Panel>
  );
}