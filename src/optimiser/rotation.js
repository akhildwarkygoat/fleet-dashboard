/* ============================================================================
 * optimiser/rotation.js — which rider group runs which Rotational clock THIS week.
 * ----------------------------------------------------------------------------
 * Rotational is three fixed groups of riders on three clocks (Day 06:00, Half night
 * 14:00, Full night 22:00). Every Monday each group steps one place along
 *     Day → Full night → Half night → Day
 * so the people riding the 06:00 buses change every week, but the SET of people in
 * each group does not. The transport manager therefore finalised NINE plans, not
 * three: every group planned at every clock (public/plans/rot/g{1,2,3}-{day,half,full}
 * .json). A plan is a property of a group × a clock, and which pair is live is a
 * property of the CALENDAR — not of anything the ERP feed says this morning.
 *
 * The alternative — re-solving three per-service plans against the freshly re-cut
 * roster every Monday — was rejected: the solver does not reproduce the routes the
 * fleet actually runs (see docs/weekly-refresh.md, "Why the plans are not rebuilt"),
 * and swapping in an unreviewed solve on a timer is not a refresh. Nine reviewed plans
 * that rotate by date give the manager the same routes back every third week, which
 * is exactly what the floor does.
 *
 * src/rotation.json is the manifest: the cycle, the anchor week, and for each group
 * the clock it was on in that week plus its three plan files. Everything here is a
 * pure function of (manifest, week). src/rotationalRoster.json still decides WHO is on
 * which slot; this module only decides WHICH PLAN each slot shows.
 *
 * Pure ESM, no React. It is imported by the Vite bundle AND run under plain `node`
 * (rotation.test.js), so every window/localStorage touch is guarded. Dates are handled
 * in LOCAL time with the same Monday rule as weekStart() in services.js, and formatted
 * from local fields — toISOString() would shift the date at IST midnight.
 * ==========================================================================*/
import ROTATION from "../rotation.json" with { type: "json" };
import { ROTATION_SLOTS } from "./services.js";

export { ROTATION };

const KEY = "opt-rota-week";          // localStorage: the pinned week, an ISO Monday
const EVENT = "rota-week";            // window CustomEvent fired when the pin changes
const WEEK_MS = 7 * 864e5;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/* ---- dates ----
 * A bare "YYYY-MM-DD" is built from its fields so it means LOCAL midnight. `new Date("2026-09-04")`
 * would mean UTC midnight, which is 05:30 IST — harmless here, but a day early anywhere west of
 * Greenwich. An impossible date ("2026-02-30", "2026-13-01") is rejected rather than rolled over:
 * readPin() treats "not a date" as "not pinned", and a rolled-over pin would be a plausible wrong
 * week with nothing on screen to say so. Other strings and positive timestamps go through Date;
 * anything else (null, 0, false, objects) is "no date" — new Date(null) is the epoch, not a miss. */
function toLocalDate(x) {
  if (x instanceof Date) return isNaN(x.getTime()) ? null : new Date(x.getTime());
  if (typeof x === "string") {
    const m = ISO_DATE.exec(x.trim());
    if (m) {
      const d = new Date(+m[1], +m[2] - 1, +m[3]);
      const real = d.getFullYear() === +m[1] && d.getMonth() === +m[2] - 1 && d.getDate() === +m[3];
      return real ? d : null;
    }
  } else if (!(typeof x === "number" && Number.isFinite(x) && x > 0)) {
    return null;
  }
  const d = new Date(x);
  return isNaN(d.getTime()) ? null : d;
}

const pad2 = (n) => String(n).padStart(2, "0");
/* Local fields, never toISOString — see header. */
const isoLocal = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

/** Monday of the week `dateOrIso` falls in, local time, as "YYYY-MM-DD". Invalid input → null. */
export function mondayOf(dateOrIso) {
  const d = toLocalDate(dateOrIso);
  if (!d) return null;
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));   // getDay: Sun=0 → Monday-based, as weekStart()
  return isoLocal(d);
}

/** Weeks from `fromIso` to `toIso` (negative when `to` is earlier), rounded to the NEAREST
 *  whole week — so a DST hour on either side cannot turn 7 days into 6.96, and a partial week
 *  rounds rather than truncates (Mon → next Sun is 1, not 0). Callers are expected to pass
 *  Mondays (stepFor normalises both ends with mondayOf first). NaN if either date is invalid. */
export function weeksBetween(fromIso, toIso) {
  const a = toLocalDate(fromIso), b = toLocalDate(toIso);
  if (!a || !b) return NaN;
  a.setHours(0, 0, 0, 0); b.setHours(0, 0, 0, 0);
  return Math.round((b - a) / WEEK_MS);
}

/* ---- the rotation ---- */

/** Position in the cycle for the week containing `weekIso`: 0 in the anchor week, 1 the week
 *  after, … wrapping at the cycle length (3). Earlier weeks count backwards, so the week before
 *  the anchor is step 2. NaN for an unparseable week — every lookup below then misses cleanly. */
export function stepFor(weekIso, manifest = ROTATION) {
  const n = manifest.cycle.length;
  const w = weeksBetween(mondayOf(manifest.anchorWeek), mondayOf(weekIso));
  return isNaN(w) ? NaN : ((w % n) + n) % n;
}

/** Which clock ("day"|"half"|"full") group `groupId` is on in the week of `weekIso`. */
export function slotOfGroup(groupId, weekIso, manifest = ROTATION) {
  const g = manifest.groups[String(groupId)];
  if (!g) return null;
  const i = manifest.cycle.indexOf(g.atAnchor);
  const s = stepFor(weekIso, manifest);
  if (i < 0 || isNaN(s)) return null;
  return manifest.cycle[(i + s) % manifest.cycle.length];
}

