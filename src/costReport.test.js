/* costReport tests — run with:  node src/costReport.test.js
 *
 * What the Costs page and its export promise: the right days for a day / week / month, every cost head
 * counted once per bus-day, both totals, cost per head over people carried, an unknown diesel figure
 * kept unknown rather than shown as a low total, and a workbook with the four sheets. */
import { periodRange, costRows, sumRows, groupRows, costWorkbook } from "./costReport.js";

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

  const wb = costWorkbook({ rows, heads, period: periodRange("week", "2026-10-01"), wd: 312, headNames: { taxes: "Taxes", insurance: "Insurance" } });
  ok(wb.SheetNames.join("|") === "Totals|Summary by bus|Bus by day|How costs work", "workbook sheets", wb.SheetNames.join("|"));
  const detail = wb.Sheets["Bus by day"];
  ok(detail.A1.v === "Date" && detail.B2.v === "HIRE1" && detail.A4.v === "2026-10-02", "bus-by-day sheet sorted by date then bus");
}

console.log(`costReport tests: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
