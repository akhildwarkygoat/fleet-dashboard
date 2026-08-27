/* ============================================================================
 * optimiser/TimingsView.jsx — the "Timings" subtab + the service picker board.
 *
 * ServiceBoard — shown when the Optimiser tab opens: pick which service you're
 * planning (or Overall) before the subtabs appear. The board IS the switcher,
 * so the header never needs a row of toggles.
 *
 * TimingsView — every bus on one 24-hour clock, one row per bus, one block per
 * run, across ALL services at once. Overlapping runs on the same bus are the
 * collisions this view exists to catch; chips narrow by service, but the
 * default is everything.
 * ==========================================================================*/
import React, { useState, useEffect, useMemo, useRef } from "react";
import { Bus, Search, AlertTriangle, Clock, Layers, ChevronRight, ZoomIn, ZoomOut, ParkingSquare } from "lucide-react";
import { Card, Tile, Empty } from "./ui.jsx";
import { SERVICES, OVERALL, fmtClock, erpStatsFor, serviceNeed, subShiftsOf, ROTATION_SLOTS, weekStart } from "./services.js";
import { ROTA_WEEK } from "../erp.js";
import { recostLinks } from "./layover.js";
import { getParkPrefs, parkForRoute } from "./parkPrefs.js";

/* YYYY-MM-DD from a LOCAL date. toISOString() would convert to UTC first, which in IST rolls
   midnight back to the previous day — a Monday then prints as the Sunday before it. */
const fmtISO = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/* ---------------- service picker ---------------- */
export function ServiceBoard({ t, onPick, shifts, shiftDate }) {
  const [meta, setMeta] = useState(null);   // finalised-plan headline for the planned card
  useEffect(() => {
    fetch("/finalised_plan.json").then((r) => (r.ok ? r.json() : null))
      .then((p) => p && p.overall && setMeta(p.overall)).catch(() => {});
  }, []);
  const withRiders = SERVICES.filter((s) => erpStatsFor(s, shifts)).length;

  return (
    <div className="max-w-2xl mx-auto flex flex-col gap-6 py-8">
      <div className="text-center">
        <h2 className="text-2xl font-bold tracking-tight" style={{ color: t.text }}>What are you planning?</h2>
        <p className="text-sm mt-1.5" style={{ color: t.muted }}>Pick a service to plan, or Overall to see every service together.</p>
      </div>

      <button type="button" onClick={() => onPick(OVERALL)} data-fx="card"
        className="text-left rounded-2xl p-5 flex items-center gap-4 transition group w-full"
        style={{ background: t.surface, border: "1px solid " + t.border, cursor: "pointer" }}
        onMouseEnter={(e) => { e.currentTarget.style.borderColor = t.primary; }}
        onMouseLeave={(e) => { e.currentTarget.style.borderColor = t.border; }}>
        <span className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0" style={{ background: t.primarySoft, color: t.primary }}>
          <Layers size={20} />
        </span>
        <span className="flex-1 min-w-0">
          <span className="font-bold block" style={{ color: t.text }}>Overall</span>
          <span className="text-sm block mt-0.5" style={{ color: t.muted }}>
            All services on one clock — timings, collisions and the whole fleet's day.
          </span>
        </span>
        <ChevronRight size={18} style={{ color: t.faint }} />
      </button>

      <div>
        <div className="text-[10px] font-bold uppercase tracking-widest mb-2.5 px-1" style={{ color: t.faint }}>Services</div>
        <div className="grid sm:grid-cols-2 gap-3">
          {SERVICES.map((s) => {
            const stats = erpStatsFor(s, shifts);
            const need = serviceNeed(s, shifts);
            const planned = !!s.planUrl && !!stats;
            const badge = planned ? ["Planned", t.goodSoft, t.good]
              : stats ? ["In the ERP", t.primarySoft, t.primary]
              : ["Not yet", t.surface2, t.faint];
            return (
              <button key={s.id} type="button" onClick={() => onPick(s)} data-fx="card"
                title={need ? `${s.name} — needs ${need}` : `Open ${s.name}`}
                className="text-left rounded-2xl p-4 flex flex-col gap-2.5 transition"
                style={{ background: t.surface, border: "1px solid " + t.border, cursor: "pointer" }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = s.color; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = t.border; }}>
                <div className="flex items-center gap-2.5">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: s.color }} />
                  <span className="font-semibold flex-1" style={{ color: t.text }}>{s.name}</span>
                  <span className="text-[9px] font-bold uppercase tracking-wider rounded-full px-2 py-0.5"
                    style={{ background: badge[1], color: badge[2] }}>{badge[0]}</span>
                </div>
                {stats ? (
                  <>
                    <div className="text-sm tabular-nums" style={{ color: t.muted }}>
                      <b style={{ color: t.text }}>{stats.riders.toLocaleString("en-IN")}</b> riders · {stats.buses} buses
                      {s.gate != null ? ` · gate ${fmtClock(s.gate)}` : ""}{s.branch ? " · own depot" : ""}
                    </div>
                    {s.erpUnit && subShiftsOf(s, shifts).length > 1 && (
                      <div className="text-xs" style={{ color: t.faint }}>
                        {subShiftsOf(s, shifts).map(([n, c]) => `${n} ${c}`).join(" · ")}
                      </div>
                    )}
                  </>
                ) : (
                  <div className="text-sm" style={{ color: t.faint }}>Needs {need}</div>
                )}
                {stats && need && (s.notice
                  ? <div className="text-xs font-medium flex items-center gap-1.5" style={{ color: t.watch }}>
                      <span className="w-1.5 h-1.5 rounded-full animate-pulse shrink-0" style={{ background: t.watch }} />
                      Optimiser in progress
                    </div>
                  : <div className="text-xs" style={{ color: t.faint }}>Needs {need}</div>)}
              </button>
            );
          })}
        </div>
      </div>

      <p className="text-xs text-center" style={{ color: t.faint }}>
        {withRiders} of {SERVICES.length} services have riders in the ERP{shiftDate ? ` on ${shiftDate}` : ""} — read live from the punch feed, so a new shift or unit appears here on its own.
      </p>
    </div>
  );
}

