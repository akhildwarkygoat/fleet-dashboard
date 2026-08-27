/* T.I tests — run with:  node src/optimiser/trackImpl.test.js
 *
 * This feature exists to say "the plan was wrong by N minutes". Every assertion below is
 * guarding one of the ways that sentence can be a lie:
 *
 *   the clock is a circle      — a run crossing midnight must not read as 1,430 min early
 *   history is written once    — finalising a new plan must not move yesterday's variance
 *   bases are never mixed      — a drop timed off an ASSUMED release hour is not evidence
 *   n travels with the number   — a day with two of twelve buses is not a day
 *
 * localStorage is stubbed so the pure model can be exercised in node.
 */
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

const TI = await import("./trackImpl.js");
const {
  clockVar, durationMin, parseClock, fmtClock, fmtISO, dateRange, isSunday, addDays,
  getTI, setEntry, deleteEntry, getEntry, entriesFor, entryKey, recordedDates,
  variance, summarise, dailySeries, byVehicle, plannedRuns, snapshotOf,
  exportTI, importTI, onTime, STATUS, SOURCE, ON_TIME_MIN, TIWriteError, quotaUse, indexByDate,
  SUSPECT_CLOCK_MIN, suspectRideOver,
} = TI;

let pass = 0, fail = 0;
const ok = (cond, label, detail = "") => {
  if (cond) pass++;
  else { fail++; console.log(`  FAIL: ${label}${detail ? " — " + detail : ""}`); }
};
const reset = () => store.clear();
const T = (h, m = 0) => h * 60 + m;

/* ================================================================= the clock is a circle */
{
  ok(clockVar(T(9, 10), T(9, 0)) === 10, "ten minutes late is +10");
  ok(clockVar(T(8, 50), T(9, 0)) === -10, "ten minutes early is -10");
  ok(clockVar(T(9, 0), T(9, 0)) === 0, "on the dot is 0");

  /* THE ONE THAT MATTERS. A half-night drop planned for 23:55 that actually left at 00:05
     is ten minutes late. Plain subtraction calls it 1,430 minutes early and would drag the
     whole service's mean into fantasy. */
  ok(clockVar(T(0, 5), T(23, 55)) === 10, "crossing midnight forward is +10, not -1430",
     String(clockVar(T(0, 5), T(23, 55))));
  ok(clockVar(T(23, 55), T(0, 5)) === -10, "and backward is -10, not +1430",
     String(clockVar(T(23, 55), T(0, 5))));

  ok(clockVar(T(22, 0), T(6, 0)) === -480, "22:00 against a 06:00 plan folds to -8h",
     String(clockVar(T(22, 0), T(6, 0))));
  const all = [];
  for (let a = 0; a < 1440; a += 7) for (let p = 0; p < 1440; p += 13) all.push(clockVar(a, p));
  ok(all.every((v) => v > -720 && v <= 720), "every variance folds into (-720, 720]",
     `min ${Math.min(...all)} max ${Math.max(...all)}`);
  ok(clockVar(null, 100) === null && clockVar(100, null) === null, "a missing time yields null, never NaN");

  ok(durationMin(T(22, 0), T(6, 50)) === 530, "a night run's duration wraps midnight",
     String(durationMin(T(22, 0), T(6, 50))));
  ok(durationMin(T(8, 0), T(9, 0)) === 60, "a day run's duration is plain");
}

/* ================================================================= parsing */
{
  ok(parseClock("08:05") === 485 && parseClock("8:05") === 485, "clock parses with or without a leading zero");
  ok(parseClock("0805") === 485, "and without the colon");
  ok(parseClock("24:00") === null && parseClock("09:75") === null, "out-of-range times are rejected");
  ok(parseClock("") === null && parseClock("abc") === null && parseClock(null) === null,
     "garbage is null, never NaN — one NaN would poison every mean downstream");
  ok(fmtClock(485) === "08:05" && fmtClock(0) === "00:00", "and formats back");
  ok(fmtClock(null) === "", "a null time formats to blank rather than 00:00, which would read as midnight");
}

