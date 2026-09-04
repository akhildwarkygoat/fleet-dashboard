/* ============================================================================
 * optimiser/trackImpl.js — T.I, Track Implementation.
 * ----------------------------------------------------------------------------
 * A plan says a bus will reach the gate at 09:00 having set off at 08:02. T.I is
 * where somebody writes down what the bus ACTUALLY did, so the difference can be
 * read — per bus, per service, and over time.
 *
 * WHY IT IS ITS OWN THING. Every other board in this app answers "what should we
 * do?". This one answers "did it happen?", and the two must not be allowed to
 * quietly become one number. A plan that is wrong by twenty minutes every day is
 * not a bad day, it is a bad estimate, and the only way to tell those apart is a
 * run of dates.
 *
 * THREE RULES THE REST OF THIS FILE EXISTS TO ENFORCE:
 *
 *  1. HISTORY IS WRITTEN ONCE. What the plan predicted is SNAPSHOT into the
 *     record at the moment the actual is entered. Finalise a different plan
 *     tomorrow, re-cut the roster, edit a stop — yesterday's variance does not
 *     move. Recomputing the baseline from today's plan would silently rewrite
 *     every past day, and a tracker that rewrites its own history is worse than
 *     no tracker.
 *
 *  2. A CLOCK IS A CIRCLE. The night shift starts at 22:00 and finishes at 06:50
 *     the next calendar morning. Plain subtraction turns "ten minutes late" into
 *     "1,430 minutes early" the moment a run crosses midnight, so every variance
 *     here is the SHORTEST SIGNED distance on a 24 h circle.
 *
 *  3. NOTHING IS AVERAGED ACROSS BASES. A pickup's lateness is measured against a
 *     gate time the ERP states. A drop's is measured against a release time that,
 *     for three of the six services, is an eight-hour ASSUMPTION (services.js
 *     `off: null`). Those two are not the same measurement and are never summed.
 *     Duration variance — how long the run took — is honest for both, because it
 *     compares a length to a length and never touches the clock.
 *
 * SOURCE OF TRUTH IS THE VEHICLE MANAGER, TODAY. Every record carries a `source`
 * so that when GPS trackers arrive they write alongside the typed entries instead
 * of forcing a migration, and a mixed day can still say which numbers were
 * observed and which were keyed in.
 * ==========================================================================*/
import { runsFromPlan } from "./layover.js";
import { canonVehicle } from "../erp.js";

const KEY = "opt-ti";
export const TI_VERSION = 1;

/** Within this many minutes of plan counts as "on time". Widely quoted, so it is one number. */
export const ON_TIME_MIN = 5;

/**
 * Beyond this far from plan, the entry is more likely a typing mistake than a bus.
 *
 * The clock folds at twelve hours, which is the only sane way to compare two times of day —
 * but it means a slip of ten minutes at the fold flips the sign by a whole day. A night
 * pickup planned for 21:10 reads +715 if you type 09:05 and −715 if you type 09:15. And the
 * ordinary typo is worse because it looks reasonable: gate 22:00, the manager means 22:30 and
 * types "230", which parses cleanly as 02:30 and lands +270 in the median.
 *
 * So anything past four hours is held out of every aggregate and shown for correction rather
 * than averaged in. A bus really is sometimes four hours late — hence "confirm", not "delete".
 */
export const SUSPECT_CLOCK_MIN = 240;
/** A run taking this much longer than planned is a transposed start and end, not a journey. */
export const suspectRideOver = (plannedRide) => Math.max(360, (plannedRide || 0) * 4);

/** Where an actual time came from. `tracker` is unused today and reserved on purpose. */
export const SOURCE = { MANUAL: "manual", TRACKER: "tracker" };

/** What happened to a run. Anything but `ran` contributes to coverage but never to variance. */
export const STATUS = { RAN: "ran", NOT_RUN: "not-run" };

/* ---------------------------------------------------------------- dates */

