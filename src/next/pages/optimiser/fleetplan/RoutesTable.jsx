/* Every route in the plan. Tick a route to draw it on the map; ticked routes also narrow every
   figure above to them. A column head with a figure ranks the routes by it, like the figures
   above. Search, filters, ranking and pages are the old board's (fleetPlanFigures). */
import React from "react";
import { ArrowDown, ArrowUp, Check, ChevronLeft, ChevronRight, X } from "lucide-react";
import { BUS_RANK, dirWords } from "../../../../optimiser/kpiRank.js";
import { fleetPlanCompanyOf } from "../../../../optimiser/OptimiserTab.jsx";
import { Badge, Button, Card, Chip, Choice, CompanyDot, DataTable, IconButton, Search, Tag, cx, tdCls, thCls, trCls } from "../../../ui.jsx";
import { DASH, count, kms, money1, percent, plural } from "../../../format.js";
import { healthTone } from "../../../health.js";
import { longestRideOk } from "../../../../optimiser/rideHealth.js";

// the shape kpiRank.js reads a route as
const busOf = (r) => ({ riders: r.riders, cap: r.cap, cost: r.cost, ride: r.ride, km: r.km, stops: r.stops });
const TYPE = { own: "Owned", rent: "Rental" };
const COLS = [
  { label: "Bus" }, { label: "Type" }, { label: "Company" },
  { label: "Stops", rank: "avgstops" }, { label: "Riders", rank: "people" }, { label: "Seats", rank: "seats" },
  { label: "Filled", rank: "util" }, { label: "Km a day", rank: "totdist" }, { label: "Ride", rank: "ride" },
  { label: "Cost per head", rank: "cost" }, { label: "Route" },
];
// a ranking named in this page's words, whichever figure or column started it
const RANK_NAME = { cost: "cost per head", util: "seats filled", avgride: "average ride", ride: "ride", totdist: "km a day",
  avgdist: "km a rider", seats: "seats", avgstops: "stops", people: "riders" };
const num = "text-right tabular-nums";

