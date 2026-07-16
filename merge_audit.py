#!/usr/bin/env python3
"""
merge_audit.py — 200 m stop merge + road-distance sanity check.

The 200 m "walk" merge is straight-line, but 200 m as-the-crow-flies can cross a Y-junction /
river / dual carriageway, so two stops that look mergeable are actually far apart on the road.

This script:
  1. loads the 962 un-merged stops (data/stops_live.json),
  2. does the 200 m straight-line merge ("crowd wins": smaller stops merge into the nearest
     already-established larger anchor within 200 m; anchors keep their own coordinates),
  3. for every merged stop, measures the REAL road distance to its anchor via OSRM (free),
  4. flags merges as SUSPECT when the road distance is much larger than the straight-line
     (the Y-road problem), so they can be reviewed / un-merged,
  5. writes:
       data/merge_audit.json    — anchors, members, straight vs road distance, suspect flag
       public/merge_map.html reads this to plot everything.

Run:  python merge_audit.py [--radius 200] [--suspect-road 300]
"""
import json, math, os, ssl, time, argparse, urllib.request, urllib.error

_CTX = ssl.create_default_context(); _CTX.check_hostname = False; _CTX.verify_mode = ssl.CERT_NONE
OSRM_TABLE = "https://router.project-osrm.org/table/v1/driving/{coords}?sources=0&annotations=distance"


def hav_m(a, b):
    R = 6371000.0
    la1, ln1, la2, ln2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    d1, d2 = la2 - la1, ln2 - ln1
    h = math.sin(d1 / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin(d2 / 2) ** 2
    return 2 * R * math.asin(math.sqrt(h))


def osrm_dist_from_anchor(anchor, members, tries=3):
    """Road distances (m) from anchor to each member, in one OSRM table call (sources=0)."""
    pts = [anchor] + members
    coords = ";".join(f"{p[1]},{p[0]}" for p in pts)  # lng,lat
    url = OSRM_TABLE.format(coords=coords)
    for attempt in range(tries):
        try:
            with urllib.request.urlopen(url, timeout=25, context=_CTX) as r:
                d = json.load(r)
            if d.get("code") != "Ok":
                return [None] * len(members)
            row = d["distances"][0]  # anchor -> everyone
            return [row[i + 1] for i in range(len(members))]
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
            if attempt == tries - 1:
                return [None] * len(members)
            time.sleep(1.2 * (attempt + 1))
    return [None] * len(members)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--radius", type=float, default=200.0, help="straight-line merge radius (m)")
    ap.add_argument("--suspect-road", type=float, default=300.0, help="flag if road distance to anchor exceeds this (m)")
    args = ap.parse_args()

    data = json.load(open("data/stops_live.json"))
    stops = data["stops"]
    for i, s in enumerate(stops):
        s["id"] = i
    # crowd wins: process biggest first; each becomes an anchor unless it sits within radius of one
    order = sorted(stops, key=lambda s: -s["headcount"])
    anchors = []  # list of stop dicts, each gets ["members"]=[...]
    for s in order:
        best, bestd = None, args.radius
        for a in anchors:
            d = hav_m((s["lat"], s["lng"]), (a["lat"], a["lng"]))
            if d <= bestd:
                best, bestd = a, d
        if best is None:
            s["members"] = []
            anchors.append(s)
        else:
            best["members"].append({**s, "straight_m": round(bestd, 1)})

    # road-distance check for every merged member (batched per anchor via OSRM)
    merges = [a for a in anchors if a["members"]]
    total_members = sum(len(a["members"]) for a in merges)
    print(f"{len(stops)} stops -> {len(anchors)} after {args.radius:.0f} m merge "
          f"({total_members} stops merged into {len(merges)} anchors)")
    print(f"Road-checking {total_members} merges via OSRM (free) ...")

    checked = 0
    for a in merges:
        mem_pts = [(m["lat"], m["lng"]) for m in a["members"]]
        roads = osrm_dist_from_anchor((a["lat"], a["lng"]), mem_pts)
        for m, rd in zip(a["members"], roads):
            m["road_m"] = round(rd, 1) if rd is not None else None
            m["ratio"] = round(rd / m["straight_m"], 2) if (rd and m["straight_m"]) else None
            m["suspect"] = bool(rd is not None and rd > args.suspect_road)
        checked += len(a["members"])
        print(f"\r  {checked}/{total_members} checked ...", end="", flush=True)
        time.sleep(0.12)
    print()

    # build audit records
    audit_anchors = []
    suspects = []
    for a in anchors:
        rec = {"id": a["id"], "name": a["name"], "lat": a["lat"], "lng": a["lng"],
               "headcount": a["headcount"], "members": []}
        for m in a["members"]:
            mm = {"id": m["id"], "name": m["name"], "lat": m["lat"], "lng": m["lng"],
                  "headcount": m["headcount"], "straight_m": m["straight_m"],
                  "road_m": m["road_m"], "ratio": m["ratio"], "suspect": m["suspect"]}
            rec["members"].append(mm)
            if m["suspect"]:
                suspects.append({"anchor": a["name"], **mm})
        audit_anchors.append(rec)

    roads_known = [m for a in anchors for m in a["members"] if m.get("road_m")]
    out = {
        "meta": {"radius_m": args.radius, "suspect_road_m": args.suspect_road,
                 "stops_in": len(stops), "stops_out": len(anchors),
                 "merged": total_members, "suspect_merges": len(suspects),
                 "road_checked": len(roads_known)},
        "depot": data.get("depot"),
        "anchors": audit_anchors,
    }
    os.makedirs("public", exist_ok=True)
    json.dump(out, open("public/merge_audit.json", "w"))
    json.dump(out, open("data/merge_audit.json", "w"), indent=1)

    # summary
    if roads_known:
        rs = sorted(m["road_m"] for m in roads_known)
        med = rs[len(rs) // 2]
        print(f"\nMerged stops road-checked: {len(roads_known)}")
        print(f"  median road distance to anchor: {med:.0f} m")
        print(f"  SUSPECT (road > {args.suspect_road:.0f} m): {len(suspects)}  "
              f"({100*len(suspects)//max(1,len(roads_known))}% of merges)")
        worst = sorted(suspects, key=lambda x: -(x["road_m"] or 0))[:8]
        if worst:
            print("  worst offenders (straight vs road):")
            for w in worst:
                print(f"    {w['name'][:28]:28} straight {w['straight_m']:.0f} m  ->  road {w['road_m']:.0f} m  (x{w['ratio']})")
    print(f"\nWrote public/merge_audit.json + data/merge_audit.json  ({len(anchors)} merged stops)")


if __name__ == "__main__":
    main()