/**
 * YYYY-MM-DD from a LOCAL date. toISOString() converts to UTC first, which in IST rolls
 * midnight back a day and files a Monday under the Sunday before it — the same trap
 * TimingsView documents.
 */
export const fmtISO = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export const parseISO = (s) => {
  const m = String(s || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
};

/** The N service days ending at `end` (inclusive), oldest first. */
export function dateRange(end, days) {
  const d = parseISO(end) || new Date();
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const x = new Date(d);
    x.setDate(x.getDate() - i);
    out.push(fmtISO(x));
  }
  return out;
}

export const addDays = (iso, n) => {
  const d = parseISO(iso) || new Date();
  d.setDate(d.getDate() + n);
  return fmtISO(d);
};

/** Sunday is not a working day here — the plan builder drops it from its own averages too. */
export const isSunday = (iso) => { const d = parseISO(iso); return !!d && d.getDay() === 0; };

/* ---------------------------------------------------------------- clock */

const DAY = 24 * 60;
const mod = (m) => ((m % DAY) + DAY) % DAY;

/**
 * Signed minutes from `planned` to `actual` on a 24 h circle, in (-720, 720].
 * Positive = later than planned.
 *
 * A run cannot legitimately be more than twelve hours off its plan; if it were, the
 * entry is wrong, not the bus. Folding at the half-day is therefore safe and is what
 * stops a 23:55 plan against a 00:05 actual reading as 1,430 minutes early.
 */
export function clockVar(actual, planned) {
  if (actual == null || planned == null) return null;
  let d = mod(actual) - mod(planned);
  if (d > DAY / 2) d -= DAY;
  if (d <= -DAY / 2) d += DAY;
  return d;
}

/** Elapsed minutes from `start` to `end` going forward round the clock. */
export const durationMin = (start, end) =>
  start == null || end == null ? null : mod(mod(end) - mod(start));

/** "08:05" <-> 485. Invalid input yields null rather than NaN, which would poison every mean. */
export function parseClock(s) {
  const m = String(s == null ? "" : s).trim().match(/^(\d{1,2}):?(\d{2})$/);
  if (!m) return null;
  const h = +m[1], mi = +m[2];
  if (h > 23 || mi > 59) return null;
  return h * 60 + mi;
}
export const fmtClock = (m) =>
  m == null ? "" : `${String(Math.floor(mod(m) / 60)).padStart(2, "0")}:${String(mod(m) % 60).padStart(2, "0")}`;

/* ---------------------------------------------------------------- store */

const blank = () => ({ version: TI_VERSION, entries: {} });

export function getTI() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "null");
    if (!raw || typeof raw !== "object" || !raw.entries) return blank();
    return { ...blank(), ...raw };
  } catch { return blank(); }
}

/** Raised when the browser refuses the write. Never swallowed — see below. */
export class TIWriteError extends Error {
  constructor(msg) { super(msg); this.name = "TIWriteError"; }
}

/**
 * Persist, or THROW.
 *
 * This used to catch and return the in-memory object as if nothing had happened. At roughly
 * 380 bytes a record and 260 runs a day fleet-wide, a 5 MB origin fills in about eleven
 * working weeks — and localStorage rejects the whole blob, so from that moment EVERY write
 * fails. The board would have gone on accepting times all day, showing them in the boxes and
 * ticking the Recorded tile up, and lost the lot on the next reload. Silently. For ever.
 *
 * Typed times exist nowhere else in this repo — a plan can be re-solved, a stop re-pinned, but
 * nobody can remember what time a bus arrived last Tuesday. So a failed write is an error the
 * operator must see, not a value the caller may assume.
 */
function write(ti) {
  try { localStorage.setItem(KEY, JSON.stringify(ti)); }
  catch (e) {
    throw new TIWriteError(
      "Could not save — this browser's storage for the dashboard is full. " +
      "Export your records, then clear older days.");
  }
  return ti;
}

