/* ============================================================================
 * costModel.js — the per-bus standing cost model, shared by the dashboard and the cost report.
 * ----------------------------------------------------------------------------
 * Each bus carries a cost profile { budget:{amount,period}, lines:[{id,type,amount,quantity,period}] }
 * from the ERP costing feed. Every line is normalised to a per-day figure: a yearly amount is spread
 * over the working days of the year, a monthly one is annualised first.
 * ==========================================================================*/
export const COST_TYPES = [
  { key: "diesel", label: "Diesel", qty: true, qtyLabel: "litres / day", period: "day" },
  { key: "driver", label: "Driver Salary", qty: false, period: "month" },
  { key: "maint", label: "Maintenance", qty: false, period: "month" },
  { key: "tires", label: "Tires", qty: true, qtyLabel: "no. of tyres", period: "year" },
  { key: "tiremaint", label: "Tire maintenance", qty: true, qtyLabel: "no. of tyres", period: "year" },
  { key: "fc", label: "FC Works", qty: false, period: "year" },
  { key: "taxes", label: "Taxes", qty: false, period: "year" },
  { key: "insurance", label: "Insurance", qty: false, period: "year" },
  // heads the costing feed carries that predate this list (see ERP_COST_HEADS in erp.js)
  { key: "rto", label: "RTO expense", qty: false, period: "year" },
  { key: "adblue", label: "AdBlue", qty: true, qtyLabel: "litres / year", period: "year" },
  // the km-variable line for a hired bus, worked out per day (dailyCost.js)
  { key: "hire", label: "Hire (day tariff)", qty: false, period: "day" },
];
export const COST_TYPE_MAP = Object.fromEntries(COST_TYPES.map((c) => [c.key, c]));

/* normalise one amount at a given period to ₹/working-day (wd = effective working days/year) */
export function perDay(amount, period, wd) {
  const a = +amount || 0;
  if (period === "day") return a;
  if (period === "month") return (a * 12) / wd; // annualise the month, spread over working days
  return a / wd; // per year
}
export function lineDaily(line, wd) {
  const spec = COST_TYPE_MAP[line.type];
  const q = spec && spec.qty ? (line.quantity === "" || line.quantity == null ? 0 : +line.quantity || 0) : 1;
  return perDay((+line.amount || 0) * q, line.period || (spec && spec.period) || "year", wd);
}
export function profileDailySpend(prof, wd) { return (prof && prof.lines ? prof.lines : []).reduce((s, l) => s + lineDaily(l, wd), 0); }
export function profileDailyBudget(prof, wd) { const b = prof && prof.budget; return b && b.amount ? perDay(b.amount, b.period || "month", wd) : 0; }
