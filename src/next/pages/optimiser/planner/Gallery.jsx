/* The Planner's landing: three ways to start a plan, then every saved plan as a card with its map,
   its figures and when it was last edited, in the same three columns on desk. The ERP's previous
   routes are always there as a starting point. Plans can be ranked by any plan figure; the row is
   never left half empty: the space after the last card shows the best of the saved plans, or what
   this service has to plan. */
import React, { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Circle, CircleCheck, FileUp, MapPinned, Plus, Sparkles, Trash2 } from "lucide-react";
import { PlanThumb } from "../../../../optimiser/PlanGallery.jsx";
import { PLAN_RANK, rankBy } from "../../../../optimiser/kpiRank.js";
import { isFinalOf, prevRouteLines, readPlanFile, usePlanRanking } from "../../../../optimiser/plannerState.js";
import { localIso } from "../../../../Dashboard.jsx";
import { NT } from "../../../legacyTheme.js";
import { Button, Chip, Choice, Field, IconButton, Select, Tile, Tiles, Unit, cx, useRise } from "../../../ui.jsx";
import { DASH, clock, count, day, money1 } from "../../../format.js";
import { FIGURE_LABEL, GRID, ON_PAGE, fmtFigure, useCols, useFlip } from "./parts.jsx";

const edited = (ts) => (ts ? `Edited ${day(localIso(new Date(ts)))}, ${clock(ts)}` : "");

function StartCard({ ink, icon: Icon, title, sub, fact, onClick, disabled }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className={cx("flex min-w-0 items-center gap-4 rounded-card p-5 text-left transition-[transform,box-shadow,background-color] duration-200",
        "active:scale-[0.985] disabled:cursor-not-allowed disabled:active:scale-100",
        ink ? "bg-ink text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.18)] hover:bg-ink-2"
          : "bg-white text-ink shadow-card enabled:hover:-translate-y-0.5 enabled:hover:shadow-float")}>
      <span className={cx("flex h-11 w-11 shrink-0 items-center justify-center rounded-pill", ink ? "bg-white/15" : "bg-satin-2", disabled && "opacity-50")}>
        <Icon size={20} strokeWidth={2} aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className={cx("block text-[15px] font-bold tracking-[-0.01em]", disabled && "text-ink-3")}>{title}</span>
        <span className={cx("mt-0.5 block truncate text-[13px]", ink ? "text-white/70" : "text-ink-3")}>{sub}</span>
      </span>
      {fact && (
        <span className="ml-auto shrink-0 text-right">
          <span className="block text-[15px] font-bold tabular-nums">{fact.value}</span>
          <span className={cx("block text-[11px] font-semibold", ink ? "text-white/70" : "text-ink-3")}>{fact.label}</span>
        </span>
      )}
    </button>
  );
}

/** A plan as a card: its map in a satin frame, its name, its riders as the lead figure over two more,
 *  and a row of actions. The whole card opens the plan; the actions sit above that. */
function PlanCard({ name, sub, thumb, badge, lead, figures, footer, onOpen, title }) {
  return (
    <article className="relative flex min-w-0 flex-col rounded-card bg-white p-3 shadow-card transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-float">
      <div className="relative h-40 overflow-hidden rounded-tile bg-satin">
        {thumb}
        {badge}
      </div>
      <h3 className="mt-3 min-w-0 px-2 text-[15px] font-bold tracking-[-0.01em] text-ink">
        <button type="button" onClick={onOpen} title={title}
          className="block w-full truncate text-left after:absolute after:inset-0 after:rounded-card focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-nova">
          {name}
        </button>
      </h3>
      <p className="mt-0.5 truncate px-2 text-[13px] text-ink-3">{sub}</p>
      <p className="mt-3 px-2">
        <span className="block text-[22px] font-bold leading-7 tracking-[-0.01em] tabular-nums text-ink">{lead.value}</span>
        <span className="block text-[11px] font-semibold text-ink-3">{lead.label}</span>
      </p>
      <Tiles className="mt-3 grid-cols-2">
        {figures.map((f) => <Tile key={f.label} size="sm" label={f.label} value={f.value} />)}
      </Tiles>
      <div className="relative z-10 mt-auto flex min-h-9 items-center gap-2 px-1 pt-3">{footer}</div>
    </article>
  );
}

function RankBadge({ pos, none }) {
  return (
    <span className={cx("absolute left-2 top-2 rounded-pill px-2.5 py-1 text-[12px] font-bold tabular-nums shadow-chip",
      pos === 1 ? "bg-ink text-white" : "bg-white text-ink")}>
      {pos != null ? `#${pos}` : none}
    </span>
  );
}

