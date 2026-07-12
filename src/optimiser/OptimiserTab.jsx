/* ============================================================================
 * optimiser/OptimiserTab.jsx — the "Optimiser" dashboard tab.
 * Subtabs:  Stops  |  Fleet & Depot  |  Optimise
 * Stops are grouped into named routes (input zones); the optimiser re-clusters
 * ALL stops onto the cheapest feasible fleet plan and proves it (cost + time).
 * ==========================================================================*/
import React, { useState, useEffect, useMemo, useRef } from "react";
import { Upload, MapPin, Trash2, Plus, RotateCcw, Bus, Route as RouteIcon, Sparkles, AlertTriangle, X, ChevronRight, ArrowUp, Maximize2, Eye, EyeOff, Info, ListFilter, Search } from "lucide-react";
import {
  ResponsiveContainer, BarChart, Bar, Cell, LineChart, Line, AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ReferenceLine,
} from "recharts";
import * as store from "./store.js";
import { optimise, baseline, simulate, metricsFromPlan, effectiveDemand, validatePlan, DEFAULTS } from "./engine.js";
import { roadMatrix, roadRoute, matrixFor } from "./google.js";
import { solveRemote, pingSolver } from "./solverClient.js";
import { parsePhotos } from "./exif.js";
import GMap from "./GMap.jsx";
import NewPlanView from "./NewPlanView.jsx";
import EnlargeableMap from "./EnlargeableMap.jsx";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Card, Btn, Field, TextInput, SelectInput, Tile, Empty, StatusPill, Segmented, makeTooltip, routeColorMap, PALETTE } from "./ui.jsx";

const inr = (n) => "₹" + Math.round(n || 0).toLocaleString("en-IN");

// --- company assignment: a bus belongs to a company ---
// Default ownership seeded from "All vehicles (JUNE).xlsx" (Technotek / Gainup sheets).
// Buses listed on both sheets are assigned to the sheet with the higher June headcount.
const COMPANIES = ["Technotek", "Gainup"];
const BUS_COMPANY_DEFAULTS = {
  "TN57BC3636": "Technotek", "TN57CL3434": "Technotek", "TN57CK3636": "Gainup", "TN57BP3434": "Technotek",
  "TN60AQ3434": "Technotek", "TN57CB3636": "Gainup", "TN57CC3636": "Gainup", "TN58BR3434": "Gainup",
  "TN57BQ3434": "Gainup", "TN58BM3636": "Gainup", "TN58BL3636": "Technotek", "TN57CB3434": "Technotek",
  "TN57CD3434": "Technotek", "TN60AP3434": "Technotek", "TN60AS3434": "Technotek", "TN58BK3636": "Technotek",
  "TN57BS3434": "Technotek", "TN57CF3636": "Technotek", "TN57CJ3636": "Technotek", "TN58BM3434": "Technotek",
  "TN57BQ3636": "Gainup", "TN58BL3434": "Technotek", "TN60AS3636": "Technotek", "TN57CA3636": "Gainup",
  "TN57CF3434": "Technotek", "TN58BS3434": "Gainup", "TN57CH3636": "Technotek", "TN58BP3434": "Technotek",
  "TN57CE3434": "Technotek", "TN54T2368": "Technotek", "TN74AW0645": "Technotek", "TN31AY8208": "Technotek",
  "TN25M4928": "Gainup", "TN31AC0182": "Technotek", "TN39AP2287": "Technotek", "TN39AZ4680": "Technotek",
  "TN49AW5908": "Technotek", "TN57L8446": "Technotek", "TN57P6909": "Technotek", "TN030857": "Technotek",
  "TN31AB3789": "Technotek", "TN46F3361": "Technotek", "TN59AB3444": "Technotek", "TN58BC3494": "Technotek",
  "TN74AY1634": "Gainup", "TN02AB5688": "Technotek", "TN20AL3611": "Technotek", "TN25M4073": "Technotek",
  "TN32AA4015": "Technotek", "TN41T5270": "Technotek", "TN69M1957": "Technotek", "TN32X3929": "Gainup",
  "TN63U4754": "Gainup", "TN20AJ3944": "Technotek", "TN31CD6636": "Technotek", "TN41S5818": "Technotek",
  "TN45AP3948": "Technotek", "TN59AH9703": "Technotek", "TN05V6697": "Technotek", "TN20AK5513": "Technotek",
  "TN23AC2721": "Technotek", "TN42A3533": "Technotek", "TN58S5303": "Technotek", "TN63E9861": "Technotek",
  "TN20AU6396": "Technotek", "TN31J6001": "Technotek", "TN36L5458": "Technotek", "TN40W3708": "Technotek",
  "TN41W8996": "Technotek",
};
const BUSCO_KEY = "opt-bus-company";
const loadBusCo = () => { try { return JSON.parse(localStorage.getItem(BUSCO_KEY) || "{}"); } catch { return {}; } };
const saveBusCo = (m) => { try { localStorage.setItem(BUSCO_KEY, JSON.stringify(m)); } catch {} };
const companyOf = (map, bus) => map[bus] || BUS_COMPANY_DEFAULTS[bus] || "Technotek";
const companyColor = (t, co) => (co === "Gainup" ? t.watch : t.good);
const loadRouteNames = () => { try { return JSON.parse(localStorage.getItem("opt-route-names") || "{}"); } catch { return {}; } };
const inr1 = (n) => "₹" + (n || 0).toLocaleString("en-IN", { maximumFractionDigits: 1 });
const pct = (n) => (n || 0).toFixed(0) + "%";

/* Parse a stops CSV → [{name, lat, lng, village}]. Tolerant: matches columns by
   header keywords (any order), handles quoted fields. Expected headers:
   "Name of Stop", "Latitude", "Longitude", "Name of Village". */
function parseStopsCsv(text) {
  const lines = (text || "").split(/\r?\n/).filter((l) => l.trim().length);
  if (!lines.length) return { rows: [], error: "The file is empty." };
  const parseLine = (line) => {
    const out = []; let cur = "", q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
      else if (c === '"') q = true;
      else if (c === ",") { out.push(cur); cur = ""; }
      else cur += c;
    }
    out.push(cur); return out.map((s) => s.trim());
  };
  const header = parseLine(lines[0]).map((h) => h.toLowerCase());
  const find = (...keys) => { for (const k of keys) { const i = header.findIndex((h) => h.includes(k)); if (i >= 0) return i; } return -1; };
  const iName = find("name of stop", "stop", "name");
  const iLat = find("latitude", "lat");
  const iLng = find("longitude", "lng", "long");
  const iVillage = find("village");
  if (iLat < 0 || iLng < 0) return { rows: [], error: "Couldn't find Latitude / Longitude columns in the header." };
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const c = parseLine(lines[i]);
    rows.push({ name: iName >= 0 ? c[iName] : "", lat: c[iLat], lng: c[iLng], village: iVillage >= 0 ? c[iVillage] : "" });
  }
  return { rows };
}

/* tiny commit-on-blur numeric/text cell for the editable tables */
function Cell2({ t, value, onCommit, type = "text", w = 70, suffix }) {
  return (
    <span className="inline-flex items-center gap-1">
      <input defaultValue={value} type={type} onBlur={(e) => onCommit(e.target.value)}
        className="rounded-lg px-2 py-1 text-sm outline-none" style={{ background: t.inputBg, border: "1px solid " + t.border, color: t.text, width: w }} />
      {suffix && <span className="text-xs" style={{ color: t.muted }}>{suffix}</span>}
    </span>
  );
}

/* ============================ STOPS SUBTAB ============================ */
// straight-line km between two lat/lng (for the "avg distance per person" metric)
function havKm(a, b, c, d) {
  const R = 6371, r = Math.PI / 180, dx = (c - a) * r, dy = (d - b) * r;
  const h = Math.sin(dx / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin(dy / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/* Aesthetic pill search box: leading search icon, focus ring, clear button. */
function SearchInput({ t, value, onChange, placeholder, width = 240 }) {
  const [focus, setFocus] = React.useState(false);
  return (
    <div className="relative" style={{ minWidth: width }}>
      <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: focus ? t.primary : t.muted }} />
      <input value={value} onChange={onChange} placeholder={placeholder}
        onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}
        className="w-full rounded-full pl-9 pr-8 py-2 text-sm outline-none transition-all duration-150"
        style={{ background: t.surface2, border: "1px solid " + (focus ? t.primary : t.border), color: t.text, boxShadow: focus ? `0 0 0 3px ${t.primarySoft}` : "none" }} />
      {value && (
        <button type="button" onClick={() => onChange({ target: { value: "" } })} title="Clear search"
          className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full flex items-center justify-center" style={{ color: t.muted, lineHeight: 0, cursor: "pointer" }}>
          <X size={13} />
        </button>
      )}
    </div>
  );
}

