/* ============================================================================
 * build_bus_connections.mjs — find every place a bus can be parked out instead of
 * driven home empty, across ALL services at once.
 *
 * The plans are built one service at a time and each one assumes its buses live at
 * the factory. That is only true if you look at one service. Look at the fleet and
 * the same bus finishes the Day drop at Dindigul at 14:50 and is wanted back in
 * Dindigul at 21:00 for the Full-night pickup — 92 km of empty running to spend six
 * hours in a yard it did not need to visit.
 *
 * This reads every finalised plan, rebuilds the day as a timeline of RUNS (two per
 * bus per service — the pickup that must reach the gate, and the drop that leaves
 * it), and reports which consecutive pairs can be joined by parking the bus in
 * between. Output is public/bus_connections.json, which the Timings board draws.
 *
 * It writes public/park_points.json too: the candidate park locations, which are the
 * road-matrix nodes and nothing else, so every distance quoted anywhere downstream
 * is a measured Google driving distance rather than an estimate.
 *
 * Usage:
 *   node build_bus_connections.mjs
 *   node build_bus_connections.mjs --min-save 10 --max-layover 600 --park-radius 5
 *   node build_bus_connections.mjs --off s9=1050 --off s7=930    # real release times
 * ==========================================================================*/
import fs from "node:fs";
import { SERVICES, FACTORY_DEPOT } from "./src/optimiser/services.js";
import {
  LAYOVER_DEFAULTS, combineMatrices, matrixContext, parkCatalogue,
  runsFromPlan, linkRuns, roadKm, onMatrix, clock, hhmm,
} from "./src/optimiser/layover.js";

const argv = process.argv;
const arg = (k, d = null) => { const i = argv.indexOf(k); return i > -1 && argv[i + 1] ? argv[i + 1] : d; };
const num = (k, d) => (arg(k) != null ? +arg(k) : d);

/* Release times the ERP does not carry, passed in as --off <svc>=<minutes>. Repeatable. */
const offOverrides = {};
argv.forEach((a, i) => {
  if (a !== "--off" || !argv[i + 1]) return;
  const [id, m] = argv[i + 1].split("=");
  if (id && m != null && isFinite(+m)) offOverrides[id] = +m;
});

const OPTS = {
  ...LAYOVER_DEFAULTS,
  minTurnMin: num("--min-turn", LAYOVER_DEFAULTS.minTurnMin),
  maxLayoverMin: num("--max-layover", LAYOVER_DEFAULTS.maxLayoverMin),
  maxParkKm: num("--park-radius", LAYOVER_DEFAULTS.maxParkKm),
  minSaveKm: num("--min-save", LAYOVER_DEFAULTS.minSaveKm),
  dieselPerKm: num("--diesel", LAYOVER_DEFAULTS.dieselPerKm),
  shiftMin: num("--shift-min", LAYOVER_DEFAULTS.shiftMin),
};
const OUT_DIR = arg("--out-dir", "public");
const log = (...a) => console.log("[connections]", ...a);

/* ---------------------------------------------------------------- load */
const local = (url) => "public" + url;                    // planUrl is browser-rooted
const services = SERVICES.map((s) => (offOverrides[s.id] != null ? { ...s, off: offOverrides[s.id] } : s));

const loaded = [];
for (const s of services) {
  if (!s.planUrl) { log(`${s.id}: no planUrl — skipped`); continue; }
  const f = local(s.planUrl);
  if (!fs.existsSync(f)) { log(`${s.id}: ${f} missing — skipped`); continue; }
  const plan = JSON.parse(fs.readFileSync(f, "utf8"));
  if (!Array.isArray(plan.routes)) { log(`${s.id}: ${f} has no routes — skipped`); continue; }
  loaded.push({ svc: s, plan, file: f });
}
if (!loaded.length) { console.error("no plans found — build the service plans first"); process.exit(1); }
log(`${loaded.length} plans: ${loaded.map((l) => l.svc.id).join(", ")}`);

