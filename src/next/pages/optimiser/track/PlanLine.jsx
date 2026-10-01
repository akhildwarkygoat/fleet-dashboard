/* The one grey line that says what the times are measured against: the plan's name and the date it
   came into force. The old board's explanation paragraph is its hover text (and read out to screen
   readers). A day picked from before that date keeps the plan it was marked against, and the line
   says so. The plans are the ones useTrackImpl resolved; nothing is resolved twice. */
import React from "react";
import { Info } from "lucide-react";
import BUILT_IN from "../../../../finalisedDefaults.json";
import { getFinalised } from "../../../../optimiser/finalisedPlans.js";
import { fmtISO } from "../../../../optimiser/trackImpl.js";
import { Skeleton } from "../../../ui.jsx";
import { day, plural } from "../../../format.js";

/* A rota plan's name already carries its week ("Group 2 · Day · week of 28 Sep"). Otherwise: the
   day it was finalised in this browser, the day the built-in plans were set, or the plan file's
   own build date. */
function since(s, p) {
  const m = p.meta;
  if (m.kind === "rotation") return null;
  const ref = getFinalised()[s.id];
  if (!m.isDefault && !m.builtIn && ref && ref.at) return fmtISO(new Date(ref.at));
  if (m.builtIn) return BUILT_IN.set;
  return (p.body && (p.body.generated || (p.body.source && p.body.source.received))) || null;
}
const nameOf = (m) => (m.isDefault ? "the optimiser’s plan" : m.kind === "rotation" ? m.name : `“${m.name}”`);
function planText(s, p) {
  const when = since(s, p);
  return nameOf(p.meta) + (when ? `, in force since ${day(when)}` : "") + (p.meta.isDefault ? ` (nothing finalised for ${s.name} yet)` : "");
}

export default function PlanLine({ scoped, plans, rotationPlans, assumedSvcs, loading, date }) {
  if (loading) return <Skeleton className="h-4 w-80 max-w-full !rounded-pill" />;
  const have = scoped.filter((s) => plans[s.id]);
  if (!have.length) return null;
  const single = scoped.length === 1;
  const none = scoped.filter((s) => !plans[s.id]);
  const earlier = have.some((s) => { const w = since(s, plans[s.id]); return w && date < String(w).slice(0, 10); });
  const more = [
    "Each time is measured against the finalised plan as it stood when the time was entered. Finalising a different plan later does not change a day already recorded.",
    !single && have.map((s) => `${s.name}: ${planText(s, plans[s.id])}`).join("\n"),
    rotationPlans.length > 0 && `Rotational is on ${rotationPlans.join(", ")}. The rider groups move one clock along every Monday, so the plan behind each slot changes with them, and each record keeps the plan it was marked against.`,
    assumedSvcs.length > 0 && `Drop runs on ${assumedSvcs.join(", ")} are timed against an assumed 8-hour shift, because the ERP gives a gate time but no release time. Their ride time still counts; their lateness is left out of every average.`,
    "A run belongs to the day it started: a night bus finishing at 06:50 is filed under the night before.",
  ].filter(Boolean).join("\n\n");

  return (
    <p title={more} className="flex min-w-0 cursor-help items-start gap-2 text-[13px] text-ink-3">
      <Info size={15} strokeWidth={2} aria-hidden className="mt-0.5 shrink-0" />
      <span className="min-w-0">
        {single
          ? <>Measured against <b className="font-semibold text-ink">{planText(scoped[0], plans[scoped[0].id])}</b></>
          : <>Measured against <b className="font-semibold text-ink">{plural(have.length, "finalised plan", "finalised plans")}</b>, one per service</>}
        {earlier && <>. Earlier days keep the plan they were marked against</>}
        {none.length > 0 && <span className="text-warn-ink">. No plan for {none.map((s) => s.name).join(", ")}</span>}
        <span className="sr-only">. {more}</span>
      </span>
    </p>
  );
}
