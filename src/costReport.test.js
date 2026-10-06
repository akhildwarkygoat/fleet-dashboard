/* costReport tests — run with:  node src/costReport.test.js
 *
 * What the Costs page and its export promise: the right days for a day / week / month, with today left
 * out of a week or a month and out of the file; standing costs only on a day a bus worked; a rented van
 * with no plan run and no GPS left blank and out of the cost per head; diesel by km standing in where
 * no fill is on record, and said so; every planned run that did not run counted; every sum agreeing
 * to the paisa on every sheet; one name per cost; and a workbook with real dates, ₹ in Indian
 * grouping, columns wide enough for their figures, and explanations that match the code.
 * The records are built by dailyCost.js busDay, as the dashboard builds them. */
import XLSX from "xlsx-js-style"; // the CommonJS build in Node: its default export carries SSF
import {
  periodRange, shiftPeriod, latestDate, datesIn, datesShown, datesText, costRows, sumRows, groupRows, costWorkbook,
  costHeadNames, companyTotals, busTotals, busCount, costLines, shareOf, costExplainers, explainersFor, noRouteVehicles,
  NO_FILL, NOT_PRICED, NO_COMPANY, RIDER_CHECK, XL,
} from "./costReport.js";
import { busDay, ratesOn, FALLBACK_KMPL } from "./dailyCost.js";
import { rentTariff } from "./optimiser/engine.js";

let pass = 0, fail = 0;
const ok = (cond, label, detail = "") => { if (cond) pass++; else { fail++; console.log(`  FAIL: ${label}${detail ? " — " + detail : ""}`); } };
const near = (a, b, e = 1e-6) => a != null && b != null && Math.abs(a - b) < e;
const paise = (a, b) => near(a, b, 0.001);

/* ---- periods and dates ---- */
{
  const d = periodRange("day", "2026-10-01");
  ok(d.from === "2026-10-01" && d.to === "2026-10-01" && d.kind === "day", "a day is itself");
  const w = periodRange("week", "2026-10-01"); // a Thursday
  ok(w.from === "2026-09-28" && w.to === "2026-10-04", "a week runs Monday to Sunday", `${w.from}..${w.to}`);
  ok(periodRange("week", "2026-10-04").from === "2026-09-28", "Sunday belongs to the week before it starts");
  const m = periodRange("month", "2026-02-14");
  ok(m.from === "2026-02-01" && m.to === "2026-02-28", "a month is its calendar month", `${m.from}..${m.to}`);
  ok(shiftPeriod("2026-01-31", "month", 1) === "2026-02-01" && shiftPeriod("2026-03-15", "month", -1) === "2026-02-01", "a month step lands on the 1st");
  ok(shiftPeriod("2026-10-01", "week", -1) === "2026-09-24" && shiftPeriod("2026-12-31", "day", 1) === "2027-01-01", "week and day steps");
  ok(latestDate(["2026-09-01", "2026-09-30"]) === "2026-09-30", "opens on the latest date with data");
  ok(datesIn(["2026-08-31", "2026-09-01", "2026-09-30", "2026-10-01"], periodRange("month", "2026-09-10")).join() === "2026-09-01,2026-09-30", "only the dates inside the period");

  const dates = ["2026-10-01", "2026-10-02", "2026-10-05"];
  ok(datesShown(dates, periodRange("month", "2026-10-05"), "2026-10-05").join() === "2026-10-01,2026-10-02", "a month leaves today out");
  ok(datesShown(dates, periodRange("week", "2026-10-05"), "2026-10-05").length === 0, "a week of only today has nothing finished");
  ok(datesShown(dates, periodRange("day", "2026-10-05"), "2026-10-05").join() === "2026-10-05", "today's own Day view shows it");
  ok(datesShown(dates, periodRange("month", "2026-10-05"), "2026-10-06").length === 3, "once the day is over it counts");

  ok(datesText("2026-10-01", "2026-10-04") === "1 to 4 Oct 2026", "real dates in one month", datesText("2026-10-01", "2026-10-04"));
  ok(datesText("2026-09-28", "2026-10-04") === "28 Sep to 4 Oct 2026" && datesText("2026-12-30", "2027-01-02") === "30 Dec 2026 to 2 Jan 2027", "across months and years");
  ok(datesText("2026-10-04", "2026-10-04") === "4 Oct 2026", "one day");
}

