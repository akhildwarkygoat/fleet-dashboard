/* ============================================================================
 * costReport.js — the fleet's costs over a day, a week or a month, and the spreadsheet export.
 * ----------------------------------------------------------------------------
 * One row per bus per day, built from what the dashboard already works out for that day
 * (mergeCostsIntoRecords): the bus's standing costs from the ERP costing feed, split by head, and
 * its km-variable cost both ways (diesel priced on km travelled, and diesel as the ERP issued it;
 * a hired bus is its day tariff both ways). Rows roll up per bus, per company and for the fleet.
 * The same rows feed the Costs page and the .xlsx, so the two always agree.
 *
 * Pure apart from the XLSX writer (no React, no storage).
 * ==========================================================================*/
import * as XLSX from "xlsx";
import { COST_TYPE_MAP, lineDaily } from "./costModel.js";
import { DIESEL_PER_LITRE, FALLBACK_KMPL, MAX_SPREAD_DAYS, RECENT_DAYS, ESTIMATE_DAYS } from "./dailyCost.js";

export const PERIODS = [["day", "Day"], ["week", "Week"], ["month", "Month"]];

const pad = (n) => String(n).padStart(2, "0");
const iso = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const utc = (s) => new Date(s + "T00:00:00Z");
const nice = (s, o) => utc(s).toLocaleDateString("en-IN", { timeZone: "UTC", ...o });

/** The day, the Monday–Sunday week, or the calendar month containing `anchor` (YYYY-MM-DD). */
export function periodRange(kind, anchor) {
  const d = utc(anchor);
  if (kind === "week") {
    const from = new Date(d); from.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    const to = new Date(from); to.setUTCDate(from.getUTCDate() + 6);
    return { from: iso(from), to: iso(to), label: `Week ${nice(iso(from), { day: "numeric", month: "short" })} – ${nice(iso(to), { day: "numeric", month: "short", year: "numeric" })}`, file: `week-${iso(from)}` };
  }
  if (kind === "month") {
    const from = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)), to = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
    return { from: iso(from), to: iso(to), label: nice(iso(from), { month: "long", year: "numeric" }), file: `month-${iso(from).slice(0, 7)}` };
  }
  return { from: anchor, to: anchor, label: nice(anchor, { weekday: "short", day: "numeric", month: "short", year: "numeric" }), file: `day-${anchor}` };
}

/* standing heads: the ERP costing feed's types in the dashboard's own order, then any head the ERP added later */
const HEAD_ORDER = ["taxes", "insurance", "fc", "maint", "rto", "tires", "tiremaint", "adblue", "driver", "diesel"];
export const headLabel = (type, lines) =>
  (COST_TYPE_MAP[type] && COST_TYPE_MAP[type].label) || (lines || []).find((l) => l.type === type)?.label || type.replace(/^erp:/, "").replace(/-/g, " ");

/** ₹ per working day of each standing head for one bus's cost profile. */
function standingByHead(profile, wd) {
  const out = {};
  for (const l of (profile && profile.lines) || []) out[l.type] = (out[l.type] || 0) + lineDaily(l, wd);
  return out;
}

/**
 * One row per bus per day with data in [from, to].
 * @param records  the dashboard's merged records (busId, date, standing, km, spend, spendDiesel, day, cost)
 * @param riders   (busId, date) → riders carried that day (the dashboard's attendance roll-up)
 * @param dates    the dates in range that have any data
 */
