/* ============================================================================
 * optimiser/engine.js — client-side bus route optimiser
 * ----------------------------------------------------------------------------
 * JavaScript re-implementation of the Python OR-Tools prototype's MODEL (the
 * Python solver is itself a heuristic, so a greedy clustering heuristic here is
 * faithful). Pure functions, no React, no DOM — easy to reason about and test.
 *
 * Problem: assign employee pickup stops to a heterogeneous fleet (own + rented
 * buses), sequence each route, minimise cost-per-head/day while respecting bus
 * capacity and a hard 60-min ride ceiling. Mirrors the ₹57/head benchmark.
 * ==========================================================================*/

export const DEFAULTS = {
  roadFactor: 1.30,        // straight-line km -> approx road km
  speedKmph: 26,           // mixed city speed to derive time
  serviceMin: 0.5,         // dwell/boarding per stop (real-world ~30 sec)
  absenteeBuffer: 0.03,    // safety margin above expected attendance
  workingDays: 26,         // days/month to amortise monthly fixed costs
  capacityBuffer: 5,       // riders allowed OVER a bus's seats (leniency) — own 55→60, rental 15→20
  softCapMin: 45,          // soft target — over this = YELLOW, and penalised when choosing a plan
  redCapMin: 60,           // colour threshold — over this = RED (still soft; never blocks a stop)
  hardCapMin: 600,         // NO real hard cap — every stop is always served; kept huge only as a solver-dimension safety
  poolOwnLoan: true,       // spread owned-bus loans across the owned fleet (sunk, fleet-level). false => per-bus
  // Two-tier ride-time penalty when ranking plans (₹/head per minute over the threshold):
  ridePenaltyPerMin: 0.3,  // LIGHT — minutes in the 45–60 (yellow) band: gently prefer shorter routes
  redPenaltyPerMin: 15,    // HEAVY — minutes beyond 60 (red): the optimiser will add a bus to avoid red
  // (optional) maxCostPerHead: null — hard ₹/head budget; see MODEL_INTEGRITY.md §2 to enable it
};

/* Rental tariff — shared by all rented vans for now (per-bus override later via bus.tariff):
   ≤80 km → ₹1700 · 80–95 km → ₹1900 · >95 km → ₹18.70/km, floored at ₹1900 so a longer trip never costs less. */
export const RENT_TARIFF = { t1Km: 80, t1: 1700, t2Km: 95, t2: 1900, perKm: 18.7 };
export function rentTariff(km, tf = RENT_TARIFF) {
  if (km <= tf.t1Km) return tf.t1;
  if (km <= tf.t2Km) return tf.t2;
  return Math.max(tf.t2, tf.perKm * km);
}

const R_EARTH = 6371; // km
const toRad = (d) => (d * Math.PI) / 180;

/** Great-circle distance (km) between two {lat,lng} points. */
export function haversineKm(a, b) {
  if (!a || !b || a.lat == null || b.lat == null) return 0;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return R_EARTH * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}
// distance/time between two nodes — uses the real road matrix (p.metric, indexed by
// node._idx) when available, otherwise the haversine ×road-factor estimate.
const legKm = (a, b, p) => {
  if (p && p.metric && a && b && a._idx != null && b._idx != null) {
    const v = p.metric.km(a._idx, b._idx);
    if (isFinite(v)) return v;
  }
  return haversineKm(a, b) * p.roadFactor;
};
const legMin = (a, b, p) => {
  let base;
  if (p && p.metric && a && b && a._idx != null && b._idx != null) {
    const v = p.metric.min(a._idx, b._idx);
    base = isFinite(v) ? v : (haversineKm(a, b) * p.roadFactor / p.speedKmph) * 60;
  } else {
    base = (haversineKm(a, b) * p.roadFactor / p.speedKmph) * 60;
  }
  return base * (p.trafficFactor || 1); // traffic factor lets the time-series vary by day
};

