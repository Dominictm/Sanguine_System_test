@echo off
chcp 65001 >nul
cd /d "%~dp0.."

echo.
echo  =======================================================
echo   Sanguine System -- Unit + API + E2E (110 tests)
echo  =======================================================
echo.

node --test --test-reporter=spec --test-reporter-destination=stdout --test-reporter=./tests/reporter.js --test-reporter-destination=nul tests/all.test.js tests/e2e.test.js

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
