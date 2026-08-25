/* ============================================================================
 * build_service_plans.mjs — run the optimiser for ONE service, headlessly.
 *
 * The Planner runs engine.optimise() in the browser against whatever service is
 * open. This does the same thing from Node so every service can get a finalised
 * plan without anyone clicking through four boards — and so three services can be
 * planned CONCURRENTLY, one process each (engine.optimise is synchronous and
 * CPU-bound, so real concurrency needs separate processes, not Promise.all).
 *
 * Output is solver_result-shaped (same as planExport.toSolverResult), which is what
 * `planUrl` consumers — the Timings clock and the Fleet-plan board — already read.
 *
 * Rider identity: ONE ROW PER EMPLOYEE, taking their most recent record. The ERP
 * feed carries ~11 days of punches, and `date` is a DD-MM-YYYY *string*, so sorting
 * it lexicographically puts 31-07-2026 after 10-08-2026. Dates are parsed properly
 * here; getting this wrong silently plans for the wrong 10% of the roster.
 *
 * Usage:
 *   node build_service_plans.mjs --service s7 [--erp data/erp_live.fresh.json]
 *   node build_service_plans.mjs --service zen
 * ==========================================================================*/
import fs from "node:fs";
import { optimise, validatePlan, haversineKm, scorePlan } from "./src/optimiser/engine.js";
import { stopsForRiders } from "./src/optimiser/serviceStops.js";
import { SERVICES, FACTORY_DEPOT, ZENWEAR_DEPOT } from "./src/optimiser/services.js";
import FROZEN_ROTA from "./src/rotationalRoster.json" with { type: "json" };

const arg = (k, d = null) => {
  const i = process.argv.indexOf(k);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d;
};
const SVC_ID = arg("--service");
const ERP = arg("--erp", "data/erp_live.fresh.json");
const OUT_DIR = arg("--out-dir", "public");
if (!SVC_ID) { console.error("need --service <id>"); process.exit(2); }
const svc = SERVICES.find((s) => s.id === SVC_ID);
if (!svc) { console.error(`unknown service ${SVC_ID}`); process.exit(2); }

const log = (...a) => console.log(`[${SVC_ID}]`, ...a);
const norm = (s) => (s == null ? "" : String(s).trim());

/* DD-MM-YYYY (with an optional time tail) -> epoch ms. Returns 0 when unparseable so
   a malformed row can never win the "most recent" comparison. */
function parseErpDate(s) {
  const m = norm(s).match(/^(\d{2})-(\d{2})-(\d{4})/);
  if (!m) return 0;
  return Date.UTC(+m[3], +m[2] - 1, +m[1]);
}

/* Unit label the way services.js expects it (erpUnit: "Zenwear"). */
function unitOf(row) {
  const c = norm(row.Comp_New).toUpperCase();
  if (c.includes("ZENWEAR")) return "Zenwear";
  if (c.includes("TECHNOTEK")) return "Technotek";
  return "Gainup";
}
/* Unit beats shift — mirrors serviceIdFor() so the split matches the dashboard exactly.
   `slot` is the rider's frozen roster slot, which is what separates Rotational's three services. */
function serviceOf(row, slot) {
  const u = unitOf(row);
  const byUnit = SERVICES.find((s) => s.erpUnit && s.erpUnit === u);
  if (byUnit) return byUnit.id;
  const sh = norm(row.Shift);
  const byShift = SERVICES.filter((s) => s.erpShift && s.erpShift === sh);
  if (!byShift.length) return null;
  if (byShift.length === 1) return byShift[0].id;
  const bySlot = byShift.find((s) => s.erpSlot && s.erpSlot === norm(slot));
  return bySlot ? bySlot.id : null;
}

// ---------------------------------------------------------------- riders
log(`reading ${ERP} …`);
const rows = JSON.parse(fs.readFileSync(ERP, "utf8"));
const latestPerEmp = new Map();
/* Attendance over the whole feed, not just the latest day: `Att_Type` is "1-Present" /
   "2-Absent" (the same test erp.js uses). One day's punch says nothing about how often
   a seat actually goes empty; ~11 days does. */
