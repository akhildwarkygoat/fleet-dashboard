#!/usr/bin/env python3
"""
build_road_matrix.py - one-time builder for the cached Google road-distance matrix.

Reads the stops CSV (depot + stops), calls the Google Distance Matrix WEB SERVICE in
10x10 element blocks, and writes data/road_matrix.json with real driving km + minutes
between every pair of nodes. optimize.py reads that file instead of the haversine ruler.

SAFETY: by default this is a DRY RUN - it prints the request/element count and an $ estimate
and makes ZERO paid calls. You must pass --go to actually spend. Progress is checkpointed
to data/road_matrix.partial.json after every block, so a crash/quota hiccup resumes for free.

The key must be a SERVER key (no HTTP-referrer restriction) with the Distance Matrix API
enabled. A browser/referrer-restricted key returns REQUEST_DENIED for web-service calls.

Usage:
  python build_road_matrix.py                       # dry run: estimate only, no calls
  python build_road_matrix.py --probe --key KEY     # one ~free test call to verify the key
  python build_road_matrix.py --go --key KEY        # the real run (spends); resumable
  (or set the key once:  export GOOGLE_MAPS_API_KEY=...   /   $env:GOOGLE_MAPS_API_KEY=...)
"""
import csv, json, os, sys, time, math, argparse, http.client
from urllib.parse import urlencode
from urllib.request import urlopen
from urllib.error import URLError, HTTPError

DEPOT = (10.207550, 77.806206, "FACTORY (depot)")
ENDPOINT = "https://maps.googleapis.com/maps/api/distancematrix/json"
STEP = 10                      # 10x10 = 100 elements/request = Google's per-request max
PARTIAL = "data/road_matrix.partial.json"
OUT = "data/road_matrix.json"


def load_nodes(path):
    """[depot, ...stops] each as {name, lat, lng}. Depot is node 0 (matches optimize.py)."""
    nodes = [{"name": DEPOT[2], "lat": DEPOT[0], "lng": DEPOT[1]}]
    with open(path, encoding="utf-8-sig") as f:
        for r in csv.DictReader(f):
            try:
                lat, lng = float(r["Latitude"]), float(r["Longitude"])
            except (ValueError, KeyError, TypeError):
                continue
            nodes.append({"name": (r.get("Name of Stop") or "Stop").strip(), "lat": lat, "lng": lng})
    return nodes


