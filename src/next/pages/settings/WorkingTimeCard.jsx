/* Working time: working days a year, and the holidays taken off them, picked on a month grid.
   The calendar keeps the old one's rules: a day toggles, the list stays sorted, "Clear month"
   removes only the month on show, and every holiday comes off the days counted. */
import React, { useState } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { MONTHS, WEEKDAYS, effWorkingDays, ymd } from "../../../Dashboard.jsx";
import { Button, Card, CardTitle, IconButton, Input, Tile, Tiles, cx } from "../../ui.jsx";
import { Row, Rows, labelCls } from "./parts.jsx";
import { count, day, plural } from "../../format.js";

function MonthGrid({ holidays, setHolidays }) {
  const now = new Date();
  const [vy, setVy] = useState(now.getFullYear());
  const [vm, setVm] = useState(now.getMonth());
  const sel = new Set(holidays);
  const firstDow = new Date(vy, vm, 1).getDay();
  const days = new Date(vy, vm + 1, 0).getDate();
  const prefix = ymd(vy, vm, 1).slice(0, 7);
  const prev = () => { if (vm === 0) { setVm(11); setVy(vy - 1); } else setVm(vm - 1); };
  const next = () => { if (vm === 11) { setVm(0); setVy(vy + 1); } else setVm(vm + 1); };
  const toggle = (d) => { const k = ymd(vy, vm, d); const ns = new Set(sel); ns.has(k) ? ns.delete(k) : ns.add(k); setHolidays([...ns].sort()); };
  const clearMonth = () => setHolidays(holidays.filter((h) => !h.startsWith(prefix)));
  const todayK = ymd(now.getFullYear(), now.getMonth(), now.getDate());
  const monthCount = holidays.filter((h) => h.startsWith(prefix)).length;

  return (
    <div className="min-w-0">
      <div className="mb-2 flex items-center justify-between gap-2">
        <IconButton label="Previous month" icon={ChevronLeft} variant="satin" size="sm" onClick={prev} />
        <p className="text-[15px] font-bold tracking-[-0.01em] text-ink" aria-live="polite">{MONTHS[vm]} {vy}</p>
        <IconButton label="Next month" icon={ChevronRight} variant="satin" size="sm" onClick={next} />
      </div>
      <div className="grid grid-cols-7 gap-1 text-center" role="group" aria-label={`Holidays in ${MONTHS[vm]} ${vy}`}>
        {WEEKDAYS.map((w) => <span key={w} aria-hidden className="py-1 text-[11px] font-semibold text-ink-3">{w}</span>)}
        {Array.from({ length: firstDow }, (_, i) => <span key={"b" + i} aria-hidden />)}
        {Array.from({ length: days }, (_, i) => {
          const d = i + 1, k = ymd(vy, vm, d), on = sel.has(k), today = k === todayK;
          return (
            <button key={d} type="button" onClick={() => toggle(d)} aria-pressed={on} aria-label={`${d} ${MONTHS[vm]}`}
              aria-current={today ? "date" : undefined}
              className={cx("relative h-9 rounded-pill text-[13px] font-semibold tabular-nums transition-[background-color,color,transform] duration-150 active:scale-[0.94]",
                on ? "bg-ink text-white" : "text-ink-2 hover:bg-satin-2 hover:text-ink")}>
              {d}
              {today && <span aria-hidden className={cx("absolute bottom-1 left-1/2 h-1 w-1 -translate-x-1/2 rounded-pill", on ? "bg-white" : "bg-ink")} />}
            </button>
          );
        })}
      </div>
      <div className="mt-2 flex min-h-9 items-center justify-between gap-2">
        <p className="text-[13px] text-ink-3">{plural(monthCount, "holiday", "holidays")} in {MONTHS[vm]}</p>
        {monthCount > 0 && <Button variant="ghost" size="sm" onClick={clearMonth} className="-mr-2">Clear month</Button>}
      </div>
    </div>
  );
}

export default function WorkingTimeCard({ settings, setSettings, className }) {
  const holidays = settings.holidays || [];
  const setHolidays = (h) => setSettings({ ...settings, holidays: h });
  const delHoliday = (d) => setHolidays(holidays.filter((x) => x !== d));
  // a value that is not a number keeps the last one, as before
  const setDays = (e) => setSettings({ ...settings, workingDays: parseFloat(e.target.value) || settings.workingDays });

  return (
    <Card data-rise-deep className={className}>
      <CardTitle title="Working time" />
      <Rows>
        <Row label="Working days a year" hint="Used for yearly figures such as net value">
          <div className="w-28">
            <Input type="number" value={settings.workingDays} onChange={setDays} aria-label="Working days a year" className="text-right tabular-nums" />
          </div>
        </Row>
        <div className="grid gap-6 pt-4 sm:grid-cols-[minmax(0,300px)_minmax(0,1fr)]">
          <MonthGrid holidays={holidays} setHolidays={setHolidays} />
          <div className="flex min-w-0 flex-col gap-4">
            <Tiles>
              <Tile label="Working days after holidays" value={count(effWorkingDays(settings))} />
            </Tiles>
            <div>
              <p className={cx(labelCls, "mb-2")}>Holidays picked <span className="font-medium text-ink-3">· {count(holidays.length)}</span></p>
              {holidays.length ? (
                <ul className="flex flex-wrap gap-1.5">
                  {holidays.map((d) => (
                    <li key={d}>
                      <button type="button" onClick={() => delHoliday(d)} aria-label={`Remove holiday ${day(d)}`}
                        className="inline-flex h-9 items-center gap-1 rounded-pill bg-white pl-3 pr-2 text-[13px] font-semibold tabular-nums text-ink-2 shadow-chip transition-[color,transform] duration-150 hover:text-ink active:scale-[0.97]">
                        {day(d)}<X size={14} aria-hidden className="text-ink-3" />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : <p className="text-[13px] text-ink-3">None yet. Select days on the calendar.</p>}
            </div>
          </div>
        </div>
      </Rows>
    </Card>
  );
}
