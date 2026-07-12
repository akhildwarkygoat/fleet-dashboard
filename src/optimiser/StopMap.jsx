/* ============================================================================
 * optimiser/StopMap.jsx — Leaflet map (free OSM tiles).
 * Shows one coloured pin per stop, supports drop-pin mode, and can overlay the
 * optimiser's bus routes as coloured polylines (+ a depot marker).
 * ==========================================================================*/
import React, { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

const DEFAULT_CENTER = [13.0827, 80.2707]; // Chennai
const DEFAULT_ZOOM = 11;

function pinIcon(color, selected) {
  const size = selected ? 26 : 18;
  const ring = selected ? "box-shadow:0 0 0 4px rgba(255,255,255,.35),0 0 0 5px " + color + ";" : "";
  return L.divIcon({
    className: "stop-pin",
    html: `<div style="width:${size}px;height:${size}px;border-radius:50% 50% 50% 0;background:${color};transform:rotate(-45deg);border:2px solid #fff;${ring}"></div>`,
    iconSize: [size, size], iconAnchor: [size / 2, size],
  });
}
function depotIcon() {
  return L.divIcon({
    className: "depot-pin",
    html: `<div style="width:22px;height:22px;border-radius:6px;background:#0f172a;border:2px solid #fff;display:flex;align-items:center;justify-content:center;color:#fff;font-size:12px;font-weight:700;box-shadow:0 0 0 3px rgba(255,255,255,.25)">★</div>`,
    iconSize: [22, 22], iconAnchor: [11, 11],
  });
}

export default function StopMap({ t, stops, routeColors, selectedId, onSelect, dropPinMode, onDropPin, depot, polylines, height = 460 }) {
  const elRef = useRef(null), mapRef = useRef(null), layerRef = useRef(null), markersRef = useRef({});
  const dropRef = useRef(dropPinMode), onDropRef = useRef(onDropPin);
  dropRef.current = dropPinMode; onDropRef.current = onDropPin;

  useEffect(() => {
    const map = L.map(elRef.current, { zoomControl: true }).setView(DEFAULT_CENTER, DEFAULT_ZOOM);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "© OpenStreetMap", maxZoom: 19 }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    map.on("click", (e) => { if (dropRef.current && onDropRef.current) onDropRef.current(e.latlng.lat, e.latlng.lng); });
    mapRef.current = map;
    setTimeout(() => map.invalidateSize(), 0);
    return () => { map.remove(); mapRef.current = null; };
  }, []);

  useEffect(() => { if (elRef.current) elRef.current.style.cursor = dropPinMode ? "crosshair" : ""; }, [dropPinMode]);

  useEffect(() => {
    const map = mapRef.current, layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers(); markersRef.current = {};

    // optimiser route polylines (drawn under the pins)
    const allPts = [];
    (polylines || []).forEach((pl) => {
      if (pl.points && pl.points.length > 1) {
        L.polyline(pl.points, { color: pl.color, weight: 3, opacity: 0.8 }).addTo(layer);
        pl.points.forEach((pt) => allPts.push(pt));
      }
    });

    if (depot && depot.lat != null) {
      L.marker([depot.lat, depot.lng], { icon: depotIcon() }).bindTooltip(depot.name || "Factory", { direction: "top", offset: [0, -12] }).addTo(layer);
      allPts.push([depot.lat, depot.lng]);
    }

    const pinned = stops.filter((s) => s.lat != null && s.lng != null);
    pinned.forEach((s) => {
      const color = routeColors[s.route] || t.primary;
      const m = L.marker([s.lat, s.lng], { icon: pinIcon(color, s.id === selectedId) });
      m.bindTooltip(`${s.name} · ${s.route}`, { direction: "top", offset: [0, -16] });
      m.on("click", () => onSelect && onSelect(s.id));
      m.addTo(layer); markersRef.current[s.id] = m;
      allPts.push([s.lat, s.lng]);
    });

    if (allPts.length && !dropRef.current) {
      map.fitBounds(L.latLngBounds(allPts), { padding: [40, 40], maxZoom: 15 });
    }
  }, [stops, routeColors, selectedId, t, depot, polylines]);

  useEffect(() => {
    const map = mapRef.current, m = markersRef.current[selectedId];
    if (map && m) { map.panTo(m.getLatLng()); m.openTooltip(); }
  }, [selectedId]);

  return (
    <div className="rounded-2xl overflow-hidden border" style={{ borderColor: t.border }}>
      {dropPinMode && (
        <div className="px-4 py-2 text-sm font-medium" style={{ background: t.primarySoft, color: t.primary }}>
          Drop-pin mode: click the map to set coordinates for the selected stop.
        </div>
      )}
      <div ref={elRef} style={{ height, width: "100%", background: t.surface2 }} />
    </div>
  );
}
