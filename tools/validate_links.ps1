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
    $dir     = $file.DirectoryName

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
        if ($path -match '\[') { $skipped++; continue }   # template placeholder

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

# Exit code = number of remaining broken links (useful for pre-commit hooks / CI)
exit $broken.Count