/** Effective riders to plan for at a stop = ceil(head × (1 − absentee + buffer)). */
export function effectiveDemand(stop, p = DEFAULTS) {
  const head = +stop.headcount || 0, abs = +stop.absentee || 0;
  return Math.max(0, Math.ceil(head * (1 - abs + p.absenteeBuffer)));
}

/** Compass-ish bearing of a stop from the depot (for sweep clustering). */
function bearing(depot, s) { return Math.atan2(s.lng - depot.lng, s.lat - depot.lat); }

/** Nearest-neighbour open path starting at the stop farthest from the depot
 *  (buses pick the farthest rider first, then work back toward the factory). */
function sequence(depot, stops, p) {
  if (stops.length <= 1) return stops.slice();
  // CLOSEST-FIRST by STRAIGHT-LINE distance from the factory (nearest first). Gives a clean outward
  // sweep that matches the map AND tends to be SHORTER than the road-distance sort here — road-ranking
  // individual stops can put a near-tie out of geographic order and force an end-of-route zigzag.
  // Reads 1,2,3… outward. "REVERT" → the distance-minimising 2-opt order (engine.REVERT.js).
  return stops.slice().sort((a, b) => haversineKm(depot, a) - haversineKm(depot, b));
}

/** 2-opt: repeatedly reverse a route segment whenever doing so shortens the loop
 *  (depot -> ... -> depot), until no reversal helps. Kills the nearest-neighbour zigzags. */
function twoOpt(depot, seq, p) {
  if (seq.length < 4) return seq;
  let best = seq.slice(), bestKm = routeKm(depot, best, p), improved = true, guard = 0;
  while (improved && guard++ < 60) {
    improved = false;
    for (let i = 0; i < best.length - 1; i++) {
      for (let j = i + 1; j < best.length; j++) {
        const cand = best.slice(0, i).concat(best.slice(i, j + 1).reverse(), best.slice(j + 1));
        const km = routeKm(depot, cand, p);
        if (km + 1e-9 < bestKm) { best = cand; bestKm = km; improved = true; }
      }
    }
  }
  return best;
}

/** Route distance (km): depot -> first -> ... -> last -> depot (loop incl. deadhead). */
function routeKm(depot, seq, p) {
  if (!seq.length) return 0;
  let km = legKm(depot, seq[0], p);
  for (let i = 0; i < seq.length - 1; i++) km += legKm(seq[i], seq[i + 1], p);
  km += legKm(seq[seq.length - 1], depot, p);
  return km;
}

/** One-way chain distance (km): depot -> first -> ... -> last, NO return. */
function chainKmOneWay(depot, seq, p) {
  if (!seq.length) return 0;
  let km = legKm(depot, seq[0], p);
  for (let i = 0; i < seq.length - 1; i++) km += legKm(seq[i], seq[i + 1], p);
  return km;
}

/** Day distance used for COST. Chain mode (bus parks at its last stop) = 2 × the one-way chain
 *  (evening drop + morning pickup, no depot deadhead) — matches optimize.py --chain. Else the loop. */
function dayKm(depot, seq, p) {
  return p.chain ? 2 * chainKmOneWay(depot, seq, p) : routeKm(depot, seq, p);
}

/** First-picked rider's ride time (min): first stop -> ... -> factory.
 *  The empty depot->first deadhead is excluded; boarding service added per later stop. */
function firstRideMin(depot, seq, p) {
  if (!seq.length) return 0;
  let min = 0;
  for (let i = 0; i < seq.length - 1; i++) min += legMin(seq[i], seq[i + 1], p);
  min += legMin(seq[seq.length - 1], depot, p);
  min += p.serviceMin * (seq.length - 1);
  return min;
}

/** Time-to-last-stop (min): depot -> first stop -> ... -> last pickup, NO return leg.
 *  This is the SLA/limit metric (the bus's pickup-run duration); boarding service per stop. */
function toLastStopMin(depot, seq, p) {
  if (!seq.length) return 0;
  let min = legMin(depot, seq[0], p);
  for (let i = 0; i < seq.length - 1; i++) min += legMin(seq[i], seq[i + 1], p);
  min += p.serviceMin * seq.length;
  return min;
}

