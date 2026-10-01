/* The right column of the bus page: the bus and its driver, who rides it, where it stops, and the
   custom metrics. */
import React, { useRef, useState } from "react";
import { MapPin, Pencil, Sigma, Users } from "lucide-react";
import { RUN_OPTIMISER, NEEDS_ERP } from "../../../erp.js";
import { bandFor, busStopRiders, driverPatch, evalFormula, fmtFormula, sortedBands, varMapOf } from "../../../Dashboard.jsx";
import { Button, Card, CardTitle, CentreCard, DataTable, Empty, Eyebrow, Field, Input, Search, Tile, Tiles, cx, tdCls, thCls, trCls } from "../../ui.jsx";
import { DASH, count, day, duration, kms, plural, squash } from "../../format.js";
import { Fact, Facts, HeadCount, Missing, useFocusBack, useKept } from "./parts.jsx";
import { SERVICES } from "../../../optimiser/services.js";

const serviceName = (id) => (SERVICES.find((x) => x.id === id) || { name: id }).name;

const PLAN_IT = "Plan the route in the Optimiser";
const NotPlanned = () => <Missing title={PLAN_IT}>Not planned yet</Missing>;

/* ------------------------------------------------------------- bus and driver -- */
/* Driver name and phone are in neither ERP feed: they are typed here and kept on this device against
   the vehicle, the same record the old look reads. Keyed by bus, so a half-typed edit stays with it. */
export function BusDriverCard({ bus, hired, info, onSave }) {
  const [draft, setDraft] = useKept(`bus:${bus.id}:driver`, null);
  const opener = useRef(null);
  useFocusBack(!!draft, opener);
  const stops = (bus.planStops || []).length;
  const has = !!(info && (info.driver || info.phone));
  const save = (e) => { e.preventDefault(); onSave(driverPatch(draft)); setDraft(null); };
  const notSet = <Missing title={NEEDS_ERP}>Not set</Missing>;

  return (
    <Card data-rise-deep>
      <CardTitle title="Bus and driver" className="!mb-1" />
      <Facts>
        <Fact label="Seats">{count(bus.capacity)}</Fact>
        <Fact label="Type" title={bus.type || undefined}>{hired ? "Hired" : "Owned"}</Fact>
        <Fact label="Route" title={stops && bus.route !== RUN_OPTIMISER ? bus.route : undefined}>
          {stops ? `${kms(bus.planKm)} km · ${plural(stops, "stop", "stops")}` : <NotPlanned />}
        </Fact>
        {/* a bus on more than one shift: its day is every run added up, and that is what its km falls back to */}
        {bus.planRuns && bus.planRuns.length > 1 && (
          <Fact label="Runs a day" title={bus.planRuns.map((r) => `${serviceName(r.service)} · ${kms(r.km)} km`).join("\n")}>
            {`${bus.planRuns.length} runs · ${kms(bus.planDayKm)} km`}
          </Fact>
        )}
        {!hired && <Fact label="Mileage">{+bus.mileage > 0 ? `${kms(+bus.mileage)} km/L` : <Missing>Not in the ERP</Missing>}</Fact>}
      </Facts>

      <div className="mt-5 flex min-h-9 items-center justify-between gap-3">
        <Eyebrow>Driver</Eyebrow>
        {!draft && (
          <Button ref={opener} variant="ghost" size="sm" icon={Pencil} className="-mr-2"
            onClick={() => setDraft({ driver: (info && info.driver) || "", phone: (info && info.phone) || "" })}>
            {has ? "Change driver" : "Add driver"}
          </Button>
        )}
      </div>
      {draft ? (
        <form className="mt-2 flex flex-col gap-3" onSubmit={save} onKeyDown={(e) => { if (e.key === "Escape") setDraft(null); }}>
          <Field label="Driver name">
            <Input autoFocus value={draft.driver} placeholder="Driver name" onChange={(e) => setDraft({ ...draft, driver: e.target.value })} />
          </Field>
          <Field label="Phone">
            <Input type="tel" inputMode="tel" value={draft.phone} placeholder="Phone number" onChange={(e) => setDraft({ ...draft, phone: e.target.value })} />
          </Field>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="ghost" className="sm:min-w-[120px]" onClick={() => setDraft(null)}>Cancel</Button>
            <Button variant="primary" type="submit" className="sm:min-w-[120px]">Save driver</Button>
          </div>
        </form>
      ) : (
        <Facts>
          <Fact label="Name">{(info && info.driver) || notSet}</Fact>
          <Fact label="Phone">{info && info.phone ? <a href={`tel:${info.phone}`} className="rounded-pill hover:underline">{info.phone}</a> : notSet}</Fact>
        </Facts>
      )}
      <p className="mt-2 text-[13px] text-ink-3">Not in the ERP · saved on this device</p>
    </Card>
  );
}

