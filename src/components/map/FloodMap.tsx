import { useEffect, useRef, useState } from "react";
import {
  Map as MaplibreMap,
  NavigationControl,
  Popup,
  type GeoJSONSource,
  type MapGeoJSONFeature,
  type MapLayerMouseEvent,
  type StyleSpecification,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { FloodZone, RouteRecommendation } from "../../types/flood";
import { ANDHERI_BOUNDS, ANDHERI_CENTER, zonesToFeatureCollection } from "../../utils/mapUtils";
import { RISK_COLORS } from "../../utils/riskUtils";
import { MapLegend } from "./MapLegend";

interface FloodMapProps {
  zones: FloodZone[];
  selectedZoneId: string | null;
  onSelectZone: (zoneId: string | null) => void;
  activeRoute: RouteRecommendation | null;
}

const EMPTY_FC: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

/**
 * The map is initialised with this minimal, zero-network-dependency style (a solid
 * background colour, no remote fetch) rather than a remote style JSON URL. This is a
 * deliberate reliability choice: the flood-risk layers (the actual point of this
 * screen) are added in the SAME 'load' handler as the style, so if the map's root
 * style ever depended on a flaky network fetch, a slow/blocked basemap request could
 * delay or entirely prevent 'load' from firing — silently blanking the whole map,
 * flood layers included. Using an inline style guarantees 'load' fires immediately,
 * so zones/roads/routes are always visible regardless of network conditions. The
 * OSM basemap (see OSM_RASTER_TILES below) is then layered in underneath as a
 * best-effort visual enhancement that cannot block or break the core map.
 */
const BASE_STYLE: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{ id: "background", type: "background", paint: { "background-color": "#0a0f1a" } }],
};

/**
 * Free, keyless OpenStreetMap standard raster tiles. Switched from CARTO's
 * "keyless" dark_all endpoint after CARTO began serving "API KEY REQUIRED"
 * watermark tiles on every anonymous request (Aug 2026) — their free tier now
 * requires signup. OSM's own tile server remains free and keyless. Added as a plain
 * `raster` source (not a full remote style JSON) so a failed/blocked tile request
 * only leaves that one tile blank — it can never break the flood-risk visualization
 * on top, unlike loading a whole remote style as the map's root style would (see
 * BASE_STYLE above).
 *
 * Note: OSM's standard style is light-themed, not dark like CARTO's dark_all — if
 * you want a dark basemap back, sign up for a free CARTO or Mapbox API key instead.
 */
const OSM_RASTER_TILES = [
  "https://a.tile.openstreetmap.org/{z}/{x}/{y}.png",
  "https://b.tile.openstreetmap.org/{z}/{x}/{y}.png",
  "https://c.tile.openstreetmap.org/{z}/{x}/{y}.png",
];

/**
 * Andheri flood-risk map (MapLibre GL JS). See README.md "Known Issues" —
 * maplibre-gl is pinned to 4.7.1 rather than the latest 6.x: 6.x's GeoJSON worker
 * failed to reach a loaded state in constrained/low-core-count environments during
 * testing (sources never rendered despite valid data), which 4.7.1 does not exhibit.
 * Revisit the pin once that's confirmed fixed upstream.
 */
