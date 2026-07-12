/* ============================================================================
 * optimiser/google.js — Google Maps road distance matrix + road geometry
 * ----------------------------------------------------------------------------
 * Loads the Maps JS API (with your key) and exposes:
 *   - roadMatrix(points)  -> { km:[[..]], min:[[..]] }  real road distances/times
 *   - roadRoute(points)   -> [[lat,lng], ...]           road-following geometry
 * Both throw on failure so callers can fall back to the haversine estimate.
 *
 * SECURITY: this browser key is visible to anyone using the app. Restrict it in
 * Google Cloud (HTTP referrer + Maps JavaScript / Directions / Distance Matrix
 * APIs) and keep billing on those APIs only.
 *
 * NOTE (June 2026): Google deprecated DistanceMatrixService/DirectionsService in
 * favour of the Routes API; the classic services still work (12-month notice).
 * ==========================================================================*/

export const GOOGLE_KEY = ""; // no key in source — paste yours in Settings → Google Maps API key (stored in your browser only)

/* User can paste their own key (Settings) — e.g. a fresh free-tier key for a big run.
   Stored locally; loadGoogle() picks it over the built-in. Takes effect on page reload
   (the Maps script bakes the key into its URL at load). */
const K_GKEY = "opt-gmaps-key";
export const getGoogleKey = () => { try { return localStorage.getItem(K_GKEY) || ""; } catch { return ""; } };
export const setGoogleKey = (k) => { try { (k && k.trim()) ? localStorage.setItem(K_GKEY, k.trim()) : localStorage.removeItem(K_GKEY); } catch { /* quota */ } };
const activeKey = () => getGoogleKey() || GOOGLE_KEY;

let _loader = null;
export function loadGoogle() {
  if (typeof window === "undefined") return Promise.reject(new Error("no window"));
  if (window.google && window.google.maps) return Promise.resolve(window.google);
  if (_loader) return _loader;
  _loader = new Promise((resolve, reject) => {
    const cb = "__gmapsReady_" + Math.floor(performance.now());
    window[cb] = () => resolve(window.google);
    const s = document.createElement("script");
    s.src = `https://maps.googleapis.com/maps/api/js?key=${activeKey()}&callback=${cb}`;
    s.async = true;
    s.onerror = () => { _loader = null; reject(new Error("Failed to load Google Maps JS API (network or key)")); };
    document.head.appendChild(s);
    // reset _loader on timeout so a later call can re-attempt (don't cache a failed load)
    setTimeout(() => { if (!(window.google && window.google.maps)) { _loader = null; reject(new Error("Google Maps JS API load timed out")); } }, 20000);
  });
  return _loader;
}
/** loadGoogle with retries — re-attempts a failed/timed-out script load a few times. */
export async function loadGoogleRetry(tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) { try { return await loadGoogle(); } catch (e) { last = e; await new Promise((r) => setTimeout(r, 800 * (i + 1))); } }
  throw last;
}

// Google service callbacks can silently never fire (e.g. ApiNotActivatedMapError),
// so every call is raced against a timeout to guarantee the caller can fall back.
const withTimeout = (p, ms, label) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(label + " timed out (API enabled + billing?)")), ms))]);
// retry transient Google failures (OVER_QUERY_LIMIT / UNKNOWN_ERROR / timeouts) with backoff
async function withRetry(fn, tries = 3, delayMs = 700) {
  let last;
  for (let i = 0; i < tries; i++) { try { return await fn(); } catch (e) { last = e; await new Promise((r) => setTimeout(r, delayMs * (i + 1))); } }
  throw last;
}

const sig = (points) => points.map((p) => p.lat.toFixed(5) + "," + p.lng.toFixed(5)).join("|");
const _matrixCache = new Map();
const _routeCache = new Map();

/* ---- offline cached road matrix (built once by build_road_matrix.py) ----------
   When EVERY requested point is present in public/road_matrix.json we return the
   whole sub-matrix from the cache and make ZERO Google calls — this is what keeps
   opening the Optimise tab free and instant instead of firing hundreds of live
   Distance Matrix requests. We fall through to the live API only when a point
   isn't in the cache (e.g. a stop the user just added by hand). Fetched from
   public/ (served at site root) the first time the optimiser runs, then memoised. */
let _cached; // undefined = not tried yet, null = unavailable
async function getCachedMatrix() {
  if (_cached !== undefined) return _cached;
  try {
    const res = await fetch("/road_matrix.json");
    if (!res.ok) throw new Error("HTTP " + res.status);
    const d = await res.json();
    const index = new Map();
    d.nodes.forEach((nd, i) => index.set(nd.lat.toFixed(5) + "," + nd.lng.toFixed(5), i));
    _cached = { km: d.km, min: d.min, index };
  } catch { _cached = null; }
  return _cached;
}
/** Sub-matrix for `points` from the cache, in the requested order — or null if the
 *  cache is missing or any point isn't in it (so the caller hits Google instead). */
