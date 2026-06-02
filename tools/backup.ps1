# backup.ps1
# Creates a timestamped zip of the project (excludes img-personj and .claude).
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

# Copy project excluding heavy/internal folders
$exclude = @("img-personj", ".claude", "tools")
New-Item -ItemType Directory -Path $tempDir | Out-Null

Get-ChildItem -Path $Root | Where-Object { $_.Name -notin $exclude } | ForEach-Object {
    Copy-Item -Path $_.FullName -Destination $tempDir -Recurse
}

# Also copy tools folder (scripts themselves)
Copy-Item -Path (Join-Path $Root "tools") -Destination $tempDir -Recurse

Compress-Archive -Path "$tempDir\*" -DestinationPath $zipPath -CompressionLevel Optimal
Remove-Item -Path $tempDir -Recurse -Force

$size = [math]::Round((Get-Item $zipPath).Length / 1KB)
Write-Host "  Done: $zipPath ($size KB)" -ForegroundColor Green
Write-Host ""
Write-Host "  Нажмите любую клавишу для закрытия..." -ForegroundColor DarkGray
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")