/* Motion for the new look: the only file that imports gsap directly.

   Motion explains state and acknowledges actions. Transform, opacity, filter and
   stroke-dashoffset only; expo-out by default, power3.out for numbers and lists.
   No tween may gate visibility: with reduced motion, or in a background tab (no animation
   frames), every preset jumps straight to its end state. */
import { gsap } from "gsap";
import { useGSAP } from "@gsap/react";

gsap.registerPlugin(useGSAP);

const reduced = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
export const still = () => reduced() || document.visibilityState === "hidden";
const d = (ms) => ms / 1000;
const CLEAR = "transform,opacity,visibility,filter";
const list = (els) => (els == null ? [] : Array.isArray(els) ? els.filter(Boolean) : els.length != null ? Array.from(els) : [els]);
const settle = (els) => { const l = list(els); if (l.length) gsap.set(l, { clearProps: CLEAR }); return null; };

export const EASE = "expo.out";
export const EASE_SOFT = "power3.out";

export const motion = {
  /** Content just arrived: rise 12px and fade in. */
  rise(els, stagger = 60) {
    const l = list(els);
    if (!l.length) return null;
    if (still()) return settle(l);
    return gsap.fromTo(l, { y: 12, autoAlpha: 0 },
      { y: 0, autoAlpha: 1, duration: d(420), stagger: d(stagger), ease: EASE, clearProps: CLEAR });
  },
  /** A small detail card arrived on a desk page (with its backdrop). */
  centreIn(card, backdrop) {
    if (still()) return settle([card, backdrop]);
    const tl = gsap.timeline();
    if (backdrop) tl.fromTo(backdrop, { autoAlpha: 0 }, { autoAlpha: 1, duration: d(240), ease: "power2.out", clearProps: CLEAR }, 0);
    if (card) tl.fromTo(card, { y: 12, scale: 0.96, autoAlpha: 0 }, { y: 0, scale: 1, autoAlpha: 1, duration: d(360), ease: EASE, clearProps: CLEAR }, 0);
    return tl;
  },
  /** A toast or popover arrived. */
  popIn(el) {
    if (!el) return null;
    if (still()) return settle(el);
    return gsap.fromTo(el, { y: 12, scale: 0.96, autoAlpha: 0 }, { y: 0, scale: 1, autoAlpha: 1, duration: d(360), ease: EASE, clearProps: CLEAR });
  },
  /** A number changed: tween the text from one value to the next. `format` turns a number into text. */
  countUp(el, from, to, format = (n) => String(Math.round(n))) {
    if (!el) return null;
    if (still() || from === to || !Number.isFinite(from) || !Number.isFinite(to)) { el.textContent = format(to); return null; }
    const o = { v: from };
    return gsap.to(o, { v: to, duration: d(420), ease: EASE_SOFT, onUpdate: () => { el.textContent = format(o.v); }, onComplete: () => { el.textContent = format(to); } });
  },
  /** The hero number changed. */
  pulse(el) {
    if (!el || still()) return null;
    return gsap.fromTo(el, { scale: 1 }, { scale: 1.06, duration: d(140), yoyo: true, repeat: 1, ease: "power1.inOut", clearProps: "transform" });
  },
  /** A bar's fill moved to a new ratio (scaleX, never width). */
  barTo(el, ratio) {
    if (!el) return null;
    if (still()) { gsap.set(el, { scaleX: ratio }); return null; }
    return gsap.to(el, { scaleX: ratio, duration: d(480), ease: EASE, overwrite: "auto" });
  },
  /** A status changed. */
  pillFlip(el) {
    if (!el) return null;
    if (still()) return settle(el);
    return gsap.fromTo(el, { scaleY: 0.7, autoAlpha: 0.5 }, { scaleY: 1, autoAlpha: 1, duration: d(220), ease: EASE, clearProps: CLEAR });
  },
  /** Live: breathe until killed. The caller kills the tween on cleanup. */
  breathe(el) {
    if (!el || still()) return null;
    return gsap.to(el, { scale: 1.08, opacity: 0.85, duration: 1.6, yoyo: true, repeat: -1, ease: "sine.inOut" });
  },
};

export { gsap, useGSAP };
