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
) else (
    echo  [OK]  All tests passed
)
echo  Report: web\tests\report.html
echo.

pause
exit /b %CODE%
