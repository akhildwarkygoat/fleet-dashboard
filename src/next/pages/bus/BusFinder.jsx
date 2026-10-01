/* Find another bus: type part of a vehicle number, a route or a driver, and pick from up to eight
   matches. Arrow keys move through them, Enter opens one, Escape closes the list. */
import React, { useId, useMemo, useRef, useState } from "react";
import { Search as SearchIcon, X } from "lucide-react";
import { RUN_OPTIMISER, NEEDS_ERP } from "../../../erp.js";
import { CompanyDot, cx, fieldCls } from "../../ui.jsx";
import { kms, squash } from "../../format.js";
import { go } from "../../route.js";

const known = (v, placeholder) => (v && v !== placeholder ? v : "");
/** The line under a vehicle number: its route length once planned. */
export const routeLine = (b) => (b.planStops && b.planStops.length ? `${kms(b.planKm)} km route` : "Route not planned yet");

/* The kit's Search, as a combobox: the field owns the list, so a screen reader hears which bus
   Enter will open. */
export default function BusFinder({ buses, className, label = "Find another bus" }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const wrap = useRef(null), input = useRef(null);
  const id = useId();
  const s = squash(q);
  const matches = useMemo(() => (s
    ? buses.filter((b) => [b.vehicle, known(b.route, RUN_OPTIMISER), known(b.driver, NEEDS_ERP)].some((v) => squash(v).includes(s))).slice(0, 8)
    : []), [buses, s]);
  const at = Math.min(active, Math.max(0, matches.length - 1));
  const shown = open && !!s;
  const optId = (i) => `${id}-o${i}`;

  const pick = (b) => { setQ(""); setOpen(false); go("bus", b.id); };
  const onKeyDown = (e) => {
    if (e.key === "Escape") { setOpen(false); return; }
    if (!matches.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setActive((at + 1) % matches.length); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setOpen(true); setActive((at - 1 + matches.length) % matches.length); }
    else if (e.key === "Enter") { e.preventDefault(); pick(matches[at]); }
  };

  return (
    <div ref={wrap} className={cx("relative", className)}
      onBlur={(e) => { if (!wrap.current.contains(e.relatedTarget)) setOpen(false); }}>
      <div className="relative min-w-0">
        <SearchIcon size={18} aria-hidden className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-3" />
        <input ref={input} type="search" role="combobox" aria-label={label} placeholder={label} value={q} autoComplete="off"
          aria-expanded={shown} aria-controls={id} aria-autocomplete="list"
          aria-activedescendant={shown && matches.length ? optId(at) : undefined}
          onChange={(e) => { setQ(e.target.value); setOpen(true); setActive(0); }} onFocus={() => setOpen(true)} onKeyDown={onKeyDown}
          className={cx(fieldCls, "pl-11 pr-11")} />
        {q && (
          <button type="button" aria-label="Clear search" onClick={() => { setQ(""); input.current.focus(); }}
            className="absolute right-1.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-pill text-ink-3 transition-colors hover:bg-line hover:text-ink">
            <X size={16} aria-hidden />
          </button>
        )}
      </div>
      {shown && (
        <div className="absolute inset-x-0 top-full z-30 mt-2 min-w-[260px] rounded-card bg-white p-2 text-left shadow-float">
          {matches.length ? (
            <ul id={id} role="listbox" aria-label="Matching buses">
              {matches.map((b, i) => (
                // mousedown keeps focus in the field, so the list stays open until the click lands
                <li key={b.id} id={optId(i)} role="option" aria-selected={i === at}
                  onMouseDown={(e) => e.preventDefault()} onMouseEnter={() => setActive(i)} onClick={() => pick(b)}
                  className={cx("flex cursor-pointer items-center gap-3 rounded-tile px-3 py-2 transition-[background-color,transform] duration-150 active:scale-[0.985]",
                    i === at ? "bg-satin" : "hover:bg-satin")}>
                  <CompanyDot unit={b.unit} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-code text-[15px] font-semibold text-ink">{b.vehicle}</span>
                    <span className="block truncate text-[13px] text-ink-3">{b.unit} · {routeLine(b)}</span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p id={id} className="px-3 py-3 text-[13px] text-ink-3">No bus matches “{q.trim()}”</p>
          )}
        </div>
      )}
    </div>
  );
}
