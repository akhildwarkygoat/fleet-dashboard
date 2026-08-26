/* ============================================================================
 * optimiser/layover.js — where a bus WAITS between runs, and which runs can be
 * joined end-to-end so it never drives home empty.
 * ----------------------------------------------------------------------------
 * Every plan in this repo assumes a bus starts and ends its run at the factory.
 * That is a modelling convenience, not an operational fact. A bus that finishes
 * the Day drop at Dindigul at 14:50 does not have to drive the 46 km back to
 * Batlagundu, sit there, and drive the same 46 km out again at 21:00 to collect
 * the Full-night riders from the same village. It can stay.
 *
 * Two empty legs disappear when it does — one at the end of the first run, one at
 * the start of the second. Those legs are pure deadhead: fuel burned carrying
 * nobody. This module finds them.
 *
 * THREE IDEAS, kept separate on purpose:
 *
 *   PARK POINT   where a bus stands when it is not running. Today: always the
 *                depot. Chosen from the road-matrix nodes, so every candidate is
 *                a place we already have real Google driving distances to and
 *                from — no new matrix calls, no invented distances.
 *
 *   RUN          one leg of one service in one direction. A service produces TWO
 *                runs per bus per day, not one: the PICKUP that must reach the
 *                gate by `gate`, and the DROP that leaves the gate at `off`. The
 *                Timings clock only ever drew the pickup, which is why the empty
 *                afternoon between two shifts was invisible.
 *
 *   LINK         two runs the same bus can do back-to-back, waiting at a park
 *                point in between instead of at the depot. The saving is the two
 *                deadheads it replaces, valued at diesel only.
 *
 * WHAT IS SAVED, AND WHAT IS NOT. A link saves DIESEL over the kilometres not
 * driven. It does not save the loan, the driver's day or the maintenance: the bus
 * exists and the driver is on shift whether it waits at Dindigul or at the
 * factory. Reporting anything more than diesel here would double-count against
 * fleetCost.js, which already owns the standing-cost question.
 *
 * A layover is an operational commitment, not just an arithmetic one — the driver
 * has to be relieved or wait, and the bus has to have somewhere safe to stand. So
 * this module RANKS and EXPLAINS candidate links; it never silently applies one.
 * ==========================================================================*/
import { haversineKm } from "./engine.js";

export const LAYOVER_DEFAULTS = {
  /* Shortest gap that is a usable layover rather than a collision. Under this the bus
     cannot physically make the second run, so the pair is a warning, not a saving. */
  minTurnMin: 45,
  /* Past this the bus has been standing so long that parking it in a village stops being
     a fuel decision and starts being a garaging decision. 14 h covers day→full-night. */
  maxLayoverMin: 14 * 60,
  /* How far a park point may sit from the run it serves. Wider than this and the bus is
     doing a second deadhead to reach its own park. */
  maxParkKm: 8,
  /* Below this a link is real but not worth the operational change. */
  minSaveKm: 4,
  roadFactor: 1.30,
  dieselPerKm: 22,
  /* Assumed shift length when a service does not state when it ends. Every saving that
     depends on it is flagged `assumedOff` so it can never be read as measured. */
  shiftMin: 8 * 60,
};

const DAY = 24 * 60;

/* ---------------------------------------------------------------- geometry */

/** Road km between two points — the real matrix when both sit on a node, else haversine×factor. */
export function roadKm(a, b, ctx) {
  const p = ctx || {};
  if (p.metric && a && b && a._idx != null && b._idx != null) {
    const v = p.metric.km(a._idx, b._idx);
    if (isFinite(v)) return v;
  }
  return haversineKm(a, b) * (p.roadFactor || LAYOVER_DEFAULTS.roadFactor);
}

/**
 * Wrap a road matrix into the lookups this module needs, and index its nodes on a coarse
 * lat/lng grid so `nodeNear` stays O(1) instead of scanning 898 nodes per query.
 *
 * @param matrix { nodes:[{name,lat,lng}], km:[[]], min:[[]] }
 */
