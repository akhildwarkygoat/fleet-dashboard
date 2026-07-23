/* ============================================================================
 * optimiser/NewPlanView.jsx — the Planning hub (Google-Docs style)
 * ----------------------------------------------------------------------------
 * A landing gallery to open a saved plan / start blank / import the optimised
 * plan, then a full map-first editor (NewPlanBoard). Plans are named drafts you
 * can save, reopen and delete — each stored in localStorage.
 * ==========================================================================*/
import React, { useEffect, useMemo, useState } from "react";
import * as store from "./store.js";
import { usePlanMetric, usePlanEditor, seedFromSolver, fleetFromSolver } from "./planEditor.js";
import { Btn, Empty, PALETTE } from "./ui.jsx";
import NewPlanBoard from "./NewPlanBoard.jsx";
import PlanGallery from "./PlanGallery.jsx";
import { activePlanUrl, getActivePlanLabel } from "./planOptions.js";
import { Save, Sparkles, RotateCcw, Download, Undo2, Redo2, Wand2, ArrowLeft, Sunset, Sunrise } from "lucide-react";
import { downloadPlanJson } from "./planExport.js";

const EMPTY = new Map();
const mapFrom = (assignments) => { const m = new Map(); for (const k of Object.keys(assignments || {})) m.set(k, assignments[k]); return m; };

export default function NewPlanView({ t, toast }) {
  const depot = useMemo(() => store.getDepot(), []);
  const storeStops = useMemo(() => store.getStops().filter((s) => s.lat != null && s.lng != null), []);

  // canonical 69-bus fleet from the solver plan (names/caps match the dashboard)
  const [solver, setSolver] = useState(null);
  const [solverLoaded, setSolverLoaded] = useState(false);
  useEffect(() => {
    fetch(activePlanUrl() + "?ts=" + Date.now()).then((r) => (r.ok ? r.json() : null))
      .then((d) => setSolver(d)).catch(() => {}).finally(() => setSolverLoaded(true));
  }, []);
  const fleet = useMemo(() => (solver ? fleetFromSolver(solver, store.getFleet()) : store.getFleet()), [solver]);
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
  const { metric, idxOf, ready, estimated } = usePlanMetric(depot, allStops);

  // hub state: which view, the open draft, the editable name, and the editor seed
  const [view, setView] = useState("gallery");           // "gallery" | "editor"
  // Evening = factory → stops (drop-off, how plans are stored). Morning = the same chain
  // ridden in reverse: last stop → … → first stop → factory (pickup). Display/editing only —
  // the cost model already counts both directions (chain km = 2 × one-way).
  const [period, setPeriod] = useState("evening");       // "evening" | "morning"
  const [drafts, setDrafts] = useState(() => store.listPlanDrafts());
  const [current, setCurrent] = useState(null);           // { id, name } of the open saved draft, or null (unsaved)
  const [draftName, setDraftName] = useState("Untitled plan");
  const [seed, setSeed] = useState(EMPTY);

  const editor = usePlanEditor({ seed, fleet, depot, stopsById, metric, idxOf, demandOf });

  const meta = () => {
    const used = editor.perBus.filter((r) => r.stopIds.length);
    return { riders: used.reduce((n, r) => n + r.heads, 0), buses: used.length, stops: used.reduce((n, r) => n + r.stopIds.length, 0) };
  };

  // ---- gallery actions ----
  const openDraft = (d) => { setImportedPlan(null); setSeed(mapFrom(d.assignments)); setCurrent({ id: d.id, name: d.name }); setDraftName(d.name); setView("editor"); };
  const newBlank = () => { setImportedPlan(null); setSeed(new Map(EMPTY)); setCurrent(null); setDraftName("Untitled plan"); setView("editor"); };
  const importPlan = () => {
    if (!solver) { toast && toast("No optimised plan to import"); return; }
    const label = getActivePlanLabel();
    const { seed, extras, demand } = seedFromSolver(solver, fleet, storeStops);
    setImportedPlan({ extras, demand });
    setSeed(seed); setCurrent(null); setDraftName(`Imported ${label} plan`); setView("editor");
    toast && toast(`Imported the ${label} optimised plan` + (extras.length ? ` (${extras.length} stops carried from the plan file)` : ""));
  };
  const deleteDraft = (d) => { store.deletePlanDraft(d.id); setDrafts(store.listPlanDrafts()); toast && toast("Plan deleted"); };

  // ---- editor actions ----
  const save = () => {
    const id = store.savePlanDraft({ id: current && current.id, name: draftName, assignments: editor.assign, meta: meta() });
    const name = (draftName || "").trim() || "Untitled plan";
    setCurrent({ id, name }); setDraftName(name); setDrafts(store.listPlanDrafts());
    toast && toast("Plan saved");
  };
  const backToGallery = () => { setDrafts(store.listPlanDrafts()); setView("gallery"); };
  const reset = () => { setImportedPlan(null); setSeed(new Map(EMPTY)); };
  const importIntoEditor = () => {
    if (!solver) { toast && toast("No optimised plan to import"); return; }
    const { seed, extras, demand } = seedFromSolver(solver, fleet, storeStops);
    setImportedPlan({ extras, demand });
    setSeed(seed); toast && toast(`Imported the ${getActivePlanLabel()} optimised plan into this editor`);
  };
  const exportJson = () => { if (editor.live) { downloadPlanJson(editor.live, fleet, depot, totalRiders, allStops); toast && toast("Exported plan JSON"); } };

  if (!ready || !solverLoaded) return <Empty t={t} title="Loading road network…" sub="Building the distance matrix for live routing." />;

  if (view === "gallery") {
    return <PlanGallery t={t} drafts={drafts} totalRiders={totalRiders} canImport={!!solver} planLabel={getActivePlanLabel()}
      stopsById={stopsById} depot={depot} busColor={busColor}
      onNewBlank={newBlank} onImport={importPlan} onOpen={openDraft} onDelete={deleteDraft} />;
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
        <Btn t={t} variant="ghost" onClick={() => { editor.autoFill(); toast && toast("Auto-filled remaining stops"); }} title="Cluster the unassigned stops onto free buses"><Wand2 size={15} /> Auto-fill</Btn>
        <Btn t={t} variant="ghost" onClick={importIntoEditor} title="Load the optimiser's plan into this editor"><Sparkles size={15} /> Import optimised</Btn>
        <Btn t={t} variant="ghost" onClick={reset}><RotateCcw size={15} /> Clear</Btn>
        <Btn t={t} variant="ghost" onClick={exportJson}><Download size={15} /> Export</Btn>
        <Btn t={t} onClick={save}><Save size={15} /> Save</Btn>
      </div>
      {estimated && <div className="text-xs rounded-xl px-3 py-2" style={{ background: t.watch + "22", color: t.watch }}>Using straight-line distance estimates — the road matrix cache didn't cover every stop.</div>}
      <NewPlanBoard t={t} editor={editor} fleet={fleet} depot={depot} stopsById={stopsById} totalRiders={totalRiders} demandOf={demandOf} toast={toast} period={period} />
    </div>
  );
}
