/* tiGps tests — run with:  node src/optimiser/tiGps.test.js
 *
 * The properties that matter: a journey lands on the run it belongs to (a pickup by its arrival at
 * the gate, a drop by its departure), one journey per run, nearest first; a bus doing several runs
 * gets each journey on the right one; a journey near no run is left over, not forced; and a GPS
 * pickup is compared at the gate only, because it starts from parking. */
import { matchJourneys, journeyGap, patchFor, minOfDay, MATCH_WINDOW_MIN } from "./tiGps.js";
import { variance, SOURCE } from "./trackImpl.js";

let pass = 0, fail = 0;
const ok = (cond, label, detail = "") => {
  if (cond) { pass++; } else { fail++; console.log(`  FAIL: ${label}${detail ? " — " + detail : ""}`); }
};
const at = (hh, mm, day = 1) => new Date(2026, 9, day, hh, mm).getTime();   // local time, 1 Oct 2026
const run = (dir, start, end, extra = {}) => ({ dir, start, end, ride: (end - start + 1440) % 1440, svcId: "s", veh: "TN1", ...extra });

/* ---- pickup by its gate arrival, drop by its departure ---- */
{
  const pick = run("pickup", 8 * 60, 9 * 60), drop = run("drop", 17 * 60, 18 * 60);
  const jPick = { id: "a", startedAt: at(7, 20), endedAt: at(9, 6) };      // left parking 07:20, gate 09:06
  ok(journeyGap(jPick, pick) === 6, "a pickup is measured at the gate", `${journeyGap(jPick, pick)}`);
  const jDrop = { id: "b", startedAt: at(17, 10), endedAt: at(18, 30) };
  ok(journeyGap(jDrop, drop) === 10, "a drop is measured at its departure");
  const m = matchJourneys([pick, drop], [jDrop, jPick]);
  ok(m.matched.length === 2 && m.matched.find((x) => x.journey.id === "a").run === pick, "each journey on its own run");
  ok(m.unmatched.length === 0, "nothing left over");
}

/* ---- a bus on five runs: each journey to the nearest, one each ---- */
{
  const runs = [run("pickup", 7 * 60, 9 * 60), run("pickup", 5 * 60, 7 * 60), run("drop", 14 * 60, 15 * 60),
                run("pickup", 12 * 60, 14 * 60), run("drop", 22 * 60, 23 * 60)];
  const js = [
    { id: "1", startedAt: at(4, 30), endedAt: at(7, 2) },
    { id: "2", startedAt: at(6, 40), endedAt: at(8, 58) },
    { id: "3", startedAt: at(11, 30), endedAt: at(14, 5) },
    { id: "4", startedAt: at(14, 3), endedAt: at(15, 10) },
    { id: "5", startedAt: at(22, 1), endedAt: at(23, 20) },
  ];
  const m = matchJourneys(runs, js);
  const of = (id) => m.matched.find((x) => x.journey.id === id).run;
  ok(m.matched.length === 5 && of("1") === runs[1] && of("2") === runs[0] && of("3") === runs[3] && of("4") === runs[2] && of("5") === runs[4],
    "five journeys, five runs, each the nearest");
}

/* ---- two journeys near one run: the nearer takes it, the other is an extra trip ---- */
{
  const r = run("pickup", 8 * 60, 9 * 60);
  const m = matchJourneys([r], [{ id: "far", startedAt: at(7, 0), endedAt: at(9, 40) }, { id: "near", startedAt: at(7, 30), endedAt: at(9, 2) }]);
  ok(m.matched.length === 1 && m.matched[0].journey.id === "near" && m.unmatched[0].id === "far", "the nearer journey wins, the other is left over");
  const lone = matchJourneys([r], [{ id: "x", startedAt: at(13, 0), endedAt: at(14, 0) }]);
  ok(lone.matched.length === 0 && lone.unmatched.length === 1, `nothing within ${MATCH_WINDOW_MIN} min: an extra trip, not forced`);
}

/* ---- across midnight: a night drop planned 06:00, journey at 05:55 ---- */
{
  const r = run("drop", 6 * 60, 7 * 60);
  ok(journeyGap({ startedAt: at(5, 55, 2), endedAt: at(7, 0, 2) }, r) === 5, "clock distance, not calendar");
  const late = run("pickup", 21 * 60 + 30, 22 * 60);
  ok(journeyGap({ startedAt: at(21, 0), endedAt: at(0, 10, 2) }, late) === 130, "a pickup arriving after midnight is 2 h 10 min late, not 21 h");
}

/* ---- a live journey: start now, end later ---- */
{
  const p = patchFor({ id: "j", startedAt: at(7, 15), endedAt: null, km: 12.5 });
  ok(p.actualStart === 435 && p.actualEnd === null && p.live === true && p.source === SOURCE.TRACKER, "a journey still out: start only, marked live");
  ok(minOfDay(at(23, 59)) === 1439, "minutes past midnight");
}

/* ---- a GPS pickup is compared at the gate only ---- */
{
  const planned = { start: 8 * 60, end: 9 * 60, ride: 60 };
  const gps = variance({ dir: "pickup", source: SOURCE.TRACKER, status: "ran", actualStart: 7 * 60 + 20, actualEnd: 9 * 60 + 6, planned });
  ok(gps.endVar === 6 && gps.startVar === null && gps.rideVar === null && gps.actualRide === 106, "GPS pickup: late at the gate, start and length not compared");
  const drop = variance({ dir: "drop", source: SOURCE.TRACKER, status: "ran", actualStart: 17 * 60 + 10, actualEnd: 18 * 60 + 30, planned: { start: 17 * 60, end: 18 * 60, ride: 60 } });
  ok(drop.startVar === 10 && drop.rideVar === 20, "GPS drop: departure and length both compared");
}

console.log(`tiGps tests: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
