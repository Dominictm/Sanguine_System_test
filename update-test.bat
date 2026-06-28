@echo off
chcp 65001 > nul
cd /d "%~dp0"

rem ============================================================
rem  Sanguine System - загрузка/обновление тестовой версии
rem  Источник: ветка "test" репозитория на GitHub.
rem ============================================================

set REPO_URL=https://github.com/Dominictm/Sanguine_System.git
set BRANCH=test
set CLONE_DIR=Sanguine_System

echo.
echo  =============================================
echo   Sanguine System - обновление (ветка %BRANCH%)
echo  =============================================
echo.

rem --- 1. Проверка наличия Git -------------------------------
where git > nul 2>&1
if %errorlevel% neq 0 goto git_missing
goto git_ok

:git_missing
echo   Git не найден.
echo.
choice /C YN /M "Установить Git автоматически через winget?"
if errorlevel 2 goto git_manual
if errorlevel 1 goto git_autoinstall

:git_manual
echo.
echo   Установите Git вручную: https://git-scm.com/download/win
echo   Затем запустите update-test.bat ещё раз.
echo.
pause
exit /b 1

:git_autoinstall
where winget > nul 2>&1
if %errorlevel% neq 0 (
    echo   winget недоступен на этой системе.
    echo   Установите Git вручную: https://git-scm.com/download/win
    pause
    exit /b 1
)
echo   Устанавливаю Git (может появиться запрос UAC)...
winget install --id Git.Git -e --source winget --accept-package-agreements --accept-source-agreements
rem Сделать свежеустановленный git видимым в текущей сессии без перезапуска.
set PATH=%PATH%;%ProgramFiles%\Git\cmd
where git > nul 2>&1
if %errorlevel% neq 0 (
    echo   Git установлен, но не виден в этой сессии.
    echo   Перезапустите update-test.bat или терминал.
    pause
    exit /b 1
)
echo   Git установлен успешно.
echo.

:git_ok

rem --- 2. Свежий клон или обновление существующего? ----------
if exist ".git\" goto update_existing
goto fresh_clone

rem --- 3a. Свежая загрузка -----------------------------------
:fresh_clone
echo   Локальный репозиторий не найден.
echo   Скачиваю свежую копию ветки "%BRANCH%" в папку "%CLONE_DIR%"...
echo.
if exist "%CLONE_DIR%\" (
    echo   ERROR: папка "%CLONE_DIR%" уже существует. Удалите её или
    echo   запустите update-test.bat из самой папки проекта для обновления.
    pause
    exit /b 1
)
git clone --branch %BRANCH% --single-branch "%REPO_URL%" "%CLONE_DIR%"
if %errorlevel% neq 0 (
    echo.
    echo   ERROR: не удалось склонировать ветку "%BRANCH%".
    echo   Возможно, ветка ещё не опубликована на GitHub.
    pause
    exit /b 1
)
echo.
echo   Готово. Проект в папке "%CLONE_DIR%".
echo   Запуск приложения: %CLONE_DIR%\web\start.bat
echo.
pause
exit /b 0

rem --- 3b. Обновление существующей копии ---------------------
:update_existing
for /f "delims=" %%u in ('git config --get remote.origin.url') do set CURRENT_URL=%%u
echo   origin: %CURRENT_URL%
echo   Получаю изменения ветки "%BRANCH%" с GitHub...
echo.

git fetch origin %BRANCH%
if %errorlevel% neq 0 (
    echo.
    echo   ERROR: не удалось получить ветку "%BRANCH%" с origin.
    echo   Возможно, ветка ещё не опубликована на GitHub.
    pause
    exit /b 1
)

rem Переключиться на test (создать локальную ветку, если её нет).
git checkout %BRANCH% 2>nul || git checkout -b %BRANCH% origin/%BRANCH%
if %errorlevel% neq 0 (
    echo   ERROR: не удалось переключиться на ветку "%BRANCH%".
    pause
    exit /b 1
)

rem Безопасное обновление "вперёд" (без перезаписи локальной работы).
git pull --ff-only origin %BRANCH%
if %errorlevel% == 0 goto update_ok

echo.
echo   ВНИМАНИЕ: обычное обновление невозможно — локальная версия
echo   разошлась с GitHub (есть локальные изменения или коммиты).
echo.
choice /C YN /M "Сбросить локальную версию к GitHub? ЛОКАЛЬНЫЕ ИЗМЕНЕНИЯ БУДУТ ПОТЕРЯНЫ"
if errorlevel 2 goto abort_update
if errorlevel 1 goto hard_reset

:hard_reset
git reset --hard origin/%BRANCH%
if %errorlevel% neq 0 (
    echo   ERROR: сброс не удался.
    pause
    exit /b 1
)
goto update_ok

:abort_update
echo.
echo   Обновление отменено. Локальные изменения сохранены.
echo   Сохраните/уберите их и запустите update-test.bat снова.
echo.
pause
exit /b 1

:update_ok
echo.
echo   Обновление завершено. Текущая версия:
git --no-pager log -1 --format="   %%h  %%s"
echo.
echo   Запуск приложения: web\start.bat
echo.
pause
exit /b 0