/* ---------------- Timings ---------------- */
const AX_START = 4 * 60, AX_END = 30 * 60;             // 04:00 → 06:00 next day (covers the full-night slot)
const pct = (min) => ((min - AX_START) / (AX_END - AX_START)) * 100;

/* Minutes-from-midnight onto the 04:00→06:00 axis, at or after `after`. A full-night run
   ending at 06:00 belongs at 1800 on this axis, not at 360 where it would draw before the
   22:00 run that produced it. */
const axisAt = (m, after = AX_START) => {
  let v = ((m % 1440) + 1440) % 1440;
  while (v < after) v += 1440;
  return v;
};
/* One bus's lane, and the line everything in it is centred on. A pickup block is 22px tall at
   top 4, so the bars' centreline is 15 — NOT half the 34px lane. Drops and layover rails are
   hung off this constant rather than each guessing an offset, which is how the rail ended up
   pinned near the bottom edge reading as if it belonged to the row below. */
const ROW_H = 34, ROW_MID = 15;

/* Clip a span to the axis; null when it falls entirely outside the day being drawn. */
const clip = (s, e) => {
  const a = Math.max(s, AX_START), b = Math.min(e, AX_END);
  return b > a ? [a, b] : null;
};

/* One run = a bus doing one service's pickup: it must be AT the gate when the
   shift starts, and its first rider boards `ride` minutes before that. */
function runsFromPlan(plan, svc) {
  if (!plan || !Array.isArray(plan.routes) || svc.gate == null) return [];
  return plan.routes.map((r) => ({
    veh: r.name, type: r.type, svc, dir: "pickup",
    start: svc.gate - (r.ride || 0), end: svc.gate,
    km: r.km, ride: r.ride, riders: r.riders, stops: r.stops,
  }));
}

/* The drop runs and the layovers between them, from the offline connection model. A bus
   standing in a village is the whole point of that model and there is nowhere else on this
   board it could be seen — the clock previously drew only the morning half of each day, so
   a bus that finished at 14:50 and restarted at 21:10 looked idle at the factory. */