export function costRows({ buses, records, busCosts, wd, dates, riders }) {
  const recs = new Map(records.map((r) => [r.busId + "|" + r.date, r]));
  const heads = new Set(), rows = [];
  const standing = new Map(buses.map((b) => [b.id, standingByHead(busCosts && busCosts[b.id], wd)]));
  for (const date of dates) for (const b of buses) {
    const rec = recs.get(b.id + "|" + date), carried = riders(b.id, date);
    if (!rec && !carried) continue;
    const st = standing.get(b.id) || {};
    Object.keys(st).forEach((h) => heads.add(h));
    const cost = rec && rec.cost, day = rec && rec.day;
    const hired = !!(cost && cost.hired);
    const byKm = cost && cost.byKm ? cost.byKm.amount : 0;
    const issued = cost ? (cost.byDiesel ? cost.byDiesel.amount : null) : 0;
    const standingTotal = Object.values(st).reduce((s, v) => s + v, 0);
    const totalKm = standingTotal + byKm, totalDiesel = issued == null ? null : standingTotal + issued;
    rows.push({
      date, busId: b.id, company: b.unit || "", kind: hired ? "Hired" : "Owned", seats: +b.capacity || 0, riders: carried || 0,
      km: day ? day.km : 0, kmSource: day ? (day.source === "gps" ? "GPS" : day.source === "plan" ? "Plan" : "") : "",
      standing: st, standingTotal,
      hire: hired ? byKm : 0,
      dieselKm: hired ? 0 : byKm, dieselKmLitres: !hired && cost && cost.byKm ? cost.byKm.litres : 0,
      dieselIssued: hired ? 0 : issued, dieselIssuedLitres: !hired && cost && cost.byDiesel ? cost.byDiesel.litres : 0,
      dieselIssuedSource: hired || !cost ? "" : !cost.byDiesel ? "not loaded" : cost.byDiesel.source === "issued" ? "ERP issue" : cost.byDiesel.source === "estimate" ? "ERP average" : "none issued",
      totalKm, totalDiesel,
    });
  }
  const order = [...HEAD_ORDER.filter((h) => heads.has(h)), ...[...heads].filter((h) => !HEAD_ORDER.includes(h)).sort()];
  return { rows, heads: order };
}

/** Sums a set of rows: totals per head and both ways, riders, km, days, and cost per head / per km. */
export function sumRows(rows, heads) {
  const s = { days: new Set(rows.map((r) => r.date)).size, busDays: rows.length, riders: 0, km: 0, standing: {}, standingTotal: 0, hire: 0, dieselKm: 0, dieselKmLitres: 0, dieselIssued: 0, dieselIssuedLitres: 0, totalKm: 0, totalDiesel: 0, dieselMissing: false };
  heads.forEach((h) => { s.standing[h] = 0; });
  for (const r of rows) {
    s.riders += r.riders; s.km += r.km; s.standingTotal += r.standingTotal; s.hire += r.hire;
    s.dieselKm += r.dieselKm; s.dieselKmLitres += r.dieselKmLitres; s.totalKm += r.totalKm;
    heads.forEach((h) => { s.standing[h] += r.standing[h] || 0; });
    if (r.dieselIssued == null) s.dieselMissing = true; else { s.dieselIssued += r.dieselIssued; s.dieselIssuedLitres += r.dieselIssuedLitres; }
    s.totalDiesel += r.totalDiesel == null ? r.standingTotal + r.hire : r.totalDiesel;
  }
  if (s.dieselMissing) { s.dieselIssued = null; s.totalDiesel = null; } // part of it unknown: do not show a low figure as the total
  s.cphKm = s.riders ? s.totalKm / s.riders : null;
  s.cphDiesel = s.riders && s.totalDiesel != null ? s.totalDiesel / s.riders : null;
  s.cpkKm = s.km ? s.totalKm / s.km : null;
  return s;
}

/** Rows grouped by `key` (e.g. "busId", "company") → [[value, rows]], sorted by value. */
export function groupRows(rows, key) {
  const m = new Map();
  for (const r of rows) { const k = r[key] || "—"; if (!m.has(k)) m.set(k, []); m.get(k).push(r); }
  return [...m.entries()].sort(([a], [b]) => String(a).localeCompare(String(b)));
}

