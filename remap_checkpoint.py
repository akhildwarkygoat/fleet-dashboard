#!/usr/bin/env python3
"""
remap_checkpoint.py - rebuild the Job B checkpoint after stops were merged away.

Merging shortens the node list, which renumbers every node after the first removal. The
paid cells are keyed by index, so a naive rebuild would throw away everything bought so
far. Nothing needs re-buying though: a cell is a distance between two PLACES, and the
places that survive keep their distances. This maps old indices to new ones and carries
every paid cell across.

A block is marked done only when EVERY cell in it is known, where "known" is read from
the old checkpoint's `done` block list rather than sniffed from the values (0.0 is both
"not bought" and a legitimate diagonal, so values cannot be trusted).

Usage:
  python3 remap_checkpoint.py --old data/road_matrix_jobB.partial.json \
     --base data/road_matrix.PRE-JOBB.json \
     --orig data/new_stops_jobB.csv --merged data/new_stops_jobB.merged.csv \
     --out-partial data/road_matrix_jobB.merged.partial.json \
     --out-csv data/bus_stops_jobB.merged.csv [--apply]
"""
import csv, json, math, os, argparse

STEP = 10


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--old", default="data/road_matrix_jobB.partial.json")
    ap.add_argument("--base", default="data/road_matrix.PRE-JOBB.json")
    ap.add_argument("--orig", default="data/new_stops_jobB.csv")
    ap.add_argument("--merged", default="data/new_stops_jobB.merged.csv")
    ap.add_argument("--out-partial", default="data/road_matrix_jobB.merged.partial.json")
    ap.add_argument("--out-csv", default="data/bus_stops_jobB.merged.csv")
    ap.add_argument("--apply", action="store_true", help="write the files (default: report only)")
    args = ap.parse_args()

    base = json.load(open(args.base, encoding="utf-8"))
    O = len(base["nodes"])                       # 761 carried-over nodes, indices unchanged
    orig = list(csv.DictReader(open(args.orig, encoding="utf-8-sig")))
    kept = list(csv.DictReader(open(args.merged, encoding="utf-8-sig")))

    # coordinates are unique across the new stops (verified), so they identify a row
    key = lambda r: (r["Latitude"].strip(), r["Longitude"].strip())
    orig_ix = {key(r): i for i, r in enumerate(orig)}
    if len(orig_ix) != len(orig):
        raise SystemExit("duplicate coordinates in the original stops - cannot map rows safely")

    old_of_new = list(range(O))                  # new index -> old index
    for r in kept:
        k = key(r)
        if k not in orig_ix:
            raise SystemExit(f"merged row {k} is not present in {args.orig}")
        old_of_new.append(O + orig_ix[k])
    N = len(old_of_new)

    ck = json.load(open(args.old, encoding="utf-8"))
    OLD_N = ck["n"]
    if OLD_N != O + len(orig):
        raise SystemExit(f"checkpoint n={OLD_N} but base+orig = {O + len(orig)}")
    old_done = {tuple(b) for b in ck["done"]}
    okm, omin = ck["km"], ck["min"]

    def known(R, C):
        bR, bC = (R // STEP) * STEP, (C // STEP) * STEP
        return (min(bR, bC), max(bR, bC)) in old_done

    km = [[0.0] * N for _ in range(N)]
    mins = [[0.0] * N for _ in range(N)]
    kn = [[False] * N for _ in range(N)]
    for r in range(N):
        R = old_of_new[r]
        for c in range(N):
            C = old_of_new[c]
            if known(R, C):
                km[r][c] = okm[R][C]
                mins[r][c] = omin[R][C]
                kn[r][c] = True

    starts = list(range(0, N, STEP))
    sizes = {s: min(STEP, N - s) for s in starts}
    tri = [(o, d) for o in starts for d in starts if d >= o]
    done = []
    for (o, d) in tri:
        if all(kn[r][c] for r in range(o, o + sizes[o]) for c in range(d, d + sizes[d])):
            done.append([o, d])
    todo = [b for b in tri if list(b) not in done]
    elements = sum(sizes[o] * sizes[d] for o, d in todo)

    old_tri = len([1 for o in range(0, OLD_N, STEP) for d in range(0, OLD_N, STEP) if d >= o])
    print(f"nodes      {OLD_N} -> {N}   ({len(orig)} new stops -> {len(kept)})")
    print(f"blocks     {len(old_done):,}/{old_tri:,} done before  ->  {len(done):,}/{len(tri):,} done after")
    print(f"carried    {len(done):,} blocks kept without re-buying")
    print(f"remaining  {len(todo):,} blocks = {elements:,} elements = ~${elements*1.5/1000:,.2f}")
    full = sum(sizes[o] * sizes[d] for o, d in tri)
    print(f"(rebuilding this matrix from scratch would be {full:,} elements "
          f"= ~${full*1.5/1000:,.2f}, so the carry-over saves ~${(full-elements)*1.5/1000:,.2f})")

    if not args.apply:
        print("\nREPORT ONLY - nothing written. Re-run with --apply.")
        return

    nodes_out = base["nodes"] + [{"name": (r.get("Name of Stop") or "Stop").strip(),
                                  "lat": float(r["Latitude"]), "lng": float(r["Longitude"])}
                                 for r in kept]
    tmp = args.out_partial + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump({"n": N, "km": km, "min": mins, "done": done}, f)
    os.replace(tmp, args.out_partial)
    print(f"wrote {args.out_partial}")

    with open(args.out_csv, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["Name of Stop", "Latitude", "Longitude", "MatrixIdx"])
        for i, nd in enumerate(nodes_out[1:], start=1):
            w.writerow([nd["name"], f'{nd["lat"]:.7f}', f'{nd["lng"]:.7f}', i])
    print(f"wrote {args.out_csv}  ({N-1} stops -> load_nodes gives {N})")


if __name__ == "__main__":
    main()
