/* ============================================================================
 * optimiser/PlanBoard.jsx — shared editing board for both plan features
 * ----------------------------------------------------------------------------
 * Map-first layout (see NEW_FEATURES_PLAN.md mockup): live KPI tiles, a live map
 * that redraws routes as you assign, a "Your buses" column of drop-target cards,
 * and a draggable tray of unassigned stops. Presentational only — all state lives
 * in the usePlanEditor() hook passed in via `editor`.
 * ==========================================================================*/
import React, { useMemo, useState, useEffect } from "react";
import { Card, Btn, Tile, PALETTE } from "./ui.jsx";
import GMap from "./GMap.jsx";
import EnlargeableMap from "./EnlargeableMap.jsx";
import { routeGeometry } from "./roadGeom.js";
import { Search, X, Wand2, Trash2, GripVertical } from "lucide-react";

const DT = "application/x-stop-id"; // drag payload key

export default function PlanBoard({
  t, editor, fleet, depot, stopsById, totalRiders, demandOf,
  mode = "build", baseline = null, headerRight = null,
}) {
  const dem = demandOf || ((s) => s.headcount || 0);
  const [q, setQ] = useState("");
  const [az, setAz] = useState(false); // sort unassigned A–Z (else by riders desc)
  const [dragOver, setDragOver] = useState(null); // busId | "tray" | null — drop-target highlight
  const busColor = useMemo(() => { const m = {}; fleet.forEach((b, i) => (m[b.id] = PALETTE[i % PALETTE.length])); return m; }, [fleet]);

  const k = editor.live ? editor.live.kpis : null;
  const assignedHeads = editor.perBus.reduce((n, r) => n + r.heads, 0);
  const progress = totalRiders ? (assignedHeads / totalRiders) * 100 : 0;
  const busesUsed = editor.perBus.filter((r) => r.stopIds.length).length;
  const overCapBuses = editor.perBus.filter((r) => r.overCap).length;

  // unassigned stops (tray)
  const unassigned = useMemo(() => {
    const list = [];
    for (const [id, s] of stopsById) if (!editor.assignedIds.has(id)) list.push(s);
    const needle = q.trim().toLowerCase();
    const filtered = needle ? list.filter((s) => (s.name || "").toLowerCase().includes(needle) || (s.village || "").toLowerCase().includes(needle)) : list;
    filtered.sort(az ? (a, b) => (a.name || "").localeCompare(b.name || "") : (a, b) => dem(b) - dem(a));
    return filtered;
  }, [stopsById, editor.assignedIds, q, az]);

  // live map: coloured dots per assigned bus + a polyline depot→stops→depot per bus
  const mapStops = useMemo(() => {
    const out = [];
    editor.perBus.forEach((r) => r.stops.forEach((s) => out.push({ ...s, route: r.bus.id, headcount: dem(s) })));
    return out;
  }, [editor.perBus]);
  // Straight-line chain (depot → stops in order; the bus parks at its last stop, so no return
  // leg) — drawn instantly, then upgraded to real road paths as roadGeom resolves them.
  const straightPolys = useMemo(() => editor.perBus.filter((r) => r.stops.length).map((r) => ({
    color: busColor[r.bus.id],
    points: [[depot.lat, depot.lng], ...r.stops.map((s) => [s.lat, s.lng])],
  })), [editor.perBus, depot, busColor]);
  const routeSig = useMemo(() => editor.perBus.filter((r) => r.stops.length)
    .map((r) => r.bus.id + ":" + r.stopIds.join(",")).join("|"), [editor.perBus]);
  const [roadPolys, setRoadPolys] = useState([]);
  useEffect(() => {
    let live = true;
    const active = editor.perBus.filter((r) => r.stops.length);
    Promise.all(active.map(async (r) => ({ color: busColor[r.bus.id], points: await routeGeometry(depot, r.stops) })))
      .then((polys) => { if (live) setRoadPolys(polys.filter((p) => p.points.length)); });
    return () => { live = false; };
  }, [routeSig]); // eslint-disable-line
  const polylines = roadPolys.length ? roadPolys : straightPolys;

  // ---- drag & drop ----
  const onDragStart = (e, stopId) => { e.dataTransfer.setData(DT, stopId); e.dataTransfer.effectAllowed = "move"; };
  const onDragEnd = () => setDragOver(null);
  const over = (e, where) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; if (dragOver !== where) setDragOver(where); };
  const allow = (e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; };
  const dropOnBus = (e, busId) => { e.preventDefault(); setDragOver(null); const id = e.dataTransfer.getData(DT); if (id) editor.assignStop(id, busId); };
  const dropOnTray = (e) => { e.preventDefault(); setDragOver(null); const id = e.dataTransfer.getData(DT); if (id) editor.unassignStop(id); };
  // drop onto a specific stop chip → manual placement at that index (drag-to-reorder / precise insert)
  const dropOnChip = (e, busId, index) => { e.preventDefault(); e.stopPropagation(); setDragOver(null); const id = e.dataTransfer.getData(DT); if (id) editor.insertStopAt(id, busId, index); };

  const delta = (now, was, lowerBetter = true, fmt = (x) => x) => {
    if (was == null || !isFinite(was)) return null;
    const d = now - was, good = lowerBetter ? d < 0 : d > 0;
    if (Math.abs(d) < 1e-9) return <span style={{ color: t.muted }}> · no change</span>;
    return <span style={{ color: good ? t.good : t.poor }}> · {d > 0 ? "+" : ""}{fmt(d)} vs plan</span>;
  };

  return (
    <div className="space-y-4">
      {/* KPI tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Tile t={t} label="People" value={`${assignedHeads} / ${totalRiders}`}
          sub={`${progress.toFixed(0)}% assigned`} accent={t.techno} deltaColor={progress >= 99.5 ? t.good : t.muted} />
        <Tile t={t} label="Avg util" value={k ? `${k.utilisation.toFixed(0)}%` : "—"}
          sub={`${busesUsed} bus${busesUsed === 1 ? "" : "es"} used`} accent={k && k.utilisation >= 85 ? t.good : t.watch} />
        <Tile t={t} label="Cost / head / day" value={k && k.heads ? `₹${k.costPerHeadDay.toFixed(1)}` : "—"}
          sub={<>{k ? `₹${Math.round(k.totalCost).toLocaleString("en-IN")} / day` : ""}{mode === "edit" && k && baseline ? delta(k.costPerHeadDay, baseline.costPerHeadDay, true, (d) => `₹${Math.abs(d).toFixed(1)}`) : null}</>}
          accent={t.primary} />
        <Tile t={t} label="Max ride" value={k ? `${Math.round(k.maxRide)} min` : "—"}
          sub={<>{overCapBuses ? <span style={{ color: t.poor }}>{overCapBuses} over capacity</span> : "to last stop"}{mode === "edit" && k && baseline ? delta(k.maxRide, baseline.maxRide, true, (d) => `${Math.round(Math.abs(d))}m`) : null}</>}
          accent={k && k.maxRide < 100 ? t.good : t.poor} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Live map + unassigned tray */}
        <div className="lg:col-span-2 space-y-4">
          <Card t={t} title="Live map" hint="Routes redraw as you assign stops." right={headerRight}>
            <EnlargeableMap t={t} height={380} render={(h, big) => (
              <div className="rounded-xl overflow-hidden" style={{ border: "1px solid " + t.border }}>
                <GMap t={t} stops={mapStops} routeColors={busColor} depot={depot} polylines={polylines} height={h} scrollWheelZoom={big} />
              </div>
            )} />
          </Card>

          <Card t={t} title={`Unassigned stops (${unassigned.length})`}
            right={<button type="button" onClick={() => setAz((v) => !v)} className="text-xs rounded-lg px-2 py-1"
              style={{ border: "1px solid " + t.border, color: t.muted, cursor: "pointer" }}>{az ? "A–Z" : "By riders"}</button>}>
            <div className="flex items-center gap-2 mb-3 rounded-xl px-3 py-2" style={{ border: "1px solid " + t.border }}
              onDragOver={allow} onDrop={dropOnTray}>
              <Search size={15} style={{ color: t.muted }} />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search stop / village… (drag a chip here to unassign)"
                className="w-full bg-transparent outline-none text-sm" style={{ color: t.text }} />
            </div>
            <div className="flex flex-wrap gap-2 max-h-64 overflow-y-auto rounded-lg transition-colors" onDragOver={(e) => over(e, "tray")} onDrop={dropOnTray}
              style={{ outline: dragOver === "tray" ? "2px dashed " + t.primary : "2px dashed transparent", outlineOffset: 2 }}>
              {unassigned.length === 0 && <div className="text-sm py-3" style={{ color: t.good }}>All stops assigned ✓</div>}
              {unassigned.slice(0, 300).map((s) => (
                <span key={s.id} draggable onDragStart={(e) => onDragStart(e, s.id)} onDragEnd={onDragEnd}
                  className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs cursor-grab select-none"
                  style={{ border: "1px solid " + t.border, background: t.surface2, color: t.text }} title={s.village || s.name}>
                  {s.name} <b style={{ color: t.techno }}>{dem(s)}</b>
                </span>
              ))}
              {unassigned.length > 300 && <span className="text-xs self-center" style={{ color: t.muted }}>+{unassigned.length - 300} more — search to narrow</span>}
            </div>
          </Card>
        </div>

        {/* Your buses */}
        <Card t={t} title="Your buses" className="lg:col-span-1"
          right={<span className="text-xs" style={{ color: t.muted }}>{busesUsed}/{fleet.length} used</span>}>
          <div className="space-y-3 max-h-[640px] overflow-y-auto pr-1">
            {editor.perBus.map((r) => (
              <div key={r.bus.id} onDragOver={(e) => over(e, r.bus.id)} onDrop={(e) => dropOnBus(e, r.bus.id)}
                className="rounded-xl p-3 transition-all" style={{ border: "1.5px solid " + (dragOver === r.bus.id ? t.primary : r.overCap ? t.poor : busColor[r.bus.id]), background: dragOver === r.bus.id ? t.primarySoft : t.surface, boxShadow: dragOver === r.bus.id ? "0 0 0 3px " + t.primarySoft : "none" }}>
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <div className="flex items-center gap-1.5 text-sm font-semibold" style={{ color: t.text }}>
                    <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: busColor[r.bus.id] }} />
                    {r.bus.name}
                    <span className="text-[10px] font-medium rounded px-1.5 py-0.5" style={{ background: t.surface2, color: t.muted }}>{r.bus.type} · {r.cap}</span>
                  </div>
                  {r.stopIds.length > 0 && (
                    <div className="flex items-center gap-1">
                      <button type="button" title="Auto-sequence nearest-first" onClick={() => editor.autoSequence(r.bus.id)} style={{ color: t.muted, cursor: "pointer" }}><Wand2 size={13} /></button>
                      <button type="button" title="Clear bus" onClick={() => editor.clearBus(r.bus.id)} style={{ color: t.muted, cursor: "pointer" }}><Trash2 size={13} /></button>
                    </div>
                  )}
                </div>
                {/* fill bar — green ≤ seats, amber over seats (within leniency), red past leniency */}
                <div className="h-1.5 rounded-full overflow-hidden mb-1" style={{ background: t.surface2 }}>
                  <div className="h-full rounded-full" style={{ width: Math.min(100, r.fill * 100) + "%", background: r.overCap ? t.poor : r.overSeats ? t.watch : t.good }} />
                </div>
                <div className="text-xs mb-2" style={{ color: r.overCap ? t.poor : r.overSeats ? t.watch : t.muted }}>
                  {r.overCap ? <b>{r.heads} / {r.cap} · OVER CAP</b> : r.overSeats ? <>{r.heads} / {r.cap} · over seats</> : <>{r.heads} / {r.cap} filled</>}
                  {r.stopIds.length > 0 && <span style={{ color: t.muted }}> · {Math.round(r.ride)}m · ₹{Math.round(r.cost)}</span>}
                </div>
                {/* ordered stop chips */}
                {r.stops.length === 0 ? (
                  <div className="rounded-lg py-3 text-center text-xs" style={{ border: "1px dashed " + t.border, color: t.muted }}>drop stops here</div>
                ) : (
                  <div className="flex flex-col gap-1">
                    {r.stops.map((s, i) => (
                      <div key={s.id} draggable onDragStart={(e) => onDragStart(e, s.id)} onDragEnd={onDragEnd}
                        onDragOver={allow} onDrop={(e) => dropOnChip(e, r.bus.id, i)}
                        title="Drag to reorder, or onto another bus to move"
                        className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs cursor-grab select-none"
                        style={{ background: t.surface2, color: t.text }}>
                        <GripVertical size={11} style={{ color: t.muted }} />
                        <span className="inline-flex items-center justify-center rounded-full text-[9px] font-bold flex-shrink-0" style={{ width: 15, height: 15, background: busColor[r.bus.id], color: "#fff" }}>{i + 1}</span>
                        <span className="truncate flex-1">{s.name}</span>
                        <b style={{ color: t.techno }}>{dem(s)}</b>
                        <button type="button" title="Unassign" onClick={() => editor.unassignStop(s.id)} style={{ color: t.muted, cursor: "pointer" }}><X size={12} /></button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
