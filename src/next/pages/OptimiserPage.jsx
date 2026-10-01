/* Optimiser: pick a service (or Overall), then plan it across five sub-tabs. The service and the
   sub-tab live in the address (#/optimiser/<service>/<sub-tab>), so Back works; entering from the
   bottom bar opens the picker, as the old tab asked on every entry.
   What the boards are given comes from useOptimiserState, the old tab's own hook, and they are
   rendered exactly as the old tab renders its views: same keys, same props. The header row scrolls
   with the page and stays usable while a board loads. */
import React from "react";
import { ArrowLeftRight } from "lucide-react";
import { useOptimiserState } from "../../optimiser/OptimiserTab.jsx";
import { OVERALL, serviceById } from "../../optimiser/services.js";
import { Alert, Chip, Field, PageHead, Select, Skeleton, cx } from "../ui.jsx";
import { count, kms, money1 } from "../format.js";
import { go, useRoute } from "../route.js";
import ServicePicker, { ServicePickerSkeleton } from "./optimiser/ServicePicker.jsx";
import StopsBoard from "./optimiser/StopsBoard.jsx";
import FleetPlanBoard from "./optimiser/FleetPlanBoard.jsx";
import PlannerBoard from "./optimiser/PlannerBoard.jsx";
import TimingsBoard from "./optimiser/TimingsBoard.jsx";
import TrackBoard from "./optimiser/TrackBoard.jsx";
import RotaWeekPills from "./optimiser/shell/RotaWeekPills.jsx";

// `key` is the old tab's sub-tab id; `slug` is how it reads in the address
const SUBS = [
  { key: "stops", slug: "stops", label: "Stops" },
  { key: "plan", slug: "fleet-plan", label: "Fleet plan" },
  { key: "new", slug: "planner", label: "Planner" },
  { key: "timings", slug: "timings", label: "Timings" },
  { key: "ti", slug: "ti", label: "T.I", title: "Track what actually ran against the plan" },
];
const firstSub = (svc) => (svc.overall ? "timings" : "stops");

function readId(id) {
  const [sid, slug] = String(id || "").split("/");
  const svc = sid === OVERALL.id ? OVERALL : serviceById(sid);
  if (!svc) return { svc: null, sub: null };
  const hit = SUBS.find((x) => x.slug === slug);
  return { svc, sub: hit ? hit.key : firstSub(svc) };
}
const open = (svc, sub) => go("optimiser", svc.id + "/" + SUBS.find((x) => x.key === sub).slug);

// services.js writes its next steps with a dash: "a plan — run the optimiser for this service"
const plainNeed = (need) => String(need).replace(" — ", ": ");
// the money is the plan's own estimate, not the ERP's cost
const planLabel = (o) => o.label + (o.metrics
  ? ` · ${money1(o.metrics.cost_head)} a head (planned) · ${kms(o.metrics.avg)} min average · ${count(o.metrics.buses)} buses` : "");

const StatBone = ({ className }) => (
  <div className={cx("flex min-h-[132px] flex-col rounded-card bg-white p-5 shadow-card sm:p-6", className)}>
    <Skeleton className="h-3.5 w-24" />
    <Skeleton className="mt-auto h-7 w-28" />
  </div>
);
const FigureBones = () => (
  <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
    {[0, 1, 2, 3].map((i) => <StatBone key={i} />)}
  </div>
);

/** A board's shape while the fleet loads, so nothing jumps when its data lands. */
function BoardSkeleton({ sub }) {
  let body;
  if (sub === "timings") body = <Skeleton className="h-[520px] !rounded-card" />;
  else if (sub === "stops") body = (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatBone className="col-span-2 !rounded-hero sm:col-span-3 lg:col-span-2" />
        {[0, 1, 2].map((i) => <StatBone key={i} className={i === 2 ? "col-span-2 sm:col-span-1" : undefined} />)}
      </div>
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_360px] xl:grid-cols-[minmax(0,1fr)_400px]">
        <Skeleton className="h-[360px] !rounded-card lg:h-[520px]" />
        <Skeleton className="hidden !rounded-card lg:block lg:h-[520px]" />
      </div>
    </>
  );
  else if (sub === "ti") body = <><FigureBones /><Skeleton className="h-[480px] !rounded-card" /></>;
  else body = <><FigureBones /><Skeleton className="h-[360px] !rounded-card lg:h-[520px]" /></>;
  return <div aria-busy="true" className="flex flex-col gap-3">{body}</div>;
}

