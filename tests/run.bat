@echo off
cd /d "%~dp0"
chcp 65001 > nul

echo.
echo  =============================================
echo   VTM Chronicle Manager — Автотесты
echo  =============================================
echo.

where node > nul 2>&1
if %errorlevel% neq 0 ( echo   ОШИБКА: Node.js не найден. & pause & exit /b 1 )

if not exist "node_modules\selenium-webdriver\" (
    echo   Устанавливаю зависимости тестов...
    call npm install
    echo.
)

echo  --- E2E (API + файловая система) ---
call node e2e.js
set E2E=%errorlevel%
echo.

echo  --- UI (Selenium, видимый Chrome) ---
echo   Для запуска без окна: set HEADLESS=1 перед запуском.
call node ui_selenium.js
set UI=%errorlevel%
echo.

echo  =============================================
if %E2E%==0 ( echo   E2E: ПРОЙДЕНО ) else ( echo   E2E: ПАДЕНИЯ )
if %UI%==0  ( echo   UI:  ПРОЙДЕНО ) else ( echo   UI:  ПАДЕНИЯ )
echo   Отчёты: tests\report_e2e.html, tests\report_ui.html
echo  =============================================
echo.
pause
