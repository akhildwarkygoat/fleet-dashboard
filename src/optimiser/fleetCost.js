/* ============================================================================
 * optimiser/fleetCost.js — what the fleet actually costs when buses are shared.
 * ----------------------------------------------------------------------------
 * A bus that runs three services is currently charged its WHOLE standing cost to
 * each of them, so the services sum to about 37% more than the fleet — ₹70,358/day
 * of cost that does not exist. No fleet-level figure can be trusted while that holds.
 *
 * Loan, driver and maintenance are caused by the VEHICLE existing that day, not by
 * any one run, so they are split equally across the runs that vehicle makes. Diesel
 * and rental slabs are caused by the RUN — its own kilometres, its own hire — and are
 * never shared. A rented van on two runs is two hires, so rentals have no standing
 * cost to divide.
 *
 * Costs are RECOMPUTED here rather than read from each plan's `cost` field: those were
 * written by different runs under different flags (some charge standing costs, some
 * treat them as sunk), so adding them up compares nothing to nothing. One basis, one
 * function, both answers.
 *
 * Two answers, deliberately:
 *   standalone — every bus charged in full. "What does this service cost on its own?"
 *   adjusted   — standing cost counted once per vehicle. "What does the fleet cost?"
 *
 * INVARIANT: the adjusted per-service costs sum to the fleet's adjusted cost. That is
 * the whole point, and fleetCost.test.js asserts it.
 * ==========================================================================*/
import { rentTariff } from "./engine.js";
import { canonVehicle } from "../erp.js";

/* Same figures the plan generator uses for an owned bus. workingDays already amortises
   the monthly loan to a day — do not divide by runs AND re-amortise. */
export const STANDING = { loanMonth: 35000, workingDays: 26, driverDay: 800, maintDay: 280 };
export const DIESEL_PER_KM = 22;

/** One owned vehicle's standing cost for a day, before any sharing. */
export const standingPerDay = (p = STANDING) =>
  p.loanMonth / (p.workingDays || 26) + p.driverDay + p.maintDay;

const num = (v) => (isFinite(+v) ? +v : 0);

/**
 * The cost basis THIS fleet actually reports, for use as `opts` below.
 *
 * STANDING/DIESEL_PER_KM above are notional: Rs2,426/day and Rs22/km. The fleet's own
 * records say otherwise — all 29 owned buses carry loanMonth 0 (the loans are pooled and
 * largely paid off), driver 692, maintenance 1,242 and diesel 16.8/km, i.e. Rs1,934/day.
 * Deriving a standing cost from a plan file only works when that plan charged one; where it
 * did not, falling back to an invented constant overstates the service by ~Rs500/bus/day.
 * Ask the fleet instead.
 *
 * @param fleet [{ name, type, loanMonth, driverDay, maintDay, dieselPerKm }]
 * @returns { standingOf(name), dieselPerKm } or null when the fleet says nothing useful
 */
export function fleetBasis(fleet, p = STANDING) {
  const list = (fleet || []).filter((b) => b && b.type !== "rent");
  if (!list.length) return null;
  const byName = new Map();
  const rates = [];
  for (const b of list) {
    const standing = num(b.loanMonth) / (p.workingDays || 26) + num(b.driverDay) + num(b.maintDay);
    if (standing > 0) byName.set(canonVehicle(String(b.name || "").trim()), standing);
    if (num(b.dieselPerKm) > 0) rates.push(num(b.dieselPerKm));
  }
  if (!byName.size) return null;
  rates.sort((a, b) => a - b);
  return {
    standingOf: (name) => byName.get(name),          // undefined -> caller derives or falls back
    dieselPerKm: rates.length ? rates[Math.floor(rates.length / 2)] : DIESEL_PER_KM,
  };
}

/**
 * @param entries [{ svc, plan }] — the FINALISED plan per service. `runs(bus)` counts
 *        only what is in here, so changing what is finalised moves every adjusted figure.
 * @param opts   { standing, dieselPerKm } to override the cost constants
 * @returns see below
 */
