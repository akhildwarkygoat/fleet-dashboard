/* planRuns tests — run with:  node src/planRuns.test.js
 *
 * The properties that matter: a bus's planned day is every run it makes, added up (km only: a hired
 * van is paid one day tariff on the day's total km, never a fee per run); each run keeps its service,
 * so a day counts only the runs whose service ran; a week with no run for the bus falls back to
 * nothing, not to another week's plan; each week can be costed on a different plan (the rotation);
 * and a vehicle only the plans name is still costed. */
import { addPlanRuns, planDayOf, loadPlanWeeks, planOnlyBuses } from "./planRuns.js";
import { kmOn, planOn, variableCost } from "./dailyCost.js";
import { rentTariff } from "./optimiser/engine.js";

let pass = 0, fail = 0;
const ok = (cond, label, detail = "") => {
  if (cond) { pass++; } else { fail++; console.log(`  FAIL: ${label}${detail ? " — " + detail : ""}`); }
};
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

const nine = { routes: [
  { name: "TN57 BR 3434", type: "own", km: 48.9, riders: 66, ride: 46, seq: [{ name: "A" }, { name: "B" }] },
  { name: "TN41S5818", type: "rent", km: 98.6, cost: 1900, riders: 22, ride: 65, seq: [{ name: "C" }] },
] };
const rotA = { routes: [
  { name: "TN57BR3434", type: "own", km: 30.1, riders: 40, ride: 35, seq: [{ name: "D" }] },
  { name: "TN41S5818", type: "rent", km: 20, cost: 1700, riders: 18, ride: 25, seq: [] },
] };
const rotB = { routes: [{ name: "TN99ZZ0001", type: "own", km: 12, riders: 9, ride: 15, seq: [] }] };

/* ---- runs add up per vehicle ---- */
{
  const day = addPlanRuns(addPlanRuns(new Map(), nine, "s9"), rotA, "rot-day");
  const own = day.get("TN57BR3434"), hired = day.get("TN41S5818");
  ok(own && near(own.km, 79) && own.runs.length === 2 && !("cost" in own), "owned bus: both runs' km add up, no fee");
  ok(own.runs[0].service === "s9" && own.runs[0].stops.length === 2, "the first run is the first service's, with its stops");
  ok(near(hired.km, 118.6) && hired.type === "rent" && !("cost" in hired), "hired van: its km adds up, no per-run fee");
  const p = planDayOf(own);
  ok(p.km === 79 && planDayOf(undefined) === null, "planDayOf rounds km to one decimal, and says null for no runs");
  ok(p.runs.map((r) => `${r.service}:${r.km}:${r.riders}`).join() === "s9:48.9:66,rot-day:30.1:40", "planDayOf keeps each run's service, km and riders");
}

/* ---- per-week fallback: each day on its own week's plan ---- */
{
  const bus = { id: "TN57BR3434", planKm: 48.9, planWeeks: { "2026-09-28": { km: 79, type: "own" }, "2026-10-05": null } };
  ok(planOn(bus, "2026-09-30").km === 79, "a loaded week: the runs added up");
  ok(planOn(bus, "2026-10-07").km === 0, "a loaded week with no run: nothing, not another week's plan");
  ok(planOn(bus, "2026-08-03").km === 48.9, "a week not loaded: the bus's own plan km");
  const d = kmOn(bus, "2026-09-30", null, "2026-10-01");
  ok(d.source === "plan" && d.km === 79 && d.planKm === 79, "no GPS: the day's km is every planned run");
  // two runs, 149.6 + 38.7 km: one tariff on 188.3 km, not ₹2,798 + ₹1,700
  const hiredBus = { id: "TN18D8500", type: "Rental", planWeeks: { "2026-09-28": { km: 188.3, type: "rent",
    runs: [{ service: "rot-day", km: 149.6 }, { service: "s9", km: 38.7 }] } } };
  const cost = variableCost(hiredBus, kmOn(hiredBus, "2026-09-29", null, "2026-10-01"), null, null);
  ok(cost.hired && near(cost.byKm.amount, rentTariff(188.3)) && near(cost.byKm.amount, 3521.21), "hired, plan day: one day tariff on the day's total km", String(cost.byKm.amount));
}

