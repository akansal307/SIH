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
  streetRisks: StreetRisk[]
): GeoJSON.FeatureCollection {
  const riskById = new Map(streetRisks.map((s) => [s.edgeId, s]));
  return {
    type: "FeatureCollection",
    features: roadsGeoJson.features.map((f) => {
      const risk = riskById.get((f.properties as any)?.edge_id);
      return {
        ...f,
        id: (f.properties as any)?.edge_id,
        properties: {
          ...f.properties,
          risk: risk?.risk ?? "LOW",
          probability: risk?.probability ?? 0,
          depthCm: risk?.depthCm ?? null,
          onsetMinutes: risk?.onsetMinutes ?? null,
        },
      };
    }),
  };
}
