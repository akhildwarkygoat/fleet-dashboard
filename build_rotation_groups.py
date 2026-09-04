#!/usr/bin/env python3
"""
build_rotation_groups.py — cut and maintain src/rotationGroups.json: Empl_no -> rider group.

WHY THIS EXISTS
---------------
Rotational is planned as THREE FIXED GROUPS of riders x THREE CLOCKS = nine manager-finalised
plans (public/plans/rot/g{1,2,3}-{day,half,full}.json). Every Monday each group steps one place
along Day -> Full night -> Half night -> Day, and src/rotation.json says which group is on which
clock in any given week. Nothing is re-solved on a Monday; only the label moves.

The weekly roster (src/rotationalRoster.json) still decides WHO is on which slot this week, and
it is re-cut from the punch feed every Monday. But a slot code is not an identity: the same rider
reads "1" one week and "3" the next. This file is the identity. It was cut ONCE, in the anchor
week (2026-08-31), when the manager's batch numbers were exactly the ERP slot codes — group 1 =
the riders on Day that week, 2 = Half night, 3 = Full night — and from then on it is only ever
ADDED TO.

THE RULES
---------
  FIRST CUT   src/rotationGroups.json does not exist. Allowed only when the roster is cut for the
              anchor week (the one week in which slot code == group). group = roster slot, minus
              every rider on src/nonRotatingRiders.json — they are the standing exception and
              belong to no rotating group. Any other roster week is refused, with the fix.
  LATER RUNS  every existing assignment is KEPT, whatever the roster says this week. A rider in
              the roster but not in the file JOINS the group the rotation puts on their roster
              slot in the roster's week (step = whole weeks since the anchor, mod 3 — the same
              arithmetic as src/optimiser/rotation.js). Never-rotators are never added. Nobody is
              dropped automatically: a rider in the file but absent from this week's roster is
              LISTED, not removed — they may be on leave, the plan still holds their seat, and a
              leaver's group must not be silently re-cut under the manager's plan.

Only riders who genuinely have no group are placed by inference, and their placement is only as
good as the roster slot it was read from — a `projected` slot puts a joiner in a guessed group.
The dashboard shows the slot's source; a supervisor can move a rider by editing this file.

USAGE
-----
    python3 build_rotation_groups.py              # first cut, or add this week's joiners
    python3 build_rotation_groups.py --dry-run    # print the change set, write nothing

Run by refresh_routes.sh straight after build_rotational_roster.py, every Monday. Exits 7 when
it refuses — the same family as build_erp_routes.py's 5 (roster unreadable) and 6 (roster on
the wrong week): the input is not what it needs, and the message names the fix.
"""
import argparse, collections, datetime, json, os, sys, time

MANIFEST_PATH = "src/rotation.json"
ROSTER_PATH = "src/rotationalRoster.json"
NONROT_PATH = "src/nonRotatingRiders.json"
GROUPS_PATH = "src/rotationGroups.json"

SLOT_OF_CODE = {"1": "day", "2": "half", "3": "full"}      # ERP Pun_Shift code -> slot id
CODE_OF_SLOT = {v: k for k, v in SLOT_OF_CODE.items()}
SLOT_NAME = {"day": "Day", "half": "Half night", "full": "Full night"}
GROUP_IDS = ("1", "2", "3")

# What src/rotation.json says, restated. Used ONLY when that file cannot be found after
# waiting for it, and the run says so loudly — the manifest is the source of truth.
CONTRACT_MANIFEST = {
    "cycle": ["day", "full", "half"],
    "anchorWeek": "2026-08-31",
    "groups": {"1": {"atAnchor": "day"}, "2": {"atAnchor": "half"}, "3": {"atAnchor": "full"}},
}

EXIT_REFUSED = 7


def week_of(iso):
    d = datetime.date.fromisoformat(iso)
    return (d - datetime.timedelta(days=d.weekday())).isoformat()


