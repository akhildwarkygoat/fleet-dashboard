@echo off
REM ===========================================================================
REM  weekly-refresh.bat - the Monday job, for the factory Windows PC.
REM
REM  WHY MONDAY: Rotational's three slots step one place every Monday
REM    (Day -> Full night -> Half night -> Day)
REM  so from Monday morning last week's roster mislabels roughly everyone who
REM  rotates, and build_erp_routes.py refuses to emit a split it knows is stale.
REM
REM  Writes files only - it never touches git.
REM
REM  DO NOT register this by hand. Run the installer instead - it checks that
REM  the job can actually run before it schedules anything:
REM
REM    powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-windows.ps1"
REM
REM  No Administrator rights are needed.
REM
REM  This wrapper is deliberately THIN. All the real logic - the log, the trim,
REM  the pre-run snapshot, the rollback on failure, the read-back of the service
REM  split - lives in weekly-refresh.sh, so the Mac and the Windows PC run the
REM  same code and only the launcher differs. Its only job is to find a bash.
REM
REM  refresh_routes.sh and weekly-refresh.sh are bash scripts, so this box needs
REM  Git for Windows (Git Bash) or WSL. Both are checked for below.
REM ===========================================================================
setlocal
set "REPO=%~dp0.."
set "LOGDIR=%~dp0logs"
if not exist "%LOGDIR%" mkdir "%LOGDIR%"
set "LOG=%LOGDIR%\weekly-refresh.log"

REM -- Find a 64-bit Git Bash first. The old order tested ProgramFiles(x86) LAST
REM -- but assigned unconditionally, so it overwrote the 64-bit hit on any PC
REM -- that had both and silently ran the 32-bit build.
set "BASH="
if exist "%ProgramW6432%\Git\bin\bash.exe"          set "BASH=%ProgramW6432%\Git\bin\bash.exe"
if not defined BASH if exist "%ProgramFiles%\Git\bin\bash.exe"              set "BASH=%ProgramFiles%\Git\bin\bash.exe"
if not defined BASH if exist "%LocalAppData%\Programs\Git\bin\bash.exe"     set "BASH=%LocalAppData%\Programs\Git\bin\bash.exe"
if not defined BASH if exist "%ProgramFiles(x86)%\Git\bin\bash.exe"         set "BASH=%ProgramFiles(x86)%\Git\bin\bash.exe"

if defined BASH goto :run

REM -- No Git Bash. Try WSL, but test it properly: wsl.exe ships on stock
REM -- Win10 1903+ and Win11 with NO distro installed, so `where wsl` is a
REM -- false positive that would send the job into a machine that cannot run it.
REM -- Test "not zero", not "errorlevel 1": wsl.exe returns -1 (0xFFFFFFFF) for its own
REM -- failures and cmd compares ERRORLEVEL as SIGNED, so `if errorlevel 1` is FALSE for -1
REM -- and a broken WSL would sail through as working.
where wsl >nul 2>&1
if not "%ERRORLEVEL%"=="0" goto :nobash
wsl.exe -l -q >nul 2>&1
if not "%ERRORLEVEL%"=="0" goto :nobash
wsl.exe -e true >nul 2>&1
if not "%ERRORLEVEL%"=="0" goto :nobash

for /f "usebackq delims=" %%P in (`wsl.exe wslpath "%~dp0weekly-refresh.sh"`) do set "WPATH=%%P"
echo [%DATE% %TIME%] launching via WSL >> "%LOG%"
REM -- `wsl -e bash <script>` needs neither the exec bit nor a shebang lookup,
REM -- unlike invoking ./weekly-refresh.sh directly.
wsl.exe -e bash "%WPATH%"
set "RC=%ERRORLEVEL%"
goto :done

:nobash
echo [%DATE% %TIME%] FAILED - neither Git Bash nor a working WSL distro was found. >> "%LOG%"
echo   Install Git for Windows ^(https://git-scm.com/download/win^), then re-run  >> "%LOG%"
echo   automation\install-windows.ps1 to re-check.                               >> "%LOG%"
exit /b 3

:run
echo [%DATE% %TIME%] launching via %BASH% >> "%LOG%"
"%BASH%" "%~dp0weekly-refresh.sh"
REM -- Capture ERRORLEVEL on the very next line. Do NOT switch to delayed
REM -- expansion and !ERRORLEVEL! further down: by then the echoes below have
REM -- overwritten it, so a failed log write would rewrite exit 4 as exit 1.
set "RC=%ERRORLEVEL%"

:done
if not "%RC%"=="0" (
  echo [%DATE% %TIME%] launcher: weekly-refresh.sh exited %RC% - see the lines above for the cause. >> "%LOG%"
  exit /b %RC%
)
exit /b 0
