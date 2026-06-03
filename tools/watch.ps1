# watch.ps1 — Watch mode: auto-validate on file changes
# Monitors characters/, modules/, locations/ for .md edits.
# Runs validate_links.ps1 automatically after each save.
#
# Usage:
#   .\tools\watch.ps1                — check only
#   .\tools\watch.ps1 -Fix          — check + auto-fix broken image links
#   .\tools\watch.ps1 -Debounce 3   — seconds to wait after last event (default 1.5)

param(
    [switch]$Fix,
    [double]$Debounce = 1.5
)

$Root     = Split-Path -Parent $PSScriptRoot
$Validate = Join-Path $Root "tools\validate_links.ps1"
$WatchDirs = @("characters", "modules", "locations") | ForEach-Object {
    Join-Path $Root $_
} | Where-Object { Test-Path $_ }

# ─── Synchronized state (shared between watcher events and main loop) ─────────

$State = [hashtable]::Synchronized(@{
    LastEvent   = [datetime]::MinValue
    Pending     = $false
    ChangedFile = ""
})

# ─── FileSystemWatchers ───────────────────────────────────────────────────────

$Watchers    = [System.Collections.Generic.List[object]]::new()
$Subscribers = [System.Collections.Generic.List[object]]::new()

$Action = {
    $s = $Event.MessageData
    $s.LastEvent   = [datetime]::Now
    $s.Pending     = $true
    $s.ChangedFile = $Event.SourceArgs[1].Name
}

foreach ($dir in $WatchDirs) {
    $w = [System.IO.FileSystemWatcher]::new($dir)
    $w.IncludeSubdirectories = $true
    $w.Filter                = "*.md"
    $w.NotifyFilter          = [System.IO.NotifyFilters]::LastWrite `
                               -bor [System.IO.NotifyFilters]::FileName `
                               -bor [System.IO.NotifyFilters]::DirectoryName
    $w.EnableRaisingEvents   = $true

    foreach ($ev in @("Changed","Created","Deleted","Renamed")) {
        $Subscribers.Add(
            (Register-ObjectEvent $w $ev -Action $Action -MessageData $State)
        )
    }
    $Watchers.Add($w)
}

# ─── Validation runner ────────────────────────────────────────────────────────

function Invoke-Validate {
    param([string]$Trigger = "")

    $ts    = Get-Date -Format "HH:mm:ss"
    $label = if ($Trigger) { "Изменён: $Trigger" } else { "Проверка при запуске..." }
    Write-Host "  [$ts] $label" -ForegroundColor DarkGray

    $fixFlag = if ($Fix) { "-Fix" } else { "" }
    $cmd = "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; " +
           "`$OutputEncoding = [System.Text.Encoding]::UTF8; " +
           "& '$($Validate -replace "'","''")'  -Force $fixFlag"

    $lines   = powershell.exe -ExecutionPolicy Bypass -NoProfile -Command $cmd 2>&1
    $code    = $LASTEXITCODE

    # Parse summary from output
    $checked = ($lines | Where-Object { $_ -match 'Checked\s+:\s+(\d+)' } |
                Select-Object -First 1) -replace '.*:\s*', '' | ForEach-Object { $_.Trim() }
    $fixed   = ($lines | Where-Object { $_ -match 'Fixed\s+:\s+' } | Select-Object -First 1)

    $ts2 = Get-Date -Format "HH:mm:ss"

    if ($code -eq 0) {
        $suffix = if ($checked) { " ($checked проверено)" } else { "" }
        Write-Host "  [$ts2] " -NoNewline -ForegroundColor DarkGray
        Write-Host "OK$suffix" -ForegroundColor Green
        if ($fixed) {
            Write-Host "  [$ts2] " -NoNewline -ForegroundColor DarkGray
            Write-Host $fixed.Trim() -ForegroundColor Cyan
        }
    } else {
        Write-Host "  [$ts2] " -NoNewline -ForegroundColor DarkGray
        Write-Host "$code битых ссылок" -ForegroundColor Red

        # Print broken entries compactly
        $inBroken = $false
        foreach ($l in $lines) {
            if ($l -match '\[FILE\]') {
                Write-Host "         " -NoNewline
                Write-Host ($l -replace '.*\[FILE\]\s*','') -ForegroundColor Yellow
                $inBroken = $true
            } elseif ($l -match '\[LINK\]' -and $inBroken) {
                Write-Host "           → " -NoNewline -ForegroundColor DarkRed
                Write-Host ($l -replace '.*\[LINK\]\s*','') -ForegroundColor Red
                $inBroken = $false
            }
        }
    }
    Write-Host ""
}

# ─── UI ───────────────────────────────────────────────────────────────────────

function Show-Header {
    Clear-Host
    Write-Host ""
    Write-Host "  ╔══════════════════════════════════════════╗" -ForegroundColor DarkRed
    Write-Host "  ║   VTM Chronicle Manager — Watch Mode     ║" -ForegroundColor DarkRed
    Write-Host "  ╚══════════════════════════════════════════╝" -ForegroundColor DarkRed
    Write-Host ""
    Write-Host "  Папки:   " -NoNewline -ForegroundColor DarkGray
    Write-Host (($WatchDirs | Split-Path -Leaf) -join "  ·  ") -ForegroundColor White
    Write-Host "  Режим:   " -NoNewline -ForegroundColor DarkGray
    if ($Fix) {
        Write-Host "проверка + автоисправление" -ForegroundColor Cyan
    } else {
        Write-Host "только проверка  " -NoNewline -ForegroundColor White
        Write-Host "(добавь -Fix чтобы исправлять автоматически)" -ForegroundColor DarkGray
    }
    Write-Host "  Пауза:   ${Debounce}с после последнего события" -ForegroundColor DarkGray
    Write-Host "  Выход:   Ctrl+C" -ForegroundColor DarkGray
    Write-Host ""
    Write-Host "  ──────────────────────────────────────────────" -ForegroundColor DarkRed
    Write-Host ""
}

# ─── Main loop ────────────────────────────────────────────────────────────────

Show-Header

# Initial validation
Invoke-Validate

try {
    while ($true) {
        Start-Sleep -Milliseconds 300

        if ($State.Pending) {
            $elapsed = ([datetime]::Now - $State.LastEvent).TotalSeconds
            if ($elapsed -ge $Debounce) {
                $file = $State.ChangedFile
                $State.Pending     = $false
                $State.ChangedFile = ""
                Invoke-Validate -Trigger $file
            }
        }
    }
} finally {
    # ─── Cleanup ─────────────────────────────────────────────────────────────
    foreach ($sub in $Subscribers) {
        try { Unregister-Event -SubscriptionId $sub.Id -ErrorAction SilentlyContinue } catch {}
    }
    foreach ($w in $Watchers) {
        $w.EnableRaisingEvents = $false
        $w.Dispose()
    }
    Write-Host "  Watch-режим остановлен." -ForegroundColor DarkGray
    Write-Host ""
}
