/* dailyCost tests — run with:  node src/dailyCost.test.js
 *
 * The properties that matter: a diesel issue is never counted twice or lost (its litres,
 * spread over the days it refilled, add back up to what was issued); a day the bus app
 * recorded is costed on GPS km and one it did not falls back to plan km, saying so; a hired
 * bus costs one day tariff on the day's km, the same both ways; a planned run counts only on a
 * day its service ran and standing costs only on a day the bus worked, both read from the
 * punches; a bus that drove with no fill on record is not ₹0 by diesel, and no fill is counted
 * twice; standing costs come from the 12 months up to each day; and a hired van with no plan run
 * and no GPS is marked unpriced rather than read as free. */
import {
  indexGps, priceOn, kmOn, dieselOn, variableCost, isHiredBus, cameInOn, attendanceRules, workedOn, busDay, ratesOn, noFillOn,
  FALLBACK_KMPL, DIESEL_PER_LITRE, MAX_SPREAD_DAYS, ESTIMATE_DAYS, driverDaily, DRIVER_SALARY_MONTH,
} from "./dailyCost.js";
import { mapErpCosts } from "./erp.js";
import { rentTariff } from "./optimiser/engine.js";

let pass = 0, fail = 0;
const ok = (cond, label, detail = "") => {
  if (cond) { pass++; } else { fail++; console.log(`  FAIL: ${label}${detail ? " — " + detail : ""}`); }
};
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;
const dates = (from, n) => Array.from({ length: n }, (_, i) => new Date(Date.parse(from + "T00:00:00Z") + i * 864e5).toISOString().slice(0, 10));

/* ---- km: GPS when the bus app recorded the day, plan otherwise ---- */
{
  const idx = indexGps([
    { serviceDate: "2026-09-28", busId: "TN57CL3434", km: 88.4, journeys: 3, active: 0 },
    { serviceDate: "2026-09-29", busId: "TN57CL3434", km: 30.1, journeys: 1, active: 0 },
    { serviceDate: "2026-09-30", busId: "TN57CL3434", km: 12.0, journeys: 1, active: 1 },
  ]);
  const bus = { id: "TN57 CL 3434", planKm: 92.2 };        // the ERP's own spacing still joins
  const d28 = kmOn(bus, "2026-09-28", idx, "2026-09-30");
  ok(d28.source === "gps" && d28.km === 88.4 && !d28.partial && !d28.inProgress, "recorded day: GPS km");
  const d29 = kmOn(bus, "2026-09-29", idx, "2026-09-30");
  ok(d29.partial, "finished day far under plan is flagged partial", JSON.stringify(d29));
  const d30 = kmOn(bus, "2026-09-30", idx, "2026-09-30");
  ok(d30.inProgress && !d30.partial, "today with a journey still out: in progress, not partial");
  const d27 = kmOn(bus, "2026-09-27", idx, "2026-09-30");
  ok(d27.source === "plan" && d27.km === 92.2, "unrecorded day falls back to plan km");
  ok(kmOn({ id: "X1" }, "2026-09-27", idx, null).source === null, "no GPS and no plan: no km");
  ok(kmOn(bus, "2026-09-27", null, null).source === "plan", "bus app not linked: plan km");
}

/* ---- price: the latest ERP price on or before the day ---- */
{
  const prices = [["2026-07-01", 100.36], ["2026-08-10", 100.67]];
  ok(priceOn(prices, "2026-06-30") === null, "no price before the first issue");
  ok(priceOn(prices, "2026-08-09").rate === 100.36, "price carries forward");
  ok(priceOn(prices, "2026-09-30").rate === 100.67 && priceOn(prices, "2026-09-30").date === "2026-08-10", "latest price and its date");
}

