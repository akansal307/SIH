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
import {
  ANDHERI_BOUNDS,
  ANDHERI_CENTER,
  zonesToFeatureCollection,
  joinStreetRisksToRoads,
} from "../../utils/mapUtils";
import { RISK_COLORS } from "../../utils/riskUtils";
import { getStreetRisks } from "../../api/floodApi";
import { MapLegend } from "./MapLegend";

interface FloodMapProps {
  zones: FloodZone[];
  selectedZoneId: string | null;
  onSelectZone: (zoneId: string | null) => void;

  selectedStreetId: string | null;
  onSelectStreet: (
    edgeId: string | null,
    point?: [number, number] | null
  ) => void;

  activeRoute: RouteRecommendation | null;
}

const EMPTY_FC: GeoJSON.FeatureCollection = {
  type: "FeatureCollection",
  features: [],
};

const BASE_STYLE: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [
    {
      id: "background",
      type: "background",
      paint: {
        "background-color": "#0a0f1a",
      },
    },
  ],
};

const OSM_RASTER_TILES = [
  "https://a.tile.openstreetmap.org/{z}/{x}/{y}.png",
  "https://b.tile.openstreetmap.org/{z}/{x}/{y}.png",
  "https://c.tile.openstreetmap.org/{z}/{x}/{y}.png",
];

