param(
    [string]$Root         = (Split-Path -Parent $PSScriptRoot),
    [string]$Filter       = "",
    [switch]$IncludeRules,   # rules/ skipped by default (contains template paths)
    [switch]$Fix,            # auto-remove broken image links from .md files
    [switch]$Force,          # skip ReadKey — used when called from web server / CI
    [switch]$Quiet           # suppress the closing "press any key" prompt entirely
)

$broken     = @()
$checked    = 0
$skipped    = 0
$fixedFiles = 0

# ─── Collect files ────────────────────────────────────────────────────────────

$mdFiles = Get-ChildItem -Path $Root -Recurse -Filter "*.md" |
    Where-Object { $_.FullName -notmatch '\\.claude\\' } |
    Where-Object { $_.FullName -notmatch '\\node_modules\\' } |
    Where-Object { $IncludeRules -or ($_.FullName -notmatch '\\rules\\') }

if ($Filter) {
    $mdFiles = $mdFiles | Where-Object { $_.FullName -match [regex]::Escape($Filter) }
}

# ─── Scan links ───────────────────────────────────────────────────────────────

foreach ($file in $mdFiles) {
    $content = Get-Content $file.FullName -Raw -Encoding UTF8
    if ($null -eq $content) { continue }   # empty file — Get-Content -Raw returns $null, not ""
    $dir     = $file.DirectoryName

    # Strip fenced code blocks and inline code spans — example snippets (e.g. in
    # docs/superpowers/plans/) often contain markdown-link-looking syntax as
    # literal example text (e.g. `[text](path.md)`), not real links.
    $content = [regex]::Replace($content, '(?s)```.*?```', '')
    $content = [regex]::Replace($content, '`[^`\n]*`', '')

    $links = @()
    # angle-bracket links: [text](<url>)
    [regex]::Matches($content, '\[([^\]]*)\]\(<([^>]+)>\)') | ForEach-Object {
        $links += $_.Groups[2].Value
    }
    # normal links: [text](url)
    [regex]::Matches($content, '\[([^\]]*)\]\(([^)<>]+)\)') | ForEach-Object {
        $links += $_.Groups[2].Value
    }

    foreach ($raw in $links) {
        if ($raw -match '^(https?://|mailto:|#)') { $skipped++; continue }
        $path = $raw -replace '#[^)]*$', ''
        if ($path -eq '') { $skipped++; continue }
        if ($path -match '\[|\$\{') { $skipped++; continue }   # template placeholder (incl. JS template literals in example code)

        $decoded = [System.Uri]::UnescapeDataString($path)
        try {
            $abs = [System.IO.Path]::GetFullPath(
                [System.IO.Path]::Combine($dir, $decoded))
        } catch { $skipped++; continue }

        $checked++
        if (-not (Test-Path $abs)) {
            $broken += [PSCustomObject]@{
                File    = $file.FullName.Replace($Root + '\', '')
                Link    = $raw
                Target  = $abs.Replace($Root + '\', '')
                IsImage = ($raw -match '\.(jpg|jpeg|png|gif|webp)($|\s|#|\?)') -as [bool]
            }
        }
    }
}

# ─── Auto-fix broken image links ─────────────────────────────────────────────

if ($Fix) {
    $byFile = $broken | Where-Object { $_.IsImage } | Group-Object File

    foreach ($group in $byFile) {
        $filePath = Join-Path $Root $group.Name
        $rawBytes = [System.IO.File]::ReadAllBytes($filePath)
        $hasBom   = ($rawBytes.Length -ge 3 -and $rawBytes[0] -eq 0xEF -and
                     $rawBytes[1] -eq 0xBB -and $rawBytes[2] -eq 0xBF)
        $text     = [System.IO.File]::ReadAllText($filePath, [System.Text.Encoding]::UTF8) `
                    -replace "`r`n", "`n"
        $original = $text

        # 1 — Remove each broken image markdown link: [any text](broken_url)
        foreach ($b in $group.Group) {
            $pattern = '\[[^\]]*\]\(' + [regex]::Escape($b.Link) + '\)'
            $text    = [regex]::Replace($text, $pattern, '')
        }

        # 2 — Line-by-line cleanup
        $lines  = $text -split "`n"
        $result = [System.Collections.Generic.List[string]]::new()
        foreach ($line in $lines) {

            # "Арт:" line — collapse · separators, add placeholder when empty
            if ($line -match '^\- \*\*Арт:\*\*') {
                $prefix = '- **Арт:**'
                $rest   = $line.Substring($prefix.Length).Trim()
                $parts  = ($rest -split '\s*·\s*') | Where-Object { $_.Trim() -ne '' }
                if ($parts.Count -eq 0) {
                    $result.Add("$prefix ⏳ Не предоставлено")
                } else {
                    $result.Add("$prefix " + ($parts -join ' · '))
                }
                continue
            }

            # Image bullet line that became empty after link removal → placeholder
            if ($line -match '^-\s*$') { continue }

            $result.Add($line)
        }

        $newText = $result -join "`n"
        if ($newText -ne $original) {
            $enc = [System.Text.UTF8Encoding]::new($hasBom)
            [System.IO.File]::WriteAllText($filePath, $newText, $enc)
            Write-Host "  FIXED  $($group.Name) ($($group.Group.Count) ссылок)" -ForegroundColor Green
            $fixedFiles++
        }
    }

    # Remove fixed image links from broken list — only non-image remain
    $broken = @($broken | Where-Object { -not $_.IsImage })
}

# ─── Auto-fix broken .md links — единственное совпадение по имени файла ──────
# §B4 (2026-08-04-city-section-techspec.md): -Fix раньше умел чинить только
# изображения. Страховка «на потом» для .md-ссылок, сломанных МИМО интерфейса
# (правка файлов руками, git) — интерфейсные операции (§B1: перенос локации,
# §A5: удаление района, DELETE персонажа) уже чинят/де-линкуют свои ссылки сами,
# в момент самой операции; здесь — общий, более грубый инструмент для случаев,
# когда обновлять было некому (сторонняя правка).
#
# Правило нарочно консервативное: чиним только когда файл с таким ИМЕНЕМ
# существует В ЕДИНСТВЕННОМ месте всего просканированного дерева — при 0 или
# 2+ совпадениях оставляем ссылку как есть и сообщаем (не гадаем, какая из
# нескольких одноимённых карточек имелась в виду).
if ($Fix) {
    # [System.IO.Path]::GetRelativePath не существует в Windows PowerShell 5.1
    # (это .NET Core API, здесь — .NET Framework) — первая версия этого блока звала
    # его напрямую; ошибка метода оказалась НЕтерминирующей и утекла дальше по
    # конвейеру: $newRel/$newLink остались $null, [regex]::Replace на $null тоже упал
    # нетерминирующей ошибкой, $updated остался от предыдущей итерации/$null, и в
    # if ($updated -ne $text) сравнение с $null оказалось true — файл ушёл на диск
    # ПУСТЫМ (WriteAllText($filePath, $null, ...) пишет ''). Поймано на тестовой
    # фикстуре ДО прогона на реальных данных. Ниже — Uri.MakeRelativeUri (доступен в
    # обеих версиях .NET) и try/catch на файл и на ссылку, чтобы неожиданная ошибка
    # пропускала файл нетронутым, а не портила его частичной/пустой записью.
    function Get-RelLinkPath([string]$fromDir, [string]$toFile) {
        $fromUri = New-Object System.Uri(($fromDir.TrimEnd('\') + '\'))
        $toUri   = New-Object System.Uri($toFile)
        $rel     = $fromUri.MakeRelativeUri($toUri).ToString()
        return [System.Uri]::UnescapeDataString($rel)
    }

    $byBasename = @{}
    foreach ($f in $mdFiles) {
        if (-not $byBasename.ContainsKey($f.Name)) { $byBasename[$f.Name] = @() }
        $byBasename[$f.Name] += $f.FullName
    }

    $mdBroken  = @($broken | Where-Object { $_.Link -match '\.md(#|$)' })
    $resolved  = New-Object System.Collections.Generic.HashSet[string]
    $mdFixed   = 0

    foreach ($group in ($mdBroken | Group-Object File)) {
        $filePath = Join-Path $Root $group.Name
        try {
            $rawBytes = [System.IO.File]::ReadAllBytes($filePath)
            $hasBom   = ($rawBytes.Length -ge 3 -and $rawBytes[0] -eq 0xEF -and
                         $rawBytes[1] -eq 0xBB -and $rawBytes[2] -eq 0xBF)
            $text     = [System.IO.File]::ReadAllText($filePath, [System.Text.Encoding]::UTF8) `
                        -replace "`r`n", "`n"
        } catch {
            Write-Host "  ПРОПУЩЕН (не удалось прочитать) $($group.Name): $($_.Exception.Message)" -ForegroundColor DarkYellow
            continue
        }
        $original = $text
        $dir      = Split-Path -Parent $filePath
        $touched  = $false

        foreach ($b in $group.Group) {
            try {
                if ($b.Link -notmatch '^(.*?\.md)(#.*)?$') { continue }
                $linkPath = $Matches[1]
                $fragment = $Matches[2]; if ($null -eq $fragment) { $fragment = '' }
                $bn = Split-Path -Leaf ([System.Uri]::UnescapeDataString($linkPath))
                $candidates = $byBasename[$bn]
                if (-not $candidates -or $candidates.Count -ne 1) { continue }  # 0 или 2+ — не трогаем

                $newRel  = Get-RelLinkPath -fromDir $dir -toFile $candidates[0]
                $newLink = $newRel + $fragment
                if ([string]::IsNullOrEmpty($newLink)) { continue }  # защита: никогда не пишем пустую ссылку

                $pattern = [regex]::Escape("]($($b.Link))")
                $replacement = "](" + $newLink.Replace('$', '$$') + ")"
                $updated = [regex]::Replace($text, $pattern, $replacement)
                if ([string]::IsNullOrEmpty($updated)) { continue }  # защита: никогда не обнуляем текст файла
                if ($updated -ne $text) {
                    $text = $updated
                    $touched = $true
                    [void]$resolved.Add("$($group.Name)|$($b.Link)")
                }
            } catch {
                Write-Host "  ПРОПУЩЕНА ссылка ($($b.Link)) в $($group.Name): $($_.Exception.Message)" -ForegroundColor DarkYellow
            }
        }

        if ($touched -and -not [string]::IsNullOrEmpty($text)) {
            $enc = [System.Text.UTF8Encoding]::new($hasBom)
            [System.IO.File]::WriteAllText($filePath, $text, $enc)
            Write-Host "  FIXED  $($group.Name) (.md-ссылки переписаны)" -ForegroundColor Green
            $mdFixed++
        }
    }

    # Из финального отчёта убираем только то, что реально переписали — ссылки с
    # 0/2+ совпадениями остаются в $broken и по-прежнему видны как BROKEN.
    $broken = @($broken | Where-Object { -not $resolved.Contains("$($_.File)|$($_.Link)") })
    $fixedFiles += $mdFixed
}

# ─── Report ───────────────────────────────────────────────────────────────────

$rulesNote = if ($IncludeRules) { "" } else { " (rules/ excluded)" }
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Sanguine System -- Link Validator" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Files   : $($mdFiles.Count)$rulesNote"
Write-Host "  Checked : $checked"
Write-Host "  Skipped : $skipped (external / anchors / templates)"
if ($Fix -and $fixedFiles -gt 0) {
    Write-Host "  Fixed   : $fixedFiles файлов" -ForegroundColor Green
}
Write-Host ""

if ($broken.Count -eq 0) {
    Write-Host "  OK -- no broken links." -ForegroundColor Green
} else {
    Write-Host "  BROKEN: $($broken.Count)" -ForegroundColor Red
    Write-Host ""
    foreach ($b in $broken) {
        Write-Host "  [FILE]   $($b.File)" -ForegroundColor Yellow
        Write-Host "  [LINK]   $($b.Link)" -ForegroundColor Red
        Write-Host "  [TARGET] $($b.Target)" -ForegroundColor DarkRed
        Write-Host ""
    }
}
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Prompt for a keypress only in a genuine interactive console. When run from CI,
# the web server, or with output/input redirected, never block on ReadKey.
$interactive = -not $Force -and -not $Quiet `
    -and [Environment]::UserInteractive `
    -and -not [Console]::IsInputRedirected
if ($interactive) {
    Write-Host "  Нажмите любую клавишу для закрытия..." -ForegroundColor DarkGray
    try { $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown") } catch { }
}

# Exit code = broken non-image links only (images are gitignored and absent in CI by design)
exit (@($broken | Where-Object { -not $_.IsImage }).Count)
