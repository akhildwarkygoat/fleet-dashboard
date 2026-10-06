# Server setup brief: host the fleet dashboard on the company website, with its data on the server

This brief is written for the Claude (or person) in IT who will set up the server. It says what the
dashboard is today, what has to move to the server, and in what order. Read it whole before
starting, then make a short plan and show it to Akhil (the dashboard's owner) before building.

Written 2026-10-06 against `main` of `akhildwarkygoat/fleet-dashboard`, commit 02f57e7 or later.

---

## 1. What the dashboard is

A transport dashboard for the factory's staff buses: which buses ran, how full they were, what they
cost (two ways: diesel by km, and diesel as the ERP issued it), route planning for six shift
services, and an "on time" board (T.I) fed by GPS from the bus attendance app.

- React 18 + Vite 5 + Tailwind 3, plain JavaScript (no TypeScript). `npm run build` writes `dist/`.
- Two pages: the dashboard at `/` (`index.html`, `src/next/`) and the old look kept at `/old/`
  (`old/index.html`, `src/main.jsx`). Both read the same data through `useFleetData()` in
  `src/Dashboard.jsx`.
- Static data files in `public/` (plans, stops, road geometry) are fetched by the browser and must be
  served as they are.
- Tests: `npm test` (about 800 plain-Node tests). They must keep passing.

A second, separate app lives in `akhildwarkygoat/bus_attendance`: the bus leaders' Android app and
its own server (Node 24, Express 5, SQLite at `data/attendance.db`, `npm start` serves everything on
port 3000). The dashboard reads GPS km from it. That server already stores its data properly; see its
README, section "Moving the server". It can run on the same machine.

## 2. The problem to solve

**There is no server today.** The dashboard runs under the Vite *development* server on the planning
PC (`Start Dashboard.bat`, port 5173) and on Akhil's Mac. Two consequences:

1. **The Vite dev server does server work** that a normal web host will not do (section 3). Without
   it, the ERP and the bus app are unreachable from the website.
2. **All data is kept in each browser's `localStorage`**, one copy per browser per computer
   (section 4). On a company website that means each person sees different plans and settings, a
   cleared browser loses data that cannot be fetched again, and the attendance history only grows
   while someone has the page open.

**The goal:** one server that hosts the dashboard and holds its data, so every computer sees the same
thing, nothing lives only in a browser, and the ERP is read on a schedule whether or not anyone has
the page open.

## 3. What the Vite dev server does today (all in `vite.config.js`)

Each of these has to be done by the production server instead.

| Path | What it does | Notes |
|---|---|---|
| `/erp/*` | Proxies to the ERP, rewriting `/erp` to `/api`, and adds `Authorization: Bearer <token>` | Login: `POST <ERP>/API/LOGIN` with `{"Username","password"}` (falls back to `{"UserName","Password"}`), response `{"token": ...}`. The token is cached for 20 minutes and dropped on a 401/403. Credentials come from `ERP_USER`/`ERP_PASS` or the gitignored `.erp_key` file. **The password must never reach the browser.** |
| `/bus-api/fleet/*` | GET-only proxy to the bus attendance server's `/api/fleet/*`, adding the `X-Fleet-Key` header | From `BUS_API_URL`/`BUS_API_KEY` or the gitignored `.bus_key` file. ETag/304 is passed through. When the bus app is down it returns 502, and the dashboard shows it as offline. |
| `/new`, `/old` | Redirects: `/new...` to `/...`, `/old` to `/old/` | |
| `/__rebuild_routes`, `/__rebuild_status` | Dev-only route rebuild (runs `refresh_routes.sh`, Python) for the "Prev. route" map | Optional. Without it, the map uses the committed snapshot. |

**ERP facts that cost time if you have to rediscover them:**
- Host `life.gainup.in`, port `8089`, plain HTTP. **The DNS is split-horizon**: inside the office it
  resolves to an internal `172.16.10.x` address, and outside to a public one. Some office subnets get
  the internal address but cannot route to it. `vite.config.js` (`resolveErpBase`) works around this
  by probing every candidate address. A server inside the office should simply use the address that
  answers from it; set `ERP_BASE` to pin it.
- Every endpoint is a `POST` with a JSON body. Send `{}`: no body gets HTTP 411.
- `POST /api/general/VehicleEmpMapDetails`: attendance punches, about 64,000 rows. **It returns only
  the last 11 days and ignores any date range in the body** (checked 2026-10-06). Older days are gone
  unless someone kept them. This is the main reason the server must pull and store it on a schedule.
- `POST /api/general/VehicleEmpMapProjectDetails`: per-vehicle cost lines (road tax, insurance, FC,
  maintenance, RTO, tyres), back to 2024.
- `POST /api/Vehicle/DieselDetails`: diesel issued per vehicle per day, about 8 MB, back to 2017.
- How the browser turns these into dashboard data: `src/erp.js` (`mapErpToDashboard`, `mapErpCosts`,
  `mapErpDiesel`). Keep the cost logic in the browser for now (section 6, "Do not change").

## 4. What the browser stores today (`localStorage`)

`src/next/main.jsx` and `src/main.jsx` install a small `window.storage` shim over `localStorage`. The
dashboard's own data goes through `Store.get/set` in `src/Dashboard.jsx`. The planner modules call
`localStorage` directly, mostly through `backend.read/write` in `src/optimiser/store.js`. Sort the
keys into three groups:

**A. Shared work: must live on the server, one copy for everyone.** Losing these loses real work.

| Key | What it is | Written by |
|---|---|---|
| `attendanceHistory` | Every day of punches ever synced (the ERP keeps only 11). Packed format, see `src/attendanceHistory.js` | `src/Dashboard.jsx` |
| `opt-finalised` | Which plan is in force for each service, including the body of a finalised draft | `src/optimiser/finalisedPlans.js` |
| `opt-plan-drafts` | Saved plan drafts | `src/optimiser/store.js` |
| `opt-ti` | T.I (on-time board) entries, filled from GPS | `src/optimiser/trackImpl.js` |
| `opt-stops-v14`, `opt-stops-backups`, `opt-fleet-v10`, `opt-depot-v6` | Planner stops, fleet and factory location, as edited | `src/optimiser/store.js` |
| `stops-master-v1` | Bus-stop records (photos to GPS) | `src/stops/stopStore.js` |
| `opt-route-names`, `opt-bus-company`, `opt-parking` | Route names, bus-to-company overrides, parking points | `OptimiserTab.jsx`, `FleetPlanBoard.jsx`, `parkPrefs.js` |
| `opt-active-plan` (+ `:file`, `:label`) | Which plan option is active | `src/optimiser/planOptions.js` |
| `settings` | Working days, declared holidays, health bands, ERP refresh interval | `src/Dashboard.jsx` |
| `busInfo` | Per-bus driver, phone, budget | `src/Dashboard.jsx` |
| `costLedger` | Manually added cost entries | `src/Dashboard.jsx` |
| `formulas`, `variables` | Custom metrics on the Compare page | `src/Dashboard.jsx` |
| bus documents (key from `busDocsKey(busId)`) | Uploaded documents per bus, **as base64 data URLs inside `localStorage`** | `src/next/pages/bus/DocumentsCard.jsx` and the old look |

**B. Caches: can be fetched again.** Fine to keep in the browser; with the server they can come from
it. `buses`, `employees`, `attendance`, `records`, `rotaHistory`, `costProfiles`, `diesel`, `busKm`,
`lastErpSync`, `lastCostSync`, `lastDieselSync`, `schema`.

**C. Personal view preferences: stay in each browser.** `theme`, `next:live:open`, `opt-kpi-hidden`,
`opt-rota-week` (the pinned week). `opt-gmaps-key` is a
Google Maps key typed into the browser. Better: serve it from server config to the page, restricted
by HTTP referrer in Google Cloud.

The browser's limit is about 5 MB per site. The dashboard already uses about 2.8 MB, and bus
documents stored as base64 can fill the rest quickly. That is another reason to move group A.

## 5. Target design (recommended; adjust to IT's platform, but say why)

One Node.js server (Node 24 LTS, the same as the bus attendance server) on a machine inside the office
network that can reach the ERP:

1. **Serve the built dashboard.** Serve `dist/` with `/` and `/old/`, the `/new` and `/old`
   redirects, and `public/` files as built. HTTPS through IT's usual reverse proxy.
2. **ERP passthrough.** The same `/erp/*` path the browser already calls, with the login, token
   cache and retry moved from `vite.config.js` into the server. Then the browser code needs no change
   for live data.
3. **Bus app passthrough.** `/bus-api/fleet/*`, as in section 3, with the key in server config.
4. **Scheduled ERP pull (the important part).** Every 30 minutes (configurable), the server pulls
   `VehicleEmpMapDetails` itself and **upserts every day it carries into a database**, keyed by
   (date, employee). Store at least: date, Empl_no, present/absent, vehicle, shift, unit (Compname
   and Comp_New), Pun_Shift. Unlike the browser's packed history, the server has room to keep each
   rider's bus *per day*, so a rider who changes bus is counted on the right bus on each day. Keep
   every day; never delete. Pull costing and diesel too, less often (every few hours), and keep the
   latest copy.
   Then serve history to the browser, for example `GET /store/attendance?from=YYYY-MM-DD&to=YYYY-MM-DD`
   in the shape `{ "YYYY-MM-DD": { "<Empl_no>": "P" | "A" } }`, plus each rider's last known
   `{ busId, shift, unit, slot }`. In `useFleetData()` (`src/Dashboard.jsx`), replace the
   `attendanceHistory` read/write with this endpoint. The merge with the live feed and the
   "former riders" handling already exist (`historyDays`, `formerRiders`); keep their behaviour.
5. **Shared store for group A.** A small key-value API, e.g. `GET /store/kv` (all shared keys) and
   `PUT /store/kv/:key` (one key, JSON body), in a database table
   `(key, value, updated_at, updated_by)`. Keep the previous versions in an audit table: plans and T.I
   are real work, and a bad save must be recoverable.
   **Least-change way to wire the browser:** before the app renders (in `src/next/main.jsx` and
   `src/main.jsx`), load all shared keys from the server into `localStorage`. Then wrap writes to
   those keys (`window.storage.set` and `localStorage.setItem` for group A keys only) so they also go
   to `PUT /store/kv/:key`. All the existing modules then keep working unchanged. Two people editing
   the same key: last write wins, but warn on stale writes (send the `updated_at` you loaded and
   return 409 if it moved), and re-read shared keys when the tab regains focus. The code already
   fires `fleet:finalised` (finalised plans) and `TI_EVENT` (T.I) after writes; use them to refresh
   other views.
6. **Bus documents** go to file storage on the server (`POST`/`GET`/`DELETE /store/docs/:busId`),
   not base64 in a database row.
7. **Database.** SQLite is enough: one site, a few users, small data (attendance is about 64,000 rows
   per 11 days, roughly 2 million rows a year). The bus attendance server already uses Node 24's
   built-in `node:sqlite`. Use something else only if IT already runs it. **Back it up nightly**, off
   the machine.
8. **Who can open it.** The pages show employee numbers, attendance and costs. Put the site behind the
   company's login (SSO or VPN, intranet only), or add a login. Decide this with IT and Akhil; do not
   publish it open to the internet. Record who changed shared data (`updated_by`).
9. **Secrets** live in server environment variables or files outside the web root, never in the
   repo, the bundle or the browser: `ERP_USER`, `ERP_PASS` (or `ERP_BASE` to pin the address),
   `BUS_API_URL`, `BUS_API_KEY`, the Google Maps key. `.erp_key`, `.bus_key` and `.maps_key` are
   gitignored; keep it that way.

Put the server code in this repo (e.g. `server/`), with an `npm start` that builds and serves, so the
planning PC and the website run the same thing.

## 6. Do not change (agreed with Akhil, and easy to break)

- **The cost rules.** They are in `src/dailyCost.js`, `src/planRuns.js`, `src/costReport.js` and
  `mergeCostsIntoRecords` in `src/Dashboard.jsx`, and covered by tests:
  - a planned run counts only on a day its service ran (half of its punched people present);
  - standing costs are charged only on days the bus worked;
  - standing costs use the trailing 12 months, per day;
  - a rented van is one day tariff on the day's total km;
  - unfilled days use diesel by km;
  - an unpriced rented van's cost is left blank;
  - today is left out until it is over.

  The server stores and serves data; it does not recalculate costs.
- **The look.** Light theme only, no dark mode. The new look is at `/` and the old look at `/old/`.
  Do not restyle anything.
- **Port 5173** stays the dashboard's default on the planning PC.
- **The bus attendance app's phones** reach their own server by its address. If that server moves, use
  its README section "Moving the server" so phones keep their setup.

## 7. Moving the existing data (do this once, before switching people over)

The planning PC's browser holds the only copy of group A (finalised plans, T.I, settings, attendance
history since 26 Sept 2026). Before anyone uses the new server:

