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
import { X, Trash2, Wand2, MousePointerClick, Maximize2, Minimize2, EyeOff, BarChart3, Bus, SlidersHorizontal, MapPin } from "lucide-react";
import { KPI_DEFS, getHiddenKpis, setHiddenKpis, visibleKpis } from "./kpiPrefs.js";
import ParkPicker, { useParkPoints, parkLabel } from "./ParkPicker.jsx";
import { parkForRoute, setRoutePark, setRouteStart } from "./parkPrefs.js";

const UNADDED = "#f87171"; // light red — stop not yet on any bus
const ADDED = "#4ade80";   // light green — stop assigned to a bus

/* S = where the bus starts this run · P = where it parks when the run is done.
   Green reads as "go", amber as "stand" — and neither is any route colour in PALETTE, so an
   end pin can never be mistaken for a bus's own stops. */
export const START_COLOR = "#16a34a";
export const PARK_COLOR = "#b45309";

export default function NewPlanBoard({ t, editor, fleet, depot, stopsById, totalRiders, demandOf, toast, period = "evening", svcId = "plan", parkPrefs, setParkPrefs }) {
  // Assignments are stored in EVENING traversal order (factory → s1 → … → sn). Morning is the
  // same chain ridden backwards (sn → … → s1 → factory), so morning clicks PREPEND: the first
  // stop you click is where the bus starts, and each next click adds the stop after it on the
  // way to the factory. Costs/KPIs are direction-free (chain km already counts both runs).
  const morning = period === "morning";
  const [activeBus, setActiveBus] = useState(null);
  const [busQuery, setBusQuery] = useState("");
  const busColor = useMemo(() => { const m = {}; fleet.forEach((b, i) => (m[b.id] = PALETTE[i % PALETTE.length])); return m; }, [fleet]);
  const busById = useMemo(() => { const m = {}; fleet.forEach((b) => (m[b.id] = b)); return m; }, [fleet]);

  const busOfStop = useMemo(() => {
    const m = new Map();
    for (const [busId, ids] of editor.assign) ids.forEach((id) => m.set(id, busId));
    return m;
  }, [editor.assign]);

  /* ---- where each bus starts and parks ----
     Per bus, per service, so one registration can start and park differently on its Day run
     and its night one. The state lives in NewPlanView because the SCORING depends on it — km,
     ride time and cost are all measured between these two points — so the board receives it
     rather than owning it. Changing an end therefore moves the pins and the numbers together.

     Clicking a stop on the map is the other half of the answer: a village worth parking in is
     usually a stop the route already serves, and picking it off a list of 1,134 names is a
     worse way to say "that one" than pointing at it. */
  const parkPoints = useParkPoints();
  /* One state, not two. While `picking` is set the map is choosing that endpoint — there is no
     separate "armed" step to forget, and therefore no window in which a click means something
     other than what the open panel says it means. */
  const [picking, setPicking] = useState(null);       // { busId, which: "start"|"park" } | null
  const nameOf = (busId) => (busById[busId] || {}).name || busId;
  const specOf = (busId, which) =>
    which === "start"
      ? (parkPrefs.starts && parkPrefs.starts[`${svcId}|${nameOf(busId)}`]) || { kind: "auto" }
      : parkForRoute(svcId, nameOf(busId), parkPrefs);

  const setEnd = (busId, which, spec) => {
    const name = nameOf(busId);
    setParkPrefs(which === "start" ? setRouteStart(svcId, name, spec) : setRoutePark(svcId, name, spec));
    setPicking(null);
    const where = !spec || spec.kind === "auto" ? (which === "start" ? "the factory" : "where its route ends")
      : spec.kind === "depot" ? "the factory" : spec.name;
    toast && toast(`${name} ${which === "start" ? "starts from" : "parks at"} ${where}`);
  };

  /* S and P for the ACTIVE bus only. 97 buses would be 194 pins; while you are working on one,
     its two ends are what you need to see.
       evening — the bus leaves its start (S) and finishes out in the villages (P)
       morning — it starts where it parked (S) and delivers to the factory (P)
     The same two points swap letters with the direction, which is what the labels are for. */
  const endPins = useMemo(() => {
    if (!activeBus) return [];
    const r = editor.perBus.find((x) => x.bus.id === activeBus);
    if (!r || !r.stops.length) return [];
    /* Read the points the ROW WAS SCORED WITH rather than re-deriving them here — two
       derivations of the same thing drift, and then the pin and the cost disagree. */
    const label = (pt, fallback) => (pt && (pt.name || pt.label)) || fallback;
    const startPt = r.start || depot;
    const parkPt = r.park || r.stops[r.stops.length - 1];
    const [S, P] = morning ? [parkPt, startPt] : [startPt, parkPt];
    const est = r.estimatedEnds ? "\n(straight-line estimate — this point is not on the road matrix)" : "";
    return [
      { lat: S.lat, lng: S.lng, label: "S", color: START_COLOR,
        title: `Starts at ${label(S, "the factory")}${est}` },
      { lat: P.lat, lng: P.lng, label: "P", color: PARK_COLOR,
        title: `Ends at ${label(P, "its last stop")}` +
               (morning ? "" : " — and waits here until its next run") + est },
    ];
  }, [activeBus, editor.perBus, depot, morning]);

  const allStops = useMemo(() => [...stopsById.values()], [stopsById]);
  const assignedHeads = editor.perBus.reduce((n, r) => n + r.heads, 0);
  const progress = totalRiders ? (assignedHeads / totalRiders) * 100 : 0;
  const busesUsed = editor.perBus.filter((r) => r.stopIds.length).length;
  const unassignedCount = allStops.length - busOfStop.size;

  // map stops — coloured by their assigned bus (grey if none)
  // With a bus active, hide stops that belong to OTHER buses — only show what's assignable
  // (unassigned = red) plus this bus's own stops (green). With no bus active, show everything.
  // Each assigned stop is coloured by its OWNING bus (so its dot matches that bus's route line and
  // its card) and carries the bus name/colour for the hover tooltip. Unassigned stops stay red.
  const mapStops = useMemo(() => allStops
    .filter((s) => { const b = busOfStop.get(s.id); return !activeBus || !b || b === activeBus; })
    .map((s) => {
      const b = busOfStop.get(s.id);
      return { ...s, route: b || "un", headcount: demandOf(s),
        busName: b ? (busById[b] && busById[b].name) || "" : null,
        busColor: b ? busColor[b] : null };
    }), [allStops, busOfStop, demandOf, activeBus, busById, busColor]);
  const routeColors = useMemo(() => ({ ...busColor, un: UNADDED }), [busColor]);

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
  // route chain matches the order you built it), or (if already on it) remove JUST that stop —
  // the rest of the route stays. Use the bus card's ↯ to re-optimise the order after a removal.
  const onStopClick = (stopId) => {
    /* THE PICKER BEING OPEN IS ITSELF THE MODE. While you are choosing where a bus starts or
       parks, a click on the map means "there" — it never adds the stop to the route or takes it
       off. Saying where to leave a bus is not the same as saying who it carries, and an earlier
       cut that needed a separate "pick on map" press made every click before that press do the
       wrong thing silently. */
    if (picking) {
      const s = stopsById.get(stopId);
      if (s) setEnd(picking.busId, picking.which, { kind: "stop", lat: s.lat, lng: s.lng, name: s.name });
      return;
    }
    const owner = busOfStop.get(stopId); // bus this stop is currently on (undefined if unassigned)
    if (activeBus) {
      const list = editor.assign.get(activeBus) || [];
      const i = list.indexOf(stopId);
      if (i >= 0) { editor.unassignStop(stopId); return; }
      // clicked a stop that belongs to a DIFFERENT bus → jump focus to its bus instead of adding
      if (owner && owner !== activeBus) { setActiveBus(owner); return; }
      // evening builds outward from the factory (append); morning builds toward it (prepend, so
      // the first click is the route start and each next click sits closer to the factory)
      if (morning) editor.insertStopAt(stopId, activeBus, 0);
      else editor.assignStop(stopId, activeBus, { sequence: false });
      return;
    }
    // no bus active: clicking an already-assigned stop selects (highlights + tops) its bus, so you
    // can instantly see and work on it. Clicking an unassigned stop still needs a target bus first.
    if (owner) { setActiveBus(owner); return; }
    toast && toast("Pick a bus first, then click stops on the map");
  };

  // KPI scope — active bus if one is picked, else the whole plan
  const row = activeBus ? editor.perBus.find((r) => r.bus.id === activeBus) : null;
  const k = editor.live ? editor.live.kpis : null;
  const busName = row ? row.bus.name : "";
  // people-weighted average ride across the used buses (mirrors the Fleet-plan avg-ride metric)
  const usedRows = editor.perBus.filter((r) => r.stopIds.length);
  const rideHeads = usedRows.reduce((n, r) => n + r.heads, 0) || 1;
  const avgRide = usedRows.reduce((n, r) => n + r.ride * r.heads, 0) / rideHeads;

  /* The Planner now carries the SAME metric set as the Fleet-plan board, filtered by the
     shared preference. It previously showed four of the ten, so figures you were steering by
     while building a plan disappeared the moment you opened the finished one. Keys match
     kpiPrefs.KPI_DEFS; the maths mirrors the Fleet-plan definitions exactly (ride and
     distance are people-weighted, distance is halved to one-way). */
  const [hiddenKpis, setHidden] = useState(getHiddenKpis);
  const [kpiMenu, setKpiMenu] = useState(false);
  const ownRows = usedRows.filter((r) => r.bus.type === "own");
  const rentRows = usedRows.filter((r) => r.bus.type === "rent");
  const seatSum = (list) => list.reduce((n, r) => n + (+r.cap || 0), 0);
  const totKm = usedRows.reduce((n, r) => n + (+r.km || 0), 0);
  const maxRide = usedRows.reduce((mx, r) => Math.max(mx, r.ride), 0);
  const distPP = usedRows.reduce((n, r) => n + (r.km / 2) * r.heads, 0) / rideHeads;
  const avgStops = usedRows.length ? usedRows.reduce((n, r) => n + r.stopIds.length, 0) / usedRows.length : 0;
  const dash = "—";

  const tiles = row ? [
    { key: "people", label: `Riders · ${busName}`, value: `${row.heads} / ${row.cap}`, sub: row.overCap ? "over capacity" : row.overSeats ? "over seats" : "seats filled", accent: row.overCap ? t.poor : row.overSeats ? t.watch : null, dc: row.overCap ? t.poor : row.overSeats ? t.watch : t.muted },
    { key: "util", label: "Utilisation", value: `${Math.round(row.fill * 100)}%`, sub: `${row.stops.length} stops`, accent: row.fill >= 0.85 ? t.good : t.watch },
    { key: "cost", label: "Cost / head / day", value: row.heads ? `₹${(row.cost / row.heads).toFixed(1)}` : dash, sub: `₹${Math.round(row.cost)} / day` },
    { key: "ride", label: morning ? "Ride (first stop → factory)" : "Ride (to last stop)", value: `${Math.round(row.ride)} min`, sub: row.km ? `${row.km.toFixed(1)} km/day` : "", accent: row.ride < 100 ? t.good : t.poor },
    { key: "totdist", label: "Total dist", value: row.km ? `${row.km.toFixed(1)} km` : dash, sub: "this bus" },
    { key: "avgstops", label: "Stops", value: row.stopIds.length, sub: "on this bus" },
  ] : [
    { key: "people", label: "People", value: `${assignedHeads} / ${totalRiders}`, sub: `${progress.toFixed(0)}% assigned`, dc: progress >= 99.5 ? t.good : t.muted },
    { key: "cost", label: "Cost / head / day", value: k && k.heads ? `₹${k.costPerHeadDay.toFixed(1)}` : dash, sub: k ? `₹${Math.round(k.totalCost).toLocaleString("en-IN")} / day` : "" },
    { key: "util", label: "Avg util", value: k ? `${k.utilisation.toFixed(0)}%` : dash, sub: `${busesUsed} bus${busesUsed === 1 ? "" : "es"} used`, accent: k && k.utilisation >= 85 ? t.good : t.watch },
    { key: "avgride", label: "Avg ride", value: usedRows.length ? `${Math.round(avgRide)} min` : dash, sub: `${unassignedCount} stops left`, accent: usedRows.length && avgRide <= 60 ? t.good : t.poor },
    { key: "ride", label: "Max ride", value: usedRows.length ? `${Math.round(maxRide)} min` : dash, sub: "longest trip", accent: usedRows.length && maxRide <= 110 ? t.good : t.poor },
    { key: "totdist", label: "Total dist", value: usedRows.length ? `${Math.round(totKm).toLocaleString("en-IN")} km` : dash, sub: "whole plan" },
    { key: "avgdist", label: "Dist / person", value: usedRows.length ? `${distPP.toFixed(1)} km` : dash, sub: "one-way" },
    { key: "owned", label: "Owned", value: ownRows.length, sub: `${seatSum(ownRows).toLocaleString("en-IN")} seats` },
    { key: "rental", label: "Rental", value: rentRows.length, sub: `${seatSum(rentRows).toLocaleString("en-IN")} seats` },
    { key: "seats", label: "Seats", value: seatSum(usedRows).toLocaleString("en-IN"), sub: `${assignedHeads} riders` },
    { key: "avgstops", label: "Stops / bus", value: usedRows.length ? avgStops.toFixed(1) : dash, sub: "average" },
  ];
  const shownTiles = visibleKpis(tiles, hiddenKpis);

  const busList = useMemo(() => {
    const q = busQuery.trim().toLowerCase();
    // Pin the active bus to the top so a stop you just clicked is right there for easy access.
    return editor.perBus
      .filter((r) => !q || r.bus.name.toLowerCase().includes(q))
      .sort((a, b) => (b.bus.id === activeBus) - (a.bus.id === activeBus));
  }, [editor.perBus, busQuery, activeBus]);

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

  // Apple "liquid glass" for the floating overlays — theme-aware so it stays readable on the dark
  // map (dark frosted glass) as well as on the light/neutral maps (bright frosted glass).
  const glassDark = t.dark;
  const glass = {
    background: glassDark ? "rgba(20,28,38,0.74)" : "rgba(255,255,255,0.62)",
    backdropFilter: "blur(16px) saturate(180%)", WebkitBackdropFilter: "blur(16px) saturate(180%)",
    border: "1px solid " + (glassDark ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.55)"),
    boxShadow: glassDark
      ? "0 8px 30px rgba(0,0,0,.5), inset 0 1px 1px rgba(255,255,255,0.10)"
      : "0 8px 30px rgba(15,23,42,.20), inset 0 1px 1px rgba(255,255,255,0.75), inset 0 -1px 2px rgba(255,255,255,0.35)",
  };
  // frosted tints for the tiles / cards / inputs / tracks nested inside the glass panels
  const glassInner = glassDark ? "rgba(255,255,255,0.07)" : "rgba(255,255,255,0.5)";
  const glassInnerBorder = glassDark ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.6)";
  const glassBtn = glassDark ? "rgba(255,255,255,0.14)" : "rgba(255,255,255,0.7)";
  const glassTrack = glassDark ? "rgba(255,255,255,0.14)" : "rgba(15,23,42,0.08)";
  const glassDivider = glassDark ? "rgba(255,255,255,0.14)" : "rgba(15,23,42,0.1)";
  const PANEL_W = 300; // right bus panel width
  const PANEL_H = 680; // bus panel height — grows downwards from the top inset. Still capped
                       // (see maxHeight) so it never runs past the map on a short window;
                       // the card grid inside scrolls once the list outgrows it

  return (
    <div className={full ? "fixed inset-0 z-[1500] overflow-hidden" : "relative rounded-2xl overflow-hidden"}
      style={{ height: containerH, border: full ? "none" : "1px solid " + t.border, background: t.surface, marginTop: full ? 0 : undefined }}>
      {/* base map — click stops to assign to the active bus */}
      <GMap t={t} stops={mapStops} routeColors={routeColors} depot={depot} polylines={polylines} pins={endPins} onSelect={onStopClick} height={containerH} scrollWheelZoom={true} autoFit={false} />

      {/* Park picker — floats beside the bus panel, over the map, so the route and its two end
          pins stay visible while the place is chosen. */}
      {/* Clear of the stats panel rather than over it: the ride time and cost are exactly what
          you are weighing while choosing where to leave the bus, so covering them would hide
          the reason for the decision. */}
      {picking && (
        <div className="absolute z-[800]" style={{ bottom: PAD, right: showBuses ? PANEL_W + PAD * 2 : PAD, width: 268 }}>
          <ParkPicker t={t} points={parkPoints}
            busName={nameOf(picking.busId)}
            which={picking.which}
            current={specOf(picking.busId, picking.which)}
            onPick={(spec) => setEnd(picking.busId, picking.which, spec)}
            onClose={() => setPicking(null)}
            glass={glass} glassInner={glassInner} />
        </div>
      )}

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
      <div className="absolute z-[600] rounded-2xl px-3 py-2" style={{ top: PAD, left: 64, right: showBuses ? PANEL_W + PAD * 2 : PAD, ...glass }}>
        <div className="flex items-center gap-1.5 text-[11px] font-medium mb-1.5" style={{ color: activeBus ? t.primary : t.muted }}>
          <MousePointerClick size={13} />
          {activeBus
            ? (morning
              ? <><b>Morning · {busName}</b> — first click = where the bus starts; each next stop is picked up on the way to the factory.</>
              : <><b>Assigning to {busName}</b> — click stops on the map to add/remove (click several for multiple).</>)
            : <>Pick a bus on the right, then click stops on the map to assign them.{morning ? " Morning plan: routes run stops → factory." : ""}</>}
          {activeBus && <button type="button" onClick={() => setActiveBus(null)} className="inline-flex items-center gap-1 rounded-lg px-2 py-0.5 font-semibold" style={{ border: "1px solid " + t.border, background: glassBtn, color: t.text, cursor: "pointer" }}><X size={11} /> Done</button>}
          <div className={"relative " + (activeBus ? "" : "ml-auto")}>
            <button type="button" onClick={() => setKpiMenu((o) => !o)} title="Choose which stats to show"
              className="inline-flex items-center gap-1 rounded-lg px-2 py-0.5 font-semibold"
              style={{ border: "1px solid " + (kpiMenu ? t.primary : t.border), background: glassBtn,
                       color: kpiMenu ? t.primary : t.text, cursor: "pointer" }}>
              <SlidersHorizontal size={11} /> {KPI_DEFS.length - hiddenKpis.size}/{KPI_DEFS.length}
            </button>
            {kpiMenu && (
              <>
                <div className="fixed inset-0" style={{ zIndex: 40 }} onClick={() => setKpiMenu(false)} />
                <div className="absolute right-0 mt-1.5 rounded-2xl p-2 w-64" style={{ zIndex: 41, ...glass }}>
                  <div className="flex items-center justify-between px-1.5 pb-1.5">
                    <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: t.muted }}>Stats to show</span>
                    <button type="button" onClick={() => { setHiddenKpis(new Set()); setHidden(new Set()); }}
                      className="text-[10px] rounded-lg px-2 py-0.5 font-semibold"
                      style={{ border: "1px solid " + t.border, background: glassBtn, color: t.text, cursor: "pointer" }}>All</button>
                  </div>
                  <div className="max-h-72 overflow-auto">
                    {KPI_DEFS.map((d) => (
                      <label key={d.key} className="flex items-start gap-2 px-1.5 py-1 rounded-xl cursor-pointer"
                        onMouseEnter={(e) => { e.currentTarget.style.background = glassInner; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}>
                        <input type="checkbox" checked={!hiddenKpis.has(d.key)} style={{ marginTop: 3, cursor: "pointer" }}
                          onChange={() => {
                            const next = new Set(hiddenKpis);
                            next.has(d.key) ? next.delete(d.key) : next.add(d.key);
                            setHiddenKpis(next); setHidden(next);
                          }} />
                        <span>
                          <span className="text-[11px] font-semibold block" style={{ color: t.text }}>{d.label}</span>
                          <span className="text-[10px]" style={{ color: t.muted }}>{d.hint}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
          <button type="button" onClick={() => setShowKpis(false)} title="Hide stats" style={{ color: t.muted, cursor: "pointer" }}><EyeOff size={13} /></button>
        </div>
        {/* Was a fixed 4 columns for exactly 4 tiles. With the full KPI set — and a count that
            changes as you toggle them — it wraps instead, so the panel grows a row rather than
            squeezing eleven tiles into four slots. */}
        <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(86px, 1fr))" }}>
          {shownTiles.map((c, i) => (
            <div key={i} className="rounded-xl px-2 py-1 relative overflow-hidden" style={{ background: glassInner, border: "1px solid " + glassInnerBorder }}>
              {/* rail only when the accent came from a threshold — see Tile in Dashboard.jsx */}
              {c.accent && <span className="absolute left-0 top-0 bottom-0 w-1" style={{ background: c.accent }} />}
              <div className={"text-[9px] uppercase tracking-wider truncate leading-tight" + (c.accent ? " pl-1.5" : "")} style={{ color: t.muted }}>{c.label}</div>
              <div className={"text-base font-bold tabular-nums leading-tight" + (c.accent ? " pl-1.5" : "")} style={{ color: t.text }}>{c.value}</div>
              <div className={"text-[9px] truncate leading-tight" + (c.accent ? " pl-1.5" : "")} style={{ color: c.dc || t.muted }}>{c.sub}</div>
            </div>
          ))}
        </div>
        {/* always-on legend so the stop-colour meaning never has to be recalled mid-rebuild */}
        <div className="flex items-center gap-3 mt-2 text-[9px] font-medium" style={{ color: t.muted }}>
          <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ background: UNADDED }} /> Unassigned</span>
          <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ background: ADDED }} /> On a bus</span>
          {activeBus && <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ background: busColor[activeBus] }} /> This bus’s stops</span>}
        </div>
      </div>
      )}

      {/* Bus glass panel — floats on the right of the map */}
      {showBuses && (
      <div className="absolute z-[600] rounded-2xl flex flex-col overflow-hidden" style={{ top: PAD, right: PAD, width: PANEL_W, maxHeight: `calc(100% - ${PAD * 2}px)`, height: PANEL_H, ...glass }}>
        <div className="flex items-center justify-between px-3 pt-3 pb-2">
          <span className="text-xs font-bold uppercase tracking-wider" style={{ color: t.text }}>Your buses</span>
          <div className="flex items-center gap-2">
            <span className="text-[11px]" style={{ color: t.muted }}>{busesUsed}/{fleet.length} used</span>
            <button type="button" onClick={() => setShowBuses(false)} title="Hide bus list" style={{ color: t.muted, cursor: "pointer" }}><EyeOff size={14} /></button>
          </div>
        </div>
        <div className="px-3 pb-2">
          <input value={busQuery} onChange={(e) => setBusQuery(e.target.value)} placeholder="Find a bus…"
            className="w-full rounded-lg px-3 py-2 text-sm outline-none" style={{ border: "1px solid " + t.border, background: glassInner, color: t.text }} />
        </div>
        <div className="grid grid-cols-2 gap-2 overflow-y-auto px-3 pb-3">
          {busList.map((r) => {
            const on = activeBus === r.bus.id;
            const fillCol = r.overCap ? t.poor : r.overSeats ? t.watch : r.stopIds.length ? t.good : t.border;
            return (
              // div-with-role, not <button>: the card holds the wand/trash <button>s and
              // nested buttons are invalid DOM (React validateDOMNesting warning)
              <div key={r.bus.id} role="button" tabIndex={0} onClick={() => setActiveBus(on ? null : r.bus.id)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setActiveBus(on ? null : r.bus.id); } }}
                className="text-left rounded-xl p-2.5 transition-all" style={{
                  border: "1.5px solid " + (on ? t.primary : r.overCap ? t.poor : glassInnerBorder),
                  background: on ? t.primarySoft : glassInner,
                  boxShadow: on ? "0 0 0 3px " + t.primarySoft : "none", cursor: "pointer",
                }}>
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: busColor[r.bus.id] }} />
                  <span className="text-xs font-semibold truncate" style={{ color: t.text }}>{r.bus.name}</span>
                </div>
                <div className="h-1 rounded-full overflow-hidden mb-1" style={{ background: glassTrack }}>
                  <div className="h-full rounded-full" style={{ width: Math.min(100, r.fill * 100) + "%", background: fillCol }} />
                </div>
                <div className="flex items-center justify-between text-[10px]" style={{ color: r.overCap ? t.poor : t.muted }}>
                  <span>{r.bus.type} · {r.cap}</span>
                  <span className="tabular-nums font-semibold">{r.heads}/{r.cap}</span>
                </div>
                {on && r.stopIds.length > 0 && (
                  <>
                    <div className="flex items-center gap-2 mt-1.5 pt-1.5" style={{ borderTop: "1px solid " + glassDivider }}>
                      <span className="text-[10px]" style={{ color: t.muted }}>{Math.round(r.ride)}m · ₹{Math.round(r.cost)}</span>
                      <span className="flex-1" />
                      <button type="button" title="Auto-sequence" onClick={(e) => { e.stopPropagation(); editor.autoSequence(r.bus.id); }} style={{ color: t.muted, cursor: "pointer" }}><Wand2 size={12} /></button>
                      <button type="button" title="Clear this bus — removes all its stops" aria-label={`Clear all stops from ${r.bus.name}`} onClick={(e) => { e.stopPropagation(); editor.clearBus(r.bus.id); }}
                        className="rounded-md p-0.5 transition-colors" style={{ color: t.poor, cursor: "pointer" }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = t.poor + "1f")} onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}><Trash2 size={12} /></button>
                    </div>
                    {/* The two ends of this bus's run, as two small chips. They read S and P to
                        match the pins on the map and the layover rails on the Timings clock, so
                        the same two letters mean the same two things everywhere. A chip is
                        filled once that end has been moved off its default. */}
                    <div className="flex items-center gap-1 mt-1.5">
                      {[["start", "S", START_COLOR], ["park", "P", PARK_COLOR]].map(([which, letter, col]) => {
                        const spec = specOf(r.bus.id, which);
                        const set = spec.kind !== "auto";
                        const open = picking && picking.busId === r.bus.id && picking.which === which;
                        return (
                          <button key={which} type="button"
                            aria-label={`Set where ${r.bus.name} ${which === "start" ? "starts" : "parks"}`}
                            title={`${r.bus.name} ${which === "start" ? "starts from" : "parks at"}: ` +
                                   `${parkLabel(spec, which)}. Click to change.`}
                            onClick={(e) => { e.stopPropagation(); setPicking(open ? null : { busId: r.bus.id, which }); }}
                            className="flex-1 min-w-0 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[9px] font-bold transition"
                            style={{ background: open ? col : set ? col + "22" : glassBtn,
                                     color: open ? "#fff" : set ? col : t.muted,
                                     border: "1px solid " + (open || set ? col : glassInnerBorder), cursor: "pointer" }}>
                            <span style={{ flexShrink: 0 }}>{letter}</span>
                            <span className="truncate font-semibold">{parkLabel(spec, which)}</span>
                          </button>
                        );
                      })}
                    </div>
                    {r.estimatedEnds && (
                      <div className="text-[9px] mt-1" style={{ color: t.watch }}>
                        one end is off the road matrix — its legs are straight-line estimates
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
      )}
    </div>
  );
}
