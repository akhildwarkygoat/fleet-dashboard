# The Monday refresh

Rotational runs three round-the-clock slots and **every rider steps one place every Monday**:

```
Day  ->  Full night  ->  Half night  ->  Day
```

So from Monday morning, last week's roster mislabels roughly everyone who rotates. Everything
below exists to make that one fact safe to forget.

## What was wrong

The "Previous routes" card was charging each service for **every rider who boarded its
vehicles**, not the riders that service actually carries. A vehicle is not a service: the same
bus runs a Rotational trip and a General trip on the same day, and eleven of them carry more
than one Rotational slot.

Measured against the live ERP feed for 28-08-2026:

| Service | Card showed | Actually | Overstated |
| --- | --- | --- | --- |
| Rotational · Day | 1131 | **250** | 4.5× |
| Rotational · Half night | 1223 | **305** | 4.0× |
| Rotational · Full night | 1112 | **247** | 4.5× |
| 7 am Morning | 952 | **157** | 6.1× |
| 9 am General | 3593 | **3019** | 1.2× |
| Zenwear | 570 | 570 | — (its buses are exclusive) |

`public/current_routes.json` carried no service attribution at all, so
[NewPlanView](../src/optimiser/NewPlanView.jsx) could only filter *by bus* and then sum each
bus's whole-vehicle rider count.

## What now happens

1. **`build_erp_routes.py` attributes every rider to a service.** It mirrors `serviceIdFor()`
   from [services.js](../src/optimiser/services.js) — unit wins over shift, and Rotational's
   three slots are separated by the rider's slot in `src/rotationalRoster.json`. It emits:
   - `meta.riders_by_service` — the whole-fleet split
   - `buses[].by_service` — what each bus carries per service
   - `buses[].stops[].by_service` — per-stop headcounts, because a pickup point is shared too

   A rotational rider with **no slot on record is in no slot's totals** rather than being
   dumped into Day. `meta.riders_unassigned` counts them so they are visibly missing.

2. **It refuses to emit a stale split.** If `rotationalRoster.json`'s `_rotaWeek` is not the
   week of the ERP day being read, the build stops with the command to fix it. Pass
   `--allow-stale-roster` to override — the Rotational split will be wrong.

3. **`refresh_routes.sh` re-cuts the roster** between fetching the ERP and building the routes.
   That order matters: the roster needs the fresh punch feed, and the routes need the fresh
   roster. Use `--no-roster` to skip it.

4. **The ERP fetch is atomic.** It stages to `data/.erp_live.json.part` and only replaces the
   real dump once the JSON parses, so a transfer that drops midway through the ~47 MB body
   leaves last week's good dump in place.

The UI falls back to the old whole-vehicle count when `by_service` is absent, so a
`current_routes.json` built before this change still renders rather than reading zero.

## Running it

```bash
automation/weekly-refresh.sh        # the Monday job: fetch ERP -> re-cut roster -> rebuild routes
./refresh_routes.sh                 # the same pipeline, without the logging wrapper
./refresh_routes.sh --no-roster     # routes only
./refresh_routes.sh --check-login   # log in, say whether it worked, exit. Fetches nothing.
./refresh_routes.sh --rebuild-plans # ALSO re-solve the three rotational plans (see below)
```

### Why the plans are not rebuilt

The roster moves every Monday. The three plans (`public/plan_rot-*.json`) do not, and that is
deliberate. They are a different artefact — the routes the fleet actually runs — and the builder
does not reproduce them: re-solving `rot-day` from the same feed returns **9 buses, 171 min worst
ride** against the operating **12 buses, 119 min**. Silently swapping that in at 04:00, two hours
before the 06:00 Day gate, is not a refresh.

So the default run leaves them alone and prints a note when they have fallen behind the roster.
Plans now carry `rotaWeek`, so that check is an exact week-string comparison — never a headcount,
which differs by a rider or two even when the two are perfectly in sync. Rebuild them when you
mean to, and look at the result:

```bash
./refresh_routes.sh --rebuild-plans
```

### What the exit codes mean

The log names the cause, and the code is what Windows Task Scheduler shows as *Last Run Result*.

| code | meaning | who fixes it |
| --- | --- | --- |
| 0 | it worked | — |
| 3 | python3, curl or node missing | install it |
| 4 | could not reach the ERP — network, or the machine slept | reconnect / keep it awake |
| 5, 6 | the route build refused the roster (unreadable, or wrong week) | re-cut the roster |
| 8 | the ERP **rejected** the credentials | IT — the account |
| 9 | logged in, but the reply had no recognisable token | IT — the login API changed |
| 10 | `.erp_key` is missing, malformed, or UTF-16 | recreate the file |
| 11 | the ERP server itself errored (5xx) | wait, then IT |

