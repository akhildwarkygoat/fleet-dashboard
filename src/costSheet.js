/* ============================================================================
 * costSheet.js — the export's "Costing sheet" tab, laid out like the transport department's own
 * monthly costing report (GUT Transport Costing report 2025-2026, the "GUT MAR 2026" sheet).
 * ----------------------------------------------------------------------------
 * Akhil, 06-10-2026: "add an extra tab to the export and keep the format like this … this is
 * easier for me to understand". So the layout, the row names and the look are theirs:
 *
 *   left   Company vehicles (owned): a date-by-bus grid of riders, then Total Km, Diesel, Average
 *          km (km a litre), and the Costing block (Diesel cost, Driver Salary, then every ERP cost
 *          head on its own row, Total Cost, Per head, KM Cost), with a Total column.
 *   right  Contract vehicles (hired): the same grid, then the hire bills by half month (FDATE to
 *          TDATE) and PER HEAD COST.
 *   below  cost per head for each side and overall, and what the figures are.
 *
 * The figures are the export's own rows (costRows), so every total agrees with the other tabs. Two
 * differences from their sheet, said on the sheet: the grid counts PEOPLE who came that day (the ERP
 * punches), not boardings up and down, so "Per head" is the cost of one person for a day, both ways;
 * and the diesel cost is the ERP's diesel as issued, priced at its own rate, not litres × ₹92.
 * Driver salary is not in any ERP feed, so its row stays blank rather than guessed. And each kind of
 * cost keeps its own row, named as on the other tabs: their sheet folds road tax, insurance, FC and
 * RTO into "Insurance & Taxes" and tyres into "Maintenance"; Akhil, 06-10-2026: "dont merge different
 * types of costs keep them seperate unlike the reference sheet".
 *
 * Totals are Excel formulas with their values cached, so the sheet reads at once and still adds up
 * if someone types a correction into it.
 * ==========================================================================*/

/* yearly costs a bus renews: when one has dropped out of the 12 months, the sheet says when it was last paid */
const RENEWED = ["taxes", "insurance", "fc"];
const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthYear = (iso) => `${SHORT_MONTHS[+iso.slice(5, 7) - 1]} ${iso.slice(0, 4)}`;
const MONTHS = ["JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE", "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"];
const utc = (s) => new Date(s + "T00:00:00Z");
const pad = (n) => String(n).padStart(2, "0");
const isoOf = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const r2 = (n) => Math.round(n * 100) / 100;

/* their look: Arial, a yellow title band in purple, green header cells, yellow row names */
const BLACK = "000000", PURPLE = "800080", YELLOW = "FFFF00", GREEN_FILL = "C5ECBD", GREEN = "00B050", NAVY = "17365D", RED = "FF0000", GREY = "595959";
const line = (style) => (style ? { style, color: { rgb: BLACK } } : undefined);
const box = (l = "thin", r = l, t = l, b = l) => ({ left: line(l), right: line(r), top: line(t), bottom: line(b) });
const font = (sz, { b = false, i = false, color = BLACK, name = "Arial" } = {}) => ({ name, sz, bold: b, italic: i, color: { rgb: color } });
const fill = (rgb) => ({ patternType: "solid", fgColor: { rgb } });
const align = (horizontal = "center", wrapText = false) => ({ horizontal, vertical: "center", wrapText });

