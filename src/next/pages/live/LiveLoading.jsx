/* Loading the Live page: the page's own layout, blurred, so nothing jumps when the data lands, with
   a small card on top where a bus travels a route and the real count of routes fetched so far. */
import React, { useRef } from "react";
import { MotionPathPlugin } from "gsap/MotionPathPlugin";
import { ERP_ROUTE_D, UNITS } from "../../../Dashboard.jsx";
import { CompanyDot, Progress, cx } from "../../ui.jsx";
import { count } from "../../format.js";
import { gsap, useGSAP } from "../../motion.js";

gsap.registerPlugin(MotionPathPlugin);

// static placeholders: the layer they sit in is blurred, so a pulse would only cost repaints
const Bone = ({ className }) => <div className={cx("rounded-tile bg-satin-2", className)} />;
const Pill = ({ className }) => <div className={cx("h-11 rounded-pill bg-white shadow-chip", className)} />;

/** The route draws itself while the bus rides it end to end. With reduced motion the route stays
 *  drawn and the bus waits halfway, held by CSS. A background tab needs no guard: the loop just
 *  waits for frames and carries on when the tab is shown. */
function RouteLoader() {
  const svg = useRef(null), route = useRef(null), bus = useRef(null);
  useGSAP(() => {
    const mm = gsap.matchMedia();
    mm.add("(prefers-reduced-motion: no-preference)", () => {
      gsap.timeline({ repeat: -1, defaults: { ease: "power1.inOut" } })
        .fromTo(route.current, { strokeDashoffset: 235 }, { strokeDashoffset: 0, duration: 1.15 })
        .to(route.current, { strokeDashoffset: -235, duration: 0.95 });
      gsap.to(bus.current, { motionPath: { path: route.current, align: route.current, alignOrigin: [0.5, 0.5] },
        duration: 2.1, ease: "none", repeat: -1, immediateRender: true });
    });
    return () => mm.revert();
  }, { scope: svg });
  return (
    <svg ref={svg} viewBox="0 0 120 120" width="112" height="112" aria-hidden className="mx-auto block">
      <path d={ERP_ROUTE_D} fill="none" className="stroke-satin-2" strokeWidth="5" strokeLinecap="round" />
      <path ref={route} d={ERP_ROUTE_D} fill="none" className="stroke-ink motion-reduce:[stroke-dashoffset:0]" strokeWidth="5"
        strokeLinecap="round" strokeDasharray="235" strokeDashoffset="235" />
      <circle cx="16" cy="100" r="5" className="fill-ink" />
      <circle cx="104" cy="20" r="5" className="fill-white stroke-ink" strokeWidth="3" />
      <circle ref={bus} r="6" className="fill-nova stroke-white motion-reduce:[transform:translate(62px,60px)]" strokeWidth="2.5" />
    </svg>
  );
}

export default function LiveLoading({ progress }) {
  const total = (progress && progress.total) || 0, done = (progress && progress.done) || 0;
  return (
    <div aria-busy="true" className="relative">
      <div aria-hidden className="pointer-events-none select-none opacity-70 blur-[6px]">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-hero bg-white p-5 shadow-card sm:col-span-2 sm:p-6">
            <Bone className="h-3 w-24" />
            <Bone className="mt-3 h-16 w-44" />
            <Bone className="mt-4 h-4 w-64 max-w-full" />
            <Bone className="mt-2 h-3 w-28" />
            <Bone className="mt-6 h-3 w-full" />
          </div>
          {[0, 1].map((i) => (
            <div key={i} className="flex min-h-[132px] flex-col rounded-card bg-white p-5 shadow-card sm:p-6">
              <Bone className="h-3.5 w-28" />
              <div className="mt-auto pt-3">
                <Bone className="h-7 w-32" />
                <Bone className="mt-2 h-2.5 w-20" />
                <Bone className="mt-3 h-3 w-48 max-w-full" />
              </div>
            </div>
          ))}
        </div>
        <div className="mt-6 flex flex-wrap items-end gap-3">
          <div className="w-full sm:w-[300px]">
            <Bone className="h-3 w-12" />
            <Pill className="mt-1.5 w-full" />
          </div>
          <div>
            <Bone className="h-3 w-10" />
            <div className="mt-1.5 flex gap-1.5">
              {["w-[88px]", "w-[112px]", "w-[104px]"].map((w) => <Pill key={w} className={w} />)}
            </div>
          </div>
          <div className="w-full sm:ml-auto sm:w-[300px]">
            <Bone className="h-3 w-8" />
            <Pill className="mt-1.5 w-full" />
          </div>
        </div>
        <div className="mt-4 flex flex-col gap-3">
          {UNITS.map((u) => (
            <div key={u} className="flex items-center gap-3 rounded-card bg-white px-4 py-4 shadow-card sm:px-5">
              <span className="h-8 w-8 shrink-0 rounded-pill bg-satin-2" />
              <CompanyDot unit={u} />
              <span className="min-w-0 flex-1">
                <Bone className="h-4 w-28" />
                <Bone className="mt-2 h-3 w-48 max-w-full" />
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* near the top on a phone, where the skeleton runs past the screen; centred on a desk */}
      <div className="absolute inset-0 z-10 flex items-start justify-center pt-10 sm:items-center sm:pt-0">
        <div className="w-[min(400px,100%)] rounded-hero bg-white px-6 pb-7 pt-6 text-center shadow-float sm:px-8">
          <RouteLoader />
          <p className="mt-3 text-[17px] font-bold tracking-[-0.01em] text-ink">Loading today’s fleet…</p>
          <p className="mt-1 min-h-5 text-[13px] tabular-nums text-ink-3">
            {total ? `${count(done)} of ${count(total)} routes loaded` : "Connecting to the ERP…"}
          </p>
          <Progress value={done} max={total || 100} tone="nova" label="Routes loaded" className="mt-5" />
        </div>
      </div>
    </div>
  );
}
