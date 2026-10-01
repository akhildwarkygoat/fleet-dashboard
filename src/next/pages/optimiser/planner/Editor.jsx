/* The plan editor. The map is the page: it fills the screen down to the floating page bar (or the
   whole screen), the figures and the bus list float over its edges as frosted panels that can be
   hidden, and stops are added to the selected bus by selecting them on the map. On a phone the
   panels sit under the map instead, and full screen scrolls down to them. */
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, BarChart3, Bus, CircleCheck, Download, Maximize2, Minimize2, RotateCcw, Save, Scan, Sunrise, Sunset, Undo2, Redo2 } from "lucide-react";
import GMap, { FIXED_SHIFT_COLOR, INFERRED_SLOT_COLOR } from "../../../../optimiser/GMap.jsx";
import { UNADDED, usePlanBoard } from "../../../../optimiser/plannerState.js";
import { NT } from "../../../legacyTheme.js";
import { Alert, Button, Chip, IconButton, Input, Tag, cx } from "../../../ui.jsx";
import { count, money, plural } from "../../../format.js";
import { GlassButton, GlassNote } from "../shell/MapStage.jsx";
import BusPanel from "./BusPanel.jsx";
import FiguresPanel from "./FiguresPanel.jsx";
import { Dot, ON_PAGE, sameStops, useFlip, useMedia, useWinH } from "./parts.jsx";
import "../../../maps.css";

const GAP = 12;            // inset of everything floating over the map (the zoom buttons sit at 12 too)
const ZOOM_W = 48;         // room for the map's zoom buttons on the left
const PANEL_W = 340;       // the bus list
const ATTRIBUTION = 36;    // the map's credit line stays readable under the bus list
const TOOLS_H = 36;        // the full-screen tool row
// the shell pads the page 128px under its content for the floating page bar; the map stops 96px
// above the screen's bottom (the bar and a 24px gap), and the editor gives back the other 32px
const NAV_CLEAR = 96;

const DIRECTIONS = [
  ["evening", "Evening", Sunset, "Drop: from the factory out to the stops"],
  ["morning", "Morning", Sunrise, "Pickup: from the last stop in to the factory"],
];

function ClearBoard({ onClear }) {
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return <Button variant="danger" icon={RotateCcw} onClick={() => setAsking(true)} title="Take every stop off every bus">Clear</Button>;
  }
  return (
    <span role="group" aria-label="Clear the board" className="inline-flex items-center gap-2">
      <span className="text-[13px] font-medium text-bad-ink">Empty every bus? This cannot be undone.</span>
      <Button variant="ghost" size="sm" onClick={() => setAsking(false)}>Cancel</Button>
      <Button variant="danger" size="sm" onClick={() => { setAsking(false); onClear(); }}>Clear board</Button>
    </span>
  );
}

/* What the map's dots mean, as drawn: red is a stop on no bus, a stop on a bus takes its bus's
   colour, and the rota markings show only when this map has such stops. */
function Legend({ board }) {
  const { mapStops, busColor, activeBus } = board;
  const fixed = mapStops.some((s) => s.fixedShift > 0);
  const inferred = mapStops.some((s) => s.inferred > 0 && s.inferred >= (s.riderCount ?? s.headcount ?? 0));
  const firstColors = Object.values(busColor).slice(0, 3);
  return (
    <GlassNote className="pointer-events-none ml-auto">
      <span className="inline-flex items-center gap-1.5"><Dot color={UNADDED} />Not on a bus</span>
      {activeBus ? (
        <span className="inline-flex items-center gap-1.5"><Dot color={busColor[activeBus]} />This bus</span>
      ) : (
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="inline-flex -space-x-1">
            {firstColors.map((c) => <Dot key={c} color={c} className="ring-2 ring-white" />)}
          </span>
          On a bus, in its colour
        </span>
      )}
      {fixed && <span className="inline-flex items-center gap-1.5"><Dot color={FIXED_SHIFT_COLOR} />Same shift every week</span>}
      {inferred && <span className="inline-flex items-center gap-1.5"><Dot color={INFERRED_SLOT_COLOR} />Shift not confirmed</span>}
    </GlassNote>
  );
}

