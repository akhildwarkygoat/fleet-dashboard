/* Timings: every bus on one 24-hour clock, one row per bus and one pill per run, across every
   service at once. Overlapping runs on one bus are the collisions this board exists to catch, so
   collisions are the one big number. Then which group runs each Rotational slot this week, which
   services are not on the clock yet, and the clock last, so nothing sits under its inner scroller.
   Everything shown comes from the old board's hook and helpers (useTimings, slotRow in
   TimingsView.jsx); this file only lays them out. */
import React, { useRef } from "react";
import { useTimings, slotRow, groupLabel } from "../../../optimiser/TimingsView.jsx";
import { ROTATION_SLOTS, SERVICES, fmtClock, serviceNeed } from "../../../optimiser/services.js";
import { ROTA_WEEK } from "../../../erp.js";
import { Aura, Badge, Card, CardTitle, Eyebrow, Skeleton, Stat, Tile, Tiles, Unit, cx, useRise } from "../../ui.jsx";
import { DASH, count, day, plural } from "../../format.js";
import { Count } from "../bus/parts.jsx";
import Clock from "./timings/Clock.jsx";
import { Dot, GhostRows, plainNeed } from "./timings/parts.jsx";

/** Collisions, the board's one number, with the buses behind it. Pressing it shows only those buses. */
function Hero({ rows, total, busy, clashOnly, onToggle, className }) {
  const hit = rows.filter((r) => r.clashes);
  const worst = hit[0]; // rows come sorted by collisions, most first
  const body = (
    <>
      <span aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden rounded-hero">
        <Aura size={420} intensity={0.85} className="-left-32 -top-40" />
      </span>
      <span className="flex flex-1 flex-col gap-x-6 gap-y-5 sm:flex-row sm:items-end">
        <span className="flex min-w-0 flex-col">
          <span className="flex items-center gap-2"><Eyebrow>Collisions</Eyebrow>{total > 0 && <Badge tone="bad">Needs fixing</Badge>}</span>
          <span className="mt-3 text-[64px] font-bold leading-none tracking-[-0.03em] tabular-nums text-ink">
            {busy ? DASH : <Count value={total} format={count} />}
          </span>
          <span className="mt-3 text-[13px] text-ink-3">{busy ? "Loading the week’s plans" : total ? "Same bus, overlapping runs" : "No bus is double-booked"}</span>
        </span>
        <Tiles className="min-w-0 flex-1 grid-cols-2">
          <Tile label="Buses involved" value={busy ? null : count(hit.length)} />
          <Tile label="Most collisions" note={worst && !busy ? count(worst.clashes) : undefined}
            value={worst && !busy ? <span className="font-code">{worst.veh}</span> : null} />
        </Tiles>
      </span>
    </>
  );
  const cls = cx("relative isolate flex flex-col rounded-hero bg-white p-5 text-left shadow-card sm:p-6", className);
  if (!total && !clashOnly) return <section className={cls}>{body}</section>;
  return (
    <button type="button" onClick={onToggle} aria-pressed={clashOnly}
      className={cx(cls, "transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-float active:scale-[0.985]",
        clashOnly && "ring-2 ring-nova")}>
      {body}
    </button>
  );
}