function StopsView({ t, toast, stops, viewStops, routes, refresh }) {
  const colorMap = routeColorMap(routes);
  const [selectedId, setSelectedId] = useState(null);
  const [checked, setChecked] = useState(() => new Set()); // multi-select: ticked stops shown on the map
  const toggleCheck = (id) => setChecked((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const [q, setQ] = useState("");        // search box
  const [page, setPage] = useState(0);
  const [stopVeh, setStopVeh] = useState({});
  const [planDemand, setPlanDemand] = useState(null); // authoritative effective riders from the plan (2,141)
  const PER = 20;
  const dep = store.getDepot();

  // stop-level metrics. "People" = EFFECTIVE daily riders (registered roster scaled to the
  // active rate + absentee/buffer), NOT the raw registered headcount — matches the fleet plan's
  // 2,141 riders. Uses the same calibration as optimize.py; prefers the plan's demand when loaded.
  const JUNE_ALLOTTED = 2360, BUFFER = 0.03;
  const metrics = useMemo(() => {
    let raw = 0, dSum = 0, aSum = 0, hSum = 0;
    for (const s of stops) { const hc = s.headcount || 0; raw += hc; }
    const regToActive = raw ? Math.min(1, JUNE_ALLOTTED / raw) : 1;
    let effective = 0;
    for (const s of stops) {
      const hc = s.headcount || 0;
      const eff = Math.max(hc > 0 ? 1 : 0, Math.round(hc * regToActive * (1 - (s.absentee || 0) + BUFFER)));
      effective += eff; hSum += eff; aSum += (s.absentee || 0) * eff;
      if (s.lat != null && s.lng != null) dSum += havKm(dep.lat, dep.lng, s.lat, s.lng) * eff;
    }
    const people = planDemand ?? effective;
    return {
      totalStops: stops.length, totalPeople: people, rawPeople: raw,
      avgPerStop: stops.length ? people / stops.length : 0,
      avgDist: hSum ? dSum / hSum : 0, avgAbsentee: hSum ? aSum / hSum : 0,
    };
  }, [stops, planDemand]); // eslint-disable-line

  // Per-stop EFFECTIVE daily riders (registered × active-rate × absentee/buffer) — the same
  // calibration the KPIs/fleet plan use, so map dots + cluster totals read ~2,141, not the raw
  // 3,054 registered roster. Keyed by stop id.
  const effHead = useMemo(() => {
    const raw = stops.reduce((a, s) => a + (s.headcount || 0), 0);
    const regToActive = raw ? Math.min(1, JUNE_ALLOTTED / raw) : 1;
    const m = new Map();
    for (const s of stops) {
      const hc = s.headcount || 0;
      m.set(s.id, Math.max(hc > 0 ? 1 : 0, Math.round(hc * regToActive * (1 - (s.absentee || 0) + BUFFER))));
    }
    return m;
  }, [stops]);
  const withEffHead = (arr) => arr.map((s) => ({ ...s, headcount: effHead.get(s.id) ?? s.headcount }));

  // Which vehicle serves each stop, from the solver plan. Match by stop name, else by coords.
  useEffect(() => {
    fetch("/solver_result.json?ts=" + Date.now()).then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (!d || !d.routes) return;
      if (d.params && d.params.demand != null) setPlanDemand(d.params.demand);
      const m = {};
      for (const rt of d.routes) for (const s of (rt.seq || [])) {
        if (s.name) m["n:" + s.name.toLowerCase().trim()] = rt.name;
        if (s.lat != null && s.lng != null) m["c:" + (+s.lat).toFixed(4) + "," + (+s.lng).toFixed(4)] = rt.name;
      }
      setStopVeh(m);
    }).catch(() => {});
  }, []);
  const vehFor = (s) => stopVeh["n:" + (s.name || "").toLowerCase().trim()]
    || (s.lat != null && s.lng != null ? stopVeh["c:" + (+s.lat).toFixed(4) + "," + (+s.lng).toFixed(4)] : "")
    || "";

  // search filter + pagination
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return viewStops;
    return viewStops.filter((x) => (x.name || "").toLowerCase().includes(s)
      || (x.village || "").toLowerCase().includes(s) || (x.route || "").toLowerCase().includes(s));
  }, [viewStops, q]);
  useEffect(() => { setPage(0); }, [q]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PER));
  const pageSafe = Math.min(page, pageCount - 1);
  const paged = filtered.slice(pageSafe * PER, pageSafe * PER + PER);
  const mapStops = withEffHead(checked.size ? viewStops.filter((s) => checked.has(s.id)) : filtered);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Tile t={t} label="Total stops" value={metrics.totalStops} accent={t.primary} />
        <Tile t={t} label="Total people" value={metrics.totalPeople} sub={`${metrics.rawPeople.toLocaleString("en-IN")} registered`} accent={t.techno} />
        <Tile t={t} label="Avg people / stop" value={metrics.avgPerStop.toFixed(1)} accent={t.primary} />
        <Tile t={t} label="Avg distance / person" value={metrics.avgDist.toFixed(1) + " km"} accent={t.good} />
      </div>

      {checked.size > 0 && (
        <div className="flex items-center gap-2 text-xs rounded-xl px-3 py-2" style={{ background: t.primarySoft, color: t.primary, fontWeight: 600 }}>
          Map showing {checked.size} selected stop{checked.size === 1 ? "" : "s"} ({viewStops.filter((s) => checked.has(s.id)).reduce((a, s) => a + (effHead.get(s.id) ?? s.headcount ?? 0), 0)} riders)
          <button type="button" onClick={() => setChecked(new Set())} className="rounded-lg px-2 py-0.5"
            style={{ border: "1px solid " + t.border, background: t.surface, color: t.text, cursor: "pointer" }}>
            Clear — show all
          </button>
        </div>
      )}
      <EnlargeableMap t={t} render={(h, big) => (
        <GMap t={t} stops={mapStops} routeColors={colorMap} depot={dep} selectedId={selectedId} onSelect={setSelectedId} height={h} scrollWheelZoom={big} />
      )} />

      <Card t={t} title="Stops"
        right={
          <div className="flex items-center gap-2">
            <span className="text-xs whitespace-nowrap" style={{ color: t.muted }}>{filtered.length} stop{filtered.length === 1 ? "" : "s"}{q ? " match" : ""}</span>
            <SearchInput t={t} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search stop, village or route…" width={230} />
          </div>
        }>
        <div className="overflow-x-auto">
          <table className="w-full text-sm" style={{ minWidth: 760 }}>
            <thead><tr style={{ color: t.text }}>
              <th className="py-2.5 px-2 text-left" style={{ background: t.primarySoft, borderBottom: "2px solid " + t.border, borderTopLeftRadius: 10 }}>
                <input type="checkbox" title="Select/clear all on this page"
                  checked={paged.length > 0 && paged.every((s) => checked.has(s.id))}
                  onChange={() => setChecked((prev) => { const n = new Set(prev); const all = paged.every((s) => n.has(s.id)); paged.forEach((s) => all ? n.delete(s.id) : n.add(s.id)); return n; })}
                  style={{ accentColor: t.primary, cursor: "pointer", width: 14, height: 14 }} />
              </th>
              {["Stop", "Vehicle", "Village", "Lat", "Lng", "Riders", "Company"].map((h, i, arr) => <th key={i} className="py-2.5 px-2 text-left text-xs font-semibold uppercase tracking-wider" style={{ background: t.primarySoft, borderBottom: "2px solid " + t.border, color: (i === 0 || i === 2) ? t.techno : t.text, borderTopRightRadius: i === arr.length - 1 ? 10 : 0 }}>{h}</th>)}
            </tr></thead>
            <tbody>
              {paged.length === 0 ? <tr><td colSpan={9} className="py-3 px-2" style={{ color: t.muted }}>{stops.length ? "No stops match." : "No stops yet."}</td></tr> :
                paged.map((s) => (
                  <tr key={s.id} onClick={() => setSelectedId(s.id)} style={{ borderBottom: "1px solid " + t.border, background: selectedId === s.id ? t.primarySoft : checked.has(s.id) ? "rgba(99,102,241,0.10)" : s.conf === "red" ? "rgba(239,68,68,0.16)" : "transparent", cursor: "pointer" }} title={s.conf === "red" ? (s.trial ? "Headcount UNKNOWN — randomised (1-6) for the trial run" : "Headcount match confidence LOW — verify") : undefined}>
                    <td className="py-2 px-2" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={checked.has(s.id)} onChange={() => toggleCheck(s.id)}
                        style={{ accentColor: t.primary, cursor: "pointer", width: 14, height: 14 }} />
                    </td>
                    <td className="py-2 px-2">{s.name}</td>
                    <td className="py-2 px-2">{vehFor(s) ? <span className="inline-block rounded-md px-2 py-1 text-xs font-semibold tabular-nums" style={{ background: t.primarySoft, color: t.primary, border: "1px solid " + t.border }}>{vehFor(s)}</span> : <span className="text-xs" style={{ color: t.muted }}>—</span>}</td>
                    <td className="py-2 px-2">{s.village || "—"}</td>
                    <td className="py-2 px-2 tabular-nums" style={{ color: t.muted }}>{s.lat != null ? (+s.lat).toFixed(5) : "—"}</td>
                    <td className="py-2 px-2 tabular-nums" style={{ color: t.muted }}>{s.lng != null ? (+s.lng).toFixed(5) : "—"}</td>
                    <td className="py-2 px-2 tabular-nums">{s.headcount}</td>
                    <td className="py-2 px-2">{s.company || "Gainup"}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        {pageCount > 1 && (
          <div className="mt-4 flex items-center justify-between gap-3 text-sm">
            <span style={{ color: t.muted }}>Showing {pageSafe * PER + 1}–{Math.min(filtered.length, pageSafe * PER + PER)} of {filtered.length}</span>
            <div className="flex items-center gap-2">
              <Btn t={t} variant="ghost" onClick={() => setPage(Math.max(0, pageSafe - 1))} disabled={pageSafe === 0}>Prev</Btn>
              <span style={{ color: t.muted }}>Page {pageSafe + 1} / {pageCount}</span>
              <Btn t={t} variant="ghost" onClick={() => setPage(Math.min(pageCount - 1, pageSafe + 1))} disabled={pageSafe >= pageCount - 1}>Next</Btn>
            </div>
          </div>
        )}
      </Card>
      <BackToTop t={t} />
    </div>
  );
}

/* ============================ FLEET SUBTAB ============================ */
function FleetView({ t, toast, fleet, depot, refresh }) {
  const own = fleet.filter((b) => b.type === "own"), rent = fleet.filter((b) => b.type === "rent");
  const setDepotField = (k, v) => { store.setDepot({ ...depot, [k]: k === "name" ? v : (v === "" ? 0 : +v) }); refresh(); };
  const upd = (id, k, v, num = true) => { store.updateBus(id, { [k]: num ? (+v || 0) : v }); refresh(); };
  return (
    <div className="space-y-4">
      <Card t={t} title="Factory / depot" hint="All routes start and end here. Used as the origin for distance, cost and ride-time.">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field t={t} label="Name"><TextInput t={t} defaultValue={depot.name} onBlur={(e) => setDepotField("name", e.target.value)} /></Field>
          <Field t={t} label="Latitude"><TextInput t={t} type="number" defaultValue={depot.lat} onBlur={(e) => setDepotField("lat", e.target.value)} /></Field>
          <Field t={t} label="Longitude"><TextInput t={t} type="number" defaultValue={depot.lng} onBlur={(e) => setDepotField("lng", e.target.value)} /></Field>
        </div>
      </Card>

      <Card t={t} title="Own buses" hint="Loan/driver/maintenance are fixed (sunk) costs — the optimiser fills these first. Diesel is the only per-km cost." right={<Btn t={t} variant="ghost" onClick={() => { store.addBus("own"); refresh(); }}><Plus size={15} /> Add own bus</Btn>}>
        <div className="overflow-x-auto"><table className="w-full text-sm" style={{ minWidth: 720 }}>
          <thead><tr style={{ color: t.muted }}>{["Name", "Seats", "Loan/mo (₹)", "Driver/day", "Maint/day", "Diesel ₹/km", ""].map((h, i) => <th key={i} className="py-2 px-2 text-left text-xs font-semibold uppercase tracking-wider" style={{ borderBottom: "1px solid " + t.border }}>{h}</th>)}</tr></thead>
          <tbody>{own.map((b) => (
            <tr key={b.id} style={{ borderBottom: "1px solid " + t.border }}>
              <td className="py-2 px-2"><Cell2 t={t} value={b.name} w={90} onCommit={(v) => upd(b.id, "name", v, false)} /></td>
              <td className="py-2 px-2"><Cell2 t={t} value={b.capacity} type="number" w={56} onCommit={(v) => upd(b.id, "capacity", v)} /></td>
              <td className="py-2 px-2"><Cell2 t={t} value={b.loanMonth} type="number" w={84} onCommit={(v) => upd(b.id, "loanMonth", v)} /></td>
              <td className="py-2 px-2"><Cell2 t={t} value={b.driverDay} type="number" w={70} onCommit={(v) => upd(b.id, "driverDay", v)} /></td>
              <td className="py-2 px-2"><Cell2 t={t} value={b.maintDay} type="number" w={70} onCommit={(v) => upd(b.id, "maintDay", v)} /></td>
              <td className="py-2 px-2"><Cell2 t={t} value={b.dieselPerKm} type="number" w={56} onCommit={(v) => upd(b.id, "dieselPerKm", v)} /></td>
              <td className="py-2 px-2"><button onClick={() => { store.removeBus(b.id); refresh(); }} className="rounded-lg p-1.5" style={{ border: "1px solid " + t.border, color: t.muted }}><Trash2 size={14} /></button></td>
            </tr>))}</tbody>
        </table></div>
      </Card>

      <Card t={t} title="Rented buses" hint="Step tariff: a flat slab up to the included km, then a per-km charge beyond. Hired only for demand the own fleet can't cover." right={<Btn t={t} variant="ghost" onClick={() => { store.addBus("rent"); refresh(); }}><Plus size={15} /> Add rented bus</Btn>}>
        <div className="overflow-x-auto"><table className="w-full text-sm" style={{ minWidth: 620 }}>
          <thead><tr style={{ color: t.muted }}>{["Name", "Seats", "Slab ₹/day", "Incl. km", "₹/km beyond", ""].map((h, i) => <th key={i} className="py-2 px-2 text-left text-xs font-semibold uppercase tracking-wider" style={{ borderBottom: "1px solid " + t.border }}>{h}</th>)}</tr></thead>
          <tbody>{rent.map((b) => (
            <tr key={b.id} style={{ borderBottom: "1px solid " + t.border }}>
              <td className="py-2 px-2"><Cell2 t={t} value={b.name} w={90} onCommit={(v) => upd(b.id, "name", v, false)} /></td>
              <td className="py-2 px-2"><Cell2 t={t} value={b.capacity} type="number" w={56} onCommit={(v) => upd(b.id, "capacity", v)} /></td>
              <td className="py-2 px-2"><Cell2 t={t} value={b.slabFixed} type="number" w={84} onCommit={(v) => upd(b.id, "slabFixed", v)} /></td>
              <td className="py-2 px-2"><Cell2 t={t} value={b.slabKm} type="number" w={64} onCommit={(v) => upd(b.id, "slabKm", v)} /></td>
              <td className="py-2 px-2"><Cell2 t={t} value={b.perKmBeyond} type="number" w={64} onCommit={(v) => upd(b.id, "perKmBeyond", v)} /></td>
              <td className="py-2 px-2"><button onClick={() => { store.removeBus(b.id); refresh(); }} className="rounded-lg p-1.5" style={{ border: "1px solid " + t.border, color: t.muted }}><Trash2 size={14} /></button></td>
            </tr>))}</tbody>
        </table></div>
      </Card>
      <BackToTop t={t} />
    </div>
  );
}

/* Themed loading state shown while a solve is in flight — staged messages + a
   spinning ring, a step tracker, and an indeterminate sweep bar. Styled entirely
   from the `t` theme so it sits native next to the other cards. */
function OptimiseLoader({ t }) {
  const steps = [
    "Fetching road distances…",
    "Generating candidate routes…",
    "Packing buses — owned first…",
    "Choosing the cheapest plan…",
  ];
  const [i, setI] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setI((x) => Math.min(x + 1, steps.length - 1)), 1400);
    return () => clearInterval(id);
  }, []);
  return (
    <Card t={t}>
      <div className="flex flex-col items-center justify-center text-center py-12 gap-5">
        <div className="relative" style={{ width: 56, height: 56 }}>
          <div className="absolute inset-0 rounded-full animate-spin"
            style={{ border: `3px solid ${t.border}`, borderTopColor: t.primary }} />
          <div className="absolute inset-0 flex items-center justify-center animate-pulse">
            <Bus size={22} style={{ color: t.primary }} />
          </div>
        </div>
        <div className="text-sm font-semibold" style={{ color: t.text }}>{steps[i]}</div>
        <div className="flex items-center gap-1.5">
          {steps.map((_, k) => (
            <span key={k} className="rounded-full transition-all duration-300" style={{
              width: k === i ? 18 : 6, height: 6,
              background: k <= i ? t.primary : t.border, opacity: k <= i ? 1 : 0.6,
            }} />
          ))}
        </div>
        <div className="w-full rounded-full overflow-hidden" style={{ maxWidth: 280, height: 4, background: t.border }}>
          <div style={{ height: "100%", width: "40%", borderRadius: 999, background: t.primary,
            animation: "opt-sweep 1.2s ease-in-out infinite" }} />
        </div>
        <div className="text-xs" style={{ color: t.muted }}>Crunching the optimiser — this can take a moment.</div>
        <style>{"@keyframes opt-sweep{0%{transform:translateX(-120%)}100%{transform:translateX(330%)}}"}</style>
      </div>
    </Card>
  );
}

