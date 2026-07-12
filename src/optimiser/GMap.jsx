/* ============================================================================
 * optimiser/GMap.jsx — Leaflet map with free OpenStreetMap tiles (NO Google key).
 * Same prop interface as before (stops, routeColors, depot, polylines, selection,
 * drop-pin) so callers are unchanged. Dense stop clumps collapse into themed
 * count-bubbles via leaflet.markercluster; selecting a stop reveals + highlights it.
 *
 * Why Leaflet, not Google: the whole app runs offline off a cached road matrix
 * ("no Google tokens"). The old Google tile layer needed a billed API key and
 * rendered as dark "for development purposes only" tiles without one.
 * ==========================================================================*/
import React, { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet.markercluster";
import "leaflet.markercluster/dist/MarkerCluster.css";

const OSM_URL = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const OSM_ATTR = "© OpenStreetMap";
const DEFAULT_CENTER = [10.35, 78.0]; // Tamil Nadu interior (fallback until fitBounds runs)
const DEFAULT_ZOOM = 9;

const esc = (x) => String(x || "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

/* A stop dot: coloured disc with the headcount, larger + ringed when selected. */
function stopDot(color, headcount, sel) {
  const size = sel ? 30 : 24;
  const ring = sel ? `box-shadow:0 0 0 3px #fff,0 0 0 5px ${color};` : "box-shadow:0 1px 3px rgba(0,0,0,.35);";
  return L.divIcon({
    className: "gmap-stop",
    html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${color};border:2px solid #fff;${ring}display:flex;align-items:center;justify-content:center;color:#fff;font:700 ${sel ? 12 : 11}px/1 Inter,system-ui,sans-serif">${headcount ?? "?"}</div>`,
    iconSize: [size, size], iconAnchor: [size / 2, size / 2],
  });
}

/* The depot marker — a dark teardrop pin with a factory glyph. */
function factoryPin() {
  const html =
    '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="50" viewBox="0 0 46 58">' +
    '<path d="M23 57 C12 41 2.5 33.5 2.5 21 A20.5 20.5 0 1 1 43.5 21 C43.5 33.5 34 41 23 57 Z" fill="#0f172a" stroke="#ffffff" stroke-width="2.5"/>' +
    '<g transform="translate(11 9)" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M2 20a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8l-7 5V8l-7 5V4a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"/>' +
    '<path d="M17 18h1"/><path d="M12 18h1"/><path d="M7 18h1"/></g></svg>';
  return L.divIcon({ className: "gmap-depot", html, iconSize: [40, 50], iconAnchor: [20, 50] });
}

/* Themed cluster bubble: shows the PASSENGER STRENGTH (sum of headcounts) of the
   stops it groups, not the stop count. Soft halo + solid disc + white number. */
const makeCluster = (primary, onPrimary) => (cluster) => {
  const total = cluster.getAllChildMarkers().reduce((s, m) => s + (m.options.headcount || 0), 0);
  const size = total < 25 ? 36 : total < 100 ? 44 : total < 300 ? 52 : 62;
  const fs = total >= 1000 ? 11 : total >= 100 ? 12.5 : 13.5;
  const html =
    `<div style="width:${size}px;height:${size}px;position:relative">` +
    `<div style="position:absolute;inset:0;border-radius:50%;background:${primary};opacity:.20"></div>` +
    `<div style="position:absolute;inset:7px;border-radius:50%;background:${primary};border:2.5px solid #fff;display:flex;align-items:center;justify-content:center;color:${onPrimary};font:700 ${fs}px/1 Inter,system-ui,sans-serif">${total}</div>` +
    `</div>`;
  return L.divIcon({ html, className: "gmap-cluster", iconSize: [size, size] });
};

export default function GMap({ t, stops, routeColors, depot, polylines, selectedId, onSelect, dropPinMode, onDropPin, height = 460, scrollWheelZoom = false, autoFit = true }) {
  const elRef = useRef(null), mapRef = useRef(null);
  const clusterRef = useRef(null), polyLayerRef = useRef(null), depotRef = useRef(null);
  const markersRef = useRef({});          // stop.id -> { marker, color, headcount }
  const selRef = useRef(selectedId);
  const sigRef = useRef("");
  const fitSigRef = useRef("");

  // latest callbacks/props for use inside the map's own event handlers
  const dropRef = useRef(dropPinMode), onDropRef = useRef(onDropPin), onSelRef = useRef(onSelect);
  dropRef.current = dropPinMode; onDropRef.current = onDropPin; onSelRef.current = onSelect;

  const buildStops = () => {
    const cluster = clusterRef.current; if (!cluster) return;
    cluster.clearLayers();
    markersRef.current = {};
    const list = (stops || []).filter((s) => s.lat != null && s.lng != null);
    const rc = routeColors || {};
    const batch = [];
    list.forEach((s) => {
      const color = rc[s.route] || t.primary || "#6366f1";
      const mk = L.marker([s.lat, s.lng], { icon: stopDot(color, s.headcount, s.id === selRef.current), headcount: s.headcount || 0 });
      mk.bindTooltip(
        `<div style="font:600 12px/1.35 Inter,system-ui,sans-serif"><b>${esc(s.name)}</b>` +
        (s.village ? `<br><span style="color:#64748b">${esc(s.village)}</span>` : "") +
        (s.headcount != null ? `<br><span style="color:#0e7490">&#128101; ${s.headcount} rider${s.headcount === 1 ? "" : "s"}</span>` : "") +
        `</div>`,
        { direction: "top", offset: [0, -12] }
      );
      mk.on("click", () => onSelRef.current && onSelRef.current(s.id));
      markersRef.current[s.id] = { marker: mk, color, headcount: s.headcount };
      batch.push(mk);
    });
    cluster.addLayers(batch);
  };

  const fit = () => {
    const map = mapRef.current; if (!map || dropRef.current) return;
    const pts = Object.values(markersRef.current).map((r) => r.marker.getLatLng());
    if (depot && depot.lat != null) pts.push(L.latLng(depot.lat, depot.lng));
    if (pts.length) map.fitBounds(L.latLngBounds(pts), { padding: [40, 40], maxZoom: 15 });
  };

  // init the map once
  useEffect(() => {
    const map = L.map(elRef.current, { zoomControl: true, scrollWheelZoom }).setView(DEFAULT_CENTER, DEFAULT_ZOOM);
    L.tileLayer(OSM_URL, { attribution: OSM_ATTR, maxZoom: 19 }).addTo(map);
    polyLayerRef.current = L.layerGroup().addTo(map);
    clusterRef.current = L.markerClusterGroup({
      showCoverageOnHover: false,
      maxClusterRadius: 60,
      iconCreateFunction: makeCluster(t.primary || "#6366f1", t.onPrimary || "#ffffff"),
    }).addTo(map);
    map.on("click", (e) => { if (dropRef.current && onDropRef.current) onDropRef.current(e.latlng.lat, e.latlng.lng); });
    mapRef.current = map;
    setTimeout(() => map.invalidateSize(), 0);
    buildStops(); fit();
    return () => { map.remove(); mapRef.current = null; };
    // eslint-disable-next-line
  }, []);

  // rebuild stops when the set/colours change (guarded by a content signature so
  // the dashboard's periodic re-render doesn't reset the user's zoom/cluster view)
  useEffect(() => {
    if (!mapRef.current) return;
    // Fit only when the stop POSITIONS change (which stops are shown) — not when only their
    // colour/route changes. Lets a caller recolour stops on click (assignment) without yanking
    // the user's zoom/pan back to the full-fleet bounds.
    const posSig = (stops || []).map((s) => s.id + ":" + s.lat + "," + s.lng).join("|");
    const sig = posSig + "§" + (stops || []).map((s) => s.route + "," + (s.headcount ?? "")).join("|") + "§" + JSON.stringify(routeColors || {});
    if (sig === sigRef.current) return;
    sigRef.current = sig;
    buildStops();
    if (posSig !== fitSigRef.current) { fitSigRef.current = posSig; if (autoFit) fit(); }
    // eslint-disable-next-line
  }, [stops, routeColors]);

  // selection → restyle prev + new marker, and reveal the selected one from its cluster
  useEffect(() => {
    const cluster = clusterRef.current; if (!cluster) return;
    const restyle = (id, sel) => { const r = markersRef.current[id]; if (r) r.marker.setIcon(stopDot(r.color, r.headcount, sel)); };
    restyle(selRef.current, false);
    restyle(selectedId, true);
    selRef.current = selectedId;
    const r = markersRef.current[selectedId];
    if (r) cluster.zoomToShowLayer(r.marker, () => r.marker.openTooltip());
    // eslint-disable-next-line
  }, [selectedId]);

  // optimiser route polylines
  useEffect(() => {
    const layer = polyLayerRef.current; if (!layer) return;
    layer.clearLayers();
    (polylines || []).forEach((pl) => {
      if (pl.points && pl.points.length > 1) L.polyline(pl.points, { color: pl.color, weight: 4, opacity: 0.85 }).addTo(layer);
    });
  }, [polylines]);

  // depot marker
  useEffect(() => {
    const map = mapRef.current; if (!map) return;
    if (depotRef.current) { depotRef.current.remove(); depotRef.current = null; }
    if (depot && depot.lat != null) {
      depotRef.current = L.marker([depot.lat, depot.lng], { icon: factoryPin(), zIndexOffset: 1000 })
        .bindTooltip(depot.name || "Factory", { direction: "top", offset: [0, -44] }).addTo(map);
    }
  }, [depot]);

  useEffect(() => { if (elRef.current) elRef.current.style.cursor = dropPinMode ? "crosshair" : ""; }, [dropPinMode]);

  // the container was resized (e.g. fullscreen toggle) — tell Leaflet to recompute its size
  useEffect(() => { const m = mapRef.current; if (m) setTimeout(() => m.invalidateSize({ animate: false }), 0); }, [height]);

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