/** Rough share of a typical 5 MB origin this record is using. */
export const QUOTA_BYTES = 5 * 1024 * 1024;
export const quotaUse = (ti = getTI()) => {
  const b = storeBytes(ti);
  return { bytes: b, pct: Math.min(100, Math.round((b / QUOTA_BYTES) * 100)) };
};

/** Roughly what this record is costing in localStorage, so a full store can be seen coming. */
export const storeBytes = (ti = getTI()) => {
  try { return JSON.stringify(ti).length; } catch { return 0; }
};

/* A run is identified by the service DAY it started on, the service, the vehicle and the
   direction. The vehicle is canonicalised because a bus that gets re-registered would
   otherwise split its own history in two on the day the ERP catches up. */
export const entryKey = (date, svcId, veh, dir) =>
  `${date}|${svcId}|${canonVehicle(String(veh || "").trim())}|${dir}`;

export const getEntry = (date, svcId, veh, dir, ti = getTI()) =>
  ti.entries[entryKey(date, svcId, veh, dir)] || null;

/**
 * Record or amend what a bus actually did.
 *
 * @param planned  the plan's own figures for this run — REQUIRED on first write, ignored
 *                 afterwards. Stored verbatim so the comparison stays fixed for ever.
 * @param patch    { actualStart, actualEnd, status, note, source, bulk, confirmed }
 * @param opts.defer  build the next state WITHOUT persisting — for a bulk run that would
 *                    otherwise stringify and store the whole record once per row. Finish with
 *                    commit().
 */
export function setEntry(date, svcId, veh, dir, patch, planned, ti = getTI(), opts = {}) {
  const k = entryKey(date, svcId, veh, dir);
  const prev = ti.entries[k];
  const now = Date.now();
  const next = {
    date, svcId, dir,
    veh: canonVehicle(String(veh || "").trim()),
    status: STATUS.RAN,
    source: SOURCE.MANUAL,
    actualStart: null, actualEnd: null, note: "", bulk: false,
    ...(prev || {}),
    ...patch,
    /* Written once. A later plan is a different prediction about the future, not a
       correction to what yesterday's plan said. */
    planned: (prev && prev.planned) || planned || null,
    at: (prev && prev.at) || now,
    editedAt: prev ? now : undefined,
  };
  /* An entry with nothing in it is a deletion, not a blank row — otherwise clearing a
     mistyped time would leave a record that counts as "recorded" for ever. A bulk assertion
     is deliberately timeless ("it ran to plan" is not a stopwatch reading) so it is not
     nothing, and must survive this. */
  if (next.status === STATUS.RAN && !next.bulk &&
      next.actualStart == null && next.actualEnd == null && !next.note) {
    delete ti.entries[k];
  } else {
    ti.entries[k] = next;
  }
  return opts.defer ? { ...ti } : write({ ...ti });
}

/** Persist a state built up with `{ defer: true }`. Throws like any other write. */
export const commit = (ti) => write(ti);

export function deleteEntry(date, svcId, veh, dir, ti = getTI()) {
  delete ti.entries[entryKey(date, svcId, veh, dir)];
  return write({ ...ti });
}

export function entriesFor(date, svcId, ti = getTI()) {
  const out = [];
  for (const e of Object.values(ti.entries))
    if ((!date || e.date === date) && (!svcId || e.svcId === svcId)) out.push(e);
  return out;
}

/** Every date that has at least one record, oldest first. */
export function recordedDates(ti = getTI(), svcId = null) {
  const s = new Set();
  for (const e of Object.values(ti.entries)) if (!svcId || e.svcId === svcId) s.add(e.date);
  return [...s].sort();
}

/* ---------------------------------------------------------------- the plan side */

/**
 * What the plan says this service's buses will do, as one row per run.
 *
 * Deliberately delegates to layover.js runsFromPlan so the Timings clock, the parking
 * model and T.I all read a plan the same way. Two derivations of "when does this bus
 * leave" would eventually disagree, and then the variance would be measuring the
 * disagreement rather than the bus. Safe with ctx=null — onMatrix() passes points
 * straight through when there is no matrix, and T.I needs times, not distances.
 */
