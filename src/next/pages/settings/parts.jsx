/* Small pieces the settings page needs that the kit does not have. */
import React, { useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { localIso, uid } from "../../../Dashboard.jsx";
import { Button, Choice, IconButton, Input, cx } from "../../ui.jsx";
import { clock, day } from "../../format.js";
import { useFocusBack } from "../bus/parts.jsx";

export const labelCls = "text-[15px] font-semibold text-ink-2";

/** One setting: label left in ink-2 with an optional grey line (and a second one, `detail`), the
 *  control right. Rows sit in `divide-y divide-line` inside one card. A hint wraps to two lines at
 *  most; an error hint is never cut. */
export function Row({ label, hint, hintTitle, hintTone, detail, children, className }) {
  return (
    <div className={cx("flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3.5 first:pt-0 last:pb-0", className)}>
      <div className="min-w-0 flex-1 basis-56">
        <p className={labelCls}>{label}</p>
        {hint && (
          <p className={cx("mt-0.5 text-[13px]", hintTone === "bad" ? "break-words text-bad-ink" : "line-clamp-2 text-ink-3")} title={hintTitle}>{hint}</p>
        )}
        {detail && <p className="text-[13px] text-ink-3" title={hintTitle}>{detail}</p>}
      </div>
      {children && <div className="flex shrink-0 flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}
export const Rows = ({ className, children }) => <div className={cx("divide-y divide-line", className)}>{children}</div>;

/** On and Off side by side, the current one ink, so the state never reads as a button. */
const ON_OFF = [[true, "On"], [false, "Off"]];
export function OnOff({ on, onChange, label }) {
  return <Choice label={label} value={!!on} options={ON_OFF} onChange={onChange} />;
}

/** A remove button that asks once, in place: Cancel and a red Remove take its spot, and Cancel
 *  hands focus back to it. `children` are the row's other buttons, hidden while asking. */
export function RemoveSwap({ name, onRemove, children }) {
  const [asking, setAsking] = useState(false);
  const bin = useRef(null);
  useFocusBack(asking, bin);
  return asking ? (
    <>
      <Button variant="ghost" size="sm" autoFocus onClick={() => setAsking(false)}>Cancel</Button>
      <Button variant="danger" size="sm" icon={Trash2} aria-label={`Remove ${name}`} onClick={() => { setAsking(false); onRemove(); }}>Remove</Button>
    </>
  ) : (
    <>
      {children}
      <IconButton ref={bin} label={`Remove ${name}`} icon={Trash2} variant="ghost" size="sm" onClick={() => setAsking(true)} />
    </>
  );
}

/** A group of controls with the small grey label above it (a <Field> would hand clicks on the
 *  label to the first button). */
export function Group({ label, className, children }) {
  return (
    <div className={cx("flex min-w-0 flex-col gap-1.5", className)}>
      <span className="text-xs font-semibold text-ink-3">{label}</span>
      {children}
    </div>
  );
}

/** "Updated 18:07", or "Updated 30 Sep, 18:07" when it was not today. */
export function Updated({ at }) {
  if (!at) return null;
  const d = localIso(new Date(at));
  return (
    <span className="whitespace-nowrap text-[13px] text-ink-3">
      Updated {d !== localIso() && `${day(d)}, `}<span className="font-code">{clock(at)}</span>
    </span>
  );
}

/* Bands: rows of colour, name and the lowest value that reaches them, highest first. The same
   editing rules as the old editor: a new band starts at 0 in slate grey, a minimum that is not a
   number reads 0, and the last band cannot be removed. The order is fixed while a minimum is typed
   and settles when the field is left, so a row never jumps under the cursor. */
const highestFirst = (list) => [...list].sort((a, b) => b.min - a.min).map((b) => b.id);

export function BandRows({ bands, setBands, unit = "%" }) {
  const [order, setOrder] = useState(() => highestFirst(bands));
  const settle = (list) => { setBands(list); setOrder(highestFirst(list)); };
  const update = (id, patch) => setBands(bands.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  const add = () => settle([...bands, { id: uid(), label: "New band", min: 0, color: "#64748b" }]);
  const del = (id) => settle(bands.filter((b) => b.id !== id));
  // bands replaced from outside (a reset) take the sorted order again
  const ids = order.length === bands.length && bands.every((b) => order.includes(b.id)) ? order : highestFirst(bands);
  const shown = ids.map((id) => bands.find((b) => b.id === id));
  return (
    <div className="flex flex-col gap-2">
      {shown.map((b) => (
        <div key={b.id} className="flex items-center gap-2">
          <span className="relative h-9 w-9 shrink-0 rounded-pill shadow-chip focus-within:ring-2 focus-within:ring-nova" style={{ background: b.color }}>
            <input type="color" value={b.color} onChange={(e) => update(b.id, { color: e.target.value })}
              aria-label={`Colour for ${b.label}`} title="Change colour" className="absolute inset-0 h-full w-full cursor-pointer rounded-pill opacity-0" />
          </span>
          <Input value={b.label} onChange={(e) => update(b.id, { label: e.target.value })} aria-label="Band name" className="flex-1" />
          <div className="w-20 shrink-0">
            <Input type="number" value={b.min} onChange={(e) => update(b.id, { min: parseFloat(e.target.value) || 0 })}
              onBlur={() => setOrder(highestFirst(bands))}
              aria-label={`Lowest value for ${b.label}`} className="text-right tabular-nums" />
          </div>
          <span className="shrink-0 whitespace-nowrap text-[13px] text-ink-3">{unit}<span className="hidden sm:inline">{unit && " "}and up</span></span>
          {bands.length > 1 && <IconButton label={`Remove ${b.label}`} icon={Trash2} variant="ghost" size="sm" onClick={() => del(b.id)} />}
        </div>
      ))}
      <Button variant="ghost" size="sm" icon={Plus} onClick={add} className="-ml-2 self-start">Add band</Button>
    </div>
  );
}
