/* layover tests — run with:  node src/optimiser/layover.test.js
 *
 * The ones that matter are the arithmetic identities, because the whole feature is one
 * subtraction and everything else is presentation:
 *
 *   1. parking where the next run starts saves exactly the round trip to the depot;
 *   2. parking AT the depot saves nothing — that is the baseline, and it must come out
 *      as zero or every saving downstream is measured against a moving target;
 *   3. a night shift crossing midnight links to the morning, and does not read as an
 *      18-hour overlap.
 *
 * (3) is the one that broke first: minutes-from-midnight sorts 06:00 before 22:00, so a
 * full-night run looked like it started after it ended.
 */
import {
  matrixContext, combineMatrices, runsFromPlan, linkRuns, bestPark,
  routeWithPark, parkCatalogue, resolvePark, gapMin, LAYOVER_DEFAULTS,
} from "./layover.js";

let pass = 0, fail = 0;
const ok = (cond, label, detail = "") => {
  if (cond) pass++;
  else { fail++; console.log(`  FAIL: ${label}${detail ? " — " + detail : ""}`); }
};
const near = (a, b, eps = 0.05) => Math.abs(a - b) < eps;

/* A toy corridor: the depot, a village 40 km out, and a lay-by 1 km short of it.
   Road km are declared, not derived, so every expectation below is exact. */
const DEPOT = { name: "FACTORY", lat: 10.2, lng: 77.8 };
const VILLAGE = { name: "Dindigul", lat: 10.36, lng: 77.98 };
const LAYBY = { name: "Dindigul bypass", lat: 10.355, lng: 77.975 };
const NEARSTOP = { name: "Batlagundu town", lat: 10.21, lng: 77.81 };

const NODES = [DEPOT, NEARSTOP, LAYBY, VILLAGE];
const KM = [
  //        depot  near  layby  village
  /*depot*/ [0, 2, 39, 40],
  /*near */ [2, 0, 38, 39],
  /*layby*/ [39, 38, 0, 1],
  /*villg*/ [40, 39, 1, 0],
];
const MIN = KM.map((row) => row.map((k) => k * 2));
const MATRIX = { nodes: NODES, km: KM, min: MIN };
const ctx = matrixContext(MATRIX, { maxParkKm: 8 });

/* Both shifts run the same two stops: near first, far last — the closest-first order the
   engine produces. Day releases at 14:00; Full night gates at 22:00. */
const route = (name, cap = 40, riders = 20) => ({
  name, type: "own", cap, riders, km: 82, ride: 50, stops: 2,
  seq: [{ ...NEARSTOP, hc: 5 }, { ...VILLAGE, hc: 15 }],
});
const DAY = { id: "rot-day", name: "Day", color: "#0d9488", gate: 6 * 60, off: 14 * 60 };
const FULL = { id: "rot-full", name: "Full night", color: "#4338ca", gate: 22 * 60, off: 6 * 60 };

/* ---- run construction ---- */
{
  const runs = runsFromPlan({ routes: [route("BUS1")] }, DAY, ctx, { depot: DEPOT });
  ok(runs.length === 2, "one route yields a pickup AND a drop", `got ${runs.length}`);
  const pick = runs.find((r) => r.dir === "pickup");
  const drop = runs.find((r) => r.dir === "drop");
  ok(pick.end === 6 * 60, "pickup lands on the gate", String(pick.end));
  ok(pick.start === 6 * 60 - 50, "pickup starts a ride before the gate", String(pick.start));
  ok(pick.from.name === "Dindigul", "pickup starts at the FAR end", pick.from.name);
  ok(drop.start === 14 * 60, "drop leaves at the release time", String(drop.start));
  ok(drop.end === 14 * 60 + 50, "drop ends a ride later", String(drop.end));
  ok(drop.to.name === "Dindigul", "drop ends at the FAR end", drop.to.name);
  ok(!pick.assumedOff, "a service with a stated `off` is not flagged assumed");

  /* THE REGRESSION THAT MATTERED. A pickup delivers people to work, so it ENDS AT THE
     FACTORY — not at `seq[0]`, the stop nearest the factory. Ending it at the nearest stop
     made every bus look stranded in a village all day and "saved" 150 km per bus by parking
     it where it never was. If these four flip, the headline saving is fiction again. */
  ok(pick.to.name === "FACTORY", "a pickup ENDS at the depot — it is delivering people to work", pick.to.name);
  ok(drop.from.name === "FACTORY", "a drop STARTS at the depot", drop.from.name);
  ok(pick.from.name === drop.to.name, "the far end is the only end ever away from the factory");

  const noOff = runsFromPlan({ routes: [route("BUS1")] }, { ...DAY, off: null }, ctx, { depot: DEPOT });
  ok(noOff.every((r) => r.assumedOff), "a service with no `off` flags every run assumed");
  ok(noOff.find((r) => r.dir === "drop").start === 6 * 60 + LAYOVER_DEFAULTS.shiftMin,
     "assumed release = gate + the assumed shift");
}

