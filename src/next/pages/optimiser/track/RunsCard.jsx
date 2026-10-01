/* This day: one row per run the finalised plan expects, with the times the vehicle manager reports.
   Saving, clearing, the did-not-run switch and the bulk "ran to plan" mark are the old board's own
   (useTrackImpl, commitClock, toggleNotRun in TrackImplView.jsx); a run left blank is not counted,
   never assumed on time. With several services the runs fold into one group per service, each
   header carrying that service's lateness to the gate and how much of it is recorded. */
import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, Download, FileWarning, SearchX, Upload, X } from "lucide-react";
import { STATUS, fmtClock, isSunday, parseClock, summarise, variance } from "../../../../optimiser/trackImpl.js";
import { commitClock, toggleNotRun } from "../../../../optimiser/TrackImplView.jsx";
import { Alert, Button, Card, CardTitle, DataTable, IconButton, Input, Progress, Search, Skeleton, Tag, cx, tdCls, thCls } from "../../../ui.jsx";
import { DASH, count, day, duration, plural, squash } from "../../../format.js";
import { go } from "../../../route.js";
import { useKept } from "../../bus/parts.jsx";
import { DIR, Dot, FlatEmpty, GroupRow, Sub, dayTone, lateTag, onDay, plain, rideVsPlan, signedMin, useGroups } from "./parts.jsx";

const COLS = 8;
const ZEBRA = "bg-satin/70";
const SUNDAY = "Sunday: the factory does not normally run";

/** A typed time: a compact pill field in mono. Saved when it loses focus or on Enter. */
function TimeField({ value, onChange, onCommit, wrong, ...rest }) {
  return (
    <Input value={value} inputMode="numeric" autoComplete="off" spellCheck={false} {...rest}
      title="Type 08:05 or 0805. It saves when you leave the field."
      aria-invalid={wrong || undefined}
      onChange={(e) => onChange(e.target.value)} onBlur={(e) => onCommit(e.target.value)}
      onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
      className={cx("!h-9 !w-[88px] !px-2 text-center font-code !text-[13px]", wrong && "!bg-bad-soft !text-bad-ink")} />
  );
}

