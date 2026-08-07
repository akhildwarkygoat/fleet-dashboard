# Transport ERP — issues and requests

**From:** Transport dashboard / route-optimiser project
**Endpoints in scope:**
- `POST http://172.16.10.169:8089/api/general/VehicleEmpMapDetails` — employee punch feed
- `POST http://172.16.10.169:8089/api/general/VehicleEmpMapProjectDetails` — vehicle costing feed

**Evidence base:** live pulls dated 05-08-2026 — 38,551 punch rows (26 MB, 11 days, 3,989 employees on the latest day) and 1,054 costing rows (64 vehicles). Every figure below is reproducible from those payloads.

Items are ordered by impact. **A1–A3 are blocking** — we cannot plan the new shifts without them.

---

## A. Blocking — needed before the new shifts can be routed

### A1. `Shift` field has inconsistent trailing whitespace

The same shift arrives under two different strings, so any `GROUP BY Shift` splits one shift into two:

| Value (quoted to show the space) | Rows |
|---|---|
| `'GENERAL SHIFT - 9 '` | 24,963 |
| `'GENERAL SHIFT - 9'` | 10,050 |
| `'ROTATIONAL SHIFT '` | 2,103 |
| `'MORNING SHIFT - 7 '` | 1,363 |
| `'MORNING SHIFT - 7'` | 72 |

**Request:** `TRIM()` the value at source. We normalise on our side, but any other consumer will silently double-count.

### A2. Rotational shift has no timings and no employee→group mapping

Rotational covers three slots that rotate weekly (Day 06:00–14:00 → Full night 22:00–06:00 → Half night 14:00–22:00 → Day). The feed says only `ROTATIONAL SHIFT` — it does not say **which slot** an employee is on in a given week.

Attendance swings accordingly: **82% present on 04-08, 35% on 05-08** — because only part of the group travels on any given day.

**Request:** expose per-employee rotation group (or the slot for the date), plus the three slot start times. Without it we cannot size buses for Rotational — planning to the full 508 assigned riders would over-provision by roughly 3×.

### A3. Zenwear employees carry the Batlagundu shift tag

The 277 Zenwear employees (`Compname = SUBBULAPURAM`, `Comp_New = ZENWEAR`) are all tagged `Shift = GENERAL SHIFT - 9` — the Batlagundu 9 am shift — despite working at Subbulapuram, **59 km south**. Their home GPS confirms the site: median distance is 16.6 km from Subbulapuram vs 48.3 km from Batlagundu.

**Request:** confirm whether Zenwear runs its own gate time. If it does, it needs its own `Shift` value. If it genuinely starts at 09:00 like the others, we just need that confirmed in writing.

---

## B. Data quality

### B1. Non-ASCII place names arrive as `?` (character-set problem)

**1,181 rows** have `?` substitution in `Area` / `Locality` / `Village`. Tamil text is being encoded in a charset that cannot represent it:

```
Locality : '?????????, ????? ????'
Area     : '6Q6R+55J, ?????????, ????? ???? 624211, ???????'
Area     : '2R63+2G3 ?????? ??????? ???????, ??????, above ???????? ?????? patti,
            Puthukottai, Usilampatti, Tamil Nadu 625532, India'
```

**Request:** serve the API as UTF-8 (`Content-Type: application/json; charset=utf-8`) and confirm the DB column collation supports Tamil. These are stop names our drivers read — they are currently unusable.

### B2. Missing home GPS on 49 employees

49 of 3,989 employees on 05-08-2026 have blank or zero `Latitude`/`Longitude`. They cannot be placed on a route and are silently dropped from planning.

**Request:** a completeness check on employee address capture, or a flag we can report on.

### B3. Blank seat capacity

Vehicle `TN31AY7144` returns blank/zero `Seat` on 5 rows. Capacity drives utilisation, so a blank makes the bus unplannable.

### B4. One costing line has a non-integer quantity

`Pur_Amount ÷ Rate` is a whole number on 1,028 of 1,029 priced rows (it is the quantity — litres, tyres). The exception:

```
TN57AC3636 · RTO EXPENSE · Rate ₹7,500 · Pur_Amount ₹14,000 → 1.8667
```

**Request:** confirm whether this is a part-charge or a data-entry error.

---

## C. Missing data we need

### C1. Costing feed has no diesel and no driver salary

