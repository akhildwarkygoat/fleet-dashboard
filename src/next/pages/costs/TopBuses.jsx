/* The buses that cost most per head in the period, by km: the same per-bus sums as the Excel file's
   "Summary by bus" sheet. It stands beside the company cards when fewer than three companies ran, so
   that column is filled with something to act on. Each bus opens its own page. */
import React from "react";
import { ChevronRight } from "lucide-react";
import { BothInline, Card, CardTitle, cx } from "../../ui.jsx";
import { money1 } from "../../format.js";
import { hrefFor } from "../../route.js";
import { routeOf } from "../live/figures.js";

/** `items` are [{ id, s }] (s from sumRows), highest first; `byId` the buses by id. */
export default function TopBuses({ items, byId, className }) {
  return (
    <Card data-rise-deep className={cx("flex flex-col", className)}>
      <CardTitle title="Highest cost per head a day" sub="By km, among the buses in this period" className="!mb-2" />
      <ul className="divide-y divide-line">
        {items.map(({ id, s }) => {
          const bus = byId.get(id);
          return (
            <li key={id}>
              <a href={hrefFor("bus", id)}
                className="-mx-3 flex items-center gap-3 rounded-tile px-3 py-2.5 transition-colors duration-150 hover:bg-satin">
                <span className="min-w-0 flex-1">
                  <span className="flex min-w-0 items-baseline gap-2 text-[13px]">
                    <span className="shrink-0 font-code font-semibold text-ink">{bus ? bus.vehicle : id}</span>
                    {bus && routeOf(bus) && <span className="truncate text-ink-3">{routeOf(bus)}</span>}
                  </span>
                  <BothInline km={s.cphKm} diesel={s.cphDiesel} fmt={money1} className="mt-0.5 block text-[13px]" />
                </span>
                <ChevronRight size={16} aria-hidden className="shrink-0 text-ink-4" />
              </a>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
