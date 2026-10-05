/* erpCosts tests — run with:  node src/erpCosts.test.js
 *
 * The cost year (erp.js mapErpCosts, costWindow, profileOn): the ERP costing lines whose period
 * starts in the 12 months up to a day, counted in calendar dates, so a bus's standing cost is a
 * whole year's worth in any month, not the financial year to date, and a past month is costed on
 * the year before it. */
import { mapErpCosts, costWindow, profileOn } from "./erp.js";
import { profileDailySpend } from "./costModel.js";

let pass = 0, fail = 0;
const ok = (cond, label, detail = "") => { if (cond) pass++; else { fail++; console.log(`  FAIL: ${label}${detail ? " — " + detail : ""}`); } };
const near = (a, b) => Math.abs(a - b) < 1e-6;

const line = (veh, head, from, to, amount, rate = amount) =>
  ({ Veh_Name: veh, Proj_Activity_Name: head, From_Date: `${from} 00:00:00`, To_Date: `${to} 00:00:00`, Pur_Amount: String(amount), Rate: String(rate), Period_Name: "" });
const asOf = new Date(2026, 9, 5, 15, 30).getTime();   // 5 Oct 2026, mid-afternoon
const rows = [
  // road tax, quarterly: the last four quarters are in, the one a year before is not
  line("TN57CA3434", "ROAD TAX", "01-10-2025", "31-12-2025", 32734),
  line("TN57CA3434", "ROAD TAX", "01-01-2026", "31-03-2026", 32734),
  line("TN57CA3434", "ROAD TAX", "01-04-2026", "30-06-2026", 32734),
  line("TN57CA3434", "ROAD TAX", "01-07-2026", "30-09-2026", 32734),
  line("TN57CA3434", "ROAD TAX", "01-10-2026", "31-12-2026", 32734),
  // FC work in January: last financial year, but inside the last 12 months
  line("TN57CA3434", "FC WORK", "01-01-2026", "31-01-2026", 42280),
  // insurance that started more than 12 months ago drops out until the renewal is entered
  line("TN57CA3434", "VEHICLE INSURANCE", "01-04-2025", "31-03-2026", 80000),
  // a planned line, not yet approved
  line("TN57CA3434", "TYRE", "01-08-2026", "31-08-2026", 0, 15000),
  // a period that has not started yet
  line("TN57CA3434", "RTO EXPENSE", "06-10-2026", "05-10-2027", 5000),
];

{
  const { profiles, meta } = mapErpCosts(rows, { asOf });
  const p = profiles.TN57CA3434;
  const amount = (type) => (p.lines.find((l) => l.type === type) || { amount: 0 }).amount;
  ok(meta.from === "2025-10-06" && meta.to === "2026-10-05" && !("fy" in meta), "the window is the 12 months to the sync", `${meta.from}..${meta.to}`);
  ok(amount("taxes") === 4 * 32734, "road tax: the last four quarters, a whole year", String(amount("taxes")));
  ok(amount("fc") === 42280, "a one-off from last financial year still counts inside the 12 months");
  ok(amount("insurance") === 0 && amount("rto") === 0, "a yearly line that started over a year ago, and one not started yet, are out");
  ok(meta.skippedUnapproved === 1 && meta.outsideWindow === 3, "unapproved and out-of-window lines are counted, not used", JSON.stringify(meta));
  ok(near(profileDailySpend(p, 312), (4 * 32734 + 42280) / 312), "the daily figure spreads the year over the working days");
  const midnight = mapErpCosts([line("X", "ROAD TAX", "06-10-2025", "05-01-2026", 100)], { asOf });
  ok(midnight.profiles.X && midnight.profiles.X.lines[0].amount === 100, "a line starting at midnight on the window's first day is in");
  ok(p.history.length === 8 && meta.vehicles === 1, "every approved line is kept for other days' windows; only the planned one is not");
  const old = mapErpCosts([line("Y", "ROAD TAX", "01-07-2024", "30-09-2024", 500)], { asOf });
  ok(old.profiles.Y && !old.profiles.Y.lines.length && old.meta.vehicles === 0, "a vehicle with lines only before the window: kept for past days, not counted as costed now");
}

/* ---- the window is a calendar year back, at month ends and over 29 February ---- */
{
  ok(costWindow("2028-06-30").from === "2027-07-01" && costWindow("2028-03-31").from === "2027-04-01", "a quarter end looks back to the day after it, a year before",
    `${costWindow("2028-06-30").from} ${costWindow("2028-03-31").from}`);
  ok(costWindow("2028-02-29").from === "2027-03-01" && costWindow("2028-03-01").from === "2027-03-02" && costWindow("2026-10-05").from === "2025-10-06", "29 February and an ordinary day");
  const quarters = ["01-07-2027", "01-10-2027", "01-01-2028", "01-04-2028"].map((q) => line("TN1", "ROAD TAX", q, q, 1000));
  const tax = (y, m, d) => mapErpCosts(quarters, { asOf: new Date(y, m, d, 15).getTime() }).profiles.TN1.lines.reduce((s, l) => s + l.amount, 0);
  ok(tax(2028, 5, 30) === 4000 && tax(2028, 6, 1) === 3000, "a sync on 30 Jun 2028 holds all four quarters; on 1 Jul the oldest drops out", `${tax(2028, 5, 30)} ${tax(2028, 6, 1)}`);
  const insured = mapErpCosts([line("TN2", "VEHICLE INSURANCE", "01-04-2027", "31-03-2028", 9000)], { asOf: new Date(2028, 2, 31, 15).getTime() });
  ok(insured.profiles.TN2.lines.length === 1, "a sync on 31 Mar 2028 keeps the yearly line dated 1 Apr 2027");
}

/* ---- a day's own 12 months ---- */
{
  const { profiles } = mapErpCosts([
    line("TN3", "ROAD TAX", "01-07-2025", "30-09-2025", 1000), line("TN3", "ROAD TAX", "01-10-2025", "31-12-2025", 1000),
    line("TN3", "FC WORK", "20-07-2026", "20-07-2026", 5000),
  ], { asOf });
  const p = profiles.TN3;
  const sum = (q) => q.lines.reduce((s, l) => s + l.amount, 0);
  ok(sum(profileOn(p, "2026-06-30")) === 2000 && sum(profileOn(p, "2026-07-19")) === 1000 && sum(profileOn(p, "2026-07-20")) === 6000,
    "July is costed on the year before it: the July quarter drops out on 1 Jul, the FC work comes in on its own day");
  ok(profileOn(p, "2026-06-30") === profileOn(p, "2026-06-29") && profileOn(null, "2026-06-30") === null, "the same lines fold once; no profile, nothing");
  ok(profileOn(p, "2026-07-20").lines.find((l) => l.type === "fc").detail[0].from === "2026-07-20", "each folded line keeps the ERP lines behind it");
}

console.log(`erpCosts tests: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
