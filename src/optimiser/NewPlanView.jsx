/* ============================================================================
 * optimiser/NewPlanView.jsx — the Planning hub (Google-Docs style)
 * ----------------------------------------------------------------------------
 * A landing gallery to open a saved plan / start blank / import the optimised
 * plan, then a full map-first editor (NewPlanBoard). Plans are named drafts you
 * can save, reopen and delete — each stored in localStorage.
 * ==========================================================================*/
import React, { useCallback, useEffect, useMemo, useState } from "react";
import * as store from "./store.js";
import { usePlanMetric, usePlanEditor, seedFromSolver, fleetFromSolver, fleetFromErp, busForEngine } from "./planEditor.js";
import { Btn, Empty, PALETTE } from "./ui.jsx";
import NewPlanBoard from "./NewPlanBoard.jsx";
import PlanGallery from "./PlanGallery.jsx";
import { activePlanUrl, getActivePlanLabel } from "./planOptions.js";
import { resolveFinalised, setFinalised, clearFinalised } from "./finalisedPlans.js";
import { Save, Sparkles, RotateCcw, Download, Undo2, Redo2, Wand2, ArrowLeft, Sunset, Sunrise } from "lucide-react";
import { downloadPlanJson, toSolverResult } from "./planExport.js";
import { scorePlan } from "./engine.js";
import { getParkPrefs, parkForRoute } from "./parkPrefs.js";
import { useParkPoints } from "./ParkPicker.jsx";

const EMPTY = new Map();
const mapFrom = (assignments) => { const m = new Map(); for (const k of Object.keys(assignments || {})) m.set(k, assignments[k]); return m; };

/* `svc` scopes the whole board to one service. Without it the Planner always used the
   global depot, the curated 9 am stop set, the 9 am plan and one shared draft list — so
   "planning Zenwear" actually routed Batlagundu's stops from Batlagundu's depot. `svcStops`
   is the service's own derived network (null for 9 am, which plans on the curated store). */
