#!/usr/bin/env python3
"""
optimize.py - offline OR-Tools heterogeneous-fleet optimiser for the Technotek transport.

Solves ALL stops + the full 57-bus fleet (20 owned + 37 rental) in ONE global VRP:
  * minimises real cost  (owned: driver+maint+diesel/km ; rental: flat slab tariff)
  * packs buses          (per-vehicle fixed cost => fewer, fuller buses, ~7-8 stops each)
  * owned vs rental       (owned cheaper => filled first; rentals cover the leftover)
  * no zones / no double-booking (one fleet, one solve)

No Google needed: distances = haversine x 1.30 road factor (swap a cached Google
matrix into build_matrices() later for road-accurate numbers).

Usage:  python optimize.py [stops.csv] [--riders 1777] [--seconds 30] [--max-ride 150]
"""
import csv, math, argparse, json, os
from ortools.constraint_solver import pywrapcp, routing_enums_pb2

# ----------------------------------------------------------------- parameters
DEPOT       = (10.207550, 77.806206)   # factory
ROAD_FACTOR = 1.30                     # straight-line -> road
SPEED_KMPH  = 30.0                     # avg road speed
SERVICE_MIN = 0.5                      # dwell per stop
ABSENTEE    = 0.12
BUFFER      = 0.03                     # demand safety margin
WORKING_DAYS = 26
CAP_LENIENCY = 5                       # riders allowed over seats

# owned operating cost (loan EXCLUDED - capital, per the dashboard model)
# Owned-bus cost model — user-provided per-bus annual figures (2026), converted to a
# per-WORKING-DAY rate over 312 working days/yr (26/mo × 12). Diesel is per-km.
WORKING_DAYS_YEAR = WORKING_DAYS * 12          # 26 × 12 = 312 working days/yr
# --- per owned bus, annual (₹) ---
OWN_DRIVER_YR     = 18_000 * 12                # driver salary 18k/mo        = 216,000
OWN_MAINT_YR      = 30_000                     # general maintenance
OWN_TIRE_YR       = 2 * 31_000                 # tyres: 2 sets/yr @ 31k       = 62,000
OWN_TIREMAINT_YR  = 20_000                     # tyre maintenance
OWN_INSURANCE_YR  = 79_000                     # insurance
OWN_ROADTAX_YR    = 33_000 * 4                 # road tax, 4 quarters         = 132,000
# FC (fitness certificate) works @ ₹55,000/visit. 10+yr buses renew yearly; <10yr every
# 2yr (→ ₹27,500/yr). Fleet blend: 8 of 29 owned buses are 10+yr (rest <10yr). [ASSUMPTION:
# per-bus age isn't in the solver, so FC is spread as a fleet-average annual cost.]
OWN_FC_10PLUS, OWN_FLEET = 8, 29
OWN_FC_YR = round((OWN_FC_10PLUS * 55_000 + (OWN_FLEET - OWN_FC_10PLUS) * 27_500) / OWN_FLEET)  # ≈35,086
# --- per working day (₹/bus/day), grouped into the solver's three fixed buckets ---
OWN_DRIVER    = round(OWN_DRIVER_YR / WORKING_DAYS_YEAR)                                   # 692
OWN_MAINT     = round((OWN_MAINT_YR + OWN_TIRE_YR + OWN_TIREMAINT_YR + OWN_FC_YR) / WORKING_DAYS_YEAR)  # maint+tyres+FC
OWN_INSURANCE = round((OWN_INSURANCE_YR + OWN_ROADTAX_YR) / WORKING_DAYS_YEAR)             # insurance + road tax
OWN_DIESEL_KM = 18.0                            # ₹/km (flat, user-provided)
DIESEL_PER_LITRE = 100.0                        # display only (Equations editor); 100 ÷ 5.56 ≈ 18/km
MILEAGE_KMPL     = round(DIESEL_PER_LITRE / OWN_DIESEL_KM, 2)
RENT_EPS_KM = 2                        # tiny compactness cost so rentals don't wander
TECH_BASELINE_YEAR   = 54_425_641      # Technotek actual annual spend (FY24-25 separate tabs)
GAINUP_BASELINE_YEAR = 0               # Gainup not provided yet — user will upload it later

