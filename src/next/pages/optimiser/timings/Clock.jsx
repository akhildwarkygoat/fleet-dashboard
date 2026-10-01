/* The clock: one row per bus, one pill per run, every service on one axis from 04:00 to 06:00 the
   next morning. Rows, runs, drops, layovers and collisions come from the old board's hook
   (useTimings in TimingsView.jsx); this file only draws them.
   Plain scrolling moves through the buses. Scrolling over the times row, ctrl-scrolling or pinching
   stretches the time axis around the pointer (Akhil: "when u zoom in with scroll expand it or
   stretch the timing horizontally"); the old clock stretched on any scroll, but this card scrolls
   its rows. Hovering reads the exact time; hovering a run adds its details. */
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CalendarClock, Maximize2, ParkingSquare, ZoomIn, ZoomOut } from "lucide-react";
import { AX_END, AX_START, pct } from "../../../../optimiser/TimingsView.jsx";
import { ROTATION_SLOTS, SERVICES, fmtClock } from "../../../../optimiser/services.js";
import { Button, Card, Chip, Empty, IconButton, Search, cx } from "../../../ui.jsx";
import { count, duration, kms, money, plural } from "../../../format.js";
import { NT } from "../../../legacyTheme.js";
import { Dot, GhostRows, tint } from "./parts.jsx";

const ROW_H = 40, MID = ROW_H / 2;
const HEAD_H = 60;
const BASE_LANE = 640;                 // narrowest the day gets before the card scrolls sideways
const MIN_Z = 1, MAX_Z = 10;           // the old clock's range
const STEPS = [15, 30, 60, 120, 180, 240];
const SPAN = AX_END - AX_START;
const RAIL = "bg-ink-4";
const OVERNIGHT = "bg-[repeating-linear-gradient(90deg,theme(colors.ink.4)_0_6px,transparent_6px_10px)]";
const CLASH = "bg-[repeating-linear-gradient(135deg,theme(colors.bad.DEFAULT/45%)_0_3px,transparent_3px_7px)]";
const WHEEL_STEP = 0.4;                // most one wheel notch may stretch: e^0.4, about 1.5 times
// a drop timed on an assumed shift end is drawn lighter, hatched with white
const assumedFill = (fill) => `repeating-linear-gradient(135deg, ${fill} 0 4px, rgba(255,255,255,0.9) 4px 8px)`;
const colorOf = (svcId) => (SERVICES.find((s) => s.id === svcId) || {}).color || NT.faint;
const span = (a, b, min = 0.6) => ({ left: pct(a) + "%", width: Math.max(pct(b) - pct(a), min) + "%" });
const times = (a, b) => `${fmtClock(a)}–${fmtClock(b)}`;
const clamp = (z) => Math.min(MAX_Z, Math.max(MIN_Z, z));

/** Text inside a pill, as much as its width allows (`ch`: one mono digit's width at the pill's size). */
const fit = (w, a, b, ch) => (w >= 11 * ch + 20 ? times(a, b) : w >= 5 * ch + 18 ? fmtClock(a) : null);
const PICK_CH = 7.9, DROP_CH = 7.3;    // 13px and 12px mono

