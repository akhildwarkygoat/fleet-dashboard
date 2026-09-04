#!/usr/bin/env bash
# refresh_routes.sh — pull the latest ERP snapshot and rebuild the Prev-route map data.
#
# Regenerates public/current_routes.json, which the "Prev. route"
# tab reads. Schedule it (cron / launchd) to keep the map current — see README notes below.
#
#   ./refresh_routes.sh                 # fetch live ERP + re-cut the rota roster + rebuild routes
#   ./refresh_routes.sh --no-roster     # skip the roster re-cut (routes only)
#   ./refresh_routes.sh --roster-only   # ONLY re-cut the roster: ~2 min, no map rebuild
#   ./refresh_routes.sh --rebuild-plans # ALSO re-solve the optimiser's three baseline plans (see below)
#   ./refresh_routes.sh --check-login   # log in, report, exit. Fetches nothing, writes nothing.
#
# The Rotational plans are NOT rebuilt on a Monday, and since 2026-09-04 they do not need to
# be. They are nine manager-finalised files — three FIXED rider groups x three clocks, under
# public/plans/rot/ — and src/rotation.json turns the label every Monday: which group's plan
# each clock shows is arithmetic on the calendar, not a rebuild. What moves every week is the
# roster (WHO is on which slot) and, additively, the groups file (WHICH group a new rider
# belongs to). Both are re-cut here, in that order, and the run prints the rotation for the
# week so the log says which group is on which clock. See docs/rotation.md.
#
# RUN THIS EVERY MONDAY. Rotational's three slots step one place every Monday
#   (Day -> Full night -> Half night -> Day)
# so a roster cut last week mislabels roughly everyone who rotates, and build_erp_routes.py
# will refuse to emit a split it knows is stale. See docs/weekly-refresh.md.
#
set -euo pipefail
cd "$(dirname "$0")"

ROSTER=1
ROSTER_ONLY=0
REBUILD_PLANS=0
CHECK_LOGIN=0
for a in "$@"; do
  case "$a" in
    --no-roster) ROSTER=0 ;;
    --roster-only) ROSTER_ONLY=1 ;;
    --rebuild-plans) REBUILD_PLANS=1 ;;
    --check-login) CHECK_LOGIN=1 ;;
    -h|--help) sed -n '2,25p' "$0"; exit 0 ;;
    *) echo "unknown option: $a" >&2; exit 2 ;;
  esac
done

# Pick a Python 3 interpreter (python3, else python) so this works across machines.
PY="$(command -v python3 || command -v python || true)"
if [ -z "$PY" ]; then echo "ERROR: Python 3 is not installed (need python3 or python on PATH)." >&2; exit 3; fi
command -v curl >/dev/null 2>&1 || { echo "ERROR: curl is not installed." >&2; exit 3; }
mkdir -p data  # gitignored dump lives here; the folder may be empty on a fresh clone

# Default to the hostname vite.config.js uses. NOTE: life.gainup.in resolves to 172.16.10.169
# — an RFC1918 address served by the factory's own resolver. It is INTERNAL ONLY. This machine
# must be on the factory network (or its VPN); from anywhere else the login fails with exit 4,
# which is not a credentials problem however much the old message said it was.
# The ERP has split-horizon DNS and its reachable address differs per office subnet — see
# erp_address.py. Discover it rather than assume it, or the 04:00 Monday job dies with
# ETIMEDOUT on whichever network the machine happens to be on. ERP_BASE skips discovery.
if [ -z "${ERP_BASE:-}" ]; then
  # `|| true` is load-bearing: under `set -e` a failing command substitution in an
  # assignment kills the script on the spot. python exits 2 when the file is missing, and
  # 2>/dev/null hides why — so a checkout without erp_address.py died with a bare "exit 2"
  # and no output at all, which is precisely what the factory PC did on 2026-09-01. The
  # fallback on the next line exists for exactly this case; let it be reached.
  ERP_BASE="$("$PY" erp_address.py 2>/dev/null || true)"
  [ -z "$ERP_BASE" ] && ERP_BASE="http://${ERP_HOST:-life.gainup.in}:${ERP_PORT:-8089}"
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] ERP address: $ERP_BASE"
fi
ERP_URL="${ERP_URL:-$ERP_BASE/api/general/VehicleEmpMapDetails}"

