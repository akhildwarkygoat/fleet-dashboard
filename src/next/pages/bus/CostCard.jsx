/* Running cost: what this bus costs a day, both ways, and the lines that make it up. Standing lines
   come from the ERP costing feed; the day's diesel (or a hired bus's tariff) is worked out here and
   tinted violet so it never reads as an ERP figure. Every figure comes from busCostFigures. */
import React, { useRef, useState } from "react";
import { ChevronRight, IndianRupee, Pencil, RotateCw } from "lucide-react";
import { COST_PERIODS, COST_TYPE_MAP } from "../../../costModel.js";
import { MAX_SPREAD_DAYS, RECENT_DAYS } from "../../../dailyCost.js";
import { TARIFF_TEXT, budgetPatch, busCostFigures, costLineDaily, costPeriodLabel } from "../../../Dashboard.jsx";
import { Alert, BothFigures, Button, Card, CardTitle, Empty, Eyebrow, Field, Input, Select, Tile, Tiles, Unit, cx } from "../../ui.jsx";
import { DASH, clock, day, dayRange, kms, money, money1, moneySigned, plural } from "../../format.js";
import { MoneyTile, VioletKey, useFocusBack, useKept } from "./parts.jsx";

const kmFrom = (d) => (d.source === "gps" ? "GPS km" : "from the finalised plan");
function kmText(d) {
  if (d.source === "plan") return `${kms(d.km)} km · from the finalised plan`;
  const g = d.gps;
  return `${kms(d.km)} km · GPS, ${plural(g.journeys, "trip", "trips")}${g.active ? `, ${g.active} still out` : d.inProgress ? " so far" : ""}`;
}

/* One ERP cost line: what was bought, at what period. */
function erpRow(l) {
  const spec = COST_TYPE_MAP[l.type] || {};
  const per = String(costPeriodLabel(l.period || spec.period) || "").toLowerCase();
  const amount = l.type === "diesel" ? `${l.quantity ?? DASH} L ${per} at ${money1(+l.amount || 0)}`
    : `${money(+l.amount || 0)}${spec.qty ? ` × ${l.quantity ?? DASH}` : ""} ${per}`;
  return { label: l.label || spec.label || l.type, caption: [amount, l.erpLines > 1 && plural(l.erpLines, "ERP line", "ERP lines")].filter(Boolean).join(" · ") };
}

/* One of the day's worked-out lines (variableLines), in words, with how it was worked out. Tinted
   unless it is the ERP's own issue. */
function workedRow(l, rec) {
  const { day: d, cost } = rec;
  if (l.id === "var-hire") return {
    label: "Hire on the km driven", caption: `${kms(d.km)} km · ${kmFrom(d)}`, tint: true,
    basis: [["Km", kmText(d)], ["Tariff", d.source === "plan" ? "the finalised plan’s own figure" : TARIFF_TEXT]],
  };
  if (l.id === "var-km") {
    const k = cost.byKm;
    // the sources are listed in the basis rows; the caption only says when any of them is not measured
    const estimated = d.source !== "gps" || !k.kmplFromErp || !k.rateDate;
    return {
      label: "Diesel by km", caption: `${l.quantity} L at ${money1(k.rate)}${estimated ? " · estimated" : ""}`, tint: true,
      basis: [["Km", kmText(d)],
        ["Mileage", k.kmplFromErp ? `${kms(k.kmpl)} km/L · ERP` : `${kms(k.kmpl)} km/L · usual mileage, not in the ERP`],
        ["Diesel price", k.rateDate ? `${money1(k.rate)} a litre · ERP, ${day(k.rateDate)}` : `${money(k.rate)} a litre · usual price, not in the ERP`],
        ["Litres", `${kms(k.litres)} L`]],
    };
  }
  const z = cost.byDiesel;
  const label = "Diesel issued";
  if (!z) return { label, caption: "Not loaded yet", tint: false, basis: null };
  if (z.source === "issued") return {
    label, caption: `${l.quantity} L at ${money1(z.rate)} · ERP issue`, tint: false,
    basis: [["Issue", `${kms(z.issue.litres)} L on ${day(z.issue.date)} · ${money(z.issue.amount)}`],
      ["Covers", z.issue.days > 1 ? `${z.issue.days} days, ${dayRange(z.issue.from, z.issue.date)}, shared evenly` : "this day only"],
      ["This day’s share", `${kms(z.litres)} L · ${money(z.amount)}`]],
  };
  if (z.source === "estimate") return {
    label, caption: `≈${l.quantity} L at ${money1(z.rate)} · ERP average until the next fill`, tint: true,
    basis: [["Last fill", day(z.last)], ["ERP average", `${kms(z.litres)} L a day over its last ${RECENT_DAYS} days of fills`]],
  };
  return {
    label, caption: "None issued", tint: false,
    basis: [["Issues", z.last ? `none since ${day(z.last)}` : z.next ? `the next one, ${day(z.next)}, covers only the ${MAX_SPREAD_DAYS} days before it` : "none on record"]],
  };
}

