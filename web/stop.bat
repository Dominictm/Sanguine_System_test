@echo off
cd /d "%~dp0"

echo.
echo  =============================================
echo   VTM Chronicle Manager - Stop Server
echo  =============================================
echo.

for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| find "LISTENING" ^| find ":3000"') do set PID=%%a

if not defined PID (
    echo   Server is not running.
    echo.
    pause
    exit /b 0
)

echo   Stopping PID %PID%...
taskkill /PID %PID% /F > nul 2>&1

if %errorlevel% == 0 (
    echo   Server stopped.
) else (
    echo   Could not stop process %PID%.
    echo   Close the VTM Chronicle Manager window manually.
)

echo.
pause
