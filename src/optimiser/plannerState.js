/* ============================================================================
 * optimiser/plannerState.js — the Planner's state, actions and figures
 * ----------------------------------------------------------------------------
 * Moved out of NewPlanView, NewPlanBoard, PlanGallery and ParkPicker so the old
 * look and the new look (src/next) run the same code: the same saved plans, the
 * same scoring, the same actions and the same figures. Nothing here draws.
 * ==========================================================================*/
import { useCallback, useEffect, useMemo, useState } from "react";
import * as store from "./store.js";
import { usePlanMetric, usePlanEditor, seedFromSolver, fleetFromSolver, fleetFromErp, busForEngine, withEndpoints } from "./planEditor.js";
import { PALETTE } from "./ui.jsx";
import { activePlanUrl, getActivePlanLabel } from "./planOptions.js";
import { resolveFinalised, setFinalised, clearFinalised, planUrlFor, planSourceFor, baselineFor } from "./finalisedPlans.js";
import { subscribeRotaWeek } from "./rotation.js";
import { downloadPlanJson, toSolverResult } from "./planExport.js";
import { scorePlan } from "./engine.js";
import { getParkPrefs, parkForRoute, startForRoute, setRoutePark, setRouteStart } from "./parkPrefs.js";
import { useParkPoints } from "./ParkPicker.jsx";
import { routeGeometry } from "./roadGeom.js";
import { KPI_DEFS, getHiddenKpis, setHiddenKpis } from "./kpiPrefs.js";
import { BUS_RANK, PLAN_RANK, TYPE_KEYS, nextRank, rankBy } from "./kpiRank.js";

export const UNADDED = "#f87171"; // light red — stop not yet on any bus
export const ADDED = "#4ade80";   // light green — stop assigned to a bus

/* S = where the bus starts this run · P = where it parks when the run is done.
   Green reads as "go", amber as "stand" — and neither is any route colour in PALETTE, so an
   end pin can never be mistaken for a bus's own stops. */
export const START_COLOR = "#16a34a";
export const PARK_COLOR = "#b45309";

const EMPTY = new Map();
/* A previous-routes stop's riders on this service: its by_service share when the feed has one, else
   the whole-vehicle headcount (a current_routes.json built before the split). Opening the previous
   routes and counting their stops both use it, so the card and the opened plan agree. */
const prevStopRiders = (buses, sid) => {
  const perSvc = sid && buses.some((b) => (b.stops || []).some((s) => s.by_service));
  return (s) => (perSvc ? (+(s.by_service || {})[sid] || 0) : (+s.hc || 0));
};
const mapFrom = (assignments) => { const m = new Map(); for (const k of Object.keys(assignments || {})) m.set(k, assignments[k]); return m; };

/* ---------------------------------------------------------------- the hub --
   `svc` scopes the whole board to one service. Without it the Planner always used the
   global depot, the curated 9 am stop set, the 9 am plan and one shared draft list — so
   "planning Zenwear" actually routed Batlagundu's stops from Batlagundu's depot. `svcStops`
   is the service's own derived network (null for 9 am, which plans on the curated store).
   `keep` (optional) is an object owned by the caller that outlives this hook: the open plan, its
   name, direction and stops are written to it and read back on the next mount, so leaving the
   Planner and coming back finds the board as it was. Without it every mount starts at the gallery. */
