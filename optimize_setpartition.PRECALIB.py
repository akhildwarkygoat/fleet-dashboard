#!/usr/bin/env python3
"""
optimize_setpartition.py - set-partitioning optimiser with an optimality BOUND.

Where optimize.py runs a single OR-Tools VRP (a good plan, but no guarantee how
close to optimal), this builds a large POOL of candidate routes and then solves a
set-partitioning MILP (CP-SAT) to pick the cheapest COMBINATION of routes that:
  * covers every stop exactly once,
  * stays within the FIXED fleet (<=20 owned, <=37 rental),
  * obeys capacity (+leniency) and the hard ride-time cap,
minimising true cost (owned: diesel/km, driver+maint sunk; rental: step tariff).

It then reports the optimality GAP from CP-SAT: "within X% of the cheapest possible
combination of the generated routes." (A true bound over ALL conceivable routes
needs column generation; this bound is over the candidate pool, which we make rich.)

Reuses optimize.py for the matrix (cached Google roads), fleet, costs and geometry.

Usage:  python optimize_setpartition.py [stops.csv] [--riders 1777] [--seconds 30]
                                        [--max-ride 120] [--soft-ride 60]
"""
import argparse, json, os, math
from ortools.sat.python import cp_model
from ortools.constraint_solver import pywrapcp, routing_enums_pb2
import optimize as O   # DEPOT, fleet, costs, hav, load_stops, build_matrices, constants

SOFT_RIDE_DEFAULT = 60     # minutes — target; rides above this are reported, not forbidden
HARD_RIDE_DEFAULT = 120    # minutes — feasibility cap (far villages need ~107)


def resequence(nodes, km):
    """Farthest-first then nearest-neighbour back to the depot (same as optimize.py):
    deadhead empty to the farthest stop, pick everyone up working home -> no zig-zag."""
    rem = list(nodes)
    order = [max(rem, key=lambda nd: km[0][nd])]; rem.remove(order[0])
    while rem:
        nxt = min(rem, key=lambda nd: km[order[-1]][nd]); order.append(nxt); rem.remove(nxt)
    return order


def route_metrics(stop_nodes, km, mins, dem_per):
    """km, ride(min), riders for an (unordered) set of stop node-ids. Depot is node 0."""
    seq = resequence(stop_nodes, km)
    deadhead = km[0][seq[0]]
    inbound_km = sum(km[seq[i]][seq[i + 1]] for i in range(len(seq) - 1)) + km[seq[-1]][0]
    dist = deadhead + inbound_km
    # longest passenger ride = farthest rider's inbound journey (real matrix minutes)
    ride = sum(mins[seq[i]][seq[i + 1]] for i in range(len(seq) - 1)) + mins[seq[-1]][0] \
        + O.SERVICE_MIN * len(seq)
    return dist, ride, dem_per * len(seq), seq


