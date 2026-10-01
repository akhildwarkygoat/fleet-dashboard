/* Live: the whole fleet at a glance. One number (seats filled), cost per head both ways, the fleet
   size, then every bus folded into its company. The figures are the old Live tab's, from the same
   functions: each bus on its latest day with data, health scored against the fleet's median cost
   per head. Pressing a figure card ranks the buses by that figure and opens the companies. */
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Bus, RotateCw, WifiOff } from "lucide-react";
import { UNITS, aggregate, busLatestDate, effWorkingDays, metricsFor, resolveRec } from "../../Dashboard.jsx";
import { Button, Card, Choice, Empty, Field, PageHead, Search, Select, cx, useRise } from "../ui.jsx";
import { count, plural, squash } from "../format.js";
import { go } from "../route.js";
import BusGroup, { BusGrid } from "./live/BusGroup.jsx";
import { CostCard, FleetCard } from "./live/FigureCards.jsx";
import HeroCard from "./live/HeroCard.jsx";
import LiveLoading from "./live/LiveLoading.jsx";
import { driverOf, perHead, routeOf, utilOf } from "./live/figures.js";
import { HEALTH, HEALTH_RANK, utilHealth } from "../health.js";

// At rest the buses run in vehicle order: the vehicle is the name on every card. The route is a plan
// summary ("12 stops · 45 km · 50 min ride"), so A to Z on it reads as no order at all.
const BASE = "vehicle";
const SORTS = [
  ["vehicle", "Vehicle, A to Z", (a, b) => a.bus.vehicle.localeCompare(b.bus.vehicle)],
  ["route", "Route, A to Z", (a, b) => (a.bus.route || "").localeCompare(b.bus.route || "")],
  ["util", "Seats filled, high to low", (a, b) => b.m.util - a.m.util],
  ["cph", "Cost per head by km, high to low", (a, b) => b.m.cph - a.m.cph],
  ["health", "Bad first", (a, b) => (HEALTH_RANK[a.h] ?? 3) - (HEALTH_RANK[b.h] ?? 3)],
];
const SORT_FN = Object.fromEntries(SORTS.map(([key, , fn]) => [key, fn]));
const SHOW = ["good", "watch", "bad"];
const DOT = { good: "bg-ok", watch: "bg-warn", bad: "bg-bad" };
const SHOW_FN = { all: () => true, good: (x) => x.h === "good", watch: (x) => x.h === "watch", bad: (x) => x.h === "bad" };

// these fields sit straight on the satin page, so they take the chips' white and soft shadow
const ON_PAGE = "[&_input]:bg-white [&_input]:shadow-chip [&_input:hover]:bg-satin [&_select]:bg-white [&_select]:shadow-chip [&_select:hover]:bg-satin";
const Labelled = ({ label, className, children }) => (
  <div className={cx("flex min-w-0 flex-col gap-1.5", className)}>
    <span className="text-xs font-semibold text-ink-3">{label}</span>
    {children}
  </div>
);

/* What was typed or picked, and where the list was scrolled, survive a trip to a bus page and back. */
const kept = { q: "", show: "all", sort: BASE, y: null };
function useKept(key) {
  const [value, set] = useState(kept[key]);
  return [value, useCallback((v) => { kept[key] = v; set(v); }, [key])];
}

const OPEN_KEY = "next:live:open";
function readOpen() {
  try { return JSON.parse(localStorage.getItem(OPEN_KEY)) || {}; } catch { return {}; }
}

