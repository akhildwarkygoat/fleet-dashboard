/* Over time: is the plan drifting, or was yesterday just yesterday. One point per service day for
   the pickups' and the drops' typical (median) lateness, and a grey bar for how much of each day was written
   down (a day with low coverage is not evidence). The latest value is printed at each line's end;
   hover adds the day's detail. Under it, the same days as a table, newest first. Every figure is
   the old board's series (useTrackImpl). */
import React from "react";
import { Bar, CartesianGrid, Cell, ComposedChart, LabelList, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartLine } from "lucide-react";
import { LOW_COVERAGE, TABLE_ROWS } from "../../../../optimiser/TrackImplView.jsx";
import { Button, Card, CardTitle, DataTable, Tag, cx, tdCls, thCls, trCls } from "../../../ui.jsx";
import { DASH, count, day, dayRange, percent } from "../../../format.js";
import { GRID, SERIES, X_AXIS, Y_AXIS } from "../../../chart.js";
import { FlatEmpty, Swatch, TipCard, TipRow, dayTone, rideVsPlan, signedMin, signedNum } from "./parts.jsx";

// not SERIES[0] and [1]: those are Gainup's and Technotek's colours everywhere else
const GATE = SERIES[5], HOME = SERIES[4];
const COVER = "#d9dde5", COVER_SUNDAY = "#eceef3";
const lastIndex = (rows, key) => { for (let i = rows.length - 1; i >= 0; i--) if (rows[i][key] != null) return i; return -1; };

/** The latest value of a line, printed beside its last point (above for the gate, below for home). */
function EndLabel({ x, y, value, index, last, color, below }) {
  if (index !== last || value == null) return null;
  return (
    <text x={x - 6} y={y + (below ? 16 : -10)} textAnchor="end" fill={color} fontSize={11} fontWeight={700}
      stroke="#ffffff" strokeWidth={3} strokeLinejoin="round" paintOrder="stroke" style={{ fontVariantNumeric: "tabular-nums" }}>
      {signedNum(value)} min
    </text>
  );
}

function Tip({ active, payload }) {
  if (!active || !payload || !payload.length) return null;
  const d = payload[0].payload;
  return (
    <TipCard title={day(d.date) + (d.sunday ? " · Sunday" : "")}>
      <TipRow label="Recorded" value={`${count(d.recorded)} of ${count(d.expected)}`} extra={d.coverage != null ? percent(d.coverage) : null}
        swatch={<span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: COVER }} />} />
      <TipRow swatch={<Swatch color={GATE} />} label="To the gate" value={signedMin(d.pickup.medianEnd)} extra={d.pickup.n ? `${count(d.pickup.n)} timed` : null} />
      <TipRow swatch={<Swatch color={HOME} dashed />} label="Home run" value={signedMin(d.drop.medianEnd)} extra={d.drop.n ? `${count(d.drop.n)} timed` : null} />
      {d.bulk ? <p className="pt-1 text-ink-3">{count(d.bulk)} ran to plan, not timed</p> : null}
      {d.unmeasurable ? <p className="pt-1 text-warn-ink">{count(d.unmeasurable)} on an assumed release time</p> : null}
    </TipCard>
  );
}

const notesOf = (s) => [s.bulk ? `${count(s.bulk)} ran to plan` : "", s.notRun ? `${count(s.notRun)} did not run` : "",
  s.unmeasurable ? `${count(s.unmeasurable)} assumed release` : "", s.noPlan ? `${count(s.noPlan)} with no plan` : ""].filter(Boolean).join(" · ");