const S = {
  // left, not centred: the band spans every bus, and centred over 50 columns it sits off screen
  title: { font: font(20, { b: true, color: PURPLE }), fill: fill(YELLOW), alignment: { horizontal: "left", vertical: "center", indent: 1 }, border: box() },
  number: { font: font(14, { b: true, color: PURPLE }), alignment: align(), border: box() },
  dateHead: { font: font(8, { b: true }), fill: fill(GREEN_FILL), alignment: align(), border: box("thick") },
  busHead: { font: font(10, { b: true }), alignment: align("center", true), border: box() },
  totalHead: { font: font(10, { b: true, color: NAVY }), alignment: align("center", true), border: box("thin", "medium") },
  date: { font: font(8), alignment: align(), border: box("thick", "medium", "thin", "thin") },
  day: { font: font(11, { name: "Calibri" }), alignment: align(), border: box() },
  dayTotal: { font: font(10, { b: true, color: NAVY }), alignment: align(), border: box("thin", "medium") },
  rowName: { font: font(10, { b: true }), alignment: align("left"), border: box("thick", "medium") },
  sum: { font: font(10, { b: true }), alignment: align(), border: box() },
  kmName: { font: font(14, { color: GREEN }), alignment: align("left"), border: box() },
  km: { font: font(14, { b: true, color: GREEN }), alignment: align(), border: box() },
  costingHead: { font: font(16, { b: true }), fill: fill(YELLOW), alignment: align("left"), border: box("medium", "thin") },
  costName: { font: font(12), fill: fill(YELLOW), alignment: align("left"), border: box("medium", "thin") },
  costNameBold: { font: font(12, { b: true }), fill: fill(YELLOW), alignment: align("left"), border: box("medium", "thin", "medium", "medium") },
  cost: { font: font(12), alignment: align("right"), border: box() },
  costBold: { font: font(12, { b: true }), alignment: align("right"), border: box() },
  costTotal: { font: font(11, { b: true, color: NAVY }), fill: fill(YELLOW), alignment: align("right"), border: box("thin", "medium") },
  headRed: { font: font(12, { b: true, color: RED }), fill: fill(YELLOW), alignment: align("right"), border: box("thin", "medium", "medium", "medium") },
  billHead: { font: font(8, { b: true }), fill: fill(GREEN_FILL), alignment: align(), border: box("medium") },
  billDate: { font: font(8), alignment: align(), border: box("medium") },
  bill: { font: font(11, { name: "Calibri" }), alignment: align("right"), border: box() },
  billTotal: { font: font(11, { b: true, name: "Calibri" }), alignment: align("right"), border: box() },
  perHeadName: { font: font(14, { b: true, name: "Calibri" }), fill: fill(YELLOW), alignment: align(), border: box() },
  perHead: { font: font(14, { b: true, name: "Calibri" }), alignment: align("right"), border: box() },
  perHeadRed: { font: font(14, { b: true, name: "Calibri", color: RED }), fill: fill(YELLOW), alignment: align("right"), border: box("medium") },
  sumName: { font: font(12, { b: true, name: "Calibri" }), alignment: align("left"), border: box() },
  sumValue: { font: font(14, { b: true, color: RED }), alignment: align("right"), border: box() },
  note: { font: font(9, { i: true, color: GREY }), alignment: align("left") },
  // red: a per head that divides by far too few riders (the ERP maps few riders to the bus)
  unreliable: { font: font(12, { b: true, color: "9C0006" }), fill: fill("FFC7CE"), alignment: align("right"), border: box() },
  unreliableBig: { font: font(14, { b: true, name: "Calibri", color: "9C0006" }), fill: fill("FFC7CE"), alignment: align("right"), border: box() },
  noteRed: { font: font(9, { i: true, color: "9C0006" }), fill: fill("FFC7CE"), alignment: align("left") },
  lastPaid: { font: font(9, { i: true, color: "C65911" }), alignment: align("right"), border: box() },
};

/** Every calendar date from `from` to `to`, Sundays and holidays included, as their sheet lists them. */
export function calendarDates(from, to) {
  const out = [];
  for (let d = utc(from); isoOf(d) <= to; d = new Date(d.getTime() + 864e5)) out.push(isoOf(d));
  return out;
}

/** "for the month of OCTOBER - 2026", or "for 28 Sep to 4 Oct 2026" for a day or a week. */
export function sheetPeriod(period, shownText) {
  if (period.kind === "month") { const d = utc(period.from); return `for the month of ${MONTHS[d.getUTCMonth()]} - ${d.getUTCFullYear()}`; }
  return `for ${shownText}`;
}

