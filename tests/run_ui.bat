@echo off
cd /d "%~dp0"
chcp 65001 > nul

echo.
echo  =============================================
echo   VTM — UI-тесты (Selenium, видимый Chrome)
echo  =============================================
echo.
echo   Требование: Google Chrome установлен.
echo   Отчёт: tests\report_ui.html
echo.

where node > nul 2>&1
if %errorlevel% neq 0 ( echo   ОШИБКА: Node.js не найден. & pause & exit /b 1 )

if not exist "node_modules\selenium-webdriver\" (
    echo   Устанавливаю зависимости...
    call npm install
    echo.
)

call node ui_selenium.js
set RESULT=%errorlevel%

echo.
if %RESULT%==0 ( echo   ПРОЙДЕНО ) else ( echo   ЕСТЬ ПАДЕНИЯ )
echo.
pause
exit /b %RESULT%
