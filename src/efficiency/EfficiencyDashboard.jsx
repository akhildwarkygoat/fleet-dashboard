/*
  Transport Efficiency Dashboard
  ------------------------------------------------------------------
  Implements the six functional modules from the Transport Efficiency
  Dashboard PRD (v1.0), built on the KPI definitions in §6:

    7.1 Cost & Fleet Performance   (Priority 1)
    7.3 Retention & Attrition      (Priority 2)
    7.2 Utilization & Route Opt.   (Priority 3)
    7.4 Recruitment Geography      (Priority 4)
    7.5 Absenteeism (daily)
    7.6 Satisfaction

  Self-contained: it carries its own PRD-shaped sample dataset (bus type,
  ownership, cost components, area mapping, attrition, commute, satisfaction)
  so it can run before the ERP Phase-0 linkage is wired. It takes only the
  shared theme object `t` and `toast` from the host app.

  NOTE (per PRD §4 & §5): every bus-level number here is computed from the
  Employee → Pickup → Route → Bus → Attendance linkage. The sample values
  stand in for that feed until IT delivers it.
*/
import React, { useState, useMemo } from "react";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  BarChart, Bar, Cell, ScatterChart, Scatter, ZAxis, ReferenceLine,
} from "recharts";
import {
  Gauge, TrendingDown, Users, MapPin, CalendarX, Star, AlertTriangle,
  ArrowUpRight, ArrowDownRight, Download, Info,
} from "lucide-react";

/* ============================ FORMAT HELPERS ============================ */
const inr = (n) => "₹" + Math.round(n || 0).toLocaleString("en-IN");
const inrK = (n) => {
  const a = Math.abs(n || 0), s = n < 0 ? "-" : "";
  if (a >= 1e7) return s + "₹" + (a / 1e7).toFixed(2) + "Cr";
  if (a >= 1e5) return s + "₹" + (a / 1e5).toFixed(1) + "L";
  if (a >= 1e3) return s + "₹" + Math.round(a / 1e3) + "k";
  return s + "₹" + Math.round(a);
};
const pct = (n, d = 0) => (n || 0).toFixed(d) + "%";
const n1 = (n) => (n || 0).toLocaleString("en-IN", { maximumFractionDigits: 1 });
const n2 = (n) => (n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });
const WORKING_DAYS = 26;                       // PRD §11 Q2 — fixed month assumption (configurable)
const UNDERUTIL_THRESHOLD = 70;                // PRD §7.2 / §11 Q4 — load-factor floor
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun"];

/* deterministic tiny PRNG so trends are stable across re-renders */
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

/* ============================ SAMPLE DATA (PRD-shaped) ============================ */
/*
  Each bus carries a full cost basis (PRD §6). Rented buses bill on a per-km
  rate that bundles driver+fuel+maintenance (PRD §11 Q1 assumption); owned buses
  carry EMI + driver + fuel + maintenance separately.
*/
function buildFleet() {
  const raw = [
    // unit, code, route, area, type(capacity), ownership, monthlyKm, uniqueEmp, avgRiders, absentPct, commuteMin, satisfaction, cost basis
    ["Gainup", "GN-55A", "Salem Town – Unit", "Salem Town", 55, "own", 3120, 52, 47, 6.4, 42, 4.3,
      { emi: 78000, driver: 22000, fuel: 61000, maint: 14000, tolls: 5200, insurance: 9000 }],
    ["Gainup", "GN-55B", "Attur – Unit", "Attur", 55, "rented", 4680, 41, 34, 11.2, 68, 3.4,
      { perKm: 42, tolls: 7800, insurance: 0 }],
    ["Gainup", "GN-25A", "Omalur – Unit", "Omalur", 25, "own", 2340, 24, 22, 5.1, 36, 4.5,
      { emi: 41000, driver: 21000, fuel: 39000, maint: 9000, tolls: 3100, insurance: 6000 }],
    ["Gainup", "GN-25B", "Mettur – Unit", "Mettur", 25, "rented", 3900, 22, 13, 14.6, 74, 3.1,
      { perKm: 31, tolls: 6100, insurance: 0 }],
    ["Gainup", "GN-15A", "Yercaud – Unit", "Yercaud", 15, "own", 2860, 15, 14, 4.2, 58, 4.6,
      { emi: 28000, driver: 20000, fuel: 33000, maint: 7000, tolls: 4200, insurance: 4500 }],
    ["Technotek", "TT-55A", "Namakkal – Plant", "Namakkal", 55, "rented", 5460, 49, 40, 9.8, 71, 3.6,
      { perKm: 40, tolls: 9100, insurance: 0 }],
    ["Technotek", "TT-25A", "Rasipuram – Plant", "Rasipuram", 25, "own", 2600, 25, 23, 5.6, 44, 4.4,
      { emi: 40000, driver: 21000, fuel: 41000, maint: 10000, tolls: 3600, insurance: 6000 }],
    ["Technotek", "TT-15A", "Sankari – Plant", "Sankari", 15, "rented", 2080, 14, 8, 17.3, 52, 2.9,
      { perKm: 29, tolls: 3400, insurance: 0 }],
    ["Technotek", "TT-15B", "Edappadi – Plant", "Edappadi", 15, "own", 2470, 15, 13, 6.1, 49, 4.2,
      { emi: 27000, driver: 20000, fuel: 31000, maint: 6500, tolls: 3900, insurance: 4500 }],
    ["Technotek", "TT-25C", "Valapady – Plant", "Valapady", 25, "rented", 3380, 23, 19, 8.4, 61, 3.8,
      { perKm: 33, tolls: 5200, insurance: 0 }],
  ];
  return raw.map((r, i) => {
    const [unit, code, route, area, capacity, ownership, km, uniqueEmp, avgRiders, absentPct, commuteMin, sat, cost] = r;
    const monthlyCost = ownership === "rented"
      ? km * cost.perKm + cost.tolls + cost.insurance
      : cost.emi + cost.driver + cost.fuel + cost.maint + cost.tolls + cost.insurance;
    // normalise both ownership types into a common component breakdown for the drill-down
    const components = ownership === "rented"
      ? [
          { k: "Per-km hire", v: km * cost.perKm, note: `${km} km × ₹${cost.perKm} (incl. driver, fuel, maint.)` },
          { k: "Tolls", v: cost.tolls },
          { k: "Insurance/permits", v: cost.insurance },
        ]
      : [
          { k: "Loan EMI", v: cost.emi },
          { k: "Driver salary", v: cost.driver },
          { k: "Fuel", v: cost.fuel },
          { k: "Maintenance", v: cost.maint },
          { k: "Tolls", v: cost.tolls },
          { k: "Insurance", v: cost.insurance },
        ];
    return {
      id: "b" + i, unit, code, route, area, capacity, ownership, km, uniqueEmp, avgRiders,
      absentPct, commuteMin, satisfaction: sat, monthlyCost, components,
      // ---- KPIs (PRD §6) ----
      costPerHeadMonth: monthlyCost / uniqueEmp,
      costPerHeadDay: monthlyCost / (avgRiders * WORKING_DAYS),
      loadFactor: (avgRiders / capacity) * 100,
      cpk: monthlyCost / km,
      costPerSeatKm: monthlyCost / km / capacity,
    };
  });
}
const FLEET = buildFleet();

