# Road distance/time matrix build — resume guide

A **resumable, checkpointed** Google Distance Matrix build. Safe to stop at any time and
continue later (this session, a new session, or a different AI/person). No block is ever
paid for twice.

## What is being built
- **Input (frozen):** `data/bus_stops.csv` — 680 road-validated stops + depot = **681 nodes**.
  Rebuilt 2026-07-20 from live ERP `VehicleEmpMapDetails` (union of all 11 days in the feed:
  1,113 un-merged home GPS) → 200 m merge (667) → the 13 barrier-split false-merges kept
  separate (verified free via OSRM road distances, see `merge_audit.py` / `public/merge_map.html`).
  Rich version: `data/stops_merged.json`. Regenerate with:
  `python build_stops_from_erp.py --merge-m 0 && python merge_audit.py --radius 200 && python apply_merge.py`.
  - **Freeze hash (must not change):** `md5(data/bus_stops.csv) = 0b94ae8893a96ee737977ffb61b69bbc`
- **Mode: TRIANGLE** — assumes `a->b == b->a` (and `a->a = 0`), so only the upper-triangle +
  diagonal blocks are requested and mirrored into the lower half. ~half the cost & time.
- **Job size (triangle):** 2,415 requests, 235,281 elements. India basic Distance Matrix pricing
  = $1.50/1,000 elements with 70,000 free/month → billable 165,281 → **~$248** (≈₹24,900 inc 18% GST).
  (Full matrix would be 463,761 elements → ~$591. US list price $5/1,000 would be ~$1,176, but that
  is NOT India pricing.)
- **Output on completion:** `data/road_matrix.json` + `public/road_matrix.json` (real road km + minutes),
  then `python build_road_geometry.py` (free OSRM) for route paths.

## Command
```bash
# probe first (one ~free call) to confirm the key is a valid SERVER key with Distance Matrix API enabled:
GOOGLE_MAPS_API_KEY='<KEY>' python build_road_matrix.py data/bus_stops.csv --probe

# the real build — MUST include --triangle (spends ~$248 ≈ ₹24,900; resumable). Run in the background so it survives:
GOOGLE_MAPS_API_KEY='<KEY>' python build_road_matrix.py data/bus_stops.csv --triangle --go
```
The key is passed via env var, never written to disk. It is **not stored anywhere** — whoever
resumes must supply it again.

## How resume works
- After **every** block the script writes `data/road_matrix.partial.json`
  (`{n, km, min, done:[[oi,di],...]}`).
- On restart it loads the partial, checks `n == 681`, and **skips every block already in `done`** —
  those cost nothing again. It continues from the first unfinished block.
- On success it writes the final matrix and deletes the partial.

## To continue after a stop (checklist for the next session / AI)
1. Same working dir: `/Users/Personal_stuff/Documents/Projects_Summer/Transport-Optimiser-main`.
2. `data/bus_stops.csv` **must be byte-identical** — verify `md5` matches the freeze hash above.
   Do NOT re-run `build_stops_from_erp.py` / `apply_merge.py` (it could reorder nodes and corrupt the partial).
3. `data/road_matrix.partial.json` must still be present (that's the saved progress).
4. Re-run the exact `--triangle --go` command above with a valid key.
   ⚠️ You MUST pass `--triangle` on resume too — omitting it makes the script try the skipped
   lower-triangle blocks and spend extra.

## Check progress
```bash
python - <<'PY'
import json
ck=json.load(open('data/road_matrix.partial.json'))
done=len(ck['done']); total=2415   # triangle blocks for n=681
print(f"{done}/{total} blocks done ({100*done//total}%)  n={ck['n']}")
PY
```