/* ============================ OPTIMISE SUBTAB ============================ */
function OptimiseView({ t, stops, zone, fleet, depot, toast }) {
  const TT = makeTooltip(t);
  const [v, setV] = useState({ loading: true });
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setV({ loading: true });
      // attach _idx so the engine can look up the real road matrix; depot is node 0
      const filtered = stops.filter((s) => s.lat != null && s.lng != null).map((s, i) => ({ ...s, _idx: i + 1 }));
      const depotN = { ...depot, _idx: 0 };
      const nodes = [depotN, ...filtered];
      let metric = null, usingGoogle = false, M = null;
      try { M = await roadMatrix(nodes); metric = { km: (i, j) => M.km[i][j], min: (i, j) => M.min[i][j] }; usingGoogle = true; }
      catch { metric = null; usingGoogle = false; } // distances fall back to estimate if a call hiccups

      const heuristic = optimise(filtered, fleet, depotN, { metric });
      const base = baseline(filtered, fleet, depotN, { metric });

      // Option B — try the OR-Tools backend. The browser already has the road matrix,
      // so we POST it and score the returned decision through engine.scorePlan (same
      // code that renders the heuristic). Falls back to the heuristic if the backend
      // is offline or reports infeasible.
      const demand = [0, ...filtered.map((s) => effectiveDemand(s))];
      // Quick health check first (~1.5s) so we don't sit on the loader for 22s waiting
      // out a backend that isn't running — only POST the solve if it actually answered.
      const backendUp = await pingSolver(1500);
      const remote = backendUp
        ? await solveRemote({ nodes, demand, fleet, matrix: M, params: { solverTimeLimitS: 10 } })
        : { ok: false, reason: "offline" };
      const useRemote = !!(remote && remote.ok);
      const result = useRemote ? remote : heuristic;
      const source = useRemote ? "ortools" : (remote && remote.reason === "offline" ? "offline" : "fallback");
      const compare = remote && remote.ok && heuristic.ok
        ? { ortools: remote.kpis.costPerHeadDay, heuristic: heuristic.kpis.costPerHeadDay, solverTimeS: remote.meta && remote.meta.solverTimeS }
        : null;

      const rc = (i) => PALETTE[i % PALETTE.length];
      let polylines = [];
      if (result.ok) {
        polylines = await Promise.all(result.plan.routes.map(async (r, i) => {
          const seq = [depotN, ...r.stops, depotN];
          if (usingGoogle) { try { const pts = await roadRoute(seq); return { color: rc(i), points: pts }; } catch { /* fall through */ } }
          return { color: rc(i), points: seq.map((s) => [s.lat, s.lng]) };
        }));
      }
      let optRef = null, series = [];
      if (result.ok) {
        optRef = metricsFromPlan(result.plan); // today's optimised breakdown (flat reference)
        const today = new Date();
        const dates = [];
        for (let i = 89; i >= 0; i--) { const d = new Date(today); d.setDate(d.getDate() - i); dates.push(d.toISOString().slice(0, 10)); }
        series = simulate(filtered, fleet, depotN, { metric }, dates, result.plan); // 90-day simulated history
      }
      if (!cancelled) setV({ loading: false, result, base, polylines, usingGoogle, optRef, series, source, compare });
    })();
    return () => { cancelled = true; };
  }, [stops, fleet, depot]);

  const [range, setRange] = useState({ from: "", to: "" });
  const [costMode, setCostMode] = useState("combined");
  const [rideMode, setRideMode] = useState("combined");
  const [selBuses, setSelBuses] = useState([]); // route indices selected for the map + detail
  const [collapsed, setCollapsed] = useState({});

  if (v.loading) return <OptimiseLoader t={t} />;
  if (!v.result.ok) return <Empty t={t} title="Can't optimise yet" sub={v.result.reason} />;

  const { result, base, polylines, usingGoogle, optRef, series, source, compare } = v;
  const { kpis, plan } = result;

  // ---- model integrity: invariant checks (#2) + visible inputs (#1) ----
  const sanity = validatePlan(result, stops, fleet, depot, result.params);
  const sanityOk = sanity.every((c) => c.ok);
  const pp = result.params || DEFAULTS;
  const ownLoanTotal = fleet.filter((b) => b.type === "own").reduce((s, b) => s + (+b.loanMonth || 0), 0);
  const nStops = plan.routes.reduce((n, r) => n + r.stops.length, 0);
  const modelInputs = [
    ["Zone", zone === "All" ? `all stops (${stops.length})` : `${zone} · ${stops.length} stops`],
    ["Riders", `${kpis.heads} from ${nStops} stops`],
    ["Demand formula", `ceil(head × (1 − absentee + ${pp.absenteeBuffer}))`],
    ["Road data", usingGoogle ? "Google Maps roads" : "⚠ straight-line estimate"],
    ["Dwell / stop", `${pp.serviceMin} min`],
    ["Fallback speed", `${pp.speedKmph} km/h`],
    ["Capacity leniency", `+${pp.capacityBuffer} over seats`],
    ["Ride colours", `<${pp.softCapMin} green · ${pp.softCapMin}–${pp.redCapMin} yellow · ≥${pp.redCapMin} red (min)`],
    ["Working days", `${pp.workingDays}/mo`],
    ["Owned loans", ownLoanTotal ? `pooled · ₹${ownLoanTotal.toLocaleString("en-IN")}/mo total` : "paid-off (₹0)"],
  ];
  const routeColor = (i) => PALETTE[i % PALETTE.length];

  const baseCph = base ? base.costPerHeadDay : null;
  const saving = baseCph != null ? baseCph - kpis.costPerHeadDay : 0;
  const savingPct = baseCph ? (saving / baseCph) * 100 : 0;

  // ---- proof time-series, filtered to the calendar window (default last 30 days) ----
  const allDates = (series || []).map((s) => s.date);
  const from = range.from || allDates[Math.max(0, allDates.length - 30)] || "";
  const to = range.to || allDates[allDates.length - 1] || "";
  const win = (series || []).filter((s) => s.date >= from && s.date <= to);
  const COMPANIES = ["Gainup", "Technotek"];
  const costData = win.map((s) => ({ date: s.date.slice(5), Unoptimised: s.baseline ? s.baseline.cph[costMode] : null, Optimised: optRef ? optRef.cph[costMode] : null }));
  const saveData = win.map((s) => ({ date: s.date.slice(5), Saved: s.baseline && optRef ? Math.max(0, s.baseline.cph.combined - optRef.cph.combined) : null }));
  let rideData = [], rideSeries = [];
  if (rideMode === "combined") {
    rideData = win.map((s) => ({ date: s.date.slice(5), Ride: s.optimised ? s.optimised.rideCombined : null }));
    rideSeries = [{ key: "Ride", color: t.primary, name: "Time to last stop" }];
  } else if (rideMode === "company") {
    rideData = win.map((s) => { const row = { date: s.date.slice(5) }; COMPANIES.forEach((c) => (row[c] = s.optimised ? (s.optimised.rideByCompany[c] || null) : null)); return row; });
    rideSeries = COMPANIES.map((c) => ({ key: c, color: c === "Gainup" ? t.gainup : t.techno, name: c }));
  } else {
    const busNames = optRef ? optRef.byBus.map((b) => b.name) : [];
    rideData = win.map((s) => { const row = { date: s.date.slice(5) }; const mp = {}; (s.optimised ? s.optimised.byBus : []).forEach((b) => (mp[b.name] = b.ride)); busNames.forEach((n) => (row[n] = mp[n] != null ? mp[n] : null)); return row; });
    rideSeries = busNames.map((n, i) => ({ key: n, color: PALETTE[i % PALETTE.length], name: n }));
  }

  // ---- route selection / map filter / shareable Google Maps links ----
  const hc = (h) => (h === "good" ? t.good : h === "watch" ? t.watch : t.poor);
  // colour purely by time-to-last-stop: green < 45, yellow 45–60, red ≥ 60 (all soft — nothing blocks)
  const routeHealth = (r) => (r.toLastMin >= 60 ? "poor" : r.toLastMin >= 45 ? "watch" : "good");
  const toggleSel = (i) => setSelBuses((cur) => (cur.includes(i) ? cur.filter((x) => x !== i) : [...cur, i]));
  const mapsLink = (r) => { const o = `${depot.lat},${depot.lng}`; const wp = r.stops.map((s) => `${s.lat},${s.lng}`).join("|"); return `https://www.google.com/maps/dir/?api=1&origin=${o}&destination=${o}&waypoints=${encodeURIComponent(wp)}&travelmode=driving`; };
  const shownPoly = selBuses.length ? polylines.filter((_, i) => selBuses.includes(i)) : polylines;
  // number map markers in PICKUP order (route sequence) so 1 = first pickup (closest), 2 = next, …
  const shownStops = selBuses.length ? selBuses.flatMap((i) => plan.routes[i].stops) : plan.routes.flatMap((r) => r.stops);

  // ---- spare fleet: buses the optimised plan doesn't need ----
  const deployedIds = new Set(plan.routes.map((r) => r.bus.id));
  const idleBuses = fleet.filter((b) => !deployedIds.has(b.id));
  const idleRent = idleBuses.filter((b) => b.type === "rent");
  const idleOwn = idleBuses.filter((b) => b.type === "own");
  const rentalSavingDay = idleRent.reduce((s, b) => s + (+b.slabFixed || 0), 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Tile t={t} label="Cost / head / day" value={inr1(kpis.costPerHeadDay)} sub={inr(kpis.costPerHeadMonth) + " / month"} accent={t.good} />
        <Tile t={t} label="Buses deployed" value={kpis.buses} sub={`${kpis.ownDeployed} own · ${kpis.rentDeployed} rented`} accent={t.primary} />
        <Tile t={t} label="Utilisation" value={pct(kpis.utilisation)} sub={`${kpis.heads} riders seated`} accent={t.watch} />
        <Tile t={t} label="Max time to last stop" value={Math.round(kpis.maxRide) + " min"} sub={kpis.routesOverSoft ? `${kpis.routesOverSoft} over 45-min soft target` : "all within 45-min target"} accent={kpis.maxRide >= 60 ? t.poor : kpis.maxRide >= 45 ? t.watch : t.good} />
      </div>

      <div className="text-xs px-1" style={{ color: usingGoogle ? t.good : t.watch }}>
        {usingGoogle ? "● Distances & routes from Google Maps roads." : "● Google road data didn't respond this run — distances estimated; reopen the tab to retry."}
      </div>
      <div className="text-xs px-1" style={{ color: source === "ortools" ? t.good : t.watch }}>
        {source === "ortools"
          ? `● Solver: Google OR-Tools — exact VRP (joint stop-assignment + routing)${compare && compare.solverTimeS != null ? ` · solved in ${compare.solverTimeS}s` : ""}.`
          : source === "offline"
            ? "● Solver: in-browser heuristic — OR-Tools backend offline (run run-solver.ps1 for the exact solver)."
            : "● Solver: in-browser heuristic — OR-Tools backend returned no plan this run."}
      </div>

      {compare && (() => {
        const diff = compare.heuristic - compare.ortools, pc = compare.heuristic ? (diff / compare.heuristic) * 100 : 0;
        const tie = Math.abs(diff) < 0.005;
        return (
          <Card t={t}>
            <div className="flex flex-wrap items-center gap-4">
              <RouteIcon size={20} style={{ color: t.primary }} />
              <div className="text-sm" style={{ color: t.text }}>
                <b style={{ color: t.good }}>OR-Tools {inr1(compare.ortools)}/head</b> vs in-browser heuristic <b style={{ color: t.faint }}>{inr1(compare.heuristic)}/head</b> —
                {tie ? <span> identical on this data — the heuristic is already at the cost-curve minimum (the 7-bus floor dominates).</span>
                  : diff > 0 ? <b style={{ color: t.good }}> OR-Tools is {inr1(diff)}/head ({pc.toFixed(1)}%) cheaper.</b>
                  : <span style={{ color: t.muted }}> the heuristic edged it by {inr1(-diff)}/head this run — both are at the 7-bus floor, so they're effectively tied.</span>}
              </div>
            </div>
          </Card>
        );
      })()}

      {base && (
        <Card t={t}>
          <div className="flex flex-wrap items-center gap-4">
            <Sparkles size={20} style={{ color: t.good }} />
            <div className="text-sm" style={{ color: t.text }}>
              Optimised plan costs <b style={{ color: t.good }}>{inr1(kpis.costPerHeadDay)}/head/day</b> vs a no-consolidation baseline (a dedicated bus per stop) of <b style={{ color: t.faint }}>{inr1(baseCph)}</b> —
              <b style={{ color: t.good }}> {savingPct.toFixed(0)}% cheaper</b> ({inr(saving * kpis.heads)}/day saved across {kpis.heads} riders).
            </div>
          </div>
        </Card>
      )}

      <Card t={t} title="Model integrity" hint="Automatic checks that the plan obeys the non-negotiables. All green = the numbers are internally consistent. Any red = don't trust the result (usually a wrong input, not the math).">
        <div className="flex flex-wrap gap-2">
          {sanity.map((c, i) => (
            <span key={i} title={c.detail} className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium"
              style={{ background: c.ok ? t.goodSoft : t.poorSoft, color: c.ok ? t.good : t.poor, border: "1px solid " + (c.ok ? t.good : t.poor) }}>
              {c.ok ? "✓" : "⚠"} {c.label}
            </span>
          ))}
        </div>
        <div className="text-xs mt-2" style={{ color: sanityOk ? t.muted : t.poor }}>
          {sanityOk ? "All checks pass — the plan is internally consistent." : sanity.filter((c) => !c.ok).map((c) => `⚠ ${c.label}: ${c.detail}`).join(" · ")}
        </div>
      </Card>

      <Card t={t} title="Model inputs — sanity-check these" hint="Every number above is driven by these. If a result looks wrong, check here first — most surprises are a wrong input (e.g. a placeholder rider count or loan), not the math.">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-3">
          {modelInputs.map(([k, val], i) => (
            <div key={i}>
              <div className="text-xs uppercase tracking-wider" style={{ color: t.muted }}>{k}</div>
              <div className="text-sm tabular-nums" style={{ color: t.text }}>{val}</div>
            </div>
          ))}
        </div>
      </Card>

      <Card t={t} title="Optimised bus routes" hint="Click a bus to isolate its route on the map (multi-select to compare); click again to deselect. Selected routes show stats + a shareable Google Maps link below.">
        <GMap t={t} stops={shownStops} routeColors={{}} depot={depot} polylines={shownPoly} height={420} />

        {[["own", "Own buses"], ["rent", "Rented buses"]].map(([type, label]) => {
          const list = plan.routes.map((r, i) => ({ r, i })).filter((x) => x.r.bus.type === type);
          if (!list.length) return null;
          const counts = { good: 0, watch: 0, poor: 0 }; list.forEach((x) => counts[routeHealth(x.r)]++);
          const avgUtil = list.reduce((s, x) => s + x.r.util, 0) / list.length;
          const isCol = !!collapsed[type];
          const accent = type === "own" ? t.primary : t.watch;
          return (
            <div key={type} className="mt-3 rounded-2xl border overflow-hidden" style={{ background: t.surface, borderColor: t.border }}>
              <button onClick={() => setCollapsed({ ...collapsed, [type]: !isCol })} className="w-full flex items-center gap-2.5 px-4 py-3 text-left" style={{ background: t.surface2 }}>
                <ChevronRight size={16} style={{ color: accent, transform: isCol ? "none" : "rotate(90deg)", transition: "transform .15s" }} />
                <span className="w-2.5 h-2.5 rounded-sm" style={{ background: accent }} />
                <span className="font-bold tracking-tight" style={{ color: t.text }}>{label}</span>
                <span className="text-xs" style={{ color: t.muted }}>{list.length} buses</span>
                <span className="ml-auto flex items-center gap-3 text-xs tabular-nums">
                  <span style={{ color: t.good }}>{counts.good} Good</span>
                  <span style={{ color: t.watch }}>{counts.watch} Watch</span>
                  <span style={{ color: t.poor }}>{counts.poor} Poor</span>
                  <span style={{ color: t.muted }}>· {pct(avgUtil)} util</span>
                </span>
              </button>
              {!isCol && (
                <div className="p-3" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: 8 }}>
                  {list.map(({ r, i }) => { const col = hc(routeHealth(r)); const on = selBuses.includes(i);
                    return (
                      <button key={i} onClick={() => toggleSel(i)} className="relative text-left rounded-xl p-2.5" style={{ background: t.surface2, border: "1.5px solid " + col, boxShadow: on ? `0 0 0 2px ${t.primary}` : "none" }}>
                        <span className="absolute rounded-full" style={{ right: 8, top: 8, width: 8, height: 8, background: col }} />
                        <div className="text-xs font-semibold truncate" style={{ color: t.text, maxWidth: "84%" }}>{r.bus.name}</div>
                        <div className="text-xl font-bold tabular-nums mt-1" style={{ color: t.text }}>{pct(r.util)}</div>
                        <div className="text-xs" style={{ color: t.muted }}>util</div>
                        <div className="text-xs tabular-nums mt-1.5" style={{ color: t.muted }}><b style={{ color: t.text }}>{inr1(r.heads ? r.cost / r.heads : 0)}</b>/head</div>
                        <div className="text-xs tabular-nums" style={{ color: t.muted }}><b style={{ color: t.text }}>{r.stops.length}</b> stops</div>
                      </button>
                    ); })}
                </div>
              )}
            </div>
          );
        })}

        {selBuses.length === 0 ? (
          <p className="text-xs mt-3" style={{ color: t.muted }}>Tile border + dot = health (utilisation &amp; ride vs SLA). Click buses to isolate them on the map and reveal route details + a shareable link.</p>
        ) : (
          <div className="space-y-2 mt-3">
            {selBuses.map((i) => { const r = plan.routes[i];
              return (
                <div key={i} className="rounded-2xl border p-4" style={{ background: t.surface2, borderColor: t.primary }}>
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <div className="font-semibold flex items-center gap-2" style={{ color: t.text }}>
                      <span className="w-3 h-3 rounded-sm" style={{ background: routeColor(i) }} />{r.bus.name}
                      <span className="text-xs rounded-full px-2 py-0.5" style={{ background: r.bus.type === "own" ? t.primarySoft : t.watchSoft, color: r.bus.type === "own" ? t.primary : t.watch }}>{r.bus.type}</span>
                    </div>
                    <button onClick={() => toggleSel(i)} className="rounded-lg p-1.5" style={{ border: "1px solid " + t.border, color: t.muted }}><X size={14} /></button>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-3">
                    <div><div className="text-xs uppercase tracking-wider" style={{ color: t.muted }}>To last stop</div><div className="text-lg font-bold tabular-nums" style={{ color: r.toLastMin > 60 ? t.poor : r.toLastMin > 45 ? t.watch : t.good }}>{Math.round(r.toLastMin)} min</div><div className="text-xs tabular-nums" style={{ color: t.muted }}>{(r.kmToLast ?? 0).toFixed(1)} km · the SLA limit</div></div>
                    <div><div className="text-xs uppercase tracking-wider" style={{ color: t.muted }}>Whole trip</div><div className="text-lg font-bold tabular-nums" style={{ color: t.text }}>{Math.round(r.totalMin)} min</div><div className="text-xs tabular-nums" style={{ color: t.muted }}>{r.km.toFixed(1)} km · incl. return</div></div>
                    <div><div className="text-xs uppercase tracking-wider" style={{ color: t.muted }}>Cost / head</div><div className="text-lg font-bold tabular-nums" style={{ color: t.text }}>{inr1(r.heads ? r.cost / r.heads : 0)}</div></div>
                    <div><div className="text-xs uppercase tracking-wider" style={{ color: t.muted }}>Stops</div><div className="text-lg font-bold tabular-nums" style={{ color: t.text }}>{r.stops.length}</div></div>
                    <div><div className="text-xs uppercase tracking-wider" style={{ color: t.muted }}>Utilisation</div><div className="text-lg font-bold tabular-nums" style={{ color: t.text }}>{pct(r.util)}</div></div>
                  </div>
                  <div className="text-xs mb-3" style={{ color: t.muted }}>
                    <span style={{ color: t.text }}>★ {depot.name}</span>
                    {r.stops.map((s, j) => <span key={j}> → {s.name}</span>)}
                    <span style={{ color: t.text }}> → ★</span>
                    <span className="ml-2">· Load {r.heads}/{r.bus.capacity} ({pct(r.util)})</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <a href={mapsLink(r)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-xl font-semibold px-4 py-2.5 text-sm" style={{ background: t.primary, color: t.onPrimary || "#fff" }}><MapPin size={15} /> Open in Google Maps</a>
                    <Btn t={t} variant="ghost" onClick={() => { try { navigator.clipboard.writeText(mapsLink(r)); toast && toast("Route link copied"); } catch { toast && toast("Copy failed"); } }}>Copy link</Btn>
                  </div>
                </div>
              ); })}
          </div>
        )}
      </Card>

      <Card t={t} title="Buses you can cut" hint={`The optimised plan needs only ${kpis.buses} of your ${fleet.length} buses — the rest sit idle.`}>
        {idleBuses.length === 0 ? (
          <div className="text-sm" style={{ color: t.muted }}>Every bus in the fleet is deployed — nothing to cut.</div>
        ) : (
          <>
            {idleRent.length > 0 && (
              <div className="rounded-2xl border p-4 mb-3 flex flex-wrap items-center gap-3" style={{ background: t.goodSoft, borderColor: t.good }}>
                <Sparkles size={18} style={{ color: t.good }} />
                <div className="text-sm" style={{ color: t.text }}>Don't hire <b style={{ color: t.good }}>{idleRent.length} rented bus{idleRent.length > 1 ? "es" : ""}</b> → save <b style={{ color: t.good }}>{inr(rentalSavingDay)}/day</b> ({inr(rentalSavingDay * DEFAULTS.workingDays)}/month).</div>
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {idleBuses.map((b) => (
                <div key={b.id} className="flex items-center justify-between gap-2 rounded-xl p-3" style={{ background: t.surface2, border: "1px solid " + t.border }}>
                  <div className="min-w-0">
                    <div className="font-semibold flex items-center gap-2" style={{ color: t.text }}>{b.name}
                      <span className="text-xs rounded-full px-2 py-0.5" style={{ background: b.type === "own" ? t.primarySoft : t.watchSoft, color: b.type === "own" ? t.primary : t.watch }}>{b.type}</span>
                    </div>
                    <div className="text-xs mt-0.5" style={{ color: t.muted }}>{b.capacity} seats · {b.type === "rent" ? `skip hiring → ${inr(+b.slabFixed || 0)}/day saved` : `owned but unused → ${inr(Math.round((+b.loanMonth || 0) / DEFAULTS.workingDays))}/day committed cost idle`}</div>
                  </div>
                  <span className="text-xs font-semibold uppercase tracking-wider shrink-0" style={{ color: b.type === "rent" ? t.good : t.watch }}>{b.type === "rent" ? "cut" : "idle"}</span>
                </div>
              ))}
            </div>
            {idleOwn.length > 0 && <p className="text-xs mt-3" style={{ color: t.muted }}>Owned buses can't be "saved" by cutting (their loan is already paid), but an idle owned bus is wasted committed cost — redeploy it or consider selling.</p>}
          </>
        )}
      </Card>

      {/* ---- PROOF (time-series, scrubbed by the calendar) ---- */}
      <Card t={t} title="Proof — across time" hint="Simulated day-by-day history: demand (absentees) and traffic vary each day. Set a date range to scrub the window; default is the last 30 days." right={
        <div className="flex flex-wrap items-end gap-2">
          <Field t={t} label="From"><TextInput t={t} type="date" value={from} onChange={(e) => setRange({ ...range, from: e.target.value })} /></Field>
          <Field t={t} label="To"><TextInput t={t} type="date" value={to} onChange={(e) => setRange({ ...range, to: e.target.value })} /></Field>
          {(range.from || range.to) && <button onClick={() => setRange({ from: "", to: "" })} className="text-xs rounded-lg px-3 py-2.5" style={{ border: "1px solid " + t.border, color: t.muted }}>Last 30d</button>}
        </div>
      }>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div>
            <div className="flex items-center justify-between mb-1">
              <div className="text-sm font-semibold" style={{ color: t.text }}>Cost / head over time</div>
              <div style={{ width: 130 }}><SelectInput t={t} value={costMode} onChange={(e) => setCostMode(e.target.value)}><option value="combined">Combined</option><option value="own">Owned</option><option value="rent">Rented</option></SelectInput></div>
            </div>
            <div className="text-xs mb-2" style={{ color: t.muted }}>Grey = un-optimised daily reality · green dashed = today's optimised plan.</div>
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={costData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={t.grid} vertical={false} />
                <XAxis dataKey="date" tick={{ fill: t.muted, fontSize: 10 }} tickLine={false} axisLine={{ stroke: t.border }} interval="preserveStartEnd" minTickGap={28} />
                <YAxis tick={{ fill: t.muted, fontSize: 11 }} tickLine={false} axisLine={false} width={48} />
                <Tooltip content={TT} />
                <Line type="monotone" dataKey="Unoptimised" name="Un-optimised" stroke={t.faint} strokeWidth={2} dot={false} connectNulls />
                <Line type="monotone" dataKey="Optimised" name="Optimised (today)" stroke={t.good} strokeWidth={2.5} strokeDasharray="5 4" dot={false} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div>
            <div className="text-sm font-semibold mb-1" style={{ color: t.text }}>Cost saved over time</div>
            <div className="text-xs mb-2" style={{ color: t.muted }}>₹/head saved each day by optimising vs the un-optimised baseline.</div>
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={saveData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={t.grid} vertical={false} />
                <XAxis dataKey="date" tick={{ fill: t.muted, fontSize: 10 }} tickLine={false} axisLine={{ stroke: t.border }} interval="preserveStartEnd" minTickGap={28} />
                <YAxis tick={{ fill: t.muted, fontSize: 11 }} tickLine={false} axisLine={false} width={48} />
                <Tooltip content={TT} />
                <Area type="monotone" dataKey="Saved" name="₹/head saved" stroke={t.good} fill={t.good} fillOpacity={0.18} strokeWidth={2} connectNulls />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          <div className="lg:col-span-2">
            <div className="flex items-center justify-between mb-1">
              <div className="text-sm font-semibold" style={{ color: t.text }}>Time to last stop over time</div>
              <div style={{ width: 150 }}><SelectInput t={t} value={rideMode} onChange={(e) => setRideMode(e.target.value)}><option value="combined">Combined</option><option value="company">By company</option><option value="bus">By bus</option></SelectInput></div>
            </div>
            <div className="text-xs mb-2" style={{ color: t.muted }}>Time from leaving the factory to the last pickup on the optimised plan as daily traffic varies. Both lines are soft: under 45 = green, 45–60 = yellow, over 60 = red. No stop is ever dropped.</div>
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={rideData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={t.grid} vertical={false} />
                <XAxis dataKey="date" tick={{ fill: t.muted, fontSize: 10 }} tickLine={false} axisLine={{ stroke: t.border }} interval="preserveStartEnd" minTickGap={28} />
                <YAxis tick={{ fill: t.muted, fontSize: 11 }} tickLine={false} axisLine={false} width={48} domain={[0, 70]} />
                <Tooltip content={TT} />{rideSeries.length > 1 && <Legend wrapperStyle={{ fontSize: 11, color: t.muted }} />}
                <ReferenceLine y={45} stroke={t.watch} strokeDasharray="4 4" label={{ value: "soft 45", fill: t.watch, fontSize: 10, position: "right" }} />
                <ReferenceLine y={60} stroke={t.poor} strokeDasharray="4 4" label={{ value: "red 60", fill: t.poor, fontSize: 10, position: "right" }} />
                {rideSeries.map((s) => <Line key={s.key} type="monotone" dataKey={s.key} name={s.name} stroke={s.color} strokeWidth={2} dot={false} connectNulls />)}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </Card>
    </div>
  );
}

/* ============================ TAB SHELL ============================ */
/* ===================== FLEET PLAN SUBTAB — offline OR-Tools solver result ===================== */
/* Floating back-to-top button for the long Stops / Fleet plan lists. */
function BackToTop({ t }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const on = () => setShow(window.scrollY > 500);
    window.addEventListener("scroll", on, { passive: true }); on();
    return () => window.removeEventListener("scroll", on);
  }, []);
  if (!show) return null;
  return (
    <button type="button" title="Back to top"
      onClick={() => { const y0 = window.scrollY; window.scrollTo({ top: 0, behavior: "smooth" });
        setTimeout(() => { if (window.scrollY >= y0 - 50) window.scrollTo(0, 0); }, 350); }}
      className="fixed bottom-6 right-6 z-50 rounded-full shadow-xl flex items-center justify-center transition-transform hover:-translate-y-0.5"
      style={{ width: 46, height: 46, background: t.primary, color: t.onPrimary || "#fff", border: "none", cursor: "pointer" }}>
      <ArrowUp size={20} />
    </button>
  );
}

/* In-app mini map for ONE route (evening drop): factory -> s1 -> ... -> parking
 * stop, drawn as clickable segments. Header shows the whole-route km/time; click
 * a segment to see that leg's road distance/time (from the offline matrix — no
 * Google billing, and no 9-waypoint limit like the Maps link). */
/* ---- shared Leaflet map bits (keyless OSM tiles, no Google key needed) ------- */
const OSM_URL = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const OSM_ATTR = "© OpenStreetMap";
const FIRST_STOP_COLOR = "#10b981"; // emerald — the route's first stop
const LAST_STOP_COLOR = "#ef4444";  // red — the route's last stop (parks overnight)
/* A small coloured disc with a white number/label — the stop-headcount dot. */
function dotIcon(color, label, { size = 22, fontSize = 11 } = {}) {
  return L.divIcon({
    className: "route-dot",
    html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;color:#fff;font:700 ${fontSize}px/1 Inter,system-ui,sans-serif">${label}</div>`,
    iconSize: [size, size], iconAnchor: [size / 2, size / 2],
  });
}
/* The depot marker — a dark disc with an "F". */
function factoryIcon() {
  const size = 30;
  return L.divIcon({
    className: "factory-dot",
    html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:#0f172a;border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;color:#fff;font:800 13px/1 Inter,system-ui,sans-serif">F</div>`,
    iconSize: [size, size], iconAnchor: [size / 2, size / 2],
  });
}

function RouteMap({ t, depot, route }) {
  const elRef = useRef(null);
  const mapRef = useRef(null);
  const segRef = useRef([]);            // polylines, restyled on selection
  const [legs, setLegs] = useState(null); // [{km,min}] per segment (0 = factory->s1)
  const [sel, setSel] = useState(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const pts = [{ lat: depot[0], lng: depot[1] }, ...route.seq.map((s) => ({ lat: s.lat, lng: s.lng }))];
        const M = await matrixFor(pts);
        const legDist = pts.slice(0, -1).map((_, i) => ({ km: M.km[i][i + 1], min: M.min[i][i + 1] }));
        // ROAD-FOLLOWING geometry for the drawn line (free OSRM router — keyless,
        // no waypoint cap). km/min stay from OUR cached road matrix; OSRM only
        // supplies the polyline shape. Falls back to straight connectors offline.
        let legPaths = pts.slice(0, -1).map((p, i) => [[pts[i].lat, pts[i].lng], [pts[i + 1].lat, pts[i + 1].lng]]);
        try {
          const coords = pts.map((p) => p.lng + "," + p.lat).join(";");
          const res = await fetch(`https://router.project-osrm.org/route/v1/driving/${coords}?overview=false&geometries=geojson&steps=true`);
          const j = await res.json();
          if (j.code === "Ok" && j.routes && j.routes[0].legs.length === pts.length - 1) {
            legPaths = j.routes[0].legs.map((leg, i) => {
              const cs = [];
              (leg.steps || []).forEach((st) => (st.geometry?.coordinates || []).forEach((c) => cs.push([c[1], c[0]])));
              return cs.length > 1 ? cs : [[pts[i].lat, pts[i].lng], [pts[i + 1].lat, pts[i + 1].lng]];
            });
          }
        } catch { /* offline / OSRM down -> straight-line fallback */ }
        if (cancelled || !elRef.current) return;
        const map = L.map(elRef.current, { zoomControl: true, scrollWheelZoom: false });
        L.tileLayer(OSM_URL, { attribution: OSM_ATTR, maxZoom: 19 }).addTo(map);
        mapRef.current = map;
        const primary = t.primary || "#6366f1";
        L.marker([pts[0].lat, pts[0].lng], { icon: factoryIcon(), zIndexOffset: 1000 })
          .bindTooltip("Factory", { direction: "top", offset: [0, -16] }).addTo(map);
        route.seq.forEach((s, i) => {
          const first = i === 0, last = i === route.seq.length - 1;
          const dotColor = last ? LAST_STOP_COLOR : first ? FIRST_STOP_COLOR : primary;
          // circle shows the stop's EFFECTIVE riders (matches the RIDERS column); drop order is in the tooltip/chips
          L.marker([s.lat, s.lng], { icon: dotIcon(dotColor, String(s.eff ?? s.hc ?? i + 1), { size: (first || last) ? 26 : 22 }) })
            .bindTooltip((i + 1) + ". " + s.name + (s.eff != null ? " — " + s.eff + " riders" : "") + (first ? " (first stop)" : last ? " (last stop · parks overnight)" : ""), { direction: "top", offset: [0, -14] })
            .addTo(map);
        });
        segRef.current = legPaths.map((path, i) => {
          const line = L.polyline(path, { color: primary, weight: 5, opacity: 0.7 }).addTo(map);
          line.on("click", () => setSel((cur) => (cur === i ? null : i)));
          return line;
        });
        const all = [];
        legPaths.forEach((p) => p.forEach((q) => all.push(q)));
        pts.forEach((p) => all.push([p.lat, p.lng]));
        map.fitBounds(L.latLngBounds(all), { padding: [34, 34] });
        setTimeout(() => map.invalidateSize(), 0);
        setLegs(legDist);
      } catch { setErr(true); }
    })();
    return () => { cancelled = true; if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; } };
    // eslint-disable-next-line
  }, []);
  useEffect(() => {   // highlight the selected segment
    segRef.current.forEach((line, i) => line.setStyle(
      sel == null ? { opacity: 0.7, weight: 5, color: t.primary || "#6366f1" }
                  : i === sel ? { opacity: 1, weight: 7, color: "#f59e0b" }
                              : { opacity: 0.35, weight: 4, color: t.primary || "#6366f1" }));
  }, [sel, t]);
  if (err) return null;
  const r1 = (x) => Math.round(x * 10) / 10;
  const segFrom = sel == null ? "" : sel === 0 ? "Factory" : sel + ". " + route.seq[sel - 1].name;
  const segTo   = sel == null ? "" : (sel + 1) + ". " + route.seq[sel].name;
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 text-xs mb-1.5 rounded-xl px-3 py-2"
        style={{ background: sel == null ? t.primarySoft : "rgba(245,158,11,0.15)", color: sel == null ? t.primary : "#b45309", fontWeight: 600 }}>
        {sel == null
          ? <>Evening drop route: <b>{route.ride} min</b> · {r1(route.km / 2)} km one-way · {route.km} km/day (both trips){legs ? "" : " · loading legs…"}</>
          : <>Leg: <b>{segFrom} → {segTo}</b> — {legs ? <b>{r1(legs[sel].km)} km · {Math.round(legs[sel].min)} min</b> : "…"} <span style={{ fontWeight: 400 }}>(click the leg again to go back to the whole route)</span></>}
      </div>
      <div ref={elRef} className="rounded-2xl overflow-hidden border" style={{ borderColor: t.border, height: 340, width: "100%", background: t.surface2 }} />
    </div>
  );
}