/* ---- the identity: park where you restart, save the round trip ---- */
{
  const runs = [
    ...runsFromPlan({ routes: [route("BUS1")] }, DAY, ctx, { depot: DEPOT }),
    ...runsFromPlan({ routes: [route("BUS1")] }, FULL, ctx, { depot: DEPOT }),
  ];
  const res = linkRuns(runs, ctx, DEPOT, { maxParkKm: 8, minSaveKm: 1 });

  /* Only drop→pickup can save anything. A pickup hands its riders over at the factory and
     the next drop leaves from the factory, so the bus is already exactly where the baseline
     says it is — the saving must be 0, not 150 km. */
  const pickThenDrop = res.links.filter((l) => l.a.dir === "pickup");
  ok(pickThenDrop.length > 0, "there IS a pickup-then-drop pair to check", String(pickThenDrop.length));
  ok(pickThenDrop.every((l) => near(l.saveKm, 0) && l.kind === "at-depot" && !l.worth),
     "a pickup followed by a drop saves nothing — the bus never left the factory",
     pickThenDrop.map((l) => `${l.a.label}->${l.b.label} ${l.saveKm}km ${l.kind}`).join(" | "));

  /* Classification. Day drop 14:50 → Full-night pickup 21:10 never touches 02:00, so it is a
     between-shifts wait. Full-night drop 06:50 → Day pickup 05:10 the next morning does. */
  const day2fullKind = res.links.find((l) => l.a.svcId === "rot-day" && l.a.dir === "drop");
  ok(day2fullKind && day2fullKind.kind === "between-shifts",
     "an afternoon-to-evening wait is between-shifts, not overnight", day2fullKind && day2fullKind.kind);
  /* A shift that releases at 23:00 strands the bus in the village at 23:50 and does not want
     it again until 05:10 — five hours of that is the middle of the night, so it is a stand-out,
     not a wait. Same arithmetic, different thing to ask a driver to do. */
  const LATE = { id: "late", name: "Late", color: "#888", gate: 6 * 60, off: 23 * 60 };
  const lateRes = linkRuns(runsFromPlan({ routes: [route("BUS9")] }, LATE, ctx, { depot: DEPOT }),
                           ctx, DEPOT, { maxParkKm: 8, minSaveKm: 1 });
  const overnight = lateRes.links.find((l) => l.kind === "overnight");
  ok(!!overnight, "a layover spanning 02:00 is classed overnight",
     lateRes.links.map((l) => `${l.a.label}->${l.b.label}:${l.kind}`).join(" | "));
  ok(overnight && near(overnight.saveKm, 80), "and is still worth the whole round trip",
     overnight && String(overnight.saveKm));

  const day2full = res.links.find((l) => l.a.svcId === "rot-day" && l.a.dir === "drop" && l.b.svcId === "rot-full");
  ok(!!day2full, "the Day drop links to the Full-night pickup");
  if (day2full) {
    ok(day2full.park.name === "Dindigul", "it parks in the village both runs touch", day2full.park.name);
    ok(near(day2full.parkKm, 0), "the empty running becomes zero", String(day2full.parkKm));
    ok(near(day2full.baseKm, 80), "the baseline is out and back — 40 + 40", String(day2full.baseKm));
    ok(near(day2full.saveKm, 80), "so the saving is the whole round trip", String(day2full.saveKm));
    ok(day2full.saveRs === Math.round(80 * LAYOVER_DEFAULTS.dieselPerKm), "valued at diesel only", String(day2full.saveRs));
    ok(day2full.crossService, "and it is flagged as joining two services");
    // Day drop ends 14:50, Full-night pickup starts 21:10
    ok(day2full.gap === 21 * 60 + 10 - (14 * 60 + 50), "the layover is the real gap", String(day2full.gap));
  }
}

