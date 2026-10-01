/* The top of the bus page: the one number (seats filled over the chosen dates) with the bus's own
   rider figures beside it, then what it cost over those dates. Every figure comes from
   busRangeFigures in Dashboard.jsx; the grade comes from health.js, the same as on Live. */
import React from "react";
import { Aura, Button, Card, CardTitle, Eyebrow, Progress, Tag, Tile, Tiles, Unit, cx } from "../../ui.jsx";
import { DASH, count, day, money1, moneyShort, percent, plural } from "../../format.js";
import { HEALTH, utilHealth } from "../../health.js";
import { Count, Duration, MoneyTile, TileMissing } from "./parts.jsx";

const heroDigits = (n) => percent(n).replace("%", "");

export function HeroCard({ bus, f, isRange, onLatest }) {
  const { m, agg } = f;
  const h = m && agg.cap ? utilHealth(m.util) : null;   // no seat count = no grade, as on Live
  return (
    <Card hero className="overflow-hidden" data-rise-deep>
      <Aura size={420} className="-left-[108px] -top-[123px]" />
      <div className="relative">
        {m ? (
          <>
            <div className="flex flex-col gap-x-10 gap-y-5 md:flex-row">
              <div className="flex min-w-0 flex-col">
                <Eyebrow>Seats filled</Eyebrow>
                <p className="mt-3 text-[64px] font-bold leading-none tracking-[-0.03em] tabular-nums text-ink">
                  {agg.cap ? <><Count value={m.util} format={heroDigits} /><Unit className="!text-[28px]">%</Unit></> : DASH}
                </p>
                <p className="mt-4 text-[15px] font-medium text-ink-2">
                  {isRange
                    ? `${plural(agg.present, "ride", "rides")} on ${plural(f.rngDates.length, "day", "days")}`
                    : `${plural(agg.present, "rider", "riders")} on ${plural(bus.capacity, "seat", "seats")}`}
                </p>
                {/* the same grade and colour as the bus's card on Live */}
                {h ? (
                  <Tag tone={HEALTH[h].tone} className="mt-2 self-start" title="Good 90 to 125% · watch 50 to 90% or 125 to 150% · bad under 50% or over 150%">{HEALTH[h].label}</Tag>
                ) : !agg.cap && <p className="mt-1 text-[13px] text-ink-3">No seat count in the ERP</p>}
              </div>
              <Tiles className="min-w-0 flex-1 content-center grid-cols-2">
                <Tile label="Attendance" title="Present, out of the riders allotted to this bus"
                  value={f.assigned ? percent(f.presentVsAlloc) : DASH} />
                <Tile label={isRange ? "Absences" : "Absent"} value={count(agg.absent)} />
                {f.minRide == null ? (
                  <Tile className="col-span-2" label="Ride time" title="Plan the route in the Optimiser"
                    value={<TileMissing>Not planned yet</TileMissing>} />
                ) : (
                  <>
                    <Tile label="Shortest ride" value={<Duration min={f.minRide} />} />
                    <Tile label="Longest ride" value={<Duration min={f.maxRide} />} />
                  </>
                )}
              </Tiles>
            </div>
            <Progress className="mt-6" size="lg" value={agg.cap ? m.util : 0} tone={h ? HEALTH[h].tone : "ink"} label="Seats filled" />
          </>
        ) : (
          <>
            <Eyebrow>Seats filled</Eyebrow>
            <p className="mt-3 text-[64px] font-bold leading-none tracking-[-0.03em] text-ink-4">{DASH}</p>
            <p className="mt-4 text-[15px] text-ink-3">{f.latest ? "No data for this bus in the chosen dates." : "No data for this bus yet."}</p>
            {f.latest && (
              <Button variant="ghost" size="sm" className="-ml-4 mt-2" onClick={() => onLatest(f.latest)}>Show {day(f.latest)}</Button>
            )}
          </>
        )}
      </div>
    </Card>
  );
}

export function GlanceCard({ f, isRange, showNetValue, dieselMissing }) {
  const { m, agg } = f;
  const noKm = !(agg.km > 0), riders = agg.present > 0;
  return (
    <Card data-rise-deep>
      <CardTitle title={isRange ? `Cost over ${plural(f.rngDates.length, "day", "days")}` : `Cost on ${day(f.rngDates[0])}`}
        sub={dieselMissing ? "By diesel · not loaded yet" : null} />
      <Tiles className={cx("grid-cols-1", showNetValue ? "sm:grid-cols-2 2xl:grid-cols-4" : "md:grid-cols-3")}>
        <MoneyTile label="Spend" km={agg.spend} diesel={agg.spend_diesel} />
        <MoneyTile label={riders ? "Cost per head a day" : "Cost per head · no riders"} km={riders ? m.cph : null} diesel={riders ? m.cph_diesel : null} />
        <MoneyTile label={noKm ? "Cost per km · no km yet" : "Cost per km"} km={noKm ? null : m.cpk} diesel={noKm ? null : m.cpk_diesel} fmt={money1} />
        {showNetValue && <MoneyTile label="Net value a year" km={m.netAnnual} diesel={agg.netAnnual_diesel} fmt={moneyShort} />}
      </Tiles>
    </Card>
  );
}
