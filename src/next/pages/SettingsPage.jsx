/* Settings: where the data comes from, working time, money and scores, custom metrics, then the
   technical tools. Two columns on desk whose bottoms always line up: the left ends with Advanced,
   the right with Variables, and whichever side is shorter lets its last card grow. One column on a
   phone, in reading order, with the technical tools last. Every setting writes through the same
   fleet functions and toasts as the old Settings page. */
import React, { useRef } from "react";
import { PageHead, cx, useRise } from "../ui.jsx";
import AdvancedCard from "./settings/AdvancedCard.jsx";
import { MetricsCard, VariablesCard } from "./settings/MetricsCard.jsx";
import MoneyCard from "./settings/MoneyCard.jsx";
import SourcesCard from "./settings/SourcesCard.jsx";
import WorkingTimeCard from "./settings/WorkingTimeCard.jsx";

/* Desk: left column in row 1, Advanced in row 2 under it, the right column across both rows. The
   DOM order is the phone's order, so Tab follows what is on screen. */
const PAGE = "flex flex-col gap-3 xl:grid xl:grid-cols-2 xl:grid-rows-[auto_1fr]";
const LEFT = "flex flex-col gap-3 xl:col-start-1 xl:row-start-1";
const RIGHT = "flex flex-col gap-3 xl:col-start-2 xl:row-span-2 xl:row-start-1";
const LAST_LEFT = "xl:col-start-1 xl:row-start-2";

// static placeholders: the layer they sit in is blurred, as on the Live page
const Bone = ({ className }) => <div className={cx("rounded-tile bg-satin-2", className)} />;
function Shell({ rows, className }) {
  return (
    <div className={cx("rounded-card bg-white p-5 shadow-card sm:p-6", className)}>
      <Bone className="mb-6 h-4 w-32" />
      <div className="flex flex-col gap-5">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex items-center justify-between gap-4">
            <Bone className="h-4 w-40" />
            <div className="h-9 w-28 rounded-pill bg-satin-2" />
          </div>
        ))}
      </div>
    </div>
  );
}

function SettingsLoading() {
  return (
    <div aria-busy="true" aria-label="Loading settings">
      <div aria-hidden className={cx(PAGE, "pointer-events-none select-none opacity-70 blur-[6px]")}>
        <div className={LEFT}>
          <Shell rows={5} />
          <Shell rows={6} />
        </div>
        <div className={RIGHT}>
          <Shell rows={5} />
          <Shell rows={4} />
          <Shell rows={3} className="xl:flex-1" />
        </div>
        <Shell rows={3} className={LAST_LEFT} />
      </div>
    </div>
  );
}

export default function SettingsPage({ fleet, toast }) {
  const f = fleet;
  const root = useRef(null);
  useRise(root, f.loaded);

  return (
    <>
      <PageHead title="Settings" />
      {f.loaded ? (
        <div ref={root} className={PAGE}>
          <div className={LEFT}>
            <SourcesCard fleet={f} />
            <WorkingTimeCard settings={f.settings} setSettings={f.setSettings} />
          </div>
          <div className={RIGHT}>
            <MoneyCard settings={f.settings} setSettings={f.setSettings} />
            <MetricsCard formulas={f.formulas} variables={f.variables}
              onAdd={(m) => { f.setFormulas([...f.formulas, m]); toast("Metric added"); }}
              onUpdate={(m) => { f.setFormulas(f.formulas.map((x) => (x.id === m.id ? m : x))); toast("Metric updated"); }}
              onDel={(id) => f.setFormulas(f.formulas.filter((x) => x.id !== id))} />
            <VariablesCard variables={f.variables} className="xl:flex-1"
              onAdd={(v) => { f.setVariables([...f.variables, v]); toast("Variable added"); }}
              onUpdate={(v) => f.setVariables(f.variables.map((x) => (x.id === v.id ? v : x)))}
              onDel={(id) => f.setVariables(f.variables.filter((x) => x.id !== id))} />
          </div>
          <AdvancedCard className={LAST_LEFT} onExport={f.exportJSON} onReset={f.resetAll} toast={toast} />
        </div>
      ) : <SettingsLoading />}
    </>
  );
}
