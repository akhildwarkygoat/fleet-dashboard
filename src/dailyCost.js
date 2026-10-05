/* ============================================================================
 * dailyCost.js — a bus's km-variable running cost on one day, worked out two ways.
 * ----------------------------------------------------------------------------
 * KM TRAVELLED     the km the bus drove, priced as diesel: km ÷ its ERP mileage × the
 *                  day's ERP diesel price. The km is GPS from the bus attendance app —
 *                  every trip has a leader who taps Start / End journey, and the app sums
 *                  a bus's journeys per day. A bus the app did not record that day falls
 *                  back to the planned km of its runs whose service ran that day, and says so.
 * DIESEL CONSUMED  what the ERP issued (DieselDetails). An issue refills what was burnt
 *                  since the previous one, so its litres are spread evenly over the days
 *                  since that issue (at most MAX_SPREAD_DAYS). The days after a bus's
 *                  latest issue are not known until the next one lands; they carry its
 *                  recent average, marked as an estimate.
 *
 * Standing costs (the ERP costing feed) do not move with km and are the same both ways; they
 * are charged only on a day the bus worked (workedOn). A HIRED bus costs one day tariff on the
 * day's total km both ways: its owner buys the diesel, and the ERP issues it none.
 *
 * Whether a service ran, or a bus's riders came in, is read from the punch feed (attendanceRules),
 * not the calendar: the factory works some Sundays and takes some weekdays off.
 *
 * Pure (no React, no storage), so dailyCost.test.js runs it in Node.
 * ==========================================================================*/
import { rentTariff } from "./optimiser/engine.js";
import { vehKey } from "./erp.js";
import { mondayOf } from "./optimiser/rotation.js";

export const DIESEL_PER_LITRE = 100;    // Rs/L on a day the ERP gives no price: the plan editor's figure
export const FALLBACK_KMPL = 100 / 18;  // km/L for a bus with no ERP mileage: the editor's Rs18/km template
export const MAX_SPREAD_DAYS = 7;       // an issue refills at most the week before it; a longer gap is a bus off the road
export const RECENT_DAYS = 30;          // the window a bus's average burn is taken over, for days not yet issued
export const ESTIMATE_DAYS = 10;        // ...and how long after its latest issue that average still stands in
export const LOW_GPS_SHARE = 0.6;       // a finished day whose GPS km is under 60% of plan probably lost a trip

const dayNum = (iso) => Math.round(Date.parse(iso + "T00:00:00Z") / 864e5);
const isoOf = (n) => new Date(n * 864e5).toISOString().slice(0, 10);

/** GET /api/fleet/km `days` → Map "VEHKEY|date" → that bus-day. */
export function indexGps(days) {
  const m = new Map();
  for (const d of days || []) m.set(vehKey(d.busId) + "|" + d.serviceDate, d);
  return m;
}

/** The ERP's diesel price on `date`: the price on its latest issue day on or before it. */
export function priceOn(prices, date) {
  let best = null;
  for (const [d, rate] of prices || []) { if (d > date) break; best = { rate, date: d }; }
  return best;
}

/** A hired bus. The ERP's type decides when it says anything; a blank one falls back to the plan's
 *  type, which the plan builder defaults to owned, so that reading is only a guess. */
export const isHiredBus = (bus) => (bus.type ? /rent/i.test(bus.type) : bus.planType === "rent");

/**
 * Whether a group of people came in on `date`, read the way erp.js reads a worked day: at least
 * half of those with a punch that day were present. A declared holiday is never a working day.
 * A day nobody in the group punched, or `open` (the feed's newest day, riders still arriving),
 * counts as one: there is nothing to judge it by.
 * @returns (employeeIds, date) → boolean
 */
export function cameInOn(attendance, { open, holidays } = {}) {
  const off = new Set(holidays || []);
  return (ids, date) => {
    if (off.has(date)) return false;
    const day = date !== open && attendance && attendance[date];
    let seen = 0, present = 0;
    if (day) for (const id of ids) { const a = day[id]; if (a) { seen++; if (a === "P") present++; } }
    return seen ? present / seen >= 0.5 : true;
  };
}

/**
 * The punch feed's two answers the costs need, kept per group and day (a month asks thousands):
 *   ranOn(service, date)     did the service run: its people came in (cameInOn)
 *   ridersCame(busId, date)  did the riders mapped to the bus come in
 * `serviceOf(employee)` is the employee's service id or null (services.js serviceIdFor).
 */
export function attendanceRules(employees, attendance, { serviceOf, open, holidays } = {}) {
  const came = cameInOn(attendance, { open, holidays });
  const groups = { svc: new Map(), bus: new Map() };
  const add = (m, key, id) => { if (!key) return; if (!m.has(key)) m.set(key, []); m.get(key).push(id); };
  for (const e of employees || []) { add(groups.svc, serviceOf(e), e.id); add(groups.bus, e.busId, e.id); }
  const memo = new Map();
  const judge = (kind) => (key, date) => {
    const k = kind + "|" + key + "|" + date;
    if (!memo.has(k)) memo.set(k, came(groups[kind].get(key) || [], date));
    return memo.get(k);
  };
  return { ranOn: judge("svc"), ridersCame: judge("bus") };
}

