/* The two cards beside the Live hero. Each is filled with its own figures, top to bottom, so the
   row has no empty middles: cost per head both ways with the day's spend and cost per km under it,
   and the fleet size with its count per company. */
import React from "react";
import { BothFigures, CompanyDot, Unit, cx } from "../../ui.jsx";
import { count, money, money1 } from "../../format.js";

const LIFT = "transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-float active:scale-[0.985]";

/** A card that is a button when pressing it ranks the buses, and a plain section otherwise. */
function Shell({ onClick, active, className, children }) {
  const cls = cx("relative flex flex-col rounded-card bg-white p-5 text-left shadow-card sm:p-6", className);
  if (!onClick) return <section className={cls}>{children}</section>;
  return (
    <button type="button" onClick={onClick} aria-pressed={!!active} className={cx(cls, LIFT, active && "ring-2 ring-nova")}>
      {children}
    </button>
  );
}

const Label = ({ children }) => <span className="text-[13px] font-semibold text-ink-3">{children}</span>;

/** Spend and cost per km both ways, as a small table: the columns line up with the figures above. */
function MoneyTable({ rows }) {
  return (
    <span className="mt-auto block pt-5">
      <span className="grid grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)] items-baseline gap-x-4 gap-y-1.5 rounded-tile bg-satin px-4 py-3">
        <span />
        <span className="text-[11px] font-semibold text-ink-3">by km</span>
        <span className="text-[11px] font-semibold text-ink-3">by diesel</span>
        {rows.map(([label, km, diesel]) => (
          <React.Fragment key={label}>
            <span className="text-[11px] font-semibold text-ink-3">{label}</span>
            <b className="truncate text-[15px] font-bold tabular-nums text-ink">{km}</b>
            <b className="truncate text-[15px] font-bold tabular-nums text-ink">{diesel}</b>
          </React.Fragment>
        ))}
      </span>
    </span>
  );
}

/** Cost per head both ways, then the day's spend and cost per km both ways. "—" where there is
 *  nothing to divide, never ₹0. `note` says what the figures hold beyond the buses listed. */
export function CostCard({ agg, cph, noCosts, note, active, onClick, className }) {
  const perKm = (spend, cpk) => (agg.km > 0 && spend > 0 ? cpk : null);
  return (
    <Shell onClick={onClick} active={active} className={className}>
      <Label>Cost per head a day</Label>
      <BothFigures size="lg" fmt={money} km={cph.km} diesel={cph.diesel} className="mt-3" />
      {note && !noCosts && <span className="mt-2 text-[11px] font-semibold text-ink-3">{note}</span>}
      {noCosts ? (
        <span className="mt-auto pt-4 text-[13px] text-ink-3">No costs from the ERP yet</span>
      ) : agg.count > 0 && (
        <MoneyTable rows={[
          ["Spend a day", money(agg.spend || null), money(agg.spend_diesel || null)],
          ["Cost per km", money1(perKm(agg.spend, agg.cpk)), money1(perKm(agg.spend_diesel, agg.cpk_diesel))],
        ]} />
      )}
    </Shell>
  );
}

/** The fleet in the ERP, and how many buses each company has. */
export function FleetCard({ total, byUnit, units, className }) {
  return (
    <Shell className={className}>
      <Label>Fleet</Label>
      <span className="mt-3 text-[28px] font-bold leading-none tracking-[-0.02em] tabular-nums text-ink">
        {count(total)}<Unit>{total === 1 ? "bus" : "buses"}</Unit>
      </span>
      <span className="mt-1.5 text-[11px] font-semibold text-ink-3">in the ERP</span>
      <span className="mt-auto flex flex-col divide-y divide-line pt-3">
        {units.filter((u) => byUnit[u]).map((u) => (
          <span key={u} className="flex items-center gap-2 py-2 text-[13px]">
            <CompanyDot unit={u} />
            <span className="font-semibold text-ink-2">{u}</span>
            <b className="ml-auto font-bold tabular-nums text-ink">{count(byUnit[u])}</b>
          </span>
        ))}
      </span>
    </Shell>
  );
}