/* ---- a week of a small fleet, as the dashboard records it ----
   OWN1   owned, 9 am + Rotational runs; its one fill is on 1 Oct, so 2 and 4 Oct take its ERP average
   HIRE1  rented, two Zenwear runs a day: paid one tariff on the day's km; Zenwear is off on 2 Oct
   VAN1   rented, carries riders, in no plan and no GPS: not priced
   GHOST  "owned" only by the plan's default (no ERP type, no costs), no seats, ERP maps few riders
   PLAN1  in the 9 am plan with ERP costs, but no rider mapped (no company)
   SPARE  ERP costs, on no route */
const WEEK = "2026-09-28", TODAY = "2026-10-05";
const weeks = (runs) => {
  const day = { km: runs.reduce((s, r) => s + r.km, 0), type: runs[0].type, runs };
  return { [WEEK]: day, [TODAY]: day };
};
const buses = [
  { id: "OWN1", unit: "Gainup", capacity: 50, type: "Owned", mileage: 5,
    planWeeks: weeks([{ service: "s9", km: 60, riders: 40, type: "own" }, { service: "rot-day", km: 40, riders: 30, type: "own" }]) },
  { id: "HIRE1", unit: "Zenwear", capacity: 20, type: "RENT VEHICLE",
    planWeeks: weeks([{ service: "zen", km: 60, riders: 18, type: "rent" }, { service: "zen", km: 50, riders: 15, type: "rent" }]) },
  { id: "VAN1", unit: "Technotek", capacity: 20, type: "RENT VEHICLE" },
  { id: "GHOST", unit: "Gainup", capacity: 0, type: "", planType: "own",
    planWeeks: weeks([{ service: "s9", km: 50, riders: 40, type: "own" }]) },
  { id: "PLAN1", unit: "", capacity: 0, type: "", mileage: 0, planOnly: true,
    planWeeks: weeks([{ service: "s9", km: 30, riders: 25, type: "own" }]) },
];
const busCosts = {
  OWN1: { lines: [{ type: "taxes", amount: 12500, period: "year" }, { type: "insurance", amount: 62400, period: "year" }] },
  PLAN1: { lines: [{ type: "taxes", amount: 31200, period: "year" }] },
  SPARE: { lines: [{ type: "insurance", amount: 62400, period: "year" }] },
};
const RIDERS = {
  OWN1: { "2026-10-01": 65, "2026-10-02": 60, "2026-10-04": 25, [TODAY]: 30 },
  HIRE1: { "2026-10-01": 18, "2026-10-02": 2, [TODAY]: 9 },
  VAN1: { "2026-10-01": 24, "2026-10-02": 20 },
  GHOST: { "2026-10-01": 5 },
};
const riders = (busId, date) => (RIDERS[busId] && RIDERS[busId][date]) || 0;
const DATES = ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", TODAY];
// 2 Oct: Zenwear off; 3 Oct: nobody; Sunday 4 Oct: only the Rotational shifts
const ranOn = (svc, date) => (date === "2026-10-03" ? false : date === "2026-10-04" ? svc.startsWith("rot-") : date === "2026-10-02" ? svc !== "zen" : true);
const diesel = { issues: { OWN1: [["2026-10-01", 20, 2000]] }, prices: [["2026-09-01", 100]] };
const recordsOf = (run) => buses.flatMap((b) => DATES.map((date) => {
  const fig = busDay(b, date, ratesOn(busCosts[b.id], date, 312), run);
  return fig && { busId: b.id, date, ...fig };
})).filter(Boolean);
const run = { diesel, ranOn, ridersCame: () => true, ridersOn: riders };
const records = recordsOf(run);
const week = periodRange("week", "2026-10-01");
const { rows, heads, missed } = costRows({ buses, records, busCosts, dates: datesShown(DATES, week, TODAY), riders });
const row = (busId, date) => rows.find((r) => r.busId === busId && r.date === date);

