/* ============================================================================
 * optimiser/roadGeom.js — road-following polylines for the plan editors
 * ----------------------------------------------------------------------------
 * Leg geometry comes from public/road_geometry.json (pre-cached by
 * build_road_geometry.py) when available; a cache miss (a leg created by an edit)
 * is fetched once from the keyless OSRM demo server and memoised; if that fails
 * we fall back to a straight segment. routeGeometry() stitches a route's legs into
 * one road-following polyline (depot → s1 → … → last; chain = no return leg).
 * ==========================================================================*/
const OSRM = "https://router.project-osrm.org/route/v1/driving/";
const k = (a, b) => `${a.lat.toFixed(5)},${a.lng.toFixed(5)}|${b.lat.toFixed(5)},${b.lng.toFixed(5)}`;
const straight = (a, b) => [[a.lat, a.lng], [b.lat, b.lng]];

let _cache;                    // undefined = not loaded, null = unavailable, else object
const _mem = new Map();        // in-session OSRM results (key -> points | straight)
const _inflight = new Map();   // key -> Promise (dedupe concurrent fetches)

// Concurrency limiter for on-demand OSRM calls — a hand-built plan can create hundreds of
// uncached legs at once; cap live requests so we don't hammer the demo server (cache hits skip this).
const MAX_CONCURRENT = 4;
let _active = 0;
const _queue = [];
function runLimited(task) {
  return new Promise((resolve) => {
    const go = () => { _active++; task().then((v) => { _active--; resolve(v); if (_queue.length) _queue.shift()(); }); };
    _active < MAX_CONCURRENT ? go() : _queue.push(go);
  });
}

async function loadCache() {
  if (_cache !== undefined) return _cache;
  try {
    const r = await fetch("/road_geometry.json");
    _cache = r.ok ? await r.json() : null;
  } catch { _cache = null; }
  return _cache;
}

/** Geometry for one leg a→b: cache → memo → OSRM on-demand → straight fallback. */
async function legGeometry(a, b) {
  const cache = await loadCache();
  const key = k(a, b), rev = k(b, a);
  if (cache) {
    if (cache[key]) return cache[key];
    if (cache[rev]) return [...cache[rev]].reverse(); // roads are ~symmetric for display
  }
  if (_mem.has(key)) return _mem.get(key);
  if (_inflight.has(key)) return _inflight.get(key);
  const p = runLimited(async () => {
    try {
      const url = `${OSRM}${a.lng},${a.lat};${b.lng},${b.lat}?overview=simplified&geometries=geojson`;
      const d = await fetch(url).then((r) => (r.ok ? r.json() : null));
      const coords = d && d.code === "Ok" && d.routes[0] && d.routes[0].geometry.coordinates;
      const pts = coords ? coords.map((c) => [c[1], c[0]]) : straight(a, b);
      _mem.set(key, pts);
      return pts;
    } catch { const s = straight(a, b); _mem.set(key, s); return s; }
    finally { _inflight.delete(key); }
  });
  _inflight.set(key, p);
  return p;
}

/** Stitch a route (depot, [stops in order]) into one road-following polyline. */
export async function routeGeometry(depot, stops) {
  if (!stops.length) return [];
  const nodes = [depot, ...stops];
  const legs = await Promise.all(nodes.slice(0, -1).map((n, i) => legGeometry(n, nodes[i + 1])));
  const out = [];
  legs.forEach((pts, i) => { (i === 0 ? pts : pts.slice(1)).forEach((p) => out.push(p)); }); // avoid dup joints
  return out;
}
