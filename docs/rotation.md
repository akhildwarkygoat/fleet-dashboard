# Rotational: nine plans, three groups, one calendar

Rotational runs three round-the-clock slots — **Day** (gate 06:00), **Half night** (14:00),
**Full night** (22:00) — and every Monday each rider steps one place along

```
Day  ->  Full night  ->  Half night  ->  Day
```

Until 2026-09-04 the dashboard held **three** plans, one per slot, and each had to be rebuilt
whenever the people on that slot changed — which is every Monday. That is what put riders in the
wrong slot (see [HANDOFF_ROTATIONAL.md](../HANDOFF_ROTATIONAL.md) §2) and what made the plans
"fall behind the roster" every week.

The transport manager does not plan it that way. He plans **three fixed groups of people**, each
at **all three clocks**: nine plans, built once. On a Monday nothing is re-solved — only the label
moves. This document is how the dashboard now does the same.

## The nine plans

Delivered 2026-09-03 as `_incoming/rotationalshiftdata/<N> <SHIFT> PLAN 0209.json`, imported to
`public/plans/rot/g<N>-<clock>.json`:

| group | manager's file | riders | buses | clock | dashboard file |
| --- | --- | --- | --- | --- | --- |
| 1 | `1 DAY NEW PLAN  0209.json` | 249 | 9 | day | `plans/rot/g1-day.json` |
| 1 | `1 HALF NIGHT PLAN 0209.json` | 249 | 9 | half | `plans/rot/g1-half.json` |
| 1 | `1 FULL NIGHT PLAN 0209.json` | 249 | 10 | full | `plans/rot/g1-full.json` |
| 2 | `2 DAY SHIFT PLAN 0209.json` | 304 | 8 | day | `plans/rot/g2-day.json` |
| 2 | `2 OFF NIGHT PLAN 0209.json` | 304 | 11 | half | `plans/rot/g2-half.json` |
| 2 | `2 FULL NIGHT PLAN 0209.json` | 304 | 8 | full | `plans/rot/g2-full.json` |
| 3 | `3 DAY SHIFT PLAN 0209.json` | 251 | 10 | day | `plans/rot/g3-day.json` |
| 3 | `3 HALF NIGHT PLAN 0209.json` | 250 | 10 | half | `plans/rot/g3-half.json` |
| 3 | `3 FULL NIGHT PLAN 0209.json` | 250 | 10 | full | `plans/rot/g3-full.json` |

"Off night" is the manager's name for Half night. Within a batch the three files are the same
people planned at three clocks — the rider totals say so.

### The evidence that batch N is a group, not a slot

The leading number is the group's **ERP slot code in the anchor week beginning 2026-08-31**:
group 1 = the riders who were on Day that week, 2 = Half night, 3 = Full night. Verified on
2026-09-04 by GPS-matching every stop in each file (60 m) against the home coordinates of the
riders the roster placed on each slot that week (never-rotators excluded):

| file | riders on slot 1 that week | on slot 2 | on slot 3 |
| --- | --- | --- | --- |
| `1 DAY / HALF / FULL` | **95–98%** | 23–24% | 15% |
| `2 DAY / OFF / FULL` | 9–17% | **89–97%** | 22–24% |
| `3 DAY / HALF / FULL` | 14% | 16% | **98%** |

The off-diagonal figures are villages several groups share a stop in, not membership. The totals
line up the same way: the roster's anchor-week slots hold 249 / 305 / 251 riders; the files
carry 249 / 304 / 250–251.

The three `public/plan_rot-*.finalised.json` files committed on 2026-09-02 ("batch 1 of 3") were
the same delivery read the other way — as this week's Day / Half / Full plans. They were built on
the **previous** week's roster, so they were one rotation step stale: the "Day" file held the
riders who are on Full night this week. They are retired; nothing reads them.

## The manifest: `src/rotation.json`

```json
{
  "cycle": ["day", "full", "half"],
  "anchorWeek": "2026-08-31",
  "received": "2026-09-03",
  "groups": {
    "1": { "label": "Group 1", "atAnchor": "day",  "plans": { "day": "/plans/rot/g1-day.json", "half": "…", "full": "…" } },
    "2": { "label": "Group 2", "atAnchor": "half", "plans": { … } },
    "3": { "label": "Group 3", "atAnchor": "full", "plans": { … } }
  }
}
```

The whole rule is one line: a group at `cycle[i]` in one week is at `cycle[(i+1) % 3]` the next.
So for any Monday `W`:

```
step(W)            = (whole weeks from anchorWeek to W) mod 3      (negative weeks run backwards)
slotOfGroup(g, W)  = cycle[(cycle.indexOf(atAnchor[g]) + step(W)) % 3]
planFor(slot, W)   = groups[groupOnSlot(slot, W)].plans[slot]
```

