/* Costs: what the fleet spent over a day, a week or a month, always both ways (by km and by diesel),
   where the money goes, each company's part, and how every cost is worked out. Every figure comes
   from costReport.js, the same rows the old page and the Excel export use, so the three agree.
   Today's riders are still arriving, so a week or a month leaves today out until the day is over;
   only today's own Day view shows it, marked, and the Excel file never has it. */
import React, { useMemo, useRef } from "react";
import { Bus, CalendarX2, ChevronLeft, ChevronRight, Download, RotateCw, WifiOff } from "lucide-react";
import {
  PERIODS, periodRange, shiftPeriod, latestDate, datesShown, costRows, sumRows, costHeadNames, companyTotals, busCount,
  busTotals, costLines, explainersFor, noRouteVehicles, downloadCosts,
} from "../../costReport.js";
import { localIso } from "../../Dashboard.jsx";
import { Alert, Button, Choice, Field, IconButton, Input, PageHead, cx, useRise } from "../ui.jsx";
import { count, day, dayRange, plural } from "../format.js";
import CompanyCard from "./costs/CompanyCard.jsx";
import CostsLoading from "./costs/CostsLoading.jsx";
import { CostCard, SplitCard } from "./costs/FigureCards.jsx";
import HowCard from "./costs/HowCard.jsx";
import MoneyCard from "./costs/MoneyCard.jsx";
import TopBuses from "./costs/TopBuses.jsx";
import TotalCard from "./costs/TotalCard.jsx";
import { EmptyStrip, useKept } from "./costs/parts.jsx";

const weekday = (iso) => new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" });
/** "Thu 01 Oct", "Week 28 Sep – 04 Oct", "September 2026". */
function periodText(kind, period) {
  if (kind === "day") return `${weekday(period.from)} ${day(period.from)}`;
  if (kind === "week") return `Week ${dayRange(period.from, period.to)}`;
  return period.label;
}
const FIELD_LABEL = { day: "Day", week: "Any day in the week", month: "Month" };
// the date field sits straight on the satin page, so it takes the chips' white and soft shadow (as on Live)
const ON_PAGE = "[&_input]:bg-white [&_input]:shadow-chip [&_input:hover]:bg-satin";
// With this many cost lines, Where the money goes is about as tall as three company cards, so the
// two stand side by side; with fewer, the company cards take a row of their own above it.
const TALL = 7;

/** The company column's grid below 1280: two across (a last odd card takes the row), three across on
 *  a laptop when they fill whole rows. */
const spread = (n) => cx("grid gap-3 sm:grid-cols-2 sm:[&>*:last-child:nth-child(odd)]:col-span-2",
  n % 3 === 0 && "lg:grid-cols-3 lg:[&>*:last-child:nth-child(odd)]:col-span-1");