export function usePlanHub({ toast, erpBuses, svc, svcStops, keep }) {
  const depot = useMemo(() => (svc && svc.depot) || store.getDepot(), [svc]);
  const matrixUrl = (svc && svc.matrixUrl) || undefined;
  const svcId = (svc && svc.id) || "s9";
  const storeStops = useMemo(
    () => (svcStops && svcStops.length ? svcStops : store.getStops()).filter((s) => s.lat != null && s.lng != null),
    [svcStops]
  );

  /* The plan this board seeds from. For a Rotational slot that is no longer a fixed file:
     it is the manager's plan for whichever rider group is on this clock in the week being
     shown, and it changes when the week does (the Monday step, or the week picker). The
     "rota-week" event is the one signal for that; bumping `rotaTick` re-asks the resolver,
     which changes `planSrc`, which refetches. `activePlanUrl()` is the 9 am plan-variant
     picker, so it is only the right source when no service-specific plan exists. */
  const [rotaTick, setRotaTick] = useState(0);
  useEffect(() => subscribeRotaWeek(() => setRotaTick((x) => x + 1)), []);
  const planSrc = useMemo(
    () => (svc && svc.id !== "s9" ? planUrlFor(svc) : activePlanUrl()),
    [svc, rotaTick]                                                  // eslint-disable-line
  );
  /* "Balanced" is the name of a 9 am plan VARIANT. Reusing it on another service's board
     labels that service's own optimiser output with a plan it has nothing to do with.
     A rotation plan is named for what it is — "Group 2 · Half night · week of 7 Sep" — so
     the gallery card says WHOSE plan is being imported, not just which slot's. */
  const planSource = useMemo(
    () => (svc && svc.id !== "s9" ? planSourceFor(svc) : null),
    [svc, rotaTick]                                                  // eslint-disable-line
  );
  const planLabel = !svc || svc.id === "s9" ? getActivePlanLabel()
    : planSource && (planSource.kind === "rotation" || !planSource.isDefault) ? planSource.label
    : `${svc.name} optimised`;
  /* What the seed card is offering: the manager's rotation plan, a finalised plan (built in or
     chosen), or the optimiser's output. */
  const planKind = !planSource ? null : planSource.kind === "rotation" ? "rotation" : planSource.isDefault ? "optimised" : "final";
  const [solver, setSolver] = useState(null);
  const [solverLoaded, setSolverLoaded] = useState(false);
  useEffect(() => {
    setSolver(null); setSolverLoaded(false);
    if (!planSrc) { setSolverLoaded(true); return; }
    fetch(planSrc + "?ts=" + Date.now()).then((r) => (r.ok ? r.json() : null))
      .then((d) => setSolver(d)).catch(() => {}).finally(() => setSolverLoaded(true));
  }, [planSrc]);
  // Fleet authority: today's ERP (capacities + mileage) first, so the Planner reflects the
  // live fleet immediately; only fall back to the solved plan / store when the ERP is absent.
  const fleet = useMemo(() => {
    if (erpBuses && erpBuses.length) return fleetFromErp(erpBuses, store.getFleet());
    return solver ? fleetFromSolver(solver, store.getFleet()) : store.getFleet();
  }, [erpBuses, solver]);
  // ERP's previously-ran allocation — always available in the gallery as a starting seed
  const [prevRoutes, setPrevRoutes] = useState(null);
  useEffect(() => {
    fetch("/current_routes.json?ts=" + Date.now()).then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d || !Array.isArray(d.buses)) { setPrevRoutes(null); return; }
        // current_routes.json is the WHOLE fleet's previous allocation. Showing all 71 buses
        // and 3,097 riders while planning a 155-rider service is not a usable starting point,
        // so keep only the buses this service actually runs.
        const own = new Set((erpBuses || []).map((b) => b.id || b.vehicle));
        const buses = own.size ? d.buses.filter((b) => own.has(b.name)) : d.buses;
        if (!buses.length) { setPrevRoutes(null); return; }
        /* A vehicle is not a service. The same bus runs a Rotational trip and a General trip on
           the same day, and eleven of them carry more than one Rotational slot — so summing each
           kept bus's TOTAL rider count charged this service for everyone who ever boarded that
           vehicle. Rotational Day read 1,121 against a real 244 (4.6x); 7 am Morning read 1,027
           against 155 (6.6x). build_erp_routes.py now emits per-service counts; use them.

           Falls back to the old vehicle total when by_service is absent, so a current_routes.json
           built before this change still renders instead of reading zero. */
        const sid = svc && svc.id;
        const ridersOf = (b) => (sid && b.by_service ? (+b.by_service[sid] || 0) : (+b.riders || 0));
        const forService = sid && buses.some((b) => b.by_service)
          ? buses.filter((b) => ridersOf(b) > 0)
          : buses;
        if (!forService.length) { setPrevRoutes(null); return; }
        const hcOf = prevStopRiders(forService, sid);
        const meta = { ...(d.meta || {}), vehicles: forService.length,
          riders: forService.reduce((s, b) => s + ridersOf(b), 0),
          stops: forService.reduce((n, b) => n + (b.stops || []).filter((s) => hcOf(s) > 0).length, 0),
          service: sid || null };
        setPrevRoutes({ ...d, buses: forService, meta });
      }).catch(() => {});
  }, [erpBuses, svc]);
  // set on import: stops carried over from the plan file that aren't in the store, plus the
  // plan's own per-stop rider counts — so the editor presents the plan exactly as solved
  const [importedPlan, setImportedPlan] = useState(() => (keep && keep.importedPlan) || null);   // { extras: stop[], demand: Map } | null
  const allStops = useMemo(
    () => (importedPlan && importedPlan.extras.length ? [...storeStops, ...importedPlan.extras] : storeStops),
    [storeStops, importedPlan]
  );
  const stopsById = useMemo(() => new Map(allStops.map((s) => [s.id, s])), [allStops]);
  // The Planner counts REGISTERED riders per stop (matches the Stops tab's 2,727 and the solver
  // plans' demand) — not the attendance-calibrated figure, so a fully-assigned plan reads 100%.
  const baseDemand = useMemo(() => { const fn = (s) => Math.max(0, Math.round(+s.headcount || 0)); fn.regToActive = 1; return fn; }, []);
  const demandOf = useMemo(() => {
    if (!importedPlan || !importedPlan.demand.size) return baseDemand;
    const fn = (stop) => (importedPlan.demand.has(stop.id) ? importedPlan.demand.get(stop.id) : baseDemand(stop));
    fn.regToActive = baseDemand.regToActive;
    return fn;
  }, [baseDemand, importedPlan]);
  const totalRiders = useMemo(() => allStops.reduce((n, s) => n + demandOf(s), 0), [allStops, demandOf]);
  const busColor = useMemo(() => { const m = {}; fleet.forEach((b, i) => (m[b.id] = PALETTE[i % PALETTE.length])); return m; }, [fleet]);
  const { metric, idxOf, ready, estimated } = usePlanMetric(depot, allStops, matrixUrl);

  // hub state: which view, the open draft, the editable name, and the editor seed
  const [view, setView] = useState(() => (keep && keep.view) || "gallery");           // "gallery" | "editor"
  // Evening = factory → stops (drop-off, how plans are stored). Morning = the same chain
  // ridden in reverse: last stop → … → first stop → factory (pickup). Display/editing only —
  // the cost model already counts both directions (chain km = 2 × one-way).
  const [period, setPeriod] = useState(() => (keep && keep.period) || "evening");       // "evening" | "morning"
  const [drafts, setDrafts] = useState(() => store.listPlanDrafts(svcId));
  /* Which plan this service actually runs. Absent -> the optimiser's output stands in,
     flagged isDefault so "nobody decided" never reads as "somebody chose this" — except on
     a Rotational slot, where the manager's group plan for the week stands in (kind
     "rotation") and is a decision, not a default. Re-resolved when the week changes, because
     for a Rotational slot the answer does. */
  const [finalised, setFinal] = useState(() => (svc ? resolveFinalised(svc) : null));
  useEffect(() => { setFinal(svc ? resolveFinalised(svc) : null); }, [svc, rotaTick]);
  /* Score a saved draft into the same solver_result shape a plan file has. Finalising stores
     that BODY, not just a pointer: a draft is a Map of bus -> stop ids, which means nothing
     without this service's fleet, depot, stops and road matrix. Without the body every reader
     fell back to the optimised file — the board showed the draft's NAME beside the optimised
     plan's numbers (Zenwear read 12 buses / Rs40.6 for an 18-bus / Rs80.8 plan). */
  const scoreDraft = (d) => {
    const asg = Object.entries(d.assignments || {}).map(([busId, ids]) => ({
      busId,
      stops: (ids || []).map((id) => stopsById.get(id)).filter(Boolean)
        .map((st) => ({ ...st, _idx: idxOf.get(st.id), _dem: demandOf(st) })),
    })).filter((a) => a.stops.length);
    if (!asg.length) return null;
    /* Score it the way the BOARD scored it, or finalising quietly rewrites the plan the manager
       just approved. Two things were missing and both changed the money:
         - the start/park choices, so a bus parked out was banked at its drive-home price;
         - `chain: true`, so the board's two-traversal day became a single loop.
       The body written here is what the Timings clock, the service card and the fleet-cost
       board all read, so it has to be the same arithmetic that was on screen. */
    const withEnds = withEndpoints(asg, {
      depot, stops: allStops, idxOf, endpointsOf,
      busById: new Map(fleet.map((b) => [b.id, b])),
    });
    /* The depot is matrix node 0. Passing it WITHOUT `_idx` made every depot→first-stop leg
       fall back to haversine × 1.3 — an estimate, in the one artefact that gets finalised and
       costed. The live board has always passed the node; this now does too. */
    const live = scorePlan(withEnds, fleet.map(busForEngine), { ...depot, _idx: 0 },
                           { chain: true, ...(metric ? { metric } : {}) });
    if (!live || !live.ok) return null;
    return toSolverResult(live, fleet, depot, totalRiders, allStops);
  };

  const finalise = (ref) => {
    if (!svc) return;
    const cur = resolveFinalised(svc);
    const same = ref.kind === "draft" ? cur.draftId === ref.id : cur.kind === "plan" && !cur.isDefault;
    if (same) {
      /* Un-finalising hands the slot back to whatever stands in — the rotation plan on a
         Rotational slot, the optimised plan elsewhere — and the toast has to say which. */
      clearFinalised(svc.id); setFinal(resolveFinalised(svc));
      const base = baselineFor(svc);
      toast && toast(`${svc.name} back to ${base.kind === "rotation" ? "the rotation plan" : base.builtIn ? `its built-in plan, ${base.name}` : "the optimised plan"}`);
      return;
    }
    let body = null;
    if (ref.kind === "draft") {
      const d = store.getPlanDraft(ref.id);
      body = d ? scoreDraft(d) : null;
      if (!body) { toast && toast("Couldn't score that plan — open it once, then finalise"); return; }
    }
    setFinalised(svc.id, { ...ref, body });
    setFinal(resolveFinalised(svc));
    toast && toast(`Finalised "${ref.name}" for ${svc.name}` +
      (body ? ` · ${body.overall.buses} buses · ₹${body.overall.cost_head}/head` : ""));
  };
  const [current, setCurrent] = useState(() => (keep && keep.current) || null);           // { id, name } of the open saved draft, or null (unsaved)
  const [draftName, setDraftName] = useState(() => (keep && keep.draftName) || "Untitled plan");
  const [seed, setSeed] = useState(() => (keep && keep.seed) || EMPTY);

  /* ---- where each bus starts and parks ----
     Held HERE rather than in the board because it feeds the scoring: km, ride time and cost all
     depend on the two ends of the run, so the editor has to see a change to them at the same
     moment the map does. The board reads and writes the same state. */
  const [endPrefs, setEndPrefs] = useState(getParkPrefs);
  const parkPoints = useParkPoints();
  const pointOf = useCallback((spec, fallback) => {
    if (!spec || spec.kind === "auto" || spec.kind === "tail") return fallback;
    if (spec.kind === "depot") return { lat: depot.lat, lng: depot.lng, name: depot.name };
    if (spec.kind === "stop") return { lat: spec.lat, lng: spec.lng, name: spec.name };
    if (spec.kind === "node" && spec.idx != null) {
      const n = parkPoints.find((p) => p.idx === spec.idx);
      return n ? { lat: n.lat, lng: n.lng, name: n.name } : fallback;
    }
    return fallback;
  }, [depot, parkPoints]);

  /* null for either end means "the default" — the engine then measures from the depot and the
     last stop, which is what it has always done. Only a bus that has actually been moved gets
     an override, so an untouched plan costs exactly what it costed before this existed. */
  const endpointsOf = useCallback((busId, busName) => {
    const startSpec = startForRoute(svcId, busName, endPrefs);
    const parkSpec = parkForRoute(svcId, busName, endPrefs);
    return {
      start: startSpec.kind !== "auto" ? pointOf(startSpec, null) : null,
      park: parkSpec.kind !== "auto" ? pointOf(parkSpec, null) : null,
    };
  }, [endPrefs, svcId, pointOf]);

  const editor = usePlanEditor({ seed, fleet, depot, stopsById, metric, idxOf, demandOf, endpointsOf });

  /* Every saved plan scored exactly as finalising scores it, so the gallery can rank plans by any
     KPI (kpiRank.PLAN_RANK) with the same numbers the board and the finalised body carry. Only
     while the gallery is on screen; a plan that cannot be scored (empty) ranks last. */
  const draftBodies = useMemo(() => {
    if (view !== "gallery" || !ready) return null;
    const out = new Map();
    for (const d of drafts) { try { out.set(d.id, scoreDraft(d)); } catch { out.set(d.id, null); } }
    return out;
  }, [view, ready, drafts, stopsById, idxOf, demandOf, allStops, endpointsOf, fleet, depot, metric, totalRiders]); // eslint-disable-line

  const meta = () => {
    const used = editor.perBus.filter((r) => r.stopIds.length);
    return { riders: used.reduce((n, r) => n + r.heads, 0), buses: used.length, stops: used.reduce((n, r) => n + r.stopIds.length, 0) };
  };

  // ---- gallery actions ----
  const openDraft = (d) => { setImportedPlan(null); setSeed(mapFrom(d.assignments)); setCurrent({ id: d.id, name: d.name }); setDraftName(d.name); setView("editor"); };
  /* Routes the import could not place because their bus is no longer in the ERP fleet.
     They are removed whole — riders, stops and cost — so the board must say so rather than
     quietly showing a smaller, cheaper plan than the one that was finalised. */
  const [droppedRoutes, setDroppedRoutes] = useState(() => (keep && keep.droppedRoutes) || []);
  const droppedRiders = droppedRoutes.reduce((n, d) => n + d.riders, 0);
  const droppedCost = droppedRoutes.reduce((n, d) => n + d.cost, 0);
  const newBlank = () => { setDroppedRoutes([]); setImportedPlan(null); setSeed(new Map(EMPTY)); setCurrent(null); setDraftName("Untitled plan"); setView("editor"); };
  const importPlan = () => {
    if (!solver) { toast && toast("No optimised plan to import"); return; }
    const label = planLabel;
    const { seed, extras, demand, dropped } = seedFromSolver(solver, fleet, storeStops);
    setDroppedRoutes(dropped);
    setImportedPlan({ extras, demand });
    setSeed(seed); setCurrent(null); setDraftName(`Imported ${label} plan`); setView("editor");
    toast && toast((planKind === "optimised" ? `Imported the ${label} optimised plan` : `Imported “${label}”`) + (extras.length ? ` (${extras.length} stops carried from the plan file)` : ""));
  };
  const deleteDraft = (d) => { store.deletePlanDraft(d.id); setDrafts(store.listPlanDrafts(svcId)); toast && toast("Plan deleted"); };
  // Prev-route seed: current_routes.json stores buses[].stops[] (ERP's actual allocation).
  // Reshape to the solver_result form so the same faithful-import path handles it.
  const importPrevRoutes = () => {
    if (!prevRoutes) { toast && toast("Previous routes aren't loaded yet"); return; }
    /* `s.hc` is the stop's WHOLE-VEHICLE headcount — every rider who boards there on any
       service. A pickup point is shared: the same corner serves General riders and Rotational
       riders, so seeding a Rotational Day plan from `hc` loaded 1,166 people onto a service
       that carries 250. Take this service's share of each stop, and drop stops that carry
       none of its riders — they belong to another service's run, not this one.

       Falls back to `s.hc` when by_service is absent (a current_routes.json built before the
       split existed), which is the pre-existing behaviour rather than an empty plan. */
    const hcOf = prevStopRiders(prevRoutes.buses, svc && svc.id);
    const shaped = { routes: prevRoutes.buses.map((b) => ({
      name: b.name, type: b.type === "owned" ? "own" : b.type, cap: b.seat,
      seq: (b.stops || [])
        .map((s) => ({ name: s.name, lat: s.lat, lng: s.lng, hc: hcOf(s) }))
        .filter((s) => s.hc > 0),
    })).filter((r) => r.seq.length) };
    const { seed, extras, demand, dropped } = seedFromSolver(shaped, fleet, storeStops);
    let placed = 0; for (const ids of seed.values()) placed += ids.length;
    if (!placed) { toast && toast("Previous routes didn't match this fleet"); return; }
    setDroppedRoutes(dropped);
    setImportedPlan({ extras, demand });
    setSeed(seed); setCurrent(null); setDraftName("Previous routes (ERP)"); setView("editor");
    toast && toast(`Loaded the previously-ran routes${extras.length ? ` · ${extras.length} stops carried from the ERP feed` : ""}`);
  };

  // Collaboration: open a plan JSON a teammate exported (same solver_result shape as Export
  // writes), through the same faithful-import path as "From optimised plan".
  const importFromFile = (json, fname) => {
    if (!json || !Array.isArray(json.routes) || !json.routes.some((r) => Array.isArray(r.seq) && r.seq.length)) {
      toast && toast("That file isn't a plan export — expected the JSON the Planner's Export button writes"); return;
    }
    const { seed, extras, demand, dropped } = seedFromSolver(json, fleet, storeStops);
    let placed = 0; for (const ids of seed.values()) placed += ids.length;
    if (!placed) { toast && toast("No routes in that file matched this fleet — is it from the same dashboard?"); return; }
    const skipped = json.routes.filter((r) => (r.seq || []).length && !seed.has(r.name)).length;
    setDroppedRoutes(dropped);
    setImportedPlan({ extras, demand });
    setSeed(seed); setCurrent(null);
    setDraftName((fname || "Imported plan").replace(/\.solver_result\.json$|\.json$/i, ""));
    setView("editor");
    toast && toast(`Imported ${fname || "plan file"}`
      + (extras.length ? ` · ${extras.length} stops carried from the file` : "")
      + (skipped ? ` · ${skipped} routes skipped (unknown bus)` : ""));
  };

  // ---- editor actions ----
  const save = () => {
    const id = store.savePlanDraft({ id: current && current.id, name: draftName, assignments: editor.assign, meta: meta(), svc: svcId });
    const name = (draftName || "").trim() || "Untitled plan";
    setCurrent({ id, name }); setDraftName(name); setDrafts(store.listPlanDrafts(svcId));
    toast && toast("Plan saved");
  };
  const backToGallery = () => { setDrafts(store.listPlanDrafts(svcId)); setView("gallery"); };
  const reset = () => { setImportedPlan(null); setSeed(new Map(EMPTY)); };
  // Clear wipes the whole board and re-seeds the editor, so it can't be undone — callers ask first.
  const clearBoard = () => {
    reset();
    toast && toast("Board cleared");
  };
  const exportJson = () => { if (editor.live) { downloadPlanJson(editor.live, fleet, depot, totalRiders, allStops); toast && toast("Exported plan JSON"); } };

  // the board as it stands, for the next mount; the editor's stops become that mount's seed
  useEffect(() => {
    if (keep) Object.assign(keep, { view, period, current, draftName, seed: editor.assign, importedPlan, droppedRoutes });
  });

  return {
    depot, svcId, planSource, planLabel, planKind, solver, solverLoaded, fleet, prevRoutes, allStops, stopsById, demandOf,
    totalRiders, busColor, ready, estimated, view, period, setPeriod, drafts, finalised, finalise, current, draftName,
    setDraftName, endPrefs, setEndPrefs, editor, draftBodies, droppedRoutes, droppedRiders, droppedCost,
    openDraft, newBlank, importPlan, deleteDraft, importPrevRoutes, importFromFile, save, backToGallery, clearBoard,
    exportJson,
  };
}

