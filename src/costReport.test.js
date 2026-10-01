/* costReport tests — run with:  node src/costReport.test.js
 *
 * What the Costs page and its export promise: the right days for a day / week / month, every cost head
 * counted once per bus-day, both totals, cost per head over people carried, an unknown diesel figure
 * kept unknown rather than shown as a low total, and a workbook with the four sheets. */
import {
  periodRange, shiftPeriod, latestDate, datesIn, costRows, sumRows, groupRows, costWorkbook,
  costHeadNames, companyTotals, busCount, costLines, shareOf,
} from "./costReport.js";

let pass = 0, fail = 0;
const ok = (cond, label, detail = "") => { if (cond) pass++; else { fail++; console.log(`  FAIL: ${label}${detail ? " — " + detail : ""}`); } };
const near = (a, b) => Math.abs(a - b) < 1e-6;

/* ---- periods ---- */
{
  const d = periodRange("day", "2026-10-01");
  ok(d.from === "2026-10-01" && d.to === "2026-10-01", "a day is itself");
  const w = periodRange("week", "2026-10-01"); // a Thursday
  ok(w.from === "2026-09-28" && w.to === "2026-10-04", "a week runs Monday to Sunday", `${w.from}..${w.to}`);
  ok(periodRange("week", "2026-10-04").from === "2026-09-28", "Sunday belongs to the week before it starts");
  const m = periodRange("month", "2026-02-14");
  ok(m.from === "2026-02-01" && m.to === "2026-02-28", "a month is its calendar month", `${m.from}..${m.to}`);
  ok(shiftPeriod("2026-01-31", "month", 1) === "2026-02-01" && shiftPeriod("2026-03-15", "month", -1) === "2026-02-01", "a month step lands on the 1st");
  ok(shiftPeriod("2026-10-01", "week", -1) === "2026-09-24" && shiftPeriod("2026-12-31", "day", 1) === "2027-01-01", "week and day steps");
  ok(latestDate(["2026-09-01", "2026-09-30"]) === "2026-09-30", "opens on the latest date with data");
  ok(datesIn(["2026-08-31", "2026-09-01", "2026-09-30", "2026-10-01"], periodRange("month", "2026-09-10")).join() === "2026-09-01,2026-09-30", "only the dates inside the period");
}

/* ---- rows and sums ---- */
{
  const buses = [{ id: "OWN1", unit: "Gainup", capacity: 50 }, { id: "HIRE1", unit: "Zenwear", capacity: 20 }];
  const busCosts = { OWN1: { lines: [{ type: "taxes", amount: 31200, period: "year" }, { type: "insurance", amount: 62400, period: "year" }] } };
  const own = (date, km, issued) => ({ busId: "OWN1", date, day: { km, source: "gps" }, cost: { hired: false, byKm: { amount: km * 18, litres: km / 5 }, byDiesel: issued == null ? null : { amount: issued, litres: issued / 100, source: "issued" } } });
  const hire = (date) => ({ busId: "HIRE1", date, day: { km: 70, source: "plan" }, cost: { hired: true, byKm: { amount: 1700 }, byDiesel: { amount: 1700 } } });
  const records = [own("2026-10-01", 100, 1500), hire("2026-10-01"), own("2026-10-02", 50, null)];
  const riders = (busId, date) => (busId === "OWN1" ? 40 : date === "2026-10-01" ? 18 : 0);
  const { rows, heads } = costRows({ buses, records, busCosts, wd: 312, dates: ["2026-10-01", "2026-10-02"], riders });
  ok(rows.length === 3, "one row per bus-day with data", String(rows.length));
  ok(heads.join() === "taxes,insurance", "standing heads in the dashboard's order", heads.join());
  const r1 = rows.find((r) => r.busId === "OWN1" && r.date === "2026-10-01");
  ok(near(r1.standing.taxes, 100) && near(r1.standing.insurance, 200), "yearly amounts spread over 312 working days");
  ok(near(r1.totalKm, 300 + 1800) && near(r1.totalDiesel, 300 + 1500), "both totals add standing to that day's diesel");
  const h = rows.find((r) => r.busId === "HIRE1");
  ok(h.kind === "Hired" && h.hire === 1700 && h.dieselKm === 0 && h.totalKm === 1700 && h.totalDiesel === 1700, "a hired bus is its tariff both ways");

  const day1 = sumRows(rows.filter((r) => r.date === "2026-10-01"), heads);
  ok(near(day1.totalKm, 2100 + 1700) && near(day1.totalDiesel, 1800 + 1700), "a day's fleet totals");
  ok(near(day1.cphKm, 3800 / 58), "cost per head = total ÷ people carried", String(day1.cphKm));
  const both = sumRows(rows, heads);
  ok(both.totalDiesel === null && both.cphDiesel === null && both.dieselMissing, "a day without diesel figures keeps the diesel total unknown");
  ok(near(both.totalKm, 3800 + 300 + 900) && both.days === 2 && both.riders === 98, "the period adds every bus-day");
  ok(groupRows(rows, "company").map(([c]) => c).join() === "Gainup,Zenwear", "grouped by company");
  ok(near(day1.cpkDiesel, (1800 + 1700) / 170) && both.cpkDiesel === null, "cost per km by diesel, unknown while diesel is unknown");
  ok(busCount(rows) === 2, "buses covered");
  const cos = companyTotals(rows, heads);
  ok(cos.map((x) => `${x.c}:${x.buses}`).join() === "Gainup:1,Zenwear:1" && near(cos[1].s.totalKm, 1700), "company totals");
  ok(costHeadNames(busCosts).taxes === "Taxes" && costHeadNames(null) && !Object.keys(costHeadNames(null)).length, "head names from the cost profiles");

  const lines1 = costLines(day1, heads, { taxes: "Taxes", insurance: "Insurance" }, (n) => String(Math.round(n)));
  ok(lines1.map((l) => l.key).join() === "dieselKm,dieselIssued,hire,taxes,insurance", "cost lines in page order", lines1.map((l) => l.key).join());
  ok(lines1[0].sub === "20 L" && lines1[1].alt && lines1[3].label === "Taxes", "litres, the alternative diesel line, head names");
  const linesAll = costLines(both, heads, {}, String);
  ok(linesAll[1].amount === null && linesAll[1].sub === "diesel feed not loaded for every day", "an unknown diesel line stays, marked");
  ok(!costLines({ ...day1, hire: 0 }, heads, {}, String).some((l) => l.key === "hire"), "an empty line is left out");
  ok(shareOf(25, 200) === "12.5%" && shareOf(1, 3) === "33.3%" && shareOf(null, 5) === "—" && shareOf(5, 0) === "—", "shares to one decimal");

  const wb = costWorkbook({ rows, heads, period: periodRange("week", "2026-10-01"), wd: 312, headNames: { taxes: "Taxes", insurance: "Insurance" } });
  ok(wb.SheetNames.join("|") === "Totals|Summary by bus|Bus by day|How costs work", "workbook sheets", wb.SheetNames.join("|"));
  const detail = wb.Sheets["Bus by day"];
  ok(detail.A1.v === "Date" && detail.B2.v === "HIRE1" && detail.A4.v === "2026-10-02", "bus-by-day sheet sorted by date then bus");
}

console.log(`costReport tests: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