const att = new Map();
/* vehicle -> riders per service, so a shared bus's cost can be split by actual use */
const busUse = new Map();
/* Counted per rider-DAY, not per row, and only on days the factory actually ran — the same
   two corrections erp.js makes, because a plan built on a different absentee rate than the
   dashboard shows is a plan nobody can reconcile.
     - the feed repeats rows (11,488 of 61,457 in the 25-Aug pull are duplicates), and a
       duplicated present-day used to count twice;
     - it carries Sundays, when ~87% are marked absent because nobody is rostered, and the
       newest date, which is the pull day and still in progress.
   Together those overstated absentee by 8.2 points, and since demand is
   ceil(head x (1 - absentee + buffer)) that UNDER-provisioned every stop. */
const empDays = new Map();                       // emp -> Map(date -> presentBool)
for (const r of rows) {
  const e = norm(r.Empl_no);
  if (!e) continue;
  const t = parseErpDate(r.date);
  const prev = latestPerEmp.get(e);
  if (!prev || t > prev.t) latestPerEmp.set(e, { t, r });
  const d = norm(r.date).slice(0, 10);
  if (!d) continue;
  const days = empDays.get(e) || new Map();
  days.set(d, /present/i.test(norm(r.Att_Type)) || days.get(d) === true);
  empDays.set(e, days);
}
const dayTotals = new Map();
for (const days of empDays.values())
  for (const [d, p] of days) {
    const c = dayTotals.get(d) || { present: 0, n: 0 };
    c.n++; if (p) c.present++;
    dayTotals.set(d, c);
  }
const dates = [...dayTotals.keys()].sort((x, y) => parseErpDate(x) - parseErpDate(y));
const pullDate = dates[dates.length - 1];
const WORKED = new Set(dates.filter((d) => d !== pullDate && dayTotals.get(d).n && dayTotals.get(d).present / dayTotals.get(d).n >= 0.5));
for (const [e, days] of empDays) {
  let absent = 0, n = 0;
  for (const [d, p] of days) { if (!WORKED.has(d)) continue; n++; if (!p) absent++; }
  att.set(e, { absent, days: n });
}
log(`absentee measured over ${WORKED.size} working day(s); dropped ${dates.length - WORKED.size} (Sundays + the pull date ${pullDate})`);
/* Rotational slot per rider: read from the FROZEN roster, exactly as the dashboard does.
   Not from Pun_Shift — that says which slot a rider was on in the week they punched, and the
   rota moves one place every Monday, so building from it would cut these plans against a
   different roster every week. Plan and dashboard must be one roster or neither is trustworthy.
   To re-cut the split, re-freeze src/rotationalRoster.json and rebuild all three together. */
const slotOfEmp = (e) => FROZEN_ROTA.slots[e] || "";

const absenteeOf = (emp) => {
  const a = att.get(emp);
  return a && a.days ? a.absent / a.days : 0;
};
for (const { r } of latestPerEmp.values()) {
  const v = norm(r.VehName) || norm(r.Veh_Mas);
  const s = serviceOf(r, slotOfEmp(norm(r.Empl_no)));
  if (!v || !s) continue;
  if (!busUse.has(v)) busUse.set(v, new Map());
  const m = busUse.get(v);
  m.set(s, (m.get(s) || 0) + 1);
}
const mine = [...latestPerEmp.values()].map((x) => x.r).filter((r) => serviceOf(r, slotOfEmp(norm(r.Empl_no))) === SVC_ID);
log(`${latestPerEmp.size} employees in feed · ${mine.length} belong to ${svc.name}`);

