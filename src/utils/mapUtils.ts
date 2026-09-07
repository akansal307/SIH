import type { FloodZone, StreetRisk } from "../types/flood";

/** Andheri bounding box from the source road graph (see data/derived/zones_base.json).
 * lon 72.8131-72.8797, lat 19.0885-19.1512. Used to fit the map on first load. */
export const ANDHERI_BOUNDS: [[number, number], [number, number]] = [
  [72.8095, 19.0855],
  [72.8835, 19.1545],
];

export const ANDHERI_CENTER: [number, number] = [72.8468, 19.1197];

/** Rebuilds a GeoJSON FeatureCollection of zone polygons from the app-facing FloodZone
 * array, for use as a MapLibre GeoJSONSource. Kept as a derivation rather than storing
 * GeoJSON redundantly alongside the typed zone list (single source of truth). */
export function zonesToFeatureCollection(zones: FloodZone[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: zones.map((z) => ({
      type: "Feature",
      id: z.id,
      properties: {
        zoneId: z.id,
        zoneName: z.name,
        risk: z.risk,
        probability: z.probability,
        depthCm: z.depthCm,
        onsetMinutes: z.onsetMinutes,
      },
      geometry: z.geometry,
    })),
  };
}

export function routeToFeature(geometry: GeoJSON.Geometry, properties: Record<string, unknown> = {}): GeoJSON.Feature {
  return { type: "Feature", properties, geometry };
}
export function joinStreetRisksToRoads(
  roadsGeoJson: GeoJSON.FeatureCollection,
  streetRisks: StreetRisk[],
  zones: FloodZone[],
): GeoJSON.FeatureCollection {
  const riskById = new Map(
    streetRisks.map((s) => [s.edgeId, s]),
  );

  return {
    type: "FeatureCollection",
    features: roadsGeoJson.features.map((f) => {
      const edgeId =
        (f.properties as Record<string, unknown> | null)?.edge_id;

      const streetRisk = edgeId
        ? riskById.get(String(edgeId))
        : undefined;

      const zoneRisk = findZoneRiskForRoad(f, zones);

      return {
        ...f,
        id: edgeId,

        properties: {
          ...f.properties,

          // Keep the actual street model prediction.
          streetRisk: streetRisk?.risk ?? "LOW",
          streetProbability: streetRisk?.probability ?? 0,
          onsetMinutes: streetRisk?.onsetMinutes ?? null,

          // This is now the risk used for the visible road color.
          risk: zoneRisk,
        },
      };
    }),
  };
}

function findZoneRiskForRoad(
  feature: GeoJSON.Feature,
  zones: FloodZone[],
): "LOW" | "MODERATE" | "HIGH" {
  const midpoint = getRoadMidpoint(feature.geometry);

  if (!midpoint) return "LOW";

  for (const zone of zones) {
    if (
      pointInGeometry(
        midpoint[0],
        midpoint[1],
        zone.geometry,
      )
    ) {
      return zone.risk;
    }
  }

  return "LOW";
}

function getRoadMidpoint(
  geometry: GeoJSON.Geometry,
): [number, number] | null {
  if (geometry.type === "LineString") {
    const coords = geometry.coordinates;

    if (coords.length === 0) return null;

    return coords[
      Math.floor(coords.length / 2)
    ] as [number, number];
  }

  if (geometry.type === "MultiLineString") {
    const lines = geometry.coordinates;

    if (lines.length === 0) return null;

    const longest = lines.reduce(
      (best, line) =>
        line.length > best.length ? line : best,
      lines[0],
    );

    if (!longest || longest.length === 0) {
      return null;
    }

    return longest[
      Math.floor(longest.length / 2)
    ] as [number, number];
  }

  return null;
}

function pointInGeometry(
  lon: number,
  lat: number,
  geometry: GeoJSON.Geometry,
): boolean {
  if (geometry.type === "Polygon") {
    return polygonContainsPoint(
      lon,
      lat,
      geometry.coordinates,
    );
  }

  if (geometry.type === "MultiPolygon") {
    return geometry.coordinates.some(
      (polygon) =>
        polygonContainsPoint(
          lon,
          lat,
          polygon,
        ),
    );
  }

  return false;
}

function polygonContainsPoint(
  lon: number,
  lat: number,
  polygon: number[][][],
): boolean {
  const outerRing = polygon[0];

  if (!outerRing || outerRing.length < 3) {
    return false;
  }

  let inside = false;

  for (
    let i = 0, j = outerRing.length - 1;
    i < outerRing.length;
    j = i++
  ) {
    const xi = outerRing[i][0];
    const yi = outerRing[i][1];
    const xj = outerRing[j][0];
    const yj = outerRing[j][1];

    const intersects =
      yi > lat !== yj > lat &&
      lon <
        ((xj - xi) * (lat - yi)) /
          (yj - yi) +
          xi;

    if (intersects) {
      inside = !inside;
    }
  }

  return inside;
}
