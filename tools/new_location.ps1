# new_location.ps1 — Создание карточки локации
# Создаёт папку и шаблон в locations/ с обязательными полями и промтом.
#
# Usage:
#   # Парижская локация:
#   .\tools\new_location.ps1 -Name "Склад в Ла-Курнёв" -District "Сен-Дени_93" -Zone dangerous -Angle wide-angle
#
#   # Локация вне Парижа:
#   .\tools\new_location.ps1 -Name "Вилла в Лионе" -District Другие -Module "февраль_2011_лион" -Zone neutral -Angle street-level
#
# После создания Claude пишет: атмосферу, сенсорную палитру, крючки, уточняет промт.

param(
    [Parameter(Mandatory=$true)]  [string]$Name,
    [Parameter(Mandatory=$true)]  [string]$District,
    [string]$Module = "",

    [ValidateSet("safe","neutral","dangerous")]
    [string]$Zone  = "neutral",

    [ValidateSet("wide-angle","street-level","low angle","corridor")]
    [string]$Angle = "wide-angle"
)

$Root    = Split-Path -Parent $PSScriptRoot
$utf8bom = [System.Text.UTF8Encoding]::new($true)

# ─── Путь ────────────────────────────────────────────────────────────────────

$safeName = $Name -replace '[:\\/*?"<>|]', '_'

if ($District -eq "Другие") {
    if (-not $Module) {
        Write-Host "FAIL: Для -District Другие необходим параметр -Module" -ForegroundColor Red
        exit 1
    }
    $locDir  = Join-Path $Root "locations\Другие\$Module\$safeName"
    $backPath = "../../../../Stories_of_Paris.md"
} else {
    $locDir  = Join-Path $Root "locations\$District\$safeName"
    $backPath = "../../../Stories_of_Paris.md"
}

$cardFile = Join-Path $locDir "$safeName.md"

Write-Host ""
Write-Host "=======================================" -ForegroundColor Cyan
Write-Host "  VTM Paris 2010 -- Новая локация" -ForegroundColor Cyan
Write-Host "  $Name" -ForegroundColor White
Write-Host "  District: $District  Zone: $Zone  Angle: $Angle" -ForegroundColor DarkGray
Write-Host "=======================================" -ForegroundColor Cyan
Write-Host ""

if (Test-Path $locDir) {
    Write-Host "WARN: папка уже существует" -ForegroundColor Yellow
    exit 1
}

New-Item -ItemType Directory -Path $locDir | Out-Null

# ─── Зона и контроль ─────────────────────────────────────────────────────────

$zoneLabel = switch ($Zone) {
    "safe"      { "🟢 Безопасная" }
    "neutral"   { "🟡 Нейтральная" }
    "dangerous" { "🔴 Опасная" }
}

$districtLabel = if ($District -eq "Другие") {
    "Вне Парижа | $Module"
} else {
    $District -replace '_', '-'
}

# ─── Базовый промт ───────────────────────────────────────────────────────────
# Содержит все обязательные элементы из rules/portret.md.
# Claude уточняет детали (поверхность, источник света, архитектуру).

$surfaceHint = switch ($Zone) {
    "safe"      { "wet cobblestones" }
    "neutral"   { "wet pavement" }
    "dangerous" { "wet concrete" }
}

$lightHint = switch ($Zone) {
    "safe"      { "warm brasserie windows and amber streetlamps" }
    "neutral"   { "amber streetlamps" }
    "dangerous" { "distant orange streetlights" }
}

$basePrompt = "$Name, Paris 2010, night, $surfaceHint reflecting $lightHint, atmospheric fog and mist, warm amber streetlamps contrast cold dark blue night sky, no people, cinematic $Angle composition, dark gothic World of Darkness atmosphere, photorealistic concept art, VtM Bloodhunt visual style, highly detailed, 1920x1080"

# ─── Карточка ─────────────────────────────────────────────────────────────────

# Тройные бэктики вынесены в переменную — внутри @"..."@ они вызывают line-continuation
$fence = '```'

$cardContent = @"
# $Name

> 🗺️ **Округ:** $districtLabel | **Зона:** $zoneLabel | **Контроль:** ⚠️ Заполнить

---

## 🎭 Атмосфера

⚠️ Заполнить — 2–3 абзаца: что видит Котери, приходя сюда; специфика района; ночная жизнь смертных; атмосферная деталь.

## 👁️ Сенсорная палитра

| | |
|---|---|
| **Свет** | ⚠️ Заполнить |
| **Звук** | ⚠️ Заполнить |
| **Запах** | ⚠️ Заполнить |
| **Тактильное** | ⚠️ Заполнить |

---

## 🩸 Контекст Камарильи / Масок

| | |
|---|---|
| **Статус** | ⚠️ Заполнить — чья территория, спорная или нейтральная |
| **Фракция** | ⚠️ Заполнить |
| **Угрозы** | ⚠️ Заполнить |
| **Маскарад** | ⚠️ Заполнить — 🟢/🟡/🔴 риск + пояснение |

## 🪝 Сценарные крючки

1. ⚠️ Заполнить
2. ⚠️ Заполнить
3. ⚠️ Заполнить

---

## 🖼️ Изображения

- ⏳ Изображение не предоставлено

---

## 🎨 Промт для генерации изображения

**GPT / DALL-E 3:**
$fence
$basePrompt
$fence

**Негативный промт (SD / Flux):**
$fence
daytime, sunlight, crowds of people, faces in foreground, modern post-2010 elements, anime, cartoon, flat lighting, low quality, blurry, text overlay, watermark, oversaturated colors, 3D plastic render, deformed
$fence
"@

[System.IO.File]::WriteAllText($cardFile, $cardContent, $utf8bom)

# ─── Итог ─────────────────────────────────────────────────────────────────────

$relPath = if ($District -eq "Другие") {
    "locations\Другие\$Module\$safeName\$safeName.md"
} else {
    "locations\$District\$safeName\$safeName.md"
}

Write-Host "  OK  $relPath" -ForegroundColor Green
Write-Host ""
Write-Host "  Требует Claude:" -ForegroundColor Yellow
Write-Host "    -- Атмосфера (2-3 абзаца)"
Write-Host "    -- Сенсорная палитра (свет, звук, запах, тактильное)"
Write-Host "    -- Контекст Камарильи (статус, угрозы, Маскарад)"
Write-Host "    -- 3 сценарных крючка"
Write-Host "    -- Уточнить промт (поверхность, источник света, акценты)"
Write-Host ""
Write-Host "  Нажмите любую клавишу..." -ForegroundColor DarkGray
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
