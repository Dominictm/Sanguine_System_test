# check_art.ps1 — проверяет наличие арт-файлов у персонажей
# Использование: .\tools\check_art.ps1 [paris]
param([string]$City = 'paris')

$root  = Split-Path $PSScriptRoot -Parent
$chars = Join-Path $root "cities\$City\characters"

$missing = 0
$present = 0
$noRef   = 0

Get-ChildItem $chars -Recurse -Filter "*.md" | Where-Object {
    $_.Name -eq ($_.Directory.Name + ".md")   # только карточки, не -sheet и не journal
} | ForEach-Object {
    $card    = $_
    $artDir  = Join-Path $card.Directory.FullName "art"
    $slug    = $card.Directory.Name
    $content = Get-Content $card.FullName -Raw -Encoding UTF8

    # Ищем ссылки вида (art/имя_файла)
    $refs = [regex]::Matches($content, '\(art/([^)]+)\)') | ForEach-Object { $_.Groups[1].Value }

    if ($refs.Count -eq 0) {
        $noRef++
        return
    }

    $missingFiles = $refs | Where-Object {
        -not (Test-Path (Join-Path $artDir $_))
    }

    if ($missingFiles) {
        Write-Host "✗ $slug" -ForegroundColor Red
        $missingFiles | ForEach-Object {
            Write-Host "    ожидается: cities\$City\characters\...\$slug\art\$_" -ForegroundColor DarkYellow
            $missing++
        }
    } else {
        Write-Host "✓ $slug ($($refs.Count) арт)" -ForegroundColor Green
        $present += $refs.Count
    }
}

Write-Host ""
Write-Host "Итог: арт на месте — $present файлов, отсутствует — $missing, без ссылок — $noRef персонажей" -ForegroundColor Cyan
