@echo off
cd /d "%~dp0"

echo.
echo  =============================================
echo   Sanguine System - stop server
echo  =============================================
echo.

set FOUND=0
for /f "tokens=5" %%P in ('netstat -ano 2^>nul ^| find "LISTENING" ^| find ":3000"') do (
    set FOUND=1
    echo   Stopping process PID %%P on port 3000...
    taskkill /PID %%P /T /F >nul 2>&1
)

if "%FOUND%"=="0" (
    echo   Server on port 3000 is not running.
) else (
    echo   Server stopped.
)

echo.
pause
