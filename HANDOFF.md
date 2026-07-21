# Transport Optimiser — Session Handoff

Working dir: `/Users/Personal_stuff/Documents/Projects_Summer/Transport-Optimiser-main`
Live ERP: `POST http://172.16.10.169:8089/api/general/VehicleEmpMapDetails` (LAN-only; reachable from this Mac on the office network, **not** from Vercel).
Dashboard: React + Vite + Tailwind (`npm run dev`, port 5173). Prev-route map is a standalone iframe: `public/routes_map.html`.

---

## ✅ Done this session

### 1. Prev-route map (`public/routes_map.html`)
- Liquid-glass **+/− zoom control**, aligned to the 16 px cockpit inset.
- **Rebuild-on-load**: opening Prev-route runs `refresh_routes.sh` (fetch live ERP → rebuild routes) behind a glass **progress loader** (self-drawing route animation, "Routing bus N/71"). Dev-only via a Vite endpoint `/__rebuild_routes` (see `vite.config.js`); on Vercel it falls back to the committed snapshot.
- Routes shown **un-merged** (`build_erp_routes.py --merge-m 0`) — every distinct ERP home GPS is its own stop.
- **3 sub-tabs** (bottom-center toggle): **Route map** / **Merge review** / **Merged stops**.
  - **Merge review**: per-bus 200 m/300 m merge suggestions, riskiest-first, distance bands (≤150 safe / 150–250 border / 250+ risky), click a card → draws dashed connector lines target←members. Data: `public/merge_suggestions.json`.
  - **Merged stops**: the **680 global "real" stops** after 200 m merge + barrier-split. **Green = kept, Red = removed** (folded into a kept stop). Stops are **renameable** (click → popup → Save; persists in localStorage keyed by GPS, survives rebuilds). Garbled `?` names flagged "name?". Data: `public/merged_stops.json`.

### 2. Merge analysis (read-only, for supervisor)
- `merge_suggestions.py` → `stop_merge_suggestions.xlsx` (200 m vs 300 m comparison, per bus) **and** `public/merge_suggestions.json` (map data). `--json-only` mode used by `refresh_routes.sh`.
- 200 m: ~753 stops remain · 300 m: ~676. (Per-bus counts; different from the global matrix stops — see below.)

### 3. Distance + Time matrix (Google) — **COMPLETE, paid, $0 via trial credit**
Pipeline (all from latest ERP, date 2026-07-20):
```
build_stops_from_erp.py --merge-m 0     # 1,113 un-merged stops -> data/stops_live.json
merge_audit.py --radius 200             # 200 m merge + OSRM road-check -> 13 barrier false-merges flagged
apply_merge.py                          # split barriers back out -> data/bus_stops.csv (680 stops) + public/merged_stops.json
build_road_matrix.py --triangle --go    # Google Distance Matrix -> data/road_matrix.json + public/road_matrix.json
build_road_geometry.py                  # OSRM road paths -> public/road_geometry.json
```
- **`data/bus_stops.csv` = 680 stops (+depot = 681 nodes)**. Freeze hash `md5 = 0b94ae8893a96ee737977ffb61b69bbc`.
- **`road_matrix.json`**: 681×681, `km` (distance) + `min` (time) matrices, 0 failed/unreachable pairs. Triangle mode (a→b==b→a mirrored; within-block cells keep real asymmetry — fine).
- Cost ≈ $248 (India SKU $1.50/1k, 70k free/mo), covered by the **$300 Google Cloud trial credit → ₹0**.
- **NOTE: two different "stop counts"** — global matrix = **680** (one node per physical location), per-bus merge review = ~753 (a shared corner counts once per bus). Both correct; matrix uses 680.

