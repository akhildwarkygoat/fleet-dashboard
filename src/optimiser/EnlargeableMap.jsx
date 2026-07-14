/* ============================================================================
 * optimiser/EnlargeableMap.jsx — wraps a map with an "Enlarge" → fullscreen button
 * ----------------------------------------------------------------------------
 * `render(height, big)` returns the map at the given height, so the inline and
 * fullscreen copies are independent Leaflet instances (each initialises cleanly at
 * its own size). Shared by the Fleet-plan maps and the plan-editor boards.
 * ==========================================================================*/
import React, { useState } from "react";
import { Maximize2, X } from "lucide-react";

export default function EnlargeableMap({ t, render, height = 460 }) {
  const [big, setBig] = useState(false);
  const bigH = typeof window !== "undefined" ? Math.round(window.innerHeight - 120) : 800;
  return (<>
    {/* While enlarged, don't also mount the inline map — one map at a time avoids the heavy
       double-render AND the old bug where the inline map's Leaflet controls bled through. */}
    <div className="relative" style={{ minHeight: height }}>
      {!big && render(height, false)}
      {!big && (
        <button type="button" onClick={() => setBig(true)} title="Enlarge map"
          className="absolute top-3 right-3 z-[600] rounded-lg px-3 py-1.5 text-xs font-semibold flex items-center gap-1.5"
          style={{ background: t.dark ? "rgba(20,28,38,0.55)" : "rgba(255,255,255,0.4)", backdropFilter: "blur(10px) saturate(180%)", WebkitBackdropFilter: "blur(10px) saturate(180%)", border: "1px solid " + (t.dark ? "rgba(255,255,255,0.14)" : "rgba(255,255,255,0.55)"), color: t.text, cursor: "pointer", boxShadow: t.dark ? "0 2px 8px rgba(0,0,0,.4), inset 0 1px 1px rgba(255,255,255,0.08)" : "0 2px 8px rgba(15,23,42,.18), inset 0 1px 1px rgba(255,255,255,0.7)" }}>
          <Maximize2 size={13} /> Enlarge
        </button>
      )}
    </div>
    {big && (
      <div className="fixed inset-0 z-[2000] p-4 flex flex-col" style={{ background: "rgba(0,0,0,0.65)" }} onClick={() => setBig(false)}>
        <div className="ml-auto mb-2">
          <button type="button" onClick={() => setBig(false)} className="rounded-lg px-3 py-1.5 text-sm font-medium flex items-center gap-1.5"
            style={{ background: t.surface, color: t.text, cursor: "pointer" }}><X size={15} /> Close</button>
        </div>
        <div className="flex-1 min-h-0" onClick={(e) => e.stopPropagation()}>{render(bigH, true)}</div>
      </div>
    )}
  </>);
}
