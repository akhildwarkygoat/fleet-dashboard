/* By bus: which buses are furthest from plan across the window, not which was late once. The
   chart shows the dozen furthest from their gate time with a pickup timed, one bar each in its
   service's colour, the value printed at the bar's end. The table under it lists every bus, with a
   search, and in Overall one collapsible group per service. */
import React, { useMemo } from "react";
import { Bar, BarChart, Cell, LabelList, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Bus, SearchX } from "lucide-react";
import { Button, Card, CardTitle, DataTable, Search, Tag, cx, tdCls, thCls } from "../../../ui.jsx";
import { DASH, count, day, dayRange, percent, plural, squash } from "../../../format.js";
import { useKept } from "../../bus/parts.jsx";
import { Dot, FlatEmpty, GroupRow, TipCard, TipRow, lateTag, signedMin, useGroups } from "./parts.jsx";

const TOP = 12;
const ROW_H = 32;
const COLS = 8;
const MONO_TICK = { fontSize: 12, fill: "#3a3f4b", fontFamily: '"Geist Mono Variable", ui-monospace, monospace', fontWeight: 600 };
const gateOf = (b) => b.pickup.medianEnd;
/* byVehicle's own order (trackImpl.js), applied across services. The hook's Overall sort compares a
   field summarise() does not return, so it leaves the services one after another. */
const furthest = (a, b) => Math.abs(gateOf(b) ?? 0) - Math.abs(gateOf(a) ?? 0) || b.recorded - a.recorded;
// room beyond the longest bar for its printed value
const padded = (side) => (v) => (side < 0 ? Math.min(0, v) * 1.3 : Math.max(0, v) * 1.3);

/** The value at the end of a bar: right of a late bar, left of an early one. */
function BarValue({ x, y, width, height, value }) {
  if (value == null) return null;
  const right = Math.max(x, x + width), left = Math.min(x, x + width);
  const late = value >= 0;
  return (
    <text x={late ? right + 6 : left - 6} y={y + height / 2} dy="0.35em" textAnchor={late ? "start" : "end"}
      fill="#0b0d12" fontSize={12} fontWeight={700} style={{ fontVariantNumeric: "tabular-nums" }}>
      {signedMin(value)}
    </text>
  );
}

function Tip({ active, payload }) {
  if (!active || !payload || !payload.length) return null;
  const b = payload[0].payload;
  return (
    <TipCard title={<span className="font-code text-ink">{b.veh}</span>}>
      <TipRow swatch={<Dot color={b.svc.color} />} label={b.svc.name} value={null} />
      <TipRow label="To the gate" value={signedMin(b.pickup.medianEnd)} extra={`typical of ${count(b.pickup.n)}`} />
      <TipRow label="Home run" value={signedMin(b.drop.medianEnd)} extra={b.drop.n ? `typical of ${count(b.drop.n)}` : null} />
      <TipRow label="Pickups on time" value={b.pickup.onTimePct == null ? DASH : percent(b.pickup.onTimePct)} />
      <TipRow label="Days recorded" value={count(b.days)} />
    </TipCard>
  );
}

function BusRow({ b, zebra }) {
  return (
    <tr className={cx(zebra && "bg-satin/70")}>
      <td className={cx(tdCls, "whitespace-nowrap font-code font-semibold")}>{b.veh}</td>
      <td className={cx(tdCls, "whitespace-nowrap")}>
        <span className="inline-flex items-center gap-2 text-ink-2"><Dot color={b.svc.color} />{b.svc.name}</span>
      </td>
      <td className={cx(tdCls, "text-right tabular-nums")}>{count(b.days)}</td>
      <td className={cx(tdCls, "whitespace-nowrap text-right tabular-nums")}>
        {count(b.pickup.n + b.drop.n)}
        {b.bulk ? <span className="ml-1.5 text-[13px] text-ink-3">· {count(b.bulk)} ran to plan</span> : null}
      </td>
      <td className={cx(tdCls, "whitespace-nowrap")}>
        {gateOf(b) == null ? <span className="text-ink-4">{DASH}</span>
          : <Tag tone={lateTag(gateOf(b))} className="!px-2.5 !py-0.5">{signedMin(gateOf(b))}</Tag>}
      </td>
      <td className={cx(tdCls, "whitespace-nowrap tabular-nums text-ink-2")}>
        {b.drop.medianEnd == null ? <span className="text-ink-4">{DASH}</span> : signedMin(b.drop.medianEnd)}
      </td>
      <td className={cx(tdCls, "text-right tabular-nums text-ink-2")}>
        {b.pickup.onTimePct == null ? <span className="text-ink-4">{DASH}</span> : percent(b.pickup.onTimePct)}
      </td>
      <td className={cx(tdCls, "whitespace-nowrap tabular-nums text-ink-2")}>
        {b.pickup.worst ? signedMin(b.pickup.worst.min) : <span className="text-ink-4">{DASH}</span>}
      </td>
    </tr>
  );
}