export function fleetCost(entries, opts = {}) {
  const p = { ...STANDING, ...(opts.standing || {}) };
  const diesel = opts.dieselPerKm != null ? opts.dieselPerKm : DIESEL_PER_KM;
  const standing = standingPerDay(p);

  /* Pass 1 — who runs what. Vehicle names are canonicalised because saved plans can carry
     a bus's old registration; without that the same vehicle counts as two and shares nothing. */
  const perBus = new Map();
  const list = (entries || []).filter((e) => e && e.plan && Array.isArray(e.plan.routes));
  for (const { svc, plan } of list) {
    for (const r of plan.routes) {
      const name = canonVehicle(String(r.name || "").trim());
      if (!name) continue;
      if (!perBus.has(name)) perBus.set(name, { name, type: r.type, runs: [] });
      const b = perBus.get(name);
      // one rented row is enough to make the vehicle a hire — hires never share
      if (r.type === "rent") b.type = "rent";
      /* Carry the plan's own declaration of how it was costed. Without it the derivation
         below silently mixes bases: plan_s7.json and plan_zen.json declare
         costing.basis "running-only" (standing:false), plan_rot-*.json declare "full"
         (standing:true), and finalised_plan.json declares nothing at all. */
      b.runs.push({ svcId: svc.id, svcName: svc.name, route: r,
                    basis: (plan.costing && plan.costing.basis) || null,
                    hasStanding: plan.costing ? plan.costing.standing !== false : null });
    }
  }

  /* Pass 2 — each vehicle's standing cost comes FROM THE PLANS, not from a constant.
     A plan already states what each route costs, and the running part of that is diesel over
     its own kilometres, so the remainder is what that plan charged the vehicle for standing:

         standing_i = cost_i - dieselPerKm x km_i

     Deriving it this way is the difference between matching the finalised plans and
     contradicting them. A flat loan/26 + driver + maint came to Rs2,426/bus/day, while the real
     plans imply Rs1,223-1,848 — the fleet's loans are pooled and largely paid off, and every bus
     has its own profile. Inventing the figure overstated every owned bus by roughly Rs800/day
     and inflated every Rs/head above what the plans say.

     One value per VEHICLE, taken as the MAXIMUM across its runs: a plan that charged the bus in
     full reveals its standing cost, whereas a plan costed without standing charges (the
     --no-standing runs) reveals nothing and would drag a shared bus's cost to zero.
     `opts.standingOf(name)` overrides it once real per-bus ERP costs are wired through. */
  const impliedStanding = (bus) => {
    if (bus.type === "rent") return 0;
    if (typeof opts.standingOf === "function") {
      const v = opts.standingOf(bus.name);
      if (isFinite(v) && v >= 0) return v;
    }
    let best = 0, sawCost = false;
    for (const run of bus.runs) {
      const c = run.route.cost;
      if (c == null || !isFinite(+c)) continue;
      // A plan that declares it charged NO standing cost reveals nothing about the vehicle's
      // standing cost; reading one anyway is how a --no-standing plan's near-zero remainder
      // used to compete in the MAX. Skip it explicitly rather than relying on MAX to lose.
      if (run.hasStanding === false) continue;
      sawCost = true;
      best = Math.max(best, num(c) - diesel * num(run.route.km));
    }
    /* No plan charged this vehicle a standing cost, so nothing can be derived. Prefer the
       fleet's own median over the notional constant — inventing Rs2,426 where the fleet
       reports Rs1,934 overstates every such service by ~Rs500/bus/day. */
    if (sawCost) return Math.max(0, best);
    if (typeof opts.standingOf === "function") {
      const vals = [];
      for (const b of perBus.values()) {
        if (b.type === "rent") continue;
        const v = opts.standingOf(b.name);
        if (isFinite(v) && v > 0) vals.push(v);
      }
      if (vals.length) { vals.sort((a, b) => a - b); return vals[Math.floor(vals.length / 2)]; }
    }
    return standing;
  };
  for (const bus of perBus.values()) bus.standing = impliedStanding(bus);

  const runCost = (bus, r, shared) => {
    if (bus.type === "rent") return rentTariff(num(r.km));      // a hire is a hire, per run
    const share = shared ? bus.standing / bus.runs.length : bus.standing;
    return share + diesel * num(r.km);
  };

  const bySvc = new Map();
  for (const { svc } of list) {
    bySvc.set(svc.id, { id: svc.id, name: svc.name, buses: 0, riders: 0, km: 0,
                        standalone: 0, adjusted: 0 });
  }
  for (const bus of perBus.values()) {
    for (const run of bus.runs) {
      const s = bySvc.get(run.svcId);
      if (!s) continue;
      s.buses += 1;
      s.riders += num(run.route.riders);
      s.km += num(run.route.km);
      /* recorded on the run as well as summed, so a view can re-cost its own routes table
         from the same numbers instead of recomputing the split and drifting from it */
      run.standalone = runCost(bus, run.route, false);
      run.adjusted = runCost(bus, run.route, true);
      s.standalone += run.standalone;
      s.adjusted += run.adjusted;
    }
  }

  /* Which declared bases are in play, and which vehicles straddle more than one. A service
     whose plan charged no standing cost still gets charged standing here whenever one of its
     buses also appears in a plan that did — that is what makes the column comparable, and it
     is also why a view must be able to say so rather than implying every row was costed the
     same way. */
  const basesSeen = new Set();
  const svcBasis = new Map();
  for (const { svc, plan } of list) {
    const b = (plan.costing && plan.costing.basis) || null;
    basesSeen.add(b || "unstated");
    svcBasis.set(svc.id, b);
  }
  const crossBasisBuses = [];
  for (const bus of perBus.values()) {
    if (bus.type === "rent") continue;
    const b = new Set(bus.runs.map((r) => r.basis || "unstated"));
    if (b.size > 1) crossBasisBuses.push({ name: bus.name, bases: [...b], svcIds: bus.runs.map((r) => r.svcId) });
  }

  const services = [...bySvc.values()].map((s) => ({
    ...s,
    /* true when this service's own plan charged no standing cost but at least one of its
       buses inherited standing from another service's plan that did */
    inheritedStanding: crossBasisBuses.some((c) => c.svcIds.includes(s.id)),
    /* What this service's own plan file says it was costed on — "running-only" means the
       file charges diesel and nothing else, so its own Rs/head is not comparable with a
       fully-costed one. Exposed so a view can name the services rather than hardcode them. */
    declaredBasis: svcBasis.get(s.id) || null,
    standaloneHead: s.riders ? s.standalone / s.riders : 0,
    adjustedHead: s.riders ? s.adjusted / s.riders : 0,
  }));

  const sum = (f) => services.reduce((n, s) => n + f(s), 0);
  const vehicles = [...perBus.values()];
  const ownedBuses = vehicles.filter((b) => b.type !== "rent");
  const ownedRuns = ownedBuses.reduce((n, b) => n + b.runs.length, 0);
  const riders = sum((s) => s.riders);

  return {
    services,
    /* every declared basis in this run, and the vehicles that straddle more than one */
    bases: [...basesSeen],
    crossBasisBuses,
    perBus: perBus,
    vehicles: vehicles.length,
    runs: vehicles.reduce((n, b) => n + b.runs.length, 0),
    shared: vehicles.filter((b) => b.runs.length > 1).length,
    fleet: {
      riders,
      km: sum((s) => s.km),
      standalone: sum((s) => s.standalone),
      /* The fleet's real cost: each owned vehicle's standing cost ONCE, plus every run's
         own diesel and every hire. Computed independently of the per-service split so the
         invariant below is a genuine check rather than a restatement. */
      adjusted: ownedBuses.reduce((n, b) => n + b.standing, 0)
        + vehicles.reduce((n, b) => n + b.runs.reduce((m, r) =>
            m + (b.type === "rent" ? rentTariff(num(r.route.km)) : diesel * num(r.route.km)), 0), 0),
      standaloneHead: riders ? sum((s) => s.standalone) / riders : 0,
      adjustedHead: riders ? sum((s) => s.adjusted) / riders : 0,
      doubleCounted: sum((s) => s.standalone) - sum((s) => s.adjusted),
      ownedBuses: ownedBuses.length,
      ownedRuns,
    },
  };
}

/** Adjusted cost per (service, vehicle), for re-costing a routes table in place. */
export function runCostIndex(fc) {
  const m = new Map();
  for (const bus of fc.perBus.values())
    for (const run of bus.runs)
      m.set(run.svcId + "|" + bus.name, { adjusted: run.adjusted, standalone: run.standalone, runs: bus.runs.length });
  return m;
}

/** Services a vehicle serves, for the "· 5 services · ⅕ standing" chip. */
export const busShare = (fc, name) => {
  const b = fc.perBus.get(canonVehicle(String(name || "").trim()));
  if (!b) return null;
  return { runs: b.runs.length, type: b.type,
           services: [...new Set(b.runs.map((r) => r.svcName))] };
};