function DraftCard({ d, pos, value, rank, body, totalRiders, final, canFinalise, onOpen, onFinalise, onDelete, stopsById, depot, busColor }) {
  const [asking, setAsking] = useState(false);
  const m = d.meta || {};
  const third = rank
    ? { label: FIGURE_LABEL[rank.key] || PLAN_RANK[rank.key].label, value: pos != null ? fmtFigure(rank.key, value) : DASH }
    : { label: "Cost / head · estimate", value: body ? money1(PLAN_RANK.cost.value(body)) : DASH };
  return (
    <PlanCard name={d.name} sub={edited(d.ts)} onOpen={onOpen} title={`Open ${d.name}`}
      thumb={<PlanThumb t={NT} assignments={d.assignments} stopsById={stopsById} depot={depot} busColor={busColor} />}
      badge={rank && <RankBadge pos={pos} none="Not scored" />}
      lead={{ label: "Riders on a bus", value: <>{count(m.riders ?? 0)}{totalRiders ? <Unit>/ {count(totalRiders)}</Unit> : null}</> }}
      figures={[{ label: "Buses", value: count(m.buses ?? 0) }, third]}
      footer={asking ? (
        <>
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-bad-ink">Delete this plan?</span>
          <Button variant="ghost" size="sm" onClick={() => setAsking(false)}>Cancel</Button>
          <Button variant="danger" size="sm" onClick={onDelete}>Delete</Button>
        </>
      ) : (
        <>
          {canFinalise && (
            <Chip on={final} icon={final ? CircleCheck : Circle} onClick={onFinalise}
              title={final ? "This is the plan this service runs. Press to stop using it." : "Use this plan for this service"}>
              {final ? "Finalised" : "Finalise"}
            </Chip>
          )}
          <IconButton label={`Delete ${d.name}`} icon={Trash2} variant="ghost" size="sm" className="ml-auto" onClick={() => setAsking(true)} />
        </>
      )} />
  );
}

/* Fills the rest of the last row: the best saved plan on three figures once there are two to
   compare, else what this service has to plan and how to keep a plan here. */
