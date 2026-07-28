/* ============================================================================
 * erp.js — live ERP ingestion for the fleet dashboard
 *
 * Source: POST http://172.16.10.169:8089/api/general/VehicleEmpMapDetails
 * In dev the browser calls it through the Vite proxy at /erp (see vite.config.js);
 * in prod route the same /erp path through the backend passthrough.
 *
 * The endpoint returns ONE row per (employee, date) with the employee's home GPS,
 * their assigned vehicle, capacity, company, department, role and attendance.
 * mapErpToDashboard() folds those rows into the 4 objects the dashboard renders:
 * { buses, employees, attendance, records }.
 *
 * What the ERP DOES NOT carry (kept as explicit placeholders, never faked):
 *   - route / ride-time / per-bus km / stops  -> RUN_OPTIMISER
 *   - driver name / phone                     -> NEEDS_ERP
 *   - per-bus cost (diesel, salary, insurance…) -> entered in the Bus-wise cost card
 * ==========================================================================*/

export const RUN_OPTIMISER = "Run optimiser to find out";
export const NEEDS_ERP = "Needs to be added to the ERP";

const ERP_ENDPOINT = "/erp/general/VehicleEmpMapDetails";

/* Fetch the raw ERP payload (array of per-employee/day rows). Throws on non-2xx. */
export async function fetchErpRaw() {
  const res = await fetch(ERP_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: "{}", // the endpoint needs a body/Content-Length or it 411s
  });
  if (!res.ok) throw new Error(`ERP HTTP ${res.status}`);
  return res.json();
}