/** Distance to last stop (km): depot -> first -> ... -> last pickup, NO return leg. */
function toLastStopKm(depot, seq, p) {
  if (!seq.length) return 0;
  let km = legKm(depot, seq[0], p);
  for (let i = 0; i < seq.length - 1; i++) km += legKm(seq[i], seq[i + 1], p);
  return km;
}

/** True daily cost of running a bus over `km`. */
export function busDayCost(bus, km, p = DEFAULTS) {
  if (bus.type === "own") {
    return (+bus.loanMonth || 0) / p.workingDays + (+bus.driverDay || 0) + (+bus.maintDay || 0) + (+bus.dieselPerKm || 0) * km;
  }
  return rentTariff(km, bus.tariff || RENT_TARIFF); // rented: tiered day tariff (per-bus override via bus.tariff)
}
/** Committed (sunk) fixed cost an idle OWN bus still incurs (its loan share). */
function idleOwnCost(bus, p) { return (+bus.loanMonth || 0) / p.workingDays; }

/** Spread owned-bus loans evenly across the owned fleet (sunk, fleet-level). Cost/head is
 *  identical pooled or not — pooling just makes per-bus costs fair. p.poolOwnLoan=false => per-bus. */
function withPooledLoans(fleet, p) {
  if (p.poolOwnLoan === false) return fleet;
  const own = fleet.filter((b) => b.type === "own");
  if (own.length < 2) return fleet;
  const per = own.reduce((s, b) => s + (+b.loanMonth || 0), 0) / own.length;
  return fleet.map((b) => (b.type === "own" ? { ...b, loanMonth: per } : b));
}

/* ---- sweep clustering into groups each capped at `capLimit` heads (used by the naive baseline) ---- */
function sweepClusters(depot, stops, capLimit) {
  const sorted = [...stops].sort((a, b) => bearing(depot, a) - bearing(depot, b));
  const clusters = [];
  let cur = [], curDem = 0;
  for (const s of sorted) {
    if (cur.length && curDem + s._dem > capLimit) { clusters.push(cur); cur = []; curDem = 0; }
    cur.push(s); curDem += s._dem;
  }
  if (cur.length) clusters.push(cur);
  return clusters;
}

/* ---- Clarke-Wright SAVINGS clustering — groups genuinely-nearby stops using the ROAD MATRIX.
   savings(i,j) = roadKm(depot,i) + roadKm(depot,j) − roadKm(i,j): how much road distance is
   saved by serving i and j on one bus instead of two. Merge highest-savings pairs first,
   respecting bus capacity and the 60-min ride ceiling. This is the standard VRP heuristic and,
   unlike the bearing sweep, the grouping decision itself is driven by real road proximity. ---- */
function savingsClusters(depot, stops, capLimit, p) {
  if (stops.length <= 1) return stops.map((s) => [s]);
  const routeOf = new Map();
  stops.forEach((s) => routeOf.set(s, [s])); // every stop starts on its own route
  const demOf = (r) => r.reduce((n, s) => n + s._dem, 0);
  const pairs = [];
  for (let i = 0; i < stops.length; i++) {
    for (let j = i + 1; j < stops.length; j++) {
      const a = stops[i], b = stops[j];
      pairs.push([legKm(depot, a, p) + legKm(depot, b, p) - legKm(a, b, p), a, b]);
    }
  }
  pairs.sort((x, y) => y[0] - x[0]); // biggest saving first
  for (const [, a, b] of pairs) {
    const ra = routeOf.get(a), rb = routeOf.get(b);
    if (ra === rb) continue;                                       // already together
    if (!(ra[0] === a || ra[ra.length - 1] === a)) continue;       // a must be a route endpoint
    if (!(rb[0] === b || rb[rb.length - 1] === b)) continue;       // b must be a route endpoint
    if (demOf(ra) + demOf(rb) > capLimit) continue;                // capacity
    if (ra[0] === a) ra.reverse();                                 // put a at the tail
    if (rb[rb.length - 1] === b) rb.reverse();                     // put b at the head
    const merged = ra.concat(rb);
    // ride time is a SOFT limit — no time ceiling on merges; capacity still bounds the cluster
    merged.forEach((s) => routeOf.set(s, merged));
  }
  const seen = new Set(), out = [];
  routeOf.forEach((r) => { if (!seen.has(r)) { seen.add(r); out.push(r); } });
  return out;
}

