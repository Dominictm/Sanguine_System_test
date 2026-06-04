# update_images.ps1
# Сканирует папки персонажей и локаций.
# Если в папке обнаружены изображения, не внесённые в карточку .md, обновляет:
#   1. Секцию «## 🖼️ Изображения» в карточке персонажа / локации
#   2. Строку «Арт:» в characters_ALL.md (только для персонажей)
#
# Запуск:
#   .\tools\update_images.ps1              — применить изменения
#   .\tools\update_images.ps1 -DryRun      — только показать, без записи

[CmdletBinding()]
param(
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding          = [System.Text.Encoding]::UTF8

$Root    = Split-Path $PSScriptRoot -Parent
$AllMd   = Join-Path $Root 'characters\characters_ALL.md'
$ImgExts = @('.jpg', '.jpeg', '.png', '.gif', '.webp')

# Линейки для определения пути в characters_ALL.md
$Lineages = @('vampires','fairies','mortals','werewolves','mages','hunters')

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
            # Берём только имя файла (без пути — в карточках пути нет)
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
# Возвращает $true если файл был изменён.
function Update-CardSection($cardPath, $newFiles) {
    $raw   = [System.IO.File]::ReadAllText($cardPath, [System.Text.Encoding]::UTF8)
    $lines = $raw -split "(?<=`n)"    # сохраняем переносы
    # Работаем со строками без завершающего \n для удобства
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
            $newLines += "- [Образ $maxIdx — $fn]($enc)"
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
        if ($l -match '⏳')         { $hasPlaceholder = $true }
        elseif ($l -match '^\s*-\s*\[') { $existingImgLines += $l }
    }

    $maxIdx = Get-MaxImageIndex $ls

    # Строки для новых изображений
    $newLines = @()
    foreach ($fn in $newFiles) {
        $maxIdx++
        $enc      = Encode-Url $fn
        $newLines += "- [Образ $maxIdx — $fn]($enc)"
    }

    # Собираем новое содержимое секции
    $sectionContent = @()
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
    # Убираем тройные и более пустые строки
    $combined = $combined -replace "(\n){3,}", "`n`n"
    $combined = $combined.TrimEnd() + "`n"

    if ($combined -eq $clean.TrimEnd() + "`n") { return $false }   # не изменилось

    if (-not $DryRun) {
        [System.IO.File]::WriteAllText($cardPath, $combined, [System.Text.Encoding]::UTF8)
    }
    return $true
}

# Обновляет строку «Арт:» в characters_ALL.md для одного персонажа.
# $lineage — подпапка ('vampires', 'fairies', ...)
# $charName — имя персонажа (название папки)
# $allImgFiles — полный список изображений в папке (существующие + новые)
function Update-AllMdArt($lineage, $charName, $allImgFiles) {
    if (-not (Test-Path $AllMd)) { return }

    $raw   = [System.IO.File]::ReadAllText($AllMd, [System.Text.Encoding]::UTF8)
    $clean = $raw -replace "`r`n", "`n" -replace "`r", "`n"
    $ls    = $clean -split "`n"

    # Ищем заголовок записи персонажа — содержит encoded имя или прямое имя
    $charEnc   = Encode-Url $charName
    $charEntry = -1
    for ($i = 0; $i -lt $ls.Count; $i++) {
        $l = $ls[$i]
        if ($l -match '^### \[' -and ($l -match [regex]::Escape($charName) -or $l -match [regex]::Escape($charEnc))) {
            $charEntry = $i; break
        }
    }
    if ($charEntry -eq -1) { return }   # персонажа нет в списке

    # Ищем строку «**Арт:**» в следующих 8 строках
    $artIdx = -1
    for ($i = $charEntry + 1; $i -lt [Math]::Min($charEntry + 9, $ls.Count); $i++) {
        if ($ls[$i] -match '^\s*-\s*\*\*Арт:\*\*') { $artIdx = $i; break }
    }
    if ($artIdx -eq -1) { return }   # нет поля Арт

    # Строим новую строку Арт
    $relBase   = "$lineage/" + (Encode-Url $charName) + "/"
    $artParts  = @()
    $n         = 0
    foreach ($fn in @($allImgFiles)) {
        $n++
        $fnEnc     = Encode-Url $fn
        $artParts += "[Образ $n]($relBase$fnEnc)"
    }
    $newArtLine = "- **Арт:** " + ($artParts -join ' · ')

    if ($ls[$artIdx].TrimEnd() -eq $newArtLine) { return }   # не изменилось

    $ls[$artIdx] = $newArtLine
    $combined = ($ls -join "`n").TrimEnd() + "`n"

    if (-not $DryRun) {
        [System.IO.File]::WriteAllText($AllMd, $combined, [System.Text.Encoding]::UTF8)
    }
    Write-Host "    ✎  characters_ALL.md → Арт обновлён" -ForegroundColor Cyan
}

