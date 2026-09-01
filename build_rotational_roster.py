#!/usr/bin/env python3
"""
build_rotational_roster.py — re-cut src/rotationalRoster.json from the ERP punch feed.

WHY THIS EXISTS
---------------
Rotational runs three round-the-clock slots and every rider steps one place along
    Day -> Full night -> Half night -> Day
every Monday. `Pun_Shift` in the feed is a PUNCH, not an assignment: it exists only on days a
rider clocked in, and ~31% of rotational rows are blank.

The first roster was cut with "each rider's most recent NON-BLANK Pun_Shift". That rule reaches
back ACROSS a Monday, so a rider who had not clocked in that week was frozen with the PREVIOUS
week's slot — which, for anyone who rotates, is guaranteed wrong. Measured on the 507 riders who
punched in two consecutive weeks, predicting the later week from the earlier one:

    carry the old value forward (the old rule) ...... 18.7% correct
    step one Monday ................................ 76.3% correct
    step, but hold the known non-rotators still .... 89.7% correct   <-- the rule used here

That is the whole bug: vehicle TN57D7999 showed on the Half night board because five riders
mapped to it last punched on 08-09 Aug, the week BEFORE the freeze, on Half night.

THE RULE
--------
For each rider on ROTATIONAL SHIFT, in this order — first hit wins:

  1. OBSERVED   they punched a 1/2/3 in the target rota week -> use the modal value.
                No inference at all. This is ground truth and covers ~75% of riders.
  2. PROJECTED  they punched in an earlier week the feed still carries -> step their slot one
                place per Monday between that week and the target week.
  3. STALE      they are absent from the current feed entirely (its window is ~11 days) but
                appear in an older snapshot -> same projection, from further back.
  4. UNPLACED   no punch anywhere -> left out. serviceIdFor() puts a slotless rider in NO
                rotational service rather than guessing, so they are visibly missing.

Riders on the never-rotate list (src/nonRotatingRiders.json) are HELD at their slot instead of
stepped — they are the standing exception the cycle does not apply to, and stepping them is what
the 76.3% -> 89.7% jump above is buying.

Every rider carries its `source` so the dashboard can show an inferred slot differently from an
observed one: a projected rider is a good guess, not a fact, and the map says so.

USAGE
-----
    python3 build_rotational_roster.py                      # newest snapshot -> current rota week
    python3 build_rotational_roster.py --week 2026-08-24    # pin the target week
    python3 build_rotational_roster.py --dry-run            # print the change set, write nothing

Snapshots are read newest-first; add older ones to widen the history the projection can reach.
RE-RUN THIS AND REBUILD ALL THREE PLANS TOGETHER (build_service_plans.mjs). A roster that moves
without its plans is what put riders in the wrong slot in the first place.
"""
import argparse, collections, datetime, json, os, re, sys

SLOTS = {"1", "2", "3"}
NAME = {"1": "Day", "2": "Half night", "3": "Full night"}
# One Monday forward. Verified against the feed on every week pair it carries: the three
# commonest transitions are exactly these, at 78-82% of all riders seen in both weeks.
STEP = {"1": "3", "3": "2", "2": "1"}

DEFAULT_SNAPSHOTS = ["data/erp_audit.json", "data/erp_live.fresh.json", "data/erp_live.json"]
ROSTER_PATH = "src/rotationalRoster.json"
NONROT_PATH = "src/nonRotatingRiders.json"


def norm_date(s):
    m = re.match(r"^(\d{2})-(\d{2})-(\d{4})", str(s or ""))
    return f"{m.group(3)}-{m.group(2)}-{m.group(1)}" if m else ""


def norm_shift(s):
    return re.sub(r"\s+", " ", str(s or "")).strip()


def week_of(iso):
    d = datetime.date.fromisoformat(iso)
    return (d - datetime.timedelta(days=d.weekday())).isoformat()