def vrp_seed_routes(N, fleet, demand, km, mins, caps, max_ride, seconds):
    """Run the OR-Tools VRP (same model as optimize.py) and return [(is_owned, [node_ids])]
    per used vehicle. Seeding the pool with this guarantees the set-partition is at least
    as good as the VRP, and makes the pool-relative optimality gap meaningful."""
    V = len(fleet)
    mgr = pywrapcp.RoutingIndexManager(N, V, 0)
    routing = pywrapcp.RoutingModel(mgr)

    def make_cost(per_km):
        def cb(i, j): return int(round(km[mgr.IndexToNode(i)][mgr.IndexToNode(j)] * per_km))
        return routing.RegisterTransitCallback(cb)
    own_cost, rent_cost_cb = make_cost(O.OWN_DIESEL_KM), make_cost(O.RENT_EPS_KM)
    for v, f in enumerate(fleet):
        routing.SetArcCostEvaluatorOfVehicle(own_cost if f["own"] else rent_cost_cb, v)
        routing.SetFixedCostOfVehicle(0 if f["own"] else 1700, v)
    dem_idx = routing.RegisterUnaryTransitCallback(lambda i: demand[mgr.IndexToNode(i)])
    routing.AddDimensionWithVehicleCapacity(dem_idx, 0, caps, True, "Cap")

    def time_cb(i, j):
        a, b = mgr.IndexToNode(i), mgr.IndexToNode(j)
        return int(round(mins[a][b] + (O.SERVICE_MIN if b != 0 else 0)))
    time_idx = routing.RegisterTransitCallback(time_cb)
    routing.AddDimension(time_idx, 0, max_ride, True, "Time")

    params = pywrapcp.DefaultRoutingSearchParameters()
    params.first_solution_strategy = routing_enums_pb2.FirstSolutionStrategy.PARALLEL_CHEAPEST_INSERTION
    params.local_search_metaheuristic = routing_enums_pb2.LocalSearchMetaheuristic.GUIDED_LOCAL_SEARCH
    params.time_limit.FromSeconds(seconds)
    sol = routing.SolveWithParameters(params)
    if not sol:
        return []
    out = []
    for v in range(V):
        idx, nodes = routing.Start(v), []
        while not routing.IsEnd(idx):
            node = mgr.IndexToNode(idx)
            if node != 0:
                nodes.append(node)
            idx = sol.Value(routing.NextVar(idx))
        if nodes:
            out.append((fleet[v]["own"], nodes))
    return out


