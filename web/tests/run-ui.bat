@echo off
chcp 65001 >nul
cd /d "%~dp0.."
set "PATH=%~dp0bin;%PATH%"

echo.
echo  =======================================================
echo   Sanguine System -- UI Selenium (Chrome)
echo  =======================================================
echo  Requirements: Chrome must be installed
echo   Local ChromeDriver from tests\bin is used when available.
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
echo  Report: web\tests\report-ui.html
echo.

pause
exit /b %CODE%