export function matrixContext(matrix, opts = {}) {
  const p = { ...LAYOVER_DEFAULTS, ...opts };
  if (!matrix || !Array.isArray(matrix.nodes)) return { ...p, metric: null, nodes: [] };
  const nodes = matrix.nodes;
  const grid = new Map();
  nodes.forEach((n, i) => {
    if (n.lat == null || n.lng == null) return;
    const k = Math.round(n.lat * 100) + ":" + Math.round(n.lng * 100);   // ~1.1 km cells
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(i);
  });
  /* The grid is a coarse pre-filter, so its cells have to be trimmed to the real radius before
     the result is used. Returning whole cells meant a ±8-cell box reached ~12 km at the
     corners: the offline search rejected those extras on its own radius check, the browser's
     precomputed table kept them, and the two disagreed by 94 km. Both callers share this
     function, so filtering here is what keeps them on one candidate set. */
  const near = (pt, withinKm) => {
    if (!pt || pt.lat == null) return [];
    const la = Math.round(pt.lat * 100), ln = Math.round(pt.lng * 100);
    const span = Math.max(1, Math.ceil(withinKm / 1.1));
    const out = [];
    for (let dla = -span; dla <= span; dla++) for (let dln = -span; dln <= span; dln++) {
      const c = grid.get((la + dla) + ":" + (ln + dln));
      if (!c) continue;
      for (const i of c) if (haversineKm(pt, nodes[i]) <= withinKm) out.push(i);
    }
    return out;
  };
  return {
    ...p,
    nodes,
    metric: { km: (i, j) => matrix.km[i][j], min: (i, j) => matrix.min[i][j] },
    /** Candidate node indices within `withinKm` straight-line of a point. */
    nodesNear: near,
    /** Index of the matrix node this point IS, within `withinKm` (250 m matches the plan builder). */
    idxOf(pt, withinKm = 0.25) {
      let best = -1, bestD = withinKm;
      for (const i of near(pt, withinKm)) {
        const d = haversineKm(pt, nodes[i]);
        if (d < bestD) { bestD = d; best = i; }
      }
      return best;
    },
  };
}

/**
 * One context over SEVERAL matrices. Zenwear is measured from its own depot 59 km south
 * on its own 462-node matrix; Batlagundu's 898 nodes are a different index entirely. A bus
 * can appear in both services' plans, so linking has to see both at once.
 *
 * Node indices are concatenated with an offset, and a distance is only returned when both
 * points come from the SAME source matrix — a Batlagundu row has no column for a Zenwear
 * node, and inventing one is exactly what this repo does not do. Cross-matrix pairs fall
 * through to haversine×roadFactor, and `crossMatrix` on the result says how often that
 * happened so the estimate is never silent.
 */
export function combineMatrices(matrices, opts = {}) {
  const list = (matrices || []).filter((m) => m && Array.isArray(m.nodes));
  if (list.length === 1) return matrixContext(list[0], opts);
  const nodes = [];
  const owner = [];                       // global index -> { m, local }
  for (const m of list) {
    const base = nodes.length;
    m.nodes.forEach((n, i) => { nodes.push(n); owner.push({ m, local: i, base }); });
  }
  const ctx = matrixContext({ nodes, km: null, min: null }, opts);
  let cross = 0;
  ctx.metric = {
    km: (i, j) => {
      const a = owner[i], b = owner[j];
      if (!a || !b || a.m !== b.m) { cross++; return NaN; }
      return a.m.km[a.local][b.local];
    },
    min: (i, j) => {
      const a = owner[i], b = owner[j];
      if (!a || !b || a.m !== b.m) return NaN;
      return a.m.min[a.local][b.local];
    },
  };
  ctx.crossMatrix = () => cross;
  return ctx;
}

/** Attach `_idx` to a point so road-matrix distances apply to it. Returns a new object. */
export function onMatrix(pt, ctx) {
  if (!pt || !ctx || !ctx.idxOf) return pt;
  if (pt._idx != null) return pt;
  const i = ctx.idxOf(pt);
  return i >= 0 ? { ...pt, _idx: i } : pt;
}

/* ---------------------------------------------------------------- park points */

/**
 * Every place a bus could legitimately be parked: the nodes of the road matrix this
 * service is planned on. They are the only points with measured driving distances, which
 * is what makes a saving computed against them defensible rather than estimated.
 *
 * Nameless nodes and the mojibake ones the ERP produced (`?????????`) are kept but named
 * by their coordinates, so the picker never shows a blank row you cannot identify.
 */
export function parkCatalogue(ctx, { depot = null } = {}) {
  const nodes = (ctx && ctx.nodes) || [];
  const out = nodes.map((n, i) => ({
    idx: i,
    name: cleanName(n.name) || `${(+n.lat).toFixed(4)}, ${(+n.lng).toFixed(4)}`,
    lat: n.lat, lng: n.lng,
    _idx: i,
    depotKm: depot ? Math.round(haversineKm(depot, n) * 10) / 10 : null,
  }));
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}
const cleanName = (s) => {
  const v = String(s == null ? "" : s).trim();
  // a name that is all '?' is a lost non-Latin string, not a place — treat it as unnamed
  return /^[?\s.,-]*$/.test(v) ? "" : v;
};

/**
 * Resolve a stored park choice against a catalogue.
 * @param spec  {kind:"depot"} | {kind:"node", idx|name} | {kind:"tail"} | {kind:"auto"} | {kind:"coord",lat,lng,name}
 * @returns a point with `_idx` when it lands on a matrix node, or null for tail/auto
 *          (those are per-route and resolved by the linker).
 */
