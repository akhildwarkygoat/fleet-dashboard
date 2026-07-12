#!/usr/bin/env python3
"""
zones_report.py - per-zone breakdown of the GLOBAL fleet plan (public/solver_result.json).

Reads the solver result, re-zones the stops the same depot-aware way the dashboard does,
assigns each bus to the zone where most of its stops sit, and prints per-zone stats.
This is a *view* of the one real plan (no double-booking), not 7 separate solves.

Usage:  python zones_report.py [--cap 30]
"""
import json, math, argparse
from collections import defaultdict

DEPOT = (10.207550, 77.806206)

def zone_labels(stops, cap, Wd=1.5):
    """Depot-aware capacity-balanced k-means (mirrors store.js autoZone)."""
    n = len(stops)
    if n == 0: return []
    k = max(1, math.ceil(n / cap))
    latm = sum(s["lat"] for s in stops) / n
    kx = math.cos(math.radians(latm))
    X = []
    for s in stops:
        dy = (s["lat"] - DEPOT[0]) * 111
        dx = (s["lng"] - DEPOT[1]) * 111 * kx
        X.append((dx, dy, Wd * math.hypot(dx, dy)))
    d2 = lambda a, b: (a[0]-b[0])**2 + (a[1]-b[1])**2 + (a[2]-b[2])**2
    start = min(range(n), key=lambda i: (X[i][0], X[i][1]))
    seeds = [start]
    while len(seeds) < k:
        seeds.append(max(range(n), key=lambda i: min(d2(X[i], X[s]) for s in seeds)))
    cent = [X[i] for i in seeds]
    assign = [0]*n
    for _ in range(30):
        for i in range(n):
            assign[i] = min(range(k), key=lambda c: d2(X[i], cent[c]))
        for c in range(k):
            mem = [i for i in range(n) if assign[i] == c]
            if mem:
                cent[c] = tuple(sum(X[i][j] for i in mem)/len(mem) for j in range(3))
    for _ in range(n + k):
        cnt = [assign.count(c) for c in range(k)]
        over = next((c for c in range(k) if cnt[c] > cap), -1)
        if over < 0: break
        far = max((i for i in range(n) if assign[i] == over), key=lambda i: d2(X[i], cent[over]))
        cand = [c for c in range(k) if c != over and cnt[c] < cap]
        if not cand: break
        assign[far] = min(cand, key=lambda c: d2(X[far], cent[c]))
    used = sorted(set(assign), key=lambda c: math.hypot(cent[c][0], cent[c][1]))
    label = {c: "Z%d" % (i+1) for i, c in enumerate(used)}
    return [label[assign[i]] for i in range(n)]

def hav(a, b):
    R = 6371.0
    la1, lo1, la2, lo2 = map(math.radians, [a[0], a[1], b[0], b[1]])
    d = math.sin((la2-la1)/2)**2 + math.cos(la1)*math.cos(la2)*math.sin((lo2-lo1)/2)**2
    return R*2*math.asin(math.sqrt(d))

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--cap", type=int, default=30); a = ap.parse_args()
    data = json.load(open("public/solver_result.json", encoding="utf-8"))
    routes = data["routes"]

    # flatten unique stops (by lat,lng), zone them, build a lookup
    seen, allstops = {}, []
    for r in routes:
        for s in r["seq"]:
            key = (round(s["lat"], 6), round(s["lng"], 6))
            if key not in seen:
                seen[key] = len(allstops); allstops.append(s)
    labels = zone_labels(allstops, a.cap)
    zone_of = {(round(allstops[i]["lat"],6), round(allstops[i]["lng"],6)): labels[i] for i in range(len(allstops))}

    # assign each bus to the zone holding most of its stops
    Z = defaultdict(lambda: {"own":0,"rent":0,"riders":0,"seats":0,"cost":0,"stops":0,"maxride":0,"dist_far":0})
    for r in routes:
        zc = defaultdict(int)
        for s in r["seq"]:
            zc[zone_of[(round(s["lat"],6), round(s["lng"],6))]] += 1
        z = max(zc, key=zc.get)
        Z[z]["own" if r["type"]=="own" else "rent"] += 1
        Z[z]["riders"] += r["riders"]; Z[z]["seats"] += r["cap"]; Z[z]["cost"] += r["cost"]
        Z[z]["stops"] += r["stops"]; Z[z]["maxride"] = max(Z[z]["maxride"], r["ride"])
        far = max(hav(DEPOT, (s["lat"], s["lng"])) for s in r["seq"])
        Z[z]["dist_far"] = max(Z[z]["dist_far"], far)

    print(f"\nPER-ZONE BREAKDOWN of the global plan  (cap {a.cap} -> {len(Z)} zones)\n")
    print(f"  {'zone':<5} {'buses(own+rent)':<16} {'stops':>5} {'riders':>6} {'util':>5} "
          f"{'cost/head':>9} {'maxride':>7} {'farthest':>8}")
    tot = {"own":0,"rent":0,"riders":0,"seats":0,"cost":0,"stops":0}
    for z in sorted(Z, key=lambda x: int(x[1:])):
        d = Z[z]
        util = 100*d["riders"]/d["seats"] if d["seats"] else 0
        ch = d["cost"]/d["riders"] if d["riders"] else 0
        print(f"  {z:<5} {str(d['own'])+' own + '+str(d['rent'])+' rent':<16} {d['stops']:>5} "
              f"{d['riders']:>6} {util:>4.0f}% {ch:>8.1f} {d['maxride']:>6} min {d['dist_far']:>6.0f}km")
        for kk in tot: tot[kk] += d[kk]
    util = 100*tot["riders"]/tot["seats"]
    print("  " + "-"*70)
    print(f"  {'ALL':<5} {str(tot['own'])+' own + '+str(tot['rent'])+' rent':<16} {tot['stops']:>5} "
          f"{tot['riders']:>6} {util:>4.0f}% {tot['cost']/tot['riders']:>8.1f}")

if __name__ == "__main__":
    main()
