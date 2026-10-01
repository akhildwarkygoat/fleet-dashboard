/* Pages whose new look is not built yet, shown in their old form inside the new shell so
   everything works while the rest is rebuilt. Same components and the same props the old
   dashboard passes them. */
import React from "react";
import { THEMES, unitColor, CompareView, SettingsView } from "../../Dashboard.jsx";
import CostsView from "../../CostsView.jsx";
import OptimiserTab from "../../optimiser/OptimiserTab.jsx";
import { PageHead, Skeleton } from "../ui.jsx";
import "../legacy.css";

const t = THEMES.light;
const PAGES = {
  costs: { title: "Costs", step: 2 },
  compare: { title: "Compare", step: 2 },
  settings: { title: "Settings", step: 2 },
  optimiser: { title: "Optimiser", step: 3 },
};
const noop = () => {};

function Body({ page, fleet, toast }) {
  const f = fleet;
  if (page === "costs") {
    return <CostsView t={t} buses={f.effBuses} records={f.effRecords} busCosts={f.busCosts} wd={f.wd} dates={f.costDates} ridersOn={f.ridersOn} unitColor={unitColor} />;
  }
  if (page === "compare") {
    return <CompareView t={t} unit="all" buses={f.effBuses} records={f.effRecords} employees={f.employees} attendance={f.attendance}
      settings={f.settings} formulas={f.formulas} variables={f.variables} />;
  }
  if (page === "optimiser") {
    return <OptimiserTab t={t} toast={toast} erpBuses={f.buses} erpEmployees={f.employees} erpShifts={f.erpRoll} erpShiftDate={f.erpShiftDate} />;
  }
  return (
    <SettingsView t={t} settings={f.settings} setSettings={f.setSettings} onReset={f.resetAll}
      gpsStatus={f.gpsStatus} gpsFeed={f.gpsFeed} onSyncGps={() => f.syncGps({ full: true, silent: false })}
      dieselStatus={f.dieselStatus} diesel={f.diesel} onSyncDiesel={() => f.syncDiesel()} onExport={f.exportJSON} onSyncErp={f.syncErp}
      erpStatus={f.erpStatus} onSyncCosts={() => f.syncCosts()} costStatus={f.costStatus} costMeta={f.costMeta} toast={toast}
      themeName="light" setThemeName={noop}
      formulas={f.formulas} variables={f.variables}
      onAddMetric={(m) => { f.setFormulas([...f.formulas, m]); toast("Metric added"); }}
      onUpdateMetric={(m) => { f.setFormulas(f.formulas.map((x) => (x.id === m.id ? m : x))); toast("Metric updated"); }}
      onDelMetric={(id) => f.setFormulas(f.formulas.filter((x) => x.id !== id))}
      onAddVar={(v) => { f.setVariables([...f.variables, v]); toast("Variable added"); }}
      onUpdateVar={(v) => f.setVariables(f.variables.map((x) => (x.id === v.id ? v : x)))}
      onDelVar={(id) => f.setVariables(f.variables.filter((x) => x.id !== id))} />
  );
}

export default function LegacyPage({ page, fleet, toast }) {
  const meta = PAGES[page];
  return (
    <>
      <PageHead title={meta.title} sub={`This page keeps the old look until step ${meta.step}.`} />
      {fleet.loaded ? (
        <div className="legacy theme-light" style={{ color: t.text, "--focus-ring": t.primary, fontFeatureSettings: "normal" }}>
          <Body page={page} fleet={fleet} toast={toast} />
        </div>
      ) : (
        <div aria-busy="true" className="grid gap-3">
          <Skeleton className="h-28 rounded-card" />
          <Skeleton className="h-96 rounded-card" />
        </div>
      )}
    </>
  );
}
