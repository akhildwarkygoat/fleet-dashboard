/* Loading the Planner: the gallery's own layout, blurred, so nothing jumps when it lands, with a
   small card on top saying what is being prepared. */
import React from "react";
import { cx } from "../../../ui.jsx";
import { GRID } from "./parts.jsx";

const Bone = ({ className }) => <div className={cx("rounded-tile bg-satin-2", className)} />;

export default function PlannerLoading() {
  return (
    <div aria-busy="true" className="relative">
      <div aria-hidden className="pointer-events-none select-none opacity-70 blur-[6px]">
        <div className="grid gap-3 sm:grid-cols-3">
          {["bg-ink", "bg-white", "bg-white"].map((bg, i) => (
            <div key={i} className={cx("flex items-center gap-4 rounded-card p-5 shadow-card", bg)}>
              <span className={cx("h-11 w-11 shrink-0 rounded-pill", i ? "bg-satin-2" : "bg-white/15")} />
              <span className="min-w-0 flex-1">
                <Bone className={cx("h-4 w-28", !i && "bg-white/25")} />
                <Bone className={cx("mt-2 h-3 w-40 max-w-full", !i && "bg-white/15")} />
              </span>
            </div>
          ))}
        </div>
        <Bone className="mt-6 h-6 w-28" />
        <div className={cx("mt-4", GRID)}>
          {[0, 1, 2].map((i) => (
            <div key={i} className="rounded-card bg-white p-3 shadow-card">
              <Bone className="h-40" />
              <Bone className="mx-2 mt-3 h-4 w-36" />
              <Bone className="mx-2 mt-2 h-3 w-28" />
              <Bone className="mx-2 mt-3 h-7 w-24" />
              <div className="mt-3 grid grid-cols-2 gap-3">
                {[0, 1].map((j) => <Bone key={j} className="h-[52px]" />)}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="absolute inset-0 z-10 flex items-start justify-center pt-24">
        <div className="w-[min(380px,100%)] rounded-hero bg-white px-6 py-6 text-center shadow-float">
          <p className="text-[17px] font-bold tracking-[-0.01em] text-ink">Loading the road network…</p>
          <p className="mt-1 text-[13px] text-ink-3">Road distances between the factory and every stop</p>
        </div>
      </div>
    </div>
  );
}
