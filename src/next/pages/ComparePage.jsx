/* Compare: two charts side by side, each with its own figure, grouping and dates, so two
   scenarios can be read next to each other. The figures are the old Compare tab's, from the same
   functions in Dashboard.jsx. What was picked survives a trip to another page and back. */
import React, { useCallback, useMemo, useRef, useState } from "react";
import { ChartLine, RotateCw, WifiOff } from "lucide-react";
import { unionDates } from "../../Dashboard.jsx";
import { Button, Card, Empty, PageHead, useRise } from "../ui.jsx";
import ChartCard from "./compare/ChartCard.jsx";
import CompareLoading, { OverCards } from "./compare/CompareLoading.jsx";
import { DEFAULTS } from "./compare/series.js";

const kept = { ...DEFAULTS };
function useCfg(id) {
  const [cfg, setCfg] = useState(kept[id]);
  const patch = useCallback((p) => setCfg((c) => {
    const next = { ...c, ...p };
    kept[id] = next;
    return next;
  }), [id]);
  return [cfg, patch];
}

export default function ComparePage({ fleet }) {
  const { loaded, effBuses: buses, effRecords: records, employees, attendance, settings, formulas, variables, erpStatus, syncErp } = fleet;
  const [a, setA] = useCfg("A");
  const [b, setB] = useCfg("B");
  const allDates = useMemo(() => unionDates(records, attendance), [records, attendance]);
  const data = useMemo(() => ({ buses, records, employees, attendance, settings, formulas, variables }),
    [buses, records, employees, attendance, settings, formulas, variables]);

  // idle counts as loading only while an automatic sync is about to start
  const syncing = erpStatus.phase === "syncing" || (erpStatus.phase === "idle" && settings.erpAuto);
  const waiting = !loaded || (!allDates.length && syncing);
  const root = useRef(null);
  useRise(root, !waiting && allDates.length > 0);

  if (waiting) {
    return (
      <>
        <PageHead title="Compare" />
        <CompareLoading progress={erpStatus.progress} />
      </>
    );
  }
  if (!allDates.length) {
    const failed = erpStatus.phase === "error";
    return (
      <>
        <PageHead title="Compare" />
        <OverCards>
          <Card padding="none" className="w-[min(440px,100%)]" role={failed ? "alert" : undefined}>
            <Empty icon={failed ? WifiOff : ChartLine}
              title={failed ? "Can’t reach the ERP" : "Nothing to compare yet"}
              hint={failed ? "Check the factory network, then press Retry." : "Charts appear once the ERP sends attendance."}
              action={<Button variant="primary" icon={RotateCw} onClick={() => syncErp()}>{failed ? "Retry" : "Sync now"}</Button>} />
          </Card>
        </OverCards>
      </>
    );
  }

  return (
    <div ref={root}>
      <PageHead title="Compare" />
      <div className="grid gap-3 lg:grid-cols-2">
        {/* plain wrappers carry the rise; each card stretches to its row so the two line up */}
        <div data-rise-deep className="flex min-w-0">
          <ChartCard title="Chart A" cfg={a} onCfg={setA} data={data} allDates={allDates} />
        </div>
        <div data-rise-deep className="flex min-w-0">
          <ChartCard title="Chart B" cfg={b} onCfg={setB} data={data} allDates={allDates} />
        </div>
      </div>
    </div>
  );
}