/* -------------------------------------------------------------- the rows -- */
function useRows({ shown, layovers, dropsByVeh, laneW, labelW }) {
  return useMemo(() => {
    const tips = new Map();
    const px = (a, b) => ((pct(b) - pct(a)) / 100) * laneW;
    const body = shown.map((row, ri) => {
      const white = ri % 2 === 0;
      const bg = white ? "bg-white" : "bg-satin";
      const ring = white ? "ring-white" : "ring-satin";
      // a collision is a run starting before the one before it ends: both are tinted, the overlap hatched
      const pair = new Set(), overlaps = [];
      row.runs.forEach((r, i) => {
        if (!r.clash) return;
        pair.add(i - 1); pair.add(i);
        overlaps.push([r.start, Math.min(r.end, row.runs[i - 1].end)]);
      });
      const lays = layovers.get(row.veh) || [], drops = dropsByVeh.get(row.veh) || [];
      // a pickup too short for its time prints the start just left of it, when nothing is drawn there
      const ends = [...row.runs.map((r) => r.end), ...drops.map((d) => d.e), ...lays.map((l) => l.e)];
      const roomBefore = (r) => px(Math.max(AX_START, ...ends.filter((e) => e <= r.start)), r.start);
      return (
        <div key={row.veh} className={cx("flex rounded-[14px]", bg)} style={{ height: ROW_H }}>
          <div className={cx("sticky left-0 z-[3] flex shrink-0 items-center gap-1.5 rounded-l-[14px] pl-3 pr-2", bg)} style={{ width: labelW }}>
            {row.clashes > 0 && <AlertTriangle size={14} strokeWidth={2} aria-label="Collision" className="shrink-0 text-bad-ink" />}
            <span className={cx("truncate font-code text-[13px]", row.clashes ? "font-semibold text-bad-ink" : "text-ink")}>{row.veh}</span>
          </div>
          <div className="relative shrink-0" style={{ width: laneW }}>
            {lays.map((l, i) => {
              const id = `l${ri}.${i}`;
              tips.set(id, { kind: "lay", veh: row.veh, l });
              // two caps need about 30px of rail; below that the bare rail says it (as the old clock)
              const caps = px(l.s, l.e) >= 30;
              return (
                <div key={id} data-tip={id} role="img"
                  aria-label={`${row.veh} parked at ${l.park.name} ${times(l.a.end, l.b.start)}, saves ${kms(l.saveKm)} km a day`}
                  className="absolute z-[2]"
                  style={{ top: MID - 8, height: 16, left: `calc(${pct(l.s)}% + 3px)`, width: `calc(${Math.max(pct(l.e) - pct(l.s), 0.5)}% - 6px)` }}>
                  <span className={cx("absolute inset-x-0 top-[7px] h-0.5 rounded-pill", l.kind === "overnight" ? OVERNIGHT : RAIL)} />
                  {caps && !l.clippedStart && <Cap side="left-0">S</Cap>}
                  {caps && !l.clippedEnd && <Cap side="right-0">P</Cap>}
                </div>
              );
            })}
            {drops.map((d, i) => {
              const id = `d${ri}.${i}`;
              tips.set(id, { kind: "drop", veh: row.veh, d });
              const c = tint(colorOf(d.svcId));
              return (
                <div key={id} data-tip={id} role="img" aria-label={`${row.veh} ${d.label} ${times(d.start, d.end)}, ${plural(d.stops, "stop", "stops")}, ${plural(d.riders, "rider", "riders")}`}
                  className={cx("absolute z-[2] flex items-center overflow-hidden whitespace-nowrap rounded-pill px-2 font-code text-[12px] font-semibold ring-2", ring)}
                  style={{ top: MID - 9, height: 18, ...span(d.s, d.e), background: d.assumedOff ? assumedFill(c.drop) : c.drop, color: c.deep }}>
                  {fit(px(d.s, d.e), d.start, d.end, DROP_CH)}
                </div>
              );
            })}
            {row.runs.map((r, i) => {
              const id = `p${ri}.${i}`;
              const clash = pair.has(i);
              tips.set(id, { kind: "pickup", veh: row.veh, r, before: !!r.clash, after: clash && !r.clash });
              const c = tint(r.svc.color);
              const w = px(r.start, r.end);
              const text = fit(clash ? w - 14 : w, r.start, r.end, PICK_CH);
              return (
                <React.Fragment key={id}>
                  <div data-tip={id} role="img"
                    aria-label={`${row.veh} ${r.svc.name} pickup ${times(r.start, r.end)}, ${plural(r.stops, "stop", "stops")}, ${plural(r.riders, "rider", "riders")}${clash ? ", collision" : ""}`}
                    className={cx("absolute z-[2] flex items-center gap-1.5 overflow-hidden whitespace-nowrap rounded-pill px-2 font-code text-[13px] font-semibold ring-2", ring,
                      clash && "bg-bad-soft text-bad-ink")}
                    style={{ top: MID - 13, height: 26, ...span(r.start, r.end), ...(clash ? null : { background: c.pick, color: c.deep }) }}>
                    {clash && w >= 30 && <Dot color={r.svc.color} className="!h-2 !w-2" />}
                    {text}
                  </div>
                  {!text && roomBefore(r) >= 5 * DROP_CH + 12 && (
                    <span aria-hidden className="pointer-events-none absolute z-[2] pr-1.5 font-code text-[12px] font-semibold leading-none text-ink-2"
                      style={{ top: MID - 6, right: `${100 - pct(r.start)}%` }}>{fmtClock(r.start)}</span>
                  )}
                </React.Fragment>
              );
            })}
            {overlaps.map(([a, b], i) => (
              <span key={"x" + i} aria-hidden className={cx("pointer-events-none absolute z-[2] rounded-[8px]", CLASH)}
                style={{ top: MID - 15, height: 30, ...span(a, b, 0.3) }} />
            ))}
          </div>
        </div>
      );
    });
    return { body, tips };
  }, [shown, layovers, dropsByVeh, laneW, labelW]);
}