export function plannedRuns(plan, svc) {
  if (!plan || !Array.isArray(plan.routes) || !svc || svc.gate == null) return [];
  /* WHICH CALENDAR DAY EACH RUN FALLS ON.
     runsFromPlan folds every time onto a 24 h circle and throws the day away, which is fine
     for drawing a clock and wrong for filing a record. Full night gates at 22:00 and releases
     at 06:00 — its drop happens the NEXT morning, and all thirteen of its drops do. Without an
     offset the manager either files them under tomorrow (so today reads 13 of 26 for ever) or
     under today with no way to know that is what the board wanted.
     `off < gate` means the shift released after midnight; `off + ride >= 1440` means the drop
     itself crossed it. The pickup case is zero on today's data but latent: any re-cut that
     pushes a ride past its gate wraps the same way. */
  const gate = svc.gate, off = svc.off;
  const relNextDay = off != null && off < gate;
  return runsFromPlan(plan, svc, null, {}).map((r) => ({
    veh: canonVehicle(r.veh),
    dir: r.dir,
    svcId: r.svcId,
    label: r.label,
    start: r.start,
    end: r.end,
    ride: r.ride,
    km: r.km,
    riders: r.riders,
    stops: r.stops,
    /* True when this run's clock times rest on the 8 h shift assumption rather than a
       release time anybody has told us. Carried into the snapshot. */
    assumedOff: !!r.assumedOff,
    /* Days from the SERVICE day to the calendar day this run starts and ends on. The record is
       always filed under the service day; these only tell the board what date to print. */
    ...dayOffsets(r, gate, off, relNextDay),
  }));
}

function dayOffsets(r, gate, off, relNextDay) {
  if (r.dir === "pickup") {
    const raw = gate - r.ride;
    return { startDay: raw < 0 ? -1 : 0, endDay: 0 };
  }
  const start = relNextDay ? 1 : 0;
  const rawEnd = (off == null ? gate : off) + r.ride;
  return { startDay: start, endDay: start + (rawEnd >= 24 * 60 ? 1 : 0) };
}

/** The snapshot to freeze into an entry, taken from a planned run plus its provenance. */
export const snapshotOf = (run, planMeta, planBody) => ({
  start: run.start, end: run.end, ride: run.ride,
  startDay: run.startDay || 0, endDay: run.endDay || 0,
  assumedOff: !!run.assumedOff,
  planName: (planMeta && planMeta.name) || "unknown",
  planKind: (planMeta && planMeta.kind) || "unknown",
  planIsDefault: !!(planMeta && planMeta.isDefault),
  /* The NAME is not an identity. resolveFinalised() returns "Optimised" for every default
     plan, so re-cutting plan_s7.json — which build_service_plans.mjs does routinely — would
     leave every record before and after carrying an identical label. The trend would then
     step by ten minutes on the day of the rebuild and be indistinguishable from the fleet
     improving. The plan file stamps its own build date; that is what tells two baselines
     apart. The manager's Rotational plans (kind "rotation") carry no `generated` — they
     were finalised in the Planner, not built — so the date the batch was RECEIVED stands
     in; it is the one date those nine files share and it changes when a new batch does.
     Their name IS distinctive ("Group 2 · Half night · week of 7 Sep") and their file is
     one of nine, so a rotation record never reads as "Optimised" and two groups on the
     same clock in different weeks never share a baseline. */
  planGenerated: (planBody && (planBody.generated || (planBody.source && planBody.source.received))) || null,
  planFile: (planMeta && planMeta.file) || null,
  /* WHICH rider group was on this clock, and in which week. Records are filed by service id,
     which for Rotational is the SLOT — "rot-day" carries three different groups over three
     weeks — so without these two fields a by-bus history on a slot would silently pool three
     different plans' buses under one name. Null on every non-rotation plan. */
  planGroup: (planMeta && planMeta.group) || null,
  planWeek: (planMeta && planMeta.week) || null,
});