/* Master map: several routes on ONE Leaflet/OSM map, each in its own colour,
   following real roads. Built like RouteMap (keyless OSM tiles + OSRM road geometry
   per route); remounted via a `key` on the selected-route set so it rebuilds only
   when the selection changes (not on every dashboard re-render). */
function MasterRouteMap({ t, depot, routes, colors, height = 460, showStops = true, scrollWheelZoom = false }) {
  const elRef = useRef(null);
  const mapRef = useRef(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!elRef.current) return;
        const map = L.map(elRef.current, { zoomControl: true, scrollWheelZoom });
        L.tileLayer(OSM_URL, { attribution: OSM_ATTR, maxZoom: 19 }).addTo(map);
        mapRef.current = map;
        const all = [[depot[0], depot[1]]];
        // Factory marker (shared origin for every route)
        L.marker([depot[0], depot[1]], { icon: factoryIcon(), zIndexOffset: 1000 })
          .bindTooltip("Factory", { direction: "top", offset: [0, -16] }).addTo(map);
        for (const r of routes) {
          if (cancelled) return;
          const color = colors[r.name] || (t.primary || "#6366f1");
          const pts = [{ lat: depot[0], lng: depot[1] }, ...r.seq.map((s) => ({ lat: s.lat, lng: s.lng }))];
          // stop dots — first & last in unique colours, middle stops in route colour
          r.seq.forEach((s, i) => {
            const first = i === 0, last = i === r.seq.length - 1;
            const dotColor = last ? LAST_STOP_COLOR : first ? FIRST_STOP_COLOR : color;
            if (showStops) {
              L.marker([s.lat, s.lng], { icon: dotIcon(dotColor, String(s.eff ?? s.hc ?? i + 1), { size: (first || last) ? 24 : 20, fontSize: 10 }) })
                .bindTooltip(r.name + " · " + (i + 1) + ". " + s.name + (s.eff != null ? " — " + s.eff + " riders" : "") + (first ? " (first stop)" : last ? " (last stop · parks overnight)" : ""), { direction: "top", offset: [0, -12] })
                .addTo(map);
            }
            all.push([s.lat, s.lng]);
          });
          // km/min for each leg (from the cached road matrix — zero Google calls)
          let legDist = [];
          try { const M = await matrixFor(pts); legDist = pts.slice(0, -1).map((_, i) => ({ km: M.km[i][i + 1], min: M.min[i][i + 1] })); } catch { /* no dist */ }
          // ROAD-FOLLOWING geometry, per leg, so each segment is clickable (OSRM steps)
          let legPaths = pts.slice(0, -1).map((_, i) => [[pts[i].lat, pts[i].lng], [pts[i + 1].lat, pts[i + 1].lng]]); // straight-line fallback
          try {
            const coords = pts.map((p) => p.lng + "," + p.lat).join(";");
            const res = await fetch(`https://router.project-osrm.org/route/v1/driving/${coords}?overview=false&geometries=geojson&steps=true`);
            const j = await res.json();
            if (j.code === "Ok" && j.routes && j.routes[0].legs.length === pts.length - 1) {
              legPaths = j.routes[0].legs.map((leg, i) => {
                const cs = [];
                (leg.steps || []).forEach((st) => (st.geometry?.coordinates || []).forEach((c) => cs.push([c[1], c[0]])));
                return cs.length > 1 ? cs : [[pts[i].lat, pts[i].lng], [pts[i + 1].lat, pts[i + 1].lng]];
              });
            }
          } catch { /* keep straight-line fallback */ }
          if (cancelled) return;
          const esc = (x) => String(x || "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
          const r1 = (x) => Math.round(x * 10) / 10;
          legPaths.forEach((path, i) => {
            const line = L.polyline(path, { color, weight: 5, opacity: 0.82 }).addTo(map);
            const d = legDist[i];
            const from = i === 0 ? "Factory" : `${i}. ${r.seq[i - 1].name}`;
            const to = `${i + 1}. ${r.seq[i].name}`;
            // click a segment → popup with distance & time between the two stops
            line.bindPopup(`<div style="font:600 12px/1.4 Inter,system-ui,sans-serif;color:#0f172a">`
              + `<div style="font-weight:700;margin-bottom:2px">${esc(from)} → ${esc(to)}</div>`
              + (d ? `<div style="color:${color};font-weight:700">${r1(d.km)} km · ${Math.round(d.min)} min</div>` : `<div style="color:#64748b">distance unavailable</div>`)
              + `</div>`);
            path.forEach((q) => all.push(q));
          });
        }
        if (!cancelled) {
          if (all.length > 1) map.fitBounds(L.latLngBounds(all), { padding: [40, 40] });
          else map.setView([depot[0], depot[1]], 11); // no routes: just centre on the factory
          setTimeout(() => map.invalidateSize(), 0);
        }
      } catch { setErr(true); }
    })();
    return () => { cancelled = true; if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; } };
    // eslint-disable-next-line
  }, []);
  if (err) return <div className="rounded-2xl border py-10 text-center text-sm" style={{ borderColor: t.border, color: t.muted }}>Map unavailable.</div>;
  return <div ref={elRef} className="rounded-2xl overflow-hidden border" style={{ borderColor: t.border, height, width: "100%", background: t.surface2 }} />;
}

