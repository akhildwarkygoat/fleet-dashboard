/* ============================================================================
 * costReport.js — the fleet's costs over a day, a week or a month, and the spreadsheet export.
 * ----------------------------------------------------------------------------
 * One row per bus per day, built from what the dashboard already works out for that day
 * (mergeCostsIntoRecords → dailyCost.js busDay): the bus's standing costs from the ERP costing
 * feed split by head, charged on a day it worked, and its km-variable cost both ways (diesel
 * priced on km travelled, and diesel as the ERP issued it; a hired bus is its day tariff both
 * ways). Every amount is rounded to the paisa once, as its row is built, so the per-bus,
 * per-company and fleet sums agree to the paisa on every sheet and on the page. The same rows feed
 * the Costs page (both looks) and the .xlsx, and every cost has one name, its explainer's title.
 *
 * Pure apart from the XLSX writer (no React, no storage).
 * ==========================================================================*/
import * as XLSX from "xlsx";
import { COST_TYPE_MAP, lineDaily, profileDailySpend } from "./costModel.js";
import { DIESEL_PER_LITRE, FALLBACK_KMPL, MAX_SPREAD_DAYS, RECENT_DAYS, ESTIMATE_DAYS, isHiredBus, planOn } from "./dailyCost.js";
import { vehKey } from "./erp.js";

export const PERIODS = [["day", "Day"], ["week", "Week"], ["month", "Month"]];

const pad = (n) => String(n).padStart(2, "0");
const iso = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const utc = (s) => new Date(s + "T00:00:00Z");
const nice = (s, o) => utc(s).toLocaleDateString("en-IN", { timeZone: "UTC", ...o });
// spelt out here rather than by the locale, which writes "Sept" in some browsers and "Sep" in others
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const r2 = (n) => (n == null ? null : Math.round(n * 100) / 100);
const r1 = (n) => (n == null ? null : Math.round(n * 10) / 10);
const sum = (vs) => vs.reduce((s, v) => s + v, 0);
const plural = (n, one, many) => `${n.toLocaleString("en-IN")} ${n === 1 ? one : many}`;
const rupees = (n) => "₹" + Math.round(n).toLocaleString("en-IN");

/** The day, the Monday–Sunday week, or the calendar month containing `anchor` (YYYY-MM-DD). */
export function periodRange(kind, anchor) {
  const d = utc(anchor);
  if (kind === "week") {
    const from = new Date(d); from.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    const to = new Date(from); to.setUTCDate(from.getUTCDate() + 6);
    return { kind, from: iso(from), to: iso(to), label: `Week ${nice(iso(from), { day: "numeric", month: "short" })} – ${nice(iso(to), { day: "numeric", month: "short", year: "numeric" })}`, file: `week-${iso(from)}` };
  }
  if (kind === "month") {
    const from = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)), to = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
    return { kind, from: iso(from), to: iso(to), label: nice(iso(from), { month: "long", year: "numeric" }), file: `month-${iso(from).slice(0, 7)}` };
  }
  return { kind: "day", from: anchor, to: anchor, label: nice(anchor, { weekday: "short", day: "numeric", month: "short", year: "numeric" }), file: `day-${anchor}` };
}

/** `iso` moved one day, week or month back (dir -1) or forward (dir 1); a month lands on its 1st. */
export function shiftPeriod(iso, kind, dir) {
  const d = new Date(iso + "T00:00:00Z");
  if (kind === "month") d.setUTCMonth(d.getUTCMonth() + dir, 1);
  else d.setUTCDate(d.getUTCDate() + dir * (kind === "week" ? 7 : 1));
  return d.toISOString().slice(0, 10);
}
/** The page opens on the latest date with data (today when there is none). `dates` is sorted. */
export const latestDate = (dates) => dates[dates.length - 1] || new Date().toISOString().slice(0, 10);
/** The dates with data that fall inside a period. */
export const datesIn = (dates, period) => dates.filter((d) => d >= period.from && d <= period.to);
/** The dates a period is costed over. Today's riders are still arriving, so a week or a month leaves
 *  today out until the day is over; only its own Day view shows it, marked as such. */
export const datesShown = (dates, period, today) => datesIn(dates, period).filter((d) => period.kind === "day" || d !== today);

