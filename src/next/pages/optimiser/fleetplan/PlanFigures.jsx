/* The plan's figures. Cost per head is the one big number; the rest sit beside it in pairs
   (capacity, ride, distance, buses, seats), stacked on a desk so each pair is as tall as the hero.
   Pressing a figure ranks the routes by it: highest first, then lowest, then off. Owned and Rental
   narrow the routes to that kind instead. Which figures show is the KPI choice made on the Planner
   (kpiPrefs). Every value is one the old board shows, from fleetPlanFigures; the old "how this is
   calculated" panels became the grey lines under each figure and the cost breakdown behind the
   info button. */
import React, { useState } from "react";
import { ArrowDown, ArrowUp, Info } from "lucide-react";
import { visibleKpis } from "../../../../optimiser/kpiPrefs.js";
import { Aura, Button, CentreCard, Eyebrow, IconButton, Tile, Tiles, Unit, cx } from "../../../ui.jsx";
import { count, kms, money, money1, percent, plural } from "../../../format.js";
import { Count, Fact, Facts } from "../../bus/parts.jsx";
import { HEALTH, utilHealth } from "../../../health.js";
import { AVG_RIDE_MAX, avgRideOk, longestRideOk } from "../../../../optimiser/rideHealth.js";

const GROUPS = [["util", "people"], ["avgride", "ride"], ["totdist", "avgdist"], ["owned", "rental"], ["seats", "avgstops"]];
const TONE_INK = { ok: "text-ok-ink", warn: "text-warn-ink", bad: "text-bad-ink" };

/* Seats filled carries its health grade (src/next/health.js, the same rule as Live): good 90-125%,
   watch 50-90% or 125-150%, bad under 50% or over 150%. */
const utilFlag = (u) => { const h = utilHealth(u); return h ? [HEALTH[h].tone, HEALTH[h].label] : null; };

function cellsFor(data, f) {
  const { m, ow, rt, a } = f;
  const p = data.params || {};
  const split = ow.buses > 0 && rt.buses > 0;
  return {
    util: { key: "util", label: "Seats filled", value: percent(m.util), note: "riders ÷ seats", flag: utilFlag(m.util),
      detail: m.util > 100 && a.cap_leniency != null ? `Up to ${a.cap_leniency} over the seats` : null },
    people: { key: "people", label: "Riders", value: count(m.riders), note: "carried" },
    avgride: { key: "avgride", label: "Average ride", value: count(f.wAvgRide), unit: "min", note: "by rider",
      flag: avgRideOk(f.wAvgRide) ? null : ["bad", `Over ${AVG_RIDE_MAX} min`],
      detail: split ? `Owned ${count(ow.avg_ride)} · rental ${count(rt.avg_ride)} min` : null },
    ride: { key: "ride", label: "Longest ride", value: count(m.max_ride), unit: "min", note: "one trip",
      flag: longestRideOk(m.max_ride) ? null : ["bad", "Over 1 h 30 min"],
      detail: p.max_ride ? `Limit ${p.max_ride}${p.soft_ride ? ` · target ${p.soft_ride}` : ""} min` : null },
    totdist: { key: "totdist", label: "Total km", value: count(m.km), unit: "km", note: "a day",
      detail: split && ow.km != null && rt.km != null ? `Owned ${count(ow.km)} · rental ${count(rt.km)} km` : null },
    avgdist: { key: "avgdist", label: "Km a rider", value: kms(f.wDistPP), unit: "km", note: "one-way" },
    owned: { key: "owned", label: "Owned", value: count(ow.buses), note: `${count(ow.seats)} seats`, detail: `${count(ow.riders)} riders`, type: "own" },
    rental: { key: "rental", label: "Rental", value: count(rt.buses), note: `${count(rt.seats)} seats`, detail: `${count(rt.riders)} riders`, type: "rent" },
    seats: { key: "seats", label: "Seats", value: count(m.seats), note: `on ${plural(m.buses, "bus", "buses")}` },
    // one decimal always, as the old board prints it
    avgstops: { key: "avgstops", label: "Stops a bus", value: m.avg_stops.toFixed(1), note: "average" },
  };
}

const Arrow = ({ dir }) => {
  const Icon = dir === "desc" ? ArrowDown : ArrowUp;
  return (
    <span className="inline-flex shrink-0 text-ink">
      <Icon size={14} strokeWidth={2.25} aria-hidden />
      <span className="sr-only">{dir === "desc" ? ", highest first" : ", lowest first"}</span>
    </span>
  );
};

const rankHint = (label, dir) => (!dir ? `Rank the routes by ${label.toLowerCase()}, highest first`
  : dir === "desc" ? "Press for lowest first" : "Press to stop ranking");

