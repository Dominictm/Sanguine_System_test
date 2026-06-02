@echo off
chcp 65001 > nul
cd /d "%~dp0"

echo.
echo  =============================================
echo   VTM Chronicle Manager
echo  =============================================
echo.

:: Проверка Node.js
where node > nul 2>&1
if %errorlevel% neq 0 (
    echo   ОШИБКА: Node.js не найден.
    echo   Установите Node.js: https://nodejs.org
    echo.
    pause
    exit /b 1
)

:: Если порт 3000 уже занят — просто открыть браузер
netstat -ano | find "LISTENING" | find ":3000" > nul 2>&1
if %errorlevel% == 0 (
    echo   Сервер уже запущен на http://localhost:3000
    echo   Открываю браузер...
    start http://localhost:3000
    exit /b 0
)

:: Установка зависимостей при первом запуске
if not exist "node_modules\" (
    echo   Установка зависимостей (первый запуск)...
    call npm install --silent
    if %errorlevel% neq 0 (
        echo   ОШИБКА при установке пакетов.
        pause
        exit /b 1
    )
    echo   Готово.
    echo.
)

:: Запуск сервера в отдельном окне
echo   Запуск сервера...
start "VTM Chronicle Manager" cmd /k "node server.js & echo. & echo Нажмите Ctrl+C для остановки"

:: Ждём пока сервер поднимется
echo   Подождите...
timeout /t 2 /nobreak > nul

:: Проверяем что сервер действительно запустился
netstat -ano | find "LISTENING" | find ":3000" > nul 2>&1
if %errorlevel% neq 0 (
    timeout /t 2 /nobreak > nul
)

:: Открыть браузер
echo   Открываю http://localhost:3000
start http://localhost:3000

echo.
echo   Сервер работает. Закройте окно "VTM Chronicle Manager" для остановки.
echo.
timeout /t 3 /nobreak > nul
