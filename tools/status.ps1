param(
    [string]$Root   = (Split-Path -Parent $PSScriptRoot),
    [string]$Status = "",
    [string]$Clan   = ""
)

function Get-Field([string[]]$lines, [string]$fieldPattern) {
    $line = $lines | Where-Object { $_ -match $fieldPattern } | Select-Object -First 1
    if (-not $line) { return "" }
    [string]($line -replace "^.*$fieldPattern\s*", "")
}

$chars    = @()
$folders  = @("vampires","fairies","mortals","werewolves","mages","hunters")

foreach ($folder in $folders) {
    $dir = Join-Path $Root "characters\$folder"
    if (-not (Test-Path $dir)) { continue }

    Get-ChildItem -Path $dir -Filter "*.md" |
        Where-Object { $_.Name -notmatch "-лист\.md$" } |
        ForEach-Object {
            $lines = [System.IO.File]::ReadAllLines($_.FullName, [System.Text.Encoding]::UTF8)

            $h1   = [string]($lines | Where-Object { $_ -match '^# ' } | Select-Object -First 1)
            $name = ($h1 -replace '^#\s+', '') -replace '^[\p{So}\p{Cs}️]+\s*', ''

            $clan      = Get-Field $lines '\*\*(Клан|Клан \/ Раса|Раса):\*\*'
            $statusVal = Get-Field $lines '\*\*Статус:\*\*'
            $sheetVal  = Get-Field $lines '\*\*Лист:\*\*'

            # Check for active FIRST — then torpor (active status often mentions torpor in parens)
            $statusShort =
                if     ($statusVal -imatch 'Активен|Активна')    { "Активен" }
                elseif ($statusVal -imatch 'Уничтож')            { "Уничтожен" }
                elseif ($statusVal -imatch 'Торпор')             { "Торпор" }
                elseif ($statusVal -imatch 'Пропал')             { "Пропал" }
                elseif ($statusVal -imatch 'Смертн')             { "Смертный" }
                elseif ($statusVal -ne '')                       { ($statusVal -split '[(\[]')[0].Trim() }
                else                                             { "—" }

            $sheetPath  = $_.FullName -replace '\.md$', '-лист.md'
            $sheetShort = if (Test-Path $sheetPath) { "Yes" } else { "—" }

            $chars += [PSCustomObject]@{
                Name    = $name.Trim()
                Clan    = $clan.Trim()
                Status  = $statusShort
                Sheet   = $sheetShort
                Lineage = $folder
            }
        }
}

if ($Status) { $chars = $chars | Where-Object { $_.Status -match $Status } }
if ($Clan)   { $chars = $chars | Where-Object { $_.Clan   -match $Clan   } }

Write-Host ""
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "  VTM Paris 2010 -- Character Status" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

$groups = $chars | Group-Object Lineage
foreach ($g in $groups) {
    Write-Host ""
    Write-Host "  [$($g.Name.ToUpper())]" -ForegroundColor Yellow
    Write-Host ("  {0,-32} {1,-22} {2,-14} {3}" -f "Name","Clan","Status","Sheet") -ForegroundColor DarkGray
    Write-Host ("  " + "-" * 74) -ForegroundColor DarkGray

    foreach ($c in $g.Group | Sort-Object Status, Name) {
        $color = switch ($c.Status) {
            "Активен"    { "Green" }
            "Торпор"     { "DarkYellow" }
            "Уничтожен"  { "DarkRed" }
            default      { "Gray" }
        }
        Write-Host ("  {0,-32} {1,-22} {2,-14} {3}" -f $c.Name, $c.Clan, $c.Status, $c.Sheet) -ForegroundColor $color
    }
}

Write-Host ""
Write-Host ("  Total: {0} characters" -f $chars.Count) -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Нажмите любую клавишу для закрытия..." -ForegroundColor DarkGray
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")