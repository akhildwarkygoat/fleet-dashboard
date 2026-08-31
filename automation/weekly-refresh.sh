#!/usr/bin/env bash
# weekly-refresh.sh — the Monday job. Wraps ./refresh_routes.sh with logging.
#
# WHY MONDAY: Rotational's three slots step one place every Monday
#   (Day -> Full night -> Half night -> Day)
# so from Monday morning last week's roster mislabels roughly everyone who rotates.
# refresh_routes.sh re-cuts the roster from the fresh punch feed and then rebuilds the
# Prev-route map against it, in that order.
#
# This writes files only. It never touches git — a bad ERP pull cannot land in the repo.
#
#   automation/weekly-refresh.sh          # run it now
#
# Scheduled by automation/com.gainup.fleet-dashboard.weekly-refresh.plist (macOS)
# or automation/weekly-refresh.bat (Windows Task Scheduler). See docs/weekly-refresh.md.
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"

LOG_DIR="$REPO/automation/logs"
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/weekly-refresh.log"

log() { printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >> "$LOG"; }

PY_BIN="$(command -v python3 || command -v python || true)"

# The dashboard reads the roster for WHO is on which shift and the routes for WHAT each bus
# carries. If those two describe different weeks the board is quietly wrong, and every
# individual step can still have reported success — which is exactly what happened on
# 2026-08-31. So assert it at the end of every run, whichever way the run went.
check_consistency() {
  [ -n "$PY_BIN" ] || return 0
  OUT="$("$PY_BIN" - <<'PYEOF' 2>/dev/null
import json
try:
    a = json.load(open("src/rotationalRoster.json")).get("_rotaWeek", "?")
    b = json.load(open("public/current_routes.json"))["meta"].get("rota_week", "?")
except Exception as e:
    print("SKIP could not read both files (%s)" % e.__class__.__name__); raise SystemExit
print(("OK %s" % a) if a == b else ("MISMATCH roster=%s routes=%s" % (a, b)))
PYEOF
)"
  case "$OUT" in
    OK\ *)       log "  Consistent: roster and routes are both week ${OUT#OK }." ;;
    MISMATCH*)   log "  *** INCONSISTENT: ${OUT#MISMATCH }."
                 log "      The shift list and the route map describe DIFFERENT weeks. The Rotational"
                 log "      split on the board is not trustworthy until this is re-run successfully."
                 log "      Fix: $(basename "$0") again, or re-cut just the roster with"
                 log "           python3 build_rotational_roster.py" ;;
    *)           log "  (consistency check skipped: ${OUT:-no output})" ;;
  esac
}

# Keep the log from growing without bound — one trim a week costs nothing.
if [ -f "$LOG" ] && [ "$(wc -c < "$LOG")" -gt 1048576 ]; then
  tail -n 2000 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
  log "(log trimmed to the last 2000 lines)"
fi

# ── one run at a time ───────────────────────────────────────────────────────────────
# Two overlapping runs corrupt each other, and it is not theoretical: on 2026-08-31 two were
# started 5 s apart. They shared one ERP staging file, so the first to finish moved it out
# from under the second; the second then died and its failure handler rolled the roster back
# over the fresh cut the first had just written. The result was routes for one week and a
# roster for another, with "refresh OK" in the log.
#
# mkdir is atomic on every filesystem this runs on, so it is the lock. A lock left behind by
# a killed run is reclaimed only after checking the recorded PID is really gone.
LOCK="$REPO/automation/.refresh.lock"
if ! mkdir "$LOCK" 2>/dev/null; then
  OLDPID="$(cat "$LOCK/pid" 2>/dev/null || echo '')"
  if [ -n "$OLDPID" ] && kill -0 "$OLDPID" 2>/dev/null; then
    log "=== another refresh (pid $OLDPID) is already running — this one will not start ==="
    log "    Wait for it to finish. Starting two at once is what broke 2026-08-31."
    exit 75          # EX_TEMPFAIL: try again later, nothing was touched
  fi
  log "Clearing a stale lock from pid ${OLDPID:-unknown} (no such process)."
  rm -rf "$LOCK"
  mkdir "$LOCK" || { log "FAILED: could not take the lock at $LOCK"; exit 75; }
fi
echo $$ > "$LOCK/pid"
# Released however this script exits, including on Ctrl-C.
trap 'rm -rf "$LOCK"' EXIT INT TERM

log "=== weekly refresh starting (host $(hostname -s)) ==="