function RunRow({ run, entry, save, onClear, date, zebra }) {
  const v = variance(entry);
  const notRun = entry && entry.status === STATUS.NOT_RUN;
  const uid = useId();
  const [draft, setDraft] = useState({ s: "", e: "" });
  const [wrong, setWrong] = useState({ s: false, e: false });
  useEffect(() => {
    setDraft({ s: entry && entry.actualStart != null ? fmtClock(entry.actualStart) : "",
               e: entry && entry.actualEnd != null ? fmtClock(entry.actualEnd) : "" });
    setWrong({ s: false, e: false });
  }, [entry && entry.actualStart, entry && entry.actualEnd]); // eslint-disable-line react-hooks/exhaustive-deps

  // "0805" works as well as "08:05"; anything else stays visible, marked, to be corrected
  const commit = (which, raw) => {
    const txt = String(raw || "").trim();
    setWrong((w) => ({ ...w, [which]: !!txt && parseClock(txt) == null }));
    commitClock(save, run, which, raw);
  };
  const field = (which, label) => (
    <>
      <TimeField value={draft[which]} disabled={notRun} wrong={wrong[which]}
        placeholder={entry && entry.bulk ? "To plan" : "hh:mm"} aria-label={`${label} for ${run.veh} ${run.dir}`}
        aria-describedby={wrong[which] ? `${uid}-${which}` : undefined}
        onChange={(t) => { setDraft((d) => ({ ...d, [which]: t })); setWrong((w) => ({ ...w, [which]: false })); }}
        onCommit={(t) => commit(which, t)} />
      {wrong[which] && <Sub tone="bad" id={`${uid}-${which}`} role="alert">Type it as 08:05</Sub>}
    </>
  );
  const offDay = run.startDay || run.endDay;
  const ride = rideVsPlan(v.rideVar);

  return (
    <tr className={cx(zebra && ZEBRA, notRun && "[&>td:not(:last-child)]:opacity-60")}>
      <td className={cx(tdCls, "whitespace-nowrap font-code font-semibold")}>{run.veh}</td>
      <td className={cx(tdCls, "whitespace-nowrap")}>
        <span className="inline-flex items-center gap-2"><Dot color={run.svc.color} /><span className="font-semibold">{DIR[run.dir] || run.dir}</span></span>
      </td>
      {/* A full-night drop leaves the next morning but is filed under the service day it belongs to,
          so the calendar day is printed rather than left to be worked out. */}
      <td className={cx(tdCls, "whitespace-nowrap")}>
        <span className="font-code">{fmtClock(run.start)}–{fmtClock(run.end)}</span>
        <span className="ml-2 text-ink-3">{duration(run.ride)}</span>
        {offDay ? <Sub>{run.startDay === run.endDay ? `on ${onDay(date, run.startDay)}` : `${onDay(date, run.startDay)} to ${onDay(date, run.endDay)}`}</Sub> : null}
        {run.dir === "drop" && run.assumedOff && <Sub tone="warn" title="The ERP gives a gate time but no release time, so an 8-hour shift is assumed">Release time assumed</Sub>}
      </td>
      <td className={cx(tdCls, "py-2")}>{field("s", "Actual start")}</td>
      <td className={cx(tdCls, "py-2")}>{field("e", "Actual end")}</td>
      <td className={cx(tdCls, "whitespace-nowrap")}>
        {v.clockValid && v.endVar != null
          ? <Tag tone={lateTag(v.endVar)} className="!px-2.5 !py-0.5">{signedMin(v.endVar)}</Tag>
          : <span className="text-ink-4">{DASH}</span>}
        {entry && entry.bulk && <Sub>Ran to plan, not timed</Sub>}
        {v.suspect && (
          <span className="mt-0.5 flex items-center gap-2 whitespace-nowrap text-[13px]">
            <span className="text-warn-ink" title={plain(v.suspectReason)}>Looks wrong</span>
            <button type="button" onClick={() => save(run, { confirmed: true })} title={`${plain(v.suspectReason)}. Confirm it really happened.`}
              className="rounded-pill bg-warn-soft px-2 py-0.5 font-semibold text-warn-ink transition-colors hover:bg-warn-soft/70">Confirm</button>
          </span>
        )}
        {!v.clockValid && !v.suspect && v.ran && entry && !entry.bulk && <Sub tone="warn" title={v.reason}>Not comparable</Sub>}
      </td>
      <td className={cx(tdCls, "whitespace-nowrap")}>
        {v.actualRide == null ? <span className="text-ink-4">{DASH}</span> : <span className="tabular-nums">{duration(v.actualRide)}</span>}
        {ride && <Sub tone={v.rideVar > 0 ? "warn" : v.rideVar < 0 ? "ok" : null}>{ride}</Sub>}
      </td>
      <td className={cx(tdCls, "whitespace-nowrap py-2")}>
        <span className="flex items-center justify-end gap-1">
          <button type="button" aria-pressed={!!notRun} onClick={() => toggleNotRun(save, run, notRun)}
            aria-label={`Did not run: ${run.veh} ${DIR[run.dir] || run.dir}`}
            title={notRun ? "Mark this bus as having run" : "Mark this bus as not run today"}
            className={cx("h-9 rounded-pill px-3 text-[13px] font-semibold transition-colors duration-150",
              notRun ? "bg-warn-soft text-warn-ink" : "text-ink-3 hover:bg-satin-2 hover:text-ink")}>
            Did not run
          </button>
          {entry ? <IconButton label={`Clear what was entered for ${run.veh} ${run.dir}`} icon={X} variant="ghost" size="sm" onClick={onClear} />
            : <span aria-hidden className="h-9 w-9" />}
        </span>
      </td>
    </tr>
  );
}

