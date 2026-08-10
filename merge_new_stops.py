#!/usr/bin/env python3
"""
merge_new_stops.py - collapse duplicate stops using ROAD distance, not straight-line.

Straight-line proximity lies. Two stops 150 m apart across a river, either side of a
divided highway, or just past a Y-junction on diverging branches are two stops, not one:
a bus down one branch cannot serve the other. Every merge here is therefore confirmed
against OSRM driving distance (free, keyless) before it is allowed.

Rules, all of which must hold before two stops merge:
  1. straight-line distance <= --radius            (cheap candidate filter)
  2. road distance          <= --road-cap          (absolute sanity bound)
  3. road / straight-line   <= --ratio-cap         (the Y-junction / wrong-road detector)
  4. OSRM must actually return a route             (no answer => do not merge)

Clusters are COMPLETE-LINKAGE: every member is verified against every other member, not
just against the anchor. Star grouping would let two stops 400 m apart share a cluster
under a "200 m" rule simply because both sit near the middle.

Read-only with respect to the matrix. Writes a merged stops CSV and an audit JSON; it
never edits a checkpoint or the matrix itself.

Usage:
  python3 merge_new_stops.py --stops data/new_stops_jobB.csv \
      --out data/new_stops_jobB.merged.csv --report data/merge_jobB_audit.json
"""
import csv, json, math, os, time, argparse, ssl
from urllib.request import urlopen
from urllib.error import URLError, HTTPError

OSRM = ("https://router.project-osrm.org/route/v1/driving/"
        "{lng1},{lat1};{lng2},{lat2}?overview=false&alternatives=false")
CACHE = "data/osrm_pair_cache.json"


