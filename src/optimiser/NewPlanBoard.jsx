/* ============================================================================
 * optimiser/NewPlanBoard.jsx — map-first "build your own plan" board
 * ----------------------------------------------------------------------------
 * Interaction: ALL stops show on the map from the start (grey = unassigned).
 * Pick a bus (small card) → it becomes active → click stops on the map to add /
 * remove them from that bus (click several for multi-select). The KPI tiles scope
 * to the active bus while one is selected, else to the whole plan.
 * ==========================================================================*/
import React, { useEffect, useMemo, useState } from "react";
import { PALETTE } from "./ui.jsx";
import GMap from "./GMap.jsx";
import { routeGeometry } from "./roadGeom.js";
import { X, Trash2, Wand2, MousePointerClick, Maximize2, Minimize2, EyeOff, BarChart3, Bus } from "lucide-react";

const UNADDED = "#f87171"; // light red — stop not yet on any bus
const ADDED = "#4ade80";   // light green — stop assigned to a bus

export default function NewPlanBoard({ t, editor, fleet, depot, stopsById, totalRiders, demandOf, toast }) {
  const [activeBus, setActiveBus] = useState(null);
  const [busQuery, setBusQuery] = useState("");
  const busColor = useMemo(() => { const m = {}; fleet.forEach((b, i) => (m[b.id] = PALETTE[i % PALETTE.length])); return m; }, [fleet]);

  const busOfStop = useMemo(() => {
    const m = new Map();
    for (const [busId, ids] of editor.assign) ids.forEach((id) => m.set(id, busId));
    return m;
  }, [editor.assign]);

  const allStops = useMemo(() => [...stopsById.values()], [stopsById]);
  const assignedHeads = editor.perBus.reduce((n, r) => n + r.heads, 0);
  const progress = totalRiders ? (assignedHeads / totalRiders) * 100 : 0;
  const busesUsed = editor.perBus.filter((r) => r.stopIds.length).length;
  const unassignedCount = allStops.length - busOfStop.size;

  // map stops — coloured by their assigned bus (grey if none)
  // With a bus active, hide stops that belong to OTHER buses — only show what's assignable
  // (unassigned = red) plus this bus's own stops (green). With no bus active, show everything.
  const mapStops = useMemo(() => allStops
    .filter((s) => { const b = busOfStop.get(s.id); return !activeBus || !b || b === activeBus; })
    .map((s) => ({ ...s, route: busOfStop.has(s.id) ? "added" : "un", headcount: demandOf(s) })), [allStops, busOfStop, demandOf, activeBus]);
  const routeColors = useMemo(() => ({ added: ADDED, un: UNADDED }), []);

  // route lines to draw — all buses normally, but ONLY the active bus while one is selected
  // (so lines don't trace to the now-hidden other-bus stops).
  const shownRoutes = useMemo(() => editor.perBus.filter((r) => r.stops.length && (!activeBus || r.bus.id === activeBus)), [editor.perBus, activeBus]);
  const routeSig = useMemo(() => shownRoutes.map((r) => r.bus.id + ":" + r.stopIds.join(",")).join("|"), [shownRoutes]);
  const [roadPolys, setRoadPolys] = useState([]);
  useEffect(() => {
    let live = true;
    Promise.all(shownRoutes.map(async (r) => ({ color: busColor[r.bus.id], points: await routeGeometry(depot, r.stops) })))
      .then((p) => { if (live) setRoadPolys(p.filter((x) => x.points.length)); });
    return () => { live = false; };
  }, [routeSig]); // eslint-disable-line
  const straightPolys = useMemo(() => shownRoutes.map((r) => ({ color: busColor[r.bus.id], points: [[depot.lat, depot.lng], ...r.stops.map((s) => [s.lat, s.lng])] })), [shownRoutes, depot, busColor]);
  const polylines = roadPolys.length ? roadPolys : straightPolys;

  // click a stop on the map → append it to the active bus IN CLICK ORDER (no auto-sequence, so the
  // route chain matches the order you built it), or (if already on it) remove it AND every stop after
  // it in that chain — breaking a link detaches the tail. Use the bus card's ↯ to optimise the order.
  const onStopClick = (stopId) => {
    if (!activeBus) { toast && toast("Pick a bus first, then click stops on the map"); return; }
    const list = editor.assign.get(activeBus) || [];
    const i = list.indexOf(stopId);
    if (i >= 0) {
      const tail = list.length - i;
      editor.truncateFrom(activeBus, stopId);
      if (tail > 1 && toast) toast(`Removed this stop and ${tail - 1} after it`);
    } else editor.assignStop(stopId, activeBus, { sequence: false });
  };

  // KPI scope — active bus if one is picked, else the whole plan
  const row = activeBus ? editor.perBus.find((r) => r.bus.id === activeBus) : null;
  const k = editor.live ? editor.live.kpis : null;
  const busName = row ? row.bus.name : "";
  // people-weighted average ride across the used buses (mirrors the Fleet-plan avg-ride metric)
  const usedRows = editor.perBus.filter((r) => r.stopIds.length);
  const rideHeads = usedRows.reduce((n, r) => n + r.heads, 0) || 1;
  const avgRide = usedRows.reduce((n, r) => n + r.ride * r.heads, 0) / rideHeads;

  const tiles = row ? [
    { label: `Riders · ${busName}`, value: `${row.heads} / ${row.cap}`, sub: row.overCap ? "over capacity" : row.overSeats ? "over seats" : "seats filled", accent: row.overCap ? t.poor : row.overSeats ? t.watch : t.techno, dc: row.overCap ? t.poor : row.overSeats ? t.watch : t.muted },
    { label: "Utilisation", value: `${Math.round(row.fill * 100)}%`, sub: `${row.stops.length} stops`, accent: row.fill >= 0.85 ? t.good : t.watch },
    { label: "Cost / head / day", value: row.heads ? `₹${(row.cost / row.heads).toFixed(1)}` : "—", sub: `₹${Math.round(row.cost)} / day`, accent: t.primary },
    { label: "Ride (to last stop)", value: `${Math.round(row.ride)} min`, sub: row.km ? `${row.km.toFixed(1)} km/day` : "", accent: row.ride < 100 ? t.good : t.poor },
  ] : [
    { label: "People", value: `${assignedHeads} / ${totalRiders}`, sub: `${progress.toFixed(0)}% assigned`, accent: t.techno, dc: progress >= 99.5 ? t.good : t.muted },
    { label: "Avg util", value: k ? `${k.utilisation.toFixed(0)}%` : "—", sub: `${busesUsed} bus${busesUsed === 1 ? "" : "es"} used`, accent: k && k.utilisation >= 85 ? t.good : t.watch },
    { label: "Cost / head / day", value: k && k.heads ? `₹${k.costPerHeadDay.toFixed(1)}` : "—", sub: k ? `₹${Math.round(k.totalCost).toLocaleString("en-IN")} / day` : "", accent: t.primary },
    { label: "Avg ride", value: usedRows.length ? `${Math.round(avgRide)} min` : "—", sub: `${unassignedCount} stops left`, accent: usedRows.length && avgRide <= 60 ? t.good : t.poor },
  ];

  const busList = useMemo(() => {
    const q = busQuery.trim().toLowerCase();
    return editor.perBus.filter((r) => !q || r.bus.name.toLowerCase().includes(q));
  }, [editor.perBus, busQuery]);

  // fill most of the viewport — the New-plan tab opens as a big map cockpit; a toggle blows it up to
  // true fullscreen (covers the header/tabs). Height tracks the window so it stays right on resize.
  const [winH, setWinH] = useState(() => (typeof window !== "undefined" ? window.innerHeight : 800));
  useEffect(() => {
    const on = () => setWinH(window.innerHeight);
    window.addEventListener("resize", on); return () => window.removeEventListener("resize", on);
  }, []);
  const [full, setFull] = useState(false);
  const [showKpis, setShowKpis] = useState(true);
  const [showBuses, setShowBuses] = useState(true);
  const containerH = full ? winH : Math.max(540, winH - 200);
  const PAD = 16; // consistent inset for the floating overlays

  // Apple "liquid glass" for the floating overlays
  const glass = {
    background: "rgba(255,255,255,0.62)",
    backdropFilter: "blur(16px) saturate(180%)", WebkitBackdropFilter: "blur(16px) saturate(180%)",
    border: "1px solid rgba(255,255,255,0.55)",
    boxShadow: "0 8px 30px rgba(15,23,42,.20), inset 0 1px 1px rgba(255,255,255,0.75), inset 0 -1px 2px rgba(255,255,255,0.35)",
  };
  const PANEL_W = 300; // right bus panel width

  return (
    <div className={full ? "fixed inset-0 z-[1500] overflow-hidden" : "relative rounded-2xl overflow-hidden"}
      style={{ height: containerH, border: full ? "none" : "1px solid " + t.border, background: t.surface, marginTop: full ? 0 : undefined }}>
      {/* base map — click stops to assign to the active bus */}
      <GMap t={t} stops={mapStops} routeColors={routeColors} depot={depot} polylines={polylines} onSelect={onStopClick} height={containerH} scrollWheelZoom={true} autoFit={false} />

      {/* fullscreen toggle — bottom-left, clear of the panels/attribution */}
      <button type="button" onClick={() => setFull((f) => !f)} title={full ? "Exit fullscreen" : "Fullscreen map"}
        className="absolute z-[600] rounded-lg px-3 py-1.5 text-xs font-semibold flex items-center gap-1.5" style={{ bottom: PAD, left: PAD, ...glass }}>
        {full ? <><Minimize2 size={13} /> Exit fullscreen</> : <><Maximize2 size={13} /> Fullscreen</>}
      </button>

      {/* restore buttons when a panel is hidden */}
      {!showKpis && (
        <button type="button" onClick={() => setShowKpis(true)} title="Show stats"
          className="absolute z-[600] rounded-lg px-3 py-1.5 text-xs font-semibold flex items-center gap-1.5" style={{ top: PAD, left: 64, color: t.text, ...glass }}>
          <BarChart3 size={13} /> Stats
        </button>
      )}
      {!showBuses && (
        <button type="button" onClick={() => setShowBuses(true)} title="Show buses"
          className="absolute z-[600] rounded-lg px-3 py-1.5 text-xs font-semibold flex items-center gap-1.5" style={{ top: PAD, right: PAD, color: t.text, ...glass }}>
          <Bus size={13} /> Buses ({busesUsed}/{fleet.length})
        </button>
      )}

      {/* KPI glass strip — floats over the top of the map (clear of the zoom controls / bus panel) */}
      {showKpis && (
      <div className="absolute z-[600] rounded-2xl px-3 py-2.5" style={{ top: PAD, left: 64, right: showBuses ? PANEL_W + PAD * 2 : PAD, ...glass }}>
        <div className="flex items-center gap-1.5 text-[11px] font-medium mb-2" style={{ color: activeBus ? t.primary : t.muted }}>
          <MousePointerClick size={13} />
          {activeBus
            ? <><b>Assigning to {busName}</b> — click stops on the map to add/remove (click several for multiple).</>
            : <>Pick a bus on the right, then click stops on the map to assign them.</>}
          {activeBus && <button type="button" onClick={() => setActiveBus(null)} className="inline-flex items-center gap-1 rounded-lg px-2 py-0.5 font-semibold" style={{ border: "1px solid " + t.border, background: "rgba(255,255,255,0.7)", color: t.text, cursor: "pointer" }}><X size={11} /> Done</button>}
          <button type="button" onClick={() => setShowKpis(false)} title="Hide stats" className={activeBus ? "" : "ml-auto"} style={{ color: t.muted, cursor: "pointer" }}><EyeOff size={13} /></button>
        </div>
        <div className="grid grid-cols-4 gap-2">
          {tiles.map((c, i) => (
            <div key={i} className="rounded-xl px-2.5 py-1.5 relative overflow-hidden" style={{ background: "rgba(255,255,255,0.5)", border: "1px solid rgba(255,255,255,0.6)" }}>
              <span className="absolute left-0 top-0 bottom-0 w-1" style={{ background: c.accent || t.primary }} />
              <div className="text-[9px] uppercase tracking-wider pl-1.5 truncate" style={{ color: t.muted }}>{c.label}</div>
              <div className="text-lg font-bold tabular-nums pl-1.5 leading-tight" style={{ color: t.text }}>{c.value}</div>
              <div className="text-[9px] pl-1.5 truncate" style={{ color: c.dc || t.muted }}>{c.sub}</div>
            </div>
          ))}
        </div>
      </div>
      )}

      {/* Bus glass panel — floats on the right of the map */}
      {showBuses && (
      <div className="absolute z-[600] rounded-2xl flex flex-col overflow-hidden" style={{ top: PAD, right: PAD, bottom: PAD, width: PANEL_W, ...glass }}>
        <div className="flex items-center justify-between px-3 pt-3 pb-2">
          <span className="text-xs font-bold uppercase tracking-wider" style={{ color: t.text }}>Your buses</span>
          <div className="flex items-center gap-2">
            <span className="text-[11px]" style={{ color: t.muted }}>{busesUsed}/{fleet.length} used</span>
            <button type="button" onClick={() => setShowBuses(false)} title="Hide bus list" style={{ color: t.muted, cursor: "pointer" }}><EyeOff size={14} /></button>
          </div>
        </div>
        <div className="px-3 pb-2">
          <input value={busQuery} onChange={(e) => setBusQuery(e.target.value)} placeholder="Find a bus…"
            className="w-full rounded-lg px-3 py-2 text-sm outline-none" style={{ border: "1px solid " + t.border, background: "rgba(255,255,255,0.6)", color: t.text }} />
        </div>
        <div className="grid grid-cols-2 gap-2 overflow-y-auto px-3 pb-3">
          {busList.map((r) => {
            const on = activeBus === r.bus.id;
            const fillCol = r.overCap ? t.poor : r.overSeats ? t.watch : r.stopIds.length ? t.good : t.border;
            return (
              <button key={r.bus.id} type="button" onClick={() => setActiveBus(on ? null : r.bus.id)}
                className="text-left rounded-xl p-2.5 transition-all" style={{
                  border: "1.5px solid " + (on ? t.primary : r.overCap ? t.poor : "rgba(255,255,255,0.6)"),
                  background: on ? t.primarySoft : "rgba(255,255,255,0.5)",
                  boxShadow: on ? "0 0 0 3px " + t.primarySoft : "none", cursor: "pointer",
                }}>
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: busColor[r.bus.id] }} />
                  <span className="text-xs font-semibold truncate" style={{ color: t.text }}>{r.bus.name}</span>
                </div>
                <div className="h-1 rounded-full overflow-hidden mb-1" style={{ background: "rgba(15,23,42,0.08)" }}>
                  <div className="h-full rounded-full" style={{ width: Math.min(100, r.fill * 100) + "%", background: fillCol }} />
                </div>
                <div className="flex items-center justify-between text-[10px]" style={{ color: r.overCap ? t.poor : t.muted }}>
                  <span>{r.bus.type} · {r.cap}</span>
                  <span className="tabular-nums font-semibold">{r.heads}/{r.cap}</span>
                </div>
                {on && r.stopIds.length > 0 && (
                  <div className="flex items-center gap-2 mt-1.5 pt-1.5" style={{ borderTop: "1px solid rgba(15,23,42,0.1)" }}>
                    <span className="text-[10px]" style={{ color: t.muted }}>{Math.round(r.ride)}m · ₹{Math.round(r.cost)}</span>
                    <span className="flex-1" />
                    <button type="button" title="Auto-sequence" onClick={(e) => { e.stopPropagation(); editor.autoSequence(r.bus.id); }} style={{ color: t.muted, cursor: "pointer" }}><Wand2 size={12} /></button>
                    <button type="button" title="Clear bus" onClick={(e) => { e.stopPropagation(); editor.clearBus(r.bus.id); }} style={{ color: t.muted, cursor: "pointer" }}><Trash2 size={12} /></button>
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>
      )}
    </div>
  );
}
