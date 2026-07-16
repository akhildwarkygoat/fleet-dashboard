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

const mode = (obj) => {
  const e = Object.entries(obj).sort((a, b) => b[1] - a[1])[0];
  return e ? e[0] : null;
};

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
    if (!bs) { bs = { seat: {}, unit: {}, type: new Set() }; buses.set(veh, bs); }
    const seat = String(r.Seat || r.Seat_New || "").trim();
    if (seat && seat !== "0") bs.seat[seat] = (bs.seat[seat] || 0) + 1;
    const u = unitOf(r.Compname);
    bs.unit[u] = (bs.unit[u] || 0) + 1;
    if (r.Type) bs.type.add(/rent/i.test(r.Type) ? "Rental" : "Owned");
  }

  const busList = [...buses.entries()].map(([veh, bs]) => ({
    id: veh,
    vehicle: veh,
    unit: mode(bs.unit) || "Gainup",
    capacity: parseInt(mode(bs.seat) || "0", 10) || 0,
    type: [...bs.type][0] || "",       // Owned / Rental
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
