/* Km and diesel by day: the 14 days to the chosen date, each day's km and where it came from, and the
   two ways it is priced. Rows and totals come from busKmDieselDays, the same as the old look. Km from
   the plan and the ERP's average stand-in carry the violet tag the cost card uses for figures that
   were not measured. */
import React, { useMemo } from "react";
import { busKmDieselDays } from "../../../Dashboard.jsx";
import { LOW_GPS_SHARE, MAX_SPREAD_DAYS } from "../../../dailyCost.js";
import { Alert, Card, CardTitle, DataTable, Tag, Tile, Tiles, Unit, cx, tdCls, thCls, trCls } from "../../ui.jsx";
import { DASH, MINUS, clock, day, kms, money, percent, plural } from "../../format.js";
import { MoneyTile, Sub, TileMissing, VioletKey } from "./parts.jsx";

const Small = ({ children }) => <Unit className="!text-[13px]">{children}</Unit>;
const Violet = ({ children }) => <div className="mt-1"><Tag tone="violet" className="whitespace-nowrap !px-2.5 !py-0.5">{children}</Tag></div>;

function KmCell({ d }) {
  if (!d.source) return <><span className="font-semibold text-ink-4">{DASH}</span><Sub>not recorded</Sub></>;
  return (
    <>
      <span className="font-semibold text-ink">{kms(d.km)}</span>
      {d.source === "plan" ? <Violet>from plan</Violet>
        : d.gps.active ? <div className="mt-1"><Tag tone="nova" className="whitespace-nowrap !px-2.5 !py-0.5">GPS · {d.gps.active} still out</Tag></div>
          : <Sub>GPS · {plural(d.gps.journeys, "trip", "trips")}</Sub>}
      {d.partial && <Sub tone="warn">under {Math.round(LOW_GPS_SHARE * 100)}% of the plan’s {kms(d.planKm)}</Sub>}
    </>
  );
}

function IssuedCell({ z }) {
  if (!z) return <><span className="font-semibold text-ink-4">{DASH}</span><Sub>not loaded</Sub></>;
  if (z.source === "none") return <><span className="font-semibold text-ink">0 L</span><Sub>none issued</Sub></>;
  if (z.source === "estimate") return <><span className="font-semibold text-ink">≈{kms(z.litres)} L</span><Violet>ERP average</Violet><Sub>until the next fill</Sub></>;
  return (
    <>
      <span className="font-semibold text-ink">{kms(z.litres)} L</span>
      <Sub>{z.issue.days > 1 ? `${day(z.issue.date)} issue over ${z.issue.days} days` : "issued this day"}</Sub>
    </>
  );
}

const LOW = "recent km may read low";
function gpsTrouble(st, feed) {
  if (st.phase === "offline") return feed && st.at ? `GPS from the bus app stopped at ${clock(st.at)} · ${LOW}` : `The bus app is offline · ${LOW}`;
  if (st.code === "bus_app_outdated") return `The bus app needs a restart · ${LOW}`;
  if (st.code === "unauthorised") return `The bus app refused the key · ${LOW}`;
  return `GPS from the bus app could not be loaded · ${LOW}`;
}

