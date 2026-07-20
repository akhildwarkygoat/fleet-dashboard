#!/usr/bin/env bash
# refresh_routes.sh — pull the latest ERP snapshot and rebuild the Prev-route map data.
#
# Run this on a machine that is ON the office network (so it can reach the ERP at
# 172.16.10.169). It regenerates public/current_routes.json, which the "Prev. route"
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

ERP_URL="${ERP_URL:-http://172.16.10.169:8089/api/general/VehicleEmpMapDetails}"
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Fetching live ERP → data/erp_live.json"
if ! curl -sS -fL -m 120 -o data/erp_live.json -X POST "$ERP_URL" \
      -H "Content-Type: application/json" -H "Accept: application/json" -d '{}'; then
  echo "ERROR: could not reach the ERP at $ERP_URL — is this machine on the office network?" >&2
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
