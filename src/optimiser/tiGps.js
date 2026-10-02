/* ============================================================================
 * optimiser/tiGps.js — T.I from the bus attendance app's journeys.
 * ----------------------------------------------------------------------------
 * The bus leader taps Start journey when the bus leaves its parking and End journey
 * when it arrives (the gate on a pickup, the last stop on a drop). The fleet km feed
 * (busApp.js) already carries every journey's times, so each one becomes the actual
 * times of the planned run it belongs to, with source "tracker". T.I takes its times
 * only from here (Akhil, 2026-10-02: "remove ability to type, it should only be thru
 * the gps").
 *
 * MATCHING. A journey belongs to the bus's planned run, across every service, whose
 * clock it sits nearest: a pickup by its END (arrival at the gate is what the plan
 * fixes, and the start is the drive out of parking, not the first stop), a drop by its
 * START (leaving the factory at release). Nearest pairs are taken first, one journey per
 * run, and nothing further than MATCH_WINDOW_MIN away is paired. A journey that matches
 * nothing is an extra trip, listed rather than forced onto a run.
 *
 * DAYS. T.I files a run under its SERVICE day; a full-night drop runs the next morning
 * (startDay 1). The bus app's service day starts at 03:00, so a 06:00 journey sits on the
 * next service date — exactly where the drop's calendar day is. So the journeys of bus-app
 * date S are matched against T.I date S's same-day runs plus T.I date S−1's next-day runs.
 * ==========================================================================*/
import { SERVICES } from "./services.js";
import { plannedRuns, snapshotOf, setEntry, commit, getTI, getEntry, addDays, SOURCE, STATUS } from "./trackImpl.js";
import { planSourceForWeek, resolveFinalised } from "./finalisedPlans.js";
import { mondayOf, describeSlot, groupOnSlot } from "./rotation.js";
import { vehKey } from "../erp.js";

export const MATCH_WINDOW_MIN = 180;
const DAY = 1440;

/** Minutes past local midnight of a timestamp. */
export const minOfDay = (ms) => { const d = new Date(ms); return d.getHours() * 60 + d.getMinutes(); };
const gap = (a, b) => { let d = (((a - b) % DAY) + DAY) % DAY; if (d > DAY / 2) d = DAY - d; return d; };

/** How far a journey sits from a planned run, in minutes, or null when it cannot be told. */
export function journeyGap(journey, run) {
  if (run.dir === "pickup" && journey.endedAt != null) return gap(minOfDay(journey.endedAt), run.end);
  if (run.dir === "pickup") return gap(minOfDay(journey.startedAt), run.start);   // still out: compare its start
  return gap(minOfDay(journey.startedAt), run.start);
}

/**
 * Pair one bus's journeys with its planned runs: nearest first, one each way, within the window.
 * @returns { matched: [{ journey, run, gap }], unmatched: journey[] }
 */
export function matchJourneys(runs, journeys, window = MATCH_WINDOW_MIN) {
  const pairs = [];
  journeys.forEach((j, ji) => runs.forEach((r, ri) => {
    const g = journeyGap(j, r);
    if (g != null && g <= window) pairs.push({ ji, ri, g });
  }));
  pairs.sort((a, b) => a.g - b.g || a.ji - b.ji || a.ri - b.ri);
  const usedJ = new Set(), usedR = new Set(), matched = [];
  for (const p of pairs) {
    if (usedJ.has(p.ji) || usedR.has(p.ri)) continue;
    usedJ.add(p.ji); usedR.add(p.ri);
    matched.push({ journey: journeys[p.ji], run: runs[p.ri], gap: p.g });
  }
  return { matched, unmatched: journeys.filter((_, i) => !usedJ.has(i)) };
}

/** What T.I stores for a matched journey. */
export const patchFor = (journey) => ({
  actualStart: minOfDay(journey.startedAt),
  actualEnd: journey.endedAt != null ? minOfDay(journey.endedAt) : null,
  status: STATUS.RAN, source: SOURCE.TRACKER, bulk: false,
  journeyId: journey.id, journeyKm: journey.km, live: journey.endedAt == null,
});

