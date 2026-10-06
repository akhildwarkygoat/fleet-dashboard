/* ============================================================================
 * attendanceHistory.js — every day of punches the ERP has ever sent, kept.
 * ----------------------------------------------------------------------------
 * The ERP's punch feed (VehicleEmpMapDetails) carries only its last 11 days and ignores any date
 * range asked of it (checked 06-10-2026). Every sync used to replace the stored attendance with
 * that window, so a month could only ever be costed on its last few days: September showed
 * "5 days recorded", 26 to 30 Sept. Akhil, 06-10-2026: keep every day from now on.
 *
 * KEPT SMALL. The browser's storage holds about 5 MB per site and the live snapshot already takes
 * half of it (the 11-day attendance alone is ~580 KB), so a day is packed to two bits a rider:
 * 0 no punch row, 1 absent, 2 present, four riders a byte, base64. About 1.5 KB a day for 4,500
 * riders, ~0.6 MB a year. Riders are numbered once, in the order first seen (`ids`), so a day packed
 * last year still reads after new riders join.
 *
 * WHO RODE WHAT. The costs map a rider to a bus, a service and a company through the employee list,
 * which the feed rebuilds from its own 11 days. A rider who has since left the company is missing
 * from it, and their past rider-days would vanish with them. So each rider's last known bus, shift,
 * unit and Rotational slot is kept too (`people`), and riders the feed no longer carries come back
 * as `formerRiders`, for the costs only. A rider who moved bus is read on their current bus for
 * every day, as the feed's own 11 days always were.
 *
 * Kept for KEEP_DAYS (two years); older days drop off.
 *
 * Shape: { v, ids: [Empl_no], people: { Empl_no: [bus#, shift#, unit#, slot] },
 *          names: { buses: [], shifts: [], units: [] }, days: { "YYYY-MM-DD": packed } }
 * ==========================================================================*/

export const HISTORY_VERSION = 1;
export const KEEP_DAYS = 731;

const b64 = {
  enc(bytes) { let s = ""; for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]); return btoa(s); },
  dec(str) { const s = atob(str); const out = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i); return out; },
};

export const emptyHistory = () => ({ v: HISTORY_VERSION, ids: [], people: {}, names: { buses: [], shifts: [], units: [] }, days: {} });

/** A stored value, or an empty history when it is missing or of another version. */
export const readHistory = (h) => (h && h.v === HISTORY_VERSION && Array.isArray(h.ids) && h.days ? h : emptyHistory());

/** One day's punches ({ Empl_no: "P" | "A" }) packed against the rider numbering. */
export function packDay(day, index) {
  const bytes = new Uint8Array(Math.ceil(index.size / 4));
  for (const [id, v] of Object.entries(day || {})) {
    const i = index.get(id);
    if (i == null) continue;
    const c = v === "P" ? 2 : v === "A" ? 1 : 0;
    if (c) bytes[i >> 2] |= c << ((i & 3) * 2);
  }
  return b64.enc(bytes);
}

/** A packed day back to { Empl_no: "P" | "A" }. */
export function unpackDay(packed, ids) {
  const bytes = b64.dec(packed), day = {};
  const n = Math.min(ids.length, bytes.length * 4);
  for (let i = 0; i < n; i++) {
    const c = (bytes[i >> 2] >> ((i & 3) * 2)) & 3;
    if (c === 2) day[ids[i]] = "P";
    else if (c === 1) day[ids[i]] = "A";
  }
  return day;
}

const intern = (list, s) => { const v = s || ""; let i = list.indexOf(v); if (i < 0) { list.push(v); i = list.length - 1; } return i; };

/**
 * Add a sync's days to the history: every date the feed carries is (re)written, since a later pull
 * of the same day is the more complete one, and each rider the feed lists has their bus, shift,
 * unit and slot brought up to date. Returns a new history; the one given is not changed.
 * @param attendance { date: { Empl_no: "P" | "A" } } as erp.js mapErpToDashboard returns it
 * @param employees  the feed's riders: { id, busId, shift, unit, slot }
 */
export function addToHistory(hist, attendance, employees) {
  const h = readHistory(hist);
  const ids = [...h.ids], index = new Map(ids.map((id, i) => [id, i]));
  const names = { buses: [...h.names.buses], shifts: [...h.names.shifts], units: [...h.names.units] };
  const people = { ...h.people };
  const number = (id) => { if (!index.has(id)) { index.set(id, ids.length); ids.push(id); } };
  for (const e of employees || []) {
    if (!e || !e.id) continue;
    number(e.id);
    people[e.id] = [intern(names.buses, e.busId), intern(names.shifts, e.shift), intern(names.units, e.unit), e.slot || ""];
  }
  for (const day of Object.values(attendance || {})) for (const id of Object.keys(day || {})) number(id);
  const days = { ...h.days };
  for (const [date, day] of Object.entries(attendance || {})) if (day && Object.keys(day).length) days[date] = packDay(day, index);
  const kept = Object.keys(days).sort();
  for (const d of kept.slice(0, Math.max(0, kept.length - KEEP_DAYS))) delete days[d];
  return { v: HISTORY_VERSION, ids, people, names, days };
}

/** The kept days the feed no longer carries, as { date: { Empl_no: "P" | "A" } }. */
export function historyDays(hist, feed) {
  const h = readHistory(hist), out = {};
  for (const [date, packed] of Object.entries(h.days)) if (!(feed && feed[date])) out[date] = unpackDay(packed, h.ids);
  return out;
}

/** Riders the history knows and the feed's employee list no longer carries, with their last known
 *  bus, shift, unit and slot, so their past rider-days still count. `former: true` marks them. */
export function formerRiders(hist, employees) {
  const h = readHistory(hist), have = new Set((employees || []).map((e) => e.id)), out = [];
  for (const [id, [bus, shift, unit, slot]] of Object.entries(h.people)) {
    if (have.has(id)) continue;
    out.push({ id, busId: h.names.buses[bus] || "", shift: h.names.shifts[shift] || "", unit: h.names.units[unit] || "", slot: slot || "", former: true });
  }
  return out;
}

/** The first day the history holds, or "" when it is empty. */
export const historyStart = (hist) => Object.keys(readHistory(hist).days).sort()[0] || "";
