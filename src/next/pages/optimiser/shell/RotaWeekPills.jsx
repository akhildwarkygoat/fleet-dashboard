/* Which rota week the Rotational plans are drawn for, as one compact pill under a "Rota week" label:
   previous week, the week, next week. The state and the two moves are the old picker's
   (useRotaWeekPicker); stepping back onto this week follows the calendar again. A week other than
   this one reads amber in the pill, with "Back to this week" beside it.
   A Rotational slot names the group on its clock that week inside the pill; with no slot (Overall)
   the whole rota sits beside the pill, as the old picker's strip did. */
import React, { useId } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useRotaWeekPicker } from "../../../../optimiser/RotaWeekPicker.jsx";
import { ROTATION, rotationFor } from "../../../../optimiser/rotation.js";
import { ROTATION_SLOTS } from "../../../../optimiser/services.js";
import { Button, IconButton, Tag, cx } from "../../../ui.jsx";
import { day } from "../../../format.js";

// clock order, as the floor names them: 06:00, 14:00, 22:00
const CLOCKS = ["day", "half", "full"];
const slotOf = (id) => ROTATION_SLOTS.find((s) => s.id === id) || { id, name: id };
const groupName = (g) => (g && ROTATION.groups[g] ? ROTATION.groups[g].label : "No group");
const rota = (week) => {
  const r = rotationFor(week);
  return CLOCKS.map((id) => `${slotOf(id).name} ${groupName(r.bySlot[id])}`).join(", ");
};

export default function RotaWeekPills({ toast, slot }) {
  const announce = (w, thisWeek) => toast && toast(`Rotational plans now show the week of ${day(w)}${w === thisWeek ? " (this week)" : ""}: ${rota(w)}`);
  const { week, pinned, previewing, step, reset } = useRotaWeekPicker(announce);
  const bySlot = rotationFor(week).bySlot;
  const labelId = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <span id={labelId} className="text-xs font-semibold text-ink-3">Rota week</span>
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-labelledby={labelId} className="inline-flex h-11 items-center gap-0.5 rounded-pill bg-white px-1 shadow-chip">
          <IconButton label="Previous week" icon={ChevronLeft} variant="ghost" size="sm" onClick={() => step(-7)} />
          <span className={cx("whitespace-nowrap px-1.5 text-[13px] font-semibold tabular-nums", previewing ? "text-warn-ink" : "text-ink")}
            title={previewing ? `Not this week. ${rota(week)}` : rota(week)} aria-live="polite">
            Week of {day(week)}{slot && <span className="font-medium text-ink-3"> · {groupName(bySlot[slot])}</span>}
          </span>
          <IconButton label="Next week" icon={ChevronRight} variant="ghost" size="sm" onClick={() => step(7)} />
        </div>
        {!slot && CLOCKS.map((id) => (
          <Tag key={id} className="whitespace-nowrap">
            <span aria-hidden className="h-2 w-2 shrink-0 rounded-pill" style={{ background: slotOf(id).color }} />
            {slotOf(id).name}: {groupName(bySlot[id])}
          </Tag>
        ))}
        {pinned && <Button variant="ghost" size="sm" onClick={reset}>Back to this week</Button>}
      </div>
    </div>
  );
}
