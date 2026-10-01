/* One company on the Live page: a header that opens and closes it, then a card per bus.
   A bus card shows its seats filled, its cost per head both ways, a badge only when something is
   off (or when its figures are from an older day), and net value a year both ways when Settings has
   it on. Pressing a card opens that bus. */
import React, { useLayoutEffect, useRef } from "react";
import { Badge, CompanyDot, GroupHeader, Progress, Unit } from "../../ui.jsx";
import { count, day, money, moneyShortSigned, percent, plural } from "../../format.js";
import { motion } from "../../motion.js";
import { driverOf, netYear, pctDigits, perHead, routeOf, utilOf } from "./figures.js";
import { HEALTH } from "../../health.js";

/** A money figure both ways in a bus card, each with its own small label. When neither is known
 *  it reads one "—" with the reason under it, rather than a row of dashes. */
function Pair({ label, km, diesel, fmt, none }) {
  const one = (v, sub) => (
    <span className="flex min-w-0 flex-col">
      <span className="truncate text-[13px] font-bold tabular-nums text-ink">{fmt(v)}</span>
      <span className="mt-0.5 text-[11px] font-semibold text-ink-3">{sub}</span>
    </span>
  );
  return (
    <span className="mt-3 block">
      <span className="block text-[11px] font-semibold text-ink-3">{label}</span>
      <span className="mt-1 grid grid-cols-2 gap-2">
        {km == null && diesel == null ? <span className="col-span-2">{one(null, none)}</span> : <>{one(km, "by km")}{one(diesel, "by diesel")}</>}
      </span>
    </span>
  );
}

function BusCard({ x, newest, showNet, onOpen }) {
  const { bus, m } = x;
  const util = utilOf(m);
  const cph = perHead(m), net = netYear(m);
  const detail = [
    bus.vehicle, routeOf(bus), driverOf(bus) && "Driver " + driverOf(bus),
    m.capacity > 0 ? `${count(m.present)} riders on ${count(m.capacity)} seats` : `${count(m.present)} riders · no seat count in the ERP`,
    "Figures from " + day(x.date),
  ].filter(Boolean).join("\n");
  return (
    <button type="button" onClick={() => onOpen(bus.id)} title={detail}
      className="flex min-w-0 flex-1 flex-col rounded-card bg-white p-4 text-left shadow-card transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-float active:scale-[0.985]">
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <span className="flex min-w-0 max-w-full items-center gap-2" title={bus.unit}>
          <CompanyDot unit={bus.unit} />
          <span className="min-w-0 truncate font-code text-[15px] font-bold text-ink">{bus.vehicle}</span>
        </span>
        {x.h && <Badge tone={HEALTH[x.h].tone}>{HEALTH[x.h].label}</Badge>}
        {x.date < newest && <Badge title="The last day with figures for this bus">{day(x.date)}</Badge>}
      </span>
      <span className="mt-auto block pt-3 text-[28px] font-bold leading-none tracking-[-0.02em] tabular-nums text-ink">
        {util == null ? "—" : <>{pctDigits(util)}<Unit>%</Unit></>}
      </span>
      {util != null && <Progress value={util} max={100} size="sm" tone={HEALTH[x.h].tone} label={`${bus.vehicle} seats filled`} className="mt-2.5" />}
      <span className="mt-1.5 block text-[11px] font-semibold text-ink-3">{util == null ? "No seat count in the ERP" : "Seats filled"}</span>
      <Pair label="Cost per head a day" km={cph.km} diesel={cph.diesel} fmt={money} none={m.present > 0 ? "no costs yet" : "no riders"} />
      {showNet && <Pair label="Net value a year" km={net.km} diesel={net.diesel} fmt={moneyShortSigned} none="no costs yet" />}
    </button>
  );
}

const buses = (n) => plural(n, "bus", "buses");

/** The responsive grid of bus cards, used by each company and by the Needs attention list. */
export function BusGrid({ id, gridRef, list, newest, showNet, onOpenBus }) {
  // each card sits in a plain wrapper so the rise and the card's own hover transition never fight
  return (
    <div id={id} ref={gridRef} className="grid grid-cols-2 gap-3 pb-3 pt-3 sm:grid-cols-[repeat(auto-fill,minmax(168px,1fr))]">
      {list.map((x) => (
        <div key={x.bus.id} className="flex min-w-0">
          <BusCard x={x} newest={newest} showNet={showNet} onOpen={onOpenBus} />
        </div>
      ))}
    </div>
  );
}

export default function BusGroup({ unit, list, tally, agg, total, open, onToggle, narrowing, newest, showNet, onOpenBus }) {
  const grid = useRef(null), wasOpen = useRef(open);

  // opening a group rises its first cards; the rest appear in place
  useLayoutEffect(() => {
    const tw = open && !wasOpen.current && grid.current ? motion.rise(Array.from(grid.current.children).slice(0, 12), 40) : null;
    wasOpen.current = open;
    return () => { if (tw) tw.progress(1).kill(); };
  }, [open]);

  const id = "live-group-" + unit;
  const badges = [
    tally.bad > 0 && <Badge key="bad" tone="bad">{tally.bad} bad</Badge>,
    tally.watch > 0 && <Badge key="watch" tone="warn">{tally.watch} watch</Badge>,
    tally.good > 0 && <Badge key="good" tone="ok">{tally.good} good</Badge>,
  ].filter(Boolean);
  // "of" whenever some of the company's buses are not in the list, so it never reads as a second fleet size
  const summary = !list.length ? (total ? `0 of ${buses(total)}` : "0 buses")
    : `${list.length < total ? `${count(list.length)} of ${buses(total)}` : buses(list.length)} · ${percent(agg.util)} seats filled`;

  return (
    <section data-rise-deep>
      <GroupHeader open={open} onToggle={onToggle} controls={open ? id : undefined} title={unit} lead={<CompanyDot unit={unit} />}
        summary={summary} right={badges.length ? badges : null} />
      {open && (list.length ? (
        <BusGrid id={id} gridRef={grid} list={list} newest={newest} showNet={showNet} onOpenBus={onOpenBus} />
      ) : (
        <p id={id} className="px-4 pb-3 pt-5 text-center text-[13px] text-ink-2">
          {!total ? `No ${unit} buses in the ERP yet.` : narrowing ? "No buses match." : "Nothing recorded for these buses yet."}
        </p>
      ))}
    </section>
  );
}
