/* Loading the bus page: the page's own layout, blurred, so nothing jumps when the data lands, with
   the Live page's loader card on top (a bus travelling a route) and the real count of routes
   fetched so far. */
import React, { useRef } from "react";
import { MotionPathPlugin } from "gsap/MotionPathPlugin";
import { ERP_ROUTE_D } from "../../../Dashboard.jsx";
import { Progress, cx } from "../../ui.jsx";
import { count } from "../../format.js";
import { gsap, useGSAP } from "../../motion.js";

gsap.registerPlugin(MotionPathPlugin);

// static placeholders: the layer they sit in is blurred, so a pulse would only cost repaints
const Bone = ({ className }) => <div className={cx("rounded-tile bg-satin-2", className)} />;
const Pill = ({ className }) => <div className={cx("h-11 rounded-pill bg-satin-2", className)} />;
const SatinTile = ({ className }) => <div className={cx("rounded-tile bg-satin", className)} />;
const Box = ({ hero, className, children }) => (
  <div className={cx("bg-white p-5 shadow-card sm:p-6", hero ? "rounded-hero" : "rounded-card", className)}>{children}</div>
);
const LabelledPill = ({ className }) => (
  <div className={className}><Bone className="h-3 w-10" /><Pill className="mt-1.5 w-full" /></div>
);

/** The same loader as Live's (live/LiveLoading.jsx): the route draws itself while the bus rides it.
 *  With reduced motion the route stays drawn and the bus waits halfway, held by CSS. */
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

const Rows = ({ n }) => Array.from({ length: n }, (_, i) => <Bone key={i} className="mt-4 h-4 w-full" />);

export default function BusLoading({ progress }) {
  const total = (progress && progress.total) || 0, done = (progress && progress.done) || 0;
  return (
    <div aria-busy="true" className="relative">
      <div aria-hidden className="pointer-events-none select-none opacity-70 blur-[6px]">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
          <div className="basis-full sm:basis-auto">
            <div className="mb-2 h-9 w-32 rounded-pill bg-satin-2" />
            <Bone className="h-8 w-48" />
            <Bone className="mt-2 h-4 w-28" />
          </div>
          <div className="flex w-full flex-wrap items-end gap-x-3 gap-y-2 sm:w-auto">
            <LabelledPill className="w-[calc(50%-6px)] sm:w-[164px]" />
            <LabelledPill className="w-[calc(50%-6px)] sm:w-[164px]" />
            <Pill className="w-full sm:w-[260px]" />
          </div>
        </div>
        <div className="grid items-start gap-3 xl:grid-cols-[minmax(0,1fr)_400px] xl:gap-6">
          <div className="flex min-w-0 flex-col gap-3">
            <Box hero>
              <div className="flex flex-col gap-x-10 gap-y-5 md:flex-row">
                <div>
                  <Bone className="h-3 w-24" />
                  <Bone className="mt-3 h-16 w-40" />
                  <Bone className="mt-4 h-4 w-44" />
                </div>
                <div className="grid flex-1 grid-cols-2 content-center gap-3">
                  {Array.from({ length: 4 }, (_, i) => <SatinTile key={i} className="h-[68px]" />)}
                </div>
              </div>
              <div className="mt-6 h-3 w-full rounded-pill bg-satin-2" />
            </Box>
            <Box>
              <Bone className="mb-4 h-4 w-40" />
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                {Array.from({ length: 3 }, (_, i) => <SatinTile key={i} className="h-[84px]" />)}
              </div>
            </Box>
            <Box>
              <Bone className="mb-5 h-4 w-32" />
              <Bone className="h-7 w-56" />
              <Rows n={5} />
            </Box>
            <Box>
              <Bone className="mb-5 h-4 w-40" />
              <Rows n={7} />
            </Box>
          </div>
          <div className="grid min-w-0 items-start gap-3 md:grid-cols-2 xl:grid-cols-1">
            {[5, 3, 4, 2, 2].map((n, i) => (
              <Box key={i}>
                <Bone className="mb-2 h-4 w-32" />
                <Rows n={n} />
              </Box>
            ))}
          </div>
        </div>
      </div>

      {/* near the top on a phone, where the skeleton runs past the screen; centred on a desk */}
      <div className="absolute inset-0 z-10 flex items-start justify-center pt-10 sm:items-center sm:pt-0">
        <div className="w-[min(400px,100%)] rounded-hero bg-white px-6 pb-7 pt-6 text-center shadow-float sm:px-8">
          <RouteLoader />
          <p className="mt-3 text-[17px] font-bold tracking-[-0.01em] text-ink">Loading the bus…</p>
          <p className="mt-1 min-h-5 text-[13px] tabular-nums text-ink-3">
            {total ? `${count(done)} of ${count(total)} routes loaded` : "Connecting to the ERP…"}
          </p>
          <Progress value={done} max={total || 100} tone="nova" label="Routes loaded" className="mt-5" />
        </div>
      </div>
    </div>
  );
}