/* ================================================================= dates are LOCAL */
{
  /* toISOString() would convert to UTC first, which in IST rolls midnight back and files a
     Monday under the Sunday before it. Same trap TimingsView documents. */
  const d = new Date(2026, 7, 27, 0, 30);              // 27 Aug 2026, 00:30 local
  ok(fmtISO(d) === "2026-08-27", "a local half-past-midnight stays on its own date", fmtISO(d));
  ok(dateRange("2026-08-27", 3).join(",") === "2026-08-25,2026-08-26,2026-08-27",
     "a range ends on the given day, oldest first", dateRange("2026-08-27", 3).join(","));
  ok(addDays("2026-08-31", 1) === "2026-09-01", "adding a day crosses the month");
  ok(isSunday("2026-08-16") && isSunday("2026-08-23"), "the two low-punch days are Sundays");
  ok(!isSunday("2026-08-17"), "and a Monday is not");
}

/* ================================================================= history is written once */
{
  reset();
  const plannedV1 = { start: T(8, 0), end: T(9, 0), ride: 60, assumedOff: false, planName: "v1", planKind: "plan" };
  setEntry("2026-08-27", "s9", "BUS1", "pickup", { actualStart: T(8, 5), actualEnd: T(9, 10) }, plannedV1);
  const first = getEntry("2026-08-27", "s9", "BUS1", "pickup");
  ok(first.planned.planName === "v1" && first.planned.ride === 60, "the plan is snapshot on first write");
  ok(variance(first).endVar === 10, "and the variance reads off it", String(variance(first).endVar));

  /* Finalise a different plan and re-touch the row. The prediction that was tested was v1's;
     v2 is a statement about the future, not a correction to the past. */
  const plannedV2 = { start: T(7, 0), end: T(9, 0), ride: 120, assumedOff: false, planName: "v2", planKind: "draft" };
  setEntry("2026-08-27", "s9", "BUS1", "pickup", { note: "heavy rain" }, plannedV2);
  const again = getEntry("2026-08-27", "s9", "BUS1", "pickup");
  ok(again.planned.planName === "v1" && again.planned.ride === 60,
     "a later plan does NOT overwrite the snapshot", again.planned.planName);
  ok(variance(again).endVar === 10, "so yesterday's variance does not move");
  ok(again.note === "heavy rain", "…while the editable fields still update");
  ok(again.at === first.at && again.editedAt >= again.at, "first-written time is kept, edit time added");
}

/* ================================================================= emptying a row deletes it */
{
  reset();
  const p = { start: T(8, 0), end: T(9, 0), ride: 60, assumedOff: false };
  setEntry("2026-08-27", "s9", "BUS1", "pickup", { actualEnd: T(9, 5) }, p);
  ok(entriesFor("2026-08-27", "s9").length === 1, "recorded");
  setEntry("2026-08-27", "s9", "BUS1", "pickup", { actualEnd: null }, p);
  ok(entriesFor("2026-08-27", "s9").length === 0,
     "clearing the times removes the record rather than leaving a blank that counts as recorded");
}

/* ================================================================= bases are never mixed */
{
  reset();
  /* 9 am General has no release time in the ERP, so its DROP is timed off an 8 h guess. */
  const dropAssumed = { start: T(17, 0), end: T(18, 0), ride: 60, assumedOff: true };
  setEntry("2026-08-27", "s9", "BUS1", "drop", { actualStart: T(17, 30), actualEnd: T(18, 40) }, dropAssumed);
  const vd = variance(getEntry("2026-08-27", "s9", "BUS1", "drop"));
  ok(vd.clockValid === false, "a drop on an assumed release hour yields NO clock verdict");
  ok(vd.rideValid === true && vd.rideVar === 10,
     "…but its DURATION is still evidence: 70 min run against a 60 min plan", String(vd.rideVar));
  ok(/assumed/.test(vd.reason), "and it says why", vd.reason);

  /* The Rotational slots tile the day, so their release times are real. */
  const dropReal = { start: T(14, 0), end: T(15, 0), ride: 60, assumedOff: false };
  setEntry("2026-08-27", "rot-day", "BUS2", "drop", { actualStart: T(14, 0), actualEnd: T(15, 20) }, dropReal);
  ok(variance(getEntry("2026-08-27", "rot-day", "BUS2", "drop")).clockValid === true,
     "a drop on a MEASURED release hour does yield a clock verdict");

  /* A pickup is always timed off the gate, which every service states. */
  const pick = { start: T(8, 0), end: T(9, 0), ride: 60, assumedOff: true };
  setEntry("2026-08-27", "s9", "BUS3", "pickup", { actualEnd: T(9, 15) }, pick);
  ok(variance(getEntry("2026-08-27", "s9", "BUS3", "pickup")).clockValid === true,
     "a PICKUP is valid even on a service with no release time — the gate is known either way");

  const s = summarise(entriesFor("2026-08-27", null));
  ok(s.clockN === 2 && s.unmeasurable === 1,
     "the roll-up counts the unmeasurable one separately instead of averaging it in",
     `clockN ${s.clockN} unmeasurable ${s.unmeasurable}`);
}

