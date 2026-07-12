/* ============================================================================
 * stops/StopMap.jsx  —  Leaflet map of all stops (free OpenStreetMap tiles)
 * ----------------------------------------------------------------------------
 * Uses Leaflet imperatively (not react-leaflet) to avoid bundler/version
 * friction and to keep full control over markers. Responsibilities:
 *   - one colored pin per stop, grouped by route color
 *   - hover/click shows the stop name; clicking selects it (calls onSelect)
 *   - auto-fit to show all current pins
 *   - "drop-pin mode": click anywhere to assign coordinates to a selected
 *     no-GPS stop (calls onDropPin with the clicked lat/lng)
 *
 * No API key needed — OSM raster tiles are free for light use.
 * ==========================================================================*/

import React, { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// India-wide default view until the first pin lands.
const DEFAULT_CENTER = [13.0827, 80.2707]; // Chennai
const DEFAULT_ZOOM = 11;

/** Small colored DivIcon — avoids Leaflet's broken default marker-image paths
 *  under Vite, and lets us tint each pin by its route color. */
function pinIcon(color, selected) {
  const size = selected ? 26 : 18;
  const ring = selected ? "box-shadow:0 0 0 4px rgba(255,255,255,.35),0 0 0 5px " + color + ";" : "";
  return L.divIcon({
    className: "stop-pin",
    html: `<div style="width:${size}px;height:${size}px;border-radius:50% 50% 50% 0;
      background:${color};transform:rotate(-45deg);border:2px solid #fff;${ring}"></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size],
  });
}

export default function StopMap({ t, stops, routeColors, selectedId, onSelect, dropPinMode, onDropPin }) {
  const elRef = useRef(null);
  const mapRef = useRef(null);
  const layerRef = useRef(null);     // LayerGroup holding all markers
  const markersRef = useRef({});     // id -> marker, for re-centering
  const dropRef = useRef(dropPinMode);
  const onDropRef = useRef(onDropPin);
  dropRef.current = dropPinMode;     // keep click handler reading fresh values
  onDropRef.current = onDropPin;

  // --- init map once ---
  useEffect(() => {
    const map = L.map(elRef.current, { zoomControl: true }).setView(DEFAULT_CENTER, DEFAULT_ZOOM);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap contributors",
      maxZoom: 19,
    }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);

    // Click empty map -> drop a pin for the selected no-GPS stop.
    map.on("click", (e) => {
      if (dropRef.current && onDropRef.current) {
        onDropRef.current(e.latlng.lat, e.latlng.lng);
      }
    });

    mapRef.current = map;
    // Leaflet needs a size recalc once its container is laid out.
    setTimeout(() => map.invalidateSize(), 0);
    return () => { map.remove(); mapRef.current = null; };
  }, []);

  // --- cursor hint while in drop-pin mode ---
  useEffect(() => {
    if (elRef.current) elRef.current.style.cursor = dropPinMode ? "crosshair" : "";
  }, [dropPinMode]);

  // --- redraw markers whenever stops / colors / selection change ---
  useEffect(() => {
    const map = mapRef.current, layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    markersRef.current = {};

    const pinned = stops.filter((s) => s.lat != null && s.lng != null);
    pinned.forEach((s) => {
      const color = routeColors[s.route] || t.primary;
      const m = L.marker([s.lat, s.lng], { icon: pinIcon(color, s.id === selectedId) });
      m.bindTooltip(`${s.name} · ${s.route}`, { direction: "top", offset: [0, -16] });
      m.on("click", () => onSelect && onSelect(s.id));
      m.addTo(layer);
      markersRef.current[s.id] = m;
    });

    // Auto-fit to all pins (skip while dropping a pin so the view stays put).
    if (pinned.length && !dropRef.current) {
      const bounds = L.latLngBounds(pinned.map((s) => [s.lat, s.lng]));
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
    }
  }, [stops, routeColors, selectedId, t]);

  // --- center on the selected stop when chosen from the table ---
  useEffect(() => {
    const map = mapRef.current;
    const m = markersRef.current[selectedId];
    if (map && m) {
      map.panTo(m.getLatLng());
      m.openTooltip();
    }
  }, [selectedId]);

  return (
    <div className="rounded-2xl overflow-hidden border" style={{ borderColor: t.border }}>
      {dropPinMode && (
        <div className="px-4 py-2 text-sm font-medium" style={{ background: t.primarySoft, color: t.primary }}>
          Drop-pin mode: click the map to set coordinates for the selected stop.
        </div>
      )}
      <div ref={elRef} style={{ height: 460, width: "100%", background: t.surface2 }} />
    </div>
  );
}
