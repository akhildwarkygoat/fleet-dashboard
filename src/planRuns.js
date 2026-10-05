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
 * Each run keeps its service, so a day can count only the runs whose service ran (dailyCost.js
 * planOn). A hired van is paid one day tariff on the day's total km, not a fee per run
 * (FINALISED_PLANS_PLAN.md), so only the km adds up here and dailyCost.js prices the day.
 * Pure functions here; loadPlanWeeks is the one that fetches.
 * ==========================================================================*/
import { vehKey, RUN_OPTIMISER, NEEDS_ERP } from "./erp.js";

/** Add one plan's routes to a day's map: vehKey(vehicle) → { km, type, runs }. Keyed by vehKey so
 *  "TN57 BR 3434" in one feed and "TN57BR3434" in a plan are the same bus. */
export function addPlanRuns(day, plan, service) {
  for (const r of (plan && plan.routes) || []) {
    const id = vehKey(r.name);
    if (!id) continue;
    const km = +r.km || 0;
    const v = day.get(id) || { km: 0, type: r.type, runs: [] };
    v.km += km;
    v.runs.push({ service, km, type: r.type, stops: r.seq || [], riders: r.riders, ride: r.ride });
    day.set(id, v);
  }
  return day;
}

/** The plan stand-in for one bus on one week: { km, type, runs }, each run its service, km and riders. */
export const planDayOf = (v) => (v
  ? { km: Math.round(v.km * 10) / 10, type: v.type, runs: v.runs.map((r) => ({ service: r.service, km: r.km, riders: r.riders })) }
  : null);

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

/* Vehicles in the plans in force that the punch feed does not carry, so no rider is mapped to them:
   the fleet list is built from the punch feed, and without these the costs left out a bus the plan
   runs every day (TN57BM3636 in the 9 am plan, with ERP cost lines of its own). Costed only: they
   have no company and no riders, so Live and the Bus page keep to the punch feed's buses. */
export function planOnlyBuses(buses, planWeeks, busCosts) {
  if (!planWeeks) return [];
  const known = new Set(buses.map((b) => vehKey(b.id)));
  const costName = new Map(Object.keys(busCosts || {}).map((v) => [vehKey(v), v]));
  const out = new Map();
  for (const day of Object.values(planWeeks)) for (const key of day.keys()) {
    if (known.has(key) || out.has(key)) continue;
    const id = costName.get(key) || key;
    out.set(key, { id, vehicle: id, unit: "", capacity: 0, type: "", mileage: 0, route: RUN_OPTIMISER, driver: NEEDS_ERP, phone: NEEDS_ERP, planOnly: true });
  }
  return [...out.values()];
}
