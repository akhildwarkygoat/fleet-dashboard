/* dailyCost tests — run with:  node src/dailyCost.test.js
 *
 * The properties that matter: a diesel issue is never counted twice or lost (its litres,
 * spread over the days it refilled, add back up to what was issued); a day the bus app
 * recorded is costed on GPS km and one it did not falls back to plan km, saying so; and a
 * hired bus costs the same both ways. */
import { indexGps, priceOn, kmOn, dieselOn, variableCost, FALLBACK_KMPL, DIESEL_PER_LITRE, MAX_SPREAD_DAYS, ESTIMATE_DAYS } from "./dailyCost.js";
import { rentTariff } from "./optimiser/engine.js";

let pass = 0, fail = 0;
const ok = (cond, label, detail = "") => {
  if (cond) { pass++; } else { fail++; console.log(`  FAIL: ${label}${detail ? " — " + detail : ""}`); }
};
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;
const dates = (from, n) => Array.from({ length: n }, (_, i) => new Date(Date.parse(from + "T00:00:00Z") + i * 864e5).toISOString().slice(0, 10));

/* ---- km: GPS when the bus app recorded the day, plan otherwise ---- */
{
  const idx = indexGps([
    { serviceDate: "2026-09-28", busId: "TN57CL3434", km: 88.4, journeys: 3, active: 0 },
    { serviceDate: "2026-09-29", busId: "TN57CL3434", km: 30.1, journeys: 1, active: 0 },
    { serviceDate: "2026-09-30", busId: "TN57CL3434", km: 12.0, journeys: 1, active: 1 },
  ]);
  const bus = { id: "TN57 CL 3434", planKm: 92.2 };        // the ERP's own spacing still joins
  const d28 = kmOn(bus, "2026-09-28", idx, "2026-09-30");
  ok(d28.source === "gps" && d28.km === 88.4 && !d28.partial && !d28.inProgress, "recorded day: GPS km");
  const d29 = kmOn(bus, "2026-09-29", idx, "2026-09-30");
  ok(d29.partial, "finished day far under plan is flagged partial", JSON.stringify(d29));
  const d30 = kmOn(bus, "2026-09-30", idx, "2026-09-30");
  ok(d30.inProgress && !d30.partial, "today with a journey still out: in progress, not partial");
  const d27 = kmOn(bus, "2026-09-27", idx, "2026-09-30");
  ok(d27.source === "plan" && d27.km === 92.2, "unrecorded day falls back to plan km");
  ok(kmOn({ id: "X1" }, "2026-09-27", idx, null).source === null, "no GPS and no plan: no km");
  ok(kmOn(bus, "2026-09-27", null, null).source === "plan", "bus app not linked: plan km");
}

/* ---- price: the latest ERP price on or before the day ---- */
{
  const prices = [["2026-07-01", 100.36], ["2026-08-10", 100.67]];
  ok(priceOn(prices, "2026-06-30") === null, "no price before the first issue");
  ok(priceOn(prices, "2026-08-09").rate === 100.36, "price carries forward");
  ok(priceOn(prices, "2026-09-30").rate === 100.67 && priceOn(prices, "2026-09-30").date === "2026-08-10", "latest price and its date");
}

