/* ============================================================================
 * import_rotation_plans.mjs — take the transport manager's nine finalised Rotational
 * plans and file them where the dashboard can pick the right one for the week.
 *
 * WHY nine plans, and why GROUP x CLOCK rather than one plan per service:
 *
 * Rotational runs three round-the-clock slots — Day (gate 06:00), Half night (14:00) and
 * Full night (22:00) — and every Monday each rider steps one place along
 *     Day -> Full night -> Half night -> Day.
 * The PEOPLE move as three fixed blocks; only the clock they run at changes. A plan is a
 * set of stops in an order, and the stops belong to the people, so a group's plan does not
 * change when its clock does — only the hour, and therefore which buses are free to run it.
 * The manager therefore planned each of the three groups at each of the three clocks: nine
 * plans, built once, and each Monday becomes a lookup instead of a re-plan.
 *
 * The deliveries are named "<N> <SHIFT> PLAN <ddmm>.json". The leading number N is NOT a
 * batch or a version — it is the ERP slot code of that rider group in the anchor rota week
 * (the week the roster in src/rotationalRoster.json was cut for): the riders on
 *     1 = Day, 2 = Half night, 3 = Full night
 * in the anchor week are group 1, 2, 3. The shift word is the CLOCK that file is planned at
 * (DAY / DAY SHIFT / DAY NEW -> day; HALF NIGHT or OFF NIGHT -> half; FULL NIGHT -> full).
 * So "2 OFF NIGHT" is the anchor week's Half-night riders, planned as they will run on Half
 * night — and "2 DAY SHIFT" is the SAME people, planned for the week the cycle puts them on
 * Day.
 *
 * Output:
 *   <out>/g{N}-{clock}.json  — the manager's body untouched, plus three provenance keys
 *                              (service = the clock, costing = how the numbers were made,
 *                              source = which delivery this is and which group it holds)
 *   src/rotation.json        — the manifest: cycle, anchor week, and which file each group
 *                              runs at each clock. src/optimiser/rotation.js turns a calendar
 *                              week into "group G is on slot S" and reads the file from here.
 *
 * The script REFUSES to write unless all nine group x clock combinations are present
 * exactly once — a partial set would leave one slot showing a stale plan some weeks and
 * nothing would flag it. It is idempotent: the same inputs and arguments produce the same
 * bytes, and files that already match are left alone.
 *
 * Usage:
 *   node scripts/import_rotation_plans.mjs --from _incoming/rotationalshiftdata \
 *        --received 2026-09-03 --anchor 2026-08-31 [--out public/plans/rot] [--dry-run]
 * ==========================================================================*/
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { SERVICES, ROTATION_SLOTS } from "../src/optimiser/services.js";

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const argv = process.argv.slice(2);
const arg = (k, d = null) => { const i = argv.indexOf(k); return i > -1 && argv[i + 1] ? argv[i + 1] : d; };
const flag = (k) => argv.includes(k);

const FROM = arg("--from");
const RECEIVED = arg("--received");
const ANCHOR = arg("--anchor");
const OUT = arg("--out", "public/plans/rot");
const MANIFEST = arg("--manifest", "src/rotation.json");
const DRY = flag("--dry-run");

const usage = () => {
  console.error("usage: node scripts/import_rotation_plans.mjs --from <dir> --received YYYY-MM-DD --anchor YYYY-MM-DD [--out public/plans/rot] [--dry-run]");
  process.exit(2);
};
if (!FROM || !RECEIVED || !ANCHOR) usage();

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const isoDate = (s) => (ISO.test(s) && !Number.isNaN(Date.parse(s + "T00:00:00Z")) ? s : null);
if (!isoDate(RECEIVED)) { console.error(`--received must be YYYY-MM-DD, got ${RECEIVED}`); process.exit(2); }
if (!isoDate(ANCHOR)) { console.error(`--anchor must be YYYY-MM-DD, got ${ANCHOR}`); process.exit(2); }
/* The anchor is a rota WEEK, and weeks start on Monday. A Thursday here would make every
   downstream weeksBetween() land on the wrong step, silently. */
if (new Date(ANCHOR + "T00:00:00Z").getUTCDay() !== 1) { console.error(`--anchor ${ANCHOR} is not a Monday`); process.exit(2); }