export function resolvePark(spec, ctx, depot) {
  const s = spec || { kind: "depot" };
  if (s.kind === "depot" || !s.kind) return { ...onMatrix(depot, ctx), kind: "depot", name: depot.name };
  if (s.kind === "coord") return { ...onMatrix({ lat: +s.lat, lng: +s.lng }, ctx), kind: "coord", name: s.name || "Custom point" };
  if (s.kind === "node") {
    const nodes = (ctx && ctx.nodes) || [];
    let i = s.idx;
    if (i == null && s.name) i = nodes.findIndex((n) => cleanName(n.name) === s.name);
    const n = i != null && i >= 0 ? nodes[i] : null;
    if (!n) return null;
    return { lat: n.lat, lng: n.lng, _idx: i, idx: i, kind: "node", name: cleanName(n.name) || `node ${i}` };
  }
  return null;                                   // "tail" / "auto" — decided per route
}

/* ---------------------------------------------------------------- runs */

/**
 * The two runs a bus makes for one service in a day.
 *
 * The plan sequences stops CLOSEST-FIRST from the depot (engine.js `sequence`), so
 * `seq[0]` is the nearest stop and `seq[n-1]` the farthest. The far end is the extremity
 * of the route — the only end of a run that is ever away from the factory.
 *
 *   PICKUP  starts at the FAR END at `gate − ride`, works inward, ENDS AT THE DEPOT on
 *           the gate. That is the whole point of the run: it delivers people to work.
 *   DROP    STARTS AT THE DEPOT at `off`, runs out through the chain, ends at the far end.
 *
 * Getting those endpoints the wrong way round is the difference between a real feature and
 * a fantasy. An earlier cut ended the pickup at `seq[0]` — the nearest stop rather than the
 * factory — which made every bus look like it finished the morning stranded in a village,
 * and "saved" 150 km a day per bus by parking it there until the evening. The bus is at the
 * factory at 09:00. There is nothing to save between a pickup and the drop that follows it,
 * and the model must say so.
 *
 * So: only a DROP can end somewhere worth parking, and only a PICKUP can start there. Every
 * genuine link is therefore drop → pickup, which is exactly the Day-drop-then-Full-night-
 * pickup case, and every other pairing correctly comes out at zero.
 *
 * `ride` is the plan's time-to-last-stop, which is the same chain either way, so it times
 * both legs. Times are minutes-from-midnight on a circular clock; a full-night run that
 * ends at 06:00 is 360, not 1800, and gaps are measured modulo the day.
 */
export function runsFromPlan(plan, svc, ctx, opts = {}) {
  const p = { ...LAYOVER_DEFAULTS, ...opts };
  if (!plan || !Array.isArray(plan.routes) || svc.gate == null) return [];
  /* Zenwear starts from its own site 59 km south, so "the depot" is per service, not global.
     Using one depot for the whole fleet would price every Zenwear deadhead against a factory
     its buses never visit. */
  const depot = onMatrix(opts.depot || svc.depot || (plan.service && plan.service.depot), ctx);
  const assumedOff = svc.off == null;
  const off = mod(svc.off != null ? svc.off : svc.gate + p.shiftMin);
  const gate = mod(svc.gate);
  const out = [];
  for (const r of plan.routes) {
    const seq = Array.isArray(r.seq) ? r.seq : [];
    if (!seq.length) continue;
    const far = named(onMatrix(seq[seq.length - 1], ctx), "far end");
    const near = named(onMatrix(seq[0], ctx), "first stop");
    const ride = Math.round(+r.ride || 0);
    const base = {
      veh: r.name, type: r.type, cap: +r.cap || 0, riders: +r.riders || 0,
      svcId: svc.id, svcName: svc.name, color: svc.color,
      km: +r.km || 0, ride, stops: seq.length, assumedOff,
      near, far, depot,
    };
    out.push({ ...base, dir: "pickup", label: `${svc.name} pickup`,
               start: mod(gate - ride), end: gate,
               from: far, to: depot });
    out.push({ ...base, dir: "drop", label: `${svc.name} drop`,
               start: off, end: mod(off + ride),
               from: depot, to: far });
  }
  return out;
}
/* Stop names come from the ERP's free-text locality, which lost its Tamil encoding somewhere
   upstream and arrives as runs of '?'. Those are not place names and must never be offered as
   "park the bus at ????????" — fall back to the coordinates, same as the node catalogue. */
const named = (pt, fallback) => ({
  ...pt,
  name: cleanName(pt && pt.name) ||
        (pt && pt.lat != null ? `${(+pt.lat).toFixed(4)}, ${(+pt.lng).toFixed(4)}` : fallback),
});
const mod = (m) => ((m % DAY) + DAY) % DAY;
/** Forward gap on a circular 24 h clock: how long after `a` does `b` happen. */
export const gapMin = (a, b) => mod(b - a);

/** Is this point, to within 250 m, the depot? Same tolerance the plan builder matches nodes at. */
const homeAt = (pt, depot) => !!pt && !!depot && haversineKm(pt, depot) < 0.25;

/** Does a layover starting at `from` and lasting `gap` cover 02:00 — the dead of night? */
const NIGHT = 2 * 60;
function spansNight(from, gap) {
  const toNight = gapMin(from, NIGHT);
  return gap >= toNight;
}

