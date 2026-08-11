/* ============================================================================
 * optimiser/finalisedPlans.js — which plan is REAL for each service.
 * ----------------------------------------------------------------------------
 * `planUrl` in services.js is a hardcoded path, which quietly made the optimiser's
 * output final by definition. It is a candidate. The transport manager builds the
 * plan he will actually run in the Planner, and needs a way to say "this one".
 *
 * A service with no choice recorded falls back to its optimised plan, LABELLED as a
 * default — so "nobody has decided yet" never looks like "somebody chose this".
 *
 * Stored in localStorage, so finalising works on the deploy and on any machine with
 * no server round-trip. The cost of that is portability, which Export/Import covers:
 * the export carries the BODY of any draft it references, not just a pointer. A
 * manifest of ids alone would import into another browser and silently restore
 * nothing, because the drafts it names live only in the browser that made them.
 * ==========================================================================*/
import * as store from "./store.js";
import { SERVICES } from "./services.js";

const KEY = "opt-finalised";

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

/** Drop the choice — the service reverts to its optimised default. */
export function clearFinalised(svcId) {
  const map = getFinalised();
  delete map[svcId];
  return write(map);
}

/**
 * What this service should be showing, and why.
 * @returns { kind, name, file?, draftId?, isDefault } — isDefault means nobody chose it.
 */
export function resolveFinalised(svc) {
  const ref = getFinalised()[svc.id];
  if (ref && ref.kind === "draft") {
    /* The scored BODY captured at finalise time is what makes a draft usable outside the
       Planner. Returning only an id sent every reader to the optimised file, so the board
       showed the draft's name against the optimised plan's numbers. A ref with no body predates
       that fix and is reported as needing re-finalising rather than silently mis-costed. */
    const d = store.getPlanDraft(ref.id);
    if (d && ref.body && Array.isArray(ref.body.routes)) {
      return { kind: "draft", draftId: ref.id, name: ref.name || d.name, body: ref.body, isDefault: false };
    }
    return { kind: "plan", file: svc.planUrl, name: "Optimised", isDefault: true,
             lostDraft: ref.name, needsRefinalise: !!d };
  }
  if (ref && ref.kind === "plan" && ref.file) {
    return { kind: "plan", file: ref.file, name: ref.name || "Finalised", isDefault: false };
  }
  return svc.planUrl
    ? { kind: "plan", file: svc.planUrl, name: "Optimised", isDefault: true }
    : { kind: "none", name: "No plan", isDefault: true };
}

/** Fetch the resolved plan body for a service, or null. Drafts are rebuilt from the store. */
export async function loadFinalisedPlan(svc, toSolverResult) {
  const r = resolveFinalised(svc);
  if (r.kind === "plan" && r.file) {
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
  const map = getFinalised();
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
  const map = { ...getFinalised(), ...json.finalised };
  write(map);
  return { services: Object.keys(json.finalised).length, restored };
}
