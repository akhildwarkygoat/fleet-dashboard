/* ============================================================================
 * optimiser/solverClient.js — talk to the Python OR-Tools backend (server.py)
 * ----------------------------------------------------------------------------
 * Option B: a real Vehicle-Routing solver. The browser already has the Google
 * road matrix, so we POST {nodes, demand, fleet, matrix, params} and the backend
 * returns only the ROUTING DECISION (which bus serves which stops, in order).
 * We then score that decision with engine.scorePlan() — the SAME code that renders
 * the in-browser heuristic — so the two plans compare apples-to-apples.
 *
 * If the backend isn't running, callers fall back to the in-browser heuristic.
 * ==========================================================================*/
import { scorePlan, haversineKm, DEFAULTS } from "./engine.js";

// Override with VITE_SOLVER_URL if the backend runs elsewhere.
export const SOLVER_URL =
  (typeof import.meta !== "undefined" && import.meta.env && import.meta.env.VITE_SOLVER_URL) ||
  "http://localhost:8000";

const fetchJSON = async (url, opts, timeoutMs) => {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally { clearTimeout(timer); }
};

/** Is the OR-Tools backend up? (fast; used to pick solver vs heuristic).
 *  Memoised for 15s so repeated solves don't each eat the full timeout waiting out
 *  a port that nothing is listening on (Windows doesn't refuse a dead port quickly). */
let _ping = null; // { ok, at }
export async function pingSolver(timeoutMs = 1500) {
  if (_ping && performance.now() - _ping.at < 15000) return _ping.ok;
  let ok = false;
  try { const r = await fetchJSON(`${SOLVER_URL}/health`, {}, timeoutMs); ok = !!(r && r.ok); }
  catch { ok = false; }
  _ping = { ok, at: performance.now() };
  return ok;
}

/** Replace any non-finite matrix cell with the haversine estimate so the JSON we
 *  POST is always valid (JSON can't carry Infinity/NaN — they serialise to null). */
function sanitiseMatrix(matrix, nodes, p) {
  const n = nodes.length;
  const km = Array.from({ length: n }, () => Array(n).fill(0));
  const min = Array.from({ length: n }, () => Array(n).fill(0));
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    if (i === j) continue;
    let k = matrix && matrix.km ? matrix.km[i][j] : Infinity;
    let m = matrix && matrix.min ? matrix.min[i][j] : Infinity;
    if (!isFinite(k)) { k = haversineKm(nodes[i], nodes[j]) * (p.roadFactor || DEFAULTS.roadFactor); m = (k / (p.speedKmph || DEFAULTS.speedKmph)) * 60; }
    if (!isFinite(m)) m = (k / (p.speedKmph || DEFAULTS.speedKmph)) * 60;
    km[i][j] = k; min[i][j] = m;
  }
  return { km, min };
}

/**
 * Solve on the backend, then score the returned decision locally.
 * @param nodes   [depot, ...stops]  depot at index 0; each carries _idx (0..n-1)
 * @param demand  int[] parallel to nodes (demand[0]=0)
 * @param fleet   browser bus objects
 * @param matrix  { km:[[]], min:[[]] } road matrix (may contain Infinity — sanitised here)
 * @param params  { softCapMin, hardCapMin, serviceMin, workingDays, solverTimeLimitS, timePenaltyPerMin }
 * @returns { ok, plan, kpis, meta } on success, or { ok:false, reason } on failure/infeasible.
 */
export async function solveRemote({ nodes, demand, fleet, matrix, params = {} }) {
  const p = { ...DEFAULTS, ...params };
  const clean = sanitiseMatrix(matrix, nodes, p);
  const body = {
    nodes: nodes.map((nd) => ({ name: nd.name || "", lat: nd.lat, lng: nd.lng })),
    demand,
    fleet,
    matrix: clean,
    params: {
      softCapMin: p.softCapMin, hardCapMin: p.hardCapMin, serviceMin: p.serviceMin,
      workingDays: p.workingDays, capacityBuffer: p.capacityBuffer ?? 5,
      timePenaltyPerMin: params.timePenaltyPerMin ?? 60,
      solverTimeLimitS: params.solverTimeLimitS ?? 10,
    },
  };

  let resp;
  try {
    resp = await fetchJSON(`${SOLVER_URL}/optimise`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    }, (body.params.solverTimeLimitS + 12) * 1000);
  } catch (e) {
    return { ok: false, reason: "offline", detail: String(e && e.message || e) };
  }
  if (!resp || !resp.ok) return { ok: false, reason: resp ? resp.reason : "no response" };

  // map node indices back to stop objects, score with the local engine
  const depot = nodes[0];
  const metric = { km: (i, j) => clean.km[i][j], min: (i, j) => clean.min[i][j] };
  const assignments = resp.routes.map((r) => ({
    busId: r.busId,
    stops: r.stopIdxs.map((i) => nodes[i]).filter(Boolean),
  }));
  const scored = scorePlan(assignments, fleet, depot, { ...params, metric });
  return { ...scored, meta: { source: "ortools", solverTimeS: resp.solverTimeS, serverRoutes: resp.routes } };
}