/* ---------------------------------------------------------------- the linker */

/**
 * Best place to wait between two runs: the matrix node that minimises the empty
 * kilometres either side of the layover. The two runs' own endpoints are always in the
 * running, and usually win — a bus that ends at Dindigul and restarts at Dindigul parks
 * at Dindigul. A separate node wins when the two endpoints differ and something sits
 * between them.
 *
 * `maxParkKm` bounds how far the park may be from EITHER endpoint, so the optimiser can
 * never "save" fuel by parking somewhere the bus then has to deadhead to anyway.
 */
export function bestPark(endPt, startPt, ctx, opts = {}) {
  const p = { ...LAYOVER_DEFAULTS, ...opts };
  const cost = (pt) => roadKm(endPt, pt, ctx) + roadKm(pt, startPt, ctx);
  let best = null, bestKm = Infinity;
  const consider = (pt, name, kind) => {
    if (!pt || pt.lat == null) return;
    if (haversineKm(endPt, pt) > p.maxParkKm || haversineKm(startPt, pt) > p.maxParkKm) return;
    const km = cost(pt);
    if (km < bestKm - 1e-9) { bestKm = km; best = { ...pt, name, kind }; }
  };
  /* The bus is already standing at the end of its last run, so staying put is always a
     candidate however tight the radius — the radius bounds how far it may be sent to park,
     not whether it may stay where it is. */
  consider(endPt, cleanName(endPt && endPt.name) || "end of run", "tail");
  consider(startPt, cleanName(startPt && startPt.name) || "start of run", "tail");
  if (ctx && ctx.nodesNear) {
    const seen = new Set();
    for (const i of ctx.nodesNear(endPt, p.maxParkKm)) {
      if (seen.has(i)) continue;
      seen.add(i);
      const n = ctx.nodes[i];
      consider({ lat: n.lat, lng: n.lng, _idx: i, idx: i },
               cleanName(n.name) || `${(+n.lat).toFixed(4)}, ${(+n.lng).toFixed(4)}`, "node");
    }
  }
  return best ? { park: best, deadKm: bestKm } : null;
}

/**
 * Every pair of runs the SAME bus does back-to-back, scored by what parking between them
 * would save.
 *
 * Baseline is what the plans assume today: the bus returns to the depot at the end of a
 * run and leaves the depot at the start of the next. So
 *
 *     saved = [ end→depot + depot→start ]  −  [ end→park + park→start ]
 *
 * When both runs touch the same village and the bus parks there, that is the whole
 * round trip — twice the distance from the factory, which for the Dindigul corridor is
 * most of a tank.
 *
 * @param runs   from runsFromPlan(), across every service
 * @param ctx    matrixContext()
 * @param depot  the run origin the baseline assumes
 * @param opts.parkOf (a, b) => spec — the CHOSEN park for this pair, overriding the
 *        search. This is how a manager's decision reaches the arithmetic: pin a service
 *        to `{kind:"depot"}` and its links come out at zero, which is the audit. Return
 *        null/undefined (or a `{kind:"auto"}` spec) to let the search decide.
 * @returns { links, clashes, opportunities, loose, totals }
 */
