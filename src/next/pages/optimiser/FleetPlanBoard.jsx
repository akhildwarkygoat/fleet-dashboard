/* Fleet plan: what the plan costs and carries (cost per head is the one big number), which plan
   each service runs (on Overall, or when there is no plan), the routes on a map, and every route
   in a table.
   The plan is loaded, re-costed and summed by the old board's own code (useFleetPlan,
   fleetPlanFigures in src/optimiser/OptimiserTab.jsx), so both looks show the same figures.
   Pressing a figure ranks the routes by it; ticking routes draws them and narrows every figure to
   them. What was typed, picked or ticked is kept for the session, per service. */
import React, { useRef, useState } from "react";
import { FileWarning, ListFilter, RotateCw } from "lucide-react";
import { fleetPlanBusCo, fleetPlanCompanyOf, fleetPlanFigures, useFleetPlan } from "../../../optimiser/OptimiserTab.jsx";
import { getHiddenKpis } from "../../../optimiser/kpiPrefs.js";
import { nextRank } from "../../../optimiser/kpiRank.js";
import { resolveFinalised } from "../../../optimiser/finalisedPlans.js";
import { describeSlot } from "../../../optimiser/rotation.js";
import { shiftWeek } from "../../../optimiser/RotaWeekPicker.jsx";
import { Button, Card, Skeleton, Tag, useRise } from "../../ui.jsx";
import { plural } from "../../format.js";
import { still } from "../../motion.js";
import { useKept } from "../bus/parts.jsx";
import BackToTop from "./shell/BackToTop.jsx";
import PlanFigures from "./fleetplan/PlanFigures.jsx";
import FinalisedPlans from "./fleetplan/FinalisedPlans.jsx";
import RouteMapCard from "./fleetplan/RouteMapCard.jsx";
import RoutesTable from "./fleetplan/RoutesTable.jsx";

const readNames = () => { try { return JSON.parse(localStorage.getItem("opt-route-names") || "{}"); } catch { return {}; } };
const KIND = { own: "owned", rent: "rental" };

export default function FleetPlanBoard({ svc, toast, onOpenService }) {
  const { data, err, load, drawn, fleetFc, isOverall, isRota, week, planSource } = useFleetPlan(svc);
  const k = "fleetplan:" + (svc ? svc.id : "all") + ":";
  const [names] = useState(readNames);
  const [busCo] = useState(fleetPlanBusCo);
  const [hidden] = useState(getHiddenKpis);
  const [selRoutes, setSelRoutes] = useKept(k + "sel", new Set());
  const [routePage, setRoutePage] = useKept(k + "page", 0);
  const [typeFilter, setTypeFilter] = useKept(k + "type", null);
  const [companyFilter, setCompanyFilter] = useKept(k + "company", null);
  const [routeQuery, setRouteQuery] = useKept(k + "q", "");
  const [sortBy, setSortBy] = useKept(k + "sort", null);
  const routesRef = useRef(null);
  const root = useRef(null);
  useRise(root, !!data);

  if (err) {
    // which plan each service runs, with "Choose in Planner" on each: the way to fill this gap
    return (
      <div className="flex flex-col gap-3">
        <NoPlan svc={svc} isRota={isRota} planSource={planSource} onReload={load} onPlanner={() => onOpenService(svc)} />
        <FinalisedPlans fc={null} toast={toast} onOpen={onOpenService} />
      </div>
    );
  }
  if (!data) return <BoardSkeleton overall={isOverall} />;

  /* Ticks and the company pick are kept for the session by service, but the plan under them can
     change (another plan finalised, another rota week): only what is in this plan counts. */
  const inPlan = new Set(data.routes.map((r) => r.name));
  const ticked = new Set([...selRoutes].filter((n) => inPlan.has(n)));
  const company = companyFilter && data.routes.some((r) => fleetPlanCompanyOf(busCo, r.name) === companyFilter) ? companyFilter : null;
  const f = fleetPlanFigures(data, { view: "overall", busCo, names, typeFilter, companyFilter: company, routeQuery, routePage, sortBy, selRoutes: ticked });

  const rankRoutes = (key, { scroll = true } = {}) => {
    const next = nextRank(sortBy, key);
    setSortBy(next); setRoutePage(0);
    // the figures sit above the map: bring the ranked table into view so the press visibly did something
    if (next && scroll) requestAnimationFrame(() => routesRef.current?.scrollIntoView({ behavior: still() ? "auto" : "smooth", block: "start" }));
  };
  const applyTypeFilter = (type) => { setTypeFilter((t) => (t === type ? null : type)); setRoutePage(0); };
  const pickCompany = (co) => { setCompanyFilter(co); setRoutePage(0); };
  const toggleSel = (name) => setSelRoutes((s) => { const n = new Set(s); n.has(name) ? n.delete(name) : n.add(name); return n; });
  const toggleAll = () => setSelRoutes(f.allSelected ? new Set() : new Set(f.tableRows.map((r) => r.name)));
  // one press draws every route in the table, or one company's
  const namesOf = (rows) => [...new Set(rows.map((r) => r.name))];
  const tableCos = f.companyOptions.filter((co) => f.tableRows.some((r) => fleetPlanCompanyOf(busCo, r.name) === co));
  const draws = [{ label: "Draw all routes", names: namesOf(f.tableRows) },
    ...(tableCos.length > 1 ? tableCos.map((co) => ({ company: co, label: `Draw ${co} routes`,
      names: namesOf(f.tableRows.filter((r) => fleetPlanCompanyOf(busCo, r.name) === co)) })) : [])];
  const scope = isOverall
    ? `${plural(data.routes.length, "route", "routes")} from ${plural(drawn.length, "service", "services")}`
    : `${plural(data.routes.length, "route", "routes")} in this plan`;
  // ticked buses go first, then the table filters, one press each, as on the old board
  const wholeFleet = () => {
    if (f.selActive) { setSelRoutes(new Set()); return; }
    setTypeFilter(null); setCompanyFilter(null); setRoutePage(0);
  };

  return (
    <div ref={root} className="flex flex-col gap-3">
      {(isRota || f.selActive || f.filtersActive) && (
        <div data-rise className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px] text-ink-3">
          {isRota && <RotaLine svc={svc} week={week} />}
          {(f.selActive || f.filtersActive) && (
            <span className="inline-flex flex-wrap items-center gap-2">
              <Tag icon={ListFilter}>
                {f.selActive
                  ? `Figures for ${plural(ticked.size, "ticked bus", "ticked buses")}`
                  : `Figures for ${[KIND[typeFilter], company].filter(Boolean).join(" ")} buses only`}
              </Tag>
              <Button variant="ghost" size="sm" onClick={wholeFleet}>Show whole fleet</Button>
            </span>
          )}
        </div>
      )}

      <div data-rise>
        <PlanFigures data={data} f={f} hidden={hidden} isOverall={isOverall} scope={scope} sortBy={sortBy} typeFilter={typeFilter}
          onRank={rankRoutes} onType={applyTypeFilter} />
      </div>

      {isOverall && (
        <div data-rise>
          <FinalisedPlans fc={fleetFc} toast={toast} onOpen={onOpenService} />
        </div>
      )}

      <div data-rise>
        <RouteMapCard depot={f.depot} selRows={f.selRows} colors={f.masterColors} masterKey={f.masterKey} names={names}
          draws={draws} onDraw={(list) => setSelRoutes(new Set(list))} onRemove={toggleSel} onClear={() => setSelRoutes(new Set())} />
      </div>

      <div data-rise ref={routesRef} className="scroll-mt-6">
        <RoutesTable f={f} names={names} busCo={busCo} selRoutes={ticked} onTick={toggleSel} onTickAll={toggleAll}
          sortBy={sortBy} onRank={(key) => rankRoutes(key, { scroll: false })} onSort={(s) => { setSortBy(s); setRoutePage(0); }}
          typeFilter={typeFilter} onClearType={() => applyTypeFilter(typeFilter)} companyFilter={company} onCompany={pickCompany}
          query={routeQuery} onQuery={(q) => { setRouteQuery(q); setRoutePage(0); }} onPage={setRoutePage} />
      </div>
      <BackToTop />
    </div>
  );
}

