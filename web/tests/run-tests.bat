@echo off
chcp 65001 >nul
cd /d "%~dp0.."

echo.
echo  =======================================================
echo   Sanguine System -- Unit + API + E2E (offline)
echo   AI generation is mocked: no API keys, no network, no cost.
echo  =======================================================
echo.

call npm run test:all

set CODE=%errorlevel%

echo.
if %CODE% neq 0 (
    echo  [FAILED]  exit code %CODE%
    echo  Report: web\tests\report.html
    echo.
    pause
    exit /b %CODE%
)

echo  [OK]  Unit + API + E2E passed
echo  Report: web\tests\report.html
echo.
echo  =======================================================
echo   UI (Selenium/Chrome, headless)
echo  =======================================================
echo.

set HEADLESS=1
call npm run test:ui

set CODE=%errorlevel%

echo.
if %CODE% neq 0 (
    echo  [FAILED]  UI tests, exit code %CODE%
) else (
    echo  [OK]  All tests passed
)
echo.

pause
exit /b %CODE%