Cost heads present: `ROAD TAX`, `VEHICLE INSURANCE`, `FC WORK`, `VEHICLE OUTSIDE SERVICES`, `RTO EXPENSE`, `TYRE`, `ADBLU`.

The two **largest** running costs are in neither feed. Per-bus cost is therefore standing costs only, and understates the true figure substantially.

**Request:** add diesel (or fuel issue records) and driver salary to the vehicle costing feed.

### C2. Costing feed has no budget

There is no budget/allocation field, so we cannot compute variance from ERP data — budgets are currently entered by hand in the dashboard.

### C3. No driver name or phone anywhere

Neither feed carries the driver assigned to a vehicle. The dashboard shows "Not in ERP" and users type these in manually.

### C4. AdBlue stops after FY2024-25

All **123** AdBlue lines start in FY2024-25; none since. Either the head was retired or AdBlue is now booked elsewhere.

**Request:** confirm which — a 2026 vehicle cost total is otherwise incomplete.

---

## D. API design

### D1. The endpoint ignores all request parameters

We tested `{}`, `{"Shift":""}`, `{"Shift":"ALL"}`, `{"shift":"all"}`, `{"Branch":""}`, `{"Compname":""}`. **Every one returns the identical full payload.**

**Request:** support server-side filtering — at minimum `date` / date range, ideally `Shift` and `Compname`.

### D2. Payload size forces a full re-download

Every pull is **~26 MB and ~23 seconds**, and it always returns the same fixed 11-day window. To pick up staff added during the day we must re-download everything.

**Request:** a `since` / modified-after parameter, or a date filter, so we can fetch deltas. This is the single biggest efficiency win available.

### D3. Vehicle assignment is nominal, not per-trip

**20 of 88 vehicles** are assigned more than 150% of their seats:

| Vehicle | Riders assigned | Seats | % |
|---|---|---|---|
| TN57CJ3434 | 227 | 54 | 420% |
| TN58BQ3434 | 174 | 54 | 322% |
| TN57BQ3636 | 111 | 36 | 308% |
| TN57CL3434 | 130 | 54 | 240% |

We understand these buses run multiple trips across shifts. But the feed gives one flat employee→vehicle mapping with **no trip or run identifier**, so we cannot tell which riders travel together.

**Request:** a trip/run identifier, or at least the shift on the assignment row, so a bus's riders can be split into actual journeys.

### D4. Fields that carry no information

Constant across all 1,054 costing rows — please confirm they are intended:

| Field | Value |
|---|---|
| `Project_Type` | `VEHICLE` |
| `Testing` | `T` |
| `Employee` | one operator account on every row |
| `Grs_Amount` | identical to `Pur_Amount` on every row |

---

## E. Notes / confirmations (no action, please confirm)

1. **`Comp_New` now has a third value.** `ZENWEAR` joined `GAINUP TECHNOTEK` and `GAINUP INDUSTRIES` on 05-08-2026. Anything assuming two entities needs review.
2. **`TECHNOTEK - WOVEN - II` was renamed** to `Compname = SUBBULAPURAM` / `Comp_New = ZENWEAR`. The rename was applied **retroactively** across all 11 days — no split history. Handled correctly, thank you.
3. **Unapproved cost lines carry `Pur_Amount` 0.** 25 lines have a blank `Approved_Date` and all carry 0. We read this as "planned but not purchased" — please confirm.
4. **`Rate` is a unit rate, not a total.** `Pur_Amount = Rate × quantity`; there is no quantity column, so we recover it by division. A quantity column would remove the guesswork.

---

## Summary of requests, in priority order

| # | Request | Why |
|---|---|---|
| 1 | Trim whitespace on `Shift` | One shift currently reads as two |
| 2 | Rotation group + slot times for Rotational | Cannot plan 508 riders without it |
| 3 | Confirm Zenwear's gate time / own shift value | Cannot place Zenwear on a timetable |
| 4 | Serve UTF-8 — 1,181 rows of unreadable place names | Drivers cannot read stop names |
| 5 | Date / `since` filter on the punch endpoint | 26 MB per refresh today |
| 6 | Trip identifier on vehicle assignment | 20 buses assigned >150% of seats |
| 7 | Diesel + driver salary in the costing feed | Largest running costs missing |
| 8 | Fill 49 missing home GPS records | Those employees cannot be routed |
