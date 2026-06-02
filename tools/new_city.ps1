# new_city.ps1 — Настройка нового домена VtM
# Заменяет [ГОРОД]/[ГОД] во всех ключевых файлах,
# переименовывает файл хроники и фракций,
# создаёт папки районов в locations/.
#
# Usage:
#   .\tools\new_city.ps1
#   .\tools\new_city.ps1 -City "Берлин" -Year "2010"
#
# Запускать ОДИН РАЗ при старте нового проекта из шаблона.

param(
    [string]$City    = "",
    [string]$Year    = "",
    [string]$Country = ""
)

$Root    = Split-Path -Parent $PSScriptRoot
$utf8bom = [System.Text.UTF8Encoding]::new($true)

function Update-File {
    param([string]$Path, [string]$From, [string]$To)
    if (-not (Test-Path $Path)) { return $false }
    $raw    = [System.IO.File]::ReadAllBytes($Path)
    $hasBom = ($raw[0] -eq 0xEF -and $raw[1] -eq 0xBB -and $raw[2] -eq 0xBF)
    $text   = [System.IO.File]::ReadAllText($Path, [System.Text.Encoding]::UTF8) -replace "`r`n", "`n"
    $new    = $text.Replace($From, $To)
    if ($new -eq $text) { return $false }
    [System.IO.File]::WriteAllText($Path, $new, [System.Text.UTF8Encoding]::new($hasBom))
    return $true
}

Write-Host ""
Write-Host "=======================================" -ForegroundColor Cyan
Write-Host "  VTM Chronicle Manager -- Новый домен" -ForegroundColor Cyan
Write-Host "=======================================" -ForegroundColor Cyan
Write-Host ""

# ─── Проверка: домен уже настроен? ───────────────────────────────────────────

$claudePath = Join-Path $Root "CLAUDE.md"
$claudeText = [System.IO.File]::ReadAllText($claudePath, [System.Text.Encoding]::UTF8)
if ($claudeText -notmatch '\[ГОРОД\]') {
    Write-Host "  WARN: В CLAUDE.md не найдено [ГОРОД]." -ForegroundColor Yellow
    Write-Host "  Домен уже настроен, или файл был изменён вручную."
    Write-Host ""
    $force = Read-Host "  Продолжить всё равно? [д/н]"
    if ($force -notmatch '^[дД]') { exit 0 }
    Write-Host ""
}

# ─── Сбор данных ─────────────────────────────────────────────────────────────

if (-not $City) {
    $City = (Read-Host "  Название города").Trim()
}
if (-not $City) {
    Write-Host "FAIL: Название города не может быть пустым" -ForegroundColor Red
    exit 1
}

if (-not $Year) {
    $Year = (Read-Host "  Год хроники (четыре цифры)").Trim()
}
if ($Year -notmatch '^\d{4}$') {
    Write-Host "FAIL: Год должен быть четырёхзначным числом (например 2010)" -ForegroundColor Red
    exit 1
}

Write-Host ""
$rawDistricts = (Read-Host "  Районы через запятую (Enter — пропустить)").Trim()
$districts = @()
if ($rawDistricts) {
    $districts = $rawDistricts -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ }
}

Write-Host ""
Write-Host "  Город : $City"    -ForegroundColor White
Write-Host "  Год   : $Year"    -ForegroundColor White
if ($districts.Count) {
    Write-Host "  Районы: $($districts -join ', ')" -ForegroundColor White
}
Write-Host ""
$confirm = (Read-Host "  Применить? [д/н]").Trim()
if ($confirm -notmatch '^[дД]') { Write-Host "  Отменено."; exit 0 }
Write-Host ""

$safeCityName = $City -replace '[:\\/*?"<>| ]', '_'
$changed = 0

# ─── Замена [ГОРОД] / [ГОД] в текстовых файлах ──────────────────────────────

$targets = @(
    "CLAUDE.md", "README.md", "SETUP.md",
    "factions.md", "factions_paris.md",
    "rumors_elysium.md", "rumors_dreaming.md",
    "characters\characters_ALL.md"
)

