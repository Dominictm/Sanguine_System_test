# search.ps1
# Search all .md files for a term. Shows file, line number, and matching line.
# Usage: .\tools\search.ps1 "Мэл"
# Case-insensitive by default. Add -Case for case-sensitive.

param(
    [Parameter(Mandatory=$true)]
    [string]$Query,
    [string]$Root   = (Split-Path -Parent $PSScriptRoot),
    [switch]$Case
)

$mdFiles = Get-ChildItem -Path $Root -Recurse -Filter "*.md" |
    Where-Object { $_.FullName -notmatch '\\.claude\\' }

$results = @()
foreach ($file in $mdFiles) {
    $lines = [System.IO.File]::ReadAllLines($file.FullName, [System.Text.Encoding]::UTF8)
    for ($i = 0; $i -lt $lines.Count; $i++) {
        $match = if ($Case) { $lines[$i] -cmatch [regex]::Escape($Query) }
                 else       { $lines[$i] -imatch [regex]::Escape($Query) }
        if ($match) {
            $results += [PSCustomObject]@{
                File    = $file.FullName.Replace($Root, '').TrimStart('\')
                Line    = $i + 1
                Content = $lines[$i].Trim()
            }
        }
    }
}

Write-Host ""
if ($results.Count -eq 0) {
    Write-Host "  No results for: $Query" -ForegroundColor Yellow
} else {
    Write-Host ("  {0} result(s) for: {1}" -f $results.Count, $Query) -ForegroundColor Cyan
    Write-Host ""
    $lastFile = ""
    foreach ($r in $results) {
        if ($r.File -ne $lastFile) {
            Write-Host "  $($r.File)" -ForegroundColor Yellow
            $lastFile = $r.File
        }
        Write-Host ("    [{0,4}] {1}" -f $r.Line, $r.Content) -ForegroundColor Gray
    }
}
Write-Host ""
Write-Host "  Нажмите любую клавишу для закрытия..." -ForegroundColor DarkGray
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")