/* ================================================================= did-not-run and no-plan */
{
  reset();
  const p = { start: T(8, 0), end: T(9, 0), ride: 60, assumedOff: false };
  setEntry("2026-08-27", "s9", "A", "pickup", { actualEnd: T(9, 10) }, p);
  setEntry("2026-08-27", "s9", "B", "pickup", { status: STATUS.NOT_RUN }, p);
  setEntry("2026-08-27", "s9", "C", "pickup", { actualEnd: T(9, 30) }, null);   // ran but not in the plan

  const vB = variance(getEntry("2026-08-27", "s9", "B", "pickup"));
  ok(vB.ran === false && vB.endVar === null, "a bus that did not run has no variance, not a variance of zero");
  const vC = variance(getEntry("2026-08-27", "s9", "C", "pickup"));
  ok(vC.hasPlan === false && vC.endVar === null, "a bus with no planned run has no baseline to differ from");

  const s = summarise(entriesFor("2026-08-27", "s9"));
  ok(s.recorded === 3 && s.ran === 2 && s.notRun === 1 && s.noPlan === 1,
     "all three are counted, in the right buckets",
     JSON.stringify({ recorded: s.recorded, ran: s.ran, notRun: s.notRun, noPlan: s.noPlan }));
  ok(s.clockN === 1, "only the one comparable run drives the variance figures", String(s.clockN));
  ok(s.pickup.medianEnd === 10, "and the median is that run alone", String(s.pickup.medianEnd));
}

/* ================================================================= median leads, mean follows */
{
  reset();
  const p = { start: T(8, 0), end: T(9, 0), ride: 60, assumedOff: false };
  /* Eleven buses within a couple of minutes, one four hours late on a burst tyre. */
  [0, 1, 2, 1, 0, 2, 1, 0, 1, 2, 1].forEach((v, i) =>
    setEntry("2026-08-27", "s9", "B" + i, "pickup", { actualEnd: T(9, 0) + v }, p));
  setEntry("2026-08-27", "s9", "TYRE", "pickup", { actualEnd: T(13, 0) }, p);

  const s = summarise(entriesFor("2026-08-27", "s9")).pickup;
  ok(s.medianEnd === 1, "the median says the day was a minute out", String(s.medianEnd));
  ok(s.meanEnd > 19, "the mean says it was twenty — one bus speaking for twelve", String(s.meanEnd));
  ok(s.worst && s.worst.veh === "TYRE" && s.worst.min === 240, "and the outlier is named rather than hidden",
     JSON.stringify(s.worst));
  ok(s.onTimeN === 11 && s.onTimePct === 92, "on-time counts the buses, not the minutes",
     `${s.onTimeN} / ${s.onTimePct}%`);
  ok(s.lateN === 1 && s.earlyN === 0, "late and early are counted separately");
}

/* ================================================================= n travels with the number */
{
  reset();
  const p = { start: T(8, 0), end: T(9, 0), ride: 60, assumedOff: false };
  setEntry("2026-08-26", "s9", "A", "pickup", { actualEnd: T(9, 0) }, p);   // 1 of 12 recorded
  [0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2].forEach((v, i) =>
    setEntry("2026-08-27", "s9", "B" + i, "pickup", { actualEnd: T(9, 0) + v }, p));  // 12 of 12

  const rows = dailySeries(getTI(), "s9", ["2026-08-26", "2026-08-27"], () => 12);
  ok(rows[0].coverage === 8 && rows[1].coverage === 100,
     "coverage exposes the day nobody filled in", rows.map((r) => r.coverage + "%").join(","));
  ok(rows[0].recorded === 1 && rows[1].recorded === 12, "and n is on every row");
  ok(rows.every((r) => r.expected === 12), "against what the plan expected");
  ok(rows[0].sunday === false, "weekday flagged correctly");
}