/* ------------------------------------------------------------------ employees -- */
// present is the normal case and stays neutral; only an absence takes a colour
const STATUS = {
  P: { letter: "P", word: "Present", disc: "bg-satin-2 text-ink-2" },
  A: { letter: "A", word: "Absent", disc: "bg-bad-soft text-bad-ink" },
  none: { letter: "–", word: "No punch", disc: "bg-satin-2 text-ink-4" },
};
const statusOf = (st) => STATUS[st] || STATUS.none;
const LIMIT = 40;

export function EmployeesCard({ bus, emps, punches, latest }) {
  const [all, setAll] = useState(false);
  const [open, setOpen] = useState(null);
  const [q, setQ] = useState("");
  // absent first, then no punch, then present: the people who need a look come first
  const rank = (st) => (st === "A" ? 0 : st === "P" ? 2 : 1);
  const s = squash(q);
  const sorted = emps.filter((e) => !s || squash(`${e.name} ${e.code || ""}`).includes(s))
    .sort((a, b) => rank(punches[a.id]) - rank(punches[b.id]));
  const shown = all ? sorted : sorted.slice(0, LIMIT);
  const st = open && statusOf(punches[open.id]);

  return (
    <Card data-rise-deep>
      <CardTitle title={<>Employees<HeadCount>{count(emps.length)}</HeadCount></>} sub={emps.length > 0 && latest ? `Punches on ${day(latest)}` : null} />
      {emps.length ? (
        <>
          {emps.length > 9 && <Search value={q} onChange={setQ} label="Find an employee" placeholder="Find an employee" className="mb-3" />}
          {s && !sorted.length && <p className="text-[13px] text-ink-3">No one matches “{q.trim()}”</p>}
          <ul className="flex flex-wrap gap-1.5">
            {shown.map((e) => {
              const s = statusOf(punches[e.id]);
              return (
                <li key={e.id} className="min-w-0 max-w-full">
                  <button type="button" onClick={() => setOpen(e)} title={s.word} aria-label={`${e.name}, ${s.word.toLowerCase()}`}
                    className="inline-flex h-8 max-w-full items-center gap-1.5 rounded-pill bg-satin pl-1 pr-3 text-[13px] font-medium text-ink-2 transition-[background-color,color,transform] duration-150 hover:bg-satin-2 hover:text-ink active:scale-[0.97]">
                    <span aria-hidden className={cx("flex h-6 w-6 shrink-0 items-center justify-center rounded-pill text-[11px] font-bold", s.disc)}>{s.letter}</span>
                    <span className="truncate">{e.name}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          {!all && sorted.length > LIMIT && (
            <Button variant="ghost" size="sm" className="-ml-4 mt-3" onClick={() => setAll(true)}>Show all {count(sorted.length)}</Button>
          )}
        </>
      ) : <Empty icon={Users} title="No riders on this bus" hint="Riders appear when the ERP puts employees on this bus." className="!py-8" />}

      <CentreCard open={!!open} title="Employee details" sub={open ? open.name : null} onClose={() => setOpen(null)}>
        {open && (
          <Facts>
            <Fact label="Employee code"><span className="font-code">{open.code || DASH}</span></Fact>
            <Fact label="Company">{bus.unit}</Fact>
            <Fact label="Department">{open.department || DASH}</Fact>
            <Fact label="Designation">{open.designation || DASH}</Fact>
            <Fact label="Travel time">{open.travelMin != null ? duration(open.travelMin) : <NotPlanned />}</Fact>
            <Fact label="Bus"><span className="font-code">{bus.vehicle}</span></Fact>
            <Fact label={latest ? `On ${day(latest)}` : "Punch"}>{st.word}</Fact>
          </Facts>
        )}
      </CentreCard>
    </Card>
  );
}

/* ---------------------------------------------------------------------- stops -- */
export function StopsCard({ bus }) {
  const stops = bus.planStops || [];
  const riders = busStopRiders(bus);
  return (
    <Card data-rise-deep>
      <CardTitle title={<>Stops{stops.length > 0 && <HeadCount>{count(stops.length)}</HeadCount>}</>}
        sub={stops.length ? "In pickup order · from the finalised plan" : null} />
      {stops.length ? (
        <>
          <Tiles className="mb-4 grid-cols-2">
            <Tile label="Riders on the route" value={count(riders)}
              note={bus.planRiders != null && +bus.planRiders !== riders ? `plan allots ${count(bus.planRiders)}` : null} />
            <Tile label="Longest ride" value={bus.planRide != null ? duration(bus.planRide) : DASH} />
          </Tiles>
          <DataTable label="Stops" className="max-h-[480px] overflow-y-auto">
            <thead>
              <tr>
                <th className={cx(thCls, "w-12")}>#</th>
                <th className={thCls}>Stop</th>
                <th className={cx(thCls, "text-right")}>Riders</th>
              </tr>
            </thead>
            <tbody>
              {stops.map((st, i) => (
                <tr key={i} className={trCls}>
                  <td className={cx(tdCls, "!align-top tabular-nums text-ink-3")}>{i + 1}</td>
                  <td className={cx(tdCls, "!align-top")}>
                    <span className="block font-medium text-ink">{st.name}</span>
                    <span className="hidden font-code text-[13px] text-ink-3 sm:block">{(+st.lat).toFixed(5)}, {(+st.lng).toFixed(5)}</span>
                  </td>
                  <td className={cx(tdCls, "!align-top text-right font-semibold tabular-nums text-ink")}>{count(st.hc)}</td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        </>
      ) : <Empty icon={MapPin} title="No stops yet" hint="This bus has no route in the finalised plan." className="!py-8" />}
    </Card>
  );
}

/* ------------------------------------------------------------- custom metrics -- */
/* A metric with bands shows the band it reached, in the colour picked for that band (green, amber
   or red hues map to their soft tones; any other hue stays ink). The "Over 150%" band only applies
   to a percentage: bandFor adds it for seats filled, and a rupee figure over 150 is not overfull. */
function toneOfHex(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ""));
  if (!m) return undefined;
  const n = parseInt(m[1], 16), r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), c = max - min;
  if (c < 0.15) return undefined;
  const hue = max === r ? 60 * (((g - b) / c + 6) % 6) : max === g ? 60 * ((b - r) / c + 2) : 60 * ((r - g) / c + 4);
  return hue < 20 || hue >= 330 ? "bad" : hue < 65 ? "warn" : hue < 170 ? "ok" : undefined;
}
function metricBand(val, f) {
  if (f.unit === "%") return bandFor(val, f.bands);
  const bs = sortedBands(f.bands);
  return bs.find((b) => val >= b.min) || bs[bs.length - 1];
}

export function MetricsCard({ formulas, variables, m }) {
  const vmap = varMapOf(variables);
  return (
    <Card data-rise-deep>
      <CardTitle title="Custom metrics" />
      {!formulas.length ? (
        <Empty icon={Sigma} title="No custom metrics yet" hint="Add them in Settings." className="!py-8" />
      ) : !m ? (
        <p className="text-[13px] text-ink-3">Nothing in the chosen dates.</p>
      ) : (
        <Tiles className="grid-cols-2">
          {formulas.map((f) => {
            const val = evalFormula(f.expr, m, vmap);
            const band = f.bands && f.bands.length && val != null ? metricBand(val, f) : null;
            return (
              <Tile key={f.id} label={f.name} note={band ? band.label : null} title={`${f.name} = ${f.expr}`}
                value={fmtFormula(val, f)} tone={band ? toneOfHex(band.color) : undefined} />
            );
          })}
        </Tiles>
      )}
    </Card>
  );
}
