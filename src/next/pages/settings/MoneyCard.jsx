/* Money and scores: whether net value shows, and the seats-filled bands. The bands colour the old
   dashboard; the new pages use the fixed health rule in src/next/health.js, and the caption says so. */
import React from "react";
import { DEFAULT_BANDS } from "../../../Dashboard.jsx";
import { Card, CardTitle } from "../../ui.jsx";
import { BandRows, OnOff, Row, Rows, labelCls } from "./parts.jsx";

export default function MoneyCard({ settings, setSettings, className }) {
  const bands = settings.bands || DEFAULT_BANDS;
  return (
    <Card data-rise-deep className={className}>
      <CardTitle title="Money and scores" />
      <Rows>
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
