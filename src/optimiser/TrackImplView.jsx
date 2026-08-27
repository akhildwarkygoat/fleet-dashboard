/* ============================================================================
 * optimiser/TrackImplView.jsx — T.I, the Track Implementation board.
 * ----------------------------------------------------------------------------
 * Every other board here plans. This one marks the plan's homework.
 *
 * Three sections, in the order the question is actually asked:
 *   TODAY      what did each bus do — the vehicle manager types it, one row per run
 *   OVER TIME  is the plan drifting, or was yesterday just yesterday
 *   BY BUS     which vehicles are consistently out, not which was late once
 *
 * The board's whole job is to avoid flattering itself. Three habits do that:
 *   - every figure carries the n it was computed from, so a day with two of twelve
 *     buses recorded can never be read as a day;
 *   - a drop timed against an ASSUMED release hour is shown but never averaged, and
 *     says so where it sits;
 *   - rows the manager confirmed in bulk are counted separately from rows that were
 *     actually timed, because "they were all fine" and twelve stopwatch readings are
 *     not the same evidence.
 *
 * Times are typed by hand today. When GPS trackers land they write the same records
 * with source:"tracker", so this board does not change and the history does not break.
 * ==========================================================================*/
import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, Cell,
} from "recharts";
import { ClipboardCheck, Download, Upload, ChevronLeft, ChevronRight, Info, AlertTriangle, Check, Search } from "lucide-react";
import { Card, Tile, Empty, Btn, Segmented } from "./ui.jsx";
import { SERVICES, fmtClock as fmtGate } from "./services.js";
import { resolveFinalised } from "./finalisedPlans.js";
import * as store from "./store.js";
import {
  getTI, setEntry, deleteEntry, getEntry, plannedRuns, snapshotOf, commit,
  variance, summarise, byVehicle, indexByDate,
  fmtISO, addDays, isSunday, dateRange, parseClock, fmtClock, onTime,
  downloadTI, importTI, quotaUse, STATUS, ON_TIME_MIN,
} from "./trackImpl.js";

const WINDOWS = [["7", "7 days"], ["14", "14 days"], ["30", "30 days"], ["90", "3 months"], ["180", "6 months"]];
/* A six-month window is 180 rows. The chart takes them; a table of 180 does not earn its
   scroll, so it is capped and the cap is STATED — a silently truncated table reads as
   "that is all there is". */
const TABLE_ROWS = 60;

/** Signed minutes as a human string. Sign is meaning here, so it is never dropped. */
const mins = (v) => (v == null ? "—" : v === 0 ? "on time" : `${v > 0 ? "+" : ""}${v} min`);

