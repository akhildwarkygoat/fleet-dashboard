/* The plan's figures, for the selected bus while one is selected, else for the whole plan: riders on
   a bus leads, the main figures sit on one row, and the smaller whole-plan facts share the header
   line. Pressing a figure ranks the bus list by it (highest first, then lowest first, then off).
   The figures shown follow the shared preference. */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Check, EyeOff, MousePointerClick, SlidersHorizontal, X } from "lucide-react";
import { KPI_DEFS, visibleKpis } from "../../../../optimiser/kpiPrefs.js";
import { BUS_RANK } from "../../../../optimiser/kpiRank.js";
import { planTiles } from "../../../../optimiser/plannerState.js";
import { Button, IconButton, Unit, cx } from "../../../ui.jsx";
import { DASH, count, duration, kms, money, money1, percent, plural } from "../../../format.js";
import { FIGURE_LABEL } from "./parts.jsx";

/* planTiles gives each figure its verdict; these name them as status tones. A figure on target
   stays ink: only "take note" and "poor" are coloured, plus every rider assigned. */
const VERDICT = { good: "ok", watch: "warn", poor: "bad", muted: null };
const TONE_TEXT = { ok: "text-ok-ink", warn: "text-warn-ink", bad: "text-bad-ink" };
const TONE_FILL = { ok: "bg-ok", warn: "bg-warn", bad: "bg-bad" };

const of = (n, d, size = "!text-[12px]") => <>{count(n)}<Unit className={size}>/ {count(d)}</Unit></>;
const unit = (v, u) => <>{v}<Unit className="!text-[12px]">{u}</Unit></>;
// shown in the header line rather than as tiles; Owned and Rental are filters on the bus list
const FACT_KEYS = new Set(["seats", "avgstops", "avgdist"]);
const LIST_KEYS = new Set(["owned", "rental"]);

function figures(b) {
  const { row, k, morning, assignedHeads, totalRiders, progress, busesUsed, unassignedCount, usedRows, avgRide, maxRide,
    totKm, distPP, seatSum, avgStops } = b;
  const verdict = Object.fromEntries(planTiles(b, VERDICT).map((x) => [x.key, x]));
  const used = usedRows.length > 0;
  const list = row ? [
    { key: "people", label: "Riders", value: of(row.heads, row.cap, "!text-[15px]"), note: verdict.people.sub, bar: [row.heads, row.cap] },
    { key: "util", label: "Seats filled", value: percent(BUS_RANK.util.value({ riders: row.heads, cap: row.cap })), note: plural(row.stops.length, "stop", "stops") },
    { key: "cost", label: "Cost / head", value: row.heads ? money1(BUS_RANK.cost.value({ riders: row.heads, cost: row.cost })) : DASH, note: `${money(row.cost)} a day · estimate` },
    { key: "ride", label: "Ride time", value: duration(row.ride), note: morning ? "first stop to factory" : "factory to last stop" },
    { key: "totdist", label: "Km a day", value: row.km ? unit(kms(row.km), "km") : DASH, note: "this bus" },
    { key: "avgstops", label: "Stops", value: count(row.stopIds.length), note: "on this bus" },
  ] : [
    { key: "people", value: of(assignedHeads, totalRiders, "!text-[15px]"), note: `${percent(progress)} assigned`, bar: [assignedHeads, totalRiders] },
    { key: "cost", value: k && k.heads ? money1(k.costPerHeadDay) : DASH, note: k ? `${money(k.totalCost)} a day · estimate` : "estimate" },
    { key: "util", value: k ? percent(k.utilisation) : DASH, note: plural(busesUsed, "bus used", "buses used") },
    { key: "avgride", value: used ? duration(avgRide) : DASH, note: `${count(unassignedCount)} stops left` },
    { key: "ride", value: used ? duration(maxRide) : DASH },
    { key: "totdist", value: used ? unit(count(totKm), "km") : DASH, note: "whole plan" },
    { key: "seats", value: count(seatSum(usedRows)) },
    { key: "avgstops", value: used ? avgStops.toFixed(1) : DASH },
    { key: "avgdist", value: used ? `${kms(distPP)} km` : DASH },
  ];
  return list.map((f) => {
    const v = verdict[f.key];
    const t = v && (v.accent || v.dc);
    // an unknown value is never coloured, and green is kept for "everyone has a seat"
    const tone = f.value === DASH || (t === "ok" && f.key !== "people") ? null : t;
    return { ...f, label: f.label || FIGURE_LABEL[f.key], tone };
  });
}

