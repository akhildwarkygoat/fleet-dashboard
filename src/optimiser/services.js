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
 * `off` is when the shift RELEASES — the moment the drop run leaves the gate. It
 * matters as much as `gate` now that buses can be parked out and linked between
 * services: the gap a bus waits through is `next gate − this off`, so a wrong
 * `off` moves every layover. Only the three Rotational slots have a measured one
 * (ROTATION_SLOTS, confirmed in the punch feed). Where it is null the layover
 * model falls back to an 8-hour shift and FLAGS every saving that depended on the
 * assumption, so an estimate never reads as a measurement.
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
 * Three round-the-clock slots. On the floor these rotate: a rider steps one place along
 *     Day → Full night → Half night → Day
 * every Monday. That cycle is real — it is visible in the punch feed, where the three
 * commonest week-to-week moves are exactly those three.
 *
 * The dashboard deliberately does NOT follow it. Membership is FROZEN to the roster in
 * src/rotationalRoster.json (see the note there and in erp.js). Tracking the rotation live
 * meant re-cutting the three services every Monday against plans that stayed put, and filing
 * anyone who had not yet punched this week one slot behind. A plan is only worth costing if
 * the riders in it are the riders it was built for, so roster and plan are frozen together
 * and re-cut together.
 *
 * These entries therefore describe the three slots as PLANNING BUCKETS — a name, a colour and
 * the window each one runs — not where any given rider is this week. Nothing here computes a
 * rider's slot from the calendar; that is exactly what was removed.
 */
export const ROTATION_SLOTS = [
  { id: "day",   name: "Day",        from: 6 * 60,  to: 14 * 60, color: "#0d9488" },
  { id: "full",  name: "Full night", from: 22 * 60, to: 30 * 60, color: "#4338ca" },  // 22:00 → 06:00 next day
  { id: "half",  name: "Half night", from: 14 * 60, to: 22 * 60, color: "#7c5cd6" },
];

/* Monday of the week `date` falls in (local). Used to label a week, not to step the rota. */
export function weekStart(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));   // getDay: Sun=0 → Monday-based
  return d;
}

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
     "ROTATIONAL SHIFT". The rider's slot (1/2/3, from the frozen roster) picks which. A rider
     with no slot on record belongs to none of them rather than being dumped into the first. */
  const bySlot = byShift.find((s) => s.erpSlot && s.erpSlot === String(slot || "").trim());
  return bySlot ? bySlot.id : null;
}

/* `matrixUrl` = the road matrix this service is measured on. Zenwear's depot is 59 km
   south, so it has its own file; planning it against Batlagundu's matrix would find none
   of its stops in the index and quietly fall back to straight-line estimates. */
export const BATLAGUNDU_MATRIX = "/road_matrix.json";
export const ZENWEAR_MATRIX = "/road_matrix_zenwear.json";

export const SERVICES = [
  /* `off: null` on the three fixed-hour services is deliberate and not a placeholder to
     fill in with a guess — the factory has given us gate times and never release times.
     The layover model assumes 8 h for these and marks the result "assumed"; ask the
     transport manager for the real figure and the assumption disappears. */
  { id: "s9",    name: "9 am General", color: "#2186eb", gate: 9 * 60, off: null, erpShift: "GENERAL SHIFT - 9", depot: FACTORY_DEPOT, matrixUrl: BATLAGUNDU_MATRIX, planUrl: "/finalised_plan.json" },   // Batlagundu only — Zenwear's 9 am riders belong to Zenwear
  { id: "s7",    name: "7 am Morning", color: "#d97706", gate: 7 * 60, off: null, erpShift: "MORNING SHIFT - 7", depot: FACTORY_DEPOT, matrixUrl: BATLAGUNDU_MATRIX, planUrl: "/plan_s7.json" },
  /* Rotational is THREE services, not one. It always ran three round-the-clock slots, but the
     ERP could not say who rode when, so it had to be planned as a single 786-rider block that
     needed ~3x the fleet and never solved. `Pun_Shift` (1/2/3 = 06:00/14:00/22:00) gave the
     missing split, and it is now held frozen in src/rotationalRoster.json so each slot keeps
     the ~250 riders its plan was built for instead of being re-cut every Monday.
     `erpSlot` is what splits them; `slot` ties back to ROTATION_SLOTS. */
  /* `off` here IS measured: the three slots tile the 24 hours end to end, so Day releases
     exactly when Half night gates. That is what makes a Day drop and a Full-night pickup
     in the same village a linkable pair rather than a guess. */
  { id: "rot-day",  name: "Rotational · Day",        color: "#0d9488", gate: 6 * 60,  off: 14 * 60, erpShift: "ROTATIONAL SHIFT", erpSlot: "1", slot: "day",  depot: FACTORY_DEPOT, matrixUrl: BATLAGUNDU_MATRIX, planUrl: "/plan_rot-day.json" },
  { id: "rot-half", name: "Rotational · Half night", color: "#7c5cd6", gate: 14 * 60, off: 22 * 60, erpShift: "ROTATIONAL SHIFT", erpSlot: "2", slot: "half", depot: FACTORY_DEPOT, matrixUrl: BATLAGUNDU_MATRIX, planUrl: "/plan_rot-half.json" },
  { id: "rot-full", name: "Rotational · Full night", color: "#4338ca", gate: 22 * 60, off: 6 * 60,  erpShift: "ROTATIONAL SHIFT", erpSlot: "3", slot: "full", depot: FACTORY_DEPOT, matrixUrl: BATLAGUNDU_MATRIX, planUrl: "/plan_rot-full.json" },
  { id: "zen",   name: "Zenwear",      color: "#be1250", gate: 9 * 60, off: null, erpShift: null, erpUnit: "Zenwear", depot: ZENWEAR_DEPOT, matrixUrl: ZENWEAR_MATRIX, branch: true, planUrl: "/plan_zen.json" },
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
