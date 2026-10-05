/* One company's costs for the period: both totals, its share of the fleet's total by km, how many
   buses, riders and km, and its cost per head both ways. Sums from companyTotals (costReport.js). */
import React from "react";
import { shareOf } from "../../../costReport.js";
import { BothFigures, BothInline, Card, CompanyDot, Progress, Tile, Tiles, cx } from "../../ui.jsx";
import { count, money, money1 } from "../../format.js";

/** `c` the company ("—" when a bus has none), `buses` how many it ran, `s` its sums, `total` the
 *  fleet's total by km; `noCosts` when the period has nothing to price, so money reads "—", not ₹0;
 *  `riders` what its riders count is called ("Rider-days" over more than a day). */
export default function CompanyCard({ c, buses, s, total, noCosts, riders = "Riders", className }) {
  const name = c === "—" ? "No company" : c;
  return (
    <Card data-rise-deep className={cx("flex flex-col", className)}>
      <div className="flex items-center gap-2.5">
        <CompanyDot unit={c} />
        <h2 className="min-w-0 flex-1 truncate text-[15px] font-bold tracking-[-0.01em] text-ink">{name}</h2>
        <p className="shrink-0 text-[13px] text-ink-3">
          <b className="text-[15px] font-bold tabular-nums text-ink">{shareOf(s.totalKm, total)}</b> of the total by km
        </p>
      </div>
      <BothFigures className="mt-4" fmt={money} km={noCosts ? null : s.totalKm} diesel={noCosts ? null : s.totalDiesel} />
      <Progress className="mt-4" size="sm" value={s.totalKm} max={total} label={`${name}, share of the total by km`} />
      <div className="mt-auto pt-4">
        <Tiles className="grid-cols-3">
          <Tile size="sm" label="Buses" value={count(buses)} />
          <Tile size="sm" label={riders} value={count(s.riders)} />
          <Tile size="sm" label="Km" value={count(s.km)} />
        </Tiles>
        <p className="mt-3 text-[13px] text-ink-3">
          Per head a day <BothInline km={noCosts ? null : s.cphKm} diesel={noCosts ? null : s.cphDiesel} fmt={money1} />
        </p>
      </div>
    </Card>
  );
}
