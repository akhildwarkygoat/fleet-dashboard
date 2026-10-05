/* ============================================================================
 * erp.js — live ERP ingestion for the fleet dashboard
 *
 * THREE endpoints, one per kind of data. All are POSTed with an empty JSON body.
 *
 *   /api/general/VehicleEmpMapDetails         employee punch records
 *   /api/general/VehicleEmpMapProjectDetails  vehicle costing (approved cost lines)
 *   /api/Vehicle/DieselDetails                diesel issued per vehicle per day
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
 * DIESEL FEED — one row per vehicle per day diesel was issued. mapErpDiesel() keeps the
 * recent issues per vehicle; dailyCost.js turns them into a cost per day.
 *
 * What the ERP DOES NOT carry (kept as explicit placeholders, never faked):
 *   - route / ride-time / stops               -> RUN_OPTIMISER
 *   - per-bus km                              -> the bus attendance app's GPS, else the plan
 *   - driver name / phone                     -> NEEDS_ERP
 *   - driver salary                           -> only as a flat figure on diesel rows, not read
 * ==========================================================================*/
import FROZEN_ROTA from "./rotationalRoster.json" with { type: "json" };
import NON_ROTATING from "./nonRotatingRiders.json" with { type: "json" };

export const RUN_OPTIMISER = "Run optimiser to find out";
export const NEEDS_ERP = "Needs to be added to the ERP";

const ERP_ENDPOINT = "/erp/general/VehicleEmpMapDetails";
const ERP_COST_ENDPOINT = "/erp/general/VehicleEmpMapProjectDetails";
const ERP_DIESEL_ENDPOINT = "/erp/Vehicle/DieselDetails";

/* ---- Rotational roster: FROZEN, not read live ----
 * Rotational's three slots rotate one place every Monday, so a rider's Pun_Shift only says
 * where they were in the week it was punched. Reading it live meant the three services were
 * re-cut every Monday against plans that were not, and a rider who had not yet punched this
 * week was filed one slot behind — 323 of 767 riders on a Tuesday.
 *
 * So the roster is fixed instead. rotationalRoster.json is the split taken from the ERP pull
 * of 11-08-2026, the same snapshot public/plan_rot-*.json were generated from, and it
 * reproduces those plans exactly: 303 Day / 218 Half night / 239 Full night. Rider and plan
 * therefore always agree, and neither moves on its own.
 *
 * The trade: the roster no longer tracks the live rotation, so it drifts as people actually
 * move between slots. Re-freeze it from a fresh pull whenever the plans are regenerated —
 * the two are one decision, never separate ones. A rider absent from the roster (a joiner
 * since the freeze) belongs to no rotational service until they are added, which is visible
 * rather than silently wrong. */
export const ROTA_WEEK = FROZEN_ROTA._rotaWeek;
const frozenSlot = (emp) => FROZEN_ROTA.slots[emp] || "";
/* Where that slot came from — "observed" (this rider punched it in the rota week the roster
   names), "projected" (stepped one Monday from their last punch) or "stale" (stepped from an
   older snapshot, because the feed's ~11-day window no longer reaches them). An observed slot
   is a fact; the other two are good guesses, and the Stops map marks them so nobody reads an
   inference as a reading. */
const slotSourceOf = (emp) => (FROZEN_ROTA.source && FROZEN_ROTA.source[emp]) || "";

/* ---- Riders who do NOT rotate ----
 * The rota is supposed to move everyone one place each Monday. 104 riders never move: they
 * punched the same slot in every week the feed carries, and the transport manager confirmed
 * the six of them we could put in front of him, six for six.
 *
 * They matter because they are the standing exception to the rule. Any logic that steps
 * everyone forward is wrong about exactly these people, and on the Stops board they are the
 * riders whose shift does NOT need re-checking each rotation — which is why the map marks
 * them rather than leaving them to be found by hand.
 *
 * Employee numbers only, no names or GPS: same rule as rotationalRoster.json. */