/* Every matrix any loaded service is measured on, combined into one index so a bus that
   runs both Zenwear and a Batlagundu service can still be linked. */
const matrixFiles = [...new Set(loaded.map((l) => "public" + l.svc.matrixUrl))].filter((f) => fs.existsSync(f));
const matrices = matrixFiles.map((f) => { log(`matrix ${f}`); return JSON.parse(fs.readFileSync(f, "utf8")); });
if (!matrices.length) { console.error("no road matrix on disk — distances would be estimates only"); process.exit(1); }
const ctx = matrices.length > 1 ? combineMatrices(matrices, OPTS) : matrixContext(matrices[0], OPTS);
log(`${ctx.nodes.length} candidate park points across ${matrices.length} matrix file(s)`);

/* ---------------------------------------------------------------- runs + links */
const runs = loaded.flatMap(({ svc, plan }) => runsFromPlan(plan, svc, ctx, OPTS));
const onNode = runs.filter((r) => r.far._idx != null).length;
log(`${runs.length} runs (${runs.length / 2} routes x pickup+drop) · ` +
    `${onNode}/${runs.length} far ends sit on a matrix node (real road km); the rest use haversine x ${OPTS.roadFactor}`);
const assumed = [...new Set(runs.filter((r) => r.assumedOff).map((r) => r.svcName))];
if (assumed.length) log(`ASSUMED ${OPTS.shiftMin / 60} h shift for: ${assumed.join(", ")} — pass --off <id>=<min> once the real release times are known`);

const res = linkRuns(runs, ctx, FACTORY_DEPOT, OPTS);

/* ---------------------------------------------------------------- report */
const T = res.totals;
const money = (n) => "₹" + Math.round(n).toLocaleString("en-IN");
log("");
log(`${T.links} worthwhile links on ${T.buses} buses (${T.crossService} join two different services)`);
log(`saves ${T.saveKm} km/day = ${money(T.saveRs)}/day ≈ ${money(T.saveRsMonth)}/month at ₹${OPTS.dieselPerKm}/km diesel`);
log(`  between shifts (bus waits where it already is): ${T.betweenShifts.links} links · ` +
    `${T.betweenShifts.saveKm} km · ${money(T.betweenShifts.saveRs)}/day`);
log(`  overnight (bus stands out through the night):   ${T.overnight.links} links · ` +
    `${T.overnight.saveKm} km · ${money(T.overnight.saveRs)}/day — needs somewhere secure to stand`);
if (T.assumedOff) log(`  ${T.assumedOff} of the ${T.links} depend on an ASSUMED release time`);
log("");
log("  bus          ends                       waits at                      resumes                    saves");
for (const l of res.links.filter((x) => x.worth).slice(0, 25)) {
  log(`  ${l.veh.padEnd(12)} ${(l.a.label + " " + clock(l.a.end)).padEnd(26)} ` +
      `${(l.park.name.slice(0, 22) + " " + hhmm(l.gap)).padEnd(29)} ` +
      `${(l.b.label + " " + clock(l.b.start)).padEnd(26)} ` +
      `${String(l.saveKm).padStart(6)} km  ₹${String(l.saveRs).padStart(5)}${l.assumed ? "  (assumed)" : ""}`);
}
if (res.clashes.length) {
  log("");
  log(`${res.clashes.length} pair(s) the bus physically cannot make — these are scheduling faults, not savings:`);
  for (const c of res.clashes.slice(0, 10))
    log(`  ${c.veh}: ${c.a.label} ends ${clock(c.a.end)}, ${c.b.label} starts ${clock(c.b.start)} — ${c.reason} (${c.gap} min)`);
}
if (res.opportunities.length) {
  log("");
  log(`${res.opportunities.length} pair(s) on DIFFERENT buses that would link if one bus did both:`);
  for (const o of res.opportunities.slice(0, 10))
    log(`  ${o.a.veh} ${o.a.label} ends ${clock(o.a.end)} near ${o.b.veh} ${o.b.label} ${clock(o.b.start)} — ${o.saveKm} km · ${o.needs}`);
}

