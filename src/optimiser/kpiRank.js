/* ============================================================================
 * optimiser/kpiRank.js — press a KPI, see who has the most of it.
 * ----------------------------------------------------------------------------
 * A KPI tile summarises a plan. Pressing it ranks what sits under that summary by the
 * same figure: the plan's buses on the Planner and Fleet-plan boards, the saved plans
 * on the Plans page. Highest first; press again for lowest first; a third time to stop.
 *
 * One definition per kpiPrefs key, so a tile, its bus ranking and its plan ranking can
 * never disagree about what "Max ride" means. Owned and Rental are counts of a KIND of
 * bus, not a figure every bus has, so pressing them narrows the list to that kind instead.
 * ==========================================================================*/

const inr1 = (n) => "₹" + n.toFixed(1);
const num = (n, d = 0) => n.toLocaleString("en-IN", { maximumFractionDigits: d });

/* Per bus. `b` is { riders, cap, cost, ride, km, stops } — both boards map their rows onto it. */
export const BUS_RANK = {
  people:   { label: "Riders",      value: (b) => b.riders,                              fmt: (v) => `${num(v)} riders` },
  cost:     { label: "Cost / head", value: (b) => (b.riders ? b.cost / b.riders : null), fmt: (v) => `${inr1(v)}/head` },
  util:     { label: "Utilisation", value: (b) => (b.cap ? (b.riders / b.cap) * 100 : null), fmt: (v) => `${Math.round(v)}%` },
  avgride:  { label: "Ride",        value: (b) => b.ride,                                fmt: (v) => `${Math.round(v)} min` },
  ride:     { label: "Ride",        value: (b) => b.ride,                                fmt: (v) => `${Math.round(v)} min` },
  totdist:  { label: "Km / day",    value: (b) => b.km,                                  fmt: (v) => `${num(v, 1)} km` },
  avgdist:  { label: "One-way km",  value: (b) => b.km / 2,                              fmt: (v) => `${num(v, 1)} km` },
  seats:    { label: "Seats",       value: (b) => b.cap,                                 fmt: (v) => `${num(v)} seats` },
  avgstops: { label: "Stops",       value: (b) => b.stops,                               fmt: (v) => `${num(v)} stops` },
};

/* Per plan, from a scored plan body (planExport.toSolverResult: overall / owned / rental / routes). */
export const PLAN_RANK = {
  people:   { label: "People assigned", value: (p) => p.overall.riders,    fmt: (v) => `${num(v)} riders` },
  cost:     { label: "Cost / head",     value: (p) => p.overall.cost_head, fmt: (v) => `${inr1(v)}/head` },
  util:     { label: "Utilisation",     value: (p) => p.overall.util,      fmt: (v) => `${Math.round(v)}%` },
  avgride:  { label: "Avg ride",        value: (p) => p.overall.avg_ride,  fmt: (v) => `${Math.round(v)} min avg` },
  ride:     { label: "Max ride",        value: (p) => p.overall.max_ride,  fmt: (v) => `${Math.round(v)} min max` },
  totdist:  { label: "Total dist",      value: (p) => p.overall.km,        fmt: (v) => `${num(v)} km` },
  avgdist:  { label: "Dist / person",   value: (p) => {
    const riders = p.routes.reduce((n, r) => n + r.riders, 0);
    return riders ? p.routes.reduce((n, r) => n + (r.km / 2) * r.riders, 0) / riders : null;
  },                                                                          fmt: (v) => `${num(v, 1)} km one-way` },
  owned:    { label: "Owned",           value: (p) => p.owned.buses,       fmt: (v) => `${num(v)} owned` },
  rental:   { label: "Rental",          value: (p) => p.rental.buses,      fmt: (v) => `${num(v)} rental` },
  seats:    { label: "Seats",           value: (p) => p.overall.seats,     fmt: (v) => `${num(v)} seats` },
  avgstops: { label: "Stops / bus",     value: (p) => p.overall.avg_stops, fmt: (v) => `${num(v, 1)} stops/bus` },
};

/** Owned and Rental narrow a bus list to that kind; every other key ranks it. */
export const TYPE_KEYS = { owned: "own", rental: "rent" };

/** The press cycle for one key: highest first → lowest first → off. Another key starts at highest first. */
export const nextRank = (cur, key) =>
  !cur || cur.key !== key ? { key, dir: "desc" } : cur.dir === "desc" ? { key, dir: "asc" } : null;

/**
 * `items` ranked by `valueOf`, as [{ item, value, rank }]. Items with no value (a bus with no
 * stops, a plan that could not be scored) keep their order at the end with rank null, so a
 * ranking never promotes an empty bus to "lowest".
 */
export function rankBy(items, valueOf, dir) {
  const withV = items.map((item, i) => ({ item, value: valueOf(item), i }));
  const has = withV.filter((x) => x.value != null && isFinite(x.value));
  const none = withV.filter((x) => !(x.value != null && isFinite(x.value)));
  has.sort((a, b) => (dir === "asc" ? a.value - b.value : b.value - a.value) || a.i - b.i);
  return [...has.map((x, r) => ({ item: x.item, value: x.value, rank: r + 1 })),
          ...none.map((x) => ({ item: x.item, value: null, rank: null }))];
}

/** "highest first" / "lowest first", for the line that says what the list is doing. */
export const dirWords = (dir) => (dir === "asc" ? "lowest first" : "highest first");