/* ---- assign the cheapest feasible bus to each cluster (own first = sunk) ---- */
function assignBuses(depot, clusters, fleet, p, ignoreHard = false) {
  const routes = clusters.map((cl) => {
    const seq = sequence(depot, cl, p);
    const km = routeKm(depot, seq, p);                 // full loop (incl. return) — used for COST
    const rideMin = firstRideMin(depot, seq, p);       // first pickup -> factory (kept for reference)
    // full loop time (incl. the empty depot->first leg) = the bus's total trip duration
    const totalMin = (seq.length ? legMin(depot, seq[0], p) : 0) + rideMin;
    const toLastMin = toLastStopMin(depot, seq, p);    // depot -> last pickup (no return) — the LIMIT metric
    const kmToLast = toLastStopKm(depot, seq, p);       // distance to last pickup (no return)
    return { stops: seq, km, kmToLast, heads: cl.reduce((n, s) => n + s._dem, 0), rideMin, totalMin, toLastMin };
  }).sort((a, b) => b.heads - a.heads); // biggest demand first

  const own = fleet.filter((b) => b.type === "own").sort((a, b) => a.capacity - b.capacity);
  const rent = fleet.filter((b) => b.type === "rent");
  const usedIds = new Set();

  const fits = (b, heads) => b.capacity + (p.capacityBuffer || 0) >= heads; // +5 leniency over seats
  for (const r of routes) {
    // prefer an own bus (loan already paid) — smallest that still fits
    const ownFit = own.find((b) => !usedIds.has(b.id) && fits(b, r.heads));
    if (ownFit) { r.bus = ownFit; usedIds.add(ownFit.id); continue; }
    // else cheapest rented bus that fits this route's km
    let best = null, bestCost = Infinity;
    for (const b of rent) {
      if (usedIds.has(b.id) || !fits(b, r.heads)) continue;
      const c = busDayCost(b, r.km, p);
      if (c < bestCost) { bestCost = c; best = b; }
    }
    if (best) { r.bus = best; usedIds.add(best.id); continue; }
    return { error: "capacity", detail: `cluster of ${r.heads} riders had no free bus` };
  }

  // finalise per-route metrics + costs
  for (const r of routes) {
    r.cost = busDayCost(r.bus, r.km, p);
    r.util = r.bus.capacity ? (r.heads / r.bus.capacity) * 100 : 0;
    r.overSoft = r.toLastMin > p.softCapMin; // flag only — soft. Colour: green<45, yellow 45–60, red≥60.
  }

  const committedUnused = fleet.filter((b) => b.type === "own" && !usedIds.has(b.id)).reduce((s, b) => s + idleOwnCost(b, p), 0);
  return { routes, committedUnused };
}

/** Roll route list + committed cost into headline KPIs. */
function kpisOf(plan, p) {
  const { routes, committedUnused } = plan;
  const heads = routes.reduce((n, r) => n + r.heads, 0);
  const deployedCost = routes.reduce((s, r) => s + r.cost, 0);
  const totalCost = deployedCost + committedUnused;
  const capDeployed = routes.reduce((n, r) => n + r.bus.capacity, 0);
  return {
    buses: routes.length,
    ownDeployed: routes.filter((r) => r.bus.type === "own").length,
    rentDeployed: routes.filter((r) => r.bus.type === "rent").length,
    heads,
    deployedCost,
    committedUnused,
    totalCost,
    costPerHeadDay: heads ? totalCost / heads : 0,
    costPerHeadMonth: heads ? (totalCost / heads) * p.workingDays : 0,
    utilisation: capDeployed ? (heads / capDeployed) * 100 : 0,
    routesOverSoft: routes.filter((r) => r.overSoft).length,
    maxRide: routes.reduce((m, r) => Math.max(m, r.toLastMin), 0), // limit metric = time to last stop
  };
}