# ── ERP login ───────────────────────────────────────────────────────────────────────
# The ERP needs a bearer token. Credentials come from ERP_USER/ERP_PASS or from .erp_key
# ({"Username": "…", "password": "…"}; either casing works), gitignored — same rule as
# .maps_key. Neither is ever echoed. With NO credentials at all this deliberately falls
# through unauthenticated, so a site still on the open ERP keeps working unchanged.
#
# Every distinct failure used to collapse into one line naming .erp_key, which sent people
# to IT about a password when the real cause was that the machine was off the factory
# network. Each cause now has its own exit code and its own sentence:
#
#   4   cannot reach the ERP (DNS, connect, timeout) — usually not on the factory network
#   8   the ERP REJECTED the credentials (401/403) — a person has to fix the account
#   9   logged in, but the reply had no recognisable token — the login API changed
#   10  .erp_key exists but is unreadable, malformed, or missing a field
#   11  the ERP itself errored (5xx) — their server, not us
# (5 and 6 come from build_erp_routes.py, 7 from build_rotation_groups.py — the roster or the
#  groups file is not what the step needs, and the message names the fix. All propagate here.)
HAVE_CREDS=0
if { [ -n "${ERP_USER:-}" ] && [ -n "${ERP_PASS:-}" ]; } || [ -f .erp_key ]; then HAVE_CREDS=1; fi

AUTH_HEADER=""
if [ "$HAVE_CREDS" = "0" ]; then
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] Auth mode: NONE — no ERP_USER/ERP_PASS and no .erp_key; fetching unauthenticated."
else
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] Logging in to the ERP"
  LOGIN_START=$(date +%s)
  LOGIN_RC=0
  # The login body's casing was documented two different ways ({"Username","password"} by
  # email, {"UserName","Password"} in the Postman screenshot), so try both. Credentials are
  # read inside Python and never echoed — no password reaches the terminal, the log or `ps`.
  TOKEN="$("$PY" - "$ERP_BASE" <<'PYEOF'
import json, os, sys, urllib.request, urllib.error

base = sys.argv[1]
user = os.environ.get("ERP_USER"); pw = os.environ.get("ERP_PASS")
src = "ERP_USER/ERP_PASS"
if not (user and pw):
    src = ".erp_key"
    try:
        # utf-8-sig tolerates a PowerShell BOM; a UTF-16 file raises and is reported as such.
        raw = json.loads(open(".erp_key", encoding="utf-8-sig").read())
    except FileNotFoundError:
        sys.exit(0)                      # no key file at all — the caller allows this
    except UnicodeDecodeError:
        print(".erp_key is not UTF-8 (a UTF-16 file, as PowerShell's > and Out-File produce)",
              file=sys.stderr); sys.exit(10)
    except ValueError as e:
        print(f".erp_key is not valid JSON ({e.__class__.__name__})", file=sys.stderr); sys.exit(10)
    if not isinstance(raw, dict):
        print(".erp_key must be a JSON object", file=sys.stderr); sys.exit(10)
    user = raw.get("Username") or raw.get("UserName") or raw.get("username") or raw.get("user")
    pw = raw.get("Password") or raw.get("password") or raw.get("pass")
if not (user and pw):
    # Name the MISSING FIELD, never a value and never a length.
    missing = " and ".join(n for n, v in (("username", user), ("password", pw)) if not v)
    print(f"{src} has no {missing}", file=sys.stderr); sys.exit(10)

