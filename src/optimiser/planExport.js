/* ============================================================================
 * optimiser/planExport.js — turn a live-scored plan into a dashboard JSON
 * ----------------------------------------------------------------------------
 * Produces a payload shaped like public/solver_result.json (routes + params +
 * aggregates) so an edited or hand-built plan can be rendered by the Fleet-plan
 * dashboard. Per-stop `hc` carries RAW registered headcount (the dashboard
 * re-apportions effective riders on load); route `riders` is effective.
 * ==========================================================================*/
import { haversineKm } from "./engine.js";

const road = (a, b) => haversineKm(a, b) * 1.3; // display-only distance estimate

/** Build the solver_result-shaped object from a scored plan (engine.scorePlan output). */
export function toSolverResult(live, fleet, depot, totalRiders, allStops) {
  const routes = (live.plan.routes || []).map((r) => {
    const seq = r.stops.map((s) => ({ name: s.name, lat: s.lat, lng: s.lng, hc: +s.headcount || 0 }));
    const first = r.stops[0], last = r.stops[r.stops.length - 1];
    return {
      name: r.bus.name, type: r.bus.type, cap: r.bus.capacity,
      stops: r.stops.length, riders: r.heads,
      km: round1(r.km), ride: Math.round(r.toLastMin),
      km_to_last: first ? round1(road(depot, first)) : 0,        // depot → first (nearest) stop
      km_to_farthest: last ? round1(road(depot, last)) : 0,       // depot → last (farthest) stop
      cost: Math.round(r.cost), seq,
    };
  });
  const k = live.kpis;
  const agg = (list) => {
    const riders = list.reduce((s, r) => s + r.riders, 0);
    const seats = list.reduce((s, r) => s + r.cap, 0);
    const cost = list.reduce((s, r) => s + r.cost, 0);
    const km = list.reduce((s, r) => s + r.km, 0);
    const rw = riders || 1;
    return {
      buses: list.length, riders, seats, cost: Math.round(cost), km: round1(km),
      util: seats ? +((riders / seats) * 100).toFixed(1) : 0,
      cost_head: +((cost / rw)).toFixed(1),
      avg_ride: +(list.reduce((s, r) => s + r.ride * r.riders, 0) / rw).toFixed(1),
      avg_stops: +(list.reduce((s, r) => s + r.stops, 0) / (list.length || 1)).toFixed(1),
      max_ride: list.reduce((m, r) => Math.max(m, r.ride), 0),
    };
  };
  return {
    generatedBy: "in-browser plan editor",
    method: "manual / edited (engine-scored)",
    params: { demand: k.heads, stops: routes.reduce((s, r) => s + r.stops, 0), totalRiders },
    overall: agg(routes),
    owned: agg(routes.filter((r) => r.type === "own")),
    rental: agg(routes.filter((r) => r.type === "rent")),
    routes,
  };
}

export function downloadPlanJson(live, fleet, depot, totalRiders, allStops) {
  const payload = toSolverResult(live, fleet, depot, totalRiders, allStops);
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "my_plan.solver_result.json";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return payload;
}

function round1(n) { return Math.round((n || 0) * 10) / 10; }
