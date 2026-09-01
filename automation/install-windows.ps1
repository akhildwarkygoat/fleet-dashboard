<#
.SYNOPSIS
    Register (or remove) the Monday fleet-dashboard refresh on this Windows PC.

.DESCRIPTION
    The Rotational shift runs three slots and every rider steps one place each Monday
    (Day -> Full night -> Half night -> Day). From Monday morning, last week's roster
    mislabels roughly everyone who rotates. This job re-cuts the roster from the fresh
    ERP punch feed and rebuilds the route map against it, at 15:30 every Monday.
    Note: Day gates at 06:00 and Half night at 14:00, so on Monday itself those two run on
    last week's roster; the fresh split is in place from Full night (22:00) onwards.

    It writes files only. It never touches git, so a bad ERP pull cannot land in the repo.

    NO ADMINISTRATOR RIGHTS ARE NEEDED. The task runs as you, at your own privilege level.

    Nothing is scheduled until every preflight check below has passed - including a real
    probe run through Task Scheduler itself. A job that cannot run is not worth a schedule;
    it just fails at 15:30 into a log nobody is reading.

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File .\automation\install-windows.ps1
    powershell -NoProfile -ExecutionPolicy Bypass -File .\automation\install-windows.ps1 -Status
    powershell -NoProfile -ExecutionPolicy Bypass -File .\automation\install-windows.ps1 -Uninstall
#>
[CmdletBinding()]
param(
    [switch]$Status,
    [switch]$Uninstall,
    [switch]$SkipLoginTest
)

# NOT 'Stop'. Under 'Stop', Windows PowerShell 5.1 promotes anything a native command
# writes to stderr into a TERMINATING error, and `2>$null` does not prevent it. This script
# shells out constantly, so 'Stop' meant a program that merely printed a warning killed the
# installer with a raw RemoteException - which is exactly what the Microsoft Store python
# stub did on the factory PC, 2026-09-01. Every check here already reports its own result
# and sets $script:Failed, and the places that must abort use try/catch.
$ErrorActionPreference = 'Continue'
$TaskName  = 'Fleet dashboard weekly refresh'
$ProbeName = 'Fleet dashboard weekly refresh (preflight)'
$Repo      = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$LogPath   = Join-Path $Repo 'automation\logs\weekly-refresh.log'

$script:Failed = $false
function Say-Ok   ($m) { Write-Host ("  OK    " + $m) -ForegroundColor Green }
function Say-Warn ($m) { Write-Host ("  WARN  " + $m) -ForegroundColor Yellow }
function Say-Fail ($m) { Write-Host ("  FAIL  " + $m) -ForegroundColor Red; $script:Failed = $true }
function Say-Info ($m) { Write-Host ("        " + $m) -ForegroundColor DarkGray }

# One way to run a shell command, whichever shell this PC actually has. Every dependency
# check goes through it, so a WSL-only PC is checked as thoroughly as a Git Bash one.
#
# The command goes into a FILE rather than being passed as an argument. Windows PowerShell
# 5.1 re-quotes arguments to native commands, and it mangles any that contain quotes of
# their own: on the factory PC 2026-09-01,
#     '/c/.../python' -c 'import sys;print(sys.version_info[0])'
# reached bash as several separate words and died with
#     syntax error: unexpected end of file
# A file has no argument layer to survive, so every quoting problem of this class goes away
# at once. It is the same trick the Task Scheduler probe below already uses.
function Invoke-Sh ($cmd) {
    $f = Join-Path $env:TEMP ("fleet-sh-" + [guid]::NewGuid().ToString("N") + ".sh")
    # LF endings and no BOM: bash treats a CR as part of the command and chokes on a BOM.
    [System.IO.File]::WriteAllText($f, (($cmd -replace "`r`n", "`n") + "`n"),
        (New-Object System.Text.UTF8Encoding $false))
    $prevEAP = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'    # native stderr must never be a terminating error
    try {
        if ($script:useWsl) {
            $wf = (& wsl.exe wslpath -a "$f" 2>$null | Select-Object -First 1)
            return (& wsl.exe -e bash -l "$wf" 2>$null)
        }
        return (& $script:bash -l "$f" 2>$null)
    } finally {
        $ErrorActionPreference = $prevEAP
        Remove-Item $f -ErrorAction SilentlyContinue   # a cmdlet, so $LASTEXITCODE survives
    }
}

