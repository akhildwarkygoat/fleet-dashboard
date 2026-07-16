#!/usr/bin/env python3
"""
build_erp_routes.py — reconstruct the CURRENT real bus routes from the live ERP.

From VehicleEmpMapDetails (latest day) we know which employees ride which vehicle and their
home GPS. We do NOT know the travel order (the ERP has no sequence), so per vehicle we:
  1. cluster its GPS employees into stops (200 m); keep each stop's employees (name + village),
  2. infer a visiting order (nearest-neighbour from the factory) — APPROXIMATE,
  3. fetch the REAL road-following path through depot + stops (free OSRM route service),
  4. emit public/current_routes.json for the preview map (with per-stop employee members).

Owned vs rental from the Type field. Employees without GPS can't be placed (reported per bus).
"""
import json, math, ssl, time, argparse, urllib.request, urllib.error
from collections import defaultdict, Counter

DEPOT = (10.207550, 77.806206)
MERGE_M = 200.0  # overridden by --merge-m (0 = un-merged: every distinct home GPS is its own stop)
CTX = ssl.create_default_context(); CTX.check_hostname = False; CTX.verify_mode = ssl.CERT_NONE


def norm(s): return (s or "").strip()


def hav(a, b):
    R = 6371000.0
    la1, ln1, la2, ln2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    d1, d2 = la2 - la1, ln2 - ln1
    h = math.sin(d1 / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin(d2 / 2) ** 2
    return 2 * R * math.asin(math.sqrt(h))


def gps(r):
    la, ln = norm(r.get("Latitude")), norm(r.get("Longitude"))
    if not la or not ln or la == "0" or ln == "0":
        return None
    try:
        return (round(float(la), 6), round(float(ln), 6))
    except ValueError:
        return None


def unit_of(c): return "Technotek" if "technotek" in (c or "").lower() else "Gainup"


def osrm_route(waypts, tries=3):
    """real road route via free OSRM -> {points:[[lat,lng]], km, trip_min}; None on failure."""
    coords = ";".join(f"{p[1]},{p[0]}" for p in waypts)  # lng,lat
    url = f"https://router.project-osrm.org/route/v1/driving/{coords}?overview=full&geometries=geojson"
    for a in range(tries):
        try:
            with urllib.request.urlopen(url, timeout=30, context=CTX) as r:
                d = json.load(r)
            if d.get("code") != "Ok" or not d.get("routes"):
                return None
            rt = d["routes"][0]
            return {"points": [[round(c[1], 5), round(c[0], 5)] for c in rt["geometry"]["coordinates"]],
                    "km": round(rt.get("distance", 0) / 1000, 1), "trip_min": round(rt.get("duration", 0) / 60)}
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
            if a == tries - 1:
                return None
            time.sleep(1.2 * (a + 1))
    return None


def cluster(emps):
    """greedy 200 m clusters -> [{lat,lng,name,members:[{name,village}]}]"""
    stops = []
    for e in emps:
        best, bd = None, MERGE_M
        for s in stops:
            d = hav(e["g"], (s["lat"], s["lng"]))
            if d <= bd:
                best, bd = s, d
        if best is None:
            stops.append({"lat": e["g"][0], "lng": e["g"][1], "members": [e]})
        else:
            best["members"].append(e)
            m = best["members"]
            best["lat"] = round(sum(x["g"][0] for x in m) / len(m), 6)
            best["lng"] = round(sum(x["g"][1] for x in m) / len(m), 6)
    out = []
    for s in stops:
        m = s["members"]
        loc = Counter(x["loc"] for x in m if x["loc"]).most_common(1)
        out.append({"lat": s["lat"], "lng": s["lng"], "name": (loc[0][0] if loc else "Stop"),
                    "hc": len(m), "members": [{"name": x["nm"], "village": x["vil"]} for x in m]})
    return out


def nn_order(stops):
    rem, seq, cur = stops[:], [], DEPOT
    while rem:
        j = min(range(len(rem)), key=lambda i: hav(cur, (rem[i]["lat"], rem[i]["lng"])))
        s = rem.pop(j); s["order"] = len(seq) + 1; seq.append(s); cur = (s["lat"], s["lng"])
    return seq


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--merge-m", type=float, default=200.0, help="cluster homes within this many metres (0 = un-merged, every distinct GPS is a stop)")
    args = ap.parse_args()
    global MERGE_M
    MERGE_M = args.merge_m
    rows = json.load(open("data/erp_live.json"))
    latest = sorted({norm(r.get("date")) for r in rows if norm(r.get("date"))})[-1]

    veh = defaultdict(lambda: {"emps": {}, "type": "", "seat": Counter(), "unit": Counter()})
    for r in rows:
        if norm(r.get("date")) != latest:
            continue
        v = norm(r.get("VehName") or r.get("Veh_Mas")); e = norm(r.get("Empl_no"))
        if not v or not e or e in veh[v]["emps"]:
            continue
        veh[v]["emps"][e] = {"g": gps(r), "loc": norm(r.get("Locality")) or norm(r.get("Village")),
                             "nm": norm(r.get("Name")), "vil": norm(r.get("Village")) or norm(r.get("Locality"))}
        if r.get("Type"):
            veh[v]["type"] = "rental" if "rent" in r["Type"].lower() else "owned"
        s = norm(r.get("Seat") or r.get("Seat_New"))
        if s and s != "0":
            veh[v]["seat"][s] += 1
        veh[v]["unit"][unit_of(r.get("Compname"))] += 1

    buses = []
    items = list(veh.items())
    for bi, (v, info) in enumerate(items, 1):
        placed = [e for e in info["emps"].values() if e["g"]]
        stops = nn_order(cluster(placed)) if placed else []
        ro = osrm_route([DEPOT] + [(s["lat"], s["lng"]) for s in stops]) if stops else None
        buses.append({
            "name": v, "type": info["type"] or "owned",
            "unit": info["unit"].most_common(1)[0][0] if info["unit"] else "Gainup",
            "seat": int(info["seat"].most_common(1)[0][0]) if info["seat"] else 0,
            "riders": len(info["emps"]), "gps_riders": len(placed), "no_gps": len(info["emps"]) - len(placed),
            "stops": stops, "n_stops": len(stops),
            "path": (ro["points"] if ro else []), "km": (ro["km"] if ro else 0), "trip": (ro["trip_min"] if ro else 0),
        })
        print(f"\r  routing bus {bi}/{len(items)} ({v}) — {len(stops)} stops ...", end="", flush=True)
        time.sleep(0.1)
    print()
    buses.sort(key=lambda b: -b["riders"])

    out = {
        "meta": {"source": "erp_VehicleEmpMapDetails", "date": latest, "merge_m": MERGE_M,
                 "order": "nearest-neighbour (approximate — ERP has no real sequence); road path via OSRM",
                 "vehicles": len(buses), "riders": sum(b["riders"] for b in buses),
                 "riders_placed": sum(b["gps_riders"] for b in buses),
                 "riders_no_gps": sum(b["no_gps"] for b in buses),
                 "stops": sum(b["n_stops"] for b in buses),
                 "road_paths": sum(1 for b in buses if b["path"])},
        "depot": {"name": "FACTORY", "lat": DEPOT[0], "lng": DEPOT[1]},
        "buses": buses,
    }
    # Full data (employee names + villages) — LOCAL ONLY, gitignored, powers name lookup/export offline.
    json.dump(out, open("public/current_routes.full.json", "w"))
    # Anonymized copy for the PUBLIC deploy: drop per-employee members, keep headcounts.
    pub = {"meta": {**out["meta"], "anonymized": True}, "depot": out["depot"],
           "buses": [{**b, "stops": [{k: v for k, v in s.items() if k != "members"} for s in b["stops"]]}
                     for b in out["buses"]]}
    json.dump(pub, open("public/current_routes.json", "w"))
    m = out["meta"]
    print(f"{m['vehicles']} vehicles · {m['riders']} riders ({m['riders_placed']} placed) · {m['stops']} stops · "
          f"{m['road_paths']}/{m['vehicles']} road paths")
    print("Wrote public/current_routes.json")


if __name__ == "__main__":
    main()