def load(paths):
    """Newest snapshot wins for any (employee, date) it shares with an older one."""
    seen, rows, used = set(), [], []
    for p in paths:
        if not os.path.exists(p):
            continue
        used.append(p)
        for r in json.load(open(p)):
            e = (r.get("Empl_no") or "").strip()
            d = norm_date(r.get("date"))
            if not e or not d or (e, d) in seen:
                continue
            seen.add((e, d))
            rows.append(r)
    if not rows:
        sys.exit("ERROR: no ERP snapshot found. Looked for: " + ", ".join(paths))
    return rows, used


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--week", help="target rota week (any date in it); default = today's week")
    ap.add_argument("--snapshots", nargs="*", default=DEFAULT_SNAPSHOTS)
    ap.add_argument("--dry-run", action="store_true")
    # Escape hatches. Neither is ever passed by the automation: refresh_routes.sh runs this
    # script bare, so a run that needs one of these is a run a person has to think about.
    ap.add_argument("--no-nonrotating", action="store_true",
                    help="step the never-rotate riders too (they are HELD by default)")
    ap.add_argument("--accept-large-change", action="store_true",
                    help="allow a cut that drops riders present in the previous roster")
    args = ap.parse_args()

    rows, used = load(args.snapshots)
    target = week_of(args.week) if args.week else week_of(datetime.date.today().isoformat())

    # The never-rotate list is NOT optional. Losing it does not fail — it silently steps the
    # 104 riders the whole exception exists for, and the log still reads normal. Measured on
    # the 2026-08-31 cut: with the file, 701 riders move; without it, 801, and 100 of the 104
    # pinned riders land in the wrong slot. That is invisible in every number this script
    # prints, which is exactly why it has to stop here instead.
    if args.no_nonrotating:
        non_rotating = set()
        print("WARNING: --no-nonrotating — the never-rotate riders will be STEPPED like everyone else.")
    else:
        if not os.path.exists(NONROT_PATH):
            sys.exit(f"ERROR: {NONROT_PATH} is missing.\n"
                     f"       104 riders never rotate and must be HELD, not stepped. Without this file\n"
                     f"       ~100 of them are put in the wrong slot and nothing in the output says so.\n"
                     f"       Restore it:  git checkout -- {NONROT_PATH}\n"
                     f"       (or pass --no-nonrotating if you really mean to step everyone)")
        non_rotating = set(json.load(open(NONROT_PATH))["riders"])
        if len(non_rotating) < 50:
            sys.exit(f"ERROR: {NONROT_PATH} lists only {len(non_rotating)} riders; expected ~104.\n"
                     f"       A truncated list steps the riders it lost. Restore it from git.")
    prev_doc = json.load(open(ROSTER_PATH)) if os.path.exists(ROSTER_PATH) else {}
    previous = prev_doc.get("slots", {})
    prev_week = prev_doc.get("_rotaWeek") or ""

    votes = collections.defaultdict(collections.Counter)   # (emp, week) -> Counter(slot)
    shift, name = {}, {}
    for r in rows:
        e = (r.get("Empl_no") or "").strip()
        d = norm_date(r.get("date"))
        if not e or not d:
            continue
        shift[e] = norm_shift(r.get("Shift"))
        name[e] = (r.get("Name") or "").strip()
        s = str(r.get("Pun_Shift") or "").strip()
        if s in SLOTS:
            votes[(e, week_of(d))][s] += 1

    rotational = sorted(e for e, s in shift.items() if s == "ROTATIONAL SHIFT")
    # `Shift` is free ERP text matched here as a literal. If the ERP ever renames it, this
    # matches nobody and the script writes an EMPTY roster stamped with the CORRECT week —
    # which sails through build_erp_routes.py's week gate and ships a fleet-wide zero split.
    if not rotational:
        seen = collections.Counter(shift.values()).most_common(8)
        sys.exit("ERROR: no rider has Shift == 'ROTATIONAL SHIFT' — the ERP's shift string has changed.\n"
                 "       Shift values in this feed: "
                 + ", ".join(f"{k!r} ({n})" for k, n in seen))
    weeks_desc = sorted({w for _, w in votes}, reverse=True)
    tgt = datetime.date.fromisoformat(target)

    slots, source, from_week, unplaced = {}, {}, {}, []
    for e in rotational:
        held = e in non_rotating
        for w in weeks_desc:
            if w > target or not votes[(e, w)]:
                continue                                  # ignore future weeks and silent ones
            steps = (tgt - datetime.date.fromisoformat(w)).days // 7
            s = votes[(e, w)].most_common(1)[0][0]
            if not held:
                for _ in range(steps):
                    s = STEP[s]
            slots[e] = s
            source[e] = "observed" if steps == 0 else ("projected" if steps == 1 else "stale")
            from_week[e] = w
            break
        else:
            unplaced.append(e)

    # ---- riders the FEED no longer reaches ------------------------------------------
    # The ERP window is ~11 days. This machine may also hold older dumps, but those are 47 MB
    # of names, home GPS and attendance — gitignored, and rightly never committed. So a fresh
    # clone sees LESS history than the machine the roster was last cut on, and riders who last
    # punched a fortnight ago simply vanish from it. Measured on the factory PC: 28 riders
    # present here, absent there, from the same ERP.
    #
    # The previous roster is the portable history. It IS committed — employee numbers and
    # slots only, no names, no GPS — so every machine has it. Carry those riders at their last
    # known slot, stepped one Monday at a time, held if they never rotate, and mark them
    # `carried` so the map shows the slot as inferred rather than read.
    carried = []
    if previous and prev_week:
        gap = (tgt - datetime.date.fromisoformat(prev_week)).days // 7
        if 0 <= gap <= 4:                       # older than a month is guesswork, not history
            for e, v in previous.items():
                if e in slots:
                    continue
                if not args.no_nonrotating and e in non_rotating:
                    pass                        # held: their slot does not move
                else:
                    for _ in range(gap):
                        v = STEP[v]
                slots[e] = v
                source[e] = "carried"
                from_week[e] = prev_week
                carried.append(e)
        elif gap > 4:
            print(f"NOTE: the previous roster is {gap} weeks old — too stale to carry riders forward from.")

    # A rider just carried is no longer unplaced — count them once, in one place.
    unplaced = [e for e in unplaced if e not in slots]

    counts = collections.Counter(slots.values())
    by_source = collections.Counter(source.values())
    # Diff BOTH ways. Iterating only the new map means a cut that loses riders reports
    # "0 changes" — the reassuring number a broken input produces.
    changed = {e: (previous.get(e), slots[e]) for e in slots if previous.get(e) != slots[e]}
    dropped = sorted(set(previous) - set(slots))
    added = sorted(set(slots) - set(previous))

    print(f"snapshots read      : {', '.join(used)}")
    print(f"target rota week    : {target} (Monday)")
    print(f"rotational riders   : {len(rotational)}")
    print(f"placed              : {len(slots)}   unplaced: {len(unplaced)}")
    print()
    print("how each rider was resolved:")
    for k in ("observed", "projected", "stale"):
        if by_source[k]:
            note = {"observed": "punched this week — ground truth",
                    "projected": "stepped one Monday from last week",
                    "stale": "stepped from an older snapshot"}[k]
            print(f"   {by_source[k]:4}  {k:9} {note}")
    if carried:
        print(f"   {len(carried):4}  carried   absent from this ERP feed — slot brought forward from the previous roster")
    if unplaced:
        print(f"   {len(unplaced):4}  unplaced  no punch in any snapshot — in NO rotational service")
    print()
    print("composition:")
    for k in "123":
        print(f"   {NAME[k]:11} {counts[k]:4}")
    print()
    print(f"riders whose slot changes vs the existing roster: {len(changed)}")
    move = collections.Counter((NAME.get(a, "unplaced"), NAME[b]) for a, b in changed.values())
    for (a, b), n in sorted(move.items(), key=lambda x: -x[1]):
        print(f"   {a:11} -> {b:11} {n}")
    if added:
        print(f"   new to the roster        {len(added)}")
    if dropped:
        print(f"   DROPPED from the roster  {len(dropped)}  -> in NO rotational service")

    # A cut that loses riders is either a truncated feed or a changed ERP field, and either
    # way those riders vanish from all three slots without appearing in any "moved" tally.
    # After carrying, a still-dropped rider is one no source can place — a genuinely short
    # pull, not merely a machine with less history. A few is ordinary attrition; a lot is the
    # truncated-feed case this guard was built for.
    if dropped and not args.accept_large_change:
        share = len(dropped) / max(len(previous), 1)
        if share > 0.05:
            sys.exit(f"\nERROR: this cut drops {len(dropped)} rider(s) that the previous roster placed"
                     f" ({len(previous)} -> {len(slots)}, {share:.0%}).\n"
                     f"       They would be in NO rotational service. Usual cause: a short or stale ERP pull.\n"
                     f"       Re-run with --accept-large-change if this is genuinely intended.")
        print(f"   ({len(dropped)} dropped rider(s), {share:.1%} — within normal attrition, continuing)")

    if args.dry_run:
        print("\n--dry-run: nothing written")
        return

    out = {
        "_comment": ("Rotational roster: Empl_no -> slot (1 Day / 2 Half night / 3 Full night). "
                     "Employee numbers only — no names, no GPS."),
        "_rule": ("modal Pun_Shift in the target rota week; otherwise the modal value from the most "
                  "recent earlier week stepped one place per Monday (Day->Full->Half->Day), with "
                  "riders on nonRotatingRiders.json held instead of stepped"),
        "_rotaWeek": target,
        "_builtBy": "build_rotational_roster.py",
        "_snapshots": used,
        "_counts": {"rot-day": counts["1"], "rot-half": counts["2"], "rot-full": counts["3"],
                    "placed": len(slots), "rotationalRiders": len(rotational),
                    "unplaced": len(unplaced), "carried": len(carried),
                   **{k: by_source[k] for k in ("observed", "projected", "stale")}},
        # per rider: where the slot came from, so the map can mark an inferred slot as inferred
        "source": {e: source[e] for e in sorted(source)},
        "fromWeek": {e: from_week[e] for e in sorted(from_week)},
        "slots": {e: slots[e] for e in sorted(slots)},
    }
    json.dump(out, open(ROSTER_PATH, "w"), indent=0, sort_keys=False)
    print(f"\nwrote {ROSTER_PATH}")
    if unplaced:
        print("unplaced riders (need a supervisor to place them): " + ", ".join(unplaced))


if __name__ == "__main__":
    main()
