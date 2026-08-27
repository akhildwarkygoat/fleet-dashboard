/* ============================================================================
 * ui/motion.js — the dashboard's motion vocabulary, in one place.
 * ----------------------------------------------------------------------------
 * Every tab shares these, so a button pressed on the Optimiser feels exactly
 * like a button pressed on Live. Transform + opacity only, so the compositor
 * does the work and GSAP never fights a CSS transition.
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

/* micro-interactions (transform-only → compositor-friendly) */
export const fxLift = (e) => { if (prefersReduced()) return; gsap.to(e.currentTarget, { y: -3, scale: 1.02, duration: 0.22, ease: "power2.out", overwrite: "auto" }); };
export const fxDrop = (e) => { if (prefersReduced()) return; gsap.to(e.currentTarget, { y: 0, scale: 1, duration: 0.28, ease: "power2.out", overwrite: "auto" }); };
export const fxPress = (e) => { if (prefersReduced()) return; gsap.fromTo(e.currentTarget, { scale: 0.96 }, { scale: 1, duration: 0.4, ease: "elastic.out(1, 0.55)", overwrite: "auto" }); };

/* what an entrance tween hands back to the browser once it's done */
export const FX_CLEAR = "transform,opacity,visibility";