const riders = [];
for (const r of mine) {
  const la = parseFloat(norm(r.Latitude)), ln = parseFloat(norm(r.Longitude));
  if (!isFinite(la) || !isFinite(ln) || la === 0 || ln === 0) continue;
  riders.push({
    id: norm(r.Empl_no), name: norm(r.Name) || norm(r.Empl_no),
    lat: la, lng: ln,
    locality: norm(r.Locality) || norm(r.Village) || norm(r.Area),
    busId: norm(r.VehName) || norm(r.Veh_Mas),
    absentee: absenteeOf(norm(r.Empl_no)),
  });
}
const meanAbs = riders.reduce((s, r) => s + r.absentee, 0) / (riders.length || 1);
log(`${riders.length} of ${mine.length} riders have usable GPS · mean absentee ${(meanAbs * 100).toFixed(1)}%`);
if (!riders.length) { console.error(`[${SVC_ID}] no GPS riders — cannot plan`); process.exit(1); }

// ---------------------------------------------------------------- stops
const depot = svc.id === "zen" ? ZENWEAR_DEPOT : FACTORY_DEPOT;
/* --allocated: plan a seat for every rider ON THE BOOKS, not the attendance-adjusted figure.
   effectiveDemand() is ceil(head x (1 - absentee + buffer)); zeroing both terms makes it
   exactly the registered headcount, so a bus is sized for everyone allotted to it rather
   than for who typically turns up. */
const ALLOCATED = process.argv.includes("--allocated");
const MERGE_M = +arg("--merge-m", "0");
const stops = stopsForRiders(riders, [], { depot, mergeM: MERGE_M });
if (ALLOCATED) stops.forEach((s) => { s.absentee = 0; });
log(`${stops.length} stops derived (${MERGE_M ? `merged at ${MERGE_M} m` : "unmerged: one per distinct home GPS"})`);

// ---------------------------------------------------------------- fleet
/* The buses the ERP already has this service's riders on. Capacity is the ERP `Seat`;
   a vehicle with no seat count would silently become a zero-capacity bus that can carry
   nobody, so those fall back to the commonest capacity rather than breaking the solve. */
const busSeen = new Map();
for (const r of mine) {
  const v = norm(r.VehName) || norm(r.Veh_Mas);
  if (!v) continue;
  const seat = parseInt(norm(r.Seat), 10);
  const rent = /rent/i.test(norm(r.Type));
  const b = busSeen.get(v) || { name: v, seats: [], rent };
  if (isFinite(seat) && seat > 0) b.seats.push(seat);
  b.rent = b.rent || rent;
  busSeen.set(v, b);
}
const capCount = {};
[...busSeen.values()].forEach((b) => b.seats.forEach((s) => { capCount[s] = (capCount[s] || 0) + 1; }));
const modalCap = +(Object.entries(capCount).sort((a, b) => b[1] - a[1])[0] || [40])[0];
const OWN = { loanMonth: 35000, driverDay: 800, maintDay: 280, dieselPerKm: 22 };

/* --share-costs: a bus that also runs another service should not be charged to this one
   twice. 8 of 7 am Morning's 9 buses also run the 9 am or Rotational service, and 7 am is
   only 15% of their riders — charging it their whole daily cost overstates it ~6.6x and
   makes a shared fleet look far more expensive per head than it is.

   Only the STANDING costs are shared (one loan, one driver, one vehicle, several runs a
   day). Diesel is not: each service's run burns its own fuel over its own kilometres, so
   dieselPerKm and the rental slab are left alone. */
/* --no-standing: an owned bus's loan, driver salary and maintenance are paid whether or not
   it turns a wheel today, so they are sunk and say nothing about which plan is better. This
   charges owned buses their RUNNING cost only (diesel x km). Rental slabs are untouched —
   hiring a van is a real daily outlay that stops the moment you stop hiring it. */
