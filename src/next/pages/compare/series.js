/* What one Compare chart plots: its lines, one row per date, and how its numbers read.
   The figures are the old ComparePanel's, from the same functions in Dashboard.jsx: each point is
   aggregate() over that company's (or that bus's) day, read with metricVal() or the custom
   formula. This file only arranges them for the chart. */
import {
  CMP_METRICS, UNITS, aggregate, busHasData, evalFormula, fmtFormula, metricVal, pairsForDate, resolveRec, scopeFromAgg,
} from "../../../Dashboard.jsx";
import { COMPANY_HEX, SERIES } from "../../chart.js";
import { MINUS, count, kms, money, money1, moneyShort, percent } from "../../format.js";

/* Seats filled is the old look's default: it always has data, while the cost figures stay empty
   until the ERP sends cost lines. Chart B opens on riders, which also always has data, so the two
   halves of the page do not repeat each other. No bus is preselected. */
export const DEFAULT_CFG = { metric: "b:util", group: "company", from: "", to: "", buses: [] };
export const DEFAULTS = { A: DEFAULT_CFG, B: { ...DEFAULT_CFG, metric: "b:present" } };

// the standard metrics, in the words the rest of the new look uses for them
const NAMES = {
  util: "Seats filled", present: "Riders", km: "Km travelled",
  cph: "Cost per head · by km", cph_diesel: "Cost per head · by diesel",
  cpk: "Cost per km · by km", cpk_diesel: "Cost per km · by diesel",
  spend: "Spend · by km", spend_diesel: "Spend · by diesel",
};

/** The metric choices: the standard ones, then the custom metrics made in Settings. */
export function metricOptions(formulas) {
  return {
    standard: CMP_METRICS.map(([key, label]) => ({ value: "b:" + key, label: NAMES[key] || label, key })),
    custom: formulas.map((f) => ({ value: "f:" + f.id, label: f.name, formula: f })),
  };
}
/** The chosen option; a custom metric deleted since it was picked falls back to the default. */
export function pickOption(options, metric) {
  return [...options.standard, ...options.custom].find((o) => o.value === metric)
    || options.standard.find((o) => o.value === DEFAULT_CFG.metric);
}

// money is always shown both ways: each money metric with its other way
const TWINS = [["cph", "cph_diesel"], ["cpk", "cpk_diesel"], ["spend", "spend_diesel"]];
/** For a money metric, its by-km and by-diesel options; null for any other metric. */
export function moneyPair(options, option) {
  const pair = TWINS.find((p) => p.includes(option.key));
  if (!pair) return null;
  const [km, diesel] = pair.map((k) => options.standard.find((o) => o.key === k));
  return { km, diesel };
}

/** One day's value for a set of { bus, rec } pairs: the old ComparePanel's valueOf. */
export function valueReader(option, wd, vmap) {
  return (pairs) => {
    if (!pairs.length) return null;
    const agg = aggregate(pairs, wd);
    return option.formula ? evalFormula(option.formula.expr, scopeFromAgg(agg), vmap) : metricVal(agg, option.key);
  };
}

// bus lines keep clear of the company hues (Chart A beside may be by company) and of the blue accent
const BUS_HUES = SERIES.filter((c) => c !== "#2f7bf5" && !Object.values(COMPANY_HEX).includes(c));
/** More bus lines than hues: colours repeat, so each line end carries its vehicle number too. */
export const namedEnds = (series) => series.length > BUS_HUES.length;

/** By company: a line per company, every bus in it together. By bus: a line per picked bus, in fleet order. */
export function seriesOf(group, picked, buses) {
  if (group === "company") return UNITS.map((u, i) => ({ id: u, dataKey: "s" + i, label: u, color: COMPANY_HEX[u], company: u }));
  return buses.filter((b) => picked.includes(b.id)).map((b, i) => ({
    id: b.id, dataKey: "s" + i, label: b.vehicle, color: BUS_HUES[i % BUS_HUES.length], bus: b, mono: true,
  }));
}

/** For each line, the { bus, rec } pairs of each date, or null on a date the line has no data. */
export function linePairs({ dates, series, buses, records, employees, attendance }) {
  return series.map((s) => dates.map((d) => {
    if (s.company) {
      const ps = pairsForDate(buses, records, employees, attendance, d, s.company);
      return ps.length ? ps : null;
    }
    return busHasData(records, employees, attendance, s.bus.id, d)
      ? [{ bus: s.bus, rec: resolveRec(records, employees, attendance, s.bus.id, d) }] : null;
  }));
}

/** One row per date; a line with no data that day is null, so the line bridges the gap. */
export function chartRows(dates, series, pairs, valueOf) {
  return dates.map((d, i) => {
    const row = { date: d };
    series.forEach((s, j) => { row[s.dataKey] = pairs[j][i] ? valueOf(pairs[j][i]) : null; });
    return row;
  });
}

/** Each line's figure over all the dates shown: aggregate() over every pair in the range, read the
 *  same way as a day, which is how the Bus page works out a range (busRangeFigures). */
export const rangeFigures = (pairs, valueOf) => pairs.map((byDate) => valueOf(byDate.flatMap((ps) => ps || [])));

/** The highest and lowest point on the chart, and the days that have any point. */
export function keyFigures(rows, series) {
  let hi = null, lo = null;
  const days = [];
  rows.forEach((r) => {
    let any = false;
    series.forEach((s) => {
      const v = r[s.dataKey];
      if (v == null) return;
      any = true;
      if (!hi || v > hi.v) hi = { v, s, date: r.date };
      if (!lo || v < lo.v) lo = { v, s, date: r.date };
    });
    if (any) days.push(r.date);
  });
  return { hi, lo, days };
}

/** Why a chart over all dates is empty, in the words of what is missing. */
export function missingOf(option) {
  if (option.formula) return "No attendance recorded yet.";
  if (option.key === "km") return "No km recorded yet.";
  if (option.key.endsWith("_diesel")) return "No diesel issues from the ERP yet.";
  if (TWINS.some((p) => p[0] === option.key)) return "The ERP has sent no costs yet.";
  return "No attendance recorded yet.";
}

const minus = (s) => s.replace(/^-/, MINUS);
const round1 = (v) => minus((Math.round(v * 10) / 10).toLocaleString("en-IN"));
// fmtShort of the old EquationChart in Dashboard.jsx (not exported), with a true minus: keep in step
const shortOf = (f) => (v) => (f.unit === "₹" ? moneyShort(v) : f.unit === "%" ? minus(Math.round(v) + "%")
  : Math.abs(v) >= 1000 ? minus((v / 1000).toFixed(1)) + "k" : round1(v));

/** How the chosen figure reads: `short` on the axis and at the line ends, `value` under the chart,
 *  `exact` on hover. `unit` is drawn as a smaller grey word after a value. */
export function formatOf(option) {
  const f = option.formula;
  if (f) {
    if (f.unit === "₹") return { short: moneyShort, value: money, exact: money };
    return { short: shortOf(f), value: (v) => minus(fmtFormula(v, f)), exact: (v) => minus(fmtFormula(v, f)) };
  }
  const k = option.key;
  if (k === "util") return { short: percent, value: percent, exact: (v) => minus(v.toFixed(1)) + "%" };
  if (k === "km") return { short: kms, value: kms, exact: kms, unit: "km" };
  if (k === "present") return { short: count, value: count, exact: count };
  if (k.startsWith("cpk")) return { short: moneyShort, value: money1, exact: money1 };
  if (k.startsWith("cph")) return { short: moneyShort, value: money, exact: money1 };
  return { short: moneyShort, value: moneyShort, exact: money };
}
