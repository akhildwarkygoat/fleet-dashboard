/* What are you planning: Overall (every service on one clock) as a full-width hero card with the
   riders of each service beside the total, then one card per service with its riders, buses and
   gate time from the live ERP roll-up and its state as a soft tag. The figures and the "planned"
   rule are the old board's (serviceCard in TimingsView.jsx).
   Each card is a plain block with one full-size button laid over it, so the figures stay outside
   the button and the button's name stays short. */
import React, { useRef } from "react";
import { ChevronRight } from "lucide-react";
import { SERVICES, OVERALL, fmtClock, subShiftsOf } from "../../../optimiser/services.js";
import { serviceCard, servicesWithRiders, ridersInServices } from "../../../optimiser/TimingsView.jsx";
import { Aura, Eyebrow, Tag, Tile, Tiles, Unit, cx, useRise } from "../../ui.jsx";
import { count, day, plural } from "../../format.js";

const CARD = cx("relative flex min-w-0 flex-col rounded-card bg-white p-5 text-left shadow-card sm:p-6",
  "transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-float active:scale-[0.985]");
const GRID = "grid gap-3 sm:grid-cols-2 lg:grid-cols-3";
const HERO_SPAN = "sm:col-span-2 lg:col-span-3";

// the ERP writes shifts in capitals with a dash ("GENERAL SHIFT - 9")
const shiftName = (s) => { const l = String(s).toLowerCase().replace(/\s*-\s*/, " "); return l.charAt(0).toUpperCase() + l.slice(1); };
// "a plan — run the optimiser for this service": the tag says "Needs a plan", the footer the rest
function splitNeed(need) {
  const [what, how] = String(need).split(" — ");
  return { what, how: how ? how.charAt(0).toUpperCase() + how.slice(1) : null };
}

/** The service's state, said once as a soft tag, and the next step for the card's footer. */
function stateOf(s, { stats, need, planned }) {
  if (!stats) return { tone: "neutral", tag: `Needs ${need}`, next: null };
  if (need && s.notice) return { tone: "warn", tag: "Optimiser in progress", next: "Open stops" };
  if (need) { const n = splitNeed(need); return { tone: "warn", tag: `Needs ${n.what}`, next: n.how || "Open stops" }; }
  return { tone: planned ? "ok" : "neutral", tag: planned ? "Planned" : "In the ERP", next: "Open stops" };
}

/** The whole card is the target; the figures sit outside the button. */
const Opener = ({ label, title, onClick, hero }) => (
  <button type="button" onClick={onClick} aria-label={label} title={title}
    className={cx("absolute inset-0 z-[1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nova", hero ? "rounded-hero" : "rounded-card")} />
);

const Disc = () => (
  <span aria-hidden className="flex h-8 w-8 shrink-0 items-center justify-center rounded-pill bg-satin-2 text-ink-2">
    <ChevronRight size={18} strokeWidth={2} />
  </span>
);

function ServiceCard({ s, shifts, onPick }) {
  const card = serviceCard(s, shifts);
  const st = stateOf(s, card);
  const subs = s.erpUnit ? subShiftsOf(s, shifts) : [];
  return (
    <div className={cx(CARD, "flex-1")}>
      <Opener onClick={() => onPick(s)} label={`Open ${s.name}`}
        title={card.need ? `${s.name} needs ${card.need.replace(" — ", ": ")}` : `Open ${s.name}`} />
      <div className="flex flex-wrap items-start gap-x-2.5 gap-y-2">
        <span aria-hidden className="mt-[5px] h-2.5 w-2.5 shrink-0 rounded-pill" style={{ background: s.color }} />
        <h2 className="min-w-0 flex-1 text-[15px] font-bold leading-snug tracking-[-0.01em] text-ink">{s.name}</h2>
        <Tag tone={st.tone} className="-my-0.5 ml-auto">{st.tag}</Tag>
      </div>
      <Tiles className="mt-4 grid-cols-3">
        <Tile size="sm" label="Riders" value={card.stats ? count(card.stats.riders) : null} />
        <Tile size="sm" label="Buses" value={card.stats ? count(card.stats.buses) : null} />
        <Tile size="sm" label="Gate" value={<span className="font-code">{fmtClock(s.gate)}</span>} />
      </Tiles>
      {(s.branch || subs.length > 1) && (
        <div className="mt-3 space-y-1 text-[13px] text-ink-3">
          {s.branch && <p>Own depot · {s.depot.name.split(" — ").pop()}</p>}
          {subs.length > 1 && <p>{subs.map(([n, c]) => `${shiftName(n)}: ${plural(c, "rider", "riders")}`).join(" · ")}</p>}
        </div>
      )}
      <div className="mt-auto flex items-center justify-between gap-3 pt-3 text-[13px] font-semibold text-ink-2">
        <span className="min-w-0">{st.next}</span>
        <Disc />
      </div>
    </div>
  );
}

