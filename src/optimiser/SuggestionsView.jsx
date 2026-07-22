/* ============================================================================
 * optimiser/SuggestionsView.jsx — dynamic fleet recommendations
 * ----------------------------------------------------------------------------
 * Reads the CURRENT solver plan (public/solver_result.json) and computes what to
 * do with the fleet — grow / shrink / buy owned / add rentals / rebalance — with
 * the reasoning and an estimated impact on each objective. Everything is derived
 * from the live numbers, so the advice changes when the plan changes.
 *
 * Objectives scored (fixed order, every card shows all five — untouched = "no change"):
 *   O1 seating   — utilisation ≤ 100% (a real seat for everyone)
 *   O2 ride time — average ride 50–60 min
 *   O3 cost      — ₹/head/day as low as possible
 *   O4 fleet use — every bus dispatched
 *   O5 split     — owned = close/dense stops, rentals = far/isolated
 * ==========================================================================*/
import React, { useEffect, useMemo, useRef, useState } from "react";
import { gsap } from "gsap";
import { useGSAP } from "@gsap/react";
import { Card, Btn, Empty } from "./ui.jsx";
import { activePlanUrl } from "./planOptions.js";
import {
  RotateCcw, TrendingUp, TrendingDown, Minus, ChevronDown, Lightbulb,
  Bus, Users, Clock, IndianRupee, Scale, AlertTriangle, CheckCircle2, Plus, Shuffle, Split,
} from "lucide-react";

const prefersReduced = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
/* entrance guard — never run a from() entrance on a hidden tab or content sticks invisible */
const canEntrance = () =>
  !prefersReduced() && (typeof document === "undefined" || document.visibilityState === "visible");

/* fixed objective order — every card renders ALL of these, same order, so the eye
   tracks the same column card-to-card; untouched ones stay muted ("no change"). */
const OBJ_ORDER = [
  ["seats", "Seating"],
  ["ride", "Avg ride"],
  ["cost", "Cost/head"],
  ["fleet", "Fleet use"],
  ["split", "Own near / rent far"],
];

/* animated number that counts up on mount (current computed value only) */
function CountN({ value, decimals = 0, suffix = "", prefix = "" }) {
  const ref = useRef(null);
  useGSAP(() => {
    const el = ref.current;
    if (!el) return;
    if (!canEntrance()) { el.textContent = prefix + value.toFixed(decimals) + suffix; return; }
    const obj = { v: 0 };
    el.textContent = prefix + (0).toFixed(decimals) + suffix;
    gsap.to(obj, {
      v: value, duration: 0.5, ease: "power2.out", delay: 0.1,
      onUpdate: () => { el.textContent = prefix + obj.v.toFixed(decimals) + suffix; },
    });
  }, [value]);
  return <span ref={ref} />;
}

/* ---------------- previously-ran routes vs optimised plan (same cost model) ---------------- */
function buildComparison(cur, opt) {
  if (!cur || !cur.buses || !opt || !opt.overall) return null;
  const a = opt.assumptions || {};
  const FIX = (a.own_driver_day ?? 692) + (a.own_maint_day ?? 471) + (a.own_insurance_day ?? 676);
  const perKm = a.own_diesel_per_km ?? 18;
  const rentCost = (km) => (km <= 80 ? 1700 : km <= 95 ? 1900 : Math.max(1900, 18.7 * km));
  const buses = cur.buses.filter((b) => b.riders > 0);
  let cost = 0, km = 0, riders = 0, seats = 0, noKm = 0;
  const rides = [], wr = [];
  for (const b of buses) {
    const dayKm = 2 * (b.km || 0);                       // chain model: both trips
    if (!b.km) noKm++;
    cost += b.type === "rental" ? rentCost(dayKm) : FIX + dayKm * perKm;
    km += dayKm; riders += b.riders; seats += b.seat || 0;
    if (b.trip) { rides.push(b.trip); wr.push([b.trip, b.riders]); }
  }
  const o = opt.overall;
  const prev = {
    buses: buses.length, riders, seats, util: seats ? (riders / seats) * 100 : 0, km,
    avg_ride: wr.length ? wr.reduce((s, [t, r]) => s + t * r, 0) / wr.reduce((s, [, r]) => s + r, 0) : 0,
    max_ride: rides.length ? Math.max(...rides) : 0, cost, cost_head: riders ? cost / riders : 0,
  };
  const dCost = prev.cost - o.cost;
  const wd = (a.working_days ?? 26) * 12;                 // working days / year
  return { prev, opt: o, dCost, perMonth: dCost * (a.working_days ?? 26), perYear: dCost * wd, noKm };
}

