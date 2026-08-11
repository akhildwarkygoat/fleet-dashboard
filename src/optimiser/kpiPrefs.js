/* ============================================================================
 * optimiser/kpiPrefs.js — which KPIs the Fleet-plan and Planner boards show.
 * ----------------------------------------------------------------------------
 * One list, one preference, both boards. The two views used to carry different
 * metrics — Fleet plan had ten, the Planner four — so a number you were steering
 * by while building a plan vanished the moment you looked at the finished one.
 *
 * The preference is a set of DISABLED keys rather than enabled ones, so a KPI
 * added here later shows up for everyone instead of being invisible to anyone
 * who had already saved a preference.
 * ==========================================================================*/
const KEY = "opt-kpi-hidden";

/* The canonical list. `key` is what gets stored; `label` is what the settings
   panel shows. Order here is the order the boards render in. */
export const KPI_DEFS = [
  { key: "cost", label: "Cost / head", hint: "₹ per rider per day" },
  { key: "util", label: "Utilisation", hint: "riders as a share of seats" },
  { key: "avgride", label: "Avg ride", hint: "people-weighted average trip" },
  { key: "ride", label: "Max ride", hint: "longest single trip" },
  { key: "totdist", label: "Total dist", hint: "km across the whole fleet" },
  { key: "avgdist", label: "Dist / person", hint: "one-way km per rider" },
  { key: "owned", label: "Owned", hint: "owned buses and their seats" },
  { key: "rental", label: "Rental", hint: "rented buses and their seats" },
  { key: "seats", label: "Seats", hint: "total seats against riders" },
  { key: "avgstops", label: "Stops / bus", hint: "average stops per route" },
  { key: "people", label: "People assigned", hint: "Planner only — assignment progress" },
];

export function getHiddenKpis() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "[]");
    return new Set(Array.isArray(raw) ? raw : []);
  } catch { return new Set(); }
}

export function setHiddenKpis(set) {
  try { localStorage.setItem(KEY, JSON.stringify([...set])); } catch { /* quota */ }
}

/** Drop the hidden cells from a list of KPI cells, keeping the caller's order. */
export const visibleKpis = (cells, hidden) => cells.filter((c) => c && !hidden.has(c.key));