/* ---- diesel: an issue refills the days since the previous one ---- */
{
  const issues = [["2026-09-10", 50, 5000], ["2026-09-11", 60, 6000], ["2026-09-15", 100, 10000], ["2026-09-30", 140, 14000]];
  const one = dieselOn(issues, "2026-09-11");
  ok(one.source === "issued" && one.litres === 60 && one.issue.days === 1, "daily issue: the day's own litres");
  const spread = dates("2026-09-12", 4).map((d) => dieselOn(issues, d));
  ok(spread.every((x) => x.source === "issued" && near(x.litres, 25) && near(x.amount, 2500)), "4-day gap: 100 L spread as 25 L a day");
  // a 15-day gap: only the last MAX_SPREAD_DAYS are refilled, the rest is a bus off the road
  const gap = dates("2026-09-16", 15).map((d) => dieselOn(issues, d));
  ok(gap.filter((x) => x.source === "issued").length === MAX_SPREAD_DAYS, "long gap: capped at MAX_SPREAD_DAYS");
  ok(gap[0].source === "none" && gap[0].next === "2026-09-30", "long gap: early days carry no diesel and name the next issue");
  // conservation: every issued litre lands on exactly one day
  const all = dates("2026-09-01", 30).map((d) => dieselOn(issues, d)).filter((x) => x.source === "issued");
  ok(near(all.reduce((s, x) => s + x.litres, 0), 50 + 60 + 100 + 140), "every issued litre is attributed exactly once");
  ok(dieselOn([], "2026-09-10").source === "none" && dieselOn(null, "2026-09-10").source === "none", "no issues: none");
}

/* ---- diesel: after the latest issue, the recent average stands in for a while ---- */
{
  const issues = [["2026-09-20", 40, 4000], ["2026-09-24", 80, 8000], ["2026-09-28", 80, 8000]];
  // covered: 20th (its own day, first on record) + 21–24 + 25–28 = 9 days, 200 L
  const est = dieselOn(issues, "2026-09-30");
  ok(est.source === "estimate" && near(est.litres, 200 / 9) && est.last === "2026-09-28", "estimate = litres over the days they refilled", JSON.stringify(est));
  ok(dieselOn(issues, "2026-10-08").source === "estimate", "estimate holds up to ESTIMATE_DAYS");
  const stale = dieselOn(issues, dates("2026-09-28", ESTIMATE_DAYS + 2).pop());
  ok(stale.source === "none" && stale.last === "2026-09-28", "past ESTIMATE_DAYS: none, naming the last issue");
}

/* ---- cost: owned buses are diesel either way, hired buses the tariff either way ---- */
{
  const price = { rate: 100.67, date: "2026-09-29" };
  const owned = { id: "TN57CL3434", type: "Owned", mileage: 5, planKm: 92.2 };
  const gpsDay = { km: 50, source: "gps" };
  const v = variableCost(owned, gpsDay, dieselOn([["2026-09-29", 42, 4228.14]], "2026-09-29"), price);
  ok(!v.hired && near(v.byKm.litres, 10) && near(v.byKm.amount, 1006.7), "km basis: km ÷ ERP mileage × ERP price", JSON.stringify(v.byKm));
  ok(near(v.byDiesel.amount, 4228.14) && v.byDiesel.source === "issued" && near(v.byDiesel.rate, 100.67), "diesel basis: what was issued");
  const noMileage = variableCost({ id: "B", type: "Owned" }, gpsDay, null, null);
  ok(near(noMileage.byKm.amount, (50 / FALLBACK_KMPL) * DIESEL_PER_LITRE) && !noMileage.byKm.kmplFromErp && noMileage.byDiesel === null,
    "no ERP mileage or price: planner defaults, and no diesel figure without the feed");
  ok(variableCost(owned, { km: 0, source: null }, null, price).byKm === null, "no km at all: nothing to price by km");

  const hired = { id: "TN20BM9126", type: "Rental", planType: "rent" };
  const onPlan = variableCost(hired, { km: 92, source: "plan" }, null, price);
  ok(onPlan.hired && onPlan.byKm.amount === rentTariff(92) && onPlan.byDiesel === onPlan.byKm, "hired, plan day: the day tariff on the planned km, same both ways");
  ok(near(variableCost(hired, { km: 96, source: "plan" }, null, price).byKm.amount, 1900), "over 95 km the tariff never drops under ₹1,900");
  const onGps = variableCost(hired, { km: 120, source: "gps" }, null, price);
  ok(near(onGps.byKm.amount, rentTariff(120)) && onGps.byDiesel.amount === onGps.byKm.amount, "hired, GPS day: tariff on km driven, same both ways");
  ok(variableCost({ id: "R", type: "Rental" }, { km: 70, source: "gps" }, null, price).hired, "hired without a plan route: told by its ERP type");
}

