/* Small pieces of a Compare chart that the kit does not have. */
import React, { useLayoutEffect, useRef } from "react";
import { cx } from "../../ui.jsx";
import { day } from "../../format.js";
import { motion } from "../../motion.js";

/** A number that counts to its new value when it changes. A different figure (`kind`) is written
 *  at once: counting from rupees to a percent would mean nothing. */
export function Num({ value, format, kind, className }) {
  const el = useRef(null), last = useRef(null), tween = useRef(null), fmt = useRef(format);
  fmt.current = format;
  useLayoutEffect(() => {
    if (tween.current) tween.current.kill();
    const from = last.current;
    last.current = { value, kind };
    if (!from || from.kind !== kind || from.value === value) { el.current.textContent = fmt.current(value); return; }
    tween.current = motion.countUp(el.current, from.value, value, (n) => fmt.current(n));
  }, [value, kind]);
  useLayoutEffect(() => () => tween.current && tween.current.kill(), []);
  return <span ref={el} className={cx("tabular-nums", className)} />;
}

/** A short stroke in a line's colour, standing in for the line in a key. */
export const Swatch = ({ color, className }) => (
  <span aria-hidden className={cx("inline-block h-[3px] w-4 shrink-0 rounded-pill", className)} style={{ background: color }} />
);

/** A key figure under a chart: the value, its grey label, and a line saying where it comes from,
 *  which wraps rather than cuts off. */
export function KeyTile({ label, value, className, children }) {
  return (
    <div className={cx("flex min-w-0 flex-col rounded-tile bg-satin px-4 py-3", className)}>
      <dd className="order-1 font-bold tabular-nums tracking-[-0.01em] text-[22px] leading-7 text-ink">{value}</dd>
      <dt className="order-2 mt-0.5 text-[11px] font-semibold text-ink-3">{label}</dt>
      <dd className="order-3 mt-1 flex min-w-0 flex-wrap items-center gap-x-1.5 text-[13px] text-ink-2">{children}</dd>
    </div>
  );
}

/* Labels at the ends of the lines, so the latest value of every line reads without hovering.
   Rendered through recharts' Customized, which hands over the drawn points. Labels that end at
   about the same place are spread apart so none sits on another. With `named`, each label starts
   with its line's name, for when colours alone no longer tell the lines apart. */
const GAP = 14;
export function LineEnds({ formattedGraphicalItems, offset, format, named }) {
  const ends = formattedGraphicalItems.map((g) => {
    const pts = g.props.points.filter((p) => p.y != null && p.value != null);
    const p = pts[pts.length - 1];
    return p ? { key: g.item.props.dataKey, name: g.item.props.name, x: p.x, y: p.y, value: p.value, color: g.item.props.stroke } : null;
  }).filter(Boolean).sort((a, b) => a.x - b.x);

  const columns = [];
  ends.forEach((e) => {
    const col = columns[columns.length - 1];
    if (col && e.x - col[0].x < 48) col.push(e); else columns.push([e]);
  });
  const top = offset.top, bottom = offset.top + offset.height;
  columns.forEach((col) => {
    col.sort((a, b) => a.y - b.y);
    for (let i = 1; i < col.length; i++) col[i].y = Math.max(col[i].y, col[i - 1].y + GAP);
    const over = col[col.length - 1].y - bottom;
    if (over > 0) col.forEach((e) => { e.y = Math.max(top, e.y - over); });
  });

  return (
    <g>
      {ends.map((e) => (
        <text key={e.key} x={e.x + 8} y={e.y} dy="0.35em" fill={e.color} fontSize={11} fontWeight={700}
          stroke="#ffffff" strokeWidth={3} strokeLinejoin="round" paintOrder="stroke" style={{ fontVariantNumeric: "tabular-nums" }}>
          {named && <tspan className="font-code">{e.name} </tspan>}{format(e.value)}
        </text>
      ))}
    </g>
  );
}

/** Hover: the day and the exact figure of every line on it, highest first. */
export function Tip({ active, payload, label, format, unit, series }) {
  if (!active || !payload || !payload.length) return null;
  const rows = payload.filter((p) => p.value != null).sort((a, b) => b.value - a.value);
  if (!rows.length) return null;
  const mono = Object.fromEntries(series.map((s) => [s.dataKey, s.mono]));
  return (
    <div className="min-w-[180px] rounded-[16px] bg-white px-3 py-2.5 text-[13px] shadow-float">
      <p className="mb-1.5 font-semibold text-ink-3">{day(label)}</p>
      {rows.map((p) => (
        <p key={p.dataKey} className="flex items-center gap-2 py-0.5">
          <Swatch color={p.color} />
          <span className={cx("min-w-0 truncate text-ink-2", mono[p.dataKey] && "font-code")}>{p.name}</span>
          <b className="ml-auto pl-4 font-bold tabular-nums text-ink">{format(p.value)}{unit && <span className="font-medium text-ink-3"> {unit}</span>}</b>
        </p>
      ))}
    </div>
  );
}