export const NON_ROTATING_COUNTS = NON_ROTATING._counts;
const doesNotRotate = (emp) => !!NON_ROTATING.riders[emp];

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
/* Raw diesel payload (array of per-vehicle, per-day issues, ~8 MB back to 2017). Throws on non-2xx. */
export const fetchErpDieselRaw = () => erpPost(ERP_DIESEL_ENDPOINT);

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
/* One spelling per vehicle across feeds. The punch feed's VehName, the diesel feed's Vehno and the
   bus attendance app's bus id name the same registration, not always in the same case or spacing
   ("TN57 CL 3434", "tn57cl3434"). Used to JOIN feeds; bus ids themselves are left as the ERP sends them. */
export const vehKey = (veh) => canonVehicle(String(veh || "").toUpperCase().replace(/[^A-Z0-9]/g, ""));

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
 * The 12 months a day's standing costs come from: the lines whose period starts after the same
 * date a year before and on or before the day itself. Counted in calendar dates, so the window
 * ending 30 Jun starts on 1 Jul and keeps the quarter that started then, and one ending 29 Feb
 * looks back to 28 Feb.
 */
export function costWindow(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  const last = new Date(Date.UTC(y - 1, m, 0)).getUTCDate();
  const from = new Date(Date.UTC(y - 1, m - 1, Math.min(d, last) + 1));
  return { from: from.toISOString().slice(0, 10), to: iso };
}

/* One vehicle's approved lines → its cost lines, one per head. */
function foldLines(entries) {
  const byHead = new Map();   // head -> { total, qty, lines, rows }
  for (const e of entries) {
    let cell = byHead.get(e.head);
    if (!cell) { cell = { total: 0, qty: 0, lines: 0, rows: [] }; byHead.set(e.head, cell); }
    cell.total += e.amount;
    cell.lines++;
    if (e.rate > 0) cell.qty += e.amount / e.rate;
    cell.rows.push(e);
  }
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
      detail: [...cell.rows].sort((a, b) => (a.from < b.from ? 1 : -1)),   // newest period first
    });
  }
  return lines.sort((a, b) => b.amount * (b.quantity || 1) - a.amount * (a.quantity || 1));
}
const inWindow = (entries, { from, to }) => entries.filter((e) => e.from >= from && e.from <= to);

/**
 * Fold costing rows into one read-only profile per vehicle.
 *
 * Window: a day is costed on the lines whose period starts in the 12 months up to that day
 * (costWindow), by each line's From_Date. A trailing year is a whole year's cost all year round: it
 * holds four quarters of road tax and the latest yearly lines, and a past month is costed on the
 * year before it, not on lines bought since. From August to October 2026 the window was the
 * financial year instead, which read low for most of the year because periods not yet started
 * have no row; the transport manager moved it back on 05-10-2026.
 *
 * So every approved line is kept (`history`), and profileOn folds the ones a day's window holds.
 * `lines` are the window at the sync (`asOf`), for the Settings summary and the cost card.
 *
 * The catch: a line counts when its period STARTS inside the window, so a yearly line that
 * started more than 12 months before the day (insurance from 1 April last year, say) drops out
 * until its renewal is entered in the ERP, and the bus shows no such cost meanwhile.
 *
 * Returns { profiles: { [vehicle]: profile }, meta: {...} }; meta describes the sync's window.
 */
