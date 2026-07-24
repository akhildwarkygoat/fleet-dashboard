/* ============================================================================
 * optimiser/planEditor.js — headless state + live recompute for the two editors
 * ----------------------------------------------------------------------------
 * Shared engine for (1) editing the optimised plan and (2) building a plan from
 * scratch. Holds an editable assignment (busId -> ordered stopId[]) and re-scores
 * it through engine.scorePlan() on every mutation, so every KPI is live.
 *
 * Distances are real road km/min from the cached matrix (google.matrixFor), with a
 * haversine fallback — the same metric the in-browser optimiser uses.
 * ==========================================================================*/
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { matrixFor } from "./google.js";
import { scorePlan, RENT_TARIFF, haversineKm } from "./engine.js";

/* Effective daily riders per stop, using the SAME calibration as the dashboard KPIs and the
 * Python solver (registered × active-rate × (1 − absentee + buffer)) — so totals land on ~2,141,
 * not the raw 3,054. engine.effectiveDemand() omits the active-rate scale, so we don't use it here.
 * regToActive = JUNE_ALLOTTED / Σ raw headcount, computed once over the whole stop universe. */
const JUNE_ALLOTTED = 2360, BUFFER = 0.03;
const CAP_LENIENCY = 5; // riders allowed over seats before a bus is "over cap" (matches engine DEFAULTS.capacityBuffer)
export function makeDemandFn(allStops) {
  const raw = (allStops || []).reduce((a, s) => a + (+s.headcount || 0), 0);
  const regToActive = raw ? Math.min(1, JUNE_ALLOTTED / raw) : 1;
  const fn = (stop) => {
    const hc = +stop.headcount || 0;
    return Math.max(hc > 0 ? 1 : 0, Math.round(hc * regToActive * (1 - (+stop.absentee || 0) + BUFFER)));
  };
  fn.regToActive = regToActive;
  return fn;
}

/** Store rent buses carry {slabFixed,slabKm,perKmBeyond}; the engine's rentTariff wants
 *  {t1Km,t1,t2Km,t2,perKm}. Map one to the other so rental cost is right. Own buses pass through. */
export function busForEngine(bus) {
  if (bus.type !== "rent") return bus;
  // The store bus carries a single slab; the real tariff (and optimize.py) has two tiers
  // (₹1700 ≤80 km, ₹1900 80–95 km, then ₹/km). Keep the store's tier-1, fill tier-2 from the
  // canonical RENT_TARIFF so rental cost reproduces the solver exactly.
  const tariff = {
    t1Km: +bus.slabKm || RENT_TARIFF.t1Km,
    t1: +bus.slabFixed || RENT_TARIFF.t1,
    t2Km: RENT_TARIFF.t2Km,
    t2: RENT_TARIFF.t2,
    perKm: +bus.perKmBeyond || RENT_TARIFF.perKm,
  };
  return { ...bus, tariff };
}

/** Build the road-distance metric for depot + the given stops. Returns the metric plus an
 *  index map (stopId -> node index). Depot is node 0; stops are 1..N in the passed order. */
async function buildMetric(depot, stops) {
  const pts = [{ lat: depot.lat, lng: depot.lng }, ...stops.map((s) => ({ lat: s.lat, lng: s.lng }))];
  const M = await matrixFor(pts); // {km:[[]], min:[[]], estimated?}
  const idxOf = new Map();
  stops.forEach((s, i) => idxOf.set(s.id, i + 1));
  const metric = { km: (i, j) => M.km[i][j], min: (i, j) => M.min[i][j] };
  return { metric, idxOf, estimated: !!M.estimated };
}

/** React hook: load the metric once for a stable set of stops + depot. */
export function usePlanMetric(depot, stops) {
  const [state, setState] = useState({ metric: null, idxOf: new Map(), estimated: false, ready: false });
  // key on the stop id set + depot so we only rebuild when the universe of stops changes
  const key = useMemo(
    () => (depot ? depot.lat + "," + depot.lng + "|" : "") + (stops || []).map((s) => s.id).join(","),
    [depot, stops]
  );
  useEffect(() => {
    let live = true;
    if (!depot || !(stops || []).length) { setState({ metric: null, idxOf: new Map(), estimated: false, ready: true }); return; }
    buildMetric(depot, stops).then((r) => { if (live) setState({ ...r, ready: true }); });
    return () => { live = false; };
  }, [key]); // eslint-disable-line
  return state;
}

/** Attach _idx (matrix node) + _dem (effective riders) to a stop for the engine. */
function forEngine(stop, idxOf, demandOf) {
  return { ...stop, _idx: idxOf.get(stop.id), _dem: demandOf(stop) };
}

