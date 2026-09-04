/* ============================================================================
 * rotation.test.js — the rotation table is a contract with the floor.  Run:  npm test
 * ----------------------------------------------------------------------------
 * Pure-node test (no DOM). The ground-truth table below was verified against the ERP
 * feed on 2026-09-04: week of 2026-08-31 has Group 1 on Day, 2 on Half night, 3 on Full
 * night, and every Monday each group steps Day → Full night → Half night → Day. If any
 * of these fail, the dashboard would serve a plan built for the wrong riders — fix
 * before shipping. Runs with the committed manifest AND a custom one passed as the
 * trailing argument, so a manifest edit and a code change are told apart.
 * ==========================================================================*/
import {
  ROTATION, mondayOf, weeksBetween, stepFor, slotOfGroup, groupOnSlot, rotationFor,
  planUrlFor, describeSlot, fmtWeek, upcoming, getRotaWeek, setRotaWeek, isRotaWeekPinned,
  subscribeRotaWeek,
} from "./rotation.js";

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.error("  ✗ " + msg); } };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/* ---- the committed manifest is the one the contract describes ---- */
ok(ROTATION.anchorWeek === "2026-08-31", "manifest anchorWeek is 2026-08-31");
ok(same(ROTATION.cycle, ["day", "full", "half"]), "manifest cycle is Day → Full night → Half night");
ok(same(Object.keys(ROTATION.groups).sort(), ["1", "2", "3"]), "manifest has groups 1, 2, 3");
for (const slot of ROTATION.cycle) {
  const at = Object.keys(ROTATION.groups).filter((g) => ROTATION.groups[g].atAnchor === slot);
  ok(at.length === 1, `exactly one group is on "${slot}" in the anchor week (found ${at.length})`);
}
for (const g of Object.keys(ROTATION.groups)) {
  for (const slot of ROTATION.cycle) {
    const p = ROTATION.groups[g].plans[slot];
    ok(p === `/plans/rot/g${g}-${slot}.json`, `group ${g} plan for ${slot} is /plans/rot/g${g}-${slot}.json (got ${p})`);
  }
}

/* ---- mondayOf: local-time Monday, formatted from local fields ---- */
ok(mondayOf("2026-08-31") === "2026-08-31", "a Monday is its own week start");
ok(mondayOf("2026-09-04") === "2026-08-31", "Thursday 4 Sep → Monday 31 Aug");
ok(mondayOf("2026-09-06") === "2026-08-31", "Sunday 6 Sep still belongs to the week of 31 Aug");
ok(mondayOf("2026-09-07") === "2026-09-07", "Monday 7 Sep starts the next week");
ok(mondayOf("2026-02-30") === null && mondayOf("2026-13-01") === null, "an impossible calendar date is rejected, not rolled over");
ok(mondayOf(0) === null && mondayOf(false) === null && mondayOf(null) === null, "0 / false / null are not dates");
ok(mondayOf(new Date("nonsense")) === null, "an invalid Date is not a date");
ok(mondayOf(new Date(2026, 8, 4, 23, 59)) === "2026-08-31", "accepts a Date; 23:59 local on 4 Sep is still 31 Aug's week");
ok(mondayOf(new Date(2026, 8, 7, 0, 0)) === "2026-09-07", "local midnight on Monday is that Monday (no UTC shift)");
ok(mondayOf("2026-01-01") === "2025-12-29", "week start can cross a year boundary");
ok(/^\d{4}-\d{2}-\d{2}$/.test(mondayOf(new Date())), "today's week start is YYYY-MM-DD");
ok(mondayOf("not a date") === null, "unparseable input → null, never a wrong week");

/* ---- weeksBetween ---- */
ok(weeksBetween("2026-08-31", "2026-09-07") === 1, "one week forward");
ok(weeksBetween("2026-08-31", "2026-08-24") === -1, "one week backward is −1");
ok(weeksBetween("2026-08-31", "2026-08-31") === 0, "same day is 0");
ok(weeksBetween("2026-08-31", "2026-09-21") === 3, "three weeks forward");
ok(weeksBetween("2026-08-31", "2026-06-08") === -12, "twelve weeks back");
ok(weeksBetween("2026-03-02", "2026-11-02") === 35, "245 days is 35 weeks whatever DST does in between");
ok(isNaN(weeksBetween("2026-08-31", "garbage")), "bad date → NaN");

