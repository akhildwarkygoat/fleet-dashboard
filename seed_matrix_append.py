#!/usr/bin/env python3
"""Prepare an APPEND run: extend a finished matrix with new stops, buying only the new pairs.

build_road_matrix.py always builds a whole matrix from a stops CSV. Handing it a longer CSV
would re-buy everything. But it resumes from a checkpoint whenever `checkpoint.n` equals the
node count — so this writes a checkpoint that already contains the finished matrix and marks
every block that lies wholly inside it as done. The run then fetches only the blocks that
touch a new node.

Blocks are STEP-aligned, so the block containing the old matrix's last node straddles old and
new and MUST be re-fetched — it is deliberately left undone. That is a handful of blocks, not
a rebuild.

Guardrail: new stops are APPENDED. Existing node indices never move, or every paid cell would
land in the wrong place.

Usage:
  python seed_matrix_append.py <matrix.json> <new_stops.csv> <out_stops.csv> <out_partial.json>
     new_stops.csv needs Name of Stop, Latitude, Longitude
"""
import csv, json, math, sys

STEP = 10
matrix_path, new_stops_path, out_csv, out_partial = sys.argv[1:5]

m = json.load(open(matrix_path, encoding="utf-8"))
old_nodes, old_km, old_min = m["nodes"], m["km"], m["min"]
O = len(old_nodes)

new_rows = []
with open(new_stops_path, encoding="utf-8-sig") as f:
    for r in csv.DictReader(f):
        try:
            lat, lng = float(r["Latitude"]), float(r["Longitude"])
        except (TypeError, ValueError, KeyError):
            continue
        new_rows.append({"name": (r.get("Name of Stop") or "Stop").strip(), "lat": lat, "lng": lng})

N = O + len(new_rows)
print(f"existing nodes {O}  +  new stops {len(new_rows)}  =  {N} nodes")

# ---- the stops CSV the build will read: old stops (indices 1..O-1) then the new ones ----
with open(out_csv, "w", newline="", encoding="utf-8") as f:
    w = csv.writer(f)
    w.writerow(["Name of Stop", "Latitude", "Longitude", "MatrixIdx"])
    for i, nd in enumerate(old_nodes[1:], start=1):
        w.writerow([nd["name"], f'{nd["lat"]:.7f}', f'{nd["lng"]:.7f}', i])
    for j, nd in enumerate(new_rows, start=O):
        w.writerow([nd["name"], f'{nd["lat"]:.7f}', f'{nd["lng"]:.7f}', j])
print(f"wrote {out_csv}  ({O - 1 + len(new_rows)} stops -> load_nodes gives {N})")

# ---- checkpoint: existing distances carried over, fully-old blocks marked done ----
km = [[0.0] * N for _ in range(N)]
mins = [[0.0] * N for _ in range(N)]
for i in range(O):
    km[i][:O] = old_km[i]
    mins[i][:O] = old_min[i]

starts = list(range(0, N, STEP))
done = []
for oi in starts:
    for di in starts:
        if di < oi:
            continue
        # only blocks whose every cell already exists in the old matrix
        if oi + STEP <= O and di + STEP <= O:
            done.append([oi, di])

tri = [(o, d) for o in starts for d in starts if d >= o]
sizes = {s: min(STEP, N - s) for s in starts}
todo = [b for b in tri if list(b) not in done]
elements = sum(sizes[o] * sizes[d] for o, d in todo)

json.dump({"n": N, "km": km, "min": mins, "done": done}, open(out_partial, "w", encoding="utf-8"))
print(f"wrote {out_partial}")
print(f"  blocks: {len(done):,} pre-filled · {len(todo):,} to fetch (of {len(tri):,})")
print(f"  elements to buy: {elements:,}   (~${elements * 1.5 / 1000:.2f} at $1.50/1k)")
straddle = sum(1 for o, d in todo if o < O and d < O)
print(f"  of those, {straddle} block(s) straddle the old/new boundary and are re-bought")
