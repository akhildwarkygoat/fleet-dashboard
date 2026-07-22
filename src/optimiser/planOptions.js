/* ============================================================================
 * optimiser/planOptions.js — saved plan variants ("result options")
 * ----------------------------------------------------------------------------
 * The optimiser can keep SEVERAL solver results side by side (e.g. the balanced
 * 71-bus plan vs a cost-lean variant). public/plan_options.json lists them; the
 * user picks one in the Optimiser header and every plan-reading view (Fleet plan,
 * Suggestions, Planner import, stop→vehicle map) follows the selection.
 * The default option always maps to /solver_result.json (the canonical plan).
 * ==========================================================================*/
const KEY = "opt-active-plan";

export async function getPlanOptions() {
  try {
    const r = await fetch("/plan_options.json?ts=" + Date.now());
    if (!r.ok) return null;
    const d = await r.json();
    return d && Array.isArray(d.options) && d.options.length ? d.options : null;
  } catch { return null; }
}

export function getActivePlanId() {
  try { return localStorage.getItem(KEY) || null; } catch { return null; }
}

export function setActivePlan(opt) {
  try {
    localStorage.setItem(KEY, opt.id);
    localStorage.setItem(KEY + ":file", opt.file);
    localStorage.setItem(KEY + ":label", opt.label || opt.id);
  } catch { /* quota */ }
}

/** Human label of the currently-selected plan (e.g. "Balanced" / "Cost-lean"). */
export function getActivePlanLabel() {
  try { return localStorage.getItem(KEY + ":label") || "Balanced"; } catch { return "Balanced"; }
}

/** URL of the currently-selected plan (falls back to the canonical solver result). */
export function activePlanUrl() {
  try { return localStorage.getItem(KEY + ":file") || "/solver_result.json"; } catch { return "/solver_result.json"; }
}