export function FloodMap({ zones, selectedZoneId, onSelectZone, activeRoute }: FloodMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MaplibreMap | null>(null);
  const popupRef = useRef<Popup | null>(null);
  const prevSelectedRef = useRef<string | null>(null);
  const [isMapReady, setIsMapReady] = useState(false);

  // --- Mount: create the map once ---
  useEffect(() => {
    if (!containerRef.current) return;

    const map = new MaplibreMap({
      container: containerRef.current,
      style: BASE_STYLE,
      center: ANDHERI_CENTER,
      zoom: 12.5,
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    map.addControl(new NavigationControl({ showCompass: false }), "top-right");
    map.fitBounds(ANDHERI_BOUNDS, { padding: 32, duration: 0 });

    popupRef.current = new Popup({ closeButton: false, closeOnClick: false, maxWidth: "220px" });

    map.on("load", () => {
      // Best-effort basemap. Deliberately added first and with no error handling
      // beyond MapLibre's own per-tile fallback (blank tile) — its failure must never
      // block the flood layers below from rendering.
      map.addSource("osm-basemap", { type: "raster", tiles: OSM_RASTER_TILES, tileSize: 256 });
      map.addLayer({ id: "osm-basemap-layer", type: "raster", source: "osm-basemap", paint: { "raster-opacity": 0.85 } });

      // Real Andheri road network, derived from edge_cache.pkl (see
      // scripts/build_zones.py) — context layer, not interactive.
      map.addSource("roads", {
        type: "geojson",
        data: `${import.meta.env.BASE_URL}data/andheri_roads.geojson`,
      });
      map.addLayer({
        id: "roads-line",
        type: "line",
        source: "roads",
        paint: {
          "line-color": "#3a4a63",
          "line-opacity": 0.65,
          "line-width": [
            "match",
            ["get", "highway"],
            ["trunk", "primary", "motorway"],
            2.2,
            ["secondary", "tertiary"],
            1.4,
            0.6,
          ],
        },
      });

      map.addSource("zones", { type: "geojson", data: EMPTY_FC, promoteId: "zoneId" });
      map.addLayer({
        id: "zones-fill",
        type: "fill",
        source: "zones",
        paint: {
          "fill-color": [
            "match",
            ["get", "risk"],
            "HIGH",
            RISK_COLORS.HIGH,
            "MODERATE",
            RISK_COLORS.MODERATE,
            RISK_COLORS.LOW,
          ],
          "fill-opacity": ["case", ["boolean", ["feature-state", "selected"], false], 0.62, 0.34],
        },
      });
      map.addLayer({
        id: "zones-outline",
        type: "line",
        source: "zones",
        paint: {
          "line-color": [
            "match",
            ["get", "risk"],
            "HIGH",
            RISK_COLORS.HIGH,
            "MODERATE",
            RISK_COLORS.MODERATE,
            RISK_COLORS.LOW,
          ],
          "line-width": ["case", ["boolean", ["feature-state", "selected"], false], 3, 1],
          "line-opacity": 0.9,
        },
      });

      map.addSource("route-fastest", { type: "geojson", data: EMPTY_FC });
      map.addLayer({
        id: "route-fastest-line",
        type: "line",
        source: "route-fastest",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": "#94a2b8",
          "line-width": 3,
          "line-dasharray": [0.2, 1.6],
          "line-opacity": 0.9,
        },
      });
      map.addSource("route-safe", { type: "geojson", data: EMPTY_FC });
      map.addLayer({
        id: "route-safe-line",
        type: "line",
        source: "route-safe",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#2fb8c6", "line-width": 4.5, "line-opacity": 0.95 },
      });

      const handleZoneClick = (e: MapLayerMouseEvent) => {
        const feature = e.features?.[0] as MapGeoJSONFeature | undefined;
        if (feature?.properties) onSelectZone(String(feature.properties.zoneId));
      };
      const handleMapClick = (e: MapLayerMouseEvent) => {
        const hits = map.queryRenderedFeatures(e.point, { layers: ["zones-fill"] });
        if (hits.length === 0) onSelectZone(null);
      };
      const handleMouseMove = (e: MapLayerMouseEvent) => {
        map.getCanvas().style.cursor = "pointer";
        const f = e.features?.[0];
        if (!f?.properties || !popupRef.current) return;
        const { zoneName, risk, probability } = f.properties as {
          zoneName: string;
          risk: string;
          probability: number;
        };
        popupRef.current
          .setLngLat(e.lngLat)
          .setHTML(
            `<div style="font-family:var(--font-sans);min-width:150px">` +
              `<div style="font-weight:600;font-size:12px;margin-bottom:2px">${zoneName}</div>` +
              `<div style="font-size:11px;color:${RISK_COLORS[risk as "LOW" | "MODERATE" | "HIGH"]}">${risk} · ${Math.round(
                probability * 100
              )}% flood probability</div>` +
              `</div>`
          )
          .addTo(map);
      };
      const handleMouseLeave = () => {
        map.getCanvas().style.cursor = "";
        popupRef.current?.remove();
      };

      map.on("click", "zones-fill", handleZoneClick);
      map.on("click", handleMapClick);
      map.on("mousemove", "zones-fill", handleMouseMove);
      map.on("mouseleave", "zones-fill", handleMouseLeave);

      setIsMapReady(true);
    });

    return () => {
      popupRef.current?.remove();
      map.remove();
      mapRef.current = null;
      setIsMapReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Keep the zones source in sync with live/simulation/forecast data ---
  useEffect(() => {
    if (!isMapReady || !mapRef.current) return;
    const source = mapRef.current.getSource("zones");
    if (source && "setData" in source) {
      (source as GeoJSONSource).setData(zonesToFeatureCollection(zones));
    }
  }, [isMapReady, zones]);

  // --- Selected-zone highlight via feature-state ---
  useEffect(() => {
    if (!isMapReady || !mapRef.current) return;
    const map = mapRef.current;
    if (prevSelectedRef.current) {
      map.setFeatureState({ source: "zones", id: prevSelectedRef.current }, { selected: false });
    }
    if (selectedZoneId) {
      map.setFeatureState({ source: "zones", id: selectedZoneId }, { selected: true });
    }
    prevSelectedRef.current = selectedZoneId;
  }, [isMapReady, selectedZoneId]);

  // --- Route overlay ---
  useEffect(() => {
    if (!isMapReady || !mapRef.current) return;
    const map = mapRef.current;
    const fastestSource = map.getSource("route-fastest");
    const safeSource = map.getSource("route-safe");
    if (!fastestSource || !safeSource || !("setData" in fastestSource)) return;

    if (!activeRoute) {
      (fastestSource as GeoJSONSource).setData(EMPTY_FC);
      (safeSource as GeoJSONSource).setData(EMPTY_FC);
      return;
    }
    (fastestSource as GeoJSONSource).setData({
      type: "Feature",
      properties: {},
      geometry: activeRoute.fastest.geometry,
    });
    (safeSource as GeoJSONSource).setData({
      type: "Feature",
      properties: {},
      geometry: activeRoute.safe.geometry,
    });
  }, [isMapReady, activeRoute]);

  return (
    <div className="relative w-full h-full">
      <div ref={containerRef} className="w-full h-full" />
      <MapLegend />
    </div>
  );
}
