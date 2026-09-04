# Handoff — Rotational shift, ERP mismatches, and the plan-count decision

Session of 2026-08-25. Branch `finalised-plans`, all work pushed to `main` (latest `32eec45`).
Everything below was measured against the live ERP feed, not assumed.

---

## 1. The one thing to understand first

**The ERP records which bus a person *belongs to*. It never records which trip they *rode*.**

`VehicleEmpMapDetails` gives one row per employee per date with a single `VehName`, and that
value does not change when the employee's shift changes. Measured: **802 of 802** rotational
employees have exactly one vehicle across the whole feed, and of the **644** who were observed
punching two different shifts, **644 (100%)** kept the same bus.

Almost every problem in this session traces back to that gap. The per-shift vehicle assignment
exists only on the transport manager's spreadsheet.

### The rota

Three round-the-clock slots. Every rider steps one place **every Monday**:

```
Day (gate 06:00) -> Full night (22:00) -> Half night (14:00) -> Day
```

Confirmed independently on every week pair the feed carries: those three transitions account for
78–82% of all riders seen in both weeks.

### Fields that matter

| field | meaning |
|---|---|
| `Pun_Shift` | `1`=Day, `2`=Half night, `3`=Full night; also `GS`/`G`/`GW`; **blank when the rider did not clock in** (~31% of rotational rows) |
| `Pun_Shift_Desc`, `StartTime` | the same fact restated — blank whenever `Pun_Shift` is blank, so they add nothing |
| `Shift` | free text, `"ROTATIONAL SHIFT"` for all three slots — cannot distinguish them |
| `Att_Type` | `1-Present` / `2-Absent` |

---

## 2. What was broken and is now fixed

All four were verified against raw ERP rows before and after.

**a. The roster reached back across a Monday.** It was cut with "each rider's most recent
non-blank punch", unbounded by week, so anyone who had not clocked in that week was frozen with
the *previous* week's slot — guaranteed wrong for anyone who rotates. Measured on 507 riders who
punched in two consecutive weeks:

| rule | correct |
|---|---|
| carry the old value forward (what it did) | **18.7%** |
| step one Monday | 76.3% |
| step, but hold known non-rotators | **89.7%** ← now used |

This is why TN57D7999 appeared on the Half night board: five riders on it last punched 08–09 Aug,
the week *before* the freeze, while the bus ran 17 Day punches on the 10th.

**b. The Stops board named another service's bus.** `vehFor()` read a stop→vehicle map built from
one globally-selected plan (default `solver_result.json`, the 9 am plan) and matched on stop
*name* before falling back to the ERP. **519 of 788 stops** showed a registration no rider there
is assigned to. The ERP assignment now wins; coordinates are matched before names.

**c. Absentee was counted per row, over every calendar day.** The feed repeats rows —
**11,488 of 61,457** are duplicates — and includes Sundays (~87% marked absent, nobody rostered)
and the in-progress pull date. That overstated absentee by **8.2 points** (25.4% vs 17.2%). Since
demand is `ceil(head × (1 − absentee + 0.03))`, it **under-provisioned every stop**: a 20-rider
stop was planned for 16 seats instead of 18. Now counted once per rider-day, working days only.

**d. The plan builder had its own copy of that sum.** Fixing `erp.js` alone left the plans on the
old inflated rate. Both now compute it identically — that is what lets a plan reconcile to the
dashboard at all.

### Verified after the fix

| check | result |
|---|---|
| roster vs raw punches | **624 of 624** riders with a punch this week are in the slot the ERP recorded; the 594 marked `observed` match their modal punch 100% |
| plans vs roster | all three reproduce exactly — demand 258/295/271, stops 149/171/147 |
| screen vs ERP | cards read 249/291/251; **0 of 467** stops show a bus no rider there is assigned to |
| bus feasibility | 0 double-bookings, 0 turnarounds under 60 min, 194–224 spare seats per shift |

---

## 3. Current state

- `src/rotationalRoster.json` — cut for rota week **2026-08-24**. 249 Day / 293 Half / 252 Full.
  Per rider it records `source`: **594 observed** (punched this week), **167 projected** (stepped
  one Monday), **30 stale** (stepped from an older snapshot), **2 unplaced**.
- `public/plan_rot-{day,half,full}.json` — rebuilt 2026-08-25, 6/6 integrity checks each.
- `src/nonRotatingRiders.json` — **104 riders who never rotate** (24 Day, 71 Half, 7 Full).
  The manager confirmed 6 of 6 we could put in front of him.
- Stops map: purple = never rotates, slate = slot inferred not punched, route colour = observed.
  A stop with both kinds is drawn as two dots ~13 m apart.
- Stop search matches vehicle registrations (`tn57 cl`, `TN57-CL3434` both find TN57CL3434).
- ERP now requires a bearer token. Credentials live in `.erp_key` (gitignored), read by the Vite
  proxy and `refresh_routes.sh`, never by the browser.

### Nine trial files still on disk

Removed 2026-09-04 (see §4 *Resolved: 9 plans, not 3*). `public/plan_grp-*.json` were
byte-identical triplets of `plan_rot-*.json`; `build_service_plans.mjs --group` now writes its
trials to `_trials/` (gitignored), never into `public/`.

