/* The Compare page's shape behind whatever stands in for it: the two chart cards as they will look,
   blurred, with a small card on top. Loading shows the real count of routes fetched, so nothing
   jumps when the data lands; an empty or failed page keeps its shape too, with no blank space. */
import React from "react";
import { Progress, cx } from "../../ui.jsx";
import { count } from "../../format.js";

// static: the layer is blurred, so a pulse would only cost repaints
const Bone = ({ className }) => <div className={cx("rounded-tile bg-satin-2", className)} />;

function CardBones() {
  return (
    <div className="flex flex-col rounded-card bg-white p-5 shadow-card sm:p-6">
      <div className="mb-4 flex items-center justify-between gap-4">
        <Bone className="h-4 w-20" />
        <div className="flex gap-1.5">
          <Bone className="h-9 w-24 rounded-pill" />
          <Bone className="h-9 w-16 rounded-pill" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-[minmax(0,1fr)_168px_168px]">
        {[0, 1, 2].map((i) => (
          <div key={i} className={cx(i === 0 && "col-span-2 xl:col-span-1")}>
            <Bone className="h-3 w-14" />
            <Bone className="mt-1.5 h-11 w-full rounded-pill" />
          </div>
        ))}
      </div>
      <Bone className="mt-5 h-[320px] sm:h-[360px]" />
      <Bone className="mt-4 h-3 w-28" />
      <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1.5 sm:grid-cols-3">
        {[0, 1, 2].map((i) => <Bone key={i} className="h-5" />)}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {[0, 1, 2].map((i) => <Bone key={i} className={cx("h-[92px]", i === 2 && "col-span-2 sm:col-span-1")} />)}
      </div>
    </div>
  );
}

/** The blurred two-card layer with `children` on top: near the top on a phone, centred on a desk. */
export function OverCards({ busy, children }) {
  return (
    <div aria-busy={busy || undefined} className="relative">
      <div aria-hidden className="pointer-events-none grid select-none gap-3 opacity-70 blur-[6px] lg:grid-cols-2">
        <CardBones />
        <CardBones />
      </div>
      <div className="absolute inset-0 z-10 flex items-start justify-center pt-10 sm:items-center sm:pt-0">{children}</div>
    </div>
  );
}

export default function CompareLoading({ progress }) {
  const total = (progress && progress.total) || 0, done = (progress && progress.done) || 0;
  return (
    <OverCards busy>
      <div className="w-[min(400px,100%)] rounded-hero bg-white px-6 pb-7 pt-6 text-center shadow-float sm:px-8">
        <p className="text-[17px] font-bold tracking-[-0.01em] text-ink">Loading attendance from the ERP…</p>
        <p className="mt-1 min-h-5 text-[13px] tabular-nums text-ink-3">
          {total ? `${count(done)} of ${count(total)} routes loaded` : "Connecting to the ERP…"}
        </p>
        <Progress value={done} max={total || 100} tone="nova" label="Routes loaded" className="mt-5" />
      </div>
    </OverCards>
  );
}