/* The plan each service ran in a given week, with the name T.I freezes into the record. */
async function planFor(svc, week, fetchJson, cache) {
  const key = svc.id + "|" + week;
  if (!cache.has(key)) {
    cache.set(key, (async () => {
      const src = planSourceForWeek(svc, week);
      if (!src) return null;
      const body = src.body || (src.file ? await fetchJson(src.file).catch(() => null) : null);
      if (!body || !Array.isArray(body.routes)) return null;
      const r = resolveFinalised(svc);
      const meta = r.kind === "rotation"
        ? { kind: "rotation", name: describeSlot(svc.slot, week), file: src.file, group: groupOnSlot(svc.slot, week), week, isDefault: false }
        : { ...r, file: src.file || r.file || null };
      return { body, meta };
    })());
  }
  return cache.get(key);
}

/* Unmatched journeys from the last sync, for the T.I board to list. */
let lastExtras = [];
export const EXTRAS_EVENT = "fleet:ti-extras";
export const getExtraTrips = () => lastExtras;

/**
 * Fill T.I from the GPS feed: every journey of every day the feed carries, matched to the plan
 * that ran that week. Writes only what changed, in one save.
 * @returns { written, extras } — extras are journeys no planned run was near
 */
export async function syncTiFromGps(gpsFeed, fetchJson) {
  if (!gpsFeed || !Array.isArray(gpsFeed.days) || !gpsFeed.days.length) return { written: 0, extras: [] };
  const cache = new Map();
  const journeysBy = new Map();                  // bus-app date → vehKey → journeys
  for (const d of gpsFeed.days) {
    const runs = (d.runs || []).filter((r) => r && r.startedAt != null);
    if (!runs.length) continue;
    if (!journeysBy.has(d.serviceDate)) journeysBy.set(d.serviceDate, new Map());
    journeysBy.get(d.serviceDate).set(vehKey(d.busId), runs.map((r) => ({ ...r, busId: d.busId, serviceDate: d.serviceDate })));
  }

  /* Planned runs for T.I date D, every service, with the plan they were measured against. */
  const runsCache = new Map();
  const runsOn = async (date) => {
    if (!runsCache.has(date)) {
      const week = mondayOf(date), out = [];
      for (const svc of SERVICES) {
        const p = await planFor(svc, week, fetchJson, cache);
        if (!p) continue;
        for (const run of plannedRuns(p.body, svc)) out.push({ ...run, tiDate: date, planMeta: p.meta, planBody: p.body });
      }
      runsCache.set(date, out);
    }
    return runsCache.get(date);
  };

  let ti = getTI(), written = 0;
  const extras = [];
  for (const [date, buses] of [...journeysBy.entries()].sort()) {
    const candidates = [
      ...(await runsOn(date)).filter((r) => (r.startDay || 0) === 0),
      ...(await runsOn(addDays(date, -1))).filter((r) => (r.startDay || 0) === 1),
    ];
    for (const [veh, journeys] of buses) {
      const runs = candidates.filter((r) => vehKey(r.veh) === veh);
      const { matched, unmatched } = matchJourneys(runs, journeys);
      extras.push(...unmatched);
      for (const { journey, run } of matched) {
        const patch = patchFor(journey);
        const prev = getEntry(run.tiDate, run.svcId, run.veh, run.dir, ti);
        if (prev && prev.source === SOURCE.TRACKER && prev.journeyId === patch.journeyId &&
            prev.actualStart === patch.actualStart && prev.actualEnd === patch.actualEnd && prev.live === patch.live) continue;
        ti = setEntry(run.tiDate, run.svcId, run.veh, run.dir, patch, snapshotOf(run, run.planMeta, run.planBody), ti, { defer: true });
        written++;
      }
    }
  }
  if (written) commit(ti);
  lastExtras = extras.sort((a, b) => b.startedAt - a.startedAt);
  if (typeof window !== "undefined" && typeof Event === "function") window.dispatchEvent(new Event(EXTRAS_EVENT));
  return { written, extras: lastExtras };
}