worst = 4
for body in ({"Username": user, "password": pw}, {"UserName": user, "Password": pw}):
    req = urllib.request.Request(base + "/API/LOGIN", method="POST",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json", "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            d = json.load(r)
    except urllib.error.HTTPError as e:
        # 401/403 is a real answer from a reachable server: the account was refused.
        worst = 8 if e.code in (401, 403) else (11 if e.code >= 500 else max(worst, 9))
        print(f"login attempt: HTTP {e.code} {e.reason}", file=sys.stderr)
        continue
    except urllib.error.URLError as e:
        print(f"login attempt: could not reach {base} ({e.reason})", file=sys.stderr)
        worst = 4; continue
    except ValueError:
        print("login attempt: the ERP replied with something that is not JSON", file=sys.stderr)
        worst = 9; continue
    except Exception as e:                     # never let a raw traceback replace the message
        print(f"login attempt: {e.__class__.__name__}", file=sys.stderr)
        worst = max(worst, 9); continue
    if isinstance(d, dict):
        d = d.get("data", d) if isinstance(d.get("data"), dict) else d
        t = d.get("token") or d.get("Token") or d.get("access_token")
        if t:
            print(t); sys.exit(0)
    # A 200 with no token: report the SHAPE (key names only), never the body.
    keys = sorted(d)[:12] if isinstance(d, dict) else type(d).__name__
    print(f"login attempt: 200 OK but no token field; top-level keys were {keys}", file=sys.stderr)
    worst = 9
sys.exit(worst)
PYEOF
)" || LOGIN_RC=$?
  LOGIN_SECS=$(( $(date +%s) - LOGIN_START ))

  # A login that takes minutes did not time out — the machine slept through it. urlopen's
  # timeout is a monotonic clock that does not tick across sleep, and covers neither DNS nor
  # the TCP connect. This is what happened on 2026-08-31: 46 minutes for a 60 s timeout.
  if [ "$LOGIN_SECS" -gt 180 ]; then
    echo "NOTE: the login took ${LOGIN_SECS}s. A 60 s timeout cannot take that long — this machine" >&2
    echo "      almost certainly slept mid-run. On macOS the job should be started by launchd via" >&2
    echo "      caffeinate (automation/install-macos.sh); on Windows keep the PC awake and on AC." >&2
  fi

  if [ -n "${TOKEN:-}" ]; then
    AUTH_HEADER="Authorization: Bearer $TOKEN"
  elif [ "$LOGIN_RC" = "0" ]; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Auth mode: NONE — no credentials found; fetching unauthenticated."
  else
    case "$LOGIN_RC" in
      8)  echo "ERROR: the ERP refused the dashboard login." >&2
          echo "       Call IT and ask them to check the ERP account this dashboard uses." >&2
          echo "       Re-running will not help. Nothing was overwritten." >&2 ;;
      9)  echo "ERROR: the login succeeded but the ERP replied in a shape this script does not know." >&2
          echo "       The ERP login API has probably changed. Call IT." >&2 ;;
      10) echo "ERROR: the credentials file could not be read (see the line above)." >&2
          echo "       Recreate .erp_key as plain UTF-8, on ONE line:" >&2
          echo '         {"Username": "…", "password": "…"}' >&2
          echo "       On Windows use PowerShell's [System.IO.File]::WriteAllText — its > and" >&2
          echo "       Out-File write UTF-16, which nothing here can read." >&2 ;;
      11) echo "ERROR: the ERP server returned an error of its own (5xx). It is likely down." >&2
          echo "       Try again in an hour; if it keeps failing, call IT." >&2 ;;
      *)  echo "ERROR: could not reach the ERP at $ERP_BASE." >&2
          echo "       This machine is probably not on the factory network, or it slept mid-run." >&2
          echo "       Nothing is wrong with the password. Reconnect, keep the machine awake," >&2
          echo "       and run the refresh again. The dashboard is still serving last week's data." >&2 ;;
    esac
    exit "$LOGIN_RC"
  fi
fi

if [ "$CHECK_LOGIN" = "1" ]; then
  if [ -n "$AUTH_HEADER" ]; then
    echo "LOGIN OK — the ERP accepted the dashboard's credentials."
  else
    echo "LOGIN OK — no credentials configured; this ERP is being read unauthenticated."
  fi
  exit 0
