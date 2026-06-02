# promote_npc.ps1 — Продвижение модульного НПС в канонические
# Читает упрощённую карточку (Шаблон Г), создаёт полную в characters/,
# обновляет characters_ALL.md, npc_image_mapping.md,
# заменяет ссылки во всех нпс.md модулей.
#
# Usage:
#   .\tools\promote_npc.ps1 -ModuleName "январь_2011_деньги" -NpcName "Ламбер Жирон"

param(
    [Parameter(Mandatory=$true)] [string]$ModuleName,
    [Parameter(Mandatory=$true)] [string]$NpcName
)

$Root       = Split-Path -Parent $PSScriptRoot
$utf8bom    = [System.Text.UTF8Encoding]::new($true)

$srcFile    = Join-Path $Root "modules\$ModuleName\нпс\$NpcName\$NpcName.md"
$allFile    = Join-Path $Root "characters\characters_ALL.md"
$mapFile    = Join-Path $Root "rules\npc_image_mapping.md"

Write-Host ""
Write-Host "=======================================" -ForegroundColor Cyan
Write-Host "  VTM Paris 2010 -- Продвижение НПС" -ForegroundColor Cyan
Write-Host "  $NpcName" -ForegroundColor White
Write-Host "=======================================" -ForegroundColor Cyan
Write-Host ""

if (-not (Test-Path $srcFile)) {
    Write-Host "FAIL: Файл не найден: $srcFile" -ForegroundColor Red
    Write-Host "  Ожидаемый путь: modules\$ModuleName\нпс\$NpcName\$NpcName.md"
    exit 1
}

# ─── Читаем и парсим упрощённую карточку ─────────────────────────────────────

$srcText  = [System.IO.File]::ReadAllText($srcFile, [System.Text.Encoding]::UTF8)
$srcLines = $srcText -split "`n"

function Get-Field {
    param([string[]]$Lines, [string]$Field)
    foreach ($l in $Lines) {
        if ($l -match "^\- \*\*$([regex]::Escape($Field))\*\*: ?(.+)$") {
            return $Matches[1].Trim()
        }
    }
    return "⚠️ Заполнить"
}

# Эмодзи + имя из заголовка
$headerEmoji = "🧛"
if ($srcLines[0] -match "^# (.+?) — ") {
    $headerFull = $Matches[1].Trim()
    if ($headerFull -match "^(.)") { $headerEmoji = $Matches[1] }
}

$wodType   = Get-Field $srcLines "Линейка WoD"
$clan      = Get-Field $srcLines "Клан / Раса"
$role      = Get-Field $srcLines "Роль в модуле"
$status    = Get-Field $srcLines "Статус"
$appearance = Get-Field $srcLines "Внешность"

# Определяем папку линейки
$lineageDir = switch -Regex ($wodType) {
    "Вампир"       { "vampires" }
    "Смертн"       { "mortals"  }
    "Фея|Ченджлинг" { "fairies" }
    "Оборотень"    { "werewolves" }
    "Маг"          { "mages"    }
    "Охотник"      { "hunters"  }
    default        { "vampires" }
}

$charDir  = Join-Path $Root "characters\$lineageDir\$NpcName"
$cardFile = Join-Path $charDir "$NpcName.md"

if (Test-Path $charDir) {
    Write-Host "WARN: папка уже существует: characters\$lineageDir\$NpcName" -ForegroundColor Yellow
    $ans = Read-Host "  Перезаписать? [д/н]"
    if ($ans -notmatch '^[дД]') { exit 1 }
} else {
    New-Item -ItemType Directory -Path $charDir | Out-Null
}

# ─── Строим полную карточку (Шаблон А/Б/В) ───────────────────────────────────

# Извлекаем блок характеристик и промт из источника (если есть)
$promptBlock = ""
$statsBlock  = ""
$inPrompt    = $false
$inStats     = $false

foreach ($l in $srcLines) {
    if ($l -match "## ⚔️ Характеристики") { $inStats = $true }
    if ($l -match "🎨 Промт для генерации") { $inStats = $false; $inPrompt = $true }
    if ($l -match "🚫 Негативный промт") { $inPrompt = $false }
    if ($inPrompt -and -not ($l -match "🎨 Промт")) { $promptBlock += "$l`n" }
    if ($inStats -and -not ($l -match "## ⚔️"))     { $statsBlock += "$l`n" }
}

