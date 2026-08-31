#!/usr/bin/env python3
"""
build_erp_routes.py — reconstruct the CURRENT real bus routes from the live ERP.

From VehicleEmpMapDetails (latest day) we know which employees ride which vehicle and their
home GPS. We do NOT know the travel order (the ERP has no sequence), so per vehicle we:
  1. cluster its GPS employees into stops (200 m); keep each stop's employees (name + village),
  2. infer a visiting order (nearest-neighbour from the factory) — APPROXIMATE,
  3. fetch the REAL road-following path through depot + stops (free OSRM route service),
  4. emit public/current_routes.json for the preview map (with per-stop employee members).

Every rider is also attributed to the SERVICE they belong to (9 am General, 7 am Morning, the
three Rotational slots, Zenwear), because a vehicle is not a service: the same bus runs a
Rotational trip and a General trip on the same day, and 11 of them carry more than one
Rotational slot. Without a per-service split, anything that filtered "the buses this service
runs" and then summed each bus's total rider count overstated a 244-rider Rotational Day by
4.6x (1121) and a 155-rider 7 am Morning by 6.6x (1027).

Rotational's three slots all read "ROTATIONAL SHIFT" in the feed; the rider's slot comes from
src/rotationalRoster.json, which is re-cut every Monday. This script checks that roster is for
the same week as the ERP day it is reading and refuses to emit a stale split.

Owned vs rental from the Type field. Employees without GPS can't be placed (reported per bus).
"""
import json, math, ssl, time, argparse, urllib.request, urllib.error, datetime, sys
import re
from collections import defaultdict, Counter

def _erp_day_key(d):
    """Sort key for the ERP's DD-MM-YYYY date strings.

    These are STRINGS, so sorted()[-1] compares character by character and ranks
    "31-07-2026" above "10-08-2026" — every consumer then silently analysed a day
    ten days stale. Parse the parts and compare them as a date.
    """
    m = re.match(r"^(\d{2})-(\d{2})-(\d{4})", (d or "").strip())
    return (int(m.group(3)), int(m.group(2)), int(m.group(1))) if m else (0, 0, 0)



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


def unit_of(compname, comp_new=""):
    """Mirror of unitOf() in src/erp.js — Zenwear is checked FIRST and on either field.

    The old version here read only Compname for "technotek" and defaulted everything else to
    Gainup, so all 3,663 Zenwear rows (Compname "SUBBULAPURAM" / Comp_New "ZENWEAR") were
    labelled Gainup on the prev-route map.
    """
    c, e = (compname or ""), (comp_new or "")
    if re.search(r"zenwear", e, re.I) or re.search(r"zenwear|subbulapuram", c, re.I):
        return "Zenwear"
    return "Technotek" if re.search(r"technotek", c, re.I) else "Gainup"


# Mirror of SERVICES / serviceIdFor() in src/optimiser/services.js. Kept as a literal table
# rather than parsed out of the JS so this script has no build step; if a service is added
# there, add it here — the self-check in main() reports riders that match nothing.
ROTA_SHIFT = "ROTATIONAL SHIFT"
SLOT_SERVICE = {"1": "rot-day", "2": "rot-half", "3": "rot-full"}
SHIFT_SERVICE = {"GENERAL SHIFT - 9": "s9", "MORNING SHIFT - 7": "s7"}
SERVICE_IDS = ["s9", "s7", "rot-day", "rot-half", "rot-full", "zen"]


def norm_shift(s):
    """The ERP's Shift field is free text with inconsistent inner/trailing spaces."""
    return re.sub(r"\s+", " ", str(s or "")).strip()


def service_for(unit, shift, slot):
    """Which service a rider belongs to. Unit wins over shift: every unit starts at the same
    gate time, so the shift string alone cannot tell a Zenwear rider from a Batlagundu one.

    A rotational rider with no slot on record belongs to NO rotational service rather than
    being dumped into the first — the same rule as serviceIdFor() in services.js, so a
    missing slot shows up as missing instead of silently inflating Day."""
    if unit == "Zenwear":
        return "zen"
    sh = norm_shift(shift)
    if sh == ROTA_SHIFT:
        return SLOT_SERVICE.get(str(slot or "").strip())
    return SHIFT_SERVICE.get(sh)


def iso_week_start(d):
    """Monday of the week containing date `d`."""
    return (d - datetime.timedelta(days=d.weekday())).isoformat()