export default function CostsPage({ fleet }) {
  const { loaded, costBuses: buses, effRecords: records, busCosts, wd, costDates: dates, ridersOn, settings, attendanceFrom,
    erpStatus, syncErp, costStatus, syncCosts, dieselStatus, syncDiesel, gpsStatus } = fleet;
  const [kind, setKind] = useKept("kind");
  const [picked, setAnchor] = useKept("anchor");
  // until a date is picked, the page follows the latest date with data
  const latest = latestDate(dates);
  const anchor = picked || latest;
  const period = periodRange(kind, anchor);
  const today = localIso();
  const isToday = kind === "day" && period.from === today;
  const todayLeftOut = kind !== "day" && today >= period.from && today <= period.to && dates.includes(today);

  const headNames = useMemo(() => costHeadNames(busCosts), [busCosts]);
  const { rows, heads, missed } = useMemo(() => costRows({
    buses, records, busCosts, riders: ridersOn, dates: datesShown(dates, period, today),
  }), [buses, records, busCosts, ridersOn, dates, period.kind, period.from, period.to, today]); // eslint-disable-line react-hooks/exhaustive-deps
  const all = useMemo(() => sumRows(rows, heads), [rows, heads]);
  const noRoute = useMemo(() => noRouteVehicles(buses, busCosts, wd), [buses, busCosts, wd]);
  const companies = useMemo(() => companyTotals(rows, heads), [rows, heads]);
  const explainers = useMemo(() => explainersFor(wd, heads), [wd, heads]);
  const explain = useMemo(() => Object.fromEntries(explainers.map((e) => [e.key, e])), [explainers]);
  const lines = useMemo(() => costLines(all, heads, headNames, count), [all, heads, headNames]);
  const listed = useMemo(() => new Set(lines.map((l) => l.key)), [lines]);
  const noCosts = !lines.length; // nothing to price at all: the totals are not known, not ₹0
  // each bus's sums, as on the Excel file's Summary by bus, highest cost per head first; a bus whose
  // cost per head is not reliable (its Check) is left out and counted
  const costed = useMemo(() => busTotals(rows, heads).filter((x) => x.s.cphKm != null), [rows, heads]);
  const perBus = useMemo(() => costed.filter((x) => !x.s.check).sort((a, b) => b.s.cphKm - a.s.cphKm), [costed]);
  const byId = useMemo(() => new Map(buses.map((b) => [b.id, b])), [buses]);

  // an idle ERP with automatic sync on is about to pull (as on Live); with it off, nothing will come
  const pulling = erpStatus.phase === "syncing" || (erpStatus.phase === "idle" && settings.erpAuto);
  const waiting = !loaded || (!dates.length && pulling);
  const root = useRef(null);
  useRise(root, !waiting && rows.length > 0);

  const head = (
    <PageHead title="Costs" sub={waiting ? periodText(kind, period) : undefined} right={
      <>
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold text-ink-3">Period</span>
          <Choice label="Period" value={kind} onChange={setKind} options={PERIODS} className="[&>button]:h-11" />
        </div>
        <div className="flex w-full items-end gap-2 sm:w-auto">
          <IconButton label={`Previous ${kind}`} icon={ChevronLeft} onClick={() => setAnchor(shiftPeriod(anchor, kind, -1))} />
          <Field label={FIELD_LABEL[kind]} className={cx("flex-1 sm:w-[176px] sm:flex-none", ON_PAGE)}>
            {kind === "month"
              ? <Input type="month" value={anchor.slice(0, 7)} onChange={(e) => e.target.value && setAnchor(e.target.value + "-01")} className="font-code" />
              : <Input type="date" value={anchor} onChange={(e) => e.target.value && setAnchor(e.target.value)} className="font-code" />}
          </Field>
          <IconButton label={`Next ${kind}`} icon={ChevronRight} onClick={() => setAnchor(shiftPeriod(anchor, kind, 1))} />
        </div>
        <Button variant="white" icon={Download} className="w-full sm:w-auto" disabled={waiting || !rows.length || isToday}
          title={isToday ? "Today is left out of the Excel file until the day is over" : "Totals, each bus, each bus each day, and how every cost works"}
          onClick={() => downloadCosts({ rows, heads, missed, period, wd, headNames, today, holidays: settings.holidays, noRoute, gps: { phase: gpsStatus.phase, at: gpsStatus.at } })}>
          Export to Excel
        </Button>
      </>
    } />
  );

  if (waiting) {
    return (
      <>
        {head}
        <div className="flex flex-col gap-3">
          <CostsLoading progress={erpStatus.progress} />
          <HowCard explainers={explainers} />
        </div>
      </>
    );
  }

  const alerts = (
    <>
      {costStatus.phase === "error" && (
        <Alert className="mb-3" onRetry={() => syncCosts()}>Costs could not be synced from the ERP. These are the last ones saved.</Alert>
      )}
      {dieselStatus.phase === "error" && (
        <Alert className="mb-3" onRetry={() => syncDiesel()}>Diesel fills could not be synced from the ERP. These are the last ones saved.</Alert>
      )}
    </>
  );

  if (!rows.length) {
    const offline = !dates.length && erpStatus.phase === "error";
    const elsewhere = latest < period.from || latest > period.to;
    return (
      <>
        {head}
        {alerts}
        <div className="flex flex-col gap-3">
          {offline ? (
            <EmptyStrip role="alert" icon={WifiOff} title="Can’t reach the ERP" hint="Check the factory network, then press Retry."
              action={<Button variant="primary" icon={RotateCw} onClick={() => syncErp()}>Retry</Button>} />
          ) : !dates.length ? (
            <EmptyStrip icon={Bus} title="No data from the ERP yet" hint="Costs appear here once the ERP has the fleet’s riders and km."
              action={<Button variant="primary" icon={RotateCw} onClick={() => syncErp()}>Sync now</Button>} />
          ) : todayLeftOut ? (
            <EmptyStrip icon={CalendarX2} title={`Nothing finished yet in ${periodText(kind, period)}`}
              hint="Today is left out of the week and month until the day is over. The Day view shows it so far."
              action={<Button variant="primary" onClick={() => { setKind("day"); setAnchor(today); }}>Show today</Button>} />
          ) : (
            <EmptyStrip icon={CalendarX2} title={`Nothing recorded ${kind === "day" ? "on" : "in"} ${periodText(kind, period)}`}
              hint={elsewhere ? `The latest costs are for ${periodText(kind, periodRange(kind, latest))}.` : undefined}
              action={elsewhere && <Button variant="primary" onClick={() => setAnchor(latest)}>Show the latest {kind}</Button>} />
          )}
          <HowCard explainers={explainers} />
        </div>
      </>
    );
  }

  // Fewer than three companies leave the company column short: the buses costing most per head fill it.
  const tall = lines.length >= TALL;
  const riderLabel = kind === "day" ? "Riders" : "Rider-days";
  const notes = [
    isToday && "Today: riders still arriving, so these figures grow until the day is over.",
    todayLeftOut && `Today, ${day(today)}, is left out until the day is over.`,
    // the ERP sends only its last 11 days of punches; the days before the first kept one are gone
    kind !== "day" && attendanceFrom && period.from < attendanceFrom && attendanceFrom <= period.to &&
      `On record from ${day(attendanceFrom)} only. The ERP sends just its last 11 days of attendance, and every day since then is kept.`,
    all.unpricedRiders > 0 && `${count(all.unpricedRiders)} ${riderLabel.toLowerCase()} on ${plural(all.unpricedBuses, "rented bus", "rented buses")} not priced: no plan run or GPS. Left out of the cost per head.`,
  ].filter(Boolean);
  const top = companies.length < 3 && !noCosts ? perBus.slice(0, tall ? 5 : 3) : [];
  const side = [
    ...companies.map(({ c, buses: n, s }) => (
      <CompanyCard key={c} c={c} buses={n} s={s} total={all.totalKm} noCosts={noCosts} riders={riderLabel}
        className={companies.length >= 3 ? "xl:flex-1" : undefined} />
    )),
    ...(top.length ? [<TopBuses key="top" items={top} byId={byId} leftOut={costed.length - perBus.length} className="xl:flex-1" />] : []),
  ];
  const money = (
    <MoneyCard lines={lines} all={all} explain={explain} noRoute={noRoute} syncing={costStatus.phase === "syncing"} onSyncCosts={() => syncCosts()}
      className="flex-1" />
  );

  return (
    <div ref={root}>
      {head}
      {alerts}
      <div className="flex flex-col gap-3">
        {/* one row on desk; below 1280 the total takes the whole width and the three figures share the next row */}
        <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-5">
          <div data-rise-deep className="sm:col-span-3 xl:col-span-2">
            <TotalCard all={all} period={periodText(kind, period)} buses={busCount(rows)} noCosts={noCosts} notes={notes} />
          </div>
          <div data-rise-deep className="flex">
            <CostCard all={all} noCosts={noCosts} className="flex-1" />
          </div>
          <div data-rise-deep className="flex">
            <SplitCard label={riderLabel} note={kind === "day" ? "Each person counted once" : "Each person counted once a day they came"} value={all.riders}
              companies={companies} pick={(s) => s.riders} className="flex-1" />
          </div>
          <div data-rise-deep className="flex">
            <SplitCard label="Km travelled" unit="km" value={all.km} companies={companies} pick={(s) => s.km} className="flex-1" />
          </div>
        </div>

        {tall ? (
          // on desk the companies stand beside the cost lines and stretch to its height
          <div className="grid gap-3 xl:grid-cols-3">
            <div data-rise-deep className="flex xl:col-span-2">{money}</div>
            <div className={cx(spread(side.length), "xl:flex xl:flex-col")}>{side}</div>
          </div>
        ) : (
          // few cost lines: the companies take a row of their own, the cost lines run full width under it
          <>
            <div className={spread(side.length)}>{side}</div>
            <div data-rise-deep className="flex">{money}</div>
          </>
        )}

        <div data-rise-deep><HowCard explainers={explainers} listed={listed} /></div>
      </div>
    </div>
  );
}