$promptSection = if ($promptBlock.Trim()) { $promptBlock.Trim() } else { "  [Блок 1] ⚠️ Заполнить`n  [Блок 2] ⚠️ Заполнить`n  [Блок 3] Dark fantasy digital painting, visible painterly brushstrokes, textured oil-paint effect, cinematic composition, moody gothic atmosphere, Vampire the Masquerade aesthetic, concept art quality, painterly realism, artstation quality, masterpiece" }

$cardContent = @"
# $headerEmoji $NpcName

> 🔗 [Все персонажи](../../characters_ALL.md)

---

- **Линейка WoD:** $wodType
- **Клан:** $clan
- **Секта:** ⚠️ Заполнить
- **Поколение:** ⚠️ Заполнить
- **Год рождения:** ⚠️ Заполнить
- **Год обращения:** ⚠️ Заполнить
- **Сир:** ⚠️ Заполнить
- **Дитя:** —
- **Домен / Локация:** ⚠️ Заполнить
- **Парижская иерархия:** ⚠️ Заполнить
- **Роль:** $role
- **Статус:** $status

- **Биография:** ⚠️ Заполнить — расширить из модуля $ModuleName

- **Внешность:** $appearance

- **Дисциплины:** ⚠️ Заполнить

- **Голос:** ⚠️ Заполнить

- **Отношения:**
  - ⚠️ Заполнить

- **📖 Впервые появился:** модуль [$ModuleName](../../modules/$ModuleName/$ModuleName.md)

- **🎨 Промт для генерации изображения:**
$promptSection
- **🚫 Негативный промт:**
  photorealistic photography, digital art, anime, cartoon, illustration, watermark, text overlay, blurry, low quality, artifacts, deformed anatomy, extra limbs, oversaturated colors, bright white background, 3D render, CGI.

---

## 🖼️ Изображения

- ⏳ Изображение не предоставлено
"@

[System.IO.File]::WriteAllText($cardFile, $cardContent, $utf8bom)
Write-Host "  OK  characters\$lineageDir\$NpcName\$NpcName.md" -ForegroundColor Green

# ─── characters_ALL.md ───────────────────────────────────────────────────────

$sectionEndMap = @{
    "vampires"   = "`n---`n`n## 🧚 Феи"
    "fairies"    = "`n---`n`n## 🧑 Смертные"
    "mortals"    = "`n---`n`n## 📂 Пустые"
}

$sectionEnd = $sectionEndMap[$lineageDir]
if ($sectionEnd) {
    $allRaw    = [System.IO.File]::ReadAllBytes($allFile)
    $allHasBom = ($allRaw[0] -eq 0xEF -and $allRaw[1] -eq 0xBB -and $allRaw[2] -eq 0xBF)
    $allText   = [System.IO.File]::ReadAllText($allFile, [System.Text.Encoding]::UTF8) -replace "`r`n", "`n"

    $enc       = $NpcName -replace ' ', '%20'
    $linkMd    = "[$headerEmoji $NpcName]($lineageDir/$enc/$enc.md)"
    $entry     = "`n`n### $linkMd`n- **Клан / Раса:** $clan`n- **Секта / Двор:** ⚠️ Заполнить`n- **Роль:** $role`n- **Лист:** —`n- **Арт:** ⏳ Не предоставлено"

    if ($allText.Contains($sectionEnd)) {
        $allText = $allText.Replace($sectionEnd, "$entry$sectionEnd")
        [System.IO.File]::WriteAllText($allFile, $allText, [System.Text.UTF8Encoding]::new($allHasBom))
        Write-Host "  OK  characters_ALL.md" -ForegroundColor Green
    } else {
        Write-Host "  WARN: Секция '$lineageDir' не найдена — добавьте вручную" -ForegroundColor Yellow
    }
} else {
    Write-Host "  WARN: Тип '$lineageDir' — добавьте в characters_ALL.md вручную" -ForegroundColor Yellow
}

