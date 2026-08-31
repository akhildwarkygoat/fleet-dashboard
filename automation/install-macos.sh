#!/usr/bin/env bash
# install-macos.sh — register (or remove) the Monday refresh as a launchd user agent.
#
#   automation/install-macos.sh            # install / reinstall
#   automation/install-macos.sh --uninstall
#   automation/install-macos.sh --status
#
# A user agent, not a system daemon: it runs as you, needs no sudo, and inherits your
# keychain/network. It only fires while you are logged in — which is the right trade for
# a job whose output is read from this same working copy.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LABEL="com.gainup.fleet-dashboard.weekly-refresh"
PLIST_SRC="$REPO/automation/$LABEL.plist"
PLIST_DST="$HOME/Library/LaunchAgents/$LABEL.plist"

case "${1:-install}" in
  --status)
    echo "label   : $LABEL"
    echo "plist   : $PLIST_DST"
    if [ -f "$PLIST_DST" ]; then echo "installed: yes"; else echo "installed: no"; fi
    launchctl list 2>/dev/null | grep -F "$LABEL" || echo "loaded   : no"
    echo
    echo "next run : $(launchctl print "gui/$(id -u)/$LABEL" 2>/dev/null | grep -i -m1 'runs\|next' || echo '(load it to see)')"
    exit 0
    ;;
  --uninstall)
    launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
    rm -f "$PLIST_DST"
    echo "Removed $LABEL."
    exit 0
    ;;
  install) ;;
  *) echo "usage: $0 [install|--uninstall|--status]" >&2; exit 2 ;;
esac

PY="$(command -v python3 || command -v python || true)"
[ -n "$PY" ] || { echo "ERROR: python3 not found on PATH." >&2; exit 3; }
PYDIR="$(dirname "$PY")"

mkdir -p "$HOME/Library/LaunchAgents" "$REPO/automation/logs"
chmod +x "$REPO/automation/weekly-refresh.sh"

# launchd will not expand ~ or a relative path, so bake the absolute ones in.
sed -e "s|__REPO__|$REPO|g" -e "s|__PYDIR__|$PYDIR|g" "$PLIST_SRC" > "$PLIST_DST"
plutil -lint "$PLIST_DST" >/dev/null

# bootout first so a re-install replaces cleanly instead of erroring "already loaded"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST_DST"

echo "Installed $LABEL"
echo "  repo    : $REPO"
echo "  python  : $PY"
echo "  schedule: Mondays 04:00 (started on wake if asleep; caffeinate keeps it awake to finish)"
echo "  logs    : $REPO/automation/logs/weekly-refresh.log"
echo

# ── TCC preflight ───────────────────────────────────────────────────────────────────
# macOS protects ~/Documents, ~/Desktop and ~/Downloads. A launchd agent is NOT your
# Terminal: it gets none of Terminal's granted access, so if the repo lives in one of
# those folders the job dies with "Operation not permitted" — at 04:00 on a Monday,
# into a log nobody is watching. Prove it can actually reach the repo, now, instead.
PROBE_LABEL="$LABEL.preflight"
PROBE_SH="$(mktemp -t fdprobe)"
PROBE_OUT="$(mktemp -t fdprobe.out)"
# Probe the operation that actually matters: READING FILE CONTENTS. Under this
# restriction `cd` and access() (`[ -r ... ]`) both still succeed on a protected
# folder while open() is refused — so a probe built on those reports a cheerful
# false pass and the job dies anyway on Monday.
cat > "$PROBE_SH" <<PROBE
#!/bin/bash
head -c 1 "$REPO/refresh_routes.sh" >/dev/null 2>&1 && echo REACHABLE || echo BLOCKED
PROBE
chmod +x "$PROBE_SH"
cat > "$HOME/Library/LaunchAgents/$PROBE_LABEL.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>$PROBE_LABEL</string>
<key>ProgramArguments</key><array><string>/bin/bash</string><string>$PROBE_SH</string></array>
<key>StandardOutPath</key><string>$PROBE_OUT</string>
<key>StandardErrorPath</key><string>$PROBE_OUT</string>
<key>RunAtLoad</key><false/>
</dict></plist>
PLIST
launchctl bootout "gui/$(id -u)/$PROBE_LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/$PROBE_LABEL.plist" 2>/dev/null || true
launchctl kickstart "gui/$(id -u)/$PROBE_LABEL" 2>/dev/null || true
for _ in 1 2 3 4 5 6 7 8 9 10; do grep -q . "$PROBE_OUT" 2>/dev/null && break; sleep 0.4; done
RESULT="$(cat "$PROBE_OUT" 2>/dev/null || true)"
launchctl bootout "gui/$(id -u)/$PROBE_LABEL" 2>/dev/null || true
rm -f "$HOME/Library/LaunchAgents/$PROBE_LABEL.plist" "$PROBE_SH" "$PROBE_OUT"

case "$RESULT" in
  *REACHABLE*)
    echo "Preflight: launchd can reach the repo. The Monday job will run."
    echo
    echo "Run it once now to confirm end-to-end (needs the ERP; 30-45 min of OSRM lookups):"
    echo "  automation/weekly-refresh.sh"
    ;;
  *)
    echo "*** PREFLIGHT FAILED — the job is installed but WILL NOT RUN. ***"
    echo
    echo "macOS blocks launchd agents from ~/Documents, ~/Desktop and ~/Downloads."
    echo "This repo is at:"
    echo "  $REPO"
    echo
    echo "Fix it either way — both are one-time:"
    echo
    echo "  A. Move the working copy out of the protected folder, then re-run this installer:"
    echo "       mv \"$REPO\" ~/fleet-dashboard && ~/fleet-dashboard/automation/install-macos.sh"
    echo
    echo "  B. Grant Full Disk Access to /bin/bash:"
    echo "       System Settings > Privacy & Security > Full Disk Access > + > press Cmd-Shift-G,"
    echo "       type /bin/bash, Open. Then re-run this installer to re-check."
    echo "       (Broader than A — it lets every shell script read every protected folder.)"
    echo
    echo "Until then, run it by hand on Mondays:  automation/weekly-refresh.sh"
    exit 1
    ;;
esac
