/* Loading the Costs page: the page's own layout, blurred, so nothing jumps when the data lands, with
   a small card on top that counts the routes fetched while the ERP's first pull runs. */
import React from "react";
import { UNITS } from "../../../Dashboard.jsx";
import { CompanyDot, Progress, cx } from "../../ui.jsx";
import { count } from "../../format.js";

// static placeholders: the layer they sit in is blurred, so a pulse would only cost repaints
const Bone = ({ className }) => <div className={cx("rounded-tile bg-satin-2", className)} />;
const CARD = "flex flex-col rounded-card bg-white p-5 shadow-card sm:p-6";

export default function CostsLoading({ progress }) {
  const total = (progress && progress.total) || 0, done = (progress && progress.done) || 0;
  return (
    <div aria-busy="true" className="relative">
      <div aria-hidden className="pointer-events-none flex select-none flex-col gap-3 opacity-70 blur-[6px]">
        <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-5">
          <div className="rounded-hero bg-white p-5 shadow-card sm:col-span-3 sm:p-6 xl:col-span-2">
            <Bone className="h-3 w-20" />
            <Bone className="mt-3 h-14 w-64 max-w-full" />
            <Bone className="mt-3 h-14 w-56 max-w-full" />
            <Bone className="mt-5 h-4 w-72 max-w-full" />
          </div>
          {[0, 1, 2].map((i) => (
            <div key={i} className={CARD}>
              <Bone className="h-3.5 w-28" />
              <Bone className="mt-3 h-7 w-32 max-w-full" />
              <div className="mt-auto flex flex-col gap-2.5 pt-5">
                {UNITS.map((u) => (
                  <span key={u} className="flex items-center gap-2"><CompanyDot unit={u} /><Bone className="h-3 flex-1" /></span>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="grid gap-3 xl:grid-cols-3">
          <div className={cx(CARD, "xl:col-span-2")}>
            <Bone className="h-4 w-44" />
            <Bone className="mt-2 h-3 w-72 max-w-full" />
            <div className="mt-5 divide-y divide-line">
              {Array.from({ length: 8 }, (_, i) => (
                <div key={i} className="flex items-center gap-6 py-3.5">
                  <div className="min-w-0 flex-1">
                    <Bone className="h-4 w-36" />
                    <Bone className="mt-2 h-3 w-full max-w-[420px]" />
                  </div>
                  <Bone className="h-4 w-24" />
                  <Bone className="hidden h-1.5 w-40 rounded-pill md:block" />
                </div>
              ))}
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 sm:[&>*:last-child]:col-span-2 lg:grid-cols-3 lg:[&>*:last-child]:col-span-1 xl:flex xl:flex-col">
            {UNITS.map((u) => (
              <div key={u} className={cx(CARD, "xl:flex-1")}>
                <span className="flex items-center gap-2.5"><CompanyDot unit={u} /><Bone className="h-4 w-32" /></span>
                <Bone className="mt-4 h-6 w-full max-w-[280px]" />
                <Bone className="mt-4 h-1.5 w-full rounded-pill" />
                <div className="mt-auto grid grid-cols-3 gap-3 pt-4">{[0, 1, 2].map((j) => <Bone key={j} className="h-12" />)}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* near the top on a phone, where the skeleton runs past the screen; centred on a desk */}
      <div className="absolute inset-0 z-10 flex items-start justify-center pt-10 sm:items-center sm:pt-0">
        <div className="w-[min(400px,100%)] rounded-hero bg-white px-6 pb-7 pt-6 text-center shadow-float sm:px-8">
          <p className="text-[17px] font-bold tracking-[-0.01em] text-ink">Loading costs…</p>
          <p className="mt-1 min-h-5 text-[13px] tabular-nums text-ink-3">
            {total ? `${count(done)} of ${count(total)} routes loaded` : "Connecting to the ERP…"}
          </p>
          <Progress value={done} max={total || 100} tone="nova" label="Routes loaded" className="mt-5" />
        </div>
      </div>
    </div>
  );
}
