#!/usr/bin/env python3
"""
build_road_geometry.py — pre-cache road-following polylines for the plan's legs.

Mirrors build_road_matrix.py, but stores GEOMETRY (the actual road path) instead of
distances. For every consecutive leg used in public/solver_result.json (depot -> first
stop, and each stop -> next stop), fetch the road path from the keyless OSRM demo server
and cache it to public/road_geometry.json. The editors read this for instant real-road
routes; legs not in the cache (created by edits) are fetched on-demand in the browser.

Key   = "lat,lng|lat,lng" (each rounded to 5 dp, drop -> pickup order).
Value = [[lat,lng], ...] simplified polyline, or null if OSRM had no route.

Run:  python build_road_geometry.py            (resumes; skips legs already cached)
"""
import json, os, sys, time, ssl, urllib.request, urllib.error

# macOS system Python often lacks CA certs → SSL verify fails for every call. This is a local
# one-off build script hitting a known public routing API, so skip verification.
_CTX = ssl.create_default_context()
_CTX.check_hostname = False
_CTX.verify_mode = ssl.CERT_NONE

ROOT = os.path.dirname(os.path.abspath(__file__))
SOLVER = os.path.join(ROOT, "public", "solver_result.json")
MATRIX = os.path.join(ROOT, "public", "road_matrix.json")
OUT = os.path.join(ROOT, "public", "road_geometry.json")
OSRM = "https://router.project-osrm.org/route/v1/driving/{lng1},{lat1};{lng2},{lat2}?overview=simplified&geometries=geojson"

def key(a, b):
    return f"{a[0]:.5f},{a[1]:.5f}|{b[0]:.5f},{b[1]:.5f}"

def fetch(a, b, retries=3):
    url = OSRM.format(lng1=a[1], lat1=a[0], lng2=b[1], lat2=b[0])
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(url, timeout=20, context=_CTX) as r:
                d = json.load(r)
            if d.get("code") != "Ok" or not d.get("routes"):
                return None
            coords = d["routes"][0]["geometry"]["coordinates"]  # [lng,lat]
            return [[round(c[1], 5), round(c[0], 5)] for c in coords]
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as e:
            if attempt == retries - 1:
                print(f"  ! {a}->{b}: {e}")
                return "FAIL"
            time.sleep(1.5 * (attempt + 1))
    return "FAIL"

def main():
    solver = json.load(open(SOLVER))
    depot = json.load(open(MATRIX))["nodes"][0]           # node 0 = factory
    dep = (depot["lat"], depot["lng"])

    # collect the unique directed legs used across every route (depot->first, inter-stop)
    legs = {}
    for r in solver["routes"]:
        seq = r.get("seq", [])
        prev = dep
        for s in seq:
            cur = (s["lat"], s["lng"])
            legs[key(prev, cur)] = (prev, cur)
            prev = cur

    cache = {}
    if os.path.exists(OUT):
        cache = json.load(open(OUT))
        print(f"resuming — {len(cache)} legs already cached")

    todo = [k for k in legs if k not in cache]
    print(f"{len(legs)} unique legs, {len(todo)} to fetch from OSRM ...")
    done = 0
    for k in todo:
        a, b = legs[k]
        geo = fetch(a, b)
        if geo == "FAIL":
            continue                                       # leave uncached; browser falls back
        cache[k] = geo                                     # geo may be None (no route) — cache it
        done += 1
        if done % 25 == 0:
            json.dump(cache, open(OUT, "w"))               # checkpoint
            print(f"  {done}/{len(todo)} cached ...")
        time.sleep(0.15)                                   # be gentle on the demo server

    json.dump(cache, open(OUT, "w"))
    size = os.path.getsize(OUT) / 1024
    print(f"done — {len(cache)}/{len(legs)} legs cached, {size:.0f} KB -> {OUT}")

if __name__ == "__main__":
    main()
