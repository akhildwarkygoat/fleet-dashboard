/* The Costs page's one number: what the period cost, as a pair of equal weight (by km and by diesel),
   and what the period covers. The pair sits side by side when the card is wide enough, else one
   above the other. */
import React from "react";
import { Aura, Card, Eyebrow } from "../../ui.jsx";
import { DASH, count, money } from "../../format.js";
import { Count } from "./parts.jsx";

function Figure({ value, label }) {
  return (
    <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
      <dt className="order-2 text-[15px] font-medium text-ink-3">{label}</dt>
      <dd className="order-1 text-[clamp(40px,4.6vw,64px)] font-bold leading-none tracking-[-0.03em] tabular-nums text-ink">
        {value == null ? DASH : <Count value={value} format={money} pulse className="origin-bottom-left" />}
      </dd>
    </div>
  );
}

/** `all` is the period's sums (sumRows); `period` its name ("September 2026"); `buses` how many buses
 *  it covers; `noCosts` when the period has no cost line at all, so the total is not known, not ₹0. */
export default function TotalCard({ all, period, buses, noCosts }) {
  const dieselMissing = all.totalDiesel == null;
  return (
    <Card hero className="h-full overflow-hidden">
      <Aura size={440} intensity={0.85} className="-left-28 -top-36" />
      <div className="relative">
        <Eyebrow>Total cost</Eyebrow>
        <dl className="mt-3 flex flex-wrap gap-x-10 gap-y-3">
          <Figure value={noCosts ? null : all.totalKm} label="by km" />
          <Figure value={noCosts ? null : all.totalDiesel} label={dieselMissing ? "by diesel · not loaded for every day" : "by diesel"} />
        </dl>
        <p className="mt-5 text-[15px] text-ink-2">
          <b className="font-semibold text-ink">{period}</b> · <b className="font-semibold text-ink">{count(buses)}</b> {buses === 1 ? "bus" : "buses"} ·{" "}
          <b className="font-semibold text-ink">{count(all.days)}</b> {all.days === 1 ? "day" : "days"} recorded
        </p>
      </div>
    </Card>
  );
}