/* ---- hired or owned: the ERP's type decides when it says anything ---- */
{
  ok(isHiredBus({ type: "Rental", planType: "own" }) && !isHiredBus({ type: "Owned", planType: "rent" }), "the ERP type wins over the plan's");
  ok(isHiredBus({ type: "", planType: "rent" }) && !isHiredBus({ type: "", planType: "own" }) && !isHiredBus({}), "a blank ERP type falls back to the plan");
  ok(isHiredBus({ type: "", planType: "own" }, { type: "rent" }) && !isHiredBus({ type: "", planType: "rent" }, { type: "own" })
    && isHiredBus({ type: "", planType: "rent" }, { km: 0, runs: [] }), "...the plan of the day's own week first, this week's when that one names no type");
}

/* ---- did a group come in: at least half of those who punched were present ---- */
{
  const att = {
    "2026-10-01": { a: "P", b: "P", c: "A", d: "P" },
    "2026-10-02": { a: "P", b: "A", c: "A", d: "A", z: "P" },   // a quarter of a–d came; z worked
    "2026-10-04": { a: "A", b: "A", c: "A", z: "P" },   // Sunday for a–c; z works on
    "2026-10-05": { a: "A", b: "A" },                    // today, still filling up
  };
  const came = cameInOn(att, { open: "2026-10-05", holidays: ["2026-10-02", "2026-10-03"] });
  ok(came(["a", "b", "c", "d"], "2026-10-01") && !came(["a", "b", "c", "d"], "2026-10-02"), "at least half present: came; fewer: did not");
  ok(came(["a", "b"], "2026-10-02"), "exactly half present counts as came");
  ok(!came(["a", "b", "c"], "2026-10-04") && came(["z"], "2026-10-04"), "a Sunday is judged by who came, not by the calendar");
  ok(came(["a", "b"], "2026-09-30") && came(["q"], "2026-10-01"), "no punches for the group: counted as a working day");
  ok(!came(["a", "b"], "2026-10-03") && !came(["q"], "2026-10-02"), "a declared holiday nobody in the group punched on is not a working day");
  ok(came(["z"], "2026-10-02") && !came(["c", "d"], "2026-10-02"), "on a declared holiday the punches still decide: those who came worked");
  ok(came(["a", "b"], "2026-10-05"), "today is not judged while riders arrive");
  const stale = cameInOn(att, { open: "2026-10-06" });
  ok(!stale(["a", "b"], "2026-10-05"), "a finished day is judged, even when it is the newest the feed holds (a pull that did not reach today)");

  const employees = [
    { id: "a", unit: "Gainup", shift: "S9", busId: "B1" }, { id: "b", unit: "Gainup", shift: "S9", busId: "B1" },
    { id: "c", unit: "Gainup", shift: "S9", busId: "B2" }, { id: "z", unit: "Gainup", shift: "ROT", busId: "B2" },
  ];
  const rules = attendanceRules(employees, att, { serviceOf: (e) => (e.shift === "ROT" ? "rot-day" : "s9"), open: "2026-10-05" });
  ok(!rules.ranOn("s9", "2026-10-04") && rules.ranOn("rot-day", "2026-10-04"), "per service: 9 am did not run on Sunday, Rotational did");
  ok(!rules.ridersCame("B1", "2026-10-04") && rules.ridersCame("B1", "2026-10-01") && !rules.ridersCame("B2", "2026-10-01"), "per bus: its own mapped riders");
  ok(rules.ranOn("zen", "2026-10-01"), "a service with nobody on record: counted as run");
  ok(!rules.ridersCame("NOBODY", "2026-10-01") && !rules.ridersCame("NOBODY", "2026-09-30"), "a bus nobody is mapped to has no riders to come");
}

