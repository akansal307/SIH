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

export async function getAllRoutes(): Promise<ApiResult<RouteRecommendation[]>> {
  const data = await mockGetAllRoutes();
  return { data, connection: IS_BACKEND_CONFIGURED ? "degraded" : "mock" };
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