const NO_STANDING = process.argv.includes("--no-standing");
const SHARE = process.argv.includes("--share-costs");
const shareOf = (vehName) => {
  const tally = busUse.get(vehName);
  if (!tally) return 1;
  const total = [...tally.values()].reduce((a, b) => a + b, 0);
  return total ? (tally.get(SVC_ID) || 0) / total : 1;
};
const fleet = [...busSeen.values()].map((b, i) => {
  const cap = b.seats.length ? Math.max(...b.seats) : modalCap;
  if (b.rent) return { id: "b" + i, name: b.name, type: "rent", capacity: cap, slabFixed: 1700, slabKm: 80, perKmBeyond: 18.7 };
  const f = (SHARE ? shareOf(b.name) : 1) * (NO_STANDING ? 0 : 1);
  return { id: "b" + i, name: b.name, type: "own", capacity: cap, ...OWN,
    loanMonth: OWN.loanMonth * f, driverDay: OWN.driverDay * f, maintDay: OWN.maintDay * f };
});
if (NO_STANDING) log(`standing costs EXCLUDED — owned buses charged diesel only (₹${OWN.dieselPerKm}/km); rentals unchanged`);
if (SHARE) {
  const shares = [...busSeen.keys()].map(shareOf);
  const mean = shares.reduce((a, b) => a + b, 0) / (shares.length || 1);
  log(`cost sharing ON — this service is ${(mean * 100).toFixed(0)}% of its buses' use on average; ` +
      `standing costs scaled to that, diesel left whole`);
}
const seats = fleet.reduce((s, b) => s + b.capacity, 0);
const heads = stops.reduce((s, x) => s + x.headcount, 0);
log(`${fleet.length} buses from the ERP · ${seats} seats for ${heads} riders`);

// ---------------------------------------------------------------- road matrix
/* Real Google road km/min where the stop matches a matrix node; the engine falls back to
   haversine×roadFactor for any stop it cannot place, so a partial match still plans. */
