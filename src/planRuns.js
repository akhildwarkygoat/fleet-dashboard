/* ============================================================================
 * planRuns.js — what each bus is planned to drive in a day, from every plan in force.
 * ----------------------------------------------------------------------------
 * A bus's day is every run it makes: the 9 am route, a 7 am or Zenwear run, and its
 * Rotational slots. When the bus attendance app recorded no GPS for a day, the day's km
 * (and so its diesel) falls back to the plan — all of its runs added together, not just
 * the 9 am one, which left a bus on three shifts costed as if it drove one route.
 *
 * Which plan stands for each service is finalisedPlans.js's answer (the built-in default,
 * or whatever was finalised in this browser); the Rotational slots take the group plan for
 * the week of each day (rotation.js), so a day three weeks ago is costed on the plans that
 * were running then.
 *
 * A hired van is paid per run, so its hire adds up run by run too (FINALISED_PLANS_PLAN.md).
 * Pure functions here; loadPlanWeeks is the one that fetches.
 * ==========================================================================*/
import { vehKey } from "./erp.js";

/** Add one plan's routes to a day's map: vehKey(vehicle) → { km, cost, type, runs }. Keyed by vehKey so
 *  "TN57 BR 3434" in one feed and "TN57BR3434" in a plan are the same bus. */
export function addPlanRuns(day, plan, service) {
  for (const r of (plan && plan.routes) || []) {
    const id = vehKey(r.name);
    if (!id) continue;
    const km = +r.km || 0, hire = r.type === "rent" ? +r.cost || 0 : null;
    const v = day.get(id) || { km: 0, cost: null, type: r.type, runs: [] };
    v.km += km;
    if (hire != null) v.cost = (v.cost || 0) + hire;
    v.runs.push({ service, km, cost: hire, type: r.type, stops: r.seq || [], riders: r.riders, ride: r.ride });
    day.set(id, v);
  }
  return day;
}

/** The plan stand-in for one bus on one week: { km, cost, type } (cost only for a hired van). */
export const planDayOf = (v) => (v ? { km: Math.round(v.km * 10) / 10, cost: v.cost, type: v.type } : null);

/**
 * Every bus's planned day for each week asked for: { [mondayIso]: Map(vehicle → day) }.
 * `sourceFor(svc, week)` says where a service's plan comes from that week: { body } or { file }.
 */
export async function loadPlanWeeks(weeks, services, sourceFor, fetchJson) {
  const cache = new Map();
  const get = (url) => {
    if (!cache.has(url)) cache.set(url, fetchJson(url).catch(() => null));
    return cache.get(url);
  };
  const out = {};
  for (const week of weeks) {
    const day = new Map();
    for (const svc of services) {
      const src = sourceFor(svc, week);
      const plan = !src ? null : src.body || (src.file ? await get(src.file) : null);
      if (plan) addPlanRuns(day, plan, svc.id);
    }
    out[week] = day;
  }
  return out;
}