function LineRow({ id, label, caption, amount, tint, open, onToggle, children }) {
  const inner = (
    <>
      <ChevronRight size={16} strokeWidth={2} aria-hidden
        className={cx("mt-[3px] shrink-0 text-ink-3 transition-transform duration-200", open && "rotate-90", !children && "invisible")} />
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-semibold text-ink">{label}</span>
        <span className="mt-0.5 block text-[13px] text-ink-3">{caption}</span>
      </span>
      <span className="shrink-0 pl-2 text-right text-[15px] font-bold tabular-nums text-ink">{amount}</span>
    </>
  );
  const cls = cx("flex w-full items-start gap-2.5 rounded-tile px-3 py-2.5 text-left", tint && "bg-violet-soft/60");
  return (
    <li className="py-1">
      {children ? (
        <button type="button" onClick={onToggle} aria-expanded={open} aria-controls={id}
          className={cx(cls, "transition-[background-color,transform] duration-150 active:scale-[0.985]", tint ? "hover:bg-violet-soft" : "hover:bg-satin")}>{inner}</button>
      ) : <div className={cls}>{inner}</div>}
      {children && open && <div id={id} className={cx("mb-1 ml-9 mr-3 mt-1 rounded-tile px-4 py-3", tint ? "bg-violet-soft/40" : "bg-satin")}>{children}</div>}
    </li>
  );
}

const Basis = ({ rows }) => (
  <dl className="grid gap-1.5">
    {rows.map(([k, v]) => (
      <div key={k} className="flex justify-between gap-4 text-[13px]">
        <dt className="shrink-0 text-ink-3">{k}</dt><dd className="text-right font-semibold text-ink-2">{v}</dd>
      </div>
    ))}
  </dl>
);
/* The ERP lines behind a rolled-up figure. */
const ErpDetail = ({ rows }) => (
  <ul className="divide-y divide-line">
    {rows.map((d, i) => (
      <li key={i} className="flex flex-col gap-1 py-2 text-[13px] first:pt-0 last:pb-0 sm:flex-row sm:justify-between sm:gap-4">
        <span className="min-w-0">
          <span className="block font-semibold text-ink-2">{d.desc}</span>
          <span className="block text-ink-3">{[d.period, dayRange(d.from, d.to)].filter(Boolean).join(" · ")}</span>
          {d.approved && <span className="block text-ink-3">approved {day(d.approved)}</span>}
        </span>
        <span className="sm:shrink-0 sm:text-right">
          <span className="block font-semibold tabular-nums text-ink">{money(d.amount)}</span>
          {d.rate ? <span className="block text-ink-3">{money(d.rate)}{d.qty != null && d.qty !== 1 ? ` × ${d.qty}` : ""}</span> : null}
        </span>
      </li>
    ))}
  </ul>
);

const GroupHead = ({ title, left }) => (
  <div className="flex items-baseline justify-between gap-4 px-3 pb-1" title={title}>
    <Eyebrow>{left}</Eyebrow><Eyebrow>A day</Eyebrow>
  </div>
);