/* ---- what every cost is: one place for the page and the spreadsheet ---- */
export function costExplainers(wd) {
  return [
    { key: "cph", title: "Cost per head", what: "What it costs the company to bring one person to work for a day.",
      how: "Total cost of the buses for the period ÷ the riders they carried in it. Shown both ways (by km and by diesel issued); the closer the two are, the more the diesel record and the GPS km agree." },
    { key: "two-ways", title: "Two totals: by km and by diesel issued", what: "Diesel is the one cost that changes with how far a bus drives, so it is worked out two independent ways.",
      how: "By km prices the kilometres the bus actually drove. By diesel issued uses what the ERP filled into the bus. Every other cost is the same in both totals." },
    { key: "dieselKm", title: "Diesel — by km travelled", what: "The diesel the bus should have burnt for the distance it drove.",
      how: `Km driven ÷ the bus's mileage (km per litre, from the ERP; ${FALLBACK_KMPL.toFixed(1)} km/L when the ERP has none) × that day's diesel price from the ERP (₹${DIESEL_PER_LITRE}/L when no price is known yet). The km comes from the bus attendance app's GPS (its leaders' Start/End journey, all trips of the day added up); on a day the app did not record, the finalised plan's route km stands in, marked "Plan".` },
    { key: "dieselIssued", title: "Diesel — as issued", what: "The diesel the ERP actually filled into the bus (DieselDetails).",
      how: `A fill tops up what was burnt since the previous fill, so its litres and cost are spread evenly over the days since then (at most ${MAX_SPREAD_DAYS} days back). For the days after a bus's latest fill, its own average over the last ${RECENT_DAYS} days stands in for up to ${ESTIMATE_DAYS} days ("ERP average"), until the next fill replaces it.` },
    { key: "hire", title: "Hire (rented buses)", what: "A rented bus is paid a day tariff; its owner buys the diesel and pays its other costs.",
      how: "Up to 80 km a day ₹1,700; 80–95 km ₹1,900; over 95 km ₹18.70 per km. Priced on the GPS km, or the finalised plan's own figure on a day the app did not record. The same in both totals; a rented bus has no standing costs here." },
    { key: "standing", title: "Standing costs (owned buses)", what: "What an owned bus costs just by being on the road, whether it drives 10 km or 100.",
      how: `From the ERP's costing feed for the financial year, per bus: road tax, insurance, FC work (the yearly fitness certificate), outside services and repairs, RTO expenses, tyres (count × price) and AdBlue (litres × price). A yearly amount becomes a daily one by dividing by the working days in the year (${wd} — Settings → Working days, minus declared holidays); a monthly amount is × 12 first. The daily figure is the same every working day.` },
    { key: "taxes", title: "Road tax", what: "The vehicle's road tax for the year.", how: "ERP head ROAD TAX, yearly, spread over working days." },
    { key: "insurance", title: "Insurance", what: "The vehicle's insurance for the year.", how: "ERP head VEHICLE INSURANCE, yearly, spread over working days." },
    { key: "fc", title: "FC works", what: "Work to pass the yearly fitness certificate (FC).", how: "ERP head FC WORK, yearly, spread over working days." },
    { key: "maint", title: "Maintenance", what: "Repairs and services done outside.", how: "ERP head VEHICLE OUTSIDE SERVICES over the year, spread over working days." },
    { key: "rto", title: "RTO expense", what: "Transport office fees: permits, registration and the like.", how: "ERP head RTO EXPENSE, yearly, spread over working days." },
    { key: "tires", title: "Tyres", what: "Tyres bought for the bus in the year.", how: "ERP head TYRE: number of tyres × price, spread over working days." },
    { key: "adblue", title: "AdBlue", what: "The exhaust fluid diesel buses need.", how: "ERP head ADBLU: litres × price over the year, spread over working days." },
    { key: "driver", title: "Driver salary", what: "The driver's pay.", how: "Counted only where it is entered on a bus's cost card; the ERP costing feed does not carry it yet." },
    { key: "riders", title: "Riders", what: "People who came on the bus that day.", how: "From the ERP's attendance punches for the employees mapped to the bus." },
  ];
}

/* ---- the spreadsheet ---- */
const r2 = (n) => (n == null ? null : Math.round(n * 100) / 100);

