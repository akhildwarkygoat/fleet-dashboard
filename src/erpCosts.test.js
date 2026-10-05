/* erpCosts tests — run with:  node src/erpCosts.test.js
 *
 * The cost year (erp.js mapErpCosts): the ERP costing lines whose period starts in the 12 months up
 * to the sync, so a bus's standing cost is a whole year's worth in any month, not the financial
 * year to date. */
import { mapErpCosts } from "./erp.js";
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
}

console.log(`erpCosts tests: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