/* ---- the baseline must be zero ----
   The audit for the whole feature: pin every pair to the depot and the saving must come
   out at exactly 0. If it does not, the "80 km saved" above is measured against something
   other than what the plans actually do today. */
{
  const runs = [
    ...runsFromPlan({ routes: [route("BUS1")] }, DAY, ctx, { depot: DEPOT }),
    ...runsFromPlan({ routes: [route("BUS1")] }, FULL, ctx, { depot: DEPOT }),
  ];
  const res = linkRuns(runs, ctx, DEPOT, { minSaveKm: 0, parkOf: () => ({ kind: "depot" }) });
  ok(res.links.length > 0, "pinning to the depot still produces the links", String(res.links.length));
  ok(res.links.every((l) => near(l.saveKm, 0)), "…each worth exactly nothing — that IS the baseline",
     res.links.map((l) => l.saveKm).join(","));
  ok(res.links.every((l) => !l.worth), "…so none of them is offered as a saving");
  const away = res.links.filter((l) => !l.atDepot);
  ok(away.length > 0 && away.every((l) => l.chosen),
     "a bus that IS away from the factory records the choice that kept it at the depot",
     `${away.length} away`);
  ok(res.links.filter((l) => l.atDepot).every((l) => l.kind === "at-depot" && near(l.saveKm, 0)),
     "a bus that never left is classed at-depot and never consulted the park choice");

  // and a pinned park that is NOT the depot is honoured even when a better one exists
  const laybyOnly = linkRuns(runs, ctx, DEPOT, {
    minSaveKm: 0, parkOf: () => ({ kind: "node", name: "Dindigul bypass" }),
  });
  const l = laybyOnly.links.find((x) => x.a.dir === "drop" && x.b.svcId === "rot-full");
  ok(l && l.park.name === "Dindigul bypass", "a chosen park overrides the cheapest one", l && l.park.name);
  ok(l && near(l.saveKm, 80 - 2), "…and is costed at ITS distance — 1 km in, 1 km out", l && String(l.saveKm));
}

/* ---- midnight ---- */
{
  ok(gapMin(23 * 60, 1 * 60) === 120, "gap wraps across midnight", String(gapMin(23 * 60, 1 * 60)));
  ok(gapMin(1 * 60, 23 * 60) === 22 * 60, "and is directional");

  // Full night only: pickup 21:10→22:00, drop 06:00→06:50. The bus waits 8 h at the factory
  // end overnight and 14 h+ the other way — the point is that neither reads as an overlap.
  const runs = runsFromPlan({ routes: [route("BUS1")] }, FULL, ctx, { depot: DEPOT });
  const res = linkRuns(runs, ctx, DEPOT, { maxParkKm: 8, minSaveKm: 0, maxLayoverMin: 20 * 60 });
  ok(res.clashes.length === 0, "a shift crossing midnight is not a collision",
     res.clashes.map((c) => `${c.reason} ${c.gap}`).join(","));
  ok(res.links.every((l) => l.gap >= 0), "every gap is forward in time");
}

/* ---- a real collision is still caught ---- */
{
  const a = { id: "a", name: "A", gate: 9 * 60, off: 17 * 60, color: "#000" };
  const b = { id: "b", name: "B", gate: 9 * 60 + 20, off: 17 * 60, color: "#111" };
  const runs = [
    ...runsFromPlan({ routes: [route("BUS1")] }, a, ctx, { depot: DEPOT }),
    ...runsFromPlan({ routes: [route("BUS1")] }, b, ctx, { depot: DEPOT }),
  ];
  const res = linkRuns(runs, ctx, DEPOT, { maxParkKm: 8, minSaveKm: 0 });
  ok(res.clashes.some((c) => c.reason === "overlap"),
     "two pickups 20 min apart on one bus overlap", JSON.stringify(res.clashes.map((c) => c.reason)));
}