/* User paths are relative to where the command was run; defaults are relative to the repo,
   so the script does the right thing from any cwd. */
const resolveUser = (p) => path.resolve(process.cwd(), p);
const resolveDefault = (p) => path.resolve(REPO, p);
const fromDir = resolveUser(FROM);
const outDir = arg("--out") ? resolveUser(OUT) : resolveDefault(OUT);
const manifestPath = arg("--manifest") ? resolveUser(MANIFEST) : resolveDefault(MANIFEST);
const publicDir = resolveDefault("public");

/* The manifest holds URLs the browser fetches, so the output must live under public/. */
const relToPublic = path.relative(publicDir, outDir);
if (relToPublic.startsWith("..") || path.isAbsolute(relToPublic)) {
  console.error(`--out must be inside ${publicDir} (the manifest stores browser URLs); got ${outDir}`);
  process.exit(2);
}
const urlPrefix = "/" + relToPublic.split(path.sep).join("/");

/* ---- The cycle, and what the batch number means -------------------------------------
 * cycle[i] -> cycle[(i+1) % 3] every Monday: Day -> Full night -> Half night -> Day.
 * A group's slot at the anchor is the ERP slot code it was delivered under. */
const CYCLE = ["day", "full", "half"];
const SLOT_OF_GROUP = { 1: "day", 2: "half", 3: "full" };   // ERP Pun_Shift code 1/2/3
const CLOCKS = ["day", "half", "full"];
const CLOCK_WORD = { DAY: "day", HALF: "half", OFF: "half", FULL: "full" };

/* The service each clock is planned at — id and display name come from services.js so the
   file says exactly what the dashboard calls that slot. */
const svcOfClock = Object.fromEntries(CLOCKS.map((c) => {
  const s = SERVICES.find((x) => x.slot === c);
  if (!s) { console.error(`services.js has no service with slot "${c}"`); process.exit(1); }
  return [c, { id: s.id, name: s.name }];
}));
const slotName = (c) => (ROTATION_SLOTS.find((s) => s.id === c) || { name: c }).name;

/* ---- Filename -> (group, clock) ------------------------------------------------------
 * "1 DAY NEW PLAN  0209.json" (yes, two spaces), "2 OFF NIGHT PLAN 0209.json", ...
 * Leading integer = group; exactly one clock word must appear. Anything else is refused
 * rather than guessed — a mis-filed plan is worse than a missing one. */
function parseName(file) {
  const base = path.basename(file, path.extname(file));
  const tokens = base.trim().split(/\s+/);
  const group = /^\d+$/.test(tokens[0]) ? Number(tokens[0]) : null;
  const clocks = [...new Set(tokens.slice(1).map((t) => CLOCK_WORD[t.toUpperCase()]).filter(Boolean))];
  const problems = [];
  if (group == null) problems.push("no leading group number");
  else if (!SLOT_OF_GROUP[group]) problems.push(`group ${group} is not 1, 2 or 3`);
  if (clocks.length === 0) problems.push("no clock word (DAY / HALF / OFF / FULL)");
  if (clocks.length > 1) problems.push(`ambiguous clock words: ${clocks.join(", ")}`);
  return { file, base, group, clock: clocks.length === 1 ? clocks[0] : null, problems };
}

