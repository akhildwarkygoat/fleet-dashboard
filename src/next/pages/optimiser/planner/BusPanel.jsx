/* The plan's buses. Selecting one makes it the bus that stops are added to on the map; its row then
   shows where it starts and parks, and the tools to order or clear its stops. While a start or park
   is being chosen, the panel shows the place picker instead of the list. */
import React from "react";
import { EyeOff, Trash2, Wand2 } from "lucide-react";
import { parkLabel } from "../../../../optimiser/ParkPicker.jsx";
import { BUS_RANK, dirWords } from "../../../../optimiser/kpiRank.js";
import { PARK_COLOR } from "../../../../optimiser/plannerState.js";
import { Button, Chip, IconButton, Progress, Search, Unit, cx } from "../../../ui.jsx";
import { DASH, count, duration, kms, money, plural } from "../../../format.js";
import EndPicker from "./EndPicker.jsx";
import { Dot, FIGURE_LABEL } from "./parts.jsx";

const TONE_TEXT = { warn: "text-warn-ink", bad: "text-bad-ink" };

const Fig = ({ label, tone, children }) => (
  <span className="flex min-w-0 flex-col">
    <span className="order-2 truncate text-[11px] font-semibold text-ink-3">{label}</span>
    <span className={cx("order-1 truncate text-[15px] font-bold leading-6 tabular-nums", TONE_TEXT[tone] || "text-ink")}>{children}</span>
  </span>
);

function EndButton({ r, which, board }) {
  const { specOf, picking, setPicking } = board;
  const spec = specOf(r.bus.id, which);
  const open = !!picking && picking.busId === r.bus.id && picking.which === which;
  const start = which === "start";
  return (
    <button type="button" onClick={() => setPicking(open ? null : { busId: r.bus.id, which })} aria-pressed={open}
      aria-label={`Set where ${r.bus.name} ${start ? "starts" : "parks"}`}
      title={`${r.bus.name} ${start ? "starts from" : "parks at"}: ${parkLabel(spec, which)}`}
      className={cx("flex min-w-0 items-center gap-2 rounded-pill py-1.5 pl-1.5 pr-3 text-left transition-colors duration-150",
        open ? "bg-ink text-white" : "bg-satin-2 text-ink hover:bg-line")}>
      {/* the letter and colour match the S and P pins on the map */}
      {/* S on the deeper green, so the white letter stays readable at this size */}
      <span aria-hidden className={cx("flex h-6 w-6 shrink-0 items-center justify-center rounded-pill text-[11px] font-bold text-white", start && "bg-ok-ink")}
        style={start ? undefined : { background: PARK_COLOR }}>{start ? "S" : "P"}</span>
      <span className="min-w-0">
        <span className={cx("block text-[11px] font-semibold", open ? "text-white/70" : "text-ink-3")}>{start ? "Starts from" : "Parks at"}</span>
        <span className="block truncate text-[13px] font-semibold">{parkLabel(spec, which)}</span>
      </span>
    </button>
  );
}

function BusRow({ r, pos, value, board, editor, glass }) {
  const { activeBus, setActiveBus, busColor, rank } = board;
  const on = activeBus === r.bus.id;
  const used = r.stopIds.length > 0;
  const tone = r.overCap ? "bad" : r.overSeats ? "warn" : null;
  return (
    <li className={cx("rounded-tile p-3 transition-shadow duration-200", glass ? "bg-white/75" : "bg-satin", on && "ring-2 ring-nova")}>
      <button type="button" onClick={() => setActiveBus(on ? null : r.bus.id)} aria-pressed={on} className="block w-full rounded-tile text-left">
        <span className="flex min-w-0 items-center gap-2">
          <Dot color={busColor[r.bus.id]} />
          <span className="min-w-0 truncate font-code text-[13px] font-semibold text-ink">{r.bus.name}</span>
          <span className="shrink-0 text-[13px] text-ink-3">{r.bus.type === "rent" ? "Rental" : "Owned"}</span>
          {pos != null && (
            <span className="ml-auto shrink-0 rounded-pill bg-ink px-2 py-0.5 text-[11px] font-bold tabular-nums text-white">
              #{pos} · {BUS_RANK[rank.key].fmt(value)}
            </span>
          )}
        </span>
        <span className="mt-2 grid grid-cols-3 gap-2">
          <Fig label="Riders" tone={tone}>{count(r.heads)}<Unit className="!text-[12px]">/ {count(r.cap)}</Unit></Fig>
          <Fig label="Km a day">{used ? kms(r.km) : DASH}</Fig>
          <Fig label="Ride">{used ? duration(r.ride) : DASH}</Fig>
        </span>
      </button>
      <Progress value={r.heads} max={r.cap} size="sm" tone={tone || "ink"} label={`${r.bus.name} seats filled`} className="mt-2.5" />

      {on && used && (
        <div className="mt-3">
          <p className="text-[13px] text-ink-2">
            <b className="font-semibold tabular-nums text-ink">{money(r.cost)}</b> a day · estimate · {plural(r.stopIds.length, "stop", "stops")}
          </p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <EndButton r={r} which="start" board={board} />
            <EndButton r={r} which="park" board={board} />
          </div>
          {r.estimatedEnds && <p className="mt-2 text-[13px] text-warn-ink">Start or park point has no road distance yet · km may read low</p>}
          <div className="mt-2 grid grid-cols-2 gap-2">
            <Button variant="secondary" size="sm" icon={Wand2} onClick={() => editor.autoSequence(r.bus.id)}
              title="Put the stops in order, nearest the factory first">Order stops</Button>
            <Button variant="danger" size="sm" icon={Trash2} onClick={() => editor.clearBus(r.bus.id)}
              aria-label={`Clear all stops from ${r.bus.name}`}>Clear bus</Button>
          </div>
        </div>
      )}
    </li>
  );
}

