/* ============================================================================
 * busApp.js — the bus attendance app's GPS km, read through the dev server.
 * ----------------------------------------------------------------------------
 * GET /bus-api/fleet/km is a passthrough in vite.config.js that adds the shared key, so the
 * browser never holds it. The answer is { today, from, to, days: [{ serviceDate, busId, km,
 * journeys, active, runs, ... }] }: every trip a bus made that day, summed.
 *
 * Returns { ok: true, data } or { ok: false, phase, msg, code } where phase is
 *   "off"      not linked here, or the feed is switched off in the bus app — nothing to retry
 *   "offline"  linked, but the bus app is not answering right now
 *   "error"    it answered and refused (a wrong key) or failed
 * ==========================================================================*/
export async function fetchBusKm({ from, to } = {}) {
  const q = new URLSearchParams();
  if (from) q.set("from", from);
  if (to) q.set("to", to);
  let res;
  try {
    res = await fetch("/bus-api/fleet/km" + (q.toString() ? "?" + q : ""), { headers: { Accept: "application/json" } });
  } catch {
    return { ok: false, phase: "offline", msg: "The dashboard's own server did not answer" };
  }
  const body = await res.json().catch(() => null);
  if (res.ok && body && Array.isArray(body.days)) return { ok: true, data: body };
  const err = (body && body.error) || {};
  // a static deployment has no dev server behind it: /bus-api is a 404, or the app shell itself
  if (!err.code && (res.status === 404 || res.ok)) return { ok: false, phase: "off", msg: "Not available on this deployment" };
  if (err.code === "not_linked" || err.code === "fleet_feed_off") return { ok: false, phase: "off", msg: err.message };
  if (err.code === "bus_app_offline") return { ok: false, phase: "offline", msg: err.message };
  if (err.code === "bus_app_outdated") return { ok: false, phase: "error", code: err.code, msg: err.message };
  if (res.status === 401) return { ok: false, phase: "error", code: "unauthorised", msg: "The bus app refused the key: run npm run fleet:link in the bus attendance repo, then restart" };
  return { ok: false, phase: "error", code: err.code || null, msg: err.message || `HTTP ${res.status}` };
}