/* ----------------------------- the suggestion engine ----------------------------- */
function buildSuggestions(d) {
  const o = d.overall, own = d.owned, rent = d.rental, a = d.assumptions || {};
  const routes = (d.routes || []).filter((r) => r.stops > 0);
  const R = (x) => Math.round(x);

  // --- current objective state ---
  const deficit = Math.max(0, o.riders - o.seats);
  const avgFar = (list) => list.length ? list.reduce((s, r) => s + (r.km_to_farthest || 0), 0) / list.length : 0;
  const ownFar = avgFar(routes.filter((r) => r.type === "own"));
  const rentFar = avgFar(routes.filter((r) => r.type !== "own"));
  const splitOk = rentFar > ownFar;
  const idle = o.buses - routes.length;

  const objectives = [
    { key: "seats", icon: Users, label: "Seating", value: R(o.util) + "%", target: "≤100%",
      met: o.util <= 100, detail: deficit > 0 ? `${deficit} riders over seat count` : "everyone has a seat" },
    { key: "ride", icon: Clock, label: "Avg ride", value: R(o.avg_ride) + " min", target: "50–60",
      met: o.avg_ride <= 60, detail: `max ${R(o.max_ride)} min` },
    { key: "cost", icon: IndianRupee, label: "Cost / head", value: "₹" + o.cost_head.toFixed(1), target: "minimise",
      met: true, detail: `owned ₹${own.cost_head.toFixed(0)} · rental ₹${rent.cost_head.toFixed(0)}` },
    { key: "fleet", icon: Bus, label: "Fleet used", value: `${routes.length}/${o.buses}`, target: "all",
      met: idle === 0, detail: idle === 0 ? "no idle buses" : `${idle} idle` },
    { key: "split", icon: Scale, label: "Own near / rent far", value: `${ownFar.toFixed(0)} / ${rentFar.toFixed(0)} km`, target: "",
      met: splitOk, detail: splitOk ? "rentals reach farther — split holds" : "owned reaching farther than rentals" },
  ];

  // --- cost building blocks (from the plan's own assumptions) ---
  const ownFixedDay = (a.own_driver_day ?? 692) + (a.own_maint_day ?? 471) + (a.own_insurance_day ?? 676);
  const ownKmPerBus = own.buses ? own.km / own.buses : 60;
  const ownBusDay = ownFixedDay + ownKmPerBus * (a.own_diesel_per_km ?? 18);   // ≈ one more owned 55-seater / day
  const rentBusDay = 1700;                                                     // slab base for a short rental route
  const ownCapMode = 55, rentCapMode = 15;

  const NOCHANGE = { dir: "neutral", text: "no change" };
  const sugs = [];

  /* S1 — seat deficit: grow the fleet (owned vs rental compared honestly) */
  if (deficit > 0) {
    const nOwn = Math.ceil(deficit / ownCapMode);
    const nRent = Math.ceil(deficit / rentCapMode);
    const ownAddCost = nOwn * ownBusDay, rentAddCost = nRent * rentBusDay;
    const newUtilOwn = (o.riders / (o.seats + nOwn * ownCapMode)) * 100;
    const newCostHeadOwn = (o.cost + ownAddCost) / o.riders;
    const perSeatOwn = ownBusDay / ownCapMode, perSeatRent = rentBusDay / rentCapMode;
    sugs.push({
      id: "grow-owned", icon: Plus, priority: "critical", category: "Capacity",
      title: `Add ~${nOwn} owned ${ownCapMode}-seaters to seat everyone`,
      summary: `${deficit} riders travel over seat count today (${R(o.util)}% utilisation). ~${nOwn} more owned buses closes the gap.`,
      impacts: {
        seats: { dir: "good", text: `~${R(o.util)}% → ~${R(newUtilOwn)}%` },
        ride: { dir: "good", text: "est. −3 to −7 min (shorter routes)" },
        cost: { dir: "bad", text: `~₹${o.cost_head.toFixed(1)} → ~₹${newCostHeadOwn.toFixed(1)} (+₹${R(ownAddCost).toLocaleString("en-IN")}/day)` },
        fleet: NOCHANGE,
        split: { dir: "good", text: "new owned take close stops, freeing rentals for far ones" },
      },
      reasoning: [
        `Per NEW seat per day: owned ≈ ₹${perSeatOwn.toFixed(0)} vs rental ≈ ₹${perSeatRent.toFixed(0)} — owned is ~${(perSeatRent / perSeatOwn).toFixed(1)}× cheaper at this scale. Your owned fleet already runs at ₹${own.cost_head.toFixed(0)}/head vs ₹${rent.cost_head.toFixed(0)}/head for rentals.`,
        `One owned ${ownCapMode}-seater ≈ ₹${R(ownBusDay).toLocaleString("en-IN")}/day to run (driver ₹${a.own_driver_day ?? 692} + maint ₹${a.own_maint_day ?? 471} + insurance ₹${a.own_insurance_day ?? 676} + ~${ownKmPerBus.toFixed(0)} km diesel). The rental path needs ~${nRent} more 15-seaters ≈ ₹${R(rentAddCost).toLocaleString("en-IN")}/day — ~${(rentAddCost / ownAddCost).toFixed(1)}× the owned cost for the same seats.`,
        `Purchase capital is excluded here (operating view) — owned buses are an investment that pays back vs rentals over time.`,
      ],
      tradeoff: "Daily operating cost rises — this buys comfort (no standing) and safety headroom, not savings.",
    });
  } else {
    const spare = o.seats - o.riders;
    if (spare > rentCapMode * 2) {
      const cut = Math.floor(spare / rentCapMode) - 1;
      sugs.push({
        id: "shrink", icon: TrendingDown, priority: "medium", category: "Capacity",
        title: `Release up to ${cut} rental buses — ${spare} spare seats`,
        summary: `Utilisation is ${R(o.util)}% — the fleet is bigger than demand.`,
        impacts: {
          seats: { dir: "neutral", text: "stays ≤100%" },
          ride: NOCHANGE,
          cost: { dir: "good", text: `est. −₹${R(cut * rentBusDay).toLocaleString("en-IN")}/day` },
          fleet: { dir: "good", text: "smaller fleet, fully used" },
          split: NOCHANGE,
        },
        reasoning: ["Rental slabs are the flexible layer — release rentals first, keep owned running."],
        tradeoff: "Less absorbing capacity for headcount spikes.",
      });
    }
  }

  /* S2 — rental → owned consolidation (running-cost economics) */
  const smallRentals = routes.filter((r) => r.type !== "own" && r.riders <= rentCapMode + 3 && r.km <= 110);
  const conv = Math.floor(smallRentals.length / 3);
  if (conv >= 1) {
    const savePer = 3 * rentBusDay - ownBusDay;
    sugs.push({
      id: "convert", icon: Shuffle, priority: "high", category: "Cost",
      title: `Long-term: buy owned to replace rentals — 3 rental routes ≈ 1 owned ${ownCapMode}-seater`,
      summary: `${smallRentals.length} small rental routes (≤${rentCapMode + 3} riders) cost ₹${rent.cost_head.toFixed(0)}/head — ${(rent.cost_head / own.cost_head).toFixed(1)}× your owned cost.`,
      impacts: {
        seats: NOCHANGE,
        ride: { dir: "bad", text: "merged routes est. +3 to +6 min for those riders" },
        cost: { dir: "good", text: `est. −₹${(conv * savePer / o.riders).toFixed(1)}/head (${conv} conversions ≈ ₹${R(conv * savePer).toLocaleString("en-IN")}/day)` },
        fleet: { dir: "neutral", text: `${conv * 3} rentals out, ${conv} owned in` },
        split: { dir: "neutral", text: "works only where 3 rental routes sit adjacent" },
      },
      reasoning: [
        `A rental day costs ₹${rentBusDay.toLocaleString("en-IN")}+ regardless of how few ride it — your small rental routes pay the full slab for ~${R(smallRentals.reduce((s, r) => s + r.riders, 0) / Math.max(1, smallRentals.length))} riders each.`,
        `An owned ${ownCapMode}-seater covering 3 adjacent rental areas carries the same riders for ≈ ₹${R(ownBusDay).toLocaleString("en-IN")}/day all-in — saving ~₹${R(savePer).toLocaleString("en-IN")}/day per consolidation.`,
        `Do it gradually: buy owned as rental contracts lapse, starting where rental routes cluster together.`,
      ],
      tradeoff: "Needs upfront purchase capital, and merged routes ride a little longer.",
    });
  }

  /* S3 — overloaded routes (worst >150%) */
  const over150 = routes.filter((r) => r.cap && r.riders / r.cap > 1.5).sort((x, y) => y.riders / y.cap - x.riders / x.cap);
  if (over150.length) {
    const worst = over150[0];
    sugs.push({
      id: "overload", icon: AlertTriangle, priority: "high", category: "Capacity",
      title: `Relieve ${over150.length} route${over150.length > 1 ? "s" : ""} running over 150%`,
      summary: `Worst: ${worst.name} at ~${R((worst.riders / worst.cap) * 100)}% (${worst.riders} riders on ${worst.cap} seats).`,
      impacts: {
        seats: { dir: "good", text: "removes standing on the worst buses" },
        ride: NOCHANGE,
        cost: { dir: "neutral", text: "≈ flat if rebalanced to under-full neighbours" },
        fleet: NOCHANGE,
        split: NOCHANGE,
      },
      reasoning: [
        `Over-150% buses: ${over150.slice(0, 4).map((r) => `${r.name} (~${R((r.riders / r.cap) * 100)}%)`).join(", ")}${over150.length > 4 ? ` +${over150.length - 4} more` : ""}.`,
        deficit > 0
          ? "With the fleet 100%+ full overall, real relief needs the extra buses from the first suggestion — rebalancing alone moves the standing elsewhere."
          : "Move their edge stops to adjacent buses running under 90%.",
      ],
      tradeoff: null,
    });
  }

  /* S4 — longest rides: dedicated split */
  const longRides = routes.filter((r) => r.ride > 90).sort((x, y) => y.ride - x.ride);
  if (longRides.length) {
    const top = longRides.slice(0, 3);
    sugs.push({
      id: "long", icon: Split, priority: "medium", category: "Routing",
      title: `Split the ${longRides.length} longest routes (> 90 min) with dedicated far-zone rentals`,
      summary: `${top.map((r) => `${r.name} ${R(r.ride)}m`).join(" · ")} — far villages chained onto long runs.`,
      impacts: {
        seats: NOCHANGE,
        ride: { dir: "good", text: "est. −2 to −4 min overall; affected riders save 20–40 min" },
        cost: { dir: "bad", text: `+₹${rentBusDay.toLocaleString("en-IN")}/day per extra far-zone rental` },
        fleet: { dir: "neutral", text: "+1 rental per split" },
        split: { dir: "good", text: "far tails go to rentals — exactly the intended split" },
      },
      reasoning: [
        "Their tail stops are far, low-headcount villages. Giving the tail to a dedicated 15-seat rental shortens the chain for everyone earlier on the route.",
        "Needs 1 extra rental per split (all current buses are dispatched).",
      ],
      tradeoff: "Cost rises a little per split — weigh against the ride-time win for those villages.",
    });
  }

  /* S5 — idle fleet (only if any) */
  if (idle > 0) {
    sugs.push({
      id: "idle", icon: Bus, priority: "high", category: "Fleet",
      title: `Dispatch or release the ${idle} idle bus${idle > 1 ? "es" : ""}`,
      summary: "An owned bus parked still costs its fixed day-rate; a rental not booked is pure saving.",
      impacts: {
        seats: NOCHANGE, ride: NOCHANGE, cost: NOCHANGE,
        fleet: { dir: "good", text: `${routes.length}/${o.buses} → ${o.buses}/${o.buses}` },
        split: NOCHANGE,
      },
      reasoning: ["Re-run the optimiser (it dispatches the full fleet when demand needs it) or release the idle rentals."],
      tradeoff: null,
    });
  }

  const rank = { critical: 0, high: 1, medium: 2 };
  sugs.sort((x, y) => rank[x.priority] - rank[y.priority]);

  // verdict line (plain language, driven by the worst state)
  const missed = objectives.filter((x) => x.met === false);
  const verdict = missed.length === 0
    ? { tone: "good", text: "All objectives are met on the current plan — the suggestions below are optional improvements." }
    : {
        tone: missed.some((m) => m.key === "seats") ? "poor" : "watch",
        text: (deficit > 0 ? `The fleet is over-loaded (${R(o.util)}% — ${deficit} riders without a seat)` : `${missed[0].label} is off target`)
          + (o.avg_ride > 60 ? ` and rides run long (${R(o.avg_ride)} min avg)` : "")
          + `. ${sugs.length} change${sugs.length === 1 ? "" : "s"} recommended.`,
      };

  return { objectives, sugs, verdict };
}