That arithmetic lives in exactly two places and they must agree: `src/optimiser/rotation.js`
(the dashboard) and `build_rotation_groups.py` (the scripts; `build_rotational_roster.py` imports
it rather than carrying a copy). The dashboard follows the calendar; the Planner can pin a week
to look at another one, and that pin lives in the browser only.

### The cycle, this week and the next six

| week of | step | Day | Half night | Full night |
| --- | --- | --- | --- | --- |
| 2026-08-31 | 0 | Group 1 | Group 2 | Group 3 |
| 2026-09-07 | 1 | Group 2 | Group 3 | Group 1 |
| 2026-09-14 | 2 | Group 3 | Group 1 | Group 2 |
| 2026-09-21 | 0 | Group 1 | Group 2 | Group 3 |
| 2026-09-28 | 1 | Group 2 | Group 3 | Group 1 |
| 2026-10-05 | 2 | Group 3 | Group 1 | Group 2 |
| 2026-10-12 | 0 | Group 1 | Group 2 | Group 3 |

Read it as "a group's plan for the clock it is on": in the week of 7 September the Day gate runs
`g2-day.json`, Half night `g3-half.json`, Full night `g1-full.json`. The week before the anchor
(2026-08-24) was step 2 — which is why the Sep-2 set was stale by exactly one place.

## The three files that move, and the one that does not

| file | says | changes |
| --- | --- | --- |
| `src/rotationalRoster.json` | **who** is on which slot this week (Empl_no → 1/2/3) | re-cut from the punch feed every Monday by `build_rotational_roster.py` |
| `src/rotationGroups.json` | **which group** each rotating rider belongs to (Empl_no → 1/2/3) | cut once in the anchor week; afterwards **only added to**, by `build_rotation_groups.py` |
| `src/rotation.json` | which group is on which clock, by week | only when a new delivery is imported, or a Monday is skipped |
| `public/plans/rot/*.json` | the nine plans | only when the manager delivers a new set |

The roster still drives everything that is about **people**: the Stops board, the ERP split in
`current_routes.json`, `serviceIdFor()`. The manifest drives everything that is about **plans**.
A slot code is not an identity — the same rider reads `1` one week and `3` the next — which is
why the groups file exists: it was cut in the one week in which slot code and group number were
the same thing, and from then on it is the identity.

`build_rotation_groups.py` runs right after the roster in every `refresh_routes.sh` mode that
re-cuts it (including `--roster-only`). A rider new to the roster joins the group the calendar
puts on their roster slot that week; nobody is removed automatically (a rider absent from the
roster is listed, not dropped — the plan still holds their seat). It refuses with **exit 7** if
the groups file is missing and the roster is not on the anchor week, because a first cut from
any other week would file everyone in the wrong group.

Current counts (2026-09-04): Group 1 **221**, Group 2 **235**, Group 3 **245**, fixed **104**
(never rotate, in no group), 2 rotational riders with no slot anywhere.

## Importing a new delivery

When the manager sends a new set of nine, do not hand-edit anything:

```bash
node scripts/import_rotation_plans.mjs --from "_incoming/<folder>" --received 2026-10-01 --anchor 2026-09-28
```