/* Whose plan a Rotational slot is showing: its figures belong to one rider group for one week. */
function RotaLine({ svc, week }) {
  // what is actually drawn, which may be a draft finalised over the rota
  const running = resolveFinalised(svc);
  if (running.kind !== "rotation" && running.isDefault) return <span>No rota plan this week, showing the optimised plan</span>;
  return (
    <span>
      <b className="font-semibold text-ink">Running {running.kind === "rotation" ? running.name : `“${running.name}”`}</b>
      {running.kind === "rotation" ? `, chosen by the manager · next week ${describeSlot(svc.slot, shiftWeek(week, 7))}`
        : running.kind === "draft" ? ", a Planner draft over the rota. Revert it on Overall to follow the rota again."
        : ", a plan chosen over the rota"}
    </span>
  );
}

/* No plan to show: what is missing, and the one action that fills it. */
function NoPlan({ svc, isRota, planSource, onReload, onPlanner }) {
  const unplanned = !!svc && !svc.overall && !svc.planUrl;
  const rotaMissing = isRota && planSource && planSource.kind === "rotation";
  return (
    <Card role={unplanned ? undefined : "alert"} className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-pill bg-satin-2 text-ink-2">
        <FileWarning size={24} strokeWidth={2} aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[17px] font-bold tracking-[-0.01em] text-ink">
          {unplanned ? `${svc.name} is not planned yet` : rotaMissing ? `No plan for ${planSource.label} this week` : "No fleet plan yet"}
        </p>
        {/* the file that failed is for whoever fixes it, on hover only */}
        <p className="mt-1 text-[13px] leading-relaxed text-ink-3" title={rotaMissing ? planSource.url || undefined : undefined}>
          {unplanned ? "Build its plan in the Planner."
            : rotaMissing ? "Pick another rota week above, or choose a plan in the Planner."
            : "Build one in the Planner, then press Reload."}
        </p>
      </div>
      {unplanned
        ? <Button variant="primary" onClick={onPlanner}>Open the Planner</Button>
        : <Button variant="secondary" icon={RotateCw} onClick={onReload}>Reload</Button>}
    </Card>
  );
}

/* The board's own shape while the plan loads. */
function BoardSkeleton({ overall }) {
  return (
    <div aria-busy="true" aria-label="Loading the plan" className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-3 xl:flex-nowrap">
        <Skeleton className="h-[240px] min-w-0 basis-full !rounded-hero xl:h-[276px] xl:shrink-0 xl:basis-[380px]" />
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-[140px] min-w-0 grow basis-full !rounded-card sm:basis-[calc(50%-6px)] lg:h-[276px] lg:basis-0" />
        ))}
      </div>
      {overall && <Skeleton className="h-[940px] !rounded-card lg:h-[684px] xl:h-[430px]" />}
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_400px]">
        <Skeleton className="h-[240px] !rounded-card lg:h-[300px]" />
        <Skeleton className="h-[200px] !rounded-card xl:h-[300px]" />
      </div>
      <Card>
        <Skeleton className="h-4 w-24 !rounded-pill" />
        <Skeleton className="mt-5 h-11 w-full !rounded-pill sm:w-[300px]" />
        {Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="mt-2 h-10 !rounded-[14px]" />)}
      </Card>
    </div>
  );
}
