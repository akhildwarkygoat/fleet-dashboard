/* ============================================================================
 * optimiser/PlanGallery.jsx — the "planning" landing (Google-Docs style)
 * ----------------------------------------------------------------------------
 * Choose how to start: a blank plan, import the optimised plan, or open one of
 * your saved drafts. Each saved draft is a card with a lightweight map PREVIEW
 * (an SVG of its routes), its name, last-edited time and a quick summary.
 * ==========================================================================*/
import React, { useLayoutEffect, useMemo, useRef } from "react";
import { gsap } from "gsap";
import { Flip } from "gsap/Flip";
import { Plus, Sparkles, MapPinned, Trash2, Clock, Users, Bus, FileUp, History, CheckCircle2, Circle } from "lucide-react";
import { PLAN_RANK, dirWords } from "./kpiRank.js";
import { prefersReduced, springTween } from "../ui/motion.js";
import { usePlanRanking, isFinalOf, prevRouteLines, readPlanFile } from "./plannerState.js";

gsap.registerPlugin(Flip);

function relTime(ts) {
  if (!ts) return "";
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60); if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h} hr ago`;
  const d = Math.floor(h / 24); if (d < 7) return `${d} day${d === 1 ? "" : "s"} ago`;
  return new Date(ts).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/* A tiny SVG "map" of a plan's routes — depot→stops polyline per bus, fit to view.
 * Cheap to render (no Leaflet), so a whole gallery of them stays snappy. */
export function PlanThumb({ t, assignments, stopsById, depot, busColor, lines }) {
  const W = 300, H = 150, pad = 16;
  const routes = [], pts = [];
  if (lines) {
    // pre-built [{color, coords:[[lat,lng],…]}] — used by the ERP prev-route card,
    // whose stops come straight from the feed (no store ids to look up)
    for (const l of lines) {
      if (!l.coords.length) continue;
      routes.push({ color: l.color, coords: [[depot.lat, depot.lng], ...l.coords] });
      l.coords.forEach((c) => pts.push(c));
    }
  } else
  for (const busId of Object.keys(assignments || {})) {
    const coords = (assignments[busId] || []).map((id) => stopsById.get(id)).filter(Boolean).map((s) => [s.lat, s.lng]);
    if (!coords.length) continue;
    routes.push({ color: (busColor && busColor[busId]) || t.primary, coords: [[depot.lat, depot.lng], ...coords] });
    coords.forEach((c) => pts.push(c));
  }
  if (depot) pts.push([depot.lat, depot.lng]);
  if (!routes.length) {
    return (
      <div className="w-full h-full flex items-center justify-center" style={{ background: t.surface2, color: t.muted }}>
        <span className="text-xs">Empty plan</span>
      </div>
    );
  }
  const lats = pts.map((p) => p[0]), lngs = pts.map((p) => p[1]);
  const minLa = Math.min(...lats), maxLa = Math.max(...lats), minLo = Math.min(...lngs), maxLo = Math.max(...lngs);
  const spanLa = (maxLa - minLa) || 1e-6, spanLo = (maxLo - minLo) || 1e-6;
  const sx = (lng) => pad + ((lng - minLo) / spanLo) * (W - 2 * pad);
  const sy = (lat) => pad + ((maxLa - lat) / spanLa) * (H - 2 * pad); // lat grows upward → invert
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="100%" preserveAspectRatio="xMidYMid slice" style={{ background: t.surface2, display: "block" }}>
      {routes.map((r, i) => (
        <polyline key={i} points={r.coords.map((c) => `${sx(c[1])},${sy(c[0])}`).join(" ")}
          fill="none" stroke={r.color} strokeWidth="1.6" strokeOpacity="0.9" strokeLinejoin="round" strokeLinecap="round" />
      ))}
      <circle cx={sx(depot.lng)} cy={sy(depot.lat)} r="3.5" fill={t.text} stroke="#fff" strokeWidth="1.4" />
    </svg>
  );
}

export default function PlanGallery({ t, drafts, totalRiders, stopsById, depot, busColor, onNewBlank, onImport, onOpen, onDelete, canImport, planLabel, planKind, onImportFile, onImportPrev, prevPlan, finalised, onFinalise, bodies }) {
  /* Rank the saved plans by any KPI the boards show (the same hidden-KPI preference applies):
     highest first, then lowest first, then back to newest first. Each plan is scored the way
     finalising scores it (usePlanHub's scoreDraft), so a figure here matches the board. */
  const gridRef = useRef(null);
  const flipFrom = useRef(null);
  const captureFlip = () => { if (gridRef.current && !prefersReduced()) flipFrom.current = Flip.getState(gridRef.current.children); };
  // the ranking's state and order live in plannerState.js, shared with the new look
  const { rank, chips, press, ranked } = usePlanRanking(drafts, bodies, captureFlip);
  useLayoutEffect(() => {
    if (!flipFrom.current) return;
    Flip.from(flipFrom.current, springTween("move"));
    flipFrom.current = null;
  }, [rank]);
  // hidden file input for "Import plan file" — reads a plan JSON exported by a teammate
  const fileRef = useRef(null);
  const prevMeta = prevPlan && prevPlan.meta;
  /* Which candidate is the finalised one. `isDefault` means nobody chose — the optimised
     plan is standing in — and that must read differently from a deliberate choice. */
  const isFinal = (kind, id) => isFinalOf(finalised, kind, id);
  // thumbnail polylines for the permanent prev-route card (drawn straight from the ERP feed)
  const prevLines = useMemo(() => prevRouteLines(prevPlan), [prevPlan]);
  /* The ERP's previous allocation is not a saved plan and has no score, so while the plans are
     ranked it follows them rather than sitting above #1. */
  const prevCard = prevLines && (
    <div key="prev" className="relative rounded-2xl border overflow-hidden transition-all hover:-translate-y-0.5 cursor-pointer"
      style={{ borderColor: t.border, background: t.surface, boxShadow: "0 1px 2px rgba(15,23,42,.04)" }}
      onClick={onImportPrev} title={rank ? "The ERP's actual allocation — open it to score it; it is not a saved plan, so it is not ranked" : "Open the ERP's actual allocation in the editor"}>
      <div className="h-32 w-full" style={{ borderBottom: "1px solid " + t.border }}>
        <PlanThumb t={t} lines={prevLines} depot={depot} />
      </div>
      <div className="p-3">
        <div className="flex items-start gap-2">
          <span className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5" style={{ background: t.watch + "22", color: t.watch }}><History size={16} /></span>
          <div className="min-w-0 flex-1">
            <div className="font-semibold truncate" style={{ color: t.text }}>Previous routes</div>
            <div className="flex items-center gap-3 text-[11px] mt-0.5" style={{ color: t.muted }}>
              <span className="inline-flex items-center gap-1"><Clock size={11} /> from ERP</span>
              <span className="inline-flex items-center gap-1"><Users size={11} /> {prevMeta ? prevMeta.riders : "—"}</span>
              <span className="inline-flex items-center gap-1"><Bus size={11} /> {prevMeta ? prevMeta.vehicles : "—"}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
  const onFile = (e) => readPlanFile(e, onImportFile);
  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-lg font-bold" style={{ color: t.text }}>Planning</h3>
        <p className="text-sm" style={{ color: t.muted }}>Open a saved plan, or start a new one — then assign stops to buses on the map.</p>
      </div>

      {/* Start options */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <button type="button" onClick={onNewBlank}
          className="flex items-center gap-3 rounded-2xl p-4 text-left transition-all hover:-translate-y-0.5"
          style={{ border: "1.5px dashed " + t.primary, background: t.primarySoft, cursor: "pointer" }}>
          <span className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: t.primary, color: t.onPrimary || "#fff" }}><Plus size={20} /></span>
          <span><span className="block font-semibold" style={{ color: t.text }}>Blank plan</span><span className="block text-xs" style={{ color: t.muted }}>Build a fresh plan from scratch</span></span>
        </button>
        <button type="button" onClick={onImport} disabled={!canImport}
          className="flex items-center gap-3 rounded-2xl p-4 text-left transition-all hover:-translate-y-0.5"
          style={{ border: "1.5px solid " + t.border, background: t.surface, cursor: canImport ? "pointer" : "not-allowed", opacity: canImport ? 1 : 0.5 }}>
          <span className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: t.techno + "22", color: t.techno }}><Sparkles size={20} /></span>
          {/* A Rotational slot seeds from the transport manager's group plan and a fixed-hour
              service from its finalised (built-in or chosen) plan — say whose plan it is
              (planKind from NewPlanView: "rotation" | "final" | "optimised"). */}
          <span><span className="block font-semibold" style={{ color: t.text }}>{planKind === "optimised" || !planKind ? "From optimised plan" : "From the finalised plan"}{planLabel ? ` — ${planLabel}` : ""}</span><span className="block text-xs" style={{ color: t.muted }}>Import the {planKind === "rotation" ? "manager's" : planKind === "final" ? "finalised" : "optimiser's"} {planLabel ? `${planLabel} ` : ""}plan and tweak it</span></span>
        </button>
        <button type="button" onClick={() => fileRef.current && fileRef.current.click()}
          className="flex items-center gap-3 rounded-2xl p-4 text-left transition-all hover:-translate-y-0.5"
          style={{ border: "1.5px solid " + t.border, background: t.surface, cursor: "pointer" }}>
          <span className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: t.good + "22", color: t.good }}><FileUp size={20} /></span>
          <span><span className="block font-semibold" style={{ color: t.text }}>Import plan file</span><span className="block text-xs" style={{ color: t.muted }}>Open a plan JSON a teammate exported from their Planner</span></span>
        </button>
        <input ref={fileRef} type="file" accept=".json,application/json" style={{ display: "none" }} onChange={onFile} />
      </div>

      {/* Saved drafts — the ERP's prev-route allocation always sits first as a permanent card */}
      <div>
        <div className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color: t.muted }}>Plans ({drafts.length + (prevLines ? 1 : 0)})</div>
        {drafts.length > 1 && chips.length > 0 && (
          <div className="mb-3">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs font-semibold mr-1" style={{ color: t.muted }}>Rank plans by</span>
              {chips.map((d) => {
                const on = !!rank && rank.key === d.key;
                return (
                  <button key={d.key} type="button" onClick={() => press(d.key)} aria-pressed={on}
                    title={!on ? `${d.hint} — highest first` : rank.dir === "desc" ? "Press for lowest first" : "Press to stop ranking"}
                    className="rounded-full px-2.5 py-1 text-xs font-semibold transition-colors whitespace-nowrap"
                    style={{ border: "1px solid " + (on ? t.primary : t.border), background: on ? t.primarySoft : t.surface,
                             color: on ? t.primary : t.text, cursor: "pointer" }}>
                    {PLAN_RANK[d.key].label}{on ? (rank.dir === "desc" ? " ↓" : " ↑") : ""}
                  </button>
                );
              })}
              {rank && (
                <button type="button" onClick={() => press(null)} className="rounded-full px-2.5 py-1 text-xs font-semibold"
                  style={{ color: t.muted, cursor: "pointer" }}>Clear</button>
              )}
            </div>
            {rank && (
              <p className="text-xs mt-1.5" style={{ color: t.muted }}>
                By {PLAN_RANK[rank.key].label.toLowerCase()}, {dirWords(rank.dir)} — each plan scored the way finalising scores it.
              </p>
            )}
          </div>
        )}
        {drafts.length === 0 && !prevLines ? (
          <div className="rounded-2xl border py-10 text-center text-sm" style={{ borderColor: t.border, color: t.muted, borderStyle: "dashed" }}>
            No saved plans yet. Create one above and hit <b>Save</b> to keep it here.
          </div>
        ) : (
          <div ref={gridRef} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {!rank && prevCard}
            {ranked.map(({ item: d, value, rank: pos }) => {
              const m = d.meta || {};
              return (
                <div key={d.id} className="group relative rounded-2xl border overflow-hidden transition-all hover:-translate-y-0.5 cursor-pointer"
                  style={{ borderColor: pos === 1 ? t.primary : t.border, background: t.surface, boxShadow: "0 1px 2px rgba(15,23,42,.04)" }} onClick={() => onOpen(d)}>
                  {/* map preview */}
                  <div className="relative h-32 w-full" style={{ borderBottom: "1px solid " + t.border }}>
                    <PlanThumb t={t} assignments={d.assignments} stopsById={stopsById} depot={depot} busColor={busColor} />
                    {rank && (
                      <span className="absolute top-2 left-2 rounded-lg px-2 py-0.5 text-xs font-bold tabular-nums"
                        style={{ background: t.surface, border: "1px solid " + (pos === 1 ? t.primary : t.border), color: pos != null ? t.primary : t.muted }}>
                        {pos != null ? `#${pos}` : "not scored"}
                      </span>
                    )}
                  </div>
                  {/* info row */}
                  <div className="p-3">
                    <div className="flex items-start gap-2">
                      <span className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5" style={{ background: t.primarySoft, color: t.primary }}><MapPinned size={16} /></span>
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold truncate" style={{ color: t.text }} title={d.name}>{d.name}</div>
                        {rank && (
                          <div className="text-sm font-bold tabular-nums mt-0.5" style={{ color: pos != null ? t.text : t.faint }}>
                            {pos != null ? PLAN_RANK[rank.key].fmt(value) : "—"}
                          </div>
                        )}
                        <div className="flex items-center gap-3 text-[11px] mt-0.5" style={{ color: t.muted }}>
                          <span className="inline-flex items-center gap-1"><Clock size={11} /> {relTime(d.ts)}</span>
                          <span className="inline-flex items-center gap-1"><Users size={11} /> {m.riders ?? 0}{totalRiders ? `/${totalRiders}` : ""}</span>
                          <span className="inline-flex items-center gap-1"><Bus size={11} /> {m.buses ?? 0}</span>
                        </div>
                        {onFinalise && (
                          <button type="button" onClick={(e) => { e.stopPropagation(); onFinalise({ kind: "draft", id: d.id, name: d.name }); }}
                            title={isFinal("draft", d.id) ? "This is the finalised plan for this service" : "Use this as the finalised plan"}
                            className="inline-flex items-center gap-1 mt-1.5 rounded-lg px-2 py-0.5 text-[11px] font-semibold"
                            style={{ border: "1px solid " + (isFinal("draft", d.id) ? t.good : t.border),
                                     background: isFinal("draft", d.id) ? t.goodSoft : t.surface,
                                     color: isFinal("draft", d.id) ? t.good : t.muted, cursor: "pointer" }}>
                            {isFinal("draft", d.id) ? <CheckCircle2 size={11} /> : <Circle size={11} />}
                            {isFinal("draft", d.id) ? "Finalised" : "Finalise"}
                          </button>
                        )}
                      </div>
                      <button type="button" title="Delete plan"
                        onClick={(e) => { e.stopPropagation(); if (confirm(`Delete "${d.name}"? This can't be undone.`)) onDelete(d); }}
                        className="opacity-0 group-hover:opacity-100 transition-opacity rounded-lg p-1.5 -mr-1" style={{ color: t.poor, cursor: "pointer" }}><Trash2 size={15} /></button>
                    </div>
                  </div>
                </div>
              );
            })}
            {rank && prevCard}
          </div>
        )}
      </div>
    </div>
  );
}
