/* Small pieces the T.I board needs that the kit does not have: how lateness reads, which tone it
   gets (the old board's thresholds, from TrackImplView.jsx), the calendar day a run lands on, a
   flat empty strip and the per-service group rows of the tables. */
import React, { useEffect, useState } from "react";
import { ChevronRight } from "lucide-react";
import { cx } from "../../../ui.jsx";
import { useKept } from "../../bus/parts.jsx";
import { DASH, MINUS, day } from "../../../format.js";
import { addDays, onTime } from "../../../../optimiser/trackImpl.js";
import { lateTone } from "../../../../optimiser/TrackImplView.jsx";

/** "+12 min", "−3 min", "On time": the sign is always written, so colour is never the only signal. */
export const signedMin = (v) => (v == null ? DASH : v === 0 ? "On time" : `${v > 0 ? "+" : MINUS}${Math.abs(v)} min`);
/** The same as bare digits, for chart ticks and labels. */
export const signedNum = (v) => (v == null ? DASH : `${v > 0 ? "+" : v < 0 ? MINUS : ""}${Math.abs(v)}`);
/** How long a ride took against its plan, in words. */
export const rideVsPlan = (v) => (v == null ? null : v === 0 ? "As planned" : `${Math.abs(v)} min ${v > 0 ? "longer" : "shorter"}`);

const TONE = { good: "ok", watch: "warn", poor: "bad" };
/** One run or one bus: ok on time, warn late, bad very late. */
export const lateTag = (v) => TONE[lateTone(v)];
/** A day's median: ok on time, warn otherwise (a day is never graded very late). */
export const dayTone = (v) => (v == null ? null : onTime(v) ? "ok" : "warn");
export const TEXT = { ok: "text-ok-ink", warn: "text-warn-ink", bad: "text-bad-ink" };

/** "02 Oct" or "next day, 02 Oct": the calendar day a run lands on, from its service day. */
export function onDay(serviceDay, offset) {
  const d = day(addDays(serviceDay, offset || 0));
  return offset === 1 ? `next day, ${d}` : offset === -1 ? `previous day, ${d}` : d;
}

/** The old board joins a fact to its advice with " — "; the new look writes a colon. */
export const plain = (s) => String(s).replace(/ — /g, ": ");

export const DIR = { pickup: "Pickup", drop: "Drop" };

export const Dot = ({ color, className }) => (
  <span aria-hidden className={cx("inline-block h-2.5 w-2.5 shrink-0 rounded-pill", className)} style={{ background: color }} />
);

/** The grey line under a table cell's value. */
export const Sub = ({ tone, title, id, role, children }) => (
  <span id={id} role={role} title={title} className={cx("mt-0.5 block whitespace-nowrap text-[13px] leading-snug", TEXT[tone] || "text-ink-3")}>{children}</span>
);

/** Nothing here yet, as one low strip across the width: icon, what is missing, the action that fills it. */
export function FlatEmpty({ icon: Icon, title, hint, action, className }) {
  return (
    <div className={cx("flex flex-col items-start gap-4 sm:flex-row sm:items-center", className)}>
      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-pill bg-satin-2 text-ink-2">
        <Icon size={24} strokeWidth={2} aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-bold tracking-[-0.01em] text-ink">{title}</p>
        {hint && <p className="mt-0.5 text-[13px] leading-relaxed text-ink-3">{hint}</p>}
      </div>
      {action && <div className="flex shrink-0 flex-wrap gap-2 sm:ml-auto">{action}</div>}
    </div>
  );
}

/** Which service groups of a table are open. They start closed in Overall and kept for the session;
 *  a search opens every group with a match, and those can still be closed while it is typed. */
export function useGroups(key, multi, sq) {
  const [open, setOpen] = useKept(key, {});
  const [shut, setShut] = useState({});
  useEffect(() => setShut({}), [sq]);
  const isOpen = (id) => !multi || (sq ? !shut[id] : !!open[id]);
  const toggle = (id) => (sq ? setShut : setOpen)((o) => ({ ...o, [id]: !o[id] }));
  return { isOpen, toggle };
}

/** A service's header row inside a table: opens and closes the rows under it, figures on the right. */
export function GroupRow({ cols, svc, open, onToggle, summary, right }) {
  return (
    <tr>
      <td colSpan={cols} className="px-1 pb-1 pt-3">
        <button type="button" aria-expanded={open} onClick={onToggle}
          className="flex w-full items-center gap-3 rounded-tile px-3 py-2 text-left transition-colors duration-150 hover:bg-satin active:scale-[0.99]">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-pill bg-satin-2 text-ink-2">
            <ChevronRight size={16} strokeWidth={2} aria-hidden className={cx("transition-transform duration-200", open && "rotate-90")} />
          </span>
          <Dot color={svc.color} />
          <span className="whitespace-nowrap text-[15px] font-bold tracking-[-0.01em] text-ink">{svc.name}</span>
          <span className="whitespace-nowrap text-[13px] tabular-nums text-ink-3">{summary}</span>
          {right && <span className="ml-auto hidden shrink-0 items-center gap-3 sm:flex">{right}</span>}
        </button>
      </td>
    </tr>
  );
}

/** A short stroke standing in for a chart line in a key; dashed for a dashed line. */
export const Swatch = ({ color, dashed }) => (
  <span aria-hidden className="inline-block h-[3px] w-4 shrink-0 rounded-pill"
    style={dashed ? { backgroundImage: `linear-gradient(90deg, ${color} 55%, transparent 55%)`, backgroundSize: "7px 3px" } : { background: color }} />
);

/** The chart's hover card. */
export const TipCard = ({ title, children }) => (
  <div className="min-w-[200px] rounded-[16px] bg-white px-3 py-2.5 text-[13px] shadow-float">
    <p className="mb-1.5 font-semibold text-ink-3">{title}</p>
    {children}
  </div>
);
export const TipRow = ({ swatch, label, value, extra }) => (
  <p className="flex items-center gap-2 py-0.5">
    {swatch}
    <span className="min-w-0 truncate text-ink-2">{label}</span>
    <b className="ml-auto pl-4 font-bold tabular-nums text-ink">{value}</b>
    {extra && <span className="tabular-nums text-ink-3">{extra}</span>}
  </p>
);
