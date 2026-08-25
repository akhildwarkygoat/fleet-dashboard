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

/* Riders who never rotate. A deep purple, deliberately darker and less pink than both the
   palette's magenta (#c026d3) and Half night's violet (#7c5cd6), so it reads as a different KIND
   of marker rather than as another route — this board is scanned for what still needs checking,
   not for what each stop is. */
export const FIXED_SHIFT_COLOR = "#6b21a8";

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
  const markersRef = useRef({});          // render key -> { marker, color, headcount, selId }
                                          // (a mixed stop renders twice, so key !== stop id there)
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

    /* One stop can hold both kinds of rider, and labelling that "1 of 3 do not rotate" reads as
       a riddle rather than an instruction. So a mixed stop becomes TWO dots instead: a purple one
       for the riders who never rotate and a route-coloured one for the riders who do. Each dot is
       then purely one thing, and its count is the count of that group.
       They sit ~13 m apart, which is nothing at the zoom the board opens on (and they cluster
       together anyway) but separates cleanly once you zoom in — which is exactly where somebody
       is deciding whether this stop still needs checking. */
    const SPLIT_DEG = 0.00012;
    const rendered = [];
    list.forEach((s) => {
      const fixed = s.fixedShift || 0;
      const total = s.riderCount ?? s.headcount ?? 0;
      const people = Array.isArray(s.people) ? s.people : null;
      if (fixed > 0 && fixed < total) {
        rendered.push({ ...s, key: s.id + "#fixed", selId: s.id, lng: s.lng - SPLIT_DEG, headcount: fixed, group: "fixed",
          people: people ? people.filter((p) => p.fixedShift) : null });
        rendered.push({ ...s, key: s.id + "#rota", selId: s.id, lng: s.lng + SPLIT_DEG, headcount: total - fixed, group: "rota",
          people: people ? people.filter((p) => !p.fixedShift) : null });
      } else {
        rendered.push({ ...s, key: s.id, selId: s.id, group: fixed > 0 ? "fixed" : null, people });
      }
    });

    rendered.forEach((s) => {
      // Purple = these riders never rotate, so this dot needs no re-check when the rota moves.
      // Anything in its route colour does. That contrast is the whole point of the marking.
      const color = s.group === "fixed" ? FIXED_SHIFT_COLOR : (rc[s.route] || t.primary);
      const n = s.headcount;
      const mk = L.marker([s.lat, s.lng], { icon: stopDot(color, n, s.selId === selRef.current), headcount: n || 0 });
      const note =
        s.group === "fixed"
          ? `<br><span style="color:${FIXED_SHIFT_COLOR};font-weight:700">&#128274; ${n === 1 ? "does not rotate" : "do not rotate"}</span>` +
            `<br><span style="color:#64748b;font-weight:400">same shift every week</span>`
          : s.group === "rota"
          ? `<br><span style="color:${color};font-weight:700">&#128260; ${n === 1 ? "rotates every Monday" : "rotate every Monday"}</span>` +
            `<br><span style="color:#64748b;font-weight:400">re-check when the rota moves</span>`
          : "";
      const ppl = Array.isArray(s.people) ? s.people : null;
      /* The dot's number is the EFFECTIVE headcount — riders minus expected absentees, i.e. seats
         to plan for. That is the right number to plan on and the wrong number to caption a list of
         names with: a stop with 3 people and a 2-seat demand would read "2 riders" above three
         names. So the tooltip counts the actual people and names the planning figure separately
         only when the two differ. */
      const realN = ppl ? ppl.length : (s.riderCount ?? n);
      const seatNote = !s.group && n != null && realN != null && n !== realN
        ? `<span style="color:#94a3b8;font-weight:400"> · ${n} seat${n === 1 ? "" : "s"} to plan</span>`
        : "";
      /* Vehicles: every registration serving this stop with its own rider count, not the
         "TN… +2" summary the dot carries. On a split marker only the buses that group's riders
         actually ride are listed, so the fixed half never claims a bus it has nobody on. */
      const groupBuses = s.group && Array.isArray(s.people)
        ? (() => {
            const tally = {};
            s.people.forEach((p) => { if (p.busId) tally[p.busId] = (tally[p.busId] || 0) + 1; });
            return Object.entries(tally).sort((a, b) => b[1] - a[1]);
          })()
        : (Array.isArray(s.buses) ? s.buses : null);
      const busLine = groupBuses && groupBuses.length
        ? groupBuses.map(([reg, c]) =>
            `<br><span style="color:${s.busColor || "#334155"};font-weight:700">&#128652; ${esc(reg)}` +
            (groupBuses.length > 1 || c !== realN ? `<span style="font-weight:400;color:#64748b"> · ${c} rider${c === 1 ? "" : "s"}</span>` : "") +
            `</span>`).join("")
        : (s.busName
            ? `<br><span style="color:${s.busColor || "#334155"};font-weight:700">&#128652; ${esc(s.busName)}</span>`
            : (s.busName === null && "busName" in s ? `<br><span style="color:#94a3b8">&#128652; unassigned</span>` : ""));

      /* Who is standing here. Capped because a tooltip that runs off the map is worse than one
         that says how many it left out; derived stops top out around 7 riders, but Zenwear's
         and the 7 am network's are not bounded by anything we control. */
      const NAME_CAP = 12;
      const nameLines = ppl && ppl.length
        ? `<br><div style="margin-top:3px;padding-top:3px;border-top:1px solid #e2e8f0;font-weight:400;color:#334155">` +
          ppl.slice(0, NAME_CAP).map((p) =>
            `${esc(p.name)}${p.code ? `<span style="color:#94a3b8"> · ${esc(p.code)}</span>` : ""}`).join("<br>") +
          (ppl.length > NAME_CAP ? `<br><span style="color:#94a3b8">+${ppl.length - NAME_CAP} more</span>` : "") +
          `</div>`
        : "";


      mk.bindTooltip(
        `<div style="font:600 12px/1.35 Inter,system-ui,sans-serif;max-width:230px"><b>${esc(s.name)}</b>` +
        (s.village ? `<br><span style="color:#64748b">${esc(s.village)}</span>` : "") +
        (realN != null ? `<br><span style="color:#0e7490">&#128101; ${realN} rider${realN === 1 ? "" : "s"}</span>${seatNote}` : "") +
        busLine +
        note +
        nameLines +
        `</div>`,
        { direction: "top", offset: [0, -12] }
      );
      mk.on("click", () => onSelRef.current && onSelRef.current(s.selId));
      markersRef.current[s.key] = { marker: mk, color, headcount: n, selId: s.selId };
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
      iconCreateFunction: makeCluster(t.primary, t.onPrimary),
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
    // A mixed stop is drawn as two markers sharing one stop id, so selection works on selId
    // rather than on the registry key — otherwise picking that row in the table would highlight
    // neither half of it.
    const forStop = (id) => Object.values(markersRef.current).filter((r) => r.selId === id);
    const restyle = (id, sel) => forStop(id).forEach((r) => r.marker.setIcon(stopDot(r.color, r.headcount, sel)));
    restyle(selRef.current, false);
    restyle(selectedId, true);
    selRef.current = selectedId;
    const hit = forStop(selectedId)[0];
    if (hit) cluster.zoomToShowLayer(hit.marker, () => hit.marker.openTooltip());
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
