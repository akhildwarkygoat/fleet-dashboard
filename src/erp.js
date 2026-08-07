/* ============================================================================
 * erp.js — live ERP ingestion for the fleet dashboard
 *
 * TWO endpoints, one per kind of data. Both are POSTed with an empty JSON body.
 *
 *   /api/general/VehicleEmpMapDetails         employee punch records
 *   /api/general/VehicleEmpMapProjectDetails  vehicle costing (approved cost lines)
 *
 * Host: http://life.gainup.in:8089 (see vite.config.js). The old 172.16.10.169 address is
 * the same server on the office LAN — it does not resolve from outside, so the public
 * hostname is used instead and the dashboard works on or off site.
 *
 * In dev the browser calls them through the Vite proxy at /erp (see vite.config.js);
 * in prod route the same /erp path through the backend passthrough.
 *
 * PUNCH FEED — one row per (employee, date) with the employee's home GPS, their
 * assigned vehicle, capacity, company, department, role and attendance.
 * mapErpToDashboard() folds those rows into { buses, employees, attendance, records }.
 *
 * COSTING FEED — one row per approved cost line: a vehicle, a cost head, the period
 * it covers and what was purchased. mapErpCosts() folds those into one read-only
 * cost profile per bus, which is what the Bus-wise cost card renders.
 *
 * What the ERP DOES NOT carry (kept as explicit placeholders, never faked):
 *   - route / ride-time / per-bus km / stops  -> RUN_OPTIMISER
 *   - driver name / phone                     -> NEEDS_ERP
 *   - diesel and driver salary                -> absent from BOTH feeds (see ERP_COST_HEADS)
 * ==========================================================================*/

export const RUN_OPTIMISER = "Run optimiser to find out";
export const NEEDS_ERP = "Needs to be added to the ERP";

const ERP_ENDPOINT = "/erp/general/VehicleEmpMapDetails";
const ERP_COST_ENDPOINT = "/erp/general/VehicleEmpMapProjectDetails";

/* Both feeds need a body/Content-Length or the endpoint 411s. */
async function erpPost(endpoint) {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: "{}",
  });
  if (!res.ok) throw new Error(`ERP HTTP ${res.status}`);
  return res.json();
}

/* Raw punch payload (array of per-employee/day rows). Throws on non-2xx. */
export const fetchErpRaw = () => erpPost(ERP_ENDPOINT);
/* Raw costing payload (array of per-vehicle cost lines). Throws on non-2xx. */
export const fetchErpCostRaw = () => erpPost(ERP_COST_ENDPOINT);

