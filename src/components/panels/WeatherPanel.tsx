import { CloudDrizzle, CloudRain, CloudLightning, Sun, Waves } from "lucide-react";
import type { FloodState } from "../../types/flood";
import { Panel } from "../common/Panel";
import { InlineLoading } from "../common/StateNotices";

interface WeatherPanelProps {
  state: FloodState | null;
  isLoading: boolean;
}

function intensityFor(mmHr: number): { label: string; icon: React.ReactNode; color: string } {
  if (mmHr < 2) return { label: "Dry / trace", icon: <Sun size={15} />, color: "text-text-faint" };
  if (mmHr < 15) return { label: "Light drizzle", icon: <CloudDrizzle size={15} />, color: "text-accent" };
  if (mmHr < 55) return { label: "Moderate rain", icon: <CloudRain size={15} />, color: "text-risk-moderate" };
  return { label: "Cloudburst intensity", icon: <CloudLightning size={15} />, color: "text-risk-high" };
}

export function WeatherPanel({ state, isLoading }: WeatherPanelProps) {
  // Rain/tide are applied uniformly city-wide per snapshot in this model, so any
  // zone's factors are representative — see scripts/generate_scenarios.py.
  const rep = state?.zones[0]?.factors;
  const intensity = state ? intensityFor(state.rainfallMmHr) : null;

  return (
    <Panel title="Weather" icon={<CloudRain size={13} />}>
      {isLoading && !state ? (
        <InlineLoading label="Loading weather…" />
      ) : !state || !rep ? (
        <p className="text-xs text-text-faint">No data available.</p>
      ) : (
        <div className="space-y-3">
          <div className={`flex items-center gap-2 ${intensity!.color}`}>
            {intensity!.icon}
            <span className="text-sm font-medium">{intensity!.label}</span>
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
            <div>
              <div className="text-text-faint">Accumulated</div>
              <div className="font-mono text-text-primary">{rep.rainTotalMm.toFixed(1)} mm</div>
            </div>
            <div>
              <div className="text-text-faint">3-hr peak</div>
              <div className="font-mono text-text-primary">{rep.rainPeak3hrMm.toFixed(1)} mm</div>
            </div>
            <div className="flex items-start gap-1.5 col-span-2 pt-1.5 border-t border-hairline-soft">
              <Waves size={12} className="text-text-faint mt-0.5 shrink-0" />
              <div>
                <span className="text-text-primary font-mono">{rep.maxTideHeightM.toFixed(1)} m</span>
                <span className="text-text-faint"> max tide</span>
                {rep.numHighTides > 0 && (
                  <span className="text-text-faint">
                    {" "}
                    · {rep.numHighTides} high tide{rep.numHighTides > 1 ? "s" : ""} in window
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </Panel>
  );
}
