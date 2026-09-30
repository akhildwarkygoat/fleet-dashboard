/* finalisedPlans tests — run with:  node src/optimiser/finalisedPlans.test.js
 *
 * Which plan a service runs when nothing was finalised in this browser: the built-in plan
 * shipped in src/finalisedDefaults.json for the fixed-hour services, this week's group plan
 * for the Rotational slots, and the optimised file only for a service the manifest does not
 * name. A choice finalised here still wins, and clearing it returns to the built-in plan. */
import fs from "node:fs";
import { SERVICES } from "./services.js";
import { resolveFinalised, baselineFor, builtInFor, planSourceFor, setFinalised, clearFinalised } from "./finalisedPlans.js";
import BUILT_IN from "../finalisedDefaults.json" with { type: "json" };

// the module persists choices in localStorage; give Node a small in-memory one
const mem = new Map();
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };

let pass = 0, fail = 0;
const ok = (cond, label, detail = "") => {
  if (cond) { pass++; } else { fail++; console.log(`  FAIL: ${label}${detail ? " — " + detail : ""}`); }
};
const svc = (id) => SERVICES.find((s) => s.id === id);

/* ---- the manifest names real files, and only fixed-hour services ---- */
for (const [id, b] of Object.entries(BUILT_IN.services)) {
  ok(!!svc(id) && !svc(id).slot, `${id} is a fixed-hour service`);
  const path = "public" + b.file;
  ok(fs.existsSync(path), `${id}: ${path} exists`);
  const plan = JSON.parse(fs.readFileSync(path, "utf8"));
  ok(Array.isArray(plan.routes) && plan.routes.length > 0 && plan.overall, `${id}: ${b.name} is a scored plan with routes`);
}

/* ---- nothing chosen: built-in for fixed hours, the rota for Rotational ---- */
for (const s of SERVICES) {
  const r = resolveFinalised(s);
  if (s.slot) ok(r.kind === "rotation" && /\/plans\/rot\/g[123]-/.test(r.file), `${s.name} follows the rotation`, JSON.stringify(r));
  else ok(r.builtIn && !r.isDefault && r.file === builtInFor(s).file && r.name === builtInFor(s).name, `${s.name} runs its built-in plan`, JSON.stringify(r));
}
ok(planSourceFor(svc("s7")).label === "7am Shift" && planSourceFor(svc("s7")).builtIn, "the 7 am seed card names the built-in plan");

/* ---- a choice made here wins; clearing it returns to the built-in plan ---- */
setFinalised("zen", { kind: "plan", file: "/plan_zen.json", name: "Optimised by hand" });
ok(resolveFinalised(svc("zen")).file === "/plan_zen.json" && !resolveFinalised(svc("zen")).builtIn, "a finalised choice wins over the built-in plan");
clearFinalised("zen");
ok(resolveFinalised(svc("zen")).name === "Subulapuram Unit", "clearing it goes back to the built-in plan");
ok(baselineFor({ id: "new-service", planUrl: "/plan_new.json" }).isDefault, "a service the manifest does not name still falls back to its optimised plan, as a default");

console.log(`finalisedPlans tests: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
