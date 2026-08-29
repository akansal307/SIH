import { useEffect, useState } from "react";
import { Navigation, ShieldCheck, Zap, ChevronDown } from "lucide-react";
import type { RouteOption, RouteRecommendation } from "../../types/flood";
import { Panel } from "../common/Panel";
import { RiskBadge } from "../common/RiskBadge";
import { InlineError, InlineLoading } from "../common/StateNotices";
import { getAllRoutes } from "../../api/routeApi";

function RouteCard({ option, highlight }: { option: RouteOption; highlight: boolean }) {
  const Icon = option.type === "fastest" ? Zap : ShieldCheck;
  return (
    <div
      className={`flex-1 rounded-md border px-3 py-2.5 ${
        highlight ? "border-accent bg-accent-soft" : "border-hairline bg-panel-raised"
      }`}
    >
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-text-faint font-semibold">
        <Icon size={11} />
        {option.type === "fastest" ? "Fastest" : "Flood-safe"}
      </div>
      <div className="text-lg font-display font-semibold text-text-primary mt-1">{option.durationMin} min</div>
      <div className="text-[11px] text-text-faint">{option.distanceKm.toFixed(2)} km</div>
      <div className="mt-1.5">
        <RiskBadge risk={option.risk} size="sm" />
      </div>
    </div>
  );
}

interface RoutePanelProps {
  onRouteChange?: (route: RouteRecommendation | null) => void;
}

export function RoutePanel({ onRouteChange }: RoutePanelProps) {
  const [routes, setRoutes] = useState<RouteRecommendation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    getAllRoutes()
      .then((res) => {
        if (cancelled) return;
        setRoutes(res.data);
        setSelectedId(res.data[0]?.id ?? null);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load routes.");
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const selected = routes.find((r) => r.id === selectedId) ?? null;

  useEffect(() => {
    onRouteChange?.(selected);
    // Clear the map overlay on unmount (e.g. panel removed/re-mounted).
    return () => onRouteChange?.(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  return (
    <Panel title="Flood-Safe Route" icon={<Navigation size={13} />}>
      {isLoading ? (
        <InlineLoading label="Loading routes…" />
      ) : error ? (
        <InlineError message={error} />
      ) : !selected ? (
        <p className="text-xs text-text-faint">No route examples available.</p>
      ) : (
        <div className="space-y-3">
          <div className="relative">
            <select
              value={selected.id}
              onChange={(e) => setSelectedId(e.target.value)}
              className="w-full appearance-none bg-void border border-hairline rounded-md text-xs text-text-primary px-2.5 py-2 pr-7 cursor-pointer focus:outline-none focus:border-accent-dim"
            >
              {routes.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
            <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-faint pointer-events-none" />
          </div>

          <div className="flex gap-2">
            <RouteCard option={selected.fastest} highlight={selected.recommendation === "fastest"} />
            <RouteCard option={selected.safe} highlight={selected.recommendation === "safe"} />
          </div>

          <div
            className={`text-center text-[11px] font-semibold uppercase tracking-wide rounded-md py-1.5 ${
              selected.recommendation === "safe"
                ? "bg-accent-soft text-accent"
                : "bg-panel-raised text-text-muted"
            }`}
          >
            {selected.recommendation === "safe" ? "Recommendation: Use safe route" : "Both routes carry similar risk"}
          </div>

          <p className="text-[10px] text-text-faint leading-relaxed">
            Computed with real shortest-path routing on the actual Andheri road graph
            (scenario: {selected.scenarioContext.replace(/_/g, " ")}). A fixed set of demo
            routes — see README "Assumptions &amp; TODOs" for the general-routing roadmap.
          </p>
        </div>
      )}
    </Panel>
  );
}