export default function TrendCard({ series, win, windowPicker, onToday }) {
  const from = series[0] && series[0].date, to = series[series.length - 1] && series[series.length - 1].date;
  const empty = series.every((s) => !s.recorded);
  const dots = +win <= 30;
  const lastGate = lastIndex(series, "pickupMedian"), lastHome = lastIndex(series, "dropMedian");
  const newest = [...series].reverse().slice(0, TABLE_ROWS);

  return (
    <Card>
      <CardTitle title="Lateness over time" right={windowPicker}
        sub={<span title="One point per service day. A single bad day is weather; a line that sits above zero for a fortnight is an estimate that needs re-cutting. Bars show how much of each day was actually written down: a day with low coverage is not evidence.">
          {dayRange(from, to)} · one point a day</span>} />
      {empty ? (
        <FlatEmpty icon={ChartLine} className="rounded-tile bg-satin px-5 py-4" title={`Nothing recorded from ${day(from)} to ${day(to)}`}
          hint="Enter a day or two on This day and the trend builds itself."
          action={<Button variant="secondary" onClick={onToday}>Open This day</Button>} />
      ) : (
        <>
          <div className="mb-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-[13px] text-ink-2">
            <span className="inline-flex items-center gap-2"><Swatch color={GATE} />To the gate</span>
            <span className="inline-flex items-center gap-2"><Swatch color={HOME} dashed />Home run</span>
            <span className="inline-flex items-center gap-2"><span aria-hidden className="h-2.5 w-2.5 rounded-[3px]" style={{ background: COVER }} />Recorded (%)</span>
          </div>
          <div className="h-[260px] sm:h-[320px]" role="img"
            aria-label={`Typical lateness to the gate and on the home run, ${dayRange(from, to)}`}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={series} margin={{ top: 18, right: 0, left: 0, bottom: 0 }}>
                <CartesianGrid {...GRID} />
                {/* 180 days cannot each carry a label: keep the ends and leave a gap between ticks */}
                <XAxis dataKey="date" {...X_AXIS} tickFormatter={day} interval="preserveStartEnd" minTickGap={28} />
                <YAxis yAxisId="min" {...Y_AXIS} width={60} tickFormatter={(v) => `${signedNum(v)} min`} />
                <YAxis yAxisId="cov" orientation="right" {...Y_AXIS} width={44} domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
                <Tooltip content={<Tip />} isAnimationActive={false} cursor={{ fill: "rgba(11,13,18,.04)" }} wrapperStyle={{ outline: "none", zIndex: 5 }} />
                <ReferenceLine yAxisId="min" y={0} stroke="#c3c8d2" />
                <Bar yAxisId="cov" dataKey="coverage" name="Recorded" maxBarSize={18} radius={[6, 6, 0, 0]} isAnimationActive={false}>
                  {series.map((s) => <Cell key={s.date} fill={s.sunday ? COVER_SUNDAY : COVER} />)}
                </Bar>
                <Line yAxisId="min" type="monotone" dataKey="pickupMedian" name="To the gate" stroke={GATE} strokeWidth={2.5}
                  dot={dots ? { r: 3, fill: GATE, strokeWidth: 0 } : false} activeDot={{ r: 5, stroke: "#ffffff", strokeWidth: 2 }}
                  connectNulls={false} isAnimationActive={false}>
                  <LabelList dataKey="pickupMedian" content={<EndLabel last={lastGate} color={GATE} />} />
                </Line>
                <Line yAxisId="min" type="monotone" dataKey="dropMedian" name="Home run" stroke={HOME} strokeWidth={1.75} strokeDasharray="5 4"
                  dot={dots ? { r: 2.5, fill: HOME, strokeWidth: 0 } : false} activeDot={{ r: 4, stroke: "#ffffff", strokeWidth: 2 }}
                  connectNulls={false} isAnimationActive={false}>
                  <LabelList dataKey="dropMedian" content={<EndLabel last={lastHome} color={HOME} below />} />
                </Line>
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          <div className="mt-5">
            <DataTable label="Days in the window">
              <thead>
                <tr>
                  <th className={thCls}>Day</th>
                  <th className={thCls}>Recorded</th>
                  <th className={thCls}>To the gate</th>
                  <th className={thCls}>Home run</th>
                  <th className={cx(thCls, "text-right")}>Pickups on time</th>
                  <th className={thCls}>Took vs plan</th>
                  <th className={thCls}>Notes</th>
                </tr>
              </thead>
              <tbody>
                {newest.map((s) => (
                  <tr key={s.date} className={cx(trCls, !s.recorded && "[&>td]:opacity-50")}>
                    <td className={cx(tdCls, "whitespace-nowrap")}>
                      {day(s.date)}{s.sunday && <span className="ml-1.5 text-[13px] text-ink-3">Sun</span>}
                    </td>
                    <td className={cx(tdCls, "whitespace-nowrap tabular-nums text-ink-2")}>
                      {count(s.recorded)} / {count(s.expected)}
                      {s.coverage != null && <span className={cx("ml-1.5 text-[13px]", s.coverage < LOW_COVERAGE ? "text-warn-ink" : "text-ink-3")}>{percent(s.coverage)}</span>}
                    </td>
                    <td className={cx(tdCls, "whitespace-nowrap tabular-nums")}>
                      {s.pickup.medianEnd == null ? <span className="text-ink-4">{DASH}</span>
                        : <Tag tone={dayTone(s.pickup.medianEnd)} className="!px-2.5 !py-0.5">{signedMin(s.pickup.medianEnd)}</Tag>}
                      {s.pickup.n ? <span className="ml-1.5 text-[13px] text-ink-3">of {count(s.pickup.n)}</span> : null}
                    </td>
                    <td className={cx(tdCls, "whitespace-nowrap tabular-nums text-ink-2")}>
                      {s.drop.medianEnd == null ? <span className="text-ink-4">{DASH}</span> : signedMin(s.drop.medianEnd)}
                      {s.drop.n ? <span className="ml-1.5 text-[13px] text-ink-3">of {count(s.drop.n)}</span> : null}
                    </td>
                    <td className={cx(tdCls, "text-right tabular-nums text-ink-2")}>{s.pickup.onTimePct == null ? <span className="text-ink-4">{DASH}</span> : percent(s.pickup.onTimePct)}</td>
                    <td className={cx(tdCls, "whitespace-nowrap tabular-nums text-ink-2")}>{s.medianRide == null ? <span className="text-ink-4">{DASH}</span> : rideVsPlan(s.medianRide)}</td>
                    <td className={cx(tdCls, "text-ink-3")}>{notesOf(s) || <span className="text-ink-4">{DASH}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          </div>
          {series.length > TABLE_ROWS && (
            <p className="mt-2 px-1 text-[13px] text-ink-3">The most recent {TABLE_ROWS} of {count(series.length)} days. The chart covers the whole window.</p>
          )}
        </>
      )}
    </Card>
  );
}