/* ================================================================= vehicle identity */
{
  reset();
  const p = { start: T(8, 0), end: T(9, 0), ride: 60, assumedOff: false };
  /* TN57BJ3434 was re-registered as TN57CJ3434. Old plans still say the old name. */
  setEntry("2026-08-26", "s9", "TN57BJ3434", "pickup", { actualEnd: T(9, 5) }, p);
  setEntry("2026-08-27", "s9", "TN57CJ3434", "pickup", { actualEnd: T(9, 7) }, p);
  const v = byVehicle(getTI(), "s9", ["2026-08-26", "2026-08-27"]);
  ok(v.length === 1 && v[0].veh === "TN57CJ3434",
     "a re-registered bus keeps ONE history rather than splitting on the day the ERP caught up",
     JSON.stringify(v.map((x) => x.veh)));
  ok(v[0].days === 2 && v[0].recorded === 2, "with both days on it");
  ok(entryKey("2026-08-26", "s9", "TN57BJ3434", "pickup") === entryKey("2026-08-26", "s9", "TN57CJ3434", "pickup"),
     "because the key itself is canonical");
}

/* ================================================================= per-vehicle ranking */
{
  reset();
  const p = { start: T(8, 0), end: T(9, 0), ride: 60, assumedOff: false };
  const dates = ["2026-08-25", "2026-08-26", "2026-08-27"];
  dates.forEach((d) => setEntry(d, "s9", "GOOD", "pickup", { actualEnd: T(9, 1) }, p));
  dates.forEach((d) => setEntry(d, "s9", "LATE", "pickup", { actualEnd: T(9, 25) }, p));
  const v = byVehicle(getTI(), "s9", dates);
  ok(v[0].veh === "LATE" && v[0].pickup.medianEnd === 25, "the consistently late bus sorts first",
     JSON.stringify(v.map((x) => [x.veh, x.pickup.medianEnd])));
  ok(v[1].veh === "GOOD" && v[1].pickup.onTimePct === 100, "and the reliable one reads 100%");
  ok(v.every((x) => x.days === 3), "over the whole window, not one day");
}

/* ================================================================= import merges, never clobbers */
{
  reset();
  const p = { start: T(8, 0), end: T(9, 0), ride: 60, assumedOff: false };
  setEntry("2026-08-27", "s9", "A", "pickup", { actualEnd: T(9, 5) }, p);
  const mine = exportTI();

  reset();
  setEntry("2026-08-27", "s9", "A", "pickup", { actualEnd: T(9, 9) }, p);   // newer local edit
  const localAt = getEntry("2026-08-27", "s9", "A", "pickup").at;
  const older = JSON.parse(JSON.stringify(mine));
  Object.values(older.entries).forEach((e) => { e.at = localAt - 10000; delete e.editedAt; });

  const r1 = importTI(older);
  ok(r1.kept === 1 && r1.updated === 0, "an OLDER record does not overwrite a newer local one",
     JSON.stringify(r1));
  ok(getEntry("2026-08-27", "s9", "A", "pickup").actualEnd === T(9, 9), "the newer value survives");

  const newer = JSON.parse(JSON.stringify(mine));
  Object.values(newer.entries).forEach((e) => { e.editedAt = localAt + 10000; e.actualEnd = T(9, 2); });
  importTI(newer);
  ok(getEntry("2026-08-27", "s9", "A", "pickup").actualEnd === T(9, 2), "a NEWER record does win");

  const before = JSON.stringify(getTI().entries);
  importTI(newer);
  ok(JSON.stringify(getTI().entries) === before, "and importing the same file twice changes nothing");

  let threw = false;
  try { importTI({ kind: "something-else" }); } catch { threw = true; }
  ok(threw, "a foreign file is refused rather than merged");
}

