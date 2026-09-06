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
import type { RouteRecommendation } from "../../types/flood";
import { ANDHERI_BOUNDS, ANDHERI_CENTER, joinStreetRisksToRoads } from "../../utils/mapUtils";
import { RISK_COLORS } from "../../utils/riskUtils";
import { getStreetRisks } from "../../api/floodApi";
import { MapLegend } from "./MapLegend";

interface FloodMapProps {
  selectedStreetId: string | null;
  onSelectStreet: (edgeId: string | null, point?: [number, number] | null) => void;
  activeRoute: RouteRecommendation | null;
}

const EMPTY_FC: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

const BASE_STYLE: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{ id: "background", type: "background", paint: { "background-color": "#0a0f1a" } }],
};

const OSM_RASTER_TILES = [
  "https://a.tile.openstreetmap.org/{z}/{x}/{y}.png",
  "https://b.tile.openstreetmap.org/{z}/{x}/{y}.png",
  "https://c.tile.openstreetmap.org/{z}/{x}/{y}.png",
];

export function FloodMap({ selectedStreetId, onSelectStreet, activeRoute }: FloodMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MaplibreMap | null>(null);
  const popupRef = useRef<Popup | null>(null);
  const prevSelectedRef = useRef<string | null>(null);
  const [isMapReady, setIsMapReady] = useState(false);

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
      map.addSource("osm-basemap", { type: "raster", tiles: OSM_RASTER_TILES, tileSize: 256 });
      map.addLayer({ id: "osm-basemap-layer", type: "raster", source: "osm-basemap", paint: { "raster-opacity": 0.85 } });

      map.addSource("roads", {
        type: "geojson",
        data: `${import.meta.env.BASE_URL}data/andheri_roads.geojson`,
        promoteId: "edge_id",
      });
      map.addLayer({
        id: "roads-line",
        type: "line",
        source: "roads",
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
          "line-opacity": ["case", ["boolean", ["feature-state", "selected"], false], 1, 0.8],
          "line-width": [
            "case",
            ["boolean", ["feature-state", "selected"], false],
            5,
            ["match", ["get", "highway"], ["trunk", "primary", "motorway"], 3, ["secondary", "tertiary"], 2, 1.4],
          ],
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

      const handleStreetClick = (e: MapLayerMouseEvent) => {
        const feature = e.features?.[0] as MapGeoJSONFeature | undefined;
        if (feature?.properties) {
          onSelectStreet(String(feature.properties.edge_id), [e.lngLat.lng, e.lngLat.lat]);
        }
      };
      const handleMapClick = (e: MapLayerMouseEvent) => {
        const hits = map.queryRenderedFeatures(e.point, { layers: ["roads-line"] });
        if (hits.length === 0) onSelectStreet(null, null);
      };
      const handleMouseMove = (e: MapLayerMouseEvent) => {
        map.getCanvas().style.cursor = "pointer";
        const f = e.features?.[0];
        if (!f?.properties || !popupRef.current) return;
        const { name, highway, risk, probability } = f.properties as {
          name: string;
          highway: string;
          risk: string;
          probability: number;
        };
        const label = name && name !== "NaN" ? name : highway;
        popupRef.current
          .setLngLat(e.lngLat)
          .setHTML(
            `<div style="font-family:var(--font-sans);min-width:150px">` +
              `<div style="font-weight:600;font-size:12px;margin-bottom:2px">${label}</div>` +
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

      map.on("click", "roads-line", handleStreetClick);
      map.on("click", handleMapClick);
      map.on("mousemove", "roads-line", handleMouseMove);
      map.on("mouseleave", "roads-line", handleMouseLeave);

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

  useEffect(() => {
    if (!isMapReady || !mapRef.current) return;
    const map = mapRef.current;

    let cancelled = false;
    (async () => {
      const [roadsRes, risksRes] = await Promise.all([
        fetch(`${import.meta.env.BASE_URL}data/andheri_roads.geojson`).then((r) => r.json()),
        getStreetRisks(),
      ]);
      if (cancelled) return;
      const joined = joinStreetRisksToRoads(roadsRes, risksRes.data);
      const source = map.getSource("roads");
      if (source && "setData" in source) {
        (source as GeoJSONSource).setData(joined);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isMapReady]);

  useEffect(() => {
    if (!isMapReady || !mapRef.current) return;
    const map = mapRef.current;
    if (prevSelectedRef.current) {
      map.setFeatureState({ source: "roads", id: prevSelectedRef.current }, { selected: false });
    }
    if (selectedStreetId) {
      map.setFeatureState({ source: "roads", id: selectedStreetId }, { selected: true });
    }
    prevSelectedRef.current = selectedStreetId;
  }, [isMapReady, selectedStreetId]);

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