/* ---- Body validation -------------------------------------------------------------------
 * Only what every consumer dereferences unguarded. The Fleet-plan board, Timings clock,
 * cost model and track-implementation view all walk routes[].seq[] and read name/lat/lng/hc
 * as numbers; a bad one throws deep inside a render, not here. */
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
function validateBody(body, label) {
  const errs = [];
  const warns = [];
  if (!body || typeof body !== "object" || Array.isArray(body)) return { errs: ["not a JSON object"], warns };
  if (!Array.isArray(body.routes) || body.routes.length === 0) errs.push("routes[] missing or empty");
  else body.routes.forEach((r, i) => {
    const at = `routes[${i}]`;
    if (!r || typeof r !== "object") { errs.push(`${at}: not an object`); return; }
    if (typeof r.name !== "string" || !r.name.trim()) errs.push(`${at}: missing name`);
    if (!Array.isArray(r.seq) || r.seq.length === 0) { errs.push(`${at} (${r.name}): seq[] missing or empty`); return; }
    r.seq.forEach((s, j) => {
      const sat = `${at} (${r.name}).seq[${j}]`;
      if (!s || typeof s !== "object") { errs.push(`${sat}: not an object`); return; }
      if (typeof s.name !== "string" || !s.name.trim()) errs.push(`${sat}: missing name`);
      if (!isNum(s.lat)) errs.push(`${sat}: lat is not a number`);
      if (!isNum(s.lng)) errs.push(`${sat}: lng is not a number`);
      if (!isNum(s.hc)) errs.push(`${sat}: hc is not a number`);
    });
  });
  /* Not fatal, but the dashboard reads these unguarded (Dashboard planSummary, the KPI
     tiles), so a file without them will be noticed the hard way. */
  for (const k of ["params", "overall", "owned", "rental"]) if (!body[k] || typeof body[k] !== "object") warns.push(`${label}: no "${k}" block`);
  return { errs, warns };
}

/* ---- Read the delivery -------------------------------------------------------------- */
if (!fs.existsSync(fromDir) || !fs.statSync(fromDir).isDirectory()) { console.error(`--from ${fromDir} is not a directory`); process.exit(2); }
const files = fs.readdirSync(fromDir).filter((f) => f.toLowerCase().endsWith(".json")).sort();
if (!files.length) { console.error(`no *.json in ${fromDir}`); process.exit(1); }

let bad = 0;
const parsed = files.map((f) => parseName(f));
for (const p of parsed) if (p.problems.length) { bad++; console.error(`  ✗ ${p.file}: ${p.problems.join("; ")}`); }

/* Every group x clock exactly once. */
const byKey = new Map();
for (const p of parsed) {
  if (p.problems.length) continue;
  const key = `${p.group}-${p.clock}`;
  if (byKey.has(key)) { bad++; console.error(`  ✗ group ${p.group} at ${p.clock} appears twice: "${byKey.get(key).file}" and "${p.file}"`); }
  else byKey.set(key, p);
}
const missing = [];
for (const g of [1, 2, 3]) for (const c of CLOCKS) if (!byKey.has(`${g}-${c}`)) missing.push(`group ${g} at ${c}`);
if (missing.length) { bad++; console.error(`  ✗ missing: ${missing.join(", ")}`); }
if (bad) { console.error(`\nrefusing to write: ${fromDir} must hold all 9 group x clock plans exactly once.`); process.exit(1); }

/* Bodies. */
const entries = [];
const hashes = new Map();
for (const g of [1, 2, 3]) for (const c of CLOCKS) {
  const p = byKey.get(`${g}-${c}`);
  const raw = fs.readFileSync(path.join(fromDir, p.file));
  let body;
  try { body = JSON.parse(raw.toString("utf8")); } catch (e) { bad++; console.error(`  ✗ ${p.file}: ${e.message}`); continue; }
  const { errs, warns } = validateBody(body, p.file);
  if (errs.length) { bad++; console.error(`  ✗ ${p.file}:\n      ${errs.slice(0, 12).join("\n      ")}${errs.length > 12 ? `\n      … ${errs.length - 12} more` : ""}`); }
  for (const w of warns) console.error(`  ! ${w}`);
  const md5 = crypto.createHash("md5").update(raw).digest("hex");
  /* Two clocks of one group sharing a byte-identical body is possible (same stops, same
     buses) but is more often a mis-saved export — say so, do not decide. */
  if (hashes.has(md5)) console.error(`  ! "${p.file}" is byte-identical to "${hashes.get(md5)}" — confirm with the transport manager that this is intended`);
  else hashes.set(md5, p.file);
  entries.push({ ...p, body, md5 });
}
if (bad) { console.error(`\nrefusing to write: fix the files above.`); process.exit(1); }

/* ---- Build outputs --------------------------------------------------------------------
 * The manager's keys stay first and untouched; the three added keys are appended so a diff
 * against the delivery is just the tail of the file. */