export default function TrackImplView({ t, toast, svc }) {
  const scoped = svc && !svc.overall ? [svc] : SERVICES;
  const [date, setDate] = useState(() => fmtISO(new Date()));
  const [ti, setTi] = useState(getTI);
  const [plans, setPlans] = useState({});          // svcId -> plan body (or null once resolved)
  const [win, setWin] = useState("14");
  const [q, setQ] = useState("");
  const [tab, setTab] = useState("today");

  /* The finalised plan is the thing being marked, so it is resolved the same way every
     other board resolves it. A draft's scored BODY is stored on the ref at finalise time,
     which is what makes a draft usable out here without the Planner's machinery. */
  useEffect(() => {
    let live = true;
    scoped.forEach((s) => {
      const r = resolveFinalised(s);
      if (r.kind === "draft" && r.body) { if (live) setPlans((p) => ({ ...p, [s.id]: { body: r.body, meta: r } })); return; }
      if (r.kind === "plan" && r.file) {
        fetch(r.file).then((x) => (x.ok ? x.json() : null))
          .then((d) => { if (live) setPlans((p) => ({ ...p, [s.id]: d && Array.isArray(d.routes) ? { body: d, meta: r } : null })); })
          .catch(() => { if (live) setPlans((p) => ({ ...p, [s.id]: null })); });
        return;
      }
      if (live) setPlans((p) => ({ ...p, [s.id]: null }));
    });
    return () => { live = false; };
  }, [svc && svc.id]);                                              // eslint-disable-line

  /* Every run the plan expects today, across the services in scope. */
  const expected = useMemo(() => {
    const out = [];
    for (const s of scoped) {
      const p = plans[s.id];
      if (!p) continue;
      for (const run of plannedRuns(p.body, s)) out.push({ ...run, svc: s, planMeta: p.meta, planBody: p.body });
    }
    return out.sort((a, b) => a.svc.name.localeCompare(b.svc.name) || a.veh.localeCompare(b.veh) || a.dir.localeCompare(b.dir));
  }, [plans, svc && svc.id]);                                        // eslint-disable-line

  const expectedFor = useCallback((svcId) => expected.filter((r) => r.svcId === svcId).length, [expected]);

  const rows = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return expected
      .filter((r) => !ql || r.veh.toLowerCase().includes(ql) || r.svc.name.toLowerCase().includes(ql))
      .map((r) => ({ run: r, entry: getEntry(date, r.svcId, r.veh, r.dir, ti) }));
  }, [expected, date, ti, q]);

  const svcIds = useMemo(() => scoped.map((s) => s.id), [svc && svc.id]);   // eslint-disable-line
  /* Indexed once. A six-month window is 180 dates, and rescanning the whole store per date
     turned the trend into an O(dates x entries) sweep on every keystroke. */
  const idx = useMemo(() => indexByDate(ti, svcIds), [ti, svcIds]);

  const todayEntries = useMemo(() => idx.get(date) || [], [idx, date]);
  const day = useMemo(() => summarise(todayEntries), [todayEntries]);

  const dates = useMemo(() => dateRange(date, +win), [date, win]);
  const series = useMemo(() => {
    const exp = svcIds.reduce((n, id) => n + expectedFor(id), 0);
    return dates.map((d) => {
      const es = idx.get(d) || [];
      const s = summarise(es);
      return { date: d, label: d.slice(5), expected: exp, sunday: isSunday(d),
               coverage: exp ? Math.round((s.recorded / exp) * 100) : null,
               pickupMedian: s.pickup.medianEnd, dropMedian: s.drop.medianEnd, ...s };
    });
  }, [dates, idx, expectedFor, svcIds]);

  const perBus = useMemo(
    () => scoped.flatMap((s) => byVehicle(ti, s.id, dates).map((v) => ({ ...v, svc: s }))) 
            .sort((a, b) => Math.abs(b.medianEnd ?? 0) - Math.abs(a.medianEnd ?? 0)),
    [ti, dates, svc && svc.id]);                                     // eslint-disable-line

  /* A refused write is an error the operator must see. It used to be swallowed, so a full
     store meant the board went on accepting times all day and lost them on reload. */
  const save = (run, patch) => {
    try {
      setTi({ ...setEntry(date, run.svcId, run.veh, run.dir, patch,
                          snapshotOf(run, run.planMeta, run.planBody), getTI()) });
    } catch (e) { toast && toast(e.message || "Could not save"); }
  };

  /* "They all ran to plan" is the only way this board gets filled in on a normal day, so it
     has to exist. Three things keep it honest:
       - it records NO TIMES. "It ran to plan" is a statement about coverage, not a stopwatch
         reading, and writing the planned times in as observations made one click produce
         "typical lateness 0 min, 98% on time" over three real readings of +28, +35 and +42;
       - it works on every unrecorded run, not on whatever the search box has filtered to —
         the button says "rest", and it used to mean "rest of what you can currently see";
       - past a handful it asks first, because in Overall mode this is 260 records across six
         services with no undo. */
  const confirmRest = () => {
    const left = expected.filter((r) => !getEntry(date, r.svcId, r.veh, r.dir, ti));
    if (!left.length) { toast && toast("Every run on this day is already recorded"); return; }
    const svcs = [...new Set(left.map((r) => r.svc.name))];
    if (left.length > 20 && !window.confirm(
      `Mark ${left.length} runs across ${svcs.length} service${svcs.length === 1 ? "" : "s"} ` +
      `(${svcs.join(", ")}) as having run to plan on ${date}?\n\n` +
      `This records that the day is accounted for. It does NOT record times, and does not ` +
      `count toward the on-time figures.`)) return;
    try {
      /* One write at the end, not one per run — 260 full stringify-and-store passes made the
         click take seconds and each one could hit the quota separately. */
      let next = getTI();
      for (const run of left)
        next = setEntry(date, run.svcId, run.veh, run.dir, { bulk: true },
                        snapshotOf(run, run.planMeta, run.planBody), next, { defer: true });
      setTi({ ...commit(next) });
      toast && toast(`${left.length} run${left.length === 1 ? "" : "s"} marked as run to plan — ` +
                     `coverage only, not counted as timings`);
    } catch (e) { toast && toast(e.message || "Could not save"); }
  };

  const quota = useMemo(() => quotaUse(ti), [ti]);
  const noPlans = expected.length === 0;
  const assumedSvcs = [...new Set(expected.filter((r) => r.assumedOff).map((r) => r.svc.name))];

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {/* The headline is the PICKUP, and it says so. "Late to the gate" is the only variance
            with a production consequence, and it is measured against a gate time the ERP
            states rather than against a modelled traversal. Drops get their own tile below
            rather than being averaged in — pooled, a fleet ten minutes late for work and ten
            minutes early home reads "on time". */}
        <Tile t={t} label="Late to the gate" accent={day.pickup.medianEnd == null ? undefined : onTime(day.pickup.medianEnd) ? t.good : t.watch}
          value={day.pickup.medianEnd == null ? "—" : mins(day.pickup.medianEnd)}
          sub={day.pickup.n ? `median of ${day.pickup.n} timed pickup${day.pickup.n === 1 ? "" : "s"}` : "no pickup timed yet"} />
        <Tile t={t} label="Pickups on time" value={day.pickup.onTimePct == null ? "—" : day.pickup.onTimePct + "%"}
          sub={day.pickup.asserted
            ? `${day.pickup.onTimeN} timed + ${day.pickup.asserted} asserted, within ${ON_TIME_MIN} min`
            : day.pickup.n ? `${day.pickup.onTimeN} of ${day.pickup.n} within ${ON_TIME_MIN} min` : `within ${ON_TIME_MIN} min`}
          accent={day.pickup.onTimePct == null ? undefined : day.pickup.onTimePct >= 80 ? t.good : t.poor} />
        <Tile t={t} label="Recorded" value={`${day.recorded}/${expected.length}`}
          sub={[day.bulk ? `${day.bulk} asserted, not timed` : "", day.notRun ? `${day.notRun} did not run` : ""]
            .filter(Boolean).join(" · ") || "runs on this day"}
          accent={expected.length && day.recorded === expected.length ? t.good : undefined} />
        <Tile t={t} label="Home run" value={day.drop.medianEnd == null ? "—" : mins(day.drop.medianEnd)}
          sub={day.drop.n ? `median of ${day.drop.n} timed drop${day.drop.n === 1 ? "" : "s"}`
               : day.unmeasurable ? `${day.unmeasurable} on an assumed release time` : "no drop timed yet"}
          accent={day.drop.medianEnd == null ? undefined : onTime(day.drop.medianEnd) ? t.good : t.watch} />
      </div>

      <div className="rounded-xl border px-4 py-3 text-xs flex items-start gap-2.5"
        style={{ background: t.surface2, borderColor: t.border, color: t.muted }}>
        <Info size={14} className="shrink-0 mt-0.5" style={{ color: t.primary }} />
        <div>
          <b style={{ color: t.text }}>Measured against the finalised plan as it stood when you entered the time.</b>{" "}
          Finalising a different plan later does not move a day already recorded — otherwise every
          past variance would silently rewrite itself and the trend would be worthless.
          {assumedSvcs.length > 0 && (
            <> <b style={{ color: t.watch }}>Drop runs on {assumedSvcs.join(", ")} are timed against an assumed
            8-hour shift</b>, because the ERP gives a gate time but no release time. Those rows are recorded and their
            <i> duration</i> still counts, but their clock lateness is left out of every average.</>
          )}
          <div className="mt-1" style={{ color: t.faint }}>
            A run belongs to the day it <i>started</i> — a night bus finishing at 06:50 is filed under the night before.
          </div>
        </div>
      </div>

      <Segmented t={t} value={tab} onChange={setTab} options={[
        ["today", "This day"], ["trend", `Over time (${win} days)`], ["bus", "By bus"],
      ]} />

      {tab === "today" && (
        <Card t={t} title="What actually happened"
          hint="One row per run the finalised plan expects. Type the times the vehicle manager reports — a run with no entry is simply not counted, never assumed on time."
          right={
            <div className="flex flex-wrap gap-2 items-center">
              <div className="inline-flex items-center rounded-xl" style={{ border: "1px solid " + t.border }}>
                <button type="button" onClick={() => setDate(addDays(date, -1))} aria-label="Previous day"
                  className="px-2 py-2" style={{ color: t.muted, cursor: "pointer" }}><ChevronLeft size={15} /></button>
                <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)}
                  aria-label="Service day"
                  className="px-2 py-1.5 text-sm tabular-nums outline-none"
                  style={{ background: "transparent", color: t.text, border: "none" }} />
                <button type="button" onClick={() => setDate(addDays(date, 1))} aria-label="Next day"
                  className="px-2 py-2" style={{ color: t.muted, cursor: "pointer" }}><ChevronRight size={15} /></button>
              </div>
              <Btn t={t} variant="ghost" onClick={confirmRest}><Check size={14} /> Rest ran to plan</Btn>
              <Btn t={t} variant="ghost" onClick={() => { downloadTI(); toast && toast("T.I records exported"); }}>
                <Download size={14} /> Export
              </Btn>
              <label className="inline-flex items-center gap-2 rounded-xl font-semibold px-4 py-2.5 text-sm cursor-pointer"
                style={{ color: t.text, border: "1px solid " + t.border }}>
                <Upload size={14} /> Import
                <input type="file" accept="application/json" className="hidden" onChange={(e) => {
                  const f = e.target.files && e.target.files[0];
                  if (!f) return;
                  f.text().then((txt) => {
                    try { const r = importTI(JSON.parse(txt)); setTi(getTI());
                          toast && toast(`Merged: ${r.added} new, ${r.updated} updated, ${r.kept} kept`); }
                    catch (err) { toast && toast(err.message || "Not a T.I export"); }
                  });
                  e.target.value = "";
                }} />
              </label>
            </div>
          }>
          {isSunday(date) && (
            <div className="rounded-lg px-3 py-2 mb-3 text-xs" style={{ background: t.watchSoft, color: t.text }}>
              {date} is a Sunday — the factory does not normally run. Recording nothing here is expected.
            </div>
          )}
          {noPlans ? (
            <Empty t={t} title="No finalised plan to mark against"
              sub={svc && !svc.overall
                ? `${svc.name} has no plan resolved yet. Finalise one in the Planner, then this board can measure against it.`
                : "None of the services has a plan resolved yet."} />
          ) : (
            <>
              {day.suspect > 0 && (
                <div className="rounded-lg px-3 py-2 mb-3 text-xs flex flex-wrap items-center gap-2"
                  style={{ background: t.watchSoft, color: t.text }}>
                  <AlertTriangle size={13} style={{ color: t.watch }} />
                  <b>{day.suspect} entr{day.suspect === 1 ? "y looks" : "ies look"} like a typing mistake</b>
                  <span style={{ color: t.muted }}>
                    — more than 4 h from plan, or a run that only makes sense backwards. Held out of every
                    figure until corrected or confirmed.
                  </span>
                </div>
              )}
              {quota.pct >= 70 && (
                <div className="rounded-lg px-3 py-2 mb-3 text-xs flex flex-wrap items-center gap-2"
                  style={{ background: quota.pct >= 90 ? t.poorSoft : t.watchSoft, color: t.text }}>
                  <AlertTriangle size={13} style={{ color: quota.pct >= 90 ? t.poor : t.watch }} />
                  <b>History is using {(quota.bytes / 1024 / 1024).toFixed(1)} MB of about 5 MB</b>
                  <span style={{ color: t.muted }}>
                    — export now. These times exist nowhere else, and once the browser refuses a write
                    nothing further can be saved.
                  </span>
                </div>
              )}
              <div className="flex flex-wrap items-center gap-2 mb-3">
                <div className="relative" style={{ minWidth: 200 }}>
                  <Search size={14} style={{ position: "absolute", left: 10, top: 9, color: t.muted }} />
                  <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Bus or service…"
                    aria-label="Filter runs"
                    className="w-full rounded-lg pl-8 pr-3 py-1.5 text-sm outline-none"
                    style={{ background: t.inputBg, border: "1px solid " + t.border, color: t.text }} />
                </div>
                <span className="text-xs ml-auto" style={{ color: t.muted }}>
                  {day.recorded} of {expected.length} recorded
                  {day.bulk ? ` · ${day.bulk} bulk-confirmed` : ""}
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm" style={{ minWidth: 940 }}>
                  <thead><tr style={{ background: t.surface2 }}>
                    {["Bus", "Run", "Plan says", "Actual start", "Actual end", "Lateness", "Took", ""].map((h) => (
                      <th key={h} className="py-2 px-3 text-xs font-semibold uppercase tracking-wider text-left"
                        style={{ color: t.muted }}>{h}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {rows.map(({ run, entry }) => (
                      <RunRow key={`${run.svcId}|${run.veh}|${run.dir}`} t={t} run={run} entry={entry} save={save} date={date}
                        onClear={() => setTi({ ...deleteEntry(date, run.svcId, run.veh, run.dir, getTI()) })} />
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </Card>
      )}

      {tab === "trend" && (
        <Card t={t} title="Is the plan drifting?"
          hint="One point per service day. A single bad day is weather; a line that sits above zero for a fortnight is an estimate that needs re-cutting. Bars show how much of each day was actually written down — a day with low coverage is not evidence."
          right={<Segmented t={t} small value={win} onChange={setWin} options={WINDOWS} />}>
          {series.every((s) => !s.recorded) ? (
            <Empty t={t} title="Nothing recorded in this window"
              sub="Enter a day or two on the This day tab and the trend builds itself." />
          ) : (
            <>
              <ResponsiveContainer width="100%" height={260}>
                <ComposedChart data={series} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={t.grid} vertical={false} />
                  {/* 180 dates cannot each carry a label; preserveStartEnd + a gap keeps the
                      axis readable at every window instead of turning into a grey smear. */}
                  <XAxis dataKey="label" tick={{ fill: t.muted, fontSize: 10 }} tickLine={false}
                    axisLine={{ stroke: t.border }} interval="preserveStartEnd" minTickGap={26} />
                  <YAxis yAxisId="cov" orientation="right" domain={[0, 100]} width={38} tick={{ fill: t.faint, fontSize: 10 }} tickLine={false} axisLine={false} unit="%" />
                  <YAxis yAxisId="min" width={44} tick={{ fill: t.muted, fontSize: 11 }} tickLine={false} axisLine={false} unit="m" />
                  <Tooltip content={<TrendTip t={t} />} />
                  <ReferenceLine yAxisId="min" y={0} stroke={t.border} />
                  <Bar yAxisId="cov" dataKey="coverage" name="Recorded" barSize={16} radius={[3, 3, 0, 0]}>
                    {series.map((s, i) => (
                      <Cell key={i} fill={s.sunday ? t.surface2 : t.primarySoft} />
                    ))}
                  </Bar>
                  <Line yAxisId="min" type="monotone" dataKey="pickupMedian" name="Late to the gate"
                    stroke={t.primary} strokeWidth={2.5} dot={+win <= 30 ? { r: 3 } : false} connectNulls={false} />
                  <Line yAxisId="min" type="monotone" dataKey="dropMedian" name="Home run"
                    stroke={t.muted} strokeWidth={1.75} strokeDasharray="5 4"
                    dot={+win <= 30 ? { r: 2 } : false} connectNulls={false} />
                </ComposedChart>
              </ResponsiveContainer>
              <div className="overflow-x-auto mt-3">
                <table className="w-full text-sm" style={{ minWidth: 760 }}>
                  <thead><tr style={{ background: t.surface2 }}>
                    {["Day", "Recorded", "To the gate", "Home run", "Pickups on time", "Took vs plan", "Notes"].map((h) => (
                      <th key={h} className="py-2 px-3 text-xs font-semibold uppercase tracking-wider text-left" style={{ color: t.muted }}>{h}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {[...series].reverse().slice(0, TABLE_ROWS).map((s) => (
                      <tr key={s.date} style={{ borderTop: "1px solid " + t.border, opacity: s.recorded ? 1 : 0.5 }}>
                        <td className="py-2 px-3 tabular-nums whitespace-nowrap" style={{ color: t.text }}>
                          {s.date}{s.sunday && <span className="text-xs ml-1.5" style={{ color: t.faint }}>Sun</span>}
                        </td>
                        <td className="py-2 px-3 tabular-nums" style={{ color: t.muted }}>
                          {s.recorded}/{s.expected}
                          {s.coverage != null && <span className="text-xs ml-1" style={{ color: s.coverage < 50 ? t.watch : t.faint }}>{s.coverage}%</span>}
                        </td>
                        <td className="py-2 px-3 tabular-nums font-semibold"
                          style={{ color: s.pickup.medianEnd == null ? t.faint : onTime(s.pickup.medianEnd) ? t.good : t.watch }}>
                          {s.pickup.medianEnd == null ? "—" : mins(s.pickup.medianEnd)}
                          {s.pickup.n ? <span className="text-xs ml-1 font-normal" style={{ color: t.faint }}>of {s.pickup.n}</span> : null}
                        </td>
                        <td className="py-2 px-3 tabular-nums" style={{ color: t.muted }}>
                          {s.drop.medianEnd == null ? "—" : mins(s.drop.medianEnd)}
                          {s.drop.n ? <span className="text-xs ml-1" style={{ color: t.faint }}>of {s.drop.n}</span> : null}
                        </td>
                        <td className="py-2 px-3 tabular-nums" style={{ color: t.muted }}>
                          {s.pickup.onTimePct == null ? "—" : `${s.pickup.onTimePct}%`}
                        </td>
                        <td className="py-2 px-3 tabular-nums" style={{ color: t.muted }}>{s.medianRide == null ? "—" : mins(s.medianRide)}</td>
                        <td className="py-2 px-3 text-xs" style={{ color: t.faint }}>
                          {[s.bulk ? `${s.bulk} asserted` : "", s.notRun ? `${s.notRun} not run` : "",
                            s.unmeasurable ? `${s.unmeasurable} assumed-clock` : "", s.noPlan ? `${s.noPlan} unplanned` : ""]
                            .filter(Boolean).join(" · ") || "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {series.length > TABLE_ROWS && (
                <div className="text-xs mt-2" style={{ color: t.faint }}>
                  Showing the most recent {TABLE_ROWS} of {series.length} days — the chart above covers the whole window.
                </div>
              )}
            </>
          )}
        </Card>
      )}

      {tab === "bus" && (
        <Card t={t} title="Which buses are consistently out"
          hint="Across the whole window, not one day. Sorted by how far a bus typically is from its planned gate time — the ones at the top are where either the driver or the estimate needs attention.">
          {!perBus.length ? (
            <Empty t={t} title="No records in this window" sub="Enter a day on the This day tab first." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" style={{ minWidth: 780 }}>
                <thead><tr style={{ background: t.surface2 }}>
                  {["Bus", "Service", "Days", "Timed", "To the gate", "Home run", "On time", "Worst"].map((h) => (
                    <th key={h} className="py-2 px-3 text-xs font-semibold uppercase tracking-wider text-left" style={{ color: t.muted }}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {perBus.map((b) => (
                    <tr key={b.svc.id + b.veh} style={{ borderTop: "1px solid " + t.border }}>
                      <td className="py-2 px-3 font-semibold tabular-nums" style={{ color: t.text }}>{b.veh}</td>
                      <td className="py-2 px-3" style={{ color: t.muted }}>
                        <span className="inline-block w-2 h-2 rounded-sm mr-1.5 align-middle" style={{ background: b.svc.color }} />
                        {b.svc.name}
                      </td>
                      <td className="py-2 px-3 tabular-nums" style={{ color: t.muted }}>{b.days}</td>
                      <td className="py-2 px-3 tabular-nums" style={{ color: t.muted }}>
                        {b.pickup.n + b.drop.n}
                        {b.bulk ? <span className="text-xs ml-1" style={{ color: t.faint }}>{b.bulk} asserted</span> : null}
                      </td>
                      <td className="py-2 px-3 tabular-nums font-semibold"
                        style={{ color: b.pickup.medianEnd == null ? t.faint : onTime(b.pickup.medianEnd) ? t.good : Math.abs(b.pickup.medianEnd) > 20 ? t.poor : t.watch }}>
                        {b.pickup.medianEnd == null ? "—" : mins(b.pickup.medianEnd)}
                      </td>
                      <td className="py-2 px-3 tabular-nums" style={{ color: t.muted }}>{b.drop.medianEnd == null ? "—" : mins(b.drop.medianEnd)}</td>
                      <td className="py-2 px-3 tabular-nums" style={{ color: t.muted }}>{b.pickup.onTimePct == null ? "—" : b.pickup.onTimePct + "%"}</td>
                      <td className="py-2 px-3 tabular-nums" style={{ color: t.muted }}>{b.pickup.worst ? mins(b.pickup.worst.min) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

/* ---------------- one run ----------------
   Times accept "0805" as readily as "08:05" — a manager copying off a sheet should not have
   to reach for the colon key ninety-seven times. Anything unparseable is left alone rather
   than being turned into a number, because a silent NaN here becomes a fictional average
   three screens away. */
/** "tomorrow (28 Aug)" — a run that lands on another calendar day says which. */
const dayLabel = (serviceDay, offset) => {
  const d = addDays(serviceDay, offset || 0);
  const nice = new Date(d + "T00:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short" });
  return offset === 0 ? nice : offset === 1 ? `next day, ${nice}` : offset === -1 ? `previous day, ${nice}` : nice;
};

function RunRow({ t, run, entry, save, onClear, date }) {
  const v = variance(entry);
  const notRun = entry && entry.status === STATUS.NOT_RUN;
  const [draft, setDraft] = useState({ s: "", e: "" });
  useEffect(() => {
    setDraft({ s: entry && entry.actualStart != null ? fmtClock(entry.actualStart) : "",
               e: entry && entry.actualEnd != null ? fmtClock(entry.actualEnd) : "" });
  }, [entry && entry.actualStart, entry && entry.actualEnd]);       // eslint-disable-line

  const commit = (which, raw) => {
    const txt = String(raw || "").trim();
    if (!txt) { save(run, which === "s" ? { actualStart: null } : { actualEnd: null }); return; }
    const m = parseClock(txt);
    if (m == null) return;                                          // leave the bad text visible to be corrected
    save(run, { ...(which === "s" ? { actualStart: m } : { actualEnd: m }), bulk: false });
  };
  const box = {
    background: t.inputBg, border: "1px solid " + t.border, color: t.text,
    width: 74, textAlign: "center",
  };

  return (
    <tr style={{ borderTop: "1px solid " + t.border, opacity: notRun ? 0.55 : 1 }}>
      <td className="py-2 px-3 font-semibold tabular-nums whitespace-nowrap" style={{ color: t.text }}>{run.veh}</td>
      <td className="py-2 px-3 whitespace-nowrap" style={{ color: t.muted }}>
        <span className="inline-block w-2 h-2 rounded-sm mr-1.5 align-middle" style={{ background: run.svc.color }} />
        {run.svc.name} <b style={{ color: t.text }}>{run.dir}</b>
      </td>
      {/* A full-night drop leaves at 06:00 the NEXT morning. The record is still filed under
          the service day it belongs to, so the calendar date is printed here rather than left
          for the manager to work out — otherwise those thirteen runs get filed under tomorrow
          and the day reads half-empty for ever. */}
      <td className="py-2 px-3 tabular-nums whitespace-nowrap" style={{ color: t.muted }}>
        {fmtClock(run.start)} → {fmtClock(run.end)}
        <span className="text-xs ml-1.5" style={{ color: t.faint }}>{run.ride}m</span>
        {(run.startDay || run.endDay) ? (
          <span className="text-[10px] block" style={{ color: t.primary }}>
            {run.startDay === run.endDay
              ? `on ${dayLabel(date, run.startDay)}`
              : `${dayLabel(date, run.startDay)} → ${dayLabel(date, run.endDay)}`}
          </span>
        ) : null}
        {run.dir === "drop" && run.assumedOff && (
          <span className="text-[10px] block" style={{ color: t.watch }}>release time assumed</span>
        )}
      </td>
      <td className="py-2 px-2">
        <input value={draft.s} disabled={notRun} placeholder={entry && entry.bulk ? "to plan" : "—"}
          aria-label={`Actual start for ${run.veh} ${run.dir}`}
          onChange={(e) => setDraft((d) => ({ ...d, s: e.target.value }))}
          onBlur={(e) => commit("s", e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
          className="rounded-lg px-2 py-1.5 text-sm tabular-nums outline-none" style={box} />
      </td>
      <td className="py-2 px-2">
        <input value={draft.e} disabled={notRun} placeholder={entry && entry.bulk ? "to plan" : "—"}
          aria-label={`Actual end for ${run.veh} ${run.dir}`}
          onChange={(e) => setDraft((d) => ({ ...d, e: e.target.value }))}
          onBlur={(e) => commit("e", e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
          className="rounded-lg px-2 py-1.5 text-sm tabular-nums outline-none" style={box} />
      </td>
      <td className="py-2 px-3 tabular-nums whitespace-nowrap"
        style={{ color: !v.clockValid ? t.faint : onTime(v.endVar) ? t.good : Math.abs(v.endVar) > 20 ? t.poor : t.watch }}>
        {v.clockValid ? mins(v.endVar) : "—"}
        {entry && entry.bulk && (
          <span className="text-[10px] block" style={{ color: t.faint }}>ran to plan (not timed)</span>
        )}
        {v.suspect && (
          <button type="button" onClick={() => save(run, { confirmed: true })}
            title={v.suspectReason + " — click to confirm it really happened"}
            className="text-[10px] block underline text-left" style={{ color: t.watch, cursor: "pointer" }}>
            looks wrong — confirm?
          </button>
        )}
        {!v.clockValid && !v.suspect && v.ran && entry && !entry.bulk && (
          <span className="text-[10px] block" style={{ color: t.watch }} title={v.reason}>not comparable</span>
        )}
      </td>
      <td className="py-2 px-3 tabular-nums whitespace-nowrap" style={{ color: t.muted }}>
        {v.actualRide == null ? "—" : `${v.actualRide}m`}
        {v.rideVar != null && <span className="text-xs ml-1" style={{ color: v.rideVar > 0 ? t.watch : t.good }}>{mins(v.rideVar)}</span>}
      </td>
      <td className="py-2 px-2 whitespace-nowrap">
        <button type="button" aria-pressed={!!notRun}
          title={notRun ? "Mark this bus as having run" : "Mark this bus as not run today"}
          onClick={() => save(run, notRun ? { status: STATUS.RAN } : { status: STATUS.NOT_RUN, actualStart: null, actualEnd: null })}
          className="rounded-lg px-1.5 py-0.5 text-[10px] font-semibold"
          style={{ background: notRun ? t.watchSoft : "transparent", color: notRun ? t.watch : t.faint,
                   border: "1px solid " + (notRun ? t.watch : t.border), cursor: "pointer" }}>
          {notRun ? "did not run" : "no-run"}
        </button>
        {entry && (
          <button type="button" onClick={onClear} title="Clear this record"
            className="rounded-lg px-1.5 py-0.5 text-[10px] ml-1" style={{ color: t.faint, cursor: "pointer" }}>
            clear
          </button>
        )}
      </td>
    </tr>
  );
}

function TrendTip({ active, payload, t }) {
  if (!active || !payload || !payload.length) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-lg px-3 py-2 text-xs" style={{ background: t.raised || t.surface, border: "1px solid " + t.border, color: t.text }}>
      <div className="font-semibold">{d.date}{d.sunday ? " · Sunday" : ""}</div>
      <div style={{ color: t.muted }}>{d.recorded} of {d.expected} recorded{d.coverage != null ? ` (${d.coverage}%)` : ""}</div>
      <div style={{ color: t.muted }}>to the gate {d.pickup.medianEnd == null ? "—" : mins(d.pickup.medianEnd)}
        {d.pickup.n ? ` (${d.pickup.n} timed)` : ""}</div>
      <div style={{ color: t.muted }}>home run {d.drop.medianEnd == null ? "—" : mins(d.drop.medianEnd)}
        {d.drop.n ? ` (${d.drop.n} timed)` : ""}</div>
      {d.bulk ? <div style={{ color: t.faint }}>{d.bulk} asserted, not timed</div> : null}
      {d.unmeasurable ? <div style={{ color: t.watch }}>{d.unmeasurable} on an assumed release time</div> : null}
    </div>
  );
}