export function linkRuns(runs, ctx, depot, opts = {}) {
  const p = { ...LAYOVER_DEFAULTS, ...opts };
  const dep = onMatrix(depot, ctx);
  const byVeh = new Map();
  for (const r of runs || []) {
    if (!r.veh) continue;
    if (!byVeh.has(r.veh)) byVeh.set(r.veh, []);
    byVeh.get(r.veh).push(r);
  }

  const links = [], clashes = [], loose = [];
  for (const [veh, list] of byVeh) {
    if (list.length < 2) continue;
    /* UNWRAP the clock before comparing. A bus's runs live on a circle — the full-night
       pickup starts at 21:00 and its drop ends at 06:00 the next morning — and raw
       minutes-from-midnight sorts that night in half, putting the 06:00 arrival first.
       Anchored at the bus's own first departure, every run gets a monotonic [s,e] on a
       flat line, so "does B start before A finished" is plain subtraction and an overlap
       is a NEGATIVE gap rather than a gap of 1,438. */
    const anchor = list.reduce((m, r) => Math.min(m, r.start), Infinity);
    const seq = list
      .map((r) => ({ r, s: gapMin(anchor, r.start), dur: gapMin(r.start, r.end) }))
      .sort((x, y) => x.s - y.s)
      .map((x) => ({ ...x, e: x.s + x.dur }));

    for (let i = 0; i < seq.length; i++) {
      const cur = seq[i], nxt = seq[(i + 1) % seq.length];
      // the last run links back to the first one TOMORROW — that is a real layover too
      const nextStart = i + 1 < seq.length ? nxt.s : nxt.s + DAY;
      const gap = nextStart - cur.e;
      const a = cur.r, b = nxt.r;

      if (gap < 0) { clashes.push({ veh, a, b, reason: "overlap", gap }); continue; }
      if (gap < p.minTurnMin) { clashes.push({ veh, a, b, reason: "turnaround", gap }); continue; }
      if (gap > p.maxLayoverMin) { loose.push({ veh, a, b, gap, reason: "gap too long to hold the bus out" }); continue; }

      /* If run A already ENDS at its depot, the bus is standing exactly where the baseline
         says it is and there is nothing to park out of. Say so by construction rather than
         letting the search find a "saving": the matrix is directional (one-way roads make
         km[i][j] ≠ km[j][i]) so a search here returns a few stray kilometres of pure noise,
         and a ₹128 link on a bus that never left the yard discredits the ₹1,465 one that is
         real. Only a DROP strands a bus somewhere worth waiting. */
      const aHome = homeAt(a.to, a.depot || dep);
      /* A CHOSEN park beats the search. `depot` is not a degenerate choice to skip — it is
         the baseline, and it has to travel through the same arithmetic as every other
         option so that "we decided to keep this one at the factory" shows up as a link
         worth ₹0 rather than as a link nobody looked at. */
      const chosen = !aHome && typeof p.parkOf === "function" ? p.parkOf(a, b) : null;
      const pinned = chosen && chosen.kind && chosen.kind !== "auto"
        ? resolvePark(chosen, ctx, a.depot || dep) : null;
      const bp = aHome
        ? { park: { ...(a.depot || dep), kind: "depot" }, deadKm: roadKm(a.depot || dep, b.from, ctx) }
        : pinned
          ? { park: { ...pinned, kind: chosen.kind }, deadKm: roadKm(a.to, pinned, ctx) + roadKm(pinned, b.from, ctx) }
          : bestPark(a.to, b.from, ctx, p);
      if (!bp) { loose.push({ veh, a, b, gap, reason: "no park point within range" }); continue; }
      /* Each run is measured against ITS OWN depot. Zenwear's buses go home to Subbulapuram,
         59 km south of Batlagundu; charging their deadhead against the factory would price a
         journey they never make. */
      const baseKm = roadKm(a.to, a.depot || dep, ctx) + roadKm(b.depot || dep, b.from, ctx);
      const saveKm = baseKm - bp.deadKm;
      links.push({
        veh, a, b, gap,
        park: bp.park,
        chosen: !!pinned,
        atDepot: aHome,
        /* An overnight stand-out and a wait between two shifts are the same arithmetic and
           very different asks. One means the bus and its driver sleep in a village; the other
           means the bus idles a few hours where it already is. Split by whether the layover
           covers the dead of night, so the board can offer the easy savings first. */
        kind: aHome ? "at-depot" : spansNight(a.end, gap) ? "overnight" : "between-shifts",
        parkKm: r1(bp.deadKm),
        baseKm: r1(baseKm),
        saveKm: r1(saveKm),
        saveRs: Math.round(saveKm * p.dieselPerKm),
        crossService: a.svcId !== b.svcId,
        assumed: a.assumedOff || b.assumedOff,
        // a saving of exactly nothing is not a saving, whatever the threshold is set to
        worth: !aHome && saveKm > 0 && saveKm >= p.minSaveKm,
      });
    }
  }
  links.sort((x, y) => y.saveKm - x.saveKm);

  /* Runs on DIFFERENT buses that could have been linked if one bus did both. Not a saving
     you can bank — it needs the two runs reassigned, and the second bus then needs work —
     but it is where the next round of savings is, so it is reported rather than dropped. */
  const opportunities = findSwaps(runs, ctx, dep, p, links);

  const worth = links.filter((l) => l.worth);
  const tally = (list) => ({
    links: list.length,
    buses: new Set(list.map((l) => l.veh)).size,
    saveKm: r1(list.reduce((s, l) => s + l.saveKm, 0)),
    saveRs: list.reduce((s, l) => s + l.saveRs, 0),
    saveRsMonth: list.reduce((s, l) => s + l.saveRs, 0) * 26,
  });
  return {
    links, clashes, opportunities, loose,
    totals: {
      ...tally(worth),
      all: links.length,
      crossService: worth.filter((l) => l.crossService).length,
      assumedOff: worth.filter((l) => l.assumed).length,
      /* Reported apart because they are different decisions to sign off, not because the
         arithmetic differs. `betweenShifts` is the easy money; `overnight` needs somewhere
         secure to stand and a driver plan. */
      betweenShifts: tally(worth.filter((l) => l.kind === "between-shifts")),
      overnight: tally(worth.filter((l) => l.kind === "overnight")),
    },
  };
}