const Cap = ({ side, children }) => (
  <span aria-hidden className={cx("absolute top-px flex h-3.5 w-3.5 items-center justify-center rounded-pill bg-ink-3 text-[10px] font-bold leading-none text-white", side)}>
    {children}
  </span>
);

/* ----------------------------------------------------------- hover card -- */
function TipCard({ tip, at }) {
  if (tip.kind === "lay") {
    const { l } = tip;
    return (
      <Shell at={at} veh={tip.veh} when={times(l.a.end, l.b.start)} note={l.assumed ? "Depends on an assumed shift end time" : null}
        head={<><ParkingSquare size={15} strokeWidth={2} aria-hidden className="text-ink-3" />{l.kind === "overnight" ? "Parked out overnight" : "Parked out between shifts"}</>}>
        <ul className="mt-1.5 space-y-0.5 text-[13px] text-ink-2">
          <li>Stops at {l.a.to.name || "its last stop"} after the {l.a.label}</li>
          <li>Parks at {l.park.name} for {duration(l.gap)}</li>
          <li>Leaves on the {l.b.label}{l.clippedEnd ? ", after this clock ends" : ""}</li>
          <li>Saves {kms(l.saveKm)} km of empty running a day · {money(l.saveRs)} by km</li>
        </ul>
      </Shell>
    );
  }
  const pick = tip.kind === "pickup";
  const x = pick ? tip.r : tip.d;
  const clash = pick && (tip.before || tip.after);
  const note = clash ? (tip.before ? "Overlaps the run before" : "Overlaps the next run")
    : !pick && x.assumedOff ? "Shift end time assumed: the ERP has none for this service" : null;
  const facts = [x.ride ? `${duration(x.ride)} ride` : null, plural(x.stops, "stop", "stops"), plural(x.riders, "rider", "riders"), x.km != null ? `${kms(x.km)} km` : null];
  return (
    <Shell at={at} veh={tip.veh} when={times(x.start, x.end)} note={note} bad={clash}
      head={<><Dot color={pick ? x.svc.color : colorOf(x.svcId)} />{pick ? `${x.svc.name} pickup` : x.label}</>}>
      <p className="mt-1 text-[13px] text-ink-3">{facts.filter(Boolean).join(" · ")}</p>
    </Shell>
  );
}

const Shell = ({ at, veh, head, when, note, bad, children }) => (
  <div role="tooltip" className={cx("pointer-events-none absolute z-30 rounded-tile bg-white px-4 py-3 shadow-float", !at.pinned && "w-max max-w-[320px]")} style={at.style}>
    <p className="font-code text-[12px] text-ink-3">{veh}</p>
    <p className="mt-0.5 flex items-center gap-2 text-[13px] font-semibold text-ink">{head}</p>
    <p className="mt-1 font-code text-[17px] font-bold tabular-nums text-ink">{when}</p>
    {children}
    {note && <p className={cx("mt-1.5 text-[13px] font-medium", bad ? "text-bad-ink" : "text-ink-3")}>{note}</p>}
  </div>
);

/* ---------------------------------------------------------------- legend -- */
// the shape keys are grey: which colour is which service is on the chips
const KEY = tint(NT.muted);
const HINT = "Scroll over the times at the top, or pinch, to stretch the clock";
const Key = ({ swatch, children }) => (
  <span className="inline-flex items-center gap-2">{swatch}{children}</span>
);
const RailKey = ({ dashed }) => (
  <span aria-hidden className="relative inline-block h-3.5 w-12">
    <span className={cx("absolute inset-x-0 top-1.5 h-0.5 rounded-pill", dashed ? OVERNIGHT : RAIL)} />
    <Cap side="left-0">S</Cap><Cap side="right-0">P</Cap>
  </span>
);