/* ---- a bus worked: GPS, a planned run that ran, or (no run planned) its riders came ---- */
{
  const ridersCame = (busId) => busId === "CAME";
  const gpsDay = { source: "gps", km: 40, plan: { km: 0, runs: [], skipped: 2 } };
  ok(workedOn({ id: "X" }, "2026-10-04", gpsDay, ridersCame), "the bus app recorded it: worked, whatever the plan says");
  ok(workedOn({ id: "X" }, "2026-10-04", { source: "plan", km: 30, plan: { km: 30, runs: [{ service: "rot-day", km: 30 }], skipped: 1 } }, ridersCame), "one planned run ran: worked");
  ok(!workedOn({ id: "CAME" }, "2026-10-04", { source: null, km: 0, plan: { km: 0, runs: [], skipped: 2 } }, ridersCame), "planned runs, none ran: not worked, even if riders turned up");
  ok(workedOn({ id: "CAME" }, "2026-10-04", { source: null, km: 0, plan: { km: 0, runs: [] } }, ridersCame)
    && !workedOn({ id: "STAYED" }, "2026-10-04", { source: null, km: 0, plan: { km: 0, runs: [] } }, ridersCame), "no run planned: worked when its riders came");
  ok(workedOn({ id: "STAYED" }, "2026-10-04", { source: "plan", km: 30, plan: { km: 30 } }, ridersCame), "a plan with no runs on record stands as planned");
}

