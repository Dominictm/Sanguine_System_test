@echo off
chcp 866 > nul
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
choice /C YN /M "��⠭����� Node.js ��⮬���᪨?"
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

echo   Installing Node.js (a UAC prompt may appear)...
msiexec /i "%TEMP%\node-installer.msi" /qn /norestart
if %errorlevel% neq 0 (
    echo   ERROR: Node.js installation failed.
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

rem --- �஢�ઠ ������ Git ----------------------------------
where git > nul 2>&1
if %errorlevel% neq 0 goto git_missing
goto git_ok

:git_missing
echo   Git �� ������.
echo.
choice /C YN /M "��⠭����� Git ��⮬���᪨ �१ winget?"
if errorlevel 2 goto git_manual
if errorlevel 1 goto git_autoinstall

:git_manual
echo.
echo   ��⠭���� Git ������: https://git-scm.com/download/win
echo   ��⥬ ������� start.bat ��� ࠧ.
echo.
pause
exit /b 1

:git_autoinstall
where winget > nul 2>&1
if %errorlevel% neq 0 (
    echo   winget ������㯥� �� �⮩ ��⥬�.
    echo   ��⠭���� Git ������: https://git-scm.com/download/win
    pause
    exit /b 1
)
echo   ��⠭������� Git (����� ������ ����� UAC)...
winget install --id Git.Git -e --source winget --accept-package-agreements --accept-source-agreements
rem ������� ᢥ����⠭������� git ������ � ⥪�饩 ��ᨨ ��� ��१���᪠.
set PATH=%PATH%;%ProgramFiles%\Git\cmd
where git > nul 2>&1
if %errorlevel% neq 0 (
    echo   Git ��⠭�����, �� �� ����� � �⮩ ��ᨨ.
    echo   ��१������ start.bat ��� �ନ���.
    pause
    exit /b 1
)
echo   Git ��⠭����� �ᯥ譮.
echo.

:git_ok

netstat -ano 2>nul | find "LISTENING" | find ":3000" > nul
if %errorlevel% == 0 (
    echo   Server already running at http://localhost:3000
    start http://localhost:3000
    echo.
    pause
    exit /b 0
)

cd /d "%~dp0web"

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
pause