const outFile = (g, c) => `g${g}-${c}.json`;
const outputs = entries.map((e) => {
  const svc = svcOfClock[e.clock];
  const doc = {
    ...e.body,
    service: { id: svc.id, name: svc.name },
    costing: {
      basis: "full",
      standing: true,
      note: "manager-finalised in the Planner: driver + maintenance standing (no loan), diesel at Rs100/L over each bus's own ERP mileage",
    },
    source: {
      group: String(e.group),
      clock: e.clock,
      file: e.file,
      received: RECEIVED,
      anchorWeek: ANCHOR,
      note: "one of 9 manager-finalised plans: 3 rider groups x 3 clocks; which group runs which clock is decided by src/rotation.json",
    },
  };
  const routes = e.body.routes;
  return {
    ...e,
    out: path.join(outDir, outFile(e.group, e.clock)),
    url: `${urlPrefix}/${outFile(e.group, e.clock)}`,
    text: JSON.stringify(doc, null, 2) + "\n",
    routes: routes.length,
    riders: routes.reduce((n, r) => n + (+r.riders || 0), 0),
    seats: routes.reduce((n, r) => n + (+r.cap || 0), 0),
    totalRiders: e.body.params && e.body.params.totalRiders,
  };
});

const manifest = {
  _comment: "Which rider group runs which Rotational clock, by calendar week. cycle[i] -> cycle[(i+1)%3] every Monday. "
    + "Group N = the ERP slot code (Pun_Shift 1 = Day, 2 = Half night, 3 = Full night) of that group in anchorWeek — "
    + "that is what the leading number on the manager's '<N> <SHIFT> PLAN' files means, and it is why atAnchor is 1 -> day, 2 -> half, 3 -> full. "
    + "Built by scripts/import_rotation_plans.mjs; do not hand-edit.",
  cycle: CYCLE,
  anchorWeek: ANCHOR,
  received: RECEIVED,
  groups: Object.fromEntries([1, 2, 3].map((g) => [String(g), {
    label: `Group ${g}`,
    atAnchor: SLOT_OF_GROUP[g],
    plans: Object.fromEntries(CLOCKS.map((c) => [c, `${urlPrefix}/${outFile(g, c)}`])),
  }])),
};
const manifestText = JSON.stringify(manifest, null, 2) + "\n";

/* ---- Report ---------------------------------------------------------------------------- */
const pad = (s, n, right) => (right ? String(s).padStart(n) : String(s).padEnd(n));
const wFile = Math.max(...outputs.map((o) => o.file.length), 4);
console.log(`${DRY ? "[dry-run] " : ""}${fromDir} -> ${outDir}  (received ${RECEIVED}, anchor week ${ANCHOR})\n`);
console.log(`  ${pad("file", wFile)}  grp  clock       routes  riders  seats  roster  -> ${path.relative(REPO, outDir)}/`);
for (const o of outputs) {
  console.log(`  ${pad(o.file, wFile)}   ${o.group}   ${pad(slotName(o.clock), 10)}  ${pad(o.routes, 6, true)}  ${pad(o.riders, 6, true)}  ${pad(o.seats, 5, true)}  ${pad(o.totalRiders ?? "-", 6, true)}  -> ${path.basename(o.out)}`);
}
console.log("");
for (const g of [1, 2, 3]) console.log(`  Group ${g}: on ${slotName(SLOT_OF_GROUP[g])} in the week of ${ANCHOR}`);

/* ---- Write (idempotent: identical bytes are not rewritten) ------------------------------ */
const same = (p, text) => fs.existsSync(p) && fs.readFileSync(p, "utf8") === text;
const put = (p, text) => {
  if (same(p, text)) { console.log(`  unchanged ${path.relative(REPO, p)}`); return; }
  if (DRY) { console.log(`  would write ${path.relative(REPO, p)}`); return; }
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text);
  console.log(`  wrote ${path.relative(REPO, p)}`);
};
console.log("");
for (const o of outputs) put(o.out, o.text);
put(manifestPath, manifestText);

/* Anything else in the output dir is a leftover from an earlier naming and would be served
   as a real plan. Flag, never delete. */
if (fs.existsSync(outDir)) {
  const expected = new Set(outputs.map((o) => path.basename(o.out)));
  const strays = fs.readdirSync(outDir).filter((f) => !expected.has(f));
  if (strays.length) console.error(`\n  ! ${outDir} also holds: ${strays.join(", ")} — not written by this run`);
}
if (DRY) console.log("\n--dry-run: nothing written");