/* Each related-KPI club sits in its OWN soft container; cells inside are split by a
   faint short divider. An explainable cell shows a small ⓘ button top-right — only
   that button opens the breakdown below (not a click anywhere on the card). */
function KpiCell({ t, c }) {
  return (
    <div onClick={c.onCardClick}
      title={c.onCardClick ? c.cardHint : undefined}
      className={"relative flex-1 min-w-0 px-3.5 py-4 transition-colors duration-150" + (c.onCardClick ? " cursor-pointer hover:brightness-[0.985]" : "")}
      style={{ background: c.active ? t.primarySoft : "transparent", boxShadow: c.active ? `inset 0 -2.5px 0 ${c.accent || t.primary}` : "none" }}>
      {c.onClick && (
        <button type="button" onClick={(e) => { e.stopPropagation(); c.onClick(); }} title="How this is calculated"
          className="absolute top-2.5 right-2.5 rounded-full flex-shrink-0 hover:opacity-100 transition-opacity"
          style={{ color: c.active ? (c.accent || t.primary) : t.muted, lineHeight: 0, cursor: "pointer", opacity: c.active ? 1 : 0.5 }}>
          <Info size={12} />
        </button>
      )}
      <div className="flex items-center gap-1.5 min-w-0" style={{ paddingRight: c.onClick ? 14 : 0 }}>
        <span className="inline-block rounded-full flex-shrink-0" style={{ width: 6, height: 6, background: c.accent || t.primary }} />
        <span className="text-[10px] uppercase tracking-wider font-semibold truncate" style={{ color: t.muted }}>{c.label}</span>
      </div>
      <div className="mt-2 font-bold tabular-nums leading-none whitespace-nowrap tracking-tight" style={{ color: t.text }}>
        <span className="text-2xl">{c.value}</span>
        {c.unit && <span className="text-xs font-semibold ml-0.5" style={{ color: t.muted }}>{c.unit}</span>}
      </div>
      {c.sub && <div className="text-[10px] mt-1.5 truncate" style={{ color: t.muted }}>{c.sub}</div>}
    </div>
  );
}
function KpiGroup({ t, groups }) {
  return (
    <div className="flex flex-col sm:flex-row gap-3">
      {groups.map((cells, gi) => (
        <div key={gi} className="rounded-2xl border flex items-stretch overflow-hidden"
          style={{ flexGrow: cells.length, flexBasis: 0, background: t.surface, borderColor: t.border, boxShadow: "0 1px 2px rgba(15,23,42,.04), 0 6px 16px rgba(15,23,42,.05)" }}>
          {cells.map((c, i) => (
            <React.Fragment key={c.key}>
              {i > 0 && <div aria-hidden style={{ width: 1, alignSelf: "center", height: "42%", background: t.border, opacity: 0.55 }} />}
              <KpiCell t={t} c={c} />
            </React.Fragment>
          ))}
        </div>
      ))}
    </div>
  );
}

/* Apportion a route's EFFECTIVE riders (r.riders — the scaled figure every KPI uses) across its
 * stops in proportion to their raw registered headcount (s.hc), with largest-remainder rounding so
 * the per-stop values sum EXACTLY to r.riders. Attaches s.eff to each stop. Without this the panel
 * showed raw headcount (a route's stops summed to 82) while the RIDERS column showed effective (56). */
function attachEffDemand(seq, target) {
  const raws = (seq || []).map((s) => s.hc || 0);
  const rawTot = raws.reduce((a, b) => a + b, 0);
  if (!rawTot || target == null) return (seq || []).map((s) => ({ ...s, eff: s.hc ?? 0 }));
  const exact = raws.map((h) => (h * target) / rawTot);
  const eff = exact.map(Math.floor);
  let rem = target - eff.reduce((a, b) => a + b, 0);
  const byRemainder = exact.map((v, i) => [v - Math.floor(v), i]).sort((a, b) => b[0] - a[0]);
  for (let k = 0; k < byRemainder.length && rem > 0; k++, rem--) eff[byRemainder[k][1]] += 1;
  return seq.map((s, i) => ({ ...s, eff: eff[i] }));
}