/* -------------------------------------------------------------- the board --
   The map-first editor's state: which bus is being worked on, what the map shows, what a click
   on a stop means, the plan's figures and the bus list's order. `beforeReorder` runs just before
   the bus list is re-ranked, so the caller can capture where the cards were and animate them. */
export function usePlanBoard({ editor, fleet, depot, stopsById, totalRiders, demandOf, toast, period = "evening", svcId = "plan", parkPrefs, setParkPrefs, beforeReorder, plain = false }) {
  // Assignments are stored in EVENING traversal order (factory → s1 → … → sn). Morning is the
  // same chain ridden backwards (sn → … → s1 → factory), so morning clicks PREPEND: the first
  // stop you click is where the bus starts, and each next click adds the stop after it on the
  // way to the factory. Costs/KPIs are direction-free (chain km already counts both runs).
  const morning = period === "morning";
  const [activeBus, setActiveBus] = useState(null);
  const [busQuery, setBusQuery] = useState("");
  const busColor = useMemo(() => { const m = {}; fleet.forEach((b, i) => (m[b.id] = PALETTE[i % PALETTE.length])); return m; }, [fleet]);
  const busById = useMemo(() => { const m = {}; fleet.forEach((b) => (m[b.id] = b)); return m; }, [fleet]);

  const busOfStop = useMemo(() => {
    const m = new Map();
    for (const [busId, ids] of editor.assign) ids.forEach((id) => m.set(id, busId));
    return m;
  }, [editor.assign]);

  /* ---- where each bus starts and parks ----
     Per bus, per service, so one registration can start and park differently on its Day run
     and its night one. The state lives in usePlanHub because the SCORING depends on it — km,
     ride time and cost are all measured between these two points — so the board receives it
     rather than owning it. Changing an end therefore moves the pins and the numbers together.

     Clicking a stop on the map is the other half of the answer: a village worth parking in is
     usually a stop the route already serves, and picking it off a list of 1,134 names is a
     worse way to say "that one" than pointing at it. */
  const parkPoints = useParkPoints();
  /* One state, not two. While `picking` is set the map is choosing that endpoint — there is no
     separate "armed" step to forget, and therefore no window in which a click means something
     other than what the open panel says it means. */
  const [picking, setPicking] = useState(null);       // { busId, which: "start"|"park" } | null
  const nameOf = (busId) => (busById[busId] || {}).name || busId;
  /* One lookup per end, both from parkPrefs. The storage key format was being rebuilt by hand
     here as well as in the hook that scores the plan; a third copy would have been the one that
     drifted, and a drifted key reads as "no choice made" rather than failing. */
  const specOf = (busId, which) =>
    (which === "start" ? startForRoute : parkForRoute)(svcId, nameOf(busId), parkPrefs);

  const setEnd = (busId, which, spec) => {
    const name = nameOf(busId);
    setParkPrefs(which === "start" ? setRouteStart(svcId, name, spec) : setRoutePark(svcId, name, spec));
    setPicking(null);
    const where = !spec || spec.kind === "auto" ? (which === "start" ? "the factory" : "where its route ends")
      : spec.kind === "depot" ? "the factory" : spec.name;
    toast && toast(`${name} ${which === "start" ? "starts from" : "parks at"} ${where}`);
  };

  /* S and P for the ACTIVE bus only. 97 buses would be 194 pins; while you are working on one,
     its two ends are what you need to see.
       evening — the bus leaves its start (S) and finishes out in the villages (P)
       morning — it starts where it parked (S) and delivers to the factory (P)
     The same two points swap letters with the direction, which is what the labels are for. */
  const endPins = useMemo(() => {
    if (!activeBus) return [];
    const r = editor.perBus.find((x) => x.bus.id === activeBus);
    if (!r || !r.stops.length) return [];
    /* Read the points the ROW WAS SCORED WITH rather than re-deriving them here — two
       derivations of the same thing drift, and then the pin and the cost disagree. */
    const label = (pt, fallback) => (pt && (pt.name || pt.label)) || fallback;
    const startPt = r.start || depot;
    const parkPt = r.park || r.stops[r.stops.length - 1];
    const [S, P] = morning ? [parkPt, startPt] : [startPt, parkPt];
    // `plain` words the titles for the new look: no dashes, no developer terms
    const est = !r.estimatedEnds ? ""
      : plain ? "\nNo road distance yet · km may read low"
      : "\n(straight-line estimate — this point is not on the road matrix)";
    return [
      { lat: S.lat, lng: S.lng, label: "S", color: START_COLOR,
        title: `Starts at ${label(S, "the factory")}${est}` },
      { lat: P.lat, lng: P.lng, label: "P", color: PARK_COLOR,
        title: `Ends at ${label(P, "its last stop")}` +
               (morning ? "" : plain ? " and waits here until its next run" : " — and waits here until its next run") + est },
    ];
  }, [activeBus, editor.perBus, depot, morning, plain]);

  const allStops = useMemo(() => [...stopsById.values()], [stopsById]);
  const assignedHeads = editor.perBus.reduce((n, r) => n + r.heads, 0);
  const progress = totalRiders ? (assignedHeads / totalRiders) * 100 : 0;
  const busesUsed = editor.perBus.filter((r) => r.stopIds.length).length;
  const unassignedCount = allStops.length - busOfStop.size;

  // map stops — coloured by their assigned bus (grey if none)
  // With a bus active, hide stops that belong to OTHER buses — only show what's assignable
  // (unassigned = red) plus this bus's own stops (green). With no bus active, show everything.
  // Each assigned stop is coloured by its OWNING bus (so its dot matches that bus's route line and
  // its card) and carries the bus name/colour for the hover tooltip. Unassigned stops stay red.
  const mapStops = useMemo(() => allStops
    .filter((s) => { const b = busOfStop.get(s.id); return !activeBus || !b || b === activeBus; })
    .map((s) => {
      const b = busOfStop.get(s.id);
      return { ...s, route: b || "un", headcount: demandOf(s),
        busName: b ? (busById[b] && busById[b].name) || "" : null,
        busColor: b ? busColor[b] : null };
    }), [allStops, busOfStop, demandOf, activeBus, busById, busColor]);
  const routeColors = useMemo(() => ({ ...busColor, un: UNADDED }), [busColor]);

  // route lines to draw — all buses normally, but ONLY the active bus while one is selected
  // (so lines don't trace to the now-hidden other-bus stops).
  const shownRoutes = useMemo(() => editor.perBus.filter((r) => r.stops.length && (!activeBus || r.bus.id === activeBus)), [editor.perBus, activeBus]);
  const routeSig = useMemo(() => shownRoutes.map((r) => r.bus.id + ":" + r.stopIds.join(",")).join("|"), [shownRoutes]);
  const [roadPolys, setRoadPolys] = useState([]);
  useEffect(() => {
    let live = true;
    Promise.all(shownRoutes.map(async (r) => ({ color: busColor[r.bus.id], points: await routeGeometry(depot, r.stops) })))
      .then((p) => { if (live) setRoadPolys(p.filter((x) => x.points.length)); });
    return () => { live = false; };
  }, [routeSig]); // eslint-disable-line
  const straightPolys = useMemo(() => shownRoutes.map((r) => ({ color: busColor[r.bus.id], points: [[depot.lat, depot.lng], ...r.stops.map((s) => [s.lat, s.lng])] })), [shownRoutes, depot, busColor]);
  const polylines = roadPolys.length ? roadPolys : straightPolys;

  // click a stop on the map → append it to the active bus IN CLICK ORDER (no auto-sequence, so the
  // route chain matches the order you built it), or (if already on it) remove JUST that stop —
  // the rest of the route stays. Use the bus card's ↯ to re-optimise the order after a removal.
  const onStopClick = (stopId) => {
    /* THE PICKER BEING OPEN IS ITSELF THE MODE. While you are choosing where a bus starts or
       parks, a click on the map means "there" — it never adds the stop to the route or takes it
       off. Saying where to leave a bus is not the same as saying who it carries, and an earlier
       cut that needed a separate "pick on map" press made every click before that press do the
       wrong thing silently. */
    if (picking) {
      const s = stopsById.get(stopId);
      if (s) setEnd(picking.busId, picking.which, { kind: "stop", lat: s.lat, lng: s.lng, name: s.name });
      return;
    }
    const owner = busOfStop.get(stopId); // bus this stop is currently on (undefined if unassigned)
    if (activeBus) {
      const list = editor.assign.get(activeBus) || [];
      const i = list.indexOf(stopId);
      if (i >= 0) { editor.unassignStop(stopId); return; }
      // clicked a stop that belongs to a DIFFERENT bus → jump focus to its bus instead of adding
      if (owner && owner !== activeBus) { setActiveBus(owner); return; }
      // evening builds outward from the factory (append); morning builds toward it (prepend, so
      // the first click is the route start and each next click sits closer to the factory)
      if (morning) editor.insertStopAt(stopId, activeBus, 0);
      else editor.assignStop(stopId, activeBus, { sequence: false });
      return;
    }
    // no bus active: clicking an already-assigned stop selects (highlights + tops) its bus, so you
    // can instantly see and work on it. Clicking an unassigned stop still needs a target bus first.
    if (owner) { setActiveBus(owner); return; }
    toast && toast("Pick a bus first, then click stops on the map");
  };

  // KPI scope — active bus if one is picked, else the whole plan
  const row = activeBus ? editor.perBus.find((r) => r.bus.id === activeBus) : null;
  const k = editor.live ? editor.live.kpis : null;
  const busName = row ? row.bus.name : "";
  // people-weighted average ride across the used buses (mirrors the Fleet-plan avg-ride metric)
  const usedRows = editor.perBus.filter((r) => r.stopIds.length);
  const rideHeads = usedRows.reduce((n, r) => n + r.heads, 0) || 1;
  const avgRide = usedRows.reduce((n, r) => n + r.ride * r.heads, 0) / rideHeads;

  /* The Planner now carries the SAME metric set as the Fleet-plan board, filtered by the
     shared preference. It previously showed four of the ten, so figures you were steering by
     while building a plan disappeared the moment you opened the finished one. Keys match
     kpiPrefs.KPI_DEFS; the maths mirrors the Fleet-plan definitions exactly (ride and
     distance are people-weighted, distance is halved to one-way). */
  const [hiddenKpis, setHidden] = useState(getHiddenKpis);
  const toggleKpi = (key) => {
    const next = new Set(hiddenKpis);
    next.has(key) ? next.delete(key) : next.add(key);
    setHiddenKpis(next); setHidden(next);
  };
  const showAllKpis = () => { setHiddenKpis(new Set()); setHidden(new Set()); };
  const ownRows = usedRows.filter((r) => r.bus.type === "own");
  const rentRows = usedRows.filter((r) => r.bus.type === "rent");
  const seatSum = (list) => list.reduce((n, r) => n + (+r.cap || 0), 0);
  const totKm = usedRows.reduce((n, r) => n + (+r.km || 0), 0);
  const maxRide = usedRows.reduce((mx, r) => Math.max(mx, r.ride), 0);
  const distPP = usedRows.reduce((n, r) => n + (r.km / 2) * r.heads, 0) / rideHeads;
  const avgStops = usedRows.length ? usedRows.reduce((n, r) => n + r.stopIds.length, 0) / usedRows.length : 0;

  /* Pressing a tile ranks the bus list by that figure (kpiRank.js): highest first, then lowest
     first, then back to normal. Owned / Rental narrow the list to that kind of bus instead. The
     cards slide to their new places, so the eye follows a bus rather than losing it. */
  const [rank, setRank] = useState(null);                  // { key, dir } | null
  const [typeOnly, setTypeOnly] = useState(null);          // "own" | "rent" | null
  const pressKpi = (key) => {
    if (!TYPE_KEYS[key] && !BUS_RANK[key]) return;
    beforeReorder && beforeReorder();
    if (TYPE_KEYS[key]) setTypeOnly((cur) => (cur === TYPE_KEYS[key] ? null : TYPE_KEYS[key]));
    else setRank((cur) => nextRank(cur, key));
  };
  const clearRank = () => { beforeReorder && beforeReorder(); setRank(null); setTypeOnly(null); };
  const kpiOn = (key) => (TYPE_KEYS[key] ? typeOnly === TYPE_KEYS[key] : !!rank && rank.key === key);
  const kpiTitle = (key) => TYPE_KEYS[key]
    ? (kpiOn(key) ? "Show every bus again" : `Show only ${key === "owned" ? "owned" : "rental"} buses`)
    : !BUS_RANK[key] ? undefined
    : !kpiOn(key) ? `Rank the buses by ${BUS_RANK[key].label.toLowerCase()}, highest first`
    : rank.dir === "desc" ? "Press for lowest first" : "Press to stop ranking";

  const busList = useMemo(() => {
    const q = busQuery.trim().toLowerCase();
    const list = editor.perBus.filter((r) => (!q || r.bus.name.toLowerCase().includes(q)) && (!typeOnly || r.bus.type === typeOnly));
    if (rank && BUS_RANK[rank.key]) {
      const def = BUS_RANK[rank.key];
      // a bus with no stops has nothing to rank; it keeps its place at the end
      return rankBy(list, (r) => (r.stopIds.length
        ? def.value({ riders: r.heads, cap: r.cap, cost: r.cost, ride: r.ride, km: r.km, stops: r.stopIds.length })
        : null), rank.dir);
    }
    // Pin the active bus to the top so a stop you just clicked is right there for easy access.
    return list.sort((a, b) => (b.bus.id === activeBus) - (a.bus.id === activeBus)).map((item) => ({ item, value: null, rank: null }));
  }, [editor.perBus, busQuery, activeBus, rank, typeOnly]);

  return {
    morning, activeBus, setActiveBus, busQuery, setBusQuery, busColor, busById, parkPoints, picking, setPicking,
    nameOf, specOf, setEnd, endPins, totalRiders, assignedHeads, progress, busesUsed, unassignedCount, mapStops, routeColors,
    polylines, onStopClick, row, k, busName, usedRows, avgRide, hiddenKpis, toggleKpi, showAllKpis, ownRows, rentRows,
    seatSum, totKm, maxRide, distPP, avgStops, rank, typeOnly, pressKpi, clearRank, kpiOn, kpiTitle, busList,
  };
}