foreach ($rel in $targets) {
    $path = Join-Path $Root $rel
    $ok1 = Update-File $path "[ГОРОД]" $City
    $ok2 = Update-File $path "[ГОД]"   $Year
    if ($ok1 -or $ok2) {
        Write-Host "  OK  $rel" -ForegroundColor Green
        $changed++
    }
}

# ─── Переименование factions_paris.md → factions.md ─────────────────────────

$oldFactions = Join-Path $Root "factions_paris.md"
$newFactions = Join-Path $Root "factions.md"
if ((Test-Path $oldFactions) -and -not (Test-Path $newFactions)) {
    Rename-Item $oldFactions $newFactions -Force
    Write-Host "  OK  factions_paris.md → factions.md" -ForegroundColor Green
    $changed++

    # Обновить ссылки на старое имя во всех .md
    Get-ChildItem $Root -Recurse -Filter "*.md" | ForEach-Object {
        Update-File $_.FullName "factions_paris.md" "factions.md" | Out-Null
    }
}

# ─── Переименование файла хроники ────────────────────────────────────────────

$chronicleOld = Get-ChildItem $Root -Filter "Stories_of_*.md" -File | Select-Object -First 1
if ($chronicleOld) {
    $chronicleNewName = "Stories_of_$safeCityName.md"
    $chronicleNew     = Join-Path $Root $chronicleNewName
    if ($chronicleOld.FullName -ne $chronicleNew) {
        Rename-Item $chronicleOld.FullName $chronicleNew -Force
        Write-Host "  OK  $($chronicleOld.Name) → $chronicleNewName" -ForegroundColor Green
        $changed++

        # Обновить ссылки на старое имя
        foreach ($rel in @("README.md", "CLAUDE.md", "SETUP.md")) {
            Update-File (Join-Path $Root $rel) $chronicleOld.Name $chronicleNewName | Out-Null
        }
    }
}

# ─── Папки районов в locations/ ──────────────────────────────────────────────

if ($districts.Count) {
    $locRoot = Join-Path $Root "locations"
    foreach ($d in $districts) {
        $safe = $d -replace '[:\\/*?"<>|]', '_'
        $dir  = Join-Path $locRoot $safe
        if (-not (Test-Path $dir)) {
            New-Item -ItemType Directory -Path $dir -Force | Out-Null
            New-Item -ItemType File -Path (Join-Path $dir ".gitkeep") -Force | Out-Null
            Write-Host "  OK  locations\$safe\" -ForegroundColor DarkGray
            $changed++
        }
    }
}

# ─── Итог ─────────────────────────────────────────────────────────────────────

Write-Host ""
Write-Host "=======================================" -ForegroundColor Green
Write-Host "  OK  $City, $Year — домен настроен" -ForegroundColor Green
Write-Host "  Изменено объектов: $changed"
Write-Host "=======================================" -ForegroundColor Green
Write-Host ""

# Подсчитать оставшиеся [ЗАПОЛНИТЬ]
$claudeRefresh = [System.IO.File]::ReadAllText($claudePath, [System.Text.Encoding]::UTF8)
$fillCount     = ([regex]::Matches($claudeRefresh, '\[ЗАПОЛНИТЬ\]')).Count

Write-Host "  Осталось заполнить:" -ForegroundColor Yellow
Write-Host "    -- $fillCount секций [ЗАПОЛНИТЬ] в CLAUDE.md"
Write-Host "       (политика, история, локации, лейтмотивы)"
Write-Host "    -- factions.md          (Князь, Примогены, фракции)"
Write-Host "    -- rumors_elysium.md    (20 слухов Элизиума)"
Write-Host "    -- rumors_dreaming.md   (20 слухов Грёзы — если нужно)"
Write-Host ""
Write-Host "  Следующий шаг:" -ForegroundColor Cyan
Write-Host "    .\tools\new_npc.ps1 -Name `"Имя`" -Type vampire"
Write-Host "    .\tools\new_module.ps1"
Write-Host ""
Write-Host "  Нажмите любую клавишу..." -ForegroundColor DarkGray
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