/* Closes on Escape or a press anywhere outside `wrap` (the menu and the button that opened it).
   Escape is taken on the way down and marked handled, so it does not also close full screen. */
function FigureMenu({ wrap, hidden, onToggle, onShowAll, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") { e.preventDefault(); onClose(); } };
    const onDown = (e) => { if (wrap.current && !wrap.current.contains(e.target)) onClose(); };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onDown);
    return () => { document.removeEventListener("keydown", onKey, true); document.removeEventListener("pointerdown", onDown); };
  }, [wrap, onClose]);
  return (
    <div className="glass absolute right-0 top-full z-20 mt-2 w-64 rounded-card p-2 shadow-float">
      <div className="flex items-center justify-between px-2 pb-1 pt-1">
        <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-ink-3">Figures to show</p>
        <Button variant="ghost" size="sm" onClick={onShowAll}>Show all</Button>
      </div>
      <ul className="max-h-72 overflow-y-auto">
        {KPI_DEFS.map((d) => {
          const on = !hidden.has(d.key);
          return (
            <li key={d.key}>
              <button type="button" role="checkbox" aria-checked={on} onClick={() => onToggle(d.key)}
                className="flex w-full items-center gap-2.5 rounded-pill px-2 py-1.5 text-left text-[13px] font-semibold text-ink transition-colors hover:bg-white/80">
                <span aria-hidden className={cx("flex h-5 w-5 shrink-0 items-center justify-center rounded-pill", on ? "bg-ink text-white" : "bg-satin-2")}>
                  {on && <Check size={13} strokeWidth={2.5} />}
                </span>
                {FIGURE_LABEL[d.key] || d.label}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default function FiguresPanel({ board, glass, onHide }) {
  const { activeBus, setActiveBus, morning, busName, busesUsed, hiddenKpis, toggleKpi, showAllKpis, pressKpi, kpiOn, kpiTitle, rank } = board;
  const [menu, setMenu] = useState(false);
  const menuWrap = useRef(null);
  const closeMenu = useCallback(() => setMenu(false), []);
  const shown = visibleKpis(figures(board), hiddenKpis).filter((f) => !LIST_KEYS.has(f.key));
  const tiles = shown.filter((f) => !FACT_KEYS.has(f.key));
  const facts = shown.filter((f) => FACT_KEYS.has(f.key));
  const arrow = (key) => (kpiOn(key) && rank && rank.key === key ? (rank.dir === "desc" ? ArrowDown : ArrowUp) : null);

  const lead = activeBus ? (
    <p className="min-w-0 flex-1 truncate text-[13px] text-ink-2">
      Adding to <b className="font-code font-semibold text-ink">{busName}</b>{morning && " · the first stop is where it starts"}
    </p>
  ) : !busesUsed ? (
    <p className="flex min-w-0 flex-1 items-center gap-2 text-[13px] text-ink-2">
      <MousePointerClick size={16} aria-hidden className="shrink-0 text-ink-3" />
      <span className="truncate">Select a bus, then its stops on the map</span>
    </p>
  ) : (
    <div className="-ml-2 flex min-w-0 flex-1 flex-wrap items-center gap-1">
      {facts.map((f) => {
        const on = kpiOn(f.key);
        const Arrow = arrow(f.key);
        return (
          <button key={f.key} type="button" onClick={() => pressKpi(f.key)} aria-pressed={on} title={kpiTitle(f.key)}
            className={cx("inline-flex items-baseline gap-1.5 rounded-pill px-2 py-1 transition-colors duration-150",
              glass ? "hover:bg-white/80" : "hover:bg-satin", on && "ring-2 ring-nova")}>
            <span className="text-[15px] font-bold tabular-nums text-ink">{f.value}</span>
            <span className="text-[13px] text-ink-3">{f.label.toLowerCase()}</span>
            {Arrow && <Arrow size={12} strokeWidth={2.5} aria-hidden className="self-center text-ink" />}
          </button>
        );
      })}
    </div>
  );

  return (
    <section aria-label="Plan figures" className={cx("w-full p-4", glass ? "glass rounded-card shadow-float" : "rounded-card bg-white shadow-card")}>
      <div className="flex min-h-9 items-center gap-2">
        {lead}
        {activeBus && <Button variant="white" size="sm" icon={X} onClick={() => setActiveBus(null)}>Done</Button>}
        <span ref={menuWrap} className="relative ml-auto">
          <IconButton label="Choose figures" icon={SlidersHorizontal} variant="ghost" size="sm" aria-expanded={menu} onClick={() => setMenu((o) => !o)} />
          {menu && <FigureMenu wrap={menuWrap} hidden={hiddenKpis} onToggle={toggleKpi} onShowAll={showAllKpis} onClose={closeMenu} />}
        </span>
        {onHide && <IconButton label="Hide figures" icon={EyeOff} variant="ghost" size="sm" className="-mr-1" onClick={onHide} />}
      </div>

      {tiles.length > 0 && (
        <div className={cx("mt-3 grid gap-2", !glass && "grid-cols-2 [&>*:last-child:nth-child(even)]:col-span-2")}
          style={glass ? { gridTemplateColumns: "repeat(auto-fit, minmax(116px, 1fr))" } : undefined}>
          {tiles.map((f) => {
            const on = kpiOn(f.key);
            const Arrow = arrow(f.key);
            const big = !!f.bar;
            return (
              <button key={f.key} type="button" onClick={() => pressKpi(f.key)} aria-pressed={on} title={kpiTitle(f.key)}
                className={cx("flex min-w-0 flex-col rounded-tile px-3 py-2 text-left",
                  "transition-[background-color,box-shadow,transform] duration-150 active:scale-[0.97]",
                  glass ? "bg-white/70 hover:bg-white" : "bg-satin hover:bg-satin-2", on && "ring-2 ring-nova", big && "col-span-2")}>
                <span className={cx("truncate font-bold tabular-nums", TONE_TEXT[f.tone] || "text-ink",
                  big ? "text-[28px] leading-none tracking-[-0.02em]" : "text-[17px] leading-6 tracking-[-0.01em]")}>
                  {f.value}
                </span>
                <span className={cx("flex min-w-0 items-center gap-1 text-[11px] font-semibold text-ink-3", big ? "mt-1.5" : "mt-0.5")}>
                  <span className="truncate">{f.label}{big && f.note && <span className="font-medium"> · {f.note}</span>}</span>
                  {Arrow && <Arrow size={12} strokeWidth={2.5} aria-hidden className="shrink-0 text-ink" />}
                </span>
                {big ? (
                  <span aria-hidden className="mt-auto block pt-2">
                    <span className="block h-1.5 w-full overflow-hidden rounded-pill bg-satin-2">
                      <span className={cx("block h-full w-full origin-left rounded-pill transition-transform duration-500 ease-out", TONE_FILL[f.tone] || "bg-ink")}
                        style={{ transform: `scaleX(${f.bar[1] ? Math.min(1, f.bar[0] / f.bar[1]) : 0})` }} />
                    </span>
                  </span>
                ) : f.note && (
                  <span className="line-clamp-2 text-[11px] leading-snug text-ink-3">{f.note}</span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