export default function Editor({ hub, toast }) {
  const { editor, fleet, depot, stopsById, totalRiders, demandOf, period, setPeriod, svcId, endPrefs, setEndPrefs, draftName,
    setDraftName, current, drafts, backToGallery, save, saveAndFinalise, finalised, exportJson, clearBoard, estimated, droppedRoutes, droppedRiders, droppedCost } = hub;
  const isFinal = !!(current && finalised && finalised.draftId === current.id);
  const list = useRef(null);
  const flip = useFlip(list);
  const board = usePlanBoard({ editor, fleet, depot, stopsById, totalRiders, demandOf, toast, period, svcId,
    parkPrefs: endPrefs, setParkPrefs: setEndPrefs, beforeReorder: flip.capture, plain: true });
  useLayoutEffect(() => flip.play(), [board.rank, board.typeOnly]); // eslint-disable-line react-hooks/exhaustive-deps

  const [full, setFull] = useState(false);
  const [showFigures, setShowFigures] = useState(true);
  const [showBuses, setShowBuses] = useState(true);
  const [fitSignal, setFitSignal] = useState(0);
  const desk = useMedia("(min-width: 1024px)");   // on a phone the panels sit under the map
  const winH = useWinH();

  // the enlarged view by default: the map runs from where it starts down to the page bar
  const head = useRef(null), frame = useRef(null);
  const [top, setTop] = useState(0);
  useLayoutEffect(() => {
    if (full || !desk) return;
    const measure = () => frame.current && setTop(frame.current.getBoundingClientRect().top + window.scrollY);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(head.current);
    window.addEventListener("resize", measure);
    return () => { ro.disconnect(); window.removeEventListener("resize", measure); };
  }, [full, desk]);
  const mapH = full ? winH - 2 * GAP : desk ? Math.max(480, winH - top - NAV_CLEAR) : 420;

  useEffect(() => {
    if (!full) return;
    // a menu open over the map takes Escape first and marks it handled
    const onKey = (e) => { if (e.key === "Escape" && !e.defaultPrevented) setFull(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [full]);

  const saved = useMemo(() => {
    const d = current && drafts.find((x) => x.id === current.id);
    return !!d && d.name === draftName.trim() && sameStops(d.assignments, editor.assign);
  }, [current, drafts, draftName, editor.assign]);

  const figures = <FiguresPanel board={board} glass={desk} onHide={desk ? () => setShowFigures(false) : null} />;
  const buses = <BusPanel board={board} editor={editor} fleetSize={fleet.length} listRef={list} glass={desk}
    onHide={desk ? () => setShowBuses(false) : null} />;
  const busesRight = showBuses ? PANEL_W + 2 * GAP : GAP;
  const figuresTop = full ? GAP + TOOLS_H + 8 : GAP;

  const direction = (glass) => (
    <div role="radiogroup" aria-label="Direction" className="flex gap-1.5">
      {DIRECTIONS.map(([v, label, Icon, title]) => glass ? (
        <GlassButton key={v} role="radio" aria-checked={period === v} icon={Icon} title={title} onClick={() => setPeriod(v)}
          className={cx("whitespace-nowrap", period === v && "!bg-ink !text-white hover:!bg-ink-2")}>{label}</GlassButton>
      ) : (
        <Chip key={v} role="radio" on={period === v} icon={Icon} title={title} onClick={() => setPeriod(v)} className="h-11">{label}</Chip>
      ))}
    </div>
  );

  return (
    <div className={cx(desk && !full && "-mb-8")}>
      <div ref={head}>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" icon={ArrowLeft} onClick={backToGallery} title="Back to your plans">Plans</Button>
          <span className={cx("w-full sm:w-[260px]", ON_PAGE)}>
            <Input value={draftName} onChange={(e) => setDraftName(e.target.value)} placeholder="Plan name" aria-label="Plan name" className="font-semibold" />
          </span>
          {saved && <span className="text-[13px] font-medium text-ink-2">Saved</span>}
          {direction(false)}
          <div className="flex flex-wrap items-center gap-2 lg:ml-auto">
            <IconButton label="Undo" icon={Undo2} variant="ghost" onClick={editor.undo} disabled={!editor.canUndo} />
            <IconButton label="Redo" icon={Redo2} variant="ghost" onClick={editor.redo} disabled={!editor.canRedo} />
            <ClearBoard onClear={clearBoard} />
            <Button variant="white" icon={Download} onClick={exportJson}>Export plan file</Button>
            <Button variant="secondary" icon={Save} onClick={() => save()}>Save</Button>
            {isFinal
              ? <Tag tone="ok" icon={CircleCheck} title="This plan is the one this service runs. Save keeps it up to date.">Finalised</Tag>
              : <Button variant="primary" icon={CircleCheck} onClick={saveAndFinalise} title="Save this plan and make it the one this service runs">Finalise</Button>}
          </div>
        </div>

        {(estimated || droppedRoutes.length > 0) && (
          <div className="mt-3 grid gap-2">
            {estimated && <Alert tone="warn">Some distances are straight-line estimates, so km and ride times may read low.</Alert>}
            {droppedRoutes.length > 0 && (
              <Alert tone="bad">
                {plural(droppedRoutes.length, "route", "routes")} not loaded: {droppedRoutes.map((d) => d.name).join(", ")} · not in today’s
                ERP fleet, so figures here leave out {plural(droppedRiders, "rider", "riders")} and {money(droppedCost)} a day
              </Alert>
            )}
          </div>
        )}
      </div>

      <div className={full ? "fixed inset-0 z-[35] overflow-y-auto bg-satin p-3" : "mt-3"}>
        {/* GMap draws its own border and small radius; inside the frame the frame gives the shape */}
        <div ref={frame} className="nx-map shadow-card [&>div:first-child]:rounded-none [&>div:first-child]:border-0" style={{ height: mapH }}>
          <GMap t={NT} stops={board.mapStops} routeColors={board.routeColors} depot={depot} polylines={board.polylines}
            pins={board.endPins} onSelect={board.onStopClick} height={mapH} scrollWheelZoom autoFit={false} plain fitSignal={fitSignal} />

          {full && (
            <div className="pointer-events-none absolute z-[500] flex flex-wrap items-center gap-2" style={{ top: GAP, left: GAP + ZOOM_W }}>
              <GlassButton aria-label="Undo" title="Undo" icon={Undo2} onClick={editor.undo} disabled={!editor.canUndo}
                className="w-9 justify-center !px-0 disabled:opacity-40" />
              <GlassButton aria-label="Redo" title="Redo" icon={Redo2} onClick={editor.redo} disabled={!editor.canRedo}
                className="w-9 justify-center !px-0 disabled:opacity-40" />
              {direction(true)}
              <GlassButton icon={Save} onClick={() => save()}>Save</GlassButton>
            </div>
          )}
          {desk && showFigures && (
            <div className="absolute z-[500]" style={{ top: figuresTop, left: GAP + ZOOM_W, right: busesRight }}>{figures}</div>
          )}
          {desk && showBuses && (
            <div className="pointer-events-none absolute z-[500] flex items-start" style={{ top: GAP, right: GAP, bottom: ATTRIBUTION, width: PANEL_W }}>{buses}</div>
          )}

          <div className="pointer-events-none absolute z-[500] flex flex-wrap items-end gap-2" style={{ left: GAP, bottom: GAP, right: desk && showBuses ? busesRight : GAP }}>
            <GlassButton icon={full ? Minimize2 : Maximize2} onClick={() => setFull((f) => !f)} aria-pressed={full} className="whitespace-nowrap">
              {full ? "Exit full screen" : "Full screen"}
            </GlassButton>
            <GlassButton icon={Scan} onClick={() => setFitSignal((k) => k + 1)} title="Show every stop">Fit</GlassButton>
            {desk && !showFigures && <GlassButton icon={BarChart3} onClick={() => setShowFigures(true)} className="whitespace-nowrap">Show figures</GlassButton>}
            {desk && !showBuses && (
              <GlassButton icon={Bus} onClick={() => setShowBuses(true)} className="whitespace-nowrap">
                Show buses <span className="tabular-nums text-ink-3">{count(board.busesUsed)} of {count(fleet.length)} used</span>
              </GlassButton>
            )}
            <Legend board={board} />
          </div>
        </div>

        {!desk && <div className="mt-3 grid gap-3">{figures}{buses}</div>}
      </div>
    </div>
  );
}