/* ---------------------------------------------------------------- variance */

/**
 * One run's variances, with an explicit verdict on which of them mean anything.
 *
 * `startVar` / `endVar` are clock comparisons and inherit the honesty of the times they
 * are measured against. `rideVar` compares a duration to a duration and is therefore
 * valid even when nobody has told us when the shift releases — which is precisely the
 * case for three of the six services.
 */
export function variance(entry) {
  const p = entry && entry.planned;
  const ran = !entry || entry.status !== STATUS.NOT_RUN;
  const out = {
    startVar: null, endVar: null, rideVar: null,
    actualRide: null,
    clockValid: false, rideValid: false,
    suspect: false, suspectReason: "",
    ran, hasPlan: !!p,
    reason: "",
  };
  if (!entry) { out.reason = "nothing recorded"; return out; }
  if (!ran) { out.reason = "did not run"; return out; }
  if (!p) { out.reason = "no plan for this bus on this service"; return out; }

  out.startVar = clockVar(entry.actualStart, p.start);
  out.endVar = clockVar(entry.actualEnd, p.end);
  out.actualRide = durationMin(entry.actualStart, entry.actualEnd);
  out.rideVar = out.actualRide == null || p.ride == null ? null : out.actualRide - p.ride;

  /* A DROP is timed off the release hour. Where that is assumed, the clock variance is
     mostly the assumption's error and would poison any average it entered. */
  const clockTrustworthy = !(entry.dir === "drop" && p.assumedOff);

  /* IS THIS A BUS OR A TYPO? Held out of the aggregates either way until somebody says. An
     unconfirmed outlier is not evidence, and letting one in moves a twelve-bus median. */
  const far = [out.startVar, out.endVar].filter((v) => v != null)
    .some((v) => Math.abs(v) > SUSPECT_CLOCK_MIN);
  const longRide = out.actualRide != null && p.ride != null &&
                   out.actualRide > suspectRideOver(p.ride);
  if (!entry.confirmed && (far || longRide)) {
    out.suspect = true;
    out.suspectReason = longRide
      /* The signature of a swapped start and end: backwards it is exactly the planned length. */
      ? (durationMin(entry.actualEnd, entry.actualStart) != null &&
         Math.abs(durationMin(entry.actualEnd, entry.actualStart) - p.ride) <= 15
          ? "start and end look swapped — the run makes sense backwards"
          : `took ${out.actualRide} min against a plan of ${p.ride}`)
      : `over ${Math.round(SUSPECT_CLOCK_MIN / 60)} h from plan — check the time, or confirm it`;
    out.reason = out.suspectReason;
    return out;                       // valid flags stay false: excluded from every aggregate
  }

  out.clockValid = clockTrustworthy && (out.startVar != null || out.endVar != null);
  out.rideValid = out.rideVar != null;
  if (!clockTrustworthy) out.reason = "release time is assumed, so clock variance is not measured against anything real";
  else if (out.startVar == null && out.endVar == null) out.reason = "no times entered";
  return out;
}

/** Late, early or on time, against the one published tolerance. */
export const onTime = (v, tol = ON_TIME_MIN) => (v == null ? null : Math.abs(v) <= tol);

/* ---------------------------------------------------------------- roll-ups */

const median = (a) => {
  if (!a.length) return null;
  const b = [...a].sort((x, y) => x - y);
  const i = b.length >> 1;
  return b.length % 2 ? b[i] : (b[i - 1] + b[i]) / 2;
};
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
const r1 = (n) => (n == null ? null : Math.round(n * 10) / 10);

/**
 * Statistics for ONE direction's clock comparison, plus its duration comparison.
 *
 * MEDIAN leads, mean follows. One bus four hours late because a tyre went is a real event but
 * it is not what the day was like, and a mean lets it speak for eleven buses that were fine.
 *
 * `lateN` / `earlyN` / `onTimeN` are returned as three separate counts and never collapsed
 * into one signed average, because a signed average of a two-sided distribution is
 * indistinguishable from everything being fine.
 */
