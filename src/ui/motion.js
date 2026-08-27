/* ============================================================================
 * ui/motion.js — the dashboard's motion vocabulary, in one place.
 * ----------------------------------------------------------------------------
 * Every tab shares these, so a button pressed on the Optimiser feels exactly
 * like a button pressed on Live. Transform + opacity only, so the compositor
 * does the work and GSAP never fights a CSS transition.
 *
 * The eases are real springs, not hand-picked bezier curves. Apple's argument
 * (WWDC 2018, "Designing Fluid Interfaces") is that a fixed-duration curve
 * can't respond to new input — it has already decided how it will end. A
 * spring has no fixed duration: its settle time falls out of the physics, so
 * a new target just changes where it's heading and the motion stays
 * continuous. Everything a user can touch should move on one.
 *
 * See docs/ui-design-system.md §4.
 * ==========================================================================*/
import { gsap } from "gsap";
import { useGSAP } from "@gsap/react";

gsap.registerPlugin(useGSAP);
// page-entrance selectors legitimately match nothing on some tabs
gsap.config({ nullTargetWarn: false });

export const prefersReduced = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/* Entrance ("from") animations set an invisible start-state and rely on GSAP's rAF ticker to
   tween back to visible. While a browser tab is backgrounded rAF is paused, so a from-tween would
   hide content and never reveal it. Only run entrances when the tab is actually visible; otherwise
   render content in its natural (visible) state. */
export const canEntrance = () =>
  !prefersReduced() && (typeof document === "undefined" || document.visibilityState === "visible");

/* ============================ SPRINGS ============================
 * Apple describes a spring with two designer-facing numbers instead of the
 * physics triplet (mass / stiffness / damping):
 *
 *   damping   1.0 = critically damped, settles with no overshoot.
 *             < 1 overshoots and oscillates. Lower = bouncier.
 *   response  how quickly it reaches the target, in seconds. Lower = snappier.
 *             NOT a duration — the settle time emerges from the two together.
 *
 * Below is the analytic step response of a second-order system, sampled into a
 * GSAP ease. `duration` is the computed settle time, so the tween ends exactly
 * when the spring has come to rest rather than at an arbitrary chosen moment. */

const TAU = Math.PI * 2;

/** Normalised spring position at time t (seconds) for a 0 → 1 step. */
function springValue(t, damping, response) {
  const w0 = TAU / response;                    // undamped natural frequency
  if (damping >= 1) {                           // critically damped
    return 1 - (1 + w0 * t) * Math.exp(-w0 * t);
  }
  const wd = w0 * Math.sqrt(1 - damping * damping); // damped frequency
  return 1 - Math.exp(-damping * w0 * t) * (Math.cos(wd * t) + ((damping * w0) / wd) * Math.sin(wd * t));
}

/** Time (seconds) after which the spring stays within `epsilon` of its target.
 *  Must be the LAST time it leaves that band, not the first time it enters:
 *  an under-damped spring crosses its target on the way up, well before it
 *  peaks. Stopping at the first crossing cuts the overshoot off entirely and
 *  quietly turns every bouncy spring into a critically damped one. */
function settleTime(damping, response, epsilon = 0.001) {
  const step = 1 / 240;
  let last = step;
  for (let t = step; t < 6; t += step) if (Math.abs(springValue(t, damping, response) - 1) >= epsilon) last = t;
  return last + step;
}

/** Build a GSAP-compatible {ease, duration} pair from damping + response. */
export function spring(damping, response) {
  const duration = settleTime(damping, response);
  // GSAP hands the ease a progress 0..1; map it back onto real spring time.
  const ease = (p) => (p >= 1 ? 1 : springValue(p * duration, damping, response));
  return { ease, duration };
}

/* The three Apple ships, by name. Registered as GSAP eases too, so they can be
   used as strings ("apple.drawer") anywhere a tween takes an ease. */
export const SPRINGS = {
  /** Move / reposition. The default: graceful, never distracting. */
  move: spring(1.0, 0.4),
  /** Rotation, and anything with a little life in it. */
  rotate: spring(0.8, 0.4),
  /** Drawers, sheets, popovers — snappier, with a touch of overshoot. */
  drawer: spring(0.8, 0.3),
  /** Snappy critically-damped for small, frequent UI changes. */
  snap: spring(1.0, 0.28),
};
Object.entries(SPRINGS).forEach(([name, s]) => gsap.registerEase("apple." + name, s.ease));

/* CSS gets the same curves. `linear()` takes a sampled easing function, so the
   identical spring that drives a GSAP tween can drive a CSS transition — one
   motion vocabulary, not two that merely look similar. Browsers without
   `linear()` discard the declaration and fall back to the preceding rule, so
   this degrades to a plain ease rather than breaking. */
function cssSpring(s, samples = 24) {
  const pts = [];
  for (let i = 0; i <= samples; i++) pts.push(+s.ease(i / samples).toFixed(4));
  return `linear(${pts.join(", ")})`;
}
if (typeof document !== "undefined") {
  const root = document.documentElement;
  Object.entries(SPRINGS).forEach(([name, s]) => {
    root.style.setProperty(`--ease-spring-${name}`, cssSpring(s));
    root.style.setProperty(`--dur-spring-${name}`, `${s.duration.toFixed(3)}s`);
  });
}

/** Spread into a tween: gsap.to(el, { y: 0, ...springTween("drawer") }).
 *  Collapses to a short fade-grade tween under reduced-motion, where overshoot
 *  and long settles are exactly what the user asked not to have. */
export function springTween(name = "move") {
  const s = SPRINGS[name] || SPRINGS.move;
  if (prefersReduced()) return { ease: "power1.out", duration: 0.15 };
  return { ease: s.ease, duration: s.duration };
}

/* ============================ MOMENTUM ============================ */

/** Where a flick would come to rest on its own — Apple's projection function
 *  from the Designing Fluid Interfaces sample code. Note this is exponential
 *  decay, NOT the textbook v²/(2a): snap to the target nearest the PROJECTED
 *  point, not the nearest one to where the finger happened to let go. */
export function project(initialVelocity, decelerationRate = 0.998) {
  return ((initialVelocity / 1000) * decelerationRate) / (1 - decelerationRate);
}

/** Progressive resistance past a boundary. A hard stop reads as "frozen"; this
 *  reads as "responsive, but there's nothing more here". */
export function rubberband(overshoot, dimension, constant = 0.55) {
  return (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot));
}

/* ============================ MICRO-INTERACTIONS ============================
 * All transform-only, all overwrite:"auto" so a second gesture retargets the
 * running tween from its current on-screen value instead of jumping. */

export const fxLift = (e) => { if (prefersReduced()) return; gsap.to(e.currentTarget, { y: -3, scale: 1.02, ...springTween("move"), overwrite: "auto" }); };
export const fxDrop = (e) => { if (prefersReduced()) return; gsap.to(e.currentTarget, { y: 0, scale: 1, ...springTween("move"), overwrite: "auto" }); };
/* Press feedback is on pointer-DOWN, never on release: the moment feedback waits
   for touch-up, directness "falls off a cliff". */
export const fxPress = (e) => { if (prefersReduced()) return; gsap.fromTo(e.currentTarget, { scale: 0.96 }, { scale: 1, ...springTween("rotate"), overwrite: "auto" }); };

/* what an entrance tween hands back to the browser once it's done */
export const FX_CLEAR = "transform,opacity,visibility";