/* ---- one bus-day as the records carry it ---- */
{
  const week = "2026-09-28";
  const runs = [{ service: "s9", km: 50 }, { service: "rot-day", km: 30 }];
  const owned = { id: "TN57CA3434", type: "Owned", mileage: 5, planWeeks: { [week]: { km: 80, type: "own", runs } } };
  const nineOnly = { id: "TN58BJ3636", type: "Owned", mileage: 5, planWeeks: { [week]: { km: 50, type: "own", runs: [runs[0]] } } };
  const ranOn = (svc, date) => date !== "2026-10-04" || svc.startsWith("rot-");   // Sunday: Rotational only
  const rates = { standing: 300, budget: 100 };
  // the fill after 1 Oct is too late to refill the 4th, so no fill covers that day
  const diesel = { issues: { TN57CA3434: [["2026-10-01", 20, 2000], ["2026-10-20", 50, 5000]] }, prices: [["2026-09-01", 100]] };
  const run = { diesel, ranOn, ridersCame: () => true, ridersOn: () => 0 };

  const thu = busDay(owned, "2026-10-01", rates, run);
  ok(thu.worked && thu.standing === 300 && thu.budget === 100 && thu.km === 80, "a weekday: every run, standing charged");
  ok(near(thu.varKm, 1600) && thu.varDiesel === 2000 && !thu.noFill && thu.spend === 1900 && thu.spendDiesel === 2300, "both ways: diesel by km, and the fill as issued");

  const sun = busDay(owned, "2026-10-04", rates, run);
  ok(sun.worked && sun.km === 30 && sun.day.plan.skipped === 1 && near(sun.varKm, 600), "Sunday: only the Rotational run is costed");
  ok(!sun.noFill && sun.cost.byDiesel.source === "none" && sun.cost.byDiesel.next === "2026-10-20" && sun.varDiesel === 0,
    "a day before a later fill that does not spread back to it: none, since that fill refills it");
  const lastLongAgo = busDay(owned, "2026-10-04", rates, { ...run, diesel: { ...diesel, issues: { TN57CA3434: [["2026-09-10", 20, 2000]] } } });
  ok(lastLongAgo.noFill && lastLongAgo.cost.byDiesel.source === "none" && lastLongAgo.varDiesel === lastLongAgo.varKm && lastLongAgo.spendDiesel === 300 + lastLongAgo.varKm,
    "no fill accounts for a day the bus drove (the last one weeks back, none since): diesel by km stands in, the ERP's own reading kept");
  ok(busDay(owned, "2026-10-04", rates, { ...run, diesel: { ...diesel, issues: {} } }).noFill, "...and so with no fill on record at all");
  ok(busDay(nineOnly, "2026-10-04", rates, run) === null, "a 9 am bus on Sunday: no km, no standing, nothing to show");
  const nineDiesel = { ...diesel, issues: { TN58BJ3636: [["2026-10-01", 10, 1000], ["2026-10-05", 70, 7000]] } };
  const sunFilled = busDay(nineOnly, "2026-10-04", rates, { ...run, diesel: nineDiesel });
  ok(sunFilled && !sunFilled.worked && sunFilled.standing === 0 && sunFilled.spend === 0 && sunFilled.varDiesel === 1750,
    "a fill spread over a day the bus did not work still lands, with no standing");

  const noFeed = busDay(owned, "2026-10-02", rates, { ...run, diesel: null });
  ok(noFeed.spendDiesel === null && noFeed.varDiesel === null && !noFeed.noFill, "diesel feed not loaded: by diesel unknown, not by km");

  const offDay = { ...run, ranOn: () => false, gpsIdx: indexGps([{ serviceDate: "2026-10-02", busId: "TN58BJ3636", km: 44 }]) };
  const gpsHol = busDay(nineOnly, "2026-10-02", rates, offDay);
  ok(gpsHol.worked && gpsHol.day.source === "gps" && gpsHol.km === 44 && gpsHol.standing === 300, "GPS wins: a bus the app recorded worked, even on a day its service did not run");

  const van = { id: "TN02AB5688", type: "Rental" };
  const carried = busDay(van, "2026-10-01", { standing: 0, budget: 0 }, { ...run, ridersOn: () => 24 });
  ok(carried && carried.unpriced && carried.cost.hired && carried.spend === 0 && carried.spendDiesel === 0 && carried.worked,
    "a hired van with riders but no plan run and no GPS: unpriced, and its zeros say so");
  ok(busDay(van, "2026-10-01", { standing: 0, budget: 0 }, run) === null, "...and with no riders, nothing at all");

  // driver salary: typed in Settings, a month ÷ 26, on each day an owned bus worked
  const pay = { ...run, driverDaily: driverDaily(18000) };
  const paid = busDay(owned, "2026-10-01", { ...rates, heads: { taxes: 300 } }, pay);
  ok(near(driverDaily(18000), 18000 / 26) && driverDaily(undefined) === DRIVER_SALARY_MONTH / 26 && driverDaily(-5) === 0, "a month's salary ÷ 26; unset is ₹18,000; never below 0");
  ok(near(paid.heads.driver, 18000 / 26) && near(paid.standing, 300 + 18000 / 26) && paid.heads.taxes === 300, "an owned bus that worked: its driver salary is a standing head");
  const idle = busDay(nineOnly, "2026-10-04", { ...rates, heads: {} }, { ...pay, diesel: nineDiesel });
  ok(idle && !idle.worked && !idle.heads.driver && idle.standing === 0, "a day the bus did not work: no driver salary");
  ok(!busDay(van, "2026-10-01", { standing: 0, budget: 0, heads: {} }, { ...pay, ridersOn: () => 24 }).heads.driver, "a rented van: no driver salary, it is in the hire");
  const unknown = busDay({ ...owned, type: "" }, "2026-10-01", { ...rates, heads: {} }, pay);
  ok(unknown.worked && !unknown.heads.driver && unknown.standing === 300, "a bus 'owned' only by the plan's default (no ERP type, no cost lines): no driver salary");
  const plannedVan = { id: "TN05V6697", type: "Rental", planWeeks: { [week]: { km: 76.9, type: "rent", runs: [{ service: "s9", km: 76.9 }] } } };
  ok(busDay(plannedVan, "2026-10-04", { standing: 0, budget: 0 }, { ...run, ridersOn: () => 2 }) === null,
    "a hired van whose planned run did not run is not unpriced: it did not run");
  const vanDay = busDay(plannedVan, "2026-10-01", { standing: 0, budget: 0 }, run);
  ok(vanDay.varKm === 1700 && vanDay.varDiesel === 1700 && !vanDay.unpriced, "a hired van on a planned day: its tariff both ways");

  const loose = { id: "TN57ZZ0001", type: "Owned" };
  const looseRun = { ...run, ridersCame: (id, date) => date !== "2026-10-04" };
  ok(busDay(loose, "2026-10-01", rates, looseRun).standing === 300 && busDay(loose, "2026-10-04", rates, looseRun) === null,
    "no run planned: standing on the days its riders came, none on the others");

  // a vehicle only the plans name, in a week whose plan has dropped it: nobody is mapped to it, so it did not work
  const planOnly = { id: "TN57BM3636", type: "", planOnly: true, planType: "own",
    planWeeks: { "2026-09-21": { km: 51.5, type: "own", runs: [{ service: "s9", km: 51.5 }] }, [week]: null } };
  const rules = attendanceRules([{ id: "a", busId: "OTHER" }], { "2026-10-04": { a: "A" } }, { serviceOf: () => "s9" });
  ok(busDay(planOnly, "2026-10-04", rates, { ...rules, diesel: null }) === null && busDay(planOnly, "2026-10-01", rates, { ...rules, diesel: null }) === null,
    "a plan-only bus in a week no plan names it: no run, no riders, so no standing on any day");
  ok(busDay(planOnly, "2026-09-24", rates, { ...rules, diesel: null }).standing === 300, "...and in a week its plan runs it, standing as usual");
}

