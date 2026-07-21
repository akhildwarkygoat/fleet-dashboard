#!/usr/bin/env python3
"""
apply_merge.py — produce the final road-validated merged stop set from merge_audit.json.

Each anchor absorbs its CLEAN members (walkable, road ≈ straight); SUSPECT members
(road >> straight, the Y-road/barrier false-merges) are pulled back out as their own stops.
Result: 602 stops = 589 merged - (suspects re-separated back in).

Writes:
  data/stops_merged.json   — rich final stops
  data/bus_stops.csv       — the FROZEN matrix input (Name of Stop, Latitude, Longitude, ...)
"""
import json, csv, os

a = json.load(open("data/merge_audit.json"))
final = []       # survivors — the stops that REMAIN after the merge (drawn green)
removed = []     # stops that were absorbed INTO a survivor and no longer exist (drawn red)
absorbed = 0
resep = 0
for anc in a["anchors"]:
    clean = [m for m in anc["members"] if not m["suspect"]]
    suspect = [m for m in anc["members"] if m["suspect"]]
    head = anc["headcount"] + sum(m["headcount"] for m in clean)
    absorbed += len(clean)
    final.append({"name": anc["name"], "lat": anc["lat"], "lng": anc["lng"],
                  "headcount": head, "merged_in": len(clean), "barrier_split": False})
    for m in clean:  # these stops disappear — folded into the anchor
        removed.append({"name": m["name"], "lat": m["lat"], "lng": m["lng"], "headcount": m["headcount"],
                        "into": anc["name"], "into_lat": anc["lat"], "into_lng": anc["lng"],
                        "straight_m": m.get("straight_m")})
    for m in suspect:  # barrier-split: within 200 m straight-line but far by road → KEPT as its own stop
        resep += 1
        final.append({"name": m["name"], "lat": m["lat"], "lng": m["lng"],
                      "headcount": m["headcount"], "merged_in": 0, "barrier_split": True})

final.sort(key=lambda r: (-r["headcount"], r["name"]))
out = {"meta": {"stops": len(final), "clean_absorbed": absorbed, "suspects_kept_separate": resep,
               "removed": len(removed), "riders": sum(r["headcount"] for r in final), "depot": a.get("depot")},
       "depot": a.get("depot"), "stops": final, "removed": removed}
json.dump(out, open("data/stops_merged.json", "w"), indent=1)
os.makedirs("public", exist_ok=True)
json.dump(out, open("public/merged_stops.json", "w"))   # consumed by the Prev-route "Merged stops" view

with open("data/bus_stops.csv", "w", newline="", encoding="utf-8") as f:
    w = csv.writer(f)
    w.writerow(["Name of Stop", "Latitude", "Longitude", "Headcount"])
    for r in final:
        w.writerow([r["name"], r["lat"], r["lng"], r["headcount"]])

n = len(final) + 1  # + depot
print(f"Final stops: {len(final)}  (clean absorbed: {absorbed}, suspects kept separate: {resep})")
print(f"Matrix nodes incl depot: {n}")