def generate_pool(n_stops, km, mins, dem_per, owned_cap, rent_cap, hard_ride, seed_routes=None):
    """Build a rich, de-duplicated pool of feasible candidate routes for each bus type.
    Generators: angular sweep windows, nearest-neighbour clusters, and singletons
    (singletons guarantee a feasible partition always exists)."""
    stops = list(range(1, n_stops + 1))                  # node ids (depot = 0)
    depot = O.DEPOT
    coords = lambda i: (None,)                           # placeholder; we use km/mins only
    # angular order around the depot for the sweep generator
    ang = {}
    for s in stops:
        # recover lat/lng from optimize's coords via the matrix? we stored them in _COORDS
        la, lo = _COORDS[s]
        ang[s] = math.atan2(la - depot[0], lo - depot[1])
    by_angle = sorted(stops, key=lambda s: ang[s])

    max_owned = max(1, (owned_cap // dem_per))
    max_rent = max(1, (rent_cap // dem_per))
    seen = set()                                         # (is_owned, frozenset) dedup
    pool = []                                            # {stops, owned, km, ride, riders, seq, cost}

    def consider(stop_set, is_owned):
        cap = owned_cap if is_owned else rent_cap
        riders = dem_per * len(stop_set)
        if riders > cap:
            return
        key = (is_owned, frozenset(stop_set))
        if key in seen:
            return
        dist, ride, riders, seq = route_metrics(stop_set, km, mins, dem_per)
        if ride > hard_ride:
            return
        seen.add(key)
        # cost = MARGINAL (what the MILP minimises): owned pays only diesel because
        #        driver+maint are sunk; rental pays its real step tariff.
        # true_cost = REAL daily ₹ for reporting (owned adds back sunk driver+maint),
        #        matching optimize.py so cost/head is comparable and honest.
        cost = (O.OWN_DIESEL_KM * dist) if is_owned else O.rent_cost(dist)
        true_cost = (O.OWN_DRIVER + O.OWN_MAINT + O.OWN_INSURANCE + O.OWN_DIESEL_KM * dist) if is_owned else O.rent_cost(dist)
        pool.append({"stops": list(stop_set), "owned": is_owned, "km": dist, "ride": ride,
                     "riders": riders, "seq": seq, "cost": cost, "true_cost": true_cost})

    # 1) sweep windows: contiguous runs in angular order, every length up to the cap
    for is_owned, maxlen in ((True, max_owned), (False, max_rent)):
        m = len(by_angle)
        for i in range(m):
            for L in range(1, maxlen + 1):
                window = [by_angle[(i + k) % m] for k in range(L)]
                consider(window, is_owned)

    # 2) nearest-neighbour clusters: grow each seed by nearest unused stop up to the cap
    for is_owned, maxlen in ((True, max_owned), (False, max_rent)):
        for seed in stops:
            cluster, used = [seed], {seed}
            while len(cluster) < maxlen:
                cand = min((s for s in stops if s not in used),
                           key=lambda s: km[cluster[-1]][s], default=None)
                if cand is None:
                    break
                cluster.append(cand); used.add(cand)
                consider(list(cluster), is_owned)

    # 3) singletons already covered by length-1 windows -> feasible partition guaranteed

    # 4) seed with the OR-Tools VRP routes so the pool is >= the VRP plan
    for is_owned, nodes in (seed_routes or []):
        consider(list(nodes), is_owned)

    return pool


_COORDS = {}   # node id -> (lat, lng), filled in main()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("stops", nargs="?", default="data/bus_stops.csv")
    ap.add_argument("--riders", type=int, default=1777)
    ap.add_argument("--seconds", type=int, default=30)
    ap.add_argument("--soft-ride", type=int, default=SOFT_RIDE_DEFAULT)
    ap.add_argument("--max-ride", type=int, default=HARD_RIDE_DEFAULT)
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args()

    stops = O.load_stops(args.stops)
    if args.limit:
        stops = stops[:args.limit]
    n_stops = len(stops)
    coords = [O.DEPOT] + [(s["lat"], s["lng"]) for s in stops]
    for i, (la, lo) in enumerate(coords):
        _COORDS[i] = (la, lo)

    head = args.riders / n_stops
    dem_per = max(1, math.ceil(head * (1 - O.ABSENTEE + O.BUFFER)))
    total_dem = dem_per * n_stops

    km, mins = O.build_matrices(coords)

    n_owned, n_rent = len(O.OWNED), len(O.RENTAL)
    owned_cap = max(c for _, c in O.OWNED) + O.CAP_LENIENCY      # 55 + 5
    rent_cap = max(c for _, c in O.RENTAL) + O.CAP_LENIENCY      # 15 + 5

    # per-vehicle fleet (real caps) for the VRP seed
    fleet = ([{"own": True, "cap": c} for _, c in O.OWNED] +
             [{"own": False, "cap": c} for _, c in O.RENTAL])
    caps = [f["cap"] + O.CAP_LENIENCY for f in fleet]
    demand = [0] + [dem_per] * n_stops
    N = n_stops + 1

    print(f"Generating candidate routes for {n_stops} stops, {total_dem} riders "
          f"({dem_per}/stop), caps owned {owned_cap} / rent {rent_cap}, hard ride {args.max_ride} min ...")
    print("  seeding with an OR-Tools VRP solution ...")
    # The VRP's Time dimension is CUMULATIVE route time (not the farthest-first passenger
    # ride), so it needs a generous ceiling to be feasible — same 260 optimize.py uses. The
    # real 120-min passenger-ride cap is still enforced by consider() as routes enter the pool.
    seed = vrp_seed_routes(N, fleet, demand, km, mins, caps, 260, min(args.seconds, 20))
    print(f"  VRP seed: {len(seed)} routes")
    pool = generate_pool(n_stops, km, mins, dem_per, owned_cap, rent_cap, args.max_ride, seed_routes=seed)
    print(f"  pool: {len(pool)} feasible routes "
          f"({sum(1 for r in pool if r['owned'])} owned + {sum(1 for r in pool if not r['owned'])} rental)")

    # ---------------- set-partitioning MILP (CP-SAT) ----------------
    model = cp_model.CpModel()
    x = [model.NewBoolVar(f"r{i}") for i in range(len(pool))]

    # every stop covered exactly once
    covers = {s: [] for s in range(1, n_stops + 1)}
    for i, r in enumerate(pool):
        for s in r["stops"]:
            covers[s].append(x[i])
    for s, xs in covers.items():
        model.Add(sum(xs) == 1)

    # fixed fleet: at most n_owned owned routes, at most n_rent rental routes
    model.Add(sum(x[i] for i, r in enumerate(pool) if r["owned"]) <= n_owned)
    model.Add(sum(x[i] for i, r in enumerate(pool) if not r["owned"]) <= n_rent)

    # minimise true cost (integer paise-free rupees; CP-SAT needs ints)
    model.Minimize(sum(int(round(pool[i]["cost"])) * x[i] for i in range(len(pool))))

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = float(args.seconds)
    solver.parameters.num_search_workers = 8
    print(f"Solving set-partition over {len(pool)} routes for up to {args.seconds}s ...")
    status = solver.Solve(model)
    status_name = solver.StatusName(status)
    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        print(f"No solution (status={status_name}). The pool may be too sparse.")
        return

    chosen = [pool[i] for i in range(len(pool)) if solver.Value(x[i]) == 1]
    obj = solver.ObjectiveValue()
    bound = solver.BestObjectiveBound()
    gap = (obj - bound) / obj * 100 if obj else 0.0

    # ---------------- report ----------------
    def metrics(rs):
        if not rs:
            return dict(buses=0, riders=0, seats=0, stops=0, avg_stops=0, util=0,
                        max_ride=0, avg_ride=0, km=0, cost=0, cost_head=0)
        riders = sum(r["riders"] for r in rs)
        seats = sum((owned_cap if r["owned"] else rent_cap) - O.CAP_LENIENCY for r in rs)
        cost = sum(r["true_cost"] for r in rs); st = sum(len(r["stops"]) for r in rs)
        return dict(buses=len(rs), riders=riders, seats=seats, stops=st, avg_stops=st / len(rs),
                    util=100 * riders / seats if seats else 0,
                    max_ride=max(r["ride"] for r in rs), avg_ride=sum(r["ride"] for r in rs) / len(rs),
                    km=sum(r["km"] for r in rs), cost=cost, cost_head=cost / riders if riders else 0)

    own_m = metrics([r for r in chosen if r["owned"]])
    rent_m = metrics([r for r in chosen if not r["owned"]])
    all_m = metrics(chosen)
    over_soft = sum(1 for r in chosen if r["ride"] > args.soft_ride)

    i = lambda v: f"{v:,.0f}"; p = lambda v: f"{v:.0f}%"; f1 = lambda v: f"{v:.1f}"
    def row(label, key, fmt):
        print(f"  {label:<20} {fmt(own_m[key]):>12} {fmt(rent_m[key]):>12} {fmt(all_m[key]):>12}")
    print("\n==================  FLEET METRICS (set-partition)  ==================")
    print(f"  {'':<20} {'OWNED':>12} {'RENTAL':>12} {'COMBINED':>12}")
    row("Buses used", "buses", i); row("Riders carried", "riders", i)
    row("Utilisation", "util", p); row("Avg stops / bus", "avg_stops", f1)
    row("Max ride (min)", "max_ride", i); row("Avg ride (min)", "avg_ride", i)
    row("Total km/day", "km", i); row("Cost Rs/day", "cost", i)
    row("Cost Rs/head/day", "cost_head", f1)
    print(f"\n  OVERALL: Rs {all_m['cost_head']:.1f}/head/day (Rs {all_m['cost_head']*O.WORKING_DAYS:,.0f}/mo)"
          f" | {all_m['util']:.0f}% util | max ride {all_m['max_ride']:.0f} min"
          f" | {all_m['buses']} buses | {over_soft} over {args.soft_ride}-min soft target")
    print(f"  OPTIMALITY (marginal Rs): solved Rs {obj:,.0f}/day; lower bound Rs {bound:,.0f}/day"
          f"  ->  within {gap:.2f}% of the cheapest combination OF THE GENERATED POOL ({status_name}).")
    print(f"  NOTE: gap is over the candidate pool, not all conceivable routes (that needs column generation).")

    # ---------------- write result.json (same shape optimize.py uses) ----------------
    def to_route(r):
        seq = r["seq"]
        return {"name": "", "type": "own" if r["owned"] else "rent",
                "cap": owned_cap - O.CAP_LENIENCY if r["owned"] else rent_cap - O.CAP_LENIENCY,
                "stops": len(seq), "riders": r["riders"], "km": round(r["km"], 1),
                # single-leg road distance factory -> farthest (first pickup) / -> last (nearest) stop
                "km_to_farthest": round(km[0][seq[0]], 1), "km_to_last": round(km[0][seq[-1]], 1),
                "ride": round(r["ride"]), "cost": round(r["true_cost"]),
                "seq": [{"name": stops[n - 1]["name"], "lat": stops[n - 1]["lat"], "lng": stops[n - 1]["lng"]}
                        for n in seq]}
    # assign owned/rental bus names in deployment order
    own_names = [nm for nm, _ in O.OWNED]; rent_names = [nm for nm, _ in O.RENTAL]
    out_routes, oi, ri = [], 0, 0
    for r in sorted(chosen, key=lambda r: (not r["owned"], -len(r["stops"]))):
        rt = to_route(r)
        if r["owned"]:
            rt["name"] = own_names[oi] if oi < len(own_names) else f"OWN{oi}"; oi += 1
        else:
            rt["name"] = rent_names[ri] if ri < len(rent_names) else f"RENT{ri}"; ri += 1
        out_routes.append(rt)

    out = {
        "params": {"riders": args.riders, "demand": total_dem, "max_ride": args.max_ride,
                   "soft_ride": args.soft_ride, "seconds": args.seconds, "stops": n_stops,
                   "depot": list(O.DEPOT), "method": "set-partition",
                   "optimality_gap_pct": round(gap, 2),
                   "bound_cost_day": round(bound), "solved_cost_day": round(obj)},
        "assumptions": {
            "own_driver_day": O.OWN_DRIVER, "own_maint_day": O.OWN_MAINT, "own_diesel_per_km": O.OWN_DIESEL_KM,
            "own_diesel_per_litre": O.DIESEL_PER_LITRE, "own_mileage_kmpl": O.MILEAGE_KMPL,
            "own_insurance_day": O.OWN_INSURANCE,
            "rent_tariff": "≤80km ₹1700 · ≤95km ₹1900 · beyond ₹18.7/km",
            "absentee_pct": round(O.ABSENTEE * 100), "buffer_pct": round(O.BUFFER * 100),
            "working_days": O.WORKING_DAYS, "cap_leniency": O.CAP_LENIENCY, "demand_per_stop": dem_per,
            "owned_loan": "excluded (capital, not operating cost)",
            "road_source": "cached Google road matrix (real driving km + minutes)",
        },
        "overall": all_m, "owned": own_m, "rental": rent_m, "routes": out_routes,
        # baseline for the savings simulator = actual annual spend (per working day); default Technotek
        "baseline": {"cost": round(O.TECH_BASELINE_YEAR / (O.WORKING_DAYS * 12)),
                     "year": O.TECH_BASELINE_YEAR,
                     "desc": "Technotek actual annual spend (FY24-25)"},
        "baselines": {"Technotek": O.TECH_BASELINE_YEAR, "Gainup": O.GAINUP_BASELINE_YEAR,
                      "Combined": O.TECH_BASELINE_YEAR + O.GAINUP_BASELINE_YEAR},
    }
    os.makedirs("public", exist_ok=True)
    with open(os.path.join("public", "solver_result.json"), "w", encoding="utf-8") as fh:
        json.dump(out, fh)
    print(f"\nWrote public/solver_result.json  ({len(out_routes)} routes, set-partition).")


if __name__ == "__main__":
    main()