async function cachedMatrix(points) {
  const c = await getCachedMatrix();
  if (!c) return null;
  const idx = new Array(points.length);
  for (let p = 0; p < points.length; p++) {
    const i = c.index.get(points[p].lat.toFixed(5) + "," + points[p].lng.toFixed(5));
    if (i === undefined) return null; // unknown point -> can't serve this solve from cache
    idx[p] = i;
  }
  const n = points.length;
  const km = Array.from({ length: n }, () => Array(n).fill(0));
  const min = Array.from({ length: n }, () => Array(n).fill(0));
  for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) {
    const kv = c.km[idx[a]][idx[b]], mv = c.min[idx[a]][idx[b]];
    km[a][b] = kv >= 0 ? kv : Infinity;   // -1 in the cache = unreachable
    min[a][b] = mv >= 0 ? mv : Infinity;
  }
  return { km, min };
}

/** Public: km/min sub-matrix for arbitrary points from the OFFLINE cache (zero
 *  Google calls). Falls back to haversine x 1.30 @ 26 km/h for any point not in
 *  the cache, so it always returns a usable matrix (used by the route mini-map). */
export async function matrixFor(points) {
  const fromCache = await cachedMatrix(points);
  if (fromCache) return fromCache;
  const R = 6371.0088, rad = (x) => (x * Math.PI) / 180;
  const hav = (a, b) => {
    const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 +
      Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  };
  const n = points.length;
  const km = Array.from({ length: n }, () => Array(n).fill(0));
  const min = Array.from({ length: n }, () => Array(n).fill(0));
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    if (i === j) continue;
    const d = hav(points[i], points[j]) * 1.30;
    km[i][j] = d; min[i][j] = (d / 26) * 60;
  }
  return { km, min, estimated: true };
}

/** Is Google actually usable on this key right now? (loads + a 1-cell matrix call).
 *  Returns false on ApiNotActivatedMapError / billing / timeout so callers fall back. */
export async function probeGoogle() {
  try {
    const g = await loadGoogle();
    await withTimeout(new Promise((resolve, reject) =>
      new g.maps.DistanceMatrixService().getDistanceMatrix(
        { origins: [new g.maps.LatLng(13.0, 80.2)], destinations: [new g.maps.LatLng(13.01, 80.21)], travelMode: g.maps.TravelMode.DRIVING },
        (r, status) => (status === "OK" ? resolve(r) : reject(new Error(status))))), 8000, "probe");
    return true;
  } catch { return false; }
}

/** Real road distance (km) + duration (min) matrix for an ordered list of {lat,lng}. */
export async function roadMatrix(points) {
  const key = sig(points);
  if (_matrixCache.has(key)) return _matrixCache.get(key);
  // serve from the offline cache when it covers every point (no Google call at all)
  const fromCache = await cachedMatrix(points);
  if (fromCache) { _matrixCache.set(key, fromCache); return fromCache; }
  const g = await loadGoogleRetry();
  const svc = new g.maps.DistanceMatrixService();
  const n = points.length;
  const km = Array.from({ length: n }, () => Array(n).fill(0));
  const min = Array.from({ length: n }, () => Array(n).fill(0));
  const LL = points.map((p) => new g.maps.LatLng(p.lat, p.lng));
  // Distance Matrix caps each request at 25 origins, 25 destinations, 100 elements.
  // Chunk BOTH axes (10×10 = 100 elements/request) so ANY node count works — the old
  // code only chunked origins, so >24 stops always blew the 25-destination cap and fell
  // back to straight-line estimates. Now a 40–55-stop zone gets real road distances.
  const STEP = 10;
  for (let oi = 0; oi < n; oi += STEP) {
    const origs = LL.slice(oi, oi + STEP);
    for (let di = 0; di < n; di += STEP) {
      const ds = LL.slice(di, di + STEP);
      const res = await withRetry(() => withTimeout(new Promise((resolve, reject) =>
        svc.getDistanceMatrix({ origins: origs, destinations: ds, travelMode: g.maps.TravelMode.DRIVING },
          (r, status) => (status === "OK" ? resolve(r) : reject(new Error("DistanceMatrix: " + status))))), 12000, "DistanceMatrix"));
      res.rows.forEach((row, ri) => row.elements.forEach((el, ci) => {
        const R = oi + ri, C = di + ci;
        if (el.status === "OK") { km[R][C] = el.distance.value / 1000; min[R][C] = el.duration.value / 60; }
        else { km[R][C] = Infinity; min[R][C] = Infinity; }
      }));
    }
  }
  const out = { km, min };
  _matrixCache.set(key, out);
  return out;
}

/** Road-following geometry for an ordered route (depot -> stops -> depot). */
export async function roadRoute(points) {
  if (points.length < 2) return points.map((p) => [p.lat, p.lng]);
  const key = sig(points);
  if (_routeCache.has(key)) return _routeCache.get(key);
  const g = await loadGoogleRetry();
  const svc = new g.maps.DirectionsService();
  const origin = points[0], destination = points[points.length - 1];
  const waypoints = points.slice(1, -1).map((p) => ({ location: new g.maps.LatLng(p.lat, p.lng), stopover: true }));
  const res = await withRetry(() => withTimeout(new Promise((resolve, reject) =>
    svc.route({ origin: new g.maps.LatLng(origin.lat, origin.lng), destination: new g.maps.LatLng(destination.lat, destination.lng), waypoints, optimizeWaypoints: false, travelMode: g.maps.TravelMode.DRIVING },
      (r, status) => (status === "OK" ? resolve(r) : reject(new Error("Directions: " + status))))), 12000, "Directions"));
  const pts = res.routes[0].overview_path.map((ll) => [ll.lat(), ll.lng()]);
  _routeCache.set(key, pts);
  return pts;
}