def rent_cost(km):                     # true rental day tariff (recomputed after solve)
    if km <= 80:  return 1700
    if km <= 95:  return 1900
    return max(1900, 18.7 * km)

# ---------------------------------------------------------------------- fleet
# FULL company fleet (June 2026 attendance): 69 physical buses = 57 Technotek +
# 14 Gainup rows minus 2 cross-company shared buses. 29 owned + 40 rental.
OWNED = [("TN57BC3636",50),("TN57BP3434",55),("TN57BS3434",55),("TN57CB3434",55),
         ("TN57CD3434",55),("TN57CE3434",55),("TN57CF3434",55),("TN57CF3636",55),
         ("TN57CH3636",55),("TN57CJ3636",55),("TN57CL3434",54),("TN58BK3636",54),
         ("TN58BL3434",55),("TN58BL3636",54),("TN58BM3434",55),("TN58BP3434",55),
         ("TN60AP3434",55),("TN60AQ3434",55),("TN60AS3434",55),("TN60AS3636",55),
         ("TN57BQ3434",55),("TN57BQ3636",42),("TN57CA3636",50),("TN57CB3636",50),
         ("TN57CC3636",50),("TN57CK3636",55),("TN58BM3636",54),("TN58BR3434",55),
         ("TN58BS3434",54)]
RENTAL = [("TN02AB5688",15),("TN030857",15),("TN05V6697",15),("TN20AJ3944",15),
          ("TN20AK5513",15),("TN20AL3611",15),("TN20AU6396",15),("TN23AC2721",15),
          ("TN25M4073",15),("TN25M4928",15),("TN31AB3789",15),("TN31AC0182",15),
          ("TN31AY8208",15),("TN31CD6636",15),("TN31J6001",15),("TN32AA4015",15),
          ("TN36L5458",15),("TN39AP2287",15),("TN39AZ4680",15),("TN40W3708",15),
          ("TN41S5818",15),("TN41T5270",15),("TN41W8996",15),("TN42A3533",15),
          ("TN45AP3948",15),("TN46F3361",15),("TN49AW5908",15),("TN54T2368",15),
          ("TN57L8446",15),("TN57P6909",15),("TN58S5303",15),("TN59AB3444",15),
          ("TN59AH9703",15),("TN63E9861",15),("TN69M1957",15),("TN74AW0645",15),
          ("TN58BC3494",9),("TN32X3929",15),("TN63U4754",15),("TN74AY1634",15)]

# ------------------------------------------------------------------- geometry
def hav(a, b):
    R = 6371.0
    la1, lo1, la2, lo2 = map(math.radians, [a[0], a[1], b[0], b[1]])
    d = math.sin((la2-la1)/2)**2 + math.cos(la1)*math.cos(la2)*math.sin((lo2-lo1)/2)**2
    return R * 2 * math.asin(math.sqrt(d))

def load_stops(path):
    out = []
    with open(path, encoding="utf-8-sig") as f:
        for r in csv.DictReader(f):
            try:
                lat, lng = float(r["Latitude"]), float(r["Longitude"])
            except (ValueError, KeyError, TypeError):
                continue
            # optional per-stop columns (real data); when present they override
            # the evenly-spread --riders default
            try:    hc = int(float(r.get("Headcount") or 0))
            except ValueError: hc = 0
            try:    ab = float(r.get("Absentee") or ABSENTEE)
            except ValueError: ab = ABSENTEE
            try:    mi = int(float(r["MatrixIdx"])) if r.get("MatrixIdx") else None
            except (ValueError, KeyError): mi = None
            out.append({"name": (r.get("Name of Stop") or "Stop").strip(),
                        "lat": lat, "lng": lng, "headcount": hc, "absentee": ab,
                        "midx": mi})
    return out