const NO_PLAN = { km: 0, type: undefined, runs: [] };

/**
 * The plan that stands in for a bus on `date`: { km, type, runs }. When the plans in force were
 * loaded for that week (bus.planWeeks, planRuns.js) it is every run the bus makes that week added
 * up, or nothing if it has none. Given `ranOn(service, date)`, only the runs whose service ran that
 * day count, and `skipped` says how many did not. A week that was not loaded falls back to the
 * bus's own plan fields, which carry no runs to judge.
 */
export function planOn(bus, date, ranOn) {
  const weeks = bus.planWeeks;
  if (weeks) {
    const w = mondayOf(date);
    if (w in weeks) {
      const p = weeks[w];
      if (!p) return NO_PLAN;
      if (!ranOn || !p.runs) return p;
      const runs = p.runs.filter((r) => ranOn(r.service, date));
      if (runs.length === p.runs.length) return p;
      return { ...p, km: Math.round(runs.reduce((s, r) => s + r.km, 0) * 10) / 10, runs, skipped: p.runs.length - runs.length };
    }
  }
  return { km: +bus.planKm || 0, type: bus.planType };
}

/**
 * The km a bus drove on `date`, and where the figure comes from:
 *   source "gps"   the bus attendance app recorded the day (its journeys, summed)
 *          "plan"  nothing recorded: the km of the planned runs that ran stands in (planOn)
 *          null    neither
 * `inProgress` — today, or a journey still recording: the km will grow.
 * `partial`    — a finished day whose GPS km is well under plan: a trip probably went unrecorded.
 * `plan`       — the plan the day was measured against.
 * GPS wins: a day the bus app recorded is its GPS km, whether or not a planned service ran.
 */
export function kmOn(bus, date, gpsIdx, today, ranOn) {
  const plan = planOn(bus, date, ranOn);
  const planKm = +plan.km || 0;
  const gps = gpsIdx ? gpsIdx.get(vehKey(bus.id) + "|" + date) : null;
  if (gps) {
    const km = +gps.km || 0;
    const inProgress = gps.active > 0 || (!!today && date >= today);
    return { km, source: "gps", gps, planKm, plan, inProgress, partial: !inProgress && planKm > 0 && km < LOW_GPS_SHARE * planKm };
  }
  if (planKm) return { km: planKm, source: "plan", gps: null, planKm, plan, inProgress: false, partial: false };
  return { km: 0, source: null, gps: null, planKm, plan, inProgress: false, partial: false };
}

/**
 * Whether the bus worked on `date`, the days its standing costs are charged on: the bus app recorded
 * it, or one of the runs planned for it that week ran, or, with no run planned that week, the riders
 * mapped to it came in (`ridersCame`, attendanceRules). A plan with no runs on record (a week whose
 * plans were not loaded) stands as planned.
 */
export function workedOn(bus, date, day, ridersCame) {
  if (day.source === "gps") return true;
  const p = day.plan, planned = p.runs ? p.runs.length + (p.skipped || 0) : 0;
  if (planned) return p.runs.length > 0;
  if (day.source === "plan") return true;
  return ridersCame ? ridersCame(bus.id, date) : true;
}

/* The days issue k refilled: from the day after the issue before it (at most MAX_SPREAD_DAYS
   back) to its own day. The first issue on record is taken to cover only its own day. */
function cover(issues, k) {
  const end = dayNum(issues[k][0]);
  const prev = k > 0 ? dayNum(issues[k - 1][0]) : end - 1;
  const start = Math.max(prev + 1, end - MAX_SPREAD_DAYS + 1);
  return { start, end, n: end - start + 1 };
}

/**
 * The diesel a bus's issues put on `date`:
 *   source "issued"    the issue that refilled the day, spread evenly over the days it covers
 *          "estimate"  after the latest issue: the average burn over the RECENT_DAYS before
 *                      it, for up to ESTIMATE_DAYS
 *          "none"      no issue covers the day (a gap past MAX_SPREAD_DAYS, or nothing issued)
 * @param issues [[date, litres, amount]] oldest first, one per day (mapErpDiesel)
 */
