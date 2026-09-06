import { useEffect, useMemo, useRef, useState } from "react";
import { Navigation, ShieldCheck, Zap, X } from "lucide-react";
import type { RouteOption, RouteRecommendation, StreetRisk } from "../../types/flood";
import { Panel } from "../common/Panel";
import { RiskBadge } from "../common/RiskBadge";
import { InlineError, InlineLoading } from "../common/StateNotices";
import { getAllRoutes } from "../../api/routeApi";
import { selectBestRouteForPoint } from "../../utils/routeSelection";

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
      <div className="text-lg font-display font-semibold text-text-primary mt-1">
        {option.durationMin} min
      </div>
      <div className="text-[11px] text-text-faint">
        {option.distanceKm.toFixed(2)} km
      </div>
      <div className="mt-1.5">
        <RiskBadge risk={option.risk} size="sm" />
      </div>
    </div>
  );
}

interface RoutePanelProps {
  streetRisk: StreetRisk | null;
  point: [number, number] | null;
  onRouteChange?: (route: RouteRecommendation | null) => void;
}

export function RoutePanel({ streetRisk, point, onRouteChange }: RoutePanelProps) {
  const [routes, setRoutes] = useState<RouteRecommendation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [dismissed, setDismissed] = useState(false);
  const lastStreetId = useRef<string | null>(null);

  useEffect(() => {
    if (streetRisk?.edgeId !== lastStreetId.current) {
      lastStreetId.current = streetRisk?.edgeId ?? null;
      setDismissed(false);
    }
  }, [streetRisk?.edgeId]);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);

    getAllRoutes()
      .then((res) => {
        if (!cancelled) setRoutes(res.data);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load routes.");
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Match the route to the actual location where the user clicked the street.
  const bestRoute = useMemo(
    () => selectBestRouteForPoint(point, routes),
    [point, routes]
  );

  const activeRoute = dismissed ? null : bestRoute;

  useEffect(() => {
    onRouteChange?.(activeRoute);
    return () => onRouteChange?.(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRoute]);

  const isElevatedRisk =
    streetRisk &&
    (streetRisk.risk === "MODERATE" || streetRisk.risk === "HIGH");

  return (
    <Panel title="Flood-Safe Route" icon={<Navigation size={13} />}>
      {isLoading ? (
        <InlineLoading label="Loading routes…" />
      ) : error ? (
        <InlineError message={error} />
      ) : !streetRisk ? (
        <p className="text-xs text-text-faint">
          Click a street on the map to see a recommended safe route.
        </p>
      ) : !bestRoute ? (
        <p className="text-xs text-text-faint">
          Safe route unavailable for this area.
        </p>
      ) : streetRisk.risk === "LOW" ? (
        <div className="space-y-2">
          <p className="text-xs text-text-muted">
            Area currently low risk — no evacuation route recommended.
          </p>

          {!dismissed && (
            <div className="rounded-md border border-hairline bg-panel-raised px-2.5 py-2 text-[11px] text-text-faint">
              Nearest reference route:{" "}
              <span className="text-text-primary">{bestRoute.label}</span> —{" "}
              {bestRoute.safe.distanceKm.toFixed(2)} km,{" "}
              {bestRoute.safe.durationMin} min.
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

          <div className="text-xs text-text-primary font-medium">
            {bestRoute.label}
          </div>

          <div className="flex gap-2">
            <RouteCard
              option={bestRoute.fastest}
              highlight={bestRoute.recommendation === "fastest"}
            />
            <RouteCard
              option={bestRoute.safe}
              highlight={bestRoute.recommendation === "safe"}
            />
          </div>

          <div
            className={`text-center text-[11px] font-semibold uppercase tracking-wide rounded-md py-1.5 ${
              bestRoute.recommendation === "safe"
                ? "bg-accent-soft text-accent"
                : "bg-panel-raised text-text-muted"
            }`}
          >
            {bestRoute.recommendation === "safe"
              ? "Recommendation: Use safe route"
              : "Both routes carry similar risk"}
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
            Computed with real shortest-path routing on the actual Andheri road
            graph, auto-matched to this street by geographic proximity
            (scenario: {bestRoute.scenarioContext.replace(/_/g, " ")}). A fixed
            set of demo route candidates — see README "Assumptions &amp; TODOs"
            for the general-routing roadmap.
          </p>
        </div>
      )}
    </Panel>
  );
}