/* ---- a run counts only on a day its service ran ---- */
{
  const runs = [{ service: "s9", km: 48.9 }, { service: "rot-day", km: 30.1 }, { service: "rot-full", km: 20 }];
  const bus = { id: "TN57BR3434", planWeeks: { "2026-09-28": { km: 99, type: "own", runs } } };
  const sundayOnlyRot = (svc, date) => date !== "2026-10-04" || svc.startsWith("rot-");
  const sun = planOn(bus, "2026-10-04", sundayOnlyRot);
  ok(near(sun.km, 50.1) && sun.runs.length === 2 && sun.skipped === 1, "Sunday: only the Rotational runs count, one skipped", JSON.stringify(sun));
  ok(planOn(bus, "2026-10-01", sundayOnlyRot) === bus.planWeeks["2026-09-28"], "a day every service ran: the plan as it is");
  const none = planOn(bus, "2026-10-04", () => false);
  ok(none.km === 0 && none.runs.length === 0 && none.skipped === 3, "no service ran: no km, every run skipped");
  ok(kmOn(bus, "2026-10-04", null, null, () => false).source === null, "no service ran and no GPS: no km to price");
  ok(planOn({ id: "X", planKm: 40 }, "2026-10-04", () => false).km === 40, "a plan without runs on record is not judged");
}

/* ---- a vehicle only the plans name is still costed ---- */
{
  const weeks = { "2026-09-28": addPlanRuns(new Map(), { routes: [
    { name: "TN57BM3636", type: "own", km: 51.5, riders: 44 }, { name: "TN57 BR 3434", type: "own", km: 48.9 }] }, "s9") };
  const extra = planOnlyBuses([{ id: "TN57BR3434" }], weeks, { TN57BM3636: { lines: [] } });
  ok(extra.length === 1 && extra[0].id === "TN57BM3636" && extra[0].planOnly && extra[0].unit === "", "a planned bus the punch feed lacks is added, with no company", JSON.stringify(extra));
  const spaced = planOnlyBuses([], weeks, { "TN57 BM 3636": { lines: [] } });
  ok(spaced.some((b) => b.id === "TN57 BM 3636"), "it takes the costing feed's spelling, so its ERP costs join");
  ok(planOnlyBuses([], null, {}).length === 0, "no plans loaded: nothing added");
}

/* ---- loading: rotation weeks read different files, each file fetched once ---- */
{
  const files = { "/nine.json": nine, "/rot-a.json": rotA, "/rot-b.json": rotB };
  let fetched = 0;
  const fetchJson = async (url) => { fetched++; return files[url] || null; };
  const services = [{ id: "s9" }, { id: "rot-day", slot: "day" }];
  const sourceFor = (svc, week) => (svc.slot ? { file: week === "2026-09-28" ? "/rot-a.json" : "/rot-b.json" } : { file: "/nine.json" });
  const weeks = await loadPlanWeeks(["2026-09-28", "2026-10-05"], services, sourceFor, fetchJson);
  ok(weeks["2026-09-28"].get("TN57BR3434").km === 79, "week 1: 9 am + its rotation group plan");
  ok(weeks["2026-10-05"].get("TN57BR3434").km === 48.9 && weeks["2026-10-05"].has("TN99ZZ0001"), "week 2: the next group plan");
  ok(fetched === 3, "each plan file is fetched once however many weeks use it", `fetched ${fetched}`);
  const drafted = await loadPlanWeeks(["2026-09-28"], [{ id: "s9" }], () => ({ body: rotB }), fetchJson);
  ok(drafted["2026-09-28"].has("TN99ZZ0001"), "a finalised draft's body is used as it is");
}

console.log(`planRuns tests: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
