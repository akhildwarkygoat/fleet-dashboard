/* ============================================================================
 * stops/ui.jsx  —  Themed UI primitives for the Stop Extractor module
 * ----------------------------------------------------------------------------
 * Small, self-contained copies of the dashboard's look (Card/Btn/Field/inputs)
 * so this module drops in with zero changes to Dashboard.jsx and styles itself
 * from the same `t` theme object. Kept intentionally tiny; if the dashboard
 * later exports its shared primitives, these can be deleted and swapped.
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
  const style = variant === "primary" ? { background: t.primary, color: "#fff" } :
    variant === "danger" ? { background: "transparent", color: t.poor, border: "1px solid " + t.poor } :
    { background: "transparent", color: t.text, border: "1px solid " + t.border };
  return <button title={title} disabled={disabled} onClick={onClick} className={base + " " + className} style={style}>{children}</button>;
}

export function Field({ t, label, children }) {
  return <label className="block"><span className="block text-xs mb-1.5" style={{ color: t.muted }}>{label}</span>{children}</label>;
}

export function inputStyle(t) { return { background: t.inputBg, border: "1px solid " + t.border, color: t.text }; }

export const TextInput = React.forwardRef(function TextInput({ t, ...p }, ref) {
  return <input ref={ref} {...p} className={"w-full rounded-xl px-3 py-2.5 text-sm outline-none " + (p.className || "")} style={{ ...inputStyle(t), ...(p.style || {}) }}
    onFocus={(e) => (e.target.style.borderColor = t.primary)} onBlur={(e) => (e.target.style.borderColor = t.border)} />;
});

export function SelectInput({ t, children, ...p }) {
  return <select {...p} className={"rounded-xl px-3 py-2.5 text-sm outline-none " + (p.className || "")} style={{ ...inputStyle(t), ...(p.style || {}) }}>{children}</select>;
}

export function Empty({ t, title, sub }) {
  return <div className="text-center py-10"><div className="text-xl font-semibold" style={{ color: t.text }}>{title}</div><div className="text-sm mt-1" style={{ color: t.muted }}>{sub}</div></div>;
}

/** Distinct, theme-neutral palette used to color pins/rows by route. */
export const ROUTE_PALETTE = [
  "#6366f1", "#38bdf8", "#10b981", "#f59e0b", "#f43f5e",
  "#a78bfa", "#14b8a6", "#eab308", "#ec4899", "#0ea5e9",
];

/** Build a stable { routeName -> color } map from the list of route names. */
export function routeColorMap(routes) {
  const map = {};
  routes.forEach((r, i) => { map[r] = ROUTE_PALETTE[i % ROUTE_PALETTE.length]; });
  return map;
}

/** Status chip mirroring the dashboard's Pill, colored by stop status. */
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