/* each bus: riders by date and its sums over the period, from the export's rows */
function busColumns(rows, companyName) {
  const by = new Map();
  for (const r of rows) {
    if (!by.has(r.busId)) by.set(r.busId, { id: r.busId, company: companyName(r.company), hired: r.kind === "Hired", rows: [] });
    by.get(r.busId).rows.push(r);
  }
  const buses = [...by.values()].map((b) => {
    const riders = new Map(), priced = b.rows.filter((r) => r.priced);
    for (const r of b.rows) riders.set(r.date, (riders.get(r.date) || 0) + r.riders);
    const head = (h) => r2(priced.reduce((s, r) => s + (r.standing[h] || 0), 0));
    const issued = priced.some((r) => r.dieselIssued == null) ? null : r2(priced.reduce((s, r) => s + r.dieselIssued, 0));
    return {
      ...b, riders, unpriced: b.rows.some((r) => !r.priced),
      km: r2(priced.reduce((s, r) => s + r.km, 0)),
      litres: issued == null ? null : r2(priced.reduce((s, r) => s + r.dieselIssuedLitres, 0)),
      diesel: issued,
      head,
      hireOn: (from, to) => (priced.length ? r2(priced.filter((r) => r.date >= from && r.date <= to).reduce((s, r) => s + r.hire, 0)) : null),
    };
  });
  const order = (a, b) => a.company.localeCompare(b.company) || a.id.localeCompare(b.id);
  return { owned: buses.filter((b) => !b.hired).sort(order), hired: buses.filter((b) => b.hired).sort(order) };
}

/**
 * The "Costing sheet" worksheet.
 * @param XLSX        the writer (xlsx-js-style: it keeps the cell styles)
 * @param rows        costRows' rows for the period, today already left out
 * @param dates       every calendar date the sheet lists (calendarDates)
 * @param title       "for the month of OCTOBER - 2026" (sheetPeriod)
 * @param heads, name the standing cost heads in the export's order, and each one's name (costName)
 * @param unreliable  the buses whose per head is not reliable (the ERP maps under a quarter of the
 *                    riders their plan carries): their per head is shaded red and explained below
 * @param lastPaid    (busId, head) → the start of the bus's last line of that head when it has dropped
 *                    out of the 12 months, else "": shown as "Last paid Apr 2025" instead of a blank
 * @param XL, xlDate  costReport's number formats and Excel date serial
 */
