import { useEffect, useState } from "react";
import { Navigation, ShieldCheck, Zap, X } from "lucide-react";

import type {
  FloodZone,
  RouteOption,
  RouteRecommendation,
  StreetRisk,
} from "../../types/flood";

import { Panel } from "../common/Panel";
import { RiskBadge } from "../common/RiskBadge";
import { InlineError, InlineLoading } from "../common/StateNotices";
import { getDynamicRoute } from "../../api/routeApi";

function RouteCard({
  option,
  highlight,
}: {
  option: RouteOption;
  highlight: boolean;
}) {
  const Icon = option.type === "fastest" ? Zap : ShieldCheck;

  return (
    <div
      className={`flex-1 rounded-md border px-3 py-2.5 ${
        highlight
          ? "border-accent bg-accent-soft"
          : "border-hairline bg-panel-raised"
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
  streetRisks: StreetRisk[];
  zones: FloodZone[];
  point: [number, number] | null;
  onRouteChange?: (route: RouteRecommendation | null) => void;
}

export function RoutePanel({
  streetRisk,
  streetRisks,
  zones,
  point,
  onRouteChange,
}: RoutePanelProps) {
  const [route, setRoute] =
    useState<RouteRecommendation | null>(null);

  const [isLoading, setIsLoading] =
    useState(false);

  const [error, setError] =
    useState<string | null>(null);

  const [dismissed, setDismissed] =
    useState(false);

  /*
   * Only calculate a route for MODERATE or HIGH streets.
   * LOW-risk streets do not require rerouting.
   */
  const needsRerouting =
    streetRisk?.risk === "MODERATE" ||
    streetRisk?.risk === "HIGH";

  /*
   * A HIGH-risk street is treated as requiring evacuation.
   */
  const needsEvacuation =
    streetRisk?.risk === "HIGH";

  useEffect(() => {
    setDismissed(false);
    setError(null);
    setRoute(null);

    /*
     * Nothing selected OR LOW-risk street:
     * clear any previous route and do not call the backend.
     */
    if (!point || !needsRerouting) {
      setIsLoading(false);
      onRouteChange?.(null);
      return;
    }

    let cancelled = false;

    setIsLoading(true);

    getDynamicRoute(point[0], point[1], zones, streetRisks)
      .then((res) => {
        if (cancelled) return;

        setRoute(res.data);
        setError(res.error ?? null);
      })
      .catch((err) => {
        if (cancelled) return;

        setRoute(null);

        setError(
          err instanceof Error
            ? err.message
            : "Failed to calculate safe route.",
        );
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [point, needsRerouting, onRouteChange, streetRisks, zones]);

  const activeRoute =
    dismissed ? null : route;

  useEffect(() => {
    onRouteChange?.(activeRoute);
  }, [activeRoute, onRouteChange]);

  return (
    <Panel
      title="Flood-Safe Route"
      icon={<Navigation size={13} />}
    >
      {!streetRisk ? (
        <p className="text-xs text-text-faint">
          Click a street on the map to view its flood status.
        </p>
      ) : streetRisk.risk === "LOW" ? (
        /*
         * GREEN STREET
         */
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="text-[11px] font-bold uppercase tracking-wide text-accent">
              No rerouting required
            </div>

            <RiskBadge
              risk="LOW"
              size="sm"
            />
          </div>

          <p className="text-xs text-text-muted">
            This street is currently low risk.
            Normal travel can continue.
          </p>

          <div className="rounded-md border border-hairline bg-panel-raised px-2.5 py-2 text-[11px] text-text-faint">
            No evacuation route is required for this street.
          </div>
        </div>
      ) : isLoading ? (
        /*
         * MODERATE / HIGH WHILE ROUTE IS CALCULATING
         */
        <InlineLoading label="Calculating safe route…" />
      ) : error ? (
        <InlineError message={error} />
      ) : !route ? (
        /*
         * MODERATE / HIGH BUT NO ROUTE AVAILABLE
         */
        <div className="space-y-2">
          <div className="text-[11px] font-bold uppercase tracking-wide text-risk-high">
            {needsEvacuation
              ? "Evacuation required"
              : "Rerouting recommended"}
          </div>

          <p className="text-xs text-text-muted">
            {needsEvacuation
              ? "This street has high flood risk. Evacuation is recommended."
              : "This street has elevated flood risk. Use an alternate route."}
          </p>

          <p className="text-[10px] text-text-faint">
            A safe route could not be calculated from this location.
          </p>
        </div>
      ) : dismissed ? (
        /*
         * ROUTE DISMISSED
         */
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-text-faint">
            Route cleared.
          </p>

          <button
            type="button"
            onClick={() => setDismissed(false)}
            className="text-[11px] font-medium text-accent hover:underline shrink-0"
          >
            Show route
          </button>
        </div>
      ) : (
        /*
         * MODERATE / HIGH WITH ROUTE
         */
        <div className="space-y-3">
          <div
            className={`text-[11px] font-bold uppercase tracking-wide ${
              needsEvacuation
                ? "text-risk-high"
                : "text-text-muted"
            }`}
          >
            {needsEvacuation
              ? "Evacuation required"
              : "Rerouting recommended"}
          </div>

          <div className="text-xs text-text-primary font-medium">
            {route.label}
          </div>

          <div className="rounded-md border border-hairline bg-panel-raised px-2.5 py-2">
            <div className="text-[10px] uppercase tracking-wide text-text-faint">
              Action
            </div>

            <div className="text-xs text-text-primary mt-0.5">
              {needsEvacuation
                ? "Leave the high-risk street and follow the flood-safe route."
                : "Avoid the affected street and use the safer route."}
            </div>
          </div>

          <div className="flex gap-2">
            <RouteCard
              option={route.fastest}
              highlight={
                route.recommendation === "fastest"
              }
            />

            <RouteCard
              option={route.safe}
              highlight={
                route.recommendation === "safe"
              }
            />
          </div>

          <div
            className={`text-center text-[11px] font-semibold uppercase tracking-wide rounded-md py-1.5 ${
              route.recommendation === "safe"
                ? "bg-accent-soft text-accent"
                : "bg-panel-raised text-text-muted"
            }`}
          >
            {route.recommendation === "safe"
              ? "Recommendation: Use flood-safe route"
              : "Fastest and safe routes have similar risk"}
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
            Route calculated dynamically from the clicked street
            on the real Andheri road graph using current flood-risk data.
          </p>
        </div>
      )}
    </Panel>
  );
}
