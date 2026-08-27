/* ============================================================================
 * ui/kit.jsx — the dashboard's shared UI primitives. One copy, every tab.
 * ----------------------------------------------------------------------------
 * These used to exist four times over (Dashboard.jsx, optimiser/ui.jsx,
 * stops/ui.jsx, efficiency/EfficiencyDashboard.jsx) and had drifted apart:
 * different button blues, two unrelated segmented controls, and — because the
 * copies dropped the data-fx hooks — an Optimiser tab that was the only one in
 * the app with no entrance animation.
 *
 * Everything here is styled from the `t` theme object (THEMES in Dashboard.jsx).
 * No Tailwind colour classes: Tailwind supplies metrics, `t` supplies colour.
 *
 * See docs/ui-design-system.md.
 * ==========================================================================*/
import React, { useRef } from "react";
import { gsap } from "gsap";
import { useGSAP } from "@gsap/react";
import { CheckCircle2, AlertTriangle, XCircle, X } from "lucide-react";
import { canEntrance, fxPress } from "./motion.js";

/* ---------------------------------------------------------------- contrast --
 * Small controls fill themselves with a caller-supplied colour (a company hue,
 * a status hue) and put a label on top. Guessing white there is how you end up
 * with 2.6:1 text. Pick whichever of white/ink actually contrasts better —
 * verified ≥4.7:1 for every palette colour in all three themes. */