/**
 * The editable plan. `assignments` is a Map<busId, stopId[]> (ordered). Everything derived
 * (live KPIs, per-bus fill, unassigned list) recomputes from it.
 *
 * @param seed        initial Map<busId, stopId[]> (empty Map to build from scratch)
 * @param fleet       store buses
 * @param depot       {lat,lng}
 * @param stopsById   Map<stopId, stop> over the whole stop universe
 * @param metric,idxOf from usePlanMetric
 */
export function usePlanEditor({ seed, fleet, depot, stopsById, metric, idxOf, demandOf }) {
  // Undo/redo history: a single stack + pointer. `assign` is the current entry. Every mutation
  // truncates any redo tail and pushes a new entry (capped at 50); undo/redo just move the pointer.
  const [hist, setHist] = useState(() => ({ stack: [cloneAssign(seed)], i: 0 }));
  const assign = hist.stack[hist.i];
  // reseed (plan loaded / prefill / reset) replaces the whole history
  const seedRef = useRef(seed);
  useEffect(() => { if (seed !== seedRef.current) { seedRef.current = seed; setHist({ stack: [cloneAssign(seed)], i: 0 }); } }, [seed]);
  const setAssign = useCallback((s) => setHist({ stack: [cloneAssign(s)], i: 0 }), []);

  const busById = useMemo(() => new Map(fleet.map((b) => [b.id, b])), [fleet]);

  // ---- mutations (all immutable, all undoable) ----
  const mutate = useCallback((fn) => setHist((h) => {
    const next = cloneAssign(h.stack[h.i]); fn(next);
    const stack = h.stack.slice(0, h.i + 1).concat([next]).slice(-50);
    return { stack, i: stack.length - 1 };
  }), []);
  const undo = useCallback(() => setHist((h) => (h.i > 0 ? { ...h, i: h.i - 1 } : h)), []);
  const redo = useCallback(() => setHist((h) => (h.i < h.stack.length - 1 ? { ...h, i: h.i + 1 } : h)), []);
  const removeEverywhere = (next, stopId) => { for (const [b, list] of next) next.set(b, list.filter((id) => id !== stopId)); };

  const assignStop = useCallback((stopId, busId, { sequence = true } = {}) => mutate((next) => {
    removeEverywhere(next, stopId);
    const list = next.get(busId) || [];
    list.push(stopId);
    next.set(busId, sequence ? sequenceIds(list, depot, stopsById) : list);
  }), [depot, stopsById]); // eslint-disable-line

  // Manual placement: put stopId into busId at a specific index (no auto-sequence) — used for
  // drag-to-reorder within a bus and for dropping a stop at a precise spot in another bus.
  const insertStopAt = useCallback((stopId, busId, index) => mutate((next) => {
    removeEverywhere(next, stopId);
    const list = next.get(busId) || [];
    const at = Math.max(0, Math.min(index, list.length));
    list.splice(at, 0, stopId);
    next.set(busId, list);
  }), []);

  const unassignStop = useCallback((stopId) => mutate((next) => removeEverywhere(next, stopId)), []);

  // Chain removal: drop a stop AND every stop after it in its bus's sequence (breaking a link in the
  // factory→…→last chain detaches the tail). No-op if the stop isn't on that bus.
  const truncateFrom = useCallback((busId, stopId) => mutate((next) => {
    const list = next.get(busId) || [];
    const i = list.indexOf(stopId);
    if (i >= 0) next.set(busId, list.slice(0, i)); // keep the stops before it; drop it and everything after
  }), []);
  const clearBus = useCallback((busId) => mutate((next) => next.set(busId, [])), []);
  const autoSequence = useCallback((busId) => mutate((next) => next.set(busId, sequenceIds(next.get(busId) || [], depot, stopsById))), [depot, stopsById]); // eslint-disable-line
  const reorder = useCallback((busId, from, to) => mutate((next) => {
    const list = (next.get(busId) || []).slice();
    if (from < 0 || from >= list.length || to < 0 || to >= list.length) return;
    const [x] = list.splice(from, 1); list.splice(to, 0, x); next.set(busId, list);
  }), []);
  const resetTo = useCallback((s) => setAssign(cloneAssign(s)), [setAssign]);

  // Auto-fill remaining: SWEEP the unassigned stops into compact angular sectors from the depot and
  // fill the free (unused) buses in that order — the standard sweep heuristic (same idea as the
  // solver's sweepClusters), so each bus gets a contiguous slice and routes stay tight (short rides).
  // Big buses fill first (larger sectors). Respects seats +5 leniency; auto-sequences each nearest-first.
  const autoFill = useCallback(() => {
    const usedBus = new Set([...assign].filter(([, ids]) => ids.length).map(([b]) => b));
    const freeBuses = fleet.filter((b) => !usedBus.has(b.id)).sort((a, b) => (b.capacity || 0) - (a.capacity || 0));
    const assignedNow = new Set(); for (const ids of assign.values()) ids.forEach((id) => assignedNow.add(id));
    const bearing = (s) => Math.atan2(s.lng - depot.lng, s.lat - depot.lat);
    const stops = [...stopsById.values()].filter((s) => !assignedNow.has(s.id))
      .sort((a, b) => bearing(a) - bearing(b) || haversineKm(depot, a) - haversineKm(depot, b));
    if (!stops.length || !freeBuses.length) return;
    const picks = new Map(freeBuses.map((b) => [b.id, []]));
    let bi = 0, room = (freeBuses[0].capacity || 0) + 5;
    for (const s of stops) {
      const d = demandOf(s);
      while (bi < freeBuses.length && room < d) { bi++; if (bi < freeBuses.length) room = (freeBuses[bi].capacity || 0) + 5; }
      if (bi >= freeBuses.length) break;    // out of buses — leave the rest unassigned
      picks.get(freeBuses[bi].id).push(s.id);
      room -= d;
    }
    mutate((next) => {
      for (const [busId, ids] of picks) if (ids.length) next.set(busId, sequenceIds([...(next.get(busId) || []), ...ids], depot, stopsById));
    });
  }, [assign, fleet, depot, stopsById, demandOf]);

  // Depot is matrix node 0 — it MUST carry _idx or every depot→stop leg falls back to the
  // haversine estimate (inflating km/ride ~1.3×). buildMetric() puts the depot at pts[0].
  const depotNode = useMemo(() => ({ ...depot, _idx: 0 }), [depot]);

  // ---- derived: live scored plan ----
  const live = useMemo(() => {
    if (!metric || !idxOf) return null;
    const assignments = [];
    for (const [busId, ids] of assign) {
      if (!ids.length) continue;
      const stops = ids.map((id) => stopsById.get(id)).filter(Boolean).map((s) => forEngine(s, idxOf, demandOf));
      assignments.push({ busId, stops });
    }
    // chain: bus parks at its last stop — matches the shipped plan's --chain accounting, so
    // cost/km reproduce the OR-Tools solver's numbers (not an out-and-back loop approximation).
    return scorePlan(assignments, fleet.map(busForEngine), depotNode, { metric, chain: true });
  }, [assign, metric, idxOf, fleet, depotNode, stopsById, demandOf]);

  // ---- derived: per-bus rows (fill, over-cap, ordered stops) for the UI ----
  const perBus = useMemo(() => fleet.map((b) => {
    const ids = assign.get(b.id) || [];
    const stops = ids.map((id) => stopsById.get(id)).filter(Boolean);
    const heads = stops.reduce((n, s) => n + demandOf(s), 0);
    const route = (live && live.plan.routes.find((r) => r.bus.id === b.id)) || null;
    return {
      bus: b, stopIds: ids, stops, heads,
      cap: b.capacity, fill: b.capacity ? heads / b.capacity : 0,
      overSeats: heads > b.capacity,                 // soft: past the seat count (amber)
      overCap: heads > b.capacity + CAP_LENIENCY,    // hard: past seats + leniency — genuinely infeasible (red)
      km: route ? route.km : 0, ride: route ? route.toLastMin : 0, cost: route ? route.cost : 0,
    };
  }), [assign, fleet, stopsById, live, demandOf]);

  const assignedIds = useMemo(() => { const s = new Set(); for (const ids of assign.values()) ids.forEach((id) => s.add(id)); return s; }, [assign]);

  return {
    assign, live, perBus, assignedIds, busById,
    assignStop, insertStopAt, unassignStop, truncateFrom, clearBus, autoSequence, reorder, resetTo, autoFill,
    undo, redo, canUndo: hist.i > 0, canRedo: hist.i < hist.stack.length - 1,
  };
}

