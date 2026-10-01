/* Small pieces the Planner needs that the kit does not have. */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Flip } from "gsap/Flip";
import { cx } from "../../../ui.jsx";
import { count, duration, kms, money1, percent } from "../../../format.js";
import { EASE, gsap, still } from "../../../motion.js";

gsap.registerPlugin(Flip);

/** True while a media query matches; follows the window as it resizes. */
export function useMedia(query) {
  const [on, setOn] = useState(() => typeof matchMedia === "function" && matchMedia(query).matches);
  useEffect(() => {
    const m = matchMedia(query);
    const sync = () => setOn(m.matches);
    sync();
    m.addEventListener("change", sync);
    return () => m.removeEventListener("change", sync);
  }, [query]);
  return on;
}

/** The gallery's grid, `grid sm:grid-cols-2 lg:grid-cols-3`: three columns on desk, the same as the
 *  row of start cards above it, so the two rows line up. */
export const GRID = "grid gap-3 sm:grid-cols-2 lg:grid-cols-3";

/** How many columns GRID is showing. */
export function useCols() {
  const sm = useMedia("(min-width: 640px)"), lg = useMedia("(min-width: 1024px)");
  return lg ? 3 : sm ? 2 : 1;
}

/** The window's height, kept current. */
export function useWinH() {
  const [h, setH] = useState(() => window.innerHeight);
  useEffect(() => {
    const on = () => setH(window.innerHeight);
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return h;
}

/** Cards slide to their new places when a list is re-ordered, so the eye follows them.
 *  Call `capture()` just before the order changes and `play()` once it has rendered. */
export function useFlip(ref) {
  const state = useRef(null);
  return useMemo(() => ({
    capture() { if (ref.current && !still()) state.current = Flip.getState(ref.current.children); },
    play() {
      if (!state.current) return;
      Flip.from(state.current, { duration: 0.42, ease: EASE, nested: true,
        onEnter: (els) => gsap.fromTo(els, { opacity: 0 }, { opacity: 1, duration: 0.2 }) });
      state.current = null;
    },
  }), [ref]);
}

/* The shared plan logic words a few messages for the old look; these say them plainly. */
const PLAIN = new Map([
  ["Couldn't score that plan — open it once, then finalise", "Open that plan once, then finalise it"],
  ["That file isn't a plan export — expected the JSON the Planner's Export button writes", "That file is not a plan. Choose a file saved with Export plan file."],
  ["No routes in that file matched this fleet — is it from the same dashboard?", "No route in that file matches this fleet"],
  ["Pick a bus first, then click stops on the map", "Select a bus first, then select stops on the map"],
  ["Exported plan JSON", "Plan file exported"],
]);
export function usePlain(toast) {
  return useCallback((m) => { if (toast) toast(PLAIN.get(m) || m); }, [toast]);
}

/** The words for each plan figure, the same on the board, its menu and the gallery. */
export const FIGURE_LABEL = {
  people: "Riders on a bus", cost: "Cost / head", util: "Seats filled", avgride: "Average ride", ride: "Longest ride",
  totdist: "Km a day", avgdist: "Km per rider", owned: "Owned buses", rental: "Rental buses", seats: "Seats",
  avgstops: "Stops per bus",
};
const FIGURE_FMT = {
  people: count, cost: money1, util: percent, avgride: duration, ride: duration, totdist: (v) => `${count(v)} km`,
  avgdist: (v) => `${kms(v)} km`, owned: count, rental: count, seats: count, avgstops: kms,
};
/** A plan figure written the board's way ("1 h 5 min", "₹40.6", "87%"). */
export const fmtFigure = (key, v) => (FIGURE_FMT[key] || count)(v);

/** Fields and selects sitting straight on the satin page: white on a soft shadow, as on Live. */
export const ON_PAGE = "[&_input]:bg-white [&_input]:shadow-chip [&_input:hover]:bg-satin [&_select]:bg-white [&_select]:shadow-chip [&_select:hover]:bg-satin";

/** True when the board's stops are the saved plan's: the same stops on the same buses, in order.
 *  A bus with no stops counts the same as a bus that is not there. */
export function sameStops(saved, assign) {
  const busy = (entries) => entries.filter(([, ids]) => ids && ids.length);
  const a = busy(Object.entries(saved || {})), b = busy([...assign]);
  if (a.length !== b.length) return false;
  const byBus = new Map(b);
  return a.every(([bus, ids]) => {
    const other = byBus.get(bus);
    return other && other.length === ids.length && other.every((id, i) => id === ids[i]);
  });
}

/** A small coloured dot that matches something drawn on the map. */
export const Dot = ({ color, className }) => (
  <span aria-hidden className={cx("inline-block h-2.5 w-2.5 shrink-0 rounded-pill", className)} style={{ background: color }} />
);
