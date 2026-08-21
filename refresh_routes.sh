#!/usr/bin/env bash
# refresh_routes.sh — pull the latest ERP snapshot and rebuild the Prev-route map data.
#
# Regenerates public/current_routes.json, which the "Prev. route"
# tab reads. Schedule it (cron / launchd) to keep the map current — see README notes below.
#
#   ./refresh_routes.sh            # fetch live ERP + rebuild routes
#
set -euo pipefail
cd "$(dirname "$0")"

# Pick a Python 3 interpreter (python3, else python) so this works across machines.
PY="$(command -v python3 || command -v python || true)"
if [ -z "$PY" ]; then echo "ERROR: Python 3 is not installed (need python3 or python on PATH)." >&2; exit 3; fi
command -v curl >/dev/null 2>&1 || { echo "ERROR: curl is not installed." >&2; exit 3; }
mkdir -p data  # gitignored dump lives here; the folder may be empty on a fresh clone

# Default to the public hostname, matching vite.config.js: the 172.16.x LAN address only
# resolves inside the office, while life.gainup.in serves the same ERP from either side.
ERP_BASE="${ERP_BASE:-http://life.gainup.in:8089}"
ERP_URL="${ERP_URL:-$ERP_BASE/api/general/VehicleEmpMapDetails}"

# ── ERP login ───────────────────────────────────────────────────────────────────────
# The ERP now needs a bearer token. Credentials come from ERP_USER/ERP_PASS or from
# .erp_key ({"Username": "…", "password": "…"}; either casing works), gitignored — same rule as
# .maps_key. Neither is echoed. With no credentials this falls through unauthenticated,
# so a site still on the old open ERP keeps working unchanged.
HAVE_CREDS=0
if { [ -n "${ERP_USER:-}" ] && [ -n "${ERP_PASS:-}" ]; } || [ -f .erp_key ]; then HAVE_CREDS=1; fi

AUTH_HEADER=""
if [ "$HAVE_CREDS" = "1" ]; then
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] Logging in to the ERP"
  # The login body's casing was documented to us two different ways ({"Username","password"}
  # by email, {"UserName","Password"} in the Postman screenshot), so try both. Credentials are
  # read inside Python and never echoed — no password reaches the terminal, the log or `ps`.
  TOKEN="$("$PY" - "$ERP_BASE" <<'PYEOF'
import json, os, sys, urllib.request, urllib.error
base = sys.argv[1]
user = os.environ.get("ERP_USER"); pw = os.environ.get("ERP_PASS")
if not (user and pw):
    try:
        raw = json.loads(open(".erp_key", encoding="utf-8-sig").read())   # utf-8-sig: tolerate a PowerShell BOM
        user = raw.get("Username") or raw.get("UserName") or raw.get("username") or raw.get("user")
        pw = raw.get("Password") or raw.get("password") or raw.get("pass")
    except Exception:
        pass
if not (user and pw):
    sys.exit(0)
for body in ({"Username": user, "password": pw}, {"UserName": user, "Password": pw}):
    req = urllib.request.Request(base + "/API/LOGIN", method="POST",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json", "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            d = json.load(r)
    except (urllib.error.URLError, ValueError):
        continue
    if isinstance(d, dict):
        d = d.get("data", d) if isinstance(d.get("data"), dict) else d
        t = d.get("token") or d.get("Token") or d.get("access_token")
        if t:
            print(t); break
PYEOF
)"
  if [ -z "$TOKEN" ]; then
    echo "ERROR: ERP login failed — check .erp_key (or ERP_USER/ERP_PASS)." >&2
    exit 4
  fi
  AUTH_HEADER="Authorization: Bearer $TOKEN"
fi

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Fetching live ERP → data/erp_live.json"
if ! curl -sS -fL -m 120 -o data/erp_live.json -X POST "$ERP_URL" \
      -H "Content-Type: application/json" -H "Accept: application/json" \
      ${AUTH_HEADER:+-H "$AUTH_HEADER"} -d '{}'; then
  echo "ERROR: could not reach the ERP at $ERP_URL — is this machine on the office network," >&2
  echo "       and are the ERP credentials current? (401 here means the login was rejected)" >&2
  exit 4
fi

# sanity-check the dump is valid JSON before rebuilding (never overwrite good routes with a broken feed)
"$PY" -c "import json,sys; d=json.load(open('data/erp_live.json')); assert isinstance(d,list) and d, 'empty ERP'; print(f'  {len(d)} rows, latest {sorted({x.get(\"date\",\"\")[:10] for x in d if x.get(\"date\")})[-1]}')"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Rebuilding routes (OSRM road paths, ~5 min)…"
# --merge-m 0 = NO clustering: every distinct ERP home GPS stays its own stop, exactly
# as it exists in the ERP (needed to compare the real current routes stop-for-stop).
"$PY" build_erp_routes.py --merge-m 0

# keep the "Merge review" tab's data in sync with the same ERP (fast, JSON only)
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Refreshing merge-review suggestions…"
"$PY" merge_suggestions.py --json-only || echo "  (merge suggestions skipped — non-fatal)"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Done. public/current_routes.json refreshed."
