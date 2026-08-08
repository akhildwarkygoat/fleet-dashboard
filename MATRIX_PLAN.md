# Distance-matrix build — the plan

**Registered:** 08-08-2026. Supersedes nothing; sits alongside `data/MATRIX_BUILD.md`,
which is the *how* (resume mechanics, checkpoint format). This is the *what and why*.

---

## What we are buying, and why it is a matrix

The optimiser does not know the routes — solving them is its job. To decide whether a stop
belongs on bus 3 or bus 7 it needs the road cost between **any** pair of stops, before any
route exists. So we buy a lookup table: for every pair of nodes, real road **km and minutes**.

One cell = one **element**, and elements are the billing unit. Everything below is really a
count of cells.

Two cost-halving mechanisms are already in `build_road_matrix.py` and must stay on:

- **`--triangle`** — assumes `A→B == B→A`, fetches the upper triangle only and mirrors it.
  Omitting it on a resume re-requests the skipped half and spends twice.
- **Checkpointing** — progress is written to `data/road_matrix.partial.json` after every
  block, so a stop, crash or quota hiccup never re-buys a block.

Route **geometry** (the drawn polylines) comes from **OSRM, free**, via
`build_road_geometry.py`. Google is only ever used for the numbers.

---

## Current state

| | |
|---|---|
| Batlagundu matrix | **767 nodes** — 680 real Google, **87 OSRM-approximated** |
| Checkpoint | 2,346 of 3,003 triangle blocks paid for; **657 remain** |
| Zenwear | no matrix at all — different depot, 59 km south |
| Stops are | **unmerged**: one node per distinct home coordinate |

Depots, from `src/optimiser/services.js`:

- Batlagundu factory — `10.207550, 77.806206` (9 am General, 7 am Morning, Rotational)
- Zenwear / Subbulapuram — `9.6732711, 77.8072837` (Zenwear only)

---

## The jobs

Independent — any can run alone, in any order.

### Job A — finish the 87 approximated nodes  ·  ~59k elements

Replaces OSRM estimates with real road data on stops **already in daily use**. Resumes the
existing checkpoint, so the 2,346 paid blocks cost nothing again. Best value in the
programme; no dependency on anything outstanding.

### Job B — add the new Batlagundu stops  ·  ~115k elements

**137 new nodes** (9 am General 13, 7 am Morning 12, Rotational 112) each measured against
all 767 existing nodes plus each other. That `× 767` is why a handful of stops costs more
than it looks, and why batching beats trickling.

### Job C — Zenwear's own matrix  ·  ~26k elements

**229 nodes** (1 depot + 228 stops), full triangle, from the Subbulapuram depot.

**Must be a separate matrix, not extra rows on Batlagundu's.** Zenwear is 59 km south;
merging would add that 59 km of irrelevance to every existing pair. Being self-contained
also makes it the cheapest job.

### Job D — route geometry  ·  free

OSRM, after the distances land.

---

## Budget

| Job | Elements | At $1.50/1k |
|---|---|---|
| A — finish the 87 | 59k | $88 |
| B — 137 new stops | 115k | $172 |
| C — Zenwear | 26k | $40 |
| **A + B + C** | **200k** | **$299** |

Against a **$300 credit** that is a coin flip, not headroom. Two ways to buy margin:

1. **Merge at 200 m before Job B.** About a third of Rotational's 112 new stops sit within
   300 m of an existing one; B drops to roughly $110 and the programme fits comfortably.
2. **Split across billing periods**, if the credit is recurring rather than one-off.

> **Verify the rate before spending.** `$1.50/1,000` comes from the previous build's notes.
> Google restructured Maps pricing in 2025 (Essentials / Pro / Enterprise). The element
> counts here are solid; the dollar conversion may not be. Also confirm whether the $300 is
> the 90-day trial credit (expires) or a recurring monthly allowance — that decides whether
> the jobs can be spread out.

---

## Sequence

1. **Probe the key** — one near-free call (`--probe`). Confirms a *server* key with Distance
   Matrix enabled and no referrer restriction, before a 3,000-request run.
2. **Run Job A.** No dependencies. Resumes the checkpoint.
3. **Collect the missing coordinates** in parallel — see below.
4. **Decide the merge radius.**
5. **Run B + C together**, with the newly collected stops folded in.
6. **Job D** (free) for geometry, then refresh the app's matrix copy.

### On the missing coordinates

As of 08-08-2026, **54 riders have no home GPS** (42 outstanding from the 06-08 check,
12 new). All are allocated to a bus and most travel daily, so they ride on a route that
exists while being invisible to the planner. Tracked in `Riders missing coordinates.xlsx`.

Deferring them is cheap — a separate top-up run costs only a few dollars more than bundling
(24 late nodes ≈ $28 bundled vs ≈ $33 alone). So **do not hold up Job A for them.**

But **set a cut-off date rather than waiting for zero**: 27 were fixed between 06-08 and
08-08 while 12 new gaps opened. At that rate the list never empties. Freeze the stop list on
a chosen day, buy the matrix, and let stragglers ride a small top-up later.

Of 27 coordinates collected so far, **24 needed a new node** — they skew toward Zenwear's
southern catchment where there is almost no routed network, so they are not free additions.

---

## Guardrails

**Append-only.** New stops go at the **end** of the node list. Inserting shifts every later
index and invalidates all 2,346 paid blocks — roughly ₹25,000 already spent, gone.

**Resume from the matrix, not the CSV.** `data/bus_stops.csv` has drifted (its md5 no longer
matches the freeze hash in `MATRIX_BUILD.md`) but the **matrix node order is intact** — all
739 CSV rows still resolve to the right node via `MatrixIdx`, verified. Rebuild the node list
from `data/road_matrix.json`'s `nodes` array, never from the CSV's row order.

**Re-measure on the day.** Rotational went 51 → 755 riders in ten days and is still being
onboarded; its stop count is still climbing. Recompute counts and cost immediately before
running, not from the numbers in this document.

**Never start a paid run without explicit confirmation** of scope and spend.

---

## Data-quality items that affect the build

Full list in `ERP_ISSUES.md`. The ones that touch this work:

- **54 riders with no coordinates** — invisible to the planner (B2).
- **One coordinate is the factory itself** — `RAJKUMAR.M` (51052) at `10.20754, 77.80620`,
  the Batlagundu depot to five decimals. Would route as a zero-length trip; needs correcting,
  not accepting.
- **Four clusters share an identical coordinate**, the largest being **10 Zenwear riders at
  `9.69831, 77.80270`**. Either a genuine shared pickup point (ideal — one stop) or one
  address copy-pasted down a list (ten wrong stops). Worth one question before the build.
- **Tamil place names arrive as `?????`** (B1) — coordinates are fine, so routing is
  unaffected, but stop names are unreadable for drivers.