/** Cross-bus pairs: run A ends where run B starts, time fits, different vehicles. */
function findSwaps(runs, ctx, dep, p, links) {
  const taken = new Set(links.map((l) => key(l.a) + ">" + key(l.b)));
  const out = [];
  const drops = (runs || []).filter((r) => r.dir === "drop");
  const picks = (runs || []).filter((r) => r.dir === "pickup");
  for (const a of drops) {
    for (const b of picks) {
      if (a.veh === b.veh) continue;
      if (taken.has(key(a) + ">" + key(b))) continue;
      const straight = haversineKm(a.to, b.from);
      if (straight > p.maxParkKm) continue;
      const gap = gapMin(a.end, b.start);
      if (gap < p.minTurnMin || gap > p.maxLayoverMin) continue;
      if (b.riders > a.cap) continue;                       // the first bus must seat the second run
      const bp = bestPark(a.to, b.from, ctx, p);
      if (!bp) continue;
      const saveKm = roadKm(a.to, a.depot || dep, ctx) + roadKm(b.depot || dep, b.from, ctx) - bp.deadKm;
      if (saveKm < p.minSaveKm) continue;
      out.push({ a, b, gap, park: bp.park, saveKm: Math.round(saveKm * 10) / 10,
                 saveRs: Math.round(saveKm * p.dieselPerKm),
                 needs: `${b.veh}'s ${b.label} would move to ${a.veh}` });
    }
  }
  out.sort((x, y) => y.saveKm - x.saveKm);
  return out.slice(0, 40);
}
const key = (r) => `${r.veh}|${r.svcId}|${r.dir}|${r.start}`;

/* ---------------------------------------------------------------- per-route parking */

/**
 * Re-cost ONE route under a park choice, against the loop it is costed as today.
 *
 * Today `route.km` is depot → near → … → far → depot: the productive chain plus one empty
 * leg back. Parking at P replaces that empty leg with far → P, and the next departure
 * starts from P instead of the depot. Both halves are reported because only one of them
 * belongs to this route's own day.
 *
 * @returns { loopKm, parkKm, saveKm, saveRs, park } or null when the route has no stops.
 */
export function routeWithPark(route, park, ctx, depot, opts = {}) {
  const p = { ...LAYOVER_DEFAULTS, ...opts };
  const seq = Array.isArray(route.seq) ? route.seq : [];
  if (!seq.length) return null;
  const dep = onMatrix(depot, ctx);
  const far = onMatrix(seq[seq.length - 1], ctx);
  const near = onMatrix(seq[0], ctx);
  const P = park && park.lat != null ? onMatrix(park, ctx) : far;
  const chain = chainKm(seq.map((s) => onMatrix(s, ctx)), ctx);
  const loopKm = roadKm(dep, near, ctx) + chain + roadKm(far, dep, ctx);
  const parkKm = roadKm(dep, near, ctx) + chain + roadKm(far, P, ctx);
  const saveKm = loopKm - parkKm;
  return {
    loopKm: r1(loopKm), parkKm: r1(parkKm), chainKm: r1(chain),
    homeKm: r1(roadKm(far, dep, ctx)), toParkKm: r1(roadKm(far, P, ctx)),
    saveKm: r1(saveKm), saveRs: Math.round(saveKm * p.dieselPerKm),
    park: { name: P.name || "far end of route", lat: P.lat, lng: P.lng, idx: P.idx != null ? P.idx : P._idx },
  };
}
const chainKm = (seq, ctx) => {
  let km = 0;
  for (let i = 0; i < seq.length - 1; i++) km += roadKm(seq[i], seq[i + 1], ctx);
  return km;
};
const r1 = (n) => Math.round((n || 0) * 10) / 10;

/* ---------------------------------------------------------------- re-costing in the browser */

/**
 * Re-price the links in public/bus_connections.json under a DIFFERENT park choice, without
 * the road matrix.
 *
 * The matrix is 18 MB and the board must stay responsive while the manager tries "what if
 * this one stays at the factory?" on six services. So the build precomputes, for every run
 * endpoint, the measured road distance to every candidate park within the radius — in both
 * directions, because Google's distances are not symmetric — and this walks that table.
 * Every number it produces is therefore still a measured driving distance, not an estimate.
 *
 * A park with no precomputed entry is out of range for that run and is refused rather than
 * approximated: the honest answer is "you cannot park it there", not a straight-line guess.
 *
 * @param data   the parsed bus_connections.json
 * @param parkOf (link) => spec — {kind:"auto"} keeps the built choice, {kind:"depot"} pins
 *               it home, {kind:"node", idx} sends it somewhere specific
 * @returns { links, totals } in the same shape linkRuns() returns
 */
