/* ============================================================================
 * optimiser/NewPlanBoard.jsx — map-first "build your own plan" board
 * ----------------------------------------------------------------------------
 * Interaction: ALL stops show on the map from the start (grey = unassigned).
 * Pick a bus (small card) → it becomes active → click stops on the map to add /
 * remove them from that bus (click several for multi-select). The KPI tiles scope
 * to the active bus while one is selected, else to the whole plan.
 * ==========================================================================*/
import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { gsap } from "gsap";
import { Flip } from "gsap/Flip";
import GMap from "./GMap.jsx";
import { X, Trash2, Wand2, MousePointerClick, Maximize2, Minimize2, EyeOff, BarChart3, Bus, SlidersHorizontal } from "lucide-react";
import { KPI_DEFS, visibleKpis } from "./kpiPrefs.js";
import ParkPicker, { parkLabel } from "./ParkPicker.jsx";
import { BUS_RANK, TYPE_KEYS, dirWords } from "./kpiRank.js";
import { prefersReduced, springTween } from "../ui/motion.js";
import { usePlanBoard, planTiles, UNADDED, ADDED, START_COLOR, PARK_COLOR } from "./plannerState.js";

gsap.registerPlugin(Flip);

export default function NewPlanBoard({ t, editor, fleet, depot, stopsById, totalRiders, demandOf, toast, period = "evening", svcId = "plan", parkPrefs, setParkPrefs }) {
  const busGridRef = useRef(null);
  const flipFrom = useRef(null);
  const captureFlip = () => { if (busGridRef.current && !prefersReduced()) flipFrom.current = Flip.getState(busGridRef.current.children); };
  // the board's state, actions and figures live in plannerState.js, shared with the new look
  const board = usePlanBoard({ editor, fleet, depot, stopsById, totalRiders, demandOf, toast, period, svcId, parkPrefs, setParkPrefs, beforeReorder: captureFlip });
  const {
    morning, activeBus, setActiveBus, busQuery, setBusQuery, busColor, parkPoints, picking, setPicking, nameOf, specOf, setEnd,
    endPins, busesUsed, mapStops, routeColors, polylines, onStopClick, busName, hiddenKpis, toggleKpi, showAllKpis,
    rank, typeOnly, pressKpi, clearRank, kpiOn, kpiTitle, busList,
  } = board;
  const [kpiMenu, setKpiMenu] = useState(false);
  const tiles = planTiles(board, t);
  const shownTiles = visibleKpis(tiles, hiddenKpis);
  useLayoutEffect(() => {
    if (!flipFrom.current) return;
    Flip.from(flipFrom.current, { ...springTween("move"), nested: true, onEnter: (els) => gsap.fromTo(els, { opacity: 0 }, { opacity: 1, duration: 0.2 }) });
    flipFrom.current = null;
  }, [rank, typeOnly]);

  // fill most of the viewport — the New-plan tab opens as a big map cockpit; a toggle blows it up to
  // true fullscreen (covers the header/tabs). Height tracks the window so it stays right on resize.
  const [winH, setWinH] = useState(() => (typeof window !== "undefined" ? window.innerHeight : 800));
  useEffect(() => {
    const on = () => setWinH(window.innerHeight);
    window.addEventListener("resize", on); return () => window.removeEventListener("resize", on);
  }, []);
  const [full, setFull] = useState(false);
  const [showKpis, setShowKpis] = useState(true);
  const [showBuses, setShowBuses] = useState(true);
  const containerH = full ? winH : Math.max(540, winH - 200);
  const PAD = 16; // consistent inset for the floating overlays

  // Apple "liquid glass" for the floating overlays — theme-aware so it stays readable on the dark
  // map (dark frosted glass) as well as on the light/neutral maps (bright frosted glass).
  const glassDark = t.dark;
  const glass = {
    background: glassDark ? "rgba(20,28,38,0.74)" : "rgba(255,255,255,0.62)",
    backdropFilter: "blur(16px) saturate(180%)", WebkitBackdropFilter: "blur(16px) saturate(180%)",
    border: "1px solid " + (glassDark ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.55)"),
    boxShadow: glassDark
      ? "0 8px 30px rgba(0,0,0,.5), inset 0 1px 1px rgba(255,255,255,0.10)"
      : "0 8px 30px rgba(15,23,42,.20), inset 0 1px 1px rgba(255,255,255,0.75), inset 0 -1px 2px rgba(255,255,255,0.35)",
  };
  // frosted tints for the tiles / cards / inputs / tracks nested inside the glass panels
  const glassInner = glassDark ? "rgba(255,255,255,0.07)" : "rgba(255,255,255,0.5)";
  const glassInnerBorder = glassDark ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.6)";
  const glassBtn = glassDark ? "rgba(255,255,255,0.14)" : "rgba(255,255,255,0.7)";
  const glassTrack = glassDark ? "rgba(255,255,255,0.14)" : "rgba(15,23,42,0.08)";
  const glassDivider = glassDark ? "rgba(255,255,255,0.14)" : "rgba(15,23,42,0.1)";
  const PANEL_W = 300; // right bus panel width
  const PANEL_H = 680; // bus panel height — grows downwards from the top inset. Still capped
                       // (see maxHeight) so it never runs past the map on a short window;
                       // the card grid inside scrolls once the list outgrows it

  return (
    <div className={full ? "fixed inset-0 z-[1500] overflow-hidden" : "relative rounded-2xl overflow-hidden"}
      style={{ height: containerH, border: full ? "none" : "1px solid " + t.border, background: t.surface, marginTop: full ? 0 : undefined }}>
      {/* base map — click stops to assign to the active bus */}
      <GMap t={t} stops={mapStops} routeColors={routeColors} depot={depot} polylines={polylines} pins={endPins} onSelect={onStopClick} height={containerH} scrollWheelZoom={true} autoFit={false} />

      {/* Park picker — floats beside the bus panel, over the map, so the route and its two end
          pins stay visible while the place is chosen. */}
      {/* Clear of the stats panel rather than over it: the ride time and cost are exactly what
          you are weighing while choosing where to leave the bus, so covering them would hide
          the reason for the decision. */}
      {picking && (
        <div className="absolute z-[800]" style={{ bottom: PAD, right: showBuses ? PANEL_W + PAD * 2 : PAD, width: 268 }}>
          <ParkPicker t={t} points={parkPoints}
            busName={nameOf(picking.busId)}
            which={picking.which}
            current={specOf(picking.busId, picking.which)}
            onPick={(spec) => setEnd(picking.busId, picking.which, spec)}
            onClose={() => setPicking(null)}
            glass={glass} glassInner={glassInner} />
        </div>
      )}

      {/* fullscreen toggle — bottom-left, clear of the panels/attribution */}
      <button type="button" onClick={() => setFull((f) => !f)} title={full ? "Exit fullscreen" : "Fullscreen map"}
        className="absolute z-[600] rounded-lg px-3 py-1.5 text-xs font-semibold flex items-center gap-1.5" style={{ bottom: PAD, left: PAD, ...glass }}>
        {full ? <><Minimize2 size={13} /> Exit fullscreen</> : <><Maximize2 size={13} /> Fullscreen</>}
      </button>

      {/* restore buttons when a panel is hidden */}
      {!showKpis && (
        <button type="button" onClick={() => setShowKpis(true)} title="Show stats"
          className="absolute z-[600] rounded-lg px-3 py-1.5 text-xs font-semibold flex items-center gap-1.5" style={{ top: PAD, left: 64, color: t.text, ...glass }}>
          <BarChart3 size={13} /> Stats
        </button>
      )}
      {!showBuses && (
        <button type="button" onClick={() => setShowBuses(true)} title="Show buses"
          className="absolute z-[600] rounded-lg px-3 py-1.5 text-xs font-semibold flex items-center gap-1.5" style={{ top: PAD, right: PAD, color: t.text, ...glass }}>
          <Bus size={13} /> Buses ({busesUsed}/{fleet.length})
        </button>
      )}

      {/* KPI glass strip — floats over the top of the map (clear of the zoom controls / bus panel) */}
      {showKpis && (
      <div className="absolute z-[600] rounded-2xl px-3 py-2" style={{ top: PAD, left: 64, right: showBuses ? PANEL_W + PAD * 2 : PAD, ...glass }}>
        <div className="flex items-center gap-1.5 text-[11px] font-medium mb-1.5" style={{ color: activeBus ? t.primary : t.muted }}>
          <MousePointerClick size={13} />
          {activeBus
            ? (morning
              ? <><b>Morning · {busName}</b> — first click = where the bus starts; each next stop is picked up on the way to the factory.</>
              : <><b>Assigning to {busName}</b> — click stops on the map to add/remove (click several for multiple).</>)
            : <>Pick a bus on the right, then click stops on the map to assign them.{morning ? " Morning plan: routes run stops → factory." : ""}</>}
          {activeBus && <button type="button" onClick={() => setActiveBus(null)} className="inline-flex items-center gap-1 rounded-lg px-2 py-0.5 font-semibold" style={{ border: "1px solid " + t.border, background: glassBtn, color: t.text, cursor: "pointer" }}><X size={11} /> Done</button>}
          <div className={"relative " + (activeBus ? "" : "ml-auto")}>
            <button type="button" onClick={() => setKpiMenu((o) => !o)} title="Choose which stats to show"
              className="inline-flex items-center gap-1 rounded-lg px-2 py-0.5 font-semibold"
              style={{ border: "1px solid " + (kpiMenu ? t.primary : t.border), background: glassBtn,
                       color: kpiMenu ? t.primary : t.text, cursor: "pointer" }}>
              <SlidersHorizontal size={11} /> {KPI_DEFS.length - hiddenKpis.size}/{KPI_DEFS.length}
            </button>
            {kpiMenu && (
              <>
                <div className="fixed inset-0" style={{ zIndex: 40 }} onClick={() => setKpiMenu(false)} />
                <div className="absolute right-0 mt-1.5 rounded-2xl p-2 w-64" style={{ zIndex: 41, ...glass }}>
                  <div className="flex items-center justify-between px-1.5 pb-1.5">
                    <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: t.muted }}>Stats to show</span>
                    <button type="button" onClick={showAllKpis}
                      className="text-[10px] rounded-lg px-2 py-0.5 font-semibold"
                      style={{ border: "1px solid " + t.border, background: glassBtn, color: t.text, cursor: "pointer" }}>All</button>
                  </div>
                  <div className="max-h-72 overflow-auto">
                    {KPI_DEFS.map((d) => (
                      <label key={d.key} className="flex items-start gap-2 px-1.5 py-1 rounded-xl cursor-pointer"
                        onMouseEnter={(e) => { e.currentTarget.style.background = glassInner; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}>
                        <input type="checkbox" checked={!hiddenKpis.has(d.key)} style={{ marginTop: 3, cursor: "pointer" }}
                          onChange={() => toggleKpi(d.key)} />
                        <span>
                          <span className="text-[11px] font-semibold block" style={{ color: t.text }}>{d.label}</span>
                          <span className="text-[10px]" style={{ color: t.muted }}>{d.hint}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
          <button type="button" onClick={() => setShowKpis(false)} title="Hide stats" style={{ color: t.muted, cursor: "pointer" }}><EyeOff size={13} /></button>
        </div>
        {/* Was a fixed 4 columns for exactly 4 tiles. With the full KPI set — and a count that
            changes as you toggle them — it wraps instead, so the panel grows a row rather than
            squeezing eleven tiles into four slots. */}
        <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(86px, 1fr))" }}>
          {shownTiles.map((c) => {
            const on = kpiOn(c.key);
            return (
              <button key={c.key} type="button" onClick={() => pressKpi(c.key)} title={kpiTitle(c.key)} aria-pressed={on}
                className="text-left rounded-xl px-2 py-1 relative overflow-hidden transition-colors"
                style={{ background: on ? t.primarySoft : glassInner, border: "1px solid " + (on ? t.primary : glassInnerBorder), cursor: "pointer" }}>
                {/* rail only when the accent came from a threshold — see Tile in Dashboard.jsx */}
                {c.accent && <span className="absolute left-0 top-0 bottom-0 w-1" style={{ background: c.accent }} />}
                <div className={"text-[9px] uppercase tracking-wider truncate leading-tight" + (c.accent ? " pl-1.5" : "")} style={{ color: on ? t.primary : t.muted }}>
                  {c.label}{on && rank && !TYPE_KEYS[c.key] ? (rank.dir === "desc" ? " ↓" : " ↑") : ""}
                </div>
                <div className={"text-base font-bold tabular-nums leading-tight" + (c.accent ? " pl-1.5" : "")} style={{ color: t.text }}>{c.value}</div>
                <div className={"text-[9px] truncate leading-tight" + (c.accent ? " pl-1.5" : "")} style={{ color: c.dc || t.muted }}>{c.sub}</div>
              </button>
            );
          })}
        </div>
        {/* always-on legend so the stop-colour meaning never has to be recalled mid-rebuild */}
        <div className="flex items-center gap-3 mt-2 text-[9px] font-medium" style={{ color: t.muted }}>
          <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ background: UNADDED }} /> Unassigned</span>
          <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ background: ADDED }} /> On a bus</span>
          {activeBus && <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ background: busColor[activeBus] }} /> This bus’s stops</span>}
        </div>
      </div>
      )}

      {/* Bus glass panel — floats on the right of the map */}
      {showBuses && (
      <div className="absolute z-[600] rounded-2xl flex flex-col overflow-hidden" style={{ top: PAD, right: PAD, width: PANEL_W, maxHeight: `calc(100% - ${PAD * 2}px)`, height: PANEL_H, ...glass }}>
        <div className="flex items-center justify-between px-3 pt-3 pb-2">
          <span className="text-xs font-bold uppercase tracking-wider" style={{ color: t.text }}>Your buses</span>
          <div className="flex items-center gap-2">
            <span className="text-[11px]" style={{ color: t.muted }}>{busesUsed}/{fleet.length} used</span>
            <button type="button" onClick={() => setShowBuses(false)} title="Hide bus list" style={{ color: t.muted, cursor: "pointer" }}><EyeOff size={14} /></button>
          </div>
        </div>
        <div className="px-3 pb-2">
          <input value={busQuery} onChange={(e) => setBusQuery(e.target.value)} placeholder="Find a bus…"
            className="w-full rounded-lg px-3 py-2 text-sm outline-none" style={{ border: "1px solid " + t.border, background: glassInner, color: t.text }} />
        </div>
        {(rank || typeOnly) && (
          <div className="flex items-center gap-2 px-3 pb-2 text-[11px]">
            <span className="font-semibold truncate" style={{ color: t.primary }}>
              {[rank && `By ${BUS_RANK[rank.key].label.toLowerCase()}, ${dirWords(rank.dir)}`, typeOnly && (typeOnly === "own" ? "owned only" : "rental only")].filter(Boolean).join(" · ")}
            </span>
            <button type="button" onClick={clearRank}
              className="ml-auto rounded-lg px-2 py-0.5 font-semibold flex-shrink-0"
              style={{ border: "1px solid " + t.border, background: glassBtn, color: t.text, cursor: "pointer" }}>Clear</button>
          </div>
        )}
        <div ref={busGridRef} className="grid grid-cols-2 gap-2 overflow-y-auto px-3 pb-3">
          {busList.map(({ item: r, value, rank: pos }) => {
            const on = activeBus === r.bus.id;
            const fillCol = r.overCap ? t.poor : r.overSeats ? t.watch : r.stopIds.length ? t.good : t.border;
            return (
              // div-with-role, not <button>: the card holds the wand/trash <button>s and
              // nested buttons are invalid DOM (React validateDOMNesting warning)
              <div key={r.bus.id} role="button" tabIndex={0} onClick={() => setActiveBus(on ? null : r.bus.id)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setActiveBus(on ? null : r.bus.id); } }}
                className="text-left rounded-xl p-2.5 transition-all" style={{
                  border: "1.5px solid " + (on ? t.primary : r.overCap ? t.poor : glassInnerBorder),
                  background: on ? t.primarySoft : glassInner,
                  boxShadow: on ? "0 0 0 3px " + t.primarySoft : "none", cursor: "pointer",
                }}>
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: busColor[r.bus.id] }} />
                  <span className="text-xs font-semibold truncate" style={{ color: t.text }}>{r.bus.name}</span>
                </div>
                {pos != null && (
                  <div className="text-[11px] font-bold tabular-nums mb-1 truncate">
                    <span style={{ color: t.primary }}>#{pos}</span> <span style={{ color: t.text }}>{BUS_RANK[rank.key].fmt(value)}</span>
                  </div>
                )}
                <div className="h-1 rounded-full overflow-hidden mb-1" style={{ background: glassTrack }}>
                  <div className="h-full rounded-full" style={{ width: Math.min(100, r.fill * 100) + "%", background: fillCol }} />
                </div>
                <div className="flex items-center justify-between text-[10px]" style={{ color: r.overCap ? t.poor : t.muted }}>
                  <span>{r.bus.type} · {r.cap}</span>
                  <span className="tabular-nums font-semibold">{r.heads}/{r.cap}</span>
                </div>
                {on && r.stopIds.length > 0 && (
                  <>
                    <div className="flex items-center gap-2 mt-1.5 pt-1.5" style={{ borderTop: "1px solid " + glassDivider }}>
                      <span className="text-[10px]" style={{ color: t.muted }}>{Math.round(r.ride)}m · ₹{Math.round(r.cost)}</span>
                      <span className="flex-1" />
                      <button type="button" title="Auto-sequence" onClick={(e) => { e.stopPropagation(); editor.autoSequence(r.bus.id); }} style={{ color: t.muted, cursor: "pointer" }}><Wand2 size={12} /></button>
                      <button type="button" title="Clear this bus — removes all its stops" aria-label={`Clear all stops from ${r.bus.name}`} onClick={(e) => { e.stopPropagation(); editor.clearBus(r.bus.id); }}
                        className="rounded-lg p-0.5 transition-colors" style={{ color: t.poor, cursor: "pointer" }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = t.poor + "1f")} onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}><Trash2 size={12} /></button>
                    </div>
                    {/* The two ends of this bus's run, as two small chips. They read S and P to
                        match the pins on the map and the layover rails on the Timings clock, so
                        the same two letters mean the same two things everywhere. A chip is
                        filled once that end has been moved off its default. */}
                    <div className="flex items-center gap-1 mt-1.5">
                      {[["start", "S", START_COLOR], ["park", "P", PARK_COLOR]].map(([which, letter, col]) => {
                        const spec = specOf(r.bus.id, which);
                        const set = spec.kind !== "auto";
                        const open = picking && picking.busId === r.bus.id && picking.which === which;
                        return (
                          <button key={which} type="button"
                            aria-label={`Set where ${r.bus.name} ${which === "start" ? "starts" : "parks"}`}
                            title={`${r.bus.name} ${which === "start" ? "starts from" : "parks at"}: ` +
                                   `${parkLabel(spec, which)}. Click to change.`}
                            onClick={(e) => { e.stopPropagation(); setPicking(open ? null : { busId: r.bus.id, which }); }}
                            className="flex-1 min-w-0 inline-flex items-center gap-1 rounded-lg px-1.5 py-0.5 text-[9px] font-bold transition"
                            style={{ background: open ? col : set ? col + "22" : glassBtn,
                                     color: open ? "#fff" : set ? col : t.muted,
                                     border: "1px solid " + (open || set ? col : glassInnerBorder), cursor: "pointer" }}>
                            <span style={{ flexShrink: 0 }}>{letter}</span>
                            <span className="truncate font-semibold">{parkLabel(spec, which)}</span>
                          </button>
                        );
                      })}
                    </div>
                    {r.estimatedEnds && (
                      <div className="text-[9px] mt-1" style={{ color: t.watch }}>
                        one end is off the road matrix — its legs are straight-line estimates
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
      )}
    </div>
  );
}
