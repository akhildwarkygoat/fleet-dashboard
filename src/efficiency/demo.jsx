/*
  Standalone DEMO harness for the Transport Efficiency Dashboard.
  ------------------------------------------------------------------
  This is intentionally NOT wired into the main app (Dashboard.jsx).
  It carries its own minimal theme + toast so the PRD dashboard can be
  shown on its own. Served via /efficiency.html (see repo root).
*/
import React, { useState, useRef } from "react";
import { createRoot } from "react-dom/client";
import { Bus, Sun, Moon } from "lucide-react";
import EfficiencyDashboard from "./EfficiencyDashboard.jsx";
import "../index.css";

/* self-contained theme (subset of the main app's palette) */
const THEMES = {
  light: {
    dark: false, bg: "#eef2f7", surface: "#ffffff", surface2: "#f8fafc", raised: "#f1f5f9",
    border: "#e2e8f0", text: "#0f172a", muted: "#64748b", faint: "#94a3b8",
    primary: "#4f46e5", primarySoft: "rgba(79,70,229,.10)", onPrimary: "#ffffff",
    good: "#059669", watch: "#d97706", poor: "#e11d48", gainup: "#0284c7", techno: "#7c3aed",
    goodSoft: "rgba(5,150,105,.10)", watchSoft: "rgba(217,119,6,.12)", poorSoft: "rgba(225,29,90,.10)",
    grid: "#e8edf4", inputBg: "#f8fafc",
  },
  dark: {
    dark: true, bg: "#0b1120", surface: "#111a2e", surface2: "#16213a", raised: "#1c2a47",
    border: "#26324d", text: "#e8edf6", muted: "#94a3b8", faint: "#5b6b86",
    primary: "#6366f1", primarySoft: "rgba(99,102,241,.16)", onPrimary: "#ffffff",
    good: "#10b981", watch: "#f59e0b", poor: "#f43f5e", gainup: "#38bdf8", techno: "#a78bfa",
    goodSoft: "rgba(16,185,129,.14)", watchSoft: "rgba(245,158,11,.14)", poorSoft: "rgba(244,63,94,.16)",
    grid: "#1f2a42", inputBg: "#0d1626",
  },
};

function Demo() {
  const [themeName, setThemeName] = useState("light");
  const t = THEMES[themeName];
  const [toastMsg, setToastMsg] = useState("");
  const timer = useRef();
  const toast = (m) => { setToastMsg(m); clearTimeout(timer.current); timer.current = setTimeout(() => setToastMsg(""), 2400); };

  return (
    <div className="min-h-screen w-full" style={{ background: t.bg, color: t.text, fontFamily: "Inter, system-ui, sans-serif" }}>
      <div className="sticky top-0 z-20" style={{ background: t.surface, borderBottom: "1px solid " + t.border }}>
        <div className="w-full px-6 flex items-center gap-4 py-2.5">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: t.primary }}><Bus size={20} color={t.onPrimary} /></div>
          <div className="min-w-0">
            <div className="font-bold text-lg leading-tight tracking-tight truncate">Transport Efficiency Dashboard</div>
            <div className="text-xs" style={{ color: t.muted }}>PRD v1.0 · demo (sample data)</div>
          </div>
          <div className="flex-1" />
          <button onClick={() => setThemeName(themeName === "light" ? "dark" : "light")} className="rounded-xl p-2.5" style={{ border: "1px solid " + t.border, color: t.muted, background: t.surface }}>
            {t.dark ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        </div>
      </div>
      <div className="w-full px-6 py-6">
        <EfficiencyDashboard t={t} toast={toast} />
      </div>
      {toastMsg && <div className="fixed left-1/2 bottom-6 -translate-x-1/2 rounded-xl px-4 py-3 text-sm z-50 shadow-lg" style={{ background: t.raised, border: "1px solid " + t.border, color: t.text }}>{toastMsg}</div>}
    </div>
  );
}

createRoot(document.getElementById("root")).render(<Demo />);