const basisNote = (data, isOverall) => (isOverall ? "Shared buses split across their services"
  : data.costing && data.costing.standing === false ? "Diesel only: no driver, maintenance or loan"
  : data.costing && data.costing.basis === "full" ? "Every bus charged in full to this service" : null);

/**
 * @param scope  where the figures come from ("75 routes from 6 services"), said once under the hero
 */
export default function PlanFigures({ data, f, hidden, isOverall, scope, sortBy, typeFilter, onRank, onType }) {
  const [how, setHow] = useState(false);
  const cells = cellsFor(data, f);
  const groups = GROUPS.map((g) => visibleKpis(g.map((key) => cells[key]), hidden)).filter((g) => g.length);
  const dirOf = (key) => (sortBy && sortBy.key === key ? sortBy.dir : null);
  const showHero = !hidden.has("cost");
  const howButton = <Button variant="ghost" size="sm" icon={Info} onClick={() => setHow(true)}>How the cost is worked out</Button>;

  return (
    <>
      {/* the breakdown and the plan's assumptions live behind the hero; with the hero hidden they stay one press away */}
      {!showHero && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-[13px] text-ink-3">
          <span>{scope}</span>{howButton}
        </div>
      )}
      {!showHero && !groups.length ? (
        <p className="rounded-card bg-white px-6 py-4 text-[13px] text-ink-3 shadow-card">Every figure is hidden. Turn some back on in the Planner.</p>
      ) : (
        <div className="flex flex-wrap gap-3 xl:flex-nowrap">
          {showHero && (
            <Hero f={f} dir={dirOf("cost")} note={basisNote(data, isOverall)} scope={scope}
              onRank={() => onRank("cost")} onHow={() => setHow(true)} />
          )}
          {groups.map((g) => (
            <div key={g[0].key} className="flex min-w-0 grow basis-full gap-1 rounded-card bg-white p-1.5 shadow-card sm:basis-[calc(50%-6px)] lg:basis-0 lg:flex-col">
              {g.map((c) => {
                if (c.type) {
                  const on = typeFilter === c.type;
                  return <Figure key={c.key} c={c} active={on} onClick={() => onType(c.type)}
                    hint={on ? "Show every bus again" : `Show only ${c.label.toLowerCase()} buses in the routes`} />;
                }
                const dir = dirOf(c.key);
                return <Figure key={c.key} c={c} dir={dir} active={!!dir} onClick={() => onRank(c.key)} hint={rankHint(c.label, dir)} />;
              })}
            </div>
          ))}
        </div>
      )}
      <HowItWorks open={how} onClose={() => setHow(false)} data={data} f={f} />
    </>
  );
}

function Figure({ c, dir, active, onClick, hint }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={!!active} title={hint}
      className={cx("flex min-w-0 flex-1 basis-0 flex-col rounded-tile px-4 py-3 text-left",
        "transition-[background-color,transform] duration-150 hover:bg-satin active:scale-[0.985]", active && "bg-satin ring-2 ring-nova")}>
      <span className="flex items-start gap-1 text-[13px] font-semibold leading-tight text-ink-3">
        {c.label}{dir && <Arrow dir={dir} />}
      </span>
      <span className="mt-2 whitespace-nowrap text-[28px] font-bold leading-none tracking-[-0.02em] tabular-nums text-ink">
        {c.value}{c.unit && <Unit className="!text-[13px]">{c.unit}</Unit>}
      </span>
      {/* a figure that is off says so in place of its caption, in words as well as colour */}
      <span className={cx("mt-2 truncate text-[12px]", c.flag ? cx("font-semibold", TONE_INK[c.flag[0]]) : "text-ink-3")}>
        {c.flag ? c.flag[1] : c.note}
      </span>
      {c.detail && <span className="mt-0.5 truncate text-[12px] text-ink-3">{c.detail}</span>}
    </button>
  );
}

/* The one big number. The whole card ranks the routes by cost per head; the info button opens the
   breakdown. */