export function recostLinks(data, opts = {}) {
  const p = { ...LAYOVER_DEFAULTS, ...opts };
  const nearOf = data.parkNear || {};
  const leg = (key, idx, dir) => {
    const row = (nearOf[key] || []).find((e) => e.i === idx);
    return row ? row[dir] : null;
  };
  const links = (data.links || []).map((l) => {
    if (l.atDepot) return { ...l, worth: false };
    const spec = (typeof p.parkOf === "function" && p.parkOf(l)) || { kind: "auto" };
    let park = l.park, parkKm = l.parkKm, refused = null;

    if (spec.kind === "depot") {
      park = { ...(l.a.depot || data.depot), kind: "depot" };
      parkKm = (l.a.toDepotKm || 0) + (l.b.depotToFromKm || 0);
    } else if (spec.kind === "node" && spec.idx != null) {
      const out = leg(l.a.key && l.a.key.to, spec.idx, "out");
      const back = leg(l.b.key && l.b.key.from, spec.idx, "back");
      if (out == null || back == null) {
        refused = "out of range for one of these two runs";
      } else {
        const n = (data.parkPoints || []).find((q) => q.idx === spec.idx);
        park = { name: (n && n.name) || `node ${spec.idx}`, lat: n && n.lat, lng: n && n.lng, idx: spec.idx, kind: "node" };
        parkKm = out + back;
      }
    }
    const baseKm = l.baseKm;
    const saveKm = Math.round((baseKm - parkKm) * 10) / 10;
    return {
      ...l, park, refused,
      parkKm: Math.round(parkKm * 10) / 10,
      saveKm, saveRs: Math.round(saveKm * p.dieselPerKm),
      chosen: spec.kind !== "auto" && !refused,
      worth: !refused && saveKm > 0 && saveKm >= p.minSaveKm,
    };
  });

  const worth = links.filter((l) => l.worth);
  const tally = (list) => ({
    links: list.length,
    buses: new Set(list.map((l) => l.veh)).size,
    saveKm: r1(list.reduce((s, l) => s + l.saveKm, 0)),
    saveRs: list.reduce((s, l) => s + l.saveRs, 0),
    saveRsMonth: list.reduce((s, l) => s + l.saveRs, 0) * 26,
  });
  return {
    links,
    totals: {
      ...tally(worth),
      all: links.length,
      crossService: worth.filter((l) => l.crossService).length,
      assumedOff: worth.filter((l) => l.assumed).length,
      refused: links.filter((l) => l.refused).length,
      betweenShifts: tally(worth.filter((l) => l.kind === "between-shifts")),
      overnight: tally(worth.filter((l) => l.kind === "overnight")),
    },
  };
}

/**
 * Rebuild the links from scratch in the browser under DIFFERENT SHIFT TIMES.
 *
 * `recostLinks` re-prices pairs that were already decided; this decides them again. It has to
 * exist because the release time is the single biggest unknown in the whole model — the ERP
 * carries `gate` for every service and `off` for only three — and moving it does not just
 * change a number, it changes WHICH runs are adjacent and therefore which pairs exist at all.
 * A release-time box that only re-priced the old pairing would be lying about what it does.
 *
 * It works off the same shipped table as recostLinks: every run's endpoints, its measured
 * distance to and from its depot, and the measured distance to each park candidate within
 * range. No matrix, no estimates, no new pairs invented out of straight lines.
 *
 * @param data  the parsed bus_connections.json
 * @param opts.services  [{id, gate, off, offAssumed}] — the clock to rebuild against
 * @param opts.parkOf    (a, b) => spec, as in linkRuns
 */
