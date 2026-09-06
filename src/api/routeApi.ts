/**
 * API abstraction for the flood-safe routing feature (brief section I / section 14
 * `POST /api/routes/safe`). Kept separate from floodApi.ts since routing is a
 * distinct concern with its own backend endpoint.
 *
 * Mock mode serves the pre-baked, REAL graph-computed examples in
 * public/data/routes.json (see scripts/build_routes.py — actual Dijkstra shortest
 * paths on the real Andheri road graph, not fabricated numbers) for a small fixed set
 * of origin/destination pairs. This is explicitly not a general routing API yet — see
 * README.md "Assumptions & TODOs".
 */

import type { ApiResult, RouteExampleWire, RouteRecommendation } from "../types/flood";
import { adaptRoute } from "./adapters";
import { API_BASE_URL, fetchJson, IS_BACKEND_CONFIGURED } from "./client";
import { mockGetAllRoutes, mockGetSafeRoute } from "../data/mockFloodData";

/**
 * The backend exposes only `GET /api/routes/safe?route_id=...` (single lookup) — there
 * is no "list all routes" endpoint. This fixed set of IDs mirrors backend/app/config.py's
 * `ROUTE_OD_PAIRS` exactly (also the same set already present in public/data/routes.json),
 * so the frontend knows which IDs to ask the real backend for. Not a new/invented route —
 * this is the existing, already-supported contract, just queried per-ID instead of via a
 * single bulk call.
 */
const KNOWN_ROUTE_IDS = ["station-to-marol", "around-tilak-marg", "around-ns-road-5"];

export async function getAllRoutes(): Promise<ApiResult<RouteRecommendation[]>> {
  if (IS_BACKEND_CONFIGURED) {
    const results = await Promise.allSettled(
      KNOWN_ROUTE_IDS.map((routeId) =>
        fetchJson<RouteExampleWire>(`${API_BASE_URL}/api/routes/safe?route_id=${routeId}`, {
          timeoutMs: 15000,
        }),
      ),
    );

    const fetched = results
      .filter((r): r is PromiseFulfilledResult<RouteExampleWire> => r.status === "fulfilled")
      .map((r) => adaptRoute(r.value));

    // Partial success (some route_ids failed, e.g. timed out) is still a real,
    // "connected" result — brief requirement 6: continue with whatever succeeded
    // rather than discarding the batch or splicing in mock data for the gaps.
    if (fetched.length > 0) {
      return { data: fetched, connection: "connected" };
    }

    // Every request failed — backend reachable-but-erroring, or fully unreachable.
    // Fall back to the bundled demo data so the app (and the demo) still works.
    const data = await mockGetAllRoutes();
    return {
      data,
      connection: "mock",
      error: "Backend unavailable — showing bundled demo routes instead of live route data.",
    };
  }
  const data = await mockGetAllRoutes();
  return { data, connection: "mock" };
}

export async function getSafeRoute(routeId: string): Promise<ApiResult<RouteRecommendation | null>> {
  if (IS_BACKEND_CONFIGURED) {
    try {
      const wire = await fetchJson<RouteExampleWire>(`${API_BASE_URL}/api/routes/safe?route_id=${routeId}`, {
        timeoutMs: 15000,
      });
      return { data: adaptRoute(wire), connection: "connected" };
    } catch {
      const data = await mockGetSafeRoute(routeId);
      return { data, connection: "mock" };
    }
  }
  const data = await mockGetSafeRoute(routeId);
  return { data, connection: "mock" };
}