/** "4 Oct 2026". */
export const dateText = (s) => { const d = utc(s); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
/** The dates a stretch covers, as they read: "1 to 4 Oct 2026", "28 Sep to 4 Oct 2026", one day alone. */
export function datesText(from, to) {
  if (!to || from === to) return dateText(from);
  const a = utc(from), b = utc(to);
  if (a.getUTCFullYear() !== b.getUTCFullYear()) return `${dateText(from)} to ${dateText(to)}`;
  return `${a.getUTCDate()}${a.getUTCMonth() === b.getUTCMonth() ? "" : " " + MONTHS[a.getUTCMonth()]} to ${dateText(to)}`;
}
const dayMonth = (s) => dateText(s).replace(/ \d{4}$/, "");

/* ---- one name per cost: the columns, the cost lines, the explainers and both pages use these ---- */
const TITLES = {
  dieselKm: "Diesel by km travelled", dieselIssued: "Diesel as issued", hire: "Hire (rented buses)",
  taxes: "Road tax", insurance: "Insurance", fc: "FC works", maint: "Maintenance", rto: "RTO expense",
  tires: "Tyres", tiremaint: "Tyre maintenance", adblue: "AdBlue", driver: "Driver salary",
};
/* standing heads: the ERP costing feed's types in the dashboard's own order, then any head the ERP added later */
const HEAD_ORDER = ["taxes", "insurance", "fc", "maint", "rto", "tires", "tiremaint", "adblue", "driver", "diesel"];
export const headLabel = (type, lines) =>
  TITLES[type] || (COST_TYPE_MAP[type] && COST_TYPE_MAP[type].label) || (lines || []).find((l) => l.type === type)?.label || type.replace(/^erp:/, "").replace(/-/g, " ");
/** Every standing head in the fleet's cost profiles → its name (the page and the spreadsheet use these). */
export function costHeadNames(busCosts) {
  const lines = Object.values(busCosts || {}).flatMap((p) => (p && p.lines) || []);
  return Object.fromEntries([...new Set(lines.map((l) => l.type))].map((h) => [h, headLabel(h, lines)]));
}
/** A cost's one name: a fixed one for the costs the dashboard knows, else the ERP head's. */
export const costName = (key, headNames) => TITLES[key] || (headNames && headNames[key]) || headLabel(key);

/** ₹ per working day of each standing head for one bus's cost profile. */
function standingByHead(profile, wd) {
  const out = {};
  for (const l of (profile && profile.lines) || []) out[l.type] = (out[l.type] || 0) + lineDaily(l, wd);
  return out;
}
const hasCostLines = (busCosts, id) => !!(busCosts && busCosts[id] && (busCosts[id].lines || []).length);

/* How a bus-day was read, in the words the sheets and the pages use. */
export const NO_FILL = "No fill on record, by km used";
export const NOT_PRICED = "Not priced: no plan run or GPS";
const ISSUED_FROM = { issued: "ERP issue", estimate: "ERP average", none: "None issued" };

/* Why a row reads as it does, where its figures alone would not say. */
function rowNote(b, date, rec, busCosts) {
  if (rec && rec.unpriced) return NOT_PRICED;
  const notes = [];
  if (b.planOnly) notes.push("In the plan; no riders mapped in the ERP");
  if (!rec) {
    const p = planOn(b, date);
    notes.push(p.runs && p.runs.length ? "Did not run: its services were off that day"
      : hasCostLines(busCosts, b.id) ? "Did not work that day" : "Nothing to price: no plan run, no GPS, no ERP costs");
  } else if (!rec.worked) {
    notes.push("Did not run: only diesel as issued is spread over the day");
  } else if (rec.day.plan.skipped) {
    notes.push(`${plural(rec.day.plan.skipped, "planned run", "planned runs")} did not run: service off that day`);
  }
  return notes.join(". ");
}

/**
 * One row per bus per day with data in `dates`.
 * @param buses    the buses the costs cover (fleet.costBuses: the punch feed's and the plans' own)
 * @param records  the dashboard's merged records (dailyCost.js busDay: worked, varKm, varDiesel,
 *                 noFill, unpriced, day, cost)
 * @param riders   (busId, date) → riders carried that day (the dashboard's attendance roll-up)
 * @param dates    the dates to cost (datesShown)
 * A bus is charged its standing costs only on a day it worked. A rented bus with riders but no plan
 * run and no GPS (`priced: false`) has no figures at all: blank, never ₹0.
 */
export function costRows({ buses, records, busCosts, wd, dates, riders }) {
  const recs = new Map(records.map((r) => [r.busId + "|" + r.date, r]));
  const heads = new Set(), rows = [];
  const standing = new Map(buses.map((b) => [b.id, standingByHead(busCosts && busCosts[b.id], wd)]));
  for (const date of dates) for (const b of buses) {
    const found = recs.get(b.id + "|" + date), carried = riders(b.id, date) || 0;
    const rec = found && found.cost ? found : null;
    if (!rec && !carried) continue;
    const hired = isHiredBus(b);
    const plan = rec && rec.day.plan, runs = (plan && plan.runs) || [], skipped = (plan && plan.skipped) || 0;
    const row = {
      date, busId: b.id, company: b.unit || "", seats: +b.capacity || null, riders: carried,
      kind: hired ? "Hired" : !b.type && !hasCostLines(busCosts, b.id) ? "Owned?" : "Owned",
      runs: runs.length + skipped ? runs.length : null, plannedRiders: sum(runs.map((r) => +r.riders || 0)) || null,
      skipped, worked: !!(rec && rec.worked), planOnly: !!b.planOnly, note: rowNote(b, date, rec, busCosts),
    };
    if (rec && rec.unpriced) {
      rows.push({ ...row, priced: false, km: null, kmSource: "", standing: {}, standingTotal: null, hire: null, dieselKm: null, dieselKmLitres: null,
        dieselIssued: null, dieselIssuedLitres: null, dieselIssuedSource: "", totalKm: null, totalDiesel: null });
      continue;
    }
    const st = Object.fromEntries(Object.entries(row.worked ? standing.get(b.id) : {}).map(([h, v]) => [h, r2(v)]));
    Object.keys(st).forEach((h) => heads.add(h));
    const cost = rec && rec.cost, day = rec && rec.day;
    const varKm = rec ? r2(rec.varKm) : 0;
    const varDiesel = !rec ? 0 : rec.varDiesel == null ? null : r2(rec.varDiesel);
    const standingTotal = r2(sum(Object.values(st)));
    const hire = hired ? varKm : 0, dieselKm = hired ? 0 : varKm, dieselIssued = hired ? 0 : varDiesel;
    rows.push({
      ...row, priced: true,
      km: day ? r2(day.km) : 0, kmSource: day ? (day.source === "gps" ? "GPS" : day.source === "plan" ? "Plan" : "") : "",
      standing: st, standingTotal, hire, dieselKm,
      dieselKmLitres: !hired && cost && cost.byKm ? r2(cost.byKm.litres) : 0,
      dieselIssued,
      dieselIssuedLitres: hired || !cost ? 0 : dieselIssued == null ? null : r2(rec.noFill ? cost.byKm.litres : cost.byDiesel.litres),
      dieselIssuedSource: hired || !cost ? "" : !cost.byDiesel ? "Not loaded" : rec.noFill ? NO_FILL : ISSUED_FROM[cost.byDiesel.source] || "",
      totalKm: r2(standingTotal + hire + dieselKm), totalDiesel: dieselIssued == null ? null : r2(standingTotal + hire + dieselIssued),
    });
  }
  const order = [...HEAD_ORDER.filter((h) => heads.has(h)), ...[...heads].filter((h) => !HEAD_ORDER.includes(h)).sort()];
  return { rows, heads: order };
}

/* The ERP's rider mapping against the plan: a bus it maps under a quarter of the riders its planned
   runs carry has a cost per head that reads off, not one to act on. (Riders above its seats are no
   sign: the plans themselves put 60 or more on a 54-seater.) */
const MAPPED_SHARE = 0.25;
const riderCheck = (s) => (s.plannedRiders > 0 && s.ridersOnPlan < MAPPED_SHARE * s.plannedRiders
  ? "Not reliable: the ERP maps far fewer riders to it than the plan carries" : "");

const MONEY_KEYS = ["standingTotal", "hire", "dieselKm", "dieselIssued", "dieselFill", "dieselAverage", "dieselStandIn", "totalKm", "totalDiesel"];
const DIESEL_KEYS = ["dieselIssued", "dieselIssuedLitres", "dieselFill", "dieselAverage", "dieselStandIn", "totalDiesel"];

/** Sums a set of rows: totals per head and both ways, riders, km, days, cost per head / per km, how
 *  the diesel as issued was read, and what was left out. Rows hold whole paise, so each sum is
 *  rounded back to the paisa and every grouping of the same rows adds up to the same figure. */
export function sumRows(rows, heads) {
  const s = { days: new Set(rows.map((r) => r.date)).size, busDays: rows.length, daysRun: 0, gpsDays: 0, planDays: 0,
    riders: 0, pricedRiders: 0, unpricedRiders: 0, unpricedBusDays: 0, km: 0, standing: {},
    standingTotal: 0, hire: 0, dieselKm: 0, dieselKmLitres: 0, dieselIssued: 0, dieselIssuedLitres: 0,
    dieselFill: 0, dieselAverage: 0, dieselStandIn: 0, fillDays: 0, averageDays: 0, standInDays: 0,
    totalKm: 0, totalDiesel: 0, dieselMissing: false, skippedRuns: 0, plannedRiders: 0, ridersOnPlan: 0, planRiderDays: 0 };
  heads.forEach((h) => { s.standing[h] = 0; });
  const unpriced = new Set(), standIn = new Set(), riderDates = new Set();
  for (const r of rows) {
    s.riders += r.riders;
    if (r.riders) riderDates.add(r.date);
    if (r.worked) s.daysRun++;
    s.skippedRuns += r.skipped;
    if (r.plannedRiders) { s.plannedRiders += r.plannedRiders; s.ridersOnPlan += r.riders; s.planRiderDays++; }
    if (!r.priced) { s.unpricedRiders += r.riders; s.unpricedBusDays++; unpriced.add(r.busId); continue; }
    s.pricedRiders += r.riders;
    if (r.kmSource === "GPS") s.gpsDays++; else if (r.kmSource === "Plan") s.planDays++;
    s.km += r.km; s.standingTotal += r.standingTotal; s.hire += r.hire;
    s.dieselKm += r.dieselKm; s.dieselKmLitres += r.dieselKmLitres; s.totalKm += r.totalKm;
    heads.forEach((h) => { s.standing[h] += r.standing[h] || 0; });
    if (r.dieselIssued == null) s.dieselMissing = true;
    else {
      s.dieselIssued += r.dieselIssued; s.dieselIssuedLitres += r.dieselIssuedLitres;
      if (r.dieselIssuedSource === "ERP issue") { s.dieselFill += r.dieselIssued; s.fillDays++; }
      else if (r.dieselIssuedSource === "ERP average") { s.dieselAverage += r.dieselIssued; s.averageDays++; }
      else if (r.dieselIssuedSource === NO_FILL) { s.dieselStandIn += r.dieselIssued; s.standInDays++; standIn.add(r.busId); }
    }
    s.totalDiesel += r.totalDiesel == null ? r.standingTotal + r.hire : r.totalDiesel;
  }
  MONEY_KEYS.forEach((k) => { s[k] = r2(s[k]); });
  heads.forEach((h) => { s.standing[h] = r2(s.standing[h]); });
  s.km = r2(s.km); s.dieselKmLitres = r2(s.dieselKmLitres); s.dieselIssuedLitres = r2(s.dieselIssuedLitres);
  if (s.dieselMissing) DIESEL_KEYS.forEach((k) => { s[k] = null; }); // part of it unknown: no low figure passed off as the total
  s.unpricedBuses = unpriced.size; s.standInBuses = standIn.size;
  s.avgRiders = riderDates.size ? s.riders / riderDates.size : null;
  s.plannedRidersADay = s.planRiderDays ? s.plannedRiders / s.planRiderDays : null;
  // over the riders whose bus has a price: an unpriced van's riders would only pull the figure down
  s.cphKm = s.pricedRiders && s.totalKm > 0 ? s.totalKm / s.pricedRiders : null;
  s.cphDiesel = s.pricedRiders && s.totalDiesel > 0 ? s.totalDiesel / s.pricedRiders : null;
  s.cpkKm = s.km ? s.totalKm / s.km : null;
  s.cpkDiesel = s.km && s.totalDiesel != null ? s.totalDiesel / s.km : null;
  s.check = riderCheck(s);
  return s;
}

/** Rows grouped by `key` (e.g. "busId", "company") → [[value, rows]], sorted by value. */
export function groupRows(rows, key) {
  const m = new Map();
  for (const r of rows) { const k = r[key] || "—"; if (!m.has(k)) m.set(k, []); m.get(k).push(r); }
  return [...m.entries()].sort(([a], [b]) => String(a).localeCompare(String(b)));
}

/** How many buses the rows cover. */
export const busCount = (rows) => new Set(rows.map((r) => r.busId)).size;

/** Each company: how many buses it ran and its sums; "No company" ("—") last, after the named ones. */
export const companyTotals = (rows, heads) => groupRows(rows, "company")
  .map(([c, rs]) => ({ c, buses: busCount(rs), s: sumRows(rs, heads) }))
  .sort((a, b) => (a.c === "—") - (b.c === "—"));

/** Each bus: its rows and its sums, as on Summary by bus. */
export const busTotals = (rows, heads) => groupRows(rows, "busId").map(([id, rs]) => ({ id, rows: rs, s: sumRows(rs, heads) }));

/** Owned vehicles with ERP cost lines on no route: neither the punch feed nor the plans in force
 *  name them, so they carried nobody. Listed under the totals with their standing costs a working
 *  day, never inside them. */
export function noRouteVehicles(buses, busCosts, wd) {
  const known = new Set(buses.map((b) => vehKey(b.id)));
  return Object.entries(busCosts || {})
    .map(([id, p]) => ({ id, daily: r2(profileDailySpend(p, wd)) }))
    .filter((v) => v.daily > 0 && !known.has(vehKey(v.id)))
    .sort((a, b) => b.daily - a.daily || a.id.localeCompare(b.id));
}

/** A share of a total to one decimal ("12.3%"); "—" when the part is not known or the total is 0. */
export const shareOf = (a, b) => (a != null && b ? Math.round((a / b) * 1000) / 10 + "%" : "—");

/** The cost lines of a period's sums (sumRows), in page order: diesel both ways, hire, then each standing
 *  head. Empty lines are left out; an unknown diesel figure stays (amount null). `alt` marks diesel as
 *  issued, the other way of counting the same diesel; its sub says how much of it is not a fill. */
export function costLines(all, heads, headNames, num) {
  const issued = all.dieselIssued == null ? "diesel feed not loaded for every day" : [
    `${num(all.dieselIssuedLitres)} L`,
    all.dieselAverage > 0 && `${shareOf(all.dieselAverage, all.dieselIssued)} ERP average`,
    all.dieselStandIn > 0 && `${shareOf(all.dieselStandIn, all.dieselIssued)} by km, no fill on record`,
  ].filter(Boolean).join(" · ");
  return [
    { key: "dieselKm", label: costName("dieselKm"), amount: all.dieselKm, sub: `${num(all.dieselKmLitres)} L` },
    { key: "dieselIssued", label: costName("dieselIssued"), amount: all.dieselIssued, sub: issued, alt: true },
    { key: "hire", label: costName("hire"), amount: all.hire },
    ...heads.map((h) => ({ key: h, label: costName(h, headNames), amount: all.standing[h] })),
  ].filter((l) => l.amount == null || l.amount > 0);
}

/* ---- what every cost is: one place for both pages and the spreadsheet ----
   `sheet` marks the notes on the spreadsheet's own columns, which the pages do not show. */
export function costExplainers(wd) {
  return [
    { key: "cph", title: "Cost per head", what: "What it costs to bring one person to work for a day.",
      how: "The total cost of the buses for the period ÷ the rider-days they carried. It is shown both ways, by km and by diesel issued; the closer the two are, the more the diesel record and the km agree. Riders on a rented bus that is not priced are left out, so they do not pull the figure down." },
    { key: "two-ways", title: "Two totals: by km and by diesel issued", what: "Diesel is the one cost that changes with how far a bus drives, so it is worked out two independent ways.",
      how: "Total by km is standing costs + hire + diesel by km travelled. Total by diesel issued is standing costs + hire + diesel as issued. Every cost other than diesel is the same in both." },
    { key: "days", title: "Which days are costed", what: "A bus is costed for what it did that day, read from the punches rather than the calendar, since the factory works some Sundays and takes some weekdays off.",
      how: "A planned run counts only on a day its service ran: at least half of that service's people who punched that day were present. A day with no punches for the service counts as run. On a holiday declared in Settings no service counts as run. A planned run that did not run costs nothing: no km, no diesel by km, no hire. A day the bus attendance app recorded journeys for a bus is always costed, on its GPS km, holiday or not." },
    { key: "dieselKm", title: TITLES.dieselKm, what: "The diesel the bus should have burnt for the distance it drove.",
      how: `Km ÷ the bus's mileage (km per litre from the ERP, or ${FALLBACK_KMPL.toFixed(2)} km/L, ₹18 a km at ₹100 a litre, when the ERP has none) × that day's diesel price from the ERP (₹${DIESEL_PER_LITRE} a litre when no price is known yet). The km is the bus attendance app's GPS when it recorded the bus that day: every journey its leaders started and ended, added up ("GPS"). On a day the app recorded nothing, the planned km stands in ("Plan"): the km of every run in that week's plans whose service ran that day (9 am, 7 am, Zenwear and the three Rotational shifts), added up.` },
    { key: "dieselIssued", title: TITLES.dieselIssued, what: "The diesel the ERP actually filled into the bus.",
      how: `A fill tops up what was burnt since the previous fill, so its litres and cost are spread evenly over the days since then, at most ${MAX_SPREAD_DAYS} days back ("ERP issue"), whether or not the bus ran on each of them. For the days after a bus's latest fill, its own average over the ${RECENT_DAYS} days before it stands in for up to ${ESTIMATE_DAYS} days ("ERP average"), until the next fill replaces it. On a day an owned bus drove and no fill covers it, its diesel by km stands in ("${NO_FILL}"), so the total is not short. How much of the total is fills, ERP average and diesel by km is shown with it.` },
    { key: "hire", title: TITLES.hire, what: "A rented bus is paid one day tariff on the day's total km, however many runs it makes. Its owner buys the diesel and pays its other costs.",
      how: "Up to 80 km ₹1,700. Over 80 and up to 95 km ₹1,900. Over 95 km ₹18.70 a km, but never less than ₹1,900, so up to about 101.6 km it is still ₹1,900. Priced on the GPS km, or on the planned km of its runs that ran. The same in both totals; a rented bus has no standing costs here. A rented bus that carried riders but has no plan run and no GPS is not priced (see Not priced)." },
    { key: "standing", title: "Standing costs (owned buses)", what: "What an owned bus costs just by being on the road, whether it drives 10 km or 100.",
      how: `From the ERP's costing feed, per bus: road tax, insurance, FC works (the yearly fitness certificate), outside services and repairs, RTO expenses, tyres (count × price) and AdBlue (litres × price). It takes the lines whose period starts in the last 12 months up to the latest sync, so a yearly line that started more than 12 months ago (insurance from April last year, say) counts nothing until its renewal is entered in the ERP. A yearly amount becomes a daily one by dividing by the working days in the year (${wd}: Settings → Working days, minus declared holidays); a monthly amount is × 12 first. It is charged only on a day the bus worked: the bus app recorded it, one of its planned runs ran, or, for a bus with no run planned, at least half of its own riders who punched came in.` },
    { key: "taxes", title: TITLES.taxes, what: "The vehicle's road tax.", how: "ERP head ROAD TAX, the last 12 months, spread over working days." },
    { key: "insurance", title: TITLES.insurance, what: "The vehicle's insurance.", how: "ERP head VEHICLE INSURANCE, the last 12 months, spread over working days." },
    { key: "fc", title: TITLES.fc, what: "Work to pass the yearly fitness certificate (FC).", how: "ERP head FC WORK, the last 12 months, spread over working days." },
    { key: "maint", title: TITLES.maint, what: "Repairs and services done outside.", how: "ERP head VEHICLE OUTSIDE SERVICES, the last 12 months, spread over working days." },
    { key: "rto", title: TITLES.rto, what: "Transport office fees: permits, registration and the like.", how: "ERP head RTO EXPENSE, the last 12 months, spread over working days." },
    { key: "tires", title: TITLES.tires, what: "Tyres bought for the bus.", how: "ERP head TYRE: number of tyres × price, the last 12 months, spread over working days." },
    { key: "tiremaint", title: TITLES.tiremaint, what: "Tyre repairs and retreading.", how: "From the bus's cost lines: number of tyres × price, spread over working days." },
    { key: "adblue", title: TITLES.adblue, what: "The exhaust fluid diesel buses need.", how: "ERP head ADBLU: litres × price, the last 12 months, spread over working days." },
    { key: "driver", title: TITLES.driver, what: "The driver's pay.", how: "Not counted: the ERP costing feed does not carry driver pay, so no total here includes it." },
    { key: "riders", title: "Rider-days", what: "Each person counted once for each day they came, on any of the bus's runs: 30 people for 5 days is 150 rider-days.",
      how: "From the ERP's attendance punches for the employees mapped to the bus. A bus that makes several runs a day can carry more people than it has seats. Where the ERP maps under a quarter of the riders a bus's plan carries, its cost per head is marked not reliable: the riders and the km come from two different lists of who rides which bus." },
    { key: "notPriced", title: "Not priced", what: "A rented bus that carried riders on a day it has no plan run and no GPS.",
      how: "Its hire is not known, so its cost is left blank, not ₹0, and its riders are left out of the cost per head. The totals say how many rider-days were left out. Adding the bus to the plans, or its trips to the bus app, prices it." },
    { key: "noRoute", title: "Owned vehicles on no route", what: "Owned vehicles with ERP cost lines that no plan and no rider puts on a route.",
      how: "They carried nobody, so they are listed under the totals with their standing costs a working day, and left out of the totals and the cost per head." },
    { key: "today", title: "Today", what: "Today's riders are still arriving.",
      how: "Today is left out of the week and month totals, and out of the Excel file, until the day is over. The Day view shows it so far, marked as such." },
    { key: "kind", sheet: true, title: "Owned / hired", what: "Who owns the bus.",
      how: "Hired: the ERP type says rented, or, with no ERP type, the plan does. Owned: the ERP says owned, or the bus has ERP cost lines. Owned?: the ERP gives no type and no cost lines, so only the plan builder's default calls it owned, and its standing costs are not known." },
    { key: "seats", sheet: true, title: "Seats", what: "The bus's seat count from the ERP.", how: "Blank where the ERP has no seat count for the bus." },
    { key: "daysRun", sheet: true, title: "Days run", what: "The days the bus worked.",
      how: "A day the bus app recorded it, one of its planned runs ran, or, for a bus with no run planned, its riders came in (see Which days are costed)." },
    { key: "runs", sheet: true, title: "Runs and planned riders", what: "The planned runs that ran that day, and the riders the plans put on them.",
      how: "Blank for a bus in no plan that week. Average riders a day is over the days the bus carried anyone; planned riders a day over the days it had a planned run." },
    { key: "kmFrom", sheet: true, title: "Km from", what: "Where a day's km comes from.",
      how: "GPS: the bus attendance app's journeys. Plan: the planned km of the runs that ran. Blank: neither, so no km." },
    { key: "dieselFrom", sheet: true, title: "Diesel as issued from", what: "How a day's diesel as issued was read.",
      how: `ERP issue: a fill spread over the days it covers. ERP average: the bus's recent average after its latest fill. ${NO_FILL}: no fill covers a day the bus drove, so its diesel by km stands in. None issued: no fill covers the day and the bus drove no km. Not loaded: the ERP's diesel feed had not loaded.` },
  ];
}
/** The explainers by key, for each cost line's "what it is". */
export const costExplainerMap = (wd) => Object.fromEntries(costExplainers(wd).map((e) => [e.key, e]));
/** The explainers worth showing: a standing head's only when the period has it (driver salary always,
 *  as the cost no total includes), and the spreadsheet's column notes only on the sheet. */
export const explainersFor = (wd, heads, { sheet = false } = {}) => costExplainers(wd).filter((e) =>
  (sheet || !e.sheet) && (!HEAD_ORDER.includes(e.key) || e.key === "driver" || (heads || []).includes(e.key)));
/** "What it is" for a standing head the explainers do not name (one the ERP added later). */
export const OTHER_HEAD_WHAT = "A cost line from the ERP costing feed, spread over the working days of the year.";

/* ---- the spreadsheet ---- */
/* Number formats. Indian grouping (1,23,45,678) needs the conditional sections: Excel reads
   "#,##,##0" as plain thousands outside an Indian locale. Dates are Excel day numbers counted in
   UTC, so no time zone moves them. */
const indian = (dp, sign) => {
  const s = sign ? `"${sign}"` : "", d = dp ? "." + "0".repeat(dp) : "";
  return `[>=10000000]${s}##\\,##\\,##\\,##0${d};[>=100000]${s}##\\,##\\,##0${d};${s}#,##0${d}`;
};
export const XL = { money: indian(2, "₹"), km: indian(1), count: indian(0), date: "ddd dd-mmm-yyyy" };
const xlDate = (s) => (Date.parse(s + "T00:00:00Z") - Date.UTC(1899, 11, 30)) / 864e5;

/* A column: its header, the value of an item, its number format, a width wider than the header's. */
const col = (h, v, z, w) => ({ h, v, z, w });
const tableOf = (cols, items) => [cols.map((c) => c.h), ...items.map((x) => cols.map((c) => {
  const v = c.v(x);
  return v == null || v === "" ? null : c.z ? { v, z: c.z } : v;
}))];
const widthsOf = (cols) => cols.map((c) => Math.max(String(c.h).length + 2, c.w || 10));

/* A sheet from rows of cells; a cell is a value, or { v, z } for a number in a format. */
function sheetOf(aoa, widths) {
  const ws = XLSX.utils.aoa_to_sheet(aoa.map((row) => row.map((c) => (c && typeof c === "object" ? c.v : c))));
  aoa.forEach((row, r) => row.forEach((c, i) => {
    if (c && typeof c === "object") ws[XLSX.utils.encode_cell({ r, c: i })].z = c.z;
  }));
  ws["!cols"] = widths.map((w) => ({ wch: w }));
  return ws;
}

/* "4 days with data in the month 1 to 31 Oct 2026. 4 Oct is a Sunday. Today, 5 Oct, is left out
   until the day is over." */
function periodLine(period, dates, today, holidays) {
  const list = (ds) => ds.map(dayMonth).join(", ").replace(/, ([^,]*)$/, " and $1");
  const sundays = dates.filter((d) => utc(d).getUTCDay() === 0), hols = dates.filter((d) => (holidays || []).includes(d));
  const out = [period.kind === "day" ? `${WEEKDAYS[utc(period.from).getUTCDay()]} ${dateText(period.from)}.`
    : `${plural(dates.length, "day", "days")} with data in the ${period.kind} ${datesText(period.from, period.to)}.`];
  if (period.kind !== "day" && sundays.length) out.push(`${list(sundays)} ${sundays.length === 1 ? "is a Sunday" : "are Sundays"}.`);
  if (hols.length) out.push(`${list(hols)} ${hols.length === 1 ? "is a declared holiday" : "are declared holidays"}.`);
  if (today && period.kind !== "day" && today >= period.from && today <= period.to) out.push(`Today, ${dayMonth(today)}, is left out until the day is over.`);
  return out.join(" ");
}

/**
 * Builds the .xlsx: Totals, Summary by bus, Bus by day, How costs work. Returns the workbook.
 * `today` is never in it, whatever the rows hold: its riders are still arriving. `noRoute` are the
 * owned vehicles on no route (noRouteVehicles), listed under the totals; `gps` the bus app feed's
 * state when exported; `holidays` the declared ones, named on the period line.
 */
export function costWorkbook({ rows: given, heads, period, wd, headNames, today, holidays, noRoute = [], gps }) {
  const rows = today ? given.filter((r) => r.date !== today) : given;
  const name = (h) => costName(h, headNames);
  const dates = [...new Set(rows.map((r) => r.date))].sort();
  const all = sumRows(rows, heads);
  const companies = companyTotals(rows, heads), buses = busTotals(rows, heads);

  const sumCols = (get) => [
    col(name("hire"), (x) => get(x).hire, XL.money),
    col(name("dieselKm"), (x) => get(x).dieselKm, XL.money),
    col(name("dieselIssued"), (x) => get(x).dieselIssued, XL.money),
    col("of which ERP average", (x) => get(x).dieselAverage, XL.money),
    col("of which by km, no fill on record", (x) => get(x).dieselStandIn, XL.money),
    ...heads.map((h) => col(name(h), (x) => get(x).standing[h] || 0, XL.money)),
    col("Standing total", (x) => get(x).standingTotal, XL.money),
    col("Total by km", (x) => get(x).totalKm, XL.money),
    col("Total by diesel issued", (x) => get(x).totalDiesel, XL.money),
    col("Cost per head (by km)", (x) => r2(get(x).cphKm), XL.money),
    col("Cost per head (by diesel)", (x) => r2(get(x).cphDiesel), XL.money),
  ];

  // Totals: the fleet and each company, then how they were read and what they leave out
  const scopeCols = [
    col("Scope", (x) => x.label, null, Math.max(14, ...companies.map((c) => c.c.length + 2))),
    col("Buses", (x) => x.buses, XL.count),
    col("Days with data", (x) => x.s.days, XL.count),
    col("Bus-days run", (x) => x.s.daysRun, XL.count),
    col("Rider-days (people × days)", (x) => x.s.riders, XL.count),
    col("Rider-days not priced", (x) => x.s.unpricedRiders, XL.count),
    col("Average riders a day", (x) => r1(x.s.avgRiders), XL.km),
    col("Km", (x) => x.s.km, XL.km),
    ...sumCols((x) => x.s),
  ];
  const scopes = [{ label: "Whole fleet", buses: busCount(rows), s: all },
    ...companies.map(({ c, buses: n, s }) => ({ label: c === "—" ? "No company" : c, buses: n, s }))];
  const flagged = buses.filter((b) => b.s.check).length;
  const busDays = (n) => plural(n, "bus-day", "bus-days");
  const unpricedBy = companies.filter((c) => c.s.unpricedRiders)
    .map((c) => `${c.c === "—" ? "no company" : c.c} ${c.s.unpricedRiders.toLocaleString("en-IN")}`).join(", ");
  const notes = [
    all.dieselIssued == null ? "Diesel as issued is blank: the ERP's diesel feed had not loaded for every day."
      : all.dieselIssued > 0 && `Diesel as issued, ${rupees(all.dieselIssued)}: ERP fills ${rupees(all.dieselFill)} on ${busDays(all.fillDays)}, ERP average ${rupees(all.dieselAverage)} on ${busDays(all.averageDays)}, and diesel by km where no fill is on record ${rupees(all.dieselStandIn)} on ${busDays(all.standInDays)} (${plural(all.standInBuses, "bus", "buses")}).`,
    `Km from: GPS on ${busDays(all.gpsDays)}, the plan on ${busDays(all.planDays)}.${gps ? ` Bus attendance app when exported: ${gps}.` : ""}`,
    all.skippedRuns > 0 && `Planned runs that did not run, their service being off that day: ${all.skippedRuns.toLocaleString("en-IN")}. They cost nothing.`,
    all.unpricedRiders > 0 && `Not priced: ${plural(all.unpricedBuses, "rented bus", "rented buses")} on ${busDays(all.unpricedBusDays)} carried ${plural(all.unpricedRiders, "rider-day", "rider-days")} (${unpricedBy}). They have no plan run and no GPS, so their hire is not known: their cost is left blank and their riders are left out of the cost per head.`,
    flagged > 0 && `Cost per head not reliable for ${plural(flagged, "bus", "buses")}: the ERP's rider mapping does not match the plan (Summary by bus, Check).`,
  ].filter(Boolean);
  const routeLess = noRoute.length ? [[],
    [`Owned vehicles with ERP costs but on no route: ${noRoute.length}, ${rupees(sum(noRoute.map((v) => v.daily)))} of standing costs a working day. They carried nobody, so they are left out of the totals above.`],
    ...tableOf([col("Vehicle", (v) => v.id), col("Standing costs a working day", (v) => v.daily, XL.money)], noRoute)] : [];
  const totals = [
    [`Fleet costs, ${dates.length ? datesText(dates[0], dates[dates.length - 1]) : "no days with data"}`],
    [periodLine(period, dates, today, holidays)],
    [`Standing costs: ERP cost lines of the last 12 months, spread over ${wd} working days a year and charged on the days a bus worked. Amounts in ₹.`],
    [],
    ...tableOf(scopeCols, scopes),
    [], ...notes.map((n) => [n]),
    ...routeLess,
    [], ["How each figure is worked out: see the sheet \"How costs work\"."],
  ];

  // Summary by bus: an unpriced bus's money stays blank, as on its days
  const busNote = ({ rows: rs, s }) => [
    rs[0].planOnly && "In the plan; no riders mapped in the ERP",
    rs[0].kind === "Owned?" && "Owned only by the plan builder's default: the ERP has no type and no cost lines for it",
    s.unpricedBusDays > 0 && `${NOT_PRICED} (${plural(s.unpricedBusDays, "day", "days")})`,
    s.skippedRuns > 0 && `${plural(s.skippedRuns, "planned run", "planned runs")} did not run: service off that day`,
    s.standInDays > 0 && `No fill on record on ${plural(s.standInDays, "day", "days")}, by km used`,
  ].filter(Boolean).join(". ");
  const unpricedOnly = (x) => x.s.unpricedBusDays === x.s.busDays;
  const summaryCols = [
    col("Bus", (x) => x.id, null, 14), col("Company", (x) => x.rows[0].company), col("Owned / hired", (x) => x.rows[0].kind),
    col("Seats", (x) => x.rows[0].seats, XL.count), col("Days run", (x) => x.s.daysRun, XL.count),
    col("Days on GPS km", (x) => x.s.gpsDays, XL.count),
    col("Rider-days (people × days)", (x) => x.s.riders, XL.count),
    col("Average riders a day", (x) => r1(x.s.avgRiders), XL.km),
    col("Planned riders a day", (x) => r1(x.s.plannedRidersADay), XL.km),
    col("Km", (x) => (unpricedOnly(x) ? null : x.s.km), XL.km),
    ...sumCols((x) => x.s).map((c) => ({ ...c, v: (x) => (unpricedOnly(x) ? null : c.v(x)) })),
    col("Check", (x) => x.s.check, null, 40), col("Note", busNote, null, 40),
  ];
  const summary = tableOf(summaryCols, buses);

  // Bus by day
  const detailCols = [
    col("Date", (r) => xlDate(r.date), XL.date, 16), col("Bus", (r) => r.busId, null, 14), col("Company", (r) => r.company),
    col("Owned / hired", (r) => r.kind), col("Seats", (r) => r.seats, XL.count),
    col("Riders that day", (r) => r.riders, XL.count), col("Planned riders", (r) => r.plannedRiders, XL.count), col("Runs", (r) => r.runs, XL.count),
    col("Km", (r) => r.km, XL.km), col("Km from", (r) => r.kmSource),
    col(name("hire"), (r) => r.hire, XL.money), col(name("dieselKm"), (r) => r.dieselKm, XL.money),
    col("Diesel by km (litres)", (r) => r.dieselKmLitres, XL.km),
    col(name("dieselIssued"), (r) => r.dieselIssued, XL.money), col("Diesel as issued (litres)", (r) => r.dieselIssuedLitres, XL.km),
    col("Diesel as issued from", (r) => r.dieselIssuedSource, null, NO_FILL.length + 2),
    ...heads.map((h) => col(name(h), (r) => (r.priced ? r.standing[h] || 0 : null), XL.money)),
    col("Standing total", (r) => r.standingTotal, XL.money), col("Total by km", (r) => r.totalKm, XL.money),
    col("Total by diesel issued", (r) => r.totalDiesel, XL.money),
    col("Cost per head (by km)", (r) => (r.priced && r.riders && r.totalKm > 0 ? r2(r.totalKm / r.riders) : null), XL.money),
    col("Cost per head (by diesel)", (r) => (r.priced && r.riders && r.totalDiesel > 0 ? r2(r.totalDiesel / r.riders) : null), XL.money),
    col("Note", (r) => r.note, null, 40),
  ];
  const detail = tableOf(detailCols, [...rows].sort((a, b) => a.date.localeCompare(b.date) || a.busId.localeCompare(b.busId)));

  // How costs work: one sentence a row, so nothing runs off the screen
  const how = [["How every cost is worked out"], [], ["Cost", "What it is", "How it is worked out"]];
  for (const e of explainersFor(wd, heads, { sheet: true })) {
    e.how.split(/(?<=\.)\s+(?=[A-Z"(₹])/).forEach((line, i) => how.push(i ? ["", "", line] : [e.title, e.what, line]));
  }
  for (const h of heads.filter((x) => !TITLES[x])) how.push([name(h), OTHER_HEAD_WHAT, "From the ERP costing feed, the last 12 months, spread over working days."]);

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheetOf(totals, widthsOf(scopeCols)), "Totals");
  XLSX.utils.book_append_sheet(wb, sheetOf(summary, widthsOf(summaryCols)), "Summary by bus");
  XLSX.utils.book_append_sheet(wb, sheetOf(detail, widthsOf(detailCols)), "Bus by day");
  XLSX.utils.book_append_sheet(wb, sheetOf(how, [32, 60, 110]), "How costs work");
  return wb;
}

/** Writes the workbook as a download. */
export function downloadCosts(args) {
  XLSX.writeFile(costWorkbook(args), `fleet-costs-${args.period.file}.xlsx`);
}