function luminance(hex) {
  const s = String(hex || "").trim();
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s);
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].split("").map((c) => c + c).join("") : m[1];
  const [r, g, b] = [0, 2, 4].map((i) => {
    const v = parseInt(h.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const INK = "#0f172a";
/** Readable text colour for a filled swatch. Falls back to white for anything
 *  we can't parse (rgba(), a CSS var), which is the pre-existing behaviour. */
export function readableOn(bg, white = "#ffffff") {
  const L = luminance(bg);
  if (L == null) return white;
  const cr = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  return cr(L, luminance(white)) >= cr(L, luminance(INK)) ? white : INK;
}

/* ------------------------------------------------------------------ numbers --
 * animated number — tweens from the previously shown value; keeps prefix/suffix
 * (₹, %, L, /yr…) */
export function CountUp({ value }) {
  const ref = useRef(null);
  const prevRef = useRef(null);
  const tweenRef = useRef(null);
  const str = String(value);
  useGSAP(() => {
    const m = str.match(/^([^0-9-]*)(-?[\d,]+(?:\.\d+)?)(.*)$/);
    // No tween unless the tab is actually visible. GSAP's ticker is paused on a backgrounded
    // tab, so the count-up below would set the text to its START value and never reach the
    // target — freezing the tile on a number that was never real. React has already rendered
    // the correct string, so bailing out here leaves it right.
    if (!m || !canEntrance()) {
      prevRef.current = m ? parseFloat(m[2].replace(/,/g, "")) : null;
      return;
    }
    const target = parseFloat(m[2].replace(/,/g, ""));
    const dec = (m[2].split(".")[1] || "").length;
    const obj = { v: prevRef.current == null ? 0 : prevRef.current };
    prevRef.current = target;
    const fmt = (n) => m[1] + n.toLocaleString("en-IN", { minimumFractionDigits: dec, maximumFractionDigits: dec }) + m[3];
    if (ref.current) ref.current.textContent = fmt(obj.v); // avoid a first-paint flash of the final value
    tweenRef.current?.kill();
    tweenRef.current = gsap.to(obj, {
      v: target, duration: 0.8, ease: "power2.out",
      onUpdate: () => { if (ref.current) ref.current.textContent = fmt(obj.v); },
    });
  }, [str]);
  return <span ref={ref}>{str}</span>;
}

/* fade+rise wrapper for conditionally-mounted panels */
export function Reveal({ children, y = 10, ...rest }) {
  const ref = useRef(null);
  useGSAP(() => {
    if (!canEntrance()) return;
    gsap.from(ref.current, { autoAlpha: 0, y, duration: 0.35, ease: "power2.out", clearProps: "transform,opacity,visibility" });
  }, { scope: ref });
  return <div ref={ref} {...rest}>{children}</div>;
}

/* --------------------------------------------------------------- containers --
 * data-fx is load-bearing: the page-entrance timeline in Dashboard.jsx selects
 * on it. A card without it doesn't animate — that's how the Optimiser tab went
 * still while every other tab moved. */
export function Card({ t, children, className = "", title, hint, right }) {
  return (
    <div data-fx="card" className={"rounded-2xl border " + className} style={{ background: t.surface, borderColor: t.border }}>
      {(title || right) && (
        <div className="flex items-center justify-between px-5 pt-4 pb-1 gap-3">
          <div>
            {title && <h3 className="font-semibold tracking-wide uppercase text-sm" style={{ color: t.text }}>{title}</h3>}
            {hint && <p className="text-xs mt-1" style={{ color: t.muted }}>{hint}</p>}
          </div>
          {right}
        </div>
      )}
      <div className="p-5 pt-3">{children}</div>
    </div>
  );
}

export function Tile({ t, label, value, sub, accent, deltaColor }) {
  return (
    <div data-fx="tile" className="rounded-2xl border p-4 relative overflow-hidden" style={{ background: t.surface, borderColor: t.border }}>
      {/* the rail is a status channel, not trim: it renders only when the caller passed a colour
          derived from the value, so a coloured tile always means something */}
      {accent && <span className="absolute left-0 top-0 bottom-0 w-1" style={{ background: accent }} />}
      <div className="text-xs uppercase tracking-widest" style={{ color: t.muted }}>{label}</div>
      <div className="text-3xl font-bold mt-2 tabular-nums" style={{ color: t.text }}>{typeof value === "string" || typeof value === "number" ? <CountUp value={value} /> : value}</div>
      {sub && <div className="text-xs mt-1" style={{ color: deltaColor || t.muted }}>{sub}</div>}
    </div>
  );
}

export function Empty({ t, title, sub, children }) {
  return (
    <Card t={t}>
      <div className="text-center py-10">
        <div className="text-xl font-semibold" style={{ color: t.text }}>{title}</div>
        <div className="text-sm mt-1" style={{ color: t.muted }}>{sub}</div>
        {children && <div className="mt-4 flex justify-center">{children}</div>}
      </div>
    </Card>
  );
}

export function Modal({ t, title, onClose, children }) {
  const overlayRef = useRef(null);
  useGSAP(() => {
    if (!canEntrance()) return;
    gsap.from(overlayRef.current, { autoAlpha: 0, duration: 0.25, ease: "power1.out" });
    gsap.from(".fx-modal-card", { autoAlpha: 0, y: 24, scale: 0.96, duration: 0.35, ease: "back.out(1.6)", clearProps: "transform" });
  }, { scope: overlayRef });
  return (
    <div ref={overlayRef} className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,.55)" }} onClick={onClose}>
      <div className="fx-modal-card w-full max-w-md rounded-2xl border" style={{ background: t.surface, borderColor: t.border }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: "1px solid " + t.border }}>
          <div className="font-semibold" style={{ color: t.text }}>{title}</div>
          <button onClick={onClose} title="Close" aria-label="Close" className="rounded-lg p-1.5" style={{ border: "1px solid " + t.border, color: t.muted }}><X size={15} /></button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- controls --
 * `primaryStrong`, not `primary`: filled buttons carry 12–14px white text, and
 * the mid-tone brand blue only reaches 3.7:1 there. `transition-colors`, not
 * `transition`: transitioning transform would fight fxPress. */
export function Btn({ t, children, onClick, variant = "primary", className = "", disabled, title, type }) {
  const base = "inline-flex items-center gap-2 rounded-xl font-semibold px-4 py-2.5 text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed";
  const style = variant === "primary" ? { background: t.primaryStrong || t.primary, color: t.onPrimary || "#fff" } :
    variant === "danger" ? { background: "transparent", color: t.poor, border: "1px solid " + t.poor } :
    { background: "transparent", color: t.text, border: "1px solid " + t.border };
  return <button type={type} title={title} disabled={disabled} onClick={onClick} onMouseDown={fxPress} className={base + " " + className} style={style}>{children}</button>;
}

/* shape + label reinforce colour so status is legible with colour-vision deficiency */
export function Pill({ t, kind }) {
  const map = { good: [t.good, t.goodSoft, "Good", CheckCircle2], watch: [t.watch, t.watchSoft, "Watch", AlertTriangle], poor: [t.poor, t.poorSoft, "Poor", XCircle] };
  const [c, bg, label, Icon] = map[kind] || map.watch;
  return <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold uppercase tracking-wider" style={{ color: c, background: bg }}><Icon size={12} strokeWidth={2.5} />{label}</span>;
}

/** Same grammar as Pill — colour plus a second channel — for stop GPS status. */
export function StatusPill({ t, status }) {
  const map = {
    ok: [t.good, t.goodSoft, "GPS OK"],
    manual: [t.primary, t.primarySoft, "Manual pin"],
    "no-gps": [t.poor, t.poorSoft, "No GPS"],
  };
  const [c, bg, label] = map[status] || map["no-gps"];
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold uppercase tracking-wider whitespace-nowrap" style={{ color: c, background: bg }}>
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: c }} />{label}
    </span>
  );
}