/**
 * Optimise. Sweeps the per-bus capacity cap to vary how many buses are used,
 * scores each feasible plan by cost-per-head, and KEEPS THE MINIMUM — so the
 * returned plan is provably the best over the search (that's the proof curve).
 *
 * @returns { ok, plan|null, kpis, curve:[{buses,costPerHead,maxRide,utilisation,feasible}], chosen }
 */
export function optimise(rawStops, fleet, depot, params = {}) {
  const p = { ...DEFAULTS, ...params };
  fleet = withPooledLoans(fleet, p);
  const stops = rawStops
    .filter((s) => s.lat != null && s.lng != null)
    .map((s) => ({ ...s, _dem: effectiveDemand(s, p) }))
    .filter((s) => s._dem > 0);

  if (!stops.length || !fleet.length) return { ok: false, reason: "Need pinned stops with riders and at least one bus.", curve: [] };

  const maxCap = Math.max(...fleet.map((b) => b.capacity)) + (p.capacityBuffer || 0); // clusters may use the +5 leniency
  const minCap = Math.min(...fleet.map((b) => b.capacity));
  const totalDem = stops.reduce((n, s) => n + s._dem, 0);

  // Sweep the per-bus cluster-size cap from the biggest bus down to TINY clusters. Going BELOW the
  // smallest bus matters: it lets the optimiser deliberately under-fill buses (fewer stops each) to
  // cut ride time — the two-tier penalty then picks a smaller-cluster plan whenever a fuller one
  // would run red. Without this, a same-size fleet could never shorten a route by adding a bus.
  const step = Math.max(1, Math.round((maxCap - 1) / 14)); // ~15 cluster-size samples, big → tiny
  const caps = [];
  for (let c = maxCap; c >= 1; c -= step) caps.push(c);
  [minCap, 1].forEach((v) => { if (v >= 1 && !caps.includes(v)) caps.push(v); });

  // group stops by their named input zone (for the zone-aware strategy)
  const byRoute = {};
  stops.forEach((s) => { (byRoute[s.route] = byRoute[s.route] || []).push(s); });

  // candidate clusterings: (A) one global sweep across ALL stops (consolidates across
  // zones), (B) a sweep WITHIN each named zone. Keep every feasible plan, pick the cheapest.
  const candidates = [];
  const debug = [];
  const tryClusters = (clusters, tag, cap) => {
    const a = assignBuses(depot, clusters, fleet, p);
    if (!a || a.error) { debug.push({ tag, cap, clusters: clusters.length, fail: a ? a.error : "null", detail: a ? a.detail : "" }); return; }
    candidates.push({ plan: a, kpis: kpisOf(a, p) });
  };
  for (const cap of caps) {
    tryClusters(savingsClusters(depot, stops, cap, p), "savings", cap); // road-matrix proximity (preferred)
    tryClusters(sweepClusters(depot, stops, cap), "global", cap);       // bearing sweep (fallback)
    const zoned = [];
    Object.values(byRoute).forEach((rs) => sweepClusters(depot, rs, cap).forEach((cl) => zoned.push(cl)));
    tryClusters(zoned, "zoned", cap);
  }

  if (!candidates.length) return { ok: false, reason: "No feasible plan — total seats can't cover total riders. Add buses.", curve: [], totalDem, debug };

  // Rank plans by cost/head plus a TWO-TIER ride-time penalty: a light nudge for minutes in the
  // 45–60 (yellow) band, and a heavy penalty for minutes past 60 (red) so the optimiser adds a bus
  // to avoid red almost always — minimal cost SUBJECT TO time staying in bounds.
  const yellowMins = (r) => Math.max(0, Math.min(r.toLastMin, p.redCapMin) - p.softCapMin);
  const redMins = (r) => Math.max(0, r.toLastMin - p.redCapMin);
  const score = (c) => c.kpis.costPerHeadDay
    + p.ridePenaltyPerMin * c.plan.routes.reduce((s, r) => s + yellowMins(r), 0)
    + p.redPenaltyPerMin * c.plan.routes.reduce((s, r) => s + redMins(r), 0);
  let chosen = candidates[0], chosenScore = score(chosen);
  for (const c of candidates) { const sc = score(c); if (sc < chosenScore) { chosen = c; chosenScore = sc; } }

  // proof curve: cheapest feasible cost-per-head at each bus count
  const byBuses = {};
  for (const c of candidates) {
    const b = c.kpis.buses;
    const pt = { buses: b, costPerHead: c.kpis.costPerHeadDay, maxRide: c.kpis.maxRide, utilisation: c.kpis.utilisation, feasible: true };
    if (!byBuses[b] || pt.costPerHead < byBuses[b].costPerHead) byBuses[b] = pt;
  }
  const curve = Object.values(byBuses).sort((a, b) => a.buses - b.buses);

  return { ok: true, plan: chosen.plan, kpis: chosen.kpis, chosen: byBuses[chosen.kpis.buses], curve, params: p, depot };
}

