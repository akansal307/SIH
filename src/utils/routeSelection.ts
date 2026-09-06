import type { FloodZone, RouteRecommendation } from "../types/flood";
import { RISK_RANK } from "./riskUtils";

/**
 * Picks the most geographically relevant safe-route candidate for a selected zone,
 * from the existing fixed set of route examples already returned by the backend /
 * mock data (public/data/routes.json — see routeApi.ts).
 *
 * This does NOT invent any route geometry, distance, or duration — it only chooses
 * which of the backend-provided candidates is most relevant to the clicked zone.
 */

/** Beyond this distance from a zone's centroid, a route candidate is considered
 * geographically irrelevant to that zone rather than "the closest we have anyway". */
const MAX_RELEVANT_DISTANCE_KM = 3;

/** Candidates within this margin of each other are treated as a geographic tie,
 * broken by risk/distance instead of by a possibly-noisy centroid-distance ordering. */
const CLOSE_ENOUGH_KM = 0.3;

function haversineKm(
  a: [number, number],
  b: [number, number],
): number {
  const R = 6371;

  const [lon1, lat1] = a;
  const [lon2, lat2] = b;

  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;

  const rLat1 = (lat1 * Math.PI) / 180;
  const rLat2 = (lat2 * Math.PI) / 180;

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rLat1) *
      Math.cos(rLat2) *
      Math.sin(dLon / 2) ** 2;

  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Centroid of a zone's polygon. */
function zoneCentroid(
  geometry: GeoJSON.Geometry,
): [number, number] | null {
  const ring: number[][] | null =
    geometry.type === "Polygon"
      ? geometry.coordinates[0]
      : geometry.type === "MultiPolygon"
        ? geometry.coordinates[0]?.[0]
        : null;

  if (!ring || ring.length === 0) return null;

  // Drop the closing point.
  const pts = ring.slice(0, -1);

  if (pts.length === 0) return null;

  const sum = pts.reduce(
    (acc, [lon, lat]) => [
      acc[0] + lon,
      acc[1] + lat,
    ],
    [0, 0],
  );

  return [
    sum[0] / pts.length,
    sum[1] / pts.length,
  ];
}

/** Shortest distance from a point to any vertex along a route's actual geometry. */
function distanceToRoute(
  point: [number, number],
  route: RouteRecommendation,
): number {
  const geom = route.safe.geometry;

  // Support normal LineString routes.
  if (geom.type === "LineString") {
    const coords: number[][] = geom.coordinates;

    if (coords.length === 0) return Infinity;

    let min = Infinity;

    for (const [lon, lat] of coords) {
      const d = haversineKm(point, [lon, lat]);

      if (d < min) {
        min = d;
      }
    }

    return min;
  }

  // Also support MultiLineString routes.
  if (geom.type === "MultiLineString") {
    let min = Infinity;

    for (const line of geom.coordinates) {
      for (const [lon, lat] of line) {
        const d = haversineKm(point, [lon, lat]);

        if (d < min) {
          min = d;
        }
      }
    }

    return min;
  }

  return Infinity;
}

export function selectBestRouteForZone(
  zone: FloodZone | null,
  routes: RouteRecommendation[],
): RouteRecommendation | null {
  if (!zone || routes.length === 0) return null;

  const centroid = zoneCentroid(zone.geometry);

  if (!centroid) return null;

  const scored = routes
    .map((route) => ({
      route,
      distance: distanceToRoute(centroid, route),
    }))
    .filter(
      (s) =>
        Number.isFinite(s.distance) &&
        s.distance <= MAX_RELEVANT_DISTANCE_KM,
    )
    .sort((a, b) => {
      if (
        Math.abs(a.distance - b.distance) >
        CLOSE_ENOUGH_KM
      ) {
        return a.distance - b.distance;
      }

      const riskDiff =
        RISK_RANK[a.route.safe.risk] -
        RISK_RANK[b.route.safe.risk];

      if (riskDiff !== 0) {
        return riskDiff;
      }

      return (
        a.route.safe.distanceKm -
        b.route.safe.distanceKm
      );
    });

  return scored[0]?.route ?? null;
}

/**
 * Picks the closest route candidate to the clicked street.
 *
 * IMPORTANT:
 * There is intentionally NO 3 km distance cutoff here.
 *
 * The old cutoff could cause:
 *   "Safe route unavailable for this area"
 *
 * even when route candidates existed.
 *
 * For a clicked street, we instead choose the nearest available
 * backend-provided route candidate.
 */
export function selectBestRouteForPoint(
  point: [number, number] | null,
  routes: RouteRecommendation[],
): RouteRecommendation | null {
  if (!point || routes.length === 0) return null;

  const scored = routes
    .map((route) => ({
      route,
      distance: distanceToRoute(point, route),
    }))
    .filter((s) => Number.isFinite(s.distance))
    .sort((a, b) => {
      if (
        Math.abs(a.distance - b.distance) >
        CLOSE_ENOUGH_KM
      ) {
        return a.distance - b.distance;
      }

      const riskDiff =
        RISK_RANK[a.route.safe.risk] -
        RISK_RANK[b.route.safe.risk];

      if (riskDiff !== 0) {
        return riskDiff;
      }

      return (
        a.route.safe.distanceKm -
        b.route.safe.distanceKm
      );
    });

  return scored[0]?.route ?? null;
}
