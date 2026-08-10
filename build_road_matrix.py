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
# A service routes from its OWN depot and into its OWN matrix file. Zenwear runs from
# Subbulapuram, 59 km south, so it needs both overridden — without --out it would silently
# overwrite the Batlagundu matrix, and without --depot every distance would be measured
# from the wrong factory.


def load_nodes(path, depot=DEPOT):
    """[depot, ...stops] each as {name, lat, lng}. Depot is node 0 (matches optimize.py)."""
    nodes = [{"name": depot[2], "lat": depot[0], "lng": depot[1]}]
    with open(path, encoding="utf-8-sig") as f:
        for r in csv.DictReader(f):
            try:
                lat, lng = float(r["Latitude"]), float(r["Longitude"])
            except (ValueError, KeyError, TypeError):
                continue
            nodes.append({"name": (r.get("Name of Stop") or "Stop").strip(), "lat": lat, "lng": lng})
    return nodes


def save_checkpoint(path, payload):
    """Write the checkpoint so an interruption can never truncate it.

    Streaming straight into `path` means a kill part-way through leaves a half-written
    file where the good one was - which is how one Job B run lost every block it had
    paid for. Write to a sibling temp file, force it to disk, then rename: os.replace
    is atomic on POSIX, so `path` is always either the old checkpoint or the new one.
    """
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(payload, f)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)