function Hero({ f, dir, note, scope, onRank, onHow }) {
  const { m, ow, rt, wd, month } = f;
  const split = [ow.buses > 0 && `Owned ${money(ow.cost)}`, rt.buses > 0 && `rental ${money(rt.cost)}`].filter(Boolean);
  return (
    <section className={cx("relative isolate flex min-w-0 basis-full flex-col rounded-hero bg-white p-5 shadow-card sm:p-6",
      "xl:shrink-0 xl:grow-0 xl:basis-[380px]",
      "transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-float", dir && "ring-2 ring-nova")}>
      <span aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden rounded-hero">
        <Aura size={440} intensity={0.85} className="-left-32 -top-40" />
      </span>
      <button type="button" onClick={onRank} aria-pressed={!!dir} aria-label="Cost per head" title={rankHint("Cost per head", dir)}
        className="absolute inset-0 rounded-hero focus-visible:outline-offset-[-4px]" />
      <IconButton label="How cost per head is worked out" icon={Info} variant="ghost" size="sm" onClick={onHow}
        className="absolute right-3 top-3 z-[1] sm:right-4 sm:top-4" />
      {/* Below xl the hero has the whole row: the breakdown sits beside the number as labelled tiles
          instead of leaving the right half empty. From xl it shares the row, so it reads as lines. */}
      <div className="pointer-events-none relative flex flex-col gap-x-10 gap-y-5 sm:flex-row xl:flex-col">
        <div className="min-w-0 shrink-0">
          <Eyebrow className="flex items-center gap-1">Cost per head{dir && <Arrow dir={dir} />}</Eyebrow>
          <p className="mt-3 text-[64px] font-bold leading-none tracking-[-0.03em] tabular-nums text-ink">
            <Count value={m.cost_head} format={money1} /><Unit className="!text-[17px]">a day</Unit>
          </p>
          <p className="mt-4 text-[15px] text-ink-2">
            <b className="font-semibold text-ink">{money(m.cost)}</b> a day for {plural(m.buses, "bus", "buses")}
          </p>
          <div className="mt-1 space-y-1 text-[13px] text-ink-3">
            <p className="sm:hidden xl:block">{money(month)} a head a month · {wd} working days</p>
            {split.length > 1 && <p className="sm:hidden xl:block">{split.join(" · ")} a day</p>}
            {note && <p>{note}</p>}
            <p>{scope}</p>
          </div>
        </div>
        <Tiles className="hidden min-w-0 flex-1 grid-cols-2 content-center sm:grid xl:hidden">
          <Tile label={`A head a month · ${wd} working days`} value={money(month)} />
          <Tile label="Buses" value={count(m.buses)} />
          {ow.buses > 0 && <Tile label={`Owned a day · ${plural(ow.buses, "bus", "buses")}`} value={money(ow.cost)} />}
          {rt.buses > 0 && <Tile label={`Rental a day · ${plural(rt.buses, "bus", "buses")}`} value={money(rt.cost)} />}
        </Tiles>
      </div>
    </section>
  );
}

/* The old board's cost walk-through, as facts: this plan's own numbers, then the assumptions the
   plan file records (only the optimiser's own result carries them). */
function HowItWorks({ open, onClose, data, f }) {
  const { m, ow, rt, wd, month } = f;
  const a = data.assumptions;
  const assumed = a ? [
    ["Diesel", typeof a.own_diesel_per_km === "number" ? `${money1(a.own_diesel_per_km)} a km` : a.own_diesel_per_km],
    ["Driver", a.own_driver_day != null && `${money(a.own_driver_day)} a day`],
    ["Maintenance", a.own_maint_day != null && `${money(a.own_maint_day)} a day`],
    ["Insurance and taxes", a.own_insurance_day ? `${money(a.own_insurance_day)} a day` : null],
    ["Loan", a.owned_loan],
    ["Rental", a.rent_tariff],
    ["Absent", a.absentee_pct != null && `${a.absentee_pct}%`],
    ["Buffer", a.buffer_pct != null && `${a.buffer_pct}%`],
    ["Over the seats", a.cap_leniency != null && `up to ${a.cap_leniency} a bus`],
    ["Working days", `${wd} a month`],
    ["Road times", a.road_source],
  ].filter(([, v]) => v) : [];
  const basis = data.costing && data.costing.basis;
  return (
    <CentreCard open={open} onClose={onClose} title="How cost per head is worked out" sub="With this plan’s own figures" width={480}>
      <Facts>
        <Fact label="Cost a day">{money(m.cost)}</Fact>
        <Fact label="Riders">{count(m.riders)}</Fact>
        <Fact label="Cost per head · cost ÷ riders">{money1(m.cost_head)}</Fact>
        <Fact label={`A head a month · ${wd} working days`}>{money(month)}</Fact>
        <Fact label={`Owned · ${plural(ow.buses, "bus", "buses")}`}>{money(ow.cost)} a day</Fact>
        <Fact label={`Rental · ${plural(rt.buses, "bus", "buses")}`}>{money(rt.cost)} a day</Fact>
      </Facts>
      {assumed.length ? (
        <>
          <Eyebrow className="mt-6">Plan assumptions</Eyebrow>
          <Facts className="mt-1">
            {assumed.map(([label, v]) => <Fact key={label} label={label}>{v}</Fact>)}
          </Facts>
        </>
      ) : (
        <p className="mt-4 text-[13px] leading-relaxed text-ink-3">
          {basis === "running-only" ? "Costed on diesel only, with no driver, maintenance or loan. "
            : basis === "full" ? "Every bus charged in full to this service. " : ""}
          This plan file does not record the cost assumptions it was built with.
        </p>
      )}
    </CentreCard>
  );
}
