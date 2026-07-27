@echo off
title Fleet Dashboard - keep this window open
rem Run from the folder this file lives in
cd /d "%~dp0"

echo Starting the Fleet Dashboard...
echo (Keep this black window open - closing it stops the dashboard)
echo.

rem Install any packages this version needs. A "git pull" that adds a dependency
rem leaves the old node_modules behind, and the dashboard then refuses to start
rem with "Failed to resolve import". This is a quick no-op when nothing changed.
echo Checking for updates...
call npm install --no-audit --no-fund --loglevel=error
if errorlevel 1 (
  echo.
  echo Could not check for updates - carrying on with what is already installed.
  echo If the dashboard fails to start, connect to the internet and run this file again.
  echo.
)

rem Let Vite open the browser itself. It picks the next free port when 5173 is
rem taken, so a hard-coded http://localhost:5173 here would land on a blank page
rem (or somebody else's server) instead of the dashboard.
call npm run dev -- --open

echo.
echo The dashboard stopped. If this was unexpected, take a photo of this window.
pause