export function mapErpCosts(rows, { asOf = Date.now() } = {}) {
  const win = costWindow(isoLocal(new Date(asOf)));
  const byVeh = new Map();  // veh -> approved lines
  const meta = { rows: (rows || []).length, used: 0, skippedUnapproved: 0, outsideWindow: 0, total: 0, heads: new Set() };

  for (const r of rows || []) {
    const veh = String(r.Veh_Name || "").trim();
    const start = erpDateVal(r.From_Date);
    if (!veh || !start) continue;
    const from = isoLocal(start), inside = from >= win.from && from <= win.to;
    if (!inside) meta.outsideWindow++;
    const amount = numVal(r.Pur_Amount);
    if (amount <= 0) { if (inside) meta.skippedUnapproved++; continue; }   // planned, not purchased

    const head = String(r.Proj_Activity_Name || "").trim() || "OTHER";
    const rate = numVal(r.Rate);
    // the individual ERP lines behind a rolled-up figure, so the card can show its working
    const end = erpDateVal(r.To_Date), appr = erpDateVal(r.Approved_Date);
    if (!byVeh.has(veh)) byVeh.set(veh, []);
    byVeh.get(veh).push({
      head,
      desc: String(r.Description || head).trim(),
      period: String(r.Period_Name || "").trim(),
      from, to: end ? isoLocal(end) : "",
      rate, qty: rate > 0 ? Math.round((amount / rate) * 100) / 100 : null, amount,
      approved: appr ? isoLocal(appr) : "",
      order: String(r.Order_No || "").trim(),
    });
    if (inside) { meta.used++; meta.total += amount; meta.heads.add(head); }
  }

  const profiles = {};
  for (const [veh, history] of byVeh) {
    profiles[veh] = {
      source: "erp-project",
      // No budget in this feed — the cost card shows a blank budget rather than inventing one.
      budget: { amount: "", period: "month" },
      lines: foldLines(inWindow(history, win)),
      history,
    };
  }

  return {
    profiles,
    meta: { ...meta, heads: [...meta.heads].sort(), vehicles: Object.values(profiles).filter((p) => p.lines.length).length, from: win.from, to: win.to },
  };
}

/* the folded lines of each window a profile has been asked for, by the lines it holds */
const folded = new WeakMap();
/**
 * A cost profile as it stands on `date`: its lines folded over the 12 months up to that day. A
 * profile with no history (one stored before it was kept, or a budget typed here) is as it is.
 */
export function profileOn(profile, date) {
  if (!profile || !profile.history || !date) return profile;
  const { from, to } = costWindow(date);
  const held = [];
  profile.history.forEach((e, i) => { if (e.from >= from && e.from <= to) held.push(i); });
  let memo = folded.get(profile);
  if (!memo) folded.set(profile, (memo = new Map()));
  const key = held.join();
  if (!memo.has(key)) memo.set(key, { ...profile, lines: foldLines(held.map((i) => profile.history[i])) });
  return memo.get(key);
}

/* ============================== DIESEL FEED ==============================
 * Vehicle/DieselDetails returns one row per vehicle per day diesel was issued, back to 2017:
 *
 *   Vehno  EDATE  Diesel_Used (litres)  Diesel_Rate (Rs/L)  Amount (= rate x litres)  VehicleCategory
 *
 * Only owned vehicles appear: a hired bus is fuelled by its owner (Sep 2026: 46 owned buses with
 * rows, 57 hired with none). Some buses are issued diesel every day, most every three to eight
 * days, and an issue refills what was burnt since the previous one: the litres grow with the gap
 * (median 57 L after one day, 99 L after four, 127 L after seven). Turning issues into a cost per
 * day is dailyCost.js's job; this only folds the rows.
 *
 * Kept: the last `days` days, far more than any view needs, so the stored snapshot stays small
 * next to the ~8 MB feed. Returns
 *   issues  { vehKey: [[date, litres, amount], ...] }  oldest first, one entry per day
 *   prices  [[date, Rs/L], ...]                        the day's rate (most common across rows)
 */