/** Which group ("1"|"2"|"3") is on clock `slot` in the week of `weekIso`, or null. */
export function groupOnSlot(slot, weekIso, manifest = ROTATION) {
  for (const id of Object.keys(manifest.groups)) {
    if (slotOfGroup(id, weekIso, manifest) === slot) return id;
  }
  return null;
}

/** The whole picture for one week: { week, step, bySlot: {slot → group}, byGroup: {group → slot} }. */
export function rotationFor(weekIso, manifest = ROTATION) {
  const week = mondayOf(weekIso);
  const bySlot = {}, byGroup = {};
  for (const slot of manifest.cycle) bySlot[slot] = groupOnSlot(slot, week, manifest);
  for (const id of Object.keys(manifest.groups)) byGroup[id] = slotOfGroup(id, week, manifest);
  return { week, step: stepFor(week, manifest), bySlot, byGroup };
}

/** The plan file that clock `slot` should show in the week of `weekIso`, from the manifest.
 *  null when no group lands on that slot or the group has no plan for it — the caller falls
 *  back to the service's own planUrl rather than showing the wrong group's routes. */
export function planUrlFor(slot, weekIso, manifest = ROTATION) {
  const g = groupOnSlot(slot, weekIso, manifest);
  const plans = g && manifest.groups[g].plans;
  return (plans && plans[slot]) || null;
}

/* ---- labels ---- */

const slotName = (slot) => (ROTATION_SLOTS.find((s) => s.id === slot) || { name: slot }).name;

/** "week of 7 Sep" — day and short month, no year, matching how the week is spoken about. */
export function fmtWeek(weekIso) {
  const d = toLocalDate(weekIso);
  return d ? `week of ${d.getDate()} ${MONTHS[d.getMonth()]}` : "week of ?";
}

/** e.g. "Group 3 · Half night · week of 7 Sep". When the manifest has no group for the slot
 *  it says so instead of inventing one. */
export function describeSlot(slot, weekIso, manifest = ROTATION) {
  const g = groupOnSlot(slot, weekIso, manifest);
  const label = g ? (manifest.groups[g].label || `Group ${g}`) : "No group";
  return `${label} · ${slotName(slot)} · ${fmtWeek(mondayOf(weekIso) || weekIso)}`;
}

/** rotationFor() for `n` consecutive weeks starting at the week of `fromWeekIso`
 *  (default: the current rota week). Steps by calendar days, so DST cannot skip a Monday. */
export function upcoming(n, fromWeekIso, manifest = ROTATION) {
  const start = toLocalDate(mondayOf(fromWeekIso == null ? getRotaWeek() : fromWeekIso));
  const out = [];
  if (!start) return out;
  for (let i = 0; i < n; i++) {
    const d = new Date(start.getTime());
    d.setDate(d.getDate() + 7 * i);
    out.push(rotationFor(isoLocal(d), manifest));
  }
  return out;
}

/* ---- the pinned week ----
 * By default the dashboard follows the calendar. Pinning a week (to look at next week's plans,
 * or to hold last week's while checking what ran) lives in localStorage, like every other
 * optimiser choice, and is announced with a window event so every view that fetched a plan
 * body re-fetches. A pin is a per-browser UI state, so under Node there is none: getRotaWeek()
 * is simply this week, and the setters are no-ops that do not throw. */
const hasWindow = () => typeof window !== "undefined";

function storage() {
  if (!hasWindow()) return null;
  try { return typeof localStorage !== "undefined" ? localStorage : null; } catch { return null; }
}

function readPin() {
  const s = storage();
  if (!s) return null;
  try {
    const raw = s.getItem(KEY);
    return raw ? mondayOf(raw) : null;      // a stale or hand-edited value that is not a date → unpinned
  } catch { return null; }
}

/** The week the dashboard is showing: the pinned week if one is set, else this week's Monday. */
export function getRotaWeek() {
  return readPin() || mondayOf(new Date());
}

export function isRotaWeekPinned() {
  return readPin() != null;
}

/** Pin a week (any date in it — it is normalised to its Monday) or pass null to follow the
 *  calendar again. Persists, then fires "rota-week" so subscribers reload. */
export function setRotaWeek(isoOrNull) {
  const week = isoOrNull == null ? null : mondayOf(isoOrNull);
  if (isoOrNull != null && !week) return false;   // unparseable: keep the current pin, no event
  const s = storage();
  if (s) {
    try {
      if (week) s.setItem(KEY, week); else s.removeItem(KEY);
    } catch { /* quota / private mode — the event still fires so the UI stays consistent */ }
  }
  if (hasWindow() && typeof window.dispatchEvent === "function") {
    const detail = { week: getRotaWeek(), pinned: isRotaWeekPinned() };
    let ev = null;
    try { ev = new CustomEvent(EVENT, { detail }); } catch { try { ev = new Event(EVENT); } catch { /* no Event */ } }
    if (ev) window.dispatchEvent(ev);
  }
  return true;
}

/** Call `fn` whenever the pinned week changes. Returns the unsubscribe function; under Node
 *  (no window) it subscribes to nothing and the returned function is a no-op. */
export function subscribeRotaWeek(fn) {
  if (!hasWindow() || typeof window.addEventListener !== "function") return () => {};
  window.addEventListener(EVENT, fn);
  return () => window.removeEventListener(EVENT, fn);
}