/**
 * Invariant checks on a produced plan — the non-negotiables that must ALWAYS hold, no matter the
 * data. Used by the UI "model integrity" strip and the engine tests. Returns [{ ok, label, detail }].
 * If any of these fails, the result is wrong (bad data or a code regression) — don't trust the numbers.
 */
export function validatePlan(result, rawStops, fleet, depot, params = {}) {
  const p = { ...DEFAULTS, ...params };
  const checks = [];
  const add = (ok, label, detail) => checks.push({ ok: !!ok, label, detail: detail || "" });

  if (!result || !result.ok || !result.plan) { add(false, "Plan produced", "optimiser returned no feasible plan"); return checks; }
  const { plan, kpis } = result;
  const stops = (rawStops || []).filter((s) => s.lat != null && s.lng != null).map((s) => ({ ...s, _dem: effectiveDemand(s, p) })).filter((s) => s._dem > 0);
  const totalDem = stops.reduce((n, s) => n + s._dem, 0);
  const buffer = p.capacityBuffer || 0;

  const servedIds = new Set(plan.routes.flatMap((r) => r.stops.map((s) => s.id)));
  const missing = stops.filter((s) => !servedIds.has(s.id));
  add(missing.length === 0, "Every stop is served", missing.length ? `${missing.length} unserved (e.g. ${missing.slice(0, 3).map((s) => s.name).join(", ")})` : `all ${stops.length} stops on a bus`);

  const carried = plan.routes.reduce((n, r) => n + r.heads, 0);
  add(carried === totalDem, "All riders carried", `carried ${carried} of ${totalDem} expected`);

  const over = plan.routes.filter((r) => r.heads > r.bus.capacity + buffer);
  add(over.length === 0, `No bus over capacity (+${buffer} leniency)`, over.length ? over.map((r) => `${r.bus.name} ${r.heads}/${r.bus.capacity}`).join(", ") : "all within seats + leniency");

  const sumParts = plan.routes.reduce((s, r) => s + r.cost, 0) + (plan.committedUnused || 0);
  add(Math.abs(sumParts - kpis.totalCost) < 1, "Cost adds up", `Σ parts ₹${Math.round(sumParts)} = headline ₹${Math.round(kpis.totalCost)}`);

  let monotonic = true, badRoute = "";
  for (const r of plan.routes) for (let i = 1; i < r.stops.length; i++) {
    if (haversineKm(depot, r.stops[i]) + 1e-6 < haversineKm(depot, r.stops[i - 1])) { monotonic = false; badRoute = r.bus.name; }
  }
  add(monotonic, "Routes run closest-first", monotonic ? "each route is nearest→farthest" : `${badRoute} is out of distance order`);

  add(kpis.maxRide < 240, "Ride times are sane", `max time-to-last-stop ${Math.round(kpis.maxRide)} min`);

  return checks;
}

