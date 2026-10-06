/* Money and scores: the driver salary (the ERP has none), whether net value shows, and the seats-filled bands. The bands colour the old
   dashboard; the new pages use the fixed health rule in src/next/health.js, and the caption says so. */
import React from "react";
import { DEFAULT_BANDS } from "../../../Dashboard.jsx";
import { Card, CardTitle, Input } from "../../ui.jsx";
import { BandRows, OnOff, Row, Rows, labelCls } from "./parts.jsx";
import { DRIVER_DAYS_A_MONTH, DRIVER_SALARY_MONTH } from "../../../dailyCost.js";

export default function MoneyCard({ settings, setSettings, className }) {
  const bands = settings.bands || DEFAULT_BANDS;
  return (
    <Card data-rise-deep className={className}>
      <CardTitle title="Money and scores" />
      <Rows>
        <Row label="Driver salary a month" hint={`Each owned bus · ÷ ${DRIVER_DAYS_A_MONTH} a day worked · not in the ERP`}>
          <div className="w-32">
            <Input type="number" min="0" step="500" value={settings.driverSalaryMonth ?? DRIVER_SALARY_MONTH} aria-label="Driver salary a month, ₹"
              onChange={(e) => { const v = parseFloat(e.target.value); setSettings({ ...settings, driverSalaryMonth: Number.isFinite(v) && v >= 0 ? v : 0 }); }}
              className="text-right tabular-nums" />
          </div>
        </Row>
        <Row label="Net value a year" hint="Budget left after spend, over a year · shown on Live and the bus page">
          <OnOff label="Show net value" on={!!settings.showNetValue} onChange={(v) => setSettings({ ...settings, showNetValue: v })} />
        </Row>
        <div className="pt-3.5">
          <p className={labelCls}>Seats filled bands</p>
          <p className="mb-3 mt-0.5 text-[13px] text-ink-3">Used by the old dashboard · Live and Bus use 90–125% good, under 50% or over 150% bad</p>
          <BandRows bands={bands} setBands={(b) => setSettings({ ...settings, bands: b })} />
        </div>
      </Rows>
    </Card>
  );
}
