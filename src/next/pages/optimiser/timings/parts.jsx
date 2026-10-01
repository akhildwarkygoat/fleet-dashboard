/* Small pieces the Timings board shares between its cards. */
import React from "react";
import { Skeleton, cx } from "../../../ui.jsx";

/** A service or slot colour as a small round dot. */
export const Dot = ({ color, className }) => (
  <span aria-hidden className={cx("inline-block h-2.5 w-2.5 shrink-0 rounded-pill", className)} style={{ background: color }} />
);

/* A service hue as soft fills with darker text of the same hue, so a run keeps its service's colour
   and its times stay readable on white and on the zebra rows. */
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const mix = (hex, to, k) => `rgb(${rgb(hex).map((c) => Math.round(c + (to - c) * k)).join(",")})`;
const TINTS = new Map();
export function tint(hex) {
  if (!TINTS.has(hex)) TINTS.set(hex, { pick: mix(hex, 255, 0.7), drop: mix(hex, 255, 0.82), deep: mix(hex, 0, 0.42) });
  return TINTS.get(hex);
}

// services.js writes its next steps with a dash: "a plan — run the optimiser for this service"
export const plainNeed = (need) => String(need).replace(" — ", ": ");

// where the skeleton's run pills sit (left and width in % of the day), so it reads as a clock
const GHOST = [[34, 7], [20, 8], [44, 6], [12, 9], [58, 7], [30, 6], [66, 8], [24, 7], [50, 9], [16, 6], [72, 7], [38, 8]];

/** The clock's rows while plans load: a times row and zebra rows with a pill each. */
export function GhostRows({ className }) {
  return (
    <div aria-hidden className={cx("mx-2 sm:mx-3", className)}>
      <Skeleton className="mb-2 ml-[136px] h-6 !rounded-pill" />
      {GHOST.map(([left, width], i) => (
        <div key={i} className={cx("flex h-10 items-center rounded-[14px]", i % 2 === 1 && "bg-satin")}>
          <Skeleton className="ml-3 h-3.5 w-24 shrink-0" />
          <div className="relative h-full flex-1">
            <div className="absolute top-[7px] h-[26px]" style={{ left: left + "%", width: width + "%" }}>
              <Skeleton className="h-full w-full !rounded-pill" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