/* The board's figure tiles, scoped to the active bus while one is picked, else the whole plan.
   `t` supplies the verdict colours (good / watch / poor / muted) and nothing else. */
export function planTiles({ row, k, busName, morning, assignedHeads, totalRiders, progress, busesUsed, unassignedCount,
  usedRows, avgRide, maxRide, totKm, distPP, ownRows, rentRows, seatSum, avgStops }, t) {
  const dash = "—";
  return row ? [
    { key: "people", label: `Riders · ${busName}`, value: `${row.heads} / ${row.cap}`, sub: row.overCap ? "over capacity" : row.overSeats ? "over seats" : "seats filled", accent: row.overCap ? t.poor : row.overSeats ? t.watch : null, dc: row.overCap ? t.poor : row.overSeats ? t.watch : t.muted },
    { key: "util", label: "Utilisation", value: `${Math.round(row.fill * 100)}%`, sub: `${row.stops.length} stops`, accent: row.fill >= 0.85 ? t.good : t.watch },
    { key: "cost", label: "Cost / head — this bus", value: row.heads ? `₹${(row.cost / row.heads).toFixed(1)}` : dash, sub: `₹${Math.round(row.cost)} / day` },
    { key: "ride", label: morning ? "Ride (first stop → factory)" : "Ride (to last stop)", value: `${Math.round(row.ride)} min`, sub: row.km ? `${row.km.toFixed(1)} km/day` : "", accent: row.ride < 100 ? t.good : t.poor },
    { key: "totdist", label: "Total dist", value: row.km ? `${row.km.toFixed(1)} km` : dash, sub: "this bus" },
    { key: "avgstops", label: "Stops", value: row.stopIds.length, sub: "on this bus" },
  ] : [
    { key: "people", label: "People", value: `${assignedHeads} / ${totalRiders}`, sub: `${progress.toFixed(0)}% assigned`, dc: progress >= 99.5 ? t.good : t.muted },
    /* Say WHICH question this answers. It is the board on screen, costed standalone — every
       bus charged in full to this service. The Finalised-plans table answers two different
       questions about a different plan (the finalised one, alone AND adjusted for buses shared
       with other services), and the two were read as a contradiction because neither said so. */
    { key: "cost", label: "Cost / head — this plan, alone", value: k && k.heads ? `₹${k.costPerHeadDay.toFixed(1)}` : dash,
      sub: k ? `₹${Math.round(k.totalCost).toLocaleString("en-IN")} / day · ${k.heads} on a bus` : "" },
    { key: "util", label: "Avg util", value: k ? `${k.utilisation.toFixed(0)}%` : dash, sub: `${busesUsed} bus${busesUsed === 1 ? "" : "es"} used`, accent: k && k.utilisation >= 85 ? t.good : t.watch },
    { key: "avgride", label: "Avg ride", value: usedRows.length ? `${Math.round(avgRide)} min` : dash, sub: `${unassignedCount} stops left`, accent: usedRows.length && avgRide <= 60 ? t.good : t.poor },
    { key: "ride", label: "Max ride", value: usedRows.length ? `${Math.round(maxRide)} min` : dash, sub: "longest trip", accent: usedRows.length && maxRide <= 110 ? t.good : t.poor },
    { key: "totdist", label: "Total dist", value: usedRows.length ? `${Math.round(totKm).toLocaleString("en-IN")} km` : dash, sub: "whole plan" },
    { key: "avgdist", label: "Dist / person", value: usedRows.length ? `${distPP.toFixed(1)} km` : dash, sub: "one-way" },
    { key: "owned", label: "Owned", value: ownRows.length, sub: `${seatSum(ownRows).toLocaleString("en-IN")} seats` },
    { key: "rental", label: "Rental", value: rentRows.length, sub: `${seatSum(rentRows).toLocaleString("en-IN")} seats` },
    { key: "seats", label: "Seats", value: seatSum(usedRows).toLocaleString("en-IN"), sub: `${assignedHeads} riders` },
    { key: "avgstops", label: "Stops / bus", value: usedRows.length ? avgStops.toFixed(1) : dash, sub: "average" },
  ];
}