def fetch_block(origins, dests, key, tries=5, net_wait=1800.0):
    """One Distance Matrix call for a block of origins x dests. Retries transient failures.

    Losing the link gets a far longer budget than an API-level wobble. A laptop that
    sleeps, moves, or changes wifi comes back after minutes or hours, and five retries
    spanning ~31s throw away an unattended run that was one reconnect from continuing.
    Quota/unknown errors keep the short `tries` budget - those mean the far end is
    unhappy, and hammering it for half an hour helps nobody.
    """
    coords = lambda pts: "|".join(f"{p['lat']},{p['lng']}" for p in pts)
    url = ENDPOINT + "?" + urlencode({
        "origins": coords(origins), "destinations": coords(dests),
        "mode": "driving", "units": "metric", "key": key,
    })
    delay = 1.0
    api_tries = 0
    offline_since = None
    while True:
        try:
            with urlopen(url, timeout=30) as resp:
                data = json.loads(resp.read().decode("utf-8"))
        except (URLError, HTTPError, TimeoutError, http.client.HTTPException, OSError, ValueError) as e:
            now = time.time()
            if offline_since is None:
                offline_since = now
                print(f"\n  network down ({type(e).__name__}: {e})\n"
                      f"  retrying for up to {net_wait/60:.0f} min - progress is safe, "
                      f"nothing is re-bought...", flush=True)
            if now - offline_since >= net_wait:
                raise SystemExit(
                    f"\n\nOffline for {net_wait/60:.0f} min ({type(e).__name__}: {e}).\n"
                    "  Every completed block is checkpointed. Re-run the same command to continue.")
            time.sleep(min(delay, 60.0)); delay = min(delay * 2, 60.0); continue
        if offline_since is not None:
            print(f"  network back after {time.time()-offline_since:.0f}s, continuing.", flush=True)
            offline_since = None
        delay = 1.0
        status = data.get("status")
        if status == "OK":
            return data
        if status in ("OVER_QUERY_LIMIT", "UNKNOWN_ERROR"):
            api_tries += 1
            if api_tries >= tries:
                raise SystemExit(f"\nBlock failed after {tries} tries (last: {status}).")
            time.sleep(delay); delay *= 2; continue
        # REQUEST_DENIED / INVALID_REQUEST etc. are not transient - surface and stop.
        raise SystemExit(f"\nGoogle returned status={status}. {data.get('error_message','')}\n"
                         "  REQUEST_DENIED usually means the key has an HTTP-referrer restriction "
                         "(browser key) or the Distance Matrix API isn't enabled. Use a server key.")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("stops", nargs="?", default="data/bus_stops.csv")
    ap.add_argument("--key", default=os.environ.get("GOOGLE_MAPS_API_KEY", ""))
    ap.add_argument("--go", action="store_true", help="actually spend (default is a dry run)")
    ap.add_argument("--triangle", action="store_true",
                    help="assume a->b == b->a: only request upper-triangle+diagonal blocks and mirror (~half cost)")
    ap.add_argument("--probe", action="store_true", help="make ONE ~free test call, then stop")
    ap.add_argument("--fresh", action="store_true",
                    help="allow building from zero when no checkpoint exists (buys everything)")
    ap.add_argument("--price-per-1000", type=float, default=1.50,
                    help="USD per 1000 elements (India basic Distance Matrix = $1.50; Advanced/traffic = $3.00)")
    ap.add_argument("--free-cap", type=int, default=70000,
                    help="free elements/month for this SKU (India basic Distance Matrix = 70,000)")
    ap.add_argument("--sleep", type=float, default=0.05, help="seconds between calls (rate limit)")
    ap.add_argument("--net-retry-mins", type=float, default=30.0,
                    help="keep retrying through a network outage for this long before giving up")
    ap.add_argument("--depot", default=None, metavar="LAT,LNG,NAME",
                    help="override node 0 (default: the Batlagundu factory)")
    ap.add_argument("--out", default=OUT, help="matrix output path")
    ap.add_argument("--partial", default=PARTIAL, help="checkpoint path")
    args = ap.parse_args()

    depot = DEPOT
    if args.depot:
        parts = args.depot.split(",", 2)
        depot = (float(parts[0]), float(parts[1]), parts[2] if len(parts) > 2 else "DEPOT")
    globals()["PARTIAL"] = args.partial      # checkpoint + output follow the job, not the module
    globals()["OUT"] = args.out
    print(f"Depot: {depot[2]}  {depot[0]}, {depot[1]}")
    print(f"Output: {args.out}   Checkpoint: {args.partial}")

    nodes = load_nodes(args.stops, depot)
    n = len(nodes)
    nb = math.ceil(n / STEP)
    # block index list to request: full grid, or upper-triangle+diagonal blocks (di >= oi) for --triangle
    starts = list(range(0, n, STEP))
    block_pairs = [(oi, di) for oi in starts for di in starts if (not args.triangle or di >= oi)]
    blocks = len(block_pairs)
    sizes = {s: min(STEP, n - s) for s in starts}
    elements = sum(sizes[oi] * sizes[di] for (oi, di) in block_pairs)

    # A checkpoint's blocks are already paid for, so quote what THIS run would spend, not
    # what a rebuild would. Quoting the full figure on a resume makes the estimate useless
    # for deciding whether to press go.
    pre_done = set()
    if os.path.exists(PARTIAL):
        try:
            with open(PARTIAL, encoding="utf-8") as f:
                ck = json.load(f)
            if ck.get("n") == n:
                pre_done = {tuple(b) for b in ck["done"]}
        except (ValueError, OSError, KeyError):
            pre_done = set()          # unreadable: the --go guard reports it properly
    todo = [b for b in block_pairs if b not in pre_done]
    todo_elements = sum(sizes[oi] * sizes[di] for (oi, di) in todo)
    billable = max(0, todo_elements - args.free_cap)
    est = billable / 1000.0 * args.price_per_1000

    print(f"Nodes: {n} (1 depot + {n-1} stops){'   [TRIANGLE mode: a->b==b->a, mirrored]' if args.triangle else ''}")
    print(f"Requests: {blocks}  ({STEP}x{STEP} blocks)   Elements: {elements:,}")
    if pre_done:
        print(f"Checkpoint: {len(pre_done):,} blocks already paid for -> "
              f"{len(todo):,} to fetch, {todo_elements:,} elements")
    print(f"Billable: {billable:,}  ({todo_elements:,} - {args.free_cap:,} free/mo)")
    print(f"Estimated cost: ~${est:,.2f}  (at ${args.price_per_1000:.2f}/1000 elements, India basic Distance Matrix)")
    print("Note: 70,000 elements/mo are free (per-SKU cap); this one-time run is then cached forever.")
    if args.free_cap and pre_done:
        print(f"      If this month's free {args.free_cap:,} is already used, pass --free-cap 0 "
              f"for the true figure (~${todo_elements/1000.0*args.price_per_1000:,.2f}).")

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

    # Resume from checkpoint. Every path that would silently rebuild from zero is fatal
    # instead: starting over re-buys blocks that are already paid for, and the old code
    # did it quietly enough that the only defence was reading the log by eye.
    km = [[0.0] * n for _ in range(n)]
    mins = [[0.0] * n for _ in range(n)]
    done = set()
    if os.path.exists(PARTIAL):
        try:
            with open(PARTIAL, encoding="utf-8") as f:
                ck = json.load(f)
        except (ValueError, OSError) as e:
            raise SystemExit(
                f"\nCheckpoint {PARTIAL} is unreadable ({type(e).__name__}: {e}).\n"
                "  Refusing to run: this would re-buy every block already paid for.\n"
                "  Re-seed it (seed_matrix_append.py) or pass --fresh to rebuild at full cost.")
        if ck.get("n") != n:
            raise SystemExit(
                f"\nCheckpoint {PARTIAL} is for {ck.get('n')} nodes but {args.stops} gives {n}.\n"
                "  Refusing to run: the stops CSV must match the checkpoint exactly or every\n"
                "  paid cell lands at the wrong index. Pass --fresh to rebuild at full cost.")
        km, mins, done = ck["km"], ck["min"], set(tuple(b) for b in ck["done"])
        print(f"\nResuming: {len(done)}/{blocks} blocks already done (no recharge for those).")
    elif not args.fresh:
        raise SystemExit(
            f"\nNo checkpoint at {PARTIAL} - this run would buy all {blocks} blocks.\n"
            "  If that is what you want, re-run with --fresh.")

    t0 = time.time()
    bi = 0
    for (oi, di) in block_pairs:            # full grid, or upper-triangle+diagonal for --triangle
            bi += 1
            if (oi, di) in done:
                continue
            origs, dests = nodes[oi:oi + STEP], nodes[di:di + STEP]
            data = fetch_block(origs, dests, args.key, net_wait=args.net_retry_mins * 60.0)
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
                    if args.triangle and di > oi:   # off-diagonal upper block -> mirror into the lower half
                        km[C][R] = km[R][C]; mins[C][R] = mins[R][C]
            done.add((oi, di))
            save_checkpoint(PARTIAL, {"n": n, "km": km, "min": mins,
                                      "done": [list(b) for b in done]})
            print(f"\r  block {bi}/{blocks}  ({100*bi//blocks}%)  elapsed {time.time()-t0:.0f}s", end="", flush=True)
            time.sleep(args.sleep)

    bad = sum(1 for i in range(n) for j in range(n) if km[i][j] < 0)
    out = {
        "meta": {"source": "google_distance_matrix", "nodes": n, "depot": list(depot[:2]),
                 "depot_name": depot[2], "unreachable_cells": bad},
        "nodes": nodes, "km": km, "min": mins,
    }
    os.makedirs("data", exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f)
    # Served copy for the browser optimiser (fetch('/road_matrix.json')) so it reads the
    # cache instead of firing live Distance Matrix calls. Named after the OUTPUT file, not
    # hardcoded: a second matrix (Zenwear) must not overwrite the main one's served copy.
    os.makedirs("public", exist_ok=True)
    served = os.path.join("public", os.path.basename(OUT))
    with open(served, "w", encoding="utf-8") as f:
        json.dump(out, f)
    if os.path.exists(PARTIAL):
        os.remove(PARTIAL)
    print(f"\n\nWrote {OUT} + {served}  ({n}x{n} matrix). "
          f"Unreachable cells: {bad} (optimize.py will ruler-fill those).")


if __name__ == "__main__":
    main()
