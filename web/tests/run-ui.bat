@echo off
chcp 65001 >nul
cd /d "%~dp0.."

echo.
echo  =======================================================
echo   VTM Chronicle Manager -- UI Selenium (Chrome)
echo  =======================================================
echo.
echo  Requirements: Chrome must be installed.
echo  Set HEADLESS=1 to run without a browser window.
echo.

node --test --test-reporter=spec --test-reporter-destination=stdout --test-reporter=./tests/reporter.js --test-reporter-destination=nul tests/ui.test.js

set CODE=%errorlevel%

echo.
if %CODE% neq 0 (
    echo  [FAILED]  exit code %CODE%
) else (
    echo  [OK]  All UI tests passed
)
echo  Report: web\tests\report.html
echo.

pause
exit /b %CODE%