/* ----------------------------------------------------------------- clock -- */
export default function Clock({ tm, className, ...rest }) {
  const { conn, loading, on, setOn, toggleSvc, q, setQ, clashOnly, setClashOnly, showLayovers, setShowLayovers,
    allRuns, pinnedHome, layovers, dropsByVeh, rows, shown, totalClashes } = tm;
  const drawn = useMemo(() => new Set(allRuns.map((r) => r.svc.id)), [allRuns]);
  const hasRows = shown.length > 0;

  const [zoom, setZoom] = useState(1);
  const [viewW, setViewW] = useState(0);
  const [hover, setHover] = useState(null);       // { x (in the lane), min, tip, at }
  const scrollRef = useRef(null), headRef = useRef(null), wrapRef = useRef(null);
  const labelW = viewW && viewW < 560 ? 104 : 136;
  const base = Math.max(BASE_LANE, viewW - labelW);
  const laneW = base * zoom;

  // the wheel handler is attached once, so it reads the live geometry from refs
  const geo = useRef(null);
  geo.current = { labelW, base };
  const zoomRef = useRef(1), drawnZ = useRef(1), anchor = useRef(null);
  /** Stretch the clock by `factor`, keeping the time under `cx` (px from the scroller's left) in place. */
  const zoomAround = (cx, factor) => {
    const el = scrollRef.current, z = zoomRef.current;
    const nz = clamp(z * factor);
    if (nz === z) return;
    const g = geo.current;
    if (el && !anchor.current) anchor.current = { f: (el.scrollLeft + cx - g.labelW) / (g.base * drawnZ.current), cx };
    zoomRef.current = nz;
    setZoom(nz);
  };
  const zoomer = useRef(zoomAround);
  zoomer.current = zoomAround;
  const middle = () => labelW + Math.max(0, viewW - labelW) / 2;

  useLayoutEffect(() => {
    drawnZ.current = zoom;
    const el = scrollRef.current, a = anchor.current;
    anchor.current = null;
    if (el && a) el.scrollLeft = labelW + a.f * base * zoom - a.cx;
  }, [zoom]); // eslint-disable-line react-hooks/exhaustive-deps

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => setViewW(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [hasRows]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e) => {
      const onFace = headRef.current && headRef.current.contains(e.target);
      if (!e.ctrlKey && !onFace) return;                       // plain scrolling moves through the buses
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;     // a sideways swipe pans, as before
      e.preventDefault();
      const cx = e.clientX - el.getBoundingClientRect().left;
      const k = -e.deltaY * (e.ctrlKey ? 0.01 : 0.0015);
      zoomer.current(cx, Math.exp(Math.max(-WHEEL_STEP, Math.min(WHEEL_STEP, k))));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [hasRows]);

  const { body, tips } = useRows({ shown, layovers, dropsByVeh, laneW, labelW });

  // the finest ruler whose labels still have room
  const pxPerMin = laneW / SPAN;
  const step = STEPS.find((s) => s * pxPerMin >= 64) || STEPS[STEPS.length - 1];
  const ticks = [], guides = [];
  for (let m = AX_START; m <= AX_END; m += step) ticks.push(m);
  for (let m = AX_START; m <= AX_END; m += Math.min(step, 60)) guides.push(m);

  const point = (e) => {
    const sc = scrollRef.current, wrap = wrapRef.current;
    if (!sc || !wrap) return;
    const sr = sc.getBoundingClientRect(), wr = wrap.getBoundingClientRect();
    const viewX = e.clientX - sr.left;
    const x = sc.scrollLeft + viewX - labelW;
    const min = viewX > labelW && x >= 0 && x <= laneW ? Math.round(AX_START + (x / laneW) * SPAN) : null;
    const el = e.target instanceof Element ? e.target.closest("[data-tip]") : null;
    const px = e.clientX - wr.left, py = e.clientY - wr.top;
    const flipX = px > wr.width - 340, flipY = py > wr.height - 170;
    // too narrow to sit beside the pointer: the card spans the bottom of the clock instead
    const at = wr.width < 640 ? { pinned: true, style: { left: 8, right: 8, bottom: 8 } } : { style: {
      left: flipX ? px - 14 : px + 14, top: flipY ? py - 14 : py + 14,
      transform: `translate(${flipX ? "-100%" : "0"}, ${flipY ? "-100%" : "0"})`,
    } };
    setHover({ x, min, tip: el ? el.dataset.tip : null, at });
  };
  const tip = hover && hover.tip ? tips.get(hover.tip) : null;
  const cross = hover && hover.min != null ? hover : null;

  const empty = !hasRows && (
    loading.plans ? <GhostRows className="mt-2" /> : !allRuns.length ? (
      <Empty icon={CalendarClock} title="No runs to draw yet" hint="Runs appear once a service has a gate time and a finalised plan." />
    ) : clashOnly && rows.length ? (
      <Empty icon={CalendarClock} title="No collisions" hint="No bus has overlapping runs under these filters."
        action={<Button variant="secondary" onClick={() => setClashOnly(false)}>Show every bus</Button>} />
    ) : q.trim() ? (
      <div className="flex flex-col items-center px-6 py-10 text-center">
        <p className="text-[15px] text-ink-2">No bus, service or park place matches “{q.trim()}”</p>
        <Button variant="ghost" className="mt-3" onClick={() => setQ("")}>Clear search</Button>
      </div>
    ) : (
      <Empty icon={CalendarClock} title={on.size ? "No runs in the services switched on" : "Every service is switched off"}
        hint="Switch on a service with runs to draw them."
        action={<Button variant="secondary" onClick={() => setOn(new Set(SERVICES.map((s) => s.id)))}>Show every service</Button>} />
    )
  );

  return (
    <Card padding="none" className={cx("flex max-h-[max(560px,calc(100dvh-7rem))] flex-col", className)} {...rest}>
      <div className="shrink-0 px-5 pt-5 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
          <div className="min-w-0">
            <h2 className="text-[15px] font-bold tracking-[-0.01em] text-ink">All buses, one day</h2>
            <p className="mt-0.5 text-[13px] text-ink-3">Every service on one clock, 04:00 to 06:00 the next morning</p>
          </div>
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
            <Search value={q} onChange={setQ} label="Search buses, services and park places" placeholder="Bus, service or where it parks"
              className="basis-full sm:basis-auto sm:w-[300px]" />
            <div role="group" aria-label="Stretch the clock" className="inline-flex h-11 shrink-0 items-center gap-0.5 rounded-pill bg-white px-1 shadow-chip">
              <IconButton label="Zoom out" icon={ZoomOut} variant="ghost" size="sm" disabled={zoom <= MIN_Z} onClick={() => zoomAround(middle(), 1 / 1.5)} />
              <span className="w-12 text-center text-[13px] font-semibold tabular-nums text-ink">{Math.round(zoom * 100)}%</span>
              <IconButton label="Zoom in" icon={ZoomIn} variant="ghost" size="sm" disabled={zoom >= MAX_Z} onClick={() => zoomAround(middle(), 1.5)} />
              <IconButton label="Fit the whole day" icon={Maximize2} variant="ghost" size="sm" disabled={zoom <= MIN_Z} onClick={() => zoomAround(middle(), 1 / zoom)} />
            </div>
          </div>
        </div>
        <div role="group" aria-label="Show on the clock"
          className="-mx-5 mt-3 flex gap-1.5 overflow-x-auto px-5 py-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
          {SERVICES.map((s) => (
            <Chip key={s.id} on={on.has(s.id)} onClick={() => toggleSvc(s.id)} className={cx(!drawn.has(s.id) && "opacity-60")}
              title={drawn.has(s.id) ? undefined : "No plan for this service yet: nothing to draw"}>
              <Dot color={s.color} className="!h-2 !w-2" />{s.name}
              {!drawn.has(s.id) && <span className="font-medium"> · no runs</span>}
            </Chip>
          ))}
          {conn && <Chip on={showLayovers} icon={ParkingSquare} onClick={() => setShowLayovers(!showLayovers)}
            title="The drop runs, and where each bus waits between them">Drops and layovers</Chip>}
          {(totalClashes > 0 || clashOnly) && (
            <Chip on={clashOnly} icon={AlertTriangle} onClick={() => setClashOnly(!clashOnly)} className="sm:ml-auto">
              Only collisions{totalClashes ? ` · ${count(totalClashes)}` : ""}
            </Chip>
          )}
        </div>
      </div>

      {hasRows ? (
        <div ref={wrapRef} className="relative mx-2 mt-2 flex min-h-0 flex-1 flex-col sm:mx-3">
          <div ref={scrollRef} role="region" aria-label="Clock of every bus" tabIndex={0}
            className="min-h-0 flex-1 overflow-auto rounded-tile" onMouseMove={point} onClick={point} onMouseLeave={() => setHover(null)} onScroll={() => setHover(null)}>
            <div style={{ width: labelW + laneW }}>
              <div ref={headRef} className="sticky top-0 z-[4] flex bg-white shadow-[0_1px_0_theme(colors.line)]" style={{ height: HEAD_H }}>
                <div className="sticky left-0 z-[5] flex shrink-0 items-end bg-white pb-2 pl-3" style={{ width: labelW }}>
                  <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-ink-3">Bus</span>
                </div>
                <div className="relative shrink-0 cursor-ew-resize" style={{ width: laneW }} title={HINT}>
                  {ROTATION_SLOTS.map((sl) => {
                    const end = Math.min(sl.to, AX_END), c = tint(sl.color);
                    const w = ((pct(end) - pct(sl.from)) / 100) * laneW;
                    const label = `${sl.name} ${times(sl.from, sl.to % 1440)}`;
                    return (
                      <div key={sl.id} title={label}
                        className="absolute top-2 flex h-6 items-center overflow-hidden whitespace-nowrap rounded-pill px-2.5 text-[11px] font-semibold"
                        style={{ left: `calc(${pct(sl.from)}% + 1px)`, width: `calc(${pct(end) - pct(sl.from)}% - 2px)`, background: c.drop, color: c.deep }}>
                        {w >= 170 ? <>{sl.name}<span className="ml-1.5 font-code font-medium">{times(sl.from, sl.to % 1440)}</span></> : w >= 70 ? sl.name : null}
                      </div>
                    );
                  })}
                  {ticks.map((m, i) => (
                    <span key={m} className="absolute bottom-2 font-code text-[11px] text-ink-3"
                      style={{ left: pct(m) + "%", transform: i === 0 ? "none" : m === AX_END ? "translateX(-100%)" : "translateX(-50%)" }}>
                      {fmtClock(m)}
                    </span>
                  ))}
                  {cross && (
                    <span className="absolute bottom-1.5 z-[1] rounded-pill bg-ink px-2 py-0.5 font-code text-[11px] font-semibold text-white"
                      style={{ left: cross.x, transform: "translateX(-50%)" }}>{fmtClock(cross.min)}</span>
                  )}
                </div>
              </div>
              <div className="relative">
                <div aria-hidden className="pointer-events-none absolute inset-y-0 z-[1]" style={{ left: labelW, width: laneW }}>
                  {guides.map((m) => <span key={m} className="absolute inset-y-0 border-l border-dashed border-ink-3/20" style={{ left: pct(m) + "%" }} />)}
                  {cross && <span className="absolute inset-y-0 w-px bg-ink/30" style={{ left: cross.x }} />}
                </div>
                {body}
              </div>
            </div>
          </div>
          {tip && <TipCard tip={tip} at={hover.at} />}
        </div>
      ) : empty}

      <div className="flex shrink-0 flex-wrap items-center gap-x-5 gap-y-2 px-5 pb-5 pt-3 text-[13px] text-ink-3 sm:px-6">
        <Key swatch={<span aria-hidden className="h-3.5 w-7 rounded-pill" style={{ background: KEY.pick }} />}>Pickup</Key>
        {conn && showLayovers && (
          <>
            <Key swatch={<span aria-hidden className="h-2.5 w-7 rounded-pill" style={{ background: KEY.drop }} />}>Drop</Key>
            <Key swatch={<span aria-hidden className="h-2.5 w-7 rounded-pill" style={{ background: assumedFill(KEY.drop) }} />}>Drop on an assumed shift end</Key>
            <Key swatch={<RailKey />}>Stops, then parks there between shifts</Key>
            <Key swatch={<RailKey dashed />}>Parked out overnight</Key>
          </>
        )}
        {totalClashes > 0 && <Key swatch={<span aria-hidden className={cx("h-3.5 w-7 rounded-pill bg-bad-soft", CLASH)} />}>Collision</Key>}
        {conn && showLayovers && pinnedHome > 0 && (
          <span className="inline-flex items-center gap-1.5 text-warn-ink">
            <ParkingSquare size={15} strokeWidth={2} aria-hidden />
            {plural(pinnedHome, "layover", "layovers")} not drawn: those buses are pinned to the factory in the Planner
          </span>
        )}
        {loading.conn && <span>Loading drops and layovers…</span>}
        <span className="lg:ml-auto">{HINT}</span>
      </div>
    </Card>
  );
}