Exit 4 used to be reported as "check .erp_key", which sent people to IT about a password when the
real cause was that the machine was not on the factory network. Each cause now has its own code
and its own sentence.

Takes **30-45 minutes**, almost all of it OSRM road-path lookups. The pipeline runs at
`--merge-m 0` (every distinct home GPS stays its own stop, so the real routes can be compared
stop-for-stop), which leaves some vehicles with 100+ waypoints per request. Scheduling it for 04:00 leaves it
finished before Rotational Day gates at 06:00. It writes
files only; it never touches git, so a bad ERP pull cannot land in the repo. The previous
`current_routes.json` and `rotationalRoster.json` are copied to `automation/last-good/` first.

Logs: `automation/logs/weekly-refresh.log`.

> The script's old banner claimed "~5 min". That estimate predates `--merge-m 0`; measured on
> this fleet it is 30-45 minutes.

## Scheduling — macOS

```bash
automation/install-macos.sh              # install (Mondays 04:00)
automation/install-macos.sh --status
automation/install-macos.sh --uninstall
```

If the Mac is asleep at 04:00 launchd **starts** the job on wake. Starting is not finishing: the
run of 2026-08-31 began at 04:04:45 and had not got past the login by 04:51:06, because the
machine kept sleeping underneath it — 46 minutes for a step with a 60-second timeout. `urlopen`'s
timeout is a monotonic clock that does not tick across sleep, and does not cover DNS at all.

The job is therefore launched through `caffeinate -i -m -s`, which holds the machine awake for
exactly as long as the run takes, and `ProcessType Background` has been removed (it opted a
45-minute network job into the throttling meant for housekeeping). A Mac that is fully shut down
at 04:00 still runs it at the next login.

### Why the repo lives at `~/fleet-dashboard`

It used to be under `~/Documents`, where the scheduled job **could not run**. macOS protects
`~/Documents`, `~/Desktop` and `~/Downloads`, and a launchd agent is **not** your Terminal — it
inherits none of Terminal's granted access. `cron` is blocked the same way; both were tested.

Measured from a launchd agent against a repo inside `~/Documents`:

| Operation | Result |
| --- | --- |
| `cd` into the repo | ok |
| `[ -r file ]` (`access()`) | **ok — and misleading** |
| read the file's contents (`open()`) | **blocked** |
| run a script in the repo | **blocked** (exit 126) |

`access()` succeeding while `open()` fails is the trap: a preflight built on `-r` reports a
cheerful pass and the job still dies at 04:00 into a log nobody reads. `install-macos.sh`
therefore probes a real content read, and refuses to claim success if it fails.

**So the working copy was moved out of `~/Documents`.** Nothing in the repo depended on the old
absolute path. If you ever move it again, just re-run `automation/install-macos.sh` from the new
location — the installer bakes the absolute path into the plist, because launchd expands neither
`~` nor relative paths.

The alternative, if the repo ever has to live in a protected folder, is granting Full Disk
Access to `/bin/bash` in System Settings → Privacy & Security. That is broader: it lets every
shell script on the machine read every protected folder.

## Scheduling — Windows (the factory PC)

`refresh_routes.sh` is a bash script, so the PC needs **Git for Windows** (Git Bash) or a real
WSL distro. The installer checks for both and says plainly what is missing.

**No Administrator rights are needed.** The task runs as the signed-in user. (The old
instructions here said "Administrator Command Prompt" — that was wrong.)

Everything the operator does, in PowerShell:

```powershell
cd C:\fleet-dashboard
git pull
powershell -NoProfile -ExecutionPolicy Bypass -File .\automation\install-windows.ps1
```

