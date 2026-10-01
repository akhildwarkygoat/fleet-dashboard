/* How numbers, money, dates and times read in the new look.

   Every figure is still worked out by the shared functions in Dashboard.jsx; these only change how
   the result is written: a true minus sign (−), "—" for a value that is not known, "01 Oct" dates,
   24-hour times and "2 h 16 min" durations. Digits come from the same formatters as the old look,
   so the two looks always print the same amounts. */
import { inr, inr1, inrK, pct, km1 } from "../Dashboard.jsx";

export const MINUS = "−";
export const DASH = "—";
const known = (n) => n != null && Number.isFinite(+n);
// the old formatters write "₹-5" or "-₹5.3L"; put the sign first, as a real minus
const signed = (s) => s.replace(/^₹-/, MINUS + "₹").replace(/^-/, MINUS);

/** ₹1,52,927 (whole rupees, Indian grouping). */
export const money = (n) => (known(n) ? signed(inr(+n)) : DASH);
/** ₹58.7 (one decimal, for per-km and per-head figures under ₹100). */
export const money1 = (n) => (known(n) ? signed(inr1(+n)) : DASH);
/** ₹5.3L / ₹1.2Cr (for tight spaces). */
export const moneyShort = (n) => (known(n) ? signed(inrK(+n)) : DASH);
/** +₹1,200 / −₹1,200 / ₹0: sign always written, so colour is never the only signal. */
export const moneySigned = (n) => (!known(n) ? DASH : +n > 0 ? "+" + money(n) : money(n));
export const moneyShortSigned = (n) => (!known(n) ? DASH : +n > 0 ? "+" + moneyShort(n) : moneyShort(n));

/** 96% (whole percent). */
export const percent = (n) => (known(n) ? pct(+n) : DASH);
/** 1,234 */
export const count = (n) => (known(n) ? Math.round(+n).toLocaleString("en-IN") : DASH);
/** 12.5 (km, one decimal at most) */
export const kms = (n) => (known(n) ? km1(+n) : DASH);

const thisYear = () => new Date().getFullYear();
/** "01 Oct", with the year only when it is not this year. Takes "2026-10-01". */
export function day(iso) {
  if (!iso) return DASH;
  const dt = new Date(String(iso).slice(0, 10) + "T00:00:00Z");
  if (Number.isNaN(dt.getTime())) return DASH;
  const opts = { day: "2-digit", month: "short", timeZone: "UTC" };
  if (dt.getUTCFullYear() !== thisYear()) opts.year = "numeric";
  return dt.toLocaleDateString("en-GB", opts);
}
/** "01 Oct – 07 Oct" or one day when both ends match. */
export const dayRange = (from, to) => (!from && !to ? DASH : !to || from === to ? day(from || to) : `${day(from)} – ${day(to)}`);
/** "18:07" from a timestamp. */
export function clock(ts) {
  if (ts == null) return DASH;
  const dt = new Date(ts);
  if (Number.isNaN(dt.getTime())) return DASH;
  return `${String(dt.getHours()).padStart(2, "0")}:${String(dt.getMinutes()).padStart(2, "0")}`;
}
/** "2 h 16 min", "12 min", "2 h". Takes minutes. */
export function duration(min) {
  if (!known(min)) return DASH;
  const m = Math.round(+min);
  const h = Math.floor(m / 60), r = m % 60;
  if (!h) return `${r} min`;
  return r ? `${h} h ${r} min` : `${h} h`;
}
/** "1 bus" / "3 buses" */
export const plural = (n, one, many) => `${count(n)} ${Math.round(+n) === 1 ? one : many}`;
/** Matching that forgives case and spaces, so "tn57 ab" finds "TN57AB3636". */
export const squash = (s) => String(s || "").toLowerCase().replace(/\s+/g, "");