/* ---- the ground-truth table ---- */
const TABLE = [
  ["2026-08-24", 2, { day: "3", full: "2", half: "1" }],   // the week before the anchor
  ["2026-08-31", 0, { day: "1", half: "2", full: "3" }],   // anchor: batch N = ERP slot code N
  ["2026-09-07", 1, { day: "2", full: "1", half: "3" }],
  ["2026-09-14", 2, { day: "3", full: "2", half: "1" }],
  ["2026-09-21", 0, { day: "1", half: "2", full: "3" }],   // and round again every three weeks
  ["2026-08-10", 0, { day: "1", half: "2", full: "3" }],   // three weeks before the anchor
  ["2026-10-12", 0, { day: "1", half: "2", full: "3" }],   // six weeks after
];
for (const [week, step, bySlot] of TABLE) {
  ok(stepFor(week) === step, `${week} is step ${step} (got ${stepFor(week)})`);
  for (const slot of Object.keys(bySlot)) {
    ok(groupOnSlot(slot, week) === bySlot[slot], `${week}: ${slot} = group ${bySlot[slot]} (got ${groupOnSlot(slot, week)})`);
    ok(slotOfGroup(bySlot[slot], week) === slot, `${week}: group ${bySlot[slot]} is on ${slot} (got ${slotOfGroup(bySlot[slot], week)})`);
  }
  const r = rotationFor(week);
  ok(r.week === week && r.step === step, `rotationFor(${week}) reports week and step`);
  ok(same(Object.keys(r.bySlot).sort(), ["day", "full", "half"]), `rotationFor(${week}).bySlot has the three slots`);
  ok(same(Object.keys(r.byGroup).sort(), ["1", "2", "3"]), `rotationFor(${week}).byGroup has the three groups`);
  for (const slot of Object.keys(bySlot)) ok(r.bySlot[slot] === bySlot[slot], `rotationFor(${week}).bySlot.${slot} = ${bySlot[slot]}`);
  for (const slot of Object.keys(bySlot)) ok(r.byGroup[bySlot[slot]] === slot, `rotationFor(${week}).byGroup is the inverse of bySlot`);
}

/* mid-week dates resolve to their Monday's rotation */
ok(stepFor("2026-09-04") === 0 && groupOnSlot("day", "2026-09-04") === "1", "Thursday 4 Sep uses the week of 31 Aug");
ok(stepFor("2026-09-06") === 0 && groupOnSlot("full", "2026-09-06") === "3", "Sunday 6 Sep still uses the week of 31 Aug");
ok(stepFor("2026-09-13") === 1 && groupOnSlot("day", "2026-09-13") === "2", "Sunday 13 Sep is still step 1");
ok(same(rotationFor("2026-09-10").bySlot, rotationFor("2026-09-07").bySlot), "rotationFor on a Thursday equals its Monday");
ok(groupOnSlot("day", "nonsense") === null && slotOfGroup("1", "nonsense") === null, "an unparseable week finds no group and no slot");
ok(groupOnSlot("night", "2026-08-31") === null, "an unknown slot has no group");
ok(slotOfGroup("9", "2026-08-31") === null, "an unknown group has no slot");
ok(slotOfGroup(1, "2026-08-31") === "day", "group id may be passed as a number");

/* ---- planUrlFor follows the manifest ---- */
ok(planUrlFor("day", "2026-08-31") === "/plans/rot/g1-day.json", "anchor week Day → g1-day");
ok(planUrlFor("half", "2026-08-31") === "/plans/rot/g2-half.json", "anchor week Half night → g2-half");
ok(planUrlFor("full", "2026-08-31") === "/plans/rot/g3-full.json", "anchor week Full night → g3-full");
ok(planUrlFor("half", "2026-09-07") === "/plans/rot/g3-half.json", "week of 7 Sep Half night → g3-half");
ok(planUrlFor("day", "2026-09-07") === "/plans/rot/g2-day.json", "week of 7 Sep Day → g2-day");
ok(planUrlFor("full", "2026-09-07") === "/plans/rot/g1-full.json", "week of 7 Sep Full night → g1-full");
ok(planUrlFor("full", "2026-09-14") === "/plans/rot/g2-full.json", "week of 14 Sep Full night → g2-full");
ok(planUrlFor("day", "2026-09-04") === "/plans/rot/g1-day.json", "a mid-week date gets its Monday's plan");
ok(planUrlFor("day", "2026-09-21") === planUrlFor("day", "2026-08-31"), "the same plan comes back three weeks later");
ok(planUrlFor("day", "nonsense") === null, "an unparseable week has no plan (caller falls back)");
ok(planUrlFor("night", "2026-08-31") === null, "an unknown slot has no plan");
/* every slot in every table week, asked from the Monday, the Thursday and the Sunday: a manifest
   edit that broke one group's plan path in one week would otherwise slip past the spot checks */
