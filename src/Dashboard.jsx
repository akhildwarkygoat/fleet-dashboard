import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import {
  LayoutDashboard, GitCompare, Database, Sigma, Settings as SettingsIcon,
  Sun, Moon, Bus, Plus, Trash2, Download, Server, Activity, BarChart3, Pencil, X, ChevronRight, ChevronDown, Search, Calendar, Clock, MapPin,
  Upload, FileText, History, CheckCircle2, AlertTriangle, XCircle, ArrowLeft, Loader2, WifiOff, Route, RefreshCw, IndianRupee
} from "lucide-react";
import OptimiserTab from "./optimiser/OptimiserTab.jsx";
import { serviceIdFor, SERVICES } from "./optimiser/services.js";
import { getGoogleKey, setGoogleKey } from "./optimiser/google.js";
import { fetchErpRaw, fetchErpCostRaw, mapErpToDashboard, mapErpCosts, canonVehicle, RUN_OPTIMISER, NEEDS_ERP } from "./erp.js";
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
import { MotionPathPlugin } from "gsap/MotionPathPlugin";
import { SpotlightNav } from "./components/ui/spotlight-button.jsx";

/* ERP shift strings that one service alone no longer identifies — "ROTATIONAL SHIFT" is
   shared by the three slots, which are told apart by the rider's punch slot. Derived from
   SERVICES so adding a slot-divided service needs no change here. Used to spot a stored
   snapshot that predates the split and force one refresh. */
const SLOT_SHIFTS = new Set(SERVICES.filter((s) => s.erpSlot && s.erpShift).map((s) => s.erpShift));

/* ============================ MOTION (GSAP) ============================ */
gsap.registerPlugin(useGSAP, MotionPathPlugin);
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
    // No tween unless the tab is actually visible. GSAP's ticker is paused on a backgrounded
    // tab, so the count-up below would set the text to its START value and never reach the
    // target — freezing the tile on a number that was never real. React has already rendered
    // the correct string, so bailing out here leaves it right.
    if (!m || !canEntrance()) {
      prevRef.current = m ? parseFloat(m[2].replace(/,/g, "")) : null;
      return;
    }
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
    border: "#e2e8f0", text: "#0f172a", muted: "#556070", faint: "#94a3b8",
    primary: "#2186eb", primarySoft: "rgba(33,134,235,.10)", onPrimary: "#ffffff",
    // filled buttons carry 12-14px white text; the mid-tone brand blue only reaches 3.7:1 there
    primaryStrong: "#1c74cf",
    // status hues carry text at 10-12px, so they are set dark enough to clear 4.5:1 on surface/surface2
    good: "#047857", watch: "#b45309", poor: "#be123c",
    gainup: "#0e7490", techno: "#7c3aed", zenwear: "#be1250",
    goodSoft: "rgba(4,120,87,.10)", watchSoft: "rgba(180,83,9,.12)", poorSoft: "rgba(190,18,60,.10)",
    grid: "#e8edf4", inputBg: "#f8fafc",
  },
  // Dark — Cool Grey neutrals + Blue (Vivid) primary, with palette semantic colours.
  dark: {
    name: "dark", label: "Dark", dark: true, bg: "#1a222c", surface: "#222e3a", surface2: "#2b3846", raised: "#374553",
    border: "#3a4a59", text: "#f5f7fa", muted: "#9aa5b1", faint: "#616e7c",
    primary: "#2186eb", primarySoft: "rgba(33,134,235,.18)", onPrimary: "#ffffff", primaryStrong: "#1c74cf",
    good: "#3ebd93", watch: "#f7d070", poor: "#f87171",
    gainup: "#2cb1bc", techno: "#8888fc", zenwear: "#f2648c",
    goodSoft: "rgba(62,189,147,.14)", watchSoft: "rgba(247,208,112,.14)", poorSoft: "rgba(248,113,113,.16)",
    grid: "#2b3846", inputBg: "#151d26",
  },
  // Neutral — light, low-chroma Cool Grey neutrals with a slate primary and muted semantic colours.
  neutral: {
    name: "neutral", label: "Neutral", dark: false, bg: "#eceff3", surface: "#ffffff", surface2: "#f5f7fa", raised: "#e4e7eb",
    border: "#cbd2d9", text: "#1f2933", muted: "#616e7c", faint: "#9aa5b1",
    // same blue identity as light/dark, pulled down in chroma — neutral is a quieter
    // surface treatment of one brand, not a second brand
    primary: "#3d6b99", primarySoft: "rgba(61,107,153,.12)", onPrimary: "#ffffff", primaryStrong: "#2f5679",
    good: "#0f7a5f", watch: "#8d6a1a", poor: "#ba2525",
    gainup: "#146b7d", techno: "#4c63b6", zenwear: "#a8325a",
    goodSoft: "rgba(15,122,95,.10)", watchSoft: "rgba(141,106,26,.12)", poorSoft: "rgba(186,37,37,.10)",
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
  // heads the costing feed carries that predate this list (see ERP_COST_HEADS in erp.js)
  { key: "rto", label: "RTO expense", qty: false, period: "year" },
  { key: "adblue", label: "AdBlue", qty: true, qtyLabel: "litres / year", period: "year" },
  // plan-derived lines (see withPlanCosts): rental day tariff from the finalised plan
  { key: "hire", label: "Hire (day tariff)", qty: false, period: "day" },
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
      // route km from the finalised plan, so cost/km and the km roll-ups are real
      byKey.set(k, { ...ex, spend, budget, km: +ex.km || +b.planKm || 0 });
    });
  });
  return [...byKey.values()];
}

/* ---- finalised route plan (public/finalised_plan.json) ----
   The approved plan gives each bus its route: km/day, stops, riders, ride time. Its own cost
   model was  fixed ₹1,934/day (driver 692 + maintenance 1,242, assumed flat per owned bus)
   + diesel at ₹100/L ÷ ERP mileage × km  — verified to reproduce all 70 route costs exactly —
   and the slab tariff for rentals. On the Live page the planner's ASSUMED fixed part is
   REPLACED by the bus's real standing costs from the ERP costing feed; only the km-variable
   part survives from the plan: diesel for owned buses, the whole day tariff for rentals
   (a rented bus has no cost lines in the ERP — the tariff IS its cost). */
/* Bumped whenever a cost profile gains fields the card relies on. A profile stored under an
   older shape still renders, but a background resync is kicked off so the new fields arrive
   without the user having to press Resync. */
const COST_SHAPE = 3;                 // 2 = per-line `detail` rows · 3 = financial-year window (was trailing 12 months)
const PLAN_DIESEL_PER_LITRE = 100;    // ₹/L — the same constant the plan editor prices with
const PLAN_FALLBACK_KMPL = 100 / 18;  // editor's template ₹18/km, for a bus with no ERP mileage

/* Overlay the plan onto the fleet: route summary + km on each routed bus, and the plan's
   km-variable costs merged into the ERP cost profiles. Pure; returns {buses, profiles}. */
function withPlanCosts(buses, costProfiles, planByVeh) {
  if (!planByVeh || !planByVeh.size) return { buses, profiles: costProfiles };
  const profiles = { ...costProfiles };
  const outBuses = buses.map((b) => {
    const r = planByVeh.get(b.id);
    if (!r) return b;
    if (r.type === "rent") {
      profiles[b.id] = {
        source: "plan",
        budget: { amount: "", period: "month" },
        lines: [{
          id: "plan-hire", type: "hire", label: "Hire — plan tariff", amount: +r.cost || 0, period: "day",
          planned: true,
          basis: [["Route distance", `${r.km} km/day`], ["Riders on the route", `${r.riders}`],
            ["Tariff slab", r.km <= 80 ? "≤80 km → ₹1,700" : r.km <= 95 ? "80–95 km → ₹1,900" : "over 95 km → ₹18.70/km"],
            ["Day tariff", inr(+r.cost || 0)]],
        }],
      };
    } else {
      const kmpl = +b.mileage > 0 ? +b.mileage : PLAN_FALLBACK_KMPL;
      const litres = Math.round((r.km / kmpl) * 100) / 100;
      const base = profiles[b.id];
      profiles[b.id] = {
        source: base ? base.source + "+plan" : "plan",
        budget: base ? base.budget : { amount: "", period: "month" },
        lines: [
          ...(base ? base.lines : []),
          {
            id: "plan-diesel", type: "diesel", label: "Diesel — plan route", amount: PLAN_DIESEL_PER_LITRE,
            quantity: litres, period: "day", planned: true,
            basis: [["Route distance", `${r.km} km/day`],
              ["Mileage", +b.mileage > 0 ? `${b.mileage} km/L (ERP)` : `${PLAN_FALLBACK_KMPL.toFixed(2)} km/L (no ERP mileage — planner default)`],
              ["Diesel price", `${inr(PLAN_DIESEL_PER_LITRE)}/L (assumed)`],
              ["Litres per day", `${litres} L`], ["Cost per day", inr(PLAN_DIESEL_PER_LITRE * litres)]],
          },
        ],
      };
    }
    return { ...b, planKm: +r.km || 0, planStops: r.seq || [], planRide: r.ride, planRiders: r.riders,
      route: `${r.stops} stops · ${r.km} km · ${r.ride} min ride` };
  });
  return { buses: outBuses, profiles };
}

/* ---- per-vehicle details the ERP does not carry ----
   Budget, driver name and phone have no home in either ERP feed (the costing feed carries no
   budget at all, and the punch feed no driver). They are entered here and kept on this device,
   keyed by vehicle so they survive every re-sync. Everything else on the card stays read-only.
   A budget on a bus with no cost lines still needs a profile to live in, so one is created. */