export default function RoutesTable({ f, names, busCo, selRoutes, onTick, onTickAll, sortBy, onRank, onSort,
  typeFilter, onClearType, companyFilter, onCompany, query, onQuery, onPage }) {
  const { tableRows, pagedRows, ranked, rankOf, masterColors, companyOptions, routePageCount: pages, curRoutePage: cur, ROUTES_PER_PAGE: per } = f;
  const dirOf = (key) => (sortBy && sortBy.key === key ? sortBy.dir : null);
  const n = tableRows.length;

  return (
    <Card>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <h2 className="text-[15px] font-bold tracking-[-0.01em] text-ink">Routes</h2>
          <p className="mt-0.5 text-[13px] text-ink-3">{plural(n, "bus", "buses")}{f.rq ? " match" : ""}</p>
        </div>
        <Search value={query} onChange={onQuery} label="Search bus, company or stop" placeholder="Search bus, company or stop"
          className="w-full sm:w-[300px]" />
      </div>

      {(companyOptions.length > 1 || companyFilter || typeFilter || ranked) && (
        <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
          {(companyOptions.length > 1 || companyFilter) && (
            <Choice label="Company" value={companyFilter || ""} onChange={(v) => onCompany(v || null)}
              options={[["", "All companies"], ...companyOptions.map((c) => [c, c])]} />
          )}
          {typeFilter && <Chip on onClick={onClearType} title="Show every bus again">{TYPE[typeFilter]} buses only<X size={14} strokeWidth={2} aria-hidden /></Chip>}
          {ranked && (
            <span className="inline-flex flex-wrap items-center gap-1 sm:ml-auto">
              <span className="mr-1 text-[13px] text-ink-2">Ranked by <b className="font-semibold text-ink">{RANK_NAME[sortBy.key]}</b>, {dirWords(sortBy.dir)}</span>
              <Button variant="ghost" size="sm" onClick={() => onSort({ ...sortBy, dir: sortBy.dir === "desc" ? "asc" : "desc" })}>
                {sortBy.dir === "desc" ? "Lowest first" : "Highest first"}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => onSort(null)}>Clear</Button>
            </span>
          )}
        </div>
      )}

      {n ? (
        <DataTable label="Routes">
          <thead>
            <tr>
              <th className={thCls}>
                <Tick on={f.allSelected} onClick={onTickAll} label={f.allSelected ? "Take every route off the map" : "Draw every route on the map"} />
              </th>
              {ranked && <th className={thCls}>Rank</th>}
              {COLS.map((c) => {
                if (!c.rank) return <th key={c.label} className={thCls}>{c.label}</th>;
                const dir = dirOf(c.rank);
                return (
                  <th key={c.label} className={cx(thCls, "text-right")} aria-sort={dir === "desc" ? "descending" : dir === "asc" ? "ascending" : undefined}>
                    <button type="button" onClick={() => onRank(c.rank)}
                      title={!dir ? `Rank by ${c.label.toLowerCase()}, highest first` : dir === "desc" ? "Press for lowest first" : "Press to stop ranking"}
                      className={cx("inline-flex items-center gap-1 uppercase tracking-[0.06em] transition-colors hover:text-ink", dir && "text-ink")}>
                      {c.label}
                      {dir && (dir === "desc" ? <ArrowDown size={13} strokeWidth={2.25} aria-hidden /> : <ArrowUp size={13} strokeWidth={2.25} aria-hidden />)}
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {pagedRows.map((r) => {
              const on = selRoutes.has(r.name);
              const co = fleetPlanCompanyOf(busCo, r.name);
              const b = busOf(r);
              const filled = BUS_RANK.util.value(b);
              const perHead = BUS_RANK.cost.value(b);
              const x = rankOf && rankOf.get(r);
              const first = r.seq[0], last = r.seq[r.seq.length - 1];
              return (
                <tr key={r.uid || r.name} className={trCls}>
                  <td className={tdCls}>
                    <Tick on={on} color={masterColors[r.name]} onClick={() => onTick(r.name)}
                      label={on ? `Take ${r.name} off the map` : `Draw ${r.name} on the map`} />
                  </td>
                  {ranked && (
                    <td className={cx(tdCls, "whitespace-nowrap tabular-nums")}>
                      {x && x.rank != null ? <b className="font-bold text-ink">#{x.rank}</b> : <span className="text-ink-4">{DASH}</span>}
                    </td>
                  )}
                  <td className={cx(tdCls, "whitespace-nowrap")}>
                    <span className="inline-flex items-center gap-2">
                      {names[r.name]
                        ? <><b className="font-semibold">{names[r.name]}</b><span className="font-code text-ink-3">{r.name}</span></>
                        : <span className="font-code font-semibold">{r.name}</span>}
                      {/* a bus on several services carries only a share of its standing cost here,
                          which is why its cost per head can look low next to its peers */}
                      {r.sharedRuns > 1 && (
                        <Badge tone="neutral" title={`This bus runs ${r.sharedRuns} services, so it carries 1/${r.sharedRuns} of its loan, driver and maintenance here`}>
                          {r.sharedRuns} services
                        </Badge>
                      )}
                    </span>
                  </td>
                  <td className={cx(tdCls, "whitespace-nowrap")}>{TYPE[r.type] || r.type}</td>
                  <td className={cx(tdCls, "whitespace-nowrap")}>
                    <span className="inline-flex items-center gap-1.5"><CompanyDot unit={co} />{co}</span>
                  </td>
                  <td className={cx(tdCls, num)}>{count(r.stops)}</td>
                  <td className={cx(tdCls, num)} title={r.riders > r.cap ? `${r.riders - r.cap} over ${r.cap} seats` : undefined}>{count(r.riders)}</td>
                  <td className={cx(tdCls, num)}>{count(r.cap)}</td>
                  <td className={cx(tdCls, num)}><Filled value={filled} /></td>
                  <td className={cx(tdCls, num)}>{kms(r.km)}</td>
                  <td className={cx(tdCls, num, "whitespace-nowrap")}>
                    {!longestRideOk(r.ride)
                      ? <Tag tone="bad" className="px-2 py-0.5" title="Over 1 h 30 min">{count(r.ride)} min</Tag>
                      : <>{count(r.ride)}<span className="text-ink-3"> min</span></>}
                  </td>
                  <td className={cx(tdCls, num)}>{perHead == null ? DASH : money1(perHead)}</td>
                  <td className={cx(tdCls, "min-w-[220px]")}>
                    <span className="block">{first ? first.name : DASH} <span className="text-ink-3">· {r.km_to_last != null ? `${kms(r.km_to_last)} km` : DASH}</span></span>
                    <span className="block"><span className="text-ink-3">to </span>{last ? last.name : DASH} <span className="text-ink-3">· {r.km_to_farthest != null ? `${kms(r.km_to_farthest)} km` : DASH}</span></span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </DataTable>
      ) : (
        <div className="flex flex-col items-center py-10 text-center">
          {f.rq ? (
            <>
              <p className="text-[15px] text-ink-2">No route matches “{query.trim()}”</p>
              <Button variant="ghost" className="mt-3" onClick={() => onQuery("")}>Clear search</Button>
            </>
          ) : (
            <>
              <p className="text-[15px] text-ink-2">No routes for these filters</p>
              <Button variant="ghost" className="mt-3" onClick={() => { onCompany(null); if (typeFilter) onClearType(); }}>Show every bus</Button>
            </>
          )}
        </div>
      )}

      {pages > 1 && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-[13px] text-ink-3">
            Showing <b className="font-semibold tabular-nums text-ink">{cur * per + 1}–{Math.min(n, (cur + 1) * per)}</b> of {plural(n, "bus", "buses")}
          </p>
          <div className="flex items-center gap-2">
            <IconButton label="Previous page" icon={ChevronLeft} variant="satin" size="sm" disabled={cur === 0} onClick={() => onPage(cur - 1)} />
            <span className="px-1 text-[13px] font-semibold tabular-nums text-ink">Page {cur + 1} of {pages}</span>
            <IconButton label="Next page" icon={ChevronRight} variant="satin" size="sm" disabled={cur >= pages - 1} onClick={() => onPage(cur + 1)} />
          </div>
        </div>
      )}
    </Card>
  );
}

/* Seats filled as a soft tag in its health colour: good 90-125%, watch 50-90% or 125-150%, bad
   under 50% or over 150% (src/next/health.js, the same rule as Live). */
function Filled({ value }) {
  if (value == null) return DASH;
  return <Tag tone={healthTone(value, "neutral")} className="px-2 py-0.5">{percent(value)}</Tag>;
}

/* A round tick: filled in the route's map colour once it is on the map. */
function Tick({ on, color, label, onClick }) {
  return (
    <button type="button" role="checkbox" aria-checked={!!on} aria-label={label} title={label} onClick={onClick}
      className={cx("flex h-6 w-6 shrink-0 items-center justify-center rounded-pill transition-[background-color,transform] duration-150 active:scale-[0.92]",
        on ? "text-white" : "bg-satin-2 text-transparent shadow-[inset_0_1px_2px_rgba(23,30,60,0.14)] hover:bg-line")}
      style={on ? { background: color || "#0b0d12" } : undefined}>
      <Check size={14} strokeWidth={3} aria-hidden />
    </button>
  );
}
