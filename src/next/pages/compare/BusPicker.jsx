/* Picking the buses one chart compares: nothing is picked at first; open a company, then pick its
   buses. Companies start folded; a search opens every company with a match. Buses from different
   companies can sit on one chart. The body sits in the empty chart itself before the first pick,
   and in a centred card when the buses are changed later. */
import React, { useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import { UNITS } from "../../../Dashboard.jsx";
import { Button, CentreCard, Chip, CompanyDot, Search, cx } from "../../ui.jsx";
import { count, plural, squash } from "../../format.js";

/** Search and the company groups with their bus chips. `onSatin` when it sits on a satin tile. */
export function BusPickerBody({ chart, buses, picked, onChange, q, onQ, onSatin }) {
  const [folds, setFolds] = useState({});
  // a search opens every company with a match; one closed by hand stays closed until the search changes
  const [shut, setShut] = useState({ q: "", units: {} });
  const sq = squash(q);
  const shutNow = shut.q === sq ? shut.units : {};
  const groups = useMemo(() => UNITS.map((unit) => {
    const all = buses.filter((b) => b.unit === unit);
    const list = sq ? all.filter((b) => squash(b.vehicle).includes(sq) || squash(b.route).includes(sq)) : all;
    return { unit, all, list, on: all.filter((b) => picked.includes(b.id)).length };
  }), [buses, picked, sq]);

  const toggle = (id) => onChange(picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id]);
  const pickAll = (list) => onChange([...new Set([...picked, ...list.map((b) => b.id)])]);
  const dropAll = (list) => onChange(picked.filter((id) => !list.some((b) => b.id === id)));

  return (
    <>
      <Search value={q} onChange={onQ} label="Search vehicle or route" placeholder="Search vehicle or route" />
      <div className="mt-2 divide-y divide-line">
        {groups.map((g) => {
          const isOpen = sq ? g.list.length > 0 && !shutNow[g.unit] : !!folds[g.unit];
          const fold = () => (sq ? setShut({ q: sq, units: { ...shutNow, [g.unit]: isOpen } }) : setFolds((f) => ({ ...f, [g.unit]: !f[g.unit] })));
          const id = "pick-" + chart.replace(/\s/g, "") + "-" + g.unit;
          const allOn = g.list.length > 0 && g.list.every((b) => picked.includes(b.id));
          const bulk = allOn ? "Clear" : sq ? "Pick matches" : "Pick all";
          return (
            <section key={g.unit} className="py-2">
              <div className="flex items-center gap-2">
                <button type="button" aria-expanded={isOpen} aria-controls={id} disabled={!g.list.length} onClick={fold}
                  className={cx("-ml-1 flex min-w-0 flex-1 items-center gap-3 rounded-pill py-1.5 pl-1 pr-3 text-left transition-colors duration-150 disabled:cursor-default disabled:hover:bg-transparent",
                    onSatin ? "hover:bg-satin-2" : "hover:bg-satin")}>
                  <span className={cx("flex h-8 w-8 shrink-0 items-center justify-center rounded-pill text-ink-2", onSatin ? "bg-white" : "bg-satin-2")}>
                    <ChevronRight size={18} strokeWidth={2} aria-hidden className={cx("transition-transform duration-200", isOpen && "rotate-90")} />
                  </span>
                  <CompanyDot unit={g.unit} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-bold tracking-[-0.01em] text-ink">{g.unit}</span>
                    <span className="block truncate text-[13px] tabular-nums text-ink-3">
                      {!g.all.length ? "No buses in the ERP yet" : sq && !g.list.length ? "No match" : `${count(g.on)} of ${plural(g.all.length, "bus", "buses")} picked`}
                    </span>
                  </span>
                </button>
                {g.list.length > 0 && (
                  <Button variant="ghost" size="sm" aria-label={`${bulk} in ${g.unit}`} onClick={() => (allOn ? dropAll(g.list) : pickAll(g.list))}>
                    {bulk}
                  </Button>
                )}
              </div>
              {isOpen && (
                <div id={id} className="flex flex-wrap gap-1.5 pb-1 pl-11 pt-2.5">
                  {g.list.map((b) => (
                    <Chip key={b.id} on={picked.includes(b.id)} onClick={() => toggle(b.id)} title={b.route || undefined} className="font-code">
                      {b.vehicle}
                    </Chip>
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </div>
      {sq && groups.every((g) => !g.list.length) && (
        <p className="py-6 text-center text-[15px] text-ink-2">No bus matches “{q.trim()}”</p>
      )}
    </>
  );
}

/** The same picker in a centred card, for changing the buses of a chart that already shows some. */
export default function BusPicker({ open, onClose, chart, buses, picked, onChange }) {
  const [q, setQ] = useState("");
  const total = picked.filter((id) => buses.some((b) => b.id === id)).length;
  const close = () => { setQ(""); onClose(); };
  return (
    <CentreCard open={open} onClose={close} width={600} title="Change buses" sub={chart}
      footer={(
        <>
          <span className="mr-auto self-center text-[13px] tabular-nums text-ink-3">{total ? `${plural(total, "bus", "buses")} picked` : "None picked"}</span>
          {total > 0 && <Button variant="ghost" onClick={() => onChange([])}>Clear all</Button>}
          <Button variant="primary" onClick={close}>Done</Button>
        </>
      )}>
      <BusPickerBody chart={chart} buses={buses} picked={picked} onChange={onChange} q={q} onQ={setQ} />
    </CentreCard>
  );
}