def hav(a, b):
    R = 6371000.0
    la1, ln1, la2, ln2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    d1, d2 = la2 - la1, ln2 - ln1
    h = math.sin(d1 / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin(d2 / 2) ** 2
    return 2 * R * math.asin(math.sqrt(h))


def load_cache():
    if os.path.exists(CACHE):
        try:
            return json.load(open(CACHE, encoding="utf-8"))
        except (ValueError, OSError):
            pass
    return {}


def save_cache(c):
    tmp = CACHE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(c, f)
    os.replace(tmp, CACHE)


def road_m(a, b, cache, sleep=0.15, tries=3):
    """One-way driving distance in metres, or None when OSRM has no route."""
    key = f"{a[0]:.6f},{a[1]:.6f}|{b[0]:.6f},{b[1]:.6f}"
    if key in cache:
        return cache[key]
    url = OSRM.format(lat1=a[0], lng1=a[1], lat2=b[0], lng2=b[1])
    ctx = ssl.create_default_context()
    try:
        import certifi
        ctx = ssl.create_default_context(cafile=certifi.where())
    except ImportError:
        pass
    val = None
    for _ in range(tries):
        try:
            with urlopen(url, timeout=25, context=ctx) as r:
                d = json.loads(r.read().decode("utf-8"))
            if d.get("code") == "Ok" and d.get("routes"):
                val = float(d["routes"][0]["distance"])
            else:
                val = None                      # genuinely no route - a real answer, cache it
            break
        except (URLError, HTTPError, TimeoutError, OSError, ValueError):
            time.sleep(1.0)
    else:
        return None                             # transport failure: do NOT cache, do NOT merge
    cache[key] = val
    time.sleep(sleep)
    return val


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--stops", default="data/new_stops_jobB.csv")
    ap.add_argument("--out", default="data/new_stops_jobB.merged.csv")
    ap.add_argument("--report", default="data/merge_jobB_audit.json")
    ap.add_argument("--radius", type=float, default=200.0, help="straight-line candidate radius (m)")
    ap.add_argument("--road-cap", type=float, default=300.0, help="max road distance to allow a merge (m)")
    ap.add_argument("--ratio-cap", type=float, default=2.0, help="max road/straight ratio (Y-junction guard)")
    ap.add_argument("--road-floor", type=float, default=75.0,
                    help="below this road distance the ratio test is skipped: OSRM snaps each point to "
                         "the road centreline, so a few metres of snapping noise inflates the ratio on "
                         "pairs that are plainly the same stop")
    ap.add_argument("--dry-run", action="store_true", help="report only, write no CSV")
    args = ap.parse_args()

    rows = list(csv.DictReader(open(args.stops, encoding="utf-8-sig")))
    stops = []
    for i, r in enumerate(rows):
        stops.append({"i": i, "name": (r.get("Name of Stop") or "Stop").strip(),
                      "lat": float(r["Latitude"]), "lng": float(r["Longitude"]),
                      "row": r})
    n = len(stops)
    print(f"{n} stops from {args.stops}")

    # ---- 1. cheap candidate pairs ----
    cands = []
    for i in range(n):
        for j in range(i + 1, n):
            d = hav((stops[i]["lat"], stops[i]["lng"]), (stops[j]["lat"], stops[j]["lng"]))
            if d <= args.radius:
                cands.append((i, j, d))
    print(f"{len(cands)} candidate pairs within {args.radius:.0f} m straight-line")

    # ---- 2. road-check every candidate, both directions ----
    cache = load_cache()
    ok_pairs, rejects = {}, []
    for k, (i, j, straight) in enumerate(cands, 1):
        a = (stops[i]["lat"], stops[i]["lng"])
        b = (stops[j]["lat"], stops[j]["lng"])
        ab, ba = road_m(a, b, cache), road_m(b, a, cache)
        if k % 10 == 0:
            save_cache(cache)
            print(f"  road-checked {k}/{len(cands)}", flush=True)
        if ab is None or ba is None:
            rejects.append({"a": stops[i]["name"], "b": stops[j]["name"], "straight_m": round(straight, 1),
                            "road_m": None, "ratio": None, "reason": "OSRM returned no route"})
            continue
        road = max(ab, ba)
        ratio = road / straight if straight > 0.5 else 1.0
        if road > args.road_cap:
            rejects.append({"a": stops[i]["name"], "b": stops[j]["name"], "straight_m": round(straight, 1),
                            "road_m": round(road), "ratio": round(ratio, 2),
                            "reason": f"road {round(road)} m > cap {args.road_cap:.0f} m"})
            continue
        if ratio > args.ratio_cap and road > args.road_floor:
            rejects.append({"a": stops[i]["name"], "b": stops[j]["name"], "straight_m": round(straight, 1),
                            "road_m": round(road), "ratio": round(ratio, 2),
                            "reason": f"detour ratio {ratio:.2f} > {args.ratio_cap} (different road / Y-junction)"})
            continue
        ok_pairs[(i, j)] = {"straight": straight, "road": road, "ratio": ratio}
    save_cache(cache)
    print(f"{len(ok_pairs)} pairs pass the road check · {len(rejects)} rejected")

    # ---- 3. complete-linkage clusters: every member verified against every other ----
    adj = {i: set() for i in range(n)}
    for (i, j) in ok_pairs:
        adj[i].add(j); adj[j].add(i)
    unused, clusters = set(range(n)), []
    # seed from the most-connected stop so the densest genuine cluster forms first
    for seed in sorted(range(n), key=lambda x: -len(adj[x])):
        if seed not in unused or not adj[seed]:
            continue
        clique = [seed]
        for cand in sorted(adj[seed], key=lambda x: -len(adj[x])):
            if cand in unused and all(cand in adj[m] for m in clique):
                clique.append(cand)
        if len(clique) > 1:
            for m in clique:
                unused.discard(m)
            clusters.append(clique)
    print(f"{len(clusters)} merge clusters absorbing {sum(len(c) - 1 for c in clusters)} stops")

    # ---- 4. anchor = road-distance medoid (minimises the worst walk to the kept stop) ----
    merges, drop = [], set()
    for cl in clusters:
        def worst(m):
            return max(ok_pairs.get((min(m, o), max(m, o)), {"road": 0})["road"] for o in cl if o != m)
        anchor = min(cl, key=lambda m: (worst(m), stops[m]["name"]))
        others = [m for m in cl if m != anchor]
        drop.update(others)
        merges.append({
            "keep": stops[anchor]["name"], "keep_lat": stops[anchor]["lat"], "keep_lng": stops[anchor]["lng"],
            "absorbed": [{"name": stops[m]["name"],
                          "straight_m": round(ok_pairs[(min(anchor, m), max(anchor, m))]["straight"], 1),
                          "road_m": round(ok_pairs[(min(anchor, m), max(anchor, m))]["road"]),
                          "ratio": round(ok_pairs[(min(anchor, m), max(anchor, m))]["ratio"], 2)}
                         for m in others],
        })

    survivors = [s for s in stops if s["i"] not in drop]
    print(f"\n{n} stops -> {len(survivors)} after merge ({len(drop)} absorbed)")

    report = {
        "params": {"radius_m": args.radius, "road_cap_m": args.road_cap, "ratio_cap": args.ratio_cap},
        "stops_before": n, "stops_after": len(survivors), "absorbed": len(drop),
        "candidate_pairs": len(cands), "pairs_passed": len(ok_pairs), "pairs_rejected": len(rejects),
        "merges": merges, "rejects": rejects,
    }
    json.dump(report, open(args.report, "w", encoding="utf-8"), indent=1)
    print(f"wrote {args.report}")

    if args.dry_run:
        print("DRY RUN - no CSV written.")
        return
    fields = list(rows[0].keys())
    with open(args.out, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        for s in survivors:
            w.writerow(s["row"])
    print(f"wrote {args.out}  ({len(survivors)} stops)")


if __name__ == "__main__":
    main()