export default function LivePage({ fleet }) {
  const { loaded, effBuses: buses, effRecords: records, employees, attendance, settings, erpStatus, syncErp } = fleet;
  const wd = effWorkingDays(settings);
  const [q, setQ] = useKept("q");
  const [show, setShow] = useKept("show");
  const [sort, setSort] = useKept("sort");
  const [open, setOpen] = useState(readOpen); // companies opened by hand; saved
  const [shut, setShut] = useState({ key: "", units: {} }); // closed by hand while a search, filter or ranking had them open

  // each bus on its latest day with data, as on the old Live tab
  const pairs = useMemo(() => buses.map((b) => {
    const d = busLatestDate(records, employees, attendance, b.id);
    return d ? { bus: b, rec: resolveRec(records, employees, attendance, b.id, d), date: d } : null;
  }).filter(Boolean), [buses, records, employees, attendance]);

  const rows = useMemo(() => pairs.map((p) => {
    const m = metricsFor(p.rec, p.bus, wd);
    // health from seats filled only (src/next/health.js); no seat count in the ERP = no grade
    return { ...p, m, h: utilHealth(utilOf(m)),
      find: [p.bus.vehicle, routeOf(p.bus), driverOf(p.bus)].map(squash) };
  }), [pairs, wd]);
  const newest = useMemo(() => rows.reduce((a, x) => (x.date > a ? x.date : a), ""), [rows]);

  const sq = squash(q);
  const found = useMemo(() => (sq ? rows.filter((x) => x.find.some((s) => s.includes(sq))) : rows), [rows, sq]);
  const counts = useMemo(() => Object.fromEntries(SHOW.map((h) => [h, found.filter((x) => x.h === h).length])), [found]);
  const shown = useMemo(() => found.filter(SHOW_FN[show]).sort(SORT_FN[sort]), [found, show, sort]);
  const agg = useMemo(() => aggregate(shown, wd), [shown, wd]);
  // the ERP sent no costs for these buses, either way (an empty list is not the ERP's doing)
  const noCosts = agg.count > 0 && agg.spend === 0 && agg.budget === 0 && !(agg.spend_diesel > 0);
  const cph = perHead(agg);
  const groups = useMemo(() => UNITS.map((unit) => {
    const list = shown.filter((x) => x.bus.unit === unit);
    const tally = { bad: 0, watch: 0, good: 0 };
    list.forEach((x) => { if (x.h) tally[x.h]++; });
    return { unit, list, tally, agg: aggregate(list, wd) };
  }), [shown, wd]);
  const attention = useMemo(() => [
    ...shown.filter((x) => x.h === "bad" && x.m.util < 50).sort((a, b) => a.m.util - b.m.util),
    ...shown.filter((x) => x.h === "bad" && x.m.util > 150).sort((a, b) => b.m.util - a.m.util),
  ], [shown]);
  const fleetBy = useMemo(() => Object.fromEntries(UNITS.map((u) => [u, buses.filter((b) => b.unit === u).length])), [buses]);

  // idle counts as loading only while an automatic sync is about to start
  const syncing = erpStatus.phase === "syncing" || (erpStatus.phase === "idle" && settings.erpAuto);
  const waiting = !loaded || (!rows.length && syncing);
  const ready = !waiting && rows.length > 0;
  const root = useRef(null);
  useRise(root, ready);

  // A search, a filter or a ranking opens every company with a match, until it is closed by hand.
  // Worked out here rather than saved, so a reload starts with only the companies opened by hand.
  const autoKey = sq || show !== "all" || sort !== BASE ? `${show} ${sort} ${sq}` : "";
  const shutNow = shut.key === autoKey ? shut.units : {};
  const isOpen = (g) => !!open[g.unit] || (!!autoKey && g.list.length > 0 && !shutNow[g.unit]);
  const toggle = (g) => {
    const next = !isOpen(g);
    setOpen((o) => ({ ...o, [g.unit]: next }));
    setShut({ key: autoKey, units: { ...shutNow, [g.unit]: !next } });
  };

  useEffect(() => {
    try { localStorage.setItem(OPEN_KEY, JSON.stringify(open)); } catch { /* storage blocked: groups start closed next time */ }
  }, [open]);

  // back from a bus, the list is where it was (every page change scrolls to the top)
  const openBus = useCallback((id) => { kept.y = window.scrollY; go("bus", id); }, []);
  useLayoutEffect(() => {
    if (!ready || kept.y == null) return;
    window.scrollTo(0, kept.y);
    kept.y = null;
  }, [ready]);

  // pressed again, a figure card puts the buses back in vehicle order
  const rankBy = (s) => setSort(sort === s ? BASE : s);

  if (waiting) {
    return (
      <>
        <PageHead title="Live" />
        <LiveLoading progress={erpStatus.progress} />
      </>
    );
  }
  if (!rows.length) {
    const sync = (label) => <Button variant="primary" icon={RotateCw} onClick={() => syncErp()}>{label}</Button>;
    return (
      <>
        <PageHead title="Live" />
        {erpStatus.phase === "error" ? (
          <Card padding="none" role="alert">
            <Empty icon={WifiOff} title="Can’t reach the ERP" hint="Check the factory network, then press Retry." action={sync("Retry")} />
          </Card>
        ) : buses.length ? (
          <Card padding="none">
            <Empty icon={Bus} title="No attendance from the ERP yet"
              hint={`${plural(buses.length, "bus is", "buses are")} in the ERP. Their figures appear once riders punch in.`} action={sync("Sync now")} />
          </Card>
        ) : (
          <Card padding="none">
            <Empty icon={Bus} title="No buses from the ERP yet" hint="Buses appear here once the ERP has today’s fleet." action={sync("Sync now")} />
          </Card>
        )}
      </>
    );
  }

  return (
    <div ref={root}>
      <PageHead title="Live" />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {/* plain wrappers carry the rise, so it never fights a card's own hover transition */}
        <div data-rise-deep className="flex sm:col-span-2">
          <HeroCard agg={agg} companies={groups.filter((g) => g.list.length)} fleetTotal={buses.length} newest={newest} active={sort === "util"} onClick={() => rankBy("util")} className="flex-1" />
        </div>
        <div data-rise-deep className="flex">
          {/* with no spend to rank by, the card is not a button */}
          <CostCard agg={agg} cph={cph} noCosts={noCosts} className="flex-1"
            active={sort === "cph"} onClick={agg.spend > 0 ? () => rankBy("cph") : undefined} />
        </div>
        <div data-rise-deep className="flex">
          <FleetCard total={buses.length} byUnit={fleetBy} units={UNITS} className="flex-1" />
        </div>
      </div>

      <div data-rise className="mt-6 flex flex-wrap items-end gap-3">
        <Labelled label="Search" className={cx("w-full sm:w-[300px]", ON_PAGE)}>
          <Search value={q} onChange={setQ} label="Search vehicle, route or driver" placeholder="Vehicle, route or driver" />
        </Labelled>
        <Labelled label="Show">
          {/* chips at field height, so the row lines up */}
          <Choice label="Show" value={show} onChange={setShow} className="[&>button]:h-11"
            options={[["all", "All buses"], ...SHOW.map((h) => [h, (
              <>
                <span aria-hidden className={cx("h-2 w-2 rounded-pill", DOT[h])} />
                {HEALTH[h].label} · {count(counts[h])}
              </>
            )])]} />
        </Labelled>
        <Field label="Sort" className={cx("w-full sm:ml-auto sm:w-[300px]", ON_PAGE)}>
          <Select value={sort} onChange={(e) => setSort(e.target.value)}>
            {SORTS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </Select>
        </Field>
      </div>

      {shown.length ? (
        <div className="mt-4 flex flex-col gap-3">
          {groups.map((g) => (
            <BusGroup key={g.unit} {...g} total={fleetBy[g.unit]} open={isOpen(g)} onToggle={() => toggle(g)}
              narrowing={!!sq || show !== "all"} newest={newest} showNet={settings.showNetValue} onOpenBus={openBus} />
          ))}
          {/* With every company folded shut the page would end here: show the buses to look at first. */}
          {!autoKey && !groups.some(isOpen) && (
            <section data-rise-deep className="mt-5" aria-labelledby="live-attention">
              <h2 id="live-attention" className="text-[22px] font-bold tracking-[-0.01em] text-ink">Needs attention</h2>
              <p className="mt-0.5 text-[13px] text-ink-3">
                {attention.length ? "Bad: under 50% or over 150% seats filled, emptiest and fullest first" : "No bus is under 50% or over 150% today."}
              </p>
              {attention.length > 0 && <BusGrid list={attention} newest={newest} showNet={settings.showNetValue} onOpenBus={openBus} />}
            </section>
          )}
        </div>
      ) : (
        <div className="flex flex-col items-center py-12 text-center">
          {found.length ? (
            <>
              <p className="text-[15px] text-ink-2">{`No ${HEALTH[show].label.toLowerCase()} buses`}</p>
              <Button variant="ghost" className="mt-3" onClick={() => setShow("all")}>Show all buses</Button>
            </>
          ) : (
            <>
              <p className="text-[15px] text-ink-2">No bus matches “{q.trim()}”</p>
              <Button variant="ghost" className="mt-3" onClick={() => setQ("")}>Clear search</Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
