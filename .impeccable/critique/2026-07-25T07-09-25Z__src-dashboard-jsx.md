---
target: src/Dashboard.jsx
total_score: 27
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
timestamp: 2026-07-25T07-09-25Z
slug: src-dashboard-jsx
---
# Critique — Gainup Employee Transport Optimiser (src/Dashboard.jsx)

Method: dual-agent (A: design review · B: deterministic detector). Mode: OPERATE.

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Good sync pill/toasts/progress %, but negative Net Value and 117% util aren't visually flagged as bad |
| 2 | Match System / Real World | 3 | Excellent domain language; undercut by a mojibake stop name and raw "HTTP 500" in a tooltip |
| 3 | User Control and Freedom | 2 | Undo/redo exist, but Clear / Clear-bus / Import overwrite the board with no confirm; Clear re-seeds (undo may not recover) |
| 4 | Consistency and Standards | 3 | Strong shared primitives, but two "Cost/head" definitions (₹326 vs ₹61.1) and three rider totals across surfaces |
| 5 | Error Prevention | 2 | No guard before wiping a plan; over-capacity silently allowed on Live/Fleet-plan |
| 6 | Recognition Rather Than Recall | 3 | ⓘ explainers help; but map relies on remembering "pick a bus first" and a non-persistent stop-color legend |
| 7 | Flexibility and Efficiency | 3 | Search/sort/filter/pagination/auto-fill/export; but no bulk stop assignment; 77 micro-cards scan slowly |
| 8 | Aesthetic and Minimalist | 3 | Clean Live/Settings; Fleet-plan crams 10 KPIs + 10-col table; glass over a busy map adds noise |
| 9 | Error Recovery | 2 | "ERP offline"/"stale" states give no next-step guidance or freshness reassurance |
| 10 | Help and Documentation | 3 | Rich inline hints/empty-states; no onboarding for the map-first Planner model |
| **Total** | | **27/40** | **Good (band 20–35); the three 2s cluster on destructive-action safety + error recovery** |

## Design Specificity Verdict

**Strongly authored for THIS product — not category-interchangeable (top of scale).** The Gainup/Technotek two-unit split is structural (company grouping, per-unit health tallies, COMPANY column, OWNED 39/RENTAL 38); ₹ is Indian-formatted throughout (en-IN, "₹1,588/mo"); maps are the primary surface with a factory depot and real Tamil Nadu villages; ERP-as-truth is modeled into copy ("allocated · from ERP", "Not in ERP", "After optimiser"); domain semantics (morning=pickup/evening=drop-off, owned vs rental, riders vs seats) are wired into structure, not decoration.

**Deterministic scan: inconclusive, not a clean bill of health.** The bundled detector returned `[]` on all source targets — but only because it can't read this app's styling: Tailwind class strings and JS-object inline styles (`style={{}}` driven by theme prop `t`) fall outside its rule surface, and its strongest mode (rendered-DOM via puppeteer) is unavailable (puppeteer not installed). Static evidence it *could* verify: a genuine token system (`THEMES` object, ~24 semantic keys × 3 themes; ~905 `t.*` references vs ~100 raw color literals — heavily token-driven), with small leakage — 8 hardcoded status/chart hexes in OptimiserTab bypassing `t`, `|| "#fff"` fallback ×10, and an **un-tokenized shadow/spacing layer** (freehand `rgba(15,23,42,.04–.22)` shadows and inline px values, no elevation tokens). Focus handling is solid (global `:focus-visible` ring despite 25 `outline-none`). A11y is thin: **13 aria-* attributes against 105 buttons and 168 onClick handlers, only 6 aria-labels** — icon-only buttons are likely unlabeled, and map stop-clicks have no keyboard path (bus cards got `role=button`+Enter/Space; stops did not).

## Overall Impression

A genuinely product-specific, competent OPERATE dashboard that already feels like one native app across very different screens. The single biggest opportunity isn't visual polish — it's **safety and truth**: destructive Planner actions with no confirmation, and the same concept (cost/head, rider baseline) reading different numbers on different tabs. Fix those two and this jumps a band.

## What's Working

1. **Authentic product authorship** — two-unit grouping, ₹ en-IN, owned/rental split, morning/evening pickup-vs-drop-off are in the *structure*, not a skin. Couldn't be reused for another vertical.
2. **The map-first Planner cockpit with context-scoped KPIs** — floating tiles retarget from whole-plan to active bus; bus cards turn red over-capacity / amber over-seats. Feedback where the work happens.
3. **Coherent system primitives** — Tile / KpiCell / KpiGroup, three themes, tabular-nums everywhere, consistent ⓘ "how this is calculated" explainers. Confirmed by evidence: ~905 token references, real semantic theme object.

## Priority Issues