export function relinkFromFile(data, opts = {}) {
  const p = { ...LAYOVER_DEFAULTS, ...opts };
  const svcBy = new Map((opts.services || data.services || []).map((s) => [s.id, s]));
  const nearOf = data.parkNear || {};
  const legOf = (key, idx, dir) => {
    const row = (nearOf[key] || []).find((e) => e.i === idx);
    return row ? row[dir] : null;
  };

  /* Re-time every run off the current clock. `ride` is a property of the route, not of the
     hour it runs at, so it carries over untouched. */
  const runs = (data.runs || []).map((r) => {
    const s = svcBy.get(r.svcId) || {};
    const gate = s.gate != null ? mod(s.gate) : mod(r.dir === "pickup" ? r.end : r.start - 0);
    const assumedOff = !!s.offAssumed;
    const off = s.off != null ? mod(s.off) : mod(gate + p.shiftMin);
    return r.dir === "pickup"
      ? { ...r, start: mod(gate - r.ride), end: gate, assumedOff }
      : { ...r, start: off, end: mod(off + r.ride), assumedOff };
  });

  const byVeh = new Map();
  for (const r of runs) {
    if (!byVeh.has(r.veh)) byVeh.set(r.veh, []);
    byVeh.get(r.veh).push(r);
  }

  const links = [], clashes = [];
  for (const [veh, list] of byVeh) {
    if (list.length < 2) continue;
    const anchor = list.reduce((m, r) => Math.min(m, r.start), Infinity);
    const seq = list
      .map((r) => ({ r, s: gapMin(anchor, r.start), dur: gapMin(r.start, r.end) }))
      .sort((x, y) => x.s - y.s)
      .map((x) => ({ ...x, e: x.s + x.dur }));

    for (let i = 0; i < seq.length; i++) {
      const cur = seq[i], nxt = seq[(i + 1) % seq.length];
      const nextStart = i + 1 < seq.length ? nxt.s : nxt.s + DAY;
      const gap = nextStart - cur.e;
      const a = cur.r, b = nxt.r;
      if (gap < 0) { clashes.push({ veh, a, b, reason: "overlap", gap }); continue; }
      if (gap < p.minTurnMin) { clashes.push({ veh, a, b, reason: "turnaround", gap }); continue; }
      if (gap > p.maxLayoverMin) continue;

      // Only a drop leaves the bus away from its depot; a pickup ends at home.
      const atDepot = a.dir !== "drop";
      const baseKm = (a.toDepotKm || 0) + (b.depotToFromKm || 0);
      let park, parkKm, chosen = false, refused = null;
      if (atDepot) {
        park = { ...(a.depot || data.depot), kind: "depot" };
        parkKm = b.depotToFromKm || 0;
      } else {
        const spec = (typeof p.parkOf === "function" && p.parkOf(a, b)) || { kind: "auto" };
        if (spec.kind === "depot") {
          park = { ...(a.depot || data.depot), kind: "depot" };
          parkKm = baseKm;
        } else if (spec.kind === "node" && spec.idx != null) {
          const out = legOf(a.key && a.key.to, spec.idx, "out");
          const back = legOf(b.key && b.key.from, spec.idx, "back");
          const n = (data.parkPoints || []).find((q) => q.idx === spec.idx);
          park = { name: (n && n.name) || `node ${spec.idx}`, lat: n && n.lat, lng: n && n.lng, idx: spec.idx, kind: "node" };
          if (out == null || back == null) {
            /* Out of range for one of these two runs. Reported as a refusal, not dropped: a
               choice that silently removes a connection looks identical to a choice that had
               no effect, and the manager needs to see that this bus cannot reach that place. */
            refused = "out of range for one of these two runs";
            parkKm = baseKm;
          } else { parkKm = out + back; }
          chosen = true;
        } else {
          /* The search, over the candidates BOTH runs can reach. Staying exactly where the run
             ended is in the running whenever the next run starts there too — that is the case
             worth the most, and it is the one the shipped table represents as distance 0. */
          const outs = nearOf[a.key && a.key.to] || [];
          const backs = new Map((nearOf[b.key && b.key.from] || []).map((e) => [e.i, e.back]));
          let best = null;
          for (const o of outs) {
            const back = backs.get(o.i);
            if (back == null) continue;
            const km = o.out + back;
            if (!best || km < best.km) best = { km, idx: o.i };
          }
          if (!best) continue;
          const n = (data.parkPoints || []).find((q) => q.idx === best.idx);
          park = { name: (n && n.name) || `node ${best.idx}`, lat: n && n.lat, lng: n && n.lng, idx: best.idx, kind: "node" };
          parkKm = best.km;
        }
      }
      const saveKm = r1(baseKm - parkKm);
      links.push({
        veh, a, b, gap, park, chosen, atDepot, refused,
        kind: atDepot ? "at-depot" : spansNight(a.end, gap) ? "overnight" : "between-shifts",
        parkKm: r1(parkKm), baseKm: r1(baseKm),
        saveKm, saveRs: Math.round(saveKm * p.dieselPerKm),
        crossService: a.svcId !== b.svcId,
        assumed: a.assumedOff || b.assumedOff,
        worth: !atDepot && !refused && saveKm > 0 && saveKm >= p.minSaveKm,
      });
    }
  }
  links.sort((x, y) => y.saveKm - x.saveKm);

  const worth = links.filter((l) => l.worth);
  const tally = (list) => ({
    links: list.length,
    buses: new Set(list.map((l) => l.veh)).size,
    saveKm: r1(list.reduce((s, l) => s + l.saveKm, 0)),
    saveRs: list.reduce((s, l) => s + l.saveRs, 0),
    saveRsMonth: list.reduce((s, l) => s + l.saveRs, 0) * 26,
  });
  return {
    links, clashes,
    totals: {
      ...tally(worth),
      all: links.length,
      crossService: worth.filter((l) => l.crossService).length,
      assumedOff: worth.filter((l) => l.assumed).length,
      betweenShifts: tally(worth.filter((l) => l.kind === "between-shifts")),
      overnight: tally(worth.filter((l) => l.kind === "overnight")),
    },
  };
}

/** Human summary of a link, for a tooltip or a log line. */
export const describeLink = (l) =>
  `${l.veh}: ${l.a.label} ends ${clock(l.a.end)} → waits ${hhmm(l.gap)} at ${l.park.name} → ` +
  `${l.b.label} starts ${clock(l.b.start)} · saves ${l.saveKm} km (₹${l.saveRs}/day)`;
export const clock = (m) => `${String(Math.floor(mod(m) / 60)).padStart(2, "0")}:${String(mod(m) % 60).padStart(2, "0")}`;
export const hhmm = (m) => `${Math.floor(m / 60)}h${m % 60 ? String(m % 60).padStart(2, "0") : ""}`;