function Explain-Result ($code) {
    switch ($code) {
        0       { 'it worked' }
        267011  { 'has not run yet (not a failure)' }
        267009  { 'currently running' }
        3       { 'Git Bash or Python was not found on this PC' }
        4       { 'could not reach the ERP (network, or the PC slept)' }
        5       { 'the route build refused the roster' }
        6       { 'the roster was cut for the wrong week' }
        8       { 'the ERP refused the login - call IT' }
        9       { 'the ERP login API has changed - call IT' }
        10      { '.erp_key could not be read' }
        11      { 'the ERP server itself errored (5xx)' }
        default { 'see automation\logs\weekly-refresh.log' }
    }
}

# ---------------------------------------------------------------- -Status
if ($Status) {
    Write-Host ""
    Write-Host "Fleet dashboard weekly refresh - status" -ForegroundColor Cyan
    Write-Host "  repo : $Repo"
    $t = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if (-not $t) {
        Write-Host "  installed: NO - run this script with no arguments to install it."
    } else {
        $i = Get-ScheduledTaskInfo -TaskName $TaskName
        Write-Host "  installed  : yes"
        Write-Host "  state      : $($t.State)"
        Write-Host "  last run   : $($i.LastRunTime)"
        Write-Host ("  last result: 0x{0:X}  {1}" -f $i.LastTaskResult, (Explain-Result $i.LastTaskResult))
        Write-Host "  next run   : $($i.NextRunTime)"
    }
    if (Test-Path $LogPath) {
        Write-Host ""
        Write-Host "  last 20 log lines:" -ForegroundColor Cyan
        Get-Content $LogPath -Tail 20 | ForEach-Object { Write-Host "    $_" }
    } else {
        Write-Host "  log: not written yet ($LogPath)"
    }
    Write-Host ""
    exit 0
}

# ---------------------------------------------------------------- -Uninstall
if ($Uninstall) {
    foreach ($n in @($TaskName, $ProbeName)) {
        if (Get-ScheduledTask -TaskName $n -ErrorAction SilentlyContinue) {
            Unregister-ScheduledTask -TaskName $n -Confirm:$false
            Write-Host "Removed scheduled task: $n"
        }
    }
    Write-Host "Done. The dashboard and its data are untouched; only the schedule was removed."
    exit 0
}

# ---------------------------------------------------------------- preflight
Write-Host ""
Write-Host "Checking this PC can actually run the Monday job" -ForegroundColor Cyan
Write-Host "  repo: $Repo"
Write-Host ""

# 1. The repo path itself.
if ($Repo -like '\\*') {
    Say-Fail "The repo is on a network path ($Repo)."
    Say-Info "A scheduled task cannot reliably reach a UNC path. Copy the folder to a local disk."
} else {
    $drive = Get-PSDrive -Name $Repo.Substring(0,1) -ErrorAction SilentlyContinue
    if ($drive -and $drive.DisplayRoot) {
        Say-Fail "The repo is on a mapped network drive ($($drive.DisplayRoot))."
        Say-Info "Mapped drives do not exist for a scheduled task. Copy the folder to a local disk."
    } elseif ($Repo -match '^[A-Za-z]:\\(Program Files|Windows)') {
        Say-Fail "The repo is under Program Files or Windows."
        Say-Info "The job writes into its own folder and Windows will refuse. Move it to C:\fleet-dashboard."
    } elseif ($Repo -match '[&%^!"]') {
        Say-Fail "The repo path contains a character that breaks a scheduled task action: $Repo"
        Say-Info "Rename the folder so the path has only letters, numbers, spaces and dashes."
    } else {
        Say-Ok "Repo path is usable."
        if ($Repo.Length -gt 240) { Say-Warn "The path is very long ($($Repo.Length) chars); some tools cap at 260." }
        if ($Repo -match 'OneDrive') {
            Say-Warn "The repo is inside OneDrive."
            Say-Info "The job writes data\erp_live.json - about 48 MB of employee names, home"
            Say-Info "addresses and attendance - every week. OneDrive would upload all of it."
            Say-Info "Strongly consider moving the folder to C:\fleet-dashboard."
        }
    }
}

# 2. bash. Git Bash preferred; a real WSL distro accepted.
$bash = $null
# Build the candidate list WITHOUT Join-Path: it throws on a null -Path, and both
# ProgramW6432 and ProgramFiles(x86) are unset on 32-bit Windows, which would abort the
# installer before it had checked anything. 64-bit first - the old batch file tested
# ProgramFiles(x86) last but assigned unconditionally, so it silently won.
$roots = @($env:ProgramW6432, $env:ProgramFiles, ${env:ProgramFiles(x86)}) |
         Where-Object { $_ }