/** Which group runs each Rotational slot in the week the board is drawn for. */
function SlotsCard({ rota, rotaWeek, shifts }) {
  return (
    <Card>
      <CardTitle title="Rotational slots" sub={`Week of ${day(rotaWeek)} · groups move Day → Full night → Half night every Monday`} />
      <div className="grid gap-3 sm:grid-cols-3">
        {ROTATION_SLOTS.map((sl) => {
          const { st, gid, fin, overridden } = slotRow(sl, rota, shifts);
          return (
            <div key={sl.id} className="flex min-w-0 flex-col rounded-tile bg-satin px-4 py-3">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[13px]">
                <Dot color={sl.color} />
                <span className="font-semibold text-ink">{sl.name}</span>
                <span className="ml-auto font-code text-ink-2">
                  {fmtClock(sl.from)}–{fmtClock(sl.to % 1440)}{sl.to > 24 * 60 && <span className="font-ui"> next day</span>}
                </span>
              </div>
              <p className="mt-2 text-[22px] font-bold leading-7 tracking-[-0.01em] text-ink">{groupLabel(gid)}</p>
              <p className="text-[11px] font-semibold text-ink-2">Group this week</p>
              <p className="mt-1 text-[13px] text-ink-2">
                {st ? `${plural(st.riders, "rider", "riders")} · roster of ${day(ROTA_WEEK)}` : `No riders on the roster of ${day(ROTA_WEEK)}`}
              </p>
              {overridden && (
                <p className="mt-2 text-[13px] font-medium text-warn-ink">
                  {fin.kind === "draft"
                    ? <>The Fleet plan runs “{fin.name}” instead; this clock shows the rota plan</>
                    : <>This clock and the Fleet plan both show “{fin.name}” instead of {groupLabel(gid)}’s plan</>}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

/** Services the clock cannot draw yet, and what each still needs. The tiles share the card's width. */
function WaitingCard({ waiting, shifts }) {
  return (
    <Card>
      <CardTitle title="Not on the clock yet" />
      <ul className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr))]">
        {waiting.map((s) => (
          <li key={s.id} className="flex min-w-0 flex-col gap-1 rounded-tile bg-satin px-4 py-3">
            <span className="flex items-center gap-2 text-[13px] font-semibold text-ink"><Dot color={s.color} />{s.name}</span>
            <span className="text-[13px] text-ink-2">Needs {plainNeed(serviceNeed(s, shifts) || "a plan")}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

const GHOST_CHIPS = ["w-28", "w-32", "w-36", "w-44", "w-44", "w-24", "w-40"];
const FIGURES = "grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5";
const HERO_SPAN = "col-span-2 sm:col-span-3 lg:col-span-2";

/** The board's shape while the plans first load: the figures, the slots and the clock with its rows. */
function BoardSkeleton() {
  return (
    <div aria-busy="true" className="flex flex-col gap-3">
      <div className={FIGURES}>
        <div className={cx("flex min-h-[180px] flex-col rounded-hero bg-white p-5 shadow-card sm:p-6", HERO_SPAN)}>
          <Skeleton className="h-3.5 w-24" />
          <Skeleton className="mt-auto h-14 w-24" />
          <Skeleton className="mt-3 h-3.5 w-40" />
        </div>
        {[0, 1, 2].map((i) => (
          <div key={i} className={cx("flex min-h-[132px] flex-col rounded-card bg-white p-5 shadow-card sm:p-6", i === 2 && "col-span-2 sm:col-span-1")}>
            <Skeleton className="h-3.5 w-24" />
            <Skeleton className="mt-auto h-7 w-16" />
            <Skeleton className="mt-2 h-3.5 w-32" />
          </div>
        ))}
      </div>
      <Card>
        <Skeleton className="h-4 w-36" /><Skeleton className="mt-2 h-3.5 w-72" />
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {ROTATION_SLOTS.map((sl) => <Skeleton key={sl.id} className="h-[108px]" />)}
        </div>
      </Card>
      <Card padding="none" className="overflow-hidden">
        <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-5 sm:px-6">
          <div><Skeleton className="h-4 w-36" /><Skeleton className="mt-2 h-3.5 w-64" /></div>
          <Skeleton className="h-11 w-full !rounded-pill sm:w-[440px]" />
        </div>
        <div className="mt-4 flex gap-1.5 overflow-hidden px-5 sm:px-6">
          {GHOST_CHIPS.map((w, i) => <Skeleton key={i} className={cx("h-9 shrink-0 !rounded-pill", w)} />)}
        </div>
        <GhostRows className="mt-4 pb-5" />
      </Card>
    </div>
  );
}

export default function TimingsBoard({ shifts }) {
  const tm = useTimings();
  const { loading, rows, shown, visible, totalClashes, liveCount, waiting, clashOnly, setClashOnly, rota, rotaWeek } = tm;
  // the skeleton is for the first load only: a new rota week redraws in place, keeping the clock's zoom
  const seen = useRef(false);
  if (!loading.plans) seen.current = true;
  const ready = seen.current;
  const busy = loading.plans;
  const root = useRef(null);
  useRise(root, ready);

  if (!ready) return <BoardSkeleton />;
  return (
    <div ref={root} aria-busy={busy || undefined} className="flex flex-col gap-3">
      <div data-rise className={FIGURES}>
        <Hero rows={rows} total={totalClashes} busy={busy} clashOnly={clashOnly} onToggle={() => setClashOnly(!clashOnly)} className={HERO_SPAN} />
        <Stat label="Buses shown" value={busy ? DASH : count(shown.length)}
          note={clashOnly ? `of ${count(rows.length)} · only collisions` : "One row each"} />
        <Stat label="Pickup runs" value={busy ? DASH : count(visible.length)} note={`across ${plural(liveCount, "service", "services")}`} />
        <Stat label="Services on the clock" className="col-span-2 sm:col-span-1"
          value={busy ? DASH : <>{count(liveCount)}<Unit>/ {SERVICES.length}</Unit></>}
          note={liveCount < SERVICES.length ? "The rest need a plan or riders" : "Every service has a plan"} />
      </div>
      <div data-rise><SlotsCard rota={rota} rotaWeek={rotaWeek} shifts={shifts} /></div>
      {!busy && waiting.length > 0 && <div data-rise><WaitingCard waiting={waiting} shifts={shifts} /></div>}
      <Clock data-rise tm={tm} />
    </div>
  );
}
