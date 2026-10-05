/* One bus in detail: how full it ran over the chosen dates (the one number), its figures, what it
   costs both ways, its km and diesel by day, and on the right who drives and rides it, where it
   stops, its custom metrics and its documents.

   Every figure comes from the shared functions in Dashboard.jsx (busRangeFigures, busCostFigures,
   busKmDieselDays …), so it matches the old look's bus page to the rupee. */
import React, { useMemo, useRef, useState } from "react";
import { ArrowLeft, Bus as BusIcon } from "lucide-react";
import { UNITS, busMedianCph, busRangeFigures, unionDates } from "../../Dashboard.jsx";
import { Badge, Button, Card, CompanyDot, Empty, Field, GroupHeader, Input, PageHead } from "../ui.jsx";
import { plural, squash } from "../format.js";
import { go, hrefFor } from "../route.js";
import BusFinder, { routeLine } from "./bus/BusFinder.jsx";
import BusLoading from "./bus/BusLoading.jsx";
import { GlanceCard, HeroCard } from "./bus/Summary.jsx";
import CostCard from "./bus/CostCard.jsx";
import KmDieselCard from "./bus/KmDieselCard.jsx";
import { BusDriverCard, EmployeesCard, MetricsCard, StopsCard } from "./bus/SideCards.jsx";
import DocumentsCard from "./bus/DocumentsCard.jsx";
import { isHired, useKept, useRiseOnMount } from "./bus/parts.jsx";

const BackToLive = () => (
  <Button variant="ghost" size="sm" icon={ArrowLeft} className="-ml-3 mb-2" onClick={() => go("live")}>Back to Live</Button>
);
const findBus = (buses, id) => (id ? buses.find((b) => b.id === id) || buses.find((b) => squash(b.id) === squash(id)) : null);

export default function BusPage({ fleet, busId, toast }) {
  const { effBuses: buses, effRecords: records, employees, attendance, wd } = fleet;
  const bus = useMemo(() => findBus(buses, busId), [buses, busId]);
  // the fleet's median cost per head does not depend on the bus, so it is not worked out again per bus
  const medCph = useMemo(() => busMedianCph(buses, records, employees, attendance, wd), [buses, records, employees, attendance, wd]);
  const firstSync = !buses.length && fleet.erpStatus.phase === "syncing";
  if (!fleet.loaded || firstSync) return <BusLoading progress={fleet.erpStatus.progress} />;
  if (!bus) return <BusPicker fleet={fleet} busId={busId} />;
  return <BusDetail key={bus.id} fleet={fleet} bus={bus} medCph={medCph} toast={toast} />;
}