export default function OptimiserPage({ fleet, toast }) {
  const { id } = useRoute();
  const { svc, sub } = readId(id);
  const erpShifts = fleet.erpRoll;
  const { refresh, stops, routes, svcStops, svcCoverage, overallStops, svcErpBuses, planOpts, planId, pickPlan, svcNeed, hasRiders } =
    useOptimiserState({ svc, erpBuses: fleet.buses, erpEmployees: fleet.employees, erpShifts });
  // nothing from the ERP yet, and a sync is on its way: every service would read "no riders", so
  // show the shape instead. With auto-sync off nothing is coming, so show what there is.
  const phase = fleet.erpStatus.phase;
  const syncing = phase === "syncing" || (phase === "idle" && fleet.settings.erpAuto !== false);
  const waiting = !fleet.loaded || (!(fleet.employees || []).length && syncing);
  const pickSvc = (s) => open(s, firstSub(s));

  // Only a service with no riders cannot be opened; it says why above the picker.
  if (!svc || (!waiting && !hasRiders)) {
    return (
      <>
        <PageHead title="Optimiser" sub="Pick a service to plan." />
        {svc && <Alert tone="warn" className="mb-3">{svc.name} isn’t ready to plan yet. It needs {plainNeed(svcNeed)}.</Alert>}
        {waiting ? (
          <div aria-busy="true"><ServicePickerSkeleton /></div>
        ) : (
          <ServicePicker onPick={pickSvc} shifts={erpShifts} shiftDate={fleet.erpShiftDate} fleetSize={(fleet.buses || []).length} />
        )}
      </>
    );
  }

  return (
    <>
      <h1 className="sr-only">Optimiser · {svc.name}</h1>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <button type="button" onClick={() => go("optimiser")} aria-label={`Change service. Now planning ${svc.name}`}
          className="inline-flex h-11 max-w-full shrink-0 items-center gap-2.5 rounded-pill bg-white pl-4 pr-3.5 text-[13px] font-semibold text-ink shadow-chip transition-[background-color,transform] duration-150 hover:bg-satin active:scale-[0.97]">
          <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-pill" style={{ background: svc.color }} />
          <span className="truncate">{svc.name}</span>
          <span aria-hidden className="inline-flex items-center gap-1 font-medium text-ink-3"><ArrowLeftRight size={15} strokeWidth={2} />Change</span>
        </button>
        <div role="radiogroup" aria-label="Optimiser view" className="flex flex-wrap gap-1.5 [&>button]:h-11">
          {SUBS.map((x) => (
            <Chip key={x.key} role="radio" on={sub === x.key} title={x.title} onClick={() => open(svc, x.key)}>{x.label}</Chip>
          ))}
        </div>
        <div className="flex flex-wrap items-end gap-3">
          {(svc.slot || svc.overall) && <RotaWeekPills toast={toast} slot={svc.slot} />}
          {(sub === "plan" || sub === "new") && planOpts && planOpts.length > 1 && (
            <Field label="Plan" className="w-full sm:w-[300px]">
              <Select value={planId || ""} onChange={(e) => pickPlan(planOpts.find((o) => o.id === e.target.value))}>
                {planOpts.map((o) => <option key={o.id} value={o.id} title={o.desc || undefined}>{planLabel(o)}</option>)}
              </Select>
            </Field>
          )}
        </div>
      </div>

      {!waiting && (svc.notice ? (
        <Alert tone="warn" className="mb-4"><b className="font-bold">Optimiser in progress.</b> {svc.notice}</Alert>
      ) : svcNeed && (
        <Alert tone="neutral" className="mb-4">{svc.name} still needs {plainNeed(svcNeed)}.</Alert>
      ))}

      {waiting ? <BoardSkeleton sub={sub} /> : (
        <>
          {sub === "stops" && (svcStops
            ? <StopsBoard key={svc.id} toast={toast} stops={svcStops} viewStops={svcStops} routes={routes} refresh={refresh}
                depot={svc.depot} coverage={svcCoverage} calibrate={false} svc={svc} />
            : overallStops
            ? <StopsBoard key={"all:" + (planId || "d")} toast={toast} stops={overallStops} viewStops={overallStops}
                routes={routes} refresh={refresh} depot={svc && svc.depot} calibrate={false} />
            : <StopsBoard key={planId || "d"} toast={toast} stops={stops} viewStops={stops} routes={routes} refresh={refresh} depot={svc && svc.depot} />)}
          {sub === "plan" && <FleetPlanBoard key={(svc ? svc.id : "all") + ":" + (planId || "d")} svc={svc}
            toast={toast} onOpenService={(s) => open(s, "new")} />}
          {sub === "new" && <PlannerBoard key={(svc ? svc.id : "all") + ":" + (planId || "d")} toast={toast}
            erpBuses={svcErpBuses} svc={svc && !svc.overall ? svc : null} svcStops={svcStops} />}
          {sub === "timings" && <TimingsBoard shifts={erpShifts} />}
          {sub === "ti" && <TrackBoard key={svc ? svc.id : "all"} toast={toast} svc={svc} />}
        </>
      )}
    </>
  );
}