/* ---- rows ---- */
{
  ok(!rows.some((r) => r.date === TODAY), "today is not in the week's rows");
  ok(heads.join() === "taxes,insurance", "standing heads in the dashboard's order", heads.join());

  const thu = row("OWN1", "2026-10-01");
  ok(thu.worked && thu.standing.taxes === 40.06 && thu.standing.insurance === 200 && thu.standingTotal === 240.06, "standing split by head, rounded to the paisa once");
  ok(thu.km === 100 && thu.kmSource === "Plan" && thu.runs === 2 && thu.plannedRiders === 70, "every run that ran, its km and planned riders");
  ok(thu.dieselKm === 2000 && thu.dieselIssued === 2000 && thu.dieselIssuedSource === "ERP issue" && thu.totalKm === 2240.06 && thu.totalDiesel === 2240.06, "both totals add standing to that day's diesel");

  const fri = row("OWN1", "2026-10-02");
  ok(fri.dieselIssuedSource === "ERP average" && fri.dieselIssued === 2000, "after the latest fill: its ERP average");

  const sun = row("OWN1", "2026-10-04");
  ok(sun.km === 40 && sun.runs === 1 && sun.skipped === 1 && sun.standingTotal === 240.06 && /1 planned run did not run/.test(sun.note), "Sunday: only the Rotational run, standing charged since the bus worked", sun.note);
  ok(!row("HIRE1", "2026-10-03") && !row("GHOST", "2026-10-03"), "a day nothing ran and nobody came: no row");
  const sat = row("OWN1", "2026-10-03");
  ok(sat && !sat.worked && sat.standingTotal === 0 && sat.km === 0 && sat.dieselIssuedSource === "ERP average" && sat.totalDiesel === 2000 && sat.skipped === 2
    && /only diesel as issued/.test(sat.note), "a day it did not run: no standing, only its ERP average as issued", sat && sat.note);
  ok(!row("PLAN1", "2026-10-04"), "a 9 am bus on Sunday: no km, no standing, no row");

  const hire = row("HIRE1", "2026-10-01");
  ok(hire.kind === "Hired" && hire.hire === rentTariff(110) && hire.hire < 2 * 1700 && hire.dieselKm === 0 && hire.totalKm === hire.hire && hire.totalDiesel === hire.hire,
    "a rented bus is one day tariff on the day's total km, both ways", String(hire.hire));
  const hireOff = row("HIRE1", "2026-10-02");
  ok(hireOff && hireOff.riders === 2 && hireOff.totalKm === 0 && hireOff.priced && /services were off/.test(hireOff.note), "its service off: no hire, the stray riders kept", hireOff && hireOff.note);
  ok(hireOff.kind === "Hired" && hireOff.runs === 0 && hireOff.skipped === 2, "...both its planned runs counted as not run, none as run", `${hireOff.runs} ${hireOff.skipped}`);
  ok(missed.length === 6 && missed.reduce((s, m) => s + m.runs, 0) === 8 && missed.some((m) => m.busId === "GHOST" && m.date === "2026-10-04"),
    "bus-days with no row whose planned runs did not run are kept for the totals", JSON.stringify(missed.map((m) => `${m.busId} ${m.date} ${m.runs}`)));

  const van = row("VAN1", "2026-10-01");
  ok(van.kind === "Hired" && van.priced === false && van.totalKm === null && van.hire === null && van.km === null && van.note === NOT_PRICED, "a van with no plan run and no GPS: Hired, blank, noted");

  const ghost = row("GHOST", "2026-10-01");
  ok(ghost.kind === "Owned?" && ghost.seats === null && ghost.standingTotal === 0, "owned only by the plan's default: Owned?, seats blank");
  ok(near(ghost.dieselKm, Math.round((50 / FALLBACK_KMPL) * 100 * 100) / 100) && ghost.dieselIssuedSource === NO_FILL
    && ghost.dieselIssued === ghost.dieselKm && ghost.dieselIssuedLitres === ghost.dieselKmLitres, "...and no fill on record: diesel by km stands in, and says so");
  ok(row("OWN1", "2026-10-01").kind === "Owned", "an ERP-owned bus is Owned");

  const plan1 = row("PLAN1", "2026-10-01");
  ok(plan1 && plan1.company === "" && plan1.kind === "Owned" && plan1.standingTotal === 100 && /no riders mapped/.test(plan1.note), "a bus only the plan names is costed, with no company");
}