/* ================================================================= plannedRuns matches the plan */
{
  const svc = { id: "rot-day", name: "Day", color: "#0d9488", gate: T(6, 0), off: T(14, 0) };
  const plan = { routes: [{ name: "TN57BJ3434", type: "own", cap: 40, riders: 20, km: 80, ride: 45, stops: 3,
                            seq: [{ name: "near", lat: 10.2, lng: 77.8, hc: 5 },
                                  { name: "far", lat: 10.4, lng: 78.0, hc: 15 }] }] };
  const runs = plannedRuns(plan, svc);
  ok(runs.length === 2, "one route yields a pickup and a drop", String(runs.length));
  const pick = runs.find((r) => r.dir === "pickup"), drop = runs.find((r) => r.dir === "drop");
  ok(pick.end === T(6, 0) && pick.start === T(6, 0) - 45, "pickup lands on the gate");
  ok(drop.start === T(14, 0) && drop.end === T(14, 45), "drop leaves at the release time");
  ok(runs.every((r) => r.veh === "TN57CJ3434"), "and the vehicle name is canonicalised", runs[0].veh);
  ok(runs.every((r) => r.assumedOff === false), "a stated release time is not flagged assumed");

  const noOff = plannedRuns(plan, { ...svc, off: null });
  ok(noOff.every((r) => r.assumedOff === true), "a missing one is");
  ok(plannedRuns(null, svc).length === 0 && plannedRuns(plan, { ...svc, gate: null }).length === 0,
     "no plan or no gate yields nothing rather than throwing");

  const snap = snapshotOf(pick, { name: "Manager v4", kind: "draft", isDefault: false });
  ok(snap.start === pick.start && snap.ride === 45 && snap.planName === "Manager v4" && snap.planKind === "draft",
     "the snapshot carries the provenance, so a record is self-describing years later",
     JSON.stringify(snap));
}

/* ================================================================= misc */
{
  reset();
  const p = { start: T(8, 0), end: T(9, 0), ride: 60, assumedOff: false };
  setEntry("2026-08-25", "s9", "A", "pickup", { actualEnd: T(9, 0) }, p);
  setEntry("2026-08-27", "rot-day", "B", "pickup", { actualEnd: T(6, 0) }, p);
  ok(recordedDates(getTI()).join(",") === "2026-08-25,2026-08-27", "recorded dates list, oldest first");
  ok(recordedDates(getTI(), "rot-day").join(",") === "2026-08-27", "and can be scoped to a service");
  ok(entriesFor(null, "s9").length === 1, "entries can be filtered by service across all dates");

  deleteEntry("2026-08-25", "s9", "A", "pickup");
  ok(entriesFor("2026-08-25", "s9").length === 0, "delete removes");

  ok(onTime(3) === true && onTime(9) === false && onTime(null) === null,
     `on-time uses the one published tolerance of ${ON_TIME_MIN} min`);
  ok(summarise([]).recorded === 0 && summarise([]).pickup.medianEnd === null,
     "an empty day summarises to nulls, not zeros — zero minutes late is a claim, null is not");
  ok(SOURCE.MANUAL === "manual" && SOURCE.TRACKER === "tracker",
     "a source is recorded so GPS trackers can write alongside typed entries later");
  const e = getEntry("2026-08-27", "rot-day", "B", "pickup");
  ok(e.source === "manual", "and today everything is manual", e.source);
}