/* ---------------------------------------------------------------- write */
/* Real road km from every run endpoint to every park candidate within the radius, so the
   board can re-cost a different park choice WITHOUT shipping the 18 MB matrix to the
   browser and without falling back to straight-line guesses the moment a choice changes.
   BOTH DIRECTIONS are stored. Google's matrix is not symmetric — one-way streets and
   divided highways make the drive out and the drive back different numbers — and a layover
   uses one of each: the bus drives END → park, then later park → START. */
const r1 = (n) => Math.round(n * 10) / 10;
const r2 = (n) => Math.round(n * 100) / 100;
const parkIdx = new Map();
const endpointKey = (r, which) => `${r.veh}|${r.svcId}|${r.dir}|${which}`;
const near = {};
for (const r of runs) {
  for (const [which, p0] of [["from", r.from], ["to", r.to]]) {
    const k = endpointKey(r, which);
    if (near[k]) continue;
    /* A park is only ever chosen between a DROP's far end and a PICKUP's far end. The other
       two endpoints of every run ARE the depot — a pickup finishes there and a drop starts
       there — and a bus standing at its own depot needs no park candidates. Skipping them
       halves this table, which is the bulk of the file the browser downloads. */
    if (haversineKm(p0, r.depot) < 0.25) continue;
    const list = [];
    for (const i of ctx.nodesNear(p0, OPTS.maxParkKm)) {
      const n = ctx.nodes[i];
      const node = { lat: n.lat, lng: n.lng, _idx: i };
      const out = roadKm(p0, node, ctx), back = roadKm(node, p0, ctx);
      if (!isFinite(out) || !isFinite(back)) continue;
      list.push({ i, out: r2(out), back: r2(back) });
      parkIdx.set(i, n);
    }
    /* NOT truncated. An earlier cut kept the nearest 24 per endpoint and the board then found
       52 links where the build found 57 — the best park for five pairs sat outside one side's
       top 24, because what matters is the INTERSECTION of the two endpoints' candidates and
       neither list can know what the other holds. layover.test.js asserts the two agree, which
       is what caught it. The radius is already the cap; a second one is just silent loss. */
    list.sort((a, b) => a.out - b.out);
    near[k] = list;
  }
}
/* Depot distances are DIRECTIONAL too, and each endpoint only ever uses one of them:
   a run's `from` is a departure (depot → from) and its `to` is an arrival (to → depot).
   Naming them for the direction stops the board pairing them up the wrong way round. */
const slim = (r) => ({
  veh: r.veh, type: r.type, cap: r.cap, riders: r.riders, stops: r.stops,
  svcId: r.svcId, svcName: r.svcName, color: r.color, dir: r.dir, label: r.label,
  start: r.start, end: r.end, ride: r.ride, km: r.km, assumedOff: r.assumedOff,
  from: pt(r.from), to: pt(r.to),
  key: { from: endpointKey(r, "from"), to: endpointKey(r, "to") },
  depotToFromKm: r1(roadKm(r.depot, r.from, ctx)),
  toDepotKm: r1(roadKm(r.to, r.depot, ctx)),
  depot: pt(r.depot),
});
const pt = (p) => (p ? { name: p.name || "", lat: p.lat, lng: p.lng, idx: p._idx != null ? p._idx : null } : null);
const slimLink = (l) => ({
  veh: l.veh, gap: l.gap, kind: l.kind, atDepot: !!l.atDepot, chosen: !!l.chosen,
  park: l.park && { name: l.park.name, lat: l.park.lat, lng: l.park.lng, idx: l.park.idx ?? l.park._idx ?? null, kind: l.park.kind },
  parkKm: l.parkKm, baseKm: l.baseKm, saveKm: l.saveKm, saveRs: l.saveRs,
  crossService: l.crossService, assumed: l.assumed, worth: l.worth,
  a: slim(l.a), b: slim(l.b),
});