The manager's nine operating plans are imported with

```
node scripts/import_rotation_plans.mjs --from _incoming/rotationalshiftdata --received YYYY-MM-DD --anchor <Monday>
```

which writes `public/plans/rot/g{1,2,3}-{day,half,full}.json` and `src/rotation.json`
(idempotent). `_incoming/` is gitignored — the deliveries stay on the machine that received them.

---

## 4. The open decision: 3 plans or 9?

The three rotational plans must currently be rebuilt every Monday because their *membership*
changes. The proposal is to plan a fixed **group** of people instead, so plans are built once and
each Monday only the label rotates.

### An invalid result to ignore

I built all nine (group × shift) and reported that they "collapsed to three identical plans".
**That evidence is worthless.** `engine.optimise()` takes no time-of-day parameter — the gate is
used only in a log line, and the nine files differ only by a `service` label. The test could not
have produced any other answer.

**So it is still unknown whether a route genuinely changes when its shift changes.** If it does,
the optimiser cannot express that today and would need the clock plumbed in.

### The three kinds of bus (5 weeks of punches)

| kind | buses | seats | riders | needs re-planning each rotation? |
|---|---|---|---|---|
| **MIXED** — carries all three groups, runs all three shifts every week | 8 | 346 | 577 (73%) | **Yes** |
| **ROTATES** — carries one group and moves with it | 9 | 160 | 168 (21%) | No |
| **FIXED** — never changes shift | 3 | 79 | 49 (6%) | No |

MIXED: `TN58BQ3434 TN57CL3434 TN57CJ3434 TN57BQ3636 TN58BS3434 TN57CK3434 TN74BC3848 TN21AW5637`
— six of these are exactly the vehicles on the manager's sheet, each with a separate day,
off-night and full-night pickup. His sheet and the ERP describe the same thing from two sides.

ROTATES: `TN20BM9126 TN28AB8866 TN19E7504 TN57D7999 TN76C8078S TN19B7844 TN41W8996S TN37X5218 TN18D8500`
(all 20-seaters). Example — TN57D7999: Half → Day → Full → Half, 95–100% pure each week.

FIXED: `TN57BH3636` (Half night, 96–100% for five weeks), `TN21AX8557`, `TN58AS4961`.

The split is **size**, not shift: a big bus needs several groups to fill it, so its shift mix
changes weekly; a 20-seater is filled by one group and travels with it.

### Residual risk if you freeze groups and exclude the 104 non-rotators

702 true rotators remain:

| after | wrong | riders |
|---|---|---|
| 1 Monday | 9.5% | ~66 |
| 2 Mondays | 11.2% | ~79 |
| 3 Mondays | 6.2% | ~44 |

**It does not compound** — it oscillates 6–11% and recovers after a full three-week cycle.

Other risks that remain:
- **Joiners (~10/week)** land in no group and no plan until someone re-cuts. ~40/month.
- **The 104 non-rotators still need buses.** Excluding them from the rotation means giving them
  their own standing plan (24 Day / 71 Half / 7 Full), not deleting them.

### The question that decides it

Put to the transport manager, still unanswered:

> For the 8 big buses — does the route actually change every week, or does the bus go to the same
> villages and just pick up whoever is on that shift that week?

- Route **stays the same** → 3 plans + 1 for non-rotators. Build once.
- Route **changes** → 9 + 1, and the clock has to be built into the optimiser first.

Also unanswered: his sheet gives **TN57BH3636** a full-night pickup; five weeks of ERP show it on
Half night every single week, never Full. One of the two is wrong.

### Resolved 2026-09-04: 9 plans, not 3

The manager answered by delivering the plans. On 2026-09-03 nine finalised files arrived in
`_incoming/rotationalshiftdata/` named `<N> <SHIFT> PLAN 0209.json` — **three fixed rider groups
× three clocks**, built by him in the Planner. Verified against the ERP on 2026-09-04
(everything below is measured, not assumed; the full write-up is [docs/rotation.md](docs/rotation.md)):

- **Batch N is a group, and N is its ERP slot code in the week beginning 2026-08-31.** GPS-matching
  each file's stops (60 m) to the riders the roster placed on each slot that week: batch 1 files
  match the slot-1 cohort at 95–98%, batch 2 the slot-2 cohort at 89–97%, batch 3 the slot-3
  cohort at 98%; every off-diagonal cell is 9–24% (shared villages). Rider totals agree too:
  249 / 304 / 250 in the files against 249 / 305 / 251 on the slots.
- **The three `plan_rot-*.finalised.json` committed on 2026-09-02 ("batch 1 of 3") were one
  rotation step stale.** They read the same delivery as this week's Day / Half / Full, but were
  built on the previous week's roster — the "Day" file held the riders who are on Full night
  this week. Retired (`git rm`), along with the nine `plan_grp-*` trials.
