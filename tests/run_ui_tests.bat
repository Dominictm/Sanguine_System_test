@echo off
chcp 65001 >nul
title VTM UI Tests (Selenium)
cd /d "%~dp0"

if not exist node_modules (
    echo Installing selenium-webdriver...
    call npm install
    echo.
)

node ui_tests.js
set CODE=%ERRORLEVEL%

echo.
if %CODE%==0 (
    echo All UI tests passed.
) else (
    echo UI tests failed. See tests\ui_report.html
)

echo.
set /p OPEN=Open UI report in browser? [Y/N]:
if /i "%OPEN%"=="y" (
    start "" "ui_report.html"
)

pause
