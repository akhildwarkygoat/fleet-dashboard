/* ============================================================================
 * engine.test.js — invariant tests for the optimiser.  Run:  npm test
 * ----------------------------------------------------------------------------
 * Pure-node test (no Google, no DOM) — optimise() falls back to haversine, so the
 * logic is checked deterministically. Asserts the non-negotiables that kept biting
 * us (demand formula, rental tariff, cost adds up, capacity+leniency, closest-first,
 * every stop served). If any fails, a code change broke the model — fix before shipping.
 * ==========================================================================*/
import {
  optimise, effectiveDemand, busDayCost, rentTariff, validatePlan, haversineKm,
} from "./engine.js";

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.error("  ✗ " + msg); } };
const near = (a, b, eps = 0.5) => Math.abs(a - b) <= eps;

/* ---- demand formula: ceil(head × (1 − absentee + 0.03)) ---- */
ok(effectiveDemand({ headcount: 5, absentee: 0.10 }) === 5, "demand ceil(5×0.93)=5");
ok(effectiveDemand({ headcount: 4, absentee: 0.10 }) === 4, "demand ceil(4×0.93)=4");
ok(effectiveDemand({ headcount: 10, absentee: 0 }) === 11, "demand ceil(10×1.03)=11");

/* ---- rental tariff tiers: ≤80→1700, 80–95→1900, >95→18.7/km floored at 1900 ---- */
ok(rentTariff(50) === 1700, "rental ≤80km = 1700");
ok(rentTariff(80) === 1700, "rental =80km = 1700");
ok(rentTariff(90) === 1900, "rental 80–95km = 1900");
ok(rentTariff(96) === 1900, "rental just over 95km floored at 1900");
ok(rentTariff(200) === 18.7 * 200, "rental long run = 18.7×km");

/* ---- own-bus cost = loan/26 + driver + maint + diesel×km ---- */
const ownPaid = { type: "own", capacity: 55, loanMonth: 0, driverDay: 850, maintDay: 300, dieselPerKm: 23 };
ok(near(busDayCost(ownPaid, 10), 850 + 300 + 230), "own (paid off) cost = driver+maint+diesel×km");
ok(near(busDayCost({ ...ownPaid, loanMonth: 26000 }, 0), 1000 + 850 + 300), "own loan share = loan/26");

/* ---- full optimise on a small corridor scenario (haversine fallback) ---- */
const depot = { name: "F", lat: 10.2075, lng: 77.8062 };
const stops = [
  { id: "s1", name: "A", lat: 10.181, lng: 77.789, headcount: 5, absentee: 0.10, route: "R" },
  { id: "s2", name: "B", lat: 10.128, lng: 77.789, headcount: 4, absentee: 0.10, route: "R" },
  { id: "s3", name: "C", lat: 10.109, lng: 77.805, headcount: 5, absentee: 0.10, route: "R" },
  { id: "s4", name: "D", lat: 10.102, lng: 77.815, headcount: 3, absentee: 0.10, route: "R" },
  { id: "s5", name: "E", lat: 10.097, lng: 77.822, headcount: 4, absentee: 0.10, route: "R" },
];
const fleet = [
  { id: "o1", name: "OWN-1", type: "own", capacity: 55, loanMonth: 0, driverDay: 850, maintDay: 300, dieselPerKm: 23 },
  { id: "o2", name: "OWN-2", type: "own", capacity: 55, loanMonth: 0, driverDay: 850, maintDay: 300, dieselPerKm: 23 },
  { id: "r1", name: "RENT-1", type: "rent", capacity: 15, slabFixed: 1700, slabKm: 80, perKmBeyond: 18.7 },
];

const res = optimise(stops, fleet, depot, {});
ok(res.ok, "optimise produced a plan");
ok(res.kpis && res.kpis.buses === 1, "small demand (21) fits a single bus");

/* every invariant from validatePlan must hold */
for (const c of validatePlan(res, stops, fleet, depot, {})) ok(c.ok, "invariant: " + c.label + " — " + c.detail);

/* closest-first: the first served stop is the nearest to the depot */
if (res.ok) {
  const first = res.plan.routes[0].stops[0];
  const nearest = stops.slice().sort((a, b) => haversineKm(depot, a) - haversineKm(depot, b))[0];
  ok(first.id === nearest.id, "first pickup is the closest stop");
}

/* leniency: a 16-rider cluster must fit a 15-seat van (15 + 5 buffer) */
const bigStop = [{ id: "b1", name: "Big", lat: 10.10, lng: 77.81, headcount: 16, absentee: 0, route: "R" }];
const vanOnly = [{ id: "rv", name: "VAN", type: "rent", capacity: 15, slabFixed: 1700, slabKm: 80, perKmBeyond: 18.7 }];
ok(optimise(bigStop, vanOnly, depot, {}).ok, "16 riders fit a 15-seat van via the +5 leniency");

/* ---- two-tier ride penalty: must SPLIT across buses to avoid a red (>60 min) route ---- */
import { DEFAULTS } from "./engine.js";
ok(DEFAULTS.redPenaltyPerMin > DEFAULTS.ridePenaltyPerMin * 10, "red penalty is far heavier than the yellow nudge");
{
  // 3 stop-clusters ~5–6 km from the depot in different directions. One bus serving all three
  // must zig-zag across them → a long red route. Demand (48) fits ONE bus on capacity, so the only
  // reason to split is the ride-time penalty. Plenty of (paid-off) buses available.
  const dep = { name: "D", lat: 10.0, lng: 77.0 };
  const centers = [[10.0, 77.06], [10.0, 76.94], [10.06, 77.0]];
  const many = [];
  centers.forEach((c, ci) => { for (let i = 0; i < 8; i++) many.push({ id: `m${ci}_${i}`, name: `M${ci}-${i}`, lat: c[0] + (i % 4) * 0.004 - 0.006, lng: c[1] + Math.floor(i / 4) * 0.004, headcount: 2, absentee: 0, route: "Z" }); });
  const own = (n) => ({ id: n, name: n, type: "own", capacity: 55, loanMonth: 0, driverDay: 850, maintDay: 300, dieselPerKm: 23 });
  const r2 = optimise(many, [own("A"), own("B"), own("C"), own("D")], dep, {});
  ok(r2.ok, "wide 3-cluster scenario solved");
  ok(r2.kpis.buses >= 2, `split across buses to avoid red (used ${r2.ok ? r2.kpis.buses : "?"})`);
  ok(r2.ok && r2.kpis.maxRide < DEFAULTS.redCapMin, `no route exceeds the ${DEFAULTS.redCapMin}-min red threshold (max ${r2.ok ? Math.round(r2.kpis.maxRide) : "?"})`);
}

console.log(`\nengine tests: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