export function mapErpDiesel(rows, { asOf = Date.now(), days = 120 } = {}) {
  const since = isoLocal(new Date(asOf - days * 864e5));
  const byVeh = new Map();      // vehKey -> Map(date -> [litres, amount])
  const rateVotes = new Map();  // date -> { rate: rows }
  const meta = { rows: (rows || []).length, used: 0, vehicles: 0, litres: 0, amount: 0, from: "", to: "" };
  for (const r of rows || []) {
    const veh = vehKey(r.Vehno), d = normDate(r.EDATE);
    const litres = numVal(r.Diesel_Used), rate = numVal(r.Diesel_Rate);
    if (!veh || !d || d < since || litres <= 0) continue;
    const amount = numVal(r.Amount) || litres * rate;
    if (!byVeh.has(veh)) byVeh.set(veh, new Map());
    const cell = byVeh.get(veh).get(d) || [0, 0];
    cell[0] += litres; cell[1] += amount;
    byVeh.get(veh).set(d, cell);
    if (rate > 0) {
      const v = rateVotes.get(d) || {};
      v[rate] = (v[rate] || 0) + 1;
      rateVotes.set(d, v);
    }
    meta.used++; meta.litres += litres; meta.amount += amount;
    if (!meta.from || d < meta.from) meta.from = d;
    if (d > meta.to) meta.to = d;
  }
  const r2 = (n) => Math.round(n * 100) / 100;
  const issues = {};
  for (const [veh, byDate] of byVeh)
    issues[veh] = [...byDate.keys()].sort().map((d) => [d, r2(byDate.get(d)[0]), r2(byDate.get(d)[1])]);
  const prices = [...rateVotes.keys()].sort().map((d) => [d, +mode(rateVotes.get(d))]);
  meta.vehicles = byVeh.size;
  meta.litres = r2(meta.litres); meta.amount = r2(meta.amount);
  return { issues, prices, meta };
}

/* The rows are folded per rider, which is what every other view needs — but it throws away
   the one thing "how was Rotational actually run on the 12th?" depends on: which bus a rider
   rode and which slot they punched ON A GIVEN DAY. Kept only for riders on the rotational
   shift, and only as [bus, slot, present], because that is the shift that moves; keeping it
   for all 4,500 riders would multiply the stored snapshot for no reader. */
const ROTA_SHIFT = "ROTATIONAL SHIFT";

/**
 * Fold raw ERP rows into { buses, employees, attendance, records, rotaHistory }.
 * - bus.id       = vehicle reg (stable across syncs, so cost profiles survive)
 * - employee.id  = Empl_no (attendance is keyed on this)
 * - records      = [] — daily spend/budget comes from the costing feed (mapErpCosts)
 * - rotaHistory  = date -> Empl_no -> [bus, slot, "P"|"A"], rotational riders only
 */
