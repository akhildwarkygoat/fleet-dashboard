# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Two audiences share one tool:

- **Transport planners** (operations/admin staff) — assign stops to buses, build and edit plans, run the optimiser, and act on daily ERP changes. They work in dense, data-heavy screens and need speed and precision.
- **Factory management** — review cost per head, utilisation, attendance, and the fare/cost picture to make decisions. They scan summaries and comparisons, sometimes on a laptop, not always at a planner's desk.

Design must serve both: the planner's working surfaces (Optimiser, Planner) stay information-dense and fast; the review surfaces (Live snapshot, Compare) read clearly at a glance.

## Product Purpose

Plans and optimises daily employee bus transport for Gainup Industries. It ingests the live ERP roster (riders with GPS home locations, the owned+rented fleet, attendance) and a road-distance matrix, then produces a fleet plan that seats every rider while minimising cost per head, subject to seat capacity and ride-time limits. It also supports fare planning (what to charge riders to cover cost) and side-by-side comparison of plan variants. Success = every allocated rider gets a seat, at the lowest defensible cost per head, on a plan the team trusts because its numbers match the ERP.

## Positioning

Optimises against the **real ERP feed**, not a spreadsheet: per-stop rider counts, the actual owned/rented fleet, and attendance come straight from the source, and every headline number (riders, buses, stops, cost/head) reconciles back to it. Route cost is a true operating-cost model (driver, diesel per km, maintenance including tyres and fitness certificates, insurance, road tax; rentals on their slab tariff), solved by a global OR-Tools vehicle-routing model on cached real road distances — so re-solving is free and the plan is defensible line by line, not a heuristic estimate.

## Operating Context

- **Two operating units, always:** every bus and rider belongs to **Gainup** or **Technotek**. This split is structural throughout the product, not a filter.
- **Region:** Tamil Nadu, India (Dindigul / Madurai corridor); the factory depot is the fixed route origin.
- **Data source:** the ERP endpoint `VehicleEmpMapDetails`, reached same-origin via a dev proxy on the factory network. When the ERP is unreachable the app runs on the last committed snapshot.
- **Deployment:** runs locally (`npm run dev`, localhost:5173) on the planning machine, including a one-double-click `Start Dashboard.bat` launcher on Windows for non-technical operators. Data persists in the browser between sessions.
- **Offline solver:** an OR-Tools model (`optimize.py`) regenerates the fleet plan offline from the cached road matrix; the dashboard renders its output.

## Capabilities and Constraints

- **Surfaces:** Live snapshot (fleet health at a glance); Optimiser with Stops / Fleet plan / Planner sub-tabs (the stop network, the solved plan, and a map-first manual plan editor with morning/evening direction, plan import/export, and a permanent ERP previous-routes seed); Compare; Settings (theme, ERP sync, per-bus cost cards, and custom Metrics); Bus-wise detail reached by clicking a bus on Live.
- **Current scale:** 77 buses (39 owned + 38 rented), 3,021 GPS-located riders across 739 stops.
- **Stack:** React + Vite + Tailwind, Leaflet maps, client-side persistence in localStorage; no server database. GSAP for entrance/motion.
- **Cost model:** owned buses moving to a per-bus basis (mileage and vehicle age coming into the ERP so diesel/km and fitness-certificate cost vary per vehicle); loan/EMI is excluded as capital, not operating cost.
- **Undecided / in flight:** the cost-lean plan variant is stale pending a re-solve; per-bus cost cards in the dashboard are not yet filled, so Live money columns read ₹0 until entered.

## Brand Commitments

- **Company:** Gainup Industries — the identity the product carries.
- **Operating units:** Gainup and Technotek, each with its own colour accent; the two-unit distinction is honored wherever buses or riders appear.
- **Currency & numbers:** Indian Rupees (₹) with Indian grouping (e.g. ₹1,52,927), everywhere money appears.
- **Voice:** plain, operational, decision-oriented — numbers first, no marketing tone.

## Evidence on Hand

- Live ERP feed (`VehicleEmpMapDetails`) — the authoritative roster, fleet, GPS, and attendance.
- Cached road-distance matrix — real Google driving distances for the established network, calibrated OSRM for later-recovered stops; no fabricated distances.
- Solved fleet plans in `public/` (`solver_result.json`, archived variants under `plans/`).
- Do **not** invent riders, buses, stops, GPS coordinates, costs, or attendance — anything not in the ERP or the cost model is not shown as fact.

## Product Principles

1. **The ERP is the source of truth.** Riders, buses, GPS, and attendance are never invented; every headline number reconciles back to the feed.
2. **The two-unit split (Gainup / Technotek) is structural** and preserved wherever buses or riders are shown.
3. **Money is always ₹ in Indian formatting.**
4. **Local-first and offline-tolerant.** The app must keep working on its last snapshot when the ERP is unreachable.
5. **Every change is reversible.** Keep a known-good restore point before altering the working product; never ship a change that can't be rolled back.

## Accessibility & Inclusion

Two distinct audiences (dense planning screens vs. at-a-glance management review) must both be served; review surfaces should stay legible on a laptop, not only a planner's large desktop display. No formal accessibility standard has been mandated yet.
