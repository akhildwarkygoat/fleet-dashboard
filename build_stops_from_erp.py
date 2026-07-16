#!/usr/bin/env python3
"""
build_stops_from_erp.py — turn the live ERP employee GPS into a consolidated stop network.

The ERP feed (VehicleEmpMapDetails) gives ONE row per (employee, date) with the employee's
home GPS, locality and attendance. This script:
  1. takes the latest day's roster (the current headcount),
  2. computes each employee's absentee rate across ALL days in the feed,
  3. greedily clusters home GPS points within MERGE_M metres into shared stops
     (mirrors the earlier "<=200 m walk" merge rule that produced the 691-stop network),
  4. names each stop by its most common Locality / Village / Area,
  5. writes:
       data/stops_live.json  — rich stops (name, lat, lng, headcount, absentee, company)
       data/bus_stops.csv    — the exact input build_road_matrix.py reads

Employees with no GPS (blank / 0) can't be placed and are reported, not dropped silently.

Run:  python build_stops_from_erp.py [--merge-m 200] [--in data/erp_live.json]
"""
import json, csv, os, math, argparse
from collections import Counter, defaultdict

DEPOT = (10.207550, 77.806206)  # FACTORY — must match build_road_matrix.py / optimize.py


def norm_date(s):
    return (s or "").strip()


def haversine_m(a, b):
    R = 6371000.0
    lat1, lng1, lat2, lng2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    dlat, dlng = lat2 - lat1, lng2 - lng1
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlng / 2) ** 2
    return 2 * R * math.asin(math.sqrt(h))


def valid_gps(r):
    la, ln = (r.get("Latitude") or "").strip(), (r.get("Longitude") or "").strip()
    if not la or not ln or la == "0" or ln == "0":
        return None
    try:
        return (round(float(la), 6), round(float(ln), 6))
    except ValueError:
        return None


def unit_of(compname):
    return "Technotek" if "technotek" in (compname or "").lower() else "Gainup"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="inp", default="data/erp_live.json")
    ap.add_argument("--merge-m", type=float, default=200.0, help="merge homes within this many metres into one stop")
    ap.add_argument("--scope", choices=["latest", "all"], default="all",
                    help="'all' = union of every employee across all days (recovers people absent today); 'latest' = today's roster only")
    args = ap.parse_args()

    rows = json.load(open(args.inp))
    dates = sorted({norm_date(r.get("date")) for r in rows if norm_date(r.get("date"))})
    latest = dates[-1]

    # per-employee attendance across ALL days → absentee rate
    att = defaultdict(lambda: [0, 0])  # empno -> [present, absent]
    for r in rows:
        emp = (r.get("Empl_no") or "").strip()
        if not emp:
            continue
        if "present" in (r.get("Att_Type") or "").lower():
            att[emp][0] += 1
        else:
            att[emp][1] += 1

    def absentee(emp):
        p, a = att[emp]
        tot = p + a
        return round(a / tot, 3) if tot else 0.0

    # Per employee, keep the most-recent row that has usable GPS. In --scope all this spans every
    # day, so someone whose GPS is blank today but present on an earlier day is still placed.
    best = {}          # emp -> (date, row, gps)
    all_emps = set()   # every distinct employee in scope (with or without GPS)
    for r in rows:
        dt = norm_date(r.get("date"))
        if args.scope == "latest" and dt != latest:
            continue
        emp = (r.get("Empl_no") or "").strip()
        if not emp:
            continue
        all_emps.add(emp)
        g = valid_gps(r)
        if g is None:
            continue
        prev = best.get(emp)
        if prev is None or dt > prev[0]:
            best[emp] = (dt, r, g)

    roster = []
    for emp, (dt, r, g) in best.items():
        roster.append({
            "emp": emp, "lat": g[0], "lng": g[1],
            "locality": (r.get("Locality") or "").strip(),
            "village": (r.get("Village") or "").strip(),
            "area": (r.get("Area") or "").strip(),
            "unit": unit_of(r.get("Compname")),
            "absentee": absentee(emp),
        })
    no_gps = len(all_emps) - len(best)

    # greedy clustering: assign each home to the nearest existing stop within merge_m, else new stop
    stops = []  # each: {lat,lng,members:[...]}
    for e in roster:
        best, bestd = None, args.merge_m
        for s in stops:
            d = haversine_m((e["lat"], e["lng"]), (s["lat"], s["lng"]))
            if d <= bestd:
                best, bestd = s, d
        if best is None:
            stops.append({"lat": e["lat"], "lng": e["lng"], "members": [e]})
        else:
            best["members"].append(e)
            # nudge stop centre toward the running centroid
            m = best["members"]
            best["lat"] = round(sum(x["lat"] for x in m) / len(m), 6)
            best["lng"] = round(sum(x["lng"] for x in m) / len(m), 6)

    # finalise stop records
    def mode(vals):
        vals = [v for v in vals if v]
        return Counter(vals).most_common(1)[0][0] if vals else ""

    rich = []
    for i, s in enumerate(stops, 1):
        m = s["members"]
        name = mode([x["locality"] for x in m]) or mode([x["village"] for x in m]) \
            or (mode([x["area"] for x in m]).split(",")[0] if any(x["area"] for x in m) else "") \
            or f"Stop {i}"
        units = Counter(x["unit"] for x in m)
        rich.append({
            "name": name,
            "lat": s["lat"], "lng": s["lng"],
            "headcount": len(m),
            "absentee": round(sum(x["absentee"] for x in m) / len(m), 3),
            "company": "Gainup & Technotek" if len(units) > 1 else next(iter(units)),
        })
    rich.sort(key=lambda r: (-r["headcount"], r["name"]))

    os.makedirs("data", exist_ok=True)
    json.dump({
        "meta": {"source": "erp_VehicleEmpMapDetails", "scope": args.scope, "latest_date": latest, "merge_m": args.merge_m,
                 "distinct_employees": len(all_emps), "employees_placed": len(roster), "employees_no_gps": no_gps,
                 "stops": len(rich), "depot": list(DEPOT)},
        "depot": {"name": "FACTORY", "lat": DEPOT[0], "lng": DEPOT[1]},
        "stops": rich,
    }, open("data/stops_live.json", "w"), indent=1)

    with open("data/bus_stops.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["Name of Stop", "Latitude", "Longitude", "Headcount", "Absentee", "Company"])
        for r in rich:
            w.writerow([r["name"], r["lat"], r["lng"], r["headcount"], r["absentee"], r["company"]])

    total_head = sum(r["headcount"] for r in rich)
    n = len(rich) + 1  # + depot
    print(f"Scope: {args.scope}  (latest day {latest}, {len(dates)} days in feed)")
    print(f"Distinct employees: {len(all_emps)}   |   placed: {len(roster)}   |   no GPS on any day (excluded): {no_gps}")
    print(f"Stops after {args.merge_m:.0f} m merge: {len(rich)}   |   riders covered: {total_head}")
    print(f"Matrix nodes (incl depot): {n}  ->  {n*n:,} elements  (~${n*n/1000*5:,.0f} on Google at $5/1000)")
    print("Wrote data/stops_live.json + data/bus_stops.csv")


if __name__ == "__main__":
    main()