function FleetPlanView({ t }) {
  const [data, setData] = useState(null);
  const view = "overall"; // Combined data only (owned/rental split shown within the KPIs)
  const [open, setOpen] = useState(() => new Set()); // expanded route rows (show stop order + Maps link)
  const [names, setNames] = useState(() => { try { return JSON.parse(localStorage.getItem("opt-route-names") || "{}"); } catch { return {}; } }); // custom route names, keyed by bus
  const [busCo] = useState(loadBusCo); // bus -> company (read-only here; edited in the Companies tab)
  const [explain, setExplain] = useState(null); // which KPI tile's calculation is open (cost|buses|util|ride|null)
  const [selRoutes, setSelRoutes] = useState(() => new Set()); // bus names plotted on the master map
  const [showStops, setShowStops] = useState(true); // master map: toggle stop-dot visibility
  const [routePage, setRoutePage] = useState(0); // routes table pagination (20 / page)
  const [typeFilter, setTypeFilter] = useState(null); // routes table filter: null | "own" | "rent" (set by clicking Owned/Rental KPI)
  const [companyFilter, setCompanyFilter] = useState(null); // routes table Company-column filter: null | company name
  const [companyMenuOpen, setCompanyMenuOpen] = useState(false); // Company-filter dropdown open state
  const [routeQuery, setRouteQuery] = useState(""); // routes table search box
  const [stopsPanelOpen, setStopsPanelOpen] = useState(true); // master-map stop-order panel: expanded/minimized
  const [err, setErr] = useState(false);
  const load = () => {
    setErr(false); setData(null);
    fetch("/solver_result.json?ts=" + Date.now())
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => {
        if (d && d.routes) for (const r of d.routes) r.seq = attachEffDemand(r.seq, r.riders);
        setData(d);
      }).catch(() => setErr(true));
  };
  useEffect(load, []);
  const inr0 = (n) => "₹" + Math.round(n || 0).toLocaleString("en-IN");

  if (err) return (
    <Empty t={t} title="No solver plan yet"
      sub="Run  python optimize.py  in the fleet-dashboard folder to generate the global fleet plan, then reload.">
      <Btn t={t} onClick={load}><RotateCcw size={15} /> Reload</Btn>
    </Empty>);
  if (!data) return <Card t={t}><div className="py-6 text-center" style={{ color: t.muted }}>Loading solver plan…</div></Card>;

  const rows = data.routes.filter((r) => (view === "overall" ? true : r.type === (view === "owned" ? "own" : "rent")));
  // distinct companies present — options for the Company-column filter dropdown
  const companyOptions = [...new Set(rows.map((r) => companyOf(busCo, r.name)))].sort();
  // Owned/Rental filter (KPI cards) drives the metrics; the Company filter is table-only
  const typeRows = typeFilter ? rows.filter((r) => r.type === typeFilter) : rows;
  // filteredRows = type + company filters — these DRIVE the KPI metrics
  const filteredRows = companyFilter ? typeRows.filter((r) => companyOf(busCo, r.name) === companyFilter) : typeRows;
  const filtersActive = !!typeFilter || !!companyFilter;
  // tableRows = filteredRows + the search box (search only narrows the displayed rows)
  const rq = routeQuery.trim().toLowerCase();
  const tableRows = rq ? filteredRows.filter((r) => {
    const first = r.seq[0]?.name || "", last = r.seq[r.seq.length - 1]?.name || "";
    return [r.name, names[r.name] || "", companyOf(busCo, r.name), r.type, first, last].some((x) => String(x).toLowerCase().includes(rq));
  }) : filteredRows;
  const applyTypeFilter = (type) => { setTypeFilter((f) => (f === type ? null : type)); setRoutePage(0); };
  // routes table pagination — 20 buses per page
  const ROUTES_PER_PAGE = 20;
  const routePageCount = Math.max(1, Math.ceil(tableRows.length / ROUTES_PER_PAGE));
  const curRoutePage = Math.min(routePage, routePageCount - 1);
  const pagedRows = tableRows.slice(curRoutePage * ROUTES_PER_PAGE, curRoutePage * ROUTES_PER_PAGE + ROUTES_PER_PAGE);
  const depot = data.params.depot;
  const toggle = (name) => setOpen((s) => { const n = new Set(s); n.has(name) ? n.delete(name) : n.add(name); return n; });
  // --- master map: plot any set of routes together, each in its own colour ---
  const toggleSel = (name) => setSelRoutes((s) => { const n = new Set(s); n.has(name) ? n.delete(name) : n.add(name); return n; });
  const allSelected = tableRows.length > 0 && tableRows.every((r) => selRoutes.has(r.name));
  const toggleAll = () => setSelRoutes(() => (allSelected ? new Set() : new Set(tableRows.map((r) => r.name))));
  const selRows = rows.filter((r) => selRoutes.has(r.name));
  const masterColors = {}; selRows.forEach((r, i) => (masterColors[r.name] = PALETTE[i % PALETTE.length]));
  const masterKey = selRows.map((r) => r.name).join(","); // remount the map only when the selection changes
  // --- Selection-aware metrics: when one or more buses are ticked in the routes
  //     table, EVERY KPI above reflects just that selection; otherwise they show
  //     the whole fleet for the current Combined/Owned/Rental view. ---
  const agg = (list) => {
    const buses = list.length;
    const riders = list.reduce((s, r) => s + r.riders, 0);
    const seats = list.reduce((s, r) => s + r.cap, 0);
    const cost = list.reduce((s, r) => s + r.cost, 0);
    const km = list.reduce((s, r) => s + r.km, 0);
    const stops = list.reduce((s, r) => s + r.stops, 0);
    const rw = riders || 1;
    return {
      buses, riders, seats, cost, km,
      util: seats ? (riders / seats) * 100 : 0,
      cost_head: riders ? cost / riders : 0,
      max_ride: buses ? Math.max(...list.map((r) => r.ride)) : 0,
      avg_ride: list.reduce((s, r) => s + r.ride * r.riders, 0) / rw,
      avg_stops: buses ? stops / buses : 0,
    };
  };
  const selActive = selRoutes.size > 0;
  const wd = (data.assumptions || {}).working_days || 26;
  // KPI scope: ticked routes take priority, else any active table filter (type + company),
  // else the whole fleet. A table filter now flows through to the metrics above.
  const scope = selActive ? selRows : filteredRows;
  const m = selActive ? agg(selRows) : filtersActive ? agg(filteredRows) : data.overall;
  const ow = (selActive || filtersActive) ? agg(scope.filter((r) => r.type === "own")) : data.owned;
  const rt = (selActive || filtersActive) ? agg(scope.filter((r) => r.type === "rent")) : data.rental;
  // people-weighted fleet metrics (weight each route by its riders, not equally)
  const metricRows = selActive ? selRows : filtersActive ? filteredRows : rows;
  const rSum = metricRows.reduce((acc, r) => acc + r.riders, 0) || 1;
  const wAvgRide = metricRows.reduce((acc, r) => acc + r.ride * r.riders, 0) / rSum;       // avg time, weighted by people
  const wDistPP = metricRows.reduce((acc, r) => acc + (r.km / 2) * r.riders, 0) / rSum;      // avg one-way km a person's bus runs
  const rename = (bus, label) => setNames((prev) => { const n = { ...prev, [bus]: label }; try { localStorage.setItem("opt-route-names", JSON.stringify(n)); } catch {} return n; });
  // Google Maps directions: factory -> stops in pickup order -> LAST stop
  // (no return-to-factory leg — it duplicated the origin and misled ride checks).
  // NOTE: Google Maps silently keeps only the FIRST ~9 waypoints of a link, so for
  // routes with 10+ stops the opened map shows a TRUNCATED route (shorter time
  // than the real full chain). The Ride column is the truth (road-matrix minutes).
  const gmaps = (r) => { const lastS = r.seq[r.seq.length - 1]; return "https://www.google.com/maps/dir/?api=1&origin=" + depot[0] + "," + depot[1] +
    "&destination=" + lastS.lat + "," + lastS.lng +
    "&waypoints=" + r.seq.slice(0, -1).map((s) => s.lat + "," + s.lng).join("|") + "&travelmode=driving"; };

  const a = data.assumptions || {};

  return (
    <div className="space-y-4">
      {selActive && (
        <div className="flex flex-wrap items-center gap-2 text-xs rounded-xl px-3 py-2" style={{ background: t.primarySoft, color: t.primary, fontWeight: 600 }}>
          Metrics below reflect <b>{selRoutes.size}</b> selected bus{selRoutes.size === 1 ? "" : "es"} · {m.riders} riders · {m.seats} seats.
          <button type="button" onClick={() => setSelRoutes(new Set())} className="rounded-lg px-2 py-0.5"
            style={{ border: "1px solid " + t.border, background: t.surface, color: t.text, cursor: "pointer" }}>
            Show whole fleet
          </button>
        </div>
      )}
      {!selActive && filtersActive && (
        <div className="flex flex-wrap items-center gap-2 text-xs rounded-xl px-3 py-2" style={{ background: t.primarySoft, color: t.primary, fontWeight: 600 }}>
          Metrics reflect <b>{[typeFilter === "own" ? "owned" : typeFilter === "rent" ? "rental" : null, companyFilter].filter(Boolean).join(" · ") || "filtered"}</b> buses · {m.buses} buses · {m.riders} riders.
          <button type="button" onClick={() => { setTypeFilter(null); setCompanyFilter(null); setRoutePage(0); }} className="rounded-lg px-2 py-0.5"
            style={{ border: "1px solid " + t.border, background: t.surface, color: t.text, cursor: "pointer" }}>
            Show whole fleet
          </button>
        </div>
      )}
      {(() => {
        const clickable = (explainKey, cell) => ({ ...cell, key: cell.key || explainKey, active: explain === explainKey, onClick: () => setExplain((e) => (e === explainKey ? null : explainKey)) });
        // related KPIs clubbed within one shared container, all on a single row
        const cost = clickable("cost", { label: "Cost / head", value: "₹" + m.cost_head.toFixed(1), sub: inr0(m.cost_head * wd) + "/mo", accent: t.primary });
        const util = clickable("util", { label: "Utilisation", value: m.util.toFixed(0), unit: "%", sub: `${m.riders} riders`, accent: m.util >= 85 ? t.good : t.poor });
        const avgride = clickable("avgride", { label: "Avg ride", value: Math.round(wAvgRide), unit: "min", sub: "people-wtd", accent: wAvgRide <= 60 ? t.good : t.poor });
        const maxride = clickable("ride", { label: "Max ride", value: Math.round(m.max_ride), unit: "min", sub: "longest trip", accent: m.max_ride <= 110 ? t.good : t.poor });
        const totDist = { key: "totdist", label: "Total dist", value: Math.round(m.km).toLocaleString("en-IN"), unit: "km", sub: "whole fleet", accent: t.techno };
        const avgDist = { key: "avgdist", label: "Dist / person", value: wDistPP.toFixed(1), unit: "km", sub: "one-way", accent: t.good };
        // Buses split into owned vs rental — clicking the CARD filters the routes
        // table by type; the ⓘ still opens the fleet-size explanation. Active
        // highlight tracks the filter (not the explainer) for these two.
        const owned = { ...clickable("buses", { key: "owned", label: "Owned", value: ow.buses, sub: `${ow.seats.toLocaleString("en-IN")} seats`, accent: t.primary }), active: typeFilter === "own", onCardClick: () => applyTypeFilter("own"), cardHint: "Show only owned buses in the table below" };
        const rental = { ...clickable("buses", { key: "rental", label: "Rental", value: rt.buses, sub: `${rt.seats.toLocaleString("en-IN")} seats`, accent: t.techno }), active: typeFilter === "rent", onCardClick: () => applyTypeFilter("rent"), cardHint: "Show only rental buses in the table below" };
        const seats = { key: "seats", label: "Seats", value: m.seats.toLocaleString("en-IN"), sub: `${m.riders} riders`, accent: t.good };
        const avgStops = { key: "avgstops", label: "Stops/bus", value: m.avg_stops.toFixed(1), sub: "average", accent: t.primary };
        return <KpiGroup t={t} groups={[[cost, util], [avgride, maxride], [totDist, avgDist], [owned, rental, seats, avgStops]]} />;
      })()}
      {/* Master map — rendered bare (no card wrapper), matching the Stops-page map */}
      <div>
        {selRows.length > 0 && (
          <div className="flex items-center justify-between gap-3 mb-3">
            <div className="flex flex-wrap gap-2">
              {selRows.map((r) => (
                <span key={r.name} className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-semibold" style={{ background: t.surface2, border: "1px solid " + t.border, color: t.text }}>
                  <span className="inline-block rounded-full" style={{ width: 10, height: 10, background: masterColors[r.name] }} />
                  {names[r.name] || r.name}
                  <button onClick={() => toggleSel(r.name)} title="Remove from map" style={{ color: t.muted }}><X size={12} /></button>
                </span>
              ))}
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <button type="button" onClick={() => setShowStops((s) => !s)}
                title={showStops ? "Hide stop markers to see the routes clearly" : "Show stop markers"}
                className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors"
                style={{ border: "1px solid " + t.border, color: showStops ? t.primary : t.muted, background: showStops ? t.primarySoft : "transparent", cursor: "pointer" }}>
                {showStops ? <Eye size={13} /> : <EyeOff size={13} />} Stops
              </button>
              <Btn t={t} variant="ghost" onClick={() => setSelRoutes(new Set())}><X size={14} /> Clear</Btn>
            </div>
          </div>
        )}
        <div className="relative">
          <EnlargeableMap t={t} render={(h, big) => <MasterRouteMap key={masterKey + ":" + h + ":" + showStops} t={t} depot={depot} routes={selRows} colors={masterColors} height={h} showStops={showStops} scrollWheelZoom={big} />} />
          {/* Stops list overlay — vertical first→last order for the selected route(s). Click a leg on the map for its distance & time. */}
          {selRows.length > 0 && (
            <div className="absolute z-[500] top-14 right-3 rounded-2xl overflow-hidden flex flex-col" style={{
              width: stopsPanelOpen ? 208 : "auto", maxHeight: "calc(100% - 4.5rem)",
              // Apple "liquid glass": translucent tint + frosted backdrop so the route shows through
              background: "rgba(255,255,255,0.26)",
              backdropFilter: "blur(12px) saturate(185%)", WebkitBackdropFilter: "blur(12px) saturate(185%)",
              border: "1px solid rgba(255,255,255,0.5)",
              boxShadow: "0 8px 30px rgba(15,23,42,.22), inset 0 1px 1px rgba(255,255,255,0.75), inset 0 -1px 2px rgba(255,255,255,0.35)",
            }}>
              <button type="button" onClick={() => setStopsPanelOpen((o) => !o)} title={stopsPanelOpen ? "Minimize" : "Show stop order"}
                className="px-3 pt-2 pb-1 flex items-center justify-between gap-3 flex-shrink-0" style={{ color: t.muted, cursor: "pointer" }}>
                <span className="text-[10px] font-bold uppercase tracking-wider">Stop order</span>
                <ChevronRight size={13} style={{ transform: stopsPanelOpen ? "rotate(-90deg)" : "rotate(90deg)", transition: "transform .15s" }} />
              </button>
              {stopsPanelOpen && (
              <div className="overflow-y-auto">
                {selRows.map((r) => (
                  <div key={r.name}>
                    {selRows.length > 1 && (
                      <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide flex items-center gap-1.5" style={{ background: "rgba(255,255,255,0.35)", color: t.text }}>
                        <span className="inline-block rounded-full flex-shrink-0" style={{ width: 8, height: 8, background: masterColors[r.name] }} />{names[r.name] || r.name}
                      </div>
                    )}
                    <ol className="py-1">
                      <li className="flex items-center gap-2 px-3 py-1 text-[11px]" style={{ color: t.text }}>
                        <span className="inline-flex items-center justify-center rounded-full flex-shrink-0 text-[9px] font-bold" style={{ width: 16, height: 16, background: "#0f172a", color: "#fff" }}>F</span>
                        <span className="font-semibold">Factory</span>
                      </li>
                      {r.seq.map((s, i) => {
                        const first = i === 0, last = i === r.seq.length - 1;
                        const c = last ? LAST_STOP_COLOR : first ? FIRST_STOP_COLOR : (masterColors[r.name] || t.primary);
                        return (
                          <li key={i} className="flex items-center gap-2 px-3 py-1 text-[11px]" style={{ color: t.text }}>
                            <span className="inline-flex items-center justify-center rounded-full flex-shrink-0 text-[9px] font-bold" style={{ width: 16, height: 16, background: c, color: "#fff" }}>{i + 1}</span>
                            <span className="truncate flex-1" title={s.name}>{s.name}</span>
                            {s.eff != null && (
                              <span className="flex-shrink-0 tabular-nums font-semibold text-[10px]" title={s.eff + " riders (" + (s.hc ?? "?") + " registered)"} style={{ color: t.muted }}>{s.eff}</span>
                            )}
                          </li>
                        );
                      })}
                    </ol>
                  </div>
                ))}
              </div>
              )}
            </div>
          )}
        </div>
      </div>
      {explain && (() => {
        const E = {
          cost: {
            title: `How ₹${m.cost_head.toFixed(1)} / head / day is calculated`,
            steps: [
              view !== "rental" && <>Owned buses: <b>₹{a.own_driver_day}</b> driver + <b>₹{a.own_maint_day}</b> maintenance{a.own_insurance_day ? <> + <b>₹{a.own_insurance_day}</b> insurance &amp; taxes</> : null} per day (paid whether they run or not — the <b>loan is excluded</b> as capital) + <b>₹{a.own_diesel_per_km}/km</b> diesel. {ow.buses} owned → <b style={{ color: t.primary }}>{inr0(ow.cost)}/day</b>.</>,
              view !== "owned" && <>Rental vans: flat tariff per trip ({a.rent_tariff}). {rt.buses} vans → <b style={{ color: t.primary }}>{inr0(rt.cost)}/day</b>.</>,
              <>Total {view === "overall" ? "fleet " : ""}cost = <b>{inr0(m.cost)}/day</b>.</>,
              <>Riders carried = <b>{m.riders}</b> ({data.params.stops} stops × {a.demand_per_stop}; demand/stop = ceil(headcount × (1 − {a.absentee_pct}% absentee + {a.buffer_pct}% buffer))).</>,
              <>Cost / head = total ÷ riders = {inr0(m.cost)} ÷ {m.riders} = <b style={{ color: t.primary, fontSize: "1.05em" }}>₹{m.cost_head.toFixed(1)}</b>.</>,
              <>Per month = ₹{m.cost_head.toFixed(1)} × {wd} working days = <b>{inr0(m.cost_head * wd)}</b>.</>,
            ].filter(Boolean),
            chips: [`Diesel ₹${a.own_diesel_per_km}/km`, `Driver ₹${a.own_driver_day}/day`, `Maint ₹${a.own_maint_day}/day`, a.own_insurance_day ? `Insurance ₹${a.own_insurance_day}/day` : null, `Loan ${a.owned_loan}`, `Rental ${a.rent_tariff}`, `Absentee ${a.absentee_pct}%`, `Buffer ${a.buffer_pct}%`, `+${a.cap_leniency} leniency`, `${wd} days/mo`, a.road_source].filter(Boolean),
          },
          buses: {
            title: `Why ${m.buses} buses`,
            steps: [
              <>The optimiser packs riders into as few buses as possible, filling cheap <b>owned</b> buses first, then renting vans for the leftover.</>,
              view !== "rental" && <>Owned used: <b>{ow.buses}</b> — carrying {ow.riders} riders, ~{Math.round(ow.riders / Math.max(1, ow.buses))} per bus (≈55 seats).</>,
              view !== "owned" && <>Rental used: <b>{rt.buses}</b> — for the remaining {rt.riders} riders, ~{Math.round(rt.riders / Math.max(1, rt.buses))} per van (15 seats).</>,
              <>Total = {view === "overall" ? `${ow.buses} + ${rt.buses} = ` : ""}<b style={{ color: t.techno, fontSize: "1.05em" }}>{m.buses}</b> buses, averaging {m.avg_stops.toFixed(1)} stops each.</>,
            ].filter(Boolean),
            chips: ["Owned ≈55 seats", "Rental 15 seats", `+${a.cap_leniency} leniency`, "Owned filled first (cheaper/head)"],
          },
          util: {
            title: `How ${m.util.toFixed(0)}% utilisation is calculated`,
            steps: [
              <>Utilisation = riders carried ÷ seats provided × 100.</>,
              <>Seats = <b>{m.seats}</b> (sum of every used bus's seat count).</>,
              <>Riders = <b>{m.riders}</b>.</>,
              <>= {m.riders} ÷ {m.seats} × 100 = <b style={{ color: m.util >= 85 ? t.good : t.poor, fontSize: "1.05em" }}>{m.util.toFixed(0)}%</b>.</>,
              m.util > 100 && <>Above 100% is allowed by the <b>+{a.cap_leniency} capacity leniency</b> — a bus may carry up to {a.cap_leniency} riders over its seat count.</>,
            ].filter(Boolean),
            chips: [`Seats ${m.seats}`, `Riders ${m.riders}`, `+${a.cap_leniency} leniency`],
          },
          ride: {
            title: `What "Max ride ${Math.round(m.max_ride)} min" means`,
            steps: [
              <><b>Trip</b> = the route chain factory → … → last stop, one direction. Evening: the last-dropped (farthest) passenger rides the whole chain; morning is the same reversed. The bus parks overnight at the last stop.</>,
              <>Max ride = the highest ride across all {m.buses} routes = <b style={{ color: m.max_ride <= 60 ? t.good : t.poor, fontSize: "1.05em" }}>{Math.round(m.max_ride)} min</b>.</>,
              <>Average ride = <b>{Math.round(m.avg_ride)} min</b>.</>,
              <>Times come from the {a.road_source}. Feasibility cap {data.params.max_ride} min{data.params.soft_ride ? `, soft target ${data.params.soft_ride} min` : ""}.</>,
            ].filter(Boolean),
            chips: [`Hard cap ${data.params.max_ride} min`, data.params.soft_ride ? `Soft target ${data.params.soft_ride} min` : null, "Real road times"].filter(Boolean),
          },
          avgride: {
            title: `How "Avg ride ${Math.round(m.avg_ride)} min" is calculated`,
            steps: [
              <>Each route's <b>Trip</b> = the chain factory → … → last stop (one direction, real road minutes + 0.5 min dwell per intermediate stop).</>,
              <>Avg ride = the mean trip across {view === "overall" ? "all" : view} <b>{m.buses}</b> routes = <b style={{ color: m.avg_ride <= 60 ? t.good : t.poor, fontSize: "1.05em" }}>{Math.round(m.avg_ride)} min</b>.</>,
              view === "overall" && <>By fleet: owned <b>{Math.round(ow.avg_ride)} min</b> (near, dense routes) · rental <b>{Math.round(rt.avg_ride)} min</b> (far villages — vans cover the long corridors).</>,
              <>The floor is geography: ~38% of riders live 35+ min of raw driving from the factory, so a fleet average near ~60 is the physical limit for single-trip operation.</>,
            ].filter(Boolean),
            chips: ["Real road times", "Dwell 0.5 min/stop", data.params.soft_ride ? `Soft target ${data.params.soft_ride} min` : null].filter(Boolean),
          },
        }[explain];
        return (
          <Card t={t} title={E.title} hint="Broken down with this plan's real numbers.">
            <ol className="space-y-2.5">
              {E.steps.map((s, i) => (
                <li key={i} className="flex gap-3 text-sm" style={{ color: t.text }}>
                  <span className="flex-shrink-0 inline-flex items-center justify-center rounded-full text-xs font-bold" style={{ width: 22, height: 22, background: t.primarySoft, color: t.primary }}>{i + 1}</span>
                  <span>{s}</span>
                </li>
              ))}
            </ol>
            {E.chips && E.chips.length > 0 && (
              <div className="mt-4 pt-3" style={{ borderTop: "1px solid " + t.border }}>
                <div className="text-xs uppercase tracking-wider mb-2" style={{ color: t.muted }}>Assumptions</div>
                <div className="flex flex-wrap gap-1.5">
                  {E.chips.filter(Boolean).map((x, i) => (
                    <span key={i} className="rounded-lg px-2 py-1 text-xs" style={{ background: t.surface, border: "1px solid " + t.border, color: t.muted }}>{x}</span>
                  ))}
                </div>
              </div>
            )}
          </Card>
        );
      })()}
      <Card t={t} title="Routes"
        right={
          <div className="flex items-center gap-2">
            <span className="text-xs whitespace-nowrap" style={{ color: t.muted }}>{tableRows.length} bus{tableRows.length === 1 ? "" : "es"}{rq ? " match" : ""}</span>
            <SearchInput t={t} value={routeQuery} onChange={(e) => { setRouteQuery(e.target.value); setRoutePage(0); }} placeholder="Search bus, company or stop…" width={230} />
          </div>
        }>
        {typeFilter && (
          <div className="flex items-center gap-2 mb-3 text-xs rounded-xl px-3 py-2" style={{ background: t.primarySoft, color: t.primary, fontWeight: 600 }}>
            Showing only <b>{typeFilter === "own" ? "owned" : "rental"}</b> buses ({tableRows.length}).
            <button type="button" onClick={() => { setTypeFilter(null); setRoutePage(0); }} className="rounded-lg px-2 py-0.5"
              style={{ border: "1px solid " + t.border, background: t.surface, color: t.text, cursor: "pointer" }}>
              Show all
            </button>
          </div>
        )}
        {companyFilter && (
          <div className="flex flex-wrap items-center gap-2 mb-3 text-xs">
            <span style={{ color: t.muted, fontWeight: 600 }}>Filtered:</span>
            <span className="inline-flex items-center gap-1.5 rounded-full pl-2.5 pr-1.5 py-1 font-semibold" style={{ background: t.primarySoft, color: t.primary }}>
              Company: {companyFilter} ({tableRows.length})
              <button type="button" onClick={() => { setCompanyFilter(null); setRoutePage(0); }} title="Clear company filter"
                className="inline-flex items-center justify-center rounded-full" style={{ background: t.primary, color: t.onPrimary || "#fff", width: 16, height: 16, lineHeight: 0, cursor: "pointer" }}>
                <X size={11} />
              </button>
            </span>
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-sm" style={{ minWidth: 700 }}>
            <thead><tr style={{ color: t.text }}>
              <th className="py-2.5 px-2 text-left" style={{ background: t.primarySoft, borderBottom: "2px solid " + t.border, borderTopLeftRadius: 10, borderBottomLeftRadius: 0 }}>
                <input type="checkbox" title={allSelected ? "Clear map selection" : "Plot all routes"} checked={allSelected} onChange={toggleAll} style={{ accentColor: t.primary, width: 15, height: 15 }} />
              </th>
              {["Bus", "Type", "Company", "Stops", "Riders", "Seats", "Km/day", "Trip", "₹/head", "Route", ""].map((h, i, arr) => <th key={i} className="py-2.5 px-2 text-left text-xs font-semibold uppercase tracking-wider" style={{ background: t.primarySoft, borderBottom: "2px solid " + t.border, color: (i === 9) ? t.techno : t.text, borderTopRightRadius: i === arr.length - 1 ? 10 : 0 }}>
                {h === "Company" ? (
                  <div className="relative inline-flex items-center gap-1.5">
                    <span>Company</span>
                    <button type="button" onClick={() => setCompanyMenuOpen((o) => !o)} title="Filter by company"
                      className="inline-flex items-center justify-center rounded-md p-1 transition-colors"
                      style={{ color: companyFilter ? (t.onPrimary || "#fff") : t.muted, background: companyFilter ? t.primary : "transparent", border: "1px solid " + (companyFilter ? t.primary : t.border), cursor: "pointer" }}>
                      <ListFilter size={12} />
                    </button>
                    {companyMenuOpen && (
                      <>
                        <div className="fixed inset-0 z-[100]" onClick={() => setCompanyMenuOpen(false)} />
                        <div className="absolute left-0 top-full mt-1 z-[110] rounded-lg py-1 overflow-hidden" style={{ background: t.surface, border: "1px solid " + t.border, boxShadow: "0 8px 24px rgba(15,23,42,.18)", minWidth: 150 }}>
                          {[["", "All companies"], ...companyOptions.map((c) => [c, c])].map(([val, label]) => {
                            const on = (companyFilter || "") === val;
                            return (
                              <button key={val || "all"} type="button" onClick={() => { setCompanyFilter(val || null); setRoutePage(0); setCompanyMenuOpen(false); }}
                                className="flex items-center gap-2 w-full text-left px-3 py-1.5 text-xs font-medium normal-case tracking-normal transition-colors"
                                style={{ color: on ? t.primary : t.text, background: on ? t.primarySoft : "transparent" }}>
                                <span className="inline-block w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: on ? t.primary : t.border }} />
                                {label}
                              </button>
                            );
                          })}
                        </div>
                      </>
                    )}
                  </div>
                ) : h}
              </th>)}
            </tr></thead>
            <tbody>
              {pagedRows.map((r) => {
                const isOpen = open.has(r.name); // keyed by bus name — stable across filter/pagination
                return (
                <React.Fragment key={r.name}>
                <tr style={{ borderBottom: isOpen ? "none" : "1px solid " + t.border, background: isOpen ? t.surface2 : selRoutes.has(r.name) ? t.primarySoft : "transparent" }}>
                  <td className="py-2 px-2">
                    <span className="inline-flex items-center gap-1.5">
                      <input type="checkbox" title="Plot on master map" checked={selRoutes.has(r.name)} onChange={() => toggleSel(r.name)} style={{ accentColor: t.primary, width: 15, height: 15 }} />
                      {selRoutes.has(r.name) && <span className="inline-block rounded-full" style={{ width: 9, height: 9, background: masterColors[r.name] }} />}
                    </span>
                  </td>
                  <td className="py-2 px-2" style={{ color: t.text }}>{names[r.name] ? <span><b>{names[r.name]}</b> <span style={{ color: t.muted, fontSize: "0.72rem" }}>({r.name})</span></span> : r.name}</td>
                  <td className="py-2 px-2">
                    <span className="rounded-full px-2 py-0.5 text-xs font-semibold" style={{ color: r.type === "own" ? t.primary : t.techno, background: r.type === "own" ? t.primarySoft : t.surface2 }}>{r.type}</span>
                  </td>
                  <td className="py-2 px-2">
                    <span className="rounded-full px-2 py-0.5 text-xs font-semibold" style={{ color: companyColor(t, companyOf(busCo, r.name)), background: t.surface2 }}>{companyOf(busCo, r.name)}</span>
                  </td>
                  <td className="py-2 px-2" style={{ color: t.text }}>{r.stops}</td>
                  <td className="py-2 px-2" style={{ color: t.text }}>{r.riders}</td>
                  <td className="py-2 px-2" style={{ color: t.text }}>{r.cap}</td>
                  <td className="py-2 px-2" style={{ color: t.muted }}>{r.km}</td>
                  <td className="py-2 px-2" style={{ color: r.ride <= 60 ? t.good : t.poor }}>{r.ride}</td>
                  <td className="py-2 px-2" style={{ color: t.text }}>{"₹" + (r.riders ? r.cost / r.riders : 0).toFixed(1)}</td>
                  <td className="py-2 px-2" style={{ color: t.techno, fontWeight: 600, minWidth: 200 }}>
                    <div>{r.seq[0] ? r.seq[0].name : "—"} <span style={{ color: t.muted, fontWeight: 400 }}>({r.km_to_last ?? "—"} km)</span></div>
                    <div><span style={{ color: t.muted, fontWeight: 400 }}>→ </span>{r.seq.length ? r.seq[r.seq.length - 1].name : "—"} <span style={{ color: t.muted, fontWeight: 400 }}>({r.km_to_farthest ?? "—"} km)</span></div>
                  </td>
                  <td className="py-2 px-2"><button onClick={() => toggle(r.name)} className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold" style={{ border: "1px solid " + t.border, color: t.primary }}><ChevronRight size={13} style={{ transform: isOpen ? "rotate(90deg)" : "none", transition: "transform .15s" }} />{isOpen ? "Close" : "Open"}</button></td>
                </tr>
                {isOpen && (
                  <tr style={{ background: t.surface2, borderBottom: "1px solid " + t.border }}>
                    <td colSpan={12} className="px-3 pb-4 pt-3">
                      <div className="text-xs mb-1.5" style={{ color: t.muted }}>Evening drop — factory → stop 1 (nearest) → … → stop {r.seq.length} (parks overnight). Morning pickup = the same route reversed:</div>
                      <div className="flex flex-wrap items-center gap-1.5 text-xs mb-3">
                        <span className="rounded-lg px-2 py-1 font-semibold" style={{ background: t.primarySoft, color: t.primary }}>Factory</span>
                        {r.seq.map((s, k) => (
                          <span key={k} className="inline-flex items-center gap-1.5">
                            <ChevronRight size={12} style={{ color: t.muted }} />
                            <span className="rounded-lg px-2 py-1" style={{ background: t.surface, border: "1px solid " + t.border, color: t.text }}>{k + 1}. {s.name}{k === r.seq.length - 1 ? " 🌙" : ""}</span>
                          </span>
                        ))}
                      </div>
                      <RouteMap t={t} depot={depot} route={r} />
                    </td>
                  </tr>
                )}
                </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        {routePageCount > 1 && (
          <div className="flex flex-wrap items-center justify-between gap-3 mt-3 pt-3 text-xs" style={{ borderTop: "1px solid " + t.border, color: t.muted }}>
            <span>Showing <b style={{ color: t.text }}>{curRoutePage * ROUTES_PER_PAGE + 1}–{Math.min(tableRows.length, (curRoutePage + 1) * ROUTES_PER_PAGE)}</b> of {tableRows.length} buses</span>
            <div className="flex items-center gap-1.5">
              <button type="button" disabled={curRoutePage === 0} onClick={() => setRoutePage((p) => Math.max(0, p - 1))}
                className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 font-semibold" style={{ border: "1px solid " + t.border, color: curRoutePage === 0 ? t.muted : t.text, opacity: curRoutePage === 0 ? 0.45 : 1, cursor: curRoutePage === 0 ? "default" : "pointer" }}>
                <ChevronRight size={13} style={{ transform: "rotate(180deg)" }} /> Prev
              </button>
              <span className="px-1" style={{ color: t.text, fontWeight: 600 }}>Page {curRoutePage + 1} / {routePageCount}</span>
              <button type="button" disabled={curRoutePage >= routePageCount - 1} onClick={() => setRoutePage((p) => Math.min(routePageCount - 1, p + 1))}
                className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 font-semibold" style={{ border: "1px solid " + t.border, color: curRoutePage >= routePageCount - 1 ? t.muted : t.text, opacity: curRoutePage >= routePageCount - 1 ? 0.45 : 1, cursor: curRoutePage >= routePageCount - 1 ? "default" : "pointer" }}>
                Next <ChevronRight size={13} />
              </button>
            </div>
          </div>
        )}
      </Card>
      <BackToTop t={t} />
    </div>
  );
}

/* ============================ COMPANIES (assignment viewer) ============================ */
function AssignmentView({ t }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(false);
  const [busCo, setBusCo] = useState(loadBusCo);
  const [names] = useState(loadRouteNames);
  const [open, setOpen] = useState(() => new Set());
  const load = () => { setErr(false); setData(null); fetch("/solver_result.json?ts=" + Date.now()).then((r) => (r.ok ? r.json() : Promise.reject())).then(setData).catch(() => setErr(true)); };
  useEffect(load, []);
  const assign = (bus, co) => setBusCo((prev) => { const n = { ...prev, [bus]: co }; saveBusCo(n); return n; });
  const toggle = (k) => setOpen((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });

  if (err) return <Empty t={t} title="No plan yet" sub="Generate the fleet plan (python optimize_setpartition.py), then reload."><Btn t={t} onClick={load}><RotateCcw size={15} /> Reload</Btn></Empty>;
  if (!data) return <Card t={t}><div className="py-6 text-center" style={{ color: t.muted }}>Loading…</div></Card>;

  const byCo = {}; COMPANIES.forEach((c) => (byCo[c] = []));
  data.routes.forEach((r) => { const c = companyOf(busCo, r.name); (byCo[c] || (byCo[c] = [])).push(r); });
  const sum = (rs, f) => rs.reduce((a, r) => a + f(r), 0);

  return (
    <div className="space-y-4">
      <div className="text-xs" style={{ color: t.muted }}>Company → its buses → each bus's route → stops → riders. A bus belongs to one company (assign in the Company column). Stops are shared locations, not owned by a company.</div>
      <div className="grid grid-cols-2 gap-3">
        {COMPANIES.map((c) => { const rs = byCo[c] || []; return (
          <Tile key={c} t={t} label={c} value={`${rs.length} buses`} accent={companyColor(t, c)}
            sub={`${sum(rs, (r) => r.riders)} riders · ${sum(rs, (r) => r.stops)} stops · ${inr(sum(rs, (r) => r.cost))}/day`} />
        ); })}
      </div>
      {COMPANIES.map((c) => { const rs = byCo[c] || []; return (
        <Card key={c} t={t} title={`${c} — ${rs.length} buses`}>
          {rs.length === 0 ? <div className="text-sm" style={{ color: t.muted }}>No buses assigned to {c} yet.</div> : (
            <div className="overflow-x-auto"><table className="w-full text-sm" style={{ minWidth: 580 }}>
              <thead><tr style={{ color: t.muted }}>{["Bus / route", "Stops", "Riders", "₹/day", "Company", ""].map((h, i) => <th key={i} className="py-2 px-2 text-left text-xs font-semibold uppercase tracking-wider" style={{ borderBottom: "1px solid " + t.border }}>{h}</th>)}</tr></thead>
              <tbody>{rs.map((r, i) => { const k = c + i; const isOpen = open.has(k); return (
                <React.Fragment key={k}>
                  <tr style={{ borderBottom: isOpen ? "none" : "1px solid " + t.border }}>
                    <td className="py-2 px-2" style={{ color: t.text }}>{names[r.name] ? <span><b>{names[r.name]}</b> <span style={{ color: t.muted, fontSize: "0.72rem" }}>({r.name})</span></span> : r.name}</td>
                    <td className="py-2 px-2" style={{ color: t.text }}>{r.stops}</td>
                    <td className="py-2 px-2" style={{ color: t.text }}>{r.riders}</td>
                    <td className="py-2 px-2" style={{ color: t.text }}>{inr(r.cost)}</td>
                    <td className="py-2 px-2"><select value={companyOf(busCo, r.name)} onChange={(e) => assign(r.name, e.target.value)} className="rounded-lg px-2 py-1 text-xs outline-none" style={{ background: t.inputBg, border: "1px solid " + t.border, color: t.text }}>{COMPANIES.map((x) => <option key={x} value={x}>{x}</option>)}</select></td>
                    <td className="py-2 px-2"><button onClick={() => toggle(k)} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold" style={{ border: "1px solid " + t.border, color: t.primary }}><ChevronRight size={12} style={{ transform: isOpen ? "rotate(90deg)" : "none", transition: "transform .15s" }} />{isOpen ? "Hide" : "Stops"}</button></td>
                  </tr>
                  {isOpen && (
                    <tr style={{ background: t.surface2, borderBottom: "1px solid " + t.border }}>
                      <td colSpan={6} className="px-3 pb-3 pt-1">
                        <div className="flex flex-wrap items-center gap-1.5 text-xs">
                          <span className="rounded-lg px-2 py-1 font-semibold" style={{ background: t.primarySoft, color: t.primary }}>Factory</span>
                          {r.seq.map((s, j) => <span key={j} className="inline-flex items-center gap-1"><ChevronRight size={11} style={{ color: t.muted }} /><span className="rounded-lg px-2 py-1" style={{ background: t.surface, border: "1px solid " + t.border, color: t.text }}>{j + 1}. {s.name}</span></span>)}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ); })}</tbody>
            </table></div>
          )}
        </Card>
      ); })}
    </div>
  );
}

/* ============================ SIMULATOR (savings) ============================ */
function SimulatorView({ t }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(false);
  const [p, setP] = useState(null);
  const [factors, setFactors] = useState([]);
  const [baseCo, setBaseCo] = useState("Technotek"); // which company's actual is the baseline
  const load = () => { setErr(false); setData(null); fetch("/solver_result.json?ts=" + Date.now()).then((r) => (r.ok ? r.json() : Promise.reject())).then(setData).catch(() => setErr(true)); };
  useEffect(load, []);
  useEffect(() => {
    if (data && !p) {
      const a = data.assumptions || {};
      setP({ driver: a.own_driver_day ?? 692, maint: a.own_maint_day ?? 471, dieselLitre: a.own_diesel_per_litre ?? 100, mileage: a.own_mileage_kmpl ?? 5.56, insurance: a.own_insurance_day ?? 676,
        rentBase: 1700, rentMid: 1900, rentBeyond: 18.7, t1: 80, t2: 95,
        workingDays: a.working_days ?? 26, months: 12, baseline: data.baseline?.cost ?? 0 });
    }
  }, [data, p]);

  if (err) return <Empty t={t} title="No plan yet" sub="Generate the fleet plan, then reload."><Btn t={t} onClick={load}><RotateCcw size={15} /> Reload</Btn></Empty>;
  if (!data || !p) return <Card t={t}><div className="py-6 text-center" style={{ color: t.muted }}>Loading…</div></Card>;

  const num = (x) => (Number(x) || 0);
  const dieselKm = num(p.mileage) ? num(p.dieselLitre) / num(p.mileage) : 0; // ₹/km = price per litre ÷ mileage
  let owned = 0, rental = 0;
  data.routes.forEach((r) => {
    if (r.type === "own") owned += num(p.driver) + num(p.maint) + num(p.insurance) + dieselKm * r.km;
    else { const km = r.km; rental += km <= num(p.t1) ? num(p.rentBase) : km <= num(p.t2) ? num(p.rentMid) : Math.max(num(p.rentMid), num(p.rentBeyond) * km); }
  });
  const buses = data.overall.buses, riders = data.overall.riders;
  let costDay = owned + rental, adds = 0;
  factors.forEach((f) => { const v = num(f.amount); if (f.basis === "flat/day") adds += v; else if (f.basis === "per bus/day") adds += v * buses; else if (f.basis === "per rider/day") adds += v * riders; });
  costDay += adds;
  factors.forEach((f) => { if (f.basis === "% of cost") costDay += costDay * num(f.amount) / 100; });

  const days = num(p.workingDays) * num(p.months);
  const optPeriod = costDay * days, basePeriod = num(p.baseline) * days;
  const savePeriod = basePeriod - optPeriod, savePct = basePeriod ? (savePeriod / basePeriod) * 100 : 0;
  const trips = buses * days, costHead = riders ? costDay / riders : 0;

  const set = (k, v) => setP((s) => ({ ...s, [k]: v }));
  // a function (NOT a nested component) so the inputs keep focus while typing
  const numIn = (label, k, suffix) => (
    <label className="block" key={k}>
      <span className="block text-xs mb-1" style={{ color: t.muted }}>{label}</span>
      <div className="flex items-center gap-1">
        <input type="number" value={p[k] ?? ""} onChange={(e) => set(k, e.target.value)} className="w-full rounded-lg px-2 py-1.5 text-sm outline-none" style={{ background: t.inputBg, border: "1px solid " + t.border, color: t.text }} />
        {suffix && <span className="text-xs" style={{ color: t.muted }}>{suffix}</span>}
      </div>
    </label>
  );
  const upd = (i, patch) => setFactors((arr) => arr.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold" style={{ color: t.text }}>Baseline company:</span>
        <Segmented t={t} small value={baseCo} onChange={(c) => { setBaseCo(c); const yr = (data.baselines || {})[c]; if (yr != null) setP((s) => ({ ...s, baseline: Math.round(yr / (num(s.workingDays) * 12)) })); }}
          options={[["Technotek", "Technotek"], ["Gainup", "Gainup"], ["Combined", "Combined"]]} />
        <span className="text-xs" style={{ color: t.muted }}>{baseCo === "Gainup" ? "not provided yet — upload later" : baseCo === "Combined" ? "Technotek + Gainup" : "FY24-25 actuals"}{data.baselines ? ` · ${inr(data.baselines[baseCo])}/yr` : ""}</span>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Tile t={t} label="Optimised cost" value={inr(optPeriod)} sub={`${num(p.months)} mo · ${inr(costDay)}/day`} accent={t.primary} />
        <Tile t={t} label="Baseline (Technotek actual)" value={inr(basePeriod)} sub="from your costing sheet (editable)" accent={t.poor} />
        <Tile t={t} label="Savings" value={inr(savePeriod)} sub={`${savePct.toFixed(0)}% cheaper`} accent={t.good} />
        <Tile t={t} label="Bus-trips" value={trips.toLocaleString("en-IN")} sub={`${buses} buses × ${days} days`} accent={t.techno} />
      </div>
      <Card t={t} title="Live equation" hint="The exact calculation with your current numbers — updates as you edit the assumptions below.">
        <div className="space-y-1.5">
          {[
            ["owned / day", `Σ(₹${num(p.driver)} driver + ₹${num(p.maint)} maint + ₹${num(p.insurance)} ins + [₹${num(p.dieselLitre)}/L÷${num(p.mileage)}=₹${dieselKm.toFixed(1)}/km]×km) over ${data.owned.buses} owned buses`, inr(owned)],
            ["rental / day", `Σ tariff(km) over ${data.rental.buses} rentals  [≤${num(p.t1)}km ₹${num(p.rentBase)} · ≤${num(p.t2)}km ₹${num(p.rentMid)} · else ₹${num(p.rentBeyond)}×km]`, inr(rental)],
            ...(adds ? [["+ factors / day", factors.map((f) => f.name || "factor").join(" + ") || "custom", inr(adds)]] : []),
            ["cost / day", `owned + rental${adds ? " + factors" : ""}`, inr(costDay)],
            ["period", `${num(p.workingDays)} working days/mo × ${num(p.months)} months`, days.toLocaleString("en-IN") + " days"],
            ["optimised", `${inr(costDay)} × ${days.toLocaleString("en-IN")} days`, inr(optPeriod)],
            ["baseline", `${inr(num(p.baseline))} / day × ${days.toLocaleString("en-IN")} days`, inr(basePeriod)],
            ["savings", `baseline − optimised`, `${inr(savePeriod)}  (${savePct.toFixed(1)}%)`],
            ["cost / head / day", `${inr(costDay)} ÷ ${riders} riders`, "₹" + costHead.toFixed(1)],
          ].map(([lhs, mid, res], i) => (
            <div key={i} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 font-mono" style={{ fontSize: "0.78rem" }}>
              <span style={{ color: t.muted, minWidth: 110, display: "inline-block" }}>{lhs}</span>
              <span style={{ color: t.gainup }}>= {mid}</span>
              <span style={{ color: t.text, fontWeight: 700 }}>= {res}</span>
            </div>
          ))}
        </div>
      </Card>
      <Card t={t} title="Assumptions — edit to see the impact" hint="Optimised cost is recomputed live from every route's real km. Baseline is the no-optimisation cost (editable; defaults to one dedicated van per stop).">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {numIn("Period (months)", "months")}
          {numIn("Working days / mo", "workingDays")}
          {numIn("Owned driver / day", "driver", "₹/day")}
          {numIn("Owned maint / day", "maint", "₹/day")}
          {numIn("Owned insurance / day", "insurance", "₹/day")}
          {numIn("Diesel ₹/litre", "dieselLitre", "₹/L")}
          {numIn("Mileage km/litre", "mileage", "km/L")}
          {numIn("Rental ≤80km trip", "rentBase", "₹")}
          {numIn("Rental ≤95km trip", "rentMid", "₹")}
          {numIn("Rental >95km", "rentBeyond", "₹/km")}
          {numIn("Baseline cost / day", "baseline", "₹/day")}
        </div>
      </Card>
      <Card t={t} title="Custom factors" hint="Add your own cost lines — insurance, tolls, fuel surcharge, anything. Each adjusts the optimised cost."
        right={<Btn t={t} variant="ghost" onClick={() => setFactors((f) => [...f, { name: "", amount: 0, basis: "flat/day" }])}><Plus size={14} /> Add factor</Btn>}>
        {factors.length === 0 ? <div className="text-sm" style={{ color: t.muted }}>No custom factors yet. Click “Add factor” to add insurance, tolls, surcharges, etc.</div> : (
          <div className="space-y-2">
            {factors.map((f, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <input value={f.name} placeholder="Factor name (e.g. Insurance)" onChange={(e) => upd(i, { name: e.target.value })} className="rounded-lg px-2 py-1.5 text-sm outline-none" style={{ background: t.inputBg, border: "1px solid " + t.border, color: t.text, minWidth: 180 }} />
                <input type="number" value={f.amount} onChange={(e) => upd(i, { amount: e.target.value })} className="rounded-lg px-2 py-1.5 text-sm outline-none" style={{ background: t.inputBg, border: "1px solid " + t.border, color: t.text, width: 110 }} />
                <select value={f.basis} onChange={(e) => upd(i, { basis: e.target.value })} className="rounded-lg px-2 py-1.5 text-sm outline-none" style={{ background: t.inputBg, border: "1px solid " + t.border, color: t.text }}>
                  {["flat/day", "per bus/day", "per rider/day", "% of cost"].map((b) => <option key={b} value={b}>{b}</option>)}
                </select>
                <button onClick={() => setFactors((arr) => arr.filter((_, j) => j !== i))} className="rounded-lg p-1.5" style={{ border: "1px solid " + t.border, color: t.muted }}><Trash2 size={14} /></button>
              </div>
            ))}
          </div>
        )}
      </Card>
      <Card t={t} title="Projection" hint={`Over ${num(p.months)} month(s) = ${days} working days.`}>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {[["Optimised / day", inr(costDay)], ["Optimised / period", inr(optPeriod)], ["Cost / head / day", "₹" + costHead.toFixed(1)],
            ["Baseline / period", inr(basePeriod)], ["Savings / period", inr(savePeriod)], ["Savings %", savePct.toFixed(1) + "%"]].map(([lab, val], i) => (
            <div key={i} className="rounded-xl px-3 py-2" style={{ background: t.surface, border: "1px solid " + t.border }}>
              <div className="text-xs" style={{ color: t.muted }}>{lab}</div>
              <div className="text-base font-bold" style={{ color: lab.indexOf("Savings") === 0 ? t.good : t.text }}>{val}</div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

export default function OptimiserTab({ t, toast }) {
  const [sub, setSub] = useState("stops");
  const [version, setVersion] = useState(0);
  const refresh = () => setVersion((v) => v + 1);
  // re-read store on every refresh tick
  const stops = useMemo(() => store.getStopsWithStatus(), [version]);
  const fleet = useMemo(() => store.getFleet(), [version]);
  const depot = useMemo(() => store.getDepot(), [version]);
  const routes = useMemo(() => store.getRoutes(), [version]);
  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <Segmented t={t} value={sub} onChange={setSub} options={[["stops", "Stops"], ["plan", "Fleet plan"], ["new", "Planner"]]} />
      </div>
      {sub === "stops" && <StopsView t={t} toast={toast} stops={stops} viewStops={stops} routes={routes} refresh={refresh} />}
      {sub === "plan" && <FleetPlanView t={t} />}
      {sub === "new" && <NewPlanView t={t} toast={toast} />}
    </div>
  );
}