export function costingSheet(XLSX, { rows, dates, title, heads, name, companyName, XL, xlDate, unreliable = new Set(), lastPaid = () => "" }) {
  const { owned, hired } = busColumns(rows, companyName);
  const ws = {}, merges = [];
  let maxR = 0, maxC = 0;
  const ref = (r, c) => XLSX.utils.encode_cell({ r, c });
  const touch = (r, c) => { maxR = Math.max(maxR, r); maxC = Math.max(maxC, c); };
  const put = (r, c, v, s, z) => {
    touch(r, c);
    ws[ref(r, c)] = v == null || v === "" ? { t: "s", v: "", s } : typeof v === "number" ? { t: "n", v, s, ...(z ? { z } : {}) } : { t: "s", v: String(v), s };
  };
  // a formula with its value worked out here, so the sheet shows it before Excel recalculates
  const calc = (r, c, f, v, s, z) => {
    touch(r, c);
    ws[ref(r, c)] = v == null || !Number.isFinite(v) ? { t: "s", v: "", f, s } : { t: "n", v, f, s, ...(z ? { z } : {}) };
  };
  const A = (r, c) => XLSX.utils.encode_cell({ r, c });
  const span = (r, c1, c2) => `${A(r, c1)}:${A(r, c2)}`;
  const money = XL.count, perHead = "0.00";
  const D = dates.length;

  // rows (0-based): 0 title, 1 numbers, 2 headers, 3.. dates, then the sums
  const R0 = 3, rTotal = R0 + D, rAvg = rTotal + 1, rKm = rAvg + 2, rLitres = rKm + 1, rKmpl = rLitres + 1;
  // the costing block: diesel, driver salary, then each ERP head on its own row
  const lines = [{ key: "diesel", label: "Diesel cost", get: (b) => b.diesel },
    { key: "driver", label: "Driver Salary", get: (b) => b.head("driver") },
    // the renewed heads always have a row, so a bus can say when it last paid one nobody paid this year
    ...[...RENEWED.filter((h) => !heads.includes(h)), ...heads].filter((h) => h !== "driver")
      .sort((a, b) => (RENEWED.includes(a) ? RENEWED.indexOf(a) : 9) - (RENEWED.includes(b) ? RENEWED.indexOf(b) : 9))
      .map((h) => ({ key: h, label: name(h), get: (b) => b.head(h) }))];
  const rCosting = rKmpl + 2, rLine = (k) => rCosting + 1 + k, rLastLine = rLine(lines.length - 1);
  const rCost = rLastLine + 1, rHead = rCost + 1, rKmCost = rHead + 1;
  const costOf = (b) => r2(lines.reduce((s, l) => s + (l.get(b) || 0), 0));
  const ridersOf = (b) => [...b.riders.values()].reduce((s, n) => s + n, 0);
  const workedDays = (b) => [...b.riders.values()].filter((n) => n > 0).length;

  /* ---- company vehicles (owned), from column A ---- */
  const oFirst = 1, oLast = oFirst + owned.length - 1, oTotal = oLast + 1;
  put(0, 0, `Company vehicle costing ${title}`, S.title);
  for (let c = 1; c <= oTotal; c++) put(0, c, "", S.title);
  merges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: oTotal } });
  put(2, 0, "DATE", S.dateHead);
  owned.forEach((b, i) => { put(1, oFirst + i, i + 1, S.number); put(2, oFirst + i, `${b.id}\n${b.company}`, S.busHead); });
  put(1, oTotal, "", S.number); put(2, oTotal, "TOTAL", S.totalHead);
  dates.forEach((d, k) => {
    const r = R0 + k;
    put(r, 0, xlDate(d), S.date, "d-mmm-yy");
    owned.forEach((b, i) => put(r, oFirst + i, b.riders.get(d) || null, S.day, "0"));
    const day = owned.reduce((s, b) => s + (b.riders.get(d) || 0), 0);
    if (owned.length) calc(r, oTotal, `SUM(${span(r, oFirst, oLast)})`, day, S.dayTotal, "0"); else put(r, oTotal, "", S.dayTotal);
  });
  put(rTotal, 0, "Total riders", S.rowName); put(rAvg, 0, "Average a day", S.rowName);
  put(rKm, 0, "Total Km", S.kmName); put(rLitres, 0, "Diesel (litres)", S.kmName); put(rKmpl, 0, "Average km", S.kmName);
  put(rCosting, 0, "Costing", S.costingHead);
  lines.forEach((l, k) => put(rLine(k), 0, l.label, S.costName));
  [[rCost, "Total Cost"], [rHead, "Per head a day (up & down)"], [rKmCost, "KM Cost"]].forEach(([r, n]) => put(r, 0, n, S.costNameBold));
  owned.forEach((b, i) => {
    const c = oFirst + i, col = (r) => A(r, c), riders = ridersOf(b), worked = workedDays(b);
    calc(rTotal, c, `SUM(${col(R0)}:${col(rTotal - 1)})`, riders, S.sum, money);
    calc(rAvg, c, `IFERROR(${col(rTotal)}/COUNTIF(${col(R0)}:${col(rTotal - 1)},">0"),"")`, worked ? riders / worked : null, S.sum, "0");
    put(rKm, c, b.km, S.km, money);
    put(rLitres, c, b.litres, S.km, money);
    calc(rKmpl, c, `IFERROR(${col(rKm)}/${col(rLitres)},"")`, b.litres ? b.km / b.litres : null, S.km, "0.0");
    put(rCosting, c, b.id, S.busHead);
    lines.forEach((l, k) => {
      const v = l.get(b), paid = !v && RENEWED.includes(l.key) ? lastPaid(b.id, l.key) : "";
      if (paid) put(rLine(k), c, `Last paid ${monthYear(paid)}`, S.lastPaid); else put(rLine(k), c, v || null, S.cost, money);
    });
    const total = costOf(b);
    calc(rCost, c, `SUM(${col(rLine(0))}:${col(rLastLine)})`, total, S.costBold, money);
    calc(rHead, c, `IFERROR(${col(rCost)}/${col(rTotal)},"")`, riders ? total / riders : null, unreliable.has(b.id) ? S.unreliable : S.costBold, perHead);
    calc(rKmCost, c, `IFERROR(${col(rCost)}/${col(rKm)},"")`, b.km ? total / b.km : null, S.costBold, perHead);
  });
  // the Total column: each row's sum across the buses, and the per-head and per-km of those sums
  const oSum = (r) => `SUM(${span(r, oFirst, Math.max(oFirst, oLast))})`;
  const oTot = (get) => r2(owned.reduce((s, b) => s + (get(b) || 0), 0));
  const oRiders = owned.reduce((s, b) => s + ridersOf(b), 0), oKm = oTot((b) => b.km), oLitres = oTot((b) => b.litres);
  const oCost = oTot(costOf);
  if (owned.length) {
    calc(rTotal, oTotal, oSum(rTotal), oRiders, S.costTotal, money);
    calc(rAvg, oTotal, oSum(rAvg), owned.reduce((s, b) => s + (workedDays(b) ? ridersOf(b) / workedDays(b) : 0), 0), S.costTotal, "0");
    calc(rKm, oTotal, oSum(rKm), oKm, S.costTotal, money);
    calc(rLitres, oTotal, oSum(rLitres), oLitres, S.costTotal, money);
    calc(rKmpl, oTotal, `IFERROR(${A(rKm, oTotal)}/${A(rLitres, oTotal)},"")`, oLitres ? oKm / oLitres : null, S.costTotal, "0.0");
    put(rCosting, oTotal, "Total", S.totalHead);
    lines.forEach((l, k) => calc(rLine(k), oTotal, oSum(rLine(k)), oTot(l.get), S.costTotal, money));
    calc(rCost, oTotal, oSum(rCost), oCost, S.costTotal, money);
    calc(rHead, oTotal, `IFERROR(${A(rCost, oTotal)}/${A(rTotal, oTotal)},"")`, oRiders ? oCost / oRiders : null, S.headRed, perHead);
    calc(rKmCost, oTotal, `IFERROR(${A(rCost, oTotal)}/${A(rKm, oTotal)},"")`, oKm ? oCost / oKm : null, S.headRed, perHead);
  }

  /* ---- contract vehicles (hired), to the right after a gap column ---- */
  const cFrom = oTotal + 2, cDate = cFrom + 1, hFirst = cDate + 1, hLast = hFirst + hired.length - 1, hTotal = hLast + 1;
  put(0, cFrom, `Contract vehicle costing ${title}`, S.title);
  for (let c = cFrom + 1; c <= hTotal; c++) put(0, c, "", S.title);
  merges.push({ s: { r: 0, c: cFrom }, e: { r: 0, c: hTotal } });
  put(2, cDate, "DATE", S.dateHead);
  hired.forEach((b, i) => { put(1, hFirst + i, i + 1, S.number); put(2, hFirst + i, `${b.id}\n${b.company}`, S.busHead); });
  put(1, hTotal, "", S.number); put(2, hTotal, "TOTAL", S.totalHead);
  dates.forEach((d, k) => {
    const r = R0 + k;
    put(r, cDate, xlDate(d), S.date, "d-mmm-yy");
    hired.forEach((b, i) => put(r, hFirst + i, b.riders.get(d) || null, S.day, "0"));
    if (hired.length) calc(r, hTotal, `SUM(${span(r, hFirst, hLast)})`, hired.reduce((s, b) => s + (b.riders.get(d) || 0), 0), S.dayTotal, "0");
  });
  put(rTotal, cDate, "Total riders", S.rowName); put(rAvg, cDate, "Average a day", S.rowName);
  // the hire bills: by half month, as their contractors bill, else the one stretch shown
  const first = dates[0], last = dates[D - 1];
  const half = first && first.slice(8) === "01" && D > 15 ? [[first, first.slice(0, 8) + "15"], [first.slice(0, 8) + "16", last]] : [[first, last]];
  const rBillHead = rKm, rBills = half.map((_, k) => rBillHead + 1 + k), rBillTotal = rBillHead + 1 + half.length, rPerHead = rBillTotal + 2;
  put(rBillHead, cFrom, "FDATE", S.billHead); put(rBillHead, cDate, "TDATE", S.billHead);
  half.forEach(([f, t], k) => { put(rBills[k], cFrom, xlDate(f), S.billDate, "d-mmm-yy"); put(rBills[k], cDate, xlDate(t), S.billDate, "d-mmm-yy"); });
  put(rBillTotal, cDate, "Total hire", S.rowName);
  put(rPerHead, cFrom, "PER HEAD COST", S.perHeadName); put(rPerHead, cDate, "", S.perHeadName);
  merges.push({ s: { r: rPerHead, c: cFrom }, e: { r: rPerHead, c: cDate } });
  hired.forEach((b, i) => {
    const c = hFirst + i, col = (r) => A(r, c), riders = ridersOf(b), worked = workedDays(b);
    calc(rTotal, c, `SUM(${col(R0)}:${col(rTotal - 1)})`, riders, S.sum, money);
    calc(rAvg, c, `IFERROR(${col(rTotal)}/COUNTIF(${col(R0)}:${col(rTotal - 1)},">0"),"")`, worked ? riders / worked : null, S.sum, "0");
    put(rBillHead, c, b.id, S.busHead);
    const bills = half.map(([f, t]) => b.hireOn(f, t));
    bills.forEach((v, k) => put(rBills[k], c, b.unpriced && !v ? null : v, S.bill, money));
    const total = b.unpriced && !bills.some(Boolean) ? null : r2(bills.reduce((s, v) => s + (v || 0), 0));
    // a van with no bill keeps an empty cell, not a SUM that Excel would read as ₹0 and count
    if (total == null) put(rBillTotal, c, null, S.billTotal);
    else calc(rBillTotal, c, `SUM(${col(rBills[0])}:${col(rBills[rBills.length - 1])})`, total, S.billTotal, money);
    if (total == null) put(rPerHead, c, null, S.perHead);
    else calc(rPerHead, c, `IFERROR(${col(rBillTotal)}/${col(rTotal)},"")`, riders ? total / riders : null, unreliable.has(b.id) ? S.unreliableBig : S.perHead, perHead);
  });
  // a van not priced has a blank bill: its riders are left out of the contract per head (SUMIF on a
  // bill above 0, so neither an empty cell nor text can count)
  const hBills = hired.map((b) => { const v = half.map(([f, t]) => b.hireOn(f, t)); return b.unpriced && !v.some(Boolean) ? null : r2(v.reduce((s, x) => s + (x || 0), 0)); });
  const hCost = r2(hBills.reduce((s, v) => s + (v || 0), 0));
  const hPricedRiders = hired.reduce((s, b, i) => s + (hBills[i] != null ? ridersOf(b) : 0), 0);
  const hRiders = hired.reduce((s, b) => s + ridersOf(b), 0);
  if (hired.length) {
    const hSum = (r) => `SUM(${span(r, hFirst, hLast)})`;
    calc(rTotal, hTotal, hSum(rTotal), hRiders, S.costTotal, money);
    calc(rAvg, hTotal, hSum(rAvg), hired.reduce((s, b) => s + (workedDays(b) ? ridersOf(b) / workedDays(b) : 0), 0), S.costTotal, "0");
    put(rBillHead, hTotal, "Total", S.totalHead);
    rBills.forEach((r, k) => calc(r, hTotal, hSum(r), r2(hired.reduce((s, b) => s + (b.hireOn(...half[k]) || 0), 0)), S.costTotal, money));
    calc(rBillTotal, hTotal, hSum(rBillTotal), hCost, S.costTotal, money);
    calc(rPerHead, hTotal, `IFERROR(${A(rBillTotal, hTotal)}/SUMIF(${span(rBillTotal, hFirst, hLast)},">0",${span(rTotal, hFirst, hLast)}),"")`,
      hPricedRiders ? hCost / hPricedRiders : null, S.perHeadRed, perHead);
  }

  /* ---- below: cost per head for each side and overall, and what the figures are ---- */
  const rSum = rKmCost + 3;
  const ownHead = owned.length ? A(rHead, oTotal) : null, conHead = hired.length ? A(rPerHead, hTotal) : null;
  put(rSum, 0, "Company vehicles, per head a day", S.sumName);
  calc(rSum, 1, ownHead ? `${ownHead}` : "0", oRiders ? oCost / oRiders : null, S.sumValue, perHead);
  put(rSum + 1, 0, "Contract vehicles, per head a day", S.sumName);
  calc(rSum + 1, 1, conHead ? `${conHead}` : "0", hPricedRiders ? hCost / hPricedRiders : null, S.sumValue, perHead);
  put(rSum + 2, 0, "OVERALL PER HEAD COST", { ...S.sumName, fill: fill(YELLOW) });
  const allRiders = oRiders + hPricedRiders;
  const allF = `IFERROR((${owned.length ? A(rCost, oTotal) : 0}+${hired.length ? A(rBillTotal, hTotal) : 0})/(${owned.length ? A(rTotal, oTotal) : 0}+${hired.length ? `SUMIF(${span(rBillTotal, hFirst, hLast)},">0",${span(rTotal, hFirst, hLast)})` : 0}),"")`;
  calc(rSum + 2, 1, allF, allRiders ? (oCost + hCost) / allRiders : null, { ...S.sumValue, fill: fill(YELLOW) }, perHead);
  const unpricedVans = hired.filter((b, i) => hBills[i] == null).length;
  const red = [...owned, ...hired].filter((b) => unreliable.has(b.id)).length;
  const paidRows = owned.some((b) => RENEWED.some((h) => !b.head(h) && lastPaid(b.id, h)));
  const notes = [
    red > 0 && ["red", `Red per head (${red} ${red === 1 ? "bus" : "buses"}): the ERP maps fewer than a quarter of the riders this bus's plan carries (often 1 a day against 50 planned), so its cost is divided by too few people and the per head reads far too high. The cost itself is right and is in every total; the riders are mapped to other buses in the ERP. Correct the bus's riders in the ERP to fix it.`],
    paidRows && ["paid", "\"Last paid\" in a cost row: the bus's newest road tax, insurance or FC in the ERP started more than 12 months ago, so it is not charged in this period. The renewal has not been entered in the ERP yet; once it is, it is charged here."],
  ].filter(Boolean);
  notes.forEach(([kind, t], k) => put(rSum + 4 + k, 0, t, kind === "red" ? S.noteRed : S.note));
  [
    "Riders: the people who came that day, from the ERP's punches for the riders mapped to each bus. Per head a day is the cost of one person for a day, up and down.",
    "Diesel cost: the diesel the ERP issued to the bus, at its own price that day (where no fill is on record, the diesel the km should burn). Every other cost has its own row: the ERP's cost lines of the last 12 months, spread over the working days and charged on the days the bus worked.",
    "Driver Salary: not in any ERP feed, so it is blank and not in the totals.",
    "Contract vehicles: the hire is one day tariff on the day's km (GPS, or the planned runs that ran). Km and diesel for them are the owner's.",
    unpricedVans > 0 && `${unpricedVans} contract ${unpricedVans === 1 ? "vehicle has" : "vehicles have"} no bill: riders but no plan run and no GPS, so the hire is not known. ${unpricedVans === 1 ? "Its" : "Their"} riders are left out of the per head.`,
    "The other tabs carry the same figures day by day, both ways (by km and by diesel), with how each one is worked out.",
  ].filter(Boolean).forEach((t, k) => put(rSum + 4 + notes.length + k, 0, t, S.note));

  ws["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: maxR, c: maxC } });
  ws["!merges"] = merges;
  const cols = [];
  cols[0] = { wch: 30 };
  for (let c = oFirst; c <= oLast; c++) cols[c] = { wch: 12.5 };
  cols[oTotal] = { wch: 13 }; cols[oTotal + 1] = { wch: 3 }; cols[cFrom] = { wch: 10 }; cols[cDate] = { wch: 13 };
  for (let c = hFirst; c <= hLast; c++) cols[c] = { wch: 12.5 };
  cols[hTotal] = { wch: 13 };
  ws["!cols"] = cols.map((x) => x || { wch: 10 });
  ws["!rows"] = [{ hpt: 32 }, { hpt: 20 }, { hpt: 42 }];
  ws["!rows"][rCosting] = { hpt: 32 }; ws["!rows"][rBillHead] = { hpt: 32 };
  return ws;
}