# Snapshot what we are about to replace, into a DATED directory.
#
# This used to write to one fixed folder, overwritten at the start of every run — so the
# second consecutive failure copied the already-broken state over the last good copy and
# there was nothing left to recover from. It had already happened: last-good/ was stamped
# by the failed run of 2026-08-31.
#
# Four generations is a month of Mondays.
BACKUP="$REPO/automation/last-good/$(date '+%Y-%m-%d')"
mkdir -p "$BACKUP"
BACKED_UP=1
for f in public/current_routes.json src/rotationalRoster.json; do
  if [ -f "$f" ]; then
    cp "$f" "$BACKUP/$(basename "$f")" || { log "WARNING: could not back up $f"; BACKED_UP=0; }
  fi
done
# Prune oldest-first, newest 4 kept. ISO names sort chronologically, so plain sort is enough.
# NOT `head -n -4`: that is a GNU extension and macOS's head rejects a negative count, which
# made the prune a silent no-op on the very machine that runs this.
(
  cd "$REPO/automation/last-good" 2>/dev/null || exit 0
  n=$(ls -1d 20*/ 2>/dev/null | wc -l | tr -d ' ')
  if [ "${n:-0}" -gt 4 ]; then
    ls -1d 20*/ 2>/dev/null | sort | head -n "$((n - 4))" | while read -r d; do rm -rf "$d"; done
  fi
) || true
log "Pre-run snapshot: automation/last-good/$(basename "$BACKUP")"

# Capture the status explicitly. After `if cmd; then ... fi` with no branch taken, `$?` is
# the status of the *if statement* (0), not of cmd — so a failed refresh reported "exit 0"
# and told launchd the job had succeeded.
./refresh_routes.sh >> "$LOG" 2>&1
RC=$?

if [ "$RC" -eq 0 ]; then
  log "refresh OK"
  # Report the split the dashboard will now show, so the log answers "did it work?"
  "$(command -v python3 || command -v python)" - >> "$LOG" 2>&1 <<'PY'
import json
try:
    m = json.load(open("public/current_routes.json"))["meta"]
    print("    rota week %s · %s" % (m.get("rota_week", "?"),
          ", ".join(f"{k} {v}" for k, v in (m.get("riders_by_service") or {}).items())))
    if m.get("riders_unassigned"):
        print("    %d rider(s) had no rotational slot and are in no slot's totals" % m["riders_unassigned"])
except Exception as e:
    print("    (could not read back current_routes.json: %s)" % e)
PY
  check_consistency
  log "=== done ==="
  exit 0
fi

# A failure can land BETWEEN the roster re-cut and the route build, leaving the roster on the
# new week and the routes on the old one — the exact state the old message denied by claiming
# "the dashboard is still serving the previous week's files". Put the two files back so that
# sentence is true again, and say plainly if that could not be done.
RESTORED=""
if [ "$BACKED_UP" = "1" ]; then
  RESTORE_OK=1
  for f in public/current_routes.json src/rotationalRoster.json; do
    b="$BACKUP/$(basename "$f")"
    if [ -f "$b" ]; then
      if cmp -s "$b" "$f" 2>/dev/null; then continue; fi     # untouched by this run
      if cp "$b" "$f"; then RESTORED="$RESTORED $(basename "$f")"; else RESTORE_OK=0; fi
    fi
  done
else
  RESTORE_OK=0
fi

log "FAILED (exit $RC)."
case "$RC" in
  3)  log "  A required program is missing (python3, node or curl). Nothing was fetched." ;;
  4)  log "  Could not reach the ERP. This machine is probably not on the factory network,"
      log "  or it went to sleep mid-run. The password is NOT the problem." ;;
  5|6) log "  The route build refused the roster (unreadable, or cut for the wrong week)." ;;
  8)  log "  The ERP REFUSED the login. Call IT about the dashboard's ERP account." ;;
  9)  log "  The ERP login replied in an unrecognised shape — its API has changed. Call IT." ;;
  10) log "  .erp_key could not be read. See the error above for which part failed." ;;
  11) log "  The ERP server itself errored (5xx). Try again in an hour." ;;
  *)  log "  See the error above. OSRM rate-limiting is another common cause." ;;
esac
if [ -n "$RESTORED" ]; then
  log "  Rolled back:$RESTORED — the dashboard is serving last week's data, unchanged."
elif [ "$RESTORE_OK" = "1" ]; then
  log "  Nothing had been written yet; the dashboard is serving last week's data, unchanged."
else
  log "  *** COULD NOT ROLL BACK. The roster and the routes may now describe different weeks."
  log "      Do not trust the Rotational split until this has been re-run successfully."
  log "      Copies are in automation/last-good/ (newest dated folder)."
fi
check_consistency
log "=== done (failed) ==="
exit "$RC"
