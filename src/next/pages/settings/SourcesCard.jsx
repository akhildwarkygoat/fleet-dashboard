/* Data sources: the four feeds the dashboard reads, each with how fresh it is and a Sync now.
   A tag appears only when a feed is failing, not linked or not synced yet, in the same words on
   every row; otherwise the row shows when it last updated. The sync calls are the old Settings
   page's, unchanged; a sync already running (the timer's too) keeps the button busy. */
import React, { useState } from "react";
import { RefreshCw } from "lucide-react";
import { GPS_KEEP_DAYS } from "../../../Dashboard.jsx";
import { Button, Card, CardTitle, Select, Tag } from "../../ui.jsx";
import { clock, count, day, dayRange, kms, plural } from "../../format.js";
import { OnOff, Row, Rows, Updated } from "./parts.jsx";

const INTERVALS = [[15, "Every 15 min"], [30, "Every 30 min"], [60, "Every hour"], [180, "Every 3 hours"], [0, "Once a day"]];

/* Buses the bus app recorded on its own "today", and how many of them are still on the road.
   The same counts the old Settings page showed; nothing else reads them. */
function gpsToday(feed) {
  const today = feed && feed.today;
  if (!today) return { recorded: 0, out: 0 };
  const days = feed.days.filter((d) => d.serviceDate === today);
  return { recorded: days.length, out: days.filter((d) => d.active).length };
}

const notYet = <Tag>Not synced yet</Tag>;
const cantReach = <Tag tone="bad">Can’t reach</Tag>;

/** Status or freshness, then Sync now. */
function SourceRow({ label, hint, hintTitle, detail, failed, status, at, busy, onSync }) {
  return (
    <Row label={label} hint={hint} hintTitle={hintTitle} hintTone={failed ? "bad" : undefined} detail={detail}>
      {status || <Updated at={at} />}
      <Button variant="secondary" size="sm" icon={RefreshCw} busy={busy} onClick={onSync} className="min-w-[112px]">
        {busy ? "Syncing…" : "Sync now"}
      </Button>
    </Row>
  );
}

export default function SourcesCard({ fleet, className }) {
  const { buses, employees, settings, setSettings, erpStatus, syncErp, costStatus, costMeta, syncCosts,
    dieselStatus, diesel, syncDiesel, gpsStatus, gpsFeed, syncGps } = fleet;
  const [syncing, setSyncing] = useState(false);
  const doSync = async () => { setSyncing(true); try { await syncErp(); } finally { setSyncing(false); } };
  const autoOn = settings.erpAuto !== false;

  const erpFailed = erpStatus.phase === "error";
  const p = erpStatus.progress;
  const erpTag = erpFailed ? cantReach
    : p && p.total > 0 ? <Tag tone="nova">{count(p.done)} of {count(p.total)} routes</Tag>
    : erpStatus.phase === "idle" ? notYet : null;
  const erpHint = erpFailed ? erpStatus.msg
    : buses.length ? `${plural(buses.length, "bus", "buses")} · ${plural(employees.length, "employee", "employees")}` : "Buses, employees and attendance";

  const costFailed = costStatus.phase === "error";
  const costHint = costFailed ? costStatus.msg
    : costMeta ? `${plural(costMeta.vehicles, "bus", "buses")} · ${dayRange(costMeta.from, costMeta.to)}` : "Approved cost lines for each bus";
  const costDetail = !costFailed && costMeta ? [
    `${count(costMeta.used)} of ${count(costMeta.rows)} cost lines used`,
    costMeta.skippedUnapproved > 0 && `${count(costMeta.skippedUnapproved)} unapproved left out`,
  ].filter(Boolean).join(" · ") : null;
  const costTitle = costMeta ? [`FY ${costMeta.fy}`, costMeta.heads && costMeta.heads.length && `heads: ${costMeta.heads.join(", ")}`]
    .filter(Boolean).join(" · ") : undefined;

  const dm = diesel && diesel.meta;
  const dieselFailed = dieselStatus.phase === "error";
  const dieselHint = dieselFailed ? `${dieselStatus.msg}${dm ? ` · kept to ${day(dm.to)}` : ""}`
    : dm ? `${kms(dm.litres)} L issued · ${dayRange(dm.from, dm.to)}` : "Diesel issued to each vehicle";

  const g = gpsToday(gpsFeed);
  const gp = gpsStatus.phase;
  const gpsFailed = gp === "offline" || gp === "error";
  const gpsTag = gp === "off" ? <Tag tone="warn">Not linked</Tag>
    : gp === "error" && gpsStatus.code === "bus_app_outdated" ? <Tag tone="warn">Needs a restart</Tag>
    : gp === "error" && gpsStatus.code === "unauthorised" ? <Tag tone="bad">Key refused</Tag>
    : gpsFailed ? cantReach
    : gp === "idle" ? notYet : null;
  const last = gpsFeed && gpsStatus.at ? ` · last ${clock(gpsStatus.at)}` : "";
  const gpsHint = gp === "offline" ? `${gpsStatus.msg} – plan km used until it is back${last}`
    : gpsFailed || gp === "off" ? gpsStatus.msg
    : gpsFeed ? `${plural(g.recorded, "bus", "buses")} recorded today${g.out ? ` · ${count(g.out)} still out` : ""}`
    : "Km each bus travelled, from the bus attendance app";
  const gpsTitle = gpsFeed ? `${count(gpsFeed.days.length)} bus-days held from the last ${GPS_KEEP_DAYS} days · checked every 30 s while open` : undefined;

  return (
    <Card data-rise-deep className={className}>
      <CardTitle title="Data sources" />
      <Rows>
        <SourceRow label="ERP" hint={erpHint} failed={erpFailed} status={erpTag} at={erpStatus.at}
          busy={syncing || erpStatus.phase === "syncing"} onSync={doSync} />
        <Row label="Auto refresh" hint="Fetch from the ERP on a timer">
          <OnOff label="Auto refresh from the ERP" on={autoOn} onChange={(v) => setSettings({ ...settings, erpAuto: v })} />
          {autoOn && (
            <div className="w-40">
              <Select aria-label="Refresh every" value={settings.erpRefreshMin ?? 30} onChange={(e) => setSettings({ ...settings, erpRefreshMin: +e.target.value })}>
                {INTERVALS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </Select>
            </div>
          )}
        </Row>
        <SourceRow label="Costing" hint={costHint} detail={costDetail} hintTitle={costTitle} failed={costFailed}
          status={costFailed ? cantReach : costStatus.phase === "idle" ? notYet : null} at={costStatus.at}
          busy={costStatus.phase === "syncing"} onSync={() => syncCosts()} />
        <SourceRow label="Diesel issued" hint={dieselHint} failed={dieselFailed}
          status={dieselFailed ? cantReach : dieselStatus.phase === "idle" && !dm ? notYet : null} at={dieselStatus.at}
          busy={dieselStatus.phase === "syncing"} onSync={() => syncDiesel()} />
        <SourceRow label="Bus app GPS" hint={gpsHint} hintTitle={gpsTitle} failed={gpsFailed} status={gpsTag} at={gpsStatus.at}
          busy={gp === "syncing"} onSync={() => syncGps({ full: true, silent: false })} />
      </Rows>
    </Card>
  );
}