/* ---------------------------------------------------------------- the detail -- */
function BusDetail({ fleet, bus, medCph, toast }) {
  const { effBuses: buses, effRecords: records, employees, attendance, settings, wd } = fleet;
  const allDates = useMemo(() => unionDates(records, attendance), [records, attendance]);
  // Until dates are picked they follow the latest day with data, as in the old look; picked dates are
  // kept while you visit other pages. Worked out during render so the first paint is already right.
  const [picked, setPicked] = useKept("bus:range", null);
  const latestDay = allDates[allDates.length - 1] || "";
  const range = useMemo(() => picked || { from: latestDay, to: latestDay }, [picked, latestDay]);
  const setRange = (next) => setPicked((p) => (typeof next === "function" ? next(p || range) : next));

  const f = useMemo(() => busRangeFigures(bus, records, employees, attendance, settings, range, wd, medCph),
    [bus, records, employees, attendance, settings, range, wd, medCph]);
  // Two empty dates mean all dates, so they count as a range (the old look read them as one day).
  const isRange = !(range.from && range.from === range.to);
  const endDate = range.to || f.latest || fleet.run.today;
  const dieselMissing = !fleet.run.diesel;

  const grid = useRef(null);
  useRiseOnMount(grid, 50);

  const hired = isHired(bus);
  const info = fleet.busInfo[bus.id];

  return (
    <>
      <PageHead back={<BackToLive />} title={<span className="font-code">{bus.vehicle}</span>}
        sub={
          <span className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-1">
            <CompanyDot unit={bus.unit} />{bus.unit}
            {/* a hired bus is the unusual case, so only it carries a badge */}
            {hired && <Badge className="ml-1" title={bus.type || undefined}>Hired</Badge>}
          </span>
        }
        right={
          <div className="flex w-full flex-wrap items-end gap-x-3 gap-y-2 sm:w-auto">
            <Field label="From" className="w-[calc(50%-6px)] sm:w-[164px]">
              <Input type="date" className="font-code" value={range.from} max={range.to || undefined}
                onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} />
            </Field>
            <Field label="To" className="w-[calc(50%-6px)] sm:w-[164px]">
              <Input type="date" className="font-code" value={range.to} min={range.from || undefined}
                onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} />
            </Field>
            {picked && <Button variant="ghost" size="md" className="-mx-2" onClick={() => setPicked(null)}>Latest day</Button>}
            <BusFinder buses={buses} className="w-full sm:w-[260px]" />
          </div>
        } />

      <div ref={grid} className="grid items-start gap-3 xl:grid-cols-[minmax(0,1fr)_400px] xl:gap-6">
        <div className="flex min-w-0 flex-col gap-3">
          <HeroCard bus={bus} f={f} isRange={isRange} onLatest={(d) => setRange({ from: d, to: d })} />
          {f.m && <GlanceCard f={f} isRange={isRange} showNetValue={settings.showNetValue} dieselMissing={dieselMissing} />}
          <CostCard bus={bus} hired={hired} dieselMissing={dieselMissing} profile={fleet.busCosts[bus.id]} rec={f.cardRec} date={f.cardDate} wd={wd}
            costStatus={fleet.costStatus} onSync={() => fleet.syncCosts()} info={info}
            onSaveBudget={(patch) => { fleet.setBusField(bus.id, patch); toast("Budget saved"); }} />
          <KmDieselCard bus={bus} endDate={endDate} run={fleet.run}
            gpsStatus={fleet.gpsStatus} gpsFeed={fleet.gpsFeed} onSyncGps={() => fleet.syncGps({ full: true, silent: false })}
            dieselStatus={fleet.dieselStatus} diesel={fleet.diesel} onSyncDiesel={() => fleet.syncDiesel()} />
        </div>
        {/* side cards pair up on a tablet or small desk instead of stretching across it */}
        <div className="grid min-w-0 items-start gap-3 md:grid-cols-2 xl:grid-cols-1">
          <BusDriverCard bus={bus} hired={hired} info={info} onSave={(patch) => { fleet.setBusField(bus.id, patch); toast("Driver details saved"); }} />
          <EmployeesCard bus={bus} emps={f.emps} punches={f.day} latest={f.latest} />
          <StopsCard bus={bus} />
          <MetricsCard formulas={fleet.formulas} variables={fleet.variables} m={f.m} />
          <DocumentsCard busId={bus.id} toast={toast} />
        </div>
      </div>
    </>
  );
}

/* ------------------------------------------------- no bus picked, or not found -- */
function BusPicker({ fleet, busId }) {
  const buses = fleet.effBuses;
  const [open, setOpen] = useState({});
  const groups = useMemo(() => UNITS.map((u) => ({
    unit: u,
    list: buses.filter((b) => b.unit === u).sort((a, b) => a.vehicle.localeCompare(b.vehicle)),
  })).filter((g) => g.list.length), [buses]);

  return (
    <>
      <PageHead back={<BackToLive />} title="Bus detail" sub={busId ? `No bus “${busId}” in the fleet` : null} />
      <Card padding="none" className="mb-3">
        <Empty icon={BusIcon} title={buses.length ? "Pick a bus" : "No buses yet"} className="!py-8"
          hint={buses.length ? "Search for a vehicle, or open one from Live." : "Buses appear once the ERP sync finishes."}
          action={buses.length
            ? <BusFinder buses={buses} label="Find a bus" className="w-[min(320px,calc(100vw-96px))]" />
            : <Button variant="secondary" onClick={() => fleet.syncErp()}>Sync now</Button>} />
      </Card>
      <div className="flex flex-col gap-3">
        {groups.map(({ unit, list }) => {
          const id = "buses-" + unit;
          return (
            <section key={unit} className="flex flex-col gap-2">
              <GroupHeader open={!!open[unit]} onToggle={() => setOpen((o) => ({ ...o, [unit]: !o[unit] }))} controls={id}
                lead={<CompanyDot unit={unit} />} title={unit} summary={plural(list.length, "bus", "buses")} />
              {open[unit] && (
                <Card id={id} padding="sm">
                  <ul className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                    {list.map((b) => (
                      <li key={b.id} className="min-w-0">
                        <a href={hrefFor("bus", b.id)}
                          className="block rounded-tile px-4 py-2.5 transition-[background-color,transform] duration-150 hover:bg-satin active:scale-[0.985]">
                          <span className="block truncate font-code text-[15px] font-semibold text-ink">{b.vehicle}</span>
                          <span className="block truncate text-[13px] text-ink-3">{routeLine(b)}</span>
                        </a>
                      </li>
                    ))}
                  </ul>
                </Card>
              )}
            </section>
          );
        })}
      </div>
    </>
  );
}