/* ================================================================= bulk confirmation is declared */
{
  reset();
  const p = { start: T(8, 0), end: T(9, 0), ride: 60, assumedOff: false };
  setEntry("2026-08-27", "s9", "TIMED", "pickup", { actualEnd: T(9, 3) }, p);
  /* "They all ran fine" is a real assertion a manager is entitled to make, and without it
     nobody fills the board in at all. But a 100% on-time day that was asserted in one click
     is not the same evidence as one timed bus by bus, so the count is kept. */
  setEntry("2026-08-27", "s9", "BULK1", "pickup", { actualStart: p.start, actualEnd: p.end, bulk: true }, p);
  setEntry("2026-08-27", "s9", "BULK2", "pickup", { actualStart: p.start, actualEnd: p.end, bulk: true }, p);
  const s = summarise(entriesFor("2026-08-27", "s9"));
  ok(s.bulk === 2, "bulk-confirmed rows are counted", String(s.bulk));
  /* THE ONE THAT MATTERS. A bulk confirm is an assertion that nothing went wrong, not a
     stopwatch reading of exactly zero. If those synthetic zeros entered the average, one
     click would drag any real lateness toward the middle and a day could be declared
     perfect by a button. */
  ok(s.pickup.n === 1, "only the TIMED run enters the average", String(s.pickup.n));
  ok(s.pickup.medianEnd === 3, "so the median is the real reading, not diluted by two zeros",
     String(s.pickup.medianEnd));
  ok(s.pickup.asserted === 2, "the asserted ones are reported beside it", String(s.pickup.asserted));
  /* And they do NOT enter the percentage. "They all ran to plan" is a statement about coverage,
     not about punctuality — counting it let three real readings of +28, +35 and +42 render as
     "on time, 98%". The one timed run here was 3 min out, which IS on time, hence 100% of 1. */
  ok(s.pickup.onTimePct === 100 && s.pickup.n === 1,
     "the percentage is over TIMED runs only", `${s.pickup.onTimePct}% of ${s.pickup.n}`);
  const s2 = summarise(entriesFor("2026-08-27", "s9").map(
    (e) => (e.veh === "TIMED" ? { ...e, actualEnd: T(9, 40) } : e)));
  ok(s2.pickup.onTimePct === 0,
     "one late timed run among two asserted ones reads 0%, not 67% — an assertion cannot outvote a stopwatch",
     `${s2.pickup.onTimePct}%`);
}

/* ================================================================= pickups and drops never pool */
{
  reset();
  const pick = { start: T(5, 0), end: T(6, 0), ride: 60, assumedOff: false };
  const drop = { start: T(14, 0), end: T(15, 0), ride: 60, assumedOff: false };
  /* Rotational releases are measured, so BOTH directions are comparable — which is exactly
     when pooling them becomes dangerous. Twelve buses ten minutes late to the factory and ten
     minutes early home is not a fleet that is on time; it is a fleet that is late for work. */
  for (let i = 0; i < 12; i++) {
    setEntry("2026-08-27", "rot-day", "B" + i, "pickup", { actualStart: pick.start, actualEnd: pick.end + 10 }, pick);
    setEntry("2026-08-27", "rot-day", "B" + i, "drop", { actualStart: drop.start, actualEnd: drop.end - 10 }, drop);
  }
  const s = summarise(entriesFor("2026-08-27", "rot-day"));
  ok(s.pickup.medianEnd === 10, "pickups read +10", String(s.pickup.medianEnd));
  ok(s.drop.medianEnd === -10, "drops read -10", String(s.drop.medianEnd));
  ok(s.medianEnd === undefined,
     "and there is NO pooled figure for them to cancel into — the one that read 'on time, green'");
  ok(s.headline === s.pickup, "the headline is the pickup: late for work is the question this answers");
  ok(s.pickup.lateN === 12 && s.pickup.earlyN === 0, "late and early stay on their own sides");
  ok(s.drop.earlyN === 12 && s.drop.lateN === 0);
}

