import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import {
  LayoutDashboard, GitCompare, Database, Sigma, Settings as SettingsIcon,
  Sun, Moon, Bus, Plus, Trash2, Download, Server, Activity, BarChart3, Pencil, X, ChevronRight, ChevronDown, Search, Calendar, Clock, MapPin,
  Upload, FileText, History, CheckCircle2, AlertTriangle, XCircle
} from "lucide-react";
import OptimiserTab from "./optimiser/OptimiserTab.jsx";
import { getGoogleKey, setGoogleKey } from "./optimiser/google.js";
import { fetchErpRaw, mapErpToDashboard, RUN_OPTIMISER, NEEDS_ERP } from "./erp.js";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  BarChart, Bar, Cell, AreaChart, Area, PieChart, Pie, ScatterChart, Scatter,
  ReferenceLine, LabelList
} from "recharts";
import * as math from "mathjs";
import * as XLSX from "xlsx";
import Papa from "papaparse";
import { gsap } from "gsap";
import { useGSAP } from "@gsap/react";

/* ============================ MOTION (GSAP) ============================ */
gsap.registerPlugin(useGSAP);
gsap.config({ nullTargetWarn: false }); // page timeline selectors may legitimately match nothing on some tabs
const prefersReduced = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
/* Entrance ("from") animations set an invisible start-state and rely on GSAP's rAF ticker to
   tween back to visible. While a browser tab is backgrounded rAF is paused, so a from-tween would
   hide content and never reveal it. Only run entrances when the tab is actually visible; otherwise
   render content in its natural (visible) state. */
const canEntrance = () =>
  !prefersReduced() && (typeof document === "undefined" || document.visibilityState === "visible");

/* micro-interactions (transform-only → compositor-friendly) */
const fxLift = (e) => { if (prefersReduced()) return; gsap.to(e.currentTarget, { y: -3, scale: 1.02, duration: 0.22, ease: "power2.out", overwrite: "auto" }); };
const fxDrop = (e) => { if (prefersReduced()) return; gsap.to(e.currentTarget, { y: 0, scale: 1, duration: 0.28, ease: "power2.out", overwrite: "auto" }); };
const fxPress = (e) => { if (prefersReduced()) return; gsap.fromTo(e.currentTarget, { scale: 0.96 }, { scale: 1, duration: 0.4, ease: "elastic.out(1, 0.55)", overwrite: "auto" }); };

/* animated number — tweens from the previously shown value; keeps prefix/suffix (₹, %, L, /yr…) */
function CountUp({ value }) {
  const ref = useRef(null);
  const prevRef = useRef(null);
  const tweenRef = useRef(null);
  const str = String(value);
  useGSAP(() => {
    const m = str.match(/^([^0-9-]*)(-?[\d,]+(?:\.\d+)?)(.*)$/);
    if (!m || prefersReduced()) { prevRef.current = null; return; }
    const target = parseFloat(m[2].replace(/,/g, ""));
    const dec = (m[2].split(".")[1] || "").length;
    const obj = { v: prevRef.current == null ? 0 : prevRef.current };
    prevRef.current = target;
    const fmt = (n) => m[1] + n.toLocaleString("en-IN", { minimumFractionDigits: dec, maximumFractionDigits: dec }) + m[3];
    if (ref.current) ref.current.textContent = fmt(obj.v); // avoid a first-paint flash of the final value
    tweenRef.current?.kill();
    tweenRef.current = gsap.to(obj, {
      v: target, duration: 0.8, ease: "power2.out",
      onUpdate: () => { if (ref.current) ref.current.textContent = fmt(obj.v); },
    });
  }, [str]);
  return <span ref={ref}>{str}</span>;
}

/* fade+rise wrapper for conditionally-mounted panels */
function Reveal({ children, y = 10, ...rest }) {
  const ref = useRef(null);
  useGSAP(() => {
    if (!canEntrance()) return;
    gsap.from(ref.current, { autoAlpha: 0, y, duration: 0.35, ease: "power2.out", clearProps: "transform,opacity,visibility" });
  }, { scope: ref });
  return <div ref={ref} {...rest}>{children}</div>;
}

/* ============================ THEME ============================ */
const THEMES = {
  light: {
    name: "light", label: "Light", dark: false, bg: "#eef2f7", surface: "#ffffff", surface2: "#f8fafc", raised: "#f1f5f9",
    border: "#e2e8f0", text: "#0f172a", muted: "#64748b", faint: "#94a3b8",
    primary: "#4f46e5", primarySoft: "rgba(79,70,229,.10)", onPrimary: "#ffffff",
    good: "#059669", watch: "#d97706", poor: "#e11d48",
    gainup: "#0284c7", techno: "#7c3aed",
    goodSoft: "rgba(5,150,105,.10)", watchSoft: "rgba(217,119,6,.12)", poorSoft: "rgba(225,29,90,.10)",
    grid: "#e8edf4", inputBg: "#f8fafc",
  },
  // Dark — Cool Grey neutrals + Blue (Vivid) primary, with palette semantic colours.
  dark: {
    name: "dark", label: "Dark", dark: true, bg: "#1a222c", surface: "#222e3a", surface2: "#2b3846", raised: "#374553",
    border: "#3a4a59", text: "#f5f7fa", muted: "#9aa5b1", faint: "#616e7c",
    primary: "#2186eb", primarySoft: "rgba(33,134,235,.18)", onPrimary: "#ffffff",
    good: "#3ebd93", watch: "#f7d070", poor: "#ef4e4e",
    gainup: "#47a3f3", techno: "#8888fc",
    goodSoft: "rgba(62,189,147,.14)", watchSoft: "rgba(247,208,112,.14)", poorSoft: "rgba(239,78,78,.16)",
    grid: "#2b3846", inputBg: "#151d26",
  },
  // Neutral — light, low-chroma Cool Grey neutrals with a slate primary and muted semantic colours.
  neutral: {
    name: "neutral", label: "Neutral", dark: false, bg: "#eceff3", surface: "#ffffff", surface2: "#f5f7fa", raised: "#e4e7eb",
    border: "#cbd2d9", text: "#1f2933", muted: "#616e7c", faint: "#9aa5b1",
    primary: "#52606d", primarySoft: "rgba(82,96,109,.12)", onPrimary: "#ffffff",
    good: "#199473", watch: "#c99a2e", poor: "#ba2525",
    gainup: "#186faf", techno: "#4c63b6",
    goodSoft: "rgba(25,148,115,.10)", watchSoft: "rgba(201,154,46,.12)", poorSoft: "rgba(186,37,37,.10)",
    grid: "#e6e9ed", inputBg: "#f5f7fa",
  },
};

/* ============================ HELPERS ============================ */
const uid = () => Math.random().toString(36).slice(2, 9);
const todayStr = () => new Date().toISOString().slice(0, 10);
const inr = (n) => "₹" + Math.round(n || 0).toLocaleString("en-IN");
const inr1 = (n) => "₹" + (n || 0).toLocaleString("en-IN", { maximumFractionDigits: 1 });
const inrK = (n) => { const a = Math.abs(n || 0), s = n < 0 ? "-" : ""; if (a >= 1e7) return s + "₹" + (a / 1e7).toFixed(1) + "Cr"; if (a >= 1e5) return s + "₹" + (a / 1e5).toFixed(1) + "L"; if (a >= 1e3) return s + "₹" + Math.round(a / 1e3) + "k"; return s + "₹" + Math.round(a); };
const pct = (n) => (n || 0).toFixed(0) + "%";

const DEFAULT_BANDS = [
  { id: "b1", label: "Excellent", min: 90, color: "#10b981" },
  { id: "b2", label: "Good", min: 75, color: "#38bdf8" },
  { id: "b3", label: "Low", min: 60, color: "#f59e0b" },
  { id: "b4", label: "Critical", min: 0, color: "#f43f5e" },
];

const FORMULA_VARS = ["present", "absent", "capacity", "assigned", "km", "budget", "spend", "util", "cph", "cpk", "variance"];
const VAR_INFO = [
  ["present", "riders present"], ["absent", "riders absent"], ["capacity", "seats on bus"],
  ["assigned", "present + absent"], ["km", "route distance"], ["budget", "allotted ₹"],
  ["spend", "actual ₹ spent"], ["util", "utilisation %"], ["cph", "cost per head"],
  ["cpk", "cost per km"], ["variance", "budget − spend"],
];
const OPS = ["+", "-", "*", "/", "(", ")"];
const DIGITS = ["7", "8", "9", "4", "5", "6", "1", "2", "3", "0", "."];
const CMP_METRICS = [
  ["cph", "Cost / head", "₹"], ["util", "Utilisation", "%"], ["cpk", "Cost / km", "₹"],
  ["spend", "Total spend", "₹"], ["present", "Riders", ""],
];
const GRAPH_TYPES = [["line", "Line"], ["bar", "Bar"], ["area", "Area"], ["pie", "Pie"], ["scatter", "Scatter"]];
const GROUP_BYS = [["company", "By company"], ["bus", "By bus"]];

/* hardcoded HR pools — placeholder until the ERP/HR feed is wired by IT (see IT_INTEGRATION_NOTES.md) */
const DEPTS = ["Cutting", "Stitching", "Finishing", "Quality", "Packing", "Admin"];
const DESIGS = ["Tailor", "Helper", "Supervisor", "Checker", "Operator", "Line Lead"];

/* ---- per-bus cost model (recurring profile → daily spend) ----
   Each bus carries a cost profile { budget:{amount,period}, lines:[{id,type,amount,quantity,period}] }.
   Every line is normalised to a per-day figure and summed → the bus's daily `spend`,
   which feeds every existing cost KPI (cost/head, variance, net value). */
const COST_TYPES = [
  { key: "diesel", label: "Diesel", qty: true, qtyLabel: "litres / day", period: "day" },
  { key: "driver", label: "Driver Salary", qty: false, period: "month" },
  { key: "maint", label: "Maintenance", qty: false, period: "month" },
  { key: "tires", label: "Tires", qty: true, qtyLabel: "no. of tyres", period: "year" },
  { key: "tiremaint", label: "Tire maintenance", qty: true, qtyLabel: "no. of tyres", period: "year" },
  { key: "fc", label: "FC Works", qty: false, period: "year" },
  { key: "taxes", label: "Taxes", qty: false, period: "year" },
  { key: "insurance", label: "Insurance", qty: false, period: "year" },
];
const COST_TYPE_MAP = Object.fromEntries(COST_TYPES.map((c) => [c.key, c]));
const COST_PERIODS = [["day", "Per day"], ["month", "Per month"], ["year", "Per year"]];
/* normalise one amount at a given period to ₹/working-day (wd = effective working days/year) */
function perDay(amount, period, wd) {
  const a = +amount || 0;
  if (period === "day") return a;
  if (period === "month") return (a * 12) / wd; // annualise the month, spread over working days
  return a / wd; // per year
}
function lineDaily(line, wd) {
  const spec = COST_TYPE_MAP[line.type];
  const q = spec && spec.qty ? (line.quantity === "" || line.quantity == null ? 0 : +line.quantity || 0) : 1;
  return perDay((+line.amount || 0) * q, line.period || (spec && spec.period) || "year", wd);
}
function profileDailySpend(prof, wd) { return (prof && prof.lines ? prof.lines : []).reduce((s, l) => s + lineDaily(l, wd), 0); }
function profileDailyBudget(prof, wd) { const b = prof && prof.budget; return b && b.amount ? perDay(b.amount, b.period || "month", wd) : 0; }
/* overlay each bus's cost profile onto its records so daily spend/budget flow to every tab */
function mergeCostsIntoRecords(records, buses, attendance, busCosts, wd) {
  if (!busCosts || !Object.keys(busCosts).length) return records;
  const dates = Object.keys(attendance || {});
  const byKey = new Map(records.map((r) => [r.busId + "|" + r.date, { ...r }]));
  buses.forEach((b) => {
    const prof = busCosts[b.id];
    if (!prof) return;
    const spend = profileDailySpend(prof, wd), budget = profileDailyBudget(prof, wd);
    if (!spend && !budget) return;
    dates.forEach((d) => {
      const k = b.id + "|" + d;
      const ex = byKey.get(k) || { busId: b.id, date: d, km: 0 };
      byKey.set(k, { ...ex, spend, budget });
    });
  });
  return [...byKey.values()];
}

