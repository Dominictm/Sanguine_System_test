@echo off
cd /d "%~dp0"
chcp 65001 > nul

echo.
echo  =============================================
echo   VTM — E2E автотест (API + файловая система)
echo  =============================================
echo.
echo   Без браузера. Создаёт одноразовый город и убирает.
echo   Отчёт: tests\report_e2e.html
echo.

where node > nul 2>&1
if %errorlevel% neq 0 ( echo   ОШИБКА: Node.js не найден. & pause & exit /b 1 )

call node e2e.js
set RESULT=%errorlevel%

echo.
if %RESULT%==0 ( echo   ПРОЙДЕНО ) else ( echo   ЕСТЬ ПАДЕНИЯ )
echo.
pause
exit /b %RESULT%
