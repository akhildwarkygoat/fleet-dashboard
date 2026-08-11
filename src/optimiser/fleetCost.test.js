/* fleetCost tests — run with:  node src/optimiser/fleetCost.test.js
 *
 * The one that matters is the invariant: the adjusted per-service costs must sum to the
 * fleet's adjusted cost. The two are computed by different routes on purpose (per-run
 * shares vs once-per-vehicle), so agreement is evidence rather than tautology. */
import { fleetCost, standingPerDay, STANDING, DIESEL_PER_KM } from "./fleetCost.js";

let pass = 0, fail = 0;
const ok = (cond, label, detail = "") => {
  if (cond) { pass++; } else { fail++; console.log(`  FAIL: ${label}${detail ? " — " + detail : ""}`); }
};
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

const svc = (id) => ({ id, name: id });
const route = (name, km, riders, type = "own") => ({ name, km, riders, type, cap: 54, stops: 5 });
const STAND = standingPerDay();

/* ---- one bus, one run: adjusted === standalone (nothing to share) ---- */
{
  const fc = fleetCost([{ svc: svc("a"), plan: { routes: [route("BUS1", 100, 40)] } }]);
  ok(near(fc.fleet.standalone, fc.fleet.adjusted), "single run: no sharing");
  ok(near(fc.fleet.adjusted, STAND + DIESEL_PER_KM * 100), "single run: standing + diesel");
  ok(fc.shared === 0, "single run: nothing shared");
}

/* ---- one bus across three services: standing counted once, diesel three times ---- */
{
  const fc = fleetCost([
    { svc: svc("a"), plan: { routes: [route("BUS1", 100, 40)] } },
    { svc: svc("b"), plan: { routes: [route("BUS1", 50, 20)] } },
    { svc: svc("c"), plan: { routes: [route("BUS1", 30, 10)] } },
  ]);
  ok(fc.vehicles === 1 && fc.runs === 3, "3 runs on 1 vehicle");
  ok(fc.shared === 1, "counted as shared");
  ok(near(fc.fleet.standalone, 3 * STAND + DIESEL_PER_KM * 180), "standalone charges standing 3x");
  ok(near(fc.fleet.adjusted, STAND + DIESEL_PER_KM * 180), "adjusted charges standing once");
  ok(near(fc.fleet.doubleCounted, 2 * STAND), "double-counting equals the 2 extra charges");
  // each service carries exactly a third of the standing cost
  fc.services.forEach((s) => {
    const km = s.km;
    ok(near(s.adjusted, STAND / 3 + DIESEL_PER_KM * km), `${s.id}: one third of standing`);
  });
}

/* ---- rentals never share: a hire on two runs is two hires ---- */
{
  const fc = fleetCost([
    { svc: svc("a"), plan: { routes: [route("VAN1", 40, 15, "rent")] } },
    { svc: svc("b"), plan: { routes: [route("VAN1", 40, 15, "rent")] } },
  ]);
  ok(near(fc.fleet.standalone, fc.fleet.adjusted), "rental: sharing changes nothing");
  ok(fc.fleet.ownedBuses === 0, "rental: no owned standing cost");
}

/* ---- THE INVARIANT: services must sum to the fleet ---- */
{
  const mk = (id, routes) => ({ svc: svc(id), plan: { routes } });
  const fc = fleetCost([
    mk("s9",   [route("A", 120, 50), route("B", 90, 40), route("V1", 60, 18, "rent")]),
    mk("s7",   [route("A", 40, 12), route("C", 70, 30)]),
    mk("rday", [route("A", 55, 20), route("B", 65, 25), route("V1", 30, 10, "rent")]),
    mk("rful", [route("C", 80, 33), route("D", 45, 16)]),
  ]);
  const summed = fc.services.reduce((n, s) => n + s.adjusted, 0);
  ok(near(summed, fc.fleet.adjusted, 1e-6), "INVARIANT: Σ adjusted services = fleet adjusted",
     `Σ=${summed.toFixed(4)} fleet=${fc.fleet.adjusted.toFixed(4)}`);
  ok(fc.fleet.standalone > fc.fleet.adjusted, "standalone overstates the fleet");
  ok(fc.vehicles === 5 && fc.runs === 10, "5 vehicles, 10 runs");
  // A runs 3x, B 2x, C 2x, D 1x  -> 3 shared owned vehicles
  ok(fc.shared === 4, "A, B, C and V1 are shared", `got ${fc.shared}`);
}

/* ---- an empty / missing plan must not explode or poison the totals ---- */
{
  const fc = fleetCost([{ svc: svc("a"), plan: null }, { svc: svc("b"), plan: { routes: [] } }]);
  ok(fc.runs === 0 && fc.fleet.adjusted === 0, "no plans: zeroed, not NaN");
  const fc2 = fleetCost([{ svc: svc("a"), plan: { routes: [route("BUS1", 100, 0)] } }]);
  ok(isFinite(fc2.fleet.adjustedHead), "zero riders: ₹/head is finite, not NaN");
}

/* ---- standing cost is DERIVED from the plan, not invented ---- */
{
  // a plan stating cost 3000 on 50 km implies standing = 3000 - 22*50 = 1900
  const r = { name: "BUS9", km: 50, riders: 40, type: "own", cap: 54, cost: 3000 };
  const fc = fleetCost([{ svc: svc("a"), plan: { routes: [r] } }]);
  ok(near(fc.fleet.standalone, 3000), "standalone reproduces the plan's own cost",
     `got ${fc.fleet.standalone.toFixed(2)}`);
  ok(near(fc.perBus.get("BUS9").standing, 1900), "standing read back as 1900");
  ok(!near(fc.fleet.standalone, STAND + 22 * 50), "did NOT use the notional constant");
}

/* ---- a bus shared between a full-cost plan and a no-standing plan ---- */
{
  // service b costed WITHOUT standing charges (cost == diesel only) reveals nothing about
  // the vehicle; service a's full costing does. The higher figure must win, or the shared
  // bus would come out free.
  const fc = fleetCost([
    { svc: svc("a"), plan: { routes: [{ name: "BUS9", km: 50, riders: 40, type: "own", cap: 54, cost: 3000 }] } },
    { svc: svc("b"), plan: { routes: [{ name: "BUS9", km: 40, riders: 20, type: "own", cap: 54, cost: 22 * 40 }] } },
  ]);
  ok(near(fc.perBus.get("BUS9").standing, 1900), "the full-cost plan sets the standing figure");
  // adjusted: standing once (1900) + diesel over both runs
  ok(near(fc.fleet.adjusted, 1900 + 22 * 90), "adjusted charges the standing once");
  const summed = fc.services.reduce((n, s) => n + s.adjusted, 0);
  ok(near(summed, fc.fleet.adjusted), "INVARIANT holds with derived standing");
}

/* ---- an explicit override wins over anything inferred ---- */
{
  const fc = fleetCost(
    [{ svc: svc("a"), plan: { routes: [{ name: "BUS9", km: 50, riders: 40, type: "own", cap: 54, cost: 3000 }] } }],
    { standingOf: (n) => (n === "BUS9" ? 500 : null) }
  );
  ok(near(fc.perBus.get("BUS9").standing, 500), "standingOf override applied");
  ok(near(fc.fleet.standalone, 500 + 22 * 50), "override flows into the totals");
}

console.log(`fleetCost tests: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