export default function BusesCard({ perBus, dates, multi, windowPicker, onToday }) {
  const from = dates[0], to = dates[dates.length - 1];
  const [q, setQ] = useKept("ti:busq", "");
  const sq = squash(q);
  const { isOpen, toggle } = useGroups("ti:busopen", multi, sq);
  const top = useMemo(() => perBus.filter((b) => gateOf(b) != null).sort(furthest).slice(0, TOP), [perBus]);
  const svcs = [...new Map(top.map((b) => [b.svc.id, b.svc])).values()];
  const shown = useMemo(() => (sq ? perBus.filter((b) => squash(b.veh).includes(sq) || squash(b.svc.name).includes(sq)) : perBus), [perBus, sq]);
  // one group per service in Overall; each keeps byVehicle's order, furthest from the gate time first
  const groups = useMemo(() => {
    if (!multi) return [{ svc: null, list: shown }];
    const m = new Map();
    for (const b of shown) {
      if (!m.has(b.svc.id)) m.set(b.svc.id, { svc: b.svc, list: [] });
      m.get(b.svc.id).list.push(b);
    }
    return [...m.values()];
  }, [shown, multi]);
  const anyOpen = groups.some((g) => !g.svc || isOpen(g.svc.id));

  return (
    <Card>
      <CardTitle title="Buses furthest from plan" right={windowPicker}
        sub={<span title="Across the whole window, not one day. Sorted by how far a bus typically is from its planned gate time: the ones at the top are where either the driver or the estimate needs attention.">
          {dayRange(from, to)} · furthest from the gate time first</span>} />
      {!perBus.length ? (
        <FlatEmpty icon={Bus} className="rounded-tile bg-satin px-5 py-4" title={`Nothing recorded from ${day(from)} to ${day(to)}`}
          hint="Enter a day on This day first." action={<Button variant="secondary" onClick={onToday}>Open This day</Button>} />
      ) : (
        <>
          {top.length > 0 && (
            <>
              <div className="mb-1 flex flex-wrap items-center gap-x-5 gap-y-1 text-[13px] text-ink-2">
                <span className="font-semibold text-ink">Typical lateness to the gate</span>
                {svcs.length > 1 && svcs.map((s) => <span key={s.id} className="inline-flex items-center gap-2"><Dot color={s.color} />{s.name}</span>)}
              </div>
              <div role="img" style={{ height: top.length * ROW_H + 8 }}
                aria-label={`Typical lateness to the gate for the ${top.length} buses furthest from plan`}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={top} layout="vertical" margin={{ top: 4, right: 8, left: 0, bottom: 4 }} barCategoryGap={7}>
                    <XAxis type="number" hide domain={[padded(-1), padded(1)]} />
                    <YAxis type="category" dataKey="veh" width={118} tick={MONO_TICK} tickLine={false} axisLine={false} interval={0} />
                    <Tooltip content={<Tip />} isAnimationActive={false} cursor={{ fill: "rgba(11,13,18,.04)" }} wrapperStyle={{ outline: "none", zIndex: 5 }} />
                    <ReferenceLine x={0} stroke="#c3c8d2" />
                    <Bar dataKey={gateOf} radius={6} maxBarSize={18} isAnimationActive={false}>
                      {top.map((b) => <Cell key={b.svc.id + b.veh} fill={b.svc.color} />)}
                      <LabelList dataKey={gateOf} content={<BarValue />} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </>
          )}

          <div className={cx("flex flex-wrap items-center gap-x-4 gap-y-2", top.length > 0 && "mt-5")}>
            <Search value={q} onChange={setQ} label="Search bus or service" placeholder="Bus or service" className="w-full sm:w-[300px]" />
            <span className="text-[13px] tabular-nums text-ink-3">{plural(shown.length, "bus", "buses")}{sq ? ` of ${count(perBus.length)}` : ""}</span>
          </div>
          {shown.length ? (
            <DataTable label="Buses in the window" className="mt-3">
              {anyOpen && (
                <thead>
                  <tr>
                    <th className={thCls}>Bus</th>
                    <th className={thCls}>Service</th>
                    <th className={cx(thCls, "text-right")}>Days</th>
                    <th className={cx(thCls, "text-right")}>Timed</th>
                    <th className={thCls}>To the gate</th>
                    <th className={thCls}>Home run</th>
                    <th className={cx(thCls, "text-right")}>On time</th>
                    <th className={thCls}>Worst</th>
                  </tr>
                </thead>
              )}
              {groups.map((g) => {
                const lead = g.svc && g.list.find((b) => gateOf(b) != null);
                return (
                  <tbody key={g.svc ? g.svc.id : "all"}>
                    {g.svc && (
                      <GroupRow cols={COLS} svc={g.svc} open={isOpen(g.svc.id)} onToggle={() => toggle(g.svc.id)}
                        summary={plural(g.list.length, "bus", "buses")}
                        right={lead && (
                          <span className="inline-flex items-center gap-2 text-[13px] text-ink-3">
                            Furthest <span className="font-code font-semibold text-ink">{lead.veh}</span>
                            <Tag tone={lateTag(gateOf(lead))} className="!px-2.5 !py-0.5">{signedMin(gateOf(lead))}</Tag>
                          </span>
                        )} />
                    )}
                    {(!g.svc || isOpen(g.svc.id)) && g.list.map((b, i) => <BusRow key={b.svc.id + b.veh} b={b} zebra={i % 2 === 1} />)}
                  </tbody>
                );
              })}
            </DataTable>
          ) : (
            <FlatEmpty icon={SearchX} className="mt-3 rounded-tile bg-satin px-5 py-4" title={`No bus matches “${q.trim()}”`}
              action={<Button variant="secondary" onClick={() => setQ("")}>Clear search</Button>} />
          )}
        </>
      )}
    </Card>
  );
}