/* Areas — recruitment geography (PRD §7.4). hires/exits over the last quarter. */
const AREAS = [
  { area: "Salem Town", lat: 62, lng: 30, hires: 14, exits: 4, headcount: 52, avgTakeHome: 16800 },
  { area: "Attur", lat: 78, lng: 68, hires: 9, exits: 11, headcount: 41, avgTakeHome: 15200 },
  { area: "Omalur", lat: 40, lng: 24, hires: 8, exits: 2, headcount: 24, avgTakeHome: 17100 },
  { area: "Mettur", lat: 22, lng: 74, hires: 6, exits: 9, headcount: 22, avgTakeHome: 14600 },
  { area: "Yercaud", lat: 48, lng: 52, hires: 4, exits: 1, headcount: 15, avgTakeHome: 17400 },
  { area: "Namakkal", lat: 84, lng: 40, hires: 12, exits: 10, headcount: 49, avgTakeHome: 15600 },
  { area: "Rasipuram", lat: 70, lng: 18, hires: 7, exits: 2, headcount: 25, avgTakeHome: 16900 },
  { area: "Sankari", lat: 30, lng: 44, hires: 5, exits: 8, headcount: 14, avgTakeHome: 14200 },
  { area: "Edappadi", lat: 52, lng: 84, hires: 6, exits: 3, headcount: 15, avgTakeHome: 16400 },
  { area: "Valapady", lat: 66, lng: 58, hires: 7, exits: 5, headcount: 23, avgTakeHome: 16100 },
];

/* 6-month monthly trend series, derived deterministically from each bus's current KPIs. */
function monthlySeries() {
  return MONTHS.map((m, mi) => {
    const row = { month: m };
    let totCost = 0, totEmp = 0, totRiders = 0, totCap = 0, exits = 0, head = 0, satSum = 0, absSum = 0;
    FLEET.forEach((b, bi) => {
      const r = rng(mi * 97 + bi * 13);
      const drift = 1 + (mi - 5) * 0.012 + (r() - 0.5) * 0.06;   // gentle month-on-month drift
      const cph = b.costPerHeadMonth * drift;
      row[b.code] = Math.round(cph);
      totCost += b.monthlyCost * drift; totEmp += b.uniqueEmp;
      totRiders += b.avgRiders; totCap += b.capacity;
      satSum += b.satisfaction * (1 + (r() - 0.5) * 0.05); absSum += b.absentPct * (1 + (r() - 0.5) * 0.15);
    });
    row.fleetCph = Math.round(totCost / totEmp);
    row.loadFactor = +((totRiders / totCap) * 100).toFixed(1);
    row.satisfaction = +(satSum / FLEET.length).toFixed(2);
    row.absenteeism = +(absSum / FLEET.length).toFixed(1);
    // attrition % builds through the period on high-commute routes
    AREAS.forEach((a) => { exits += a.exits * (0.1 + mi * 0.03); head += a.headcount; });
    row.attrition = +((exits / head) * 100).toFixed(1);
    return row;
  });
}
const SERIES = monthlySeries();

/* 14-day daily absenteeism per bus (PRD §7.5 — daily refresh). */
function dailyAbsence() {
  const days = [];
  for (let d = 13; d >= 0; d--) {
    const row = { day: `D-${d}` };
    FLEET.forEach((b, bi) => {
      const r = rng(d * 31 + bi * 7);
      row[b.code] = +Math.max(0, b.absentPct * (1 + (r() - 0.5) * 0.5)).toFixed(1);
    });
    days.push(row);
  }
  return days;
}
const DAILY_ABSENCE = dailyAbsence();

/* fleet-wide roll-ups */
const FLEET_AGG = (() => {
  const cost = FLEET.reduce((s, b) => s + b.monthlyCost, 0);
  const emp = FLEET.reduce((s, b) => s + b.uniqueEmp, 0);
  const riders = FLEET.reduce((s, b) => s + b.avgRiders, 0);
  const cap = FLEET.reduce((s, b) => s + b.capacity, 0);
  const km = FLEET.reduce((s, b) => s + b.km, 0);
  return {
    cost, emp, riders, cap, km,
    cph: cost / emp,
    loadFactor: (riders / cap) * 100,
    costPerSeatKm: cost / km / (cap / FLEET.length),
    absenteeism: FLEET.reduce((s, b) => s + b.absentPct, 0) / FLEET.length,
    satisfaction: FLEET.reduce((s, b) => s + b.satisfaction, 0) / FLEET.length,
    attrition: (AREAS.reduce((s, a) => s + a.exits, 0) / AREAS.reduce((s, a) => s + a.headcount, 0)) * 100,
  };
})();

/* ============================ LOCAL UI PRIMITIVES ============================ */
function Card({ t, children, className = "", title, hint, right }) {
  return (
    <div className={"rounded-2xl border " + className} style={{ background: t.surface, borderColor: t.border }}>
      {(title || right) && (
        <div className="flex items-start justify-between px-5 pt-4 pb-1 gap-3">
          <div>
            {title && <h3 className="font-semibold tracking-wide uppercase text-sm" style={{ color: t.text }}>{title}</h3>}
            {hint && <p className="text-xs mt-1" style={{ color: t.muted }}>{hint}</p>}
          </div>
          {right}
        </div>
      )}
      <div className="p-5 pt-3">{children}</div>
    </div>
  );
}
function Tile({ t, label, value, sub, accent, delta }) {
  return (
    <div className="rounded-2xl border p-4 relative overflow-hidden" style={{ background: t.surface, borderColor: t.border }}>
      <span className="absolute left-0 top-0 bottom-0 w-1" style={{ background: accent || t.primary }} />
      <div className="text-xs uppercase tracking-widest" style={{ color: t.muted }}>{label}</div>
      <div className="text-3xl font-bold mt-2 tabular-nums" style={{ color: t.text }}>{value}</div>
      {sub && (
        <div className="text-xs mt-1 flex items-center gap-1" style={{ color: delta ? (delta > 0 ? t.poor : t.good) : t.muted }}>
          {delta != null && (delta > 0 ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />)}
          {sub}
        </div>
      )}
    </div>
  );
}
function Chip({ t, color, children }) {
  return <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold" style={{ background: color + "22", color }}>{children}</span>;
}
function SubNav({ t, value, onChange, items }) {
  return (
    <div className="flex flex-wrap gap-1.5 mb-5">
      {items.map(([k, label, Icon]) => {
        const on = value === k;
        return (
          <button key={k} onClick={() => onChange(k)} className="inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-semibold transition"
            style={{ background: on ? t.primary : t.surface, color: on ? (t.onPrimary || "#fff") : t.muted, border: "1px solid " + (on ? t.primary : t.border) }}>
            <Icon size={15} /> {label}
          </button>
        );
      })}
    </div>
  );
}
function makeTooltip(t, fmt) {
  return function TT({ active, payload, label }) {
    if (!active || !payload || !payload.length) return null;
    return (
      <div className="rounded-lg px-3 py-2 text-xs" style={{ background: t.raised, border: "1px solid " + t.border, color: t.text }}>
        {label != null && <div className="font-semibold mb-1">{label}</div>}
        {payload.map((p, i) => <div key={i} style={{ color: p.color || p.fill }}>{p.name}: {fmt ? fmt(p.value, p) : n1(p.value)}</div>)}
      </div>
    );
  };
}
const UNIT_COLOR = (t, u) => (u === "Gainup" ? t.gainup : t.techno);
const TYPE_COLOR = (t, cap) => (cap === 55 ? t.primary : cap === 25 ? t.techno : t.watch);
const loadColor = (t, lf) => (lf >= 85 ? t.good : lf >= UNDERUTIL_THRESHOLD ? t.watch : t.poor);
const satColor = (t, s) => (s >= 4 ? t.good : s >= 3.4 ? t.watch : t.poor);

