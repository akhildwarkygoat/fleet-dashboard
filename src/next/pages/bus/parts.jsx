/* Small pieces the bus page needs that the kit does not have. */
import React, { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { variableCost } from "../../../dailyCost.js";
import { BothFigures, Unit, cx } from "../../ui.jsx";
import { duration, money } from "../../format.js";
import { motion } from "../../motion.js";

/* Typed input and picked dates outlive the page ("when i switch tabs the data i entered is lost"):
   kept in memory for the session, by key. A component whose key names a bus is keyed by that bus. */
const kept = new Map();
export function useKept(key, initial) {
  const [value, setValue] = useState(() => (kept.has(key) ? kept.get(key) : initial));
  const set = useCallback((next) => setValue((prev) => {
    const v = typeof next === "function" ? next(prev) : next;
    kept.set(key, v);
    return v;
  }), [key]);
  return [value, set];
}

/** Hired or owned, by the rule the costs use (the plan's own type first, else the ERP type). */
export const isHired = (bus) => variableCost(bus, { source: null }, null, null).hired;

/** Rise the cards marked data-rise-deep when the page mounts. A layout effect, so the cards never
 *  paint once before the rise hides them. */
export function useRiseOnMount(ref, stagger = 50) {
  useLayoutEffect(() => {
    const tw = ref.current && motion.rise(ref.current.querySelectorAll("[data-rise-deep]"), stagger);
    return () => { if (tw) tw.progress(1).kill(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

/** Focus `target` again when an inline form closes, so the keyboard does not fall back to the top. */
export function useFocusBack(open, target) {
  const was = useRef(open);
  useEffect(() => {
    if (was.current && !open && target.current) target.current.focus();
    was.current = open;
  }, [open, target]);
}

/** A number that counts to its new value when it changes, never on first render. A change during
 *  a count carries on from the digits on screen. */
export function Count({ value, format, className }) {
  const el = useRef(null), last = useRef(null), tween = useRef(null), pulse = useRef(null), fmt = useRef(format);
  fmt.current = format;
  useLayoutEffect(() => {
    const counting = tween.current && tween.current.isActive();
    const from = counting ? tween.current.targets()[0].v : last.current;
    last.current = value;
    if (tween.current) tween.current.kill();
    tween.current = null;
    if (from == null || from === value) { el.current.textContent = fmt.current(value); return; }
    tween.current = motion.countUp(el.current, from, value, (n) => fmt.current(n));
    if (pulse.current) pulse.current.progress(1).kill();
    pulse.current = motion.pulse(el.current);
  }, [value]);
  useLayoutEffect(() => () => {
    if (tween.current) tween.current.kill();
    if (pulse.current) pulse.current.kill();
  }, []);
  return <span ref={el} className={cx("inline-block", className)} />;
}

/** "1 h 50 min" with h and min as small grey units. */
export const Duration = ({ min }) => duration(min).split(" ").map((w, i) => (
  <Fragment key={i}>{/^\d/.test(w) ? (i ? " " : "") + w : <Unit className="!text-[13px]">{w}</Unit>}</Fragment>
));

/** Money in a satin tile, both ways side by side (the BothFigures pair), its label under it. */
export function MoneyTile({ label, km, diesel, fmt = money, className }) {
  return (
    <div className={cx("flex min-w-0 flex-col rounded-tile bg-satin px-4 py-3", className)}>
      <dt className="order-2 mt-2 truncate text-[11px] font-semibold text-ink-3">{label}</dt>
      <dd className="order-1"><BothFigures km={km} diesel={diesel} fmt={fmt} /></dd>
    </div>
  );
}

/** Label left, value right: one fact in a list of facts divided by hairlines. */
export function Fact({ label, children, title }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2.5" title={title}>
      <dt className="shrink-0 text-[13px] text-ink-3">{label}</dt>
      <dd className="min-w-0 text-right text-[15px] font-semibold text-ink">{children}</dd>
    </div>
  );
}
export const Facts = ({ className, children }) => <dl className={cx("divide-y divide-line", className)}>{children}</dl>;
/** A value the data does not have yet, said in a few grey words. */
export const Missing = ({ children, title, className }) => <span className={cx("font-medium text-ink-3", className)} title={title}>{children}</span>;
/** The same in a tile, whose value line is 22px. */
export const TileMissing = ({ children, title }) => <Missing title={title} className="text-[15px] tracking-normal">{children}</Missing>;

/** The grey line under a table cell's value. */
export const Sub = ({ tone, children }) => (
  <div className={cx("mt-0.5 whitespace-nowrap text-[13px] leading-snug", tone === "warn" ? "text-warn-ink" : "text-ink-3")}>{children}</div>
);

/** The key to the light violet fill: worked out here, not read from the ERP or GPS. */
export const VioletKey = ({ children, className }) => (
  <p className={cx("flex items-center gap-2 text-[13px] text-ink-3", className)}>
    <span aria-hidden className="h-3 w-3 shrink-0 rounded-pill bg-violet-soft" />{children}
  </p>
);

/** The count beside a card title. */
export const HeadCount = ({ children }) => <span className="ml-1.5 font-semibold text-ink-3 tabular-nums">{children}</span>;
