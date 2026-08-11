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
 * Three round-the-clock slots. Every rider steps one place along
 *     Day → Full night → Half night → Day
 * on Monday, and stays there for the week.
 *
 * Verified against the punch feed rather than assumed: over the days the ERP carries, the
 * three commonest week-to-week moves are exactly Half→Day (282), Day→Full (228) and
 * Full→Half (166), with only 4% moving against the cycle.
 *
 * Which slot a given rider is on is now READ from the feed (`Pun_Shift`, 1/2/3), so nothing
 * here has to be guessed for any date the feed covers. These helpers project the cycle
 * FORWARD past that horizon — "where is this rider three weeks from now".
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
/* Anchor week: the Monday the cycle is measured from. Both 03-08 and 10-08 are Mondays in
   the feed and the observed transitions line up with them, so the phase is no longer a guess. */
export const ROTATION_ANCHOR = new Date(2026, 7, 3);   // Mon 03-08-2026

/* Which slot a rotation group is on in a given week.
   `group` is 0-based (group 0 starts on Day in the anchor week). */
export function rotationalSlotOn(group, date) {
  const i = (rotationIndex(date) + (group || 0)) % ROTATION_SLOTS.length;
  return ROTATION_SLOTS[i];
}
/* Where a rider currently on `slotId` will be in the week containing `date`, stepping one
   place every Monday. `from` defaults to now, so slotAfter("day") answers "and next week?".
   This is the dynamic part: it needs no group number and no stored phase — just the slot the
   feed says the rider is on today and how many Mondays separate the two dates. */
export function slotOn(slotId, date, from = new Date()) {
  const i = ROTATION_SLOTS.findIndex((s) => s.id === slotId);
  if (i < 0) return null;
  const n = ROTATION_SLOTS.length;
  const weeks = Math.round((weekStart(date) - weekStart(from)) / (7 * 86400e3));
  return ROTATION_SLOTS[(((i + weeks) % n) + n) % n];
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
export function serviceIdFor(unit, shift, slot) {
  const byUnit = SERVICES.find((s) => s.erpUnit && s.erpUnit === unit);
  if (byUnit) return byUnit.id;
  const byShift = SERVICES.filter((s) => s.erpShift && s.erpShift === shift);
  if (!byShift.length) return null;
  if (byShift.length === 1) return byShift[0].id;
  /* Several services share one ERP shift string — Rotational's three slots all read
     "ROTATIONAL SHIFT". The rider's punch slot (Pun_Shift: 1/2/3) picks which. A rider with
     no slot on record belongs to none of them rather than being dumped into the first. */
  const bySlot = byShift.find((s) => s.erpSlot && s.erpSlot === String(slot || "").trim());
  return bySlot ? bySlot.id : null;
}

/* `matrixUrl` = the road matrix this service is measured on. Zenwear's depot is 59 km
   south, so it has its own file; planning it against Batlagundu's matrix would find none
   of its stops in the index and quietly fall back to straight-line estimates. */
export const BATLAGUNDU_MATRIX = "/road_matrix.json";
export const ZENWEAR_MATRIX = "/road_matrix_zenwear.json";

export const SERVICES = [
  { id: "s9",    name: "9 am General", color: "#2186eb", gate: 9 * 60, erpShift: "GENERAL SHIFT - 9", depot: FACTORY_DEPOT, matrixUrl: BATLAGUNDU_MATRIX, planUrl: "/finalised_plan.json" },   // Batlagundu only — Zenwear's 9 am riders belong to Zenwear
  { id: "s7",    name: "7 am Morning", color: "#d97706", gate: 7 * 60, erpShift: "MORNING SHIFT - 7", depot: FACTORY_DEPOT, matrixUrl: BATLAGUNDU_MATRIX, planUrl: "/plan_s7.json" },
  /* Rotational is THREE services, not one. It always ran three round-the-clock slots, but the
     ERP could not say who rode when, so it had to be planned as a single 786-rider block that
     needed ~3x the fleet and never solved. The feed now carries `Pun_Shift` per rider per day
     (1/2/3 = 06:00/14:00/22:00), so each slot is its own service with its own ~200 riders,
     gate time and plan. `erpSlot` is what splits them; `slot` ties back to ROTATION_SLOTS. */
  { id: "rot-day",  name: "Rotational · Day",        color: "#0d9488", gate: 6 * 60,  erpShift: "ROTATIONAL SHIFT", erpSlot: "1", slot: "day",  depot: FACTORY_DEPOT, matrixUrl: BATLAGUNDU_MATRIX, planUrl: "/plan_rot-day.json" },
  { id: "rot-half", name: "Rotational · Half night", color: "#7c5cd6", gate: 14 * 60, erpShift: "ROTATIONAL SHIFT", erpSlot: "2", slot: "half", depot: FACTORY_DEPOT, matrixUrl: BATLAGUNDU_MATRIX, planUrl: "/plan_rot-half.json" },
  { id: "rot-full", name: "Rotational · Full night", color: "#4338ca", gate: 22 * 60, erpShift: "ROTATIONAL SHIFT", erpSlot: "3", slot: "full", depot: FACTORY_DEPOT, matrixUrl: BATLAGUNDU_MATRIX, planUrl: "/plan_rot-full.json" },
  { id: "zen",   name: "Zenwear",      color: "#be1250", gate: 9 * 60, erpShift: null, erpUnit: "Zenwear", depot: ZENWEAR_DEPOT, matrixUrl: ZENWEAR_MATRIX, branch: true, planUrl: "/plan_zen.json" },
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