for (const [week, , bySlot] of TABLE) {
  const [y, mo, d] = week.split("-").map(Number);
  for (const offset of [0, 3, 6]) {
    const x = new Date(y, mo - 1, d + offset);
    const iso = `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
    for (const slot of ROTATION.cycle) {
      const want = `/plans/rot/g${bySlot[slot]}-${slot}.json`;
      ok(planUrlFor(slot, iso) === want, `${iso} (${week}+${offset}d) ${slot} → ${want} (got ${planUrlFor(slot, iso)})`);
    }
  }
}
for (const r of upcoming(6, "2026-08-31")) for (const slot of ROTATION.cycle) {
  ok(planUrlFor(slot, r.week) === `/plans/rot/g${r.bySlot[slot]}-${slot}.json`, `upcoming ${r.week} ${slot} plan matches its group`);
}
/* the retired Sep-2 files must never come out of the manifest */
for (const [week, , bySlot] of TABLE) for (const slot of Object.keys(bySlot)) {
  ok(!/plan_rot-.*finalised|plan_grp-/.test(planUrlFor(slot, week) || ""), `${week}/${slot} never points at a retired file`);
}

/* ---- labels ---- */
ok(fmtWeek("2026-09-07") === "week of 7 Sep", `fmtWeek 7 Sep (got "${fmtWeek("2026-09-07")}")`);
ok(fmtWeek("2026-08-31") === "week of 31 Aug", `fmtWeek 31 Aug (got "${fmtWeek("2026-08-31")}")`);
ok(fmtWeek("2026-01-05") === "week of 5 Jan", "fmtWeek in January");
ok(describeSlot("half", "2026-09-07") === "Group 3 · Half night · week of 7 Sep", `describeSlot half/7 Sep (got "${describeSlot("half", "2026-09-07")}")`);
ok(describeSlot("day", "2026-08-31") === "Group 1 · Day · week of 31 Aug", `describeSlot day/31 Aug (got "${describeSlot("day", "2026-08-31")}")`);
ok(describeSlot("full", "2026-09-14") === "Group 2 · Full night · week of 14 Sep", `describeSlot full/14 Sep (got "${describeSlot("full", "2026-09-14")}")`);
ok(describeSlot("day", "2026-09-10") === "Group 2 · Day · week of 7 Sep", "describeSlot on a Thursday names its Monday");

/* ---- upcoming ---- */
{
  const up = upcoming(3, "2026-08-31");
  ok(up.length === 3, "upcoming(3) returns three weeks");
  ok(same(up.map((r) => r.week), ["2026-08-31", "2026-09-07", "2026-09-14"]), "upcoming(3) is three consecutive Mondays");
  ok(same(up.map((r) => r.step), [0, 1, 2]), "upcoming(3) steps 0, 1, 2");
  ok(same(up.map((r) => r.bySlot.day), ["1", "2", "3"]), "Day is run by groups 1, 2, 3 in turn");
  const four = upcoming(4, "2026-09-03");
  ok(four[0].week === "2026-08-31" && four[3].week === "2026-09-21" && four[3].step === 0, "upcoming from a mid-week date starts at its Monday and wraps to step 0");
  ok(upcoming(0, "2026-08-31").length === 0, "upcoming(0) is empty");
  ok(upcoming(2).length === 2 && upcoming(2)[0].week === getRotaWeek(), "upcoming without a start begins at the current rota week");
}

/* ---- the pinned week under Node: no window, so no pin and nothing throws ---- */
ok(typeof window === "undefined", "this test runs without a DOM");
ok(getRotaWeek() === mondayOf(new Date()), "getRotaWeek() with no pin is this week's Monday");
ok(isRotaWeekPinned() === false, "nothing is pinned under Node");
{
  let threw = false;
  try { setRotaWeek("2026-09-07"); setRotaWeek(null); } catch { threw = true; }
  ok(!threw, "setRotaWeek does not throw without a window");
  ok(setRotaWeek("not-a-date") === false, "setRotaWeek refuses an unparseable week (returns false)");
  ok(setRotaWeek(null) === true && setRotaWeek("2026-09-07") === true, "setRotaWeek returns true for null and a valid week");
  ok(getRotaWeek() === mondayOf(new Date()) && !isRotaWeekPinned(), "…and changes nothing under Node");
  const off = subscribeRotaWeek(() => {});
  ok(typeof off === "function", "subscribeRotaWeek returns a function without a window");
  let offThrew = false;
  try { off(); } catch { offThrew = true; }
  ok(!offThrew, "the no-op unsubscribe does not throw");
}

/* ---- a custom manifest passed as the trailing argument ---- */
{
  /* Same cycle, anchored a week later with the groups placed differently, and a private
     plan naming scheme. Group C has no Day plan at all — a manifest gap. */
  const custom = {
    cycle: ["day", "full", "half"],
    anchorWeek: "2026-09-07",
    groups: {
      "A": { label: "Alpha", atAnchor: "full", plans: { day: "/x/A-day.json", half: "/x/A-half.json", full: "/x/A-full.json" } },
      "B": { label: "Bravo", atAnchor: "day",  plans: { day: "/x/B-day.json", half: "/x/B-half.json", full: "/x/B-full.json" } },
      "C": { atAnchor: "half", plans: { half: "/x/C-half.json", full: "/x/C-full.json" } },
    },
  };
  ok(stepFor("2026-09-07", custom) === 0, "custom anchor: 7 Sep is step 0");
  ok(stepFor("2026-08-31", custom) === 2, "custom anchor: 31 Aug is step 2");
  ok(stepFor("2026-09-14", custom) === 1, "custom anchor: 14 Sep is step 1");
  ok(stepFor("2026-09-07") === 1, "…while the committed manifest still says 7 Sep is step 1");
  ok(groupOnSlot("day", "2026-09-07", custom) === "B" && groupOnSlot("full", "2026-09-07", custom) === "A" && groupOnSlot("half", "2026-09-07", custom) === "C", "custom anchor week: B Day, A Full night, C Half night");
  ok(slotOfGroup("A", "2026-09-14", custom) === "half" && slotOfGroup("B", "2026-09-14", custom) === "full" && slotOfGroup("C", "2026-09-14", custom) === "day", "custom step 1: A → Half night, B → Full night, C → Day");
  ok(planUrlFor("full", "2026-09-07", custom) === "/x/A-full.json", "custom planUrlFor reads the custom plan paths");
  ok(planUrlFor("day", "2026-09-14", custom) === null, "a manifest gap (C has no Day plan) is null, not a wrong file");
  ok(planUrlFor("day", "2026-09-14") === "/plans/rot/g3-day.json", "…and the committed manifest is untouched by the custom one");
  ok(describeSlot("full", "2026-09-07", custom) === "Alpha · Full night · week of 7 Sep", `custom label is used (got "${describeSlot("full", "2026-09-07", custom)}")`);
  ok(describeSlot("half", "2026-09-07", custom) === "Group C · Half night · week of 7 Sep", `a group without a label is called "Group <id>" (got "${describeSlot("half", "2026-09-07", custom)}")`);
  const r = rotationFor("2026-09-21", custom);
  ok(r.step === 2 && same(r.bySlot, { day: "A", full: "C", half: "B" }) && same(r.byGroup, { A: "day", B: "half", C: "full" }), "custom rotationFor at step 2");
  ok(same(upcoming(3, "2026-09-07", custom).map((x) => x.bySlot.day), ["B", "C", "A"]), "custom upcoming rotates B, C, A through Day");
  /* an anchor that is not a Monday is normalised to its week, so a hand-typed date still works */
  const wed = { ...custom, anchorWeek: "2026-09-09" };
  ok(stepFor("2026-09-07", wed) === 0 && stepFor("2026-09-14", wed) === 1, "a mid-week anchorWeek is treated as its Monday");
  /* a two-slot cycle proves the modulus is the cycle length, not a hard-coded 3 */
  const two = { cycle: ["day", "half"], anchorWeek: "2026-08-31", groups: { "p": { atAnchor: "day", plans: { day: "/p-day", half: "/p-half" } }, "q": { atAnchor: "half", plans: { day: "/q-day", half: "/q-half" } } } };
  ok(stepFor("2026-09-14", two) === 0 && groupOnSlot("day", "2026-09-07", two) === "q" && planUrlFor("day", "2026-09-14", two) === "/p-day", "a two-group cycle alternates every week");
}

console.log(`\nrotation tests: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