Then check it, and run it once for real (30–45 minutes):

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\automation\install-windows.ps1 -Status
Start-ScheduledTask -TaskName "Fleet dashboard weekly refresh"
Get-Content .\automation\logs\weekly-refresh.log -Tail 20 -Wait
```

`-Uninstall` removes it. `-SkipLoginTest` skips the ERP login check, which otherwise runs by
default because the login is the step that actually broke on the Mac.

### What the installer checks before it schedules anything

Nothing is registered until all of these pass — the same philosophy as `install-macos.sh`, which
refuses to claim success it has not proved:

- the repo is not on a UNC path, a mapped drive, `Program Files`, or `Windows` (a task cannot
  write there), and warns if it is inside OneDrive — the job writes a 48 MB dump of names, home
  addresses and attendance every week, and OneDrive would upload all of it
- Git Bash actually **runs** (`bash -lc 'echo ok'`), not merely exists on disk
- python3 is real, checked **through bash** — testing it from PowerShell is a false pass, because
  Windows ships a zero-byte `WindowsApps\python.exe` stub that `command -v` happily finds
- curl is present; node is only a warning, since the default Monday job never calls it
- `.erp_key` exists, is not UTF-16, parses, and has both fields — contents are never printed
- at least 150 MB free
- **and then it registers a throwaway probe task and actually runs it**, because everything above
  only proves what the installer's own session can do, not what a scheduled task can

### Why `Register-ScheduledTask` and not `schtasks`

`schtasks.exe` has **no switch** for `StartWhenAvailable` or `WakeToRun` — the catch-up behaviour
that makes a missed Monday run at the next start-up instead of being skipped. The macOS side
advertises exactly that, so the old `schtasks` line here quietly promised something it could not
deliver. The installer also sets `AllowStartIfOnBatteries` and `DontStopIfGoingOnBatteries`, both
of which default the wrong way and would otherwise kill the job mid-run on a laptop.

If you ever need the raw form anyway — **Command Prompt only, and without wake-on-miss** — note
that cmd's `^` line-continuation breaks in PowerShell, so it has to be one line:

```
schtasks.exe /Create /TN "Fleet dashboard weekly refresh" /SC WEEKLY /D MON /ST 04:00 /TR "\"C:\fleet-dashboard\automation\weekly-refresh.bat\"" /RL LIMITED /IT /F
```

### If PowerShell refuses to run the script

`-ExecutionPolicy Bypass` handles the ordinary case. If it still says *"running scripts is
disabled"*, run `Get-ExecutionPolicy -List`: anything other than `Undefined` for `MachinePolicy`
or `UserPolicy` means Group Policy is blocking script **files**, and `Bypass` cannot override it.
Ask IT, or register the task by hand with the `schtasks` line above.

### Still untested on Windows

This half was written from the macOS side and **has never been run on a Windows box**. The batch
wrapper and the installer are believed correct and were reviewed line by line, but believed is
not the same as seen. Run it once by hand and read
`automation\logs\weekly-refresh.log` before trusting the schedule — and keep this caveat here
until someone has pasted back a green log line from the actual factory PC.

## Only one run at a time

`weekly-refresh.sh` takes a lock (`automation/.refresh.lock`) and refuses to start if another
run holds it, exiting 75 without touching anything. A lock left by a killed run is reclaimed
after checking its recorded PID is really gone.

This is not a precaution, it is a repair. On 2026-08-31 two runs were started five seconds
apart and destroyed each other:

| time | |
| --- | --- |
| 14:54:57 | run A starts, downloads the ERP into the shared staging file |
| 14:55:02 | run B starts, downloads into **the same** staging file |
| 14:55:41 | B wins, re-cuts the roster to week 2026-08-31, begins the route build |
| 14:55:44 | A finds its staging file gone, dies — and rolls the roster **back** to 08-24 |
| 14:58:57 | B finishes and writes routes for 08-31, having already read the roster |

The result was a roster for one week and routes for another, with `refresh OK` in the log.
Three things changed: the lock above; the ERP staging file is now per-process
(`data/.erp_live.json.$$.part`) rather than one shared name; and **every run now ends by
asserting that the roster and the routes describe the same week**, on the success and the
failure path alike. That last check is what turns this class of fault from silent into loud:

```
*** INCONSISTENT: roster=2026-08-24 routes=2026-08-31.
    The shift list and the route map describe DIFFERENT weeks.
```

If you see that, re-run the job, or re-cut just the roster with
`python3 build_rotational_roster.py`.

## When it fails

The log names the cause. The usual ones:

- **ERP unreachable / credentials expired.** `.erp_key` holds `{"Username": …, "password": …}`.
  A 401 means the login was rejected. Nothing is overwritten — the dashboard keeps serving last
  week's files.
- **OSRM rate-limited.** The public `router.project-osrm.org` is best-effort; road paths come
  back empty (`road_paths 0/110`) while stops and rider counts are still correct. Re-run later.
- **Roster is for the wrong week.** The build refuses and prints the exact command. This is the
  guard working, not a bug.

Recover with the copies in `automation/last-good/`. Each run snapshots
`public/current_routes.json` and `src/rotationalRoster.json` into a **dated** folder there before
touching anything, and the newest four are kept. It used to be a single folder overwritten at the
start of every run, so the second consecutive failure copied the broken state over the only good
copy — which had already happened once.

A failed run now also **rolls those two files back**, so "the dashboard is still serving last
week's data" is true rather than merely hoped for. If the rollback itself fails the log says
`COULD NOT ROLL BACK` and names what to distrust, instead of claiming everything is fine.
