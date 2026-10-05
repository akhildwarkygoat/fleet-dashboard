/* Where the money goes: every cost line of the period with what it is, its amount and its share of
   the total by km. Diesel is worked out two ways, so its two lines sit together in one tile; only
   "by km" counts in the shares, "as issued" counts in the total by diesel. Lines, names and shares
   come from costLines and shareOf (costReport.js), the same as the old page and the Excel file. Owned
   vehicles with ERP costs but on no route are named under the total, never inside it. */
import React from "react";
import { ReceiptText, RotateCw } from "lucide-react";
import { shareOf, OTHER_HEAD_WHAT } from "../../../costReport.js";
import { BothFigures, Button, Card, CardTitle, Eyebrow, Progress, cx } from "../../ui.jsx";
import { money, plural } from "../../format.js";
import { EmptyStrip } from "./parts.jsx";

const DIESEL = new Set(["dieselKm", "dieselIssued"]);
// name and what it is · amount · share; on a phone the share bar takes its own row
const COLS = "grid-cols-[minmax(0,1fr)_auto] gap-x-6 md:grid-cols-[minmax(0,1fr)_132px_minmax(150px,200px)]";

/** `onSatin` darkens the grey captions so they keep their contrast on the satin tile. */
function Line({ name, what, amount, sub, alt, total, onSatin }) {
  const grey = onSatin ? "text-ink-2" : "text-ink-3";
  return (
    <li className={cx("grid gap-y-2 py-3 md:items-center", COLS)}>
      <div className="min-w-0">
        <p className="text-[15px] font-semibold text-ink">{name}</p>
        <p className={cx("mt-0.5 text-[13px] leading-snug", grey)}>{what}</p>
      </div>
      <div className="text-right">
        <p className="text-[15px] font-bold tabular-nums text-ink">{money(amount)}</p>
        {sub && <p className={cx("mt-0.5 text-[13px] tabular-nums", grey)}>{sub}</p>}
      </div>
      <div className="col-span-2 flex items-center gap-3 md:col-span-1">
        {alt ? (
          <span className={cx("text-[13px]", grey)}>In the total by diesel</span>
        ) : (
          <>
            <Progress size="sm" value={amount} max={total} label={`${name}, share of the total by km`} className="flex-1" />
            <span className="w-[52px] shrink-0 text-right text-[13px] font-semibold tabular-nums text-ink-2">{shareOf(amount, total)}</span>
          </>
        )}
      </div>
    </li>
  );
}

/** `lines` from costLines, `all` the period's sums (sumRows), `explain` the explainers by key,
 *  `noRoute` the owned vehicles on no route (noRouteVehicles). */
export default function MoneyCard({ lines, all, explain, noRoute = [], syncing, onSyncCosts, className }) {
  const total = all.totalKm;
  const row = (l, onSatin) => (
    <Line key={l.key} name={l.label} what={(explain[l.key] || {}).what || OTHER_HEAD_WHAT}
      amount={l.amount} alt={l.alt} total={total} onSatin={onSatin}
      sub={l.key === "dieselIssued" && l.amount == null ? "not loaded for every day" : l.sub} />
  );
  const diesel = lines.filter((l) => DIESEL.has(l.key));
  const hire = lines.filter((l) => l.key === "hire");
  const standing = lines.filter((l) => !DIESEL.has(l.key) && l.key !== "hire");
  const ownedRan = all.dieselKm > 0 || all.dieselIssued > 0;
  const syncButton = (
    <Button variant="secondary" size="sm" icon={RotateCw} busy={syncing} onClick={onSyncCosts}>
      {syncing ? "Syncing…" : "Sync costs"}
    </Button>
  );

  if (!lines.length) {
    return (
      <EmptyStrip icon={ReceiptText} title="No cost lines from the ERP for this period" className={className}
        hint="Costs appear here once the ERP costing feed has synced. Settings shows when it last did." action={syncButton} />
    );
  }

  return (
    <Card className={cx("flex flex-col", className)}>
      <CardTitle title="Where the money goes" sub="Every cost in the period, with its share of the total by km" />
      <div className={cx("hidden pb-1 md:grid", COLS)} aria-hidden>
        <Eyebrow>Cost</Eyebrow><Eyebrow className="text-right">Amount</Eyebrow><Eyebrow>Share</Eyebrow>
      </div>

      {diesel.length > 0 && (
        <section className="-mx-3 rounded-tile bg-satin px-3 pt-3">
          <p className="text-[13px] text-ink-2"><b className="font-semibold text-ink">Diesel</b> · one cost, counted two ways</p>
          <ul className="divide-y divide-line">{diesel.map((l) => row(l, true))}</ul>
        </section>
      )}
      {hire.length > 0 && <ul className={cx(diesel.length > 0 && "mt-1")}>{hire.map((l) => row(l))}</ul>}

      {(standing.length > 0 || ownedRan) && (
        <section className="mt-5">
          <Eyebrow>Standing costs · owned buses</Eyebrow>
          {standing.length ? (
            <ul className="mt-1 divide-y divide-line">{standing.map((l) => row(l))}</ul>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3 py-3">
              <p className="text-[13px] text-ink-3">No standing costs from the ERP for this period.</p>
              {syncButton}
            </div>
          )}
        </section>
      )}

      {/* stretched beside the company cards, any spare height goes above the total, not under it */}
      <div className="mt-auto pt-3">
        <div className="-mx-3 flex flex-wrap items-end justify-between gap-x-6 gap-y-3 rounded-tile bg-satin px-3 py-4">
          <p className="text-[15px] font-bold text-ink">Total</p>
          <BothFigures fmt={money} km={all.totalKm} diesel={all.totalDiesel} />
        </div>
        {noRoute.length > 0 && (
          <p className="mt-3 text-[13px] leading-snug text-ink-3">
            Not in the total: {plural(noRoute.length, "owned vehicle", "owned vehicles")} with ERP costs but on no route,{" "}
            {money(noRoute.reduce((s, v) => s + v.daily, 0))} of standing costs a working day ({noRoute.map((v) => v.id).join(", ")}).
          </p>
        )}
      </div>
    </Card>
  );
}