export function FloodMap({
  zones,
  selectedZoneId,
  onSelectZone,
  selectedStreetId,
  onSelectStreet,
  activeRoute,
}: FloodMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MaplibreMap | null>(null);
  const popupRef = useRef<Popup | null>(null);

  const prevSelectedZoneRef = useRef<string | null>(null);
  const prevSelectedStreetRef = useRef<string | null>(null);

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

    map.addControl(
      new NavigationControl({ showCompass: false }),
      "top-right"
    );

    map.fitBounds(ANDHERI_BOUNDS, {
      padding: 32,
      duration: 0,
    });

    popupRef.current = new Popup({
      closeButton: false,
      closeOnClick: false,
      maxWidth: "220px",
    });

    map.on("load", () => {
      // ---------------------------------------------------------------------
      // BASEMAP
      // ---------------------------------------------------------------------

      map.addSource("osm-basemap", {
        type: "raster",
        tiles: OSM_RASTER_TILES,
        tileSize: 256,
      });

      map.addLayer({
        id: "osm-basemap-layer",
        type: "raster",
        source: "osm-basemap",
        paint: {
          "raster-opacity": 0.85,
        },
      });

      // ---------------------------------------------------------------------
      // FLOOD-RISK ZONES
      // ---------------------------------------------------------------------

      map.addSource("zones", {
        type: "geojson",
        data: EMPTY_FC,
        promoteId: "zoneId",
      });

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
          "fill-opacity": [
            "case",
            ["boolean", ["feature-state", "selected"], false],
            0.52,
            0.25,
          ],
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
          "line-width": [
            "case",
            ["boolean", ["feature-state", "selected"], false],
            3,
            1,
          ],
          "line-opacity": 0.9,
        },
      });

      // ---------------------------------------------------------------------
      // STREET NETWORK
      // ---------------------------------------------------------------------

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
          "line-opacity": [
            "case",
            ["boolean", ["feature-state", "selected"], false],
            1,
            0.9,
          ],
          "line-width": [
            "case",
            ["boolean", ["feature-state", "selected"], false],
            5,
            [
              "match",
              ["get", "highway"],
              ["trunk", "primary", "motorway"],
              3,
              ["secondary", "tertiary"],
              2,
              1.4,
            ],
          ],
        },
      });

      // ---------------------------------------------------------------------
      // ROADS HIT LAYER
      // Invisible wider line used to make road clicking reliable.
      // ---------------------------------------------------------------------

      map.addLayer({
        id: "roads-hit",
        type: "line",
        source: "roads",
        paint: {
          "line-color": "#000000",
          "line-opacity": 0,
          "line-width": 14,
        },
      });

      // ---------------------------------------------------------------------
      // ROUTES
      // ---------------------------------------------------------------------

      map.addSource("route-fastest", {
        type: "geojson",
        data: EMPTY_FC,
      });

      map.addLayer({
        id: "route-fastest-line",
        type: "line",
        source: "route-fastest",
        layout: {
          "line-cap": "round",
          "line-join": "round",
        },
        paint: {
          "line-color": "#94a2b8",
          "line-width": 3,
          "line-dasharray": [0.2, 1.6],
          "line-opacity": 0.9,
        },
      });

      map.addSource("route-safe", {
        type: "geojson",
        data: EMPTY_FC,
      });

      map.addLayer({
        id: "route-safe-line",
        type: "line",
        source: "route-safe",
        layout: {
          "line-cap": "round",
          "line-join": "round",
        },
        paint: {
          "line-color": "#2fb8c6",
          "line-width": 4.5,
          "line-opacity": 0.95,
        },
      });

      // ---------------------------------------------------------------------
      // ZONE CLICK
      // ---------------------------------------------------------------------

      const handleZoneClick = (e: MapLayerMouseEvent) => {
        const feature = e.features?.[0] as
          | MapGeoJSONFeature
          | undefined;

        if (feature?.properties) {
          onSelectZone(String(feature.properties.zoneId));
        }
      };

      // ---------------------------------------------------------------------
      // STREET CLICK
      // ---------------------------------------------------------------------

      const handleStreetClick = (e: MapLayerMouseEvent) => {
        const feature = e.features?.[0] as
          | MapGeoJSONFeature
          | undefined;

        if (!feature?.properties) return;

        const edgeId = feature.properties.edge_id;

        if (!edgeId) return;

        onSelectStreet(
          String(edgeId),
          [e.lngLat.lng, e.lngLat.lat]
        );
      };

      // ---------------------------------------------------------------------
      // MAP CLICK
      //
      // Important fix:
      // The map-level click now directly selects the road when the road
      // hit-layer is found. This makes street selection reliable even if the
      // layer-specific click handler doesn't fire.
      // ---------------------------------------------------------------------

      const handleMapClick = (e: MapLayerMouseEvent) => {
        const zoneHits = map.queryRenderedFeatures(e.point, {
          layers: ["zones-fill"],
        });

        const streetHits = map.queryRenderedFeatures(e.point, {
          layers: ["roads-hit"],
        });

        // If a street was clicked, select it directly.
        if (streetHits.length > 0) {
          const feature = streetHits[0] as MapGeoJSONFeature;

          if (feature.properties) {
            const edgeId = feature.properties.edge_id;

            if (edgeId) {
              onSelectStreet(
                String(edgeId),
                [e.lngLat.lng, e.lngLat.lat]
              );
            }
          }
        } else {
          onSelectStreet(null, null);
        }

        // Keep original zone-selection behavior.
        if (zoneHits.length === 0) {
          onSelectZone(null);
        }
      };

      // ---------------------------------------------------------------------
      // ZONE HOVER
      // ---------------------------------------------------------------------

      const handleZoneMouseMove = (e: MapLayerMouseEvent) => {
        map.getCanvas().style.cursor = "pointer";

        const feature = e.features?.[0];

        if (!feature?.properties || !popupRef.current) return;

        const properties = feature.properties as {
          zoneName?: string;
          name?: string;
          risk?: string;
          probability?: number;
        };

        const zoneName =
          properties.zoneName ??
          properties.name ??
          "Flood-risk zone";

        const risk = properties.risk ?? "LOW";

        const probability =
          typeof properties.probability === "number"
            ? properties.probability
            : 0;

        popupRef.current
          .setLngLat(e.lngLat)
          .setHTML(
            `<div style="font-family:var(--font-sans);min-width:150px">` +
              `<div style="font-weight:600;font-size:12px;margin-bottom:2px">${zoneName}</div>` +
              `<div style="font-size:11px;color:${
                RISK_COLORS[
                  risk as "LOW" | "MODERATE" | "HIGH"
                ]
              }">${risk} · ${Math.round(
                probability * 100
              )}% flood probability</div>` +
              `</div>`
          )
          .addTo(map);
      };

      // ---------------------------------------------------------------------
      // STREET HOVER
      // ---------------------------------------------------------------------

      const handleStreetMouseMove = (e: MapLayerMouseEvent) => {
        map.getCanvas().style.cursor = "pointer";

        const feature = e.features?.[0];

        if (!feature?.properties || !popupRef.current) return;

        const properties = feature.properties as {
          name?: string;
          highway?: string;
          risk?: string;
          probability?: number;
        };

        const label =
          properties.name &&
          properties.name !== "NaN"
            ? properties.name
            : properties.highway ?? "Street";

        const risk = properties.risk ?? "LOW";

        const probability =
          typeof properties.probability === "number"
            ? properties.probability
            : 0;

        popupRef.current
          .setLngLat(e.lngLat)
          .setHTML(
            `<div style="font-family:var(--font-sans);min-width:150px">` +
              `<div style="font-weight:600;font-size:12px;margin-bottom:2px">${label}</div>` +
              `<div style="font-size:11px;color:${
                RISK_COLORS[
                  risk as "LOW" | "MODERATE" | "HIGH"
                ]
              }">${risk} · ${Math.round(
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

      // ---------------------------------------------------------------------
      // EVENT LISTENERS
      // ---------------------------------------------------------------------

      map.on("click", "zones-fill", handleZoneClick);
      map.on("click", "roads-hit", handleStreetClick);
      map.on("click", handleMapClick);

      map.on(
        "mousemove",
        "zones-fill",
        handleZoneMouseMove
      );

      map.on(
        "mousemove",
        "roads-hit",
        handleStreetMouseMove
      );

      map.on(
        "mouseleave",
        "zones-fill",
        handleMouseLeave
      );

      map.on(
        "mouseleave",
        "roads-hit",
        handleMouseLeave
      );

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

  // -------------------------------------------------------------------------
  // FLOOD ZONES
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (!isMapReady || !mapRef.current) return;

    const source = mapRef.current.getSource("zones");

    if (source && "setData" in source) {
      (source as GeoJSONSource).setData(
        zonesToFeatureCollection(zones)
      );
    }
  }, [isMapReady, zones]);

  // -------------------------------------------------------------------------
  // STREET RISKS
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (!isMapReady || !mapRef.current) return;

    const map = mapRef.current;
    let cancelled = false;

    (async () => {
      try {
        const [roadsRes, risksRes] = await Promise.all([
          fetch(
            `${import.meta.env.BASE_URL}data/andheri_roads.geojson`
          ).then((r) => r.json()),
          getStreetRisks(),
        ]);

        if (cancelled) return;

        const joined = joinStreetRisksToRoads(
          roadsRes,
          risksRes.data
        );

        const source = map.getSource("roads");

        if (source && "setData" in source) {
          (source as GeoJSONSource).setData(joined);
        }
      } catch {
        // Keep the road network visible if street-risk loading fails.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isMapReady]);

  // -------------------------------------------------------------------------
  // SELECTED ZONE
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (!isMapReady || !mapRef.current) return;

    const map = mapRef.current;

    if (prevSelectedZoneRef.current) {
      map.setFeatureState(
        {
          source: "zones",
          id: prevSelectedZoneRef.current,
        },
        { selected: false }
      );
    }

    if (selectedZoneId) {
      map.setFeatureState(
        {
          source: "zones",
          id: selectedZoneId,
        },
        { selected: true }
      );
    }

    prevSelectedZoneRef.current = selectedZoneId;
  }, [isMapReady, selectedZoneId]);

  // -------------------------------------------------------------------------
  // SELECTED STREET
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (!isMapReady || !mapRef.current) return;

    const map = mapRef.current;

    if (prevSelectedStreetRef.current) {
      map.setFeatureState(
        {
          source: "roads",
          id: prevSelectedStreetRef.current,
        },
        { selected: false }
      );
    }

    if (selectedStreetId) {
      map.setFeatureState(
        {
          source: "roads",
          id: selectedStreetId,
        },
        { selected: true }
      );
    }

    prevSelectedStreetRef.current = selectedStreetId;
  }, [isMapReady, selectedStreetId]);

  // -------------------------------------------------------------------------
  // ROUTE OVERLAY
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (!isMapReady || !mapRef.current) return;

    const map = mapRef.current;

    const fastestSource = map.getSource("route-fastest");
    const safeSource = map.getSource("route-safe");

    if (
      !fastestSource ||
      !safeSource ||
      !("setData" in fastestSource)
    ) {
      return;
    }

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
      <div
        ref={containerRef}
        className="w-full h-full"
      />
      <MapLegend />
    </div>
  );
}