export default function KmDieselCard({ bus, endDate, run, gpsStatus, gpsFeed, onSyncGps, dieselStatus, diesel, onSyncDiesel }) {
  const { days, hired, sum } = useMemo(() => busKmDieselDays(bus, endDate, run), [bus, endDate, run]);
  if (!endDate) return null;
  const gpsDown = gpsStatus.phase === "offline" || gpsStatus.phase === "error";
  const dieselDown = !hired && dieselStatus.phase === "error";
  // before the ERP diesel feed lands, its columns would be dashes on every row: leave them out
  const issued = !hired && !!run.diesel;
  const showKmpl = issued && days.some((r) => r.kmpl != null);
  const anyViolet = days.some((r) => r.day.source === "plan" || (r.cost.byDiesel && r.cost.byDiesel.source === "estimate"));
  const num = cx(tdCls, "!align-top text-right tabular-nums");

  return (
    <Card data-rise-deep>
      <CardTitle title="Km and diesel by day"
        sub={!hired && !issued ? `14 days to ${day(endDate)} · by diesel not loaded yet` : `14 days to ${day(endDate)}`} />
      {(gpsDown || dieselDown) && (
        <div className="mb-4 flex flex-col gap-2">
          {gpsDown && <Alert onRetry={onSyncGps}>{gpsTrouble(gpsStatus, gpsFeed)}</Alert>}
          {dieselDown && (
            <Alert onRetry={onSyncDiesel}>
              ERP diesel could not be loaded{diesel ? ` · showing issues up to ${day(diesel.meta.to)}` : ""}
            </Alert>
          )}
        </div>
      )}

      <DataTable label="Km and diesel by day">
        <thead>
          <tr>
            <th className={thCls}>Day</th>
            <th className={thCls}>Km</th>
            {hired ? <th className={cx(thCls, "text-right")}>Tariff</th> : (
              <>
                <th className={cx(thCls, "text-right")} title="Km ÷ the bus’s mileage × the ERP diesel price that day">Cost by km</th>
                {issued && (
                  <>
                    <th className={cx(thCls, "text-right")}
                      title={`Each issue is shared over the days since the one before, at most ${MAX_SPREAD_DAYS}. After the last fill, the bus’s ERP average stands in.`}>Litres issued</th>
                    <th className={cx(thCls, "text-right")}>Cost by diesel</th>
                    {showKmpl && <th className={cx(thCls, "text-right")} title="Only on days with GPS km and a real issue">km/L</th>}
                  </>
                )}
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {days.map(({ d, day: k, cost, kmpl, vsKm }) => {
            const byKm = cost.byKm, z = cost.byDiesel;
            return (
              <tr key={d} className={trCls}>
                <td className={cx(tdCls, "whitespace-nowrap !align-top font-medium text-ink-2")}>{day(d)}</td>
                <td className={cx(tdCls, "!align-top tabular-nums")}><KmCell d={k} /></td>
                <td className={num}>
                  <span className={cx("font-semibold", byKm ? "text-ink" : "text-ink-4")}>{byKm ? money(byKm.amount) : DASH}</span>
                  {!hired && byKm && <Sub>{kms(byKm.litres)} L at {kms(byKm.kmpl)} km/L{byKm.kmplFromErp ? "" : " · usual mileage"}</Sub>}
                </td>
                {issued && (
                  <>
                    <td className={num}><IssuedCell z={z} /></td>
                    <td className={num}>
                      <span className={cx("font-semibold", z ? "text-ink" : "text-ink-4")}>{z ? `${z.source === "estimate" ? "≈" : ""}${money(z.amount)}` : DASH}</span>
                      {vsKm && <Sub>{k.inProgress ? "km still growing" : `${vsKm.up ? "+" : MINUS}${percent(vsKm.pct)} vs by km`}</Sub>}
                    </td>
                    {showKmpl && <td className={cx(num, "font-semibold", kmpl != null ? "text-ink" : "text-ink-4")}>{kmpl != null ? kms(kmpl) : DASH}</td>}
                  </>
                )}
              </tr>
            );
          })}
        </tbody>
      </DataTable>
      {anyViolet && <VioletKey className="mt-3">From the plan or the ERP average, not measured</VioletKey>}

      <Tiles className={cx("mt-5", hired ? "grid-cols-2 sm:grid-cols-3" : issued ? "grid-cols-2 sm:grid-cols-4 xl:grid-cols-6" : "grid-cols-2 sm:grid-cols-4")}>
        <Tile label="Km in 14 days" value={<>{kms(sum.km)}<Small>km</Small></>} />
        <Tile label="Days with GPS" note={sum.plan ? `${sum.plan} from plan` : null} value={<>{sum.gps}<Small>of 14</Small></>} />
        {hired ? <Tile className="col-span-2 sm:col-span-1" label="Tariff in 14 days" value={money(sum.byKm)} /> : issued ? (
          <>
            <Tile label="Litres issued" value={<>{kms(sum.litres)}<Small>L</Small></>} />
            <Tile label="Actual km/L" note={sum.both ? plural(sum.both, "day", "days") : null}
              title={sum.both ? "Days with GPS km and a real issue" : "Shows once a day with GPS km is covered by a real issue"}
              value={sum.kmpl != null ? <>{kms(sum.kmpl)}<Small>km/L</Small></> : <TileMissing>Not measured yet</TileMissing>} />
            <MoneyTile className="col-span-2 sm:col-span-4 xl:col-span-2" label="Diesel in 14 days" km={sum.byKm} diesel={sum.byDiesel} />
          </>
        ) : <MoneyTile className="col-span-2" label="Diesel in 14 days" km={sum.byKm} diesel={null} />}
      </Tiles>
    </Card>
  );
}