function applyBusInfo(buses, profiles, busInfo) {
  if (!busInfo || !Object.keys(busInfo).length) return { buses, profiles };
  const out = { ...profiles };
  const outBuses = buses.map((b) => {
    const info = busInfo[b.id];
    if (!info) return b;
    const amount = info.budgetAmount;
    if (amount !== "" && amount != null) {
      const budget = { amount, period: info.budgetPeriod || "month" };
      const base = out[b.id];
      out[b.id] = base ? { ...base, budget } : { source: "local", budget, lines: [] };
    }
    return { ...b, driver: info.driver || b.driver, phone: info.phone || b.phone };
  });
  return { buses: outBuses, profiles: out };
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
  // Score against the points actually on offer. A criterion the data can't speak to is left out
  // of BOTH the score and the maximum — otherwise it silently caps every bus below the grade it
  // earned. The ERP costing feed carries no budget, so without this the variance points are
  // unwinnable and no bus can ever read "good", however well utilised and however cheap it is.
  let sc = sc0, max = 2;
  max += 2;
  if (m.cph <= medCph) sc += 2; else if (m.cph <= medCph * 1.25) sc += 1;
  if (m.budget > 0) {
    max += 2;
    if (m.variance >= 0) sc += 2; else if (m.variance >= -0.1 * m.budget) sc += 1;
  }
  const r = sc / max;                       // same 5/6 and 3/6 cut-offs as when a budget exists
  return r >= 5 / 6 ? "good" : r >= 0.5 ? "watch" : "poor";
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
/* The brands the fleet is split by. Zenwear is the third entity (Comp_New "ZENWEAR",
   Compname "SUBBULAPURAM") — the company is Zenwear, the site it runs from is
   Subbulapuram, and the dashboard names units by company. See unitOf in erp.js. */
const UNITS = ["Gainup", "Technotek", "Zenwear"];
const unitColor = (t, u) => (u === "Gainup" ? t.gainup : u === "Zenwear" ? t.zenwear : t.techno);
/* Buses/ledger rows stored under the old unit name before the rename. Harmless to keep;
   drop it once no device can still be holding a pre-rename snapshot. */
const UNIT_RENAMES = { Subbulapuram: "Zenwear" };
const canonUnit = (u) => UNIT_RENAMES[u] || u;
const SCHEMA = "fleet-v8"; // bump to invalidate stored data; v8 discards snapshots whose rider slots came from the live punch feed, before the Rotational roster was frozen
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
  const settings = { showNetValue: true, workingDays: 312, holidays: [], bands: DEFAULT_BANDS.map((b) => ({ ...b })), erpAuto: true, erpRefreshMin: 30 };
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
  const style = variant === "primary" ? { background: t.primaryStrong || t.primary, color: t.onPrimary || "#fff" } :
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
      {/* the rail is a status channel, not trim: it renders only when the caller passed a colour
          derived from the value, so a coloured tile always means something */}
      {accent && <span className="absolute left-0 top-0 bottom-0 w-1" style={{ background: accent }} />}
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
const UnitDot = ({ t, unit }) => <span className="inline-block w-2 h-2 rounded-sm mr-2 align-middle" style={{ background: unitColor(t, unit) }} />;
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
  const opts = [["all", "Combined", t.primary], ...UNITS.map((u) => [u, u, unitColor(t, u)])];
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
        {UNITS.filter((u) => unit === "all" || unit === u).map((u) => (
          <Line key={u} type="monotone" dataKey={u} stroke={unitColor(t, u)} strokeWidth={2} dot={{ r: 2.5 }} connectNulls />
        ))}
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
/* The Prev-route rebuild loader, faithfully: a compact glass card with a small route curve
 * that draws itself while a bus dot travels it (GSAP MotionPath), a title, a live message
 * line, and a gradient progress bar. Progress = routes revealed so far (real count). */
const ERP_ROUTE_D = "M16 100 C 44 100, 40 62, 62 60 S 92 38, 104 20";
function RouteBusLoader({ t }) {
  const svgRef = useRef(null), busRef = useRef(null), pathRef = useRef(null);
  useGSAP(() => {
    // route draws in → un-draws out, forever — same 2.1s cadence as the original overlay
    gsap.timeline({ repeat: -1, defaults: { ease: "power1.inOut" } })
      .fromTo(".erp-draw", { strokeDashoffset: 235 }, { strokeDashoffset: 0, duration: 1.15 })
      .to(".erp-draw", { strokeDashoffset: -235, duration: 0.95 });
    // the bus rides the same curve end-to-end (loops are safe on hidden tabs; only from() entrances need the guard)
    gsap.to(busRef.current, { motionPath: { path: pathRef.current, align: pathRef.current, alignOrigin: [0.5, 0.5] },
      duration: 2.1, ease: "none", repeat: -1 });
  }, { scope: svgRef });
  return (
    <svg ref={svgRef} viewBox="0 0 120 120" width="116" height="116" style={{ display: "block", margin: "0 auto 8px" }} aria-hidden>
      <path d={ERP_ROUTE_D} fill="none" stroke={t.primary} strokeOpacity="0.16" strokeWidth="5" strokeLinecap="round" />
      <path ref={pathRef} className="erp-draw" d={ERP_ROUTE_D} fill="none" stroke={t.primary} strokeWidth="5" strokeLinecap="round" strokeDasharray="235" strokeDashoffset="235" />
      <circle cx="16" cy="100" r="6" fill={t.primary} />
      <circle cx="104" cy="20" r="6" fill={t.good} />
      <circle ref={busRef} r="5" fill={t.dark ? "#e2e8f0" : "#0f172a"} stroke={t.surface} strokeWidth="2" />
    </svg>
  );
}
function ErpLoading({ t, phase, progress, onSync }) {
  const offline = phase === "error";
  const total = (progress && progress.total) || 0;
  const done = (progress && progress.done) || 0;
  const pctDone = total ? Math.round((done / total) * 100) : 0;
  // Skeleton bone — a neutral placeholder bar (no fabricated numbers; it all sits behind a blur)
  const boneBg = t.dark ? "rgba(148,163,184,.22)" : "rgba(15,23,42,.08)";
  const Bone = ({ w, h = 10, mt = 0 }) => <span style={{ display: "block", width: w, height: h, marginTop: mt, borderRadius: 6, background: boneBg }} />;
  const GhostGroup = ({ unitColor, cards }) => (
    <div className="rounded-2xl border mb-4 overflow-hidden" style={{ background: t.surface, borderColor: t.border }}>
      <div className="flex items-center gap-2 px-4 py-3">
        <span className="w-2.5 h-2.5 rounded-sm" style={{ background: unitColor }} />
        <Bone w={76} h={12} /><Bone w={48} h={8} />
        <span className="flex-1" /><Bone w={130} h={8} />
      </div>
      <div className="px-4 pb-4" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(108px, 1fr))", gap: 8 }}>
        {Array.from({ length: cards }, (_, i) => (
          <div key={i} className="rounded-xl p-2.5" style={{ border: "1.5px solid " + t.border, background: t.surface2 }}>
            <Bone w="72%" h={9} /><Bone w="52%" h={17} mt={7} /><Bone w="60%" h={7} mt={7} />
          </div>
        ))}
      </div>
    </div>
  );
  return (
    <div className="relative">
      {/* the Live page's exact layout, blurred behind the loader — KPI tiles, controls, unit groups */}
      <div aria-hidden className="pointer-events-none select-none" style={{ filter: "blur(7px)", opacity: 0.65 }}>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="rounded-2xl border p-4 relative overflow-hidden" style={{ background: t.surface, borderColor: t.border }}>
              <Bone w={96} h={8} /><Bone w={64} h={26} mt={12} /><Bone w={76} h={8} mt={9} />
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-2 mb-4 items-center">
          <div className="flex-1 rounded-xl" style={{ minWidth: 200, height: 42, background: t.inputBg, border: "1px solid " + t.border }} />
          <div className="rounded-xl" style={{ width: 150, height: 42, background: t.inputBg, border: "1px solid " + t.border }} />
          <div className="rounded-xl" style={{ width: 106, height: 42, background: t.surface2, border: "1px solid " + t.border }} />
          <div className="rounded-xl" style={{ width: 146, height: 42, background: t.surface2, border: "1px solid " + t.border }} />
        </div>
        <GhostGroup unitColor={t.gainup} cards={8} />
        <GhostGroup unitColor={t.techno} cards={8} />
      </div>
      {/* the loader card floats over the ghost — a plain raised panel, so the only thing moving
          on screen is the route drawing itself */}
      <div className="absolute inset-0 z-10 flex items-center justify-center">
      <div className="text-center px-6 pt-7 pb-6 rounded-2xl border"
        style={{ width: "min(400px, 92%)", background: t.surface, borderColor: offline ? t.poor : t.border,
          boxShadow: t.dark ? "0 12px 40px rgba(0,0,0,.45)" : "0 12px 40px rgba(15,23,42,.14)" }}>
        {offline ? (
          <>
            <span className="w-14 h-14 rounded-2xl inline-flex items-center justify-center mb-2" style={{ background: t.poor + "1a", color: t.poor }}><WifiOff size={26} /></span>
            <div className="font-extrabold" style={{ color: t.text, fontSize: 16, letterSpacing: "-0.01em" }}>Can't reach the ERP</div>
            <div className="text-xs mt-1.5" style={{ color: t.muted }}>The transport feed didn't respond. This dashboard shows live data only — check the factory network, then retry.</div>
            <button onClick={onSync} className="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold mt-4" style={{ background: t.primaryStrong || t.primary, color: t.onPrimary || "#fff" }}>Try again</button>
          </>
        ) : (
          <>
            <RouteBusLoader t={t} />
            <div className="font-extrabold" style={{ color: t.text, fontSize: 16, letterSpacing: "-0.01em" }}>Fetching live data from ERP</div>
            <div className="tabular-nums" style={{ color: t.muted, fontSize: 12.5, marginTop: 5, minHeight: 16 }}>
              {total ? <>Loading routes… <b style={{ color: t.primary }}>{done}</b> / {total}</> : "Contacting ERP…"}
            </div>
            <div className="rounded-full overflow-hidden" style={{ height: 7, marginTop: 18, background: t.dark ? "rgba(148,163,184,.18)" : "rgba(15,23,42,.09)" }}>
              {/* scaleX rather than width so the fill compositor-animates instead of relaying out */}
              <div className="h-full w-full rounded-full" style={{ transform: `scaleX(${pctDone / 100})`, transformOrigin: "left center", background: t.primary, transition: "transform .5s cubic-bezier(.4,0,.2,1)" }} />
            </div>
            <div style={{ color: t.faint, fontSize: 10.5, marginTop: 11 }}>Today's fleet, riders &amp; attendance load straight from the source</div>
          </>
        )}
      </div>
      </div>
    </div>
  );
}
function LiveView({ t, unit, buses, records, employees, attendance, formulas, settings, variables, onOpenBusView, erpPhase, erpProgress, onSync, planSummary }) {
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

  if (!pairs.length) return <ErpLoading t={t} phase={erpPhase} progress={erpProgress} onSync={onSync} />;

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
  const noCosts = agg.spend === 0 && agg.budget === 0; // the ERP costing feed brought back nothing for this fleet
  const overCount = filtered.filter((x) => x.m.util > 150).length; // heavily over-loaded (>150%)
  const punched = agg.present + agg.absent;
  const inputBase = { background: t.inputBg, border: "1px solid " + t.border, color: t.text };

  const detail = (x) => (
    <Reveal className="rounded-2xl border p-4 mt-2" style={{ background: t.surface2, borderColor: t.primary }}>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div><div className="font-semibold flex items-center gap-2" style={{ color: t.text }}><UnitDot t={t} unit={x.bus.unit} />
          {/* the registration is the way through to the full bus-wise view; the card itself only
              opens this preview, so a tap never skips past today's attendance */}
          {onOpenBusView
            ? <button onClick={() => onOpenBusView(x.bus.id)} title={`Open ${x.bus.vehicle} in Bus-wise detail`}
                className="inline-flex items-center gap-1 font-semibold rounded hover:underline"
                style={{ color: t.primary, textUnderlineOffset: 3 }}>{x.bus.vehicle}<ChevronRight size={14} /></button>
            : x.bus.vehicle}
          <Pill t={t} kind={x.h} /></div>
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
        <Tile t={t} label="Riders present" value={agg.present} sub={`of ${agg.cap} seats`} />
        <Tile t={t} label="Capacity utilisation" value={pct(agg.util)} sub={`${agg.count} buses shown`} />
        {noCosts
          ? <Tile t={t} label="Over 150%" value={overCount} sub="heavily over-loaded" />
          : <Tile t={t} label="Avg cost / head" value={inr(agg.cph)} sub={`${inr(agg.spend)} spend`} />}
        {(() => {
          const n = (u) => buses.filter((b) => b.unit === u).length;
          const sub = UNITS.map((u) => `${n(u)} ${u}`).filter((x) => !x.startsWith("0 ")).join(" · ");
          return <Tile t={t} label="Total fleet" value={buses.length} sub={sub} />;
        })()}
      </div>

      {noCosts && (
        <div className="rounded-xl border px-4 py-3 mb-4 flex flex-wrap items-center gap-3 text-sm" style={{ background: t.primarySoft, borderColor: t.primary, color: t.text }}>
          <Server size={16} style={{ color: t.primary }} />
          <span>Cost, spend &amp; net-value figures stay blank until approved cost lines exist for these vehicles in the ERP. They arrive with the daily sync — or use Resync costing in Settings.</span>
        </div>
      )}

      {planSummary && (
        <div className="rounded-xl border px-4 py-3 mb-4 flex flex-wrap items-center gap-x-5 gap-y-1 text-sm" style={{ background: t.surface, borderColor: t.border }}>
          <span className="font-semibold flex items-center gap-2" style={{ color: t.text }}>
            <Route size={15} style={{ color: t.primary }} />
            Finalised plans · {planSummary.services.length} of {planSummary.services.length + planSummary.missing.length} services
          </span>
          <span className="tabular-nums" style={{ color: t.muted }}><b style={{ color: t.text }}>{planSummary.buses}</b> routes ({planSummary.matched} on today's fleet)</span>
          <span className="tabular-nums" style={{ color: t.muted }}><b style={{ color: t.text }}>{planSummary.km.toLocaleString("en-IN")}</b> km/day</span>
          <span className="tabular-nums" style={{ color: t.muted }}>plan cost <b style={{ color: t.text }}>{inr(planSummary.cost)}</b>/day{planSummary.mixedBasis ? "" : ` · ${inr(planSummary.cost_head)}/head`}</span>
          <span className="text-xs w-full" style={{ color: t.faint }}>
            {planSummary.services.join(" · ")}
            {planSummary.missing.length ? ` — not included: ${planSummary.missing.join(", ")} (no plan yet)` : ""}
          </span>
          {planSummary.mixedBasis && (
            <span className="text-xs w-full" style={{ color: t.watch }}>
              ₹/head is hidden: these plans use different cost bases (some charge loan, driver and
              maintenance, some treat them as sunk), so a combined per-head figure would be meaningless.
            </span>
          )}
          <span className="text-xs w-full" style={{ color: t.faint }}>Live spend below swaps the plan's assumed fixed ₹1,934/bus for each bus's real ERP standing costs; km &amp; diesel are the plan's.</span>
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
        const accent = unitColor(t, u);
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
                {list.length === 0 ? (
                  <div className="text-sm py-5 px-4 text-center" style={{ color: t.muted }}>
                    {buses.some((b) => b.unit === u)
                      ? "No buses match."
                      : <>No buses here yet — the ERP has no <b style={{ color: t.text }}>{u}</b> unit on any vehicle. They appear the moment it tags one.</>}
                  </div>
                ) : (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(108px, 1fr))", gap: 8 }}>
                    {list.map((x) => { const over = x.m.util > 150; const col = over ? OVER_BAND.color : hc(x.h); const on = openBus === x.bus.id;
                      const tag = over ? `OVER +${Math.round(x.m.util - 100)}%` : x.h.toUpperCase();
                      return (
                        <button key={x.bus.id} data-fx="bus" aria-expanded={on}
                          title={on ? `Hide who's on ${x.bus.vehicle}` : `Show who's on ${x.bus.vehicle}`}
                          onClick={() => setOpenBus(on ? null : x.bus.id)}
                          onMouseEnter={fxLift} onMouseLeave={fxDrop} className="relative text-left rounded-xl p-2.5" style={{ background: t.surface2, border: "1.5px solid " + col, boxShadow: on ? `0 0 0 2px ${t.primary}` : "none" }}>
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
/* Read-only view of one bus's running costs, from the ERP costing feed
   (VehicleEmpMapProjectDetails). The dashboard shows what it was given and normalises
   each line to ₹/day (see mergeCostsIntoRecords). Nothing here is editable — costs are
   corrected in the ERP and arrive on the next sync, or on the Resync button. */
function CostCard({ t, bus, profile, wd, costMeta, costPhase, onSyncCosts, budget, onSetBudget }) {
  const [open, setOpen] = useState({});          // line id -> expanded
  const [editBudget, setEditBudget] = useState(false);
  const [draft, setDraft] = useState({ amount: "", period: "month" });
  const lines = (profile && profile.lines) || [];
  const dailySpend = profileDailySpend(profile, wd);
  const dailyBudget = profileDailyBudget(profile, wd);
  const periodLabel = (p) => (COST_PERIODS.find(([v]) => v === p) || [, p])[1];
  const busy = costPhase === "syncing";
  const windowLabel = costMeta && costMeta.fy ? `FY ${costMeta.fy} (${costMeta.from} → ${costMeta.to})` : "the current financial year";

  return (
    <Card t={t} title="Cost breakdown"
      hint={lines.some((l) => l.id === "plan-hire")
        ? `Day tariff for ${bus.vehicle}'s route in the finalised plan. Drives Cost/head, Spend & Net value.`
        : `Approved cost lines for ${bus.vehicle} from the ERP costing feed (${windowLabel})${lines.some((l) => l.id === "plan-diesel") ? ", plus diesel for its finalised-plan route" : ""}. Each is converted to ₹/day (using ${wd} working days) and drives Cost/head, Budget, Spend & Net value. Edit these in the ERP — the dashboard reads them.`}
      right={onSyncCosts && (
        <Btn t={t} variant="ghost" className="shrink-0" onClick={onSyncCosts} disabled={busy}
          title="Re-fetch the costing feed from the ERP now">
          <RefreshCw size={15} className={busy ? "animate-spin" : ""} /> {busy ? "Resyncing…" : "Resync costs"}
        </Btn>
      )}>
      {lines.length || dailyBudget ? (
        <>
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <div className="text-xs uppercase tracking-widest" style={{ color: t.muted }}>Budget</div>
            {editBudget ? (
              <div className="flex flex-wrap items-center gap-2">
                <span style={{ color: t.muted }}>₹</span>
                <input autoFocus type="number" min="0" value={draft.amount} placeholder="0"
                  onChange={(e) => setDraft({ ...draft, amount: e.target.value })}
                  aria-label={`Budget amount for ${bus.vehicle}`} className="rounded-lg px-2.5 py-1.5 text-sm outline-none w-32 tabular-nums"
                  style={{ background: t.inputBg, border: "1px solid " + t.border, color: t.text }} />
                <select value={draft.period} onChange={(e) => setDraft({ ...draft, period: e.target.value })}
                  aria-label="Budget period" className="rounded-lg px-2 py-1.5 text-sm outline-none"
                  style={{ background: t.inputBg, border: "1px solid " + t.border, color: t.text }}>
                  {COST_PERIODS.map(([v, lab]) => <option key={v} value={v}>{lab}</option>)}
                </select>
                <Btn t={t} className="!px-3 !py-1.5" onClick={() => { onSetBudget({ budgetAmount: draft.amount === "" ? "" : +draft.amount || 0, budgetPeriod: draft.period }); setEditBudget(false); }}>Save</Btn>
                <Btn t={t} variant="ghost" className="!px-3 !py-1.5" onClick={() => setEditBudget(false)}>Cancel</Btn>
              </div>
            ) : (
              <>
                <div className="text-xl font-bold tabular-nums" style={{ color: t.text }}>{inr(dailyBudget)}<span className="text-xs font-semibold ml-1" style={{ color: t.muted }}>/day</span></div>
                {budget && budget.budgetAmount !== "" && budget.budgetAmount != null && (
                  <span className="text-xs" style={{ color: t.muted }}>({inr(+budget.budgetAmount)} {periodLabel(budget.budgetPeriod || "month").toLowerCase()})</span>
                )}
                <Btn t={t} variant="ghost" className="!px-3 !py-1.5"
                  onClick={() => { setDraft({ amount: budget && budget.budgetAmount != null ? budget.budgetAmount : "", period: (budget && budget.budgetPeriod) || "month" }); setEditBudget(true); }}>
                  <Pencil size={14} /> {dailyBudget ? "Edit budget" : "Set budget"}
                </Btn>
              </>
            )}
          </div>

          <div className="rounded-xl overflow-hidden" style={{ border: "1px solid " + t.border }}>
            <table className="w-full text-sm">
              <thead><tr style={{ background: t.surface2 }}>
                {["Cost", "Amount", "Qty", "Per", "₹/day"].map((h, i) => (
                  <th key={h} className={"py-2 px-3 text-xs font-semibold uppercase tracking-wider " + (i > 0 ? "text-right" : "text-left")} style={{ color: t.muted }}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {lines.map((l) => {
                  const spec = COST_TYPE_MAP[l.type] || {};
                  const rows = l.detail || [], basis = l.basis || [];
                  const canOpen = rows.length > 0 || basis.length > 0;
                  const isOpen = !!open[l.id];
                  // plan-derived lines are tinted so an assumed figure never reads as an ERP one
                  const bg = l.planned ? t.primarySoft : undefined;
                  return (
                    <React.Fragment key={l.id}>
                      <tr onClick={canOpen ? () => setOpen({ ...open, [l.id]: !isOpen }) : undefined}
                        aria-expanded={canOpen ? isOpen : undefined}
                        title={canOpen ? (isOpen ? "Hide the lines behind this figure" : "Show the lines behind this figure") : undefined}
                        style={{ borderTop: "1px solid " + t.border, background: bg, cursor: canOpen ? "pointer" : "default" }}>
                        <td className="py-2 px-3" style={{ color: t.text }}>
                          <span className="inline-flex items-center gap-1.5">
                            {canOpen && <ChevronRight size={13} style={{ color: t.muted, transform: isOpen ? "rotate(90deg)" : "none", transition: "transform .15s" }} />}
                            {l.label || spec.label || l.type}
                          </span>
                          {l.planned && <span className="text-[10px] font-bold uppercase tracking-wider ml-2 rounded px-1.5 py-0.5" style={{ background: t.primary, color: t.onPrimary || "#fff" }}>Plan</span>}
                          {l.erpLines > 1 && <span className="text-xs ml-1.5" style={{ color: t.muted }}>· {l.erpLines} lines</span>}
                        </td>
                        <td className="py-2 px-3 text-right tabular-nums" style={{ color: t.text }}>{inr(+l.amount || 0)}</td>
                        <td className="py-2 px-3 text-right tabular-nums" style={{ color: t.muted }}>{spec.qty ? (l.quantity ?? "—") : "—"}</td>
                        <td className="py-2 px-3 text-right" style={{ color: t.muted }}>{periodLabel(l.period || spec.period)}</td>
                        <td className="py-2 px-3 text-right tabular-nums font-semibold" style={{ color: t.text }}>{inr(lineDaily(l, wd))}</td>
                      </tr>
                      {isOpen && (
                        <tr style={{ background: l.planned ? t.primarySoft : t.surface2 }}>
                          <td colSpan={5} className="px-3 py-3">
                            {rows.length > 0 ? (
                              <table className="w-full text-xs">
                                <thead><tr style={{ color: t.muted }}>
                                  {["Description", "Period", "Covers", "Rate", "Qty", "Amount", "Approved"].map((h, i) => (
                                    <th key={h} className={"pb-1.5 font-semibold uppercase tracking-wider " + (i > 2 ? "text-right pl-3" : "text-left pr-3")}>{h}</th>
                                  ))}
                                </tr></thead>
                                <tbody>
                                  {rows.map((d, i) => (
                                    <tr key={i} style={{ borderTop: "1px solid " + t.border }}>
                                      <td className="py-1.5 pr-3" style={{ color: t.text }}>{d.desc}</td>
                                      <td className="py-1.5 pr-3" style={{ color: t.muted }}>{d.period || "—"}</td>
                                      <td className="py-1.5 pr-3 tabular-nums" style={{ color: t.muted }}>{d.from}{d.to ? ` → ${d.to}` : ""}</td>
                                      <td className="py-1.5 pl-3 text-right tabular-nums" style={{ color: t.muted }}>{d.rate ? inr(d.rate) : "—"}</td>
                                      <td className="py-1.5 pl-3 text-right tabular-nums" style={{ color: t.muted }}>{d.qty != null && d.qty !== 1 ? d.qty : "—"}</td>
                                      <td className="py-1.5 pl-3 text-right tabular-nums font-semibold" style={{ color: t.text }}>{inr(d.amount)}</td>
                                      <td className="py-1.5 pl-3 text-right tabular-nums" style={{ color: t.muted }}>{d.approved || "—"}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            ) : (
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-1.5">
                                {basis.map(([k, v]) => (
                                  <div key={k} className="flex justify-between gap-4 text-xs">
                                    <span style={{ color: t.muted }}>{k}</span><span className="tabular-nums font-semibold" style={{ color: t.text }}>{v}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                            <div className="text-[11px] mt-2" style={{ color: t.faint }}>
                              {rows.length ? `From the ERP costing feed — the ${rows.length === 1 ? "line" : rows.length + " lines"} that make up this figure.` : "Worked out from the finalised plan — not an ERP figure."}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          {lines.some((l) => l.planned) && (
            <div className="flex items-center gap-2 mt-2 text-xs" style={{ color: t.muted }}>
              <span className="inline-block w-3 h-3 rounded" style={{ background: t.primarySoft, border: "1px solid " + t.border }} />
              Tinted rows come from the finalised plan, not the ERP. Click any row to see how it was worked out.
            </div>
          )}

          <div className="flex flex-wrap items-center gap-4 mt-3 text-sm">
            <div>Total spend: <b style={{ color: t.text }}>{inr(dailySpend)}</b>/day · <span style={{ color: t.muted }}>{inr(dailySpend * wd / 12)}/mo</span></div>
            <div className="ml-auto">Variance: <b style={{ color: dailyBudget - dailySpend >= 0 ? t.good : t.poor }}>{inr(dailyBudget - dailySpend)}</b>/day</div>
          </div>
          <div className="text-xs mt-3" style={{ color: t.muted }}>
            {lines.some((l) => l.id === "plan-hire")
              ? "Rented bus — its cost is the finalised plan's day tariff for this route; the ERP carries no cost lines for hired vehicles."
              : lines.some((l) => l.id === "plan-diesel")
                ? "Financial-year ERP standing costs plus diesel priced from the finalised plan's route km (₹100/L at this bus's ERP mileage). Driver salary is in neither ERP feed, so the total remains short of the full running cost."
                : "Standing costs only — this bus has no route in the finalised plan, and diesel and driver salary are in neither ERP feed."}
          </div>
        </>
      ) : (
        <div className="text-sm rounded-xl border border-dashed py-8 px-4 text-center" style={{ borderColor: t.border, color: t.muted }}>
          <div style={{ color: t.text }} className="font-semibold mb-1">No approved costs in the ERP for {bus.vehicle}</div>
          {bus.type === "Rental"
            ? "Rented buses carry no cost lines in the costing feed — their hire charge is invoiced rather than planned against the vehicle."
            : `Nothing has been purchased against this vehicle in ${windowLabel}. Approve its cost lines in the ERP and they appear on the next sync.`}
          <div className="mt-3">
            {editBudget ? (
              <div className="flex flex-wrap items-center justify-center gap-2">
                <span>₹</span>
                <input autoFocus type="number" min="0" value={draft.amount} placeholder="0"
                  onChange={(e) => setDraft({ ...draft, amount: e.target.value })}
                  aria-label={`Budget amount for ${bus.vehicle}`} className="rounded-lg px-2.5 py-1.5 text-sm outline-none w-32 tabular-nums"
                  style={{ background: t.inputBg, border: "1px solid " + t.border, color: t.text }} />
                <select value={draft.period} onChange={(e) => setDraft({ ...draft, period: e.target.value })}
                  aria-label="Budget period" className="rounded-lg px-2 py-1.5 text-sm outline-none"
                  style={{ background: t.inputBg, border: "1px solid " + t.border, color: t.text }}>
                  {COST_PERIODS.map(([v, lab]) => <option key={v} value={v}>{lab}</option>)}
                </select>
                <Btn t={t} className="!px-3 !py-1.5" onClick={() => { onSetBudget({ budgetAmount: draft.amount === "" ? "" : +draft.amount || 0, budgetPeriod: draft.period }); setEditBudget(false); }}>Save</Btn>
                <Btn t={t} variant="ghost" className="!px-3 !py-1.5" onClick={() => setEditBudget(false)}>Cancel</Btn>
              </div>
            ) : (
              <Btn t={t} variant="ghost" className="!px-3 !py-1.5" onClick={() => { setDraft({ amount: "", period: "month" }); setEditBudget(true); }}><Pencil size={14} /> Set a budget for this bus</Btn>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}

/* Driver name + phone. Neither is in the ERP feed, so they are entered here and kept on this
   device against the vehicle — the ERP placeholder shows only while nothing has been entered. */
function DriverCard({ t, bus, info, onSave }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ driver: "", phone: "" });
  const start = () => { setDraft({ driver: (info && info.driver) || "", phone: (info && info.phone) || "" }); setEditing(true); };
  const save = () => { onSave({ driver: draft.driver.trim(), phone: draft.phone.trim() }); setEditing(false); };
  const field = (label, key, props) => (
    <div>
      <label className="text-xs" style={{ color: t.muted }} htmlFor={`drv-${key}-${bus.id}`}>{label}</label>
      <input id={`drv-${key}-${bus.id}`} value={draft[key]} onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
        onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") setEditing(false); }}
        className="w-full rounded-lg px-2.5 py-1.5 text-sm outline-none mt-1"
        style={{ background: t.inputBg, border: "1px solid " + t.border, color: t.text }} {...props} />
    </div>
  );
  const shown = (v) => (v ? <span style={{ color: t.text }}>{v}</span> : <span className="italic" title={NEEDS_ERP} style={{ color: t.muted }}>Not set</span>);
  return (
    <Card t={t} title="Driver info"
      right={!editing && <Btn t={t} variant="ghost" className="!px-3 !py-1.5" onClick={start}><Pencil size={14} /> {info && (info.driver || info.phone) ? "Edit" : "Add"}</Btn>}>
      {editing ? (
        <>
          <div className="grid grid-cols-2 gap-4">
            {field("Driver", "driver", { placeholder: "Driver name", autoFocus: true })}
            {field("Phone", "phone", { placeholder: "Phone number", type: "tel", inputMode: "tel" })}
          </div>
          <div className="flex gap-2 mt-3">
            <Btn t={t} className="!px-3 !py-1.5" onClick={save}>Save</Btn>
            <Btn t={t} variant="ghost" className="!px-3 !py-1.5" onClick={() => setEditing(false)}>Cancel</Btn>
          </div>
        </>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4">
            <div><div className="text-xs" style={{ color: t.muted }}>Driver</div><div className="text-sm mt-0.5">{shown(info && info.driver)}</div></div>
            <div><div className="text-xs" style={{ color: t.muted }}>Phone</div><div className="text-sm mt-0.5">{shown(info && info.phone)}</div></div>
          </div>
          <div className="text-xs mt-3" style={{ color: t.faint }}>Not carried by either ERP feed — entered here and saved on this device against {bus.vehicle}.</div>
        </>
      )}
    </Card>
  );
}

/* ============================ COST REPORT ============================
   Costs only, drilled Unit-wise → Bus-wise → one bus's lines. Every figure uses the
   SAME normalisation as the cost card (lineDaily / profileDailySpend), so a number here
   can never disagree with the one on the bus page.

   On top of the ERP's costs it carries a small local ledger: amounts ALLOTTED (money that
   will be given out — an advance, a deposit, a scheduled payment) and amounts RECEIVED
   (a refund, an insurance claim, a rebate). Neither is in the ERP, so both are entered
   here and kept on this device, against a unit or a single bus. */
const LEDGER_PERIODS = [["once", "One-off"], ["day", "Per day"], ["month", "Per month"], ["year", "Per year"]];

/* An entry's contribution to ₹/working-day. A one-off is a lump sum, not a rate, so it
   never becomes a daily figure — it is reported separately and never silently annualised. */
function ledgerDaily(e, wd) { return e.period === "once" ? 0 : perDay(+e.amount || 0, e.period, wd); }
function ledgerTotals(entries, wd) {
  const z = { givenDaily: 0, recvDaily: 0, givenOnce: 0, recvOnce: 0, count: entries.length };
  entries.forEach((e) => {
    const once = e.period === "once", amt = +e.amount || 0;
    if (e.direction === "received") { if (once) z.recvOnce += amt; else z.recvDaily += ledgerDaily(e, wd); }
    else if (once) z.givenOnce += amt; else z.givenDaily += ledgerDaily(e, wd);
  });
  return z;
}

function LedgerCard({ t, title, hint, scope, target, entries, onAdd, onDelete, wd }) {
  const [open, setOpen] = useState(false);
  const blank = { direction: "given", label: "", amount: "", period: "once", date: new Date().toISOString().slice(0, 10) };
  const [draft, setDraft] = useState(blank);
  const mine = entries.filter((e) => e.scope === scope && e.target === target);
  const z = ledgerTotals(mine, wd);
  const field = { background: t.inputBg, border: "1px solid " + t.border, color: t.text };
  const save = () => {
    if (draft.amount === "" || !(+draft.amount)) return;
    onAdd({ ...draft, id: "led-" + Date.now(), scope, target, amount: +draft.amount });
    setDraft(blank); setOpen(false);
  };
  return (
    <Card t={t} title={title} hint={hint}
      right={!open && <Btn t={t} variant="ghost" className="!px-3 !py-1.5" onClick={() => setOpen(true)}><Plus size={14} /> Add entry</Btn>}>
      {open && (
        <div className="rounded-xl p-3 mb-3 flex flex-wrap items-end gap-2" style={{ background: t.surface2, border: "1px solid " + t.border }}>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: t.faint }}>Direction</div>
            <div className="inline-flex rounded-lg overflow-hidden" style={{ border: "1px solid " + t.border }}>
              {[["given", "To be given"], ["received", "Received"]].map(([v, lab]) => (
                <button key={v} type="button" onClick={() => setDraft({ ...draft, direction: v })}
                  className="px-3 py-1.5 text-xs font-semibold"
                  style={{ background: draft.direction === v ? (v === "received" ? t.goodSoft : t.poorSoft) : "transparent",
                           color: draft.direction === v ? (v === "received" ? t.good : t.poor) : t.muted, cursor: "pointer" }}>{lab}</button>
              ))}
            </div>
          </div>
          <div className="flex-1" style={{ minWidth: 160 }}>
            <div className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: t.faint }}>What for</div>
            <input value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })}
              placeholder="Diesel advance, insurance claim…" aria-label="What the entry is for"
              className="w-full rounded-lg px-2.5 py-1.5 text-sm outline-none" style={field} />
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: t.faint }}>Amount ₹</div>
            <input type="number" min="0" value={draft.amount} onChange={(e) => setDraft({ ...draft, amount: e.target.value })}
              onKeyDown={(e) => { if (e.key === "Enter") save(); }} placeholder="0" aria-label="Amount"
              className="rounded-lg px-2.5 py-1.5 text-sm outline-none w-28 tabular-nums" style={field} />
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: t.faint }}>Period</div>
            <select value={draft.period} onChange={(e) => setDraft({ ...draft, period: e.target.value })} aria-label="Period"
              className="rounded-lg px-2 py-1.5 text-sm outline-none" style={field}>
              {LEDGER_PERIODS.map(([v, lab]) => <option key={v} value={v}>{lab}</option>)}
            </select>
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: t.faint }}>Date</div>
            <input type="date" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} aria-label="Date"
              className="rounded-lg px-2 py-1.5 text-sm outline-none" style={field} />
          </div>
          <Btn t={t} className="!px-3 !py-1.5" onClick={save}>Save</Btn>
          <Btn t={t} variant="ghost" className="!px-3 !py-1.5" onClick={() => { setDraft(blank); setOpen(false); }}>Cancel</Btn>
        </div>
      )}

      {mine.length ? (
        <>
          <div className="rounded-xl overflow-hidden" style={{ border: "1px solid " + t.border }}>
            <table className="w-full text-sm">
              <thead><tr style={{ background: t.surface2 }}>
                {["Entry", "Date", "Amount", "Per", "₹/day", ""].map((h, i) => (
                  <th key={h + i} className={"py-2 px-3 text-xs font-semibold uppercase tracking-wider " + (i > 1 ? "text-right" : "text-left")} style={{ color: t.muted }}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {mine.slice().sort((a, b) => (b.date || "").localeCompare(a.date || "")).map((e) => {
                  const recv = e.direction === "received", c = recv ? t.good : t.poor;
                  return (
                    <tr key={e.id} style={{ borderTop: "1px solid " + t.border }}>
                      <td className="py-2 px-3" style={{ color: t.text }}>
                        <span className="text-[9px] font-bold uppercase tracking-wider rounded px-1.5 py-0.5 mr-2"
                          style={{ background: recv ? t.goodSoft : t.poorSoft, color: c }}>{recv ? "Received" : "To give"}</span>
                        {e.label || (recv ? "Received" : "Allotted")}
                      </td>
                      <td className="py-2 px-3 tabular-nums" style={{ color: t.muted }}>{e.date || "—"}</td>
                      <td className="py-2 px-3 text-right tabular-nums font-semibold" style={{ color: c }}>{recv ? "+" : "−"}{inr(e.amount)}</td>
                      <td className="py-2 px-3 text-right" style={{ color: t.muted }}>{(LEDGER_PERIODS.find(([v]) => v === e.period) || [, e.period])[1]}</td>
                      <td className="py-2 px-3 text-right tabular-nums" style={{ color: t.muted }}>{e.period === "once" ? "—" : inr(ledgerDaily(e, wd))}</td>
                      <td className="py-2 px-3 text-right">
                        <button onClick={() => onDelete(e.id)} title="Delete this entry" style={{ color: t.faint, cursor: "pointer" }}><X size={13} /></button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-1 mt-3 text-sm">
            <span style={{ color: t.muted }}>To be given: <b style={{ color: t.poor }}>{inr(z.givenDaily)}</b>/day{z.givenOnce ? <> · <b style={{ color: t.poor }}>{inr(z.givenOnce)}</b> one-off</> : null}</span>
            <span style={{ color: t.muted }}>Received: <b style={{ color: t.good }}>{inr(z.recvDaily)}</b>/day{z.recvOnce ? <> · <b style={{ color: t.good }}>{inr(z.recvOnce)}</b> one-off</> : null}</span>
          </div>
        </>
      ) : (
        <div className="text-sm rounded-xl border border-dashed py-6 px-4 text-center" style={{ borderColor: t.border, color: t.muted }}>
          Nothing allotted or received here yet. Use <b style={{ color: t.text }}>Add entry</b> for money going out (an advance, a deposit) or coming in (a claim, a rebate).
        </div>
      )}
    </Card>
  );
}

function CostReportView({ t, buses, records, employees, attendance, settings, busCosts, costMeta, costPhase, onSyncCosts, ledger, onAddLedger, onDelLedger, busInfo, onSetBusField, toast }) {
  const wd = effWorkingDays(settings);
  const [unitSel, setUnitSel] = useState(null);   // null = all units
  const [busSel, setBusSel] = useState(null);

  // one row per bus, on its latest day with data — same resolution the Live board uses
  const rows = useMemo(() => buses.map((b) => {
    const d = busLatestDate(records, employees, attendance, b.id);
    const rec = d ? resolveRec(records, employees, attendance, b.id, d) : null;
    const m = rec ? metricsFor(rec, b, wd) : null;
    const prof = busCosts && busCosts[b.id];
    return { bus: b, m, prof, spend: profileDailySpend(prof, wd), budget: profileDailyBudget(prof, wd) };
  }), [buses, records, employees, attendance, busCosts, wd]);

  const ledgerFor = (scope, target) => ledger.filter((e) => e.scope === scope && e.target === target);
  const unitLedger = (u) => ledger.filter((e) => (e.scope === "unit" && e.target === u)
    || (e.scope === "bus" && rows.some((r) => r.bus.id === e.target && r.bus.unit === u)));

  const unitRows = UNITS.map((u) => {
    const rs = rows.filter((r) => r.bus.unit === u);
    const spend = rs.reduce((s, r) => s + r.spend, 0);
    const budget = rs.reduce((s, r) => s + r.budget, 0);
    const present = rs.reduce((s, r) => s + (r.m ? r.m.present : 0), 0);
    return { unit: u, buses: rs.length, spend, budget, present, cph: present ? spend / present : 0, led: ledgerTotals(unitLedger(u), wd) };
  });

  const fleet = {
    spend: unitRows.reduce((s, u) => s + u.spend, 0),
    present: unitRows.reduce((s, u) => s + u.present, 0),
    led: ledgerTotals(ledger, wd),
  };
  const money = (n, c) => <span className="tabular-nums" style={{ color: c || t.text }}>{inr(n)}</span>;

  const crumb = (
    <div className="flex flex-wrap items-center gap-1.5 text-sm mb-4">
      <button onClick={() => { setUnitSel(null); setBusSel(null); }} className="font-semibold" style={{ color: unitSel ? t.primary : t.text, cursor: "pointer" }}>All units</button>
      {unitSel && <><ChevronRight size={14} style={{ color: t.faint }} />
        <button onClick={() => setBusSel(null)} className="font-semibold inline-flex items-center gap-1.5" style={{ color: busSel ? t.primary : t.text, cursor: "pointer" }}>
          <UnitDot t={t} unit={unitSel} />{unitSel}</button></>}
      {busSel && <><ChevronRight size={14} style={{ color: t.faint }} />
        <span className="font-semibold" style={{ color: t.text }}>{busSel}</span></>}
    </div>
  );

  const selBus = busSel && rows.find((r) => r.bus.id === busSel);

  return (
    <div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <Tile t={t} label="Fleet spend" value={inr(fleet.spend)} sub={`per working day · ${inr(fleet.spend * wd / 12)}/mo`} />
        <Tile t={t} label="Cost / head" value={inr(fleet.present ? fleet.spend / fleet.present : 0)} sub={`${fleet.present.toLocaleString("en-IN")} riders present`} />
        <Tile t={t} label="To be given" value={inr(fleet.led.givenDaily)} sub={fleet.led.givenOnce ? `per day · ${inr(fleet.led.givenOnce)} one-off` : "per day · allotted"} accent={fleet.led.givenDaily || fleet.led.givenOnce ? t.poor : null} />
        <Tile t={t} label="Received" value={inr(fleet.led.recvDaily)} sub={fleet.led.recvOnce ? `per day · ${inr(fleet.led.recvOnce)} one-off` : "per day · credits"} accent={fleet.led.recvDaily || fleet.led.recvOnce ? t.good : null} />
      </div>

      {crumb}

      {/* ---------- level 1: unit-wise ---------- */}
      {!unitSel && (
        <>
          <Card t={t} title="Unit-wise costs" hint={`Financial-year ERP cost lines plus the finalised plan's diesel, normalised to ₹/working-day (${wd} days) and rolled up by unit. Click a unit to see its buses.`}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm" style={{ minWidth: 760 }}>
                <thead><tr style={{ background: t.surface2 }}>
                  {["Unit", "Buses", "Riders", "Spend / day", "Spend / mo", "Cost / head", "To give", "Received"].map((h, i) => (
                    <th key={h} className={"py-2 px-3 text-xs font-semibold uppercase tracking-wider " + (i ? "text-right" : "text-left")} style={{ color: t.muted }}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {unitRows.map((u) => (
                    <tr key={u.unit} onClick={() => setUnitSel(u.unit)} title={`Open ${u.unit}`}
                      style={{ borderTop: "1px solid " + t.border, cursor: "pointer" }}>
                      <td className="py-2.5 px-3 font-semibold whitespace-nowrap" style={{ color: t.text }}><UnitDot t={t} unit={u.unit} />{u.unit}</td>
                      <td className="py-2.5 px-3 text-right tabular-nums" style={{ color: t.muted }}>{u.buses}</td>
                      <td className="py-2.5 px-3 text-right tabular-nums" style={{ color: t.muted }}>{u.present.toLocaleString("en-IN")}</td>
                      <td className="py-2.5 px-3 text-right font-semibold">{money(u.spend)}</td>
                      <td className="py-2.5 px-3 text-right" style={{ color: t.muted }}>{money(u.spend * wd / 12, t.muted)}</td>
                      <td className="py-2.5 px-3 text-right">{money(u.cph)}</td>
                      <td className="py-2.5 px-3 text-right">{u.led.givenDaily || u.led.givenOnce ? money(u.led.givenDaily + u.led.givenOnce, t.poor) : <span style={{ color: t.faint }}>—</span>}</td>
                      <td className="py-2.5 px-3 text-right">{u.led.recvDaily || u.led.recvOnce ? money(u.led.recvDaily + u.led.recvOnce, t.good) : <span style={{ color: t.faint }}>—</span>}</td>
                    </tr>
                  ))}
                  <tr style={{ borderTop: "2px solid " + t.border, background: t.surface2 }}>
                    <td className="py-2.5 px-3 font-bold whitespace-nowrap" style={{ color: t.text }}>Fleet</td>
                    <td className="py-2.5 px-3 text-right tabular-nums font-semibold" style={{ color: t.text }}>{rows.length}</td>
                    <td className="py-2.5 px-3 text-right tabular-nums font-semibold" style={{ color: t.text }}>{fleet.present.toLocaleString("en-IN")}</td>
                    <td className="py-2.5 px-3 text-right font-bold">{money(fleet.spend)}</td>
                    <td className="py-2.5 px-3 text-right font-semibold" style={{ color: t.muted }}>{money(fleet.spend * wd / 12, t.muted)}</td>
                    <td className="py-2.5 px-3 text-right font-bold">{money(fleet.present ? fleet.spend / fleet.present : 0)}</td>
                    <td className="py-2.5 px-3 text-right font-semibold">{money(fleet.led.givenDaily + fleet.led.givenOnce, t.poor)}</td>
                    <td className="py-2.5 px-3 text-right font-semibold">{money(fleet.led.recvDaily + fleet.led.recvOnce, t.good)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div className="text-xs mt-3" style={{ color: t.muted }}>
              Costs are read-only from the ERP and cover the financial year (1 April → 31 March) — corrections are made in the ERP. “To give” and “Received” are entered here; they sit outside the ERP and never change a cost line.
            </div>
          </Card>
          <div className="mt-4">
            <LedgerCard t={t} title="Fleet-wide allotments &amp; receipts" scope="fleet" target="all" entries={ledger} onAdd={onAddLedger} onDelete={onDelLedger} wd={wd}
              hint="Money going out or coming in for the fleet as a whole, not tied to one unit or bus." />
          </div>
        </>
      )}

      {/* ---------- level 2: bus-wise within a unit ---------- */}
      {unitSel && !busSel && (
        <>
          <Card t={t} title={`${unitSel} — bus-wise costs`} hint={`Each bus's ₹/working-day, from its financial-year ERP cost lines plus the finalised plan's diesel. Click a bus for its full breakdown.`}>
            {rows.filter((r) => r.bus.unit === unitSel).length ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm" style={{ minWidth: 820 }}>
                  <thead><tr style={{ background: t.surface2 }}>
                    {["Bus", "Riders", "Spend / day", "Spend / mo", "Cost / head", "Budget / day", "Variance", "To give", "Received"].map((h, i) => (
                      <th key={h} className={"py-2 px-3 text-xs font-semibold uppercase tracking-wider whitespace-nowrap " + (i ? "text-right" : "text-left")} style={{ color: t.muted }}>{h}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {rows.filter((r) => r.bus.unit === unitSel).sort((a, b) => b.spend - a.spend).map((r) => {
                      const led = ledgerTotals(ledgerFor("bus", r.bus.id), wd);
                      const varc = r.budget - r.spend;
                      return (
                        <tr key={r.bus.id} onClick={() => setBusSel(r.bus.id)} title={`Open ${r.bus.vehicle}`}
                          style={{ borderTop: "1px solid " + t.border, cursor: "pointer" }}>
                          <td className="py-2.5 px-3 font-semibold whitespace-nowrap" style={{ color: t.text }}>{r.bus.vehicle}</td>
                          <td className="py-2.5 px-3 text-right tabular-nums" style={{ color: t.muted }}>{r.m ? r.m.present : "—"}</td>
                          <td className="py-2.5 px-3 text-right font-semibold">{money(r.spend)}</td>
                          <td className="py-2.5 px-3 text-right">{money(r.spend * wd / 12, t.muted)}</td>
                          <td className="py-2.5 px-3 text-right">{r.m && r.m.present ? money(r.spend / r.m.present) : <span style={{ color: t.faint }}>—</span>}</td>
                          <td className="py-2.5 px-3 text-right">{r.budget ? money(r.budget, t.muted) : <span style={{ color: t.faint }}>—</span>}</td>
                          <td className="py-2.5 px-3 text-right">{r.budget ? money(varc, varc >= 0 ? t.good : t.poor) : <span style={{ color: t.faint }}>—</span>}</td>
                          <td className="py-2.5 px-3 text-right">{led.givenDaily || led.givenOnce ? money(led.givenDaily + led.givenOnce, t.poor) : <span style={{ color: t.faint }}>—</span>}</td>
                          <td className="py-2.5 px-3 text-right">{led.recvDaily || led.recvOnce ? money(led.recvDaily + led.recvOnce, t.good) : <span style={{ color: t.faint }}>—</span>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-sm rounded-xl border border-dashed py-8 px-4 text-center" style={{ borderColor: t.border, color: t.muted }}>
                No buses in {unitSel} yet.
              </div>
            )}
          </Card>
          <div className="mt-4">
            <LedgerCard t={t} title={`${unitSel} — allotments & receipts`} scope="unit" target={unitSel} entries={ledger} onAdd={onAddLedger} onDelete={onDelLedger} wd={wd}
              hint={`Money going out or coming in for ${unitSel} as a whole. Entries against individual buses are listed on the bus itself and still roll up here.`} />
          </div>
        </>
      )}

      {/* ---------- level 3: one bus ---------- */}
      {selBus && (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Tile t={t} label="Spend / day" value={inr(selBus.spend)} sub={`${inr(selBus.spend * wd / 12)}/mo`} />
            <Tile t={t} label="Cost / head" value={selBus.m && selBus.m.present ? inr(selBus.spend / selBus.m.present) : "—"} sub={selBus.m ? `${selBus.m.present} present` : "no punch data"} />
            <Tile t={t} label="Budget / day" value={selBus.budget ? inr(selBus.budget) : "—"} sub={selBus.budget ? "set on this bus" : "none set"} />
            <Tile t={t} label="Variance" value={selBus.budget ? inr(selBus.budget - selBus.spend) : "—"}
              sub={selBus.budget ? (selBus.budget - selBus.spend >= 0 ? "under budget" : "over budget") : "set a budget to compare"}
              accent={selBus.budget ? (selBus.budget - selBus.spend >= 0 ? t.good : t.poor) : null} />
          </div>
          <CostCard t={t} bus={selBus.bus} profile={selBus.prof} wd={wd} costMeta={costMeta} costPhase={costPhase} onSyncCosts={onSyncCosts}
            budget={busInfo && busInfo[selBus.bus.id]} onSetBudget={(patch) => { onSetBusField(selBus.bus.id, patch); toast("Budget saved"); }} />
          <LedgerCard t={t} title={`${selBus.bus.vehicle} — allotments & receipts`} scope="bus" target={selBus.bus.id} entries={ledger} onAdd={onAddLedger} onDelete={onDelLedger} wd={wd}
            hint="Money given out for this bus (an advance, a deposit) or received against it (a claim, a rebate). Rolls up into its unit." />
        </div>
      )}
    </div>
  );
}

/* ============================ BUS-WISE (Unit → Bus → details) ============================ */
function BusView({ t, unit, buses, records, employees, attendance, formulas, settings, variables, busCosts, costMeta, costPhase, onSyncCosts, busInfo, onSetBusField, toast, focusBusId, onBack }) {
  const wd = effWorkingDays(settings), showNV = settings.showNetValue;
  const vmap = varMapOf(variables);
  const allDates = useMemo(() => unionDates(records, attendance), [records, attendance]);
  const visBuses = buses.filter((b) => unit === "all" || b.unit === unit);
  const [q, setQ] = useState({}); // per-company search text: { Gainup: "", Technotek: "" }
  const [sel, setSel] = useState(focusBusId || (visBuses[0] ? visBuses[0].id : null));
  const [range, setRange] = useState({ from: "", to: "" });
  const [openEmp, setOpenEmp] = useState(null);
  // opened from a Live bus card → jump straight to that bus
  useEffect(() => { if (focusBusId) setSel(focusBusId); }, [focusBusId]);

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
    <div className="flex flex-col gap-3">
      {onBack && (
        <div>
          <button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold"
            style={{ border: "1px solid " + t.border, background: t.surface, color: t.text, cursor: "pointer" }}>
            <ArrowLeft size={15} /> Back to Live
          </button>
        </div>
      )}
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
                  <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: unitColor(t, u) }} />
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
          <p className="text-xs mt-3" style={{ color: t.muted }}>Cost/km and ride times show "{RUN_OPTIMISER}" until the route is planned in the Optimiser (that's where per-bus km &amp; travel time are computed). Cost/head, budget, spend &amp; net value come from the ERP's running costs for this vehicle (shown below).</p>
        </Card>

        {/* Bus & driver info now sit BELOW the metrics */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Card t={t} title="Bus info">
            <div className="grid grid-cols-2 gap-4">{infoItem("Vehicle", bus.vehicle)}{infoItem("Route", bus.route)}{infoItem("Unit / Company", bus.unit)}{infoItem("Capacity", bus.capacity + " seats")}</div>
          </Card>
          <DriverCard t={t} bus={bus} info={busInfo && busInfo[bus.id]} onSave={(patch) => { onSetBusField(bus.id, patch); toast("Driver details saved"); }} />
        </div>

        <CostCard t={t} bus={bus} profile={busCosts && busCosts[bus.id]} wd={wd} costMeta={costMeta} costPhase={costPhase} onSyncCosts={onSyncCosts}
          budget={busInfo && busInfo[bus.id]} onSetBudget={(patch) => { onSetBusField(bus.id, patch); toast("Budget saved"); }} />

        <Card t={t} title={`Employees (${emps.length})`} hint="Latest punch status · click an employee for full details">
          {emps.length ? <div className="flex flex-wrap gap-1.5">{emps.slice().sort((a, b) => { const r = (st) => (st === "A" ? 0 : st === "P" ? 2 : 1); return r(day[a.id]) - r(day[b.id]); }).map((e) => { const st = day[e.id]; const c = st === "P" ? t.good : st === "A" ? t.poor : t.faint; const lab = st === "P" ? "P" : st === "A" ? "A" : "–";
            return <button key={e.id} onClick={() => setOpenEmp(e)} title={st === "P" ? "Present" : st === "A" ? "Absent" : "No punch"} className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs transition" style={{ background: t.surface2, border: "1px solid " + t.border, color: t.text }}><span className="w-4 h-4 rounded flex items-center justify-center text-[9px] font-bold" style={{ background: c + "22", color: c }}>{lab}</span>{e.name}</button>; })}</div>
            : <div className="text-sm" style={{ color: t.muted }}>No employees mapped to this bus.</div>}
        </Card>

        {/* Stops — the route allotted to this bus in the finalised plan, in pickup order */}
        <Card t={t} title={`Stops${bus.planStops && bus.planStops.length ? ` (${bus.planStops.length})` : ""}`}
          hint={bus.planStops && bus.planStops.length
            ? `Pickup order from the finalised plan — ${bus.planKm} km, ${bus.planRide} min for the first rider, ${bus.planRiders} riders allotted.`
            : "The pickup/drop stops assigned to this bus. These are filled in from the finalised plan."}>
          {bus.planStops && bus.planStops.length ? (
            <>
              <div className="rounded-xl overflow-hidden" style={{ border: "1px solid " + t.border }}>
                <table className="w-full text-sm">
                  <thead><tr style={{ background: t.surface2 }}>
                    {["#", "Stop", "Riders", "Coordinates"].map((h, i) => (
                      <th key={h} className={"py-2 px-3 text-xs font-semibold uppercase tracking-wider " + (i === 2 ? "text-right" : "text-left")} style={{ color: t.muted }}>{h}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {bus.planStops.map((s, i) => (
                      <tr key={i} style={{ borderTop: "1px solid " + t.border }}>
                        <td className="py-2 px-3 tabular-nums" style={{ color: t.muted }}>{i + 1}</td>
                        <td className="py-2 px-3" style={{ color: t.text }}>{s.name}</td>
                        <td className="py-2 px-3 text-right tabular-nums font-semibold" style={{ color: t.text }}>{s.hc}</td>
                        <td className="py-2 px-3 tabular-nums text-xs" style={{ color: t.muted }}>{(+s.lat).toFixed(5)}, {(+s.lng).toFixed(5)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-wrap items-center gap-4 mt-3 text-sm">
                <div>Riders on the route: <b style={{ color: t.text }}>{bus.planStops.reduce((s, x) => s + (+x.hc || 0), 0)}</b></div>
                <div style={{ color: t.muted }}>Seats: {bus.capacity}</div>
                <div className="ml-auto text-xs" style={{ color: t.muted }}>Stops are listed in pickup order, farthest rider first.</div>
              </div>
            </>
          ) : (
            <div className="rounded-xl border border-dashed py-8 text-center text-sm" style={{ borderColor: t.border, color: t.muted }}>
              <MapPin size={18} className="inline-block mb-1.5 opacity-60" />
              <div>No stops allotted yet.</div>
              <div className="text-xs mt-0.5">This bus has no route in the finalised plan.</div>
            </div>
          )}
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
    series = (unit === "all" ? UNITS : [unit]).map((u) => ({ key: u, label: u, color: unitColor(t, u), company: u }));
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
              options={[["all", "All", t.primary], ...UNITS.map((u) => [u, u, unitColor(t, u)])]} />
            <span className="text-xs" style={{ color: t.muted }}>{cfg.buses.length} selected</span>
            <button onClick={() => setCfg({ ...cfg, buses: [...new Set([...cfg.buses, ...chipBuses.map((b) => b.id)])] })} className="text-xs font-semibold" style={{ color: t.primary }}>Select all shown</button>
            {cfg.buses.length > 0 && <button onClick={() => setCfg({ ...cfg, buses: [] })} className="text-xs" style={{ color: t.muted }}>Clear</button>}
          </div>
          <div className="flex flex-wrap gap-1.5 overflow-auto" style={{ maxHeight: 132 }}>
            {chipBuses.length === 0 ? <span className="text-xs" style={{ color: t.muted }}>No buses in the current data.</span>
              : chipBuses.map((b) => { const on = cfg.buses.includes(b.id);
                return <button key={b.id} onClick={() => toggleBus(b.id)} title={b.unit} className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition" style={{ background: on ? t.primarySoft : "transparent", border: "1px solid " + (on ? t.primary : t.border), color: on ? t.text : t.muted }}>
                  <span className="w-2 h-2 rounded-sm" style={{ background: unitColor(t, b.unit) }} />{b.vehicle}</button>; })}
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
// same eight hues as the optimiser's route palette (src/optimiser/ui.jsx) — keep in step
const PIE_PALETTE = ["#2563eb", "#ea580c", "#16a34a", "#c026d3", "#0891b2", "#ca8a04", "#dc2626", "#4d7c0f"];
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
  const colorFor = (k) => (UNITS.includes(k) ? unitColor(t, k) : t.primary);
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
            {busData.map((d, i) => <Cell key={i} fill={`url(#${gid("b" + (d.unit === "Gainup" ? "Gainup" : "Technotek"))})`} stroke={unitColor(t, d.unit)} strokeWidth={1} />)}
            <LabelList dataKey="value" position="top" formatter={fmtShort} fill={t.muted} fontSize={10} fontWeight={600} />
          </Bar>
        : seriesKeys.map((k) => <Bar key={k} dataKey={k} name={k} fill={`url(#${gid("b" + k)})`} stroke={colorFor(k)} strokeWidth={1} radius={[6, 6, 2, 2]} maxBarSize={36} animationDuration={900} animationEasing="ease-out" />)}
    </BarChart></ResponsiveContainer>
  );
  else if (cfg.type === "pie") {
    const pieData = (cfg.axis === "bus" ? busData.map((d) => ({ name: d.name, value: Math.max(0, d.value), color: unitColor(t, d.unit) }))
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
        <Scatter data={busData} animationDuration={900} animationEasing="ease-out" shape={(p) => <circle cx={p.cx} cy={p.cy} r={9} fill={unitColor(t, p.payload.unit)} fillOpacity={0.5} stroke={unitColor(t, p.payload.unit)} strokeWidth={2} />} />
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
                  options={[["all", "All", t.primary], ...UNITS.map((u) => [u, u, unitColor(t, u)])]} />
                <span className="text-xs" style={{ color: t.muted }}>{selBuses.length} selected</span>
                <button onClick={() => setCfg({ ...cfg, buses: [...new Set([...cfg.buses, ...chipBuses.map((b) => b.id)])] })} className="text-xs font-semibold" style={{ color: t.primary }}>Select all shown</button>
                {cfg.buses.length > 0 && <button onClick={() => setCfg({ ...cfg, buses: [] })} className="text-xs" style={{ color: t.muted }}>Clear</button>}
              </div>
              <div className="flex flex-wrap gap-1.5 overflow-auto" style={{ maxHeight: 132 }}>
                {chipBuses.length === 0 ? <span className="text-xs" style={{ color: t.muted }}>No buses in the current data.</span>
                  : chipBuses.map((b) => { const on = cfg.buses.includes(b.id);
                    return <button key={b.id} onClick={() => toggleBus(b.id)} title={b.unit} className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition" style={{ background: on ? t.primarySoft : "transparent", border: "1px solid " + (on ? t.primary : t.border), color: on ? t.text : t.muted }}>
                      <span className="w-2 h-2 rounded-sm" style={{ background: unitColor(t, b.unit) }} />{b.vehicle}</button>; })}
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
function SettingsView({ t, settings, setSettings, onReset, onExport, onSyncErp, erpStatus, toast, themeName, setThemeName,
  onSyncCosts, costStatus, costMeta,
  formulas, variables, onAddMetric, onUpdateMetric, onDelMetric, onAddVar, onUpdateVar, onDelVar }) {
  const [syncing, setSyncing] = useState(false);
  const doSync = async () => { setSyncing(true); try { await onSyncErp(); } finally { setSyncing(false); } };
  const erpLabel = erpStatus.phase === "ok" ? `● Live — ${erpStatus.msg}, updated ${fmtClock(erpStatus.at)}`
    : erpStatus.phase === "syncing" ? "● Syncing…"
    : erpStatus.phase === "error" ? `● Offline — ${erpStatus.msg}` : "● Not connected yet";
  const costBusy = costStatus.phase === "syncing";
  const costLabel = costStatus.phase === "ok" ? `● Live — ${costStatus.msg}, updated ${fmtClock(costStatus.at)}`
    : costBusy ? "● Resyncing…"
    : costStatus.phase === "error" ? `● Offline — ${costStatus.msg}` : "● Not connected yet";
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
          <div><div className="font-semibold" style={{ color: t.text }}>Auto-sync</div><div className="text-sm mt-0.5" style={{ color: t.muted, maxWidth: 520 }}>When on, the dashboard re-fetches from the ERP on the interval below and serves the stored snapshot in between. Turn off to freeze on the last pull; the sync pill always fetches on demand.</div></div>
          <div className="shrink-0"><Switch t={t} label="Auto-sync from ERP" checked={settings.erpAuto !== false} onChange={(v) => setSettings({ ...settings, erpAuto: v })} /></div>
        </div>
        <div className="flex items-center justify-between py-2 gap-4" style={rowStyle}>
          <div><div className="font-semibold" style={{ color: t.text }}>Refresh every</div><div className="text-sm mt-0.5" style={{ color: t.muted, maxWidth: 520 }}>People are added to the ERP through the working day, so a once-a-day pull can sit up to 24 hours behind. The punch feed is ~26 MB, so shorter intervals cost more bandwidth.</div></div>
          <div className="shrink-0">
            <select value={settings.erpRefreshMin ?? 30} onChange={(e) => setSettings({ ...settings, erpRefreshMin: +e.target.value })}
              aria-label="ERP refresh interval" className="rounded-lg px-3 py-2 text-sm outline-none"
              style={{ background: t.inputBg, border: "1px solid " + t.border, color: t.text }}>
              {[[15, "15 minutes"], [30, "30 minutes"], [60, "1 hour"], [180, "3 hours"], [0, "Once a day"]].map(([v, lab]) => (
                <option key={v} value={v}>{lab}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3 mt-3">
          <Btn t={t} onClick={doSync} disabled={syncing}><Server size={15} /> {syncing ? "Syncing…" : "Sync now"}</Btn>
          <span className="text-xs" style={{ color: erpStatus.phase === "error" ? t.poor : erpStatus.phase === "ok" ? t.good : t.muted }}>{erpLabel}</span>
        </div>
        <div className="text-xs mt-3" style={{ color: t.muted }}>Route / driver / phone aren't in this feed → shown as "{NEEDS_ERP}". Per-bus km, ride times &amp; stops come from the Optimiser → "{RUN_OPTIMISER}". In production this call is routed through the backend passthrough; in dev it uses the Vite proxy.</div>
      </Card>

      <Card t={t} title="ERP costing" hint="Approved vehicle cost lines from the ERP (VehicleEmpMapProjectDetails) — road tax, insurance, FC work, servicing, tyres, RTO and AdBlue. Pulled with the daily sync; resync here to pick up approvals made today.">
        <div className="flex flex-wrap items-center gap-3">
          <Btn t={t} onClick={onSyncCosts} disabled={costBusy}><RefreshCw size={15} className={costBusy ? "animate-spin" : ""} /> {costBusy ? "Resyncing…" : "Resync costing now"}</Btn>
          <span className="text-xs" style={{ color: costStatus.phase === "error" ? t.poor : costStatus.phase === "ok" ? t.good : t.muted }}>{costLabel}</span>
        </div>
        {costMeta && (
          <div className="flex flex-wrap gap-x-6 gap-y-1 mt-3 text-xs" style={{ color: t.muted }}>
            <span>Financial year <b style={{ color: t.text }}>{costMeta.fy}</b> ({costMeta.from} → {costMeta.to})</span>
            <span>Costed buses <b style={{ color: t.text }}>{costMeta.vehicles}</b></span>
            <span>Cost lines <b style={{ color: t.text }}>{costMeta.used}</b> of {costMeta.rows}</span>
            <span>Total <b style={{ color: t.text }}>{inr(costMeta.total)}</b></span>
            {costMeta.skippedUnapproved > 0 && <span>Unapproved skipped <b style={{ color: t.text }}>{costMeta.skippedUnapproved}</b></span>}
          </div>
        )}
        <div className="text-xs mt-3" style={{ color: t.muted }}>
          Costs cover the financial year (1 April → 31 March), the same year the ERP plans against — so early in the year the total is genuinely part-year. A line counts once it is approved; an unapproved line carries a zero amount and is left out. Rented buses have no cost lines in this feed. <b style={{ color: t.text }}>Diesel and driver salary are in neither ERP feed</b>, so per-bus totals are standing costs only.
          {costMeta && costMeta.heads && costMeta.heads.length ? ` Heads in this pull: ${costMeta.heads.join(", ")}.` : ""}
        </div>
      </Card>

      <Card t={t} title="Data">
        <div className="flex flex-wrap gap-3"><Btn t={t} variant="ghost" onClick={onExport}><Download size={15} /> Export all data (JSON)</Btn><Btn t={t} variant="danger" onClick={onReset}><Trash2 size={15} /> Clear local data &amp; re-sync</Btn></div>
        <div className="text-xs mt-3" style={{ color: t.muted }}>This local copy is saved on this device between sessions. Use “Sync from ERP” above to load live data.</div>
      </Card>

      {/* Custom metrics — moved here from its own top-level tab */}
      <MetricsView t={t} formulas={formulas || []} variables={variables || []} toast={toast}
        onAdd={onAddMetric} onUpdate={onUpdateMetric} onDel={onDelMetric}
        onAddVar={onAddVar} onUpdateVar={onUpdateVar} onDelVar={onDelVar} />
    </div>
  );
}

/* ============================ PREVIOUSLY USED ROUTE ============================ */
/* The live-ERP "current routes" view (map + routes table + edit/export), embedded from the
   self-contained public/routes_map.html so it shares one implementation with the standalone page. */
/* ============================ APP ============================ */
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
  const [busFocus, setBusFocus] = useState(null); // bus id opened from a Live card (Bus-wise has no nav entry)
  const [unit, setUnit] = useState("all");
  const [buses, setBuses] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [attendance, setAttendance] = useState({});
  const [records, setRecords] = useState([]);
  // Running costs come from the ERP costing feed and are read-only here. They live in their
  // own state (not on the bus) so the costing feed can be resynced on its own, without
  // refetching the much larger punch feed.
  const [costProfiles, setCostProfiles] = useState({});   // vehicle -> cost profile
  const [costMeta, setCostMeta] = useState(null);         // { from, to, vehicles, total, ... }
  const [costStatus, setCostStatus] = useState({ phase: "idle", at: null, msg: "" });
  const [plan, setPlan] = useState(null);                 // finalised route plan (static asset)
  const [ledger, setLedger] = useState([]);              // allotted / received entries (not in the ERP)
  const [busInfo, setBusInfo] = useState({});             // vehicle -> { driver, phone, budgetAmount, budgetPeriod }
  const [formulas, setFormulas] = useState([]);
  const [variables, setVariables] = useState([]);
  const [settings, setSettings] = useState({ showNetValue: true, workingDays: 312, holidays: [], bands: DEFAULT_BANDS.map((b) => ({ ...b })), erpAuto: true, erpRefreshMin: 30 });
  const [erpStatus, setErpStatus] = useState({ phase: "idle", at: null, msg: "", progress: null }); // idle|syncing|ok|error — live ERP connection; progress = {done,total} routes on first load
  const busesRef = useRef([]); // current fleet, read inside the stable syncErp callback
  const staleCostShape = useRef(false); // stored profiles predate the current COST_SHAPE
  const staleEmployees = useRef(false); // stored employees predate a field we now read (shift)
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
        b.forEach((x) => { x.unit = canonUnit(x.unit); });   // pre-rename snapshots
        const emps = (await Store.get("employees")) || [];
        // employees stored before the shift field existed can't answer "which shift?" —
        // one silent refresh fills it rather than leaving the board claiming no riders
        if (emps.length && !emps.some((e) => e.shift && e.unit && e.lat != null)) staleEmployees.current = true;
        // …and the same rule for `slot`, added when Rotational split into its three slots.
        // A snapshot saved before that split carries shift/unit/lat and so passes the test
        // above, but no slot — and serviceIdFor puts a slotless rider in NONE of the three,
        // so all three read "needs riders" against a feed that has them. Only fires when the
        // snapshot actually holds riders on a slot-divided shift, so a feed genuinely without
        // them can't re-sync on every load.
        if (emps.length && emps.some((e) => SLOT_SHIFTS.has(e.shift)) && !emps.some((e) => e.slot)) staleEmployees.current = true;
        setBuses(b); setRecords(recs); setAttendance(att); setEmployees(emps); setFormulas((await Store.get("formulas")) || []); setVariables((await Store.get("variables")) || []);
        const st = (await Store.get("settings")) || {};
        if (!st.bands || !st.bands.length) st.bands = DEFAULT_BANDS.map((x) => ({ ...x }));
        if (st.workingDays == null) st.workingDays = 312;
        if (st.showNetValue == null) st.showNetValue = true;
        if (!st.holidays) st.holidays = [];
        if (st.erpAuto == null) st.erpAuto = true;
        if (st.erpRefreshMin == null) st.erpRefreshMin = 30;
        setSettings(st);
      } else {
        // No stored fleet yet — never seed dummy data. Keep only the config defaults
        // (settings, custom metrics) and leave the fleet empty; the ERP sync below fills it.
        const s = sampleData(); setSettings(s.settings); setFormulas(s.formulas); setVariables(s.variables);
        setBuses([]); setEmployees([]); setAttendance({}); setRecords([]);
      }
      // Costs are stored alongside the fleet so the last pull is on screen before the
      // first fetch of the day lands; they refresh with it.
      setBusInfo((await Store.get("busInfo")) || {});
      setLedger(((await Store.get("costLedger")) || []).map((e) =>
        (e.scope === "unit" ? { ...e, target: canonUnit(e.target) } : e)));
      const cp = await Store.get("costProfiles");
      if (cp && cp.profiles) {
        setCostProfiles(cp.profiles); setCostMeta(cp.meta || null);
        if (cp.at) setCostStatus({ phase: "ok", at: cp.at, msg: `${Object.keys(cp.profiles).length} buses costed` });
        if (cp.shape !== COST_SHAPE) staleCostShape.current = true;   // refetch once the app is up
      }
      const th = await Store.get("theme"); if (th && THEMES[th]) setThemeName(th); // ignore any removed/old theme name
      setLoaded(true);
    })();
    return () => {};
  }, []);
  useEffect(() => { if (loaded) Store.set("schema", SCHEMA); }, [loaded]);
  useEffect(() => { if (loaded) Store.set("buses", buses); }, [buses, loaded]);
  useEffect(() => { busesRef.current = buses; }, [buses]);
  useEffect(() => { if (loaded) Store.set("employees", employees); }, [employees, loaded]);
  useEffect(() => { if (loaded) Store.set("attendance", attendance); }, [attendance, loaded]);
  useEffect(() => { if (loaded) Store.set("records", records); }, [records, loaded]);
  useEffect(() => { if (loaded) Store.set("formulas", formulas); }, [formulas, loaded]);
  useEffect(() => { if (loaded) Store.set("variables", variables); }, [variables, loaded]);
  useEffect(() => { if (loaded) Store.set("settings", settings); }, [settings, loaded]);
  useEffect(() => { if (loaded) Store.set("theme", themeName); }, [themeName, loaded]);
  useEffect(() => { if (loaded) Store.set("busInfo", busInfo); }, [busInfo, loaded]);
  useEffect(() => { if (loaded) Store.set("costLedger", ledger); }, [ledger, loaded]);

  /* Every service's finalised plan, not just 9 am's. The strip below used to read
     finalised_plan.json alone while sitting under a fleet-wide bus count, so a fleet running
     four services advertised one service's routes and cost as if they were the whole day.
     `plan` stays 9 am only — it feeds the per-bus cost overlay, and a bus shared between
     services would otherwise have one service's route silently overwrite another's. */
  useEffect(() => {
    fetch("/finalised_plan.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((p) => { if (p && Array.isArray(p.routes)) setPlan(p); })
      .catch(() => {});   // no plan file → dashboard runs exactly as before
  }, []);
  const [servicePlans, setServicePlans] = useState([]);
  useEffect(() => {
    const withPlans = SERVICES.filter((s) => s.planUrl);
    Promise.all(withPlans.map((s) =>
      fetch(s.planUrl + "?ts=" + Date.now())
        .then((r) => (r.ok ? r.json() : null))
        .then((p) => (p && Array.isArray(p.routes) ? { svc: s, plan: p } : null))
        .catch(() => null)
    )).then((rs) => setServicePlans(rs.filter(Boolean)));
  }, []);
  /* Per-SERVICE roll-up, DERIVED from the synced employees rather than captured during the
     sync: on a day that is already synced the stored snapshot is served and syncErp never
     runs, so anything captured only at sync time would be missing and every service would
     read "needs riders" against a feed that has them.

     Each rider lands in exactly one service (serviceIdFor: unit beats shift), so the counts
     sum to the fleet instead of Zenwear's riders also being counted inside 9 am General. */
  const erpShiftDate = useMemo(() => Object.keys(attendance || {}).sort().pop() || "", [attendance]);
  const erpRoll = useMemo(() => {
    const day = (attendance || {})[erpShiftDate] || {};
    const unitOfBus = new Map((buses || []).map((b) => [b.id, b.unit]));
    const out = {};
    (employees || []).forEach((e) => {
      // the rider's own unit is authoritative; a bus's unit is only the majority of who
      // rides it, so a Zenwear rider on a mostly-Technotek bus would land in the wrong service
      const id = serviceIdFor(e.unit || unitOfBus.get(e.busId), e.shift, e.slot);
      if (!id) return;
      let g = out[id];
      if (!g) { g = out[id] = { riders: 0, buses: new Set(), present: 0, shifts: {} }; }
      g.riders++;
      if (e.busId) g.buses.add(e.busId);
      if (day[e.id] === "P") g.present++;
      if (e.shift) g.shifts[e.shift] = (g.shifts[e.shift] || 0) + 1;
    });
    Object.values(out).forEach((g) => { g.buses = g.buses.size; });
    return out;
  }, [employees, attendance, buses, erpShiftDate]);

  const planByVeh = useMemo(() => {
    const m = new Map();
    (plan ? plan.routes : []).forEach((r) => m.set(canonVehicle(r.name), r));
    return m;
  }, [plan]);

  // records the tabs actually read: base records with each bus's cost profile overlaid as daily
  // spend/budget. Buses/profiles first pass through the finalised plan: route km + plan-variable
  // costs (diesel / rental tariff) join the ERP standing costs (see withPlanCosts).
  const wd = effWorkingDays(settings);
  const { buses: effBuses, profiles: busCosts } = useMemo(() => {
    const planned = withPlanCosts(buses, costProfiles, planByVeh);
    return applyBusInfo(planned.buses, planned.profiles, busInfo);
  }, [buses, costProfiles, planByVeh, busInfo]);
  const setBusField = useCallback((busId, patch) =>
    setBusInfo((prev) => ({ ...prev, [busId]: { ...prev[busId], ...patch } })), []);
  const effRecords = useMemo(() => mergeCostsIntoRecords(records, effBuses, attendance, busCosts, wd), [records, effBuses, attendance, busCosts, wd]);
  const planSummary = useMemo(() => {
    if (!servicePlans.length) return null;
    const named = new Set();
    servicePlans.forEach(({ plan: p }) => (p.routes || []).forEach((r) => named.add(canonVehicle(r.name))));
    // Plans built on different cost bases must not be added into one ₹/head. finalised_plan
    // charges loan+driver+maintenance in full; the headless plans can exclude them.
    const bases = new Set(servicePlans.map(({ plan: p }) => (p.costing && p.costing.basis) || "full"));
    const sum = (f) => servicePlans.reduce((n, { plan: p }) => n + (+f(p.overall) || 0), 0);
    const riders = sum((o) => o.riders);
    return {
      buses: sum((o) => o.buses), km: sum((o) => o.km), cost: sum((o) => o.cost), riders,
      cost_head: riders ? sum((o) => o.cost) / riders : 0,
      matched: buses.filter((b) => named.has(b.id)).length,
      services: servicePlans.map(({ svc }) => svc.name),
      missing: SERVICES.filter((s) => !servicePlans.some((x) => x.svc.id === s.id)).map((s) => s.name),
      mixedBasis: bases.size > 1,
    };
  }, [servicePlans, buses]);

  const exportJSON = () => { const blob = new Blob([JSON.stringify({ buses, employees, attendance, records, busCosts, formulas, variables, settings }, null, 2)], { type: "application/json" }); const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "fleet_data.json"; a.click(); };
  // Clear the local copy back to config defaults (no dummy fleet) and pull fresh from the ERP.
  const resetAll = () => { const s = sampleData(); setBuses([]); setEmployees([]); setAttendance({}); setRecords([]); setCostProfiles({}); setCostMeta(null); setCostStatus({ phase: "idle", at: null, msg: "" }); setFormulas(s.formulas); setVariables(s.variables); setSettings(s.settings); setTab("live"); toast("Cleared local data — re-syncing ERP"); syncErp(); };
  /* Costing feed — fetched with the punch feed on the daily sync, and on its own from the
     Resync buttons. Kept separate so a costing failure never costs you the fleet, and so
     re-pulling costs (a few hundred rows) doesn't drag the punch feed with it. */
  const syncCosts = useCallback(async ({ silent = false } = {}) => {
    setCostStatus((s) => ({ ...s, phase: "syncing" }));
    try {
      const { profiles, meta } = mapErpCosts(await fetchErpCostRaw());
      const at = Date.now();
      setCostProfiles(profiles); setCostMeta(meta);
      setCostStatus({ phase: "ok", at, msg: `${meta.vehicles} buses · ${meta.used} cost lines` });
      Store.set("costProfiles", { profiles, meta, at, shape: COST_SHAPE });
      Store.set("lastCostSync", at);
      if (!silent) toast(`Costing synced · ${meta.vehicles} buses · ${inr(meta.total)} in FY ${meta.fy}`);
      return meta;
    } catch (e) {
      setCostStatus({ phase: "error", at: Date.now(), msg: e.message || String(e) });
      if (!silent) toast("Costing sync failed: " + (e.message || e));
      return null;
    }
  }, []);

  // silent = auto/background refresh (no toast, no tab jump); loud = manual button press
  const syncErp = useCallback(async ({ silent = false } = {}) => {
    const firstLoad = busesRef.current.length === 0; // count-up reveal only when starting from empty
    setErpStatus((s) => ({ ...s, phase: "syncing", progress: firstLoad ? { done: 0, total: 0 } : null }));
    if (!silent) toast("Syncing from ERP…");
    // Both feeds are pulled on every sync — punch records and costing — and they run
    // concurrently. syncCosts settles its own status and never throws, so a costing
    // outage leaves the fleet sync untouched.
    const costing = syncCosts({ silent: true });
    try {
      const data = mapErpToDashboard(await fetchErpRaw());
      // On the first load, reveal the fetched routes as a real count-up (0 → total) before showing
      // the dashboard, so the loader reports genuine progress instead of an opaque spinner.
      // Only when the tab is visible: rAF is paused on a backgrounded tab, so awaiting the tween
      // there would never resolve and the sync would hang short of setBuses — which is exactly the
      // case the daily rollover sync runs in. Same rule as canEntrance(), applied to a promise.
      if (firstLoad && data.buses.length && canEntrance()) {
        const total = data.buses.length;
        await new Promise((resolve) => {
          const p = { done: 0 };
          gsap.to(p, { done: total, duration: Math.min(1.8, 0.6 + total * 0.013), ease: "power1.inOut",
            onUpdate: () => setErpStatus((s) => ({ ...s, phase: "syncing", progress: { done: Math.round(p.done), total } })),
            onComplete: resolve });
        });
      }
      setBuses(data.buses); setEmployees(data.employees); setAttendance(data.attendance); setRecords(data.records);

      Store.set("lastErpSync", Date.now()); // freshness marker the refresh interval measures against
      setErpStatus({ phase: "ok", at: Date.now(), msg: `${data.buses.length} buses · ${data.employees.length} employees`, progress: null });
      const cm = await costing;
      if (!silent) {
        setTab("live");
        toast(`ERP synced · ${data.buses.length} buses · ${data.employees.length} employees`
          + (cm ? ` · ${cm.vehicles} costed` : " · costing unavailable"));
      }
    } catch (e) {
      setErpStatus((s) => ({ ...s, phase: "error", msg: e.message || String(e), progress: null }));
      if (!silent) toast("ERP sync failed: " + (e.message || e));
    }
  }, [syncCosts]);

  /* Live connection: re-fetch every `erpRefreshMin` minutes (default 30), not once a day.
     The ERP is edited continuously — riders are onboarded into shifts and units through the
     working day — so a once-a-day pull left the dashboard up to 24 h stale. The stored
     snapshot still paints instantly on open; the refresh then lands quietly behind it.
     Set the interval to 0 to keep the old once-a-day behaviour. */
  useEffect(() => {
    if (!loaded || !settings.erpAuto) return;
    let cancelled = false;
    const sameDay = (a, b) => { const x = new Date(a), y = new Date(b); return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate(); };
    const everyMs = Math.max(0, +settings.erpRefreshMin || 0) * 60_000;
    // is the stored pull still fresh enough to skip a fetch?
    const fresh = (last) => {
      if (!last) return false;
      return everyMs ? Date.now() - last < everyMs : sameDay(last, Date.now());
    };
    const tick = async ({ first = false } = {}) => {
      const last = await Store.get("lastErpSync");
      if (cancelled) return;
      if (fresh(last) && busesRef.current.length > 0 && !staleEmployees.current) {
        if (first) setErpStatus({ phase: "ok", at: last, msg: "loaded " + fmtClock(last), progress: null });
        // costing is its own feed on its own marker — a day where only that pull failed
        // still gets caught up here
        const lastCost = await Store.get("lastCostSync");
        if (!cancelled && (staleCostShape.current || !fresh(lastCost))) {
          staleCostShape.current = false;
          syncCosts({ silent: true });
        }
        return;
      }
      staleEmployees.current = false;
      syncErp({ silent: true });
    };
    tick({ first: true });
    // check often; `fresh()` decides whether a check actually costs a fetch
    const id = setInterval(tick, Math.min(everyMs || 10 * 60_000, 5 * 60_000));
    return () => { cancelled = true; clearInterval(id); };
  }, [loaded, settings.erpAuto, settings.erpRefreshMin, syncErp, syncCosts]);

  // Bus-wise stays as a VIEW (reached by clicking a bus on Live) but leaves the nav;
  // Equations is retired; Metrics lives inside Settings now.
  const TABS = [["live", "Live", LayoutDashboard], ["optimiser", "Optimiser", Route], ["costs", "Cost report", IndianRupee], ["compare", "Compare", GitCompare], ["settings", "Settings", SettingsIcon]];
  const titleMap = { live: "Live snapshot", bus: "Bus-wise detail", costs: "Cost report", compare: "Compare", optimiser: "", settings: "Settings" };

  return (
    <div ref={rootRef} className={"min-h-screen w-full theme-" + (t.dark ? "dark" : "light")} style={{ background: t.bg, color: t.text, fontFamily: "'Inter Variable', Inter, system-ui, sans-serif", "--focus-ring": t.primary, "--sb-thumb": t.dark ? "rgba(148,163,184,.28)" : "rgba(100,116,139,.32)", "--sb-thumb-hover": t.dark ? "rgba(148,163,184,.5)" : "rgba(100,116,139,.55)" }}>
      <div ref={headerRef} className="sticky top-0 z-20" style={{ background: t.surface, borderBottom: "1px solid " + t.border }}>
        <div className="w-full px-6 flex items-center gap-4">
          <div className="flex items-center gap-3 py-2 min-w-0 shrink-0 sm:flex-1 sm:overflow-hidden">
            <div data-fx="logo" className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: t.primary }}><Bus size={20} color={t.onPrimary || "#fff"} /></div>
            {/* brand text is dropped below sm so the tabs and status pill never collide on a phone */}
            <div data-fx="brand" className="font-bold text-lg leading-tight tracking-tight truncate hidden sm:block">Transport dashboard</div>
          </div>
          <div className="flex overflow-x-auto flex-1 min-w-0 sm:flex-none py-1.5">
            {/* spotlight nav: sliding top light-bar + light cone on the active tab */}
            <SpotlightNav t={t} items={TABS.map(([k, l, Icon]) => ({ key: k, label: l, icon: Icon }))} activeKey={tab} onChange={setTab} />
          </div>
          <div className="flex justify-end min-w-0 shrink-0 sm:flex-1">
            {(() => {
              const p = erpStatus.phase;
              const dot = p === "ok" ? t.good : p === "syncing" ? t.watch : p === "error" ? t.poor : t.faint;
              const label = p === "syncing" ? "Syncing…" : p === "error" ? "ERP offline" : p === "ok" ? `Live · ${fmtClock(erpStatus.at)}` : "Connecting…";
              return (
                // below sm the pill collapses to just its status dot so it can't clip the Settings tab
                <button onClick={() => syncErp()} aria-live="polite" aria-label={`ERP status: ${label}. Tap to sync.`}
                  title={erpStatus.msg ? `${erpStatus.msg}${erpStatus.at ? " · updated " + fmtClock(erpStatus.at) : ""}` : "Sync from ERP now"}
                  className="inline-flex items-center gap-2 rounded-full px-2 sm:px-3 py-1.5 text-xs font-semibold whitespace-nowrap" style={{ background: t.surface2, border: "1px solid " + t.border, color: t.text }}>
                  <span ref={erpDotRef} className="w-2 h-2 rounded-full shrink-0" style={{ background: dot }} /><span className="hidden sm:inline">{label}</span>
                </button>
              );
            })()}
          </div>
        </div>
      </div>

      <div ref={mainRef} className="w-full px-6 py-6">
        {titleMap[tab] && <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
          <h2 data-fx="page-title" className="text-2xl font-bold tracking-tight">{titleMap[tab]}</h2>
          {["compare"].includes(tab) && <UnitDropdown t={t} value={unit} onChange={setUnit} />}
        </div>}
        {!loaded ? <div style={{ color: t.muted }}>Loading…</div> : (
          <>
            {tab === "live" && <LiveView t={t} unit={unit} buses={effBuses} records={effRecords} planSummary={planSummary} employees={employees} attendance={attendance} formulas={formulas} settings={settings} variables={variables} onOpenBusView={(id) => { setBusFocus(id); setTab("bus"); }} erpPhase={erpStatus.phase} onSync={() => syncErp()} />}
            {tab === "bus" && <BusView t={t} unit="all" buses={effBuses} records={effRecords} employees={employees} attendance={attendance} formulas={formulas} settings={settings} variables={variables} busCosts={busCosts} costMeta={costMeta} costPhase={costStatus.phase} onSyncCosts={() => syncCosts()} busInfo={busInfo} onSetBusField={setBusField} toast={toast} focusBusId={busFocus} onBack={() => { setBusFocus(null); setTab("live"); }} />}
            {tab === "costs" && <CostReportView t={t} buses={effBuses} records={effRecords} employees={employees} attendance={attendance} settings={settings}
              busCosts={busCosts} costMeta={costMeta} costPhase={costStatus.phase} onSyncCosts={() => syncCosts()}
              ledger={ledger} onAddLedger={(e) => setLedger((L) => [...L, e])} onDelLedger={(id) => setLedger((L) => L.filter((x) => x.id !== id))}
              busInfo={busInfo} onSetBusField={setBusField} toast={toast} />}
            {tab === "compare" && <CompareView t={t} unit={unit} buses={effBuses} records={effRecords} employees={employees} attendance={attendance} settings={settings} formulas={formulas} variables={variables} />}
            {tab === "optimiser" && <OptimiserTab t={t} toast={toast} erpBuses={buses} erpEmployees={employees} erpShifts={erpRoll} erpShiftDate={erpShiftDate} />}
            {tab === "settings" && <SettingsView t={t} settings={settings} setSettings={setSettings} onReset={resetAll} onExport={exportJSON} onSyncErp={syncErp} erpStatus={erpStatus} onSyncCosts={() => syncCosts()} costStatus={costStatus} costMeta={costMeta} toast={toast} themeName={themeName} setThemeName={setThemeName}
              formulas={formulas} variables={variables}
              onAddMetric={(f) => { setFormulas([...formulas, f]); toast("Metric added"); }}
              onUpdateMetric={(f) => { setFormulas(formulas.map((x) => (x.id === f.id ? f : x))); toast("Metric updated"); }}
              onDelMetric={(id) => setFormulas(formulas.filter((f) => f.id !== id))}
              onAddVar={(v) => { setVariables([...variables, v]); toast("Variable added"); }}
              onUpdateVar={(v) => setVariables(variables.map((x) => (x.id === v.id ? v : x)))}
              onDelVar={(id) => setVariables(variables.filter((v) => v.id !== id))} />}
          </>
        )}
      </div>

      {toastMsg && <Toast t={t} msg={toastMsg} />}
    </div>
  );
}
