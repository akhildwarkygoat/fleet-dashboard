/* Stops: the service's pickup points. People is the hero figure, with the three others on the same
   row; the map beside the stop you picked (or the biggest stops until you pick one), then the full
   list. Figures, the vehicle at each stop and the search are the old board's own functions
   (OptimiserTab.jsx); this file only lays them out.
   Map dots: stops built from rider homes say whether they are on a bus route yet, light green or
   light red (Akhil: "change the unadded stop to light red and the added stops to light green",
   the Planner's own two colours); the curated 9 am network keeps one colour per route, as the old
   board drew it. Purple and slate are GMap's own marks for fixed-shift riders and inferred shifts. */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight, LocateFixed, MapPin, Users, X } from "lucide-react";
import * as store from "../../../optimiser/store.js";
import GMap, { FIXED_SHIFT_COLOR } from "../../../optimiser/GMap.jsx";
import { stopMetrics, effectiveHeads, useStopVehicles, vehicleFor, searchStops, selectedRiders } from "../../../optimiser/OptimiserTab.jsx";
import { metresBetween } from "../../../optimiser/serviceStops.js";
import { ADDED, UNADDED } from "../../../optimiser/plannerState.js";
import { SERVICES } from "../../../optimiser/services.js";
import { routeColorMap } from "../../../ui/kit.jsx";
import { NT } from "../../legacyTheme.js";
import { Aura, Badge, Button, Card, CardTitle, DataTable, Empty, Eyebrow, IconButton, Search, Stat, Tag, Tile, Tiles, Unit, cx, tdCls, thCls, trCls, useRise } from "../../ui.jsx";
import { DASH, count, kms, plural } from "../../format.js";
import MapStage, { GlassButton, GlassNote } from "./shell/MapStage.jsx";
import BackToTop from "./shell/BackToTop.jsx";

const PER = 20;
const ON = "on-route", OFF = "not-on-route";
const DOT = { [ON]: ADDED, [OFF]: UNADDED };
const ON_LABEL = "On a bus route", OFF_LABEL = "Not on a route yet";
const OFF_TITLE = "No stop within 200 m on a bus route";
const byRiders = (a, b) => (b.headcount || 0) - (a.headcount || 0);
const serviceColor = (s) => s.serviceColor || (SERVICES.find((x) => x.name === s.service) || {}).color;
const coord = (n) => (n != null ? (+n).toFixed(5) : DASH);
const busesTitle = (s) => (s.buses && s.buses.length ? s.buses.map(([b, n]) => `${b}: ${plural(n, "rider", "riders")}`).join("\n") : undefined);
const confTitle = (s) => (s.trial ? "Headcount not known: filled in at random (1 to 6) for the trial run" : "The headcount match is uncertain: check it");

// the selected row: a blue ring drawn on its cells, which keep their rounded ends (written out in
// full so Tailwind finds the classes)
const SELECTED_ROW = cx("[&>td]:bg-satin-2",
  "[&>td]:shadow-[inset_0_2px_0_#2f7bf5,inset_0_-2px_0_#2f7bf5]",
  "[&>td:first-child]:shadow-[inset_2px_0_0_#2f7bf5,inset_0_2px_0_#2f7bf5,inset_0_-2px_0_#2f7bf5]",
  "[&>td:last-child]:shadow-[inset_-2px_0_0_#2f7bf5,inset_0_2px_0_#2f7bf5,inset_0_-2px_0_#2f7bf5]");

const Dot = ({ color, className }) => <span aria-hidden className={cx("inline-block h-2.5 w-2.5 shrink-0 rounded-pill", className)} style={{ background: color }} />;

/** A round tick for a row. Ink when on, like every "on" control; the hit area is wider than the disc. */
function Tick({ on, onClick, label }) {
  return (
    <button type="button" role="checkbox" aria-checked={!!on} aria-label={label} title={label}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className="group -m-2 flex h-9 w-9 items-center justify-center rounded-pill">
      <span aria-hidden className={cx("flex h-5 w-5 items-center justify-center rounded-pill transition-colors duration-150",
        on ? "bg-ink text-white" : "bg-satin-2 group-hover:bg-line")}>
        {on && <Check size={13} strokeWidth={3} />}
      </span>
    </button>
  );
}