/* Owned and Rental narrow the list to that kind of bus; each shows how many of its kind the plan
   uses. Hidden with the matching figure in the figure menu. */
function TypeChips({ board }) {
  const { ownRows, rentRows, seatSum, hiddenKpis, pressKpi, kpiOn, kpiTitle } = board;
  const types = [["owned", "Owned", ownRows], ["rental", "Rental", rentRows]].filter(([key]) => !hiddenKpis.has(key));
  if (!types.length) return null;
  return (
    <div className="flex gap-1.5 px-4 pt-3">
      {types.map(([key, label, rows]) => {
        const on = kpiOn(key);
        return (
          <Chip key={key} on={on} onClick={() => pressKpi(key)} title={`${kpiTitle(key)} · ${count(rows.length)} on this plan, ${count(seatSum(rows))} seats`}>
            {label} <span className={cx("tabular-nums", on ? "text-white/70" : "text-ink-3")}>{count(rows.length)}</span>
          </Chip>
        );
      })}
    </div>
  );
}

export default function BusPanel({ board, editor, fleetSize, listRef, glass, onHide }) {
  const { busList, busesUsed, busQuery, setBusQuery, rank, typeOnly, clearRank, picking, setPicking, nameOf, specOf, setEnd, parkPoints } = board;
  const shell = glass ? "glass pointer-events-auto max-h-full rounded-card shadow-float" : "max-h-[640px] rounded-card bg-white shadow-card";

  if (picking) {
    return (
      <section aria-label="Start or park" className={cx("flex min-h-0 w-full flex-col", shell)}>
        <EndPicker busName={nameOf(picking.busId)} which={picking.which} current={specOf(picking.busId, picking.which)} points={parkPoints}
          onPick={(spec) => setEnd(picking.busId, picking.which, spec)} onClose={() => setPicking(null)} />
      </section>
    );
  }

  const ranking = rank && `By ${(rank.key === "people" ? "riders" : FIGURE_LABEL[rank.key] || BUS_RANK[rank.key].label).toLowerCase()}, ${dirWords(rank.dir)}`;
  const kind = typeOnly === "own" ? "owned" : "rental";
  return (
    <section aria-label="Buses" className={cx("flex min-h-0 w-full flex-col", shell)}>
      <div className="flex items-center gap-2 px-4 pt-4">
        <h3 className="text-[15px] font-bold tracking-[-0.01em] text-ink">Buses</h3>
        <span className="text-[13px] tabular-nums text-ink-3">{count(busesUsed)} of {count(fleetSize)} used</span>
        {onHide && <IconButton label="Hide the bus list" icon={EyeOff} variant="ghost" size="sm" className="ml-auto -mr-1" onClick={onHide} />}
      </div>
      <TypeChips board={board} />
      <Search value={busQuery} onChange={setBusQuery} label="Find a bus" placeholder="Find a bus" className="mx-4 mt-3" />
      {ranking && (
        <div className="flex items-center gap-2 px-4 pt-2">
          <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-ink-2">{ranking}</span>
          <Button variant="ghost" size="sm" onClick={clearRank}>Clear</Button>
        </div>
      )}
      <ul ref={listRef} className="mt-2 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-4 pb-4 pt-1">
        {busList.map(({ item: r, value, rank: pos }) => (
          <BusRow key={r.bus.id} r={r} pos={pos} value={value} board={board} editor={editor} glass={glass} />
        ))}
        {!busList.length && (
          <li className="flex flex-col items-center gap-2 py-6 text-center text-[13px] text-ink-3">
            {busQuery.trim() ? `No bus matches “${busQuery.trim()}”` : typeOnly ? `No ${kind} buses` : "No buses in this fleet"}
            {typeOnly && <Button variant="ghost" size="sm" onClick={clearRank}>Show all buses</Button>}
          </li>
        )}
      </ul>
    </section>
  );
}