function metricsFor(rec, bus, workingDays) {
  const present = +rec.present || 0, absent = +rec.absent || 0, cap = +bus.capacity || 0;
  const km = +rec.km || 0, budget = +rec.budget || 0, spend = +rec.spend || 0;
  return {
    present, absent, capacity: cap, km, budget, spend, assigned: present + absent,
    util: cap ? (present / cap) * 100 : 0,
    cph: present ? spend / present : 0,
    cpk: km ? spend / km : 0,
    variance: budget - spend,
    netAnnual: (budget - spend) * workingDays,
  };
}
function aggregate(pairs, workingDays) {
  let present = 0, absent = 0, cap = 0, km = 0, budget = 0, spend = 0, count = 0;
  pairs.forEach(({ rec, bus }) => {
    const m = metricsFor(rec, bus, workingDays);
    present += m.present; absent += m.absent; cap += m.capacity; km += m.km; budget += m.budget; spend += m.spend; count++;
  });
  return {
    count, present, absent, cap, km, budget, spend,
    util: cap ? (present / cap) * 100 : 0,
    cph: present ? spend / present : 0,
    cpk: km ? spend / km : 0,
    netAnnual: (budget - spend) * workingDays,
  };
}
function scopeFromAgg(a) {
  return {
    present: a.present, absent: a.absent, capacity: a.cap, assigned: a.present + a.absent,
    km: a.km, budget: a.budget, spend: a.spend, util: a.util, cph: a.cph, cpk: a.cpk, variance: a.budget - a.spend,
  };
}
/* ---- employees + attendance roll-up (punch feed is source of truth; typed counts are fallback) ---- */
function busEmps(employees, busId) { return employees.filter((e) => e.busId === busId); }
function recOf(records, busId, date) { return records.find((r) => r.busId === busId && r.date === date) || null; }
function rollup(employees, attendance, busId, date) {
  const emps = busEmps(employees, busId), day = attendance && attendance[date];
  if (!emps.length || !day) return null;
  if (!emps.some((e) => day[e.id])) return null; // nobody punched yet
  const present = emps.filter((e) => day[e.id] === "P").length;
  return { present, absent: emps.length - present, assigned: emps.length };
}
function resolveRec(records, employees, attendance, busId, date) {
  const r = recOf(records, busId, date) || {};
  const roll = rollup(employees, attendance, busId, date);
  return { busId, date, present: roll ? roll.present : +r.present || 0, absent: roll ? roll.absent : +r.absent || 0, km: +r.km || 0, budget: +r.budget || 0, spend: +r.spend || 0 };
}
function unionDates(records, attendance) { return [...new Set([...records.map((r) => r.date), ...Object.keys(attendance || {})])].sort(); }
function busHasData(records, employees, attendance, busId, date) { return !!recOf(records, busId, date) || !!rollup(employees, attendance, busId, date); }
function busLatestDate(records, employees, attendance, busId) {
  const ds = unionDates(records, attendance);
  for (let i = ds.length - 1; i >= 0; i--) if (busHasData(records, employees, attendance, busId, ds[i])) return ds[i];
  return null;
}
function pairsForDate(buses, records, employees, attendance, date, unit) {
  return buses.filter((b) => unit === "all" || b.unit === unit).filter((b) => busHasData(records, employees, attendance, b.id, date)).map((b) => ({ bus: b, rec: resolveRec(records, employees, attendance, b.id, date) }));
}
function datesInRange(records, attendance, from, to) {
  return unionDates(records, attendance).filter((d) => (!from || d >= from) && (!to || d <= to));
}
function median(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function sortedBands(bands) { return [...(bands || DEFAULT_BANDS)].sort((a, b) => b.min - a.min); }
// up to 150% is fine (full/over-full = green); above 150% is flagged amber as heavily over-loaded
const OVER_BAND = { id: "over", label: "Over 150%", min: 150, color: "#f59e0b" };
function bandFor(util, bands) {
  if (util > 150) return OVER_BAND;
  const bs = sortedBands(bands);
  return bs.find((b) => util >= b.min) || bs[bs.length - 1] || DEFAULT_BANDS[0];
}
function bandRankPoints(util, bands) {
  const bs = sortedBands(bands), n = bs.length;
  if (n <= 1) return 1;
  let rank = bs.findIndex((b) => util >= b.min); if (rank < 0) rank = n - 1;
  const ratio = (n - 1 - rank) / (n - 1);
  return ratio >= 0.66 ? 2 : ratio >= 0.33 ? 1 : 0;
}
function healthOf(m, medCph, s) {
  // over 150% is heavily over-loaded → flag as watch; 100–150% is treated as healthy (full)
  if (m.util > 150) return "watch";
  const sc0 = bandRankPoints(m.util, s.bands);
  // no cost data in scope yet → score honestly on utilisation alone (don't hand out phantom points)
  if (medCph <= 0) return sc0 >= 2 ? "good" : sc0 >= 1 ? "watch" : "poor";
  let sc = sc0;
  if (m.cph <= medCph) sc += 2; else if (m.cph <= medCph * 1.25) sc += 1;
  if (m.budget > 0) { if (m.variance >= 0) sc += 2; else if (m.variance >= -0.1 * m.budget) sc += 1; }
  return sc >= 5 ? "good" : sc >= 3 ? "watch" : "poor";
}
/* custom variables -> {name: value} map for the formula scope */
function varMapOf(variables) { return Object.fromEntries((variables || []).map((v) => [v.name, Number(v.value) || 0])); }
function evalFormula(expr, m, vars) {
  try {
    const scope = {}; FORMULA_VARS.forEach((v) => (scope[v] = m[v] || 0));
    if (vars) Object.assign(scope, vars);
    const val = math.evaluate(expr, scope);
    return typeof val === "number" && isFinite(val) ? val : null;
  } catch { return null; }
}
function fmtFormula(val, f) {
  if (val == null) return "—";
  if (f.unit === "₹") return inr(val);
  if (f.unit === "%") return val.toFixed(f.decimals ?? 0) + "%";
  return val.toLocaleString("en-IN", { maximumFractionDigits: f.decimals ?? 1 }) + (f.unit ? " " + f.unit : "");
}
// cost-derived metrics return null (→ honest "no data" state) until costs / km exist, rather than a misleading flat 0
const metricVal = (agg, key) =>
  key === "util" ? agg.util : key === "present" ? agg.present :
  key === "cph" ? (agg.spend > 0 ? agg.cph : null) :
  key === "cpk" ? (agg.spend > 0 && agg.km > 0 ? agg.cpk : null) :
  key === "spend" ? (agg.spend > 0 ? agg.spend : null) : null;
/* effective working days = configured working days minus declared holidays */
function effWorkingDays(s) { return Math.max(1, (s.workingDays || 312) - ((s.holidays && s.holidays.length) || 0)); }

/* ---- expression <-> token helpers for the chip-based formula editor ---- */
function tokensToExpr(tokens) { return (tokens || []).map((tk) => tk.v).join(" "); }
function exprToTokens(expr) {
  const out = []; const re = /\s*([A-Za-z_]\w*|\d+\.?\d*|\.\d+|[-+*/()])/g; let mt;
  while ((mt = re.exec(expr || "")) !== null) {
    const v = mt[1];
    if (v === "(" || v === ")") out.push({ t: "p", v });
    else if (["+", "-", "*", "/"].includes(v)) out.push({ t: "o", v });
    else if (/^[\d.]+$/.test(v)) out.push({ t: "n", v });
    else out.push({ t: "v", v });
  }
  return out;
}

/* ============================ STORAGE ============================ */
const mem = {};
const Store = {
  async get(k) { try { if (window.storage) { const r = await window.storage.get(k); return r ? JSON.parse(r.value) : null; } } catch { } return k in mem ? mem[k] : null; },
  async set(k, v) { mem[k] = v; try { if (window.storage) await window.storage.set(k, JSON.stringify(v)); } catch { } },
};

/* ============================ SAMPLE DATA ============================ */
const UNITS = ["Gainup", "Technotek"];
const SCHEMA = "fleet-v6"; // bump when the data model changes, to re-seed sample data
const NAME_POOL = ["A. Kumar", "R. Murugan", "S. Devi", "K. Prakash", "M. Latha", "V. Raja", "P. Selvi", "T. Anand", "N. Gokul", "D. Priya", "B. Suresh", "J. Mary", "L. Karthik", "G. Divya", "H. Ramesh", "C. Anitha", "E. Vijay", "F. Sneha", "I. Manoj", "O. Kavya"];
function sampleData() {
  const buses = [
    { id: uid(), unit: "Gainup", route: "Salem Town – Unit", vehicle: "TN30 AB 1234", driver: "R. Murugan", phone: "90000 11111", capacity: 12 },
    { id: uid(), unit: "Gainup", route: "Attur – Unit", vehicle: "TN30 AC 4521", driver: "S. Kumar", phone: "90000 22222", capacity: 14 },
    { id: uid(), unit: "Technotek", route: "Omalur – Plant", vehicle: "TN29 BD 7788", driver: "A. Velan", phone: "90000 33333", capacity: 10 },
    { id: uid(), unit: "Technotek", route: "Mettur – Plant", vehicle: "TN29 BE 1010", driver: "K. Prakash", phone: "90000 44444", capacity: 16 },
  ];
  const employees = [];
  let gi = 0;
  buses.forEach((b, bi) => {
    for (let j = 0; j < b.capacity; j++) {
      // department/designation/grade/travelMin are HARDCODED placeholders — see IT_INTEGRATION_NOTES.md
      employees.push({
        id: uid(), code: `${b.unit[0]}${bi + 1}-${String(j + 1).padStart(3, "0")}`, name: NAME_POOL[gi % NAME_POOL.length], busId: b.id,
        department: DEPTS[gi % DEPTS.length], designation: DESIGS[gi % DESIGS.length],
        travelMin: 20 + ((gi * 7) % 50), // 20–69 min placeholder; real value will come from GPS/geo-stop tracking
      });
      gi++;
    }
  });
  const records = [], attendance = {};
  const fills = [0.83, 0.92, 0.7, 0.85], kms = [38, 64, 52, 80], budgets = [2600, 3800, 3200, 4600];
  for (let d = 11; d >= 0; d--) {
    const date = new Date(); date.setDate(date.getDate() - d);
    const ds = date.toISOString().slice(0, 10);
    attendance[ds] = {};
    buses.forEach((b, i) => {
      const emps = employees.filter((e) => e.busId === b.id);
      const present = Math.max(2, Math.min(emps.length, Math.round(emps.length * Math.min(0.99, fills[i] + (Math.random() * 0.12 - 0.06)))));
      emps.forEach((e, idx) => { attendance[ds][e.id] = idx < present ? "P" : "A"; });
      records.push({ id: uid(), busId: b.id, date: ds, km: kms[i] + Math.round(Math.random() * 4 - 2), budget: budgets[i], spend: Math.round(budgets[i] * (0.9 + Math.random() * 0.22)) });
    });
  }
  const formulas = [
    { id: uid(), name: "Cost / seat", expr: "spend / capacity", unit: "₹", decimals: 0, description: "Daily spend spread across every seat on the bus." },
    { id: uid(), name: "Empty seats", expr: "capacity - present", unit: "", decimals: 0, description: "Seats that went unused." },
    { id: uid(), name: "Utilisation %", expr: "present / capacity * 100", unit: "%", decimals: 0, description: "Share of seats filled." },
    { id: uid(), name: "Cost / km", expr: "spend / km", unit: "₹", decimals: 1, description: "Spend per kilometre of route." },
    { id: uid(), name: "Riders / km", expr: "present / km", unit: "", decimals: 2, description: "Riders carried per kilometre." },
    { id: uid(), name: "Variance / day", expr: "budget - spend", unit: "₹", decimals: 0, description: "Budget left over (or overspent) per day." },
  ];
  // user-defined variables — independent values you set by hand (not derivable from other data)
  const variables = [{ id: uid(), name: "tailors", value: 40 }];
  const settings = { showNetValue: true, workingDays: 312, holidays: [], bands: DEFAULT_BANDS.map((b) => ({ ...b })), erpAuto: true };
  const erp = {};
  return { buses, employees, attendance, records, formulas, variables, settings, erp };
}

/* ============================ UI PRIMITIVES ============================ */
function Card({ t, children, className = "", title, hint, right }) {
  return (
    <div data-fx="card" className={"rounded-2xl border " + className} style={{ background: t.surface, borderColor: t.border }}>
      {(title || right) && (
        <div className="flex items-center justify-between px-5 pt-4 pb-1 gap-3">
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
function Btn({ t, children, onClick, variant = "primary", className = "", disabled, title }) {
  const base = "inline-flex items-center gap-2 rounded-xl font-semibold px-4 py-2.5 text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed";
  const style = variant === "primary" ? { background: t.primary, color: t.onPrimary || "#fff" } :
    variant === "danger" ? { background: "transparent", color: t.poor, border: "1px solid " + t.poor } :
    { background: "transparent", color: t.text, border: "1px solid " + t.border };
  return <button title={title} disabled={disabled} onClick={onClick} onMouseDown={fxPress} className={base + " " + className} style={style}>{children}</button>;
}
function Pill({ t, kind }) {
  // shape + label reinforce colour so status is legible with colour-vision deficiency
  const map = { good: [t.good, t.goodSoft, "Good", CheckCircle2], watch: [t.watch, t.watchSoft, "Watch", AlertTriangle], poor: [t.poor, t.poorSoft, "Poor", XCircle] };
  const [c, bg, label, Icon] = map[kind];
  return <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold uppercase tracking-wider" style={{ color: c, background: bg }}><Icon size={12} strokeWidth={2.5} />{label}</span>;
}
function Tile({ t, label, value, sub, accent, deltaColor }) {
  return (
    <div data-fx="tile" className="rounded-2xl border p-4 relative overflow-hidden" style={{ background: t.surface, borderColor: t.border }}>
      <span className="absolute left-0 top-0 bottom-0 w-1" style={{ background: accent || t.primary }} />
      <div className="text-xs uppercase tracking-widest" style={{ color: t.muted }}>{label}</div>
      <div className="text-3xl font-bold mt-2 tabular-nums" style={{ color: t.text }}>{typeof value === "string" || typeof value === "number" ? <CountUp value={value} /> : value}</div>
      {sub && <div className="text-xs mt-1" style={{ color: deltaColor || t.muted }}>{sub}</div>}
    </div>
  );
}
function Field({ t, label, children, strong }) {
  // `strong` = higher-stakes inputs (money, formula) get a more legible label
  return <label className="block"><span className="block mb-1.5" style={{ color: strong ? t.text : t.muted, fontSize: strong ? 13 : 12, fontWeight: strong ? 600 : 400 }}>{label}</span>{children}</label>;
}
function inputStyle(t) { return { background: t.inputBg, border: "1px solid " + t.border, color: t.text }; }
const TextInput = React.forwardRef(function TextInput({ t, ...p }, ref) {
  return <input ref={ref} {...p} className="w-full rounded-xl px-3 py-2.5 text-sm outline-none" style={inputStyle(t)}
    onFocus={(e) => (e.target.style.borderColor = t.primary)} onBlur={(e) => (e.target.style.borderColor = t.border)} />;
});
function SelectInput({ t, children, ...p }) {
  return <select {...p} className="w-full rounded-xl px-3 py-2.5 text-sm outline-none" style={inputStyle(t)}>{children}</select>;
}
function Switch({ t, checked, onChange, label }) {
  return <button role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)} className="relative w-12 h-7 rounded-full transition" style={{ background: checked ? t.good : t.border }}>
    <span className="absolute top-1 w-5 h-5 rounded-full bg-white transition-all" style={{ left: checked ? 26 : 4 }} /></button>;
}
function Segmented({ t, value, onChange, options, small }) {
  return (
    <div className="inline-flex rounded-xl p-1 gap-1" style={{ background: t.surface2, border: "1px solid " + t.border }}>
      {options.map(([val, label, color]) => {
        const on = value === val;
        return <button key={val} onClick={() => onChange(val)} className={(small ? "px-2.5 py-1 text-xs" : "px-3.5 py-1.5 text-sm") + " rounded-lg font-semibold transition"}
          style={{ background: on ? t.raised : "transparent", color: on ? t.text : t.muted, boxShadow: on ? `inset 0 -2px 0 ${color || t.primary}` : "none" }}>{label}</button>;
      })}
    </div>
  );
}
const UnitDot = ({ t, unit }) => <span className="inline-block w-2 h-2 rounded-sm mr-2 align-middle" style={{ background: unit === "Gainup" ? t.gainup : t.techno }} />;
function Empty({ t, title, sub }) {
  return <Card t={t}><div className="text-center py-10"><div className="text-xl font-semibold" style={{ color: t.text }}>{title}</div><div className="text-sm mt-1" style={{ color: t.muted }}>{sub}</div></div></Card>;
}
function Modal({ t, title, onClose, children }) {
  const overlayRef = useRef(null);
  useGSAP(() => {
    if (!canEntrance()) return;
    gsap.from(overlayRef.current, { autoAlpha: 0, duration: 0.25, ease: "power1.out" });
    gsap.from(".fx-modal-card", { autoAlpha: 0, y: 24, scale: 0.96, duration: 0.35, ease: "back.out(1.6)", clearProps: "transform" });
  }, { scope: overlayRef });
  return (
    <div ref={overlayRef} className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,.55)" }} onClick={onClose}>
      <div className="fx-modal-card w-full max-w-md rounded-2xl border" style={{ background: t.surface, borderColor: t.border }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: "1px solid " + t.border }}>
          <div className="font-semibold" style={{ color: t.text }}>{title}</div>
          <button onClick={onClose} title="Close" aria-label="Close" className="rounded-lg p-1.5" style={{ border: "1px solid " + t.border, color: t.muted }}><X size={15} /></button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

/* ============================ ANIMATED UNIT DROPDOWN ============================ */
function UnitDropdown({ t, value, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef();
  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  const opts = [["all", "Combined", t.primary], ["Gainup", "Gainup", t.gainup], ["Technotek", "Technotek", t.techno]];
  const cur = opts.find((o) => o[0] === value) || opts[0];
  return (
    <div ref={ref} className="relative" style={{ minWidth: 170 }}>
      <button onClick={() => setOpen((o) => !o)} className="w-full inline-flex items-center gap-2.5 rounded-xl px-3.5 py-2.5 text-sm font-semibold"
        style={{ background: t.surface, border: "1px solid " + (open ? t.primary : t.border), color: t.text, boxShadow: open ? `0 0 0 3px ${t.primarySoft}` : "none", transition: "border-color .18s ease, box-shadow .18s ease" }}>
        <span className="w-2.5 h-2.5 rounded-sm" style={{ background: cur[2], transition: "background .2s ease" }} />
        <span>{cur[1]}</span>
        <ChevronDown size={16} className="ml-auto" style={{ color: t.muted, transform: open ? "rotate(180deg)" : "rotate(0deg)", transition: "transform .22s cubic-bezier(.4,0,.2,1)" }} />
      </button>
      <div className="absolute right-0 mt-2 w-full rounded-xl p-1 z-40"
        style={{ background: t.surface, border: "1px solid " + t.border, boxShadow: "0 14px 34px rgba(0,0,0,.28)", transformOrigin: "top right",
          transition: "opacity .2s ease, transform .2s cubic-bezier(.4,0,.2,1)", opacity: open ? 1 : 0,
          transform: open ? "translateY(0) scale(1)" : "translateY(-8px) scale(.96)", pointerEvents: open ? "auto" : "none" }}>
        {opts.map(([val, label, color]) => {
          const on = val === value;
          return (
            <button key={val} onClick={() => { onChange(val); setOpen(false); }} className="w-full flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-left"
              style={{ background: on ? t.primarySoft : "transparent", color: t.text, transition: "background .15s ease" }}
              onMouseEnter={(e) => { if (!on) e.currentTarget.style.background = t.surface2; }}
              onMouseLeave={(e) => { if (!on) e.currentTarget.style.background = "transparent"; }}>
              <span className="w-2.5 h-2.5 rounded-sm" style={{ background: color }} />
              <span className="font-medium">{label}</span>
              {on && <span className="ml-auto w-1.5 h-1.5 rounded-full" style={{ background: t.primary }} />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ============================ HOLIDAY CALENDAR (multi-select) ============================ */
const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const pad2 = (n) => String(n).padStart(2, "0");
const ymd = (y, m, d) => `${y}-${pad2(m + 1)}-${pad2(d)}`;
function HolidayCalendar({ t, holidays, setHolidays }) {
  const now = new Date();
  const [vy, setVy] = useState(now.getFullYear());
  const [vm, setVm] = useState(now.getMonth());
  const sel = new Set(holidays);
  const firstDow = new Date(vy, vm, 1).getDay();
  const days = new Date(vy, vm + 1, 0).getDate();
  const prev = () => { if (vm === 0) { setVm(11); setVy(vy - 1); } else setVm(vm - 1); };
  const next = () => { if (vm === 11) { setVm(0); setVy(vy + 1); } else setVm(vm + 1); };
  const toggle = (d) => { const k = ymd(vy, vm, d); const ns = new Set(sel); ns.has(k) ? ns.delete(k) : ns.add(k); setHolidays([...ns].sort()); };
  const clearMonth = () => setHolidays(holidays.filter((h) => !h.startsWith(`${vy}-${pad2(vm + 1)}`)));
  const todayK = ymd(now.getFullYear(), now.getMonth(), now.getDate());
  const monthCount = holidays.filter((h) => h.startsWith(`${vy}-${pad2(vm + 1)}`)).length;
  return (
    <div className="rounded-xl p-3" style={{ background: t.surface2, border: "1px solid " + t.border, maxWidth: 360 }}>
      <div className="flex items-center justify-between mb-2">
        <button onClick={prev} className="rounded-lg p-1.5" style={{ border: "1px solid " + t.border, color: t.muted }}><ChevronRight size={15} style={{ transform: "rotate(180deg)" }} /></button>
        <div className="text-sm font-semibold" style={{ color: t.text }}>{MONTHS[vm]} {vy}</div>
        <button onClick={next} className="rounded-lg p-1.5" style={{ border: "1px solid " + t.border, color: t.muted }}><ChevronRight size={15} /></button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center">
        {WEEKDAYS.map((w) => <div key={w} className="text-xs py-1 font-medium" style={{ color: t.muted }}>{w}</div>)}
        {Array.from({ length: firstDow }).map((_, i) => <div key={"b" + i} />)}
        {Array.from({ length: days }).map((_, i) => {
          const d = i + 1, k = ymd(vy, vm, d), on = sel.has(k), today = k === todayK;
          return <button key={d} onClick={() => toggle(d)} className="aspect-square rounded-lg text-xs font-medium"
            style={{ background: on ? t.primary : "transparent", color: on ? "#fff" : t.text, border: "1px solid " + (on ? t.primary : today ? t.muted : "transparent"), transition: "background .12s ease" }}>{d}</button>;
        })}
      </div>
      <div className="flex items-center justify-between mt-2">
        <span className="text-xs" style={{ color: t.muted }}>Click any dates to toggle · {monthCount} this month · {holidays.length} total</span>
        {monthCount > 0 && <button onClick={clearMonth} className="text-xs rounded-lg px-2 py-1" style={{ border: "1px solid " + t.border, color: t.muted }}>Clear month</button>}
      </div>
    </div>
  );
}

/* ============================ CHART TOOLTIP ============================ */
function makeTooltip(t) {
  return function TT({ active, payload, label }) {
    if (!active || !payload || !payload.length) return null;
    return (
      <div className="rounded-lg px-3 py-2 text-xs" style={{ background: t.raised, border: "1px solid " + t.border, color: t.text }}>
        {label != null && <div className="font-semibold mb-1">{label}</div>}
        {payload.map((p, i) => <div key={i} style={{ color: p.color || p.fill }}>{p.name}: {typeof p.value === "number" ? Math.round(p.value).toLocaleString("en-IN") : p.value}</div>)}
      </div>
    );
  };
}
function TrendChart({ t, data, unit }) {
  const TT = makeTooltip(t);
  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={t.grid} vertical={false} />
        <XAxis dataKey="date" tick={{ fill: t.muted, fontSize: 11 }} tickLine={false} axisLine={{ stroke: t.border }} />
        <YAxis tick={{ fill: t.muted, fontSize: 11 }} tickLine={false} axisLine={false} width={48} />
        <Tooltip content={TT} />
        {(unit === "all" || unit === "Gainup") && <Line type="monotone" dataKey="Gainup" stroke={t.gainup} strokeWidth={2} dot={{ r: 2.5 }} connectNulls />}
        {(unit === "all" || unit === "Technotek") && <Line type="monotone" dataKey="Technotek" stroke={t.techno} strokeWidth={2} dot={{ r: 2.5 }} connectNulls />}
        {unit === "all" && <Line type="monotone" dataKey="Combined" stroke={t.primary} strokeWidth={2.5} dot={{ r: 2.5 }} connectNulls />}
      </LineChart>
    </ResponsiveContainer>
  );
}

/* ============================ TOKEN (chip) FORMULA EDITOR ============================ */
/* Variables/operators/numbers are entered as immutable chips. Keyboard typing is blocked;
   only Backspace/Delete work, and they remove the whole last chip as one entity. */
function TokenFormulaEditor({ t, tokens, setTokens, variables }) {
  const vars = [...FORMULA_VARS, ...(variables || []).map((v) => v.name)];
  const boxRef = useRef();
  const push = (tok) => setTokens([...tokens, tok]);
  const pushDigit = (d) => {
    const last = tokens[tokens.length - 1];
    if (last && last.t === "n") setTokens([...tokens.slice(0, -1), { t: "n", v: last.v + d }]);
    else push({ t: "n", v: d });
  };
  const back = () => setTokens(tokens.slice(0, -1));
  const onKeyDown = (e) => {
    if (e.key === "Backspace" || e.key === "Delete") { e.preventDefault(); back(); }
    else e.preventDefault(); // block all other keyboard input
  };
  const chipStyle = (tk) =>
    tk.t === "v" ? { background: t.primarySoft, color: t.gainup, border: "1px solid " + t.primary } :
    tk.t === "n" ? { background: t.surface, color: t.text, border: "1px solid " + t.border } :
    { background: t.surface2, color: t.muted, border: "1px solid " + t.border };
  return (
    <div>
      <div ref={boxRef} tabIndex={0} onKeyDown={onKeyDown}
        className="min-h-[48px] rounded-xl px-2.5 py-2 flex flex-wrap items-center gap-1.5 outline-none cursor-text"
        style={{ background: t.inputBg, border: "1px solid " + t.border }}
        onClick={() => boxRef.current && boxRef.current.focus()}>
        {tokens.length === 0 && <span className="text-sm px-1" style={{ color: t.muted }}>Click variables, operators or digits below to build the formula…</span>}
        {tokens.map((tk, i) => (
          <span key={i} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-sm font-mono font-semibold" style={chipStyle(tk)}>
            {tk.v}
            <button onClick={() => setTokens(tokens.filter((_, j) => j !== i))} style={{ color: "inherit", opacity: .65 }}><X size={12} /></button>
          </span>
        ))}
      </div>
      <div className="mt-3 rounded-xl p-3" style={{ background: t.surface2, border: "1px solid " + t.border }}>
        <div className="text-xs uppercase tracking-wider mb-2" style={{ color: t.muted }}>Variables</div>
        <div className="flex flex-wrap gap-1.5">
          {vars.map((v) => (
            <button key={v} onClick={() => push({ t: "v", v })} className="rounded-lg px-2.5 py-1.5 text-xs font-mono font-semibold" style={{ background: t.surface, border: "1px solid " + t.primary, color: t.gainup }}>{v}</button>
          ))}
        </div>
        <div className="text-xs uppercase tracking-wider mt-3 mb-2" style={{ color: t.muted }}>Operators &amp; numbers</div>
        <div className="flex flex-wrap gap-1.5">
          {OPS.map((o) => <button key={o} onClick={() => push({ t: ["(", ")"].includes(o) ? "p" : "o", v: o })} className="w-9 h-9 rounded-lg font-mono text-sm" style={{ background: t.surface, border: "1px solid " + t.border, color: t.text }}>{o}</button>)}
          {DIGITS.map((d) => <button key={d} onClick={() => pushDigit(d)} className="w-9 h-9 rounded-lg font-mono text-sm" style={{ background: t.surface, border: "1px solid " + t.border, color: t.text }}>{d}</button>)}
          <button onClick={back} className="rounded-lg px-3 h-9 text-xs" style={{ background: t.surface, border: "1px solid " + t.border, color: t.muted }}>⌫ back</button>
          <button onClick={() => setTokens([])} className="rounded-lg px-3 h-9 text-xs" style={{ background: t.surface, border: "1px solid " + t.border, color: t.muted }}>clear</button>
        </div>
      </div>
    </div>
  );
}

/* ============================ BANDS EDITOR (reused by Settings + per-metric) ============================ */
function BandsEditor({ t, bands, setBands }) {
  const update = (id, patch) => setBands(bands.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  const add = () => setBands([...bands, { id: uid(), label: "New band", min: 0, color: "#64748b" }]);
  const del = (id) => setBands(bands.filter((b) => b.id !== id));
  return (
    <div>
      <div className="space-y-2">
        <div className="grid grid-cols-12 gap-2 text-xs uppercase tracking-wider px-1" style={{ color: t.muted }}>
          <div className="col-span-2">Colour</div><div className="col-span-6">Label</div><div className="col-span-3">Min</div><div className="col-span-1" />
        </div>
        {[...bands].sort((a, b) => b.min - a.min).map((b) => (
          <div key={b.id} className="grid grid-cols-12 gap-2 items-center">
            <div className="col-span-2"><input type="color" value={b.color} onChange={(e) => update(b.id, { color: e.target.value })} className="w-full h-10 rounded-lg cursor-pointer" style={{ background: t.inputBg, border: "1px solid " + t.border }} /></div>
            <div className="col-span-6"><TextInput t={t} value={b.label} onChange={(e) => update(b.id, { label: e.target.value })} /></div>
            <div className="col-span-3"><TextInput t={t} type="number" value={b.min} onChange={(e) => update(b.id, { min: parseFloat(e.target.value) || 0 })} /></div>
            <div className="col-span-1 flex justify-end"><button onClick={() => del(b.id)} disabled={bands.length <= 1} title="Remove band" aria-label="Remove band" className="rounded-lg p-2 disabled:opacity-40" style={{ border: "1px solid " + t.border, color: t.muted }}><Trash2 size={14} /></button></div>
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Btn t={t} variant="ghost" onClick={add}><Plus size={15} /> Add band</Btn>
        <div className="flex flex-wrap gap-1.5">{[...bands].sort((a, b) => b.min - a.min).map((b) => <span key={b.id} className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold" style={{ background: b.color + "22", color: b.color }}><span className="w-1.5 h-1.5 rounded-full" style={{ background: b.color }} />{b.label} ≥ {b.min}</span>)}</div>
      </div>
    </div>
  );
}

/* ============================ LIVE (grid + collapsible units) ============================ */
function LiveView({ t, unit, buses, records, employees, attendance, formulas, settings, variables, onAddCosts }) {
  const wd = effWorkingDays(settings), showNV = settings.showNetValue;
  const vmap = varMapOf(variables);
  const [q, setQ] = useState("");
  const [sortBy, setSortBy] = useState("route");
  const [hfilter, setHfilter] = useState("all");
  const [collapsed, setCollapsed] = useState({});
  const [openBus, setOpenBus] = useState(null);

  const pairs = useMemo(() => buses.map((b) => {
    const d = busLatestDate(records, employees, attendance, b.id);
    return d ? { bus: b, rec: resolveRec(records, employees, attendance, b.id, d), date: d } : null;
  }).filter(Boolean), [buses, records, employees, attendance]);

  if (!pairs.length) return <Empty t={t} title="No live data yet" sub="Once the IT team connects the punch + cost feed, live buses appear here." />;

  const medCph = median(pairs.map((p) => metricsFor(p.rec, p.bus, wd).cph).filter((n) => n > 0));
  const enriched = pairs.map((p) => { const m = metricsFor(p.rec, p.bus, wd); return { ...p, m, h: healthOf(m, medCph, settings), bd: bandFor(m.util, settings.bands) }; });
  const hc = (h) => (h === "good" ? t.good : h === "watch" ? t.watch : t.poor);

  const ql = q.trim().toLowerCase();
  const matchQ = (x) => !ql || x.bus.vehicle.toLowerCase().includes(ql) || (x.bus.route || "").toLowerCase().includes(ql) || (x.bus.driver || "").toLowerCase().includes(ql);
  const matchH = (x) => (hfilter === "all" ? true : hfilter === "over" ? x.m.util > 150 : hfilter === "attention" ? x.h !== "good" : x.h === hfilter);
  const rank = { poor: 0, watch: 1, good: 2 };
  const sorters = {
    route: (a, b) => (a.bus.route || "").localeCompare(b.bus.route || ""),
    vehicle: (a, b) => a.bus.vehicle.localeCompare(b.bus.vehicle),
    util: (a, b) => b.m.util - a.m.util,
    health: (a, b) => rank[a.h] - rank[b.h],
  };
  let filtered = enriched.filter((x) => (unit === "all" || x.bus.unit === unit) && matchQ(x) && matchH(x));
  filtered = [...filtered].sort(sorters[sortBy]);

  const showUnits = unit === "all" ? UNITS : [unit];
  const agg = aggregate(filtered, wd);
  const noCosts = agg.spend === 0 && agg.budget === 0; // no per-bus cost cards filled yet
  const overCount = filtered.filter((x) => x.m.util > 150).length; // heavily over-loaded (>150%)
  const punched = agg.present + agg.absent;
  const inputBase = { background: t.inputBg, border: "1px solid " + t.border, color: t.text };

  const detail = (x) => (
    <Reveal className="rounded-2xl border p-4 mt-2" style={{ background: t.surface2, borderColor: t.primary }}>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div><div className="font-semibold flex items-center gap-2" style={{ color: t.text }}><UnitDot t={t} unit={x.bus.unit} />{x.bus.vehicle} <Pill t={t} kind={x.h} /></div>
          <div className="text-xs mt-0.5" style={{ color: t.muted }}>{x.bus.route} · {x.bus.driver} · {x.date}</div></div>
        <button onClick={() => setOpenBus(null)} className="rounded-lg p-1.5" style={{ border: "1px solid " + t.border, color: t.muted }}><X size={14} /></button>
      </div>
      <div className="flex flex-wrap gap-4 text-sm tabular-nums mb-3">
        <span style={{ color: t.muted }}>Present <b style={{ color: t.good }}>{x.m.present}</b>/{x.m.capacity}</span>
        <span style={{ color: t.muted }}>Absent <b style={{ color: t.text }}>{x.m.absent}</b></span>
        <span className="rounded-full px-2 py-0.5 text-xs font-semibold" style={{ background: x.bd.color + "22", color: x.bd.color }}>{x.bd.label} {pct(x.m.util)}</span>
        <span style={{ color: t.muted }}>Cost/head <b style={{ color: t.text }}>{inr(x.m.cph)}</b></span>
        <span style={{ color: t.muted }}>Cost/km <b style={{ color: t.text }}>{inr1(x.m.cpk)}</b></span>
        {showNV && <span style={{ color: t.muted }}>Net value <b style={{ color: x.m.netAnnual >= 0 ? t.good : t.poor }}>{inr(x.m.netAnnual)}/yr</b></span>}
      </div>
      {(() => { const emps = busEmps(employees, x.bus.id), day = attendance[x.date] || {};
        // absentees first, then no-punch, present last — the misses are what you scan for
        const stRank = (st) => (st === "A" ? 0 : st === "P" ? 2 : 1);
        const ordered = emps.slice().sort((a, b) => stRank(day[a.id]) - stRank(day[b.id]));
        return ordered.length ? (
        <div className="flex flex-wrap gap-1.5">{ordered.map((e) => { const st = day[e.id]; const c = st === "P" ? t.good : st === "A" ? t.poor : t.faint; const lab = st === "P" ? "P" : st === "A" ? "A" : "–";
          return <span key={e.id} title={`${e.code} · ${st === "P" ? "Present" : st === "A" ? "Absent" : "No punch"}`} className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs" style={{ background: t.surface, border: "1px solid " + t.border, color: t.text }}><span className="w-4 h-4 rounded flex items-center justify-center text-[9px] font-bold" style={{ background: c + "22", color: c }}>{lab}</span>{e.name}</span>; })}</div>
      ) : <div className="text-xs" style={{ color: t.muted }}>No employees mapped.</div>; })()}
      {formulas.length > 0 && <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 text-xs" style={{ color: t.muted }}>{formulas.map((f) => <span key={f.id}>{f.name}: <b style={{ color: t.text }}>{fmtFormula(evalFormula(f.expr, x.m, vmap), f)}</b></span>)}</div>}
    </Reveal>
  );

  return (
    <div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <Tile t={t} label="Riders present" value={agg.present} sub={`of ${agg.cap} seats`} accent={t.good} />
        <Tile t={t} label="Capacity utilisation" value={pct(agg.util)} sub={`${agg.count} buses shown`} accent={t.primary} />
        {noCosts ? <>
          <Tile t={t} label="Over 150%" value={overCount} sub="heavily over-loaded" accent={overCount ? t.watch : t.good} />
          <Tile t={t} label="Attendance" value={punched ? pct((agg.present / punched) * 100) : "—"} sub={`${agg.present}/${punched} punched`} accent={t.techno} />
        </> : <>
          <Tile t={t} label="Avg cost / head" value={inr(agg.cph)} sub={`${inr(agg.spend)} spend`} accent={t.watch} />
          <Tile t={t} label={showNV ? "Net value (yr)" : "Cost / km"} value={showNV ? inrK(agg.netAnnual) : inr1(agg.cpk)} sub={showNV ? "budget − spend" : `${agg.km} km`} accent={t.techno} />
        </>}
      </div>

      {noCosts && (
        <div className="rounded-xl border px-4 py-3 mb-4 flex flex-wrap items-center gap-3 text-sm" style={{ background: t.primarySoft, borderColor: t.primary, color: t.text }}>
          <Server size={16} style={{ color: t.primary }} />
          <span>Cost, spend &amp; net-value figures stay blank until each bus's running costs are entered.</span>
          {onAddCosts && <button onClick={onAddCosts} className="ml-auto rounded-lg px-3 py-1.5 text-xs font-semibold" style={{ background: t.primary, color: t.onPrimary || "#fff" }}>Add bus costs →</button>}
        </div>
      )}

      <div className="flex flex-wrap gap-2 mb-4 items-center">
        <div className="relative flex-1" style={{ minWidth: 200 }}>
          <Search size={15} style={{ position: "absolute", left: 12, top: 11, color: t.muted }} />
          <input value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search vehicle, route or driver" placeholder="Search vehicle, route or driver..." className="w-full rounded-xl pl-9 pr-3 py-2.5 text-sm outline-none" style={inputBase} />
        </div>
        <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} className="rounded-xl px-3 py-2.5 text-sm outline-none" style={inputBase}>
          <option value="route">Sort: Route A–Z</option>
          <option value="vehicle">Sort: Vehicle A–Z</option>
          <option value="util">Sort: Utilisation high to low</option>
          <option value="health">Sort: Health worst first</option>
        </select>
        <button onClick={() => setHfilter(hfilter === "over" ? "all" : "over")} aria-pressed={hfilter === "over"} className="rounded-xl px-3 py-2.5 text-sm font-medium" style={{ background: hfilter === "over" ? t.watchSoft : "transparent", border: "1px solid " + (hfilter === "over" ? t.watch : t.border), color: hfilter === "over" ? t.text : t.muted }}>Over 150%{overCount ? ` (${overCount})` : ""}</button>
        <button onClick={() => setHfilter(hfilter === "attention" ? "all" : "attention")} aria-pressed={hfilter === "attention"} className="rounded-xl px-3 py-2.5 text-sm font-medium" style={{ background: hfilter === "attention" ? t.primarySoft : "transparent", border: "1px solid " + (hfilter === "attention" ? t.primary : t.border), color: hfilter === "attention" ? t.text : t.muted }}>Only Watch / Poor</button>
        {!["all", "attention", "over"].includes(hfilter) && <button onClick={() => setHfilter("all")} className="rounded-xl px-3 py-2.5 text-sm" style={{ border: "1px solid " + t.border, color: t.muted }}>Clear: {hfilter}</button>}
      </div>

      {showUnits.map((u) => {
        const list = filtered.filter((x) => x.bus.unit === u);
        const counts = { good: 0, watch: 0, poor: 0 }; list.forEach((x) => counts[x.h]++);
        const ua = aggregate(list, wd);
        const isCol = !!collapsed[u];
        const accent = u === "Gainup" ? t.gainup : t.techno;
        const openHere = openBus && list.find((x) => x.bus.id === openBus);
        return (
          <div key={u} data-fx="card" className="mb-4 rounded-2xl border overflow-hidden" style={{ background: t.surface, borderColor: t.border }}>
            <button onClick={() => setCollapsed({ ...collapsed, [u]: !isCol })} className="w-full flex items-center gap-2.5 px-4 py-3 text-left" style={{ background: t.surface2 }}>
              <ChevronRight size={16} style={{ color: accent, transform: isCol ? "none" : "rotate(90deg)", transition: "transform .15s" }} />
              <span className="w-2.5 h-2.5 rounded-sm" style={{ background: accent }} />
              <span className="font-bold tracking-tight" style={{ color: t.text }}>{u}</span>
              <span className="text-xs" style={{ color: t.muted }}>{list.length} buses</span>
              <span className="ml-auto flex items-center gap-3 text-xs tabular-nums">
                <span onClick={(e) => { e.stopPropagation(); setHfilter(hfilter === "good" ? "all" : "good"); }} style={{ color: t.good, cursor: "pointer" }}>{counts.good} Good</span>
                <span onClick={(e) => { e.stopPropagation(); setHfilter(hfilter === "watch" ? "all" : "watch"); }} style={{ color: t.watch, cursor: "pointer" }}>{counts.watch} Watch</span>
                <span onClick={(e) => { e.stopPropagation(); setHfilter(hfilter === "poor" ? "all" : "poor"); }} style={{ color: t.poor, cursor: "pointer" }}>{counts.poor} Poor</span>
                <span style={{ color: t.muted }}>· {pct(ua.util)} util</span>
              </span>
            </button>
            {!isCol && (
              <div className="p-3">
                {list.length === 0 ? <div className="text-sm py-4 text-center" style={{ color: t.muted }}>No buses match.</div> : (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(108px, 1fr))", gap: 8 }}>
                    {list.map((x) => { const over = x.m.util > 150; const col = over ? OVER_BAND.color : hc(x.h); const on = openBus === x.bus.id;
                      const tag = over ? `OVER +${Math.round(x.m.util - 100)}%` : x.h.toUpperCase();
                      return (
                        <button key={x.bus.id} data-fx="bus" onClick={() => setOpenBus(on ? null : x.bus.id)} onMouseEnter={fxLift} onMouseLeave={fxDrop} className="relative text-left rounded-xl p-2.5" style={{ background: t.surface2, border: "1.5px solid " + col, boxShadow: on ? `0 0 0 2px ${t.primary}` : "none" }}>
                          <span className="absolute rounded-full" style={{ right: 8, top: 8, width: 8, height: 8, background: col }} />
                          <div className="text-xs font-semibold truncate" style={{ color: t.text, maxWidth: "84%" }}>{x.bus.vehicle}</div>
                          <div className="flex items-baseline gap-1 mt-1">
                            <div className="text-xl font-bold tabular-nums" style={{ color: col }}>{pct(x.m.util)}</div>
                            <div className="text-[10px]" style={{ color: t.muted }}>util</div>
                          </div>
                          <div className="text-[10px] font-bold uppercase tracking-wide truncate" style={{ color: col }}>{tag}</div>
                          {showNV && <div className="text-xs font-semibold tabular-nums mt-1" style={{ color: x.m.netAnnual >= 0 ? t.good : t.poor }}>{inrK(x.m.netAnnual)}/yr</div>}
                        </button>
                      ); })}
                  </div>
                )}
                {openHere && detail(openHere)}
              </div>
            )}
          </div>
        );
      })}
      <p className="text-xs" style={{ color: t.muted }}>Tile border + dot = health. Utilisation shows on every tile{showNV ? "; net value too (toggle in Settings)." : " — enable Net Value in Settings to also show profit."} Tap a tile for employees + details.</p>
    </div>
  );
}

/* ============================ BUS DOCUMENTS (per-bus file store) ============================ */
const DOC_CATEGORIES = ["RC", "Insurance", "Permit", "Fitness", "Pollution", "Driver licence", "Other"];
const MAX_DOC_BYTES = 3 * 1024 * 1024; // 3 MB/file — kept small so localStorage doesn't overflow
const fmtBytes = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + " MB" : n >= 1024 ? Math.round(n / 1024) + " KB" : n + " B");
function BusDocuments({ t, busId, busLabel, toast }) {
  const key = "bus-docs-" + busId;
  const [docs, setDocs] = useState([]);
  const [cat, setCat] = useState(DOC_CATEGORIES[0]);
  const fileRef = useRef(null);
  useEffect(() => { try { setDocs(JSON.parse(localStorage.getItem(key) || "[]")); } catch { setDocs([]); } }, [key]);
  const persist = (next) => { setDocs(next); try { localStorage.setItem(key, JSON.stringify(next)); return true; } catch { toast && toast("Storage full — remove some files first"); return false; } };

  const onPick = (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    let next = docs.slice(); let pending = files.length;
    files.forEach((f) => {
      if (f.size > MAX_DOC_BYTES) { toast && toast(`${f.name} is too large (max ${fmtBytes(MAX_DOC_BYTES)})`); if (--pending === 0) persist(next); return; }
      const reader = new FileReader();
      reader.onload = () => {
        next = [...next, { id: uid(), name: f.name, type: f.type || "file", size: f.size, category: cat, addedAt: new Date().toISOString().slice(0, 10), dataUrl: reader.result }];
        if (--pending === 0) { if (persist(next)) toast && toast("Document(s) added"); }
      };
      reader.onerror = () => { if (--pending === 0) persist(next); };
      reader.readAsDataURL(f);
    });
    e.target.value = "";
  };
  const remove = (id) => persist(docs.filter((d) => d.id !== id));

  const byCat = {}; docs.forEach((d) => { (byCat[d.category] || (byCat[d.category] = [])).push(d); });
  const cats = DOC_CATEGORIES.filter((c) => byCat[c]);

  return (
    <Card t={t} title={`Documents (${docs.length})`} hint={`Upload and organise files for ${busLabel} — RC, insurance, permit, fitness, etc. Stored locally in your browser.`}
      right={
        <div className="flex items-center gap-2">
          <select value={cat} onChange={(e) => setCat(e.target.value)} className="rounded-lg px-2 py-1.5 text-xs outline-none" style={{ background: t.inputBg, border: "1px solid " + t.border, color: t.text }}>
            {DOC_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <input ref={fileRef} type="file" multiple onChange={onPick} className="hidden" />
          <Btn t={t} variant="ghost" onClick={() => fileRef.current && fileRef.current.click()}><Upload size={14} /> Upload</Btn>
        </div>
      }>
      {docs.length === 0 ? (
        <div className="rounded-xl border border-dashed py-8 text-center text-sm" style={{ borderColor: t.border, color: t.muted }}>
          <FileText size={18} className="inline-block mb-1.5 opacity-60" />
          <div>No documents yet.</div>
          <div className="text-xs mt-0.5">Pick a category on the right, then <b>Upload</b> to attach files to this bus.</div>
        </div>
      ) : (
        <div className="space-y-4">
          {cats.map((c) => (
            <div key={c}>
              <div className="text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: t.muted }}>{c} · {byCat[c].length}</div>
              <div className="space-y-1.5">
                {byCat[c].map((d) => (
                  <div key={d.id} className="flex items-center gap-3 rounded-xl px-3 py-2" style={{ background: t.surface2, border: "1px solid " + t.border }}>
                    <FileText size={16} style={{ color: t.primary, flexShrink: 0 }} />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium truncate" style={{ color: t.text }}>{d.name}</div>
                      <div className="text-xs" style={{ color: t.muted }}>{fmtBytes(d.size)} · added {d.addedAt}</div>
                    </div>
                    <a href={d.dataUrl} download={d.name} className="rounded-lg p-2" title="Download" style={{ border: "1px solid " + t.border, color: t.muted }}><Download size={14} /></a>
                    <button onClick={() => remove(d.id)} className="rounded-lg p-2" title="Remove" style={{ border: "1px solid " + t.border, color: t.poor }}><Trash2 size={14} /></button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

/* ============================ PER-BUS COST CARD ============================ */
/* Recurring cost profile for one bus: a Budget (amount + period) plus any number of
   cost lines (Diesel, Driver Salary, Maintenance, Tires, …). Every value is normalised
   to ₹/day and summed into the bus's daily spend (see mergeCostsIntoRecords). */
function CostCard({ t, bus, profile, wd, onChange }) {
  const prof = profile || { budget: { amount: "", period: "month" }, lines: [] };
  const lines = prof.lines || [];
  const budget = prof.budget || { amount: "", period: "month" };
  const set = (next) => onChange({ ...prof, ...next });
  const setBudget = (patch) => set({ budget: { ...budget, ...patch } });
  const addLine = () => { const first = COST_TYPES[0]; set({ lines: [...lines, { id: uid(), type: first.key, amount: "", quantity: first.qty ? "" : undefined, period: first.period }] }); };
  const updLine = (id, patch) => set({ lines: lines.map((l) => (l.id === id ? { ...l, ...patch } : l)) });
  const delLine = (id) => set({ lines: lines.filter((l) => l.id !== id) });
  const onType = (id, key) => { const spec = COST_TYPE_MAP[key]; updLine(id, { type: key, period: spec.period, quantity: spec.qty ? (lines.find((l) => l.id === id)?.quantity ?? "") : undefined }); };

  const dailySpend = profileDailySpend(prof, wd);
  const dailyBudget = profileDailyBudget(prof, wd);
  const inputBase = { background: t.inputBg, border: "1px solid " + t.border, color: t.text };
  const cell = "rounded-lg px-2.5 py-2 text-sm outline-none";

  return (
    <Card t={t} title="Cost breakdown" hint={`Recurring costs for ${bus.vehicle}. Each line is converted to ₹/day (using ${wd} working days) and drives Cost/head, Budget, Spend & Net value. Saved per bus.`}>
      {/* Budget */}
      <div className="flex flex-wrap items-end gap-3 mb-4">
        <Field t={t} strong label="Budget (₹)"><input type="number" min="0" value={budget.amount} onChange={(e) => setBudget({ amount: e.target.value })} placeholder="0" className={"w-40 " + cell} style={inputBase} /></Field>
        <Field t={t} label="Per"><select value={budget.period} onChange={(e) => setBudget({ period: e.target.value })} className={cell} style={inputBase}>{COST_PERIODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
        <div className="text-xs pb-2" style={{ color: t.muted }}>= <b style={{ color: t.text }}>{inr(dailyBudget)}</b>/day</div>
      </div>

      {/* Cost lines */}
      {lines.length ? (
        <div className="space-y-2">
          {lines.map((l) => { const spec = COST_TYPE_MAP[l.type] || {}; return (
            <div key={l.id} className="flex flex-wrap items-end gap-2 rounded-xl p-2" style={{ background: t.surface2, border: "1px solid " + t.border }}>
              <Field t={t} label="Type"><select value={l.type} onChange={(e) => onType(l.id, e.target.value)} className={cell} style={inputBase}>{COST_TYPES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}</select></Field>
              <Field t={t} strong label={"Amount (₹" + (spec.qty ? " each" : "") + ")"}><input type="number" min="0" value={l.amount} onChange={(e) => updLine(l.id, { amount: e.target.value })} placeholder="0" className={"w-32 " + cell} style={inputBase} /></Field>
              {spec.qty && <Field t={t} label={spec.qtyLabel || "Qty"}><input type="number" min="0" value={l.quantity ?? ""} onChange={(e) => updLine(l.id, { quantity: e.target.value })} placeholder="0" className={"w-28 " + cell} style={inputBase} /></Field>}
              <Field t={t} label="Per"><select value={l.period} onChange={(e) => updLine(l.id, { period: e.target.value })} className={cell} style={inputBase}>{COST_PERIODS.map(([v, lb]) => <option key={v} value={v}>{lb}</option>)}</select></Field>
              <div className="text-xs pb-2 ml-auto whitespace-nowrap" style={{ color: t.muted }}>= <b style={{ color: t.text }}>{inr(lineDaily(l, wd))}</b>/day</div>
              <button onClick={() => delLine(l.id)} title="Remove cost line" aria-label="Remove cost line" className="rounded-lg p-2 mb-0.5" style={{ border: "1px solid " + t.border, color: t.poor }}><Trash2 size={14} /></button>
            </div>
          ); })}
        </div>
      ) : <div className="text-sm rounded-xl border border-dashed py-6 text-center" style={{ borderColor: t.border, color: t.muted }}>No costs added yet — add Diesel, Driver Salary, Insurance, etc.</div>}

      <div className="flex flex-wrap items-center gap-3 mt-3">
        <Btn t={t} variant="ghost" onClick={addLine}><Plus size={15} /> Add cost</Btn>
        <div className="ml-auto flex flex-wrap gap-4 text-sm">
          <div>Total spend: <b style={{ color: t.text }}>{inr(dailySpend)}</b>/day · <span style={{ color: t.muted }}>{inr(dailySpend * wd / 12)}/mo</span></div>
          <div>Variance: <b style={{ color: dailyBudget - dailySpend >= 0 ? t.good : t.poor }}>{inr(dailyBudget - dailySpend)}</b>/day</div>
        </div>
      </div>
    </Card>
  );
}

/* ============================ BUS-WISE (Unit → Bus → details) ============================ */
function BusView({ t, unit, buses, records, employees, attendance, formulas, settings, variables, busCosts, onBusCost, toast }) {
  const wd = effWorkingDays(settings), showNV = settings.showNetValue;
  const vmap = varMapOf(variables);
  const allDates = useMemo(() => unionDates(records, attendance), [records, attendance]);
  const visBuses = buses.filter((b) => unit === "all" || b.unit === unit);
  const [q, setQ] = useState({}); // per-company search text: { Gainup: "", Technotek: "" }
  const [sel, setSel] = useState(visBuses[0] ? visBuses[0].id : null);
  const [range, setRange] = useState({ from: "", to: "" });
  const [openEmp, setOpenEmp] = useState(null);

  // default the date range to the latest day that has data
  useEffect(() => {
    const d = allDates[allDates.length - 1] || "";
    if (d && !range.from && !range.to) setRange({ from: d, to: d });
    // eslint-disable-next-line
  }, [allDates.length]);
  // keep selection valid when the unit filter changes
  useEffect(() => { if (!visBuses.find((b) => b.id === sel)) setSel(visBuses[0] ? visBuses[0].id : null); /* eslint-disable-next-line */ }, [unit, buses]);

  if (!buses.length) return <Empty t={t} title="No buses yet" sub="Buses appear once the IT team connects the fleet feed." />;

  const medCph = median(buses.map((b) => { const d = busLatestDate(records, employees, attendance, b.id); return d ? metricsFor(resolveRec(records, employees, attendance, b.id, d), b, wd).cph : 0; }).filter((n) => n > 0));
  const matchQ = (b, ql) => !ql || b.vehicle.toLowerCase().includes(ql) || (b.route || "").toLowerCase().includes(ql) || (b.driver || "").toLowerCase().includes(ql);

  const bus = buses.find((b) => b.id === sel) || visBuses[0] || buses[0];
  const rngDates = datesInRange(records, attendance, range.from, range.to).filter((d) => busHasData(records, employees, attendance, bus.id, d));
  const pairs = rngDates.map((d) => ({ bus, rec: resolveRec(records, employees, attendance, bus.id, d) }));
  const agg = aggregate(pairs, wd);
  const scope = scopeFromAgg(agg);
  const has = pairs.length > 0;
  const m = has ? { ...scope, netAnnual: agg.netAnnual } : null;
  const h = m ? healthOf(m, medCph, settings) : "watch";
  const bd = m ? bandFor(m.util, settings.bands) : null;
  const assigned = agg.present + agg.absent;
  const presentVsAlloc = assigned ? (agg.present / assigned) * 100 : 0;
  const emps = busEmps(employees, bus.id);
  const travels = emps.map((e) => +e.travelMin).filter((n) => n > 0);
  const minRide = travels.length ? Math.min(...travels) : null, maxRide = travels.length ? Math.max(...travels) : null;
  const latest = busLatestDate(records, employees, attendance, bus.id);
  const day = (latest && attendance[latest]) || {};
  const inputBase = { background: t.inputBg, border: "1px solid " + t.border, color: t.text };
  const rangeLabel = range.from && range.to ? (range.from === range.to ? range.from : `${range.from} → ${range.to}`) : "all dates";
  const isRange = range.from !== range.to;

  const metricTile = (label, value, color) => (<div className="rounded-xl border p-3" style={{ background: t.surface2, borderColor: t.border }}><div className="text-xs uppercase tracking-wider" style={{ color: t.muted }}>{label}</div><div className="text-lg font-bold tabular-nums mt-1" style={{ color: color || t.text }}>{value}</div></div>);
  const infoItem = (label, value) => {
    const ph = value === RUN_OPTIMISER || value === NEEDS_ERP;
    return (<div><div className="text-xs" style={{ color: t.muted }}>{label}</div>
      {ph ? <div title={value} className="text-sm italic mt-0.5" style={{ color: t.muted }}>{value === NEEDS_ERP ? "Not in ERP" : "After optimiser"}</div>
          : <div className="font-semibold mt-0.5" style={{ color: t.text }}>{value}</div>}</div>);
  };
  const optVal = <span title={RUN_OPTIMISER} className="text-sm font-semibold italic leading-tight" style={{ color: t.primary }}>Run optimiser →</span>;

  return (
    <div className="flex flex-col md:flex-row gap-4">
      <div className="md:w-72 shrink-0 flex flex-col gap-4 md:sticky md:self-start" style={{ top: 72, maxHeight: "calc(100vh - 150px)" }}>
        {(unit === "all" ? UNITS : [unit]).map((u) => {
          const total = buses.filter((b) => b.unit === u).length;
          const ql = (q[u] || "").trim().toLowerCase();
          const list = buses.filter((b) => b.unit === u && matchQ(b, ql));
          return (
            <div key={u} className="rounded-2xl border flex flex-col min-h-0 flex-1" style={{ background: t.surface, borderColor: t.border }}>
              <div className="p-3 shrink-0" style={{ borderBottom: "1px solid " + t.border }}>
                <div className="flex items-center gap-2 mb-2">
                  <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: u === "Gainup" ? t.gainup : t.techno }} />
                  <span className="font-semibold text-sm" style={{ color: t.text }}>{u}</span>
                  <span className="ml-auto text-xs" style={{ color: t.muted }}>{ql ? `${list.length} / ${total}` : total}</span>
                </div>
                <div className="relative">
                  <Search size={15} style={{ position: "absolute", left: 10, top: 10, color: t.muted }} />
                  <input value={q[u] || ""} onChange={(e) => setQ((s) => ({ ...s, [u]: e.target.value }))} placeholder={`Search ${u} buses...`} className="w-full rounded-xl pl-8 pr-3 py-2 text-sm outline-none" style={inputBase} />
                </div>
              </div>
              <div className="p-2 overflow-y-auto flex-1 min-h-0">
                {list.length === 0 ? <div className="text-xs px-2 py-3" style={{ color: t.muted }}>No matching buses.</div>
                  : list.map((b) => { const on = b.id === bus.id;
                    return <button key={b.id} onClick={() => setSel(b.id)} className="w-full text-left rounded-lg px-2.5 py-2 mb-0.5" style={{ background: on ? t.primarySoft : "transparent", border: "1px solid " + (on ? t.primary : "transparent") }}>
                      <div className="text-sm font-medium truncate" style={{ color: t.text }}>{b.vehicle}</div>
                      <div className="text-xs truncate" style={{ color: t.muted }}>{b.route && b.route !== RUN_OPTIMISER ? b.route : (b.type || b.unit)}</div>
                    </button>; })}
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex-1 min-w-0 space-y-4">
        <Card t={t}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div><div className="text-xl font-bold flex items-center gap-2" style={{ color: t.text }}><UnitDot t={t} unit={bus.unit} />{bus.vehicle} {m && <Pill t={t} kind={h} />}</div>
              <div className="text-sm mt-0.5" style={{ color: t.muted }}>{bus.route && bus.route !== RUN_OPTIMISER ? bus.route + " · " : ""}{bus.unit}{bus.type ? " · " + bus.type : ""} · {rangeLabel}</div></div>
            {m && bd && <span className="rounded-full px-3 py-1 text-sm font-semibold" style={{ background: bd.color + "22", color: bd.color }}>{bd.label} · {pct(m.util)}</span>}
          </div>
        </Card>

        {/* BASIC METRICS — moved to the top, with a date-range selector like the Compare tab */}
        <Card t={t} title="Basic metrics" hint={`Aggregated over ${rangeLabel}.`}
          right={
            <div className="flex flex-wrap items-end gap-2">
              <Field t={t} label="From"><TextInput t={t} type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} /></Field>
              <Field t={t} label="To"><TextInput t={t} type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} /></Field>
            </div>
          }>
          {m ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {metricTile("Seat capacity", bus.capacity, t.text)}
              {metricTile(isRange ? "Rider-days" : "Present", isRange ? agg.present : `${agg.present}/${bus.capacity}`, t.good)}
              {metricTile("Present vs allocated", pct(presentVsAlloc))}
              {metricTile("Utilisation", pct(m.util), bd ? bd.color : t.text)}
              {metricTile("Absent", agg.absent)}
              {metricTile("Cost / head", inr(m.cph))}
              {metricTile("Cost / km", agg.km > 0 ? inr1(m.cpk) : optVal)}
              {metricTile("Budget", inr(agg.budget))}
              {metricTile("Spend", inr(agg.spend))}
              {metricTile("Min ride", minRide != null ? minRide + " min" : optVal)}
              {metricTile("Max ride", maxRide != null ? maxRide + " min" : optVal)}
              {showNV && metricTile("Net value (yr)", inrK(m.netAnnual), m.netAnnual >= 0 ? t.good : t.poor)}
            </div>
          ) : <div className="text-sm" style={{ color: t.muted }}>No attendance / cost data for this bus in the selected range.</div>}
          <p className="text-xs mt-3" style={{ color: t.muted }}>Cost/km and ride times show "{RUN_OPTIMISER}" until the route is planned in the Optimiser (that's where per-bus km &amp; travel time are computed). Cost/head, budget, spend &amp; net value come from the cost card below.</p>
        </Card>

        {/* Bus & driver info now sit BELOW the metrics */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Card t={t} title="Bus info">
            <div className="grid grid-cols-2 gap-4">{infoItem("Vehicle", bus.vehicle)}{infoItem("Route", bus.route)}{infoItem("Unit / Company", bus.unit)}{infoItem("Capacity", bus.capacity + " seats")}</div>
          </Card>
          <Card t={t} title="Driver info">
            <div className="grid grid-cols-2 gap-4">{infoItem("Driver", bus.driver || "—")}{infoItem("Phone", bus.phone || "—")}</div>
          </Card>
        </div>

        <CostCard t={t} bus={bus} profile={busCosts && busCosts[bus.id]} wd={wd} onChange={(p) => onBusCost(bus.id, p)} />

        <Card t={t} title={`Employees (${emps.length})`} hint="Latest punch status · click an employee for full details">
          {emps.length ? <div className="flex flex-wrap gap-1.5">{emps.slice().sort((a, b) => { const r = (st) => (st === "A" ? 0 : st === "P" ? 2 : 1); return r(day[a.id]) - r(day[b.id]); }).map((e) => { const st = day[e.id]; const c = st === "P" ? t.good : st === "A" ? t.poor : t.faint; const lab = st === "P" ? "P" : st === "A" ? "A" : "–";
            return <button key={e.id} onClick={() => setOpenEmp(e)} title={st === "P" ? "Present" : st === "A" ? "Absent" : "No punch"} className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs transition" style={{ background: t.surface2, border: "1px solid " + t.border, color: t.text }}><span className="w-4 h-4 rounded flex items-center justify-center text-[9px] font-bold" style={{ background: c + "22", color: c }}>{lab}</span>{e.name}</button>; })}</div>
            : <div className="text-sm" style={{ color: t.muted }}>No employees mapped to this bus.</div>}
        </Card>

        {/* Stops — populated later from the Optimiser's route plan; blank for now */}
        <Card t={t} title="Stops" hint="The pickup/drop stops assigned to this bus. These will be filled in automatically once the route is allotted through the Optimiser.">
          <div className="rounded-xl border border-dashed py-8 text-center text-sm" style={{ borderColor: t.border, color: t.muted }}>
            <MapPin size={18} className="inline-block mb-1.5 opacity-60" />
            <div>No stops allotted yet.</div>
            <div className="text-xs mt-0.5">Assign a route in the Optimiser tab and the stops will appear here.</div>
          </div>
        </Card>

        <Card t={t} title="Metrics for this bus" hint="Your custom metrics, computed for this bus over the selected range. Create or edit them in the Metrics tab.">
          {m && formulas.length ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">{formulas.map((f) => { const val = evalFormula(f.expr, m, vmap); const col = f.bands && f.bands.length && val != null ? bandFor(val, f.bands).color : null; return <React.Fragment key={f.id}>{metricTile(f.name, fmtFormula(val, f), col)}</React.Fragment>; })}</div>
          ) : <div className="text-sm" style={{ color: t.muted }}>{formulas.length ? "No data in range." : "No metrics yet — create them in the Metrics tab."}</div>}
        </Card>

        {/* Documents — RC / insurance / permit / fitness etc., stored per bus */}
        <BusDocuments t={t} busId={bus.id} busLabel={bus.vehicle} toast={toast} />
      </div>

      {openEmp && (
        <Modal t={t} title="Employee details" onClose={() => setOpenEmp(null)}>
          <div className="grid grid-cols-2 gap-4">
            {infoItem("Name", openEmp.name)}
            {infoItem("Employee code", openEmp.code || "—")}
            {infoItem("Company", bus.unit)}
            {infoItem("Department", openEmp.department || "—")}
            {infoItem("Designation", openEmp.designation || "—")}
            {infoItem("Travel time", openEmp.travelMin != null ? openEmp.travelMin + " min" : optVal)}
            {infoItem("Bus", bus.vehicle)}
          </div>
          <p className="text-xs mt-4" style={{ color: t.muted }}>Travel time is filled once the route is planned in the Optimiser. Department &amp; designation come from the ERP.</p>
        </Modal>
      )}
    </div>
  );
}

/* ============================ COMPARE (two independent metric panels) ============================ */
function ComparePanel({ t, label, buses, records, employees, attendance, settings, formulas, variables, unit }) {
  const wd = effWorkingDays(settings);
  const vmap = varMapOf(variables);
  const allDates = useMemo(() => unionDates(records, attendance), [records, attendance]);
  const metricOptions = [
    ...CMP_METRICS.map(([k, l]) => ["b:" + k, l]),
    ...formulas.map((f) => ["f:" + f.id, f.name]),
  ];
  // default to Utilisation — it always has data; Cost/head is ₹0 until per-bus cost cards are filled
  const [cfg, setCfg] = useState({ metric: "b:util", group: "company", filter: "all", from: "", to: "", buses: [] });
  const TT = makeTooltip(t);

  const dates = datesInRange(records, attendance, cfg.from, cfg.to);
  const valueOf = (pairs) => {
    if (!pairs.length) return null;
    const agg = aggregate(pairs, wd);
    if (cfg.metric.startsWith("b:")) return metricVal(agg, cfg.metric.slice(2));
    const f = formulas.find((x) => "f:" + x.id === cfg.metric);
    return f ? evalFormula(f.expr, scopeFromAgg(agg), vmap) : null;
  };

  const scopeBuses = buses.filter((b) => unit === "all" || b.unit === unit);
  // "By company" = one aggregated line per company (Gainup / Technotek). "By bus" = one line per picked bus.
  let series = [];
  if (cfg.group === "company") {
    series = (unit === "all" ? UNITS : [unit]).map((u) => ({ key: u, label: u, color: u === "Gainup" ? t.gainup : t.techno, company: u }));
  } else if (cfg.group === "bus") {
    const chosen = scopeBuses.filter((b) => cfg.buses.includes(b.id)); // only what's picked — no auto-select-all
    series = chosen.map((b, i) => ({ key: b.id, label: b.vehicle, sub: b.unit + " · " + b.route, color: PIE_PALETTE[i % PIE_PALETTE.length], busId: b.id }));
  }
  const chipBuses = scopeBuses.filter((b) => cfg.filter === "all" || b.unit === cfg.filter); // company filter for the chip list

  // time-series rows: one row per date; company lines aggregate all that company's buses, bus lines are per-bus
  const data = dates.map((d) => {
    const row = { date: d.slice(5) };
    series.forEach((s) => {
      if (s.company) {
        const ps = pairsForDate(buses, records, employees, attendance, d, s.company);
        row[s.key] = ps.length ? valueOf(ps) : null;
      } else {
        const bus = buses.find((b) => b.id === s.busId);
        row[s.key] = bus && busHasData(records, employees, attendance, s.busId, d)
          ? valueOf([{ bus, rec: resolveRec(records, employees, attendance, s.busId, d) }]) : null;
      }
    });
    return row;
  });
  const hasData = series.length > 0 && data.some((row) => series.some((s) => row[s.key] != null));
  const needPick = cfg.group === "bus" && cfg.buses.length === 0;
  const toggleBus = (id) => setCfg((c) => ({ ...c, buses: c.buses.includes(id) ? c.buses.filter((x) => x !== id) : [...c.buses, id] }));

  return (
    <Card t={t} title={label}>
      <div className="flex flex-wrap items-end gap-2 mb-3">
        <Field t={t} label="Metric"><div style={{ minWidth: 150 }}><SelectInput t={t} value={cfg.metric} onChange={(e) => setCfg({ ...cfg, metric: e.target.value })}>{metricOptions.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</SelectInput></div></Field>
        <Field t={t} label="Group by"><div style={{ minWidth: 130 }}><SelectInput t={t} value={cfg.group} onChange={(e) => setCfg({ ...cfg, group: e.target.value })}>{GROUP_BYS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</SelectInput></div></Field>
        <Field t={t} label="From"><TextInput t={t} type="date" value={cfg.from} onChange={(e) => setCfg({ ...cfg, from: e.target.value })} /></Field>
        <Field t={t} label="To"><TextInput t={t} type="date" value={cfg.to} onChange={(e) => setCfg({ ...cfg, to: e.target.value })} /></Field>
      </div>

      {cfg.group === "bus" && (
        <div className="mb-3 rounded-xl p-3" style={{ background: t.surface2, border: "1px solid " + t.border }}>
          <div className="flex flex-wrap items-center gap-3 mb-2">
            <span className="text-xs uppercase tracking-wider" style={{ color: t.muted }}>Show</span>
            <Segmented t={t} small value={cfg.filter} onChange={(v) => setCfg({ ...cfg, filter: v })}
              options={[["all", "All", t.primary], ["Gainup", "Gainup", t.gainup], ["Technotek", "Technotek", t.techno]]} />
            <span className="text-xs" style={{ color: t.muted }}>{cfg.buses.length} selected</span>
            <button onClick={() => setCfg({ ...cfg, buses: [...new Set([...cfg.buses, ...chipBuses.map((b) => b.id)])] })} className="text-xs font-semibold" style={{ color: t.primary }}>Select all shown</button>
            {cfg.buses.length > 0 && <button onClick={() => setCfg({ ...cfg, buses: [] })} className="text-xs" style={{ color: t.muted }}>Clear</button>}
          </div>
          <div className="flex flex-wrap gap-1.5 overflow-auto" style={{ maxHeight: 132 }}>
            {chipBuses.length === 0 ? <span className="text-xs" style={{ color: t.muted }}>No buses in the current data.</span>
              : chipBuses.map((b) => { const on = cfg.buses.includes(b.id);
                return <button key={b.id} onClick={() => toggleBus(b.id)} title={b.unit} className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition" style={{ background: on ? t.primarySoft : "transparent", border: "1px solid " + (on ? t.primary : t.border), color: on ? t.text : t.muted }}>
                  <span className="w-2 h-2 rounded-sm" style={{ background: b.unit === "Gainup" ? t.gainup : t.techno }} />{b.vehicle}</button>; })}
          </div>
        </div>
      )}

      {needPick ? (
        <div className="text-sm py-10 text-center" style={{ color: t.muted }}>Pick one or more buses above to plot — you can mix Gainup and Technotek.</div>
      ) : !hasData ? (
        <div className="text-sm py-10 text-center" style={{ color: t.muted }}>No data for this selection.</div>
      ) : (
        <>
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={t.grid} vertical={false} />
              <XAxis dataKey="date" tick={{ fill: t.muted, fontSize: 11 }} tickLine={false} axisLine={{ stroke: t.border }} interval="preserveStartEnd" />
              <YAxis tick={{ fill: t.muted, fontSize: 11 }} tickLine={false} axisLine={false} width={48} />
              <Tooltip content={TT} isAnimationActive={false} />
              {series.length <= 10 && <Legend wrapperStyle={{ fontSize: 11, color: t.muted }} />}
              {series.map((s) => <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={s.color} strokeWidth={2} dot={{ r: 2 }} connectNulls isAnimationActive={false} />)}
            </LineChart>
          </ResponsiveContainer>
          <p className="text-xs mt-2" style={{ color: t.muted }}>{cfg.group === "company" ? "One line per company — every bus in Gainup / Technotek aggregated together." : "One line per selected bus. Use “By company” for a clean two-line comparison."}</p>
        </>
      )}
    </Card>
  );
}
function CompareView({ t, unit, buses, records, employees, attendance, settings, formulas, variables }) {
  const dates = useMemo(() => unionDates(records, attendance), [records, attendance]);
  if (dates.length < 1) return <Empty t={t} title="Nothing to compare yet" sub="Comparisons appear once data is connected." />;
  return (
    <div>
      <p className="text-sm mb-4" style={{ color: t.muted }}>Two independent charts. Each one is driven by a <b>metric</b>, a <b>date range</b> and a <b>group-by</b> (company / bus / stop) — set them differently to compare two scenarios side by side.</p>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ComparePanel t={t} label="Chart A" unit={unit} buses={buses} records={records} employees={employees} attendance={attendance} settings={settings} formulas={formulas} variables={variables} />
        <ComparePanel t={t} label="Chart B" unit={unit} buses={buses} records={records} employees={employees} attendance={attendance} settings={settings} formulas={formulas} variables={variables} />
      </div>
    </div>
  );
}

/* ============================ EQUATIONS ============================ */
const PIE_PALETTE = ["#6366f1", "#38bdf8", "#a78bfa", "#10b981", "#f59e0b", "#f43f5e", "#14b8a6", "#eab308"];
function EquationChart({ t, formula, unit, buses, records, employees, attendance, settings, variables }) {
  const wd = effWorkingDays(settings);
  const vmap = varMapOf(variables);
  const allDates = useMemo(() => unionDates(records, attendance), [records, attendance]);
  // view: "whole" (Gainup vs Technotek aggregated) | "buses" (individually-picked buses, across companies).
  // filter only narrows which chips are shown; the selection & plot span both companies.
  const [cfg, setCfg] = useState({ axis: "bus", view: "whole", filter: "all", type: "bar", buses: [], from: "", to: "" });
  const TT = makeTooltip(t);
  const expr = formula.expr;

  const dates = allDates.filter((d) => (!cfg.from || d >= cfg.from) && (!cfg.to || d <= cfg.to));
  const chipBuses = buses.filter((b) => cfg.filter === "all" || b.unit === cfg.filter);
  const selBuses = buses.filter((b) => cfg.buses.includes(b.id)); // selection is global — mix Gainup + Technotek
  const toggleBus = (id) => setCfg((c) => ({ ...c, buses: c.buses.includes(id) ? c.buses.filter((x) => x !== id) : [...c.buses, id] }));

  const timeData = dates.map((d) => {
    const row = { name: d.slice(5) };
    UNITS.forEach((u) => { const ps = pairsForDate(buses, records, employees, attendance, d, u); row[u] = ps.length ? evalFormula(expr, scopeFromAgg(aggregate(ps, wd)), vmap) : null; });
    const all = pairsForDate(buses, records, employees, attendance, d, "all"); row.Combined = all.length ? evalFormula(expr, scopeFromAgg(aggregate(all, wd)), vmap) : null;
    return row;
  });
  // "By bus" data: either whole-company aggregates, or the individually-picked buses of one company
  const latestDate = allDates[allDates.length - 1];
  const wholeData = UNITS.map((u) => {
    const ps = latestDate ? pairsForDate(buses, records, employees, attendance, latestDate, u) : [];
    return { name: u, unit: u, capacity: ps.reduce((s, p) => s + (+p.bus.capacity || 0), 0), value: ps.length ? evalFormula(expr, scopeFromAgg(aggregate(ps, wd)), vmap) : null };
  }).filter((x) => x.value != null);
  const perBusData = selBuses.map((b) => {
    const d = busLatestDate(records, employees, attendance, b.id);
    const m = d ? metricsFor(resolveRec(records, employees, attendance, b.id, d), b, wd) : null;
    return { name: b.vehicle, unit: b.unit, capacity: b.capacity, value: m ? evalFormula(expr, m, vmap) : null };
  }).filter((x) => x.value != null);
  const busData = cfg.view === "whole" ? wholeData : perBusData;

  const seriesKeys = cfg.axis === "time" ? (unit === "all" ? ["Gainup", "Technotek", "Combined"] : [unit]) : ["value"];
  const colorFor = (k) => (k === "Gainup" ? t.gainup : k === "Technotek" ? t.techno : t.primary);
  const data = cfg.axis === "time" ? timeData : busData;
  const valLabel = formula.unit === "₹" ? "₹" : formula.unit === "%" ? "%" : "";

  /* ---- visual helpers: gradients per series, avg reference line, short value formatter ---- */
  const gid = (k) => `eqg-${formula.id}-${k}`; // unique per chart instance (several charts share the page)
  const fmtShort = (v) => v == null ? "" : formula.unit === "₹" ? inrK(v) : formula.unit === "%" ? Math.round(v) + "%" : Math.abs(v) >= 1000 ? (v / 1000).toFixed(1) + "k" : (Math.round(v * 10) / 10).toLocaleString("en-IN");
  const GRAD_KEYS = ["Gainup", "Technotek", "Combined", "value"];
  const Grads = () => (
    <defs>
      {GRAD_KEYS.map((k) => {
        const c = colorFor(k);
        return (
          <React.Fragment key={k}>
            {/* soft wash for lines/areas */}
            <linearGradient id={gid(k)} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={c} stopOpacity={0.55} />
              <stop offset="100%" stopColor={c} stopOpacity={0.04} />
            </linearGradient>
            {/* punchier fill for bars */}
            <linearGradient id={gid("b" + k)} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={c} stopOpacity={0.95} />
              <stop offset="100%" stopColor={c} stopOpacity={0.45} />
            </linearGradient>
          </React.Fragment>
        );
      })}
    </defs>
  );
  const vals = (cfg.axis === "bus" ? busData.map((d) => d.value) : timeData.map((d) => d.Combined)).filter((v) => v != null);
  const avgVal = vals.length > 2 ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  const AvgLine = () => avgVal == null ? null : (
    <ReferenceLine y={avgVal} stroke={t.watch} strokeDasharray="5 4" strokeOpacity={0.75}
      label={{ value: "avg " + fmtShort(avgVal), fill: t.watch, fontSize: 10, fontWeight: 600, position: "insideTopRight" }} />
  );
  const yTick = { tick: { fill: t.muted, fontSize: 11 }, tickLine: false, axisLine: false, width: 52, tickFormatter: fmtShort };

  let chart = null;
  const noData = (cfg.axis === "bus" ? busData.length === 0 : timeData.every((d) => d.Combined == null));
  const needPick = cfg.axis === "bus" && cfg.view === "buses" && cfg.buses.length === 0;
  if (noData) chart = <div className="text-sm py-10 text-center" style={{ color: t.muted }}>{needPick ? "Pick one or more buses above to plot — you can mix Gainup and Technotek." : "No data to plot."}</div>;
  else if (cfg.type === "line") chart = (
    <ResponsiveContainer width="100%" height={260}><AreaChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
      {Grads()}
      <CartesianGrid strokeDasharray="3 3" stroke={t.grid} vertical={false} />
      <XAxis dataKey="name" tick={{ fill: t.muted, fontSize: 11 }} tickLine={false} axisLine={{ stroke: t.border }} interval="preserveStartEnd" />
      <YAxis {...yTick} />
      <Tooltip content={TT} />{cfg.axis === "time" && unit === "all" && <Legend wrapperStyle={{ fontSize: 12, color: t.muted }} />}
      {AvgLine()}
      {seriesKeys.map((k) => <Area key={k} type="monotone" dataKey={k} name={k === "value" ? formula.name : k}
        stroke={colorFor(k)} strokeWidth={2.5} fill={`url(#${gid(k)})`} fillOpacity={0.35}
        dot={{ r: 3, fill: colorFor(k), strokeWidth: 0 }} activeDot={{ r: 5.5, stroke: t.surface, strokeWidth: 2 }}
        connectNulls animationDuration={900} animationEasing="ease-out" />)}
    </AreaChart></ResponsiveContainer>
  );
  else if (cfg.type === "area") chart = (
    <ResponsiveContainer width="100%" height={260}><AreaChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
      {Grads()}
      <CartesianGrid strokeDasharray="3 3" stroke={t.grid} vertical={false} />
      <XAxis dataKey="name" tick={{ fill: t.muted, fontSize: 11 }} tickLine={false} axisLine={{ stroke: t.border }} interval="preserveStartEnd" />
      <YAxis {...yTick} />
      <Tooltip content={TT} />{cfg.axis === "time" && unit === "all" && <Legend wrapperStyle={{ fontSize: 12, color: t.muted }} />}
      {AvgLine()}
      {seriesKeys.map((k) => <Area key={k} type="monotone" dataKey={k} name={k === "value" ? formula.name : k}
        stroke={colorFor(k)} strokeWidth={2.5} fill={`url(#${gid(k)})`}
        activeDot={{ r: 5.5, stroke: t.surface, strokeWidth: 2 }}
        connectNulls animationDuration={900} animationEasing="ease-out" />)}
    </AreaChart></ResponsiveContainer>
  );
  else if (cfg.type === "bar") chart = (
    <ResponsiveContainer width="100%" height={260}><BarChart data={data} margin={{ top: 18, right: 12, left: 0, bottom: 0 }}>
      {Grads()}
      <CartesianGrid strokeDasharray="3 3" stroke={t.grid} vertical={false} />
      <XAxis dataKey="name" tick={{ fill: t.muted, fontSize: 11 }} tickLine={false} axisLine={{ stroke: t.border }} interval={0} angle={cfg.axis === "bus" ? -15 : 0} textAnchor={cfg.axis === "bus" ? "end" : "middle"} height={cfg.axis === "bus" ? 50 : 30} />
      <YAxis {...yTick} />
      <Tooltip content={TT} cursor={{ fill: t.primarySoft }} />{cfg.axis === "time" && unit === "all" && <Legend wrapperStyle={{ fontSize: 12, color: t.muted }} />}
      {AvgLine()}
      {cfg.axis === "bus"
        ? <Bar dataKey="value" name={formula.name} radius={[8, 8, 2, 2]} maxBarSize={70} animationDuration={900} animationEasing="ease-out">
            {busData.map((d, i) => <Cell key={i} fill={`url(#${gid("b" + (d.unit === "Gainup" ? "Gainup" : "Technotek"))})`} stroke={d.unit === "Gainup" ? t.gainup : t.techno} strokeWidth={1} />)}
            <LabelList dataKey="value" position="top" formatter={fmtShort} fill={t.muted} fontSize={10} fontWeight={600} />
          </Bar>
        : seriesKeys.map((k) => <Bar key={k} dataKey={k} name={k} fill={`url(#${gid("b" + k)})`} stroke={colorFor(k)} strokeWidth={1} radius={[6, 6, 2, 2]} maxBarSize={36} animationDuration={900} animationEasing="ease-out" />)}
    </BarChart></ResponsiveContainer>
  );
  else if (cfg.type === "pie") {
    const pieData = (cfg.axis === "bus" ? busData.map((d) => ({ name: d.name, value: Math.max(0, d.value), color: d.unit === "Gainup" ? t.gainup : t.techno }))
      : timeData.filter((d) => d.Combined != null).map((d, i) => ({ name: d.name, value: Math.max(0, d.Combined), color: PIE_PALETTE[i % PIE_PALETTE.length] })));
    const total = pieData.reduce((a, b) => a + b.value, 0);
    chart = (
      <ResponsiveContainer width="100%" height={280}><PieChart>
        <Tooltip content={TT} />
        <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={105} innerRadius={62}
          paddingAngle={3} cornerRadius={6} stroke={t.surface} strokeWidth={2}
          animationDuration={900} animationEasing="ease-out"
          label={({ name, percent }) => percent > 0.06 ? `${name} ${(percent * 100).toFixed(0)}%` : ""}
          labelLine={{ stroke: t.faint, strokeWidth: 1 }} fontSize={10}>
          {pieData.map((d, i) => <Cell key={i} fill={d.color} fillOpacity={0.9} />)}
        </Pie>
        <text x="50%" y="47%" textAnchor="middle" dominantBaseline="central" fill={t.text} fontSize={20} fontWeight={700}>{fmtShort(total)}</text>
        <text x="50%" y="47%" dy={20} textAnchor="middle" dominantBaseline="central" fill={t.muted} fontSize={10} style={{ textTransform: "uppercase", letterSpacing: 1 }}>total</text>
      </PieChart></ResponsiveContainer>
    );
  }
  else if (cfg.type === "scatter") {
    const TTs = makeTooltip(t);
    if (cfg.axis === "bus") chart = (
      <ResponsiveContainer width="100%" height={280}><ScatterChart margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={t.grid} />
        <XAxis type="number" dataKey="capacity" name="capacity" tick={{ fill: t.muted, fontSize: 11 }} axisLine={{ stroke: t.border }} label={{ value: "capacity", fill: t.muted, fontSize: 11, position: "insideBottom", dy: 12 }} />
        <YAxis type="number" dataKey="value" name={formula.name} {...yTick} />
        <Tooltip content={TTs} cursor={{ stroke: t.border, strokeDasharray: "4 4" }} />
        {AvgLine()}
        <Scatter data={busData} animationDuration={900} animationEasing="ease-out" shape={(p) => <circle cx={p.cx} cy={p.cy} r={9} fill={p.payload.unit === "Gainup" ? t.gainup : t.techno} fillOpacity={0.5} stroke={p.payload.unit === "Gainup" ? t.gainup : t.techno} strokeWidth={2} />} />
      </ScatterChart></ResponsiveContainer>
    );
    else { const pts = timeData.filter((d) => d.Combined != null).map((d, i) => ({ idx: i, name: d.name, value: d.Combined }));
      chart = (
        <ResponsiveContainer width="100%" height={280}><ScatterChart margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={t.grid} />
          <XAxis type="number" dataKey="idx" name="day" tick={{ fill: t.muted, fontSize: 11 }} axisLine={{ stroke: t.border }} tickFormatter={(i) => pts[i] ? pts[i].name : ""} />
          <YAxis type="number" dataKey="value" name={formula.name} {...yTick} />
          <Tooltip content={TTs} cursor={{ stroke: t.border, strokeDasharray: "4 4" }} />
          {AvgLine()}
          <Scatter data={pts} animationDuration={900} animationEasing="ease-out" shape={(p) => <circle cx={p.cx} cy={p.cy} r={8} fill={t.primary} fillOpacity={0.5} stroke={t.primary} strokeWidth={2} />} />
        </ScatterChart></ResponsiveContainer>
      );
    }
  }

  return (
    <Card t={t}>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
        <div>
          <h3 className="font-semibold text-base" style={{ color: t.text }}>{formula.name}{valLabel && <span className="text-xs ml-1" style={{ color: t.muted }}>({valLabel})</span>}</h3>
          <code className="text-xs font-mono" style={{ color: t.gainup }}>{formula.expr}</code>
        </div>
        <div className="flex flex-wrap gap-2">
          <Segmented t={t} small value={cfg.axis} onChange={(v) => setCfg({ ...cfg, axis: v })} options={[["bus", "By bus"], ["time", "Over time"]]} />
          <Segmented t={t} small value={cfg.type} onChange={(v) => setCfg({ ...cfg, type: v })} options={GRAPH_TYPES} />
        </div>
      </div>

      {cfg.axis === "bus" && (
        <div className="mb-3 rounded-xl p-3" style={{ background: t.surface2, border: "1px solid " + t.border }}>
          <div className="flex flex-wrap items-center gap-3 mb-2">
            <span className="text-xs uppercase tracking-wider" style={{ color: t.muted }}>View</span>
            <Segmented t={t} small value={cfg.view} onChange={(v) => setCfg({ ...cfg, view: v })}
              options={[["whole", "Companies", t.primary], ["buses", "Individual buses", t.primary]]} />
          </div>
          {cfg.view === "whole" ? (
            <div className="text-xs" style={{ color: t.muted }}>Comparing Gainup vs Technotek as whole companies, aggregated over the latest day. Switch to “Individual buses” to compare specific buses — you can mix both companies.</div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-3 mb-2">
                <span className="text-xs uppercase tracking-wider" style={{ color: t.muted }}>Show</span>
                <Segmented t={t} small value={cfg.filter} onChange={(v) => setCfg({ ...cfg, filter: v })}
                  options={[["all", "All", t.primary], ["Gainup", "Gainup", t.gainup], ["Technotek", "Technotek", t.techno]]} />
                <span className="text-xs" style={{ color: t.muted }}>{selBuses.length} selected</span>
                <button onClick={() => setCfg({ ...cfg, buses: [...new Set([...cfg.buses, ...chipBuses.map((b) => b.id)])] })} className="text-xs font-semibold" style={{ color: t.primary }}>Select all shown</button>
                {cfg.buses.length > 0 && <button onClick={() => setCfg({ ...cfg, buses: [] })} className="text-xs" style={{ color: t.muted }}>Clear</button>}
              </div>
              <div className="flex flex-wrap gap-1.5 overflow-auto" style={{ maxHeight: 132 }}>
                {chipBuses.length === 0 ? <span className="text-xs" style={{ color: t.muted }}>No buses in the current data.</span>
                  : chipBuses.map((b) => { const on = cfg.buses.includes(b.id);
                    return <button key={b.id} onClick={() => toggleBus(b.id)} title={b.unit} className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition" style={{ background: on ? t.primarySoft : "transparent", border: "1px solid " + (on ? t.primary : t.border), color: on ? t.text : t.muted }}>
                      <span className="w-2 h-2 rounded-sm" style={{ background: b.unit === "Gainup" ? t.gainup : t.techno }} />{b.vehicle}</button>; })}
              </div>
            </>
          )}
        </div>
      )}
      {cfg.axis === "time" && (
        <div className="mb-3 flex flex-wrap items-end gap-3 rounded-xl p-3" style={{ background: t.surface2, border: "1px solid " + t.border }}>
          <Field t={t} label="From"><TextInput t={t} type="date" value={cfg.from} onChange={(e) => setCfg({ ...cfg, from: e.target.value })} /></Field>
          <Field t={t} label="To"><TextInput t={t} type="date" value={cfg.to} onChange={(e) => setCfg({ ...cfg, to: e.target.value })} /></Field>
          {(cfg.from || cfg.to) && <button onClick={() => setCfg({ ...cfg, from: "", to: "" })} className="text-xs rounded-lg px-3 py-2.5" style={{ border: "1px solid " + t.border, color: t.muted }}>Clear range</button>}
        </div>
      )}
      {chart}
    </Card>
  );
}
function EquationsView({ t, unit, buses, records, employees, attendance, formulas, settings, variables }) {
  if (!formulas.length) return <Empty t={t} title="No metrics yet" sub="Create metrics in the Metrics tab — each one becomes a chart here." />;
  return <div className="space-y-4">{formulas.map((f) => <EquationChart key={f.id} t={t} formula={f} unit={unit} buses={buses} records={records} employees={employees} attendance={attendance} settings={settings} variables={variables} />)}</div>;
}

/* ============================ METRICS (was Formulas) ============================ */
function MetricForm({ t, editing, variables, onSubmit, onCancel, toast }) {
  const [f, setF] = useState({ name: "", unit: "", decimals: "0", description: "" });
  const [tokens, setTokens] = useState([]);
  const [bands, setBands] = useState([]);
  const [showBands, setShowBands] = useState(false);
  useEffect(() => {
    if (editing) {
      setF({ name: editing.name, unit: editing.unit || "", decimals: String(editing.decimals ?? 0), description: editing.description || "" });
      setTokens(exprToTokens(editing.expr));
      setBands(editing.bands ? editing.bands.map((b) => ({ ...b })) : []);
      setShowBands(!!(editing.bands && editing.bands.length));
    } else { setF({ name: "", unit: "", decimals: "0", description: "" }); setTokens([]); setBands([]); setShowBands(false); }
  }, [editing]);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const expr = tokensToExpr(tokens);
  const sample = useMemo(() => {
    const s = { present: 38, absent: 3, capacity: 42, assigned: 41, km: 48, budget: 2600, spend: 2480 };
    s.util = (s.present / s.capacity) * 100; s.cph = s.spend / s.present; s.cpk = s.spend / s.km; s.variance = s.budget - s.spend; return s;
  }, []);
  const preview = expr ? evalFormula(expr, sample, varMapOf(variables)) : undefined;
  const submit = () => {
    if (!f.name || !expr || preview == null) return toast && toast("Enter a name and a valid formula");
    onSubmit({ id: editing ? editing.id : uid(), name: f.name, expr, unit: f.unit, decimals: parseInt(f.decimals || "0"), description: f.description, bands: showBands && bands.length ? bands : undefined });
    if (!editing) { setF({ name: "", unit: "", decimals: "0", description: "" }); setTokens([]); setBands([]); setShowBands(false); }
  };
  return (
    <div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Field t={t} label="Name"><TextInput t={t} value={f.name} onChange={set("name")} placeholder="Cost per seat" /></Field>
        <Field t={t} label="Unit label"><SelectInput t={t} value={f.unit} onChange={set("unit")}><option value="">number</option><option value="₹">₹</option><option value="%">%</option><option value="km">km</option></SelectInput></Field>
        <Field t={t} label="Decimals"><TextInput t={t} type="number" min="0" max="4" value={f.decimals} onChange={set("decimals")} /></Field>
      </div>
      <div className="mt-3"><Field t={t} label="Description"><TextInput t={t} value={f.description} onChange={set("description")} placeholder="What this metric means / how to read it" /></Field></div>

      <div className="mt-3">
        <span className="block text-xs mb-1.5" style={{ color: t.muted }}>Formula</span>
        <TokenFormulaEditor t={t} tokens={tokens} setTokens={setTokens} variables={variables} />
      </div>

      {expr && <div className="text-xs mt-3" style={{ color: preview == null ? t.poor : t.muted }}>
        {preview == null ? "Invalid formula — check the expression." : <>On a sample bus → <b style={{ color: t.text }}>{preview.toLocaleString("en-IN", { maximumFractionDigits: 2 })}</b></>}
      </div>}

      <div className="mt-4 rounded-xl p-3" style={{ background: t.surface2, border: "1px solid " + t.border }}>
        <label className="flex items-center gap-2 text-sm" style={{ color: t.text }}>
          <input type="checkbox" checked={showBands} onChange={(e) => { setShowBands(e.target.checked); if (e.target.checked && !bands.length) setBands([{ id: uid(), label: "Good", min: 0, color: t.good }]); }} />
          Performance bands for this metric (optional)
        </label>
        {showBands && <div className="mt-3"><BandsEditor t={t} bands={bands} setBands={setBands} /><p className="text-xs mt-2" style={{ color: t.muted }}>The metric value is colour-coded by the highest band whose minimum it meets (shown in the Bus-wise tab).</p></div>}
      </div>

      <div className="mt-4 flex gap-2">
        <Btn t={t} onClick={submit}>{editing ? <><Pencil size={15} /> Update metric</> : <><Plus size={16} /> Add metric</>}</Btn>
        {editing && <Btn t={t} variant="ghost" onClick={onCancel}><X size={15} /> Cancel</Btn>}
      </div>
    </div>
  );
}
function VariablesCard({ t, variables, onAdd, onUpdate, onDel, toast }) {
  const [nv, setNv] = useState({ name: "", value: "" });
  const add = () => {
    const name = nv.name.trim();
    if (!/^[a-zA-Z_]\w*$/.test(name)) return toast("Use a letter/underscore name, no spaces (e.g. tailors)");
    if (FORMULA_VARS.includes(name) || variables.some((v) => v.name === name)) return toast("That variable name is already taken");
    onAdd({ id: uid(), name, value: Number(nv.value) || 0 });
    setNv({ name: "", value: "" });
  };
  return (
    <Card t={t} title="Variables" hint="Independent values you set by hand (e.g. number of tailors) that can't be derived from other data. Use them in any metric formula.">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <TextInput t={t} value={nv.name} onChange={(e) => setNv({ ...nv, name: e.target.value })} placeholder="Variable name (e.g. tailors)" />
        <TextInput t={t} type="number" value={nv.value} onChange={(e) => setNv({ ...nv, value: e.target.value })} placeholder="Value" />
        <Btn t={t} onClick={add}><Plus size={15} /> Add variable</Btn>
      </div>
      {variables.length > 0 && (
        <div className="mt-3 space-y-2">
          {variables.map((v) => (
            <div key={v.id} className="flex items-center gap-3 rounded-xl p-2.5" style={{ background: t.surface2, border: "1px solid " + t.border }}>
              <span className="font-mono text-sm font-semibold px-2 py-1 rounded-lg" style={{ background: t.primarySoft, color: t.gainup }}>{v.name}</span>
              <span className="text-xs" style={{ color: t.muted }}>=</span>
              <div style={{ width: 140 }}><TextInput t={t} type="number" value={v.value} onChange={(e) => onUpdate({ ...v, value: Number(e.target.value) || 0 })} /></div>
              <button onClick={() => onDel(v.id)} className="ml-auto inline-flex items-center gap-1 text-xs rounded-lg px-2.5 py-1.5" style={{ border: "1px solid " + t.border, color: t.muted }}><Trash2 size={13} /> remove</button>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
function MetricsView({ t, formulas, variables, onAdd, onUpdate, onDel, onAddVar, onUpdateVar, onDelVar, toast }) {
  const [editing, setEditing] = useState(null);
  return (
    <div className="space-y-4">
      <VariablesCard t={t} variables={variables} onAdd={onAddVar} onUpdate={onUpdateVar} onDel={onDelVar} toast={toast} />
      <Card t={t} title={editing ? "Edit metric" : "Create a metric"} hint="Build the formula with the variable / operator / number buttons — typing is disabled, and Backspace removes a whole chip at a time.">
        <MetricForm t={t} editing={editing} variables={variables} toast={toast} onCancel={() => setEditing(null)} onSubmit={(fm) => { editing ? onUpdate(fm) : onAdd(fm); setEditing(null); }} />
      </Card>
      <Card t={t} title="Your metrics">
        {formulas.length === 0 ? <div className="text-sm" style={{ color: t.muted }}>No custom metrics yet.</div> : (
          <div className="space-y-2">{formulas.map((f) => (
            <div key={f.id} className="flex items-center gap-3 rounded-xl p-3" style={{ background: t.surface2, border: "1px solid " + t.border }}>
              <div className="flex-1 min-w-0">
                <div style={{ color: t.text }}><b>{f.name}</b> <span className="text-xs" style={{ color: t.muted }}>→ {f.unit || "number"}</span>
                  {f.bands && f.bands.length > 0 && <span className="ml-2 inline-flex flex-wrap gap-1 align-middle">{[...f.bands].sort((a, b) => b.min - a.min).map((b) => <span key={b.id} className="rounded-full px-1.5 py-0.5 text-[10px] font-semibold" style={{ background: b.color + "22", color: b.color }}>{b.label}≥{b.min}</span>)}</span>}
                </div>
                <code className="text-xs font-mono" style={{ color: t.gainup }}>{f.expr}</code>
                {f.description && <div className="text-xs mt-0.5" style={{ color: t.muted }}>{f.description}</div>}
              </div>
              <button onClick={() => setEditing(f)} className="inline-flex items-center gap-1 text-xs rounded-lg px-2.5 py-1.5" style={{ border: "1px solid " + t.border, color: t.muted }}><Pencil size={13} /> edit</button>
              <button onClick={() => onDel(f.id)} className="inline-flex items-center gap-1 text-xs rounded-lg px-2.5 py-1.5" style={{ border: "1px solid " + t.border, color: t.muted }}><Trash2 size={13} /> remove</button>
            </div>))}</div>
        )}
      </Card>
    </div>
  );
}

/* ============================ SETTINGS ============================ */
function SettingsView({ t, settings, setSettings, onReset, onExport, onSyncErp, erpStatus, toast, themeName, setThemeName }) {
  const [syncing, setSyncing] = useState(false);
  const doSync = async () => { setSyncing(true); try { await onSyncErp(); } finally { setSyncing(false); } };
  const erpLabel = erpStatus.phase === "ok" ? `● Live — ${erpStatus.msg}, updated ${fmtClock(erpStatus.at)}`
    : erpStatus.phase === "syncing" ? "● Syncing…"
    : erpStatus.phase === "error" ? `● Offline — ${erpStatus.msg}` : "● Not connected yet";
  const setNum = (k) => (e) => setSettings({ ...settings, [k]: parseFloat(e.target.value) || settings[k] });
  const rowStyle = { borderBottom: "1px solid " + t.border };
  const bands = settings.bands || DEFAULT_BANDS;
  const holidays = settings.holidays || [];
  const setHolidays = (h) => setSettings({ ...settings, holidays: h });
  const delHoliday = (d) => setHolidays(holidays.filter((x) => x !== d));
  const [gkey, setGkey] = useState(getGoogleKey());
  const saveKey = (val) => { setGoogleKey(val); toast(val ? "Google key saved — reloading" : "Using built-in key — reloading"); setTimeout(() => window.location.reload(), 700); };
  return (
    <div className="space-y-4">
      <Card t={t} title="Appearance" hint="Pick a theme for the whole dashboard. It applies instantly and is saved automatically.">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {Object.values(THEMES).map((th) => {
            const on = themeName === th.name;
            return (
              <button key={th.name} data-fx="swatch" onMouseDown={fxPress} onMouseEnter={fxLift} onMouseLeave={fxDrop} onClick={() => setThemeName(th.name)} className="rounded-xl p-3 text-left transition-colors"
                style={{ background: th.surface, border: "2px solid " + (on ? t.primary : th.border), boxShadow: on ? `0 0 0 3px ${t.primarySoft}` : "none" }}>
                <div className="flex items-center gap-1.5 mb-2">
                  {[th.primary, th.good, th.watch, th.poor].map((c, i) => (
                    <span key={i} className="w-4 h-4 rounded-full" style={{ background: c, border: "1px solid rgba(255,255,255,.18)" }} />
                  ))}
                </div>
                <div className="text-sm font-semibold" style={{ color: th.text }}>{th.label || th.name}</div>
                <div className="text-xs mt-0.5" style={{ color: on ? th.primary : th.muted }}>{on ? "● Active" : "Tap to use"}</div>
              </button>
            );
          })}
        </div>
      </Card>

      <Card t={t} title="Google Maps API key" hint="Required for the map + road distances. Paste the Google Maps key you were given, then Save — the page reloads to apply it. It's stored only in your browser, never in the code.">
        <div className="flex flex-wrap items-end gap-3">
          <div style={{ flex: 1, minWidth: 280 }}>
            <TextInput t={t} value={gkey} onChange={(e) => setGkey(e.target.value)} placeholder="AIza…  (paste your key)" />
          </div>
          <Btn t={t} onClick={() => saveKey(gkey)}>Save &amp; reload</Btn>
          {getGoogleKey() && <Btn t={t} variant="ghost" onClick={() => { setGkey(""); saveKey(""); }}>Clear</Btn>}
        </div>
        <div className="text-xs mt-2" style={{ color: t.muted }}>{getGoogleKey() ? "● Using your saved key." : "● No key set — the map & road distances are off until you add one."}</div>
      </Card>

      <Card t={t}>
        <div className="flex items-center justify-between py-4 gap-4" style={rowStyle}>
          <div><div className="font-semibold" style={{ color: t.text }}>Net Value (profit)</div><div className="text-sm mt-0.5" style={{ color: t.muted, maxWidth: 520 }}>Net Value = (Budget − Spend) × working days, annualised. When on, it shows on each Live tile, in the Bus-wise detail, and as a KPI. Off hides it everywhere.</div></div>
          <div className="shrink-0"><Switch t={t} label="Show Net Value" checked={settings.showNetValue} onChange={(v) => setSettings({ ...settings, showNetValue: v })} /></div>
        </div>
        <div className="flex items-center justify-between py-4 gap-4" style={rowStyle}>
          <div><div className="font-semibold" style={{ color: t.text }}>Working days / year</div><div className="text-sm mt-0.5" style={{ color: t.muted, maxWidth: 520 }}>Used to annualise the Net Value. Effective working days = this minus the holidays you declare below (currently <b style={{ color: t.text }}>{effWorkingDays(settings)}</b>).</div></div>
          <div className="shrink-0" style={{ width: 110 }}><TextInput t={t} type="number" value={settings.workingDays} onChange={setNum("workingDays")} /></div>
        </div>
      </Card>

      <Card t={t} title="Holidays" hint="Click dates on the calendar to toggle holidays — select as many as you like, it saves automatically. Each holiday is removed from the effective working days used for annualised figures.">
        <div className="flex flex-col lg:flex-row gap-4">
          <HolidayCalendar t={t} holidays={holidays} setHolidays={setHolidays} />
          <div className="flex-1 min-w-0">
            <div className="text-xs uppercase tracking-wider mb-2" style={{ color: t.muted }}>Declared holidays ({holidays.length})</div>
            {holidays.length === 0 ? <div className="text-sm" style={{ color: t.muted }}>None yet — pick dates on the calendar.</div> : (
              <div className="flex flex-wrap gap-1.5">{holidays.map((d) => (
                <span key={d} className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs" style={{ background: t.surface2, border: "1px solid " + t.border, color: t.text }}>{d}<button onClick={() => delHoliday(d)} style={{ color: t.muted }}><X size={12} /></button></span>
              ))}</div>
            )}
          </div>
        </div>
      </Card>

      <Card t={t} title="Utilisation bands" hint="Default performance bands for the Live board + Health score. A bus sits in the highest band whose minimum utilisation % it meets. (Individual metrics can carry their own bands in the Metrics tab.)">
        <BandsEditor t={t} bands={bands} setBands={(b) => setSettings({ ...settings, bands: b })} />
      </Card>

      <Card t={t} title="ERP connection" hint="Live buses, employees and attendance from the ERP (VehicleEmpMapDetails). Auto-sync keeps the dashboard current; your per-bus cost cards, custom metrics and settings are always kept.">
        <div className="flex items-center justify-between py-2 gap-4" style={rowStyle}>
          <div><div className="font-semibold" style={{ color: t.text }}>Auto-sync (live updates)</div><div className="text-sm mt-0.5" style={{ color: t.muted, maxWidth: 520 }}>When on, the dashboard connects to the ERP on load and refreshes every {Math.round(ERP_POLL_MS / 1000)}s. Turn off to freeze on the last pull.</div></div>
          <div className="shrink-0"><Switch t={t} label="Auto-sync from ERP" checked={settings.erpAuto !== false} onChange={(v) => setSettings({ ...settings, erpAuto: v })} /></div>
        </div>
        <div className="flex flex-wrap items-center gap-3 mt-3">
          <Btn t={t} onClick={doSync} disabled={syncing}><Server size={15} /> {syncing ? "Syncing…" : "Sync now"}</Btn>
          <span className="text-xs" style={{ color: erpStatus.phase === "error" ? t.poor : erpStatus.phase === "ok" ? t.good : t.muted }}>{erpLabel}</span>
        </div>
        <div className="text-xs mt-3" style={{ color: t.muted }}>Route / driver / phone aren't in this feed → shown as "{NEEDS_ERP}". Per-bus km, ride times &amp; stops come from the Optimiser → "{RUN_OPTIMISER}". In production this call is routed through the backend passthrough; in dev it uses the Vite proxy.</div>
      </Card>

      <Card t={t} title="Data">
        <div className="flex flex-wrap gap-3"><Btn t={t} variant="ghost" onClick={onExport}><Download size={15} /> Export all data (JSON)</Btn><Btn t={t} variant="danger" onClick={onReset}><Trash2 size={15} /> Reset to sample data</Btn></div>
        <div className="text-xs mt-3" style={{ color: t.muted }}>This local copy is saved on this device between sessions. Use “Sync from ERP” above to load live data.</div>
      </Card>
    </div>
  );
}

/* ============================ PREVIOUSLY USED ROUTE ============================ */
/* The live-ERP "current routes" view (map + routes table + edit/export), embedded from the
   self-contained public/routes_map.html so it shares one implementation with the standalone page. */
function PrevRouteTab({ t }) {
  // no white card wrapper — the embedded page sits on the dashboard's own background (like the Optimiser tab)
  return (
    <iframe src="/routes_map.html?embed=1" title="Previously used route" allow="fullscreen"
      style={{ width: "100%", height: "calc(100vh - 108px)", minHeight: 640, border: 0, display: "block", background: t.bg }} />
  );
}

/* ============================ APP ============================ */
const ERP_POLL_MS = 60_000; // auto-refresh the ERP feed every 60s for live updates
const fmtClock = (ts) => { try { return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); } catch { return ""; } };
function Toast({ t, msg }) {
  const ref = useRef(null);
  useGSAP(() => {
    if (prefersReduced()) { gsap.set(ref.current, { xPercent: -50 }); return; }
    gsap.fromTo(ref.current,
      { xPercent: -50, autoAlpha: 0, y: 16, scale: 0.95 },
      { xPercent: -50, autoAlpha: 1, y: 0, scale: 1, duration: 0.4, ease: "back.out(1.8)", overwrite: "auto" });
  }, [msg]);
  return <div ref={ref} className="fixed left-1/2 bottom-6 rounded-xl px-4 py-3 text-sm z-50 shadow-lg" style={{ background: t.raised, border: "1px solid " + t.border, color: t.text }}>{msg}</div>;
}

export default function App() {
  const [themeName, setThemeName] = useState("light");
  const t = THEMES[themeName];
  const [tab, setTab] = useState("live");
  const [unit, setUnit] = useState("all");
  const [buses, setBuses] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [attendance, setAttendance] = useState({});
  const [records, setRecords] = useState([]);
  const [busCosts, setBusCosts] = useState({}); // busId -> { budget, lines[] } recurring cost profile
  const [formulas, setFormulas] = useState([]);
  const [variables, setVariables] = useState([]);
  const [settings, setSettings] = useState({ showNetValue: true, workingDays: 312, holidays: [], bands: DEFAULT_BANDS.map((b) => ({ ...b })), erpAuto: true });
  const [erpStatus, setErpStatus] = useState({ phase: "idle", at: null, msg: "" }); // idle|syncing|ok|error — live ERP connection
  const [loaded, setLoaded] = useState(false);
  const [toastMsg, setToastMsg] = useState("");
  const toastTimer = useRef();
  const toast = (m) => { setToastMsg(m); clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToastMsg(""), 2400); };

  /* ---- GSAP entrances (clearProps limited to animated props so theme inline styles survive) ---- */
  const headerRef = useRef(null);
  const mainRef = useRef(null);
  const visitedTabs = useRef(new Set()); // full entrance runs once per tab; revisits get a quick fade
  const erpDotRef = useRef(null);
  const FX_CLEAR = "transform,opacity,visibility";
  useGSAP(() => { // one-time header entrance
    if (!canEntrance()) return;
    gsap.timeline({ defaults: { ease: "power2.out" } })
      .from('[data-fx="logo"]', { scale: 0.5, rotation: -12, autoAlpha: 0, duration: 0.45, ease: "back.out(1.7)", clearProps: FX_CLEAR })
      .from('[data-fx="brand"]', { x: -10, autoAlpha: 0, duration: 0.35, clearProps: FX_CLEAR }, "-=0.25")
      .from('[data-fx="tab"]', { y: -8, autoAlpha: 0, duration: 0.3, stagger: 0.05, clearProps: FX_CLEAR }, "-=0.2");
  }, { scope: headerRef });
  useGSAP(() => { // per-tab content entrance: title → KPI tiles → cards → bus grid
    if (!loaded) return;
    const stale = mainRef.current?.querySelectorAll('[data-fx]');
    // tab hidden (rAF paused) or reduced-motion → don't animate; wipe any stale hidden state and show
    if (!canEntrance()) { if (stale && stale.length) gsap.set(stale, { clearProps: "opacity,visibility,transform" }); return; }
    const firstVisit = !visitedTabs.current.has(tab);
    visitedTabs.current.add(tab);
    if (!firstVisit) {
      // returning to an already-seen tab: keep flipping snappy — quick fade of headers/tiles only,
      // and never re-stagger the (potentially dozens of) bus tiles.
      gsap.from('[data-fx="page-title"], [data-fx="tile"], [data-fx="card"]',
        { autoAlpha: 0, y: 6, duration: 0.22, ease: "power2.out", stagger: 0.02, clearProps: FX_CLEAR });
      return;
    }
    gsap.timeline({ defaults: { ease: "power2.out" } })
      .from('[data-fx="page-title"]', { y: 10, autoAlpha: 0, duration: 0.35, clearProps: FX_CLEAR })
      .from('[data-fx="tile"]', { y: 18, autoAlpha: 0, duration: 0.45, stagger: { amount: 0.25 }, clearProps: FX_CLEAR }, "-=0.2")
      .from('[data-fx="card"]', { y: 22, autoAlpha: 0, duration: 0.5, stagger: { amount: 0.3 }, clearProps: FX_CLEAR }, "-=0.3")
      .from('[data-fx="swatch"]', { y: 14, scale: 0.9, autoAlpha: 0, duration: 0.4, ease: "back.out(1.6)", stagger: 0.06, clearProps: FX_CLEAR }, "-=0.35")
      .from('[data-fx="bus"]', { scale: 0.92, autoAlpha: 0, duration: 0.35, stagger: { amount: 0.4, grid: "auto", from: "start" }, clearProps: FX_CLEAR }, "-=0.35");
  }, { dependencies: [tab, loaded], scope: mainRef });

  // ERP status dot: gentle pulse while syncing, a brief confirmation pop when a sync lands.
  useEffect(() => {
    const el = erpDotRef.current;
    if (!el || prefersReduced()) return;
    gsap.killTweensOf(el);
    if (erpStatus.phase === "syncing") {
      const tw = gsap.to(el, { scale: 1.4, opacity: 0.5, duration: 0.65, repeat: -1, yoyo: true, ease: "sine.inOut" });
      return () => { tw.kill(); gsap.set(el, { scale: 1, opacity: 1 }); };
    }
    gsap.set(el, { scale: 1, opacity: 1 });
    if (erpStatus.phase === "ok") gsap.fromTo(el, { scale: 1 }, { scale: 1.9, duration: 0.28, yoyo: true, repeat: 1, ease: "power2.out", onComplete: () => gsap.set(el, { scale: 1 }) });
  }, [erpStatus.phase]);

  // Smooth whole-app colour crossfade on theme change: briefly enable CSS colour transitions
  // (only during the switch, so they never interfere with GSAP transforms or hover feel).
  const rootRef = useRef(null);
  const firstTheme = useRef(true);
  useEffect(() => {
    const el = rootRef.current;
    if (!el || firstTheme.current) { firstTheme.current = false; return; }
    if (prefersReduced()) return;
    el.classList.add("theme-switching");
    const id = setTimeout(() => el.classList.remove("theme-switching"), 480);
    return () => clearTimeout(id);
  }, [themeName]);

  useEffect(() => {
    (async () => {
      const schema = await Store.get("schema");
      const b = await Store.get("buses");
      const recs = (await Store.get("records")) || [];
      const att = (await Store.get("attendance")) || {};
      const hasData = b && b.length && (recs.length || Object.keys(att).length);
      if (schema === SCHEMA && hasData) {
        setBuses(b); setRecords(recs); setAttendance(att); setEmployees((await Store.get("employees")) || []); setBusCosts((await Store.get("busCosts")) || {}); setFormulas((await Store.get("formulas")) || []); setVariables((await Store.get("variables")) || []);
        const st = (await Store.get("settings")) || {};
        if (!st.bands || !st.bands.length) st.bands = DEFAULT_BANDS.map((x) => ({ ...x }));
        if (st.workingDays == null) st.workingDays = 312;
        if (st.showNetValue == null) st.showNetValue = true;
        if (!st.holidays) st.holidays = [];
        if (st.erpAuto == null) st.erpAuto = true;
        setSettings(st);
      } else {
        const s = sampleData(); setBuses(s.buses); setEmployees(s.employees); setAttendance(s.attendance); setRecords(s.records); setFormulas(s.formulas); setVariables(s.variables); setSettings(s.settings);
      }
      const th = await Store.get("theme"); if (th && THEMES[th]) setThemeName(th); // ignore any removed/old theme name
      setLoaded(true);
    })();
    return () => {};
  }, []);
  useEffect(() => { if (loaded) Store.set("schema", SCHEMA); }, [loaded]);
  useEffect(() => { if (loaded) Store.set("buses", buses); }, [buses, loaded]);
  useEffect(() => { if (loaded) Store.set("employees", employees); }, [employees, loaded]);
  useEffect(() => { if (loaded) Store.set("attendance", attendance); }, [attendance, loaded]);
  useEffect(() => { if (loaded) Store.set("records", records); }, [records, loaded]);
  useEffect(() => { if (loaded) Store.set("busCosts", busCosts); }, [busCosts, loaded]);
  useEffect(() => { if (loaded) Store.set("formulas", formulas); }, [formulas, loaded]);
  useEffect(() => { if (loaded) Store.set("variables", variables); }, [variables, loaded]);
  useEffect(() => { if (loaded) Store.set("settings", settings); }, [settings, loaded]);
  useEffect(() => { if (loaded) Store.set("theme", themeName); }, [themeName, loaded]);

  // records the tabs actually read: base records with each bus's cost profile overlaid as daily spend/budget
  const wd = effWorkingDays(settings);
  const effRecords = useMemo(() => mergeCostsIntoRecords(records, buses, attendance, busCosts, wd), [records, buses, attendance, busCosts, wd]);
  const setBusCost = (busId, prof) => setBusCosts((c) => ({ ...c, [busId]: prof }));

  const exportJSON = () => { const blob = new Blob([JSON.stringify({ buses, employees, attendance, records, busCosts, formulas, variables, settings }, null, 2)], { type: "application/json" }); const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "fleet_data.json"; a.click(); };
  const resetAll = () => { const s = sampleData(); setBuses(s.buses); setEmployees(s.employees); setAttendance(s.attendance); setRecords(s.records); setBusCosts({}); setFormulas(s.formulas); setVariables(s.variables); setSettings(s.settings); setTab("live"); toast("Reset to sample data"); };
  // silent = auto/background refresh (no toast, no tab jump); loud = manual button press
  const syncErp = useCallback(async ({ silent = false } = {}) => {
    setErpStatus((s) => ({ ...s, phase: "syncing" }));
    if (!silent) toast("Syncing from ERP…");
    try {
      const data = mapErpToDashboard(await fetchErpRaw());
      setBuses(data.buses); setEmployees(data.employees); setAttendance(data.attendance); setRecords(data.records);
      setErpStatus({ phase: "ok", at: Date.now(), msg: `${data.buses.length} buses · ${data.employees.length} employees` });
      if (!silent) { setTab("live"); toast(`ERP synced · ${data.buses.length} buses · ${data.employees.length} employees`); }
    } catch (e) {
      setErpStatus((s) => ({ ...s, phase: "error", msg: e.message || String(e) }));
      if (!silent) toast("ERP sync failed: " + (e.message || e));
    }
  }, []);

  // live connection: sync once on load and then poll while auto-sync is on
  useEffect(() => {
    if (!loaded || !settings.erpAuto) return;
    syncErp({ silent: true });
    const id = setInterval(() => syncErp({ silent: true }), ERP_POLL_MS);
    return () => clearInterval(id);
  }, [loaded, settings.erpAuto, syncErp]);

  const TABS = [["live", "Live", LayoutDashboard], ["optimiser", "Optimiser", MapPin], ["prevroute", "Prev. route", History], ["bus", "Bus-wise", Bus], ["compare", "Compare", GitCompare], ["equations", "Equations", BarChart3], ["metrics", "Metrics", Sigma], ["settings", "Settings", SettingsIcon]];
  const titleMap = { live: "Live snapshot", bus: "Bus-wise detail", compare: "Compare", equations: "Equations", metrics: "Custom metrics", optimiser: "", prevroute: "", settings: "Settings" };

  return (
    <div ref={rootRef} className={"min-h-screen w-full theme-" + (t.dark ? "dark" : "light")} style={{ background: t.bg, color: t.text, fontFamily: "Inter, system-ui, sans-serif", "--focus-ring": t.primary, "--sb-thumb": t.dark ? "rgba(148,163,184,.28)" : "rgba(100,116,139,.32)", "--sb-thumb-hover": t.dark ? "rgba(148,163,184,.5)" : "rgba(100,116,139,.55)" }}>
      <div ref={headerRef} className="sticky top-0 z-20" style={{ background: t.surface, borderBottom: "1px solid " + t.border }}>
        <div className="w-full px-6 flex items-center gap-4">
          <div className="flex-1 flex items-center gap-3 py-2 min-w-0 overflow-hidden">
            <div data-fx="logo" className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: t.primary }}><Bus size={20} color={t.onPrimary || "#fff"} /></div>
            <div data-fx="brand" className="font-bold text-lg leading-tight tracking-tight truncate">Transport dashboard</div>
          </div>
          <div className="flex gap-1 overflow-x-auto shrink-0">
            {TABS.map(([k, l, Icon]) => { const on = tab === k; return <button key={k} data-fx="tab" onClick={() => setTab(k)} aria-current={on ? "page" : undefined} className="flex items-center gap-2 px-4 py-3 text-sm font-medium whitespace-nowrap transition-colors" style={{ color: on ? t.primary : t.muted, borderBottom: "2px solid " + (on ? t.primary : "transparent") }} onMouseEnter={(e) => { if (!on) e.currentTarget.style.color = t.text; }} onMouseLeave={(e) => { if (!on) e.currentTarget.style.color = t.muted; }}><Icon size={16} /> {l}</button>; })}
          </div>
          <div className="flex-1 flex justify-end min-w-0">
            {(() => {
              const p = erpStatus.phase;
              const dot = p === "ok" ? t.good : p === "syncing" ? t.watch : p === "error" ? t.poor : t.faint;
              const label = p === "syncing" ? "Syncing…" : p === "error" ? "ERP offline" : p === "ok" ? `Live · ${fmtClock(erpStatus.at)}` : "Connecting…";
              return (
                <button onClick={() => syncErp()} aria-live="polite" title={erpStatus.msg ? `${erpStatus.msg}${erpStatus.at ? " · updated " + fmtClock(erpStatus.at) : ""}` : "Sync from ERP now"}
                  className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold whitespace-nowrap" style={{ background: t.surface2, border: "1px solid " + t.border, color: t.text }}>
                  <span ref={erpDotRef} className="w-2 h-2 rounded-full" style={{ background: dot }} />{label}
                </button>
              );
            })()}
          </div>
        </div>
      </div>

      <div ref={mainRef} className="w-full px-6 py-6">
        {titleMap[tab] && <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
          <h2 data-fx="page-title" className="text-2xl font-bold tracking-tight">{titleMap[tab]}</h2>
          {["live", "compare", "equations"].includes(tab) && <UnitDropdown t={t} value={unit} onChange={setUnit} />}
        </div>}
        {!loaded ? <div style={{ color: t.muted }}>Loading…</div> : (
          <>
            {tab === "live" && <LiveView t={t} unit={unit} buses={buses} records={effRecords} employees={employees} attendance={attendance} formulas={formulas} settings={settings} variables={variables} onAddCosts={() => setTab("bus")} />}
            {tab === "bus" && <BusView t={t} unit="all" buses={buses} records={effRecords} employees={employees} attendance={attendance} formulas={formulas} settings={settings} variables={variables} busCosts={busCosts} onBusCost={setBusCost} toast={toast} />}
            {tab === "compare" && <CompareView t={t} unit={unit} buses={buses} records={effRecords} employees={employees} attendance={attendance} settings={settings} formulas={formulas} variables={variables} />}
            {tab === "equations" && <EquationsView t={t} unit={unit} buses={buses} records={effRecords} employees={employees} attendance={attendance} formulas={formulas} settings={settings} variables={variables} />}
            {tab === "metrics" && <MetricsView t={t} formulas={formulas} variables={variables} toast={toast}
              onAdd={(f) => { setFormulas([...formulas, f]); toast("Metric added"); }}
              onUpdate={(f) => { setFormulas(formulas.map((x) => (x.id === f.id ? f : x))); toast("Metric updated"); }}
              onDel={(id) => setFormulas(formulas.filter((f) => f.id !== id))}
              onAddVar={(v) => { setVariables([...variables, v]); toast("Variable added"); }}
              onUpdateVar={(v) => setVariables(variables.map((x) => (x.id === v.id ? v : x)))}
              onDelVar={(id) => setVariables(variables.filter((v) => v.id !== id))} />}
            {tab === "optimiser" && <OptimiserTab t={t} toast={toast} />}
            {tab === "prevroute" && <PrevRouteTab t={t} />}
            {tab === "settings" && <SettingsView t={t} settings={settings} setSettings={setSettings} onReset={resetAll} onExport={exportJSON} onSyncErp={syncErp} erpStatus={erpStatus} toast={toast} themeName={themeName} setThemeName={setThemeName} />}
          </>
        )}
      </div>

      {toastMsg && <Toast t={t} msg={toastMsg} />}
    </div>
  );
}
