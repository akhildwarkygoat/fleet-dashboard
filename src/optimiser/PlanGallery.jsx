/* ============================================================================
 * optimiser/PlanGallery.jsx — the "planning" landing (Google-Docs style)
 * ----------------------------------------------------------------------------
 * Choose how to start: a blank plan, import the optimised plan, or open one of
 * your saved drafts. Each saved draft is a card with a lightweight map PREVIEW
 * (an SVG of its routes), its name, last-edited time and a quick summary.
 * ==========================================================================*/
import React from "react";
import { Plus, Sparkles, MapPinned, Trash2, Clock, Users, Bus } from "lucide-react";

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
function PlanThumb({ t, assignments, stopsById, depot, busColor }) {
  const W = 300, H = 150, pad = 16;
  const routes = [], pts = [];
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

export default function PlanGallery({ t, drafts, totalRiders, stopsById, depot, busColor, onNewBlank, onImport, onOpen, onDelete, canImport, planLabel }) {
  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-lg font-bold" style={{ color: t.text }}>Planning</h3>
        <p className="text-sm" style={{ color: t.muted }}>Open a saved plan, or start a new one — then assign stops to buses on the map.</p>
      </div>

      {/* Start options */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
          <span><span className="block font-semibold" style={{ color: t.text }}>From optimised plan{planLabel ? ` — ${planLabel}` : ""}</span><span className="block text-xs" style={{ color: t.muted }}>Import the optimiser's {planLabel ? `${planLabel} ` : ""}plan and tweak it</span></span>
        </button>
      </div>

      {/* Saved drafts */}
      <div>
        <div className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color: t.muted }}>Saved plans ({drafts.length})</div>
        {drafts.length === 0 ? (
          <div className="rounded-2xl border py-10 text-center text-sm" style={{ borderColor: t.border, color: t.muted, borderStyle: "dashed" }}>
            No saved plans yet. Create one above and hit <b>Save</b> to keep it here.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {drafts.map((d) => {
              const m = d.meta || {};
              return (
                <div key={d.id} className="group relative rounded-2xl border overflow-hidden transition-all hover:-translate-y-0.5 cursor-pointer"
                  style={{ borderColor: t.border, background: t.surface, boxShadow: "0 1px 2px rgba(15,23,42,.04)" }} onClick={() => onOpen(d)}>
                  {/* map preview */}
                  <div className="h-32 w-full" style={{ borderBottom: "1px solid " + t.border }}>
                    <PlanThumb t={t} assignments={d.assignments} stopsById={stopsById} depot={depot} busColor={busColor} />
                  </div>
                  {/* info row */}
                  <div className="p-3">
                    <div className="flex items-start gap-2">
                      <span className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5" style={{ background: t.primarySoft, color: t.primary }}><MapPinned size={16} /></span>
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold truncate" style={{ color: t.text }} title={d.name}>{d.name}</div>
                        <div className="flex items-center gap-3 text-[11px] mt-0.5" style={{ color: t.muted }}>
                          <span className="inline-flex items-center gap-1"><Clock size={11} /> {relTime(d.ts)}</span>
                          <span className="inline-flex items-center gap-1"><Users size={11} /> {m.riders ?? 0}{totalRiders ? `/${totalRiders}` : ""}</span>
                          <span className="inline-flex items-center gap-1"><Bus size={11} /> {m.buses ?? 0}</span>
                        </div>
                      </div>
                      <button type="button" title="Delete plan"
                        onClick={(e) => { e.stopPropagation(); if (confirm(`Delete "${d.name}"? This can't be undone.`)) onDelete(d); }}
                        className="opacity-0 group-hover:opacity-100 transition-opacity rounded-lg p-1.5 -mr-1" style={{ color: t.poor, cursor: "pointer" }}><Trash2 size={15} /></button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
