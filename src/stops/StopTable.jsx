/* ============================================================================
 * stops/StopTable.jsx  —  Sortable, editable master list of stops
 * ----------------------------------------------------------------------------
 * Columns: Route | Stop Name | Latitude | Longitude | Status | (actions)
 * Capabilities:
 *   - sort by any column (click header; click again to flip direction)
 *   - group by route (toggle) with a colored route swatch
 *   - inline-edit the stop name
 *   - reassign a stop to a different route (dropdown)
 *   - type lat/long by hand for a no-GPS stop
 *   - delete a stop
 *   - click a row to select it (highlights + centers the matching map pin)
 *
 * Pure presentation + local edit state. All persistence goes through the
 * callbacks (onUpdate / onDelete) which the parent wires to stopStore.
 * ==========================================================================*/

import React, { useState, useMemo } from "react";
import { ChevronUp, ChevronDown, Trash2, MapPin, Check, X } from "lucide-react";
import { SelectInput, StatusPill } from "./ui.jsx";

const COLUMNS = [
  ["route", "Route"],
  ["name", "Stop Name"],
  ["lat", "Latitude"],
  ["lng", "Longitude"],
  ["status", "Status"],
];

const num = (v) => (v == null || v === "" ? "" : Number(v).toFixed(6));

export default function StopTable({
  t, stops, routes, routeColors, selectedId,
  onSelect, onUpdate, onDelete, onPinRequest, groupByRoute, setGroupByRoute,
}) {
  const [sortKey, setSortKey] = useState("route");
  const [sortDir, setSortDir] = useState(1); // 1 asc, -1 desc
  const [editName, setEditName] = useState(null); // {id, value}

  const sorted = useMemo(() => {
    const arr = [...stops];
    arr.sort((a, b) => {
      let av = a[sortKey], bv = b[sortKey];
      if (sortKey === "lat" || sortKey === "lng") { av = av ?? -Infinity; bv = bv ?? -Infinity; return (av - bv) * sortDir; }
      av = (av ?? "").toString().toLowerCase(); bv = (bv ?? "").toString().toLowerCase();
      return av < bv ? -sortDir : av > bv ? sortDir : 0;
    });
    return arr;
  }, [stops, sortKey, sortDir]);

  const toggleSort = (key) => {
    if (key === sortKey) setSortDir((d) => -d);
    else { setSortKey(key); setSortDir(1); }
  };

  const commitName = () => {
    if (editName && editName.value.trim()) onUpdate(editName.id, { name: editName.value.trim() });
    setEditName(null);
  };

  const th = "text-left px-3 py-2.5 text-xs font-semibold uppercase tracking-wider select-none cursor-pointer whitespace-nowrap";
  const td = "px-3 py-2 text-sm align-middle";

  // Group rows under route headers when grouping is on.
  const rows = [];
  if (groupByRoute) {
    const byRoute = {};
    sorted.forEach((s) => { (byRoute[s.route] ||= []).push(s); });
    Object.keys(byRoute).forEach((route) => {
      rows.push({ _group: route });
      byRoute[route].forEach((s) => rows.push(s));
    });
  } else {
    rows.push(...sorted);
  }

  return (
    <div className="rounded-2xl border overflow-hidden" style={{ background: t.surface, borderColor: t.border }}>
      <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: "1px solid " + t.border }}>
        <div className="font-semibold" style={{ color: t.text }}>Master stop list <span style={{ color: t.muted }}>· {stops.length}</span></div>
        <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: t.muted }}>
          <input type="checkbox" checked={groupByRoute} onChange={(e) => setGroupByRoute(e.target.checked)} />
          Group by route
        </label>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr style={{ background: t.surface2, color: t.muted }}>
              {COLUMNS.map(([key, label]) => (
                <th key={key} className={th} onClick={() => toggleSort(key)}>
                  <span className="inline-flex items-center gap-1">
                    {label}
                    {sortKey === key && (sortDir === 1 ? <ChevronUp size={13} /> : <ChevronDown size={13} />)}
                  </span>
                </th>
              ))}
              <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wider" style={{ color: t.muted }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-sm" style={{ color: t.muted }}>No stops yet — name a route and drop in some photos.</td></tr>
            )}

            {rows.map((row) => {
              if (row._group) {
                return (
                  <tr key={"g-" + row._group} style={{ background: t.surface2 }}>
                    <td colSpan={6} className="px-3 py-2 text-xs font-semibold uppercase tracking-wider" style={{ color: t.text }}>
                      <span className="inline-block w-2.5 h-2.5 rounded-sm mr-2 align-middle" style={{ background: routeColors[row._group] || t.primary }} />
                      {row._group}
                    </td>
                  </tr>
                );
              }

              const s = row;
              const on = s.id === selectedId;
              const needsGps = s.lat == null || s.lng == null;
              return (
                <tr key={s.id} onClick={() => onSelect(s.id)} className="cursor-pointer transition"
                  style={{ background: on ? t.primarySoft : "transparent", borderTop: "1px solid " + t.border }}>
                  {/* Route (reassignable) */}
                  <td className={td} onClick={(e) => e.stopPropagation()}>
                    <SelectInput t={t} value={s.route} onChange={(e) => onUpdate(s.id, { route: e.target.value })} style={{ padding: "4px 8px" }}>
                      {routes.map((r) => <option key={r} value={r}>{r}</option>)}
                    </SelectInput>
                  </td>

                  {/* Stop name (inline editable) */}
                  <td className={td} onClick={(e) => e.stopPropagation()} style={{ color: t.text }}>
                    {editName && editName.id === s.id ? (
                      <span className="inline-flex items-center gap-1">
                        <input autoFocus value={editName.value}
                          onChange={(e) => setEditName({ id: s.id, value: e.target.value })}
                          onKeyDown={(e) => { if (e.key === "Enter") commitName(); if (e.key === "Escape") setEditName(null); }}
                          className="rounded-lg px-2 py-1 text-sm outline-none"
                          style={{ background: t.inputBg, border: "1px solid " + t.primary, color: t.text }} />
                        <button onClick={commitName} style={{ color: t.good }}><Check size={15} /></button>
                        <button onClick={() => setEditName(null)} style={{ color: t.muted }}><X size={15} /></button>
                      </span>
                    ) : (
                      <span className="hover:underline" onClick={() => setEditName({ id: s.id, value: s.name })} title="Click to rename">{s.name}</span>
                    )}
                  </td>

                  {/* Lat / Lng (editable, especially for no-GPS rows) */}
                  <td className={td} onClick={(e) => e.stopPropagation()}>
                    <CoordCell t={t} value={s.lat} placeholder="lat" onCommit={(v) => onUpdate(s.id, { lat: v })} />
                  </td>
                  <td className={td} onClick={(e) => e.stopPropagation()}>
                    <CoordCell t={t} value={s.lng} placeholder="lng" onCommit={(v) => onUpdate(s.id, { lng: v })} />
                  </td>

                  {/* Status */}
                  <td className={td}><StatusPill t={t} status={s.status} /></td>

                  {/* Actions */}
                  <td className={td} onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-end gap-1.5">
                      {needsGps && (
                        <button title="Drop pin on map" onClick={() => onPinRequest(s.id)}
                          className="rounded-lg p-1.5" style={{ border: "1px solid " + t.border, color: t.primary }}>
                          <MapPin size={15} />
                        </button>
                      )}
                      <button title="Delete stop" onClick={() => onDelete(s.id)}
                        className="rounded-lg p-1.5" style={{ border: "1px solid " + t.border, color: t.poor }}>
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** A lat/lng cell that shows the number but becomes a text input on click. */
function CoordCell({ t, value, placeholder, onCommit }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState("");

  const start = () => { setVal(value == null ? "" : String(value)); setEditing(true); };
  const commit = () => {
    const trimmed = val.trim();
    if (trimmed === "") onCommit(null);
    else { const n = Number(trimmed); if (Number.isFinite(n)) onCommit(n); }
    setEditing(false);
  };

  if (editing) {
    return (
      <input autoFocus value={val} placeholder={placeholder}
        onChange={(e) => setVal(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEditing(false); }}
        className="w-24 rounded-lg px-2 py-1 text-sm outline-none tabular-nums"
        style={{ background: t.inputBg, border: "1px solid " + t.primary, color: t.text }} />
    );
  }
  return (
    <span onClick={start} title="Click to edit" className="tabular-nums hover:underline"
      style={{ color: value == null ? t.faint : t.text }}>
      {value == null ? placeholder : num(value)}
    </span>
  );
}
