/* Which plan each of the six services runs, what that costs, and what it does to the fleet. A
   service quietly running the optimiser's output must never look like one somebody chose, so each
   says how it got its plan. Choosing happens in the Planner; Revert drops a choice made in this
   browser. The rows and counts are the old board's (finalisationSummary), rebuilt on every render
   because they read localStorage. */
import React, { useRef, useState } from "react";
import { Download, Upload } from "lucide-react";
import { finalisationSummary } from "../../../../optimiser/OptimiserTab.jsx";
import { baselineFor, clearFinalised, downloadFinalised, importFinalised } from "../../../../optimiser/finalisedPlans.js";
import { SERVICES } from "../../../../optimiser/services.js";
import { Button, Card, CardTitle, Tag, Tile, Tiles } from "../../../ui.jsx";
import { DASH, count, money, money1, plural } from "../../../format.js";

export default function FinalisedPlans({ fc, toast, onOpen }) {
  const [, setTick] = useState(0);
  const fileRef = useRef(null);
  const { noStandingSvcs, mixedBasis, rows, chosen } = finalisationSummary(fc);
  // the diesel-only note matters only beside services costed in full
  const dieselOnly = new Set(mixedBasis ? noStandingSvcs.map((s) => s.id) : []);

  const doImport = (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const rd = new FileReader();
    rd.onload = () => {
      try {
        const res = importFinalised(JSON.parse(rd.result));
        setTick((x) => x + 1);
        toast(`Imported ${plural(res.services, "choice", "choices")}` + (res.restored ? ` · ${plural(res.restored, "draft", "drafts")} restored` : ""));
      } catch (err) { toast(err.message || "Could not read that file"); }
    };
    rd.readAsText(file);
    e.target.value = "";
  };
  const revert = (svc) => {
    clearFinalised(svc.id);
    setTick((x) => x + 1);
    const base = baselineFor(svc);
    toast(`${svc.name} back to ${base.builtIn ? `its built-in plan, ${base.name}` : base.kind === "rotation" ? base.name : "the optimised plan"}`);
  };

  return (
    <Card>
      <CardTitle title="Finalised plans" sub={`${chosen} of ${SERVICES.length} chosen here`}
        right={
          <>
            <Button variant="secondary" size="sm" icon={Download} onClick={() => { downloadFinalised(); toast("Exported finalised_plans.json"); }}>Export JSON</Button>
            <Button variant="secondary" size="sm" icon={Upload} onClick={() => fileRef.current && fileRef.current.click()}>Import JSON</Button>
            <input ref={fileRef} type="file" accept=".json,application/json" className="hidden" onChange={doImport} />
          </>
        } />
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {rows.map(({ svc, fin, cost }) => (
          <ServiceTile key={svc.id} svc={svc} fin={fin} cost={cost} dieselOnly={dieselOnly.has(svc.id)} onOpen={onOpen} onRevert={revert} />
        ))}
      </ul>
      {fc && (
        <Tiles className="mt-3 grid-cols-1 lg:grid-cols-3">
          <Tile label="Fleet a day" note="shared buses split" value={money(fc.fleet.adjusted)} />
          <Tile label="Each service in full" note="a day" value={money(fc.fleet.standalone)}
            title="If every service paid the whole of every bus it uses" />
          <Tile label="Difference" note="shared buses counted twice" value={money(fc.fleet.doubleCounted)} />
        </Tiles>
      )}
    </Card>
  );
}

function ServiceTile({ svc, fin, cost, dieselOnly, onOpen, onRevert }) {
  // nothing to revert on a rota slot (the rota week moves it) or a built-in plan (nothing chosen here)
  const canRevert = !fin.isDefault && fin.kind !== "rotation" && !fin.builtIn;
  const how = fin.isDefault ? null : fin.kind === "rotation" ? "follows the rota" : fin.builtIn ? "built in" : "chosen here";
  const base = canRevert ? baselineFor(svc) : null;
  return (
    <li className="flex min-w-0 flex-col rounded-tile bg-satin p-4">
      <div className="flex min-w-0 items-center gap-2">
        <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-pill" style={{ background: svc.color }} />
        <h3 className="truncate text-[15px] font-bold tracking-[-0.01em] text-ink">{svc.name}</h3>
      </div>
      <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <Tag tone={fin.isDefault || fin.kind === "rotation" ? "neutral" : "ok"} className="min-w-0"
          title={fin.kind === "rotation" ? `Follows src/rotation.json · ${fin.file || ""}` : fin.builtIn ? `Built into the app (src/finalisedDefaults.json) · ${fin.file}` : undefined}>
          <span className="min-w-0">{fin.isDefault ? "Optimised · default" : fin.name}</span>
        </Tag>
        {how && <span className="text-[13px] text-ink-2">{how}</span>}
      </div>
      {/* two reasons a choice stopped resolving, and they need different fixes */}
      {fin.lostDraft && (
        <p className="mt-2 text-[13px] font-medium text-warn-ink"
          title={fin.needsRefinalise ? `“${fin.lostDraft}” was finalised before its costs were captured: open it and press Finalise again`
            : `The finalised plan was deleted, so this fell back to ${fin.builtIn ? "the built-in plan" : "the optimised one"}`}>
          {fin.needsRefinalise ? `Finalise “${fin.lostDraft}” again` : `“${fin.lostDraft}” was deleted`}
        </p>
      )}
      {/* plans built without standing costs read far higher here than in their own file: every
          service is re-costed on the live fleet's own costs so the services compare */}
      {dieselOnly && <p className="mt-2 text-[13px] font-medium text-warn-ink">Planned on diesel only, costed in full here</p>}
      <dl className="mt-4 grid grid-cols-2 gap-x-3 gap-y-3">
        <Figure label="Buses" value={cost ? count(cost.buses) : DASH} />
        <Figure label="Riders" value={cost ? count(cost.riders) : DASH} />
        <Figure label="Per head, alone" value={cost ? money1(cost.standaloneHead) : DASH} title="This service charged the whole of every bus it uses" />
        <Figure label="Per head, shared" value={cost ? money1(cost.adjustedHead) : DASH} title="Its share of a bus that runs several services" />
      </dl>
      <div className="mt-auto flex flex-wrap gap-2 pt-4">
        <Button variant="white" size="sm" onClick={() => onOpen(svc)}>Choose in Planner</Button>
        {canRevert && (
          <Button variant="ghost" size="sm" onClick={() => onRevert(svc)}
            title={base.builtIn ? `Go back to the built-in plan, ${base.name}` : "Go back to the optimised plan"}>Revert</Button>
        )}
      </div>
    </li>
  );
}

const Figure = ({ label, value, title }) => (
  <div className="flex min-w-0 flex-col" title={title}>
    <dt className="order-2 mt-1 truncate text-[11px] font-semibold text-ink-3">{label}</dt>
    <dd className="order-1 truncate text-[17px] font-bold leading-none tabular-nums tracking-[-0.01em] text-ink">{value}</dd>
  </div>
);
