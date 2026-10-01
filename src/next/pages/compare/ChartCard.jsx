/* One of the two Compare charts: its own figure, grouping and dates; a line per company or per
   picked bus; the latest value printed at each line's end; and the key figures of what it shows.
   The chart grows to fill its card, so it lines up with the chart beside it. */
import React, { useMemo, useState } from "react";
import { CartesianGrid, Customized, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CalendarRange, ChartLine, ListChecks } from "lucide-react";
import { GROUP_BYS, datesInRange, effWorkingDays, varMapOf } from "../../../Dashboard.jsx";
import { Button, Card, CardTitle, Choice, Empty, Field, Input, Select, Tiles, Unit, cx } from "../../ui.jsx";
import { DASH, count, day, dayRange, plural } from "../../format.js";
import { GRID, X_AXIS, Y_AXIS } from "../../chart.js";
import BusPicker, { BusPickerBody } from "./BusPicker.jsx";
import { KeyTile, LineEnds, Num, Swatch, Tip } from "./parts.jsx";
import {
  chartRows, formatOf, keyFigures, linePairs, metricOptions, missingOf, moneyPair, namedEnds, pickOption, rangeFigures, seriesOf, valueReader,
} from "./series.js";

const LINE_PER = { company: "Company", bus: "Bus" };
const eyebrow = "text-[11px] font-bold uppercase tracking-[0.08em] text-ink-3";

/** A value with its unit as a smaller grey word; "—" when there is none. */
function Figure({ value, fmt, kind }) {
  if (value == null) return <span className="text-ink-4">{DASH}</span>;
  return <><Num value={value} format={fmt.value} kind={kind} />{fmt.unit && <Unit className="!text-[13px]">{fmt.unit}</Unit>}</>;
}

/** A line's name with its colour, for the rows and tiles under the chart. */
const LineName = ({ s }) => (
  <span className="flex min-w-0 items-center gap-2" title={s.bus ? [s.bus.unit, s.bus.route].filter(Boolean).join(" · ") : undefined}>
    <Swatch color={s.color} />
    <span className={cx("truncate text-[13px] text-ink-2", s.mono && "font-code")}>{s.label}</span>
  </span>
);

