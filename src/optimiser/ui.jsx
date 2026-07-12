/* ============================================================================
 * optimiser/ui.jsx — theme-aware primitives, matched 1:1 to Dashboard.jsx so
 * the Optimiser tab looks native. Everything is styled from the `t` theme prop.
 * ==========================================================================*/
import React from "react";

export function Card({ t, children, className = "", title, hint, right }) {
  return (
    <div className={"rounded-2xl border " + className} style={{ background: t.surface, borderColor: t.border }}>
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
export function Btn({ t, children, onClick, variant = "primary", className = "", disabled, title }) {
  const base = "inline-flex items-center gap-2 rounded-xl font-semibold px-4 py-2.5 text-sm transition disabled:opacity-50 disabled:cursor-not-allowed";
  const style = variant === "primary" ? { background: t.primary, color: t.onPrimary || "#fff" }
    : variant === "danger" ? { background: "transparent", color: t.poor, border: "1px solid " + t.poor }
    : { background: "transparent", color: t.text, border: "1px solid " + t.border };
  return <button title={title} disabled={disabled} onClick={onClick} className={base + " " + className} style={style}>{children}</button>;
}
export function Field({ t, label, children }) {
  return <label className="block"><span className="block text-xs mb-1.5" style={{ color: t.muted }}>{label}</span>{children}</label>;
}
export function inputStyle(t) { return { background: t.inputBg, border: "1px solid " + t.border, color: t.text }; }
export const TextInput = React.forwardRef(function TextInput({ t, ...p }, ref) {
  return <input ref={ref} {...p} className="w-full rounded-xl px-3 py-2.5 text-sm outline-none" style={inputStyle(t)}
    onFocus={(e) => (e.target.style.borderColor = t.primary)} onBlur={(e) => (e.target.style.borderColor = t.border)} />;
});
export function SelectInput({ t, children, ...p }) {
  return <select {...p} className="w-full rounded-xl px-3 py-2.5 text-sm outline-none" style={inputStyle(t)}>{children}</select>;
}
export function Tile({ t, label, value, sub, accent, deltaColor }) {
  return (
    <div className="rounded-2xl border p-4 relative overflow-hidden" style={{ background: t.surface, borderColor: t.border }}>
      <span className="absolute left-0 top-0 bottom-0 w-1" style={{ background: accent || t.primary }} />
      <div className="text-xs uppercase tracking-widest" style={{ color: t.muted }}>{label}</div>
      <div className="text-3xl font-bold mt-2 tabular-nums" style={{ color: t.text }}>{value}</div>
      {sub && <div className="text-xs mt-1" style={{ color: deltaColor || t.muted }}>{sub}</div>}
    </div>
  );
}
export function Empty({ t, title, sub, children }) {
  return (
    <Card t={t}><div className="text-center py-10">
      <div className="text-xl font-semibold" style={{ color: t.text }}>{title}</div>
      <div className="text-sm mt-1" style={{ color: t.muted }}>{sub}</div>
      {children && <div className="mt-4 flex justify-center">{children}</div>}
    </div></Card>
  );
}
export function StatusPill({ t, status }) {
  const map = {
    ok: [t.good, t.goodSoft, "GPS OK"],
    manual: [t.primary, t.primarySoft, "Manual pin"],
    "no-gps": [t.poor, t.poorSoft, "No GPS"],
  };
  const [c, bg, label] = map[status] || map.ok;
  return <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold" style={{ color: c, background: bg }}><span className="w-1.5 h-1.5 rounded-full" style={{ background: c }} />{label}</span>;
}
export function Segmented({ t, value, onChange, options, small }) {
  const [hover, setHover] = React.useState(null);
  return (
    <div className="inline-flex rounded-full gap-1" style={{ background: t.surface2, border: "1px solid " + t.border, padding: 4, boxShadow: `inset 0 1px 2px rgba(15,23,42,.06)` }}>
      {options.map(([val, label]) => {
        const on = value === val;
        const hot = hover === val && !on;
        return (
          <button key={val} type="button"
            onClick={() => onChange(val)}
            onMouseEnter={() => setHover(val)}
            onMouseLeave={() => setHover((h) => (h === val ? null : h))}
            className={(small ? "px-3 py-1 text-xs" : "px-4 py-1.5 text-sm") + " rounded-full font-semibold"}
            style={{
              background: on ? t.primary : hot ? t.raised : "transparent",
              color: on ? (t.onPrimary || "#fff") : hot ? t.text : t.muted,
              boxShadow: on ? "0 1px 2px rgba(15,23,42,.16), 0 3px 8px rgba(79,70,229,.28)" : "none",
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
/** Fixed palette for route colours (independent of theme). */
const PALETTE = ["#6366f1", "#38bdf8", "#a78bfa", "#10b981", "#f59e0b", "#f43f5e", "#14b8a6", "#eab308", "#ec4899", "#8b5cf6"];
export function routeColorMap(routes) { const m = {}; routes.forEach((r, i) => (m[r] = PALETTE[i % PALETTE.length])); return m; }
export { PALETTE };