function statsFor(list, tolerance) {
  /* BULK-CONFIRMED ROWS DO NOT ENTER THE AVERAGES. "They all ran to plan" is an assertion that
     nothing went wrong; it is not a stopwatch reading of exactly zero. Letting one click write
     twelve synthetic zeros would drag any real lateness toward the middle and let a day be
     declared perfect by a button. They still count as an on-time CLAIM, which is what the
     manager actually asserted, and the split is always reported. */
  const timed = list.filter((x) => !x.e.bulk);
  const asserted = list.filter((x) => x.e.bulk);
  const endVals = timed.map((x) => x.v.endVar).filter((v) => v != null);
  const startVals = timed.map((x) => x.v.startVar).filter((v) => v != null);
  const rideVals = timed.map((x) => x.v.rideVar).filter((v) => v != null);
  const onT = endVals.filter((v) => onTime(v, tolerance)).length;
  const worst = timed.reduce((m, x) => (x.v.endVar == null ? m
    : m == null || Math.abs(x.v.endVar) > Math.abs(m.v.endVar) ? x : m), null);
  /* Asserted rows do NOT enter the percentage. "They all ran to plan" is a statement about
     COVERAGE — the day is accounted for — not a measurement of punctuality. Counting them
     here let three real readings of +28, +35 and +42 render as "on time, 98%". */
  return {
    n: endVals.length,                 // runs actually timed
    asserted: asserted.length,         // runs confirmed in bulk, not timed
    medianEnd: r1(median(endVals)),
    meanEnd: r1(mean(endVals)),
    medianStart: r1(median(startVals)),
    medianRide: r1(median(rideVals)),
    rideN: rideVals.length,
    lateN: endVals.filter((v) => v > tolerance).length,
    earlyN: endVals.filter((v) => v < -tolerance).length,
    onTimeN: onT,
    /* Over TIMED runs only. `asserted` sits beside it so the reader knows how much of the day
       was waved through rather than measured. */
    onTimePct: endVals.length ? Math.round((onT / endVals.length) * 100) : null,
    worst: worst ? { veh: worst.e.veh, dir: worst.e.dir, min: worst.v.endVar } : null,
  };
}

/**
 * Summarise a set of entries, PARTITIONED BY DIRECTION.
 *
 * There is deliberately no pooled "lateness" figure. A pickup's variance is measured against
 * the gate — a time the ERP states, with no model in it — and being late means people were
 * late for work. A drop's is measured against release-plus-a-modelled-traversal, and being
 * late means people got home late. They are different bases and they have opposite meanings,
 * so averaging them lets them CANCEL: twelve pickups ten minutes late and twelve drops ten
 * minutes early came out as "on time", in green, next to "0% on time", about the same runs.
 *
 * `headline` is the pickup block, because "did the fleet get people to work on time" is the
 * question this feature exists to answer.
 */
export function summarise(entries, { tolerance = ON_TIME_MIN } = {}) {
  const vs = entries.map((e) => ({ e, v: variance(e) }));
  const usable = vs.filter((x) => x.v.clockValid || x.v.rideValid);
  const pickup = statsFor(usable.filter((x) => x.e.dir === "pickup" && x.v.clockValid), tolerance);
  const drop = statsFor(usable.filter((x) => x.e.dir === "drop" && x.v.clockValid), tolerance);
  /* Duration IS comparable across directions — it compares a length to a length and never
     touches the clock — so it is the one figure allowed to span both. */
  const rideAll = statsFor(vs.filter((x) => x.v.rideValid), tolerance);
  return {
    recorded: entries.length,
    ran: vs.filter((x) => x.v.ran).length,
    notRun: vs.filter((x) => !x.v.ran).length,
    bulk: vs.filter((x) => x.e.bulk).length,
    noPlan: vs.filter((x) => x.v.ran && !x.v.hasPlan).length,
    /* Recorded, ran, has a plan — and still cannot be compared on the clock, because its
       release time is an assumption. Counted so the gap is visible rather than absent. */
    unmeasurable: vs.filter((x) => x.v.ran && x.v.hasPlan && !x.v.clockValid && !x.v.suspect && !x.e.bulk).length,
    /* Entries that look like a mistake. Excluded from everything until confirmed, and counted
       here so they are visible to be corrected rather than quietly absent. */
    suspect: vs.filter((x) => x.v.suspect).length,
    pickup, drop,
    headline: pickup,
    clockN: pickup.n + drop.n,
    medianRide: rideAll.medianRide,
    rideN: rideAll.rideN,
  };
}