export default function ChartCard({ title, cfg, onCfg, data, allDates }) {
  const { buses, records, employees, attendance, settings, formulas, variables } = data;
  const [changing, setChanging] = useState(false);
  const [q, setQ] = useState("");

  const options = useMemo(() => metricOptions(formulas), [formulas]);
  const option = pickOption(options, cfg.metric);
  const pair = useMemo(() => moneyPair(options, option), [options, option]);
  const fmt = formatOf(option);
  const wd = effWorkingDays(settings);
  const vmap = useMemo(() => varMapOf(variables), [variables]);

  const series = useMemo(() => seriesOf(cfg.group, cfg.buses, buses), [cfg.group, cfg.buses, buses]);
  const dates = useMemo(() => datesInRange(records, attendance, cfg.from, cfg.to), [records, attendance, cfg.from, cfg.to]);
  const pairs = useMemo(() => linePairs({ dates, series, buses, records, employees, attendance }),
    [dates, series, buses, records, employees, attendance]);
  const rows = useMemo(() => chartRows(dates, series, pairs, valueReader(option, wd, vmap)), [dates, series, pairs, option, wd, vmap]);
  const key = useMemo(() => keyFigures(rows, series), [rows, series]);
  // each line over the whole range; a money metric both ways
  const range = useMemo(() => (pair
    ? { km: rangeFigures(pairs, valueReader(pair.km, wd, vmap)), diesel: rangeFigures(pairs, valueReader(pair.diesel, wd, vmap)) }
    : { shown: rangeFigures(pairs, valueReader(option, wd, vmap)) }), [pairs, pair, option, wd, vmap]);

  const hasData = series.length > 0 && key.days.length > 0;
  const needPick = cfg.group === "bus" && cfg.buses.length === 0;
  const ranged = !!(cfg.from || cfg.to);
  const allDatesBtn = <Button variant="ghost" size="sm" icon={CalendarRange} onClick={() => onCfg({ from: "", to: "" })}>All dates</Button>;
  const set = (k) => (e) => onCfg({ [k]: e.target.value });
  const first = allDates[0], last = allDates[allDates.length - 1];
  const named = namedEnds(series);

  return (
    <Card className="flex min-w-0 flex-1 flex-col">
      <CardTitle title={title} right={(
        <>
          {ranged && hasData && allDatesBtn}
          {cfg.group === "bus" && !needPick && (
            <Button variant="secondary" size="sm" icon={ListChecks} onClick={() => setChanging(true)}>Change buses</Button>
          )}
          <span className="hidden text-[13px] text-ink-3 sm:inline">One line per</span>
          <Choice label="One line per" value={cfg.group} onChange={(v) => onCfg({ group: v })}
            options={GROUP_BYS.map(([k]) => [k, LINE_PER[k]])} />
        </>
      )} />

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-[minmax(0,1fr)_168px_168px]">
        <Field label="Metric" className="col-span-2 xl:col-span-1">
          <Select value={option.value} onChange={set("metric")}>
            <optgroup label="Standard">
              {options.standard.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </optgroup>
            {options.custom.length > 0 && (
              <optgroup label="Custom metrics">
                {options.custom.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </optgroup>
            )}
          </Select>
        </Field>
        <Field label="From">
          <Input type="date" className="font-code" value={cfg.from} min={first} max={cfg.to || last} onChange={set("from")} />
        </Field>
        <Field label="To">
          <Input type="date" className="font-code" value={cfg.to} min={cfg.from || first} max={last} onChange={set("to")} />
        </Field>
      </div>

      <div className="relative mt-5 min-h-[320px] flex-1 sm:min-h-[360px]">
        {needPick ? (
          // before the first pick, the chart's place holds the picker itself
          <div className="absolute inset-0 overflow-y-auto rounded-tile bg-satin p-4">
            <p className="mb-3 text-[13px] text-ink-3">Pick one or more buses, from any company.</p>
            <BusPickerBody chart={title} buses={buses} picked={cfg.buses} onChange={(ids) => onCfg({ buses: ids })} q={q} onQ={setQ} onSatin />
          </div>
        ) : !hasData ? (
          <div className="absolute inset-0 flex items-center justify-center rounded-tile bg-satin/50">
            <Empty icon={ChartLine} title="No data for this selection" className="py-6"
              hint={ranged ? `Nothing recorded between these dates. Data runs ${dayRange(first, last)}.` : missingOf(option)}
              action={ranged ? allDatesBtn : null} />
          </div>
        ) : (
          <div className="absolute inset-0" role="img"
            aria-label={`${option.label}, ${plural(series.length, "line", "lines")}, ${dayRange(key.days[0], key.days[key.days.length - 1])}`}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={rows} margin={{ top: 12, right: named ? 148 : 64, left: 0, bottom: 0 }}>
                <CartesianGrid {...GRID} />
                <XAxis dataKey="date" {...X_AXIS} tickFormatter={day} interval="preserveStartEnd" minTickGap={24} padding={{ left: 8, right: 8 }} />
                <YAxis {...Y_AXIS} tickFormatter={fmt.short} />
                <Tooltip content={<Tip format={fmt.exact} unit={fmt.unit} series={series} />} isAnimationActive={false}
                  cursor={{ stroke: "#9aa0ab", strokeDasharray: "4 4" }} wrapperStyle={{ outline: "none", zIndex: 5 }} />
                {series.map((s) => (
                  <Line key={s.id} type="monotone" dataKey={s.dataKey} name={s.label} stroke={s.color} strokeWidth={2.5}
                    dot={{ r: 2.5, fill: s.color, strokeWidth: 0 }} activeDot={{ r: 5, stroke: "#ffffff", strokeWidth: 2 }}
                    connectNulls isAnimationActive={false} />
                ))}
                <Customized component={<LineEnds format={fmt.short} named={named} />} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {hasData && (
        <>
          {pair ? (
            <dl className="mt-4 grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-6 gap-y-1.5">
              <dt className={eyebrow}>Over these dates</dt>
              <dt className={cx(eyebrow, "text-right")}>By km</dt>
              <dt className={cx(eyebrow, "text-right")}>By diesel</dt>
              {series.map((s, i) => (
                <React.Fragment key={s.id}>
                  <dt className="min-w-0"><LineName s={s} /></dt>
                  <dd className="text-right text-[15px] font-bold text-ink"><Figure value={range.km[i]} fmt={fmt} kind={pair.km.value} /></dd>
                  <dd className="text-right text-[15px] font-bold text-ink"><Figure value={range.diesel[i]} fmt={fmt} kind={pair.diesel.value} /></dd>
                </React.Fragment>
              ))}
            </dl>
          ) : (
            <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-1.5 sm:grid-cols-3">
              <dt className={cx(eyebrow, "col-span-full")}>Over these dates</dt>
              {series.map((s, i) => (
                <div key={s.id} className="flex min-w-0 items-center gap-2">
                  <dt className="min-w-0"><LineName s={s} /></dt>
                  <dd className="ml-auto text-[15px] font-bold text-ink"><Figure value={range.shown[i]} fmt={fmt} kind={option.value} /></dd>
                </div>
              ))}
            </dl>
          )}
          <Tiles className="mt-4 grid-cols-2 sm:grid-cols-3">
            <KeyTile label="Highest day" value={<Figure value={key.hi.v} fmt={fmt} kind={option.value} />}>
              <LineName s={key.hi.s} /><span className="whitespace-nowrap">on {day(key.hi.date)}</span>
            </KeyTile>
            <KeyTile label="Lowest day" value={<Figure value={key.lo.v} fmt={fmt} kind={option.value} />}>
              <LineName s={key.lo.s} /><span className="whitespace-nowrap">on {day(key.lo.date)}</span>
            </KeyTile>
            <KeyTile label="Days with data" className="col-span-2 sm:col-span-1" value={<Num value={key.days.length} format={count} kind="days" />}>
              {dayRange(key.days[0], key.days[key.days.length - 1])}
            </KeyTile>
          </Tiles>
        </>
      )}

      <BusPicker open={changing} onClose={() => setChanging(false)} chart={title} buses={buses} picked={cfg.buses}
        onChange={(ids) => onCfg({ buses: ids })} />
    </Card>
  );
}
