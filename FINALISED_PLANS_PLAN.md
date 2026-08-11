# Finalised plans + shared-bus costing — the plan

**Registered:** 11-08-2026. Sits alongside `MATRIX_PLAN.md`. This is the *what and why*
for two changes that turn out to be one change: the transport manager picks which plan is
real, and the fleet's cost stops being double-counted.

---

## Why

A bus that runs three services is charged its **whole** standing cost to each of them.
Across the six current plans:

| | |
|---|---|
| Vehicles used | 100, doing **136 runs** |
| Buses on more than one service | **18** (three do five runs a day) |
| Owned | 49 buses doing 78 runs |
| Standing cost, charged per run | **₹189,240/day** ← today |
| Standing cost, charged per bus | **₹118,882/day** |
| **Double-counted** | **₹70,358/day** ≈ ₹1.8 crore/year |

No fleet-level number can be trusted while that holds, because the services do not sum to
the fleet — they sum to 37% more than the fleet.

Separately: `planUrl` is a hardcoded path in `services.js`. The optimiser's output is
treated as final by definition, which is backwards — it is a **candidate**. The manager
builds the real plan in the Planner and has no way to say so.

---

## Decisions (settled 11-08-2026)

1. **One driver per bus per day.** Driver salary is shared across every run that bus makes,
   exactly like loan and maintenance. All three standing costs are shared.
2. **Split equally per run.** A bus doing three runs charges ⅓ of its standing cost to each.
   The cost is caused by the run existing, not by how full it is — and it keeps one service's
   ₹/head from moving when an unrelated service's headcount changes.
3. **Choices live in localStorage, with Export/Import** to move them between machines.
   No server write, so finalising works on the deploy and on the Windows machine.

---

## The cost model

Three tiers, because they behave differently:

| Cost | Caused by | Treatment |
|---|---|---|
| Loan, driver, maintenance | The **vehicle** existing that day | Split equally across its runs |
| Diesel | The **run** — its own kilometres | Charged whole, never shared |
| Rental slab | The **hire** — a rented van is hired per run | Charged whole, never shared |

For an owned bus `b` making `n(b)` runs across all finalised plans:

```
standingPerRun(b) = (loanMonth/workingDays + driverDay + maintDay) / n(b)
runCost(run)      = standingPerRun(bus) + dieselPerKm × run.km
```

`n(b)` counts runs in the **finalised** set only. Change what is finalised and every
adjusted figure moves — that is the point.

**The invariant to design to:** the adjusted per-service costs must sum to the real fleet
cost. Today they overshoot by ₹70k/day. Any implementation that breaks this is wrong.

---

## Standalone vs adjusted — the rule

| View | Basis | Answers |
|---|---|---|
| Inside a service | **Standalone** — full standing cost | "What does 7 am Morning cost on its own?" |
| **Overall only** | **Adjusted** — standing cost shared | "What does the fleet actually cost?" |

Per-service views do not change at all. Whoever owns a service keeps the number they know,
and the adjustment appears in exactly one place, clearly labelled, where it is meaningful.

This also sidesteps the mixed-basis trap already hit once: a combined ₹/head across plans
costed differently is meaningless, so the Overall header always states its basis.

---

## Storage

`localStorage["opt-finalised"]`:

```json
{ "s9": { "kind": "draft", "id": "d3f…", "name": "Manager 9am v4", "at": 1786…},
  "s7": { "kind": "plan",  "file": "/plan_s7.json", "name": "Optimised" } }
```

- `kind: "plan"` — a file already in `public/` (the optimiser's output, or an import).
- `kind: "draft"` — a Planner draft, which lives in localStorage alongside it.
- **Absent → the optimised plan, labelled `default`** so it is obvious nobody chose it.

**Export** writes `finalised_plans.json` containing the manifest *and* the full body of any
draft it references — otherwise the file is a set of pointers into a browser that the other
machine cannot see. **Import** merges it back and restores the drafts.

---

## UX surfaces

**1. Plans list, per service** — the Planner gallery gains a Finalise action. Every candidate
side by side: optimiser output, saved drafts, imports, each with buses / ₹head / avg ride /
max ride, so the choice is made on numbers rather than filename.

**2. Badge on the service card** — `Finalised · Manager 9am v4` or `Optimised · default`.
One glance tells the manager which of the six he has actually decided.

**3. Overall — the finalisation board.** Six rows: service, what is finalised, what is still
defaulted, and the fleet totals recomputing live as any row changes.

**4. Shared-bus chip** in Overall's routes table — `TN57CJ3434 · 5 services · ⅕ standing` —
so the discount is visible and auditable rather than magic.

**5. Basis label**, always, on Overall: *"Adjusted — standing costs shared across 136 runs on
100 vehicles."*

---

## Build order

Each step is useful alone and safe to stop after.

1. **`fleetCost.js`** — pure function: finalised plans in, usage map + both cost bases out.
   No UI. Testable, and the invariant (Σ adjusted = fleet) becomes an assertion.
2. **`finalisedPlans.js`** — resolver with the optimised fallback, plus export/import.
   Everything that reads `svc.planUrl` moves to `resolvePlan(svc)`.
3. **Finalise action + Plans list** per service.
4. **Overall switches to adjusted**; per-service untouched.
5. **Finalisation board** + shared-bus chips.

---

## Edge cases to handle, not discover

- **A finalised draft is deleted.** Fall back to optimised, and say so rather than blanking.
- **A bus appears in two plans at the same gate time.** That is a real collision — the
  Timings clock already detects it; the cost model should not quietly average it away.
- **Rented buses.** No standing cost to share; a rental on two runs is two hires. The split
  applies to owned only.
- **`workingDays`** (26) already amortises the monthly loan. Do not divide by runs *and*
  re-amortise — the daily loan figure is the input to the split.
- **Zero-seat buses** — five vehicles have no `Seat` in the ERP. They currently plan as
  zero-capacity; they must not become divide-by-zero in ₹/head.
