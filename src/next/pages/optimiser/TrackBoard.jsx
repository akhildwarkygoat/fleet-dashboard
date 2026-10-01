/* T.I: what the fleet actually did against the plan. One control row on top (the view, the plan it
   is measured against, the day), the day's figures on one row, then This day (type what each bus
   did), Over time (is the plan drifting) or By bus (which buses are furthest from plan).
   Everything the board knows and does is the old board's hook (useTrackImpl in
   src/optimiser/TrackImplView.jsx), so both looks read and write the same T.I history. The day, the
   view, the window and the search are kept for the session. */
import React, { useCallback, useRef } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTrackImpl, WINDOWS } from "../../../optimiser/TrackImplView.jsx";
import { addDays, downloadTI, fmtISO } from "../../../optimiser/trackImpl.js";
import { Button, Choice, IconButton, useRise } from "../../ui.jsx";
import { useKept } from "../bus/parts.jsx";
import BackToTop from "./shell/BackToTop.jsx";
import PlanLine from "./track/PlanLine.jsx";
import Figures from "./track/Figures.jsx";
import RunsCard from "./track/RunsCard.jsx";
import TrendCard from "./track/TrendCard.jsx";
import BusesCard from "./track/BusesCard.jsx";
import { plain } from "./track/parts.jsx";

const VIEWS = [["today", "This day"], ["trend", "Over time"], ["bus", "By bus"]];

/** The service day: previous day, the date, next day, as one pill; "Today" once another day is picked. */
function DayPicker({ date, onChange }) {
  const today = fmtISO(new Date());
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div role="group" aria-label="Service day" className="inline-flex h-11 items-center gap-0.5 rounded-pill bg-white px-1 shadow-chip">
        <IconButton label="Previous day" icon={ChevronLeft} variant="ghost" size="sm" onClick={() => onChange(addDays(date, -1))} />
        <input type="date" value={date} aria-label="Service day" onChange={(e) => e.target.value && onChange(e.target.value)}
          className="h-9 rounded-pill bg-transparent px-2 font-code text-[13px] font-semibold text-ink transition-colors hover:bg-satin focus:outline-none focus-visible:ring-2 focus-visible:ring-nova/40" />
        <IconButton label="Next day" icon={ChevronRight} variant="ghost" size="sm" onClick={() => onChange(addDays(date, 1))} />
      </div>
      {date !== today && <Button variant="ghost" size="sm" onClick={() => onChange(today)}>Today</Button>}
    </div>
  );
}

export default function TrackBoard({ toast, svc }) {
  const [date, setDate] = useKept("ti:date", fmtISO(new Date()));
  const [view, setView] = useKept("ti:view", "today");
  const [win, setWin] = useKept("ti:win", "14");
  // the old board's messages join a fact to its advice with a dash; here they read with a colon
  const say = useCallback((m) => toast && toast(plain(m)), [toast]);
  // the runs card searches by itself (forgiving of case and spaces), so the hook gets no search
  const board = useTrackImpl({ svc, toast: say, date, win, q: "" });
  const { scoped, ti, plans, expected, day, dates, series, perBus, rotationPlans, assumedSvcs } = board;
  const loading = scoped.some((s) => !(s.id in plans));

  // rise once, when the plans first land: a later reload (the rota week changing) must not hide what is on screen
  const root = useRef(null);
  const landed = useRef(false);
  if (!loading) landed.current = true;
  useRise(root, landed.current);

  const windowPicker = <Choice label="Window" value={win} onChange={setWin} options={WINDOWS} />;
  const openToday = () => setView("today");
  const exportAll = () => { downloadTI(); say("T.I history exported"); };

  return (
    <div ref={root} className="flex flex-col gap-3">
      <div className="flex min-h-11 flex-wrap items-center gap-x-4 gap-y-2">
        <Choice label="T.I view" value={view} onChange={setView} options={VIEWS} className="[&>button]:h-11" />
        <div className="min-w-0 flex-1 basis-[280px]">
          <PlanLine scoped={scoped} plans={plans} rotationPlans={rotationPlans} assumedSvcs={assumedSvcs} loading={loading} date={date} />
        </div>
        <DayPicker date={date} onChange={setDate} />
      </div>

      {/* with no plan and nothing recorded there is no figure to show, only the card that says why */}
      {!(board.noPlans && !loading && !day.recorded) && <Figures day={day} expected={expected.length} loading={loading} />}

      <div data-rise>
        {view === "today" && (
          <RunsCard board={board} svc={svc} date={date} loading={loading} multi={scoped.length > 1} toast={say}
            onExport={exportAll} canExport={Object.keys(ti.entries).length > 0} />
        )}
        {view === "trend" && <TrendCard series={series} win={win} windowPicker={windowPicker} onToday={openToday} />}
        {view === "bus" && <BusesCard perBus={perBus} dates={dates} multi={scoped.length > 1} windowPicker={windowPicker} onToday={openToday} />}
      </div>
      <BackToTop />
    </div>
  );
}