/* ---- diesel: an issue refills the days since the previous one ---- */
{
  const issues = [["2026-09-10", 50, 5000], ["2026-09-11", 60, 6000], ["2026-09-15", 100, 10000], ["2026-09-30", 140, 14000]];
  const one = dieselOn(issues, "2026-09-11");
  ok(one.source === "issued" && one.litres === 60 && one.issue.days === 1, "daily issue: the day's own litres");
  const spread = dates("2026-09-12", 4).map((d) => dieselOn(issues, d));
  ok(spread.every((x) => x.source === "issued" && near(x.litres, 25) && near(x.amount, 2500)), "4-day gap: 100 L spread as 25 L a day");
  // a 15-day gap: only the last MAX_SPREAD_DAYS are refilled, the rest is a bus off the road
  const gap = dates("2026-09-16", 15).map((d) => dieselOn(issues, d));
  ok(gap.filter((x) => x.source === "issued").length === MAX_SPREAD_DAYS, "long gap: capped at MAX_SPREAD_DAYS");
  ok(gap[0].source === "none" && gap[0].next === "2026-09-30", "long gap: early days carry no diesel and name the next issue");
  // conservation: every issued litre lands on exactly one day
  const all = dates("2026-09-01", 30).map((d) => dieselOn(issues, d)).filter((x) => x.source === "issued");
  ok(near(all.reduce((s, x) => s + x.litres, 0), 50 + 60 + 100 + 140), "every issued litre is attributed exactly once");
  ok(dieselOn([], "2026-09-10").source === "none" && dieselOn(null, "2026-09-10").source === "none", "no issues: none");
}

/* ---- diesel: after the latest issue, the recent average stands in for a while ---- */
{
  const issues = [["2026-09-20", 40, 4000], ["2026-09-24", 80, 8000], ["2026-09-28", 80, 8000]];
  // covered: 20th (its own day, first on record) + 21–24 + 25–28 = 9 days, 200 L
  const est = dieselOn(issues, "2026-09-30");
  ok(est.source === "estimate" && near(est.litres, 200 / 9) && est.last === "2026-09-28", "estimate = litres over the days they refilled", JSON.stringify(est));
  ok(dieselOn(issues, "2026-10-08").source === "estimate", "estimate holds up to ESTIMATE_DAYS");
  const stale = dieselOn(issues, dates("2026-09-28", ESTIMATE_DAYS + 2).pop());
  ok(stale.source === "none" && stale.last === "2026-09-28", "past ESTIMATE_DAYS: none, naming the last issue");
}

/* ---- cost: owned buses are diesel either way, hired buses the tariff either way ---- */
{
  const price = { rate: 100.67, date: "2026-09-29" };
  const owned = { id: "TN57CL3434", type: "Owned", mileage: 5, planKm: 92.2 };
  const gpsDay = { km: 50, source: "gps" };
  const v = variableCost(owned, gpsDay, dieselOn([["2026-09-29", 42, 4228.14]], "2026-09-29"), price);
  ok(!v.hired && near(v.byKm.litres, 10) && near(v.byKm.amount, 1006.7), "km basis: km ÷ ERP mileage × ERP price", JSON.stringify(v.byKm));
  ok(near(v.byDiesel.amount, 4228.14) && v.byDiesel.source === "issued" && near(v.byDiesel.rate, 100.67), "diesel basis: what was issued");
  const noMileage = variableCost({ id: "B", type: "Owned" }, gpsDay, null, null);
  ok(near(noMileage.byKm.amount, (50 / FALLBACK_KMPL) * DIESEL_PER_LITRE) && !noMileage.byKm.kmplFromErp && noMileage.byDiesel === null,
    "no ERP mileage or price: planner defaults, and no diesel figure without the feed");
  ok(variableCost(owned, { km: 0, source: null }, null, price).byKm === null, "no km at all: nothing to price by km");

  const hired = { id: "TN20BM9126", type: "Rental", planType: "rent", planCost: 1900 };
  const onPlan = variableCost(hired, { km: 92, source: "plan" }, null, price);
  ok(onPlan.hired && onPlan.byKm.amount === 1900 && onPlan.byDiesel === onPlan.byKm, "hired, plan day: the plan's own tariff, same both ways");
  const onGps = variableCost(hired, { km: 120, source: "gps" }, null, price);
  ok(near(onGps.byKm.amount, rentTariff(120)) && onGps.byDiesel.amount === onGps.byKm.amount, "hired, GPS day: tariff on km driven, same both ways");
  ok(variableCost({ id: "R", type: "Rental" }, { km: 70, source: "gps" }, null, price).hired, "hired without a plan route: told by its ERP type");
}

console.log(`dailyCost tests: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
