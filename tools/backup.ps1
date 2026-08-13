# backup.ps1
# Creates a timestamped zip of the project.
#
# Главная цель — арт (cities/**/art/, ~120 МБ): изображения под .gitignore и
# существуют в единственном экземпляре на диске, в отличие от текстовых данных,
# которые лежат в git и запушены на GitHub.
#
# Usage: .\tools\backup.ps1
# Custom output dir: .\tools\backup.ps1 -OutDir "D:\Backups"

param(
    [string]$Root   = (Split-Path -Parent $PSScriptRoot),
    [string]$OutDir = (Split-Path -Parent $PSScriptRoot)
)

$timestamp  = Get-Date -Format "yyyy-MM-dd_HH-mm"
$zipName    = "VTM-backup-$timestamp.zip"
$zipPath    = Join-Path $OutDir $zipName
$tempDir    = Join-Path $env:TEMP "vtm_backup_$timestamp"

Write-Host ""
Write-Host "  Creating backup: $zipName" -ForegroundColor Cyan

# Анализ 2026-08-11 (A2): из списка убран "img-personj" — папки с таким именем в
# проекте давно нет, исключение ничего не делало. Добавлен ".git" — история и так
# на GitHub, в архиве это лишние сотни мегабайт.
$exclude = @(".claude", ".git", "tools")
New-Item -ItemType Directory -Path $tempDir | Out-Null

Get-ChildItem -Path $Root -Force | Where-Object { $_.Name -notin $exclude } | ForEach-Object {
    Copy-Item -Path $_.FullName -Destination $tempDir -Recurse -Force
}

# Also copy tools folder (scripts themselves)
Copy-Item -Path (Join-Path $Root "tools") -Destination $tempDir -Recurse -Force

# Ключи AI (web/.env, service-account JSON) не должны попадать в ручной бэкап — "web"
# не в $exclude (внутри неё лежат сами данные городов при старой раскладке — сейчас нет,
# но исключать всю папку не вариант), поэтому файлы с ключами вычищаются точечно уже
# после копирования. Отправленный кому-то архив иначе становится утечкой ключей.
Remove-Item -Path (Join-Path $tempDir "web\.env") -Force -ErrorAction SilentlyContinue
Remove-Item -Path (Join-Path $tempDir "web\.gemini-vertex-key.json") -Force -ErrorAction SilentlyContinue

# node_modules (web/ + web/tests/, ~88 МБ) полностью восстанавливаются через
# `npm install` — в архиве смысла не имеют. Отсечь их одним $exclude выше нельзя:
# они вложенные, а Copy-Item -Recurse тянет их вместе с web/. Удаляем после
# копирования; сортировка по длине пути (сначала самые глубокие) — чтобы
# вложенные node_modules внутри node_modules не осиротели при удалении родителя.
Get-ChildItem -Path $tempDir -Directory -Recurse -Force -Filter 'node_modules' |
    Sort-Object { $_.FullName.Length } -Descending |
    ForEach-Object { Remove-Item -LiteralPath $_.FullName -Recurse -Force -ErrorAction SilentlyContinue }

Compress-Archive -Path "$tempDir\*" -DestinationPath $zipPath -CompressionLevel Optimal
Remove-Item -Path $tempDir -Recurse -Force

$size = [math]::Round((Get-Item $zipPath).Length / 1MB, 1)
Write-Host "  Done: $zipPath ($size MB)" -ForegroundColor Green

# Бэкап рядом с оригиналом не защищает от отказа диска — говорим об этом прямо,
# иначе архив создаёт ложное чувство защищённости.
if ((Split-Path -Qualifier $zipPath) -eq (Split-Path -Qualifier $Root)) {
    Write-Host ""
    Write-Host "  ! Archive is on the same drive as the project - no protection from disk failure." -ForegroundColor Yellow
    Write-Host "    Copy it to an external drive or a cloud-synced folder," -ForegroundColor DarkGray
    Write-Host "    or run: .\tools\backup.ps1 -OutDir 'D:\Backups'" -ForegroundColor DarkGray
}

Write-Host ""
Write-Host "  Нажмите любую клавишу для закрытия..." -ForegroundColor DarkGray
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