/** Canonical editing fleet = the 69 buses the solver plan actually uses (names/types/caps match
 *  the dashboard). Cost fields come from the store bus of the same name when present, else a
 *  per-type template, so engine cost stays realistic. Bus id = its name (stable, matches seq). */
export function fleetFromSolver(solver, storeFleet) {
  const byName = new Map((storeFleet || []).map((b) => [b.name, b]));
  const ownTpl = (storeFleet || []).find((b) => b.type === "own") || { loanMonth: 0, driverDay: 692, maintDay: 1147, dieselPerKm: 18 };
  const rentTpl = (storeFleet || []).find((b) => b.type === "rent") || { slabFixed: 1700, slabKm: 80, perKmBeyond: 18.7 };
  return (solver.routes || []).map((r) => {
    const existing = byName.get(r.name);
    if (existing) return { ...existing, id: r.name, capacity: r.cap };
    const cost = r.type === "own"
      ? { loanMonth: ownTpl.loanMonth, driverDay: ownTpl.driverDay, maintDay: ownTpl.maintDay, dieselPerKm: ownTpl.dieselPerKm }
      : { slabFixed: rentTpl.slabFixed, slabKm: rentTpl.slabKm, perKmBeyond: rentTpl.perKmBeyond };
    return { id: r.name, name: r.name, type: r.type, capacity: r.cap, ...cost };
  });
}

