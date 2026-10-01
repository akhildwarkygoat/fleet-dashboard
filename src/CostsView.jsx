/* ============================================================================
 * CostsView.jsx — the Costs page: what the fleet spent over a day, a week or a month, every cost
 * explained, and the .xlsx export (costReport.js builds both, so they always agree).
 * ==========================================================================*/
import React, { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Download } from "lucide-react";
import { Card, Btn, Tile, Segmented, Empty } from "./ui/kit.jsx";
import {
  PERIODS, periodRange, shiftPeriod, latestDate, datesIn, costRows, sumRows, costHeadNames, companyTotals, busCount,
  costLines, shareOf, costExplainers, costExplainerMap, OTHER_HEAD_WHAT, downloadCosts,
} from "./costReport.js";

const inr = (n) => (n == null ? "—" : "₹" + Math.round(n).toLocaleString("en-IN"));
const inr1 = (n) => (n == null ? "—" : "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 1 }));
const num = (n) => Math.round(n || 0).toLocaleString("en-IN");

/** dates: every date with data (sorted); ridersOn(busId, date): riders carried that day. */
export default function CostsView({ t, buses, records, busCosts, wd, dates, ridersOn, unitColor }) {
  const latest = latestDate(dates);
  const [kind, setKind] = useState("month");
  const [anchor, setAnchor] = useState(latest);
  const period = periodRange(kind, anchor);

  const headNames = useMemo(() => costHeadNames(busCosts), [busCosts]);
  const { rows, heads } = useMemo(() => costRows({
    buses, records, busCosts, wd, riders: ridersOn,
    dates: datesIn(dates, period),
  }), [buses, records, busCosts, wd, ridersOn, dates, period.from, period.to]);
  const all = useMemo(() => sumRows(rows, heads), [rows, heads]);
  const companies = useMemo(() => companyTotals(rows, heads), [rows, heads]);
  const explain = useMemo(() => costExplainerMap(wd), [wd]);

  const lines = costLines(all, heads, headNames, num);

  const picker = kind === "month"
    ? <input type="month" value={anchor.slice(0, 7)} onChange={(e) => e.target.value && setAnchor(e.target.value + "-01")} className="rounded-xl px-3 py-2 text-sm tabular-nums" style={{ background: t.inputBg, border: "1px solid " + t.border, color: t.text }} aria-label="Month" />
    : <input type="date" value={anchor} onChange={(e) => e.target.value && setAnchor(e.target.value)} className="rounded-xl px-3 py-2 text-sm tabular-nums" style={{ background: t.inputBg, border: "1px solid " + t.border, color: t.text }} aria-label={kind === "week" ? "Any day in the week" : "Day"} />;
  const arrow = (dir, Icon, label) => (
    <button type="button" onClick={() => setAnchor(shiftPeriod(anchor, kind, dir))} aria-label={label} title={label}
      className="rounded-xl p-2" style={{ border: "1px solid " + t.border, color: t.text, background: t.surface }}><Icon size={16} /></button>
  );

  return (
    <div className="space-y-5">
      {/* period: day / week / month, the one being shown, and the export */}
      <div className="flex flex-wrap items-center gap-3">
        <Segmented t={t} value={kind} onChange={setKind} options={PERIODS} />
        <div className="flex items-center gap-2">{arrow(-1, ChevronLeft, "Previous")}{picker}{arrow(1, ChevronRight, "Next")}</div>
        <div className="text-sm font-semibold" style={{ color: t.text }}>{period.label}</div>
        <div className="ml-auto">
          <Btn t={t} onClick={() => downloadCosts({ rows, heads, period, wd, headNames })} disabled={!rows.length} title="Totals, each bus, each bus each day, and how every cost works">
            <Download size={16} />Export to Excel
          </Btn>
        </div>
      </div>

      {!rows.length ? <Empty t={t} title="No data in this period" sub={`Nothing was recorded between ${period.from} and ${period.to}. Pick another ${kind}.`} /> : <>
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <Tile t={t} label="Total cost · by km" value={inr(all.totalKm)} sub={`${all.days} day${all.days === 1 ? "" : "s"} · ${busCount(rows)} buses`} />
          <Tile t={t} label="Total cost · by diesel" value={inr(all.totalDiesel)} sub={all.totalDiesel == null ? "diesel feed not loaded for every day" : "diesel as the ERP issued it"} />
          <Tile t={t} label="Cost per head" value={inr1(all.cphKm)} sub={`by diesel ${inr1(all.cphDiesel)}`} />
          <Tile t={t} label="Riders carried" value={num(all.riders)} sub="people × days" />
          <Tile t={t} label="Km travelled" value={num(all.km)} sub={all.cpkKm ? `${inr1(all.cpkKm)} per km` : undefined} />
        </div>

        <Card t={t} title="Where the money goes" hint="Every cost for the period. Shares are of the total by km; diesel as issued is the other way of counting the same diesel, so it has no share of its own.">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr style={{ color: t.muted }} className="text-left">
                <th className="py-2 pr-4 font-medium">Cost</th><th className="py-2 pr-4 font-medium text-right">Amount</th><th className="py-2 pr-4 font-medium text-right">Share</th><th className="py-2 font-medium">What it is</th>
              </tr></thead>
              <tbody>{lines.map((l) => (
                <tr key={l.key} style={{ borderTop: "1px solid " + t.border }}>
                  <td className="py-2.5 pr-4 font-semibold" style={{ color: t.text }}>{l.label}{l.sub && <div className="text-xs font-normal" style={{ color: t.muted }}>{l.sub}</div>}</td>
                  <td className="py-2.5 pr-4 text-right tabular-nums font-semibold" style={{ color: t.text }}>{inr(l.amount)}</td>
                  <td className="py-2.5 pr-4 text-right tabular-nums" style={{ color: t.muted }}>{l.alt ? "—" : shareOf(l.amount, all.totalKm)}</td>
                  <td className="py-2.5" style={{ color: t.muted }}>{(explain[l.key] || {}).what || OTHER_HEAD_WHAT}</td>
                </tr>))}
                <tr style={{ borderTop: "2px solid " + t.border }}>
                  <td className="py-2.5 pr-4 font-bold" style={{ color: t.text }}>Total · by km</td>
                  <td className="py-2.5 pr-4 text-right tabular-nums font-bold" style={{ color: t.text }}>{inr(all.totalKm)}</td><td /><td className="py-2.5" style={{ color: t.muted }}>By diesel as issued: <b style={{ color: t.text }}>{inr(all.totalDiesel)}</b></td>
                </tr>
              </tbody>
            </table>
          </div>
        </Card>

        <Card t={t} title="By company">
          <div className="overflow-x-auto">
            <table className="w-full text-sm tabular-nums">
              <thead><tr style={{ color: t.muted }} className="text-left">
                {["Company", "Buses", "Riders", "Km", "Total · by km", "Total · by diesel", "Per head · by km", "Per head · by diesel"].map((h, i) => <th key={h} className={"py-2 pr-4 font-medium" + (i ? " text-right" : "")}>{h}</th>)}
              </tr></thead>
              <tbody>{companies.map(({ c, buses: n, s }) => (
                <tr key={c} style={{ borderTop: "1px solid " + t.border, color: t.text }}>
                  <td className="py-2.5 pr-4 font-semibold"><span className="inline-block w-2.5 h-2.5 rounded-full mr-2 align-middle" style={{ background: unitColor ? unitColor(t, c) : t.primary }} />{c}</td>
                  <td className="py-2.5 pr-4 text-right">{n}</td><td className="py-2.5 pr-4 text-right">{num(s.riders)}</td><td className="py-2.5 pr-4 text-right">{num(s.km)}</td>
                  <td className="py-2.5 pr-4 text-right font-semibold">{inr(s.totalKm)}</td><td className="py-2.5 pr-4 text-right">{inr(s.totalDiesel)}</td>
                  <td className="py-2.5 pr-4 text-right font-semibold">{inr1(s.cphKm)}</td><td className="py-2.5 pr-4 text-right">{inr1(s.cphDiesel)}</td>
                </tr>))}
              </tbody>
            </table>
          </div>
        </Card>
      </>}

      <Card t={t} title="How every cost is worked out" hint="The same explanations go into the exported file's last sheet.">
        <div className="grid md:grid-cols-2 gap-x-8 gap-y-5">
          {costExplainers(wd).map((e) => (
            <div key={e.key}>
              <div className="font-semibold" style={{ color: t.text }}>{e.title}</div>
              <div className="text-sm mt-0.5" style={{ color: t.text }}>{e.what}</div>
              <div className="text-sm mt-1 leading-relaxed" style={{ color: t.muted }}>{e.how}</div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