function layoverRows(conn, on) {
  if (!conn || !Array.isArray(conn.links)) return new Map();
  const byVeh = new Map();
  for (const l of conn.links) {
    if (l.atDepot || !l.worth) continue;
    if (!on.has(l.a.svcId) || !on.has(l.b.svcId)) continue;
    const s = axisAt(l.a.end);
    const end = s + l.gap;
    const seg = clip(s, end);
    if (!seg) continue;
    if (!byVeh.has(l.veh)) byVeh.set(l.veh, []);
    /* An overnight layover runs past 06:00 the next morning, which is where this axis stops.
       Drawing a P at the cut would put the parking marker at a time the bus is still parked, so
       the clipped end is flagged and the marker is left off — the line simply runs to the edge. */
    byVeh.get(l.veh).push({ ...l, s: seg[0], e: seg[1], clippedEnd: end > AX_END, clippedStart: s < AX_START });
  }
  return byVeh;
}
function dropRuns(conn, on) {
  if (!conn || !Array.isArray(conn.runs)) return [];
  return conn.runs
    .filter((r) => r.dir === "drop" && on.has(r.svcId))
    .map((r) => {
      const s = axisAt(r.start);
      const seg = clip(s, s + Math.max(1, r.ride));
      return seg ? { ...r, s: seg[0], e: seg[1] } : null;
    })
    .filter(Boolean);
}

