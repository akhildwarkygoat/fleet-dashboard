/* attendanceHistory tests — run with:  node src/attendanceHistory.test.js
 *
 * The properties that matter: a day packs and unpacks to exactly the punches it held; a day the
 * feed has dropped is still there after the next sync; a later pull of the same day replaces it;
 * a rider who joins later does not disturb a day packed before; a rider who has left comes back
 * with their last bus for the costs; the history stays small and stops at KEEP_DAYS. */
import { packDay, unpackDay, addToHistory, historyDays, formerRiders, historyStart, readHistory, emptyHistory, KEEP_DAYS } from "./attendanceHistory.js";

let pass = 0, fail = 0;
const ok = (cond, label, detail = "") => {
  if (cond) { pass++; } else { fail++; console.log(`  FAIL: ${label}${detail ? " — " + detail : ""}`); }
};
const same = (a, b) => JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());
const emp = (id, busId, shift = "GENERAL SHIFT - 9", unit = "Gainup", slot = "") => ({ id, busId, shift, unit, slot });

/* ---- pack and unpack ---- */
{
  const ids = ["E1", "E2", "E3", "E4", "E5"], index = new Map(ids.map((id, i) => [id, i]));
  const day = { E1: "P", E2: "A", E4: "P", E5: "A" };            // E3 has no row that day
  ok(same(unpackDay(packDay(day, index), ids), day), "a day comes back exactly, a missing row stays missing");
  ok(same(unpackDay(packDay({}, index), ids), {}), "an empty day is empty");
}

/* ---- the feed moves on; the old days stay ---- */
{
  const emps = [emp("E1", "TN1"), emp("E2", "TN1"), emp("E3", "TN2")];
  let h = addToHistory(null, { "2026-09-26": { E1: "P", E2: "A", E3: "P" }, "2026-09-27": { E1: "A", E2: "A", E3: "A" } }, emps);
  // next pull: the 26th has dropped out of the feed, the 27th was re-sent complete
  const feed = { "2026-09-27": { E1: "P", E2: "A", E3: "A" }, "2026-09-28": { E1: "P", E2: "P", E3: "P" } };
  h = addToHistory(h, feed, emps);
  ok(Object.keys(h.days).sort().join() === "2026-09-26,2026-09-27,2026-09-28", "every day kept", Object.keys(h.days).join());
  const old = historyDays(h, feed);
  ok(Object.keys(old).join() === "2026-09-26", "only the days the feed no longer carries come back from the history");
  ok(same(old["2026-09-26"], { E1: "P", E2: "A", E3: "P" }), "a dropped day reads as it was");
  ok(same(historyDays(h, {})["2026-09-27"], { E1: "P", E2: "A", E3: "A" }), "a later pull of a day replaces it");
  ok(historyStart(h) === "2026-09-26", "the first day on record");
  ok(JSON.stringify(readHistory(JSON.parse(JSON.stringify(h)))) === JSON.stringify(h), "survives a save and a load");
}

/* ---- riders join and leave ---- */
{
  const before = [emp("E1", "TN1"), emp("E2", "TN1")];
  let h = addToHistory(null, { "2026-09-01": { E1: "P", E2: "P" } }, before);
  // E2 has left, E3 has joined
  const after = [emp("E1", "TN1"), emp("E3", "TN2", "ROTATIONAL SHIFT", "Technotek", "2")];
  h = addToHistory(h, { "2026-10-01": { E1: "P", E3: "P" } }, after);
  ok(same(historyDays(h, {})["2026-09-01"], { E1: "P", E2: "P" }), "a day packed before a rider joined is unchanged");
  const gone = formerRiders(h, after);
  ok(gone.length === 1 && gone[0].id === "E2" && gone[0].busId === "TN1" && gone[0].former, "a rider who left comes back with their last bus", JSON.stringify(gone));
  ok(formerRiders(h, after).every((e) => e.id !== "E3"), "a current rider is not a former one");
  const e3 = h.people.E3, names = h.names;
  ok(names.shifts[e3[1]] === "ROTATIONAL SHIFT" && names.units[e3[2]] === "Technotek" && e3[3] === "2", "shift, unit and slot kept");
}

/* ---- small, and bounded ---- */
{
  const n = 4500, emps = Array.from({ length: n }, (_, i) => emp("E" + i, "TN" + (i % 110)));
  const day = Object.fromEntries(emps.map((e, i) => [e.id, i % 5 ? "P" : "A"]));
  const h = addToHistory(null, { "2026-10-01": day }, emps);
  ok(h.days["2026-10-01"].length < 1600, "a 4,500-rider day packs under 1.6 KB", `${h.days["2026-10-01"].length}`);
  const many = {};
  const start = new Date(Date.UTC(2024, 0, 1));
  for (let i = 0; i < KEEP_DAYS + 10; i++) many[new Date(start.getTime() + i * 864e5).toISOString().slice(0, 10)] = { E1: "P" };
  const big = addToHistory(emptyHistory(), many, [emp("E1", "TN1")]);
  ok(Object.keys(big.days).length === KEEP_DAYS && historyStart(big) === "2024-01-11", "the oldest days drop off past KEEP_DAYS", historyStart(big));
}

/* ---- anything unreadable starts empty ---- */
ok(readHistory({ v: 0 }).ids.length === 0 && readHistory(undefined).ids.length === 0, "an old or missing history starts empty");

console.log(`attendanceHistory tests: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