/* ------------------------------------------------------------ the gallery --
   Rank the saved plans by any KPI the boards show (the same hidden-KPI preference applies):
   highest first, then lowest first, then back to newest first. Each plan is scored the way
   finalising scores it (usePlanHub.scoreDraft), so a figure here matches the board.
   `beforeChange` runs just before the order changes, so the caller can animate the cards. */
export function usePlanRanking(drafts, bodies, beforeChange) {
  const [rank, setRank] = useState(null);                  // { key, dir } | null
  const [hidden] = useState(getHiddenKpis);
  const chips = KPI_DEFS.filter((d) => PLAN_RANK[d.key] && !hidden.has(d.key));
  const press = (key) => {
    beforeChange && beforeChange();
    setRank((cur) => (key ? nextRank(cur, key) : null));
  };
  const ranked = useMemo(() => {
    if (!rank) return drafts.map((d) => ({ item: d, value: null, rank: null }));
    const def = PLAN_RANK[rank.key];
    return rankBy(drafts, (d) => { const b = bodies && bodies.get(d.id); return b ? def.value(b) : null; }, rank.dir);
  }, [drafts, rank, bodies]);
  return { rank, setRank, chips, press, ranked };
}

/* Which candidate is the finalised one. `isDefault` means nobody chose — the optimised
   plan is standing in — and that must read differently from a deliberate choice. */
export const isFinalOf = (finalised, kind, id) => !!finalised && !finalised.isDefault &&
  (kind === "draft" ? finalised.draftId === id : finalised.kind === "plan");

/** Thumbnail polylines for the permanent prev-route card (drawn straight from the ERP feed). */
export function prevRouteLines(prevPlan) {
  if (!prevPlan || !Array.isArray(prevPlan.buses)) return null;
  return prevPlan.buses.map((b, i) => ({
    color: PALETTE[i % PALETTE.length],
    coords: (b.stops || []).filter((s) => s.lat != null && s.lng != null).map((s) => [s.lat, s.lng]),
  })).filter((l) => l.coords.length);
}

/** The file input's change handler for "Import plan file": hands the parsed JSON (or null when
 *  it is not JSON) and the file name to `onImportFile`, which says what was wrong. */
export async function readPlanFile(e, onImportFile) {
  const f = e.target.files && e.target.files[0];
  e.target.value = ""; // allow picking the same file again
  if (!f || !onImportFile) return;
  try { onImportFile(JSON.parse(await f.text()), f.name); }
  catch { onImportFile(null, f.name); } // parent shows the "not a plan file" toast
}