/* The budget is not in the ERP: it is typed here and kept on this device against the vehicle. */
function BudgetRow({ bus, info, dailyBudget, onSave }) {
  const [draft, setDraft] = useKept(`bus:${bus.id}:budget`, null);
  const opener = useRef(null);
  useFocusBack(!!draft, opener);
  const set = !!info && info.budgetAmount !== "" && info.budgetAmount != null;
  if (draft) {
    return (
      <form className="flex flex-wrap items-end gap-3 px-3 py-4"
        onSubmit={(e) => { e.preventDefault(); onSave(budgetPatch(draft)); setDraft(null); }}
        onKeyDown={(e) => { if (e.key === "Escape") setDraft(null); }}>
        <Field label="Budget in ₹" className="w-full sm:w-[160px]">
          <Input type="number" min="0" inputMode="decimal" autoFocus placeholder="0" className="tabular-nums"
            value={draft.amount} onChange={(e) => setDraft({ ...draft, amount: e.target.value })} />
        </Field>
        <Field label="Period" className="w-full sm:w-[150px]">
          <Select value={draft.period} onChange={(e) => setDraft({ ...draft, period: e.target.value })}>
            {COST_PERIODS.map(([v, lab]) => <option key={v} value={v}>{lab}</option>)}
          </Select>
        </Field>
        <div className="flex w-full flex-col-reverse gap-2 sm:w-auto sm:flex-row">
          <Button variant="ghost" className="sm:min-w-[120px]" onClick={() => setDraft(null)}>Cancel</Button>
          <Button variant="primary" type="submit" className="sm:min-w-[120px]">Save budget</Button>
        </div>
      </form>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-4">
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-semibold text-ink">Budget</p>
        <p className="mt-0.5 text-[13px] text-ink-3">
          {set ? `${money(+info.budgetAmount)} ${String(costPeriodLabel(info.budgetPeriod || "month")).toLowerCase()}` : "Not set"}
        </p>
      </div>
      {set && <p className="text-[15px] font-bold tabular-nums text-ink">{money(dailyBudget)}<Unit className="!text-[13px]">a day</Unit></p>}
      <Button ref={opener} variant="ghost" size="sm" icon={Pencil}
        onClick={() => setDraft({ amount: set ? info.budgetAmount : "", period: (info && info.budgetPeriod) || "month" })}>
        {set ? "Change budget" : "Set budget"}
      </Button>
    </div>
  );
}

export default function CostCard({ bus, hired, dieselMissing, profile, rec, date, wd, costMeta, costStatus, onSync, info, onSaveBudget }) {
  const [open, setOpen] = useState({});
  const { lines, vlines, dailyBudget, totKm, totDiesel, monthKm, monthDiesel, varianceKm, varianceDiesel } = busCostFigures(profile, rec, date, wd);
  const toggle = (id) => setOpen((o) => ({ ...o, [id]: !o[id] }));
  const busy = costStatus.phase === "syncing";
  const fy = costMeta && costMeta.fy ? `FY ${costMeta.fy}` : "this financial year";
  const worked = vlines.map((l) => ({ l, row: workedRow(l, rec) }));
  const anyTint = worked.some((w) => w.row.tint);
  const has = lines.length || dailyBudget || vlines.length;
  const totalNote = ["Not counting driver salary", totDiesel == null && dieselMissing && "by diesel not loaded yet"].filter(Boolean).join(" · ");
  const budgetRow = <BudgetRow bus={bus} info={info} dailyBudget={dailyBudget} onSave={onSaveBudget} />;

  return (
    <Card data-rise-deep>
      <CardTitle title="Running cost" sub={date ? `For ${day(date)}` : null}
        right={
          <Button variant="secondary" size="sm" icon={RotateCw} busy={busy} onClick={() => onSync()}
            title={costStatus.at ? `Last synced ${clock(costStatus.at)}` : "Fetch the costing feed from the ERP now"}>
            {busy ? "Syncing…" : "Sync costs"}
          </Button>
        } />
      {costStatus.phase === "error" && (
        <Alert className="mb-4" onRetry={() => onSync()}>Costs could not be synced. These are the last ones saved.</Alert>
      )}

      {has ? (
        <>
          <Eyebrow>Total a day</Eyebrow>
          {hired ? (
            <div className="mt-2">
              <p className="text-[28px] font-bold leading-none tracking-[-0.02em] tabular-nums text-ink">{money(totKm)}</p>
              <p className="mt-1.5 text-[11px] font-semibold text-ink-3">hired · same by km and by diesel</p>
            </div>
          ) : (
            <>
              <BothFigures className="mt-2" size="lg" km={totKm} diesel={totDiesel} fmt={money} />
              <p className="mt-2 text-[13px] text-ink-3">{totalNote}</p>
            </>
          )}
          <Tiles className="mt-5 grid-cols-1 sm:grid-cols-2">
            {/* alone (no budget set), the month total takes the whole row instead of leaving half of it empty */}
            {hired ? <Tile label="Total a month" value={money(monthKm)} className={dailyBudget > 0 ? "" : "sm:col-span-2"} />
              : <MoneyTile label="Total a month" km={monthKm} diesel={monthDiesel} className={dailyBudget > 0 ? "" : "sm:col-span-2"} />}
            {dailyBudget > 0 && (hired
              ? <Tile label="Budget left a day" value={moneySigned(varianceKm)} />
              : <MoneyTile label="Budget left a day" km={varianceKm} diesel={varianceDiesel} fmt={moneySigned} />)}
          </Tiles>

          <div className="-mx-3 mt-3 divide-y divide-line">
            {budgetRow}
            {(lines.length > 0 || !hired) && (
              <section className="py-4">
                <GroupHead left={`From the ERP · ${fy}`}
                  title={costMeta ? `${dayRange(costMeta.from, costMeta.to)} · each line spread over ${wd} working days a year` : undefined} />
                {lines.length ? (
                  <ul className="divide-y divide-line">
                    {lines.map((l) => {
                      const r = erpRow(l);
                      const id = "cost-" + l.id;
                      return (
                        <LineRow key={l.id} id={id} label={r.label} caption={r.caption} amount={money(costLineDaily(l, wd))}
                          open={!!open[id]} onToggle={() => toggle(id)}>
                          {l.detail && l.detail.length ? <ErpDetail rows={l.detail} /> : null}
                        </LineRow>
                      );
                    })}
                  </ul>
                ) : <p className="px-3 py-2 text-[13px] text-ink-3">No ERP cost lines for this bus in {fy}.</p>}
              </section>
            )}
            {worked.length > 0 && (
              <section className="py-4">
                <GroupHead left={`${hired ? "Hire" : "Diesel"} on ${day(date)}`} />
                <ul className="divide-y divide-line">
                  {worked.map(({ l, row }) => (
                    <LineRow key={l.id} id={"cost-" + l.id} label={row.label} caption={row.caption} tint={row.tint}
                      amount={l.missing ? DASH : money(costLineDaily(l, wd))} open={!!open["cost-" + l.id]} onToggle={() => toggle("cost-" + l.id)}>
                      {row.basis ? <Basis rows={row.basis} /> : null}
                    </LineRow>
                  ))}
                </ul>
              </section>
            )}
          </div>
          {anyTint && <VioletKey className="mt-1">Worked out here, not an ERP cost line</VioletKey>}
        </>
      ) : (
        <div className="-mx-3 divide-y divide-line">
          <Empty icon={IndianRupee} title="No costs for this bus yet" className="pb-8 pt-4"
            hint={hired ? "It is hired and has no km yet, so there is no tariff to work out."
              : `Nothing bought for it in ${fy} and no km or diesel to price. Approve its cost lines in the ERP, then Sync costs.`} />
          {budgetRow}
        </div>
      )}
    </Card>
  );
}
