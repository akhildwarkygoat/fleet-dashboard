/* ============================================================================
 * optimiser/services.js — the services the fleet runs.
 *
 * One flat list. Each entry maps a service the business talks about onto the
 * exact string the ERP's free-text `Shift` field carries, so rider counts come
 * from the live punch feed rather than being written down here and going stale.
 *
 * As of 05-08-2026 the ERP carries THREE shifts — General 9, Morning 7 (first
 * seen 27-07-2026) and Rotational (first seen 31-07-2026), and the ERP team is
 * still onboarding people into them.
 *
 * EACH SERVICE IS ITS OWN ENTITY for routing: its own depot, its own stop set,
 * its own distance matrix. Every service starts and ends at the Batlagundu
 * factory except Zenwear, which runs from its own Subbulapuram site ~59 km south.
 *
 * `gate` is minutes-from-midnight; null = the factory hasn't told us the timing.
 * `planUrl` = a finalised plan exists, so this service can be drawn on the
 * Timings clock. Riders in the ERP and a finalised plan are different things:
 * a service can have riders (so it appears with real numbers) and still have no
 * plan (so it has no route blocks to draw).
 *
 * Colours are fixed hexes (not theme tokens) so a service keeps its identity
 * across light/dark and across every view that draws it.
 * ==========================================================================*/

export const FACTORY_DEPOT = { name: "Batlagundu factory", lat: 10.207550, lng: 77.806206 };
export const ZENWEAR_DEPOT = { name: "Zenwear — Subbulapuram", lat: 9.6732711, lng: 77.8072837 };

/* ---- Rotational ----
 * Rotational is one ERP shift covering three round-the-clock slots. The groups
 * move on every Monday, one step along Day → Full night → Half night → Day.
 * Which employee sits in which group is not in the ERP yet; when it arrives,
 * feed it to rotationalSlotOn() and the assignment becomes automatic.
 */
export const ROTATION_SLOTS = [
  { id: "day",   name: "Day",        from: 6 * 60,  to: 14 * 60, color: "#0d9488" },
  { id: "full",  name: "Full night", from: 22 * 60, to: 30 * 60, color: "#4338ca" },  // 22:00 → 06:00 next day
  { id: "half",  name: "Half night", from: 14 * 60, to: 22 * 60, color: "#7c5cd6" },
];
/* The cycle order IS the array order: Day → Full night → Half night → back to Day. */

/* Monday of the week `date` falls in (local), which is when the rotation steps. */
export function weekStart(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));   // getDay: Sun=0 → Monday-based
  return d;
}
/* How many Mondays have passed since the anchor — i.e. how many steps the rotation has taken. */
export function rotationIndex(date, anchor = ROTATION_ANCHOR) {
  const weeks = Math.floor((weekStart(date) - weekStart(anchor)) / (7 * 86400e3));
  const n = ROTATION_SLOTS.length;
  return ((weeks % n) + n) % n;
}
/* Anchor week: the week group A is on Day. Set this to a real Monday once the
   ERP tells us which group was where — until then the cycle is right and only
   its phase is unconfirmed. */
export const ROTATION_ANCHOR = new Date(2026, 7, 3);   // Mon 03-08-2026

/* Which slot a rotation group is on in a given week.
   `group` is 0-based (group 0 starts on Day in the anchor week). */
export function rotationalSlotOn(group, date) {
  const i = (rotationIndex(date) + (group || 0)) % ROTATION_SLOTS.length;
  return ROTATION_SLOTS[i];
}
/* The next slot a group moves to — "Day → Full night" reads straight off this. */
export const nextSlot = (slotId) => {
  const i = ROTATION_SLOTS.findIndex((s) => s.id === slotId);
  return i < 0 ? null : ROTATION_SLOTS[(i + 1) % ROTATION_SLOTS.length];
};

/* A rider belongs to EXACTLY ONE service. Unit wins over shift: every unit starts at the
   same gate time, so the shift field alone cannot tell a Zenwear rider from a Batlagundu
   one — both read "GENERAL SHIFT - 9". Services with their own `erpUnit` therefore claim
   their riders first, and the shift-based services take everyone left over. Shift still
   sub-divides WITHIN a unit, which is why Gainup's people split across all three shifts. */
export function serviceIdFor(unit, shift) {
  const byUnit = SERVICES.find((s) => s.erpUnit && s.erpUnit === unit);
  if (byUnit) return byUnit.id;
  const byShift = SERVICES.find((s) => s.erpShift && s.erpShift === shift);
  return byShift ? byShift.id : null;
}

export const SERVICES = [
  { id: "s9",    name: "9 am General", color: "#2186eb", gate: 9 * 60, erpShift: "GENERAL SHIFT - 9", depot: FACTORY_DEPOT, planUrl: "/finalised_plan.json" },   // Batlagundu only — Zenwear's 9 am riders belong to Zenwear
  { id: "s7",    name: "7 am Morning", color: "#d97706", gate: 7 * 60, erpShift: "MORNING SHIFT - 7", depot: FACTORY_DEPOT },
  { id: "rot",   name: "Rotational",   color: "#0d9488", gate: null,   erpShift: "ROTATIONAL SHIFT", depot: FACTORY_DEPOT, slots: ROTATION_SLOTS },
  { id: "zen",   name: "Zenwear",      color: "#be1250", gate: 9 * 60, erpShift: null, erpUnit: "Zenwear", depot: ZENWEAR_DEPOT, branch: true },
];

/* The seventh choice on the board: not a service but the union of them —
   opens the tab in cross-service mode with the Timings clock front and centre. */
export const OVERALL = { id: "all", name: "Overall", color: "#64748b", overall: true, planUrl: null };

export const serviceById = (id) => SERVICES.find((s) => s.id === id) || null;

/* This service's slice of the live ERP roll-up. `roll` is keyed by service id and is
   already mutually exclusive (see serviceIdFor), so the counts add up to the fleet. */
export const erpStatsFor = (svc, roll) => (roll && roll[svc.id]) || null;

/* What this service is still missing before it can be planned. */
export function serviceNeed(svc, roll) {
  const stats = erpStatsFor(svc, roll);
  if (!stats) return svc.branch ? "riders tagged to it in the ERP" : "riders in the ERP";
  if (svc.slots) return "the employee→group split, to place its three slots";
  if (svc.gate == null) return "a gate time";
  if (!svc.planUrl) return "a plan — run the optimiser for this service";
  return null;
}

/* Shifts running inside one unit-based service — the "exception" case: units share a gate
   time, but a unit can still run more than one shift internally. */
export const subShiftsOf = (svc, roll) => {
  const st = erpStatsFor(svc, roll);
  return st && st.shifts ? Object.entries(st.shifts).sort((a, b) => b[1] - a[1]) : [];
};

export const fmtClock = (min) => {
  if (min == null) return "—";
  const h = Math.floor(min / 60) % 24, m = min % 60;
  return String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0");
};
