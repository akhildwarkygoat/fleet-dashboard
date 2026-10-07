/* setAside tests — run with:  node src/next/setAside.test.js
 *
 * The properties that matter: a rider's shift today comes from their newest punch, stepped one slot
 * per Monday (Day -> Full -> Half -> Day) unless they never rotate; a bus is yet to run only today,
 * and only when a quarter or more of its riders start later; a bus the plan fills but the ERP barely
 * lists is set aside as riders missing in the ERP, on any day. */
import { setAsideOf, startToday } from "./setAside.js";

let pass = 0, fail = 0;
const ok = (cond, label, detail = "") => {
  if (cond) { pass++; } else { fail++; console.log(`  FAIL: ${label}${detail ? " — " + detail : ""}`); }
};

const TODAY = "2026-10-07"; // a Wednesday; its rota week began Monday 05-10
const rot = (id, slot, date = "2026-10-06", extra = {}) =>
  ({ id, shift: "ROTATIONAL SHIFT", start: { date, time: { 1: "06:00", 2: "14:00", 3: "22:00" }[slot], slot: String(slot) }, ...extra });
const gen = (id) => ({ id, shift: "GENERAL SHIFT - 9", start: { date: "2026-10-06", time: "09:00", slot: "GS" } });

{
  ok(startToday(rot("a", 2), TODAY) === "14:00", "punched this week: that slot");
  ok(startToday(rot("a", 1, "2026-10-02"), TODAY) === "22:00", "Day last week steps to Full night");
  ok(startToday(rot("a", 3, "2026-10-02"), TODAY) === "14:00", "Full night last week steps to Half night");
  ok(startToday(rot("a", 2, "2026-10-02"), TODAY) === "06:00", "Half night last week steps to Day");
  ok(startToday(rot("a", 1, "2026-10-02", { fixedShift: true }), TODAY) === "06:00", "a rider who never rotates is held");
  ok(startToday(gen("a"), TODAY) === "09:00", "a general shift keeps its time");
  ok(startToday({ id: "a", shift: "MORNING SHIFT - 7" }, TODAY) === "07:00", "no punch: the shift's name");
  ok(startToday({ id: "a", shift: "ROTATIONAL SHIFT" }, TODAY) === null, "no punch on rotational: unknown");
}

{
  const bus = { id: "V1", capacity: 20 };
  const riders = [rot("a", 2), rot("b", 2), rot("c", 1), rot("d", 1)];
  const present = { c: "P", d: "A" };
  const yet = setAsideOf({ bus, date: TODAY, riders, present, today: TODAY, now: "10:50" });
  ok(yet && yet.kind === "yet" && yet.next === "14:00" && yet.pending === 2, "half the riders start at 14:00: yet to run", JSON.stringify(yet));
  ok(setAsideOf({ bus, date: TODAY, riders, present, today: TODAY, now: "14:05" }) === null, "once the last shift has started it is graded");
  ok(setAsideOf({ bus, date: "2026-10-06", riders, present, today: TODAY, now: "10:50" }) === null, "an earlier day is never yet to run");
  const mostly = [...Array(9)].map((_, i) => gen("g" + i)).concat(rot("z", 2));
  ok(setAsideOf({ bus, date: TODAY, riders: mostly, present: {}, today: TODAY, now: "10:50" }) === null, "one late rider in ten does not set a bus aside");
  ok(setAsideOf({ bus, date: TODAY, riders: [rot("a", 2)], present: { a: "P" }, today: TODAY, now: "10:50" }) === null, "a rider already in is not pending");
}

{
  const bus = { id: "TN57BR3434", capacity: 54, planRuns: [{ riders: 66 }] };
  const erp = setAsideOf({ bus, date: "2026-10-06", riders: [gen("a")], present: {}, today: TODAY, now: "10:50" });
  ok(erp && erp.kind === "erp" && erp.plan === 66 && erp.erp === 1, "plan 66, ERP 1: riders missing in ERP", JSON.stringify(erp));
  const full = [...Array(40)].map((_, i) => gen("g" + i));
  ok(setAsideOf({ bus, date: "2026-10-06", riders: full, present: {}, today: TODAY, now: "10:50" }) === null, "an ERP list near the plan is graded");
  ok(setAsideOf({ bus: { id: "X", capacity: 20 }, date: "2026-10-06", riders: [gen("a")], present: {}, today: TODAY, now: "10:50" }) === null, "no plan: graded as the ERP says");
}

console.log(`setAside tests: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