/* ---- turnaround floor ---- */
{
  const a = { id: "a", name: "A", gate: 6 * 60, off: 14 * 60, color: "#000" };
  const b = { id: "b", name: "B", gate: 15 * 60, off: 23 * 60, color: "#111" };
  // A drop ends 14:50; B pickup starts 14:10 -> that overlaps. Use a later gate for the floor test.
  const c = { id: "c", name: "C", gate: 16 * 60, off: 23 * 60, color: "#111" };
  const tight = linkRuns([
    ...runsFromPlan({ routes: [route("BUS1")] }, a, ctx, { depot: DEPOT }),
    ...runsFromPlan({ routes: [route("BUS1")] }, c, ctx, { depot: DEPOT }),
  ], ctx, DEPOT, { maxParkKm: 8, minSaveKm: 0, minTurnMin: 45 });
  // A drop 14:00→14:50, C pickup 15:10→16:00 = 20 min gap, under the 45 min floor
  ok(tight.clashes.some((x) => x.reason === "turnaround"),
     "a 20-minute turnaround is reported as unmakeable, not as a saving",
     JSON.stringify(tight.clashes.map((x) => `${x.reason}:${x.gap}`)));
  ok(!tight.links.some((l) => l.a.svcId === "a" && l.a.dir === "drop" && l.b.svcId === "c" && l.b.dir === "pickup"),
     "and it produces no link");
  void b;
}

/* ---- bestPark prefers the endpoint, and respects the radius ---- */
{
  const bp = bestPark({ ...VILLAGE, _idx: 3 }, { ...VILLAGE, _idx: 3 }, ctx, { maxParkKm: 8 });
  ok(bp && near(bp.deadKm, 0), "same endpoint both sides -> park there, zero empty km", bp && String(bp.deadKm));

  const far = bestPark({ ...VILLAGE, _idx: 3 }, { ...NEARSTOP, _idx: 1 }, ctx, { maxParkKm: 2 });
  ok(far === null || far.deadKm >= 0, "a radius that excludes everything does not invent a point");
}

/* ---- routeWithPark: the loop vs the parked run ---- */
{
  const r = route("BUS1");
  const parked = routeWithPark(r, VILLAGE, ctx, DEPOT, {});
  ok(near(parked.loopKm, 2 + 39 + 40), "loop = depot->near->far->depot", String(parked.loopKm));
  ok(near(parked.parkKm, 2 + 39 + 0), "parked = the same run without the leg home", String(parked.parkKm));
  ok(near(parked.saveKm, 40), "so it saves the one empty leg", String(parked.saveKm));

  const atDepot = routeWithPark(r, DEPOT, ctx, DEPOT, {});
  ok(near(atDepot.saveKm, 0), "parking at the depot IS the baseline — zero", String(atDepot.saveKm));
}

/* ---- catalogue + resolver ---- */
{
  const cat = parkCatalogue(ctx, { depot: DEPOT });
  ok(cat.length === NODES.length, "every matrix node is a candidate park point", String(cat.length));
  ok(cat.every((c) => c.name && c.name.trim()), "no candidate is unnamed");
  ok(cat.some((c) => c.depotKm === 0), "the depot's own distance is 0");

  ok(resolvePark({ kind: "depot" }, ctx, DEPOT).name === "FACTORY", "depot resolves");
  const n = resolvePark({ kind: "node", name: "Dindigul" }, ctx, DEPOT);
  ok(n && n._idx === 3, "a node resolves by name to its matrix index", n && String(n._idx));
  ok(resolvePark({ kind: "auto" }, ctx, DEPOT) === null, "auto is deferred to the linker");

  // a name that is pure '?' is mojibake, not a place
  const junk = matrixContext({ nodes: [{ name: "?????", lat: 10, lng: 77 }], km: [[0]], min: [[0]] });
  ok(!parkCatalogue(junk)[0].name.includes("?"), "a lost non-Latin name falls back to coordinates",
     parkCatalogue(junk)[0].name);
}

/* ---- combineMatrices refuses to cross ---- */
{
  const B = { nodes: [{ name: "Far away", lat: 9.6, lng: 77.8 }], km: [[0]], min: [[0]] };
  const cc = combineMatrices([MATRIX, B]);
  ok(cc.nodes.length === NODES.length + 1, "both matrices' nodes are candidates", String(cc.nodes.length));
  ok(near(cc.metric.km(0, 3), 40), "within one matrix the real distance survives", String(cc.metric.km(0, 3)));
  ok(!isFinite(cc.metric.km(0, 4)), "across matrices it returns NaN rather than a made-up number");
}