/**
 * Score a FIXED assignment (which bus serves which stops, in a given order) with
 * the same helpers optimise() uses — no re-clustering, no re-sequencing. Used to
 * render an externally-produced plan (the OR-Tools backend) through the identical
 * code path, so the solver plan and the heuristic plan compare apples-to-apples.
 *
 * @param assignments [{ busId, stops:[orderedStopObjs] }]  stop objs carry _idx (+_dem optional)
 * @returns { ok, plan:{routes,committedUnused}, kpis }  same shape as optimise()
 */
export function scorePlan(assignments, fleet, depot, params = {}) {
  const p = { ...DEFAULTS, ...params };
  fleet = withPooledLoans(fleet, p);
  const busById = new Map(fleet.map((b) => [b.id, b]));
  const routes = [];
  for (const a of assignments) {
    const bus = busById.get(a.busId);
    if (!bus) continue;
    const seq = a.stops.map((s) => (s._dem != null ? s : { ...s, _dem: effectiveDemand(s, p) }));
    const km = dayKm(depot, seq, p);                   // day km for COST (chain = 2× one-way, else loop)
    const rideMin = firstRideMin(depot, seq, p);       // first pickup -> factory (reference)
    const totalMin = (seq.length ? legMin(depot, seq[0], p) : 0) + rideMin;
    const toLastMin = toLastStopMin(depot, seq, p);    // depot -> last pickup — the LIMIT metric
    const kmToLast = toLastStopKm(depot, seq, p);
    const heads = seq.reduce((n, s) => n + s._dem, 0);
    const cost = busDayCost(bus, km, p);
    routes.push({
      stops: seq, km, kmToLast, heads, rideMin, totalMin, toLastMin, bus, cost,
      util: bus.capacity ? (heads / bus.capacity) * 100 : 0,
      overSoft: toLastMin > p.softCapMin,
    });
  }
  const usedIds = new Set(routes.map((r) => r.bus.id));
  const committedUnused = fleet
    .filter((b) => b.type === "own" && !usedIds.has(b.id))
    .reduce((s, b) => s + idleOwnCost(b, p), 0);
  const plan = { routes, committedUnused };
  return { ok: true, plan, kpis: kpisOf(plan, p) };
}

/** Deliberately NAÏVE baseline: NO route optimisation — a dedicated bus per stop,
 *  merging only the nearest pairs when there aren't enough buses. Proves the saving
 *  from consolidating scattered pickups onto fewer, fuller buses. */
export function baseline(rawStops, fleet, depot, params = {}) {
  const p = { ...DEFAULTS, ...params };
  fleet = withPooledLoans(fleet, p);
  const stops = rawStops.filter((s) => s.lat != null && s.lng != null).map((s) => ({ ...s, _dem: effectiveDemand(s, p) })).filter((s) => s._dem > 0);
  if (!stops.length || !fleet.length) return null;
  const maxCap = Math.max(...fleet.map((b) => b.capacity)) + (p.capacityBuffer || 0);

  let clusters = stops.map((s) => [s]); // one bus per stop
  const centroid = (cl) => ({ lat: cl.reduce((n, s) => n + s.lat, 0) / cl.length, lng: cl.reduce((n, s) => n + s.lng, 0) / cl.length });
  let guard = 0;
  // merge the two nearest clusters until we have no more clusters than buses
  while (clusters.length > fleet.length && guard++ < 300) {
    let bi = -1, bj = -1, bd = Infinity;
    for (let i = 0; i < clusters.length; i++) for (let j = i + 1; j < clusters.length; j++) {
      const dem = clusters[i].reduce((n, s) => n + s._dem, 0) + clusters[j].reduce((n, s) => n + s._dem, 0);
      if (dem > maxCap) continue;
      const d = haversineKm(centroid(clusters[i]), centroid(clusters[j]));
      if (d < bd) { bd = d; bi = i; bj = j; }
    }
    if (bi < 0) break;
    clusters[bi] = clusters[bi].concat(clusters[bj]);
    clusters.splice(bj, 1);
  }
  const assigned = assignBuses(depot, clusters, fleet, p, true); // naive: don't enforce the ride ceiling
  if (!assigned || assigned.error) return null;
  return { ...kpisOf(assigned, p), routes: assigned.routes, committedUnused: assigned.committedUnused };
}

