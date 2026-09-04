/* ============================================================================
 * optimiser/RotaWeekPicker.jsx — which rota week the Rotational plans are drawn for.
 * ----------------------------------------------------------------------------
 * The three Rotational slots are fixed clocks; the riders in them step one place
 * every Monday (src/rotation.json). So "the Day plan" is a different group's plan
 * each week, and every board that draws one has to agree on WHICH week it is
 * drawing. Left alone the app follows the calendar. This control lets the transport
 * manager look ahead (next Monday's plans, before the buses run them) or back, by
 * PINNING a week — one persisted, app-wide choice that every consumer picks up
 * through the "rota-week" event, so the Fleet plan, Planner, Timings and T.I can
 * never disagree about which group is on which clock.
 *
 * A pin is a preview and says so. Stepping back onto the current calendar week
 * UNPINS rather than pinning "this week": a pin on this week silently becomes a pin
 * on last week at midnight on Sunday, and nothing on screen would say so.
 *
 * WHO is on each slot is a different question (the frozen roster) and is not
 * touched here — the picker only chooses which finalised plan each slot shows.
 * ==========================================================================*/
import React, { useState, useEffect } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { ROTATION_SLOTS } from "./services.js";
import {
  ROTATION, getRotaWeek, setRotaWeek, isRotaWeekPinned, subscribeRotaWeek,
  mondayOf, rotationFor, fmtWeek,
} from "./rotation.js";

/* Clock order, not cycle order: the strip reads as a day — 06:00, 14:00, 22:00 —
   which is how the floor names them. ROTATION_SLOTS is in cycle order (day, full,
   half) because that is the direction riders step; it is looked up by id here. */
const STRIP = ["day", "half", "full"];
const slotOf = (id) => ROTATION_SLOTS.find((s) => s.id === id) || { id, name: id, color: "#64748b" };
const groupLabel = (gid) => (gid && ROTATION.groups[gid] ? ROTATION.groups[gid].label : "—");

/** ISO Monday shifted by `days`, parsed as a LOCAL date so IST midnight never rolls
 *  the Monday back to the Sunday before it. */
export function shiftWeek(iso, days) {
  const [y, m, d] = String(iso).split("-").map(Number);
  return mondayOf(new Date(y, m - 1, d + days));
}

/** The rota week every rotational consumer should draw: the pinned week if any, else
 *  this calendar week. Re-renders the caller when the pin changes anywhere in the app. */
export function useRotaWeek() {
  const [week, setWeek] = useState(() => getRotaWeek());
  useEffect(() => subscribeRotaWeek(() => setWeek(getRotaWeek())), []);
  return week;
}

/** One line: "Day · Group 2   Half night · Group 3   Full night · Group 1". Exported so a
 *  board can restate the rota next to figures that depend on it. */
export function RotationStrip({ t, week, className = "" }) {
  const rota = rotationFor(week);
  return (
    <span className={"inline-flex flex-wrap items-center gap-x-3 gap-y-1 text-xs " + className} style={{ color: t.muted }}>
      {STRIP.map((id) => {
        const sl = slotOf(id);
        return (
          <span key={id} className="inline-flex items-center gap-1.5 whitespace-nowrap">
            {/* colour is the slot's identity across every view; the name beside it is the
                second channel so the strip still reads without it */}
            <span className="w-2 h-2 rounded-full" style={{ background: sl.color }} />
            <span style={{ color: t.text, fontWeight: 600 }}>{sl.name}</span>
            <span>· {groupLabel(rota.bySlot[id])}</span>
          </span>
        );
      })}
    </span>
  );
}

export default function RotaWeekPicker({ t, toast }) {
  const week = useRotaWeek();
  const thisWeek = mondayOf(new Date());
  /* Tracked on the event, not read at render: a pin set on Friday for "next Monday" becomes
     the calendar week when Monday arrives, so dropping it leaves `week` unchanged and the
     week hook alone would not re-render — the reset button would outlive the pin. */
  const [pinned, setPinned] = useState(() => isRotaWeekPinned());
  useEffect(() => subscribeRotaWeek(() => setPinned(isRotaWeekPinned())), []);
  const previewing = week !== thisWeek;

  const announce = (w) => {
    if (!toast) return;
    const r = rotationFor(w);
    toast(`Rotational plans now showing the ${fmtWeek(w)}${w === thisWeek ? " (this week)" : ""} — ` +
          STRIP.map((id) => `${slotOf(id).name} ${groupLabel(r.bySlot[id])}`).join(", "));
  };
  const step = (days) => {
    const next = shiftWeek(week, days);
    setRotaWeek(next === thisWeek ? null : next);
    announce(next);
  };
  const reset = () => { setRotaWeek(null); announce(thisWeek); };

  const navBtn = { color: t.muted, cursor: "pointer", background: "transparent", border: "none" };

  return (
    <div className="inline-flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <div className="inline-flex items-center gap-1 rounded-xl p-1" style={{ background: t.surface2, border: "1px solid " + t.border }}>
        <span className="text-[10px] font-bold uppercase tracking-wider px-2" style={{ color: t.faint }}>Rota week</span>
        <button type="button" onClick={() => step(-7)} aria-label="Previous rota week" title="Previous week"
          className="rounded-lg px-1.5 py-1" style={navBtn}><ChevronLeft size={14} /></button>
        <span className="px-1 text-xs font-semibold tabular-nums whitespace-nowrap" style={{ color: t.text }} title={`Monday ${week}`}>
          {fmtWeek(week)}
        </span>
        <button type="button" onClick={() => step(7)} aria-label="Next rota week" title="Next week"
          className="rounded-lg px-1.5 py-1" style={navBtn}><ChevronRight size={14} /></button>
        {/* Only offered while there is a pin to drop; an always-present reset would suggest
            the picker is somewhere other than "this week" when it is not. */}
        {pinned && (
          <button type="button" onClick={reset} title="Follow the calendar again"
            className="rounded-lg px-2 py-1 text-xs font-semibold"
            style={{ background: t.raised, color: t.text, border: "1px solid " + t.border, cursor: "pointer" }}>
            This week
          </button>
        )}
      </div>
      <RotationStrip t={t} week={week} />
      {previewing && (
        <span className="text-[11px] font-semibold" style={{ color: t.watch }}>
          previewing — plans follow this week until you reset
        </span>
      )}
    </div>
  );
}
