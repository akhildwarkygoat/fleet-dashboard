/* The formula is built from chips, never typed: variables, operators and digits are pressed in, a
   digit pressed after a number joins it, and Backspace or Delete in the box takes off the last chip
   whole (on a focused chip, that chip). The same rules as the old chip editor; tokens are the old { t, v } shape so
   tokensToExpr / exprToTokens read and write them. */
import React, { useRef } from "react";
import { Delete, X } from "lucide-react";
import { DIGITS, FORMULA_VARS, OPS, VAR_INFO, metricsFor } from "../../../Dashboard.jsx";
import { Button, Eyebrow, cx } from "../../ui.jsx";
import { count, money } from "../../format.js";

/* The old form's sample bus, worked through the shared metricsFor: the preview and the check on
   Add see exactly the figures they always did. */
const SAMPLE_REC = { present: 38, absent: 3, km: 48, budget: 2600, spend: 2480, spendDiesel: 2390 };
const SAMPLE_BUS = { capacity: 42 };
export const SAMPLE = metricsFor(SAMPLE_REC, SAMPLE_BUS, 1);
export const SAMPLE_TEXT = `${count(SAMPLE_REC.present)} riders, ${count(SAMPLE_BUS.capacity)} seats, ${count(SAMPLE_REC.km)} km`;
export const SAMPLE_TITLE = `Sample bus: ${SAMPLE_TEXT}, ${money(SAMPLE_REC.spend)} spent by km, ${money(SAMPLE_REC.spendDiesel)} by diesel, budget ${money(SAMPLE_REC.budget)} a day`;

const MEANING = Object.fromEntries(VAR_INFO);
/** The face of an operator: × ÷ − as a manager writes them. The token keeps * / -. */
export const FACE = { "*": "×", "/": "÷", "-": "−" };
export const exprFace = (expr) => expr.replace(/[*/-]/g, (c) => FACE[c]);
const OP_NAME = { "+": "plus", "-": "minus", "*": "times", "/": "divided by", "(": "open bracket", ")": "close bracket" };

function ops(tokens, setTokens) {
  const push = (tok) => setTokens([...tokens, tok]);
  return {
    push,
    pushDigit(d) {
      const last = tokens[tokens.length - 1];
      if (last && last.t === "n") setTokens([...tokens.slice(0, -1), { t: "n", v: last.v + d }]);
      else push({ t: "n", v: d });
    },
    pushOp: (o) => push({ t: ["(", ")"].includes(o) ? "p" : "o", v: o }),
    back: () => setTokens(tokens.slice(0, -1)),
    clear: () => setTokens([]),
    removeAt: (i) => setTokens(tokens.filter((_, j) => j !== i)),
  };
}

/** The formula as chips. Press a chip to take it out; Backspace takes off the last one. */
export function FormulaBox({ tokens, setTokens, describedBy }) {
  const o = ops(tokens, setTokens);
  const box = useRef(null);
  const onKeyDown = (e) => {
    if (e.key !== "Backspace" && e.key !== "Delete") return;
    e.preventDefault();
    const at = e.target.dataset.at;
    if (at == null) return o.back();
    // the chip goes; focus moves to the one that takes its place, or back to the box
    const i = +at;
    o.removeAt(i);
    requestAnimationFrame(() => {
      const chips = box.current && box.current.querySelectorAll("[data-at]");
      const next = chips && (chips[Math.min(i, chips.length - 1)] || null);
      (next || box.current)?.focus();
    });
  };
  return (
    <div ref={box} tabIndex={0} role="group" aria-label="Formula, Backspace removes the last part" onKeyDown={onKeyDown} aria-describedby={describedBy}
      className="flex min-h-[64px] flex-wrap items-center gap-1.5 rounded-tile bg-satin p-2.5">
      {tokens.length === 0 && <span className="px-2 text-[13px] text-ink-2">Press variables, operators and numbers to build it</span>}
      {tokens.map((tk, i) => (
        <button key={i} type="button" data-at={i} onClick={() => o.removeAt(i)} aria-label={`Remove ${OP_NAME[tk.v] || tk.v}`} title="Remove"
          className={cx("inline-flex h-9 items-center gap-1 rounded-pill pl-2.5 pr-1.5 font-code text-[13px] font-semibold transition-transform duration-150 active:scale-[0.95]",
            tk.t === "v" ? "bg-white text-ink shadow-chip" : tk.t === "n" ? "bg-white text-ink-2" : "bg-satin-2 text-ink-2")}>
          {FACE[tk.v] || tk.v}<X size={12} aria-hidden className="text-ink-4" />
        </button>
      ))}
    </div>
  );
}

const varCls = "flex min-w-0 flex-col items-start rounded-tile bg-white px-3 py-2 text-left shadow-chip transition-transform duration-150 hover:bg-satin active:scale-[0.97]";
const keyCls = "flex h-10 items-center justify-center rounded-pill font-code text-[15px] font-semibold text-ink transition-[background-color,transform] duration-150 active:scale-[0.94]";
const digitCls = cx(keyCls, "bg-white shadow-chip hover:bg-satin");
const opCls = cx(keyCls, "bg-satin-2 hover:bg-line");

const VarKey = ({ name, meaning, onClick }) => (
  <button type="button" onClick={onClick} className={varCls}>
    <span className="max-w-full truncate font-code text-[13px] font-semibold text-ink">{name}</span>
    <span className="text-[12px] leading-4 text-ink-3">{meaning}</span>
  </button>
);

/** What can go into the formula: the dashboard's variables, your own, then a keypad. */
export function FormulaKeys({ tokens, setTokens, variables }) {
  const o = ops(tokens, setTokens);
  return (
    <div className="flex flex-col gap-4">
      <div>
        <Eyebrow className="mb-2">Variables</Eyebrow>
        <div className="grid grid-cols-2 gap-1.5">
          {FORMULA_VARS.map((v) => <VarKey key={v} name={v} meaning={MEANING[v]} onClick={() => o.push({ t: "v", v })} />)}
          {(variables || []).map((v) => (
            <VarKey key={v.id} name={v.name} meaning={`Your number, ${v.value}`} onClick={() => o.push({ t: "v", v: v.name })} />
          ))}
        </div>
      </div>
      <div>
        <Eyebrow className="mb-2">Operators and numbers</Eyebrow>
        <div className="flex gap-3">
          <div className="grid flex-[3] grid-cols-3 gap-1.5">
            {DIGITS.map((d) => <button key={d} type="button" onClick={() => o.pushDigit(d)} aria-label={`Add ${d}`} className={digitCls}>{d}</button>)}
            <button type="button" onClick={o.back} aria-label="Remove the last part" title="Back" className={opCls}><Delete size={18} aria-hidden /></button>
          </div>
          <div className="grid flex-[2] grid-cols-2 content-start gap-1.5">
            {OPS.map((op) => <button key={op} type="button" onClick={() => o.pushOp(op)} aria-label={`Add ${OP_NAME[op]}`} className={opCls}>{FACE[op] || op}</button>)}
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={o.clear} disabled={!tokens.length} className="-ml-2 mt-2">Clear formula</Button>
      </div>
    </div>
  );
}