/* ---- the browser re-linker must agree with the offline build ----
   Two independent code paths reach the same number: build_bus_connections.mjs walks the real
   18 MB matrix, relinkFromFile() walks the small table that build ships. If they disagree the
   board is quietly contradicting the file it loaded, so this is run against the real artefact
   when one exists rather than against a fixture. */
{
  const fs = await import("node:fs");
  const path = "public/bus_connections.json";
  if (!fs.existsSync(path)) {
    console.log("  (skipped: public/bus_connections.json not built — run node build_bus_connections.mjs)");
  } else {
    const { relinkFromFile, recostLinks } = await import("./layover.js");
    const d = JSON.parse(fs.readFileSync(path, "utf8"));

    const same = relinkFromFile(d, { services: d.services });
    const dk = Math.abs(same.totals.saveKm - d.totals.saveKm);
    ok(same.totals.links === d.totals.links,
       "re-linking on the SAME clock finds the same number of links",
       `browser ${same.totals.links} vs build ${d.totals.links}`);
    ok(dk < 1, "…and the same kilometres", `browser ${same.totals.saveKm} vs build ${d.totals.saveKm} (Δ${dk.toFixed(2)})`);

    const home = relinkFromFile(d, { services: d.services, parkOf: () => ({ kind: "depot" }) });
    ok(home.totals.links === 0 && home.totals.saveKm === 0,
       "pinning every service to the depot zeroes the whole fleet's saving",
       `${home.totals.links} links / ${home.totals.saveKm} km`);

    /* Moving a release time must change the PAIRING, not just the prices — that is the whole
       reason relinkFromFile exists alongside recostLinks. */
    const shifted = relinkFromFile(d, {
      services: d.services.map((s) => (s.id === "s9" ? { ...s, off: (s.off + 240) % 1440, offAssumed: false } : s)),
    });
    ok(shifted.totals.links !== same.totals.links || Math.abs(shifted.totals.saveKm - same.totals.saveKm) > 1,
       "pushing 9 am General's release four hours later changes the result",
       `${same.totals.links} links/${same.totals.saveKm} km → ${shifted.totals.links}/${shifted.totals.saveKm}`);

    const rec = recostLinks(d, { parkOf: () => ({ kind: "auto" }) });
    ok(Math.abs(rec.totals.saveKm - d.totals.saveKm) < 1,
       "re-pricing without re-linking also reproduces the build",
       `${rec.totals.saveKm} vs ${d.totals.saveKm}`);
  }
}

/* ---- scorePlan honours an explicit start / park ----
   The Planner lets a bus be given its own two ends, and km, ride time and cost all move with
   them. The invariant that matters is the FIRST one: leaving the ends alone must reproduce the
   old number to the last decimal, or every plan in the repo silently re-costs the day this
   feature shipped. */
{
  const { scorePlan } = await import("./engine.js");
  const dep = { name: "F", lat: 10.2, lng: 77.8 };
  const chain = [
    { id: "a", name: "near", lat: 10.21, lng: 77.81, headcount: 5, absentee: 0 },
    { id: "b", name: "mid", lat: 10.28, lng: 77.90, headcount: 8, absentee: 0 },
    { id: "c", name: "far", lat: 10.36, lng: 77.98, headcount: 7, absentee: 0 },
  ];
  const bus = [{ id: "b1", name: "BUS1", type: "own", capacity: 40, loanMonth: 35000, driverDay: 800, maintDay: 280, dieselPerKm: 22 }];
  const run = (extra) => scorePlan([{ busId: "b1", stops: chain, ...extra }], bus, dep, { chain: true }).plan.routes[0];

  const base = run({});
  const explicit = run({ start: dep, park: chain[2] });
  ok(Math.abs(explicit.km - base.km) < 1e-9 && Math.abs(explicit.cost - base.cost) < 1e-9,
     "naming the DEFAULT ends changes nothing — depot and last stop reproduce the old numbers",
     `${base.km}/${base.cost} vs ${explicit.km}/${explicit.cost}`);
  ok(!base.moved && explicit.moved, "…but the route records that ends were given explicitly");

  const beyond = { name: "beyond", lat: 10.45, lng: 78.10 };
  const parked = run({ park: beyond });
  ok(parked.km > base.km && parked.cost > base.cost,
     "parking past the last stop adds kilometres and cost", `${base.km}km -> ${parked.km}km`);
  ok(Math.abs(parked.toLastMin - base.toLastMin) < 1e-9,
     "…and does NOT change the ride, which ends at the last rider, not at the park",
     `${base.toLastMin} -> ${parked.toLastMin}`);

  const started = run({ start: beyond });
  ok(started.toLastMin > base.toLastMin,
     "starting further out makes the run take longer", `${base.toLastMin}min -> ${started.toLastMin}min`);
  ok(started.km > base.km, "…and cost more ground", `${base.km}km -> ${started.km}km`);
}

console.log(`\nlayover: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