/** Nothing to mark against: what is missing, where it is fixed, and the history actions beside it. */
function NoPlan({ svc, date, actions }) {
  const single = svc && !svc.overall;
  return (
    <Card>
      <FlatEmpty icon={FileWarning} title="No finalised plan to mark against"
        hint={<>
          {!single ? "None of the services has a plan yet."
            : svc.slot ? `${svc.name} has no plan for this week. Finalise one in the Planner.`
            : `${svc.name} has no plan yet. Finalise one in the Planner, then the times can be measured against it.`}
          {isSunday(date) && <span className="block">{SUNDAY}</span>}
        </>}
        action={<>
          {single && <Button variant="primary" onClick={() => go("optimiser", `${svc.id}/planner`)}>Open the Planner</Button>}
          {actions}
        </>} />
    </Card>
  );
}

function RowsSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading the plan" className="flex flex-col gap-2 pt-1">
      {Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-12 !rounded-[14px]" />)}
    </div>
  );
}

export default function RunsCard({ board, svc, date, loading, multi, toast, onExport, canExport }) {
  const { rows, ti, day: d, save, clear, importFile, noPlans, quota, confirmRest } = board;
  const [q, setQ] = useKept(`ti:q:${svc ? svc.id : "all"}`, "");
  const [pending, setPending] = useState(null); // a large bulk mark waiting for its confirm
  const file = useRef(null);
  // the count it asks about goes stale once anything is entered
  useEffect(() => setPending(null), [date, ti]);

  const sq = squash(q);
  const { isOpen, toggle } = useGroups("ti:open", multi, sq);
  const shown = useMemo(() => (sq ? rows.filter(({ run }) => squash(run.veh).includes(sq) || squash(run.svc.name).includes(sq)) : rows), [rows, sq]);
  const groups = useMemo(() => {
    const m = new Map();
    for (const r of rows) {
      const id = r.run.svc.id;
      if (!m.has(id)) m.set(id, { svc: r.run.svc, total: 0, done: 0, entries: [], list: [] });
      const g = m.get(id);
      g.total++;
      if (r.entry) { g.done++; g.entries.push(r.entry); }
    }
    for (const r of shown) m.get(r.run.svc.id).list.push(r);
    return [...m.values()].filter((g) => g.list.length).map((g) => ({ ...g, gate: multi ? summarise(g.entries).pickup.medianEnd : null }));
  }, [rows, shown, multi]);
  const anyOpen = groups.some((g) => isOpen(g.svc.id));

  const markRest = () => confirmRest((left, svcs) => { setPending({ n: left.length, svcs }); return false; });
  const confirmPending = () => { setPending(null); confirmRest(() => true); };
  const pickFile = (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    importFile(f);
    e.target.value = "";
  };

  const history = (
    <>
      <Button variant="secondary" size="sm" icon={Download} onClick={onExport} disabled={!canExport} title={canExport ? "Every T.I entry, as a JSON file" : "Nothing recorded yet"}>Export JSON</Button>
      <Button variant="secondary" size="sm" icon={Upload} onClick={() => file.current && file.current.click()} title="Merge a T.I export from another machine">Import JSON</Button>
      <input ref={file} type="file" accept="application/json" className="hidden" onChange={pickFile} tabIndex={-1} aria-hidden />
    </>
  );

  if (!loading && noPlans) return <NoPlan svc={svc} date={date} actions={history} />;

  return (
    <Card padding="none">
      <div className="px-5 pt-5 sm:px-6">
        <CardTitle className="!mb-3" sub={isSunday(date) ? SUNDAY : null}
          title={<span title="One row per run the finalised plan expects. Type the times the vehicle manager reports; a run with no entry is not counted, never assumed on time.">Runs on {day(date)}</span>} />
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Search value={q} onChange={setQ} label="Search bus or service" placeholder="Bus or service" className="w-full sm:w-[300px]" />
          <div className="flex flex-wrap gap-2 sm:ml-auto">
            {!loading && !pending && <Button variant="secondary" size="sm" icon={Check} onClick={markRest}>Mark the rest as run to plan</Button>}
            {history}
          </div>
        </div>
        {pending && (
          <div className="mt-3 flex flex-wrap items-center gap-3 rounded-tile bg-satin px-4 py-3">
            <p className="min-w-0 flex-1 text-[13px] text-ink-2">
              <b className="font-semibold text-ink">Mark {plural(pending.n, "run", "runs")} on {day(date)} as run to plan?</b>{" "}
              Across {pending.svcs.join(", ")}. This says the day is accounted for: it records no times and does not count toward on time.
            </p>
            <Button variant="ghost" size="sm" onClick={() => setPending(null)}>Cancel</Button>
            <Button variant="primary" size="sm" onClick={confirmPending}>Mark {plural(pending.n, "run", "runs")}</Button>
          </div>
        )}
        {d.suspect > 0 && (
          <Alert tone="warn" className="mt-3">
            {d.suspect === 1 ? "1 time looks mistyped, so it is" : `${count(d.suspect)} times look mistyped, so they are`} left out of the figures.
            Correct {d.suspect === 1 ? "it" : "them"}, or press Confirm on the row.
          </Alert>
        )}
        {quota.pct >= 70 && (
          <Alert tone={quota.pct >= 90 ? "bad" : "warn"} className="mt-3">
            History is using {(quota.bytes / 1024 / 1024).toFixed(1)} MB of about 5 MB. Export it now: these times exist nowhere else,
            and once the browser refuses a save nothing more can be kept.
          </Alert>
        )}
      </div>

      <div className="px-2 pb-3 pt-3 sm:px-3">
        {loading ? <RowsSkeleton /> : shown.length ? (
          <DataTable label={`Runs on ${day(date)}`}>
            {anyOpen && (
              <thead>
                <tr>
                  <th className={thCls}>Bus</th>
                  <th className={thCls}>Run</th>
                  <th className={thCls}>Plan says</th>
                  <th className={thCls}>Actual start</th>
                  <th className={thCls}>Actual end</th>
                  <th className={thCls}>Lateness</th>
                  <th className={thCls}>Took</th>
                  <th className={thCls}><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
            )}
            {groups.map((g) => (
              <tbody key={g.svc.id}>
                {multi && (
                  <GroupRow cols={COLS} svc={g.svc} open={isOpen(g.svc.id)} onToggle={() => toggle(g.svc.id)}
                    summary={`${count(g.done)} of ${plural(g.total, "run", "runs")} recorded`}
                    right={<>
                      {g.gate != null && (
                        <span className="inline-flex items-center gap-2 text-[13px] text-ink-3">
                          To the gate <Tag tone={dayTone(g.gate)} className="!px-2.5 !py-0.5">{signedMin(g.gate)}</Tag>
                        </span>
                      )}
                      <Progress value={g.done} max={g.total} size="sm" className="w-40" label={`${g.svc.name}: ${count(g.done)} of ${count(g.total)} recorded`} />
                    </>} />
                )}
                {isOpen(g.svc.id) && g.list.map(({ run, entry }, i) => (
                  <RunRow key={`${run.svcId}|${run.veh}|${run.dir}`} run={run} entry={entry} save={save} date={date} zebra={i % 2 === 1}
                    onClear={() => { try { clear(run); } catch (e) { toast(e.message || "Could not save"); } }} />
                ))}
              </tbody>
            ))}
          </DataTable>
        ) : (
          <FlatEmpty icon={SearchX} className="m-1 rounded-tile bg-satin px-5 py-4" title={`No run matches “${q.trim()}”`}
            action={<Button variant="secondary" onClick={() => setQ("")}>Clear search</Button>} />
        )}
      </div>
    </Card>
  );
}