$candidates = @()
foreach ($r in $roots) { $candidates += ($r.TrimEnd('\') + '\Git\bin\bash.exe') }
if ($env:LocalAppData) { $candidates += ($env:LocalAppData.TrimEnd('\') + '\Programs\Git\bin\bash.exe') }
$candidates = @($candidates | Where-Object { Test-Path $_ })   # @() or a lone survivor unrolls to a string and += concatenates
$git = Get-Command git.exe -ErrorAction SilentlyContinue
if ($git) {
    $guess = Join-Path (Split-Path (Split-Path $git.Source -Parent) -Parent) 'bin\bash.exe'
    if (Test-Path $guess) { $candidates += $guess }
}
foreach ($c in $candidates) {
    # Prove it runs. Presence on disk is not the same as working.
    $out = & $c -lc 'echo ok' 2>$null
    if ($LASTEXITCODE -eq 0 -and $out -eq 'ok') { $bash = $c; $script:bash = $c; break }
}
$script:useWsl = $false
$script:bash = $bash
if ($bash) {
    Say-Ok "Git Bash: $bash"
} else {
    $wslOk = $false
    if (Get-Command wsl.exe -ErrorAction SilentlyContinue) {
        # wsl.exe ships on stock Win10/11 with no distro, so ask it to do something.
        $distros = & wsl.exe -l -q 2>$null
        if ($LASTEXITCODE -eq 0 -and ($distros | Where-Object { $_.Trim() })) {
            & wsl.exe -e true 2>$null | Out-Null
            if ($LASTEXITCODE -eq 0) { $wslOk = $true }
        }
    }
    if ($wslOk) { $script:useWsl = $true; Say-Ok "WSL with a working distro (no Git Bash found)." }
    else {
        Say-Fail "Neither Git Bash nor a working WSL distro is installed."
        Say-Info "Install Git for Windows, then run this script again:"
        Say-Info "  https://git-scm.com/download/win"
        Say-Info "Accept every default in the installer."
    }
}

# The two shells need DIFFERENT paths for the same folder, so this can only be worked out
# once the shell is known: Git Bash takes C:/fleet-dashboard, WSL needs /mnt/c/fleet-dashboard.
# It is then wrapped in bash single quotes at the probe and login steps, so an apostrophe in
# the path (C:\Users\O'Brien\...) would close that quote and break the line - escape it the
# POSIX way rather than banning the path.
$RepoSh = $Repo -replace '\\', '/'
if ($script:useWsl) {
    $w = (& wsl.exe -e wslpath -a "$Repo" 2>$null | Select-Object -First 1)
    if ($w) { $RepoSh = "$w".Trim() }
}
$RepoSh = $RepoSh -replace "'", "'\''"

# 3+4. python and curl, checked THROUGH bash - the shell the job will actually use.
#      Checking python from PowerShell is a false pass: Windows ships a zero-byte
#      WindowsApps\python.exe stub that opens the Store and does nothing, and
#      `command -v` in refresh_routes.sh would find exactly that.
if ($bash -or $useWsl) {
    $py = (Invoke-Sh 'command -v python3 || command -v python' | Select-Object -First 1)
    if ($py -match 'WindowsApps') {
        # The zero-byte Store alias. It is on PATH, so `command -v` finds it and
        # refresh_routes.sh would find it too - then the Monday job would fail at 04:00
        # having "found" a Python that only prints an advert.
        Say-Fail "The only python on this PC is the Microsoft Store placeholder, not a real Python."
        Say-Info "Two steps, both needed:"
        Say-Info "  1. Install Python 3: https://www.python.org/downloads/windows/"
        Say-Info "     On the FIRST screen of the installer, tick 'Add python.exe to PATH'."
        Say-Info "  2. Turn the placeholder off so it stops shadowing the real one:"
        Say-Info "     Settings > Apps > Advanced app settings > App execution aliases,"
        Say-Info "     then switch OFF both 'python.exe' and 'python3.exe'."
        Say-Info "Close and reopen PowerShell afterwards, then run this script again."
    } elseif (-not $py) {
        Say-Fail "No python3 on this PC (as seen from Git Bash)."
        Say-Info "Install Python 3 from https://www.python.org/downloads/windows/ and TICK"
        Say-Info "'Add python.exe to PATH' on the first screen of the installer."
    } else {
        # Same apostrophe escape as $RepoSh: $py is usually under C:\Users\<name>\AppData.
        $pySh = $py -replace "'", "'\''"
        $ver = (Invoke-Sh "'$pySh' -c 'import sys;print(sys.version_info[0])'")
        if ($ver -eq '3') { Say-Ok "Python 3: $py" }
        else {
            Say-Fail "'$py' is not a working Python 3 (it printed '$ver')."
            Say-Info "This is usually the Microsoft Store placeholder. Install real Python 3."
        }
    }
    Invoke-Sh 'command -v curl' | Out-Null
    if ($LASTEXITCODE -eq 0) { Say-Ok "curl present." } else { Say-Fail "curl is missing; the ERP fetch needs it." }

    # node is NOT used by the default Monday job - only by --rebuild-plans, which the
    # schedule does not pass. Never fail the install over it.
    Invoke-Sh 'command -v node' | Out-Null
    if ($LASTEXITCODE -eq 0) { Say-Ok "node present (only needed for --rebuild-plans)." }
    else { Say-Warn "node not found. Fine - the Monday job does not use it." }
}

# 6. .erp_key. Hardening, not the cause of any known failure. Contents are never printed.
$keyPath = Join-Path $Repo '.erp_key'
$keyHint = '  [System.IO.File]::WriteAllText("' + $Repo + '\.erp_key", ''{"Username":"USER","password":"PASS"}'')'
if (-not (Test-Path $keyPath)) {
    Say-Fail "This PC has no .erp_key, so the job cannot log in to the ERP."
    Say-Info "Create it with the line below - fill in the real username and password."
    Say-Info "Use exactly this command: PowerShell's > and Out-File write UTF-16, which"
    Say-Info "nothing in the pipeline can read."
    Say-Info ""
    Say-Info $keyHint
} else {
    $bytes = [System.IO.File]::ReadAllBytes($keyPath)
    if ($bytes.Length -ge 2 -and (($bytes[0] -eq 0xFF -and $bytes[1] -eq 0xFE) -or ($bytes[0] -eq 0xFE -and $bytes[1] -eq 0xFF))) {
        Say-Fail ".erp_key is a UTF-16 file and cannot be read by the pipeline."
        Say-Info "This is what PowerShell's > and Out-File produce. Rewrite it with:"
        Say-Info $keyHint
    } else {
        if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) {
            Say-Warn ".erp_key starts with a UTF-8 BOM. It is tolerated, but WriteAllText avoids it."
        }
        try {
            $k = (Get-Content $keyPath -Raw) -replace "^\uFEFF", '' | ConvertFrom-Json
            $u = $k.Username; if (-not $u) { $u = $k.UserName }; if (-not $u) { $u = $k.username }; if (-not $u) { $u = $k.user }
            $w = $k.Password; if (-not $w) { $w = $k.password }; if (-not $w) { $w = $k.pass }
            if ($u -and $w) { Say-Ok ".erp_key parses and has both fields." }
            else {
                $missing = @(); if (-not $u) { $missing += 'username' }; if (-not $w) { $missing += 'password' }
                Say-Fail (".erp_key is missing: " + ($missing -join ' and '))
            }
        } catch {
            Say-Fail ".erp_key is not valid JSON."
            Say-Info "It must be one line, exactly like this:"
            Say-Info $keyHint
        }
    }
}

# 7. Folders and free space. The ERP dump is ~48 MB and is replaced via a staging swap,
#    so the transient peak is roughly double.
foreach ($d in @('automation\logs', 'automation\last-good', 'data')) {
    New-Item -ItemType Directory -Force -Path (Join-Path $Repo $d) | Out-Null
}
try {
    $free = (Get-PSDrive -Name $Repo.Substring(0,1)).Free / 1MB
    if ($free -lt 150) { Say-Fail ("Only {0:N0} MB free on {1}: - the ERP dump alone is ~48 MB." -f $free, $Repo.Substring(0,1)) }
    else { Say-Ok ("Disk space: {0:N0} MB free." -f $free) }
} catch { Say-Warn "Could not read free disk space." }

if ($script:Failed) {
    Write-Host ""
    Write-Host "*** PREFLIGHT FAILED - nothing has been scheduled. ***" -ForegroundColor Red
    Write-Host "Fix the FAIL line(s) above and run this script again." -ForegroundColor Red
    Write-Host ""
    exit 1
}

# ---------------------------------------------------------------- the prove-it probe
# Everything above tested what THIS PowerShell session can do. The job will run as a
# scheduled task, which is not the same thing. So run the real check through Task
# Scheduler, with the same principal, before promising anything.
Write-Host ""
Write-Host "Probing through Task Scheduler (this is the check that matters)" -ForegroundColor Cyan

$probeOut = Join-Path $env:TEMP 'fleet-probe.out'
$probeCmd = Join-Path $env:TEMP 'fleet-probe.cmd'
$probeSh  = Join-Path $env:TEMP 'fleet-probe.sh'
Remove-Item $probeOut -ErrorAction SilentlyContinue

# A script FILE, not a nested -c string: quoting a shell command inside a cmd line inside a
# scheduled-task argument is where these probes usually break, silently.
$shBody = "cd '$RepoSh' || { echo BLOCKED-CD; exit 1; }" + "`n" +
          'echo "cwd=$(pwd)"' + "`n" +
          "head -c1 refresh_routes.sh >/dev/null 2>&1 && echo REACHABLE || echo BLOCKED-READ" + "`n"
[System.IO.File]::WriteAllText($probeSh, $shBody.Replace("`r`n", "`n"), (New-Object System.Text.UTF8Encoding $false))

if ($useWsl) {
    $shWsl = (& wsl.exe wslpath "$probeSh") 2>$null
    $cmdBody = "@echo off`r`nwsl.exe -e bash `"$shWsl`"`r`n"
} else {
    $cmdBody = "@echo off`r`n`"$bash`" `"$probeSh`"`r`n"
}
# cmd.exe decodes this file using the SYSTEM OEM code page, so read that from the registry
# rather than the user's regional-format locale - the two differ whenever someone changes
# date format without changing system locale. ::ASCII is not an option: it is a lossy
# ENCODER and would turn an accented character in the path into a literal '?'.
# Two traps guarded below:
#   - locales with no legacy OEM page (hi-IN, ta-IN, mr-IN and friends - i.e. exactly the
#     region this PC is in) report the CP_OEMCP sentinel 1, and GetEncoding(1) throws;
#   - GetEncoding(65001), which is what Windows reports once the "Use Unicode UTF-8" beta
#     option is on, carries a BOM preamble that cmd.exe does not strip - it would try to
#     run "<junk>@echo off" and leave command echoing on for the whole file.
$oemCp = 437
try { $oemCp = [int](Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\Nls\CodePage' -Name OEMCP -ErrorAction Stop).OEMCP } catch { }
if ($oemCp -le 1) { $oemCp = 437 }
if ($oemCp -eq 65001) { $oemEnc = New-Object System.Text.UTF8Encoding $false }
else {
    try { $oemEnc = [System.Text.Encoding]::GetEncoding($oemCp) }
    catch { $oemEnc = [System.Text.Encoding]::GetEncoding(437) }
}
[System.IO.File]::WriteAllText($probeCmd, $cmdBody, $oemEnc)

$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
$probeAction = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument "/c `"`"$probeCmd`" > `"$probeOut`" 2>&1`"" -WorkingDirectory $Repo
try {
    Register-ScheduledTask -TaskName $ProbeName -Action $probeAction -Principal $principal -Force | Out-Null
} catch {
    Write-Host "  FAIL  Windows refused to create even a test task." -ForegroundColor Red
    Say-Info "Message: $($_.Exception.Message)"
    Say-Info "Some company policies block this. Try running PowerShell as Administrator once."
    exit 1
}
Start-ScheduledTask -TaskName $ProbeName
$deadline = (Get-Date).AddSeconds(60)
do {
    Start-Sleep -Milliseconds 700
    $r = (Get-ScheduledTaskInfo -TaskName $ProbeName).LastTaskResult
} while ((Get-Date) -lt $deadline -and ($r -eq 267009 -or $r -eq 267011))   # 0x41301 running, 0x41303 never run
$probeText = ''
if (Test-Path $probeOut) { $probeText = (Get-Content $probeOut -Raw) }
Unregister-ScheduledTask -TaskName $ProbeName -Confirm:$false
Remove-Item $probeCmd, $probeSh, $probeOut -ErrorAction SilentlyContinue

if ($probeText -notmatch 'REACHABLE') {
    Write-Host "  FAIL  A scheduled task on this PC could not read the repo." -ForegroundColor Red
    Say-Info ("Probe said: " + $probeText.Trim())
    Say-Info "Nothing has been scheduled. Usual cause: the folder is on a network or"
    Say-Info "removable drive, or in a location this account cannot reach unattended."
    exit 1
}
Say-Ok "A scheduled task can reach the repo and run bash."

# ---------------------------------------------------------------- optional login test
if (-not $SkipLoginTest) {
    Write-Host ""
    Write-Host "Testing the ERP login (fetches nothing, writes nothing)" -ForegroundColor Cyan
    $loginOut = Invoke-Sh "cd '$RepoSh' && ./refresh_routes.sh --check-login 2>&1"
    $loginRc = $LASTEXITCODE
    if ($loginRc -eq 0) { Say-Ok "The ERP accepted the login." }
    else {
        Say-Warn "The login did not succeed (exit $loginRc). Installing the schedule anyway."
        ($loginOut | Select-Object -Last 6) | ForEach-Object { Say-Info $_ }
        switch ($loginRc) {
            4  { Say-Info "=> This PC is probably not on the factory network right now." }
            8  { Say-Info "=> The ERP refused the account. Call IT." }
            10 { Say-Info "=> .erp_key could not be read." }
            11 { Say-Info "=> The ERP server is erroring. Try later." }
        }
    }
}

# ---------------------------------------------------------------- register
$action = New-ScheduledTaskAction -Execute (Join-Path $Repo 'automation\weekly-refresh.bat') -WorkingDirectory $Repo
$trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday -At '15:30'
# StartWhenAvailable is the whole point: it is the Windows equivalent of launchd running a
# missed job on wake. schtasks.exe cannot express it, which is why this script exists rather
# than a one-line schtasks command. The battery switches are not optional either - both
# default the wrong way, and the default would kill the job mid-run on a laptop.
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -WakeToRun `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Hours 3) -MultipleInstances IgnoreNew `
    -RestartCount 2 -RestartInterval (New-TimeSpan -Minutes 30)
try {
    Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
        -Settings $settings -Principal $principal -Force | Out-Null
} catch {
    Write-Host "  FAIL  Could not register the task: $($_.Exception.Message)" -ForegroundColor Red
    Say-Info "If this says Access Denied, run PowerShell as Administrator once and retry."
    exit 1
}

# WakeToRun is a request, not a guarantee: it does nothing if wake timers are off.
try {
    $wt = (& powercfg /waketimers) 2>$null | Out-String
    if ($wt -match 'disabled|are not enabled') {
        Say-Warn "Wake timers are disabled on this PC, so it will not wake itself at 15:30."
        Say-Info "It will still run at the next start-up. To allow waking (needs Administrator):"
        Say-Info "  powercfg /SETACVALUEINDEX SCHEME_CURRENT SUB_SLEEP RTCWAKE 1"
        Say-Info "  powercfg /SETACTIVE SCHEME_CURRENT"
    }
} catch { }

$info = Get-ScheduledTaskInfo -TaskName $TaskName
$bashShown = $bash
if ($useWsl) { $bashShown = 'WSL' }
Write-Host ""
Write-Host "Installed: $TaskName" -ForegroundColor Green
Write-Host "  repo    : $Repo"
Write-Host "  bash    : $bashShown"
Write-Host "  schedule: Mondays 15:30 (runs at the next start-up if the PC was off)"
Write-Host "  next run: $($info.NextRunTime)"
Write-Host "  log     : $LogPath"
Write-Host ""
Write-Host "This job runs as YOU, so:" -ForegroundColor Cyan
Write-Host "  - The PC must be signed in on Monday afternoon. Locking the screen is fine."
Write-Host "  - Do not sign out, and do not shut down."
Write-Host "  - A black window opens at 15:30 and stays for 30-45 minutes. That is the"
Write-Host "    refresh working. It is NOT the dashboard window - leave both alone."
Write-Host ""
Write-Host "Run it once now, to prove it end to end (takes 30-45 minutes):" -ForegroundColor Cyan
Write-Host "  Start-ScheduledTask -TaskName ""$TaskName"""
Write-Host "  Get-Content ""$LogPath"" -Tail 20 -Wait"
Write-Host ""
Write-Host "Later:  -Status to check it, -Uninstall to remove it." -ForegroundColor DarkGray
Write-Host ""
