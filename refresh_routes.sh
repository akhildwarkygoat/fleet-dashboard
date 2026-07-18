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

ERP_URL="${ERP_URL:-http://172.16.10.169:8089/api/general/VehicleEmpMapDetails}"
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Fetching live ERP → data/erp_live.json"
curl -sS -m 90 -o data/erp_live.json -X POST "$ERP_URL" \
  -H "Content-Type: application/json" -H "Accept: application/json" -d '{}'

# sanity-check the dump is valid JSON before rebuilding (never overwrite good routes with a broken feed)
python3 -c "import json,sys; d=json.load(open('data/erp_live.json')); assert isinstance(d,list) and d, 'empty ERP'; print(f'  {len(d)} rows, latest {sorted({x.get(\"date\",\"\")[:10] for x in d if x.get(\"date\")})[-1]}')"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Rebuilding routes (OSRM road paths, ~5 min)…"
python3 build_erp_routes.py

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Done. public/current_routes.json refreshed."
