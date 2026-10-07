/* The Live page's one number: seats filled across the buses shown, with each company's own figure
   beside it. Pressing it ranks the buses by seats filled. */
import React, { useLayoutEffect, useRef } from "react";
import { Aura, CompanyDot, Eyebrow, Progress, cx } from "../../ui.jsx";
import { count, day, percent, plural } from "../../format.js";
import { motion } from "../../motion.js";
import { pctDigits } from "./figures.js";
import { healthTone } from "../../health.js";

export default function HeroCard({ agg, aside = 0, companies, fleetTotal, newest, active, onClick, className }) {
  const digits = useRef(null), number = useRef(null), last = useRef(null), tween = useRef(null), pulse = useRef(null);
  const value = agg.cap ? agg.util : null; // no seats in the list: "—", not 0%

  // React never renders these digits itself, so the count-up can write them without React losing
  // track of its text node. The first value is written at once; a change counts on from the digits
  // on screen (a search changes it on every key) and pulses once.
  useLayoutEffect(() => {
    const counting = tween.current && tween.current.isActive();
    const from = counting ? tween.current.targets()[0].v : last.current;
    last.current = value;
    if (tween.current) tween.current.kill();
    tween.current = null;
    if (from == null || value == null || from === value) { digits.current.textContent = pctDigits(value); return; }
    tween.current = motion.countUp(digits.current, from, value, pctDigits);
    if (pulse.current) pulse.current.progress(1).kill();
    pulse.current = motion.pulse(number.current);
  }, [value]);
  useLayoutEffect(() => () => {
    if (tween.current) tween.current.kill();
    if (pulse.current) pulse.current.kill();
  }, []);

  return (
    <button type="button" onClick={onClick} aria-pressed={!!active}
      className={cx("relative isolate flex flex-col rounded-hero bg-white p-5 text-left shadow-card sm:p-6",
        "transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-float active:scale-[0.985]",
        active && "ring-2 ring-nova", className)}>
      <span aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden rounded-hero">
        <Aura size={460} intensity={0.9} className="-left-32 -top-36" />
      </span>
      <span className="flex flex-col gap-x-10 gap-y-5 sm:flex-row">
        <span className="flex min-w-0 flex-col">
          <Eyebrow>Seats filled</Eyebrow>
          <span ref={number} className="mt-3 inline-block origin-bottom-left self-start text-[64px] font-bold leading-none tracking-[-0.03em] tabular-nums text-ink">
            <span ref={digits} />
            {value != null && <span className="ml-1 text-[28px] font-semibold tracking-normal text-ink-3">%</span>}
          </span>
          <span className="mt-4 block text-[15px] tabular-nums text-ink-2">
            <b className="font-semibold text-ink">{count(agg.present)}</b> {agg.present === 1 ? "rider" : "riders"} on{" "}
            <b className="font-semibold text-ink">{count(agg.cap)}</b> {agg.cap === 1 ? "seat" : "seats"}
          </span>
          <span className="mt-1 block text-[13px] tabular-nums text-ink-3">
            {agg.count < fleetTotal ? `${count(agg.count)} of ${plural(fleetTotal, "bus", "buses")}` : plural(agg.count, "bus", "buses")}
            {aside > 0 && ` · ${count(aside)} set aside`}
            {newest && ` · ${day(newest)}`}
          </span>
        </span>
        {/* each company's seats filled, so the hero says where the number comes from */}
        <span className="flex min-w-0 flex-1 flex-col justify-center gap-3.5 sm:pt-1">
          {companies.map((c) => (
            <span key={c.unit} className="block">
              <span className="flex items-center gap-2 text-[13px]">
                <CompanyDot unit={c.unit} />
                <span className="truncate font-semibold text-ink-2">{c.unit}</span>
                <span className="ml-auto font-bold tabular-nums text-ink">{c.agg.cap ? percent(c.agg.util) : "—"}</span>
              </span>
              <Progress value={c.agg.util} max={100} tone={healthTone(c.agg.cap ? c.agg.util : null)} size="sm" label={`${c.unit} seats filled`} className="mt-1.5" />
            </span>
          ))}
        </span>
      </span>
      <span className="mt-auto block pt-5">
        <Progress value={agg.util} max={100} tone={healthTone(value, "nova")} size="lg" label="Seats filled" />
      </span>
    </button>
  );
}
