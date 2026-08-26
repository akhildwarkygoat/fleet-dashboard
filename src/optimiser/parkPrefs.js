/* ============================================================================
 * optimiser/parkPrefs.js — where each bus is told to wait.
 * ----------------------------------------------------------------------------
 * The choice is a PREFERENCE, not a plan output. A plan file records where its
 * buses were parked when it was built (`parking` in the JSON); this records what
 * the transport manager has since decided. The manager's choice wins, exactly as
 * finalisedPlans.js lets his plan beat the optimiser's — and for the same reason:
 * he knows which villages have somewhere a bus can safely stand overnight and the
 * road matrix does not.
 *
 * Keyed per SERVICE and per BUS. One registration runs several services, and where
 * it should stand after the Day drop is a different question from where it should
 * stand after the night one — a single key per vehicle would force one answer to
 * both.
 *
 * localStorage, like every other choice in this app, so it works on the deploy and
 * on the Windows machine with no server write.
 *
 * Spec shapes:
 *   { kind: "auto" }                     leave the bus where its route ends (default)
 *   { kind: "depot" }                    drive it home after every run — today's baseline
 *   { kind: "node", idx, name }          a specific road-matrix node
 * ==========================================================================*/

const KEY = "opt-parking";

/* `routes` holds where a bus PARKS (the end of its run); `starts` holds where it BEGINS.
   Two maps rather than one entry with two fields, so a bus that only ever has its park moved
   never writes a start it did not choose. */
const blank = () => ({ services: {}, routes: {}, starts: {} });

export function getParkPrefs() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "null");
    if (!raw || typeof raw !== "object") return blank();
    return { ...blank(), ...raw };
  } catch { return blank(); }
}

function write(p) {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* quota — see Store.set */ }
  return p;
}

/** Where this service parks by default. `auto` is the behaviour that saves fuel. */
export const parkFor = (svcId, prefs = getParkPrefs()) =>
  prefs.services[svcId] || { kind: "auto" };

/** Where ONE bus on this service parks — its own choice, else the service's. */
export const parkForRoute = (svcId, veh, prefs = getParkPrefs()) =>
  prefs.routes[`${svcId}|${veh}`] || parkFor(svcId, prefs);

/**
 * Record where one bus parks on one service. Pass `null` to drop the choice and fall
 * back to the service default — storing `{kind:"auto"}` instead would freeze today's
 * default into the record and stop a later change to it reaching this bus.
 */
export function setRoutePark(svcId, veh, spec) {
  const p = getParkPrefs();
  const k = `${svcId}|${veh}`;
  if (!spec || spec.kind === "auto") delete p.routes[k];
  else p.routes[k] = spec;
  return write(p);
}

/** Where one bus BEGINS its run. `auto` (or null) means the depot, as every plan assumes. */
export const startForRoute = (svcId, veh, prefs = getParkPrefs()) =>
  (prefs.starts && prefs.starts[`${svcId}|${veh}`]) || { kind: "auto" };

export function setRouteStart(svcId, veh, spec) {
  const p = getParkPrefs();
  const k = `${svcId}|${veh}`;
  if (!spec || spec.kind === "auto") delete p.starts[k];
  else p.starts[k] = spec;
  return write(p);
}

/** Drop every per-bus choice on a service — back to one rule for the whole service. */
export function clearRouteParks(svcId) {
  const p = getParkPrefs();
  for (const k of Object.keys(p.routes)) if (k.startsWith(svcId + "|")) delete p.routes[k];
  for (const k of Object.keys(p.starts)) if (k.startsWith(svcId + "|")) delete p.starts[k];
  return write(p);
}
