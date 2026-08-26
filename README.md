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

### ERP login (required — the dashboard has no data without it)

The ERP is no longer open. `POST /api/login` with a username and password returns a
bearer token, and every `/api/general/*` call must carry it; without one the feed
answers `401 Authorization has been denied for this request.` and the dashboard sits
on "Contacting ERP…".

Create **`.erp_key`** in the project root:

```json
{ "Username": "…", "password": "…" }
```

(The ERP was documented to us with two different spellings of these fields, so
`UserName`/`Password` works too — the login tries both.)

`ERP_USER` / `ERP_PASS` environment variables work too and take precedence.

The file is gitignored, same rule as `.maps_key`: **never committed, never printed.**
It is read by the dev server and by `refresh_routes.sh` — *not* by the browser. The
proxy attaches the token as the request passes through, so the ERP password never
reaches the bundle and never lands on a dashboard machine.

On startup the log says which mode is in use:

```
ERP   login configured — requests will carry a bearer token
ERP   logged in
```

A wrong password reports there, at startup, rather than as a vague sync failure later.
With no credentials at all it calls the ERP unauthenticated, which now fails — that
path only exists so a site still on the old open ERP keeps working.

> **Production:** the backend passthrough has to perform this same login. The browser
> cannot, for the same reason it cannot hold the password.

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
| **Optimiser** | *Stops* (view/edit the stop network), *Fleet plan* (the OR-Tools plan — Combined / Owned / Rental toggle + per-bus list + map), *Planner* (open a saved plan or build one on the map; set where each bus parks), *Timings* (every bus on one 24-hour clock, with its layovers) |
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
| `src/optimiser/layover.js` | Park points, the run timeline, and the link/saving arithmetic (pure — runs in Node and the browser) |
| `src/optimiser/parkPrefs.js` | Which park each service/bus is assigned, in `localStorage`, with export/import |
| `src/optimiser/ParkPicker.jsx` | The place chooser used by the Planner's per-bus `Parks: …` button |
| `build_bus_connections.mjs` | Builds `public/bus_connections.json` + `park_points.json` from the finalised plans |
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

## Parking and connecting runs

Every plan here is built one service at a time, and each one assumes its buses start and end
at the factory. Across the fleet that is not true. A bus finishing the Rotational Day drop in
a village at 14:50 is wanted back in the same village at 21:00 for the Full-night pickup — so
it can **stay there** instead of driving home empty and driving out again.

Three ideas, kept separate:

| | |
|---|---|
| **Park point** | Where a bus stands between runs. Candidates are the **road-matrix nodes** — the only places with measured Google driving distances, so a choice can be priced rather than estimated. |
| **Run** | One leg of one service. Each service produces **two** per bus per day: the *pickup* that must reach the gate, and the *drop* that leaves it. Only a drop can strand a bus somewhere worth waiting. |
| **Link** | Two runs the same bus does back-to-back, waiting at a park point in between. |

```bash
node build_bus_connections.mjs
```

Reads every finalised plan, rebuilds the fleet's day as a run timeline, and writes
`public/bus_connections.json` (what the Parking board draws) and `public/park_points.json`
(the picker's catalogue). Needs no ERP call and no Google quota — only the cached matrix.

```bash
node build_bus_connections.mjs --off s9=1080 --off s7=930   # real release times, in minutes
node build_bus_connections.mjs --min-save 10 --park-radius 5 --max-layover 600
```

### Where the choice is made

**Per bus, in the Planner.** Pick a bus and its card gains two small chips — **S** where the
run starts, **P** where it ends and the bus waits. Each opens the same picker:

| Choice | Meaning |
|---|---|
| **Factory** / **Where it ends** | the default for that end — today's behaviour, and the zero line |
| **Pick on map** | click any stop; it becomes that end. The click does *not* add or remove it from the route |
| a named place | any road-matrix node, for when the village has nowhere a bus can stand |

The map pins both ends of the selected bus's run. They swap with the Evening/Morning toggle,
because the same two points are the start and the end depending on which way the route is read.
Choices are stored per service *and* per bus, so one registration can start and park differently
on its Day run and its night one.

**The numbers follow the pins.** `scorePlan` measures each run between its own two ends, so
moving either one immediately re-costs that bus — distance, cost/head and, for the start, ride
time. Leaving both alone reproduces the old figures to the last decimal; `layover.test.js`
asserts that, along with the fact that moving the *park* must not change the ride (a passenger's
trip ends at the last rider, not at the depot the bus goes to afterwards).

The plan's road matrix only covers the depot and that plan's stops, so those — and any stop you
click — are measured. A place picked from the wider catalogue that isn't one of them falls back
to a straight-line estimate, and the card says so rather than passing it off as measured.

The **Timings** clock then draws each layover as `S———P` on the bus's row — green when the bus
waits between shifts, amber when it stands out overnight — and its search matches a bus, a
service, or the village a bus parks in.

**What is saved, and what is not.** A link saves **diesel only**, over kilometres not driven.
Loan, driver and maintenance are unchanged — the bus and the driver exist whether it waits in
a village or at the factory — and those are `fleetCost.js`'s question. The baseline is what
the plans assume today, so pinning every bus to *Factory* makes the total come out at exactly
₹0. That identity is asserted in `layover.test.js`.

**Gate times are known; release times are not.** The ERP carries `gate` for every service but
`off` only for the three Rotational slots, whose windows tile the day. The other three fall
back to an assumed 8-hour shift and **every figure that depended on it is flagged `assumed`**
— on the clock a drop run drawn on an assumed release time is dashed rather than solid. Set
the real ones in `services.js` or pass `--off <id>=<minutes>` when rebuilding.

A layover is an operational commitment, not just an arithmetic one — the driver has to be
relieved or wait, and the village needs somewhere a bus can safely stand. So the board ranks
and explains candidates; it never applies one. Overnight stand-outs are counted separately
from between-shift waits for exactly that reason.

`build_service_plans.mjs --park far` records the decision per route in the plan file. It
deliberately does **not** adjust that file's `km` or `cost`: those reconcile to the dashboard
and to `fleetCost.js`, and the default (`--park depot`) reproduces existing plans byte for byte.

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
npm test                                # engine invariant checks
node src/optimiser/layover.test.js      # parking / connection arithmetic
node src/optimiser/fleetCost.test.js    # shared-bus costing invariant
```
