/* The ticked routes on a map, each in its own colour along real roads (MasterRouteMap, the old
   board's map, shown as it is), with frosted controls over it and the stop order beside it.
   Pressing a route's name in the stop order shows only that route and its stops. With nothing
   ticked the map stays short and offers the routes to draw: beside it when there are companies
   to pick from, over it when there is only the whole list. */
import React, { useEffect, useState } from "react";
import { ChevronDown, Crosshair, MapPin, X } from "lucide-react";
import { FIRST_STOP_COLOR, LAST_STOP_COLOR, MasterRouteMap } from "../../../../optimiser/OptimiserTab.jsx";
import { NT } from "../../../legacyTheme.js";
import { Button, Card, CardTitle, CompanyDot, IconButton, cx } from "../../../ui.jsx";
import { count, plural } from "../../../format.js";
import MapStage, { GlassButton } from "../shell/MapStage.jsx";
import { fitMap } from "./fitMap.js";

// in Overall a bus running two services is two rows with one name
const idOf = (r) => r.uid || r.name;

/**
 * @param draws  what can be drawn in one press: [{ label, company, names }], the whole list first
 */
export default function RouteMapCard({ depot, selRows, colors, masterKey, names, draws, onDraw, onRemove, onClear }) {
  const [showStops, setShowStops] = useState(true);
  const [solo, setSolo] = useState(null);
  const soloRow = solo ? selRows.find((r) => idOf(r) === solo) : null;
  useEffect(() => { if (solo && !soloRow) setSolo(null); }, [solo, soloRow]);
  const shown = soloRow ? [soloRow] : selRows;
  const has = selRows.length > 0;
  const side = has || draws.length > 1;
  const [all] = draws;
  const order = { selRows, shown, colors, names, solo: soloRow ? solo : null, onRemove, onClear,
    onSolo: (id) => setSolo((s) => (s === id ? null : id)) };

  const tools = has && (
    <>
      <button type="button" aria-pressed={showStops} onClick={() => setShowStops((s) => !s)}
        title={showStops ? "Hide the stops to see the roads clearly" : "Show the stops"}
        className={cx("pointer-events-auto inline-flex h-9 shrink-0 items-center gap-1.5 rounded-pill px-3.5 text-[13px] font-semibold shadow-chip",
          "transition-[background-color,transform] duration-150 active:scale-[0.97]",
          showStops ? "bg-ink text-white hover:bg-ink-2" : "glass text-ink hover:bg-white")}>
        <MapPin size={15} strokeWidth={2} aria-hidden />Stops
      </button>
      <GlassButton icon={Crosshair} title="Fit the map to the routes" onClick={(e) => fitMap(e.currentTarget)}>Fit</GlassButton>
    </>
  );

  return (
    <div className={cx("grid gap-3", side && "xl:grid-cols-[minmax(0,1fr)_400px]")}>
      {/* with nothing drawn the map is only the factory, so it stays short; 300 matches the column of draw buttons */}
      <MapStage label="Routes map" tools={tools} height={has ? { base: 360, lg: 520 } : { base: 240, lg: side ? 300 : 240 }}
        render={(h, big) => (
          // a new key draws the map again: a new set of routes, size or stop layer
          <MasterRouteMap key={[soloRow ? idOf(soloRow) : masterKey, h, big, showStops].join(":")} t={NT} depot={depot}
            routes={shown} colors={colors} height={h} showStops={showStops} scrollWheelZoom={big} />
        )}
        // enlarged, the column beside the map is out of sight, so the stop order floats over it
        overlay={(big) => (has ? big && <StopOrder {...order} floating />
          : !side && all.names.length > 0 && (
            <div className="glass pointer-events-auto flex max-w-full flex-wrap items-center gap-x-4 gap-y-2 rounded-tile px-4 py-3 shadow-float">
              <p className="min-w-0 text-[13px] text-ink-2">Tick routes in the table below, or</p>
              <Button variant="primary" size="sm" onClick={() => onDraw(all.names)}>{all.label}</Button>
            </div>
          ))} />
      {has ? <StopOrder {...order} /> : side && <DrawRoutes draws={draws} onDraw={onDraw} />}
    </div>
  );
}