/* "15-07-2026 00:00:00" -> "2026-07-15" (ISO, so it sorts + matches the date pickers) */
function normDate(s) {
  const m = String(s || "").match(/^(\d{2})-(\d{2})-(\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : "";
}

/* The dashboard's two-unit split (Gainup / Technotek) is a BRAND split, which the
   ERP carries in Compname ("TECHNOTEK - WOVEN - I", "GAINUP - SOCKS - I", …), not in
   the legal-entity field Comp_New. Default anything non-Technotek to Gainup. */
function unitOf(compname) {
  return /technotek/i.test(compname || "") ? "Technotek" : "Gainup";
}

/* Old registrations still baked into saved plans, mapped to the name the ERP (and so the live
   fleet) actually uses. Plans are matched to buses by name, so without this the route on a
   renamed bus finds no fleet entry and is dropped — the bus then reads 0 riders in the Planner.
   ERP vehicle names are correct as sent and are NOT rewritten; this is plan-side only.
   Retire an entry once every plan under plans/ and public/ has been regenerated. */
const PLAN_VEHICLE_ALIASES = {
  TN57BJ3434: "TN57CJ3434",
  TN57BK3434: "TN57CK3434",
};
export const canonVehicle = (veh) => PLAN_VEHICLE_ALIASES[veh] || veh;

const mode = (obj) => {
  const e = Object.entries(obj).sort((a, b) => b[1] - a[1])[0];
  return e ? e[0] : null;
};

/* ------------------------------------------------------------------ bus costs
 * Running costs are owned by the ERP — the dashboard displays them and never
 * edits them. Each entry maps one of the dashboard's cost lines to the ERP
 * column(s) that carry it, and to the period that column is quoted in.
 *
 * The feed does not expose any of these yet (VehicleEmpMapDetails returns 30
 * fields, none of them costs), so today every bus resolves to no profile and the
 * cost tiles stay blank — the same honest blank they showed before. When the ERP
 * team adds the columns, put their real names in `from` and nothing else has to
 * change: `period` and `qty` already match how the dashboard normalises to
 * ₹/working-day. Names are matched case-insensitively.
 */
const ERP_COST_FIELDS = [
  // amount is the RATE PER LITRE and quantity the litres/day — the dashboard multiplies the
  // two (COST_TYPES.diesel is qty:true), so a per-day total here would be counted litres times over
  { type: "diesel",    period: "day",   from: ["DieselRatePerLitre", "Diesel_Rate", "FuelRate"], qtyFrom: ["DieselLitres", "Litres_Per_Day"] },
  { type: "driver",    period: "month", from: ["DriverSalary", "Driver_Sal", "DriverWageMonth"] },
  { type: "maint",     period: "month", from: ["Maintenance", "Maint_Amt", "MaintenanceMonth"] },
  { type: "tires",     period: "year",  from: ["TyreCost", "Tire_Amt"], qtyFrom: ["TyreCount", "No_Of_Tyres"] },
  { type: "tiremaint", period: "year",  from: ["TyreMaintenance", "Tyre_Maint"], qtyFrom: ["TyreCount", "No_Of_Tyres"] },
  { type: "fc",        period: "year",  from: ["FCWorks", "FC_Amt", "FitnessCost"] },
  { type: "taxes",     period: "year",  from: ["RoadTax", "Tax_Amt", "Taxes"] },
  { type: "insurance", period: "year",  from: ["Insurance", "Insurance_Amt"] },
];
const ERP_BUDGET_FIELDS = { from: ["Budget", "Budget_Amt", "BudgetMonth"], period: "month" };

/* first non-empty numeric value among `names` on a row, or null */
function numFrom(row, names) {
  for (const n of names || []) {
    const key = Object.keys(row).find((k) => k.toLowerCase() === n.toLowerCase());
    if (key == null) continue;
    const v = parseFloat(String(row[key]).replace(/[^0-9.-]/g, ""));
    if (isFinite(v) && v !== 0) return v;
  }
  return null;
}

/* Fold the cost columns tallied for one vehicle into the profile shape the
 * dashboard already understands: { budget:{amount,period}, lines:[…] }.
 * Returns null when the ERP carried no costs for this bus. */
function costProfileFrom(tally) {
  const lines = [];
  for (const spec of ERP_COST_FIELDS) {
    const amount = tally[spec.type];
    if (amount == null) continue;
    lines.push({
      id: "erp-" + spec.type, type: spec.type, amount, period: spec.period,
      ...(spec.qtyFrom ? { quantity: tally[spec.type + ":qty"] ?? 1 } : {}),
    });
  }
  const budget = tally.budget;
  if (!lines.length && budget == null) return null;
  return {
    source: "erp",
    budget: budget != null ? { amount: budget, period: ERP_BUDGET_FIELDS.period } : { amount: "", period: "month" },
    lines,
  };
}

/**
 * Fold raw ERP rows into { buses, employees, attendance, records }.
 * - bus.id      = vehicle reg (stable across syncs, so cost profiles survive)
 * - employee.id = Empl_no (attendance is keyed on this)
 * - records     = [] — daily spend/budget is filled from each bus's cost card
 */
export function mapErpToDashboard(rows) {
  const buses = new Map();      // veh -> { seat:{}, unit:{}, type:Set }
  const empLatest = new Map();  // Empl_no -> { date, r }  (keep the most recent mapping)
  const attendance = {};        // date -> { Empl_no: "P"|"A" }

  for (const r of rows || []) {
    const veh = (r.VehName || r.Veh_Mas || "").trim();
    const emp = (r.Empl_no || "").trim();
    const d = normDate(r.date);
    if (!veh || !emp || !d) continue;

    // attendance (live punch feed)
    (attendance[d] = attendance[d] || {})[emp] = /present/i.test(r.Att_Type || "") ? "P" : "A";

    // employee — keep the latest-dated row (its bus/department/role win)
    const prev = empLatest.get(emp);
    if (!prev || d > prev.date) empLatest.set(emp, { date: d, r });

    // bus — tally capacity, brand and owned/rental across its rows
    let bs = buses.get(veh);
    if (!bs) { bs = { seat: {}, unit: {}, type: new Set(), mil: {}, cost: {} }; buses.set(veh, bs); }
    // running costs, if the ERP carries them — first non-empty value per bus wins
    for (const spec of ERP_COST_FIELDS) {
      if (bs.cost[spec.type] == null) { const v = numFrom(r, spec.from); if (v != null) bs.cost[spec.type] = v; }
      if (spec.qtyFrom && bs.cost[spec.type + ":qty"] == null) { const q = numFrom(r, spec.qtyFrom); if (q != null) bs.cost[spec.type + ":qty"] = q; }
    }
    if (bs.cost.budget == null) { const b = numFrom(r, ERP_BUDGET_FIELDS.from); if (b != null) bs.cost.budget = b; }
    const seat = String(r.Seat || r.Seat_New || "").trim();
    if (seat && seat !== "0") bs.seat[seat] = (bs.seat[seat] || 0) + 1;
    const u = unitOf(r.Compname);
    bs.unit[u] = (bs.unit[u] || 0) + 1;
    if (r.Type) bs.type.add(/rent/i.test(r.Type) ? "Rental" : "Owned");
    const mil = String(r.Mileage || "").trim();   // per-bus km/L (ERP column)
    if (mil && mil !== "0" && mil !== "0.00") bs.mil[mil] = (bs.mil[mil] || 0) + 1;
  }

  const busList = [...buses.entries()].map(([veh, bs]) => ({
    id: veh,
    vehicle: veh,
    unit: mode(bs.unit) || "Gainup",
    capacity: parseInt(mode(bs.seat) || "0", 10) || 0,
    type: [...bs.type][0] || "",       // Owned / Rental
    mileage: parseFloat(mode(bs.mil) || "0") || 0,   // km/L — drives this bus's diesel ₹/km
    costProfile: costProfileFrom(bs.cost),           // ERP-owned running costs, or null
    route: RUN_OPTIMISER,
    driver: NEEDS_ERP,
    phone: NEEDS_ERP,
  }));

  const employees = [...empLatest.entries()].map(([emp, { r }]) => ({
    id: emp,
    code: (r.tno || emp).trim(),
    name: (r.Name || "").trim() || emp,
    busId: (r.VehName || r.Veh_Mas || "").trim(),
    department: (r.DeptName || "").trim(),
    designation: (r.Catagory || "").trim(),
    travelMin: null,                   // -> RUN_OPTIMISER in the UI
  }));

  return { buses: busList, employees, attendance, records: [] };
}