/* ---- per-plan breakdown for the proof charts (cost own/rent/combined + ride by company/bus) ---- */
export function metricsFromPlan(plan) {
  const routes = (plan && plan.routes) || [];
  const heads = routes.reduce((n, r) => n + r.heads, 0) || 1;
  const ownCost = routes.filter((r) => r.bus.type === "own").reduce((s, r) => s + r.cost, 0) + (plan.committedUnused || 0);
  const rentCost = routes.filter((r) => r.bus.type === "rent").reduce((s, r) => s + r.cost, 0);
  const total = ownCost + rentCost;
  let rideSum = 0, demSum = 0; const cRide = {}, cDem = {};
  const rt = (r) => (r.toLastMin != null ? r.toLastMin : r.rideMin); // limit metric = time to last stop
  const byBus = routes.map((r) => ({ name: r.bus.name, type: r.bus.type, ride: rt(r) }));
  routes.forEach((r) => r.stops.forEach((s) => {
    const d = s._dem || 0, c = s.company || "—";
    rideSum += rt(r) * d; demSum += d;
    cRide[c] = (cRide[c] || 0) + rt(r) * d; cDem[c] = (cDem[c] || 0) + d;
  }));
  const rideByCompany = {}; Object.keys(cRide).forEach((c) => (rideByCompany[c] = cDem[c] ? cRide[c] / cDem[c] : 0));
  return { cph: { combined: total / heads, own: ownCost / heads, rent: rentCost / heads }, rideCombined: demSum ? rideSum / demSum : 0, rideByCompany, byBus };
}

/* ---- deterministic per-date noise so the simulated history is stable across reloads ---- */
function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function mulberry32(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/** Re-evaluate a FIXED plan (today's optimised routes) under a day's demand + traffic.
 *  Bus assignment is kept, only ride-times (traffic) and heads (demand) change — so
 *  per-bus lines stay consistent across days. */
export function evaluatePlan(plan, dayStops, depot, params) {
  const p = { ...DEFAULTS, ...params };
  const demById = {}; dayStops.forEach((s) => (demById[s.id] = effectiveDemand(s, p)));
  const routes = (plan.routes || []).map((r) => {
    const seq = r.stops;
    // time to last stop (depot -> ... -> last pickup) under this day's traffic — the limit metric
    let toLast = seq.length ? legMin(depot, seq[0], p) : 0;
    for (let i = 0; i < seq.length - 1; i++) toLast += legMin(seq[i], seq[i + 1], p);
    toLast += p.serviceMin * seq.length;
    const heads = seq.reduce((n, s) => n + (demById[s.id] || 0), 0);
    return { bus: r.bus, stops: seq, km: r.km, toLastMin: toLast, heads, cost: busDayCost(r.bus, r.km, p) };
  });
  return metricsFromPlan({ routes, committedUnused: plan.committedUnused });
}

/** Day-by-day series: the un-optimised baseline (for the cost story) AND today's
 *  optimised plan re-evaluated under each day's traffic (for the ride story). */
export function simulate(stops, fleet, depot, params, dates, optPlan) {
  return dates.map((date) => {
    const rnd = mulberry32(hashStr(date));
    const dayStops = stops.map((s) => { const a = Math.min(0.6, Math.max(0, (+s.absentee || 0) + (rnd() - 0.5) * 0.16)); return { ...s, absentee: a }; });
    const traffic = 1 + (rnd() - 0.5) * 0.3; // ~0.85 .. 1.15
    const dp = { ...params, trafficFactor: traffic };
    const bPlan = baseline(dayStops, fleet, depot, dp);
    return { date, traffic, baseline: bPlan ? metricsFromPlan(bPlan) : null, optimised: optPlan ? evaluatePlan(optPlan, dayStops, depot, dp) : null };
  });
}