/** One stop: its figures, who is waiting there, and whether it is on a bus route yet. */
function StopDetail({ stop, vehicle }) {
  const [names, setNames] = useState(false);
  const people = Array.isArray(stop.people) ? stop.people : null;
  return (
    <>
      <Tiles className="grid-cols-2">
        <Tile size="sm" label="Riders" value={count(stop.headcount)} />
        {stop.depotKm != null
          ? <Tile size="sm" label="From depot" value={<>{kms(stop.depotKm)}<Unit className="!text-[12px]">km</Unit></>} />
          : <Tile size="sm" label="Company" value={stop.company || "Gainup"} />}
        <Tile size="sm" className="col-span-2" label="Vehicle" title={busesTitle(stop)} value={vehicle ? <span className="font-code">{vehicle}</span> : null} />
      </Tiles>

      {(stop.isNew || stop.nearestExistingM > 0 || stop.conf === "red") && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-[13px] text-ink-3">
          {stop.isNew && <Tag tone="bad" title={OFF_TITLE}><Dot color={UNADDED} className="!h-2 !w-2" />{OFF_LABEL}</Tag>}
          {stop.isNew === false && stop.nearestExistingM > 0 && <span>{count(stop.nearestExistingM)} m from its stop on a bus route</span>}
          {stop.conf === "red" && <Tag tone="bad" title={confTitle(stop)}>Check headcount</Tag>}
        </div>
      )}

      {stop.buses && stop.buses.length > 1 && (
        <dl className="mt-3 divide-y divide-line">
          {stop.buses.map(([b, n]) => (
            <div key={b} className="flex items-baseline justify-between gap-3 py-2">
              <dt className="font-code text-[13px] text-ink">{b}</dt>
              <dd className="text-[13px] tabular-nums text-ink-3">{plural(n, "rider", "riders")}</dd>
            </div>
          ))}
        </dl>
      )}

      {people && people.length ? (
        <div className="mt-4">
          <Button variant="secondary" size="sm" icon={Users} aria-expanded={names} onClick={() => setNames((v) => !v)}>
            {names ? "Hide employees" : "See employees"}
          </Button>
          {names && (
            <ul className="mt-3 divide-y divide-line" aria-label={`Employees at ${stop.name}`}>
              {people.map((p, i) => (
                <li key={(p.code || p.name) + i} className="flex items-baseline gap-3 py-2">
                  <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-ink">{p.name}</span>
                  {p.fixedShift && <Badge tone="violet" title="Same shift every week">Fixed shift</Badge>}
                  {p.code && <span className="font-code text-[12px] text-ink-3">{p.code}</span>}
                  {p.busId && <span className="font-code text-[12px] text-ink-3">{p.busId}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <p className="mt-4 text-[13px] text-ink-3">No names here: this network merges several homes into one stop.</p>
      )}
    </>
  );
}

/** Beside the map: the picked stop on top, then the biggest stops to pick from. */
function StopPanel({ stop, vehFor, dotFor, biggest, onPick, onClose, panelRef }) {
  const body = useRef(null);
  // a newly picked stop shows from its top, even after the list was scrolled
  useEffect(() => { if (stop && body.current) body.current.scrollTop = 0; }, [stop && stop.id]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Card ref={panelRef} padding="none" className="flex min-h-0 flex-1 flex-col overflow-hidden" aria-label={stop ? `Stop ${stop.name}` : "Biggest stops"}>
      <div ref={body} className="max-h-[560px] min-h-0 flex-1 divide-y divide-line overflow-y-auto lg:max-h-none">
        {stop && (
          <div className="px-5 pb-5 pt-5 sm:px-6">
            <div className="mb-4 flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-[15px] font-bold tracking-[-0.01em] text-ink" title={stop.name}>{stop.name}</h2>
                <p className="mt-0.5 truncate text-[13px] text-ink-3">{[stop.village, stop.service].filter(Boolean).join(" · ") || DASH}</p>
              </div>
              <IconButton label="Close stop" icon={X} variant="satin" size="sm" onClick={onClose} />
            </div>
            <StopDetail key={stop.id} stop={stop} vehicle={vehFor(stop)} />
          </div>
        )}
        <div className="px-3 pb-3 pt-4">
          <div className="mb-1 flex items-baseline justify-between gap-3 px-2 sm:px-3">
            <div className="min-w-0">
              <h3 className="text-[15px] font-bold tracking-[-0.01em] text-ink">Biggest stops</h3>
              {!stop && <p className="mt-0.5 text-[13px] text-ink-3">Select one to see who boards there</p>}
            </div>
            <span className="shrink-0 text-[11px] font-semibold text-ink-3">Riders</span>
          </div>
          {!biggest.length && <p className="px-2 py-2 text-[13px] text-ink-3 sm:px-3">No stop matches the search</p>}
          <ol className="divide-y divide-line">
            {biggest.map((s, i) => (
              <li key={s.id}>
                <button type="button" onClick={() => onPick(s.id)} aria-current={stop && stop.id === s.id ? "true" : undefined}
                  className={cx("flex w-full items-center gap-3 rounded-tile px-2 py-2.5 text-left transition-colors duration-150 sm:px-3",
                    stop && stop.id === s.id ? "bg-satin ring-2 ring-inset ring-nova" : "hover:bg-satin")}>
                  <span className="w-5 shrink-0 text-right text-[12px] font-semibold tabular-nums text-ink-3">{i + 1}</span>
                  <Dot color={dotFor(s)} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-semibold text-ink">{s.name}</span>
                    {s.village && s.village !== s.name && <span className="block truncate text-[12px] text-ink-3">{s.village}</span>}
                  </span>
                  <span className="shrink-0 text-[15px] font-bold tabular-nums text-ink">{count(s.headcount)}</span>
                </button>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </Card>
  );
}

/** How much of this service's network is already on a bus route (services built from rider homes only). */
function NetworkCard({ coverage }) {
  const on = coverage.stops - coverage.newStops;
  return (
    <Card className="shrink-0">
      <CardTitle className="!mb-3" title="Bus routes" />
      <Tiles className="grid-cols-2">
        <Tile label={<span className="inline-flex items-center gap-1.5"><Dot color={DOT[ON]} />{ON_LABEL}</span>} value={count(on)} />
        <Tile label={<span className="inline-flex items-center gap-1.5"><Dot color={DOT[OFF]} />{OFF_LABEL}</span>} value={count(coverage.newStops)} />
      </Tiles>
      <p className="mt-3 text-[13px] text-ink-3">
        {coverage.newStops > 0 ? `${count(coverage.newRiders)} of ${count(coverage.riders)} riders board at a stop not on a route yet` : `All ${count(coverage.riders)} riders board at a stop on a bus route`}
      </p>
    </Card>
  );
}

/** People: the page's one big number. Pressing it ranks the list by riders, like the other figures. */
function PeopleHero({ value, onClick, active }) {
  const As = onClick ? "button" : "section";
  return (
    <As {...(onClick ? { type: "button", onClick, "aria-pressed": !!active } : {})}
      className={cx("relative isolate col-span-2 flex min-h-[132px] flex-col overflow-hidden rounded-hero bg-white p-5 text-left shadow-card sm:col-span-3 sm:p-6 lg:col-span-2",
        onClick && "transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-float active:scale-[0.985]",
        active && "ring-2 ring-nova")}>
      <Aura size={360} intensity={0.8} className="-left-24 -top-32 -z-10" />
      <Eyebrow>People</Eyebrow>
      <span className="mt-auto flex flex-wrap items-end justify-between gap-x-4 gap-y-2 pt-3">
        <span className="text-[64px] font-bold leading-none tracking-[-0.03em] tabular-nums text-ink">{value}</span>
        <span className="pb-1 text-[13px] text-ink-3">Allocated · from the ERP</span>
      </span>
    </As>
  );
}

function Figures({ metrics, stopsNote, from, rank, rankBy }) {
  const has = metrics && metrics.totalStops > 0;
  return (
    <div data-rise className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      <PeopleHero value={has ? count(metrics.totalPeople) : DASH} onClick={has ? () => rankBy("riders") : undefined} active={rank === "riders"} />
      <Stat label="Stops" value={has ? count(metrics.totalStops) : DASH} note={has ? stopsNote : undefined} />
      <Stat label="People per stop" value={has ? metrics.avgPerStop.toFixed(1) : DASH} />
      <Stat label="Distance per person" className="col-span-2 sm:col-span-1" value={has ? <>{metrics.avgDist.toFixed(1)}<Unit>km</Unit></> : DASH}
        note={`Straight line from ${from}`} onClick={has ? () => rankBy("distance") : undefined} active={rank === "distance"} />
    </div>
  );
}

export default function StopsBoard({ stops, viewStops, routes, depot, coverage, calibrate = true, svc }) {
  const [selectedId, setSelectedId] = useState(null);
  const [checked, setChecked] = useState(() => new Set()); // ticked stops: only these on the map
  const toggleCheck = (id) => setChecked((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);
  const [rank, setRank] = useState(null);   // "riders" | "distance" | null (the network's own order)
  const [fitKey, setFitKey] = useState(0);
  const { stopVeh, planDemand } = useStopVehicles(svc);
  // a service routes from its own depot (Zenwear runs out of Subbulapuram)
  const dep = depot || store.getDepot();

  const metrics = useMemo(() => stopMetrics(stops, dep, calibrate), [stops, planDemand]); // eslint-disable-line react-hooks/exhaustive-deps
  const effHead = useMemo(() => effectiveHeads(stops, calibrate), [stops]); // eslint-disable-line react-hooks/exhaustive-deps
  const withEffHead = (arr) => arr.map((s) => ({ ...s, headcount: effHead.get(s.id) ?? s.headcount }));
  const vehFor = (s) => vehicleFor(stopVeh, s);
  const filtered = useMemo(() => searchStops(viewStops, q, vehFor), [viewStops, q, stopVeh]); // eslint-disable-line react-hooks/exhaustive-deps

  // stops built from rider homes say whether they are on a route; the curated network keeps its route colours
  const onRoutes = useMemo(() => viewStops.some((s) => typeof s.isNew === "boolean"), [viewStops]);
  const colors = useMemo(() => (onRoutes ? DOT : routeColorMap(routes || [])), [onRoutes, routes]);
  const keyOf = (s) => (onRoutes ? (s.isNew ? OFF : ON) : s.route);
  const dotFor = (s) => colors[keyOf(s)] || NT.primary;

  const ranked = useMemo(() => {
    if (rank === "riders") return [...filtered].sort(byRiders);
    if (rank === "distance") {
      const far = (s) => (s.lat == null || s.lng == null ? -1 : metresBetween(s, dep));
      return [...filtered].sort((a, b) => far(b) - far(a));
    }
    return filtered;
  }, [filtered, rank, dep.lat, dep.lng]); // eslint-disable-line react-hooks/exhaustive-deps
  const biggest = useMemo(() => [...filtered].sort(byRiders).slice(0, 12), [filtered]);

  const search = (v) => { setQ(v); setPage(0); };
  const rankBy = (r) => { setRank((cur) => (cur === r ? null : r)); setPage(0); };
  const pageCount = Math.max(1, Math.ceil(ranked.length / PER));
  const pageSafe = Math.min(page, pageCount - 1);
  const paged = ranked.slice(pageSafe * PER, pageSafe * PER + PER);
  const mapStops = useMemo(() => withEffHead(checked.size ? viewStops.filter((s) => checked.has(s.id)) : filtered)
    .map((s) => (onRoutes ? { ...s, route: keyOf(s) } : s)),
    [checked, viewStops, filtered, effHead, onRoutes]); // eslint-disable-line react-hooks/exhaustive-deps
  const sel = selectedId ? viewStops.find((s) => s.id === selectedId) || null : null;
  const byService = viewStops.some((s) => s.service);
  const lastCol = coverage ? "From depot" : "Company";
  const anyOff = mapStops.some((s) => s.isNew);
  const anyFixed = mapStops.some((s) => s.fixedShift > 0);
  const allOnPage = paged.length > 0 && paged.every((s) => checked.has(s.id));
  const stopsNote = coverage ? "One per home, nothing merged"
    : byService ? `Across ${plural(new Set(viewStops.map((s) => s.service)).size, "service", "services")}`
    : "Merged within 200 m";
  // Zenwear runs from its own site; every other service from the factory
  const from = svc && svc.branch ? svc.depot.name.split(" — ").pop() : "the factory";
  const showAll = () => setChecked(new Set());

  const root = useRef(null), panel = useRef(null);
  useRise(root, true);

  if (!stops.length) {
    return (
      <div ref={root} className="flex flex-col gap-3">
        <Figures from={from} />
        <Card data-rise padding="none">
          <Empty icon={MapPin} title="No stops yet" hint="Stops appear here once the ERP has riders with a home location for this service." />
        </Card>
      </div>
    );
  }

  const pickFromList = (id) => {
    setSelectedId(id);
    requestAnimationFrame(() => panel.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }));
  };
  const fit = () => { setSelectedId(null); setFitKey((k) => k + 1); };

  const overlay = (big) => (
    <>
      {big && sel && (
        <div className="glass pointer-events-auto max-h-[50vh] w-[min(380px,100%)] overflow-y-auto rounded-tile p-4 shadow-float">
          <div className="mb-3 flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-bold text-ink">{sel.name}</p>
              {sel.village && <p className="truncate text-[13px] text-ink-3">{sel.village}</p>}
            </div>
            <IconButton label="Close stop" icon={X} variant="satin" size="sm" onClick={() => setSelectedId(null)} />
          </div>
          <StopDetail key={sel.id} stop={sel} vehicle={vehFor(sel)} />
        </div>
      )}
      {checked.size > 0 && (
        <div className="pointer-events-auto flex flex-wrap items-center gap-2">
          <GlassNote>{plural(checked.size, "ticked stop", "ticked stops")} · {plural(selectedRiders(viewStops, checked, effHead), "rider", "riders")}</GlassNote>
          <GlassButton onClick={showAll}>Show every stop</GlassButton>
        </div>
      )}
      {(onRoutes || anyFixed) && (
        <GlassNote>
          {onRoutes && <span className="inline-flex items-center gap-1.5"><Dot color={DOT[ON]} />{ON_LABEL}</span>}
          {anyOff && <span className="inline-flex items-center gap-1.5"><Dot color={DOT[OFF]} />{OFF_LABEL}</span>}
          {anyFixed && <span className="inline-flex items-center gap-1.5"><Dot color={FIXED_SHIFT_COLOR} />Fixed shift</span>}
        </GlassNote>
      )}
    </>
  );

  return (
    <div ref={root} className="flex flex-col gap-3">
      <Figures metrics={metrics} stopsNote={stopsNote} from={from} rank={rank} rankBy={rankBy} />

      <div data-rise className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_360px] xl:grid-cols-[minmax(0,1fr)_400px]">
        <MapStage label={svc ? `Stops of ${svc.name}` : "Stops"} overlay={overlay}
          tools={<GlassButton icon={LocateFixed} title="Fit every stop in view" onClick={fit}>Fit</GlassButton>}
          render={(h, big) => (
            <GMap key={fitKey} t={NT} stops={mapStops} routeColors={colors} depot={dep} selectedId={selectedId}
              onSelect={setSelectedId} height={h} scrollWheelZoom={big} />
          )} />
        <div className="flex min-h-0 flex-col gap-3 lg:h-[520px]">
          {coverage && <NetworkCard coverage={coverage} />}
          <StopPanel stop={sel} vehFor={vehFor} dotFor={dotFor} biggest={biggest} panelRef={panel}
            onPick={setSelectedId} onClose={() => setSelectedId(null)} />
        </div>
      </div>

      <Card data-rise padding="none">
        <div className="flex flex-wrap items-end justify-between gap-3 px-5 pt-5 sm:px-6">
          <div className="min-w-0">
            <h2 className="text-[15px] font-bold tracking-[-0.01em] text-ink">Stop list</h2>
            <p className="mt-0.5 text-[13px] text-ink-3">
              {plural(ranked.length, "stop", "stops")}{q.trim() ? " match" : ""}
              {rank === "riders" ? " · most people first" : rank === "distance" ? ` · farthest from ${from} first` : ""}
            </p>
          </div>
          <div className="flex w-full items-center gap-2 sm:w-auto">
            {checked.size > 0 && <Button variant="ghost" size="sm" onClick={showAll}>Show every stop</Button>}
            <Search value={q} onChange={search} label="Search stop, village or vehicle" placeholder="Search stop, village or vehicle" className="w-full sm:w-[320px]" />
          </div>
        </div>
        {paged.length ? (
          <div className="px-2 pb-2 pt-3 sm:px-3">
            <DataTable label="Stops">
              <thead>
                <tr>
                  <th className={thCls}>
                    <Tick on={allOnPage} label={allOnPage ? "Untick every stop on this page" : "Tick every stop on this page to show only them on the map"}
                      onClick={() => setChecked((prev) => { const n = new Set(prev); paged.forEach((s) => (allOnPage ? n.delete(s.id) : n.add(s.id))); return n; })} />
                  </th>
                  <th className={thCls}>Stop</th>
                  <th className={thCls}>Vehicle</th>
                  <th className={thCls}>Village</th>
                  <th className={thCls}>Location</th>
                  <th className={cx(thCls, "text-right")}>Riders</th>
                  {byService && <th className={thCls}>Service</th>}
                  <th className={thCls}>{lastCol}</th>
                </tr>
              </thead>
              <tbody>
                {paged.map((s) => {
                  const on = selectedId === s.id, v = vehFor(s);
                  return (
                    <tr key={s.id} onClick={() => pickFromList(s.id)} className={cx("cursor-pointer", on ? SELECTED_ROW : trCls)}>
                      <td className={tdCls}><Tick on={checked.has(s.id)} label={`Show ${s.name} on the map`} onClick={() => toggleCheck(s.id)} /></td>
                      <td className={cx(tdCls, "min-w-[180px]")}>
                        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <button type="button" onClick={(e) => { e.stopPropagation(); pickFromList(s.id); }} aria-current={on ? "true" : undefined}
                            className="rounded-pill text-left font-semibold text-ink">{s.name}</button>
                          {s.isNew && <Badge tone="bad" title={OFF_TITLE}><Dot color={UNADDED} className="!h-2 !w-2" />{OFF_LABEL}</Badge>}
                          {s.conf === "red" && <Badge tone="bad" title={confTitle(s)}>Check headcount</Badge>}
                        </span>
                      </td>
                      <td className={cx(tdCls, "whitespace-nowrap")}>
                        {v ? <span className="font-code text-ink" title={busesTitle(s)}>{v}</span> : <span className="text-ink-4">{DASH}</span>}
                      </td>
                      <td className={tdCls}>{s.village || <span className="text-ink-4">{DASH}</span>}</td>
                      <td className={cx(tdCls, "whitespace-nowrap font-code text-[13px] text-ink-3")}>
                        {s.lat != null || s.lng != null ? `${coord(s.lat)}, ${coord(s.lng)}` : DASH}
                      </td>
                      <td className={cx(tdCls, "text-right font-semibold tabular-nums")}>{count(s.headcount)}</td>
                      {byService && (
                        <td className={cx(tdCls, "whitespace-nowrap")}>
                          {s.service ? <span className="inline-flex items-center gap-1.5 text-ink-2"><Dot color={serviceColor(s)} />{s.service}</span> : <span className="text-ink-4">{DASH}</span>}
                        </td>
                      )}
                      <td className={cx(tdCls, "whitespace-nowrap")}>
                        {s.depotKm != null ? <span className="tabular-nums text-ink-2">{kms(s.depotKm)} km</span> : <span className="text-ink-2">{s.company || "Gainup"}</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </DataTable>
          </div>
        ) : (
          <div className="flex flex-col items-center px-6 py-10 text-center">
            <p className="text-[15px] text-ink-2">No stop matches “{q.trim()}”</p>
            <Button variant="ghost" className="mt-3" onClick={() => search("")}>Clear search</Button>
          </div>
        )}
        {pageCount > 1 && (
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 pb-5 pt-2 sm:px-6">
            <span className="text-[13px] tabular-nums text-ink-3">
              Showing {count(pageSafe * PER + 1)}–{count(Math.min(ranked.length, pageSafe * PER + PER))} of {count(ranked.length)}
            </span>
            <div className="flex items-center gap-2">
              <Button variant="secondary" size="sm" icon={ChevronLeft} disabled={pageSafe === 0} onClick={() => setPage(pageSafe - 1)}>Previous</Button>
              <Button variant="secondary" size="sm" iconRight={ChevronRight} disabled={pageSafe >= pageCount - 1} onClick={() => setPage(pageSafe + 1)}>Next</Button>
            </div>
          </div>
        )}
      </Card>
      <BackToTop />
    </div>
  );
}
