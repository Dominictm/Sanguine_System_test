# update_images.ps1
# Сканирует папки персонажей и локаций в cities/<город>/.
# Если в папке art/ (персонажи) или рядом с карточкой (локации) обнаружены изображения,
# не внесённые в карточку .md, обновляет секцию «## 🖼️ Изображения».
#
# Запуск:
#   .\tools\update_images.ps1                 — все города, применить изменения
#   .\tools\update_images.ps1 -City paris     — только указанный город
#   .\tools\update_images.ps1 -DryRun         — только показать, без записи

[CmdletBinding()]
param(
    [string]$City   = '',
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding          = [System.Text.Encoding]::UTF8

$Root        = Split-Path $PSScriptRoot -Parent
$CitiesRoot  = Join-Path $Root 'cities'
$ImgExts     = @('.jpg', '.jpeg', '.png', '.gif', '.webp')
$Lineages    = @('vampires','fairies','mortals','werewolves','mages','hunters')

# ─── Вспомогательные функции ─────────────────────────────────────────────────

function Encode-Url($str) {
    # Только пробелы → %20; скобки → %28/%29; остальное (кириллица) — как есть
    $str.Replace('%', '%25').Replace(' ', '%20').Replace('(', '%28').Replace(')', '%29')
}

function Decode-Url($str) {
    [System.Uri]::UnescapeDataString($str)
}

# Возвращает список имён файлов (не путей), уже прописанных в секции ## 🖼️ Изображения
function Get-LinkedFilenames($lines) {
    $inSection = $false
    $result    = @()
    foreach ($l in $lines) {
        if ($l -match '^## 🖼️ Изображения') { $inSection = $true; continue }
        if ($inSection -and $l -match '^## ')  { break }
        if ($inSection -and $l -match '\]\(([^)]+)\)') {
            $href    = $matches[1]
            # Берём только имя файла (в карточках путь — art/<file> или <file>)
            $decoded = Decode-Url $href
            $result += [System.IO.Path]::GetFileName($decoded)
        }
    }
    return $result
}

# Возвращает максимальный номер «Образ N» из уже существующих строк
function Get-MaxImageIndex($lines) {
    $inSection = $false
    $max       = 0
    foreach ($l in $lines) {
        if ($l -match '^## 🖼️ Изображения') { $inSection = $true; continue }
        if ($inSection -and $l -match '^## ')  { break }
        if ($inSection -and $l -match 'Образ\s+(\d+)') {
            $n = [int]$matches[1]
            if ($n -gt $max) { $max = $n }
        }
    }
    return $max
}

# Обновляет секцию ## 🖼️ Изображения в файле карточки.
# $hrefPrefix — префикс пути для новых ссылок ('art/' для персонажей, '' для локаций).
# Возвращает $true если файл был изменён.
function Update-CardSection($cardPath, $newFiles, $hrefPrefix) {
    $raw   = [System.IO.File]::ReadAllText($cardPath, [System.Text.Encoding]::UTF8)
    $clean = $raw -replace "`r`n", "`n" -replace "`r", "`n"
    $ls    = $clean -split "`n"

    # Находим начало секции
    $secIdx = -1
    for ($i = 0; $i -lt $ls.Count; $i++) {
        if ($ls[$i] -match '^## 🖼️ Изображения') { $secIdx = $i; break }
    }
    if ($secIdx -eq -1) {
        # Секции нет — добавляем в конец файла
        $maxIdx = 0
        $newLines = @()
        foreach ($fn in $newFiles) {
            $maxIdx++
            $enc = Encode-Url $fn
            $newLines += "- [Образ $maxIdx]($hrefPrefix$enc)"
        }
        $combined = $clean.TrimEnd() + "`n`n## 🖼️ Изображения`n`n" + ($newLines -join "`n") + "`n"
        if (-not $DryRun) {
            [System.IO.File]::WriteAllText($cardPath, $combined, [System.Text.Encoding]::UTF8)
        }
        return $true
    }

    # Находим конец секции (следующий ## заголовок или конец файла)
    $secEnd = $ls.Count
    for ($i = $secIdx + 1; $i -lt $ls.Count; $i++) {
        if ($ls[$i] -match '^## ') { $secEnd = $i; break }
    }

    # Собираем существующие строки с изображениями (не ⏳, не пустые)
    $existingImgLines = @()
    $hasPlaceholder   = $false
    for ($i = $secIdx + 1; $i -lt $secEnd; $i++) {
        $l = $ls[$i].TrimEnd()
        if ($l -match '⏳')             { $hasPlaceholder = $true }
        elseif ($l -match '^\s*-\s*\[') { $existingImgLines += $l }
    }

    $maxIdx = Get-MaxImageIndex $ls

    # Строки для новых изображений
    $newLines = @()
    foreach ($fn in $newFiles) {
        $maxIdx++
        $enc      = Encode-Url $fn
        $newLines += "- [Образ $maxIdx]($hrefPrefix$enc)"
    }

    # Собираем новое содержимое секции
    if ($hasPlaceholder -and $existingImgLines.Count -eq 0) {
        # Только плейсхолдер — заменяем целиком
        $sectionContent = $newLines
    } else {
        $sectionContent = $existingImgLines + $newLines
    }

    # Пересобираем файл
    $before = $ls[0..$secIdx]
    $after  = if ($secEnd -lt $ls.Count) { $ls[$secEnd..($ls.Count - 1)] } else { @() }

    $combined = ($before + $sectionContent + @('') + $after) -join "`n"
    $combined = $combined -replace "(\n){3,}", "`n`n"
    $combined = $combined.TrimEnd() + "`n"

    if ($combined -eq $clean.TrimEnd() + "`n") { return $false }   # не изменилось

    if (-not $DryRun) {
        [System.IO.File]::WriteAllText($cardPath, $combined, [System.Text.Encoding]::UTF8)
    }
    return $true
}

# ─── Сканирование одной папки ─────────────────────────────────────────────────

# Возвращает список новых файлов изображений (есть в папке, нет в карточке)
function Scan-Folder($folderPath, $cardPath) {
    if (-not (Test-Path $folderPath)) { return @() }
    $dirItems = Get-ChildItem $folderPath -File | Where-Object {
        $ImgExts -contains $_.Extension.ToLower()
    }
    if (-not $dirItems) { return @() }

    $raw    = [System.IO.File]::ReadAllText($cardPath, [System.Text.Encoding]::UTF8)
    $clean  = $raw -replace "`r`n", "`n" -replace "`r", "`n"
    $ls     = $clean -split "`n"
    $linked = Get-LinkedFilenames $ls

    $newFiles = @()
    foreach ($item in $dirItems) {
        $fn = $item.Name
        if ($linked -notcontains $fn) { $newFiles += $fn }
    }
    return $newFiles
}

# ─── Основной обход ───────────────────────────────────────────────────────────

if (-not (Test-Path $CitiesRoot)) {
    Write-Host "  ✗ Папка cities/ не найдена: $CitiesRoot" -ForegroundColor Red
    exit 1
}

if ($City) {
    $p = Join-Path $CitiesRoot $City
    if (-not (Test-Path $p)) { Write-Host "  ✗ Город не найден: $City" -ForegroundColor Red; exit 1 }
    $cityDirs = @(Get-Item $p)
} else {
    $cityDirs = @(Get-ChildItem $CitiesRoot -Directory)
}

$totalUpdated = 0
$totalNew     = 0

Write-Host ""
Write-Host "  🖼️  update_images.ps1$(if($DryRun){' [DRY RUN]'})" -ForegroundColor Yellow
Write-Host "  ─────────────────────────────────────────────────" -ForegroundColor DarkGray

foreach ($cityDir in $cityDirs) {
    Write-Host ""
    Write-Host "  🏙  $($cityDir.Name)" -ForegroundColor Magenta

    # ── Персонажи ─────────────────────────────────────────────────────────────
    $charsRoot = Join-Path $cityDir.FullName 'characters'
    if (Test-Path $charsRoot) {
        Write-Host "    👥 Персонажи" -ForegroundColor White
        foreach ($lineage in $Lineages) {
            $lineageDir = Join-Path $charsRoot $lineage
            if (-not (Test-Path $lineageDir)) { continue }

            foreach ($charDir in Get-ChildItem $lineageDir -Directory) {
                $slug     = $charDir.Name
                $cardPath = Join-Path $charDir.FullName "$slug.md"
                if (-not (Test-Path $cardPath)) { continue }

                $artDir   = Join-Path $charDir.FullName 'art'
                $newFiles = Scan-Folder $artDir $cardPath
                if (-not $newFiles) { continue }

                Write-Host "      + $slug  →  $($newFiles.Count) новых: $($newFiles -join ', ')" -ForegroundColor Green
                if (Update-CardSection $cardPath $newFiles 'art/') {
                    $totalUpdated++
                    $totalNew += $newFiles.Count
                }
            }
        }
    }

    # ── Локации ───────────────────────────────────────────────────────────────
    $locRoot = Join-Path $cityDir.FullName 'locations'
    if (Test-Path $locRoot) {
        Write-Host "    🗺  Локации" -ForegroundColor White
        Get-ChildItem $locRoot -Directory -Recurse | ForEach-Object {
            $locDir   = $_
            $locName  = $locDir.Name
            $cardPath = Join-Path $locDir.FullName "$locName.md"
            if (-not (Test-Path $cardPath)) { return }

            # Изображения могут лежать в art/ или рядом с карточкой
            $artDir   = Join-Path $locDir.FullName 'art'
            $hasArt   = Test-Path $artDir
            $scanDir  = if ($hasArt) { $artDir } else { $locDir.FullName }
            $prefix   = if ($hasArt) { 'art/' } else { '' }

            $newFiles = Scan-Folder $scanDir $cardPath
            if (-not $newFiles) { return }

            Write-Host "      + $locName  →  $($newFiles.Count) новых: $($newFiles -join ', ')" -ForegroundColor Green
            if (Update-CardSection $cardPath $newFiles $prefix) {
                $totalUpdated++
                $totalNew += $newFiles.Count
            }
        }
    }
}

# ─── Итог ─────────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "  ─────────────────────────────────────────────────" -ForegroundColor DarkGray
if ($totalUpdated -eq 0) {
    Write-Host "  ✓  Все карточки актуальны — новых изображений не найдено." -ForegroundColor DarkGray
} else {
    $action = if ($DryRun) { "Будет обновлено" } else { "Обновлено" }
    Write-Host "  ✓  $action карточек: $totalUpdated  |  новых ссылок: $totalNew" -ForegroundColor Green
    if ($DryRun) {
        Write-Host "  ⚠  Это DRY RUN — файлы не записаны. Запустите без -DryRun для применения." -ForegroundColor Yellow
    }
}
Write-Host ""
