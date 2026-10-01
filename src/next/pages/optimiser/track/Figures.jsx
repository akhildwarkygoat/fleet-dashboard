/* The day's figures on one row. Late to the gate is the one big number: it is the only lateness with
   a production consequence and is measured against a gate time the ERP states. Beside it the same
   pickups split into late, on time and early, then pickups on time, how much of the day is recorded
   and the home run. Drops are never pooled with pickups (see summarise in trackImpl.js). Every
   figure is the old board's, from summarise(); badges appear only when a figure is off. While the
   plans load the cards keep their frames and show skeletons. */
import React from "react";
import { ON_TIME_MIN } from "../../../../optimiser/trackImpl.js";
import { ON_TIME_TARGET } from "../../../../optimiser/TrackImplView.jsx";
import { Aura, Badge, Eyebrow, Skeleton, Stat, Tile, Tiles, Unit, cx } from "../../../ui.jsx";
import { DASH, MINUS, count, percent, plural } from "../../../format.js";
import { Count } from "../../bus/parts.jsx";
import { dayTone, signedMin, signedNum } from "./parts.jsx";

// summarise() already rounds to one decimal; this only shapes the count's in-between frames
const heroDigits = (n) => (n > 0 ? "+" : n < 0 ? MINUS : "") + Math.abs(n).toFixed(1).replace(/\.0$/, "");

/** A typical lateness: "On time", or the signed minutes with a grey unit. */
function Minutes({ v, hero }) {
  if (v == null) return DASH;
  if (v === 0) return "On time";
  return (
    <>
      {hero ? <Count value={v} format={heroDigits} /> : signedNum(v)}
      <Unit className={hero ? "ml-1.5 !text-[28px] font-semibold" : undefined}>min</Unit>
    </>
  );
}

const Off = ({ v }) => (dayTone(v) === "warn" ? <Badge tone="warn">{v > 0 ? "Late" : "Early"}</Badge> : null);
const LabelRow = ({ children, badge }) => (
  <span className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">{children}{badge}</span>
);
const Line = ({ w }) => <Skeleton className={cx("h-4 !rounded-pill", w)} />;
const StatSkeleton = () => (
  <>
    <Skeleton className="h-7 w-24 !rounded-pill" />
    <Line w="mt-2 w-32 max-w-full" />
  </>
);

function Hero({ pickup, loading, className }) {
  const v = pickup.medianEnd;
  const timed = pickup.n > 0;
  return (
    <section className={cx("relative isolate flex flex-col rounded-hero bg-white p-5 shadow-card sm:p-6", className)}>
      <span aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden rounded-hero">
        <Aura size={420} intensity={0.85} className="-left-32 -top-40" />
      </span>
      {/* number and tiles side by side, except at lg where the hero has only its share of the one row */}
      <div className="flex flex-1 flex-col gap-x-6 gap-y-5 sm:flex-row sm:items-end lg:flex-col lg:items-stretch xl:flex-row xl:items-end">
        <div className="flex min-w-0 flex-col">
          <span className="flex items-center gap-2"><Eyebrow>Late to the gate</Eyebrow>{!loading && <Off v={v} />}</span>
          {loading ? <Skeleton className="mt-3 h-16 w-48 !rounded-pill" /> : (
            <p className="mt-3 whitespace-nowrap text-[64px] font-bold leading-none tracking-[-0.03em] tabular-nums text-ink">
              <Minutes v={v} hero />
            </p>
          )}
          {loading ? <Line w="mt-3 w-40" /> : (
            <p className="mt-3 text-[13px] text-ink-3">
              {timed ? `typical of ${plural(pickup.n, "timed pickup", "timed pickups")}` : "no pickup timed yet"}
            </p>
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          {loading ? (
            <div className="grid grid-cols-3 gap-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-[60px]" />)}</div>
          ) : (
            <Tiles className="grid-cols-3">
              <Tile label="Late" value={timed ? count(pickup.lateN) : null} />
              <Tile label="On time" value={timed ? count(pickup.onTimeN) : null} />
              <Tile label="Early" value={timed ? count(pickup.earlyN) : null} />
            </Tiles>
          )}
          {loading ? <Line w="w-52 max-w-full" /> : (
            <p className="truncate text-[13px] text-ink-3">
              {pickup.worst
                ? <>Furthest from plan <span className="font-code font-semibold text-ink">{pickup.worst.veh}</span> {signedMin(pickup.worst.min)}</>
                : `${ON_TIME_MIN} min either side counts as on time`}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

export default function Figures({ day, expected, loading }) {
  const { pickup, drop } = day;
  const complete = !loading && expected > 0 && day.recorded === expected;
  const under = pickup.onTimePct != null && pickup.onTimePct < ON_TIME_TARGET;
  const onTimeNote = pickup.n
    ? `${count(pickup.onTimeN)} of ${count(pickup.n)} within ${ON_TIME_MIN} min${pickup.asserted ? ` · ${count(pickup.asserted)} not timed` : ""}`
    : pickup.asserted ? `${count(pickup.asserted)} ran to plan, not timed` : `within ${ON_TIME_MIN} min`;
  const recordedNote = [day.bulk ? `${count(day.bulk)} ran to plan, not timed` : "", day.notRun ? `${count(day.notRun)} did not run` : ""]
    .filter(Boolean).join(" · ") || "runs on this day";
  const dropNote = drop.n ? `typical of ${plural(drop.n, "timed drop", "timed drops")}`
    : day.unmeasurable ? `${count(day.unmeasurable)} on an assumed release time` : "no drop timed yet";
  const sk = loading ? <StatSkeleton /> : null;

  return (
    <div aria-busy={loading || undefined}
      className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-[minmax(0,2.4fr)_repeat(3,minmax(0,1fr))]">
      <div data-rise-deep className="col-span-2 flex sm:col-span-3 lg:col-span-1">
        <Hero pickup={pickup} loading={loading} className="flex-1" />
      </div>
      <div data-rise-deep className="flex">
        <Stat className="flex-1" value={loading ? null : pickup.onTimePct == null ? DASH : percent(pickup.onTimePct)} note={loading ? null : onTimeNote}
          label={<LabelRow badge={!loading && under && <Badge tone="bad">Under {ON_TIME_TARGET}%</Badge>}>Pickups on time</LabelRow>}>{sk}</Stat>
      </div>
      <div data-rise-deep className="flex">
        <Stat className="flex-1" note={loading ? null : recordedNote}
          label={<LabelRow badge={complete && <Badge tone="ok">Complete</Badge>}>Recorded</LabelRow>}
          value={loading ? null : <>{count(day.recorded)}<Unit>/ {count(expected)}</Unit></>}>{sk}</Stat>
      </div>
      <div data-rise-deep className="col-span-2 flex sm:col-span-1">
        <Stat className="flex-1" value={loading ? null : <Minutes v={drop.medianEnd} />} note={loading ? null : dropNote}
          label={<LabelRow badge={!loading && <Off v={drop.medianEnd} />}>Home run</LabelRow>}>{sk}</Stat>
      </div>
    </div>
  );
}
