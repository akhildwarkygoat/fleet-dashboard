/* ============================================================================
 * optimiser/ParkPicker.jsx — choose where one bus stands when it is not running.
 * ----------------------------------------------------------------------------
 * Candidates are the nodes of the road matrix and nothing else. That is the whole
 * discipline: a matrix node has measured Google driving distances to the rest of
 * the network, so parking a bus there can be PRICED. Any other point on the map
 * would have to be estimated, and this repo does not quote estimated distances as
 * if they were measured.
 *
 * `Where it ends` is the default and means "leave the bus where the route
 * finishes" — the village it just dropped its last rider in. `Factory` drives it
 * home after every run, which is what every plan here has always assumed and so
 * is the zero line any saving is measured against. A named node is for when the
 * village has nowhere a bus can safely stand and a yard, bypass or bus stand
 * nearby does.
 *
 * 1,100-odd candidates is too many to scroll, so it is search-first and shows the
 * nearest handful to the depot until you type.
 * ==========================================================================*/
import React, { useState, useEffect, useMemo } from "react";
import { MapPin, Search, RotateCcw, Home, Crosshair } from "lucide-react";

/** The catalogue, fetched once and shared by every picker on the page. */
let cache = null;
export function useParkPoints() {
  const [points, setPoints] = useState(() => cache || []);
  useEffect(() => {
    if (cache) return;
    fetch("/park_points.json").then((r) => (r.ok ? r.json() : null))
      .then((p) => { cache = (p && p.points) || []; setPoints(cache); })
      .catch(() => { cache = []; });
  }, []);
  return points;
}

/** One-line description of a stored spec, for a button label. */
export const parkLabel = (spec, which = "park") =>
  !spec || spec.kind === "auto" || spec.kind === "tail"
    ? (which === "start" ? "Factory" : "Where it ends")
    : spec.kind === "depot" ? "Factory"
    : spec.name || `node ${spec.idx}`;

/**
 * @param which   "start" | "park" — which end of the run is being set. The two differ only in
 *                what their default means: a run starts at the factory and ends wherever its
 *                last stop is, so "leave it alone" is a different place for each.
 */
export default function ParkPicker({ t, busName, which = "park", current, points, onPick, onClose, glass, glassInner }) {
  const [q, setQ] = useState("");
  const list = useMemo(() => {
    const ql = q.trim().toLowerCase();
    const src = ql ? points.filter((p) => p.name.toLowerCase().includes(ql)) : points;
    return [...src].sort((a, b) => (a.depotKm ?? 1e9) - (b.depotKm ?? 1e9)).slice(0, 40);
  }, [points, q]);
  const cur = current || { kind: "auto" };
  const isStart = which === "start";
  const chip = (active) => ({
    background: active ? t.primary : (glassInner || t.surface2),
    color: active ? (t.onPrimary || "#fff") : t.text,
    border: "1px solid " + (active ? t.primary : t.border), cursor: "pointer",
  });

  return (
    <div className="rounded-xl p-3" style={glass || { background: t.surface, border: "1px solid " + t.primary }}>
      <div className="flex items-center gap-2 mb-2.5">
        <MapPin size={13} style={{ color: t.primary }} />
        <span className="text-xs font-bold uppercase tracking-wider" style={{ color: t.text }}>
          {busName ? `${busName} ${isStart ? "starts from" : "parks at"}` : isStart ? "Starts from" : "Parks at"}
        </span>
        <button type="button" onClick={onClose} className="ml-auto text-xs" style={{ color: t.muted, cursor: "pointer" }}>Close</button>
      </div>
      <div className="flex flex-wrap gap-1.5 mb-2.5">
        <button type="button" onClick={() => onPick({ kind: "auto" })}
          className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold"
          style={chip(cur.kind === "auto" || cur.kind === "tail")}>
          <RotateCcw size={12} /> {isStart ? "Factory (default)" : "Where it ends"}
        </button>
        {!isStart && (
          <button type="button" onClick={() => onPick({ kind: "depot" })}
            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold"
            style={chip(cur.kind === "depot")}>
            <Home size={12} /> Factory
          </button>
        )}
      </div>
      {/* Not a mode you switch on — it is simply true while this panel is open, so it is stated
          rather than offered. Choosing where a bus stands never edits who it carries. */}
      <p className="text-[11px] mb-2 rounded-lg px-2 py-1.5 flex items-start gap-1.5"
        style={{ background: t.primarySoft, color: t.primary }}>
        <Crosshair size={12} className="shrink-0 mt-0.5" />
        <span>
          Click any stop on the map to use it. While this is open, clicking
          <b> does not add or remove </b> stops from the route.
        </span>
      </p>
      <div className="relative mb-2">
        <Search size={13} style={{ position: "absolute", left: 9, top: 8, color: t.muted }} />
        <input value={q} onChange={(e) => setQ(e.target.value)} autoFocus
          placeholder={points.length ? `Search ${points.length.toLocaleString("en-IN")} places…` : "Loading places…"}
          className="w-full rounded-lg pl-7 pr-2 py-1.5 text-sm outline-none"
          style={{ background: glassInner || t.inputBg, border: "1px solid " + t.border, color: t.text }} />
      </div>
      <div className="max-h-44 overflow-y-auto flex flex-col gap-0.5">
        {list.map((p) => (
          <button key={p.idx} type="button" onClick={() => onPick({ kind: "node", idx: p.idx, name: p.name })}
            className="flex items-center gap-2 text-left rounded-lg px-2 py-1.5 text-xs transition"
            style={{ background: cur.idx === p.idx ? t.primarySoft : "transparent",
                     color: cur.idx === p.idx ? t.primary : t.text, cursor: "pointer" }}>
            <MapPin size={11} style={{ color: t.muted, flexShrink: 0 }} />
            <span className="flex-1 truncate">{p.name}</span>
            {p.depotKm != null && <span className="tabular-nums" style={{ color: t.muted }}>{p.depotKm} km</span>}
          </button>
        ))}
        {!list.length && (
          <div className="text-xs py-3 text-center" style={{ color: t.muted }}>
            {points.length ? `Nothing matches “${q}”.` : "Run node build_bus_connections.mjs to build the place list."}
          </div>
        )}
      </div>
      <p className="text-[10px] mt-2" style={{ color: t.muted }}>
        Only places on the road matrix — the ones with measured driving distances — so the choice can be costed.
      </p>
    </div>
  );
}
