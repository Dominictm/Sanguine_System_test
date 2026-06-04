@echo off
chcp 65001 >nul
title VTM Tests
cd /d "%~dp0"

if not exist node_modules (
    echo Installing dependencies...
    call npm install
    echo.
)

cd /d "%~dp0.."
node tests\run_all_tests.js
set CODE=%ERRORLEVEL%

echo.
if %CODE%==0 (
    echo All tests passed.
) else (
    echo Tests failed. See tests\report_all.html
)

echo.
set /p OPEN=Open report in browser? [Y/N]:
if /i "%OPEN%"=="y" (
    start "" "tests\report_all.html"
)

pause