/* ================================================================= night runs know their date */
{
  const full = { id: "rot-full", name: "Full night", color: "#4338ca", gate: T(22, 0), off: T(6, 0) };
  const plan = { routes: [{ name: "BUS1", type: "own", cap: 40, riders: 20, km: 80, ride: 108, stops: 2,
                            seq: [{ name: "a", lat: 10.2, lng: 77.8, hc: 5 }, { name: "b", lat: 10.4, lng: 78, hc: 15 }] }] };
  const runs = plannedRuns(plan, full);
  const p = runs.find((r) => r.dir === "pickup"), d = runs.find((r) => r.dir === "drop");
  ok(p.startDay === 0 && p.endDay === 0, "the night pickup runs 20:12 -> 22:00 on the service day");
  /* The release is 06:00 against a 22:00 gate, so the shift ended the NEXT morning and every
     one of full night's drops happens on D+1. Without this the manager files them under
     tomorrow and the day reads 13 of 26 for ever. */
  ok(d.startDay === 1 && d.endDay === 1, "the night DROP is on the next calendar day",
     `startDay ${d.startDay} endDay ${d.endDay}`);

  const half = { id: "rot-half", name: "Half night", gate: T(14, 0), off: T(22, 0) };
  const long = { routes: [{ name: "B", ride: 150, riders: 1, km: 1, cap: 40, type: "own", stops: 1,
                            seq: [{ name: "a", lat: 10.2, lng: 77.8, hc: 1 }] }] };
  const hd = plannedRuns(long, half).find((r) => r.dir === "drop");
  ok(hd.startDay === 0 && hd.endDay === 1, "a drop that runs 22:00 -> 00:30 ends the next day",
     `startDay ${hd.startDay} endDay ${hd.endDay}`);

  const day = { id: "rot-day", name: "Day", gate: T(6, 0), off: T(14, 0) };
  const dd = plannedRuns(long, day);
  ok(dd.every((r) => r.startDay === 0 && r.endDay === 0), "a daytime service stays on its own day");

  /* Latent, not hypothetical: any re-cut that pushes a ride past its gate wraps the same way. */
  const early = plannedRuns(long, { id: "x", name: "X", gate: T(2, 0), off: T(10, 0) });
  ok(early.find((r) => r.dir === "pickup").startDay === -1,
     "a pickup whose ride starts before midnight is flagged as the previous evening");

  const snap = snapshotOf(d, { name: "Optimised", kind: "plan", isDefault: true, file: "/plan_rot-full.json" },
                          { generated: "2026-08-25" });
  ok(snap.startDay === 1 && snap.endDay === 1, "the offsets are frozen into the record too");
  ok(snap.planGenerated === "2026-08-25" && snap.planFile === "/plan_rot-full.json",
     "and the plan's BUILD DATE is stored — the name alone is 'Optimised' for every default plan, " +
     "so a re-cut would otherwise be invisible and read as the fleet improving");
}

/* ================================================================= a failed save is never silent */
{
  reset();
  const p = { start: T(8, 0), end: T(9, 0), ride: 60, assumedOff: false };
  const realSet = globalThis.localStorage.setItem;
  globalThis.localStorage.setItem = () => { const e = new Error("quota"); e.name = "QuotaExceededError"; throw e; };
  let caught = null;
  try { setEntry("2026-08-27", "s9", "A", "pickup", { actualEnd: T(9, 5) }, p); }
  catch (e) { caught = e; }
  globalThis.localStorage.setItem = realSet;
  ok(caught instanceof TIWriteError,
     "a full store THROWS rather than returning as if it saved — typed times exist nowhere else, " +
     "so a swallowed write loses a day's work permanently and silently", caught && caught.name);
  ok(/full/i.test(caught.message) && /xport/i.test(caught.message),
     "and the message tells the operator what to do about it", caught && caught.message);

  const q = quotaUse();
  ok(typeof q.bytes === "number" && q.pct >= 0 && q.pct <= 100, "headroom is reportable so the wall can be seen coming",
     JSON.stringify(q));
}

/* ================================================================= long windows are indexed */
{
  reset();
  const p = { start: T(8, 0), end: T(9, 0), ride: 60, assumedOff: false };
  const dates = dateRange("2026-08-27", 180);
  ok(dates.length === 180 && dates[0] === "2026-03-01", "a six-month window spans 180 days",
     dates[0] + " -> " + dates[179]);
  setEntry("2026-06-01", "s9", "A", "pickup", { actualEnd: T(9, 4) }, p);
  setEntry("2026-08-27", "s9", "B", "pickup", { actualEnd: T(9, 6) }, p);
  const idx = indexByDate(getTI(), ["s9"]);
  ok(idx.size === 2 && idx.get("2026-06-01").length === 1, "entries index by date once", String(idx.size));
  const rows = dailySeries(getTI(), "s9", dates, () => 12);
  ok(rows.length === 180, "the series covers the whole window");
  ok(rows.filter((r) => r.recorded).length === 2, "with only the recorded days populated");
  ok(rows.find((r) => r.date === "2026-08-27").pickup.medianEnd === 6, "and reads correctly at the far end");
}