### 4. Optimiser (`optimize.py`) wired to real data
- **Reads `data/road_matrix.json`** automatically (`_load_cached_matrix`) — prints "Using cached Google road matrix". Aligned by node order (depot + 680 stops).
- **Fleet from live ERP** (`_fleet_from_erp`): 71 buses = 33 owned + 38 rental = 2,286 seats. The 2 blank-seat buses (TN57BJ3434, TN57BK3434) default to **owned, 55 seats** (ERP has blank seat+type; user confirmed 55; type=owned is an assumption — flip to rental if wrong).
- **Demand = full ERP roster (2,727)** — removed the stale `JUNE_ALLOTTED=2360` pin and the absentee discount.
- **All 71 buses used** (no idle) — happens naturally with the full fleet + goal phase; hard "force all" constraint was tried and **removed** (it broke the solve).
- **Capacity**: 150 % "standing" cap (`STAND_MULT`) + a **ride-banded 2-pass** (long routes → seats-only, short → 150 %), with **seat-everyone fallback** (kept the 150 % plan because 2,727 riders > 2,176 seats — can't hold long routes at 100 % and seat everyone).
- **`--max-stops`** cap (soft, ₹400/stop over). **`OWN_FAR_PEN`** = owned pay a per-stop surcharge for far-from-depot stops → owned favour CLOSE stops, rentals take FAR (distance-based). New args: `--short-ride`, `--long-ride`, `--allow-idle`.

---

## ⚠️ OPEN / UNRESOLVED — optimiser tuning (pick up here)

User's routing goals (from this session):
1. **≤ 20 stops per bus** — DONE (max-stops cap).
2. **Owned = close/dense (more stops), Rental = far/isolated** — *best-effort*; limited by fleet mix (only 570 rental seats, so owned carry 76 % of riders and must cover far areas too).
3. **Avg ride 50–60 min** (user later said **"balance both" → ~62–65 min**).
4. **Owned/rental split: "do the best split possible"** (accept some owned still go far).

**The tension (real, not a bug):** with the chain model + 680 stops, routes of ~12–14 stops inherently run 80–95 min, so **avg 62–65 fights "owned = more stops"**. Every lever trades off another. Best clean results seen:
- `--max-stops 20 --ride-target 55` (no far-pen): avg **69**, max **146**, all 71 buses, everyone seated. ← cleanest.
- `--max-stops 16 --ride-target 55 --OWN_FAR_PEN 14`: distance split works (rental farther 32.5 vs owned 26.1 km) but avg **77** (owned over-pack near clusters).

**LOCKED-IN PLAN (current `solver_result.json` + `road_geometry.json`):** run with
`--seconds 150 --max-stops 16 --ride-target 55` and `OWN_FAR_PEN = 6`:
- **71 buses (all used) · 2,727 riders seated · 119 % util · ₹61.0/head/day**
- **Avg ride 63 min** (owned **58** / rental 68) · max **139** · max stops **16, none over cap**
- **Owned = closer + more stops** (22.4 km far, 10.7 stops) vs **Rental = farther + fewer** (32.0 km, 8.6 stops) ✓
- Geometry: 2,072 legs cached, all road-following, 0 null. **Durable archive of this plan:** `plans/solver_result_2026-07-22_optimised-71bus-150s.json` (+ its geometry) — restore with `cp plans/solver_result_2026-07-22_optimised-71bus-150s.json public/solver_result.json`.

**Key tuning discovery:** SOLVE TIME was the missing lever — 45 s → 150 s dropped avg ride 72→63 and cost 66→61 with every constraint intact. **300 s went too far**: marginally better avg/cost (62/₹60) but left 1 bus idle and max ride rose to 147 — rejected because the user requires all 71 buses used. If re-running, use `--seconds 150`.

---

## Key gotchas / environment
- **macOS Python SSL**: scripts hitting HTTPS need certs. Prefix with `SSL_CERT_FILE="$(python3 -m certifi)"` (run `python3 -m pip install --upgrade certifi` once). `build_road_matrix.py` needs this; OSRM scripts already disable verify.
- **No `timeout` command** on macOS.
- **Map usage**: in Optimiser → Fleet plan, draw a route by **ticking the bus's CHECKBOX** (left of the row), not clicking the row. Route then draws following real roads (OSRM). *Possible improvement: make row-click also select.*
- **`caffeinate`** was started to keep the Mac awake for the matrix build — kill with `killall caffeinate` if still running.
- **🔑 API KEY EXPOSED**: the Google Maps API key was pasted in chat several times — **regenerate it** (Google Cloud → Credentials → Regenerate). It was restricted to Distance Matrix API + Application restrictions: None.
- **Google billing**: the old "UPI Payment" billing account is CLOSED; user created a new project on the $300 free trial (paid via card — UPI fails the trial verification).

## Git status
- Pushed to `main` earlier: prev-route glass/loader/merge-review commits (user ran `git push` — pushes are blocked for the assistant in this session).
- **Uncommitted**: all the `optimize.py` changes (fleet loader, demand, capacity bands, OWN_FAR_PEN, args), `apply_merge.py` (removed-stops export), `merge_suggestions.py`, `refresh_routes.sh`, `data/MATRIX_BUILD.md` (updated hash/counts), and `public/*.json` regenerated files. `data/bus_stops.csv`, `data/erp_live.json`, `data/stops_*.json` are **gitignored** (contain employee PII).
- On Vercel: the app deploys from `main`; ERP is unreachable there (falls back to committed snapshots).

## File map
- `optimize.py` — the solver (fleet/demand/capacity/routing tuning lives here).
- `build_road_matrix.py` + `data/MATRIX_BUILD.md` — Google matrix build (resumable, checkpointed).
- `build_stops_from_erp.py` → `merge_audit.py` → `apply_merge.py` — stop pipeline → `data/bus_stops.csv`.
- `merge_suggestions.py` — merge review data + xlsx.
- `refresh_routes.sh` — fetch ERP + rebuild prev-route data (also regenerates merge_suggestions json).
- `public/routes_map.html` — Prev-route cockpit (3 sub-tabs).
- `src/optimiser/OptimiserTab.jsx` — Optimiser tab (Stops / Fleet plan=`FleetPlanView` / Planner). `MasterRouteMap` draws selected routes.
- `public/{road_matrix,road_geometry,solver_result,merged_stops,merge_suggestions,current_routes}.json` — data the UI reads.
