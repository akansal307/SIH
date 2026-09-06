import { Bell, BellOff } from "lucide-react";
import type { Alert } from "../../types/flood";
import { Panel } from "../common/Panel";
import { InlineEmpty, InlineLoading } from "../common/StateNotices";
import { RISK_COLORS, formatMinutes } from "../../utils/riskUtils";

interface LiveAlertsProps {
  alerts: Alert[];
  isLoading: boolean;
  selectedZoneId: string | null;
  onSelectZone: (zoneId: string) => void;
}

export function LiveAlerts({ alerts, isLoading, selectedZoneId, onSelectZone }: LiveAlertsProps) {
  return (
    <Panel
      title="Live Alerts"
      icon={<Bell size={13} />}
      action={
        alerts.length > 0 ? (
          <span className="text-[10px] font-mono text-text-faint bg-void px-1.5 py-0.5 rounded">
            {alerts.length}
          </span>
        ) : undefined
      }
      dense
    >
      {isLoading && alerts.length === 0 ? (
        <InlineLoading label="Checking alerts…" />
      ) : alerts.length === 0 ? (
        <div className="flex flex-col items-center gap-1.5 py-3 text-text-faint">
          <BellOff size={16} />
          <InlineEmpty>No active alerts. All zones nominal.</InlineEmpty>
        </div>
      ) : (
        <ul className="space-y-1.5 max-h-72 overflow-y-auto pr-0.5">
          {alerts.map((alert) => {
            const color = RISK_COLORS[alert.severity];
            const isSelected = alert.zoneId === selectedZoneId;
            return (
              <li key={alert.id}>
                <button
                  type="button"
                  onClick={() => onSelectZone(alert.zoneId)}
                  className={`w-full text-left rounded-md px-2.5 py-2 border transition-colors animate-sweep-in ${
                    isSelected ? "bg-panel-raised-2" : "bg-panel-raised hover:bg-panel-raised-2"
                  }`}
                  style={{ borderColor: isSelected ? color : "var(--color-hairline)", borderLeftWidth: 3, borderLeftColor: color }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-bold uppercase tracking-wide" style={{ color }}>
                      {alert.severity} flood risk
                    </span>
                    <span className="text-[10px] text-text-faint font-mono shrink-0">
                      {formatMinutes(alert.onsetMinutes)}
                    </span>
                  </div>
                  <div className="text-xs text-text-primary font-medium mt-0.5 truncate">{alert.zoneName}</div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