function Filler({ span, drafts, bodies, onOpen, facts }) {
  const scored = useMemo(() => drafts.filter((d) => bodies && bodies.get(d.id)), [drafts, bodies]);
  const style = { gridColumn: `span ${span} / span ${span}` };
  if (scored.length < 2) {
    return (
      <section style={style} aria-label="This service" className="flex flex-col rounded-card bg-white p-5 shadow-card">
        <h3 className="text-[15px] font-bold tracking-[-0.01em] text-ink">This service</h3>
        <Tiles className="mt-3 grid-cols-3">
          <Tile size="sm" label="Riders" value={count(facts.riders)} />
          <Tile size="sm" label="Stops" value={count(facts.stops)} />
          <Tile size="sm" label="Buses" value={count(facts.buses)} />
        </Tiles>
        <p className="mt-auto flex items-center gap-2 pt-4 text-[13px] text-ink-2">
          <MapPinned size={16} aria-hidden className="shrink-0 text-ink-3" />
          {drafts.length ? "Save another plan to compare the two here." : "Start a plan above and press Save to keep it here."}
        </p>
      </section>
    );
  }
  const best = [["cost", "asc", "Lowest cost / head"], ["util", "desc", "Most seats filled"], ["avgride", "asc", "Shortest average ride"]]
    .map(([key, dir, label]) => {
      const [top] = rankBy(scored, (d) => PLAN_RANK[key].value(bodies.get(d.id)), dir);
      return { key, label, plan: top.item, value: top.value };
    });
  return (
    <section style={style} aria-label="Best of your plans" className="flex flex-col rounded-card bg-white p-5 shadow-card">
      <h3 className="text-[15px] font-bold tracking-[-0.01em] text-ink">Best of your plans</h3>
      <ul className="mt-2 flex flex-1 flex-col justify-center divide-y divide-line">
        {best.map((b) => (
          <li key={b.key}>
            <button type="button" onClick={() => onOpen(b.plan)} title={`Open ${b.plan.name}`}
              className="flex w-full items-center gap-3 rounded-tile py-3 text-left transition-colors hover:bg-satin/70">
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] text-ink-3">{b.label}</span>
                <span className="block truncate text-[15px] font-semibold text-ink">{b.plan.name}</span>
              </span>
              <span className="shrink-0 text-[17px] font-bold tabular-nums text-ink">{fmtFigure(b.key, b.value)}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function Gallery({ hub, svc }) {
  const { drafts, totalRiders, allStops, fleet, solver, planLabel, planKind, finalised, finalise, stopsById, depot, busColor,
    newBlank, importPlan, openDraft, deleteDraft, importFromFile, importPrevRoutes, prevRoutes, draftBodies } = hub;
  const root = useRef(null), grid = useRef(null), file = useRef(null);
  const flip = useFlip(grid);
  const { rank, setRank, chips, ranked } = usePlanRanking(drafts, draftBodies);
  useLayoutEffect(() => flip.play(), [rank]); // eslint-disable-line react-hooks/exhaustive-deps
  useRise(root, true);
  const cols = useCols();

  const rankPick = (next) => { flip.capture(); setRank(next); };
  const prevLines = useMemo(() => prevRouteLines(prevRoutes), [prevRoutes]);
  const prevMeta = prevRoutes && prevRoutes.meta;
  const cards = ranked.length + (prevLines ? 1 : 0);
  const rest = cards ? (cols - (cards % cols)) % cols : cols;
  const fromOptimised = planKind === "optimised" || !planKind;
  const solverBuses = solver ? (solver.overall ? solver.overall.buses : Array.isArray(solver.routes) ? solver.routes.length : null) : null;

  const prevCard = prevLines && (
    <PlanCard key="prev" name="Previous routes" sub="From the ERP · the routes that ran" onOpen={importPrevRoutes}
      title={rank ? "The routes the ERP ran. Not a saved plan, so it is not ranked." : "Open the routes the ERP ran"}
      thumb={<PlanThumb t={NT} lines={prevLines} depot={depot} />}
      badge={rank && <RankBadge none="Not ranked" />}
      lead={{ label: "Riders", value: prevMeta ? count(prevMeta.riders) : DASH }}
      figures={[
        { label: "Buses", value: prevMeta ? count(prevMeta.vehicles) : DASH },
        { label: "Stops", value: prevMeta ? count(prevMeta.stops) : DASH },
      ]}
      footer={<span className="px-1 text-[13px] text-ink-3">Opens as a new plan</span>} />
  );

  return (
    <div ref={root}>
      <div data-rise className="grid gap-3 sm:grid-cols-3">
        <StartCard ink icon={Plus} title="Blank plan" sub="Start from an empty map" onClick={newBlank}
          fact={{ value: count(allStops.length), label: "stops" }} />
        <StartCard icon={Sparkles} onClick={importPlan} disabled={!solver}
          title={fromOptimised ? "From the optimised plan" : "From the finalised plan"}
          sub={!solver ? "No optimised plan yet · see Fleet plan" : planKind === "rotation" ? `Manager’s plan · ${planLabel}` : planLabel}
          fact={solverBuses != null ? { value: count(solverBuses), label: "buses" } : null} />
        <StartCard icon={FileUp} title="Import a plan file" sub="A file saved with Export plan file" onClick={() => file.current && file.current.click()} />
        <input ref={file} type="file" accept=".json,application/json" className="hidden" onChange={(e) => readPlanFile(e, importFromFile)} />
      </div>

      <div data-rise className="mt-6 flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <h2 className="text-[22px] font-bold leading-tight tracking-[-0.01em] text-ink">
            Plans <span className="font-semibold tabular-nums text-ink-3">{count(cards)}</span>
          </h2>
          {svc && svc.slot && finalised && (
            <p className="mt-1 text-[13px] text-ink-3">
              Running <b className="font-semibold text-ink">{finalised.name}</b> · {finalised.kind === "rotation" ? "manager’s plan" : "finalised by hand"}
            </p>
          )}
        </div>
        {(drafts.length > 1 || rank) && chips.length > 0 && (
          <div className="flex w-full flex-wrap items-end gap-2 sm:w-auto">
            <Field label="Rank plans by" className={cx("w-full sm:w-[220px]", ON_PAGE)}>
              <Select value={rank ? rank.key : ""} onChange={(e) => rankPick(e.target.value ? { key: e.target.value, dir: "desc" } : null)}>
                <option value="">Newest first</option>
                {chips.map((c) => <option key={c.key} value={c.key}>{FIGURE_LABEL[c.key] || PLAN_RANK[c.key].label}</option>)}
              </Select>
            </Field>
            {rank && (
              <Choice label="Order" value={rank.dir} onChange={(dir) => rankPick({ ...rank, dir })} className="[&>button]:h-11"
                options={[["desc", "Highest first"], ["asc", "Lowest first"]]} />
            )}
          </div>
        )}
      </div>

      <div ref={grid} data-rise className={cx("mt-4", GRID)}>
        {!rank && prevCard}
        {ranked.map(({ item: d, value, rank: pos }) => (
          <DraftCard key={d.id} d={d} pos={pos} value={value} rank={rank} body={draftBodies && draftBodies.get(d.id)} totalRiders={totalRiders}
            final={isFinalOf(finalised, "draft", d.id)} canFinalise={!!svc} stopsById={stopsById} depot={depot} busColor={busColor}
            onOpen={() => openDraft(d)} onFinalise={() => finalise({ kind: "draft", id: d.id, name: d.name })} onDelete={() => deleteDraft(d)} />
        ))}
        {rank && prevCard}
        {rest > 0 && (
          <Filler key="filler" span={rest} drafts={drafts} bodies={draftBodies} onOpen={openDraft}
            facts={{ riders: totalRiders, stops: allStops.length, buses: fleet.length }} />
        )}
      </div>
    </div>
  );
}