const matrixFile = svc.id === "zen" ? "public/road_matrix_zenwear.json" : "public/road_matrix.json";
let metric = null, matched = 0;
if (fs.existsSync(matrixFile)) {
  const m = JSON.parse(fs.readFileSync(matrixFile, "utf8"));
  const nodes = m.nodes;
  const idxOf = (p) => {
    let best = -1, bestD = 0.25;                 // 250 m — same spirit as COVER_M
    for (let i = 0; i < nodes.length; i++) {
      const d = haversineKm(p, nodes[i]);
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  };
  stops.forEach((s) => { const i = idxOf(s); if (i >= 0) { s._idx = i; matched++; } });
  const dIdx = idxOf(depot);
  if (dIdx >= 0) depot._idx = dIdx;
  metric = { km: (i, j) => m.km[i][j], min: (i, j) => m.min[i][j] };
  log(`matrix ${matrixFile} (${nodes.length} nodes) — ${matched}/${stops.length} stops matched to a real node`);
} else {
  log(`no matrix at ${matrixFile} — planning on haversine estimates`);
}

// ---------------------------------------------------------------- solve
/* Cost and ride time pull against each other: fewer buses spread the fixed cost over more
   heads but lengthen every route. engine.optimise() resolves that with one fixed penalty
   setting, which hides the trade-off. Sweeping the penalties walks the frontier, so a plan
   can be chosen against a real target instead of whatever the defaults happen to prefer. */
const MAX_AVG_RIDE = arg("--max-avg-ride") ? +arg("--max-avg-ride") : null;
const MAX_RIDE = arg("--max-ride") ? +arg("--max-ride") : null;
const TARGET_CPH = arg("--target-cost-head") ? +arg("--target-cost-head") : null;
const PICK_OPT = arg("--pick") ? +arg("--pick") : null;

const rideStats = (r) => {
  const rs = r.plan.routes;
  const heads = rs.reduce((s, x) => s + x.heads, 0) || 1;
  const own = rs.filter((x) => x.bus.type === "own");
  const rent = rs.filter((x) => x.bus.type === "rent");
  const sum = (list, f) => list.reduce((s, x) => s + f(x), 0);
  return {
    buses: rs.length,
    own: own.length, ownSeats: sum(own, (x) => x.bus.capacity), ownCost: Math.round(sum(own, (x) => x.cost)),
    rent: rent.length, rentSeats: sum(rent, (x) => x.bus.capacity), rentCost: Math.round(sum(rent, (x) => x.cost)),
    cph: r.kpis.costPerHeadDay,
    cost: Math.round(sum(rs, (x) => x.cost)),
    avgRide: sum(rs, (x) => x.toLastMin * x.heads) / heads,
    maxRide: rs.reduce((m, x) => Math.max(m, x.toLastMin), 0),
    util: r.kpis.utilisation,
  };
};

log("optimising …");
const t0 = Date.now();
const base = { ...(metric ? { metric } : {}), ...(ALLOCATED ? { absenteeBuffer: 0 } : {}) };
if (ALLOCATED) log(`planning for ALLOCATED headcount — every registered rider gets a seat`);
let live = optimise(stops, fleet, depot, base);
if (!live.ok) { console.error(`[${SVC_ID}] optimiser failed: ${live.reason}`); process.exit(1); }

if (MAX_AVG_RIDE || MAX_RIDE || TARGET_CPH || PICK_OPT) {
  const settings = [];
  for (const rp of [0, 0.1, 0.3, 1, 3]) for (const red of [0, 1, 5, 15, 60]) settings.push({ rp, red });
  const seen = new Map();
  for (const { rp, red } of settings) {
    const r = optimise(stops, fleet, depot, { ...base, ridePenaltyPerMin: rp, redPenaltyPerMin: red });
    if (!r.ok) continue;
    const st = rideStats(r);
    const k = st.buses + ":" + Math.round(st.cph);
    if (!seen.has(k)) seen.set(k, { st, r });
  }
  const all = [...seen.values()].sort((a, b) => a.st.cph - b.st.cph);
  log(`OPTIONS for ${svc.name} — ${all.length} distinct plans:`);
  log(`   ${"#".padStart(3)}  buses   owned (seats)   rental (seats)   ₹/head    ₹/day   avg ride  max ride  util   fits?`);
  all.forEach(({ st }, i) => {
    const ok = (!MAX_AVG_RIDE || st.avgRide <= MAX_AVG_RIDE) && (!MAX_RIDE || st.maxRide <= MAX_RIDE);
    log(`   ${String(i + 1).padStart(3)}  ${String(st.buses).padStart(5)}   ` +
        `${String(st.own).padStart(5)} (${String(st.ownSeats).padStart(4)})   ` +
        `${String(st.rent).padStart(6)} (${String(st.rentSeats).padStart(4)})   ` +
        `₹${st.cph.toFixed(1).padStart(6)}  ${String(st.cost).padStart(7)}   ` +
        `${st.avgRide.toFixed(1).padStart(6)}    ${String(Math.round(st.maxRide)).padStart(6)}  ` +
        `${st.util.toFixed(0).padStart(4)}%   ${ok ? "✓" : "—"}`);
  });
  const PICK = PICK_OPT;
  if (PICK && all[PICK - 1]) {
    live = all[PICK - 1].r;
    const st = all[PICK - 1].st;
    log(`picked option ${PICK}: ${st.buses} buses · ₹${st.cph.toFixed(1)}/head · avg ${st.avgRide.toFixed(1)} min · max ${Math.round(st.maxRide)} min`);
  } else {
  const feasible = all.filter((x) =>
    (!MAX_AVG_RIDE || x.st.avgRide <= MAX_AVG_RIDE) && (!MAX_RIDE || x.st.maxRide <= MAX_RIDE));
  if (!feasible.length) {
    log(`NO plan satisfies the ride limits — keeping the default plan.`);
  } else {
    live = feasible[0].r;                       // cheapest that respects the ride ceiling
    const st = feasible[0].st;
    log(`chose ${st.buses} buses · ₹${st.cph.toFixed(1)}/head · avg ${st.avgRide.toFixed(1)} min · max ${Math.round(st.maxRide)} min`);
    if (TARGET_CPH && st.cph > TARGET_CPH) {
      log(`TARGET MISSED: ₹${st.cph.toFixed(1)}/head vs target ₹${TARGET_CPH} — ` +
          `cheapest ride-feasible plan on this fleet.`);
    }
  }
  }
}

/* --trim-worst: the optimiser picks a whole plan by total cost, so one route can end up far
   longer than the rest without that showing in the average. This shaves the WORST route
   specifically — moving its stops onto buses with slack, keeping every capacity limit — and
   accepts a move only when the longest ride in the whole plan actually drops. Cost is allowed
   to drift slightly; the point is the outlier, not the total. */
if (process.argv.includes("--trim-worst")) {
  const maxOf = (sc) => Math.max(...sc.plan.routes.map((r) => r.toLastMin));
  const clone = (a) => a.map((x) => ({ busId: x.busId, stops: [...x.stops] }));
  let asg = live.plan.routes.map((r) => ({ busId: r.bus.id, stops: [...r.stops] }));
  let cur = scorePlan(asg, fleet, depot, base);
  const before = maxOf(cur), beforeCost = cur.kpis.costPerHeadDay;
  log(`trimming the worst route (currently ${Math.round(before)} min) …`);
  const cap = (b) => b.capacity + (base.capacityBuffer != null ? base.capacityBuffer : 5);
  // MUST be haversine: validatePlan's closest-first check uses haversineKm (engine.js:432).
  // Sorting by road km instead reorders stops the checker then flags as out of order.
  const depotKm = (s) => haversineKm(depot, s);
  for (let round = 0; round < 40; round++) {
    const routes = cur.plan.routes;
    const worst = routes.reduce((m, r) => (r.toLastMin > m.toLastMin ? r : m), routes[0]);
    let moved = false;
    for (const stop of [...worst.stops]) {
      for (const target of routes) {
        if (target.bus.id === worst.bus.id) continue;
        if (target.heads + stop._dem > cap(target.bus)) continue;
        for (let pos = 0; pos < 1; pos++) {
          const trial = clone(asg);
          const wa = trial.find((a) => a.busId === worst.bus.id);
          const ta = trial.find((a) => a.busId === target.bus.id);
          const i = wa.stops.findIndex((s) => s.id === stop.id);
          if (i < 0) continue;
          wa.stops.splice(i, 1);
          ta.stops.push(stop);
          // The engine asserts every route runs closest-first; dropping a stop in at an
          // arbitrary index breaks that invariant and fails validatePlan. Re-sort instead.
          ta.stops.sort((x, y) => depotKm(x) - depotKm(y));
          if (!wa.stops.length) continue;              // don't empty a bus off the plan
          const sc = scorePlan(trial, fleet, depot, base);
          if (maxOf(sc) < maxOf(cur) - 0.01) { asg = trial; cur = sc; moved = true; break; }
        }
        if (moved) break;
      }
      if (moved) break;
    }
    if (!moved) break;
  }
  const after = maxOf(cur);
  log(`worst route ${Math.round(before)} → ${Math.round(after)} min` +
      (after < before ? ` (−${Math.round(before - after)} min)` : ` (no improvement found)`) +
      ` · ₹${beforeCost.toFixed(1)} → ₹${cur.kpis.costPerHeadDay.toFixed(1)}/head`);
  if (after < before) live = cur;
}
log(`solved in ${((Date.now() - t0) / 1000).toFixed(1)}s — ${live.kpis.buses} buses, ` +
    `₹${Math.round(live.kpis.costPerHeadDay)}/head/day, max ride ${Math.round(live.kpis.maxRide)} min`);

const checks = validatePlan(live, stops, fleet, depot, base);
checks.filter((c) => !c.ok).forEach((c) => log(`  ⚠ FAILED: ${c.label} — ${c.detail}`));
const failed = checks.filter((c) => !c.ok).length;
log(`integrity: ${checks.length - failed}/${checks.length} checks pass`);

// ---------------------------------------------------------------- write
const round1 = (n) => Math.round((n || 0) * 10) / 10;
const road = (a, b) => haversineKm(a, b) * 1.3;
const routes = (live.plan.routes || []).map((r) => {
  const first = r.stops[0], last = r.stops[r.stops.length - 1];
  return {
    name: r.bus.name, type: r.bus.type, cap: r.bus.capacity,
    stops: r.stops.length, riders: r.heads,
    km: round1(r.km), ride: Math.round(r.toLastMin),
    km_to_last: first ? round1(road(depot, first)) : 0,
    km_to_farthest: last ? round1(road(depot, last)) : 0,
    cost: Math.round(r.cost),
    seq: r.stops.map((s) => ({ name: s.name, lat: s.lat, lng: s.lng, hc: +s.headcount || 0 })),
  };
});
const agg = (list) => {
  const rid = list.reduce((s, r) => s + r.riders, 0);
  const st = list.reduce((s, r) => s + r.cap, 0);
  const cost = list.reduce((s, r) => s + r.cost, 0);
  const km = list.reduce((s, r) => s + r.km, 0);
  const rw = rid || 1;
  return {
    buses: list.length, riders: rid, seats: st, cost: Math.round(cost), km: round1(km),
    util: st ? +((rid / st) * 100).toFixed(1) : 0,
    cost_head: +(cost / rw).toFixed(1),
    avg_ride: +(list.reduce((s, r) => s + r.ride * r.riders, 0) / rw).toFixed(1),
    avg_stops: +(list.reduce((s, r) => s + r.stops, 0) / (list.length || 1)).toFixed(1),
    max_ride: list.reduce((m, r) => Math.max(m, r.ride), 0),
  };
};
const payload = {
  generatedBy: "build_service_plans.mjs (headless engine.optimise)",
  method: "optimiser — capacity sweep, cheapest cost/head with ride-time penalty",
  service: { id: svc.id, name: svc.name, depot: { name: depot.name, lat: depot.lat, lng: depot.lng } },
  generated: new Date().toISOString().slice(0, 10),
  matrix: { file: matrixFile, stops_matched: matched, stops_total: stops.length },
  /* How this plan's ₹/head was charged. Recorded because it is NOT comparable across
     plans that used a different basis: finalised_plan.json bills its buses in full, so
     its ₹58/head and a shared-cost ₹83/head are measuring different things. */
  costing: NO_STANDING
    ? { basis: "running-only", standing: false, shared: SHARE,
        note: "owned buses charged diesel only — loan, driver and maintenance treated as sunk. NOT comparable to a plan that includes them." }
    : SHARE
      ? { basis: "shared", standing: true, shared: true,
          note: "standing costs split by each bus's rider share across services; diesel charged whole" }
      : { basis: "full", standing: true, shared: false,
          note: "every bus charged 100% to this service, even when it also runs another" },
  integrity: { checks: checks.length, failed },
  /* `depot` is [lat, lng] — the Fleet-plan map reads params.depot[0]/[1] to centre itself, so
     a plan without it renders "Map unavailable". max_ride/soft_ride feed the KPI explainers. */
  params: { demand: live.kpis.heads, stops: routes.reduce((s, r) => s + r.stops, 0),
            totalRiders: riders.length, depot: [depot.lat, depot.lng],
            max_ride: Math.round(live.params ? live.params.hardCapMin : 600),
            soft_ride: Math.round(live.params ? live.params.softCapMin : 45) },
  overall: agg(routes),
  owned: agg(routes.filter((r) => r.type === "own")),
  rental: agg(routes.filter((r) => r.type === "rent")),
  routes,
};
const out = `${OUT_DIR}/plan_${svc.id}.json`;
fs.writeFileSync(out + ".tmp", JSON.stringify(payload, null, 1));
fs.renameSync(out + ".tmp", out);
log(`wrote ${out} — ${routes.length} routes, ${payload.overall.riders} riders, ₹${payload.overall.cost_head}/head`);
