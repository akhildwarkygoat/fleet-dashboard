@echo off
title Fleet Dashboard - keep this window open
rem Run from the folder this file lives in
cd /d "%~dp0"

echo Starting the Fleet Dashboard...
echo (Keep this black window open - closing it stops the dashboard)
echo.

rem Open the browser after a short head start for the server
start "" cmd /c "timeout /t 4 >nul & start http://localhost:5173"

call npm run dev

echo.
echo The dashboard stopped. If this was unexpected, take a photo of this window.
pause