export function dieselOn(issues, date) {
  if (!issues || !issues.length) return { source: "none", litres: 0, amount: 0 };
  const t = dayNum(date);
  const k = issues.findIndex(([d]) => d >= date);
  if (k >= 0) {
    const c = cover(issues, k);
    if (t < c.start) return { source: "none", litres: 0, amount: 0, next: issues[k][0] };
    const [d, litres, amount] = issues[k];
    return { source: "issued", litres: litres / c.n, amount: amount / c.n, issue: { date: d, litres, amount, days: c.n, from: isoOf(c.start) } };
  }
  const lastDate = issues[issues.length - 1][0], last = dayNum(lastDate);
  if (t - last > ESTIMATE_DAYS) return { source: "none", litres: 0, amount: 0, last: lastDate };
  // litres per day burnt over the window: each issue in it over the days it covers (pro rata at the edge)
  const from = last - RECENT_DAYS + 1;
  let litres = 0, amount = 0, days = 0;
  for (let i = issues.length - 1; i >= 0; i--) {
    const c = cover(issues, i);
    if (c.end < from) break;
    const n = c.end - Math.max(c.start, from) + 1;
    litres += (issues[i][1] * n) / c.n; amount += (issues[i][2] * n) / c.n; days += n;
  }
  return { source: "estimate", litres: litres / days, amount: amount / days, last: lastDate, days };
}

/**
 * A bus's km-variable cost on one day, both ways.
 * @param bus    { id, type, mileage, planType } — planType from the plan it runs this week
 * @param day    kmOn(...)
 * @param diesel dieselOn(...) for this bus, or null when the diesel feed is not loaded
 * @param price  priceOn(...) for the day, or null
 * @returns { hired, byKm, byDiesel } — each null when there is nothing to price. byDiesel is the
 *          ERP's own reading, "none" included; the records put diesel by km in its place (noFill).
 */
export function variableCost(bus, day, diesel, price) {
  const hired = isHiredBus(bus);
  if (hired) {
    if (!day.source) return { hired, byKm: null, byDiesel: null };
    // one tariff a day on the day's total km, GPS or planned: a van is not paid per run
    const hire = { kind: "hire", amount: rentTariff(day.km), km: day.km, kmSource: day.source };
    return { hired, byKm: hire, byDiesel: hire };
  }
  const rate = price ? price.rate : DIESEL_PER_LITRE;
  const kmpl = +bus.mileage > 0 ? +bus.mileage : FALLBACK_KMPL;
  const byKm = day.source
    ? { kind: "diesel", amount: (day.km / kmpl) * rate, litres: day.km / kmpl, km: day.km, kmSource: day.source,
        kmpl, kmplFromErp: +bus.mileage > 0, rate, rateDate: price ? price.date : null }
    : null;
  const byDiesel = diesel
    ? { kind: "diesel", amount: diesel.amount, litres: diesel.litres, source: diesel.source,
        rate: diesel.litres ? diesel.amount / diesel.litres : rate,
        issue: diesel.issue || null, last: diesel.last || null, next: diesel.next || null }
    : null;
  return { hired, byKm, byDiesel };
}

/**
 * One bus's costs on one day, as the dashboard's records carry them (Dashboard.jsx
 * mergeCostsIntoRecords), so every page and the export read the same figures:
 *   standing, budget  the bus's ERP rates a working day, on a day it worked (workedOn); 0 otherwise
 *   varKm             hire, or diesel priced on km (0 when there is no km)
 *   varDiesel         hire, or diesel as the ERP issued it; diesel by km when the bus drove and no fill
 *                     covers the day (`noFill`); null while the diesel feed has not loaded
 *   spend, spendDiesel  standing plus each
 *   unpriced          a hired van that carried riders with no run planned that week and no GPS: its
 *                     hire is not known, so its figures are 0 and must not read as a cost
 * @param rates { standing, budget } ₹ a working day (costModel.js)
 * @param run   { gpsIdx, today, diesel, ranOn, ridersCame, ridersOn }
 * @returns the figures, or null when the day has nothing to show
 */
export function busDay(bus, date, rates, run = {}) {
  const issues = run.diesel ? run.diesel.issues[vehKey(bus.id)] || [] : null;
  const day = kmOn(bus, date, run.gpsIdx, run.today, run.ranOn);
  const worked = workedOn(bus, date, day, run.ridersCame);
  const cost = variableCost(bus, day, issues && dieselOn(issues, date), run.diesel ? priceOn(run.diesel.prices, date) : null);
  const standing = worked ? rates.standing : 0, budget = worked ? rates.budget : 0;
  const varKm = cost.byKm ? cost.byKm.amount : 0;
  const noFill = !cost.hired && !!cost.byDiesel && cost.byDiesel.source === "none" && varKm > 0;
  const varDiesel = cost.hired ? varKm : !cost.byDiesel ? null : noFill ? varKm : cost.byDiesel.amount;
  const planned = day.plan.runs ? day.plan.runs.length + (day.plan.skipped || 0) : 0;
  const unpriced = cost.hired && !day.source && !planned && !!run.ridersOn && run.ridersOn(bus.id, date) > 0;
  if (!standing && !budget && !varKm && !varDiesel && day.source !== "gps" && !unpriced) return null;
  return { budget, standing, km: day.km, spend: standing + varKm, spendDiesel: varDiesel == null ? null : standing + varDiesel,
    varKm, varDiesel, worked, noFill, unpriced, day, cost };
}