def load_roster(path="src/rotationalRoster.json"):
    """The frozen Empl_no -> slot map, plus the rota week it was cut for."""
    try:
        r = json.load(open(path, encoding="utf-8"))
        return r.get("slots") or {}, r.get("_rotaWeek") or ""
    except (OSError, ValueError) as e:
        print(f"ERROR: could not read {path} ({e}).", file=sys.stderr)
        print("       Run: python3 build_rotational_roster.py", file=sys.stderr)
        raise SystemExit(5)


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
        # by_service: a stop is shared — the same pickup point serves General riders and
        # Rotational riders. A map filtered to one service must show that service's headcount,
        # not the stop's total, or every filtered view silently reads as the whole fleet.
        out.append({"lat": s["lat"], "lng": s["lng"], "name": (loc[0][0] if loc else "Stop"),
                    "hc": len(m), "by_service": dict(Counter(x["svc"] for x in m if x["svc"])),
                    "members": [{"name": x["nm"], "village": x["vil"], "svc": x["svc"]} for x in m]})
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
    ap.add_argument("--allow-stale-roster", action="store_true",
                    help="build even if src/rotationalRoster.json is not for the ERP day's week (the Rotational split will be wrong)")
    args = ap.parse_args()
    global MERGE_M
    MERGE_M = args.merge_m
    rows = json.load(open("data/erp_live.json"))
    latest = max({norm(r.get("date")) for r in rows if norm(r.get("date"))}, key=_erp_day_key)

    # The Rotational split is only valid for the week it was cut for — riders step one slot
    # every Monday, so last week's roster mislabels roughly everyone who rotates. Refuse to
    # bake a stale split into the map rather than emitting numbers that look plausible.
    roster, rota_week = load_roster()
    y, mo, dy = _erp_day_key(latest)
    erp_week = iso_week_start(datetime.date(y, mo, dy)) if y else ""
    if rota_week != erp_week:
        msg = (f"rotational roster is for week {rota_week or '(unknown)'} but the ERP's latest day "
               f"({latest[:10]}) is in week {erp_week}")
        if args.allow_stale_roster:
            print(f"  WARNING: {msg} — continuing because --allow-stale-roster was passed.")
        else:
            print(f"ERROR: {msg}.", file=sys.stderr)
            print(f"       Re-cut it first:  python3 build_rotational_roster.py --week {erp_week}", file=sys.stderr)
            print( "       (or pass --allow-stale-roster to build anyway)", file=sys.stderr)
            raise SystemExit(6)

    veh = defaultdict(lambda: {"emps": {}, "type": "", "seat": Counter(), "unit": Counter()})
    for r in rows:
        if norm(r.get("date")) != latest:
            continue
        v = norm(r.get("VehName") or r.get("Veh_Mas")); e = norm(r.get("Empl_no"))
        if not v or not e or e in veh[v]["emps"]:
            continue
        u = unit_of(r.get("Compname"), r.get("Comp_New"))
        veh[v]["emps"][e] = {"g": gps(r), "loc": norm(r.get("Locality")) or norm(r.get("Village")),
                             "nm": norm(r.get("Name")), "vil": norm(r.get("Village")) or norm(r.get("Locality")),
                             "svc": service_for(u, r.get("Shift"), roster.get(e))}
        if r.get("Type"):
            veh[v]["type"] = "rental" if "rent" in r["Type"].lower() else "owned"
        s = norm(r.get("Seat") or r.get("Seat_New"))
        if s and s != "0":
            veh[v]["seat"][s] += 1
        veh[v]["unit"][u] += 1

    buses = []
    items = list(veh.items())
    for bi, (v, info) in enumerate(items, 1):
        placed = [e for e in info["emps"].values() if e["g"]]
        stops = nn_order(cluster(placed)) if placed else []
        ro = osrm_route([DEPOT] + [(s["lat"], s["lng"]) for s in stops]) if stops else None
        by_svc = Counter(e["svc"] for e in info["emps"].values() if e["svc"])
        buses.append({
            "name": v, "type": info["type"] or "owned",
            # riders THIS bus carries for each service. `riders` below is the vehicle total
            # across every service it runs, which is not what a per-service view wants.
            "by_service": dict(by_svc),
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

    riders_by_service = Counter()
    for info in veh.values():
        for e in info["emps"].values():
            riders_by_service[e["svc"] or "unassigned"] += 1

    out = {
        "meta": {"source": "erp_VehicleEmpMapDetails", "date": latest, "merge_m": MERGE_M,
                 "rota_week": rota_week, "erp_week": erp_week,
                 "riders_by_service": {k: riders_by_service.get(k, 0) for k in SERVICE_IDS},
                 "riders_unassigned": riders_by_service.get("unassigned", 0),
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
                     for b in out["buses"]]}   # by_service survives: headcounts, no identities
    json.dump(pub, open("public/current_routes.json", "w"))
    m = out["meta"]
    print(f"{m['vehicles']} vehicles · {m['riders']} riders ({m['riders_placed']} placed) · {m['stops']} stops · "
          f"{m['road_paths']}/{m['vehicles']} road paths")
    print(f"rota week {rota_week} · riders per service: "
          + ", ".join(f"{k} {m['riders_by_service'][k]}" for k in SERVICE_IDS))
    if m["riders_unassigned"]:
        print(f"  {m['riders_unassigned']} rider(s) matched no service — rotational riders with no "
              f"slot in the roster, left out of all three slots rather than guessed")
    print("Wrote public/current_routes.json")


if __name__ == "__main__":
    main()