/* ---- diesel as issued: over a stretch, exactly the fills, never more ---- */
{
  // 60 planned km a day at 5 km/L and ₹95/L, fills on 20 and 30 Sep: the 30th refills the ten days
  // between, spread over its last seven; the three before take nothing, rather than diesel by km
  const weeks = Object.fromEntries(["2026-09-14", "2026-09-21", "2026-09-28"].map((w) => [w, { km: 60, type: "own", runs: [{ service: "s9", km: 60 }] }]));
  const bus = { id: "OWNX", type: "Owned", mileage: 5, planWeeks: weeks };
  const run = { diesel: { issues: { OWNX: [["2026-09-20", 50, 4750], ["2026-09-30", 100, 9500]] }, prices: [["2026-09-01", 95]] },
    ranOn: () => true, ridersCame: () => true };
  const days = dates("2026-09-21", 10).map((d) => busDay(bus, d, { standing: 0, budget: 0, heads: {} }, run));
  ok(near(days.reduce((s, f) => s + f.varDiesel, 0), 9500) && !days.some((f) => f.noFill), "two fills ten days apart: the stretch between costs what the later one issued, no stand-in on top",
    days.map((f) => f.varDiesel.toFixed(0)).join(" "));
  ok(noFillOn({ hired: false, byKm: { amount: 100 }, byDiesel: { source: "none", last: "2026-09-01" } })
    && !noFillOn({ hired: false, byKm: { amount: 100 }, byDiesel: { source: "none", next: "2026-10-20" } })
    && !noFillOn({ hired: false, byKm: null, byDiesel: { source: "none" } }), "the stand-in: drove, and no fill before or after accounts for the day");
}

/* ---- standing rates: the ERP lines of the 12 months up to each day ---- */
{
  const line = (head, from, amount) => ({ Veh_Name: "TN57CA3434", Proj_Activity_Name: head, From_Date: `${from} 00:00:00`, To_Date: "", Pur_Amount: String(amount), Rate: String(amount) });
  const { profiles } = mapErpCosts([
    line("ROAD TAX", "01-07-2025", 31200), line("ROAD TAX", "01-10-2025", 31200), line("ROAD TAX", "01-01-2026", 31200),
    line("ROAD TAX", "01-04-2026", 31200), line("ROAD TAX", "01-07-2026", 31200), line("ROAD TAX", "01-10-2026", 31200),
    line("VEHICLE INSURANCE", "15-07-2026", 62400),
  ], { asOf: new Date(2026, 9, 5, 12).getTime() });
  const p = profiles.TN57CA3434;
  const july = ratesOn(p, "2026-07-14", 312), oct = ratesOn(p, "2026-10-04", 312);
  ok(near(july.heads.taxes, (4 * 31200) / 312) && !july.heads.insurance && near(july.standing, 400), "a day in July: the four quarters up to it, not the insurance bought after it", JSON.stringify(july.heads));
  ok(near(oct.heads.taxes, 400) && near(oct.heads.insurance, 200) && near(oct.standing, 600), "a day in October: the year up to it, insurance in");
  ok(near(ratesOn(p, "2026-10-05", 312).heads.taxes, 400) && near(ratesOn(p, "2026-06-30", 312).heads.taxes, 400), "each day four quarters, never five or three");
  ok(ratesOn(null, "2026-10-04", 312).standing === 0 && ratesOn({ lines: [{ type: "taxes", amount: 31200, period: "year" }] }, "2026-10-04", 312).standing === 100,
    "no profile: nothing; a profile kept before its lines were (no history): its lines as they are");
}

console.log(`dailyCost tests: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