/* ---- sums ---- */
{
  const all = sumRows(rows, heads);
  const sumOf = (k) => Math.round(rows.reduce((s, r) => s + (r[k] || 0), 0) * 100) / 100;
  ok(all.totalKm === sumOf("totalKm") && all.totalDiesel === sumOf("totalDiesel") && all.standingTotal === sumOf("standingTotal"), "the totals are the rows added up, to the paisa");
  ok(all.standing.taxes === 320.18 && all.standing.insurance === 600, "standing only on the days each bus worked", `${all.standing.taxes} ${all.standing.insurance}`);
  ok(all.unpricedRiders === 44 && all.unpricedBuses === 1 && all.unpricedBusDays === 2 && all.pricedRiders === all.riders - 44, "riders on the unpriced van counted apart");
  ok(near(all.cphKm, all.totalKm / all.pricedRiders) && all.cphKm > all.totalKm / all.riders, "cost per head is over priced riders only", String(all.cphKm));
  ok(all.standInDays === 4 && all.standInBuses === 2 && all.fillDays === 1 && all.averageDays === 3 && paise(all.dieselFill + all.dieselAverage + all.dieselStandIn, all.dieselIssued),
    "diesel as issued is fills + ERP average + by km stand-in", `${all.standInDays} ${all.standInBuses} ${all.fillDays} ${all.averageDays}`);
  ok(all.skippedRuns === 5, "planned runs that did not run are counted, on rows with no record too", String(all.skippedRuns));
  ok(all.days === 4 && all.daysRun === rows.filter((r) => r.worked).length && all.daysRun === 10, "days with data and bus-days run", `${all.days} ${all.daysRun}`);
  const byCompany = companyTotals(rows, heads);
  ok(paise(byCompany.reduce((s, c) => s + c.s.totalKm, 0), all.totalKm) && paise(byCompany.reduce((s, c) => s + c.s.totalDiesel, 0), all.totalDiesel), "the companies add up to the fleet");
  ok(paise(busTotals(rows, heads).reduce((s, b) => s + b.s.totalKm, 0), all.totalKm), "the buses add up to the fleet");
  ok(groupRows(rows, "company").map(([c]) => c).join() === "—,Gainup,Technotek,Zenwear", "grouped by company", groupRows(rows, "company").map(([c]) => c).join());
  ok(busCount(rows) === 5, "buses covered", String(busCount(rows)));

  const perBus = Object.fromEntries(busTotals(rows, heads).map((b) => [b.id, b.s]));
  ok(/Not reliable/.test(perBus.GHOST.check) && !perBus.OWN1.check, "a bus the ERP maps far fewer riders to than its plan: not reliable");
  ok(perBus.OWN1.daysRun === 3 && near(perBus.OWN1.avgRiders, 50) && near(perBus.OWN1.plannedRidersADay, (70 + 70 + 30) / 3), "days run, riders a day and planned riders a day");
  ok(perBus.VAN1.cphKm === null && perBus.VAN1.totalKm === 0, "an unpriced bus has no cost per head");

  const noFeed = costRows({ buses, records: recordsOf({ ...run, diesel: null }), busCosts, dates: ["2026-10-01"], riders });
  const nf = sumRows(noFeed.rows, noFeed.heads);
  ok(nf.dieselMissing && nf.totalDiesel === null && nf.cphDiesel === null && nf.cpkDiesel === null && nf.dieselIssued === null, "diesel feed not loaded: the diesel total stays unknown");

  ok(costHeadNames(busCosts).taxes === "Road tax" && !Object.keys(costHeadNames(null)).length, "head names: one name per cost");
  const lines = costLines(all, heads, costHeadNames(busCosts), (n) => String(Math.round(n)));
  ok(lines.map((l) => l.key).join() === "dieselKm,dieselIssued,hire,taxes,insurance", "cost lines in page order", lines.map((l) => l.key).join());
  const explain = Object.fromEntries(costExplainers(312).map((e) => [e.key, e]));
  ok(lines.every((l) => l.label === explain[l.key].title), "each cost line is named as its explainer", lines.map((l) => l.label).join("|"));
  ok(lines[1].alt && /by km, no fill on record/.test(lines[1].sub) && lines[0].sub.endsWith(" L"), "diesel as issued says how much of it is by km", lines[1].sub);
  ok(costLines(nf, noFeed.heads, {}, String)[1].sub === "diesel feed not loaded for every day", "an unknown diesel line stays, marked");
  ok(shareOf(25, 200) === "12.5%" && shareOf(1, 3) === "33.3%" && shareOf(null, 5) === "—" && shareOf(5, 0) === "—", "shares to one decimal");

  const spare = noRouteVehicles(buses, busCosts, 312);
  ok(spare.length === 1 && spare[0].id === "SPARE" && spare[0].daily === 200, "owned vehicles with ERP costs on no route", JSON.stringify(spare));
}