ROAD_MATRIX_FILE = "data/road_matrix.json"   # built once by build_road_matrix.py

def _load_cached_matrix(coords, midxs=None):
    """Use the cached Google road matrix if it's present AND lines up with these coords.
    Two modes: full match (same node count + order, depot at 0), or SUBSET via midxs —
    a matrix-row index per coord (used by merged/trial networks: survivors keep their
    original matrix rows, so the paid road data is reused exactly)."""
    if not os.path.exists(ROAD_MATRIX_FILE):
        return None
    try:
        d = json.load(open(ROAD_MATRIX_FILE, encoding="utf-8"))
        nodes, km, mn = d.get("nodes", []), d.get("km"), d.get("min")
    except (ValueError, OSError):
        return None
    n = len(coords)
    if midxs is not None:
        if not km or max(midxs) >= len(nodes):
            print("  (MatrixIdx out of range -> using ruler estimate)")
            return None
        for i in (0, n // 2, n - 1):        # spot-check alignment
            nd = nodes[midxs[i]]
            if abs(nd["lat"] - coords[i][0]) > 1e-4 or abs(nd["lng"] - coords[i][1]) > 1e-4:
                print("  (MatrixIdx doesn't match stop coords -> using ruler estimate)")
                return None
        KM = [[km[midxs[i]][midxs[j]] for j in range(n)] for i in range(n)]
        MN = [[mn[midxs[i]][midxs[j]] for j in range(n)] for i in range(n)]
        fills = 0
        for i in range(n):
            for j in range(n):
                if i == j:
                    KM[i][j] = 0.0; MN[i][j] = 0.0; continue
                if KM[i][j] is None or KM[i][j] < 0:
                    dist = hav(coords[i], coords[j]) * ROAD_FACTOR
                    KM[i][j] = dist; MN[i][j] = dist / SPEED_KMPH * 60.0; fills += 1
                elif MN[i][j] is None or MN[i][j] < 0:
                    MN[i][j] = KM[i][j] / SPEED_KMPH * 60.0
        print(f"  Using cached Google road matrix via MatrixIdx ({n} of {len(nodes)} nodes)"
              + (f", ruler-filled {fills}." if fills else "."))
        return KM, MN
    if not km or not mn or len(km) != n or len(nodes) != n:
        print(f"  (road_matrix.json has {len(nodes)} nodes, need {n} -> using ruler estimate)")
        return None
    for i, (la, lo) in enumerate(coords):
        if abs(nodes[i]["lat"] - la) > 1e-4 or abs(nodes[i]["lng"] - lo) > 1e-4:
            print("  (road_matrix.json node order doesn't match stops -> using ruler estimate)")
            return None
    # copy + ruler-fill any unreachable (-1 / null) cells so the solver never sees a bad number
    KM = [row[:] for row in km]; MN = [row[:] for row in mn]; fills = 0
    for i in range(n):
        for j in range(n):
            if i == j:
                KM[i][j] = 0.0; MN[i][j] = 0.0; continue
            if KM[i][j] is None or KM[i][j] < 0:
                dist = hav(coords[i], coords[j]) * ROAD_FACTOR
                KM[i][j] = dist; MN[i][j] = dist / SPEED_KMPH * 60.0; fills += 1
            elif MN[i][j] is None or MN[i][j] < 0:
                MN[i][j] = KM[i][j] / SPEED_KMPH * 60.0
    print("  Using cached Google road matrix (data/road_matrix.json)"
          + (f", ruler-filled {fills} unreachable cells." if fills else "."))
    return KM, MN

def build_matrices(coords, midxs=None):
    cached = _load_cached_matrix(coords, midxs)
    if cached:
        return cached
    # fallback: straight-line (haversine) x road factor
    n = len(coords)
    km  = [[0]*n for _ in range(n)]
    mins = [[0]*n for _ in range(n)]
    for i in range(n):
        for j in range(n):
            if i == j: continue
            d = hav(coords[i], coords[j]) * ROAD_FACTOR
            km[i][j]  = d
            mins[i][j] = d / SPEED_KMPH * 60.0
    return km, mins

# ----------------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("stops", nargs="?", default="data/bus_stops.csv")
    ap.add_argument("--riders", type=int, default=1777)
    ap.add_argument("--seconds", type=int, default=30)
    ap.add_argument("--max-ride", type=int, default=260, help="max round-trip min (>=~220 so far stops stay feasible)")
    ap.add_argument("--limit", type=int, default=0, help="cap #stops for testing")
    ap.add_argument("--max-stops", type=int, default=0,
                    help="cap on STOPS per bus (0 = uncapped); spreads stops across the fleet")
    ap.add_argument("--ride-target", type=int, default=60,
                    help="soft ride-time target in minutes (penalty applies beyond this)")
    ap.add_argument("--chain", action="store_true",
                    help="judge routes by the park-at-last-stop day model (2x legs, free return)")
    ap.add_argument("--ride-penalty", type=int, default=25,
                    help="Rs per passenger-minute beyond the ride target (steers cost-vs-time)")
    args = ap.parse_args()

    stops = load_stops(args.stops)
    if args.limit:
        stops = stops[:args.limit]
    n_stops = len(stops)
    coords = [DEPOT] + [(s["lat"], s["lng"]) for s in stops]
    N = len(coords)

    # demand per stop: use REAL per-stop headcount+absentee when the CSV carries
    # them (Headcount column, any stop > 0); else legacy evenly-spread --riders
    if any(s["headcount"] > 0 for s in stops):
        # REG_TO_ACTIVE calibrates ROSTER counts to riders who actually board,
        # pinned to the JUNE ATTENDANCE total (2,360 allotted riders) so fleet
        # utilisation matches reality (~99% of the 2,151 seats) instead of
        # overfilling every bus into its +5 leniency. Runtime-computed, so it
        # self-adjusts when the reviewed headcounts replace the trial randoms.
        # round() not ceil(): over 822 small stops ceil inflates demand ~+10%.
        JUNE_ALLOTTED = 2360
        REG_TO_ACTIVE = min(1.0, JUNE_ALLOTTED / max(1, sum(s["headcount"] for s in stops)))
        demand = [0] + [max(1, round(s["headcount"] * REG_TO_ACTIVE * (1 - s["absentee"] + BUFFER)))
                        for s in stops]
        dem_per = round(sum(demand) / n_stops, 2)   # avg/stop (info only, for the result JSON)
        print(f"  Using per-stop headcounts from CSV "
              f"(registered {sum(s['headcount'] for s in stops)}, active x{REG_TO_ACTIVE}, "
              f"effective demand {sum(demand)})")
    else:
        head = args.riders / n_stops
        dem_per = max(1, math.ceil(head * (1 - ABSENTEE + BUFFER)))
        demand = [0] + [dem_per] * n_stops
    total_dem = sum(demand)

    midxs = ([0] + [s["midx"] for s in stops]) if all(s.get("midx") for s in stops) else None
    km, mins = build_matrices(coords, midxs)

    # vehicles: owned first (cheaper), then rental
    fleet = ([{"name": nm, "cap": cap, "own": True}  for nm, cap in OWNED] +
             [{"name": nm, "cap": cap, "own": False} for nm, cap in RENTAL])
    V = len(fleet)
    caps = [f["cap"] + CAP_LENIENCY for f in fleet]

    # ------------------------------------------------------------- model builder
    # Built twice (two-phase): the GOAL objective (60-min ride soft bounds + all
    # buses free to dispatch) is too hard for cold first-solution construction at
    # 822 stops, so phase A solves the plain cost model, and phase B warm-starts
    # the goal model from phase A's routes.
    RIDE_TARGET, RIDE_PENALTY = args.ride_target, args.ride_penalty
    def build_model(goal):
        mgr = pywrapcp.RoutingIndexManager(N, V, 0)
        routing = pywrapcp.RoutingModel(mgr)
        # arc cost: owned pays diesel/km, rental a tiny epsilon (flat tariff is fixed).
        # CHAIN MODE (--chain): judge routes by the REAL day model — the bus parks at
        # its last stop, so the return-to-depot arc is FREE, and every other leg is
        # driven TWICE a day (morning pickup + evening drop). Aligns the solver's
        # objective with the park-at-last-stop accounting (fixes cycle-vs-chain gap).
        def make_cost(per_km):
            def cb(i, j):
                a, b = mgr.IndexToNode(i), mgr.IndexToNode(j)
                if args.chain and b == 0:
                    return 0                       # park at the last stop: no return leg
                mult = 2.0 if args.chain else 1.0  # chain legs are driven twice per day
                return int(round(km[a][b] * per_km * mult))
            return routing.RegisterTransitCallback(cb)
        own_cost, rent_cb = make_cost(OWN_DIESEL_KM), make_cost(RENT_EPS_KM)
        for v, f in enumerate(fleet):
            routing.SetArcCostEvaluatorOfVehicle(own_cost if f["own"] else rent_cb, v)
            # goal model: no activation penalty -> idle buses get pulled in freely
            # (user: dispatch all 69). True Rs recomputed after the solve.
            routing.SetFixedCostOfVehicle(0 if (goal or f["own"]) else 1700, v)
        def dem_cb(i): return demand[mgr.IndexToNode(i)]
        dem_idx = routing.RegisterUnaryTransitCallback(dem_cb)
        routing.AddDimensionWithVehicleCapacity(dem_idx, 0, caps, True, "Cap")
        # ride time: excludes the empty deadhead leg out of the depot, so the route-
        # end cumul == the FIRST-PICKED passenger's ride to the factory
        def time_cb(i, j):
            a, b = mgr.IndexToNode(i), mgr.IndexToNode(j)
            if a == 0:
                return 0
            return int(round(mins[a][b] + (SERVICE_MIN if b != 0 else 0)))
        time_idx = routing.RegisterTransitCallback(time_cb)
        routing.AddDimension(time_idx, 0, args.max_ride, True, "Time")
        if args.max_stops:
            # stops-per-bus spread: a HARD cap makes first-solution construction
            # impossible at 99% seat fill (PCI and SAVINGS both time out), so the
            # cap is SOFT — Rs400 per stop beyond --max-stops, enforced in the
            # goal phase. GLS then spreads stops wherever it's affordable.
            one_idx = routing.RegisterUnaryTransitCallback(
                lambda i: 1 if mgr.IndexToNode(i) != 0 else 0)
            routing.AddDimension(one_idx, 0, 40, True, "Stops")   # generous ceiling
            if goal:
                sdim = routing.GetDimensionOrDie("Stops")
                for v in range(V):
                    sdim.SetCumulVarSoftUpperBound(routing.End(v), args.max_stops, 400)
        if goal:
            # GOAL: balance ~Rs65/head with <60 min rides — every passenger-minute
            # beyond 60 costs RIDE_PENALTY; far villages stay feasible (hard cap
            # --max-ride) but their overshoot is minimised.
            tdim = routing.GetDimensionOrDie("Time")
            for v in range(V):
                tdim.SetCumulVarSoftUpperBound(routing.End(v), RIDE_TARGET, RIDE_PENALTY)
        return mgr, routing

    def search_params(seconds, strategy=None):
        p = pywrapcp.DefaultRoutingSearchParameters()
        p.first_solution_strategy = (strategy if strategy is not None else
                                     routing_enums_pb2.FirstSolutionStrategy.PARALLEL_CHEAPEST_INSERTION)
        p.local_search_metaheuristic = routing_enums_pb2.LocalSearchMetaheuristic.GUIDED_LOCAL_SEARCH
        p.time_limit.FromSeconds(seconds)
        return p

    STATUS = {0:"NOT_SOLVED",1:"SUCCESS",2:"FAIL",3:"FAIL_TIMEOUT",4:"INVALID"}
    print(f"Solving {n_stops} stops, {total_dem} riders, {V} buses available "
          f"({len(OWNED)} own + {len(RENTAL)} rent)  -  up to {args.seconds}s ...")

    # ---- phase A: plain cost model (fast to construct; the stop cap is soft and
    # only enters in the goal phase, so construction is unaffected)
    secsA = max(45, args.seconds // 3)
    mgrA, rA = build_model(goal=False)
    solA = rA.SolveWithParameters(search_params(secsA))
    if not solA:
        print(f"No solution found (phase A).  status={STATUS.get(rA.status(), rA.status())}")
        return
    routesA = []
    for v in range(V):
        seq, idx = [], rA.Start(v)
        while not rA.IsEnd(idx):
            node = mgrA.IndexToNode(idx)
            if node != 0: seq.append(node)
            idx = solA.Value(rA.NextVar(idx))
        routesA.append(seq)
    print(f"  phase A done ({sum(1 for r in routesA if r)} buses) -> warm-starting goal model")

    # ---- phase B: goal model (ride soft bounds), warm-started from phase A
    mgr, routing = build_model(goal=True)
    paramsB = search_params(max(45, args.seconds - secsA))
    routing.CloseModelWithParameters(paramsB)
    initial = routing.ReadAssignmentFromRoutes(routesA, True)
    sol = (routing.SolveFromAssignmentWithParameters(initial, paramsB)
           if initial else routing.SolveWithParameters(paramsB))
    if not sol:
        print(f"  phase B failed (status={STATUS.get(routing.status(), routing.status())}) "
              f"-> keeping phase A plan")
        mgr, routing, sol = mgrA, rA, solA

    # ---------------------------------------------------------------------------
    # OPERATING DAY MODEL (per user, 2026-07-08):
    #   The bus PARKS OVERNIGHT AT ITS LAST (farthest) STOP.
    #   Morning:  last stop -> ... -> stop1 -> factory   (picks up on the way in)
    #   Evening:  factory -> stop1 -> ... -> last stop   (drops off, parks there)
    #   => NO deadhead leg at all; day km = 2 x the one-way chain (both trips);
    #      trip time = the chain factory->...->last stop (both directions equal,
    #      symmetric matrix). Routes are DISPLAYED in evening-drop order.
    # Sequences use nearest-first-from-factory (closest stop from the current
    # location, then closest from the new location, ...) polished with 2-opt on
    # real road-matrix minutes so crossings never survive.
    def ride_of(seq):
        """Chain time factory -> seq[0] -> ... -> seq[-1] (evening drop; the last-
        dropped passenger's time aboard). Dwell at intermediate stops only."""
        return (mins[0][seq[0]]
                + sum(mins[seq[i]][seq[i + 1]] for i in range(len(seq) - 1))
                + SERVICE_MIN * max(0, len(seq) - 1))

    def chain_km(seq):
        return km[0][seq[0]] + sum(km[seq[i]][seq[i + 1]] for i in range(len(seq) - 1))

    def two_opt(seq):
        best, best_r = seq[:], ride_of(seq)
        improved = True
        while improved:
            improved = False
            for a in range(len(best) - 1):
                for b in range(a + 1, len(best)):
                    cand = best[:a] + best[a:b + 1][::-1] + best[b + 1:]
                    r = ride_of(cand)
                    if r < best_r - 1e-9:
                        best, best_r, improved = cand, r, True
        return best

    def resequence(nodes):
        # nearest-first from the factory (user's rule), plus the solver's order
        # reversed into drop direction; 2-opt both, keep the shorter chain
        rem = list(nodes)
        nn = [min(rem, key=lambda nd: km[0][nd])]; rem.remove(nn[0])
        while rem:
            nxt = min(rem, key=lambda nd: km[nn[-1]][nd]); nn.append(nxt); rem.remove(nxt)
        cands = [two_opt(nn), two_opt(list(nodes)), two_opt(list(nodes)[::-1])]
        return min(cands, key=ride_of)

    routes = []
    for v in range(V):
        idx = routing.Start(v)
        nodes, load = [], 0
        while not routing.IsEnd(idx):
            node = mgr.IndexToNode(idx)
            if node != 0:
                nodes.append(node); load += demand[node]
            idx = sol.Value(routing.NextVar(idx))
        if not nodes: continue
        seq = resequence(nodes)          # EVENING DROP order: factory-nearest first
        one_way = chain_km(seq)          # factory -> s1 -> ... -> last stop
        dist = 2 * one_way               # DAY km: morning pickup + evening drop
                                         # (bus parks at the last stop overnight — no deadhead)
        ride = ride_of(seq)              # chain time factory -> ... -> last stop
        cost = (OWN_DRIVER + OWN_MAINT + OWN_INSURANCE + OWN_DIESEL_KM * dist) if fleet[v]["own"] else rent_cost(dist)
        routes.append({"v": v, "name": fleet[v]["name"], "own": fleet[v]["own"],
                       "cap": fleet[v]["cap"], "stops": len(seq), "riders": load,
                       "km": dist, "ride": ride, "cost": cost, "seq": seq})

    # ---------- owned / rental / combined breakdown ----------
    def metrics(rs):
        if not rs:
            return {"buses": 0, "riders": 0, "seats": 0, "stops": 0, "avg_stops": 0,
                    "util": 0, "max_ride": 0, "avg_ride": 0, "km": 0, "cost": 0, "cost_head": 0}
        riders = sum(r["riders"] for r in rs); seats = sum(r["cap"] for r in rs)
        cost = sum(r["cost"] for r in rs); stops = sum(r["stops"] for r in rs)
        return {"buses": len(rs), "riders": riders, "seats": seats, "stops": stops,
                "avg_stops": stops/len(rs), "util": 100*riders/seats,
                "max_ride": max(r["ride"] for r in rs), "avg_ride": sum(r["ride"] for r in rs)/len(rs),
                "km": sum(r["km"] for r in rs), "cost": cost, "cost_head": cost/riders if riders else 0}

    own_m  = metrics([r for r in routes if r["own"]])
    rent_m = metrics([r for r in routes if not r["own"]])
    all_m  = metrics(routes)

    def row(label, key, fmt):
        print(f"  {label:<20} {fmt(own_m[key]):>12} {fmt(rent_m[key]):>12} {fmt(all_m[key]):>12}")
    i = lambda x: f"{x:,.0f}"; p = lambda x: f"{x:.0f}%"; f1 = lambda x: f"{x:.1f}"
    print("\n==================  FLEET METRICS  ==================")
    print(f"  {'':<20} {'OWNED':>12} {'RENTAL':>12} {'COMBINED':>12}")
    row("Buses used",      "buses",     i)
    row("Riders carried",  "riders",    i)
    row("Utilisation",     "util",      p)
    row("Avg stops / bus", "avg_stops", f1)
    row("Max ride (min)",  "max_ride",  i)
    row("Avg ride (min)",  "avg_ride",  i)
    row("Total km/day",    "km",        i)
    row("Cost Rs/day",     "cost",      i)
    row("Cost Rs/head/day","cost_head", f1)
    print(f"\n  OVERALL (whole fleet, all zones):  Rs {all_m['cost_head']:.1f}/head/day  "
          f"(Rs {all_m['cost_head']*WORKING_DAYS:,.0f}/mo) | {all_m['util']:.0f}% util | "
          f"max ride {all_m['max_ride']:.0f} min | {all_m['buses']} buses")
    print("\n  bus           type    stops  riders  km     ride   Rs")
    for r in sorted(routes, key=lambda r: (not r["own"], -r["stops"])):
        print(f"  {r['name']:<13} {'own' if r['own'] else 'rent':<5}  {r['stops']:>4}  {r['riders']:>5}  "
              f"{r['km']:>5.1f}  {r['ride']:>4.0f}  {r['cost']:>6,.0f}")

    # ---- detail of the longest-ride route (EVENING DROP order) + maps link ----
    worst = max(routes, key=lambda r: r["ride"])
    print(f"\n================  LONGEST ROUTE: {worst['name']}  "
          f"({worst['stops']} stops, {worst['km']:.1f} km/day both trips, {worst['ride']:.0f} min chain)  ================")
    print(f"  FACTORY (evening drop start) {DEPOT[0]:.6f}, {DEPOT[1]:.6f}")
    for k, node in enumerate(worst["seq"], 1):
        s = stops[node - 1]
        tag = "  <- parks overnight" if k == len(worst["seq"]) else ""
        print(f"  {k}. {s['name']:<28} {s['lat']:.6f}, {s['lng']:.6f}{tag}")
    # maps link: factory -> stops -> LAST stop (evening drop; no return leg)
    waypts = "|".join(f"{stops[n-1]['lat']},{stops[n-1]['lng']}" for n in worst["seq"][:-1])
    last = stops[worst["seq"][-1] - 1]
    print(f"\n  Google Maps: https://www.google.com/maps/dir/?api=1&origin={DEPOT[0]},{DEPOT[1]}"
          f"&destination={last['lat']},{last['lng']}&waypoints={waypts}&travelmode=driving")

    # ---- write result.json for the dashboard (public/ is served by Vite at root) ----
    os.makedirs("public", exist_ok=True)
    out = {
        "params": {"riders": args.riders, "demand": total_dem, "max_ride": args.max_ride,
                   "seconds": args.seconds, "stops": n_stops, "depot": list(DEPOT), "method": "OR-Tools VRP"},
        "assumptions": {
            "own_driver_day": OWN_DRIVER, "own_maint_day": OWN_MAINT, "own_diesel_per_km": OWN_DIESEL_KM,
            "own_diesel_per_litre": DIESEL_PER_LITRE, "own_mileage_kmpl": MILEAGE_KMPL,
            "own_insurance_day": OWN_INSURANCE,
            "rent_tariff": "≤80km ₹1700 · ≤95km ₹1900 · beyond ₹18.7/km",
            "absentee_pct": round(ABSENTEE * 100), "buffer_pct": round(BUFFER * 100),
            "working_days": WORKING_DAYS, "cap_leniency": CAP_LENIENCY, "demand_per_stop": dem_per,
            "owned_loan": "excluded (capital, not operating cost)",
            "road_source": "cached Google road matrix (real driving km + minutes)"},
        "overall": all_m, "owned": own_m, "rental": rent_m,
        # naive baseline for the savings simulator: one dedicated van per stop (round trip)
        "baseline": {"buses": n_stops, "km": round(sum(2 * km[0][i] for i in range(1, N)), 1),
                     "cost": round(sum(rent_cost(2 * km[0][i]) for i in range(1, N))),
                     "desc": "one dedicated van per stop (no consolidation)"},
        "routes": [{"name": r["name"], "type": "own" if r["own"] else "rent", "cap": r["cap"],
                    "stops": r["stops"], "riders": r["riders"], "km": round(r["km"], 1),
                    # seq is EVENING DROP order: seq[0] = nearest (first drop),
                    # seq[-1] = farthest (last drop = overnight parking stop)
                    "km_to_farthest": round(km[0][r["seq"][-1]], 1), "km_to_last": round(km[0][r["seq"][0]], 1),
                    "ride": round(r["ride"]), "cost": round(r["cost"]),
                    "seq": [{"name": stops[n-1]["name"], "lat": stops[n-1]["lat"], "lng": stops[n-1]["lng"],
                             "hc": stops[n-1].get("headcount", 0)}
                            for n in r["seq"]]}
                   for r in sorted(routes, key=lambda r: (not r["own"], -r["stops"]))],
    }
    with open(os.path.join("public", "solver_result.json"), "w", encoding="utf-8") as fh:
        json.dump(out, fh)
    print(f"\nWrote public/solver_result.json  ({len(routes)} routes)")

if __name__ == "__main__":
    main()
