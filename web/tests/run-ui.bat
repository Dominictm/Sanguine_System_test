@echo off
chcp 65001 >nul
cd /d "%~dp0.."

echo.
echo  =======================================================
echo   Sanguine System -- UI Selenium (Chrome)
echo  =======================================================
echo  Requirements: Chrome must be installed
echo   (ChromeDriver is fetched automatically by Selenium Manager).
echo  Set HEADLESS=1 to run without a browser window.
echo.

call npm run test:ui

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
