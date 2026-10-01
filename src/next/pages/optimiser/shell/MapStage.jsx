/* A map in a rounded card with frosted controls floating over it: Enlarge opens it over the page,
   and from there Full screen hands it the whole screen. `render(height, big)` draws the map at a
   height in pixels, so the page copy and the enlarged copy are separate Leaflet maps, each started
   at its own size; only one is mounted at a time. */
import React, { forwardRef, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Maximize2, Minimize, Expand, X } from "lucide-react";
import { cx } from "../../../ui.jsx";
import { motion } from "../../../motion.js";
import "../../../maps.css";

/** A frosted pill over a map. */
export const GlassButton = forwardRef(function GlassButton({ icon: Icon, className, children, ...rest }, ref) {
  return (
    <button ref={ref} type="button" {...rest}
      className={cx("glass pointer-events-auto inline-flex h-9 shrink-0 items-center gap-1.5 rounded-pill px-3.5 text-[13px] font-semibold text-ink shadow-chip",
        "transition-[background-color,transform] duration-150 hover:bg-white active:scale-[0.97]", className)}>
      {Icon && <Icon size={15} strokeWidth={2} aria-hidden />}
      {children}
    </button>
  );
});

/** Frosted, read-only facts over a map (a legend, a count). Never blocks dragging the map. */
export const GlassNote = ({ className, children }) => (
  <div className={cx("glass inline-flex max-w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-pill px-3.5 py-2 text-[13px] font-semibold text-ink-2 shadow-chip", className)}>
    {children}
  </div>
);

// GMap and StopMap draw their own thin border and small radius; the card's clip is the shape here
const FRAME = "nx-map bg-satin-2 shadow-card [&>div]:!rounded-none [&>div]:!border-0";

function useWindowHeight() {
  const [h, setH] = useState(() => window.innerHeight);
  useEffect(() => {
    const on = () => setH(window.innerHeight);
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return h;
}

/**
 * @param render    (heightPx, big) => the map
 * @param height    height on the page, in px, per breakpoint: { base, lg }
 * @param tools     extra frosted buttons, top right, before Enlarge
 * @param overlay   (big) => anything floating over the map's lower left (legend, counts, a detail card)
 * @param label     what the enlarged map is called, for screen readers
 */
export default function MapStage({ render, height = { base: 360, lg: 520 }, tools, overlay, label = "Map", className }) {
  const [big, setBig] = useState(false);
  const [full, setFull] = useState(false);
  const stage = useRef(null), card = useRef(null), closeBtn = useRef(null), openBtn = useRef(null);
  const winH = useWindowHeight();
  const lg = useMedia("(min-width: 1024px)");
  const pageH = lg ? height.lg : height.base;

  useEffect(() => {
    const on = () => setFull(!!stage.current && document.fullscreenElement === stage.current);
    document.addEventListener("fullscreenchange", on);
    return () => document.removeEventListener("fullscreenchange", on);
  }, []);

  const close = () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    setBig(false);
    requestAnimationFrame(() => openBtn.current?.focus({ preventScroll: true }));
  };
  const closeRef = useRef(close);
  closeRef.current = close;

  useLayoutEffect(() => {
    if (!big) return;
    motion.centreIn(card.current, null);
    closeBtn.current?.focus({ preventScroll: true });
    // the page behind is covered, so it takes no focus while the map is open
    const behind = [...document.body.children].filter((el) => el !== stage.current && !el.inert);
    behind.forEach((el) => { el.inert = true; });
    // in full screen the browser takes Escape for itself
    const onKey = (e) => { if (e.key === "Escape" && !document.fullscreenElement) closeRef.current(); };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      behind.forEach((el) => { el.inert = false; });
    };
  }, [big]);

  const toggleFull = () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else stage.current?.requestFullscreen?.().catch(() => {});
  };
  // the enlarged card fills the stage less its padding (12px a side, 16px from sm); full screen has none
  const pad = full ? 0 : window.innerWidth >= 640 ? 32 : 24;
  const bigH = Math.max(320, winH - pad);

  return (
    <>
      <div className={cx(FRAME, className)} style={{ height: pageH }}>
        {!big && render(pageH, false)}
        {!big && (
          <>
            <div className="pointer-events-none absolute right-3 top-3 z-[1100] flex flex-wrap justify-end gap-2">
              {tools}
              <GlassButton ref={openBtn} icon={Maximize2} onClick={() => setBig(true)}>Enlarge</GlassButton>
            </div>
            {overlay && <div className="pointer-events-none absolute inset-x-3 bottom-3 z-[1100] flex flex-col items-start gap-2">{overlay(false)}</div>}
          </>
        )}
      </div>

      {big && createPortal(
        <div ref={stage} role="dialog" aria-modal="true" aria-label={label}
          className={cx("fixed inset-0 z-[60] flex bg-ink/20 backdrop-blur-sm", full ? "p-0" : "p-3 sm:p-4")}>
          <div ref={card} className={cx(FRAME, "relative min-w-0 flex-1 shadow-float", full && "!rounded-none")} style={{ height: bigH }}>
            {render(bigH, true)}
            <div className="pointer-events-none absolute right-3 top-3 z-[1100] flex flex-wrap justify-end gap-2">
              {tools}
              <GlassButton icon={full ? Minimize : Expand} onClick={toggleFull}>{full ? "Exit full screen" : "Full screen"}</GlassButton>
              <GlassButton ref={closeBtn} icon={X} onClick={close}>Close</GlassButton>
            </div>
            {overlay && <div className="pointer-events-none absolute inset-x-3 bottom-3 z-[1100] flex flex-col items-start gap-2">{overlay(true)}</div>}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

function useMedia(query) {
  const [on, setOn] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const m = window.matchMedia(query);
    const fn = () => setOn(m.matches);
    m.addEventListener("change", fn);
    return () => m.removeEventListener("change", fn);
  }, [query]);
  return on;
}