/** Turn a solver_result.json into an editable seed by matching the plan's seq stops back to
 *  store stops (4-dp coords, then name, then nearest-within-150 m to absorb ERP coord drift).
 *  Plan stops with no free store match are carried over as synthetic stops so the import never
 *  silently drops a route's riders, and each stop's plan-time rider count (seq[].hc) is returned
 *  so the editor can present the plan exactly as solved — not re-derived from today's demand.
 *  @returns {{ seed: Map<string,string[]>, extras: object[], demand: Map<string,number> }} */
export function seedFromSolver(solver, fleet, stops) {
  const byCoord = new Map(), byName = new Map(), located = [];
  for (const s of stops) {
    if (s.lat != null && s.lng != null) { byCoord.set((+s.lat).toFixed(4) + "," + (+s.lng).toFixed(4), s.id); located.push(s); }
    if (s.name) byName.set(s.name.toLowerCase().trim(), s.id);
  }
  // Closest network stop within 2 km — the SAME rule the network's headcounts are
  // attributed by, so an import reproduces the ERP's per-stop rider counts exactly.
  // (Optimised plans hit the exact-coord lookup first, so this radius never applies there.)
  const nearestId = (p) => {
    let best = null, bestKm = 2;
    for (const s of located) { const km = haversineKm(p, s); if (km < bestKm) { bestKm = km; best = s.id; } }
    return best;
  };
  const byBusName = new Map(fleet.map((b) => [b.name, b.id]));
  const seed = new Map(), extras = [], demand = new Map(), used = new Set();
  for (const r of (solver.routes || [])) {
    const busId = byBusName.get(r.name);
    if (!busId) continue;
    const ids = [];
    for (const s of (r.seq || [])) {
      const pt = s.lat != null ? { lat: +s.lat, lng: +s.lng } : null;
      // Order matters: exact coords, then NEAREST, then name. Nearest must beat name —
      // village names repeat across the district, and the network's headcounts are
      // attributed by nearest stop, so name-first would credit riders to a same-named
      // stop kilometres away and double-count them against the real one.
      let id = (pt && byCoord.get(pt.lat.toFixed(4) + "," + pt.lng.toFixed(4)))
        || (pt && nearestId(pt))
        || byName.get((s.name || "").toLowerCase().trim())
        || null;
      if (!id) {
        // genuinely no network stop within 2 km — carry the plan's own stop so the
        // import stays faithful instead of silently dropping riders
        if (!pt) continue;
        id = "plan:" + pt.lat.toFixed(5) + "," + pt.lng.toFixed(5) + ":" + extras.length;
        extras.push({ id, name: s.name || "Plan stop", lat: pt.lat, lng: pt.lng, headcount: +s.hc || 0, absentee: 0 });
      }
      // ACCUMULATE the rider counts: several raw ERP pickup points routinely collapse
      // onto one consolidated stop, and that stop serves all of them. Overwriting here
      // would leave a 10-rider village showing whichever single point claimed it.
      if (s.hc != null) demand.set(id, (demand.get(id) || 0) + Math.max(0, Math.round(+s.hc || 0)));
      if (used.has(id)) continue; // already on a route — count its riders, don't stop twice
      used.add(id);
      ids.push(id);
    }
    seed.set(busId, ids);
  }
  return { seed, extras, demand };
}

/* ---- helpers ---- */
function cloneAssign(seed) {
  const m = new Map();
  if (seed) for (const [k, v] of seed) m.set(k, v.slice());
  return m;
}
/** Order stop ids nearest-first from the depot (straight-line) — matches engine.sequence(). */
function sequenceIds(ids, depot, stopsById) {
  return ids.slice().sort((a, b) => {
    const sa = stopsById.get(a), sb = stopsById.get(b);
    return haversineKm(depot, sa) - haversineKm(depot, sb);
  });
}
