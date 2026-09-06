/**
 * API abstraction for the flood-safe routing feature.
 *
 * Keeps the existing fixed-route API intact and adds dynamic routing
 * from a clicked street:
 *
 * GET /api/routes/dynamic?lon=...&lat=...
 */

import type {
  ApiResult,
  RouteExampleWire,
  RouteRecommendation,
} from "../types/flood";

import { adaptRoute } from "./adapters";
import {
  API_BASE_URL,
  fetchJson,
  IS_BACKEND_CONFIGURED,
} from "./client";

import {
  mockGetAllRoutes,
  mockGetSafeRoute,
} from "../data/mockFloodData";

/**
 * Existing fixed route IDs.
 * These are kept unchanged for the original route functionality.
 */
const KNOWN_ROUTE_IDS = [
  "station-to-marol",
  "around-tilak-marg",
  "around-ns-road-5",
];

/**
 * Existing fixed-route lookup.
 */
export async function getAllRoutes(): Promise<
  ApiResult<RouteRecommendation[]>
> {
  if (IS_BACKEND_CONFIGURED) {
    const results = await Promise.allSettled(
      KNOWN_ROUTE_IDS.map((routeId) =>
        fetchJson<RouteExampleWire>(
          `${API_BASE_URL}/api/routes/safe?route_id=${routeId}`,
          {
            timeoutMs: 15000,
          },
        ),
      ),
    );

    const fetched = results
      .filter(
        (
          r,
        ): r is PromiseFulfilledResult<RouteExampleWire> =>
          r.status === "fulfilled",
      )
      .map((r) => adaptRoute(r.value));

    // Keep partial real results.
    if (fetched.length > 0) {
      return {
        data: fetched,
        connection: "connected",
      };
    }

    // Existing fallback behavior.
    const data = await mockGetAllRoutes();

    return {
      data,
      connection: "mock",
      error:
        "Backend unavailable — showing bundled demo routes instead of live route data.",
    };
  }

  const data = await mockGetAllRoutes();

  return {
    data,
    connection: "mock",
  };
}

/**
 * Existing single fixed-route lookup.
 * Kept unchanged so the original feature continues to work.
 */
export async function getSafeRoute(
  routeId: string,
): Promise<ApiResult<RouteRecommendation | null>> {
  if (IS_BACKEND_CONFIGURED) {
    try {
      const wire = await fetchJson<RouteExampleWire>(
        `${API_BASE_URL}/api/routes/safe?route_id=${routeId}`,
        {
          timeoutMs: 15000,
        },
      );

      return {
        data: adaptRoute(wire),
        connection: "connected",
      };
    } catch {
      const data = await mockGetSafeRoute(routeId);

      return {
        data,
        connection: "mock",
      };
    }
  }

  const data = await mockGetSafeRoute(routeId);

  return {
    data,
    connection: "mock",
  };
}

/**
 * NEW:
 * Calculate a route starting from the street the user clicked.
 *
 * The backend:
 *   1. finds the nearest road-graph node,
 *   2. uses the current street/zone flood risks,
 *   3. runs Dijkstra routing,
 *   4. returns fastest + safer route geometry.
 */
export async function getDynamicRoute(
  lon: number,
  lat: number,
): Promise<ApiResult<RouteRecommendation | null>> {
  if (!IS_BACKEND_CONFIGURED) {
    return {
      data: null,
      connection: "mock",
      error: "Dynamic routing requires the backend.",
    };
  }

  try {
    const wire = await fetchJson<RouteExampleWire>(
      `${API_BASE_URL}/api/routes/dynamic?lon=${encodeURIComponent(
        lon,
      )}&lat=${encodeURIComponent(lat)}`,
      {
        timeoutMs: 15000,
      },
    );

    return {
      data: adaptRoute(wire),
      connection: "connected",
    };
  } catch (err) {
    return {
      data: null,
      connection: "offline",
      error:
        err instanceof Error
          ? err.message
          : "Dynamic safe route unavailable.",
    };
  }
}
