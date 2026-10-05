/* Small pieces the Costs page needs that the kit does not have. */
import React, { useCallback, useLayoutEffect, useRef, useState } from "react";
import { Card, cx } from "../../ui.jsx";
import { motion } from "../../motion.js";

/* The period picked survives a trip to another page and back ("when i switch tabs the data i
   entered is lost"): kept in memory for the session. */
const kept = { kind: "month", anchor: null };
export function useKept(key) {
  const [value, set] = useState(kept[key]);
  return [value, useCallback((v) => { kept[key] = v; set(v); }, [key])];
}

/** A number that counts to its new value when it changes, never on first render. React never
 *  renders the text itself, so the tween can write it. `pulse` only on the hero. */
export function Count({ value, format, pulse, className }) {
  const el = useRef(null), prev = useRef(null), tween = useRef(null), fmt = useRef(format);
  fmt.current = format;
  useLayoutEffect(() => {
    if (tween.current) tween.current.kill();
    const from = prev.current;
    prev.current = value;
    if (from == null || from === value) { el.current.textContent = fmt.current(value); return; }
    tween.current = motion.countUp(el.current, from, value, (n) => fmt.current(n));
    if (pulse) motion.pulse(el.current);
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(() => () => tween.current && tween.current.kill(), []);
  return <span ref={el} className={cx("inline-block", className)} />;
}

/** Nothing here, as one short strip: the quiet icon, what is missing and the action that fills it,
 *  in a row on a wide screen so no tall empty card is left; stacked and centred on a phone. */
export function EmptyStrip({ icon: Icon, title, hint, action, className, ...rest }) {
  return (
    <Card padding="none" {...rest}
      className={cx("flex flex-col items-center gap-4 px-6 py-8 text-center sm:flex-row sm:py-5 sm:text-left", className)}>
      <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-pill bg-satin-2 text-ink-2">
        <Icon size={26} strokeWidth={2} aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[17px] font-bold tracking-[-0.01em] text-ink">{title}</p>
        {hint && <p className="mt-1 text-[13px] leading-relaxed text-ink-3">{hint}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </Card>
  );
}
