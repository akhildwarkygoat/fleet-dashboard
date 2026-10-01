/* planRuns tests — run with:  node src/planRuns.test.js
 *
 * The properties that matter: a bus's planned day is every run it makes, added up (km, and a
 * hired van's fee run by run); a week with no run for the bus falls back to nothing, not to
 * another week's plan; and each week can be costed on a different plan (the rotation). */
import { addPlanRuns, planDayOf, loadPlanWeeks } from "./planRuns.js";
import { kmOn, planOn, variableCost } from "./dailyCost.js";

let pass = 0, fail = 0;
const ok = (cond, label, detail = "") => {
  if (cond) { pass++; } else { fail++; console.log(`  FAIL: ${label}${detail ? " — " + detail : ""}`); }
};

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
  ok(own && Math.abs(own.km - 79) < 1e-9 && own.runs.length === 2 && own.cost === null, "owned bus: both runs' km add up, no hire");
  ok(own.runs[0].service === "s9" && own.runs[0].stops.length === 2, "the first run is the first service's, with its stops");
  ok(hired.cost === 3600 && hired.type === "rent", "hired van: paid per run, so the hire adds up");
  ok(planDayOf(own).km === 79 && planDayOf(undefined) === null, "planDayOf rounds km to one decimal, and says null for no runs");
}

/* ---- per-week fallback: each day on its own week's plan ---- */
{
  const bus = { id: "TN57BR3434", planKm: 48.9, planWeeks: { "2026-09-28": { km: 79, cost: null, type: "own" }, "2026-10-05": null } };
  ok(planOn(bus, "2026-09-30").km === 79, "a loaded week: the runs added up");
  ok(planOn(bus, "2026-10-07").km === 0, "a loaded week with no run: nothing, not another week's plan");
  ok(planOn(bus, "2026-08-03").km === 48.9, "a week not loaded: the bus's own plan km");
  const d = kmOn(bus, "2026-09-30", null, "2026-10-01");
  ok(d.source === "plan" && d.km === 79 && d.planKm === 79, "no GPS: the day's km is every planned run");
  const hiredBus = { id: "TN41S5818", planType: "rent", planWeeks: { "2026-09-28": { km: 118.6, cost: 3600, type: "rent" } } };
  const cost = variableCost(hiredBus, kmOn(hiredBus, "2026-09-29", null, "2026-10-01"), null, null);
  ok(cost.hired && cost.byKm.amount === 3600, "hired, plan day: the hire of every run");
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