fi

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Fetching live ERP → data/erp_live.json"
# Fetch to a temp file and swap it in only once it parses. curl leaves the target alone on a
# connection failure or an HTTP error, but a transfer that DROPS midway through the ~30 MB body
# writes a truncated file — which is still valid on disk and fails much later, inside the route
# build. Staging makes the replacement atomic: a bad pull leaves last week's dump untouched.
# Per-process, NOT a fixed name. Two runs sharing one staging file is how 2026-08-31 broke:
# the first to finish moved it into place, the second found it gone and died — and the EXIT
# trap of either would happily delete the other's download.
ERP_TMP="data/.erp_live.json.$$.part"
trap 'rm -f "$ERP_TMP"' EXIT
# -m 120 was too short: the feed has grown to ~48 MB and a real run timed out at 136 s with
# 17 MB received. Use a generous overall cap plus a stall detector, so a genuinely dead
# connection still fails fast while a merely slow one is allowed to finish.
if ! curl -sS -fL -m "${ERP_TIMEOUT:-900}" --speed-limit 1024 --speed-time 60 -o "$ERP_TMP" -X POST "$ERP_URL" \
      -H "Content-Type: application/json" -H "Accept: application/json" \
      ${AUTH_HEADER:+-H "$AUTH_HEADER"} -d '{}'; then
  echo "ERROR: could not reach the ERP at $ERP_URL — is this machine on the office network," >&2
  echo "       and are the ERP credentials current? (401 here means the login was rejected)" >&2
  exit 4
fi

# sanity-check the dump is valid JSON before rebuilding (never overwrite good routes with a broken feed)
"$PY" -c "import json,sys; d=json.load(open('$ERP_TMP')); assert isinstance(d,list) and d, 'empty ERP'; print(f'  {len(d)} rows, latest {sorted({x.get(\"date\",\"\")[:10] for x in d if x.get(\"date\")})[-1]}')"
mv "$ERP_TMP" data/erp_live.json

# ── Rotational roster ───────────────────────────────────────────────────────────────
# Must run AFTER the fetch (it reads the fresh punch feed) and BEFORE the route build
# (which reads the roster to split Rotational's three slots). Out of order, the routes
# are cut against last week's slots.
if [ "$ROSTER" = "1" ]; then
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] Re-cutting the rotational roster for this week…"
  "$PY" build_rotational_roster.py
  # The roster just moved everyone one slot. The GROUPS file must not move at all — it is the
  # fixed identity the nine plans were built for — so this step is additive: it files this
  # week's joiners into the group the calendar puts on their slot, removes nobody, and is a
  # no-op when there is nothing new. It runs in every mode that re-cuts the roster, including
  # --roster-only. Exit 7 means it refused (same family as build_erp_routes.py's 5 and 6: the
  # input is not what it needs, and the message above names the fix); under `set -e` that
  # stops the run here, before the map is built against a roster whose joiners have no plan.
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] Filing this week's joiners into their rotation group…"
  "$PY" build_rotation_groups.py
else
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] Skipping the roster re-cut (--no-roster)."
fi

# ── Rotational plans ────────────────────────────────────────────────────────────────
# The operating plans are the nine group x clock files under public/plans/rot/, chosen per
# week by src/rotation.json. They are built for a FIXED group of people, so they never fall
# behind the roster and nothing here rebuilds them — a new set arrives from the transport
# manager and is imported with scripts/import_rotation_plans.mjs (docs/rotation.md).
#
# --rebuild-plans re-solves something else: the optimiser's own three baseline files
# (public/plan_rot-*.json, each service's planUrl), which the dashboard falls back to only
# when the manifest has no plan for a slot. Re-solving those unattended is still not a
# refresh — measured, the builder does not reproduce a manager plan (rot-day comes back
# 9 buses / 171 min max ride against the operating 12 buses / 119 min) — so it stays OPT-IN.
# The default path instead prints the rotation for the roster week: which group is on which
# clock, and how well this week's punches agreed with the calendar.
if [ "$REBUILD_PLANS" = "1" ]; then
  command -v node >/dev/null 2>&1 || { echo "ERROR: --rebuild-plans needs node on PATH." >&2; exit 3; }
  # `import … with { type: "json" }` in build_service_plans.mjs is a SyntaxError below Node 18.20.
  NODE_OK="$(node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.stdout.write((a>20||(a===20&&b>=10)||(a===18&&b>=20))?"1":"0")')"
  [ "$NODE_OK" = "1" ] || { echo "ERROR: --rebuild-plans needs Node >= 18.20 (found $(node -v))." >&2; exit 3; }
  for s in rot-day rot-half rot-full; do
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Re-planning $s…"
    # --erp is NOT optional: build_service_plans.mjs defaults to data/erp_live.fresh.json,
    # which is a frozen snapshot, not the dump this script just pulled.
    node build_service_plans.mjs --service "$s" --erp data/erp_live.json
  done