`--anchor` is the Monday in which his batch numbers equal the ERP slot codes — ask him which week
he cut the groups from, and check it the same way as above (GPS-match a file's stops against
that week's roster slots; the diagonal should be 90%+). The importer rewrites
`public/plans/rot/g*-*.json` with the plan bodies plus the `service`, `costing` and `source`
blocks the dashboard reads, and regenerates `src/rotation.json`. Then:

```bash
python3 build_rotational_roster.py     # prints the rotation check against the new anchor
python3 build_rotation_groups.py       # only if the groups themselves were re-cut — see below
git add src/rotation.json public/plans/rot && git commit
```

If the new delivery re-groups the riders (not just re-routes the same groups), delete
`src/rotationGroups.json` first, make sure the roster is cut for the new anchor week
(`python3 build_rotational_roster.py --week <anchor>`), and let `build_rotation_groups.py` make
its first cut again. A delivery that keeps the same three groups needs no such step.

## A Planner draft finalised on a Rotational slot pins that slot

Finalised choices are keyed by SERVICE id, and for Rotational the service is the SLOT. A draft
finalised on `rot-day` therefore keeps overriding Day for whichever group rotates onto Day next
Monday — the same one-step-stale failure that retired the Sep-2 files, only stored in the
browser. The Fleet plan banner, the FinalisationBoard and the Timings slots table all say so
("finalised over the rota" / "Fleet plan runs … instead"), but nothing expires it: **Revert** the
row on the Overall Fleet plan when the override is done.

One case is dropped automatically: a draft whose name is one of the manager's deliveries
(`<N> DAY|HALF|OFF|FULL … PLAN 0209`) finalised on a slot. Those are the anchor-week group plans
frozen onto a slot, which the rotation already serves — from `public/plans/rot/` and moved on
with the calendar — so `finalisedPlans.js` treats such a ref as retired, purges it from
`opt-finalised` on first resolve and leaves it out of exports. Any other draft name is a real
manual override and wins.

## If a Monday is skipped

The calendar assumes the floor rotates every Monday. If the factory skips one (a holiday week in
which nobody moves), the floor is one step **behind** the calendar from then on, and every
group is at the wrong clock on the dashboard. You will see it in the weekly self-check below:
agreement drops from ~90% to under 10% for **all three** groups at once.

Fix: move `anchorWeek` in `src/rotation.json` **forward by 7 days**, commit it with the reason,
and re-run `python3 build_rotational_roster.py` — the check should go back to ~90%. The groups
file does not change (the people are the same); only the week → step arithmetic does.
`build_rotation_groups.py` notices the moved anchor and says so.

A drop for **one** group only is not a skipped Monday. It is a re-grouping on the floor — ask the
manager before touching anything.

## The never-rotate gap — open with the manager

104 riders never rotate (`src/nonRotatingRiders.json`: 24 Day, 71 Half night, 9 Full night).
They are held out of the rotating groups on the dashboard, but the manager's plans were cut from
the anchor week's slots, so each of his groups carries the fixed riders who happened to be on
that slot that week — and those riders then rotate **with the plan** although they do not rotate
on the floor.

Measured on the 71 fixed Half-night riders: Group 2's Off Night file carries **66** of them;
groups 1 and 3 carry **3** and **8** (a 60 m GPS re-check on 2026-09-04 gave 5 / 67 / 10 — the
same picture). So in the week Group 2 is on Half night the fixed Half-night riders have a bus;
in the other two weeks the Half-night plan on the board is Group 3's or Group 1's, which has a
seat for at most a handful of them. The same holds, in smaller numbers, for the 24 fixed Day and
9 fixed Full-night riders.

This is not something the dashboard can fix by arithmetic. It needs one of:

- the manager keeps the fixed riders in a standing plan of their own (as
  [HANDOFF_ROTATIONAL.md](../HANDOFF_ROTATIONAL.md) §4 proposed: 24 / 71 / 9 riders, one small
  plan per clock), and re-cuts the nine without them; or
- the fixed riders are carried by whichever group's plan is on their clock — which means the
  nine plans have to be re-cut with those stops in all three groups' files for that clock.

Until it is settled, the board is right for those 104 one week in three.

## The weekly self-check

Every roster re-cut prints a **rotation check** and stores it in the roster as `_rotation`:

```
rotation check      : week 2026-08-24 (step 2): Day = Group 3 · Half night = Group 1 · Full night = Group 2
   Group 1  predicted Half night   punched 208  agree 195    94%
   Group 2  predicted Full night   punched 219  agree 197    90%
   Group 3  predicted Day          punched 237  agree 201    85%
```

For each group, among members who actually **punched** that week, the share whose punched slot
is the one the calendar predicts. Only observed riders count — a projected slot was itself
produced by stepping, so it would agree by construction. The figures above are a real test: the
groups were cut on 2026-08-31 and checked against the previous week's punches, backwards.

- **85–95%** is normal. The remainder is the ~10% of riders who rotate irregularly (measured in
  HANDOFF §4: it oscillates 6–11% and does not compound).
- **Under 75% for all three groups** is the skipped-Monday case. With the anchor deliberately
  moved one week the same check reads 5% / 6% / 7%. `build_rotational_roster.py` prints a
  warning naming the fix, `refresh_routes.sh` repeats it, and `weekly-refresh.log` carries it in
  the success summary:

```
    rotation (step 1): Day = Group 2 · Half night = Group 3 · Full night = Group 1
    punches agree with the calendar: Group 1 91%, Group 2 88%, Group 3 93%
```

- **100%** in the anchor week itself proves nothing (the groups were cut from those punches).
  The first real reading is the Monday after.

`_rotation` in the roster looks like this, for anything that wants to read it back:

```json
"_rotation": {
  "week": "2026-09-07", "step": 1,
  "predicted": { "day": "2", "half": "3", "full": "1" },
  "agreement": { "1": { "n": 208, "match": 195, "share": 0.938 }, "2": { … }, "3": { … } }
}
```
