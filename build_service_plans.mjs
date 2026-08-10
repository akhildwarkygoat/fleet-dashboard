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
import { optimise, validatePlan, haversineKm } from "./src/optimiser/engine.js";
import { stopsForRiders } from "./src/optimiser/serviceStops.js";
import { SERVICES, FACTORY_DEPOT, ZENWEAR_DEPOT } from "./src/optimiser/services.js";

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
/* Unit beats shift — mirrors serviceIdFor() so the split matches the dashboard exactly. */
function serviceOf(row) {
  const u = unitOf(row);
  const byUnit = SERVICES.find((s) => s.erpUnit && s.erpUnit === u);
  if (byUnit) return byUnit.id;
  const sh = norm(row.Shift);
  const byShift = SERVICES.find((s) => s.erpShift && s.erpShift === sh);
  return byShift ? byShift.id : null;
}

// ---------------------------------------------------------------- riders
log(`reading ${ERP} …`);
const rows = JSON.parse(fs.readFileSync(ERP, "utf8"));
const latestPerEmp = new Map();
/* Attendance over the whole feed, not just the latest day: `Att_Type` is "1-Present" /
   "2-Absent" (the same test erp.js uses). One day's punch says nothing about how often
   a seat actually goes empty; ~11 days does. */
const att = new Map();
for (const r of rows) {
  const e = norm(r.Empl_no);
  if (!e) continue;
  const t = parseErpDate(r.date);
  const prev = latestPerEmp.get(e);
  if (!prev || t > prev.t) latestPerEmp.set(e, { t, r });
  const a = att.get(e) || { absent: 0, days: 0 };
  if (!/present/i.test(norm(r.Att_Type))) a.absent++;
  a.days++;
  att.set(e, a);
}
const absenteeOf = (emp) => {
  const a = att.get(emp);
  return a && a.days ? a.absent / a.days : 0;
};
const mine = [...latestPerEmp.values()].map((x) => x.r).filter((r) => serviceOf(r) === SVC_ID);
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
const MERGE_M = +arg("--merge-m", "0");
const stops = stopsForRiders(riders, [], { depot, mergeM: MERGE_M });
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
const fleet = [...busSeen.values()].map((b, i) => {
  const cap = b.seats.length ? Math.max(...b.seats) : modalCap;
  return b.rent
    ? { id: "b" + i, name: b.name, type: "rent", capacity: cap, slabFixed: 1700, slabKm: 80, perKmBeyond: 18.7 }
    : { id: "b" + i, name: b.name, type: "own", capacity: cap, ...OWN };
});
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
log("optimising …");
const t0 = Date.now();
const live = optimise(stops, fleet, depot, metric ? { metric } : {});
if (!live.ok) { console.error(`[${SVC_ID}] optimiser failed: ${live.reason}`); process.exit(1); }
log(`solved in ${((Date.now() - t0) / 1000).toFixed(1)}s — ${live.kpis.buses} buses, ` +
    `₹${Math.round(live.kpis.costPerHeadDay)}/head/day, max ride ${Math.round(live.kpis.maxRide)} min`);

const checks = validatePlan(live, stops, fleet, depot, metric ? { metric } : {});
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
  integrity: { checks: checks.length, failed },
  params: { demand: live.kpis.heads, stops: routes.reduce((s, r) => s + r.stops, 0), totalRiders: riders.length },
  overall: agg(routes),
  owned: agg(routes.filter((r) => r.type === "own")),
  rental: agg(routes.filter((r) => r.type === "rent")),
  routes,
};
const out = `${OUT_DIR}/plan_${svc.id}.json`;
fs.writeFileSync(out + ".tmp", JSON.stringify(payload, null, 1));
fs.renameSync(out + ".tmp", out);
log(`wrote ${out} — ${routes.length} routes, ${payload.overall.riders} riders, ₹${payload.overall.cost_head}/head`);
