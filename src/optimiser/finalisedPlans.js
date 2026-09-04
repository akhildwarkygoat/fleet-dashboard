/* ============================================================================
 * optimiser/finalisedPlans.js — which plan is REAL for each service.
 * ----------------------------------------------------------------------------
 * `planUrl` in services.js is a hardcoded path, which quietly made the optimiser's
 * output final by definition. It is a candidate. The transport manager builds the
 * plan he will actually run in the Planner, and needs a way to say "this one".
 *
 * A service with no choice recorded falls back to a DEFAULT, and what that default
 * is depends on the service:
 *
 *   - the fixed-hour services (9 am, 7 am, Zenwear) fall back to their optimised
 *     plan, LABELLED as a default — so "nobody has decided yet" never looks like
 *     "somebody chose this";
 *
 *   - the three Rotational slots fall back to the MANAGER'S plan for whichever rider
 *     group is on that clock this week. The manager finalised nine plans (three fixed
 *     rider groups x three clocks) and the groups step one clock along every Monday,
 *     so "the plan for Rotational · Day" is a different file each week. Which file is
 *     decided by src/rotation.json through rotation.js — this module only asks. That
 *     answer is reported as kind "rotation" and NOT as a default: it is a decision the
 *     manager made, just one made once for all nine combinations rather than weekly.
 *
 * A manual choice (a finalised draft, or an explicit file) still wins over the rotation.
 * The one exception is a "plan" ref pointing at the retired Sep-2 files
 * (/plan_rot-*.finalised.json): those were built one rotation step stale and have been
 * deleted, so a browser still holding such a ref is treated as holding no choice at all
 * rather than being sent to a 404 every week.
 *
 * Stored in localStorage, so finalising works on the deploy and on any machine with
 * no server round-trip. The cost of that is portability, which Export/Import covers:
 * the export carries the BODY of any draft it references, not just a pointer. A
 * manifest of ids alone would import into another browser and silently restore
 * nothing, because the drafts it names live only in the browser that made them.
 *
 * No React here: TrackImplView, the fleet-cost board and the Live strip all resolve
 * through this module, and so does the Node test runner.
 * ==========================================================================*/
import * as store from "./store.js";
import { SERVICES } from "./services.js";
import { planUrlFor as rotationPlanUrl, describeSlot, groupOnSlot, getRotaWeek } from "./rotation.js";

const KEY = "opt-finalised";

/* The Sep-2 "batch 1 of 3" files. They were cut on the PREVIOUS week's roster, so their
   "Day" file carried the group that is on Full night today; they are gone from public/.
   A ref to one of them is a stale pointer, not a choice, and is dropped wherever it is met
   (resolve, export and import) and purged from storage the first time resolve sees it, so it
   can neither win over the rotation nor be re-exported. Nothing else is retired: a finalised
   DRAFT is always the manager's explicit choice and wins, whatever it is called — silently
   dropping one on read would contradict the "Finalised" toast that just confirmed it. */
const RETIRED_FILES = new Set([
  "/plan_rot-day.finalised.json",
  "/plan_rot-half.finalised.json",
  "/plan_rot-full.finalised.json",
]);
const isRetiredRef = (ref) => !!ref && ref.kind === "plan" && RETIRED_FILES.has(ref.file);

/** { [svcId]: { kind:"plan"|"draft", file?, id?, name, at } } */
export function getFinalised() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "{}");
    return raw && typeof raw === "object" ? raw : {};
  } catch { return {}; }
}

function write(map) {
  try { localStorage.setItem(KEY, JSON.stringify(map)); } catch { /* quota */ }
  return map;
}

/** Mark a plan as the finalised one for a service. `ref` is {kind,file|id,name}. */
export function setFinalised(svcId, ref) {
  const map = getFinalised();
  map[svcId] = { ...ref, at: Date.now() };
  return write(map);
}

/** Drop the choice — the service reverts to its default (optimised, or the rotation plan). */
export function clearFinalised(svcId) {
  const map = getFinalised();
  delete map[svcId];
  return write(map);
}

/**
 * What stands for this service when nobody has chosen.
 *
 * Rotational slots ask the rotation for THIS week's group plan. `getRotaWeek()` is the
 * week the dashboard is showing — the calendar week unless the week picker has pinned
 * another — so every reader that resolves through here moves together when it changes.
 * A manifest gap (planUrlFor returns null) falls back to the old optimised-file default
 * so the slot still draws something, flagged as the default it is.
 */
export function baselineFor(svc) {
  if (svc && svc.slot) {
    const week = getRotaWeek();
    const file = rotationPlanUrl(svc.slot, week);
    if (file) {
      return {
        kind: "rotation", file, name: describeSlot(svc.slot, week),
        group: groupOnSlot(svc.slot, week), week, isDefault: false,
      };
    }
  }
  return svc && svc.planUrl
    ? { kind: "plan", file: svc.planUrl, name: "Optimised", isDefault: true }
    : { kind: "none", name: "No plan", isDefault: true };
}

/**
 * What this service should be showing, and why.
 * @returns { kind, name, file?, draftId?, group?, week?, isDefault } — isDefault means nobody
 *   chose it. kind "rotation" carries the group and week it was resolved for, so a record
 *   frozen from it says which of the nine plans it was measured against.
 */
