/* ============================================================================
 * optimiser/serviceStops.js — derive a service's stop network from the live ERP.
 *
 * The 9 am General network was built offline (build_stops_from_erp.py → 200 m merge →
 * road-validated → data/bus_stops.csv) and is the curated set the optimiser plans on.
 * The newer services — 7 am Morning, Rotational, Zenwear — have no curated network yet,
 * so this derives one in the browser from each rider's home GPS.
 *
 * UNMERGED BY DEFAULT (mergeM = 0): one stop per distinct home coordinate, nothing
 * collapsed by radius. Only riders sharing an identical coordinate (same house) land on
 * the same stop. This mirrors `build_stops_from_erp.py --merge-m 0`, the raw layer the
 * offline pipeline merges afterwards — merging is a walking-distance decision and is
 * deliberately left until it is made explicitly.
 *
 * COVERAGE is a separate question from merging, so it has its own radius (coverM):
 * each derived stop is flagged `isNew` when the curated network has nothing within
 * coverM metres. Those are the nodes a distance-matrix build would have to add.
 * ==========================================================================*/

export const MERGE_M = 0;     // no radius merging — identical coordinates only
export const COVER_M = 200;   // "is this already a routed stop?" radius

const R = 6371000;
const rad = (d) => (d * Math.PI) / 180;
export function metresBetween(a, b) {
  if (!a || !b || a.lat == null || b.lat == null) return Infinity;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

/* Coarse lat/lng bucket index so coverage checks stay O(n) rather than O(n²) —
   at these latitudes 0.01° is ~1.1 km, comfortably wider than MERGE_M. */
function gridIndex(points) {
  const g = new Map();
  points.forEach((p, i) => {
    if (p.lat == null || p.lng == null) return;
    const k = Math.round(p.lat * 100) + ":" + Math.round(p.lng * 100);
    if (!g.has(k)) g.set(k, []);
    g.get(k).push(i);
  });
  return g;
}
function neighbours(g, p) {
  const out = [];
  const la = Math.round(p.lat * 100), ln = Math.round(p.lng * 100);
  for (let dla = -1; dla <= 1; dla++) for (let dln = -1; dln <= 1; dln++) {
    const c = g.get((la + dla) + ":" + (ln + dln));
    if (c) out.push(...c);
  }
  return out;
}

/* Nearest point in `others` within `within` metres, or null. */
export function nearest(p, others, grid, within = COVER_M) {
  let best = null, bestD = within;
  for (const i of neighbours(grid, p)) {
    const d = metresBetween(p, others[i]);
    if (d <= bestD) { bestD = d; best = { stop: others[i], m: d }; }
  }
  return best;
}

/**
 * Cluster riders' homes into stops.
 * @param riders  [{ id, lat, lng, locality, name, busId }]
 * @param existing curated stops to check coverage against (may be empty)
 * @returns stops in the same shape StopsView renders, each with `isNew` + `riders`
 */
export function stopsForRiders(riders, existing = [], { mergeM = MERGE_M, coverM = COVER_M, depot = null } = {}) {
  const pts = (riders || []).filter((r) => r.lat != null && r.lng != null);
  if (!pts.length) return [];

  // densest-first so a cluster forms around the busiest point, matching the offline merge
  const grid = gridIndex(pts);
  const density = pts.map((p) => neighbours(grid, p).filter((j) => metresBetween(p, pts[j]) <= mergeM).length);
  const order = pts.map((_, i) => i).sort((a, b) => density[b] - density[a]);

  const taken = new Array(pts.length).fill(false);
  const exGrid = gridIndex(existing);
  const stops = [];
  for (const i of order) {
    if (taken[i]) continue;
    const seed = pts[i];
    const members = neighbours(grid, seed).filter((j) => !taken[j] && metresBetween(seed, pts[j]) <= mergeM);
    if (!members.length) continue;
    members.forEach((j) => { taken[j] = true; });

    // centroid of the cluster, so the stop sits among its riders rather than on one house
    const lat = members.reduce((s, j) => s + pts[j].lat, 0) / members.length;
    const lng = members.reduce((s, j) => s + pts[j].lng, 0) / members.length;
    const here = { lat, lng };
    const match = nearest(here, existing, exGrid, coverM);
    // name it after the commonest locality its riders report; fall back to the coordinates
    const tally = {};
    members.forEach((j) => { const v = (pts[j].locality || "").trim(); if (v) tally[v] = (tally[v] || 0) + 1; });
    const named = Object.entries(tally).sort((a, b) => b[1] - a[1])[0];

    // Which vehicle(s) this stop is registered against, straight from each rider's ERP bus
    // assignment. Without this a derived stop has no vehicle anywhere — not on the map
    // tooltip, not in the table — and cannot be tied back to a real run.
    const busTally = {};
    members.forEach((j) => { const b = (pts[j].busId || "").trim(); if (b) busTally[b] = (busTally[b] || 0) + 1; });
    const busList = Object.entries(busTally).sort((a, b) => b[1] - a[1]);

    stops.push({
      id: "svc:" + lat.toFixed(5) + "," + lng.toFixed(5),
      name: (match && match.stop.name) || (named && named[0]) || `${lat.toFixed(4)}, ${lng.toFixed(4)}`,
      lat, lng,
      village: (named && named[0]) || "",
      headcount: members.length,
      // Real absentee, averaged over the riders standing here. Hardcoding 0 made the
      // engine's `ceil(head x (1 - absentee + 3% buffer))` round UP at every stop, so a
      // 1-rider stop planned as 2 and a 236-stop network inflated 559 riders to 795 —
      // enough to make a service with spare seats look infeasible. Riders without an
      // attendance history contribute 0, which is the old behaviour for that rider only.
      absentee: members.reduce((s, j) => s + (+pts[j].absentee || 0), 0) / members.length,
      route: "Imported",
      // How many riders standing here sit out the weekly rotation. Carried through so the map
      // can mark the stop: a stop that is all fixed-shift riders needs no re-check when the
      // rota moves, and one that is partly fixed needs a careful look rather than a glance.
      fixedShift: members.reduce((n, j) => n + (pts[j].fixedShift ? 1 : 0), 0),
      // the raw number of riders at this stop. `headcount` is overwritten downstream with the
      // EFFECTIVE (absentee-adjusted) figure, so "are all of them fixed-shift?" has to be asked
      // against this rather than against a number that has been rounded for planning.
      riderCount: members.length,
      riders: members.map((j) => pts[j].name || pts[j].id),
      merged: members.length > 1,          // more than one rider at this exact coordinate
      buses: busList,                      // [[registration, riders], …] busiest first
      busName: busList.length ? (busList.length === 1 ? busList[0][0] : `${busList[0][0]} +${busList.length - 1}`) : null,
      isNew: !match,                       // nothing in the curated network within coverM
      nearestExistingM: match ? Math.round(match.m) : null,
      depotKm: depot ? Math.round(metresBetween(here, depot) / 100) / 10 : null,
    });
  }
  stops.sort((a, b) => b.headcount - a.headcount);
  return stops;
}

/* Headline numbers for the "is the network complete?" question. */
export function coverageOf(stops) {
  const nu = stops.filter((s) => s.isNew);
  return {
    stops: stops.length,
    riders: stops.reduce((a, s) => a + s.headcount, 0),
    newStops: nu.length,
    newRiders: nu.reduce((a, s) => a + s.headcount, 0),
  };
}