const payload = {
  generatedBy: "build_bus_connections.mjs",
  generated: new Date().toISOString().slice(0, 10),
  /* What "saved" means here, recorded with the numbers so it cannot drift from them:
     diesel over kilometres not driven, against a baseline of returning to the depot
     between every run. Loan, driver and maintenance are unchanged — the bus and the
     driver exist whether the bus waits at Dindigul or at the factory — and those are
     fleetCost.js's question, not this one. */
  basis: {
    saving: "diesel only, over deadhead kilometres removed",
    baseline: "every run starts and ends at the depot, which is what the plans assume",
    excluded: "loan, driver and maintenance — unchanged by where a bus waits",
    dieselPerKm: OPTS.dieselPerKm,
    note: "a layover is an operational commitment: the driver must be relieved or wait, and the village must have somewhere a bus can safely stand.",
  },
  params: {
    minTurnMin: OPTS.minTurnMin, maxLayoverMin: OPTS.maxLayoverMin,
    maxParkKm: OPTS.maxParkKm, minSaveKm: OPTS.minSaveKm,
    roadFactor: OPTS.roadFactor, assumedShiftMin: OPTS.shiftMin,
  },
  services: loaded.map(({ svc, file }) => ({
    id: svc.id, name: svc.name, color: svc.color, gate: svc.gate,
    off: svc.off != null ? svc.off : (svc.gate + OPTS.shiftMin) % 1440,
    offAssumed: svc.off == null, plan: file,
  })),
  depot: { name: FACTORY_DEPOT.name, lat: FACTORY_DEPOT.lat, lng: FACTORY_DEPOT.lng },
  totals: res.totals,
  runs: runs.map(slim),
  links: res.links.map(slimLink),
  clashes: res.clashes.map((c) => ({ veh: c.veh, reason: c.reason, gap: c.gap, a: slim(c.a), b: slim(c.b) })),
  opportunities: res.opportunities.map((o) => ({
    saveKm: o.saveKm, saveRs: o.saveRs, gap: o.gap, needs: o.needs,
    park: { name: o.park.name, lat: o.park.lat, lng: o.park.lng },
    a: slim(o.a), b: slim(o.b),
  })),
  parkNear: near,
  parkPoints: [...parkIdx.entries()].map(([i, n]) => ({ idx: i, name: n.name, lat: n.lat, lng: n.lng })),
};
writeJson(`${OUT_DIR}/bus_connections.json`, payload);

/* The full picker catalogue — every matrix node, which is every place we have a measured
   distance to. ~55 KB, versus 18 MB for the matrix it comes from. */
const cat = parkCatalogue(ctx, { depot: FACTORY_DEPOT });
writeJson(`${OUT_DIR}/park_points.json`, {
  generatedBy: "build_bus_connections.mjs",
  generated: new Date().toISOString().slice(0, 10),
  note: "Candidate bus park points = the nodes of the road matrix. Every one has measured Google driving distances to the rest of the network, which is why parking savings computed against them are auditable.",
  depot: { name: FACTORY_DEPOT.name, lat: FACTORY_DEPOT.lat, lng: FACTORY_DEPOT.lng },
  count: cat.length,
  points: cat.map((c) => ({ idx: c.idx, name: c.name, lat: c.lat, lng: c.lng, depotKm: c.depotKm })),
});

function writeJson(path, obj) {
  fs.writeFileSync(path + ".tmp", JSON.stringify(obj, null, 1));
  fs.renameSync(path + ".tmp", path);
  log(`wrote ${path} (${(fs.statSync(path).size / 1024).toFixed(0)} KB)`);
}
