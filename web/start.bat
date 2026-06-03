@echo off
cd /d "%~dp0"

echo.
echo  =============================================
echo   VTM Chronicle Manager
echo  =============================================
echo.

where node > nul 2>&1
if %errorlevel% neq 0 (
    echo   ERROR: Node.js not found. Install from https://nodejs.org
    echo.
    pause
    exit /b 1
)

netstat -ano 2>nul | find "LISTENING" | find ":3000" > nul
if %errorlevel% == 0 (
    echo   Server already running at http://localhost:3000
    start http://localhost:3000
    echo.
    pause
    exit /b 0
)

if not exist "node_modules\" (
    echo   Installing dependencies...
    call npm install
    if %errorlevel% neq 0 (
        echo   ERROR: npm install failed.
        pause
        exit /b 1
    )
    echo   Done.
    echo.
)

start /B cmd /c "timeout /t 2 /nobreak > nul & start http://localhost:3000"

echo   Server started: http://localhost:3000
echo   Close this window to stop the server.
echo.

node server.js

echo.
echo   Server stopped (code: %errorlevel%).
echo.
pause