/* CSV export helper (PRD §9 — export to Excel/PDF; CSV opens natively in Excel) */
function exportCsv(filename, rows, toast) {
  if (!rows.length) return;
  const cols = Object.keys(rows[0]);
  const body = [cols.join(","), ...rows.map((r) => cols.map((c) => JSON.stringify(r[c] ?? "")).join(","))].join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([body], { type: "text/csv" }));
  a.download = filename; a.click();
  toast && toast("Exported " + filename);
}

/* ============================ 7.1 COST & FLEET PERFORMANCE ============================ */
function CostFleetView({ t, toast }) {
  const [sel, setSel] = useState(null);
  const TT = makeTooltip(t, (v, p) => (p.name.includes("head") || p.name.includes("seat") || p.name.includes("km") ? inr(v) : n1(v)));

  const ranked = [...FLEET].sort((a, b) => b.costPerHeadMonth - a.costPerHeadMonth);
  const bar = ranked.map((b) => ({ code: b.code, cph: Math.round(b.costPerHeadMonth), fill: UNIT_COLOR(t, b.unit) }));

  // bus-type comparison (55 vs 25 vs 15) — cost/seat-km, load factor, cost/head
  const byType = [55, 25, 15].map((cap) => {
    const g = FLEET.filter((b) => b.capacity === cap);
    const cost = g.reduce((s, b) => s + b.monthlyCost, 0), km = g.reduce((s, b) => s + b.km, 0);
    const riders = g.reduce((s, b) => s + b.avgRiders, 0), c = g.reduce((s, b) => s + b.capacity, 0);
    const emp = g.reduce((s, b) => s + b.uniqueEmp, 0);
    return { type: cap + "-seat", n: g.length, costPerSeatKm: +(cost / km / cap).toFixed(2), loadFactor: +((riders / c) * 100).toFixed(1), cph: Math.round(cost / emp) };
  });
  // owned vs rented on common basis
  const byOwn = ["own", "rented"].map((o) => {
    const g = FLEET.filter((b) => b.ownership === o);
    const cost = g.reduce((s, b) => s + b.monthlyCost, 0), km = g.reduce((s, b) => s + b.km, 0);
    const riders = g.reduce((s, b) => s + b.avgRiders, 0), c = g.reduce((s, b) => s + b.capacity, 0);
    const emp = g.reduce((s, b) => s + b.uniqueEmp, 0);
    return { own: o === "own" ? "Owned" : "Rented", n: g.length, cph: Math.round(cost / emp), costPerSeatKm: +(cost / km / (c / g.length)).toFixed(2), loadFactor: +((riders / c) * 100).toFixed(1) };
  });

  const selBus = FLEET.find((b) => b.id === sel);

  return (
    <div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <Tile t={t} label="Fleet cost / month" value={inrK(FLEET_AGG.cost)} sub={`${FLEET.length} buses · ${FLEET_AGG.emp} riders`} accent={t.primary} />
        <Tile t={t} label="Avg cost / head · mo" value={inr(FLEET_AGG.cph)} sub="direct lever on CTC" accent={t.watch} />
        <Tile t={t} label="Cost / seat-km" value={"₹" + n2(FLEET_AGG.costPerSeatKm)} sub="apples-to-apples metric" accent={t.techno} />
        <Tile t={t} label="Fleet load factor" value={pct(FLEET_AGG.loadFactor, 0)} sub="read cost/head with this" accent={loadColor(t, FLEET_AGG.loadFactor)} />
      </div>

      <Card t={t} title="Cost per head ranking — all buses" hint="Highest cost/head first. Bar colour = unit. Click a bar to drill into its cost basis."
        right={<button onClick={() => exportCsv("cost_per_head.csv", ranked.map((b) => ({ code: b.code, route: b.route, type: b.capacity, ownership: b.ownership, costPerHeadMonth: Math.round(b.costPerHeadMonth), loadFactor: +b.loadFactor.toFixed(1), costPerSeatKm: +b.costPerSeatKm.toFixed(2) })), toast)} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold" style={{ border: "1px solid " + t.border, color: t.muted }}><Download size={13} /> CSV</button>}>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={bar} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={t.grid} vertical={false} />
            <XAxis dataKey="code" tick={{ fill: t.muted, fontSize: 11 }} tickLine={false} axisLine={{ stroke: t.border }} />
            <YAxis tick={{ fill: t.muted, fontSize: 11 }} tickLine={false} axisLine={false} width={54} tickFormatter={(v) => inrK(v)} />
            <Tooltip content={TT} cursor={{ fill: t.primarySoft }} />
            <ReferenceLine y={FLEET_AGG.cph} stroke={t.faint} strokeDasharray="4 4" label={{ value: "fleet avg", fill: t.muted, fontSize: 10, position: "right" }} />
            <Bar dataKey="cph" name="Cost / head" radius={[6, 6, 0, 0]} onClick={(d) => setSel(FLEET.find((b) => b.code === d.code)?.id)}>
              {bar.map((d, i) => <Cell key={i} fill={d.fill} cursor="pointer" />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </Card>

      <div className="grid lg:grid-cols-2 gap-4 mt-4">
        <Card t={t} title="Bus-type comparison" hint="55 vs 25 vs 15 seat — the right-sizing view.">
          <table className="w-full text-sm">
            <thead><tr style={{ color: t.muted }} className="text-xs uppercase tracking-wider text-left">
              <th className="pb-2">Type</th><th className="pb-2 text-right">Buses</th><th className="pb-2 text-right">Cost/seat-km</th><th className="pb-2 text-right">Load factor</th><th className="pb-2 text-right">Cost/head</th>
            </tr></thead>
            <tbody>
              {byType.map((r) => (
                <tr key={r.type} style={{ borderTop: "1px solid " + t.border }}>
                  <td className="py-2 font-semibold" style={{ color: t.text }}>{r.type}</td>
                  <td className="py-2 text-right tabular-nums" style={{ color: t.muted }}>{r.n}</td>
                  <td className="py-2 text-right tabular-nums" style={{ color: t.text }}>₹{n2(r.costPerSeatKm)}</td>
                  <td className="py-2 text-right"><Chip t={t} color={loadColor(t, r.loadFactor)}>{pct(r.loadFactor, 0)}</Chip></td>
                  <td className="py-2 text-right tabular-nums" style={{ color: t.text }}>{inr(r.cph)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-xs mt-3 flex items-start gap-1.5" style={{ color: t.muted }}><Info size={13} className="mt-0.5 shrink-0" /> Cost/seat-km + load factor read as a pair (PRD §6). Low cost/head with a low load factor is hiding waste.</p>
        </Card>

        <Card t={t} title="Owned vs rented" hint="Normalised to a common monthly basis (PRD §6).">
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={byOwn} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={t.grid} vertical={false} />
              <XAxis dataKey="own" tick={{ fill: t.muted, fontSize: 11 }} tickLine={false} axisLine={{ stroke: t.border }} />
              <YAxis yAxisId="l" tick={{ fill: t.muted, fontSize: 11 }} tickLine={false} axisLine={false} width={54} tickFormatter={(v) => inrK(v)} />
              <YAxis yAxisId="r" orientation="right" tick={{ fill: t.muted, fontSize: 11 }} tickLine={false} axisLine={false} width={38} tickFormatter={(v) => v + "%"} />
              <Tooltip content={makeTooltip(t, (v, p) => (p.name === "Load factor" ? pct(v, 0) : inr(v)))} cursor={{ fill: t.primarySoft }} />
              <Legend wrapperStyle={{ fontSize: 11, color: t.muted }} />
              <Bar yAxisId="l" dataKey="cph" name="Cost / head" fill={t.watch} radius={[6, 6, 0, 0]} />
              <Bar yAxisId="r" dataKey="loadFactor" name="Load factor" fill={t.good} radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>

      <Card t={t} className="mt-4" title="Cost/head trend — per bus" hint="Monthly cost per head over the last 6 months. Dashed = fleet average.">
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={SERIES} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={t.grid} vertical={false} />
            <XAxis dataKey="month" tick={{ fill: t.muted, fontSize: 11 }} tickLine={false} axisLine={{ stroke: t.border }} />
            <YAxis tick={{ fill: t.muted, fontSize: 11 }} tickLine={false} axisLine={false} width={54} tickFormatter={(v) => inrK(v)} />
            <Tooltip content={makeTooltip(t, (v) => inr(v))} />
            {FLEET.map((b) => <Line key={b.id} type="monotone" dataKey={b.code} stroke={UNIT_COLOR(t, b.unit)} strokeWidth={sel === b.id ? 3 : 1} strokeOpacity={sel && sel !== b.id ? 0.15 : 0.75} dot={false} />)}
            <Line type="monotone" dataKey="fleetCph" name="Fleet avg" stroke={t.text} strokeWidth={2.5} strokeDasharray="5 4" dot={false} />
          </LineChart>
        </ResponsiveContainer>
        <p className="text-xs mt-2" style={{ color: t.muted }}>{selBus ? `Highlighting ${selBus.code}. ` : ""}Click a bar above to isolate a bus's line.</p>
      </Card>

      {selBus && (
        <Card t={t} className="mt-4" title={`Drill-down — ${selBus.code}`} hint={`${selBus.route} · ${selBus.capacity}-seat · ${selBus.ownership} · ${selBus.unit}`}
          right={<button onClick={() => setSel(null)} className="rounded-lg px-3 py-1.5 text-xs" style={{ border: "1px solid " + t.border, color: t.muted }}>Close</button>}>
          <div className="grid md:grid-cols-2 gap-5">
            <div>
              <div className="text-xs uppercase tracking-wider mb-2" style={{ color: t.muted }}>Cost components / month</div>
              {selBus.components.map((c) => {
                const share = (c.v / selBus.monthlyCost) * 100;
                return (
                  <div key={c.k} className="mb-2">
                    <div className="flex justify-between text-sm mb-1"><span style={{ color: t.text }}>{c.k}</span><span className="tabular-nums" style={{ color: t.text }}>{inr(c.v)} <span style={{ color: t.faint }}>· {pct(share, 0)}</span></span></div>
                    <div className="h-2 rounded-full overflow-hidden" style={{ background: t.surface2 }}><div className="h-full rounded-full" style={{ width: pct(share, 0), background: t.primary }} /></div>
                    {c.note && <div className="text-xs mt-0.5" style={{ color: t.faint }}>{c.note}</div>}
                  </div>
                );
              })}
              <div className="flex justify-between text-sm font-bold mt-3 pt-2" style={{ borderTop: "1px solid " + t.border, color: t.text }}><span>Total / month</span><span className="tabular-nums">{inr(selBus.monthlyCost)}</span></div>
            </div>
            <div className="grid grid-cols-2 gap-3 content-start">
              {[["Cost / head · mo", inr(selBus.costPerHeadMonth), t.watch], ["Cost / head · day", inr(selBus.costPerHeadDay), t.watch],
                ["Load factor", pct(selBus.loadFactor, 0), loadColor(t, selBus.loadFactor)], ["Cost / km", inr(selBus.cpk), t.techno],
                ["Cost / seat-km", "₹" + n2(selBus.costPerSeatKm), t.techno], ["Monthly km", n1(selBus.km), t.primary],
                ["Unique riders", selBus.uniqueEmp, t.good], ["Avg daily riders", `${selBus.avgRiders} / ${selBus.capacity}`, t.good]].map(([l, v, c]) => (
                <div key={l} className="rounded-xl p-3" style={{ background: t.surface2, border: "1px solid " + t.border }}>
                  <div className="text-xs" style={{ color: t.muted }}>{l}</div>
                  <div className="text-lg font-bold tabular-nums mt-0.5" style={{ color: c }}>{v}</div>
                </div>
              ))}
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}

/* ============================ 7.2 UTILIZATION & ROUTE OPTIMIZATION ============================ */
function UtilizationView({ t, toast }) {
  const rows = [...FLEET].sort((a, b) => a.loadFactor - b.loadFactor).map((b) => {
    let action = "Healthy — hold";
    if (b.loadFactor < UNDERUTIL_THRESHOLD) {
      // suggest the next smaller standard size that would still seat current riders
      const smaller = [15, 25, 55].filter((c) => c < b.capacity && c >= b.avgRiders)[0];
      action = smaller ? `Downsize → ${smaller}-seat` : "Consolidate / merge route";
    } else if (b.loadFactor >= 95) {
      action = "Near-full — consider adding capacity";
    }
    return { ...b, action };
  });
  const under = rows.filter((b) => b.loadFactor < UNDERUTIL_THRESHOLD);

  return (
    <div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <Tile t={t} label="Fleet load factor" value={pct(FLEET_AGG.loadFactor, 0)} accent={loadColor(t, FLEET_AGG.loadFactor)} sub="riders ÷ seats" />
        <Tile t={t} label={`Underutilised (<${UNDERUTIL_THRESHOLD}%)`} value={under.length} accent={t.poor} sub={`of ${FLEET.length} buses`} />
        <Tile t={t} label="Empty seat-km / mo" value={inrK(under.reduce((s, b) => s + (b.capacity - b.avgRiders) * b.costPerSeatKm * b.km, 0))} accent={t.watch} sub="wasted spend on empties" />
        <Tile t={t} label="Near-full (≥95%)" value={rows.filter((b) => b.loadFactor >= 95).length} accent={t.good} sub="candidates for more capacity" />
      </div>

      <Card t={t} title="Load factor heatmap — by route" hint={`Green ≥85% · Amber ${UNDERUTIL_THRESHOLD}–85% · Red <${UNDERUTIL_THRESHOLD}%. Sorted lowest first.`}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 10 }}>
          {rows.map((b) => (
            <div key={b.id} className="rounded-xl p-3" style={{ background: loadColor(t, b.loadFactor) + "1e", border: "1px solid " + loadColor(t, b.loadFactor) }}>
              <div className="text-xs font-semibold truncate" style={{ color: t.text }}>{b.route}</div>
              <div className="text-2xl font-bold tabular-nums mt-1" style={{ color: loadColor(t, b.loadFactor) }}>{pct(b.loadFactor, 0)}</div>
              <div className="text-xs" style={{ color: t.muted }}>{b.avgRiders}/{b.capacity} · {b.capacity}-seat {b.ownership}</div>
            </div>
          ))}
        </div>
      </Card>

      <Card t={t} className="mt-4" title="Right-sizing actions" hint="Rule-based v1 (PRD §7.2). Downsize suggestions keep the next standard size that still seats current riders."
        right={<button onClick={() => exportCsv("route_actions.csv", rows.map((b) => ({ code: b.code, route: b.route, type: b.capacity, avgRiders: b.avgRiders, loadFactor: +b.loadFactor.toFixed(1), action: b.action })), toast)} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold" style={{ border: "1px solid " + t.border, color: t.muted }}><Download size={13} /> CSV</button>}>
        <table className="w-full text-sm">
          <thead><tr style={{ color: t.muted }} className="text-xs uppercase tracking-wider text-left">
            <th className="pb-2">Route</th><th className="pb-2 text-right">Riders/seats</th><th className="pb-2 text-right">Load</th><th className="pb-2">Suggested action</th>
          </tr></thead>
          <tbody>
            {rows.map((b) => (
              <tr key={b.id} style={{ borderTop: "1px solid " + t.border }}>
                <td className="py-2" style={{ color: t.text }}><span className="font-semibold">{b.code}</span> · <span style={{ color: t.muted }}>{b.route}</span></td>
                <td className="py-2 text-right tabular-nums" style={{ color: t.text }}>{b.avgRiders}/{b.capacity}</td>
                <td className="py-2 text-right"><Chip t={t} color={loadColor(t, b.loadFactor)}>{pct(b.loadFactor, 0)}</Chip></td>
                <td className="py-2" style={{ color: b.action.startsWith("Healthy") ? t.muted : b.action.startsWith("Near") ? t.good : t.poor }}>
                  {!b.action.startsWith("Healthy") && <AlertTriangle size={13} className="inline mr-1 -mt-0.5" />}{b.action}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

/* ============================ 7.3 RETENTION & ATTRITION ============================ */
function RetentionView({ t, toast }) {
  // attrition % by route/area = exits ÷ headcount, joined with the serving bus's commute + deduction
  const rows = FLEET.map((b) => {
    const a = AREAS.find((x) => x.area === b.area) || { exits: 0, hires: 0, headcount: b.uniqueEmp, avgTakeHome: 16000 };
    const attrition = (a.exits / a.headcount) * 100;
    const deductPctTakeHome = (b.costPerHeadMonth / a.avgTakeHome) * 100;
    return { code: b.code, area: b.area, route: b.route, commuteMin: b.commuteMin, attrition: +attrition.toFixed(1), deductPctTakeHome: +deductPctTakeHome.toFixed(1), exits: a.exits, headcount: a.headcount, fill: UNIT_COLOR(t, b.unit) };
  }).sort((a, b) => b.attrition - a.attrition);

  const scatter = rows.map((r) => ({ x: r.commuteMin, y: r.attrition, z: r.headcount, code: r.code, fill: r.attrition > FLEET_AGG.attrition ? t.poor : t.good }));

  return (
    <div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <Tile t={t} label="Fleet attrition" value={pct(FLEET_AGG.attrition, 1)} accent={t.poor} sub="exits ÷ headcount (qtr)" />
        <Tile t={t} label="Worst route" value={rows[0].code} accent={t.poor} sub={`${pct(rows[0].attrition, 1)} · ${rows[0].commuteMin} min commute`} />
        <Tile t={t} label="Avg commute" value={`${Math.round(FLEET.reduce((s, b) => s + b.commuteMin, 0) / FLEET.length)} min`} accent={t.techno} sub="board → alight, per route" />
        <Tile t={t} label="Transport as % take-home" value={pct(rows.reduce((s, r) => s + r.deductPctTakeHome, 0) / rows.length, 1)} accent={t.watch} sub="avg deduction weight" />
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card t={t} title="Commute time vs attrition" hint="Does a longer commute correlate with leaving? Bubble size = headcount. Red = above-average attrition.">
          <ResponsiveContainer width="100%" height={280}>
            <ScatterChart margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={t.grid} />
              <XAxis type="number" dataKey="x" name="Commute" unit=" min" tick={{ fill: t.muted, fontSize: 11 }} tickLine={false} axisLine={{ stroke: t.border }} />
              <YAxis type="number" dataKey="y" name="Attrition" unit="%" tick={{ fill: t.muted, fontSize: 11 }} tickLine={false} axisLine={false} width={40} />
              <ZAxis type="number" dataKey="z" range={[60, 400]} />
              <Tooltip cursor={{ strokeDasharray: "3 3" }} content={({ active, payload }) => {
                if (!active || !payload || !payload.length) return null;
                const d = payload[0].payload;
                return <div className="rounded-lg px-3 py-2 text-xs" style={{ background: t.raised, border: "1px solid " + t.border, color: t.text }}>
                  <div className="font-semibold mb-0.5">{d.code}</div><div>Commute: {d.x} min</div><div>Attrition: {pct(d.y, 1)}</div><div>Headcount: {d.z}</div>
                </div>;
              }} />
              <ReferenceLine y={FLEET_AGG.attrition} stroke={t.faint} strokeDasharray="4 4" />
              <Scatter data={scatter}>{scatter.map((d, i) => <Cell key={i} fill={d.fill} />)}</Scatter>
            </ScatterChart>
          </ResponsiveContainer>
        </Card>

        <Card t={t} title="Attrition trend" hint="Fleet attrition % building through the period (PRD §7.3).">
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={SERIES} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={t.grid} vertical={false} />
              <XAxis dataKey="month" tick={{ fill: t.muted, fontSize: 11 }} tickLine={false} axisLine={{ stroke: t.border }} />
              <YAxis tick={{ fill: t.muted, fontSize: 11 }} tickLine={false} axisLine={false} width={40} tickFormatter={(v) => v + "%"} />
              <Tooltip content={makeTooltip(t, (v) => pct(v, 1))} />
              <Line type="monotone" dataKey="attrition" name="Attrition" stroke={t.poor} strokeWidth={2.5} dot={{ r: 2.5 }} />
            </LineChart>
          </ResponsiveContainer>
        </Card>
      </div>

      <Card t={t} className="mt-4" title="Attrition & transport-cost weight by route" hint="Where transport deduction eats most into take-home — the routes where cost most hurts retention."
        right={<button onClick={() => exportCsv("attrition_by_route.csv", rows, toast)} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold" style={{ border: "1px solid " + t.border, color: t.muted }}><Download size={13} /> CSV</button>}>
        <table className="w-full text-sm">
          <thead><tr style={{ color: t.muted }} className="text-xs uppercase tracking-wider text-left">
            <th className="pb-2">Route / area</th><th className="pb-2 text-right">Commute</th><th className="pb-2 text-right">Exits/head</th><th className="pb-2 text-right">Attrition</th><th className="pb-2 text-right">Transport % take-home</th>
          </tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.code} style={{ borderTop: "1px solid " + t.border }}>
                <td className="py-2" style={{ color: t.text }}><span className="font-semibold">{r.code}</span> · <span style={{ color: t.muted }}>{r.area}</span></td>
                <td className="py-2 text-right tabular-nums" style={{ color: r.commuteMin > 60 ? t.poor : t.text }}>{r.commuteMin} min</td>
                <td className="py-2 text-right tabular-nums" style={{ color: t.muted }}>{r.exits}/{r.headcount}</td>
                <td className="py-2 text-right"><Chip t={t} color={r.attrition > FLEET_AGG.attrition ? t.poor : t.good}>{pct(r.attrition, 1)}</Chip></td>
                <td className="py-2 text-right tabular-nums" style={{ color: r.deductPctTakeHome > 6 ? t.watch : t.text }}>{pct(r.deductPctTakeHome, 1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

/* ============================ 7.4 RECRUITMENT GEOGRAPHY ============================ */
function RecruitmentView({ t, toast }) {
  // overlay each area with the serving bus's seat capacity + cost-to-serve
  const rows = AREAS.map((a) => {
    const bus = FLEET.find((b) => b.area === a.area);
    const net = a.hires - a.exits;
    const seatCapacity = bus ? bus.capacity : 0;
    const spare = bus ? bus.capacity - bus.avgRiders : 0;
    const costToServe = bus ? bus.monthlyCost / (a.headcount || 1) : 0;      // allocated bus cost ÷ employees from area
    // yield score: net retention weighted down by cost-to-serve (higher = better place to hire)
    const score = net * 1000 - costToServe * 0.35 + spare * 400;
    return { ...a, net, seatCapacity, spare, costToServe: Math.round(costToServe), score: Math.round(score) };
  }).sort((a, b) => b.score - a.score);

  const maxAbs = Math.max(...rows.map((r) => Math.abs(r.net)), 1);

  return (
    <div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <Tile t={t} label="Net headcount (qtr)" value={(AREAS.reduce((s, a) => s + a.hires - a.exits, 0) >= 0 ? "+" : "") + AREAS.reduce((s, a) => s + a.hires - a.exits, 0)} accent={t.good} sub="hires − exits, all areas" />
        <Tile t={t} label="Best area" value={rows[0].area} accent={t.good} sub={`net ${rows[0].net >= 0 ? "+" : ""}${rows[0].net} · ${inr(rows[0].costToServe)}/head`} />
        <Tile t={t} label="Spare seats" value={rows.reduce((s, r) => s + Math.max(0, r.spare), 0)} accent={t.primary} sub="capacity ready for new hires" />
        <Tile t={t} label="Worst area" value={rows[rows.length - 1].area} accent={t.poor} sub={`net ${rows[rows.length - 1].net}`} />
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card t={t} title="Hires vs exits by source location" hint="Geographic scatter (relative positions). Green = net positive, red = net loss; dot size = headcount.">
          <div className="relative rounded-xl" style={{ height: 320, background: t.surface2, border: "1px solid " + t.border, overflow: "hidden" }}>
            {rows.map((r) => {
              const size = 26 + r.headcount * 0.7;
              const c = r.net >= 0 ? t.good : t.poor;
              return (
                <div key={r.area} title={`${r.area}: net ${r.net}`} className="absolute flex items-center justify-center rounded-full text-[10px] font-bold"
                  style={{ left: `calc(${r.lng}% - ${size / 2}px)`, top: `calc(${100 - r.lat}% - ${size / 2}px)`, width: size, height: size, background: c + "33", border: "2px solid " + c, color: t.text }}>
                  {r.net >= 0 ? "+" : ""}{r.net}
                </div>
              );
            })}
            <span className="absolute bottom-2 left-3 text-xs" style={{ color: t.faint }}>Factory catchment · schematic</span>
          </div>
        </Card>

        <Card t={t} title="Net hire/exit by area" hint="Diverging bars — hires minus exits.">
          <div className="space-y-2">
            {[...rows].sort((a, b) => b.net - a.net).map((r) => {
              const c = r.net >= 0 ? t.good : t.poor;
              const w = (Math.abs(r.net) / maxAbs) * 50;
              return (
                <div key={r.area} className="flex items-center gap-2 text-xs">
                  <span className="w-20 text-right truncate" style={{ color: t.muted }}>{r.area}</span>
                  <div className="flex-1 flex items-center" style={{ height: 18 }}>
                    <div className="w-1/2 flex justify-end"><div style={{ width: r.net < 0 ? `${w}%` : 0, height: 14, background: t.poor, borderRadius: "4px 0 0 4px" }} /></div>
                    <div className="w-px h-4" style={{ background: t.border }} />
                    <div className="w-1/2"><div style={{ width: r.net >= 0 ? `${w}%` : 0, height: 14, background: t.good, borderRadius: "0 4px 4px 0" }} /></div>
                  </div>
                  <span className="w-8 tabular-nums font-semibold" style={{ color: c }}>{r.net >= 0 ? "+" : ""}{r.net}</span>
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      <Card t={t} className="mt-4" title="Location success / failure ranking" hint="Ranked by net retention + transport efficiency. Top rows = concentrate hiring; bottom = fix transport or de-prioritise."
        right={<button onClick={() => exportCsv("recruitment_by_area.csv", rows.map(({ lat, lng, score, ...r }) => r), toast)} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold" style={{ border: "1px solid " + t.border, color: t.muted }}><Download size={13} /> CSV</button>}>
        <table className="w-full text-sm">
          <thead><tr style={{ color: t.muted }} className="text-xs uppercase tracking-wider text-left">
            <th className="pb-2">#</th><th className="pb-2">Area</th><th className="pb-2 text-right">Hires</th><th className="pb-2 text-right">Exits</th><th className="pb-2 text-right">Net</th><th className="pb-2 text-right">Spare seats</th><th className="pb-2 text-right">Cost-to-serve/head</th><th className="pb-2">Verdict</th>
          </tr></thead>
          <tbody>
            {rows.map((r, i) => {
              const good = r.net >= 3 && r.spare > 0;
              const bad = r.net < 0;
              return (
                <tr key={r.area} style={{ borderTop: "1px solid " + t.border }}>
                  <td className="py-2 tabular-nums" style={{ color: t.faint }}>{i + 1}</td>
                  <td className="py-2 font-semibold" style={{ color: t.text }}>{r.area}</td>
                  <td className="py-2 text-right tabular-nums" style={{ color: t.good }}>{r.hires}</td>
                  <td className="py-2 text-right tabular-nums" style={{ color: t.poor }}>{r.exits}</td>
                  <td className="py-2 text-right tabular-nums font-semibold" style={{ color: r.net >= 0 ? t.good : t.poor }}>{r.net >= 0 ? "+" : ""}{r.net}</td>
                  <td className="py-2 text-right tabular-nums" style={{ color: r.spare > 0 ? t.text : t.muted }}>{r.spare}</td>
                  <td className="py-2 text-right tabular-nums" style={{ color: t.text }}>{inr(r.costToServe)}</td>
                  <td className="py-2"><Chip t={t} color={good ? t.good : bad ? t.poor : t.watch}>{good ? "Concentrate hiring" : bad ? "Losing ground" : "Hold"}</Chip></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

/* ============================ 7.5 ABSENTEEISM (daily) ============================ */
function AbsenteeismView({ t, toast }) {
  const CHRONIC = 12; // % — chronic threshold
  const rows = [...FLEET].sort((a, b) => b.absentPct - a.absentPct).map((b) => ({
    ...b,
    wastedSeatKm: Math.round((b.capacity - b.avgRiders) * b.km),
    wastedCost: Math.round((b.absentPct / 100) * b.monthlyCost),
    chronic: b.absentPct >= CHRONIC,
  }));
  const chronic = rows.filter((b) => b.chronic);

  return (
    <div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <Tile t={t} label="Fleet absenteeism" value={pct(FLEET_AGG.absenteeism, 1)} accent={t.watch} sub="absent ÷ assigned (daily)" />
        <Tile t={t} label={`Chronic buses (≥${CHRONIC}%)`} value={chronic.length} accent={t.poor} sub="wasted seat-km" />
        <Tile t={t} label="Wasted spend / mo" value={inrK(rows.reduce((s, b) => s + b.wastedCost, 0))} accent={t.poor} sub="cost of empty assigned seats" />
        <Tile t={t} label="Best bus" value={rows[rows.length - 1].code} accent={t.good} sub={pct(rows[rows.length - 1].absentPct, 1)} />
      </div>

      <Card t={t} title="Daily bus-wise absenteeism — last 14 days" hint="Daily refresh (PRD §7.5). Each line is a bus; chronic buses are drawn bold.">
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={DAILY_ABSENCE} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={t.grid} vertical={false} />
            <XAxis dataKey="day" tick={{ fill: t.muted, fontSize: 10 }} tickLine={false} axisLine={{ stroke: t.border }} />
            <YAxis tick={{ fill: t.muted, fontSize: 11 }} tickLine={false} axisLine={false} width={40} tickFormatter={(v) => v + "%"} />
            <Tooltip content={makeTooltip(t, (v) => pct(v, 1))} />
            <ReferenceLine y={CHRONIC} stroke={t.poor} strokeDasharray="4 4" label={{ value: "chronic", fill: t.poor, fontSize: 10, position: "right" }} />
            {FLEET.map((b) => <Line key={b.id} type="monotone" dataKey={b.code} stroke={b.absentPct >= CHRONIC ? t.poor : UNIT_COLOR(t, b.unit)} strokeWidth={b.absentPct >= CHRONIC ? 2.5 : 1} strokeOpacity={b.absentPct >= CHRONIC ? 0.95 : 0.4} dot={false} />)}
          </LineChart>
        </ResponsiveContainer>
      </Card>

      <Card t={t} className="mt-4" title="Absenteeism ranking & wasted capacity" hint="Chronic absenteeism = seat-km you pay for but don't use."
        right={<button onClick={() => exportCsv("absenteeism.csv", rows.map((b) => ({ code: b.code, route: b.route, absenteeism: +b.absentPct.toFixed(1), wastedSeatKm: b.wastedSeatKm, wastedCostMonth: b.wastedCost, chronic: b.chronic })), toast)} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold" style={{ border: "1px solid " + t.border, color: t.muted }}><Download size={13} /> CSV</button>}>
        <table className="w-full text-sm">
          <thead><tr style={{ color: t.muted }} className="text-xs uppercase tracking-wider text-left">
            <th className="pb-2">Bus / route</th><th className="pb-2 text-right">Absenteeism</th><th className="pb-2 text-right">Wasted seat-km/mo</th><th className="pb-2 text-right">Wasted spend/mo</th><th className="pb-2">Flag</th>
          </tr></thead>
          <tbody>
            {rows.map((b) => (
              <tr key={b.id} style={{ borderTop: "1px solid " + t.border }}>
                <td className="py-2" style={{ color: t.text }}><span className="font-semibold">{b.code}</span> · <span style={{ color: t.muted }}>{b.route}</span></td>
                <td className="py-2 text-right"><Chip t={t} color={b.absentPct >= CHRONIC ? t.poor : b.absentPct >= 8 ? t.watch : t.good}>{pct(b.absentPct, 1)}</Chip></td>
                <td className="py-2 text-right tabular-nums" style={{ color: t.muted }}>{n1(b.wastedSeatKm)}</td>
                <td className="py-2 text-right tabular-nums" style={{ color: t.text }}>{inr(b.wastedCost)}</td>
                <td className="py-2" style={{ color: b.chronic ? t.poor : t.muted }}>{b.chronic ? <><AlertTriangle size={13} className="inline mr-1 -mt-0.5" />Chronic</> : "OK"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

/* ============================ 7.6 SATISFACTION ============================ */
function SatisfactionView({ t, toast }) {
  // score per bus/route, correlated with commute time and absenteeism (PRD §7.6)
  const rows = [...FLEET].sort((a, b) => a.satisfaction - b.satisfaction).map((b) => ({
    code: b.code, route: b.route, satisfaction: b.satisfaction, commuteMin: b.commuteMin, absentPct: b.absentPct,
    fill: satColor(t, b.satisfaction), low: b.satisfaction < 3.4,
  }));
  const low = rows.filter((r) => r.low);
  const scatter = FLEET.map((b) => ({ x: b.commuteMin, y: b.satisfaction, code: b.code, fill: satColor(t, b.satisfaction) }));

  return (
    <div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <Tile t={t} label="Fleet satisfaction" value={n2(FLEET_AGG.satisfaction) + " / 5"} accent={satColor(t, FLEET_AGG.satisfaction)} sub="avg rating, all riders" />
        <Tile t={t} label="Low-score buses (<3.4)" value={low.length} accent={t.poor} sub="need attention" />
        <Tile t={t} label="Worst route" value={rows[0].code} accent={t.poor} sub={`${n1(rows[0].satisfaction)}★ · ${rows[0].commuteMin} min`} />
        <Tile t={t} label="Best route" value={rows[rows.length - 1].code} accent={t.good} sub={`${n1(rows[rows.length - 1].satisfaction)}★`} />
      </div>

      {low.length > 0 && (
        <Card t={t} className="mb-4" title="Low-score alerts">
          <div className="flex flex-wrap gap-2">
            {low.map((r) => (
              <div key={r.code} className="rounded-xl px-3 py-2 flex items-center gap-2" style={{ background: t.poorSoft, border: "1px solid " + t.poor }}>
                <AlertTriangle size={15} style={{ color: t.poor }} />
                <div><div className="text-sm font-semibold" style={{ color: t.text }}>{r.code} — {n1(r.satisfaction)}★</div>
                  <div className="text-xs" style={{ color: t.muted }}>{r.commuteMin} min commute · {pct(r.absentPct, 1)} absent</div></div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <div className="grid lg:grid-cols-2 gap-4">
        <Card t={t} title="Satisfaction by route" hint="1–5 rating rolled up per bus/route.">
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={t.grid} horizontal={false} />
              <XAxis type="number" domain={[0, 5]} tick={{ fill: t.muted, fontSize: 11 }} tickLine={false} axisLine={{ stroke: t.border }} />
              <YAxis type="category" dataKey="code" tick={{ fill: t.muted, fontSize: 11 }} tickLine={false} axisLine={false} width={54} />
              <Tooltip content={makeTooltip(t, (v) => n1(v) + " ★")} cursor={{ fill: t.primarySoft }} />
              <ReferenceLine x={3.4} stroke={t.poor} strokeDasharray="4 4" />
              <Bar dataKey="satisfaction" name="Rating" radius={[0, 6, 6, 0]}>{rows.map((r, i) => <Cell key={i} fill={r.fill} />)}</Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card t={t} title="Commute time vs satisfaction" hint="Longer trips tend to score lower — the service-quality lever.">
          <ResponsiveContainer width="100%" height={300}>
            <ScatterChart margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={t.grid} />
              <XAxis type="number" dataKey="x" name="Commute" unit=" min" tick={{ fill: t.muted, fontSize: 11 }} tickLine={false} axisLine={{ stroke: t.border }} />
              <YAxis type="number" dataKey="y" name="Rating" domain={[2.5, 5]} tick={{ fill: t.muted, fontSize: 11 }} tickLine={false} axisLine={false} width={32} />
              <Tooltip cursor={{ strokeDasharray: "3 3" }} content={({ active, payload }) => {
                if (!active || !payload || !payload.length) return null;
                const d = payload[0].payload;
                return <div className="rounded-lg px-3 py-2 text-xs" style={{ background: t.raised, border: "1px solid " + t.border, color: t.text }}><div className="font-semibold">{d.code}</div><div>{d.x} min · {n1(d.y)}★</div></div>;
              }} />
              <Scatter data={scatter}>{scatter.map((d, i) => <Cell key={i} fill={d.fill} />)}</Scatter>
            </ScatterChart>
          </ResponsiveContainer>
        </Card>
      </div>

      <Card t={t} className="mt-4" title="Satisfaction trend" hint="Fleet-average rating over the period, cross-read with absenteeism.">
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={SERIES} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={t.grid} vertical={false} />
            <XAxis dataKey="month" tick={{ fill: t.muted, fontSize: 11 }} tickLine={false} axisLine={{ stroke: t.border }} />
            <YAxis yAxisId="l" domain={[2.5, 5]} tick={{ fill: t.muted, fontSize: 11 }} tickLine={false} axisLine={false} width={32} />
            <YAxis yAxisId="r" orientation="right" tick={{ fill: t.muted, fontSize: 11 }} tickLine={false} axisLine={false} width={36} tickFormatter={(v) => v + "%"} />
            <Tooltip content={makeTooltip(t, (v, p) => (p.name === "Absenteeism" ? pct(v, 1) : n1(v) + "★"))} />
            <Legend wrapperStyle={{ fontSize: 11, color: t.muted }} />
            <Line yAxisId="l" type="monotone" dataKey="satisfaction" name="Satisfaction" stroke={t.good} strokeWidth={2.5} dot={{ r: 2.5 }} />
            <Line yAxisId="r" type="monotone" dataKey="absenteeism" name="Absenteeism" stroke={t.watch} strokeWidth={2} strokeDasharray="5 4" dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </Card>
    </div>
  );
}

/* ============================ OVERVIEW ============================ */
function OverviewView({ t, onGo }) {
  const cards = [
    ["cost", "Cost & Fleet", Gauge, t.watch, inr(FLEET_AGG.cph) + " /head·mo", "Priority 1 — the CTC lever"],
    ["retention", "Retention", TrendingDown, t.poor, pct(FLEET_AGG.attrition, 1) + " attrition", "Priority 2 — commute vs leaving"],
    ["util", "Utilization", Users, t.good, pct(FLEET_AGG.loadFactor, 0) + " load", "Priority 3 — right-size fleet"],
    ["recruit", "Recruitment", MapPin, t.primary, (AREAS.reduce((s, a) => s + a.hires - a.exits, 0)) + " net hires", "Priority 4 — where to hire"],
    ["absence", "Absenteeism", CalendarX, t.watch, pct(FLEET_AGG.absenteeism, 1), "daily · wasted seat-km"],
    ["satisfaction", "Satisfaction", Star, satColor(t, FLEET_AGG.satisfaction), n2(FLEET_AGG.satisfaction) + " / 5", "service quality"],
  ];
  return (
    <div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <Tile t={t} label="Cost / head · month" value={inr(FLEET_AGG.cph)} accent={t.watch} sub="priority #1 KPI" />
        <Tile t={t} label="Cost / seat-km" value={"₹" + n2(FLEET_AGG.costPerSeatKm)} accent={t.techno} sub="best cross-type metric" />
        <Tile t={t} label="Load factor" value={pct(FLEET_AGG.loadFactor, 0)} accent={loadColor(t, FLEET_AGG.loadFactor)} sub="read as a pair with cost/head" />
        <Tile t={t} label="Attrition (qtr)" value={pct(FLEET_AGG.attrition, 1)} accent={t.poor} sub="retention driver" />
      </div>
      <p className="text-sm mb-3" style={{ color: t.muted }}>Jump to a module — each answers one of the PRD's four business goals plus daily operations.</p>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {cards.map(([k, label, Icon, c, big, sub]) => (
          <button key={k} onClick={() => onGo(k)} className="text-left rounded-2xl border p-4 transition hover:-translate-y-0.5" style={{ background: t.surface, borderColor: t.border }}>
            <div className="flex items-center gap-2.5 mb-2"><span className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: c + "22" }}><Icon size={18} style={{ color: c }} /></span><span className="font-semibold" style={{ color: t.text }}>{label}</span></div>
            <div className="text-2xl font-bold tabular-nums" style={{ color: t.text }}>{big}</div>
            <div className="text-xs mt-0.5" style={{ color: t.muted }}>{sub}</div>
          </button>
        ))}
      </div>
      <Card t={t} className="mt-4">
        <div className="flex items-start gap-2 text-xs" style={{ color: t.muted }}>
          <Info size={14} className="mt-0.5 shrink-0" style={{ color: t.primary }} />
          <span>Figures are computed from the PRD's KPI definitions (§6) on a PRD-shaped sample dataset. Live numbers require the ERP Phase-0 linkage — <b style={{ color: t.text }}>Employee → Pickup → Route → Bus → Attendance</b> (§4). Working month assumed at {WORKING_DAYS} days; underutilisation flagged below {UNDERUTIL_THRESHOLD}% load factor.</span>
        </div>
      </Card>
    </div>
  );
}

/* ============================ ROOT ============================ */
export default function EfficiencyDashboard({ t, toast }) {
  const [view, setView] = useState("overview");
  const NAV = [
    ["overview", "Overview", Gauge],
    ["cost", "Cost & Fleet", Gauge],
    ["retention", "Retention", TrendingDown],
    ["util", "Utilization", Users],
    ["recruit", "Recruitment", MapPin],
    ["absence", "Absenteeism", CalendarX],
    ["satisfaction", "Satisfaction", Star],
  ];
  return (
    <div>
      <SubNav t={t} value={view} onChange={setView} items={NAV} />
      {view === "overview" && <OverviewView t={t} onGo={setView} />}
      {view === "cost" && <CostFleetView t={t} toast={toast} />}
      {view === "retention" && <RetentionView t={t} toast={toast} />}
      {view === "util" && <UtilizationView t={t} toast={toast} />}
      {view === "recruit" && <RecruitmentView t={t} toast={toast} />}
      {view === "absence" && <AbsenteeismView t={t} toast={toast} />}
      {view === "satisfaction" && <SatisfactionView t={t} toast={toast} />}
    </div>
  );
}