/* `strong` = higher-stakes inputs (money, formula) get a more legible label */
export function Field({ t, label, children, strong }) {
  return <label className="block"><span className="block mb-1.5" style={{ color: strong ? t.text : t.muted, fontSize: strong ? 13 : 12, fontWeight: strong ? 600 : 400 }}>{label}</span>{children}</label>;
}

export function inputStyle(t) { return { background: t.inputBg, border: "1px solid " + t.border, color: t.text }; }

/* outline-none is only safe because index.css restores a :focus-visible ring */
export const TextInput = React.forwardRef(function TextInput({ t, className = "", style, ...p }, ref) {
  return <input ref={ref} {...p} className={"w-full rounded-xl px-3 py-2.5 text-sm outline-none " + className} style={{ ...inputStyle(t), ...style }}
    onFocus={(e) => (e.target.style.borderColor = t.primary)} onBlur={(e) => (e.target.style.borderColor = t.border)} />;
});

export function SelectInput({ t, children, className = "", style, ...p }) {
  return <select {...p} className={"w-full rounded-xl px-3 py-2.5 text-sm outline-none " + className} style={{ ...inputStyle(t), ...style }}>{children}</select>;
}

export function Switch({ t, checked, onChange, label }) {
  return <button role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)} className="relative w-12 h-7 rounded-full transition" style={{ background: checked ? t.good : t.border }}>
    <span className="absolute top-1 w-5 h-5 rounded-full bg-white transition-all" style={{ left: checked ? 26 : 4 }} /></button>;
}

/** Options are [value, label] or [value, label, colour]. The third element is a
 *  live information channel — the company filters colour the thumb per company —
 *  so it fills the thumb, and the label colour is derived from it rather than
 *  assumed to be white. */
export function Segmented({ t, value, onChange, options, small }) {
  const [hover, setHover] = React.useState(null);
  return (
    <div className="inline-flex rounded-full gap-1" style={{ background: t.surface2, border: "1px solid " + t.border, padding: 4, boxShadow: "inset 0 1px 2px rgba(15,23,42,.06)" }}>
      {options.map(([val, label, color]) => {
        const on = value === val;
        const hot = hover === val && !on;
        const fill = color || t.primaryStrong || t.primary;
        return (
          <button key={val} type="button"
            onClick={() => onChange(val)}
            onMouseEnter={() => setHover(val)}
            onMouseLeave={() => setHover((h) => (h === val ? null : h))}
            className={(small ? "px-3 py-1 text-xs" : "px-4 py-1.5 text-sm") + " rounded-full font-semibold"}
            style={{
              background: on ? fill : hot ? t.raised : "transparent",
              color: on ? (color ? readableOn(fill, t.onPrimary || "#fff") : t.onPrimary || "#fff") : hot ? t.text : t.muted,
              boxShadow: on ? `0 1px 2px rgba(15,23,42,.16), 0 3px 8px ${t.primarySoft}` : "none",
              transform: on ? "translateY(-0.5px)" : "none",
              transition: "background .18s ease, color .18s ease, box-shadow .18s ease, transform .18s ease",
              letterSpacing: "0.01em",
              cursor: "pointer",
            }}>
            {label}
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------- charts --*/
export function makeTooltip(t) {
  return function TT({ active, payload, label }) {
    if (!active || !payload || !payload.length) return null;
    return (
      <div className="rounded-lg px-3 py-2 text-xs" style={{ background: t.raised, border: "1px solid " + t.border, color: t.text }}>
        {label != null && <div className="font-semibold mb-1">{label}</div>}
        {payload.map((p, i) => <div key={i} style={{ color: p.color || p.fill }}>{p.name}: {typeof p.value === "number" ? Math.round(p.value).toLocaleString("en-IN") : p.value}</div>)}
      </div>
    );
  };
}

/** Fixed palette for route colours (independent of theme). Eight hues at even spacing with
 *  alternating lightness, so neighbouring route indices never collide at 1.6px stroke on a map —
 *  the old list led with three near-identical indigo/violets in slots 1, 3 and 10. */
export const PALETTE = ["#2563eb", "#ea580c", "#16a34a", "#c026d3", "#0891b2", "#ca8a04", "#dc2626", "#4d7c0f"];
export function routeColorMap(routes) { const m = {}; routes.forEach((r, i) => (m[r] = PALETTE[i % PALETTE.length])); return m; }