/* ================================================================= a typo is not a bus */
{
  reset();
  /* The clock folds at twelve hours, which is the only sane way to compare two times of day.
     The cost is that a slip near the fold flips the sign by a whole day, and the ordinary typo
     looks perfectly reasonable on the way in. */
  const night = { start: T(21, 10), end: T(22, 0), ride: 50, assumedOff: false };
  setEntry("2026-08-27", "rot-full", "A", "pickup", { actualEnd: T(9, 5) }, night);
  setEntry("2026-08-27", "rot-full", "B", "pickup", { actualEnd: T(9, 15) }, night);
  const a = variance(getEntry("2026-08-27", "rot-full", "A", "pickup"));
  const b = variance(getEntry("2026-08-27", "rot-full", "B", "pickup"));
  ok(Math.abs(a.endVar) > SUSPECT_CLOCK_MIN && Math.abs(b.endVar) > SUSPECT_CLOCK_MIN,
     "ten minutes either side of the fold gives +715 and -715", `${a.endVar} / ${b.endVar}`);
  ok(a.suspect && b.suspect, "so both are held out rather than averaged in");
  ok(!a.clockValid && !b.clockValid, "neither counts toward anything");

  /* The everyday one: gate 22:00, the manager means 22:30 and types "230". */
  const gate22 = { start: T(21, 0), end: T(22, 0), ride: 60, assumedOff: false };
  setEntry("2026-08-27", "rot-full", "TYPO", "pickup", { actualEnd: parseClock("230") }, gate22);
  const v = variance(getEntry("2026-08-27", "rot-full", "TYPO", "pickup"));
  ok(v.suspect, "a 02:30 against a 22:00 plan is flagged, not scored as +270 min", String(v.endVar));
  ok(/check the time|confirm/i.test(v.suspectReason), "and says what to do", v.suspectReason);

  /* A bus really can be four hours late, so it is confirm — never delete. */
  setEntry("2026-08-27", "rot-full", "TYPO", "pickup", { confirmed: true }, gate22);
  ok(variance(getEntry("2026-08-27", "rot-full", "TYPO", "pickup")).clockValid === true,
     "confirming it lets the real outlier back in");

  const s = summarise(entriesFor("2026-08-27", "rot-full"));
  ok(s.suspect === 2, "suspects are counted so they can be found and fixed", String(s.suspect));
  ok(s.pickup.n === 1, "and only the confirmed one is in the average", String(s.pickup.n));
}

/* ================================================================= a swapped start and end */
{
  reset();
  /* Half night drop plans 22:00 -> 00:30. Transposed, it "takes" 21h30 and wraps cleanly, so
     nothing about the number itself says it is backwards. */
  const p = { start: T(22, 0), end: T(0, 30), ride: 150, assumedOff: false };
  setEntry("2026-08-27", "rot-half", "SWAP", "drop", { actualStart: parseClock("0035"), actualEnd: parseClock("2205") }, p);
  const v = variance(getEntry("2026-08-27", "rot-half", "SWAP", "drop"));
  ok(v.actualRide === 1290, "forwards it reads 21h30", String(v.actualRide));
  ok(v.suspect && !v.rideValid,
     "which is flagged rather than entering the duration average as +1140 min");
  ok(/swapped/.test(v.suspectReason), "and the transposition is named, because backwards it fits the plan exactly",
     v.suspectReason);

  ok(suspectRideOver(150) === 600 && suspectRideOver(20) === 360,
     "the bound scales with the plan but never drops below six hours");

  // eleven honest entries plus the swapped one
  for (let i = 0; i < 11; i++)
    setEntry("2026-08-27", "rot-half", "B" + i, "drop", { actualStart: T(22, 0), actualEnd: T(0, 35) }, p);
  const s = summarise(entriesFor("2026-08-27", "rot-half"));
  ok(s.drop.medianRide === 5, "so the eleven good ones keep the median at +5", String(s.drop.medianRide));
  ok(s.drop.rideN === 11 && s.suspect === 1, "with the twelfth held out and counted",
     `rideN ${s.drop.rideN} suspect ${s.suspect}`);
}

console.log(`\ntrack implementation: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
