#!/usr/bin/env python3
"""Combination sweep on the 691-stop consolidated network (chain engine).
Varies ride-target, ride-penalty, and stop-cap. Full KPIs captured per run.
Live dashboard plan backed up first and restored at the end."""
import subprocess, json, shutil, sys

CSV = "data/bus_stops_merge200.csv"
COMBOS = [  # (label, extra args)
    ("t45  p25",        ["--ride-target", "45"]),
    ("t60  p25",        ["--ride-target", "60"]),
    ("t60  p60",        ["--ride-target", "60", "--ride-penalty", "60"]),
    ("t75  p25",        ["--ride-target", "75"]),
    ("t90  p25",        ["--ride-target", "90"]),
    ("t75  p25 cap15",  ["--ride-target", "75", "--max-stops", "15"]),
]
SECONDS = "240"

shutil.copy("public/solver_result.json", "public/solver_result.SWEEP-BACKUP.json")
results = []
for label, extra in COMBOS:
    print(f"\n=== {label} ===", flush=True)
    r = subprocess.run([sys.executable, "optimize.py", CSV, "--seconds", SECONDS, "--chain"] + extra,
                       capture_output=True, text=True)
    if "Wrote public/solver_result.json" not in (r.stdout or ""):
        print("  FAILED:", (r.stdout or "")[-250:], (r.stderr or "")[-250:], flush=True)
        results.append({"label": label, "failed": True}); continue
    d = json.load(open("public/solver_result.json", encoding="utf-8"))
    row = {"label": label}
    for scope in ("overall", "owned", "rental"):
        m = d[scope]
        row[scope] = {k: round(m[k], 1) if isinstance(m[k], float) else m[k] for k in
                      ("buses", "riders", "util", "avg_stops", "max_ride", "avg_ride", "km", "cost", "cost_head")}
    rides = [rt["ride"] for rt in d["routes"]]
    row["le60"] = sum(1 for x in rides if x <= 60)
    row["gt90"] = sum(1 for x in rides if x > 90)
    row["max_stops"] = max(rt["stops"] for rt in d["routes"])
    results.append(row)
    json.dump(results, open("sweep_results.json", "w"), indent=1)
    o = row["overall"]
    print(f"  Rs{o['cost_head']}/head | buses {o['buses']} | util {o['util']}% | avg {o['avg_ride']} "
          f"| max {o['max_ride']} | <=60: {row['le60']} | maxstops {row['max_stops']}", flush=True)

shutil.copy("public/solver_result.SWEEP-BACKUP.json", "public/solver_result.json")
print("\nDashboard plan RESTORED. Results in sweep_results.json", flush=True)