/* ----------------------------- UI ----------------------------- */
const PRI = {
  critical: { label: "Critical", color: "#e11d48" },
  high: { label: "High", color: "#d97706" },
  medium: { label: "Medium", color: "#0284c7" },
};

function ImpactChip({ t, label, imp }) {
  const good = imp.dir === "good", bad = imp.dir === "bad";
  const col = good ? t.good : bad ? t.poor : t.faint;
  const bg = good ? t.goodSoft : bad ? t.poorSoft : t.surface2;
  const Icon = good ? TrendingUp : bad ? TrendingDown : Minus;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs"
      style={{ background: bg, color: imp.dir === "neutral" ? t.faint : t.text }}>
      <Icon size={12} style={{ color: col, flex: "none" }} strokeWidth={bad ? 2.6 : 2} />
      <b style={{ color: col, fontWeight: bad ? 800 : 700 }}>{label}:</b> {imp.text}
    </span>
  );
}

function SuggestionCard({ t, s }) {
  const [open, setOpen] = useState(false);
  const bodyRef = useRef(null);
  const pri = PRI[s.priority];
  const Icon = s.icon || Lightbulb;
  const negCount = OBJ_ORDER.filter(([k]) => s.impacts[k] && s.impacts[k].dir === "bad").length;
  const toggle = () => {
    const el = bodyRef.current;
    if (!el || prefersReduced()) { setOpen((o) => !o); return; }
    if (!open) {
      setOpen(true);
      requestAnimationFrame(() => {
        gsap.fromTo(el, { height: 0, autoAlpha: 0 }, { height: "auto", autoAlpha: 1, duration: 0.3, ease: "power2.out", clearProps: "height" });
      });
    } else {
      gsap.to(el, { height: 0, autoAlpha: 0, duration: 0.22, ease: "power2.in", onComplete: () => setOpen(false) });
    }
  };
  return (
    <div data-sfx="scard" className="rounded-2xl border relative overflow-hidden" style={{ background: t.surface, borderColor: negCount >= 2 ? t.poor : t.border }}>
      <span className="absolute left-0 top-0 bottom-0 w-1" style={{ background: pri.color }} />
      <button onClick={toggle} className="w-full text-left px-5 py-4" style={{ background: "transparent", cursor: "pointer" }}
        aria-expanded={open} aria-label={`${s.title}. Priority ${pri.label}. Click for reasoning.`}>
        <div className="flex items-start gap-3">
          <span className="rounded-xl p-2 mt-0.5" style={{ background: t.primarySoft, color: t.primary, flex: "none" }}><Icon size={17} /></span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-wider rounded-full px-2 py-0.5" style={{ color: "#fff", background: pri.color }}>{pri.label}</span>
              <span className="text-[10px] font-bold uppercase tracking-wider rounded-full px-2 py-0.5" style={{ color: t.muted, background: t.surface2 }}>{s.category}</span>
              <h4 className="font-semibold text-[15px] w-full sm:w-auto" style={{ color: t.text }}>{s.title}</h4>
            </div>
            <p className="text-sm mt-1" style={{ color: t.muted }}>{s.summary}</p>
            {/* fixed-order impact row — all five objectives, always the same order */}
            <div className="flex flex-wrap gap-1.5 mt-3">
              {OBJ_ORDER.map(([k, label]) => (
                <ImpactChip key={k} t={t} label={label} imp={s.impacts[k] || { dir: "neutral", text: "no change" }} />
              ))}
            </div>
          </div>
          <ChevronDown size={17} style={{ color: t.faint, flex: "none", transform: open ? "rotate(180deg)" : "none", transition: "transform .25s" }} />
        </div>
      </button>
      {open && (
        <div ref={bodyRef} style={{ overflow: "hidden" }}>
          <div className="px-5 pb-4 pl-14">
            <div className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color: t.faint }}>Why · the numbers</div>
            <ul className="space-y-1.5">
              {s.reasoning.map((r, i) => (
                <li key={i} className="text-sm flex gap-2" style={{ color: t.text }}>
                  <span style={{ color: t.primary, flex: "none" }}>—</span><span>{r}</span>
                </li>
              ))}
            </ul>
            {s.tradeoff && (
              <div className="mt-3 text-sm rounded-xl px-3 py-2 flex gap-2 items-start" style={{ background: t.watchSoft, color: t.text }}>
                <Scale size={14} style={{ color: t.watch, flex: "none", marginTop: 2 }} />
                <span><b style={{ color: t.watch }}>Trade-off:</b> {s.tradeoff}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function SuggestionsView({ t }) {
  const [data, setData] = useState(null);
  const [cur, setCur] = useState(null);      // previously-ran routes (live ERP snapshot)
  const [err, setErr] = useState(false);
  const rootRef = useRef(null);
  const load = () => {
    setErr(false); setData(null);
    fetch(activePlanUrl() + "?ts=" + Date.now()).then((r) => (r.ok ? r.json() : Promise.reject())).then(setData).catch(() => setErr(true));
    fetch("/current_routes.json?ts=" + Date.now()).then((r) => (r.ok ? r.json() : null)).then(setCur).catch(() => {});
  };
  useEffect(load, []);

  const model = useMemo(() => (data ? buildSuggestions(data) : null), [data]);
  const cmp = useMemo(() => buildComparison(cur, data), [cur, data]);

  useGSAP(() => {
    if (!model || !canEntrance()) return;
    gsap.timeline({ defaults: { ease: "power2.out" } })
      .from('[data-sfx="verdict"]', { y: 10, autoAlpha: 0, duration: 0.35, clearProps: "transform,opacity,visibility" })
      .from('[data-sfx="obj"]', { y: 14, autoAlpha: 0, duration: 0.35, stagger: 0.05, clearProps: "transform,opacity,visibility" }, "-=0.15")
      .from('[data-sfx="scard"]', { y: 18, autoAlpha: 0, duration: 0.4, stagger: 0.08, clearProps: "transform,opacity,visibility" }, "-=0.15");
  }, { dependencies: [model], scope: rootRef });

  if (err) return <Empty t={t} title="No plan to analyse" sub="Generate the fleet plan first — suggestions are computed from it."><Btn t={t} onClick={load}><RotateCcw size={15} /> Reload</Btn></Empty>;
  if (!model) return <Card t={t}><div className="py-6 text-center" style={{ color: t.muted }}>Analysing the current plan…</div></Card>;

  const { objectives, sugs, verdict } = model;
  const metCount = objectives.filter((x) => x.met === true).length;
  const vCol = verdict.tone === "good" ? t.good : verdict.tone === "poor" ? t.poor : t.watch;

  return (
    <div ref={rootRef} className="space-y-4">
      {/* verdict banner — the one-glance diagnosis */}
      <div data-sfx="verdict" className="rounded-2xl border px-5 py-4 relative overflow-hidden flex items-start gap-3"
        style={{ background: t.surface, borderColor: t.border }}>
        <span className="absolute left-0 top-0 bottom-0 w-1" style={{ background: vCol }} />
        <span className="rounded-xl p-2" style={{ background: verdict.tone === "good" ? t.goodSoft : verdict.tone === "poor" ? t.poorSoft : t.watchSoft, color: vCol, flex: "none" }}>
          {verdict.tone === "good" ? <CheckCircle2 size={18} /> : <Lightbulb size={18} />}
        </span>
        <div>
          <div className="font-semibold" style={{ color: t.text }}>{verdict.text}</div>
          <div className="text-xs mt-1" style={{ color: t.muted }}>
            <b style={{ color: t.text }}><CountN value={metCount} /> of {objectives.length}</b> objectives met · ordered by urgency, then impact · estimates from the plan's own cost model
          </div>
        </div>
      </div>

      {/* objective scoreboard */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {objectives.map((o) => {
          const Icon = o.icon;
          const col = o.met === true ? t.good : o.met === false ? t.poor : t.muted;
          return (
            <div key={o.key} data-sfx="obj" className="rounded-2xl border p-3.5 relative overflow-hidden" style={{ background: t.surface, borderColor: t.border }}>
              <span className="absolute left-0 top-0 bottom-0 w-1" style={{ background: col }} />
              <div className="flex items-center gap-1.5 text-xs uppercase tracking-wider" style={{ color: t.muted }}>
                <Icon size={13} /> {o.label}
              </div>
              <div className="text-lg font-bold mt-1.5 tabular-nums flex items-center gap-1.5" style={{ color: t.text }}>
                {o.value}
                {o.met === true ? <CheckCircle2 size={14} style={{ color: t.good }} /> :
                 o.met === false ? <AlertTriangle size={14} style={{ color: t.poor }} /> : null}
              </div>
              <div className="text-[11px] mt-0.5" style={{ color: t.faint }}>{o.target && `target ${o.target} · `}{o.detail}</div>
            </div>
          );
        })}
      </div>

      {/* previously-ran routes vs optimised plan */}
      {cmp && (() => {
        const R = (x) => Math.round(x);
        const inr = (x) => "₹" + R(x).toLocaleString("en-IN");
        const rows = [
          ["Cost / day", inr(cmp.prev.cost), inr(cmp.opt.cost), cmp.dCost, (d) => (d > 0 ? "−" : "+") + "₹" + R(Math.abs(d)).toLocaleString("en-IN"), cmp.dCost > 0],
          ["Cost / head", "₹" + cmp.prev.cost_head.toFixed(1), "₹" + cmp.opt.cost_head.toFixed(1), cmp.prev.cost_head - cmp.opt.cost_head, (d) => (d > 0 ? "−₹" : "+₹") + Math.abs(d).toFixed(1), null],
          ["Utilisation", R(cmp.prev.util) + "%", R(cmp.opt.util) + "%", cmp.prev.util - cmp.opt.util, (d) => (d > 0 ? "−" : "+") + R(Math.abs(d)) + " pts", cmp.prev.util > 100 && cmp.opt.util < cmp.prev.util],
          ["Avg ride", R(cmp.prev.avg_ride) + " min*", R(cmp.opt.avg_ride) + " min", cmp.prev.avg_ride - cmp.opt.avg_ride, (d) => (d > 0 ? "−" : "+") + R(Math.abs(d)) + " min", cmp.opt.avg_ride <= cmp.prev.avg_ride],
          ["Km / day", R(cmp.prev.km).toLocaleString("en-IN"), R(cmp.opt.km).toLocaleString("en-IN"), cmp.prev.km - cmp.opt.km, (d) => (d > 0 ? "−" : "+") + R(Math.abs(d)) + " km", cmp.prev.km > cmp.opt.km],
          ["Riders covered", cmp.prev.riders.toLocaleString("en-IN"), cmp.opt.riders.toLocaleString("en-IN"), null, null, null],
        ];
        const saveCol = cmp.dCost >= 0 ? t.good : t.poor;
        return (
          <div data-sfx="scard" className="rounded-2xl border relative overflow-hidden" style={{ background: t.surface, borderColor: t.border }}>
            <span className="absolute left-0 top-0 bottom-0 w-1" style={{ background: t.primary }} />
            <div className="px-5 py-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-xl p-2" style={{ background: t.primarySoft, color: t.primary }}><Scale size={17} /></span>
                <h4 className="font-semibold text-[15px]" style={{ color: t.text }}>Previously-ran routes vs the optimised plan</h4>
                <span className="text-[10px] font-bold uppercase tracking-wider rounded-full px-2 py-0.5" style={{ color: t.muted, background: t.surface2 }}>same cost model</span>
              </div>
              <div className="overflow-x-auto mt-3">
                <table className="w-full text-sm" style={{ color: t.text }}>
                  <thead>
                    <tr className="text-xs uppercase tracking-wider" style={{ color: t.muted }}>
                      <th className="text-left py-1.5 pr-3 font-semibold">Metric</th>
                      <th className="text-right py-1.5 px-3 font-semibold">Previous (ERP routes)</th>
                      <th className="text-right py-1.5 px-3 font-semibold">Optimised plan</th>
                      <th className="text-right py-1.5 pl-3 font-semibold">Change</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(([label, a, b, d, fmt, good]) => (
                      <tr key={label} style={{ borderTop: "1px solid " + t.border }}>
                        <td className="py-1.5 pr-3" style={{ color: t.muted }}>{label}</td>
                        <td className="py-1.5 px-3 text-right tabular-nums">{a}</td>
                        <td className="py-1.5 px-3 text-right tabular-nums font-semibold">{b}</td>
                        <td className="py-1.5 pl-3 text-right tabular-nums font-bold"
                          style={{ color: d == null ? t.faint : good == null ? t.text : good ? t.good : t.poor }}>
                          {d == null ? "—" : fmt(d)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-3 text-sm rounded-xl px-3 py-2.5" style={{ background: cmp.dCost >= 0 ? t.goodSoft : t.poorSoft, color: t.text }}>
                <b style={{ color: saveCol }}>
                  Estimated spending change: {cmp.dCost >= 0 ? "saves" : "adds"} ₹{R(Math.abs(cmp.dCost)).toLocaleString("en-IN")}/day
                  ≈ ₹{R(Math.abs(cmp.perMonth)).toLocaleString("en-IN")}/month ≈ ₹{(Math.abs(cmp.perYear) / 100000).toFixed(1)} lakh/year
                </b>{" "}
                ({Math.abs((cmp.dCost / cmp.prev.cost) * 100).toFixed(1)}% of current spend) — while cutting overloading from {R(cmp.prev.util)}% to {R(cmp.opt.util)}%.
              </div>
              <p className="text-[11px] mt-2" style={{ color: t.faint }}>
                *Previous avg ride is the OSRM one-way trip time (approx. stop order, no stop dwell) so it reads optimistic; rider bases differ
                (previous counts the full roster{cmp.noKm ? `; ${cmp.noKm} previous buses lacked road km` : ""}). Both plans costed with the same
                owned fixed+diesel and rental-slab model — capital cost of buses excluded.
              </p>
            </div>
          </div>
        );
      })()}

      {/* suggestion cards */}
      <div className="space-y-3">
        {sugs.map((s) => <SuggestionCard key={s.id} t={t} s={s} />)}
      </div>

      <p className="text-xs px-1" style={{ color: t.faint }}>
        Figures marked "~ / est." are projections from the current plan's cost assumptions (diesel ₹{(data.assumptions?.own_diesel_per_km ?? 18)}/km,
        rental slab ₹1,700–1,900), not quotes. Re-run the optimiser after any fleet change to see the real numbers.
      </p>
    </div>
  );
}