export default function NewPlanView({ t, toast, erpBuses, svc, svcStops }) {
  const depot = useMemo(() => (svc && svc.depot) || store.getDepot(), [svc]);
  const matrixUrl = (svc && svc.matrixUrl) || undefined;
  const svcId = (svc && svc.id) || "s9";
  const storeStops = useMemo(
    () => (svcStops && svcStops.length ? svcStops : store.getStops()).filter((s) => s.lat != null && s.lng != null),
    [svcStops]
  );

  // This service's optimised plan. `activePlanUrl()` is the 9 am plan-variant picker, so it
  // is only the right source when no service-specific plan exists.
  const planSrc = svc && svc.id !== "s9" ? (svc.planUrl || null) : activePlanUrl();
  // "Balanced" is the name of a 9 am plan VARIANT. Reusing it on another service's board
  // labels that service's own optimiser output with a plan it has nothing to do with.
  const planLabel = svc && svc.id !== "s9" ? `${svc.name} optimised` : getActivePlanLabel();
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
        // The card reads meta.riders / meta.vehicles, so filtering the buses alone still
        // advertised the whole fleet's 3,097 riders on a service that has 786.
        const meta = { ...(d.meta || {}), vehicles: buses.length,
          riders: buses.reduce((s, b) => s + (+b.riders || 0), 0) };
        setPrevRoutes({ ...d, buses, meta });
      }).catch(() => {});
  }, [erpBuses]);
  // set on import: stops carried over from the plan file that aren't in the store, plus the
  // plan's own per-stop rider counts — so the editor presents the plan exactly as solved
  const [importedPlan, setImportedPlan] = useState(null);   // { extras: stop[], demand: Map } | null
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
  const [view, setView] = useState("gallery");           // "gallery" | "editor"
  // Evening = factory → stops (drop-off, how plans are stored). Morning = the same chain
  // ridden in reverse: last stop → … → first stop → factory (pickup). Display/editing only —
  // the cost model already counts both directions (chain km = 2 × one-way).
  const [period, setPeriod] = useState("evening");       // "evening" | "morning"
  const [drafts, setDrafts] = useState(() => store.listPlanDrafts(svcId));
  /* Which plan this service actually runs. Absent -> the optimiser's output stands in,
     flagged isDefault so "nobody decided" never reads as "somebody chose this". */
  const [finalised, setFinal] = useState(() => (svc ? resolveFinalised(svc) : null));
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
    const live = scorePlan(asg, fleet.map(busForEngine), depot, metric ? { metric } : {});
    if (!live || !live.ok) return null;
    return toSolverResult(live, fleet, depot, totalRiders, allStops);
  };

  const finalise = (ref) => {
    if (!svc) return;
    const cur = resolveFinalised(svc);
    const same = ref.kind === "draft" ? cur.draftId === ref.id : cur.kind === "plan" && !cur.isDefault;
    if (same) { clearFinalised(svc.id); setFinal(resolveFinalised(svc)); toast && toast(`${svc.name} back to the optimised plan`); return; }
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
  const [current, setCurrent] = useState(null);           // { id, name } of the open saved draft, or null (unsaved)
  const [draftName, setDraftName] = useState("Untitled plan");
  const [seed, setSeed] = useState(EMPTY);

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
  const endpointsOf = useCallback((busId, busName, lastStop) => {
    const startSpec = endPrefs.starts && endPrefs.starts[`${svcId}|${busName}`];
    const parkSpec = parkForRoute(svcId, busName, endPrefs);
    const start = startSpec ? pointOf(startSpec, null) : null;
    const park = parkSpec && parkSpec.kind !== "auto" ? pointOf(parkSpec, null) : null;
    return { start, park };
  }, [endPrefs, svcId, pointOf]);

  const editor = usePlanEditor({ seed, fleet, depot, stopsById, metric, idxOf, demandOf, endpointsOf });

  const meta = () => {
    const used = editor.perBus.filter((r) => r.stopIds.length);
    return { riders: used.reduce((n, r) => n + r.heads, 0), buses: used.length, stops: used.reduce((n, r) => n + r.stopIds.length, 0) };
  };

  // ---- gallery actions ----
  const openDraft = (d) => { setImportedPlan(null); setSeed(mapFrom(d.assignments)); setCurrent({ id: d.id, name: d.name }); setDraftName(d.name); setView("editor"); };
  const newBlank = () => { setImportedPlan(null); setSeed(new Map(EMPTY)); setCurrent(null); setDraftName("Untitled plan"); setView("editor"); };
  const importPlan = () => {
    if (!solver) { toast && toast("No optimised plan to import"); return; }
    const label = planLabel;
    const { seed, extras, demand } = seedFromSolver(solver, fleet, storeStops);
    setImportedPlan({ extras, demand });
    setSeed(seed); setCurrent(null); setDraftName(`Imported ${label} plan`); setView("editor");
    toast && toast(`Imported the ${label} optimised plan` + (extras.length ? ` (${extras.length} stops carried from the plan file)` : ""));
  };
  const deleteDraft = (d) => { store.deletePlanDraft(d.id); setDrafts(store.listPlanDrafts(svcId)); toast && toast("Plan deleted"); };
  // Prev-route seed: current_routes.json stores buses[].stops[] (ERP's actual allocation).
  // Reshape to the solver_result form so the same faithful-import path handles it.
  const importPrevRoutes = () => {
    if (!prevRoutes) { toast && toast("Previous routes aren't loaded yet"); return; }
    const shaped = { routes: prevRoutes.buses.map((b) => ({
      name: b.name, type: b.type === "owned" ? "own" : b.type, cap: b.seat,
      seq: (b.stops || []).map((s) => ({ name: s.name, lat: s.lat, lng: s.lng, hc: s.hc })),
    })) };
    const { seed, extras, demand } = seedFromSolver(shaped, fleet, storeStops);
    let placed = 0; for (const ids of seed.values()) placed += ids.length;
    if (!placed) { toast && toast("Previous routes didn't match this fleet"); return; }
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
    const { seed, extras, demand } = seedFromSolver(json, fleet, storeStops);
    let placed = 0; for (const ids of seed.values()) placed += ids.length;
    if (!placed) { toast && toast("No routes in that file matched this fleet — is it from the same dashboard?"); return; }
    const skipped = json.routes.filter((r) => (r.seq || []).length && !seed.has(r.name)).length;
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
  // Clear wipes the whole board and re-seeds the editor, so it can't be undone — warn first.
  const clearWithConfirm = () => {
    if (window.confirm("Clear the whole board?\n\nThis removes every stop from every bus and can't be undone.")) {
      reset();
      toast && toast("Board cleared");
    }
  };
  const importIntoEditor = () => {
    if (!solver) { toast && toast("No optimised plan to import"); return; }
    const { seed, extras, demand } = seedFromSolver(solver, fleet, storeStops);
    setImportedPlan({ extras, demand });
    setSeed(seed); toast && toast(`Imported the ${planLabel} plan into this editor`);
  };
  const exportJson = () => { if (editor.live) { downloadPlanJson(editor.live, fleet, depot, totalRiders, allStops); toast && toast("Exported plan JSON"); } };

  if (!ready || !solverLoaded) return <Empty t={t} title="Loading road network…" sub="Building the distance matrix for live routing." />;

  if (view === "gallery") {
    return <PlanGallery t={t} drafts={drafts} totalRiders={totalRiders} canImport={!!solver} planLabel={planLabel} finalised={finalised} onFinalise={finalise}
      stopsById={stopsById} depot={depot} busColor={busColor}
      onNewBlank={newBlank} onImport={importPlan} onOpen={openDraft} onDelete={deleteDraft} onImportFile={importFromFile}
      onImportPrev={importPrevRoutes} prevPlan={prevRoutes} />;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Btn t={t} variant="ghost" onClick={backToGallery} title="Back to your plans"><ArrowLeft size={15} /> Plans</Btn>
        <input value={draftName} onChange={(e) => setDraftName(e.target.value)} placeholder="Plan name…"
          className="rounded-lg px-3 py-1.5 text-sm font-semibold outline-none" style={{ border: "1px solid " + t.border, background: t.surface, color: t.text, minWidth: 200 }} />
        {current && <span className="text-[11px]" style={{ color: t.muted }}>saved</span>}
        <div className="inline-flex items-center rounded-xl p-1" style={{ background: t.surface2, border: "1px solid " + t.border }}>
          {[["evening", "Evening", Sunset], ["morning", "Morning", Sunrise]].map(([id, label, Icon]) => (
            <button key={id} type="button" onClick={() => setPeriod(id)}
              title={id === "evening" ? "Drop-off: factory → stops (last stop is the end of the line)" : "Pickup: last stop → … → factory (the same chain, ridden in reverse)"}
              className="px-2.5 py-1 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 transition"
              style={{ background: period === id ? t.raised : "transparent", color: period === id ? t.text : t.muted,
                       boxShadow: period === id ? `inset 0 -2px 0 ${t.primary}` : "none", cursor: "pointer" }}>
              <Icon size={13} /> {label}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <Btn t={t} variant="ghost" onClick={editor.undo} disabled={!editor.canUndo} title="Undo"><Undo2 size={15} /></Btn>
        <Btn t={t} variant="ghost" onClick={editor.redo} disabled={!editor.canRedo} title="Redo"><Redo2 size={15} /></Btn>
        {/* Clear wipes the whole board — destructive, held apart from the safe Export/Save group, and confirmed first */}
        <Btn t={t} variant="danger" onClick={clearWithConfirm} title="Empty the board — removes every stop from every bus"><RotateCcw size={15} /> Clear</Btn>
        <span aria-hidden className="self-stretch mx-1" style={{ width: 1, background: t.border }} />
        <Btn t={t} variant="ghost" onClick={exportJson}><Download size={15} /> Export</Btn>
        <Btn t={t} onClick={save}><Save size={15} /> Save</Btn>
      </div>
      {estimated && <div className="text-xs rounded-xl px-3 py-2" style={{ background: t.watch + "22", color: t.watch }}>Using straight-line distance estimates — the road matrix cache didn't cover every stop.</div>}
      <NewPlanBoard t={t} editor={editor} fleet={fleet} depot={depot} stopsById={stopsById} totalRiders={totalRiders} demandOf={demandOf} toast={toast} period={period} svcId={svcId} parkPrefs={endPrefs} setParkPrefs={setEndPrefs} />
    </div>
  );
}
