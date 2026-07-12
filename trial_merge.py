#!/usr/bin/env python3
"""
trial_merge.py — TRIAL stop consolidation per user rules (2026-07-08):
  * merge ONLY into existing stops (matrix rows reused -> Rs0)
  * tiered walking limits by riders at the stop being moved:
        1 rider -> 400 m, 2 riders -> 300 m, 3 riders -> 200 m, 4+ never moved
  * survivor = the more CROWDED stop; tie -> the better-connected (cheaper) one
  * a stop that has absorbed riders becomes immovable (it's now a destination)
Walking distance = haversine x 1.2 (village paths; car u-turn km would overstate a
walk). Rows where road km > 3x straight-line are flagged VERIFY (possible barrier
- river/rail between, no footpath assumed).
Outputs:
  data/bus_stops_trialmerge.csv  (survivors, with MatrixIdx -> exact matrix reuse)
  trial_merge_list.xlsx          (full audit: every merge, distances, tiers, flags)
"""
import csv, json, math
from openpyxl import Workbook

LIMITS = {1: 0.400, 2: 0.300, 3: 0.200}   # km, by riders being moved

rows = list(csv.DictReader(open("data/bus_stops.csv", encoding="utf-8")))
n = len(rows)
name = [r["Name of Stop"] for r in rows]
lat  = [float(r["Latitude"]) for r in rows]
lng  = [float(r["Longitude"]) for r in rows]
hc0  = [int(float(r["Headcount"])) for r in rows]       # original (rule eligibility)
hc   = hc0[:]                                            # running totals
ab   = [float(r["Absentee"]) for r in rows]

M = json.load(open("data/road_matrix.json", encoding="utf-8"))
KM = M["km"]                                             # 823x823, depot=0; stop i -> row i+1

def hav(i, j):
    R = 6371.0088
    la1, lo1, la2, lo2 = map(math.radians, (lat[i], lng[i], lat[j], lng[j]))
    h = math.sin((la2-la1)/2)**2 + math.cos(la1)*math.cos(la2)*math.sin((lo2-lo1)/2)**2
    return 2*R*math.asin(math.sqrt(h))

def road(i, j):
    v = KM[i+1][j+1]
    return v if v is not None and v >= 0 else hav(i, j) * 1.3

# precompute walk-candidate neighbours within 0.45 km straight-line
neigh = [[] for _ in range(n)]
for i in range(n):
    for j in range(i+1, n):
        if abs(lat[i]-lat[j]) > 0.0045:  # ~0.5 km latitude window
            continue
        d = hav(i, j)
        if d <= 0.45:
            neigh[i].append(j); neigh[j].append(i)

def connect_score(j, alive):
    """cheaper-location tie-break: avg road km to the 3 nearest living stops"""
    ds = sorted(road(j, k) for k in neigh[j] if alive[k] and k != j)[:3]
    return sum(ds)/len(ds) if ds else 9e9

alive = [True]*n
received = [False]*n
merges = []          # audit rows
merge_map = {}       # moved 0-based index -> survivor 0-based index

order = sorted(range(n), key=lambda i: (hc0[i], name[i]))
for i in order:
    if hc0[i] not in LIMITS or not alive[i] or received[i]:
        continue
    limit = LIMITS[hc0[i]]
    cands = []
    for j in neigh[i]:
        if not alive[j] or j == i:
            continue
        walk = hav(i, j) * 1.2
        if walk <= limit:
            cands.append((j, walk))
    if not cands:
        continue
    # survivor: most riders; tie -> better connected (cheaper chains)
    best = max(cands, key=lambda c: (hc[c[0]], -connect_score(c[0], alive)))
    j, walk = best
    tie = len([c for c in cands if hc[c[0]] == hc[j]]) > 1
    barrier = road(i, j) > 3 * max(0.03, hav(i, j))
    tot = hc[i] + hc[j]
    ab[j] = (ab[i]*hc[i] + ab[j]*hc[j]) / tot if tot else ab[j]
    merges.append([name[i], hc[i], name[j], hc[j], tot, round(walk*1000),
                   LIMITS[hc0[i]]*1000, "cost-tiebreak" if tie else "crowd",
                   "VERIFY-BARRIER" if barrier else ""])
    hc[j] = tot; alive[i] = False; received[j] = True
    merge_map[i] = j

# ---- outputs
json.dump({str(k): v for k, v in merge_map.items()},
          open("data/trialmerge_map.json", "w", encoding="utf-8"))
with open("data/bus_stops_trialmerge.csv", "w", newline="", encoding="utf-8") as f:
    w = csv.writer(f)
    w.writerow(["Name of Stop", "Latitude", "Longitude", "Headcount", "Absentee", "MatrixIdx"])
    for i in range(n):
        if alive[i]:
            w.writerow([name[i], lat[i], lng[i], hc[i], round(ab[i], 3), i+1])

wb = Workbook(); ws = wb.active; ws.title = "merges"
ws.append(["moved stop", "riders moved", "into (survivor)", "riders there before",
           "riders after", "walk m (est)", "rule limit m", "survivor chosen by", "flag"])
for m_ in merges: ws.append(m_)
ws2 = wb.create_sheet("summary")
kept = sum(alive)
ws2.append(["stops before", n]); ws2.append(["stops after", kept])
ws2.append(["merged away", n-kept]); ws2.append(["riders before", sum(hc0)])
ws2.append(["riders after", sum(hc[i] for i in range(n) if alive[i])])
ws2.append(["barrier flags", sum(1 for m_ in merges if m_[-1])])
wb.save("trial_merge_list.xlsx")

by_tier = {}
for m_ in merges: by_tier[m_[6]] = by_tier.get(m_[6], 0) + 1
print(f"stops: {n} -> {kept}  (merged away {n-kept})")
print(f"riders conserved: {sum(hc0)} -> {sum(hc[i] for i in range(n) if alive[i])}")
print(f"by tier: {by_tier}   barrier-flagged: {sum(1 for m_ in merges if m_[-1])}")
print(f"avg walk of moved stops: {sum(m_[5] for m_ in merges)/max(1,len(merges)):.0f} m")