/** Overall: every rider in a service, and how they split across the services. */
function OverallCard({ shifts, shiftDate, fleetSize, onPick }) {
  const riders = ridersInServices(shifts);
  const withRiders = servicesWithRiders(shifts);
  const split = SERVICES.map((s) => ({ s, n: (serviceCard(s, shifts).stats || {}).riders || 0 }));
  return (
    <div className={cx(CARD, "isolate flex-1 overflow-hidden !rounded-hero sm:p-8")}>
      <Opener hero onClick={() => onPick(OVERALL)} label="Open Overall: every service on one clock" />
      <Aura size={440} intensity={0.85} className="-left-32 -top-40 -z-10" />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] lg:gap-10">
        <div>
          <Eyebrow>Overall</Eyebrow>
          <p className="mt-2 text-[64px] font-bold leading-none tracking-[-0.03em] tabular-nums text-ink">
            {count(riders)}<Unit className="!text-[28px] font-semibold">riders</Unit>
          </p>
          <p className="mt-4 text-[15px] text-ink-2">Every service on one clock: timings, clashes and the whole fleet’s day.</p>
        </div>
        <RiderSplit split={split} total={riders} />
      </div>
      <div className="mt-auto flex items-center justify-between gap-4 pt-6">
        <p className="flex flex-wrap items-baseline gap-x-5 gap-y-1 text-[13px]">
          {fleetSize != null && (
            <span><b className="text-[15px] font-bold tabular-nums text-ink">{count(fleetSize)}</b> <span className="text-ink-3">{fleetSize === 1 ? "bus" : "buses"} in the fleet</span></span>
          )}
          <span><b className="text-[15px] font-bold tabular-nums text-ink">{count(withRiders)}</b> <span className="text-ink-3">of {plural(SERVICES.length, "service", "services")} with riders</span></span>
          <span className="text-ink-3">From the ERP{shiftDate ? ` on ${day(shiftDate)}` : ""}</span>
        </p>
        <Disc />
      </div>
    </div>
  );
}

/** Riders by service: one bar split in each service's colour, then every service with its count. */
function RiderSplit({ split, total }) {
  return (
    <div className="min-w-0">
      <p className="text-[13px] font-semibold text-ink-3">Riders by service</p>
      <div aria-hidden className="mt-3 flex h-3 gap-1 overflow-hidden rounded-pill bg-satin-2">
        {total > 0 && split.filter((x) => x.n > 0).map(({ s, n }) => (
          <span key={s.id} className="h-full" style={{ flex: `${n} 1 0`, background: s.color }} />
        ))}
      </div>
      <dl className="mt-3 grid gap-x-6 sm:grid-cols-2">
        {split.map(({ s, n }) => (
          <div key={s.id} className="flex items-baseline gap-2.5 py-1.5">
            <span aria-hidden className="h-2.5 w-2.5 shrink-0 translate-y-[1px] rounded-pill" style={{ background: s.color }} />
            <dt className="min-w-0 flex-1 truncate text-[13px] text-ink-2">{s.name}</dt>
            <dd className="text-[15px] font-bold tabular-nums text-ink">{count(n)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** `fleetSize` (optional, beyond the old board's props): the fleet's bus count for the Overall card. */
export default function ServicePicker({ onPick, shifts, shiftDate, fleetSize }) {
  const root = useRef(null);
  useRise(root, true, [], 40);
  return (
    <div ref={root} className={GRID}>
      {/* plain wrappers carry the rise, so it never fights a card's own hover transition */}
      <div data-rise className={cx("flex", HERO_SPAN)}>
        <OverallCard shifts={shifts} shiftDate={shiftDate} fleetSize={fleetSize} onPick={onPick} />
      </div>
      {SERVICES.map((s) => (
        <div key={s.id} data-rise className="flex"><ServiceCard s={s} shifts={shifts} onPick={onPick} /></div>
      ))}
    </div>
  );
}

/** The picker's shape while the fleet loads. */
export function ServicePickerSkeleton() {
  const bone = "rounded-tile bg-satin-2";
  return (
    <div aria-hidden className={GRID}>
      <div className={cx("flex min-h-[260px] flex-col rounded-hero bg-white p-6 shadow-card sm:p-8", HERO_SPAN)}>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] lg:gap-10">
          <div>
            <div className={cx(bone, "h-3 w-20")} />
            <div className={cx(bone, "mt-3 h-16 w-56")} />
            <div className={cx(bone, "mt-4 h-4 w-80 max-w-full")} />
          </div>
          <div>
            <div className={cx(bone, "h-3.5 w-32")} />
            <div className="mt-3 h-3 rounded-pill bg-satin-2" />
            <div className="mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-2">
              {SERVICES.map((s) => <div key={s.id} className={cx(bone, "h-4")} />)}
            </div>
          </div>
        </div>
        <div className={cx(bone, "mt-auto h-4 w-64 max-w-full")} />
      </div>
      {SERVICES.map((s) => (
        <div key={s.id} className="flex flex-col rounded-card bg-white p-5 shadow-card sm:p-6">
          <div className="flex items-center gap-2.5">
            <span className="h-2.5 w-2.5 rounded-pill" style={{ background: s.color }} />
            <span className="text-[15px] font-bold text-ink">{s.name}</span>
            <span className="ml-auto h-7 w-20 rounded-pill bg-satin-2" />
          </div>
          <div className="mt-4 grid grid-cols-3 gap-3">
            {[0, 1, 2].map((i) => <div key={i} className={cx(bone, "h-[52px]")} />)}
          </div>
          <div className="mt-auto flex items-center justify-between pt-3">
            <div className={cx(bone, "h-4 w-24")} />
            <span className="h-8 w-8 rounded-pill bg-satin-2" />
          </div>
        </div>
      ))}
    </div>
  );
}