else
  # Informational, hence `|| true`: a roster cut before the rotation check existed, or a
  # missing manifest, must never fail the run. The agreement figures come from
  # build_rotational_roster.py's rotation check, stored in the roster as `_rotation`; when
  # the roster has none for this week the prediction is still printed, without a figure.
  "$PY" - <<'PYEOF' || true
import json, sys
SLOT = {"day": "Day", "half": "Half night", "full": "Full night"}
try:
    roster = json.load(open("src/rotationalRoster.json", encoding="utf-8"))
except Exception as e:
    print(f"NOTE: could not read src/rotationalRoster.json ({e.__class__.__name__}) — no rotation line.")
    sys.exit(0)
week = roster.get("_rotaWeek") or "?"
rot = roster.get("_rotation") or {}
agreement = {}
if rot.get("week") == week and rot.get("predicted"):
    by_slot, step, agreement = rot["predicted"], rot.get("step", "?"), rot.get("agreement") or {}
else:
    try:
        import build_rotation_groups as rg            # same arithmetic as the dashboard's rotation.js
        manifest, _ = rg.load_manifest(retries=0)
        r = rg.rotation_for(week, manifest)
        by_slot, step = r["bySlot"], r["step"]
    except Exception as e:
        print(f"NOTE: no rotation for week {week} ({e.__class__.__name__}: {e}) — is src/rotation.json present?")
        sys.exit(0)
print(f"Rotation for week {week} (step {step}): "
      + " · ".join(f"{SLOT[s]} = Group {by_slot.get(s, '?')}" for s in ("day", "half", "full")))
if agreement:
    parts, low = [], []
    for g in sorted(agreement):
        a = agreement[g]
        if a.get("share") is None:
            parts.append(f"Group {g} no punches")
        else:
            parts.append(f"Group {g} {a['share']:.0%} ({a['match']}/{a['n']})")
            if a["share"] < 0.75:
                low.append(g)
    print("    this week's punches agree with the calendar: " + ", ".join(parts))
    if low:
        print("    *** LOW agreement for Group " + ", ".join(low) + " — the calendar may be a step off the floor.")
        print("        See the warning from build_rotational_roster.py above, and docs/rotation.md.")
else:
    print("    (no agreement figure yet: the roster predates the rotation check — the next re-cut adds it)")
PYEOF
fi

# The rotation and the map are two different jobs sharing one ERP pull. Re-cutting the
# roster is the one that decides WHO is on which shift, and it takes seconds; rebuilding the
# map is 30-45 minutes of OSRM lookups and only changes WHERE the buses drive. Splitting
# them lets the shift board be brought up to date on a Monday without waiting for the map.
if [ "$ROSTER_ONLY" = "1" ]; then
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] --roster-only: skipping the route rebuild and the merge review."
  echo "    The shift list and the rotation groups are now current. public/current_routes.json still describes the"
  echo "    week it was last built for, so the Prev-route map is one refresh behind until"
  echo "    a full run is made. The Planner and the Stops board read the roster and are correct."
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] Done (roster only)."
  exit 0
fi

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Rebuilding routes (OSRM road paths — 30-45 min at --merge-m 0)…"
# --merge-m 0 = NO clustering: every distinct ERP home GPS stays its own stop, exactly
# as it exists in the ERP (needed to compare the real current routes stop-for-stop).
"$PY" build_erp_routes.py --merge-m 0

# keep the "Merge review" tab's data in sync with the same ERP (fast, JSON only)
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Refreshing merge-review suggestions…"
MS_RC=0
"$PY" merge_suggestions.py --json-only || MS_RC=$?
if [ "$MS_RC" != "0" ]; then
  MS_AGE="$("$PY" -c "import os,time;f='public/merge_suggestions.json';print(f'{(time.time()-os.path.getmtime(f))/86400:.0f}') if os.path.exists(f) else print('?')" 2>/dev/null || echo '?')"
  echo "  WARNING: merge_suggestions.py exited $MS_RC — the Merge review tab is still serving"
  echo "           public/merge_suggestions.json from ${MS_AGE} day(s) ago. Non-fatal; routes are fine."
fi

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Done. public/current_routes.json refreshed."