# ─── npc_image_mapping.md ────────────────────────────────────────────────────

$mapRaw    = [System.IO.File]::ReadAllBytes($mapFile)
$mapHasBom = ($mapRaw[0] -eq 0xEF -and $mapRaw[1] -eq 0xBB -and $mapRaw[2] -eq 0xBF)
$mapText   = [System.IO.File]::ReadAllText($mapFile, [System.Text.Encoding]::UTF8) -replace "`r`n", "`n"
$mapMarker = "`n`n---`n`nВажные"

if ($mapText.Contains($mapMarker)) {
    $mapText = $mapText.Replace($mapMarker, "`n| $NpcName | ⚠️ Заполнить |$mapMarker")
    [System.IO.File]::WriteAllText($mapFile, $mapText, [System.Text.UTF8Encoding]::new($mapHasBom))
    Write-Host "  OK  npc_image_mapping.md" -ForegroundColor Green
} else {
    Write-Host "  WARN: Добавьте строку в npc_image_mapping.md вручную" -ForegroundColor Yellow
}

# ─── Обновляем ссылки во всех нпс.md модулей ─────────────────────────────────

$npcMdFiles = Get-ChildItem -Path (Join-Path $Root "modules") -Recurse -Filter "нпс.md" -ErrorAction SilentlyContinue
$oldLinkPat = "нпс/$NpcName/$NpcName.md"
$newLink    = "../../characters/$lineageDir/$($NpcName -replace ' ', '%20')/$($NpcName -replace ' ', '%20').md"
$updated    = 0

foreach ($f in $npcMdFiles) {
    $txt = [System.IO.File]::ReadAllText($f.FullName, [System.Text.Encoding]::UTF8)
    if ($txt.Contains($oldLinkPat)) {
        $txt = $txt.Replace($oldLinkPat, $newLink)
        $fBytes  = [System.IO.File]::ReadAllBytes($f.FullName)
        $fHasBom = ($fBytes[0] -eq 0xEF -and $fBytes[1] -eq 0xBB -and $fBytes[2] -eq 0xBF)
        [System.IO.File]::WriteAllText($f.FullName, $txt, [System.Text.UTF8Encoding]::new($fHasBom))
        Write-Host "  OK  Ссылка обновлена: modules\$($f.Directory.Parent.Name)\нпс.md" -ForegroundColor Green
        $updated++
    }
}

if ($updated -eq 0) {
    Write-Host "  INFO: Ссылки на '$NpcName' в нпс.md не найдены (или уже обновлены)" -ForegroundColor DarkGray
}

# ─── Помечаем исходный файл как продвинутый ──────────────────────────────────

$srcNew = "[ПРОДВИНУТ] Перемещён в characters/$lineageDir/$NpcName/"
$srcText = "# ПРОДВИНУТ`n`n> Этот персонаж стал каноничным.`n> Карточка: [characters/$lineageDir/$NpcName](../../../../characters/$lineageDir/$($NpcName -replace ' ','%20')/$($NpcName -replace ' ','%20').md)`n`n---`n`n" + $srcText
[System.IO.File]::WriteAllText($srcFile, $srcText, $utf8bom)
Write-Host "  OK  Исходный файл помечен как продвинутый" -ForegroundColor DarkGray

# ─── Итог ─────────────────────────────────────────────────────────────────────

Write-Host ""
Write-Host "=======================================" -ForegroundColor Green
Write-Host "  OK  $NpcName -> characters/" -ForegroundColor Green
Write-Host "=======================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Требует Claude:" -ForegroundColor Yellow
Write-Host "    -- Расширить биографию"
Write-Host "    -- Заполнить поля: поколение, сир, иерархия, дисциплины, голос"
Write-Host "    -- Цвет фона в npc_image_mapping.md"
Write-Host "    -- Обратные ссылки в карточки связанных персонажей"
Write-Host ""
Write-Host "  tools\validate_links.ps1" -ForegroundColor DarkGray
Write-Host ""
Write-Host "  Нажмите любую клавишу..." -ForegroundColor DarkGray
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
