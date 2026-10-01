/* Where one bus starts its run or parks when it is done. Only places on the road matrix are offered,
   so the choice can be costed; a stop selected on the map works too while this is open. */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Check, Crosshair, MapPin, X } from "lucide-react";
import { parkMatches } from "../../../../optimiser/ParkPicker.jsx";
import { Chip, IconButton, Search, cx } from "../../../ui.jsx";
import { count, kms } from "../../../format.js";

export default function EndPicker({ busName, which, current, points, onPick, onClose }) {
  const [q, setQ] = useState("");
  const box = useRef(null);
  // opening the picker puts the cursor in its search, so a place can be typed straight away
  useEffect(() => { const input = box.current && box.current.querySelector("input"); if (input) input.focus({ preventScroll: true }); }, []);
  const list = useMemo(() => parkMatches(points, q), [points, q]);
  const cur = current || { kind: "auto" };
  const start = which === "start";
  const isDefault = cur.kind === "auto" || cur.kind === "tail";

  return (
    <div className="flex min-h-0 flex-1 flex-col p-4">
      <div className="flex items-start gap-2">
        <h3 className="min-w-0 flex-1 text-[15px] font-bold leading-snug tracking-[-0.01em] text-ink">
          <span className="font-code">{busName}</span> {start ? "starts from" : "parks at"}
        </h3>
        <IconButton label="Close" icon={X} variant="satin" size="sm" onClick={onClose} />
      </div>

      <div role="radiogroup" aria-label={start ? "Start" : "Park"} className="mt-3 flex flex-wrap gap-1.5">
        <Chip role="radio" on={isDefault} onClick={() => onPick({ kind: "auto" })}>{start ? "Factory" : "Where it ends"}</Chip>
        {!start && <Chip role="radio" on={cur.kind === "depot"} onClick={() => onPick({ kind: "depot" })}>Factory</Chip>}
      </div>

      <p className="mt-3 flex items-start gap-2 text-[13px] leading-snug text-ink-2">
        <Crosshair size={15} aria-hidden className="mt-0.5 shrink-0 text-ink-3" />
        <span>Select a stop on the map to use it. Stops are not added or taken off while this is open.</span>
      </p>

      <div ref={box} className="mt-3">
        <Search value={q} onChange={setQ} label="Search places"
          placeholder={points.length ? `Search ${count(points.length)} places` : "Loading places…"} />
      </div>

      <ul className="mt-2 flex min-h-[120px] flex-1 flex-col gap-0.5 overflow-y-auto">
        {list.map((p) => {
          const on = cur.kind === "node" && cur.idx === p.idx;
          return (
            <li key={p.idx}>
              <button type="button" onClick={() => onPick({ kind: "node", idx: p.idx, name: p.name })} aria-pressed={on}
                className={cx("flex w-full items-center gap-2 rounded-pill px-3 py-2 text-left text-[13px] transition-colors",
                  on ? "bg-ink text-white" : "text-ink hover:bg-white/80")}>
                {on ? <Check size={15} aria-hidden className="shrink-0" /> : <MapPin size={15} aria-hidden className="shrink-0 text-ink-3" />}
                <span className="min-w-0 flex-1 truncate">{p.name}</span>
                {p.depotKm != null && <span className={cx("shrink-0 tabular-nums", on ? "text-white/70" : "text-ink-3")}>{kms(p.depotKm)} km</span>}
              </button>
            </li>
          );
        })}
        {!list.length && (
          <li className="py-6 text-center text-[13px] text-ink-3">
            {points.length ? `No place matches “${q.trim()}”` : "No places loaded"}
          </li>
        )}
      </ul>
    </div>
  );
}