export function mapErpToDashboard(rows) {
  const buses = new Map();      // veh -> { seat:{}, unit:{}, type:Set }
  const empLatest = new Map();  // Empl_no -> { date, r }  (keep the most recent mapping)
  const attendance = {};        // date -> { Empl_no: "P"|"A" }
  const empDays = {};           // Empl_no -> { date: presentBool }  (one entry per rider-DAY)
  const dayRows = new Set();    // "emp date" already counted — the feed repeats rows
  const rotaHistory = {};       // date -> { Empl_no: [bus, slot, "P"|"A"] }

  for (const r of rows || []) {
    const veh = (r.VehName || r.Veh_Mas || "").trim();
    const emp = (r.Empl_no || "").trim();
    const d = normDate(r.date);
    if (!veh || !emp || !d) continue;

    // The feed repeats rows: 11,488 of 61,457 rows in the 25-Aug pull are a second (or third)
    // copy of an (employee, date) already seen — 19% of the payload. Every per-row tally below
    // therefore has to be per rider-DAY, or a rider who happens to be duplicated counts twice.
    // A rider marked present on ANY of their rows that day was present.
    const seenKey = emp + " " + d;
    const firstRowToday = !dayRows.has(seenKey);
    const present = /present/i.test(r.Att_Type || "");
    if (firstRowToday) dayRows.add(seenKey);

    // attendance (live punch feed)
    (attendance[d] = attendance[d] || {})[emp] = present ? "P" : (attendance[d][emp] || "A");
    // how Rotational actually ran that day — the bus and the slot as punched, NOT the frozen
    // roster. This is the record of what happened; the roster is the plan.
    if (normShift(r.Shift) === ROTA_SHIFT) {
      (rotaHistory[d] = rotaHistory[d] || {})[emp] = [veh, (r.Pun_Shift || "").trim(), present ? "P" : "A"];
    }
    // …and the same punches rolled up per rider, so a derived stop can carry a REAL absentee
    // rate. Without it every derived stop assumed nobody is ever away, and the engine's per-stop
    // `ceil(head x (1 - absentee + buffer))` rounded up at each one.
    // Counted once per rider-day (see the dedupe above) and resolved in a second pass, because
    // whether a day counts at all depends on how the whole factory behaved on it — see WORKED.
    if (firstRowToday) (empDays[emp] = empDays[emp] || {})[d] = present;

    // employee — keep the latest-dated row (its bus/department/role win)
    const prev = empLatest.get(emp);
    if (!prev || d > prev.date) empLatest.set(emp, { date: d, r });

    // bus — tally capacity, brand and owned/rental across its rows. Also once per rider-day:
    // these are decided by majority vote (mode), and a duplicated row is a stuffed ballot — it
    // was enough to flip a bus's unit label and with it the Total-fleet split on the Live tiles.
    let bs = buses.get(veh);
    if (!bs) { bs = { seat: {}, unit: {}, type: new Set(), mil: {} }; buses.set(veh, bs); }
    if (firstRowToday) {
      const seat = String(r.Seat || r.Seat_New || "").trim();
      if (seat && seat !== "0") bs.seat[seat] = (bs.seat[seat] || 0) + 1;
      const u = unitOf(r.Compname, r.Comp_New);
      bs.unit[u] = (bs.unit[u] || 0) + 1;
      const mil = String(r.Mileage || "").trim();   // per-bus km/L (ERP column)
      if (mil && mil !== "0" && mil !== "0.00") bs.mil[mil] = (bs.mil[mil] || 0) + 1;
    }
    if (r.Type) bs.type.add(/rent/i.test(r.Type) ? "Rental" : "Owned");
  }

  /* Which dates the factory actually ran. The feed carries every calendar day, including Sundays,
     when ~87% of the workforce is marked absent because nobody is rostered — counting those as
     absences overstated the mean absentee rate by 8.2 points (25.4% vs 17.2%) and, since the
     engine plans `ceil(head x (1 - absentee + buffer))` seats, quietly UNDER-provisioned every
     stop: a 20-rider stop was planned for 16 seats instead of 18.
     The feed's newest date is also dropped — it is the pull date, still in progress, and its
     not-yet-arrived riders read as absent for the same reason. */
  const dayTotals = {};
  for (const [emp, days] of Object.entries(empDays))
    for (const [d, p] of Object.entries(days)) {
      const t = (dayTotals[d] = dayTotals[d] || { present: 0, n: 0 });
      t.n++; if (p) t.present++;
    }
  const allDates = Object.keys(dayTotals).sort();
  const pullDate = allDates[allDates.length - 1];
  const WORKED = new Set(allDates.filter((d) => d !== pullDate && dayTotals[d].n && dayTotals[d].present / dayTotals[d].n >= 0.5));
  const empAtt = new Map();
  for (const [emp, days] of Object.entries(empDays)) {
    let absent = 0, n = 0;
    for (const [d, p] of Object.entries(days)) { if (!WORKED.has(d)) continue; n++; if (!p) absent++; }
    empAtt.set(emp, { absent, days: n });
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
    // share of this rider's punches that were absences — feeds stop-level absentee
    absentee: (() => { const a = empAtt.get(emp); return a && a.days ? a.absent / a.days : 0; })(),
    // Rotational slot from the FROZEN roster, not from this rider's punches — see the note
    // on FROZEN_ROTA above. "1" Day · "2" Half night · "3" Full night; "" = not on the roster.
    slot: frozenSlot(emp),
    // …and whether this rider sits out the rotation entirely (see NON_ROTATING above)
    fixedShift: doesNotRotate(emp),
    slotSource: slotSourceOf(emp),   // observed | projected | stale — see slotSourceOf

    department: (r.DeptName || "").trim(),
    designation: (r.Catagory || "").trim(),
    travelMin: null,                   // -> RUN_OPTIMISER in the UI
  }));

  return { buses: busList, employees, attendance, records: [], rotaHistory };
}
