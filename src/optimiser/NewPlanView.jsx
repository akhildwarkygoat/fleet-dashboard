/* ============================================================================
 * optimiser/NewPlanView.jsx — the Planning hub (Google-Docs style)
 * ----------------------------------------------------------------------------
 * A landing gallery to open a saved plan / start blank / import the optimised
 * plan, then a full map-first editor (NewPlanBoard). Plans are named drafts you
 * can save, reopen and delete — each stored in localStorage.
 * ==========================================================================*/
import React from "react";
import { Btn, Empty } from "./ui.jsx";
import NewPlanBoard from "./NewPlanBoard.jsx";
import PlanGallery from "./PlanGallery.jsx";
import { Save, RotateCcw, Download, Undo2, Redo2, ArrowLeft, Sunset, Sunrise } from "lucide-react";
import { usePlanHub } from "./plannerState.js";

/* `svc` scopes the whole board to one service. Without it the Planner always used the
   global depot, the curated 9 am stop set, the 9 am plan and one shared draft list — so
   "planning Zenwear" actually routed Batlagundu's stops from Batlagundu's depot. `svcStops`
   is the service's own derived network (null for 9 am, which plans on the curated store). */
export default function NewPlanView({ t, toast, erpBuses, svc, svcStops }) {
  // the hub's state, actions and figures live in plannerState.js, shared with the new look
  const {
    depot, svcId, planSource, planLabel, planKind, solver, solverLoaded, fleet, prevRoutes, stopsById, demandOf,
    totalRiders, busColor, ready, estimated, view, period, setPeriod, drafts, finalised, finalise, current, draftName,
    setDraftName, endPrefs, setEndPrefs, editor, draftBodies, droppedRoutes, droppedRiders, droppedCost,
    openDraft, newBlank, importPlan, deleteDraft, importPrevRoutes, importFromFile, save, backToGallery, clearBoard, exportJson,
  } = usePlanHub({ toast, erpBuses, svc, svcStops });
  // Clear wipes the whole board and re-seeds the editor, so it can't be undone — warn first.
  const clearWithConfirm = () => {
    if (window.confirm("Clear the whole board?\n\nThis removes every stop from every bus and can't be undone.")) {
      clearBoard();
    }
  };

  if (!ready || !solverLoaded) return <Empty t={t} title="Loading road network…" sub="Building the distance matrix for live routing." />;

  if (view === "gallery") {
    return (
      <div className="space-y-4">
        {/* Which plan a Rotational slot is RUNNING is not visible from the draft cards alone:
            with nothing finalised on top, none of them is marked, and the answer is one of the
            manager's nine group plans. Say so, and say that finalising a card below overrides
            it — for this week and every week after, since a choice is kept per slot. */}
        {svc && svc.slot && finalised && (
          <div className="rounded-xl px-4 py-2.5 text-sm flex flex-wrap items-baseline gap-x-2 gap-y-1"
            style={{ background: t.primarySoft, border: "1px solid " + t.border, color: t.text }}>
            <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: t.primary }}>Running</span>
            {finalised.kind === "rotation" ? (
              <>
                <b>{finalised.name}</b>
                <span style={{ color: t.muted }}>
                  — the manager&rsquo;s finalised plan for the group on this clock. Finalise a saved plan below to override it.
                </span>
              </>
            ) : (
              <>
                <b>{finalised.name}</b>
                <span style={{ color: t.muted }}>
                  — finalised by hand, so it is used in place of the rotation plan
                  {planSource && planSource.kind === "rotation" ? ` (${planSource.label})` : ""} until it is un-finalised.
                </span>
              </>
            )}
          </div>
        )}
        <PlanGallery t={t} drafts={drafts} totalRiders={totalRiders} canImport={!!solver} planLabel={planLabel} planKind={planKind} finalised={finalised} onFinalise={finalise}
          stopsById={stopsById} depot={depot} busColor={busColor}
          onNewBlank={newBlank} onImport={importPlan} onOpen={openDraft} onDelete={deleteDraft} onImportFile={importFromFile}
          onImportPrev={importPrevRoutes} prevPlan={prevRoutes} bodies={draftBodies} />
      </div>
    );
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
      {droppedRoutes.length > 0 && (
        <div className="text-xs rounded-xl px-3 py-2" style={{ background: t.poor + "22", color: t.poor }}>
          <b>{droppedRoutes.length} route{droppedRoutes.length > 1 ? "s" : ""} could not be loaded</b> — {droppedRoutes.map((d) => d.name).join(", ")} {droppedRoutes.length > 1 ? "are" : "is"} not in today&rsquo;s ERP fleet.
          {" "}That removed <b>{droppedRiders} rider{droppedRiders === 1 ? "" : "s"}</b>
          {" "}and <b>₹{Math.round(droppedCost).toLocaleString("en-IN")}/day</b> from every figure on this board, so it reads lower than the finalised plan.
        </div>
      )}
      <NewPlanBoard t={t} editor={editor} fleet={fleet} depot={depot} stopsById={stopsById} totalRiders={totalRiders} demandOf={demandOf} toast={toast} period={period} svcId={svcId} parkPrefs={endPrefs} setParkPrefs={setEndPrefs} />
    </div>
  );
}
