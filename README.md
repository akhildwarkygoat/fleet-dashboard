# Fleet Dashboard — Employee Transport Optimiser

A React (Vite) dashboard that plans and optimises employee bus transport for a
multi-unit manufacturer. It ingests bus stops (name, GPS, per-stop rider
headcount), a mixed fleet of owned and rented vehicles, and a road-distance
matrix, then produces a fleet plan that minimises cost per head while respecting
capacity and ride-time limits.

Two solvers are available:

- **In-browser heuristic** (`src/optimiser/engine.js`) — instant, cluster-first
  (Clarke–Wright savings) + greedy owned-before-rental assignment + a cost-curve
  sweep. Runs entirely client-side.
- **Offline OR-Tools solver** (`optimize.py`) — a global HF-CVRPTW model that
  decides stop-to-bus assignment and route order jointly. Produces the plan the
  **Fleet plan** tab renders (`public/solver_result.json`). Free to re-run once
  the road matrix is cached — no per-solve Google calls.

---

## Quick start

```bash
# Frontend deps
npm install

# Run the app
npm run dev                 # → http://localhost:5173

# (optional) Python solver deps — only to regenerate the plan offline
pip install -r requirements.txt
python optimize.py          # writes public/solver_result.json
```

### Google Maps key (optional — for live road distances)

There is **no API key in the source**. The app runs on the pre-cached road
matrix (`public/road_matrix.json`). To fetch fresh road distances/geometry:

1. Open the app → **Settings** → **Google Maps API key**.
2. Paste a key with *Maps JavaScript API + Directions API + Distance Matrix API*
   enabled (billing on).

The key is stored **only in your browser** (`localStorage`), never committed.
Without a key the app falls back to the cached matrix (or straight-line estimates).

---

## The dashboard

| Tab | What it shows |
|---|---|
| **Live** | Operational overview |
| **Optimiser** | *Stops* (view/edit the stop network), *Fleet plan* (the OR-Tools plan — Combined / Owned / Rental toggle + per-bus list + map), *Planner* (open a saved plan or build one on the map) |
| **Bus-wise** | Per-bus breakdown |
| **Compare** | Compare plans / scenarios |
| **Equations** | The cost & demand formulas, editable |
| **Metrics** | KPI rollups |
| **Settings** | Google key, model constants |

---

## Architecture

| Path | What |
|---|---|
| `src/Dashboard.jsx` | Main app shell + non-optimiser tabs |
| `src/optimiser/OptimiserTab.jsx` | Optimiser UI (Stops / Fleet plan / Planner) |
| `src/optimiser/engine.js` | In-browser heuristic solver + cost model + `validatePlan()` |
| `src/optimiser/realData.js` | The stop network (names, coords, headcounts) rendered by the app |
| `src/optimiser/store.js` | Data layer — stops/fleet/depot + `localStorage` (`opt-*` keys) |
| `src/optimiser/google.js` | Google Maps loader + road matrix/route (no key in source) |
| `src/optimiser/GMap.jsx` | Map with marker clustering |
| `src/optimiser/PlanGallery.jsx` / `NewPlanBoard.jsx` | Saved-plan gallery + on-map plan editor |
| `optimize.py` | Global OR-Tools fleet optimiser (owned + rental, packs buses, farthest-first) |
| `zones_report.py` | Per-zone breakdown of the global plan |
| `public/solver_result.json` | The plan the Fleet-plan tab fetches at runtime |
| `public/road_matrix.json` / `road_geometry.json` | Cached road distances + leg geometry |

---

## The optimisation model

**Effective demand at a stop** (seats to plan for):

```
demand = ceil( headcount × (1 − absentee + buffer) )      buffer = 0.03
```

**Cost of running a bus for a day:**

```
OWN  :  loan/26 + driver_day + maint_day + diesel_per_km × km
RENT :  slab_fixed + per_km_beyond × max(0, km − slab_km)
```

An owned bus's loan/driver/maintenance are **fixed (sunk)** — its *marginal*
cost is only diesel — so the solver fills owned buses first and rents only the
leftover demand. Distances and times come from the **cached Google road matrix**
(real driving km/min), not straight-line estimates.

**Objectives the plan is tuned toward:**

| # | Objective | Target |
|---|---|---|
| 1 | Cost per head / day | < ₹65 |
| 2 | Average ride time | ≈ 45 min |
| 3 | Max ride time | < 100 min |
| 4 | Max stops per bus | < 20 |
| 5 | Fleet utilisation | ≈ 100% |

**Allocation algorithm (heuristic):** effective demand → Clarke–Wright savings
clustering on the road matrix → nearest-neighbour sequencing from the farthest
stop → cheapest feasible bus per cluster (owned first) → sweep the cluster-size
limit and keep the minimum cost/head plan. The number of buses is bounded below
by the total-demand ÷ largest-capacities argument, so on a given instance the
fleet size is provably minimal and the returned plan sits at the cost-curve
minimum.

**OR-Tools solver:** a Google OR-Tools HF-CVRPTW model — per-vehicle arc cost =
marginal ₹/km, fixed cost = 0 for owned / daily slab for rented, a capacity
dimension, and a time dimension with a soft ride target + hard ride ceiling.
Because OR-Tools can't represent the rental *slab* tariff directly, rental arc
cost uses a small compactness epsilon and the true slab cost is recomputed
afterwards with the formula above.

---

## Model integrity

Most "the optimiser is wrong" moments are a bad **input**, not a math bug —
a leftover placeholder headcount, a loan on a paid-off bus, the wrong dwell time.
Three guardrails catch this:

1. **Model inputs card** — shows every value driving the result.
2. **`validatePlan()`** — live invariant checks (every stop served · riders =
   demand · no bus over capacity + leniency · cost adds up · routes closest-first
   · ride times sane). Any red = don't trust the numbers.
3. **`engine.test.js`** (`npm test`) — pure-node invariant assertions; run after
   any `engine.js` change.

The cheapest habit: eyeball three numbers per plan — **bus count**, **₹/head**,
**max ride** — against what you already know. If one is wildly off, it's an
input, not the math.

Model constants live in `engine.js → DEFAULTS` (dwell, absentee buffer, working
days, ride caps, capacity leniency, ride penalties). Seed data (stops/fleet/
depot) is written to `localStorage` once, so after editing a seed you must bump
its key (`opt-stops-*`, `opt-fleet-*`, `opt-depot-*`) or clear it in the console.

---

## Data & scaling notes

- Coordinates must be **decimal degrees** (e.g. `10.207550`).
- The road matrix is **N²** — a full solve stays cheap up to ~60 stops per run;
  large networks should be optimised **one zone/shift at a time**, not in one
  giant solve, to stay within Google's matrix quota.
- Each **shift** (factory timing window) is its own optimisation — its riders,
  routes, and buses — handled like a zone: load that shift's stops + headcounts
  and solve it on its own.
- **IT integration:** the target is a single ingestion point (one multi-sheet
  workbook, or a backend feed) populating stops, fleet, employees, attendance,
  and settings at once. Optimiser data flows through `optimiser/store.js`; ops
  data through the `window.storage` shim in `main.jsx`.

---

## Tests

```bash
npm test          # engine invariant checks
```