/* "15-07-2026 00:00:00" -> "2026-07-15" (ISO, so it sorts + matches the date pickers) */
function normDate(s) {
  const m = String(s || "").match(/^(\d{2})-(\d{2})-(\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : "";
}

/* The ERP's Shift field is free text and arrives with inconsistent trailing spaces, so the
   same shift can appear as "GENERAL SHIFT - 9 " and "GENERAL SHIFT - 9". Collapse runs of
   whitespace before ever grouping on it. */
export const normShift = (s) => String(s || "").replace(/\s+/g, " ").trim();

/* The dashboard's unit split is a BRAND/SITE split. The ERP carries it in Compname
   ("TECHNOTEK - WOVEN - I", "GAINUP - SOCKS - I", "SUBBULAPURAM", …) and the legal
   entity separately in Comp_New. Default anything unrecognised to Gainup.

   ZENWEAR is the third entity, added 05-08-2026 when TECHNOTEK - WOVEN - II was re-tagged
   Compname "SUBBULAPURAM" / Comp_New "ZENWEAR" — the site is Subbulapuram, the company is
   Zenwear, and the dashboard shows the company. Matched on EITHER field and checked first,
   so it wins over the Technotek/Gainup fallbacks whichever way the ERP tags a row. */
function unitOf(compname, compNew) {
  const c = compname || "", e = compNew || "";
  if (/zenwear/i.test(e) || /zenwear|subbulapuram/i.test(c)) return "Zenwear";
  return /technotek/i.test(c) ? "Technotek" : "Gainup";
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

const numOrNull = (v) => { const n = parseFloat(v); return isFinite(n) && n !== 0 ? n : null; };

const mode = (obj) => {
  const e = Object.entries(obj).sort((a, b) => b[1] - a[1])[0];
  return e ? e[0] : null;
};

/* ============================== COSTING FEED ==============================
 * VehicleEmpMapProjectDetails returns one row per approved cost line:
 *
 *   Veh_Name  Proj_Activity_Name  Period_Name  From_Date/To_Date  Rate  Pur_Amount
 *
 * Two things about that shape decide how it is read here:
 *
 *  1. Rate is a UNIT rate and Pur_Amount is rate x quantity. They are equal only
 *     where the quantity is 1. AdBlue is quoted per litre (~Rs 60) against a
 *     Rs 36,600 purchase, tyres per tyre. Pur_Amount is the figure to sum; Rate
 *     never is. The feed has no quantity column, so it is recovered as
 *     Pur_Amount / Rate — a whole number on 1,028 of 1,029 priced rows.
 *  2. A line is a plan until it is approved, and an unapproved line carries
 *     Pur_Amount 0. Summing Pur_Amount therefore counts spend, not intent.
 *
 * Each head maps to one of the dashboard's cost lines. `qty` marks the heads whose
 * Rate is a unit price: for those the dashboard is handed the rate and the quantity
 * (COST_TYPES multiplies them back out), for the rest just the amount.
 *
 * DIESEL and DRIVER SALARY are in neither feed — the two largest running costs are
 * not in the ERP yet, so a bus's profile here is its standing costs only.
 */
const ERP_COST_HEADS = {
  "ROAD TAX": { type: "taxes", label: "Road tax" },
  "VEHICLE INSURANCE": { type: "insurance", label: "Vehicle insurance" },
  "FC WORK": { type: "fc", label: "FC work" },
  "VEHICLE OUTSIDE SERVICES": { type: "maint", label: "Vehicle outside services" },
  "RTO EXPENSE": { type: "rto", label: "RTO expense" },
  TYRE: { type: "tires", label: "Tyre", qty: true },
  ADBLU: { type: "adblue", label: "AdBlue", qty: true },
};
/* A head the ERP adds later still lands on the card, under its own name, rather than
   being silently dropped — as a plain yearly amount, which is the safe reading. */
const headSpec = (head) =>
  ERP_COST_HEADS[String(head || "").trim().toUpperCase()] ||
  { type: "erp:" + String(head || "other").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-") };

/* "01-04-2026 00:00:00" -> Date (local midnight). Invalid/blank -> null. */
function erpDateVal(s) {
  const m = String(s || "").match(/^(\d{2})-(\d{2})-(\d{4})/);
  if (!m) return null;
  const d = new Date(+m[3], +m[2] - 1, +m[1]);
  return isNaN(d) ? null : d;
}
const numVal = (v) => { const n = parseFloat(String(v ?? "").replace(/[^0-9.-]/g, "")); return isFinite(n) ? n : 0; };
const sentenceCase = (s) => { const x = String(s || "").toLowerCase().trim(); return x.charAt(0).toUpperCase() + x.slice(1); };
/* local calendar date, not toISOString() — that shifts to UTC and reports the day before
   for any evening in IST, which would put the wrong window on the cost card */
const isoLocal = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/**
 * Fold costing rows into one read-only profile per vehicle.
 *
 * Window: the INDIAN FINANCIAL YEAR (1 April → 31 March) that `asOf` falls in, by each
 * line's From_Date — the same year the ERP itself plans and approves against, so a total
 * here reconciles with the ERP's own FY figures.
 *
 * Note this is FY-to-date in practice: a period that has not started yet has no row in
 * the feed, so early in the financial year the total is genuinely lower than a full
 * year's cost. That is the ERP's position, not a gap in the reading.
 *
 * Returns { profiles: { [vehicle]: profile }, meta: {...} }; a vehicle with no
 * approved spend in the window is absent rather than present with zeros.
 */
export function mapErpCosts(rows, { asOf = Date.now() } = {}) {
  // the financial year `asOf` sits in: April→March, whole calendar days at both ends so a
  // line starting at midnight on 1 April is never clipped by the time of day
  const a = new Date(asOf);
  const fyStart = a.getMonth() >= 3 ? a.getFullYear() : a.getFullYear() - 1;
  const from = new Date(fyStart, 3, 1); from.setHours(0, 0, 0, 0);
  const to = new Date(fyStart + 1, 2, 31); to.setHours(23, 59, 59, 999);
  const fy = `${fyStart}-${String((fyStart + 1) % 100).padStart(2, "0")}`;
  const tally = new Map();  // veh -> { head -> { total, qty, rated, lines } }
  const meta = { rows: (rows || []).length, used: 0, skippedUnapproved: 0, outsideWindow: 0, total: 0, heads: new Set() };

  for (const r of rows || []) {
    const veh = String(r.Veh_Name || "").trim();
    const start = erpDateVal(r.From_Date);
    if (!veh || !start) continue;
    if (start < from || start > to) { meta.outsideWindow++; continue; }
    const amount = numVal(r.Pur_Amount);
    if (amount <= 0) { meta.skippedUnapproved++; continue; }   // planned, not purchased

    const head = String(r.Proj_Activity_Name || "").trim() || "OTHER";
    let byHead = tally.get(veh);
    if (!byHead) { byHead = new Map(); tally.set(veh, byHead); }
    let cell = byHead.get(head);
    if (!cell) { cell = { total: 0, qty: 0, rated: 0, lines: 0, rows: [] }; byHead.set(head, cell); }
    cell.total += amount;
    cell.lines++;
    const rate = numVal(r.Rate);
    if (rate > 0) { cell.qty += amount / rate; cell.rated += amount; }   // rated = the part qty covers
    // the individual ERP lines behind the rolled-up figure, so the card can show its working
    const end = erpDateVal(r.To_Date), appr = erpDateVal(r.Approved_Date);
    cell.rows.push({
      desc: String(r.Description || head).trim(),
      period: String(r.Period_Name || "").trim(),
      from: isoLocal(start), to: end ? isoLocal(end) : "",
      rate, qty: rate > 0 ? Math.round((amount / rate) * 100) / 100 : null, amount,
      approved: appr ? isoLocal(appr) : "",
      order: String(r.Order_No || "").trim(),
    });
    meta.used++; meta.total += amount;
    meta.heads.add(head);
  }

  const profiles = {};
  for (const [veh, byHead] of tally) {
    const lines = [];
    for (const [head, cell] of byHead) {
      const spec = headSpec(head);
      // A unit-rate head is shown the way the ERP quotes it — rate x quantity — using the
      // quantity-weighted average rate, so rate * qty is exactly the amount purchased.
      // A quantity-typed line MUST carry a quantity: the dashboard multiplies amount by it and
      // reads a missing one as zero, which would drop the line from every total in silence. When
      // no rate came back to divide by, fall back to the whole amount at quantity 1.
      const useQty = spec.qty && cell.qty > 0;
      lines.push({
        id: spec.type,
        type: spec.type,
        label: spec.label || sentenceCase(head),
        amount: useQty ? cell.total / cell.qty : cell.total,
        ...(spec.qty ? { quantity: useQty ? Math.round(cell.qty * 100) / 100 : 1 } : {}),
        period: "year",
        erpLines: cell.lines,
        detail: cell.rows.sort((a, b) => (a.from < b.from ? 1 : -1)),   // newest period first
      });
    }
    lines.sort((a, b) => b.amount * (b.quantity || 1) - a.amount * (a.quantity || 1));
    profiles[veh] = {
      source: "erp-project",
      // No budget in this feed — the cost card shows a blank budget rather than inventing one.
      budget: { amount: "", period: "month" },
      lines,
    };
  }

  return {
    profiles,
    meta: { ...meta, heads: [...meta.heads].sort(), vehicles: Object.keys(profiles).length, fy, from: isoLocal(from), to: isoLocal(to) },
  };
}

/**
 * Fold raw ERP rows into { buses, employees, attendance, records }.
 * - bus.id      = vehicle reg (stable across syncs, so cost profiles survive)
 * - employee.id = Empl_no (attendance is keyed on this)
 * - records     = [] — daily spend/budget comes from the costing feed (mapErpCosts)
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
    if (!bs) { bs = { seat: {}, unit: {}, type: new Set(), mil: {} }; buses.set(veh, bs); }
    const seat = String(r.Seat || r.Seat_New || "").trim();
    if (seat && seat !== "0") bs.seat[seat] = (bs.seat[seat] || 0) + 1;
    const u = unitOf(r.Compname, r.Comp_New);
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
    route: RUN_OPTIMISER,
    driver: NEEDS_ERP,
    phone: NEEDS_ERP,
  }));

  const employees = [...empLatest.entries()].map(([emp, { r }]) => ({
    id: emp,
    shift: normShift(r.Shift),        // free-text ERP group ("GENERAL SHIFT - 9", "ROTATIONAL SHIFT", …)
    unit: unitOf(r.Compname, r.Comp_New),   // the rider's OWN unit, not their bus's majority unit
    // home GPS + place, so a service's stop network can be derived in the browser
    lat: numOrNull(r.Latitude), lng: numOrNull(r.Longitude),
    locality: (r.Locality || r.Village || "").trim(),
    code: (r.tno || emp).trim(),
    name: (r.Name || "").trim() || emp,
    busId: (r.VehName || r.Veh_Mas || "").trim(),
    department: (r.DeptName || "").trim(),
    designation: (r.Catagory || "").trim(),
    travelMin: null,                   // -> RUN_OPTIMISER in the UI
  }));

  return { buses: busList, employees, attendance, records: [] };
}
