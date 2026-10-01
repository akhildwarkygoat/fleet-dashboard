/* The three cards beside the Costs hero. As on Live, each is filled top to bottom with its own
   figures so the row has no empty middles: cost per head with cost per km under it, and riders and
   km with each company's part. Every figure is a sum from sumRows / companyTotals (costReport.js). */
import React from "react";
import { BothFigures, Card, CompanyDot, Unit, cx } from "../../ui.jsx";
import { count, money1 } from "../../format.js";
import { Count } from "./parts.jsx";

const Label = ({ children }) => <h2 className="text-[13px] font-semibold text-ink-3">{children}</h2>;
const Small = ({ className, children }) => <span className={cx("text-[11px] font-semibold text-ink-3", className)}>{children}</span>;

/** Cost per head a day both ways, then cost per km both ways in a small table whose columns line up
 *  with the pair above. `noCosts` when nothing in the period is priced: "—", not ₹0. */
export function CostCard({ all, noCosts, className }) {
  const known = (v) => (noCosts ? null : v);
  return (
    <Card className={cx("flex flex-col", className)}>
      <Label>Cost per head a day</Label>
      <BothFigures size="lg" fmt={money1} km={known(all.cphKm)} diesel={known(all.cphDiesel)} className="mt-3" />
      <div className="mt-auto pt-5">
        <div className="grid grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)] items-baseline gap-x-4 gap-y-1.5 rounded-tile bg-satin px-4 py-3">
          <span />
          <Small>by km</Small>
          <Small>by diesel</Small>
          <Small>Cost per km</Small>
          <b className="truncate text-[15px] font-bold tabular-nums text-ink">{money1(known(all.cpkKm))}</b>
          <b className="truncate text-[15px] font-bold tabular-nums text-ink">{money1(known(all.cpkDiesel))}</b>
        </div>
      </div>
    </Card>
  );
}

/** A count for the period with each company's part under it. `pick` reads the count from a sum. */
export function SplitCard({ label, value, unit, note, companies, pick, className }) {
  return (
    <Card className={cx("flex flex-col", className)}>
      <Label>{label}</Label>
      <p className="mt-3 text-[28px] font-bold leading-none tracking-[-0.02em] tabular-nums text-ink">
        <Count value={value} format={count} />{unit && <Unit>{unit}</Unit>}
      </p>
      {note && <Small className="mt-1.5">{note}</Small>}
      <ul className="mt-auto divide-y divide-line pt-3">
        {companies.map(({ c, s }) => (
          <li key={c} className="flex items-center gap-2 py-2 text-[13px]">
            <CompanyDot unit={c} />
            <span className="truncate font-semibold text-ink-2">{c === "—" ? "No company" : c}</span>
            <b className="ml-auto font-bold tabular-nums text-ink">{count(pick(s))}</b>
          </li>
        ))}
      </ul>
    </Card>
  );
}