# ---- the rotation arithmetic (mirrors src/optimiser/rotation.js exactly) ----------------
def step_for(week_iso, manifest):
    """0|1|2: how many places the cycle has turned between the anchor week and `week_iso`.
    Whole weeks between two Mondays; Python's % is already non-negative, so earlier weeks run
    backwards (2026-08-24 -> step 2) just as rotation.js's ((n % 3) + 3) % 3 does."""
    anchor = datetime.date.fromisoformat(week_of(manifest["anchorWeek"]))
    week = datetime.date.fromisoformat(week_of(week_iso))
    return ((week - anchor).days // 7) % 3


def slot_of_group(group, week_iso, manifest):
    cycle = manifest["cycle"]
    i = cycle.index(manifest["groups"][group]["atAnchor"])
    return cycle[(i + step_for(week_iso, manifest)) % len(cycle)]


def group_on_slot(slot, week_iso, manifest):
    for g in manifest["groups"]:
        if slot_of_group(g, week_iso, manifest) == slot:
            return g
    return None


def rotation_for(week_iso, manifest):
    """{week, step, bySlot: {slot: group}, byGroup: {group: slot}} — same shape as rotation.js."""
    by_group = {g: slot_of_group(g, week_iso, manifest) for g in manifest["groups"]}
    return {"week": week_of(week_iso), "step": step_for(week_iso, manifest),
            "bySlot": {s: g for g, s in by_group.items()}, "byGroup": by_group}


def describe_rotation(week_iso, manifest):
    r = rotation_for(week_iso, manifest)
    order = " · ".join(f"{SLOT_NAME[s]} = Group {r['bySlot'][s]}" for s in ("day", "half", "full"))
    return f"week {r['week']} (step {r['step']}): {order}"


def load_manifest(retries=0, delay=60, quiet=False):
    """src/rotation.json. With `retries`, wait for it — it is written by a different step and
    a fresh checkout may be mid-way through receiving it. The built-in copy is a last resort."""
    for attempt in range(retries + 1):
        if os.path.exists(MANIFEST_PATH):
            m = json.load(open(MANIFEST_PATH, encoding="utf-8"))
            for k in ("cycle", "anchorWeek", "groups"):
                if k not in m:
                    sys.exit(f"ERROR: {MANIFEST_PATH} has no '{k}' — not a rotation manifest.")
            return m, MANIFEST_PATH
        if attempt < retries:
            print(f"NOTE: {MANIFEST_PATH} not found — waiting {delay}s for it (attempt {attempt + 1} of {retries})")
            time.sleep(delay)
    if not quiet:
        print(f"WARNING: {MANIFEST_PATH} is missing. Using the built-in copy of its contents "
              f"(anchor {CONTRACT_MANIFEST['anchorWeek']}, cycle {'->'.join(CONTRACT_MANIFEST['cycle'])}).")
        print(f"         Restore the real file:  git checkout -- {MANIFEST_PATH}")
    return CONTRACT_MANIFEST, "(built-in defaults)"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="print the change set, write nothing")
    args = ap.parse_args()

    manifest, manifest_src = load_manifest(retries=2)
    anchor = week_of(manifest["anchorWeek"])

    if not os.path.exists(ROSTER_PATH):
        sys.exit(f"ERROR: {ROSTER_PATH} is missing. Cut it first:  python3 build_rotational_roster.py")
    roster = json.load(open(ROSTER_PATH, encoding="utf-8"))
    week = roster.get("_rotaWeek") or ""
    slots = roster.get("slots") or {}
    sources = roster.get("source") or {}
    if not week or not slots:
        sys.exit(f"ERROR: {ROSTER_PATH} has no _rotaWeek / slots. Re-cut it:  python3 build_rotational_roster.py")

    # Same stance as build_rotational_roster.py: losing the never-rotate list does not fail,
    # it silently files 104 standing riders into groups that then rotate them. Stop instead.
    if not os.path.exists(NONROT_PATH):
        sys.exit(f"ERROR: {NONROT_PATH} is missing — the 104 never-rotate riders must be kept OUT of the\n"
                 f"       rotating groups. Restore it:  git checkout -- {NONROT_PATH}")
    non_rotating = json.load(open(NONROT_PATH, encoding="utf-8"))["riders"]
    if len(non_rotating) < 50:
        sys.exit(f"ERROR: {NONROT_PATH} lists only {len(non_rotating)} riders; expected ~104. Restore it from git.")

    existing = {}
    if os.path.exists(GROUPS_PATH):
        doc = json.load(open(GROUPS_PATH, encoding="utf-8"))
        existing = doc.get("groups") or {}
        prev_anchor = doc.get("_anchorWeek")
        if prev_anchor and prev_anchor != anchor:
            # The manifest's anchor moved (a skipped Monday, see docs/rotation.md). The groups
            # are still the same people; only the step arithmetic changes. Say so, carry on.
            print(f"NOTE: {GROUPS_PATH} was cut against anchor {prev_anchor}; the manifest now says {anchor}.")
            print(f"      The group membership is unchanged by that; the week -> step mapping is not.")

    rot = rotation_for(week, manifest)
    print(f"manifest            : {manifest_src}")
    print(f"roster week         : {week}   anchor: {anchor}")
    print(f"rotation this week  : {describe_rotation(week, manifest)}")
    print(f"never-rotate riders : {len(non_rotating)} (kept out of every group)")

    groups = dict(existing)
    added, held_fixed, first_cut = {}, [], False
    if not existing:
        # ---- first cut: slot code IS the group, but only in the anchor week -------------
        if week != anchor:
            sys.exit(f"\nERROR: {GROUPS_PATH} does not exist and the roster is cut for week {week}, not the\n"
                     f"       anchor week {anchor}. Slot code == group number holds ONLY in the anchor week, so\n"
                     f"       a first cut from any other roster would file every rider in the wrong group.\n"
                     f"       Either restore the committed file:   git checkout -- {GROUPS_PATH}\n"
                     f"       or re-cut the roster for the anchor:  python3 build_rotational_roster.py --week {anchor}\n"
                     f"       (only possible while an ERP snapshot still covers that week), then run this again.",)
        first_cut = True
        for e, code in slots.items():
            if e in non_rotating:
                held_fixed.append(e)
                continue
            if code not in SLOT_OF_CODE:
                continue
            groups[e] = code                 # anchor week: step 0, group == slot code
            added[e] = code
    else:
        # ---- later runs: keep everything, add joiners where the rotation puts them ------
        for e, code in slots.items():
            if e in groups:
                continue
            if e in non_rotating:
                held_fixed.append(e)
                continue
            slot = SLOT_OF_CODE.get(code)
            if not slot:
                continue
            g = rot["bySlot"].get(slot)
            if g is None:
                continue
            groups[e] = g
            added[e] = g

    absent = sorted(e for e in groups if e not in slots)
    now_fixed = sorted(e for e in groups if e in non_rotating)
    counts = collections.Counter(groups.values())
    unplaced = int((roster.get("_counts") or {}).get("unplaced") or 0)

    print()
    print("composition:")
    for g in GROUP_IDS:
        at = SLOT_NAME[rot["byGroup"][g]] if g in rot["byGroup"] else "?"
        print(f"   Group {g}  {counts[g]:4}   (on {at} this week)")
    print(f"   fixed    {len(non_rotating):4}   never rotate — in no group")
    if unplaced:
        print(f"   unassigned {unplaced:2}   no slot in the roster, so no group and no plan")
    print()
    if first_cut:
        print(f"first cut from the anchor-week roster: {len(added)} riders grouped")
    else:
        print(f"riders kept as already grouped     : {len(existing)}")
        print(f"riders newly grouped               : {len(added)}")
        for g in GROUP_IDS:
            n = sum(1 for v in added.values() if v == g)
            if n:
                by_src = collections.Counter(sources.get(e, "?") for e, v in added.items() if v == g)
                print(f"   -> Group {g}  {n:3}   ({', '.join(f'{k} {v}' for k, v in sorted(by_src.items()))})")
        if added:
            guessed = [e for e in added if sources.get(e) != "observed"]
            if guessed:
                print(f"   {len(guessed)} of them placed from a projected/carried slot, not a punch — a guess, check it:")
                print(f"      " + ", ".join(guessed))
    if absent:
        print(f"riders grouped but NOT in this week's roster: {len(absent)}  (kept — nobody is dropped automatically)")
        print(f"   " + ", ".join(absent))
    if now_fixed:
        print(f"NOTE: {len(now_fixed)} grouped rider(s) are now on the never-rotate list; kept in their group, "
              f"remove by hand if the manager agrees: " + ", ".join(now_fixed))

    if args.dry_run:
        print("\n--dry-run: nothing written")
        return

    out = {
        "_comment": ("Rotational rider groups: Empl_no -> group (1/2/3). The three FIXED groups the nine "
                     "manager-finalised plans were built for; which group runs which clock in a given week "
                     "is decided by src/rotation.json. Employee numbers only — no names, no GPS."),
        "_anchorWeek": anchor,
        "_rule": ("cut once from src/rotationalRoster.json in the anchor week (group = ERP slot code that "
                  "week), excluding every rider in src/nonRotatingRiders.json; afterwards existing "
                  "assignments are kept and a new roster rider joins the group the rotation puts on their "
                  "roster slot in the roster's week; nobody is removed automatically"),
        "_builtBy": "build_rotation_groups.py",
        "_counts": {**{g: counts[g] for g in GROUP_IDS}, "fixed": len(non_rotating), "unassigned": unplaced},
        "groups": {e: groups[e] for e in sorted(groups)},
    }
    json.dump(out, open(GROUPS_PATH, "w", encoding="utf-8"), indent=0, sort_keys=False)
    print(f"\nwrote {GROUPS_PATH}")


if __name__ == "__main__":
    try:
        main()
    except SystemExit as e:
        # sys.exit("message") is Python's exit 1; this script's refusals are exit 7 so the
        # Monday job can tell "the group cut refused" from an unrelated crash.
        if isinstance(e.code, str):
            sys.stdout.flush()               # keep the report above the refusal in a log file
            print(e.code, file=sys.stderr)
            sys.exit(EXIT_REFUSED)
        raise