/* ---- what the explanations say ---- */
{
  const ex = costExplainers(312);
  const text = ex.map((e) => `${e.title} ${e.what} ${e.how}`).join(" ");
  ok(!/—/.test(text), "no em dashes in the explanations");
  ok(!/financial year/i.test(text) && /last 12 months/.test(text), "standing costs: the last 12 months");
  ok(/one day tariff on the day's total km/.test(text) && /never less than ₹1,900/.test(text), "hire: one tariff a day, its ₹1,900 floor written down");
  ok(text.includes(FALLBACK_KMPL.toFixed(2) + " km/L"), "the fallback mileage as the code uses it");
  ok(/Not counted/.test(ex.find((e) => e.key === "driver").how), "driver salary: not counted");
  const page = explainersFor(312, ["taxes"]).map((e) => e.key);
  ok(page.includes("taxes") && !page.includes("insurance") && page.includes("driver") && !page.includes("seats"), "the page: only the heads present, driver kept, no column notes");
  ok(explainersFor(312, ["taxes"], { sheet: true }).some((e) => e.key === "seats"), "the sheet: its column notes too");
}

/* ---- the workbook ---- */
{
  const withToday = costRows({ buses, records, busCosts, dates: datesIn(DATES, week).concat(TODAY), riders });
  ok(withToday.rows.some((r) => r.date === TODAY), "(the rows handed over do hold today)");
  const wb = costWorkbook({ rows: withToday.rows, heads: withToday.heads, missed: withToday.missed, period: periodRange("month", "2026-10-01"), wd: 312,
    headNames: costHeadNames(busCosts), today: TODAY, holidays: [], noRoute: noRouteVehicles(buses, busCosts, 312),
    gps: { phase: "ok", at: new Date(2026, 9, 5, 10, 30).getTime() } });
  ok(wb.SheetNames.join("|") === "Costing sheet|Totals|Summary by bus|Bus by day|How costs work", "workbook sheets", wb.SheetNames.join("|"));
  const tot = wb.Sheets.Totals, detail = wb.Sheets["Bus by day"], summary = wb.Sheets["Summary by bus"], how = wb.Sheets["How costs work"];

  /* Costing sheet: the transport department's layout, the same money as the other tabs */
  {
    const cs = wb.Sheets["Costing sheet"], grid = XLSX.utils.sheet_to_json(cs, { header: 1, defval: null, raw: true });
    const fleet = XLSX.utils.sheet_to_json(tot, { range: 4, defval: null })[0];
    const rowOf = (label, c = 0) => grid.findIndex((r) => r[c] === label);
    const totals = grid[2].map((v, c) => (v === "TOTAL" ? c : -1)).filter((c) => c >= 0);
    const [oT, hT] = totals, cDate = grid[2].indexOf("DATE", 1);
    const at = (r, c) => grid[r][c];
    ok(cs.A1.v === "Company vehicle costing for the month of OCTOBER - 2026" && totals.length === 2 && cDate > oT,
      "Costing sheet: company vehicles on the left, contract vehicles on the right", `${cs.A1.v} ${totals}`);
    const dateCells = grid.slice(3).map((r) => r[0]).filter((v) => typeof v === "number");
    ok(dateCells.length === 4 && dateCells[0] === 46296 && dateCells[3] === 46299, "every calendar day up to yesterday, Sunday included, today left out", dateCells.join());
    ok(rowOf("Road tax") > 0 && rowOf("Insurance") > 0 && rowOf("Insurance & Taxes") < 0 && rowOf("Maintenance") < 0,
      "each kind of cost on its own row, named as on the other tabs");
    const ownCost = at(rowOf("Total Cost"), oT), hireCost = at(rowOf("Total hire", cDate), hT);
    ok(paise(ownCost + hireCost, fleet["Total by diesel issued"]), "company vehicles + contract hire = the total by diesel issued", `${ownCost} + ${hireCost} vs ${fleet["Total by diesel issued"]}`);
    ok(paise(at(rowOf("Road tax"), oT), fleet["Road tax"]) && paise(at(rowOf("Diesel cost"), oT), fleet["Diesel as issued"]), "each cost row's total = the Totals tab");
    ok(paise(at(rowOf("Total hire", cDate), hT), fleet["Hire (rented buses)"]), "the hire bills add up to the hire");
    const riders = at(rowOf("Total riders"), oT) + at(rowOf("Total riders", cDate), hT);
    ok(riders === fleet["Rider-days (people × days)"], "riders on the sheet = the rider-days", `${riders} ${fleet["Rider-days (people × days)"]}`);
    const overall = at(rowOf("OVERALL PER HEAD COST"), 1);
    ok(paise(overall, Math.round((ownCost + hireCost) / (riders - fleet["Rider-days not priced"]) * 100) / 100) || Math.abs(overall - (ownCost + hireCost) / (riders - 44)) < 0.01,
      "overall per head leaves the unpriced van's riders out", String(overall));
    ok(rowOf("Driver Salary") > 0 && at(rowOf("Driver Salary"), oT) === 0, "driver salary: a row, nothing in it");
    const ghostCol = grid[2].findIndex((v) => typeof v === "string" && v.startsWith("GHOST")), ownCol = grid[2].findIndex((v) => typeof v === "string" && v.startsWith("OWN1"));
    const headCell = (c) => cs[XLSX.utils.encode_cell({ r: rowOf("Per head a day (up & down)"), c })];
    ok(headCell(ghostCol).s.fill.fgColor.rgb === "FFC7CE" && headCell(ownCol).s.fill == null, "a per head the ERP mapping makes unreliable is red, the others are not");
    ok(grid.some((r) => typeof r[0] === "string" && /^Red per head \(\d+ bus(es)?\)/.test(r[0])), "the red is explained under the sheet");
    const paid = costWorkbook({ rows: withToday.rows, heads: withToday.heads, period: periodRange("month", "2026-10-01"), wd: 312, headNames: costHeadNames(busCosts), today: TODAY,
      busCosts: { ...busCosts, GHOST: { lines: [], history: [{ head: "FC WORK", from: "2025-03-01", amount: 9000 }, { head: "FC WORK", from: "2024-03-01", amount: 8000 }] } } }).Sheets["Costing sheet"];
    const fcCell = paid[XLSX.utils.encode_cell({ r: rowOf("FC works"), c: ghostCol })];
    ok(rowOf("FC works") > 0 && fcCell && fcCell.v === "Last paid Mar 2025", "a renewal not entered: the cell says when it was last paid", fcCell && fcCell.v);
    const vanCol = grid[2].findIndex((v) => typeof v === "string" && v.startsWith("VAN1"));
    const vanBill = cs[XLSX.utils.encode_cell({ r: rowOf("Total hire", cDate), c: vanCol })];
    ok(vanCol > hT - 99 && vanBill && !vanBill.f && vanBill.v === "", "an unbilled van's hire is an empty cell, not a SUM Excel would read as ₹0");
    ok(/SUMIF\([^)]*">0"/.test(cs[XLSX.utils.encode_cell({ r: rowOf("PER HEAD COST", cDate - 1), c: hT })].f), "contract per head counts riders only where there is a bill");
    ok(cs[XLSX.utils.encode_cell({ r: rowOf("Total Cost"), c: oT })].f && cs.A1.s && cs.A1.s.fill.fgColor.rgb === "FFFF00", "totals are formulas, and the sheet carries its look");
  }
  ok(tot.A1.v === "Fleet costs, 1 to 4 Oct 2026", "the title gives the real dates covered", tot.A1.v);
  ok(/4 Oct is a Sunday/.test(tot.A2.v) && /Today, 5 Oct, is left out until the day is over/.test(tot.A2.v) && !/—/.test(tot.A2.v), "the period line names the Sunday and today", tot.A2.v);
  ok(tot.A2.v.startsWith("4 days with data in October 2026, month to date.") && !/31 Oct/.test(tot.A2.v), "...and names the month, not its 1 to 31 span", tot.A2.v);

  const table = (ws, headerRow) => XLSX.utils.sheet_to_json(ws, { range: headerRow, defval: null });
  const days = table(detail, 0);
  ok(days.length === rows.length && !days.some((r) => r.Date === 46300), "the file leaves today out", `${days.length} vs ${rows.length}`);
  ok(detail.A2.t === "n" && detail.A2.v === 46296 && detail.A2.z === XL.date && XLSX.SSF.format(detail.A2.z, detail.A2.v) === "Thu 01-Oct-2026", "dates are real dates with the weekday");
  const H = (ws, name) => { const r = XLSX.utils.decode_range(ws["!ref"]); for (let c = 0; c <= r.e.c; c++) { const cell = ws[XLSX.utils.encode_cell({ r: 0, c })]; if (cell && cell.v === name) return c; } return -1; };
  const totalCol = H(detail, "Total by km");
  ok(detail[XLSX.utils.encode_cell({ r: 1, c: totalCol })].z === XL.money && XLSX.SSF.format(XL.money, 1106278.91) === "₹11,06,278.91" && XLSX.SSF.format(XL.money, 950) === "₹950.00",
    "money in ₹ with Indian grouping");
  const vanDay = days.find((r) => r.Bus === "VAN1");
  ok(vanDay["Total by km"] === null && vanDay["Hire (rented buses)"] === null && vanDay["Road tax"] === null && vanDay["Cost per head (by km)"] === null && vanDay.Note === NOT_PRICED, "an unpriced van's money is blank");
  ok(days.find((r) => r.Bus === "GHOST").Seats === null, "unknown seats are blank");
  ok(H(detail, "Road tax") > 0 && H(detail, "Diesel by km travelled") > 0 && H(detail, "Diesel as issued") > 0 && H(detail, "Taxes") < 0, "columns carry the one name per cost");

  const scopes = table(tot, 4).slice(0, 5);
  const fleet = scopes[0];
  ok(fleet.Scope === "Whole fleet" && scopes.slice(1).map((s) => s.Scope).join() === `Gainup,Technotek,Zenwear,${NO_COMPANY}`, "Totals: the fleet, each company, the plan-only buses last", scopes.map((s) => s.Scope).join());
  ok(days.filter((r) => r.Bus === "PLAN1").every((r) => r.Company === NO_COMPANY) && table(summary, 0).find((r) => r.Bus === "PLAN1").Company === NO_COMPANY,
    "the plan-only bus has the one name for its company on every sheet");
  const add = (list, k) => Math.round(list.reduce((s, r) => s + (r[k] || 0), 0) * 100) / 100;
  for (const k of ["Total by km", "Total by diesel issued", "Standing total", "Road tax", "Diesel as issued"]) {
    ok(paise(fleet[k], add(scopes.slice(1), k)) && paise(fleet[k], add(table(summary, 0), k)) && paise(fleet[k], add(days, k)), `${k}: Totals = companies = buses = days`, `${fleet[k]} ${add(days, k)}`);
  }
  const all = sumRows(rows, heads);
  ok(paise(fleet["Cost per head (by km)"], Math.round(all.cphKm * 100) / 100) && fleet["Rider-days not priced"] === 44, "cost per head leaves the unpriced riders out, and says how many");
  const notes = XLSX.utils.sheet_to_json(tot, { header: 1 }).map((r) => r[0]).filter((v) => typeof v === "string");
  ok(notes.some((n) => /^Diesel as issued, ₹.*no fill is on record/.test(n)), "Totals: how much of the diesel as issued is fills, average, by km");
  ok(notes.some((n) => /^Not priced: 1 rented bus on 2 bus-days carried 44 rider-days \(Technotek 44\)/.test(n)), "Totals: what was not priced, by company");
  ok(notes.some((n) => /^Owned vehicles with ERP costs but on no route: 1,/.test(n)) && notes.includes("SPARE") && !scopes.some((s) => s.Scope === "SPARE"), "owned vehicles on no route listed under the totals, not in them");
  ok(notes.some((n) => /^Km from: GPS on 0 bus-days, the plan on/.test(n) && n.endsWith("Bus attendance app: last pulled 5 Oct 2026, 10:30.")), "Totals: where the km came from, and the bus app's feed in words",
    notes.find((n) => /^Km from/.test(n)));
  ok(notes.includes("Planned runs that did not run, their service being off that day: 13. They cost nothing."), "Totals: every planned run that did not run, rows or not",
    notes.find((n) => /^Planned runs/.test(n)));

  const busRows = table(summary, 0);
  const ghost = busRows.find((r) => r.Bus === "GHOST");
  ok(ghost.Check === RIDER_CHECK && ghost["Owned / hired"] === "Owned?", "Summary: not reliable flag and Owned?");
  ok(ghost["Standing total"] === null && ghost["Road tax"] === null && ghost["Total by km"] > 0
    && days.filter((r) => r.Bus === "GHOST").every((r) => r["Standing total"] === null && r["Road tax"] === null), "an Owned? bus's standing costs are blank, not ₹0");
  ok(busRows.find((r) => r.Bus === "OWN1")["Days run"] === 3 && busRows.find((r) => r.Bus === "VAN1")["Total by km"] === null, "Summary: days run; an unpriced bus blank");

  const howRows = XLSX.utils.sheet_to_json(how, { header: 1 }).slice(3);
  const howCells = howRows.flat().filter((v) => typeof v === "string");
  ok(howCells.every((v) => !/—/.test(v)) && howRows.every((r) => r.length <= 2), "How costs work: two columns, no em dashes");
  ok(howRows.every((r) => !r[0] || r[0].length <= how["!cols"][0].wch) && howRows.every((r) => !r[1] || r[1].length <= how["!cols"][1].wch),
    "How costs work: no text longer than its column, so none is cut or runs off", String(Math.max(...howRows.map((r) => String(r[1] || "").length))));
  ok(howCells.includes("Road tax") && howCells.includes("Seats") && howCells.includes(NO_COMPANY) && !howCells.includes("AdBlue"), "How costs work: the heads present and the column notes");
  // the Note at the end of a row may run on into the empty cells beyond it; nothing else may
  const fits = (ws) => { const all = XLSX.utils.sheet_to_json(ws, { header: 1 }), last = all[0].length - 1;
    return all.every((r) => r.every((v, i) => i === last || v == null
      || ws["!cols"][i].wch >= String(typeof v === "number" ? v.toLocaleString("en-IN", { maximumFractionDigits: 2 }) : v).length)); };
  ok(fits(detail) && fits(summary), "no header, figure or text is wider than its column, but the last column's notes");
  const sheetWidth = (ws, name) => ws["!cols"][XLSX.utils.sheet_to_json(ws, { header: 1, range: ws === tot ? 4 : 0 })[0].indexOf(name)].wch;
  ok(sheetWidth(tot, "Road tax") >= XLSX.SSF.format(XL.money, fleet["Road tax"]).length && sheetWidth(summary, "Check") >= RIDER_CHECK.length,
    "Totals' money columns fit their figures, the Check column its text");
  const big = costWorkbook({ rows: [{ ...rows[0], standing: { taxes: 133337.36 }, standingTotal: 133337.36 }], heads: ["taxes"], period: week, wd: 312, headNames: {} });
  ok(big.Sheets.Totals["!cols"][14].wch >= "₹1,33,337.36".length + 1, "a lakh of road tax still fits its column", String(big.Sheets.Totals["!cols"][14].wch));

  const later = costWorkbook({ rows: [], heads: ["erp:parking"], period: week, wd: 312, headNames: { "erp:parking": "Parking" } });
  ok(later.Sheets.Totals.A2.v === "0 days with data in the week starting Monday 28 Sep 2026.", "a week's period line", later.Sheets.Totals.A2.v);
  ok(XLSX.utils.sheet_to_json(later.Sheets["How costs work"], { header: 1 }).some((r) => r[0] === "Parking"), "a head the ERP added later still gets a line");
  ok(later.Sheets.Totals.A1.v === "Fleet costs, no days with data", "an empty period says so");

  const back = XLSX.read(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }), { cellNF: true });
  ok(back.Sheets["Bus by day"].A2.z === XL.date && back.Sheets["Bus by day"][XLSX.utils.encode_cell({ r: 1, c: totalCol })].z === XL.money, "the formats survive writing the file");
}

console.log(`costReport tests: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