1. Build an import endpoint, e.g. `POST /store/import`, that takes `{ key: value }` for group A keys
   and the attendance history. Unpack `attendanceHistory` with `src/attendanceHistory.js`
   (`historyDays`, `formerRiders`) into the attendance table.
2. On the planning PC, in the dashboard's own browser (the one it normally opens), copy everything out
   from the browser console:
   ```js
   copy(JSON.stringify(Object.fromEntries(Object.keys(localStorage).map((k) => [k, localStorage.getItem(k)]))))
   ```
   Then save the clipboard to a file and import it. Values are JSON strings; parse them before storing.
3. Do the same from Akhil's Mac. If a key differs between the two machines, ask Akhil which copy wins.
4. After the import, open the site on a different computer and check that the finalised plans,
   Settings → holidays and the T.I board match the planning PC.

## 8. Done means

- The site opens from the company address on two different computers, and both show the same
  finalised plans, settings, T.I and costs.
- Costs → Month → September 2026 shows days from 26 Sept on. Leave it running for more than 11
  days: days older than the ERP's window are still there, with nobody having opened the page.
- No ERP password, bus app key or Maps key appears in the browser (check the bundle and the network
  tab).
- Clearing the browser loses nothing but view preferences.
- `npm test` passes, and the new server code has its own tests for the ERP pull and the store.
- Nightly backups exist, and a restore has been tried once.
- A short "how to run, update and restore" section is added to `README.md`.

## 9. Ask before deciding

- Where it runs (IT's Windows or Linux server, a VM, or a cloud host) and whether that machine reaches
  `life.gainup.in:8089`.
- How people sign in (section 5, point 8).
- Whether the bus attendance server moves onto the same machine (recommended: it removes the
  temporary tunnel the phones use today).
- Anything that would change what a number on the dashboard means: ask Akhil first.