export function TimingsView({ t, shifts }) {
  const [plans, setPlans] = useState({});               // service id -> plan json
  const [conn, setConn] = useState(null);               // bus_connections.json, if built
  /* Read once on mount. Switching to this subtab remounts the view, so a park changed in the
     Planner is picked up the next time the clock is looked at. */
  const [prefs] = useState(getParkPrefs);
  const [on, setOn] = useState(() => new Set(SERVICES.map((s) => s.id)));
  const [q, setQ] = useState("");
  const [clashOnly, setClashOnly] = useState(false);
  const [showLayovers, setShowLayovers] = useState(true);

  useEffect(() => {
    SERVICES.filter((s) => s.planUrl).forEach((s) => {
      fetch(s.planUrl).then((r) => (r.ok ? r.json() : null))
        .then((p) => p && setPlans((prev) => ({ ...prev, [s.id]: p })))
        .catch(() => {});
    });
    fetch("/bus_connections.json").then((r) => (r.ok ? r.json() : null)).then(setConn).catch(() => {});
  }, []);

  const allRuns = useMemo(() => SERVICES.flatMap((s) => runsFromPlan(plans[s.id], s)), [plans]);
  /* Re-price the shipped model against the parking the manager has actually chosen.
     bus_connections.json is built offline and knows nothing about it, so a bus pinned to the
     factory in the Planner still had its layover drawn here and still counted toward the
     headline — two boards quoting different money for the same decision. `recostLinks` walks
     the measured distance table shipped inside that file, so a re-priced link is still a
     measured number, not a re-estimate. */
  const priced = useMemo(() => (conn ? recostLinks(conn, {
    parkOf: (l) => parkForRoute(l.a.svcId, l.veh, prefs),
  }) : null), [conn, prefs]);
  const connLive = useMemo(
    () => (priced ? { ...conn, links: priced.links, totals: priced.totals } : conn),
    [conn, priced]
  );
  const pinnedHome = useMemo(
    () => (priced ? priced.links.filter((l) => !l.atDepot && l.chosen && l.saveKm <= 0).length : 0),
    [priced]
  );
  const layovers = useMemo(() => (showLayovers ? layoverRows(connLive, on) : new Map()), [connLive, on, showLayovers]);
  const drops = useMemo(() => (showLayovers ? dropRuns(connLive, on) : []), [connLive, on, showLayovers]);
  const dropsByVeh = useMemo(() => {
    const m = new Map();
    for (const d of drops) { if (!m.has(d.veh)) m.set(d.veh, []); m.get(d.veh).push(d); }
    return m;
  }, [drops]);

  const toggleSvc = (id) => setOn((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  /* Registrations are written a dozen ways (`tn57 cl`, `TN57-CL3434`), so the vehicle side of
     the search strips everything that is not a letter or digit on both sides — the same rule
     the Stops board uses. Service names and park places are ordinary text and match as typed. */
  const parkedAt = useMemo(() => {
    const m = new Map();
    for (const l of (conn && conn.links) || []) {
      if (!l.worth || l.atDepot || !l.park) continue;
      if (!m.has(l.veh)) m.set(l.veh, new Set());
      m.get(l.veh).add(String(l.park.name || "").toLowerCase());
    }
    return m;
  }, [conn]);

  const visible = useMemo(() => {
    const ql = q.trim().toLowerCase();
    if (!ql) return allRuns.filter((r) => on.has(r.svc.id));
    const bare = ql.replace(/[^a-z0-9]/g, "");
    return allRuns.filter((r) => {
      if (!on.has(r.svc.id)) return false;
      const veh = r.veh.toLowerCase();
      if (veh.includes(ql) || (bare && veh.replace(/[^a-z0-9]/g, "").includes(bare))) return true;
      if (r.svc.name.toLowerCase().includes(ql)) return true;
      const places = parkedAt.get(r.veh);
      return !!places && [...places].some((p) => p.includes(ql));
    });
  }, [allRuns, on, q, parkedAt]);

  // one row per bus; runs sorted by start so overlaps read left→right
  const rows = useMemo(() => {
    const byVeh = new Map();
    visible.forEach((r) => {
      if (!byVeh.has(r.veh)) byVeh.set(r.veh, []);
      byVeh.get(r.veh).push({ ...r });
    });
    const out = [...byVeh.entries()].map(([veh, runs]) => {
      runs.sort((a, b) => a.start - b.start);
      let clashes = 0;
      for (let i = 1; i < runs.length; i++) if (runs[i].start < runs[i - 1].end) { runs[i].clash = true; clashes++; }
      return { veh, runs, clashes };
    });
    out.sort((a, b) => b.clashes - a.clashes || a.veh.localeCompare(b.veh));
    return out;
  }, [visible]);

  const shown = clashOnly ? rows.filter((r) => r.clashes) : rows;
  const totalClashes = rows.reduce((s, r) => s + r.clashes, 0);
  const liveCount = SERVICES.filter((s) => plans[s.id]).length;
  const waiting = SERVICES.filter((s) => !plans[s.id]);

  /* ---- zoom + hover time readout ----
     Scrolling over the chart stretches the clock horizontally (anchored at the cursor,
     so the time under the pointer stays put); the crosshair reads the exact time. */
  const BASE_W = 760, LABEL_W = 124;               // label column + grid gap
  const [zoom, setZoom] = useState(1);
  const [hover, setHover] = useState(null);        // { x (px in content), min }
  const scrollRef = useRef(null), innerRef = useRef(null), anchorRef = useRef(null);
  const setZoomClamped = (z) => setZoom(Math.min(10, Math.max(1, z)));

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e) => {
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;   // horizontal pan stays native
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const cx = e.clientX - rect.left;                       // cursor within the viewport
      const contentX = el.scrollLeft + cx;                    // …and within the content
      setZoom((z) => {
        const nz = Math.min(10, Math.max(1, z * Math.exp(-e.deltaY * 0.0015)));
        anchorRef.current = { frac: contentX / (Math.max(BASE_W, el.clientWidth) * z), cx };
        return nz;
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
    // the chart (and its scroller) only exists once runs are loaded and unfiltered,
    // so re-attach whenever it appears — on mount the ref is still null
  }, [shown.length > 0]);
  // after the width changes, put the anchored time back under the cursor
  useEffect(() => {
    const el = scrollRef.current, a = anchorRef.current;
    if (!el || !a) return;
    anchorRef.current = null;
    el.scrollLeft = a.frac * Math.max(BASE_W, el.clientWidth) * zoom - a.cx;
  }, [zoom]);

  const onMove = (e) => {
    const inner = innerRef.current;
    if (!inner) return;
    const rect = inner.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const laneW = rect.width - LABEL_W;
    if (x < LABEL_W || laneW <= 0) { setHover(null); return; }
    const min = AX_START + ((x - LABEL_W) / laneW) * (AX_END - AX_START);
    setHover({ x, min: Math.round(min) });
  };

  // finer ruler as the clock stretches
  const step = zoom >= 6 ? 15 : zoom >= 3 ? 30 : zoom >= 1.7 ? 60 : 120;
  const ticks = [];
  for (let m = AX_START; m <= AX_END; m += step) ticks.push(m);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Tile t={t} label="Buses shown" value={shown.length} sub={`${rows.length} in scope`} />
        <Tile t={t} label="Runs" value={visible.length} sub={`across ${liveCount} service${liveCount === 1 ? "" : "s"}`} />
        <Tile t={t} label="Collisions" value={totalClashes} sub={totalClashes ? "same bus, overlapping runs" : "no bus is double-booked"} accent={totalClashes ? t.poor : t.good} />
        <Tile t={t} label="Services drawn" value={`${liveCount}/${SERVICES.length}`} sub="rest need a plan or riders" />
      </div>

      <Card t={t} title="All buses, one day"
        hint="One row per bus, one block per run — every service on the same clock, so a double-booked bus shows up as overlapping blocks. S marks where a bus starts a run, P where it parks when the run is done."
        right={
          /* One search, in the header. It used to sit in the toolbar below and match the
             registration only, which meant "who is parked at Dindigul?" — the question this
             board now answers — had no way to be asked. */
          <div className="relative" style={{ minWidth: 230 }}>
            <Search size={14} style={{ position: "absolute", left: 10, top: 10, color: t.muted }} />
            <input value={q} onChange={(e) => setQ(e.target.value)}
              placeholder="Bus, service or where it parks…" aria-label="Search buses, services and park places"
              className="w-full rounded-lg pl-8 pr-3 py-2 text-sm outline-none"
              style={{ background: t.inputBg, border: "1px solid " + t.border, color: t.text }} />
          </div>
        }>
        <div className="flex flex-wrap items-center gap-2 mb-4">
          {SERVICES.map((s) => {
            const isOn = on.has(s.id);
            const has = allRuns.some((r) => r.svc.id === s.id);
            return (
              <button key={s.id} type="button" onClick={() => toggleSvc(s.id)} aria-pressed={isOn}
                title={has ? "" : "No data for this service yet — nothing to draw"}
                className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold transition"
                style={{ background: isOn ? s.color + "22" : "transparent", border: "1px solid " + (isOn ? s.color : t.border),
                         color: isOn ? t.text : t.faint, cursor: "pointer", opacity: has ? 1 : 0.55 }}>
                <span className="w-2 h-2 rounded-sm" style={{ background: s.color }} />{s.name}
              </button>
            );
          })}
          {conn && (
            <button type="button" onClick={() => setShowLayovers(!showLayovers)} aria-pressed={showLayovers}
              title="Show the drop runs and the time each bus spends parked out between them"
              className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold transition"
              style={{ background: showLayovers ? t.goodSoft : "transparent", border: "1px solid " + (showLayovers ? t.good : t.border),
                       color: showLayovers ? t.good : t.muted, cursor: "pointer" }}>
              <ParkingSquare size={12} /> Drops &amp; layovers
            </button>
          )}
          <button type="button" onClick={() => setClashOnly(!clashOnly)} aria-pressed={clashOnly}
            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold ml-auto transition"
            style={{ background: clashOnly ? t.poorSoft : "transparent", border: "1px solid " + (clashOnly ? t.poor : t.border),
                     color: clashOnly ? t.poor : t.muted, cursor: "pointer" }}>
            <AlertTriangle size={12} /> Only collisions{totalClashes ? ` (${totalClashes})` : ""}
          </button>
          <div className="inline-flex items-center gap-1 rounded-lg px-1 py-0.5" style={{ border: "1px solid " + t.border }}>
            <button type="button" onClick={() => setZoomClamped(zoom / 1.5)} title="Zoom out (or scroll on the chart)" aria-label="Zoom out"
              className="p-1 rounded" style={{ color: zoom <= 1 ? t.faint : t.muted, cursor: "pointer" }}><ZoomOut size={14} /></button>
            <span className="text-[11px] tabular-nums w-9 text-center" style={{ color: t.muted }}>{Math.round(zoom * 100)}%</span>
            <button type="button" onClick={() => setZoomClamped(zoom * 1.5)} title="Zoom in (or scroll on the chart)" aria-label="Zoom in"
              className="p-1 rounded" style={{ color: zoom >= 10 ? t.faint : t.muted, cursor: "pointer" }}><ZoomIn size={14} /></button>
            {zoom > 1 && <button type="button" onClick={() => setZoomClamped(1)} className="text-[11px] px-1.5 rounded font-semibold" style={{ color: t.primary, cursor: "pointer" }}>Reset</button>}
          </div>
        </div>

        {shown.length ? (
          <div className="overflow-x-auto" ref={scrollRef}>
            <div ref={innerRef} className="relative" style={{ minWidth: BASE_W * zoom }}
              onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
              {hover && (
                <>
                  <div className="absolute pointer-events-none" style={{ left: hover.x, top: 22, bottom: 0, width: 1, background: t.primary, opacity: 0.55, zIndex: 2 }} />
                  <div className="absolute pointer-events-none text-[10px] font-bold tabular-nums rounded px-1.5 py-0.5"
                    style={{ left: hover.x, top: 0, transform: "translateX(-50%)", background: t.primary, color: t.onPrimary || "#fff", zIndex: 3, whiteSpace: "nowrap" }}>
                    {fmtClock(hover.min % (24 * 60))}
                  </div>
                </>
              )}
              <div className="grid" style={{ gridTemplateColumns: "110px 1fr", columnGap: 14 }}>
                <div style={{ position: "sticky", left: 0, zIndex: 4, background: t.surface }} />
                {/* rotational slot windows, drawn behind everything as a reference backdrop */}
                <div className="absolute pointer-events-none" style={{ left: 124, right: 0, top: 22, bottom: 0, zIndex: 0 }}>
                  {ROTATION_SLOTS.map((sl) => (
                    <div key={sl.id} title={`${sl.name} · ${fmtClock(sl.from)}–${fmtClock(sl.to % 1440)}`}
                      className="absolute top-0 bottom-0"
                      style={{ left: pct(sl.from) + "%", width: (pct(Math.min(sl.to, AX_END)) - pct(sl.from)) + "%",
                               background: sl.color, opacity: 0.05, borderLeft: "1px dashed " + sl.color }} />
                  ))}
                </div>
                <div className="relative" style={{ height: 22, borderBottom: "1px solid " + t.border }}>
                  {ticks.map((m) => (
                    <span key={m} className="absolute text-[10px] tabular-nums" style={{ left: pct(m) + "%", transform: "translateX(-50%)", color: t.faint }}>
                      {fmtClock(m % (24 * 60))}
                    </span>
                  ))}
                </div>
                {shown.map((row) => (
                  <React.Fragment key={row.veh}>
                    <div className="flex items-center gap-1.5 py-1 text-xs tabular-nums"
                      style={{ color: row.clashes ? t.poor : t.muted, position: "sticky", left: 0, zIndex: 4, background: t.surface }}>
                      {row.clashes ? <AlertTriangle size={11} /> : <Bus size={11} style={{ opacity: 0.5 }} />}{row.veh}
                    </div>
                    <div className="relative" style={{ height: ROW_H, borderBottom: "1px solid " + t.border }}>
                      {/* A layover reads S———P: the bus Stops where its run finished and Parks
                          there until the next one. A plain coloured rail said "something is
                          happening here" without saying what, and on 97 rows that is noise. The
                          two ends are what carry the meaning, so they are what is drawn. */}
                      {(layovers.get(row.veh) || []).map((l, i) => {
                        const c = l.kind === "overnight" ? t.watch : t.good;
                        /* The caps sit INSIDE the rail, not centred on its ends. Straddling the
                           ends put half of each badge on top of the run block it butts against,
                           so the rail appeared to overlap the bar it was meant to hand over to.
                           Inside, there is clear air on both sides of every join. */
                        const cap = (letter, side) => (
                          <span key={side} className="absolute flex items-center justify-center"
                            style={{ [side]: 0, top: -4.5, width: 12, height: 12, borderRadius: 3,
                                     background: c, color: "#fff", fontSize: 8, fontWeight: 800,
                                     lineHeight: 1, letterSpacing: 0 }}>{letter}</span>
                        );
                        /* Two 12px badges plus breathing room need ~30px of rail. Below that the
                           bare rail says it on its own — better than two badges shoved into each
                           other on a bus whose layover is twenty minutes. */
                        const railPx = ((pct(l.e) - pct(l.s)) / 100) * (BASE_W * zoom - LABEL_W);
                        const roomForCaps = railPx >= 30;
                        return (
                          <div key={"lay" + i}
                            title={`${row.veh} · S → P\nStops at ${l.a.to.name || "its last stop"} ${fmtClock(l.a.end)} after the ${l.a.label}\n` +
                                   `Parks at ${l.park.name} for ${Math.floor(l.gap / 60)}h${l.gap % 60 ? String(l.gap % 60).padStart(2, "0") : ""}\n` +
                                   `Leaves ${fmtClock(l.b.start)} on the ${l.b.label}` +
                                   (l.clippedEnd ? " — past the end of this chart" : "") + "\n" +
                                   `Saves ${l.saveKm} km of empty running (₹${l.saveRs}/day)${l.assumed ? "\n(depends on an assumed release time)" : ""}`}
                            className="absolute"
                            /* ON THE BARS' CENTRELINE (ROW_MID), not under them. The rail
                               starts exactly where the drop block ends and finishes exactly
                               where the next pickup begins, so at the row's mid-height it reads
                               as one continuous thread: run — parked — run. Pinned to the
                               bottom of the row it was 12px adrift and looked like it belonged
                               to the bus on the line below. */
                            /* Inset 3px at each end so the rail does not touch the blocks it
                               joins — a hairline of gap is what makes it read as a handover
                               rather than as one merged shape. */
                            style={{ top: ROW_MID - 1.5, height: 3,
                                     left: `calc(${pct(l.s)}% + 3px)`,
                                     width: `calc(${Math.max(pct(l.e) - pct(l.s), 0.5)}% - 6px)`,
                                     background: c, opacity: 0.9, borderRadius: 2 }}>
                            {roomForCaps && !l.clippedStart && cap("S", "left")}
                            {roomForCaps && !l.clippedEnd && cap("P", "right")}
                          </div>
                        );
                      })}
                      {/* Drop runs — the second half of the bus's day, which this board never drew. */}
                      {(dropsByVeh.get(row.veh) || []).map((d, i) => {
                        const c = (SERVICES.find((s) => s.id === d.svcId) || {}).color || t.faint;
                        return (
                          <div key={"drop" + i}
                            title={`${row.veh} · ${d.label}\n${fmtClock(d.start)}–${fmtClock(d.end)} · ${d.stops} stops · ${d.riders} riders${d.assumedOff ? "\n(release time assumed — the ERP carries no `off` for this service)" : ""}`}
                            className="absolute rounded-lg"
                            style={{
                              top: ROW_MID - 7, height: 14,
                              left: pct(d.s) + "%", width: Math.max(pct(d.e) - pct(d.s), 0.6) + "%",
                              // hollow + dashed when the timing is assumed rather than measured
                              background: c + (d.assumedOff ? "18" : "33"),
                              border: (d.assumedOff ? "1px dashed " : "1px solid ") + c,
                            }} />
                        );
                      })}
                      {row.runs.map((r, i) => (
                        <div key={i}
                          title={`${row.veh} · ${r.svc.name}\n${fmtClock(r.start)}–${fmtClock(r.end)} · ${r.km} km · ${r.stops} stops · ${r.riders} riders${r.clash ? "\n⚠ overlaps the previous run" : ""}`}
                          className="absolute rounded-lg"
                          style={{
                            top: ROW_MID - 11, height: 22,
                            left: pct(r.start) + "%", width: Math.max(pct(r.end) - pct(r.start), 0.6) + "%",
                            background: r.clash
                              ? `repeating-linear-gradient(45deg, ${r.svc.color}66 0 5px, transparent 5px 10px)`
                              : r.svc.color + "55",
                            border: (r.clash ? "1.5px dashed " : "1px solid ") + r.svc.color,
                          }} />
                      ))}
                    </div>
                  </React.Fragment>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <Empty t={t} title={clashOnly ? "No collisions" : "Nothing to show"}
            sub={clashOnly ? "No bus has overlapping runs under the current filters." : "Every run is filtered out — clear the filters above."} />
        )}

        <div className="flex flex-wrap items-center gap-4 mt-4 text-xs" style={{ color: t.muted }}>
          {ROTATION_SLOTS.map((sl) => (
            <span key={sl.id} className="inline-flex items-center gap-1.5">
              <i className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: sl.color, opacity: 0.35 }} />
              {sl.name} {fmtClock(sl.from)}–{fmtClock(sl.to % 1440)}
            </span>
          ))}
          {conn && showLayovers && (
            <>
              <span className="inline-flex items-center gap-1.5">
                <b style={{ color: t.good }}>S</b>—<b style={{ color: t.good }}>P</b>
                <span>Stops, then Parks there between shifts</span>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <b style={{ color: t.watch }}>S</b>—<b style={{ color: t.watch }}>P</b>
                <span>…and stands out overnight</span>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <i className="inline-block w-3 h-2.5 rounded-sm" style={{ border: "1px dashed " + t.muted }} />
                Drop run on an assumed release time
              </span>
              {/* A rail that vanished because somebody pinned that bus home is otherwise
                  indistinguishable from a rail the model never found. */}
              {pinnedHome > 0 && (
                <span className="inline-flex items-center gap-1.5" style={{ color: t.watch }}>
                  <ParkingSquare size={12} />
                  {pinnedHome} layover{pinnedHome === 1 ? "" : "s"} not drawn — those buses are pinned to the factory in the Planner
                </span>
              )}
            </>
          )}
          <span style={{ color: t.faint }}>Solid blocks are pickup runs, thin blocks the drops · hatched = the bus is double-booked · scroll on the chart (or the +/− buttons) to stretch the clock · the crosshair reads the exact time</span>
        </div>
      </Card>

      <Card t={t} title="Rotational — the three slots"
        hint="Rotational is one ERP shift covering three round-the-clock slots. On the floor riders rotate one place every Monday; the planning roster deliberately does not, so each slot keeps the riders its plan was built for.">
        <div className="overflow-x-auto">
          <table className="w-full text-sm" style={{ minWidth: 520 }}>
            <thead><tr style={{ background: t.surface2 }}>
              {["Slot", "Window", "Riders on the frozen roster"].map((h) => (
                <th key={h} className="py-2 px-3 text-xs font-semibold uppercase tracking-wider text-left" style={{ color: t.muted }}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {ROTATION_SLOTS.map((sl) => {
                const svc = SERVICES.find((s) => s.slot === sl.id);
                const st = svc && erpStatsFor(svc, shifts);
                return (
                  <tr key={sl.id} style={{ borderTop: "1px solid " + t.border }}>
                    <td className="py-2 px-3 font-semibold whitespace-nowrap" style={{ color: t.text }}>
                      <span className="inline-block w-2.5 h-2.5 rounded-sm mr-2 align-middle" style={{ background: sl.color }} />{sl.name}
                    </td>
                    <td className="py-2 px-3 tabular-nums" style={{ color: t.muted }}>{fmtClock(sl.from)} – {fmtClock(sl.to % 1440)}{sl.to > 24 * 60 ? " (next day)" : ""}</td>
                    <td className="py-2 px-3 tabular-nums" style={{ color: t.muted }}>{st ? st.riders.toLocaleString("en-IN") : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="text-xs mt-3" style={{ color: t.faint }}>
          Week beginning {fmtISO(weekStart(new Date()))}. Who sits in each slot is
          read from the roster cut for the rota week beginning {ROTA_WEEK}, which is also the week the
          three plans were built from — so a plan stays costed against the riders it was actually built
          for. Most riders in it punched that week; the rest were stepped forward one place per Monday
          from their last punch, and the Stops map marks those as inferred rather than observed.
          Re-cut it with build_rotational_roster.py and rebuild all three plans together; doing one
          without the other is what puts riders in the wrong slot.
        </div>
      </Card>

      {waiting.length > 0 && (
        <Card t={t} title="Not on the clock yet" hint="A service is only drawn once it has a gate time AND a finalised plan — the plan is where each route's ride time comes from, and that's what gives a run its start. Each one below says what it's missing.">
          <div className="flex flex-wrap gap-2">
            {waiting.map((s) => (
              <span key={s.id} className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs"
                style={{ border: "1px dashed " + t.border, color: t.muted }}>
                <span className="w-2 h-2 rounded-sm" style={{ background: s.color }} />
                {s.name}<span style={{ color: t.faint }}>· needs {serviceNeed(s, shifts) || "a plan"}</span>
              </span>
            ))}
          </div>
          <div className="text-xs mt-3 flex items-center gap-1.5" style={{ color: t.faint }}>
            <Clock size={12} /> Give a service riders and a gate time, and its runs appear here automatically.
          </div>
        </Card>
      )}
    </div>
  );
}