- **The dashboard now rotates the label, not the plan.** `src/rotation.json` (anchor
  2026-08-31, cycle day → full → half) says which group is on which clock in any week;
  `src/optimiser/rotation.js` does the arithmetic; `finalisedPlans.js` resolves a rotational
  service to `public/plans/rot/g<group>-<clock>.json` for the week. Ground truth for the next
  three Mondays: 09-07 Day=G2 Half=G3 Full=G1 · 09-14 Day=G3 Half=G1 Full=G2 · 09-21 back to
  Day=G1 Half=G2 Full=G3.
- **`src/rotationGroups.json` is the identity.** Cut once from the anchor-week roster minus the
  104 never-rotators: Group 1 = 221, Group 2 = 235, Group 3 = 245 riders. From now on
  `build_rotation_groups.py` (run by `refresh_routes.sh` straight after the roster) only adds
  joiners — into the group the calendar puts on their roster slot — and removes nobody.
- **The weekly self-check** is `build_rotational_roster.py`'s rotation check: per group, the
  share of members who punched this week whose punch is the slot the calendar predicts. Checked
  backwards on week 2026-08-24 (step 2): 94% / 90% / 85%. With the anchor deliberately moved one
  week: 5% / 6% / 7%. A drop below 75% for all three groups means a skipped Monday; the fix is to
  move `anchorWeek` forward 7 days. That closes the "does it compound" worry above from the
  measuring side: the drift is visible every Monday, in the log.
- **The 8 big MIXED buses question is answered by the files themselves**: the manager plans them
  per group per clock, so their route does change with the group. That is why it has to be
  nine files and not three plus a clock parameter.

**Still open, now concrete: the never-rotate gap.** The manager's groups were cut from the
anchor-week slots, so each carries the fixed riders who happened to be on that slot that week,
and those riders then rotate with the plan although they do not rotate on the floor. Measured on
the 71 fixed Half-night riders: Group 2's Off Night file carries 66 of them, groups 1 and 3 carry
3 and 8. So those riders have a bus one week in three. Either they get a standing plan of their
own (24 Day / 71 Half / 9 Full, as proposed above) or all three groups' files for a clock carry
their stops. Put it to him with those numbers.

`plan_rot-*.json` (the optimiser's own 2026-08-25 files, each service's `planUrl`) stay as the
fallback when the manifest has no plan for a slot and as the "this service has a plan" flag.

---

## 5. How to re-run things

Re-cut the roster (prints who moved and why, and the rotation check), then file the week's
joiners into their group. The nine Rotational plans are **not** rebuilt — since 2026-09-04 they
are built for fixed groups and the calendar in `src/rotation.json` picks which one each clock
shows (see §4 and [docs/rotation.md](docs/rotation.md)). `refresh_routes.sh` runs both:

```bash
python3 build_rotational_roster.py
python3 build_rotation_groups.py
```

The optimiser's own baseline files (`public/plan_rot-*.json`, the fallback) can still be
re-solved by hand, and the old warning stands — look at the result before trusting it:

```bash
for s in rot-day rot-half rot-full; do node build_service_plans.mjs --service $s --erp data/erp_audit.json; done
```

For real weekly use, pull a fresh feed first — `data/erp_audit.json` is a frozen 25-Aug snapshot:

```bash
curl -s -m 600 -X POST http://localhost:5173/erp/general/VehicleEmpMapDetails \
  -H 'Content-Type: application/json' -d '{}' -o data/erp_live.json
```

The dev server must be running (it holds the ERP login). Group mode also exists as an optimiser
trial only — `node build_service_plans.mjs --group day --shift full` writes to `_trials/`, not
`public/`; the operating group x clock plans come from `scripts/import_rotation_plans.mjs`.

**Windows / the second machine:** needs `git pull` **and** its own `.erp_key`, created with
`WriteAllText` (PowerShell's `Set-Content` adds a BOM that breaks JSON — the code strips it, but
avoid it anyway). Then restart via `Start Dashboard.bat`; the login happens at server start.

---

## 6. Known issues NOT fixed

From a 33-finding audit; these were verified but left alone.

- **"As operated" opens on the ERP pull date** — a half-finished day rendered as completed
  history. Today shows ~116 riders where a complete day shows ~600.
- **Per-card bus counts sum to 150 against a 110-bus fleet** — a shared bus is counted on several
  cards.
- **`syncErp` has no re-entrancy guard** (`Dashboard.jsx:2803`); the header pill
  (`:2906`) and "Try again" (`:874`) can launch concurrent 49 MB fetches.
- **`Store.set` swallows quota errors** (`Dashboard.jsx:442`). localStorage measured at 2,371 KB
  = 46% of a 5 MB quota, and `attendance` is never pruned.
- **"Proof — across time"** (`OptimiserTab.jsx:757`) charts a `simulate()`-generated series under
  a title asserting evidence.
- **17 unused imports**; `todayStr()` (`Dashboard.jsx:128`) is dead and uses `toISOString()`.
- **ERP login was returning HTTP 500** at the end of the session (their server, not our code —
  it worked earlier the same day with the same credentials).

---

## 7. Credentials note

The ERP password has now travelled through email, a screenshot and chat. Worth asking IT whether
the account in `.erp_key` is a shared one, and rotating it once things are stable.
