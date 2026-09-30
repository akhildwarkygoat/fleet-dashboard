/* kpiRank tests — run with:  node src/optimiser/kpiRank.test.js
 *
 * What pressing a KPI promises: highest first, then lowest first, then off; the ranked figure
 * is the one the tile sums up; and a bus or plan with nothing to rank sits at the end unranked
 * rather than being called the lowest. */
import { BUS_RANK, PLAN_RANK, nextRank, rankBy } from "./kpiRank.js";

let pass = 0, fail = 0;
const ok = (cond, label, detail = "") => {
  if (cond) { pass++; } else { fail++; console.log(`  FAIL: ${label}${detail ? " — " + detail : ""}`); }
};

/* ---- the press cycle ---- */
{
  const a = nextRank(null, "cost");
  ok(a.key === "cost" && a.dir === "desc", "first press: highest first");
  const b = nextRank(a, "cost");
  ok(b.key === "cost" && b.dir === "asc", "second press: lowest first");
  ok(nextRank(b, "cost") === null, "third press: off");
  ok(nextRank(b, "ride").dir === "desc", "a different KPI starts at highest first");
}

/* ---- buses ---- */
{
  const buses = [
    { n: "A", riders: 40, cap: 50, cost: 2000, ride: 90, km: 80, stops: 10 },
    { n: "B", riders: 0, cap: 20, cost: 0, ride: 0, km: 0, stops: 0 },
    { n: "C", riders: 20, cap: 20, cost: 1900, ride: 120, km: 100, stops: 12 },
  ];
  const byCost = rankBy(buses, (b) => BUS_RANK.cost.value(b), "desc");
  ok(byCost.map((x) => x.item.n).join("") === "CAB", "cost/head: ₹95 before ₹50, the empty bus last", byCost.map((x) => x.item.n).join(""));
  ok(byCost[0].rank === 1 && byCost[1].rank === 2 && byCost[2].rank === null, "the empty bus is unranked, not 3rd");
  const byUtil = rankBy(buses, (b) => BUS_RANK.util.value(b), "desc");
  ok(byUtil[0].item.n === "C" && Math.round(byUtil[0].value) === 100, "utilisation = riders ÷ seats");
  const byRideAsc = rankBy(buses, (b) => BUS_RANK.ride.value(b), "asc");
  ok(byRideAsc[0].item.n === "B" && byRideAsc[0].rank === 1, "a real zero still ranks; only a missing value is unranked");
  const ties = rankBy([{ n: "X", v: 5 }, { n: "Y", v: 5 }], (x) => x.v, "desc");
  ok(ties[0].item.n === "X" && ties[1].item.n === "Y", "ties keep their original order");
  ok(BUS_RANK.ride.fmt(89.6) === "90 min" && BUS_RANK.cost.fmt(95) === "₹95.0/head", "bus formats");
}

/* ---- plans ---- */
{
  const plan = {
    overall: { riders: 100, cost_head: 60, util: 90, avg_ride: 50, max_ride: 110, km: 900, seats: 120, avg_stops: 9 },
    owned: { buses: 3 }, rental: { buses: 2 },
    routes: [{ km: 100, riders: 60 }, { km: 40, riders: 40 }],
  };
  ok(PLAN_RANK.cost.value(plan) === 60 && PLAN_RANK.ride.value(plan) === 110 && PLAN_RANK.owned.value(plan) === 3, "plan figures read off the scored body");
  ok(Math.abs(PLAN_RANK.avgdist.value(plan) - (50 * 60 + 20 * 40) / 100) < 1e-9, "dist/person is people-weighted one-way km");
  const plans = [{ id: "a", body: plan }, { id: "b", body: null }, { id: "c", body: { ...plan, overall: { ...plan.overall, cost_head: 72 } } }];
  const ranked = rankBy(plans, (p) => (p.body ? PLAN_RANK.cost.value(p.body) : null), "desc");
  ok(ranked.map((x) => x.item.id).join("") === "cab" && ranked[2].rank === null, "a plan that could not be scored ranks last, unranked");
}

console.log(`kpiRank tests: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
