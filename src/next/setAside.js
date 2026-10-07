/* Buses the Live page sets aside instead of grading (Akhil, 07-10-2026). Two kinds:

     yet   Yet to run. Today's figures are still coming in: a quarter or more of the bus's riders
           start a shift later today (rotational 06:00, 14:00 and 22:00), so their absence is not
           an absence yet. Graded Bad at 10 am, the rotational vans read 0% and confused people.
           The card shows the bus's last full day instead, and when it next runs.
     erp   Riders missing in ERP. The plans in force put at least twice as many riders on the bus
           as the ERP lists, and the ERP lists under a quarter of its seats: 54-seat buses carrying
           one employee in the ERP read 2% while the plan runs them with 50 to 66 riders.

   Neither is graded Good, Watch or Bad, and neither counts towards seats filled at the top. */

// the ERP's start time for each rotational slot (Pun_Shift), and the weekly step Day -> Full -> Half -> Day
const SLOT_START = { 1: "06:00", 2: "14:00", 3: "22:00" };
const NEXT_SLOT = { 1: "3", 3: "2", 2: "1" };
const DAY_MS = 864e5;

const utc = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
/** Mondays passed between two ISO dates, so a rider last punched in an earlier week can be stepped on. */
function mondaysBetween(from, to) {
  const monday = (t) => t - ((new Date(t).getUTCDay() + 6) % 7) * DAY_MS;
  return Math.max(0, Math.round((monday(utc(to)) - monday(utc(from))) / (7 * DAY_MS)));
}

/** When a rider's shift starts today ("14:00"), or null when the ERP gives no clue. */
export function startToday(e, today) {
  const s = e.start;
  if (s && SLOT_START[s.slot]) {
    const weeks = mondaysBetween(s.date, today);
    if (!weeks) return s.time;
    let slot = s.slot;
    // the riders who never rotate keep their slot (erp.js NON_ROTATING)
    if (!e.fixedShift) for (let i = 0; i < weeks % 3; i++) slot = NEXT_SLOT[slot];
    return SLOT_START[slot];
  }
  if (s) return s.time; // general and morning shifts do not rotate
  const m = /SHIFT - (\d{1,2})\b/.exec(e.shift || "");
  return m ? m[1].padStart(2, "0") + ":00" : null;
}

const planRiders = (bus) => (bus.planRuns || []).reduce((n, r) => n + (+r.riders || 0), 0);

/**
 * Why a bus is set aside today, or null when it is graded as usual.
 * riders: the bus's riders in the ERP; present: today's attendance { Empl_no: "P" | "A" };
 * now: "HH:MM". Only today can be yet to run: an earlier day is over.
 */
export function setAsideOf({ bus, date, riders, present, today, now }) {
  const plan = planRiders(bus);
  if (plan >= 2 * riders.length && riders.length * 4 < (bus.capacity || plan)) return { kind: "erp", plan, erp: riders.length };
  if (date !== today) return null;
  let pending = 0, next = null;
  for (const e of riders) {
    if (present && present[e.id] === "P") continue;
    const t = startToday(e, today);
    if (t && t > now) { pending++; if (!next || t < next) next = t; }
  }
  return pending && pending * 4 >= riders.length ? { kind: "yet", next, pending } : null;
}

export const ASIDE = {
  yet: { label: "Yet to run", tone: "nova" },
  erp: { label: "Riders missing in ERP", tone: "neutral" },
};
