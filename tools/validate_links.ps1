param(
    [string]$Root = (Split-Path -Parent $PSScriptRoot),
    [string]$Filter = "",
    [switch]$IncludeRules   # rules/ skipped by default (contains template paths)
)

$broken   = @()
$checked  = 0
$skipped  = 0

$mdFiles = Get-ChildItem -Path $Root -Recurse -Filter "*.md" |
    Where-Object { $_.FullName -notmatch '\\.claude\\' } |
    Where-Object { $IncludeRules -or ($_.FullName -notmatch '\\rules\\') }

if ($Filter) {
    $mdFiles = $mdFiles | Where-Object { $_.FullName -match [regex]::Escape($Filter) }
}

foreach ($file in $mdFiles) {
    $content = Get-Content $file.FullName -Raw -Encoding UTF8
    $dir     = $file.DirectoryName

    $links = @()
    # angle-bracket links: [text](<url>)
    [regex]::Matches($content, '\[([^\]]*)\]\(<([^>]+)>\)') | ForEach-Object {
        $links += $_.Groups[2].Value
    }
    # normal links: [text](url)  -- no < > inside
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
                [System.IO.Path]::Combine($dir, $decoded)
            )
        } catch { $skipped++; continue }

        $checked++

        if (-not (Test-Path $abs)) {
            $broken += [PSCustomObject]@{
                File   = $file.FullName.Replace($Root, '').TrimStart('\')
                Link   = $raw
                Target = $abs.Replace($Root, '').TrimStart('\')
            }
        }
    }
}

$rulesNote = if ($IncludeRules) { "" } else { " (rules/ excluded)" }
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  VTM Paris 2010 -- Link Validator" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Files   : $($mdFiles.Count)$rulesNote"
Write-Host "  Checked : $checked"
Write-Host "  Skipped : $skipped (external / anchors / templates)"
Write-Host ""

if ($broken.Count -eq 0) {
    Write-Host "  OK -- no broken links found." -ForegroundColor Green
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
Write-Host "  Нажмите любую клавишу для закрытия..." -ForegroundColor DarkGray
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")