/* Nothing on the map yet: every route in one press, or one company's. */
function DrawRoutes({ draws, onDraw }) {
  const [all, ...companies] = draws;
  return (
    <Card className="flex flex-col">
      <CardTitle title="Draw routes" sub="Or tick routes in the table below" />
      <div className="flex flex-wrap gap-2 xl:flex-col">
        {all.names.length > 0 && (
          <Button variant="primary" onClick={() => onDraw(all.names)} className="xl:w-full">
            {all.label}<span className="tabular-nums text-white/60">{count(all.names.length)}</span>
          </Button>
        )}
        {companies.map((d) => (
          <Button key={d.company} variant="secondary" onClick={() => onDraw(d.names)} className="xl:w-full xl:justify-start">
            <CompanyDot unit={d.company} />{d.label}<span className="ml-auto tabular-nums text-ink-3">{count(d.names.length)}</span>
          </Button>
        ))}
      </div>
    </Card>
  );
}

/* Factory first, then each stop in pick-up order, coloured as on the map: first green, last red.
   Beside the map it is a card as tall as the map; over the enlarged map it floats as glass. */
function StopOrder({ floating, selRows, shown, colors, names, solo, onSolo, onRemove, onClear }) {
  const [open, setOpen] = useState(() => window.matchMedia("(min-width: 768px)").matches);
  return (
    <div className={cx("flex min-w-0 flex-col overflow-hidden",
      floating ? "glass pointer-events-auto mb-5 max-h-[calc(100vh-128px)] w-72 self-end rounded-tile shadow-float"
        : "rounded-card bg-white shadow-card xl:h-[520px]")}>
      <div className="flex shrink-0 items-center gap-1 py-2 pl-5 pr-2">
        <p className="min-w-0 flex-1 truncate">
          <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-ink-3">Stop order</span>
          <span className="text-[13px] text-ink-3"> · {plural(selRows.length, "route", "routes")}</span>
        </p>
        {solo && <Button variant="ghost" size="sm" onClick={() => onSolo(solo)}>Show all</Button>}
        <Button variant="ghost" size="sm" icon={X} onClick={onClear}>Clear map</Button>
        {/* beside the map on a desk the list is always open */}
        <IconButton label={open ? "Fold the stop order" : "Show the stop order"} icon={ChevronDown} variant="ghost" size="sm"
          aria-expanded={open} onClick={() => setOpen((o) => !o)}
          className={cx("[&>svg]:transition-transform [&>svg]:duration-200", open && "[&>svg]:rotate-180", !floating && "xl:hidden")} />
      </div>
      <div className={cx("min-h-0 flex-1 overflow-y-auto", floating ? !open && "hidden" : open ? "max-xl:max-h-[420px]" : "max-xl:hidden")}>
        {shown.map((r) => (
          <section key={idOf(r)}>
            <div className={cx("flex items-center gap-2 py-1.5 pl-5 pr-2", floating ? "bg-white/60" : "bg-satin")}>
              <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-pill" style={{ background: colors[r.name] }} />
              <button type="button" aria-pressed={solo === idOf(r)} onClick={() => onSolo(idOf(r))}
                title={solo === idOf(r) ? "Show every ticked route" : "Show only this route"}
                className="min-w-0 flex-1 truncate text-left text-[13px] font-semibold text-ink hover:underline">
                {names[r.name] || <span className="font-code">{r.name}</span>}
                {r.service && <span className="font-normal text-ink-3"> · {r.service}</span>}
              </button>
              <button type="button" aria-label={`Take ${names[r.name] || r.name} off the map`} title="Take off the map" onClick={() => onRemove(r.name)}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-pill text-ink-3 transition-colors hover:bg-white hover:text-ink">
                <X size={14} strokeWidth={2} aria-hidden />
              </button>
            </div>
            <ol className="py-1">
              <li className="flex items-center gap-2 px-5 py-1 text-[13px] text-ink">
                <Disc className="bg-ink">F</Disc><span className="font-semibold">Factory</span>
              </li>
              {r.seq.map((s, i) => {
                const first = i === 0, last = i === r.seq.length - 1;
                return (
                  <li key={i} className="flex items-center gap-2 px-5 py-1 text-[13px] text-ink">
                    <Disc color={last ? LAST_STOP_COLOR : first ? FIRST_STOP_COLOR : colors[r.name] || NT.primary}>{i + 1}</Disc>
                    <span className="min-w-0 flex-1 truncate" title={s.name}>{s.name}</span>
                    {s.eff != null && (
                      <span className="shrink-0 text-[13px] font-semibold tabular-nums text-ink-2" title={`${s.eff} riders (${s.hc ?? "?"} registered)`}>{s.eff}</span>
                    )}
                  </li>
                );
              })}
            </ol>
          </section>
        ))}
      </div>
    </div>
  );
}

const Disc = ({ color, className, children }) => (
  <span className={cx("inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-pill px-1 text-[11px] font-bold tabular-nums text-white", className)}
    style={color ? { background: color } : undefined}>
    {children}
  </span>
);
