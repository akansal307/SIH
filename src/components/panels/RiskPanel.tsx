import { Gauge, CloudRain, MapPinned, Clock } from "lucide-react";
import type { FloodState } from "../../types/flood";
import { Panel } from "../common/Panel";
import { RiskBadge } from "../common/RiskBadge";
import { InlineLoading } from "../common/StateNotices";
import { formatMinutes } from "../../utils/riskUtils";

interface RiskPanelProps {
  state: FloodState | null;
  isLoading: boolean;
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="flex items-center gap-2 text-xs text-text-muted">
        {icon}
        {label}
      </span>
      <span className="font-mono text-sm font-medium text-text-primary">{value}</span>
    </div>
  );
}

export function RiskPanel({ state, isLoading }: RiskPanelProps) {
  return (
    <Panel title="Current Conditions" icon={<Gauge size={13} />}>
      {isLoading && !state ? (
        <InlineLoading label="Loading conditions…" />
      ) : !state ? (
        <p className="text-xs text-text-faint">No data available.</p>
      ) : (
        <div className="divide-y divide-hairline-soft">
          <div className="flex items-center justify-between pb-2.5">
            <span className="text-xs text-text-muted">Overall risk</span>
            <RiskBadge risk={state.overallRisk} size="md" />
          </div>
          <Stat icon={<CloudRain size={13} />} label="Rainfall" value={`${state.rainfallMmHr.toFixed(1)} mm/hr`} />
          <Stat icon={<MapPinned size={13} />} label="Affected zones" value={`${state.affectedZones} / 33`} />
          <Stat
            icon={<Clock size={13} />}
            label="Earliest onset"
            value={formatMinutes(state.earliestOnsetMinutes)}
          />
        </div>
      )}
    </Panel>
  );
}