**[P1] Destructive Planner actions with no confirmation or recoverable undo.** Clear (empties the board), per-bus Clear-bus, and Import-optimised all overwrite silently; Clear re-seeds the editor and likely bypasses the undo stack. Clear sits inches from Save/Export in identical ghost styling. *Why:* a time-pressured planner loses work on one misclick. *Fix:* confirm dialog (or "Plan cleared — Undo" toast) for full Clear; guarantee reset pushes to history; visually separate Clear from Save. *Command:* **/impeccable harden**

**[P1] Metric inconsistency across surfaces.** "Cost/head" = ₹326 on Live but ₹61.1 on Fleet-plan; rider baseline = 3,021 (Stops) vs 3,097 (Previous-routes card) vs older 2,727. *Why:* planner and manager quote different numbers from the same tool; erodes ERP-truth credibility. *Fix:* label denominators ("actual ₹/head/day" vs "planned ₹/head/day"); reconcile or annotate the rider baselines. *Command:* **/impeccable clarify**

**[P2] Over-capacity/over-budget not flagged outside the Planner.** Fleet-plan 117% utilisation and riders>seats rows (59/54, 69/55) render neutral black; Live "-₹44k Net Value" is purple, not red. *Why:* the two numbers that mean "over budget / over capacity" don't look like problems to at-a-glance management. *Fix:* alarm color/badge on over-capacity rows + util KPI; red for negative Net Value. *Command:* **/impeccable colorize**

**[P2] Density beyond scan limits.** Fleet-plan: 10-metric KPI strip + 10-column routes table; Planner toolbar: ~10 controls. Violates grouping-≤4 and choices-≤4. *Fix:* promote 3–4 primary KPIs, tuck the rest behind "more"; collapse toolbar to Save/Undo/Redo + overflow. *Command:* **/impeccable distill**

**[P2] Mobile header collision.** At phone widths the "Syncing…/ERP offline" pill overlaps/clips the Settings tab — Settings can become unreachable. *Fix:* wrap the nav or move ERP status into a kebab on small screens. *Command:* **/impeccable adapt**

**[P3] No persistent map legend in the Planner.** grey=unassigned / red=unadded / green=added and "pick a bus first" only surface as a toast after a wrong click. *Fix:* small always-on legend + pinned interaction hint. *Command:* **/impeccable onboard**

## Persona Red Flags

**Alex (power user):** No labeled keyboard shortcuts for Undo/Redo/Save (icon-only ghost buttons); 77-bus assignment is one-click-per-stop across 739 stops, no lasso/bulk/multi-assign; routes-table columns not sortable. Elements: Planner toolbar; NewPlanBoard bus grid; Live "Sort".

**Sam (accessibility):** Liquid-glass KPI/bus panels (`rgba` over live Leaflet tiles) give variable, likely-insufficient contrast for 9–10px labels; assigning a stop is mouse-only (map clicks have no keyboard path — stops lack the `role=button`+Enter/Space the bus cards got); Live health leans on color-coded dots. Confirmed by evidence: 13 aria attributes / 105 buttons. Elements: NewPlanBoard glass tiles (`text-[9px]`), GMap `onSelect`, Live status dots.

**Transport planner under time pressure:** Unlabeled Clear abuts Save/Export in identical styling — fat-finger wipes the board with no confirm; morning-prepend vs evening-append is invisible until stops insert at the "wrong" end; no persistent legend, so grey/red/green must be recalled mid-rebuild.

## Minor Observations

- Mojibake stop name "?????????, ????? ????" (Tamil not rendering) in the Stops table; the VILLAGE column is entirely "—" — a dead column shipping to planners.
- LAT/LNG to 5 decimals in a human-scanned table is noise — hide behind detail.
- "Cost-lean (stale)" chip flags staleness but offers no re-run affordance next to it.
- Segmented Stops/Fleet-plan/Planner control raced during ERP re-sync/HMR — worth confirming OptimiserTab isn't remounting on the 60s poll.
- Header pill hover title leaks raw "ERP HTTP 500" — jargon for management.
- Un-tokenized shadow/spacing: freehand `rgba(15,23,42,.04–.22)` shadows + inline px repeats (top:8 ×11, etc.) — no elevation/spacing tokens despite a strong color-token system.

## Questions to Consider

1. Management's two most important headline numbers — "-₹44k Net Value" and "117% utilisation" — both render in calm black. If "over budget and over capacity" doesn't *look* wrong, what is the at-a-glance view for?
2. The Planner is a beautiful cockpit, yet the core interaction is assigning stops one click at a time across 739 stops / 77 buses. Should the human be *editing the optimiser's proposal* (Auto-fill/Import as the default entry point) rather than hand-building from blank?
3. You maintain two rider baselines and two cost-per-head definitions across tabs. If the ERP is the source of truth, why isn't that reconciliation labeled anywhere?
