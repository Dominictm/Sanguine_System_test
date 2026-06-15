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

rem Default Claude model for web prose generation (override per-run in the UI dropdown).
rem Options: sonnet (cheaper), opus (best), haiku (cheapest). Empty = session default.
set CLAUDE_MODEL=sonnet
echo   Claude model (web prose): %CLAUDE_MODEL%

rem Default city for the web UI (this is the Paris campaign branch).
set CITY=paris
echo   Default city: %CITY%
echo.

node wrapper.js

echo.
echo   Server stopped (code: %errorlevel%).
echo.

