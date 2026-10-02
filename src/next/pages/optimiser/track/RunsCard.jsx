/* This day: one row per run the finalised plan expects, with the times the bus attendance app
   recorded. A leader taps Start journey when the bus leaves its parking and End journey when it
   arrives, and tiGps.js files each journey on the run it belongs to. Nothing is typed here (Akhil,
   2026-10-02): a run with no journey is not counted, never assumed on time. Journeys that match no
   planned run are listed under the table as trips not in the plan. With several services the runs
   fold into one group per service, each header carrying that service's lateness to the gate. */
import React, { useEffect, useMemo, useState } from "react";
import { Download, FileWarning, Route as RouteIcon, SearchX } from "lucide-react";
import { SOURCE, STATUS, fmtClock, isSunday, summarise, variance } from "../../../../optimiser/trackImpl.js";
import { EXTRAS_EVENT, getExtraTrips, minOfDay } from "../../../../optimiser/tiGps.js";
import { Alert, Button, Card, CardTitle, DataTable, Progress, Search, Skeleton, Tag, cx, tdCls, thCls } from "../../../ui.jsx";
import { DASH, count, day, duration, kms, plural, squash } from "../../../format.js";
import { go } from "../../../route.js";
import { useKept } from "../../bus/parts.jsx";
import { DIR, Dot, FlatEmpty, GroupRow, Sub, dayTone, lateTag, onDay, plain, rideVsPlan, signedMin, useGroups } from "./parts.jsx";

const COLS = 7;
const ZEBRA = "bg-satin/70";
const SUNDAY = "Sunday: the factory does not normally run";

/** A recorded clock time with what it marks; "—" and why when there is none. */
function Clock({ value, sub, empty }) {
  if (value == null) return <><span className="text-ink-4">{DASH}</span>{empty && <Sub>{empty}</Sub>}</>;
  return <><span className="font-code font-semibold">{fmtClock(value)}</span>{sub && <Sub>{sub}</Sub>}</>;
}

function RunRow({ run, entry, save, date, zebra }) {
  const v = variance(entry);
  const notRun = entry && entry.status === STATUS.NOT_RUN;
  const gps = entry && entry.source === SOURCE.TRACKER;
  const pickup = run.dir === "pickup";
  const offDay = run.startDay || run.endDay;
  const ride = rideVsPlan(v.rideVar);

  return (
    <tr className={cx(zebra && ZEBRA, notRun && "[&>td]:opacity-60")}>
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
      <td className={cx(tdCls, "whitespace-nowrap")}>
        {notRun ? <span className="text-ink-3">Did not run</span>
          : <Clock value={entry && entry.actualStart} empty={entry ? null : "No journey yet"}
              sub={gps ? (pickup ? "Left parking" : "Left") : entry ? "Typed earlier" : null} />}
      </td>
      <td className={cx(tdCls, "whitespace-nowrap")}>
        {gps && entry.live
          ? <Tag tone="nova" className="!px-2.5 !py-0.5" title="The journey is still recording; the end time arrives when the leader taps End journey">Still out</Tag>
          : <Clock value={entry && !notRun ? entry.actualEnd : null} sub={gps ? (pickup ? "At the gate" : "Last stop") : null} />}
      </td>
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
        {!v.clockValid && !v.suspect && v.ran && entry && !entry.bulk && !entry.live && <Sub tone="warn" title={v.reason}>Not comparable</Sub>}
      </td>
      <td className={cx(tdCls, "whitespace-nowrap")}>
        {v.actualRide == null || (gps && entry.live) ? <span className="text-ink-4">{DASH}</span> : <span className="tabular-nums">{duration(v.actualRide)}</span>}
        {gps && pickup && v.actualRide != null && !entry.live ? <Sub>from parking</Sub> : ride && <Sub tone={v.rideVar > 0 ? "warn" : v.rideVar < 0 ? "ok" : null}>{ride}</Sub>}
        {gps && entry.journeyKm != null && <Sub>{kms(entry.journeyKm)} km</Sub>}
      </td>
    </tr>
  );
}

/** Journeys the GPS recorded on this day that match no planned run: extra trips, listed as they are. */
function useExtraTrips(date) {
  const [all, setAll] = useState(getExtraTrips);
  useEffect(() => {
    const on = () => setAll(getExtraTrips());
    window.addEventListener(EXTRAS_EVENT, on);
    return () => window.removeEventListener(EXTRAS_EVENT, on);
  }, []);
  return useMemo(() => all.filter((j) => j.serviceDate === date), [all, date]);
}

function ExtraTrips({ trips }) {
  if (!trips.length) return null;
  return (
    <div className="px-5 pb-5 sm:px-6">
      <h3 className="text-[15px] font-bold tracking-[-0.01em] text-ink">Trips not in the plan <span className="font-semibold text-ink-3">{count(trips.length)}</span></h3>
      <p className="mt-0.5 text-[13px] text-ink-3">Journeys recorded more than 3 hours from any planned run of their bus</p>
      <ul className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {trips.map((j) => (
          <li key={j.id} className="flex items-center gap-3 rounded-tile bg-satin px-4 py-2.5">
            <RouteIcon size={16} aria-hidden className="shrink-0 text-ink-3" />
            <span className="min-w-0 flex-1 truncate font-code text-[13px] font-semibold text-ink">{j.busId}</span>
            <span className="font-code text-[13px] text-ink-2">{fmtClock(minOfDay(j.startedAt))}–{j.endedAt != null ? fmtClock(minOfDay(j.endedAt)) : "now"}</span>
            <span className="text-[13px] tabular-nums text-ink-3">{kms(j.km)} km</span>
          </li>
        ))}
      </ul>
    </div>
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
  const { rows, day: d, save, noPlans, quota } = board;
  const [q, setQ] = useKept(`ti:q:${svc ? svc.id : "all"}`, "");
  const extras = useExtraTrips(date);

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

  const history = (
    <>
      <Button variant="secondary" size="sm" icon={Download} onClick={onExport} disabled={!canExport} title={canExport ? "Every T.I entry, as a JSON file" : "Nothing recorded yet"}>Export JSON</Button>
    </>
  );

  if (!loading && noPlans) return <NoPlan svc={svc} date={date} actions={history} />;

  return (
    <Card padding="none">
      <div className="px-5 pt-5 sm:px-6">
        <CardTitle className="!mb-3" sub={isSunday(date) ? SUNDAY : null}
          title={<span title="One row per run the finalised plan expects. Times come from the bus attendance app's journeys; a run with no journey is not counted, never assumed on time.">Runs on {day(date)}</span>} />
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Search value={q} onChange={setQ} label="Search bus or service" placeholder="Bus or service" className="w-full sm:w-[300px]" />
          <div className="flex flex-wrap gap-2 sm:ml-auto">
            {history}
          </div>
        </div>
        {d.suspect > 0 && (
          <Alert tone="warn" className="mt-3">
            {d.suspect === 1 ? "1 time looks wrong, so it is" : `${count(d.suspect)} times look wrong, so they are`} left out of the figures.
            Press Confirm on the row if it really happened.
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
 />
                ))}
              </tbody>
            ))}
          </DataTable>
        ) : (
          <FlatEmpty icon={SearchX} className="m-1 rounded-tile bg-satin px-5 py-4" title={`No run matches “${q.trim()}”`}
            action={<Button variant="secondary" onClick={() => setQ("")}>Clear search</Button>} />
        )}
      </div>
      <ExtraTrips trips={extras} />
    </Card>
  );
}
