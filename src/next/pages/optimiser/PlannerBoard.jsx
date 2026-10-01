/* The Planner: saved plans in a gallery, then a map-first editor where stops are added to a bus by
   selecting them on the map. Every plan, figure and action comes from optimiser/plannerState.js,
   the same code the old look runs, so both read and write the same saved plans. */
import React from "react";
import { usePlanHub } from "../../../optimiser/plannerState.js";
import Editor from "./planner/Editor.jsx";
import Gallery from "./planner/Gallery.jsx";
import PlannerLoading from "./planner/PlannerLoading.jsx";
import { usePlain } from "./planner/parts.jsx";

/* The open board per service, kept while the page is open, so switching to another Optimiser view
   and back does not lose a plan that has not been saved yet. */
const kept = new Map();
const keepFor = (svc) => {
  const id = (svc && svc.id) || "s9";
  if (!kept.has(id)) kept.set(id, {});
  return kept.get(id);
};

export default function PlannerBoard({ toast, erpBuses, svc, svcStops }) {
  const say = usePlain(toast);
  const hub = usePlanHub({ toast: say, erpBuses, svc, svcStops, keep: keepFor(svc) });
  if (!hub.ready || !hub.solverLoaded) return <PlannerLoading />;
  return hub.view === "gallery" ? <Gallery hub={hub} svc={svc} /> : <Editor hub={hub} toast={say} />;
}