def fetch_block(origins, dests, key, tries=5):
    """One Distance Matrix call for a block of origins x dests. Retries transient failures."""
    coords = lambda pts: "|".join(f"{p['lat']},{p['lng']}" for p in pts)
    url = ENDPOINT + "?" + urlencode({
        "origins": coords(origins), "destinations": coords(dests),
        "mode": "driving", "units": "metric", "key": key,
    })
    delay = 1.0
    last = None
    for _ in range(tries):
        try:
            with urlopen(url, timeout=30) as resp:
                data = json.loads(resp.read().decode("utf-8"))
        except (URLError, HTTPError, TimeoutError, http.client.HTTPException, OSError, ValueError) as e:
            last = f"network: {type(e).__name__}: {e}"; time.sleep(delay); delay *= 2; continue
        status = data.get("status")
        if status == "OK":
            return data
        if status in ("OVER_QUERY_LIMIT", "UNKNOWN_ERROR"):
            last = status; time.sleep(delay); delay *= 2; continue
        # REQUEST_DENIED / INVALID_REQUEST etc. are not transient - surface and stop.
        raise SystemExit(f"\nGoogle returned status={status}. {data.get('error_message','')}\n"
                         "  REQUEST_DENIED usually means the key has an HTTP-referrer restriction "
                         "(browser key) or the Distance Matrix API isn't enabled. Use a server key.")
    raise SystemExit(f"\nBlock failed after {tries} tries (last: {last}).")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("stops", nargs="?", default="data/bus_stops.csv")
    ap.add_argument("--key", default=os.environ.get("GOOGLE_MAPS_API_KEY", ""))
    ap.add_argument("--go", action="store_true", help="actually spend (default is a dry run)")
    ap.add_argument("--probe", action="store_true", help="make ONE ~free test call, then stop")
    ap.add_argument("--price-per-1000", type=float, default=5.0, help="USD per 1000 elements")
    ap.add_argument("--sleep", type=float, default=0.05, help="seconds between calls (rate limit)")
    args = ap.parse_args()

    nodes = load_nodes(args.stops)
    n = len(nodes)
    blocks = math.ceil(n / STEP) ** 2
    elements = n * n
    est = elements / 1000.0 * args.price_per_1000

    print(f"Nodes: {n} (1 depot + {n-1} stops)")
    print(f"Requests: {blocks}  ({STEP}x{STEP} blocks)   Elements billed: {elements:,}")
    print(f"Estimated cost: ~${est:,.2f}  (at ${args.price_per_1000:.2f}/1000 elements, no traffic)")
    print("Note: Google gives a $200/mo free credit; this one-time run is then cached forever.")

    if args.probe:
        if not args.key:
            raise SystemExit("--probe needs --key (or GOOGLE_MAPS_API_KEY).")
        print("\nPROBE: one origin x one destination (~free)...")
        d = fetch_block([nodes[0]], [nodes[1]], args.key)
        el = d["rows"][0]["elements"][0]
        if el.get("status") == "OK":
            print(f"  OK - {nodes[0]['name']} -> {nodes[1]['name']}: "
                  f"{el['distance']['value']/1000:.1f} km / {el['duration']['value']/60:.0f} min")
            print("  Key works server-side. Re-run with --go to build the full matrix.")
        else:
            print(f"  Element status: {el.get('status')} - check coordinates / API enablement.")
        return

    if not args.go:
        print("\nDRY RUN - no calls made, nothing spent. Re-run with --go --key KEY to build for real.")
        return

    if not args.key:
        raise SystemExit("--go needs --key (or GOOGLE_MAPS_API_KEY).")

    # resume from checkpoint if present
    km = [[0.0] * n for _ in range(n)]
    mins = [[0.0] * n for _ in range(n)]
    done = set()
    if os.path.exists(PARTIAL):
        with open(PARTIAL, encoding="utf-8") as f:
            ck = json.load(f)
        if ck.get("n") == n:
            km, mins, done = ck["km"], ck["min"], set(tuple(b) for b in ck["done"])
            print(f"\nResuming: {len(done)}/{blocks} blocks already done (no recharge for those).")

    t0 = time.time()
    bi = 0
    for oi in range(0, n, STEP):
        for di in range(0, n, STEP):
            bi += 1
            if (oi, di) in done:
                continue
            origs, dests = nodes[oi:oi + STEP], nodes[di:di + STEP]
            data = fetch_block(origs, dests, args.key)
            for ri, row in enumerate(data["rows"]):
                for ci, el in enumerate(row["elements"]):
                    R, C = oi + ri, di + ci
                    if R == C:
                        km[R][C] = 0.0; mins[R][C] = 0.0
                    elif el.get("status") == "OK":
                        km[R][C] = el["distance"]["value"] / 1000.0
                        mins[R][C] = el["duration"]["value"] / 60.0
                    else:                       # NOT_FOUND / ZERO_RESULTS -> mark; optimize.py falls back
                        km[R][C] = -1.0; mins[R][C] = -1.0
            done.add((oi, di))
            with open(PARTIAL, "w", encoding="utf-8") as f:
                json.dump({"n": n, "km": km, "min": mins, "done": [list(b) for b in done]}, f)
            print(f"\r  block {bi}/{blocks}  ({100*bi//blocks}%)  elapsed {time.time()-t0:.0f}s", end="", flush=True)
            time.sleep(args.sleep)

    bad = sum(1 for i in range(n) for j in range(n) if km[i][j] < 0)
    out = {
        "meta": {"source": "google_distance_matrix", "nodes": n, "depot": list(DEPOT[:2]),
                 "unreachable_cells": bad},
        "nodes": nodes, "km": km, "min": mins,
    }
    os.makedirs("data", exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f)
    # also drop a served copy in public/ so the browser optimiser reads the cache
    # (fetch('/road_matrix.json')) instead of firing live Distance Matrix calls.
    os.makedirs("public", exist_ok=True)
    with open(os.path.join("public", "road_matrix.json"), "w", encoding="utf-8") as f:
        json.dump(out, f)
    if os.path.exists(PARTIAL):
        os.remove(PARTIAL)
    print(f"\n\nWrote {OUT} + public/road_matrix.json  ({n}x{n} matrix). "
          f"Unreachable cells: {bad} (optimize.py will ruler-fill those).")


if __name__ == "__main__":
    main()
