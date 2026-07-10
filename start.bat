@echo off
cd /d "%~dp0"

echo.
echo  =============================================
echo   Sanguine System
echo  =============================================
echo.

where node > nul 2>&1
if %errorlevel% neq 0 goto node_missing
goto node_ok

:node_missing
echo   Node.js not found.
echo.
choice /C YN /M "Install Node.js automatically?"
if errorlevel 2 goto node_manual
if errorlevel 1 goto node_autoinstall

:node_manual
echo   Install from https://nodejs.org
echo.
pause
exit /b 1

:node_autoinstall
rem Pinned LTS version - update periodically (this .bat can't safely resolve "latest LTS").
set NODE_VERSION=22.13.0
set ARCH=x64
if /I "%PROCESSOR_ARCHITECTURE%"=="ARM64" set ARCH=arm64

echo   Downloading Node.js v%NODE_VERSION% (%ARCH%)...
powershell -NoProfile -Command "Invoke-WebRequest -Uri 'https://nodejs.org/dist/v%NODE_VERSION%/node-v%NODE_VERSION%-%ARCH%.msi' -OutFile '%TEMP%\node-installer.msi'"
if %errorlevel% neq 0 (
    echo   ERROR: Download failed.
    pause
    exit /b 1
)

rem msiexec needs administrator rights to install Node.js machine-wide. Running
rem it directly under /qn (silent) with a non-elevated parent process just fails
rem outright instead of asking - so we force an explicit UAC prompt here via
rem PowerShell's Start-Process -Verb RunAs, and always return a real numeric
rem exit code to this .bat even if the user declines the prompt (which throws
rem a PowerShell exception rather than setting a plain exit code).
echo   Installing Node.js (a Windows administrator prompt will appear - please accept it)...
powershell -NoProfile -Command "try { $p = Start-Process msiexec.exe -ArgumentList '/i','\"%TEMP%\node-installer.msi\"','/qn','/norestart' -Verb RunAs -Wait -PassThru; exit $p.ExitCode } catch { exit 1 }"
if %errorlevel% neq 0 (
    echo   ERROR: Node.js installation failed (exit code %errorlevel%^).
    echo   This usually means the administrator prompt was declined or blocked
    echo   by system policy. Please install Node.js manually from
    echo   https://nodejs.org and run this script again.
    del /q "%TEMP%\node-installer.msi" > nul 2>&1
    pause
    exit /b 1
)
del /q "%TEMP%\node-installer.msi" > nul 2>&1

rem Make the freshly installed node visible in this session without restarting the terminal.
set PATH=%PATH%;%ProgramFiles%\nodejs\

where node > nul 2>&1
if %errorlevel% neq 0 (
    echo   ERROR: Node.js was installed but is not visible in this session.
    echo   Please restart start.bat or your terminal and try again.
    pause
    exit /b 1
)
echo   Node.js installed successfully.
echo.

:node_ok

rem --- Check for Git -------------------------------------------
where git > nul 2>&1
if %errorlevel% neq 0 goto git_missing
goto git_ok

:git_missing
echo   Git not found.
echo.
choice /C YN /M "Install Git automatically via winget?"
if errorlevel 2 goto git_manual
if errorlevel 1 goto git_autoinstall

:git_manual
echo.
echo   Install Git manually: https://git-scm.com/download/win
echo   Then run start.bat again.
echo.
pause
exit /b 1

:git_autoinstall
where winget > nul 2>&1
if %errorlevel% neq 0 (
    echo   winget is not available on this system.
    echo   Install Git manually: https://git-scm.com/download/win
    pause
    exit /b 1
)
echo   Installing Git (a Windows administrator prompt may appear)...
winget install --id Git.Git -e --source winget --accept-package-agreements --accept-source-agreements
rem Make the freshly installed git visible in this session without restarting the terminal.
set PATH=%PATH%;%ProgramFiles%\Git\cmd
where git > nul 2>&1
if %errorlevel% neq 0 (
    echo   Git was installed but is not visible in this session.
    echo   Please restart start.bat or your terminal and try again.
    pause
    exit /b 1
)
echo   Git installed successfully.
echo.

:git_ok

netstat -ano 2>nul | find "LISTENING" | find ":4295" > nul
if %errorlevel% == 0 (
    echo   Server already running at http://localhost:4295
    start http://localhost:4295
    echo.
    pause
    exit /b 0
)

cd /d "%~dp0web"

rem npm skips reinstall work when package.json/lock haven't changed, so it's
rem safe (and fast) to always run this - not just when node_modules is missing.
rem Otherwise, after `update.bat` pulls a package.json with a new dependency,
rem an existing node_modules\ (from before the update) would silently stay
rem stale and the server would crash with MODULE_NOT_FOUND on startup.
echo   Checking dependencies...
call npm install
if %errorlevel% neq 0 (
    echo   ERROR: npm install failed.
    pause
    exit /b 1
)
echo.

start /B cmd /c "timeout /t 2 /nobreak > nul & start http://localhost:4295"

echo   Server started: http://localhost:4295
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
pause