export function resolveFinalised(svc) {
  const map = getFinalised();
  let ref = map[svc.id];
  if (ref && isRetiredRef(ref)) {
    /* Stale pointer, not a choice — forget it so it stops lingering (and being re-exported). */
    delete map[svc.id]; write(map); ref = undefined;
  }
  if (ref && ref.kind === "draft") {
    /* The scored BODY captured at finalise time is what makes a draft usable outside the
       Planner. Returning only an id sent every reader to the optimised file, so the board
       showed the draft's name against the optimised plan's numbers. A ref with no body predates
       that fix and is reported as needing re-finalising rather than silently mis-costed. */
    const d = store.getPlanDraft(ref.id);
    if (d && ref.body && Array.isArray(ref.body.routes)) {
      return { kind: "draft", draftId: ref.id, name: ref.name || d.name, body: ref.body, isDefault: false };
    }
    return { ...baselineFor(svc), lostDraft: ref.name, needsRefinalise: !!d };
  }
  if (ref && ref.kind === "plan" && ref.file) {
    return { kind: "plan", file: ref.file, name: ref.name || "Finalised", isDefault: false };
  }
  return baselineFor(svc);
}

/**
 * The URL of the plan file this service should be read from, or null.
 *
 * A finalised DRAFT has no file — its body lives on the ref — so callers that only speak
 * URLs get the plan underneath it: the rotation plan for a Rotational slot, the optimised
 * file otherwise. That is what the Planner's "From optimised plan" card should seed from
 * whatever has been finalised on top, and what a URL-only reader draws when it cannot
 * carry a draft body. Callers that need the finalised BODY use loadFinalisedPlan.
 */
export function planUrlFor(svc) {
  if (!svc || svc.overall) return null;
  return resolveFinalised(svc).file || baselineFor(svc).file || null;
}

/**
 * The file behind planUrlFor(svc) and what to call it: { url, label, kind, isDefault }.
 * When a draft is finalised the URL is the plan underneath it, so the label describes THAT
 * — "which plan is running" is resolveFinalised's question, not this one's.
 */
export function planSourceFor(svc) {
  if (!svc || svc.overall) return { url: null, label: "No plan", kind: "none", isDefault: true };
  const r = resolveFinalised(svc);
  const src = r.file ? r : baselineFor(svc);
  return { url: src.file || null, label: src.name, kind: src.kind, isDefault: !!src.isDefault };
}

/** Fetch the resolved plan body for a service, or null. Drafts are rebuilt from the store. */
export async function loadFinalisedPlan(svc, toSolverResult) {
  const r = resolveFinalised(svc);
  /* A rotation plan is a file like any other; only how it was chosen differs. */
  if ((r.kind === "plan" || r.kind === "rotation") && r.file) {
    try {
      const res = await fetch(r.file + "?ts=" + Date.now());
      if (!res.ok) return null;
      const d = await res.json();
      return d && Array.isArray(d.routes) ? { ...d, _finalised: r } : null;
    } catch { return null; }
  }
  if (r.kind === "draft" && typeof toSolverResult === "function") {
    const d = store.getPlanDraft(r.draftId);
    if (!d) return null;
    const plan = toSolverResult(d);
    return plan && Array.isArray(plan.routes) ? { ...plan, _finalised: r } : null;
  }
  return null;
}

/* ---------------- portability ---------------- */

/** Everything another machine needs: the manifest AND the referenced draft bodies. */
export function exportFinalised() {
  const map = Object.fromEntries(
    Object.entries(getFinalised()).filter(([, ref]) => !isRetiredRef(ref)));
  const drafts = {};
  for (const ref of Object.values(map)) {
    if (ref.kind === "draft") {
      const d = store.getPlanDraft(ref.id);
      if (d) drafts[ref.id] = d;
    }
  }
  return {
    kind: "fleet-dashboard/finalised",
    version: 1,
    exported: new Date().toISOString(),
    services: SERVICES.map((s) => s.id),
    finalised: map,
    drafts,
  };
}

export function downloadFinalised() {
  const blob = new Blob([JSON.stringify(exportFinalised(), null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "finalised_plans.json";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** Merge an exported file back in. Restores draft bodies first so the refs resolve. */
export function importFinalised(json) {
  if (!json || json.kind !== "fleet-dashboard/finalised" || !json.finalised) {
    throw new Error("Not a finalised-plans export");
  }
  let restored = 0;
  for (const [id, d] of Object.entries(json.drafts || {})) {
    if (!store.getPlanDraft(id) && d && d.assignments) {
      store.savePlanDraft({ id, name: d.name, assignments: d.assignments, meta: d.meta, svc: d.svc });
      restored++;
    }
  }
  /* An export taken before the Sep-2 files were retired can still name them. Importing
     that ref would pin a slot to a deleted file; leave it out so the slot follows the
     rotation instead. Counted as not imported, because it was not. */
  const incoming = Object.fromEntries(
    Object.entries(json.finalised).filter(([, ref]) => !isRetiredRef(ref))
  );
  const map = { ...getFinalised(), ...incoming };
  write(map);
  return { services: Object.keys(incoming).length, restored };
}
