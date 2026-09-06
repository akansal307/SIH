import { useEffect, useMemo, useRef, useState } from "react";
import { Navigation, ShieldCheck, Zap, X } from "lucide-react";
import type { FloodZone, RouteOption, RouteRecommendation } from "../../types/flood";
import { Panel } from "../common/Panel";
import { RiskBadge } from "../common/RiskBadge";
import { InlineError, InlineLoading } from "../common/StateNotices";
import { getAllRoutes } from "../../api/routeApi";
import { selectBestRouteForZone } from "../../utils/routeSelection";

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
  /** The currently selected zone (same object useFloodData/App.tsx already derives
   * for ZoneDetails) — the route recommendation is driven entirely by this, replacing
   * the old manual dropdown. */
  zone: FloodZone | null;
  onRouteChange?: (route: RouteRecommendation | null) => void;
}

export function RoutePanel({ zone, onRouteChange }: RoutePanelProps) {
  const [routes, setRoutes] = useState<RouteRecommendation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Whether the user has manually dismissed the route for the CURRENT zone selection.
  // Resets automatically whenever a different zone is selected (section 7: route
  // must follow the selected zone, never linger from the previous one).
  const [dismissed, setDismissed] = useState(false);
  const lastZoneId = useRef<string | null>(null);
  useEffect(() => {
    if (zone?.id !== lastZoneId.current) {
      lastZoneId.current = zone?.id ?? null;
      setDismissed(false);
    }
  }, [zone?.id]);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    getAllRoutes()
      .then((res) => {
        if (!cancelled) setRoutes(res.data);
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

  // Only the geographic-match logic is new; every value shown (distance, duration,
  // risk, geometry) still comes straight from the existing backend-provided route
  // candidates in `routes` — nothing here fabricates a route.
  const bestRoute = useMemo(() => selectBestRouteForZone(zone, routes), [zone, routes]);
  const activeRoute = dismissed ? null : bestRoute;

  useEffect(() => {
    onRouteChange?.(activeRoute);
    return () => onRouteChange?.(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRoute]);

  const isElevatedRisk = zone && (zone.risk === "MODERATE" || zone.risk === "HIGH");

  return (
    <Panel title="Flood-Safe Route" icon={<Navigation size={13} />}>
      {isLoading ? (
        <InlineLoading label="Loading routes…" />
      ) : error ? (
        <InlineError message={error} />
      ) : !zone ? (
        <p className="text-xs text-text-faint">Click a flood-risk zone on the map to see a recommended safe route.</p>
      ) : !bestRoute ? (
        <p className="text-xs text-text-faint">Safe route unavailable for this area.</p>
      ) : zone.risk === "LOW" ? (
        <div className="space-y-2">
          <p className="text-xs text-text-muted">Area currently low risk — no evacuation route recommended.</p>
          {!dismissed && (
            <div className="rounded-md border border-hairline bg-panel-raised px-2.5 py-2 text-[11px] text-text-faint">
              Nearest reference route: <span className="text-text-primary">{bestRoute.label}</span> —{" "}
              {bestRoute.safe.distanceKm.toFixed(2)} km, {bestRoute.safe.durationMin} min.
            </div>
          )}
        </div>
      ) : dismissed ? (
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-text-faint">Route cleared.</p>
          <button
            type="button"
            onClick={() => setDismissed(false)}
            className="text-[11px] font-medium text-accent hover:underline shrink-0"
          >
            Show recommended route
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <div
            className={`text-[11px] font-bold uppercase tracking-wide ${
              isElevatedRisk ? "text-risk-high" : "text-text-faint"
            }`}
          >
            {isElevatedRisk ? "Recommended safe exit" : "Flood-safe route"}
          </div>

          <div className="text-xs text-text-primary font-medium">{bestRoute.label}</div>

          <div className="flex gap-2">
            <RouteCard option={bestRoute.fastest} highlight={bestRoute.recommendation === "fastest"} />
            <RouteCard option={bestRoute.safe} highlight={bestRoute.recommendation === "safe"} />
          </div>

          <div
            className={`text-center text-[11px] font-semibold uppercase tracking-wide rounded-md py-1.5 ${
              bestRoute.recommendation === "safe"
                ? "bg-accent-soft text-accent"
                : "bg-panel-raised text-text-muted"
            }`}
          >
            {bestRoute.recommendation === "safe" ? "Recommendation: Use safe route" : "Both routes carry similar risk"}
          </div>

          <button
            type="button"
            onClick={() => setDismissed(true)}
            className="w-full flex items-center justify-center gap-1.5 text-[11px] text-text-faint hover:text-text-primary transition-colors py-1"
          >
            <X size={11} />
            Clear route
          </button>

          <p className="text-[10px] text-text-faint leading-relaxed">
            Computed with real shortest-path routing on the actual Andheri road graph, auto-matched to
            this zone by geographic proximity (scenario: {bestRoute.scenarioContext.replace(/_/g, " ")}).
            A fixed set of demo route candidates — see README "Assumptions &amp; TODOs" for the
            general-routing roadmap.
          </p>
        </div>
      )}
    </Panel>
  );
}