/** Entries grouped by service day, built once. A six-month window is 180 dates; rescanning
 *  the whole store per date turned the trend into an O(dates x entries) sweep on every
 *  keystroke. */
export function indexByDate(ti, svcIds = null) {
  const want = svcIds ? new Set(svcIds) : null;
  const m = new Map();
  for (const e of Object.values(ti.entries)) {
    if (want && !want.has(e.svcId)) continue;
    if (!m.has(e.date)) m.set(e.date, []);
    m.get(e.date).push(e);
  }
  return m;
}

/**
 * One row per day: the summary plus how much of the day was actually written down.
 * `expected` is how many runs the plan has, so coverage is honest — a perfect-looking day
 * with two entries is a day nobody filled in, not a day nothing went wrong.
 */
export function dailySeries(ti, svcId, dates, expectedPerDate = () => 0, opts = {}) {
  const idx = indexByDate(ti, svcId ? [svcId] : null);
  return dates.map((date) => {
    const es = idx.get(date) || [];
    const expected = expectedPerDate(date) || 0;
    const s = summarise(es, opts);
    return {
      date, expected,
      coverage: expected ? Math.round((s.recorded / expected) * 100) : null,
      sunday: isSunday(date),
      ...s,
    };
  });
}

/** Per-vehicle reliability across a window — who is consistently late, not who was late once.
 *  Ranked by the PICKUP median, because that is the figure with a business consequence. */
export function byVehicle(ti, svcId, dates, opts = {}) {
  const set = new Set(dates);
  const g = new Map();
  for (const e of Object.values(ti.entries)) {
    if (svcId && e.svcId !== svcId) continue;
    if (!set.has(e.date)) continue;
    if (!g.has(e.veh)) g.set(e.veh, []);
    g.get(e.veh).push(e);
  }
  return [...g.entries()]
    .map(([veh, es]) => ({ veh, days: new Set(es.map((e) => e.date)).size, ...summarise(es, opts) }))
    .sort((a, b) => (Math.abs(b.pickup.medianEnd ?? 0) - Math.abs(a.pickup.medianEnd ?? 0))
                 || b.recorded - a.recorded);
}

/* ---------------------------------------------------------------- portability */

export function exportTI(ti = getTI()) {
  return { kind: "fleet-dashboard/track-implementation", version: TI_VERSION,
           exported: new Date().toISOString(), entries: ti.entries };
}

/**
 * Merge another machine's records in. Conflicts resolve to the LATER edit rather than to
 * whoever imported last, so importing the same file twice is a no-op and two managers
 * working different services never overwrite each other.
 */
export function importTI(json, ti = getTI()) {
  if (!json || json.kind !== "fleet-dashboard/track-implementation") throw new Error("Not a T.I export");
  const incoming = json.entries || {};
  let added = 0, updated = 0, kept = 0;
  const entries = { ...ti.entries };
  for (const [k, e] of Object.entries(incoming)) {
    const cur = entries[k];
    if (!cur) { entries[k] = e; added++; continue; }
    const curT = cur.editedAt || cur.at || 0, incT = e.editedAt || e.at || 0;
    if (incT > curT) { entries[k] = e; updated++; } else kept++;
  }
  write({ ...ti, entries });
  return { added, updated, kept };
}

export function downloadTI() {
  const blob = new Blob([JSON.stringify(exportTI(), null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `track_implementation_${fmtISO(new Date())}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