# ─── Сканирование одной папки ─────────────────────────────────────────────────

# Возвращает список новых файлов изображений (есть в папке, нет в карточке)
function Scan-Folder($folderPath, $cardPath) {
    $dirItems = Get-ChildItem $folderPath -File | Where-Object {
        $ImgExts -contains $_.Extension.ToLower()
    }
    if (-not $dirItems) { return @() }

    $raw        = [System.IO.File]::ReadAllText($cardPath, [System.Text.Encoding]::UTF8)
    $clean      = $raw -replace "`r`n", "`n" -replace "`r", "`n"
    $ls         = $clean -split "`n"
    $linked     = Get-LinkedFilenames $ls

    $newFiles = @()
    foreach ($item in $dirItems) {
        $fn = $item.Name
        # Пропускаем portrait.png генерируемый веб-сервером — он alias, не отдельный образ
        # Раскомментировать строку ниже если portrait.* нужно добавлять:
        # if ($fn -match '^portrait\.' ) { continue }
        if ($linked -notcontains $fn) { $newFiles += $fn }
    }
    return $newFiles
}

# ─── Основной обход ───────────────────────────────────────────────────────────

$totalUpdated  = 0
$totalNew      = 0

Write-Host ""
Write-Host "  🖼️  update_images.ps1$(if($DryRun){' [DRY RUN]'})" -ForegroundColor Yellow
Write-Host "  ─────────────────────────────────────────────────" -ForegroundColor DarkGray
Write-Host ""

# ── Персонажи ─────────────────────────────────────────────────────────────────
Write-Host "  👥 Персонажи" -ForegroundColor White

foreach ($lineage in $Lineages) {
    $lineageDir = Join-Path $Root "characters\$lineage"
    if (-not (Test-Path $lineageDir)) { continue }

    foreach ($charDir in Get-ChildItem $lineageDir -Directory) {
        $charName = $charDir.Name
        $cardPath = Join-Path $charDir.FullName "$charName.md"
        if (-not (Test-Path $cardPath)) { continue }

        $newFiles = Scan-Folder $charDir.FullName $cardPath
        if (-not $newFiles) { continue }

        Write-Host "    + $charName  →  $($newFiles.Count) новых: $($newFiles -join ', ')" -ForegroundColor Green

        # Все изображения (уже существующие в карточке + новые) для обновления Арт:
        $raw      = [System.IO.File]::ReadAllText($cardPath, [System.Text.Encoding]::UTF8)
        $ls       = ($raw -replace "`r`n","`n") -split "`n"
        $existing = Get-LinkedFilenames $ls
        $allImgs  = @($existing) + @($newFiles)

        $changed = Update-CardSection $cardPath $newFiles
        if ($changed) {
            $totalUpdated++
            $totalNew += $newFiles.Count
        }

        Update-AllMdArt $lineage $charName $allImgs
    }
}

# ── Локации ───────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "  🗺️  Локации" -ForegroundColor White

$locRoot = Join-Path $Root 'locations'
if (Test-Path $locRoot) {
    # Рекурсивно ищем папки, содержащие .md с тем же именем
    Get-ChildItem $locRoot -Directory -Recurse | ForEach-Object {
        $locDir  = $_
        $locName = $locDir.Name
        $cardPath = Join-Path $locDir.FullName "$locName.md"
        if (-not (Test-Path $cardPath)) { return }

        $newFiles = Scan-Folder $locDir.FullName $cardPath
        if (-not $newFiles) { return }

        Write-Host "    + $locName  →  $($newFiles.Count) новых: $($newFiles -join ', ')" -ForegroundColor Green

        $changed = Update-CardSection $cardPath $newFiles
        if ($changed) {
            $totalUpdated++
            $totalNew += $newFiles.Count
        }
        # Локации в characters_ALL.md не обновляем
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
