/* ============================================================================
 * dailyCost.js — a bus's km-variable running cost on one day, worked out two ways.
 * ----------------------------------------------------------------------------
 * KM TRAVELLED     the km the bus drove, priced as diesel: km ÷ its ERP mileage × the
 *                  day's ERP diesel price. The km is GPS from the bus attendance app —
 *                  every trip has a leader who taps Start / End journey, and the app sums
 *                  a bus's journeys per day. A bus the app did not record that day falls
 *                  back to its finalised-plan route km, and says so.
 * DIESEL CONSUMED  what the ERP issued (DieselDetails). An issue refills what was burnt
 *                  since the previous one, so its litres are spread evenly over the days
 *                  since that issue (at most MAX_SPREAD_DAYS). The days after a bus's
 *                  latest issue are not known until the next one lands; they carry its
 *                  recent average, marked as an estimate.
 *
 * Standing costs (the ERP costing feed) do not move with km and are the same both ways.
 * A HIRED bus costs its day tariff on km both ways: its owner buys the diesel, and the
 * ERP issues it none.
 *
 * Pure (no React, no storage), so dailyCost.test.js runs it in Node.
 * ==========================================================================*/
import { rentTariff } from "./optimiser/engine.js";
import { vehKey } from "./erp.js";

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

/**
 * The km a bus drove on `date`, and where the figure comes from:
 *   source "gps"   the bus attendance app recorded the day (its journeys, summed)
 *          "plan"  nothing recorded: the finalised plan's route km stands in
 *          null    neither
 * `inProgress` — today, or a journey still recording: the km will grow.
 * `partial`    — a finished day whose GPS km is well under plan: a trip probably went unrecorded.
 */
export function kmOn(bus, date, gpsIdx, today) {
  const planKm = +bus.planKm || 0;
  const gps = gpsIdx ? gpsIdx.get(vehKey(bus.id) + "|" + date) : null;
  if (gps) {
    const km = +gps.km || 0;
    const inProgress = gps.active > 0 || (!!today && date >= today);
    return { km, source: "gps", gps, planKm, inProgress, partial: !inProgress && planKm > 0 && km < LOW_GPS_SHARE * planKm };
  }
  if (planKm) return { km: planKm, source: "plan", gps: null, planKm, inProgress: false, partial: false };
  return { km: 0, source: null, gps: null, planKm, inProgress: false, partial: false };
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
 * @param bus    { id, type, mileage, planKm, planType, planCost } — plan fields from the finalised plan
 * @param day    kmOn(...)
 * @param diesel dieselOn(...) for this bus, or null when the diesel feed is not loaded
 * @param price  priceOn(...) for the day, or null
 * @returns { hired, byKm, byDiesel } — each null when there is nothing to price
 */
export function variableCost(bus, day, diesel, price) {
  const hired = bus.planType ? bus.planType === "rent" : /rent/i.test(bus.type || "");
  if (hired) {
    if (!day.source) return { hired, byKm: null, byDiesel: null };
    // a plan day keeps the plan's own tariff figure; a GPS day prices the tariff on the km driven
    const amount = day.source === "plan" && bus.planCost != null ? +bus.planCost : rentTariff(day.km);
    const hire = { kind: "hire", amount, km: day.km, kmSource: day.source };
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
