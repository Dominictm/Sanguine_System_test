@echo off
rem ============================================================
rem  Sanguine System - update old scenario.md files to the
rem  current 3-block format (Prologue / Scene N / Finale).
rem
rem  Always runs a dry-run first and asks before writing anything.
rem  See docs/guide.md, section 21 "Обслуживание".
rem ============================================================

rem UTF-8 codepage: the Node script below prints in Russian; without this
rem cmd.exe renders it as mojibake on a Russian-locale Windows (cp866).
rem Own text of this .bat stays English, like start.bat / update.bat / stop.bat.
chcp 65001 > nul
cd /d "%~dp0"

echo.
echo  =============================================
echo   Sanguine System - scenario format update
echo  =============================================
echo.

where node > nul 2>&1
if %errorlevel% neq 0 goto node_missing

echo  Step 1 of 2: checking what would change (nothing is written yet).
echo.

node tools\migrate_old_scenario_format.js
if %errorlevel% neq 0 goto fail

echo.
echo  Nothing has been written yet. Review the list above.
echo.
choice /C YN /M "Apply these changes"
if errorlevel 2 goto cancelled
if errorlevel 1 goto apply

:apply
echo.
echo  Step 2 of 2: applying...
echo.
node tools\migrate_old_scenario_format.js --apply
if %errorlevel% neq 0 goto fail
echo.
echo  Done. Old scenarios now match the current format.
goto end

:cancelled
echo.
echo  Cancelled - no files were changed.
goto end

:node_missing
echo  Node.js not found. Run start.bat once - it installs Node.js.
goto end

:fail
echo.
echo  Error while running the migration. Check the output above.

:end
echo.
pause