/** Builds the .xlsx: Totals, Summary by bus, Bus by day, How costs work. Returns the workbook. */
export function costWorkbook({ rows, heads, period, wd, headNames }) {
  const name = (h) => headNames[h] || h;
  const money = ["Hire", "Diesel by km", "Diesel issued", ...heads.map(name), "Standing total", "Total by km", "Total by diesel issued"];
  const moneyOf = (x) => [r2(x.hire), r2(x.dieselKm), r2(x.dieselIssued), ...heads.map((h) => r2(x.standing[h] || 0)), r2(x.standingTotal), r2(x.totalKm), r2(x.totalDiesel)];

  // Totals: the fleet and each company
  const all = sumRows(rows, heads);
  const totals = [[`Fleet costs — ${period.label}`], [`${period.from} to ${period.to} · ${all.days} day(s) with data · working days/year ${wd}`], [],
    ["Scope", "Buses", "Riders", "Km", ...money, "Cost per head (by km)", "Cost per head (by diesel)"]];
  const line = (label, x, buses) => [label, buses, x.riders, r2(x.km), ...moneyOf(x), r2(x.cphKm), r2(x.cphDiesel)];
  totals.push(line("Whole fleet", all, new Set(rows.map((r) => r.busId)).size));
  for (const [c, rs] of groupRows(rows, "company")) totals.push(line(c, sumRows(rs, heads), new Set(rs.map((r) => r.busId)).size));
  totals.push([], ["All amounts in ₹. \"Diesel issued\" is blank where the ERP's diesel feed had not loaded. See the sheet \"How costs work\"."]);

  // Summary by bus
  const summary = [["Bus", "Company", "Owned / hired", "Seats", "Days", "Riders", "Km", ...money, "Cost per head (by km)", "Cost per head (by diesel)"]];
  for (const [busId, rs] of groupRows(rows, "busId")) {
    const x = sumRows(rs, heads), r0 = rs[0];
    summary.push([busId, r0.company, r0.kind, r0.seats, x.days, x.riders, r2(x.km), ...moneyOf(x), r2(x.cphKm), r2(x.cphDiesel)]);
  }

  // Bus by day
  const detail = [["Date", "Bus", "Company", "Owned / hired", "Seats", "Riders", "Km", "Km from", "Hire", "Diesel by km", "Diesel by km (litres)", "Diesel issued", "Diesel issued (litres)", "Diesel issued from",
    ...heads.map(name), "Standing total", "Total by km", "Total by diesel issued", "Cost per head (by km)", "Cost per head (by diesel)"]];
  for (const r of [...rows].sort((a, b) => a.date.localeCompare(b.date) || a.busId.localeCompare(b.busId))) {
    detail.push([r.date, r.busId, r.company, r.kind, r.seats, r.riders, r2(r.km), r.kmSource, r2(r.hire), r2(r.dieselKm), r2(r.dieselKmLitres), r2(r.dieselIssued), r2(r.dieselIssuedLitres), r.dieselIssuedSource,
      ...heads.map((h) => r2(r.standing[h] || 0)), r2(r.standingTotal), r2(r.totalKm), r2(r.totalDiesel),
      r.riders ? r2(r.totalKm / r.riders) : null, r.riders && r.totalDiesel != null ? r2(r.totalDiesel / r.riders) : null]);
  }

  // How costs work
  const how = [["How every cost is worked out"], [], ["Cost", "What it is", "How it is worked out"],
    ...costExplainers(wd).map((e) => [e.title, e.what, e.how])];

  const wb = XLSX.utils.book_new();
  const sheet = (aoa, widths) => { const ws = XLSX.utils.aoa_to_sheet(aoa); ws["!cols"] = widths.map((w) => ({ wch: w })); return ws; };
  const wide = (n, first) => [...first, ...Array(n).fill(14)];
  XLSX.utils.book_append_sheet(wb, sheet(totals, wide(totals[3].length - 1, [22])), "Totals");
  XLSX.utils.book_append_sheet(wb, sheet(summary, wide(summary[0].length - 3, [14, 18, 13])), "Summary by bus");
  XLSX.utils.book_append_sheet(wb, sheet(detail, wide(detail[0].length - 4, [12, 14, 18, 13])), "Bus by day");
  XLSX.utils.book_append_sheet(wb, sheet(how, [30, 60, 110]), "How costs work");
  return wb;
}

/** Writes the workbook as a download. */
export function downloadCosts(args) {
  XLSX.writeFile(costWorkbook(args), `fleet-costs-${args.period.file}.xlsx`);
}
