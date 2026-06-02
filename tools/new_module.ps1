# new_module.ps1 — Интерактивный мастер создания модуля
# Usage: .\tools\new_module.ps1 "месяц_ГГГГ_название"
# Example: .\tools\new_module.ps1 "декабрь_2010_опера"

param(
    [Parameter(Mandatory=$true)]
    [string]$Name
)

$Root      = Split-Path -Parent $PSScriptRoot
$ModuleDir = Join-Path $Root "modules\$Name"
$ShortName = $Name -replace '^\w+_\d{4}_', ''
$utf8bom   = [System.Text.UTF8Encoding]::new($true)

if ($Name -match '^(\w+)_(\d{4})_') {
    $Month = $Matches[1]
    $Year  = $Matches[2]
    $Date  = "$Month $Year"
} else {
    $Date = $Name
}

if (Test-Path $ModuleDir) {
    Write-Host "WARN: папка уже существует: modules\$Name" -ForegroundColor Yellow
    exit 1
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  VTM Paris 2010 -- Новый модуль" -ForegroundColor Cyan
Write-Host "  $Date -- $ShortName" -ForegroundColor White
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# ─── Шаг 1: Связь с предыдущей хроникой ─────────────────────────────────────

$linkedDisplayName = ""
$linkedFinaleNote  = ""

$linkAnswer = Read-Host "Связан ли этот модуль с другими хрониками/модулями? [д/н]"
if ($linkAnswer -match '^[дД]') {
    $modulesRoot = Join-Path $Root "modules"
    $finaleFiles = Get-ChildItem -Path $modulesRoot -Recurse -Filter "финал.md" -ErrorAction SilentlyContinue

    if ($null -eq $finaleFiles -or $finaleFiles.Count -eq 0) {
        Write-Host "  Нет модулей с финалом. Продолжаем без связи." -ForegroundColor Yellow
    } else {
        Write-Host ""
        Write-Host "  Модули с финалом:" -ForegroundColor Cyan
        $finaleList = @()
        foreach ($f in $finaleFiles) {
            $finaleList += $f.Directory.Name
        }
        for ($i = 0; $i -lt $finaleList.Count; $i++) {
            Write-Host "    $($i + 1). $($finaleList[$i])"
        }
        Write-Host ""
        $sel = Read-Host "  Введите номер связанного модуля (Enter — пропустить)"
        if ($sel -match '^\d+$') {
            $idx = [int]$sel - 1
            if ($idx -ge 0 -and $idx -lt $finaleList.Count) {
                $linkedDisplayName = $finaleList[$idx]
                $linkedFinaleNote  = @"

> ⛓️ **Связан с:** [Финал — $linkedDisplayName](../../modules/$linkedDisplayName/финал.md)
> 📖 При написании сценария учитывать события финала предыдущего модуля.
"@
            }
        }
    }
}

# ─── Шаг 2: НПС ──────────────────────────────────────────────────────────────

Write-Host ""
$npcInput = Read-Host "Перечислите НПС модуля через запятую (Enter — пропустить)"
$npcNames = @()
if ($npcInput.Trim() -ne "") {
    $npcNames = ($npcInput -split ",") | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne "" }
}

# ─── Шаг 3: Локации ──────────────────────────────────────────────────────────

$locInput = Read-Host "Перечислите локации через запятую (Enter — пропустить)"
$locNames = @()
if ($locInput.Trim() -ne "") {
    $locNames = ($locInput -split ",") | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne "" }
}

# ─── Создание структуры ───────────────────────────────────────────────────────

New-Item -ItemType Directory -Path $ModuleDir            | Out-Null
New-Item -ItemType Directory -Path "$ModuleDir\нпс"      | Out-Null

Write-Host ""
Write-Host "  Создание файлов..." -ForegroundColor DarkGray

# ─── [описание].md ───────────────────────────────────────────────────────────

$mainFile    = Join-Path $ModuleDir "$ShortName.md"
$mainContent = @"
# $Date — $ShortName
> Хроника | Vampire: The Masquerade V20 / Changeling: The Dreaming

> 🔗 [Хроника: $Date](../../Stories_of_Paris.md)

---

| Параметр | Значение |
|---|---|
| **Тип** | Игровая сессия |
| **Время** | $Date |
| **Локация** | ⚠️ Заполнить |

---

⚠️ Краткое содержание — заполнить после сессии.

> 🔗 Дневники: ⚠️ Ссылки — заполнить
"@
[System.IO.File]::WriteAllText($mainFile, $mainContent, $utf8bom)

# ─── сценарий.md ─────────────────────────────────────────────────────────────

$scenFile = Join-Path $ModuleDir "сценарий.md"

$npcScenBlock = if ($npcNames.Count -gt 0) {
    ($npcNames | ForEach-Object { "- $_" }) -join "`n"
} else { "- ⚠️ Заполнить" }

$locBlock = if ($locNames.Count -gt 0) {
    ($locNames | ForEach-Object { "- $_ → 🔗 ⚠️ Ссылка на карточку локации" }) -join "`n"
} else { "- ⚠️ Заполнить" }

$scenContent = @"
# Сценарий — $ShortName
> 🔗 [Модуль]($ShortName.md) | [Хроника](../../Stories_of_Paris.md)
$linkedFinaleNote
---

## 📌 Предпосылки

⚠️ Что привело Котери к этому событию. Политический, личный или случайный контекст.

---

## 🗺️ Локации

$locBlock

---

## 👥 НПС

$npcScenBlock

---

## 🎯 Завязка

⚠️ Как Котери втягивается в события. Крючок — 1–2 предложения.

---

## 🎭 Сцены

### Сцена 1 — ⚠️ Название
- **Локация:** ⚠️
- **НПС:** ⚠️
- **Цель:** ⚠️
- **Описание:** ⚠️

### Сцена 2 — ⚠️ Название
- **Локация:** ⚠️
- **НПС:** ⚠️
- **Цель:** ⚠️
- **Описание:** ⚠️

### Сцена 3 — ⚠️ Название
- **Локация:** ⚠️
- **НПС:** ⚠️
- **Цель:** ⚠️
- **Описание:** ⚠️

---

## 💥 Кульминация

⚠️ Финальное столкновение / решение / выбор. 1 абзац.

---

## 🔚 Варианты финала

- **Успех:** ⚠️
- **Провал:** ⚠️
- **Нейтральный:** ⚠️

---

## 🔗 Крючки для следующей хроники

- ⚠️ Открытая нить 1
- ⚠️ Открытая нить 2

---

## 📎 Парижский колорит

⚠️ 2–3 специфически парижские детали: район, смертные, язык, культурный контекст.
"@
[System.IO.File]::WriteAllText($scenFile, $scenContent, $utf8bom)

# ─── нпс.md ──────────────────────────────────────────────────────────────────

$npcFile = Join-Path $ModuleDir "нпс.md"

$canonBlock = if ($npcNames.Count -gt 0) {
    ($npcNames | ForEach-Object {
        "- ⚠️ $_ — роль в модуле → 🔗 [Карточка](../../characters/[линейка]/$_.md) *(уточнить: каноничный или модульный?)*"
    }) -join "`n"
} else { "- ⚠️ Заполнить" }

$npcContent = @"
# НПС модуля — «$ShortName»

> 🔗 [Модуль]($ShortName.md) | [Хроника](../../Stories_of_Paris.md)
> ℹ️ Каноничные НПС → ссылка на карточку в ``characters/``. Модульные (неканоничные) → карточки в ``нпс/``.

---

## 🎭 Игровые персонажи (ПК)

- ⚠️ Имя — Клан, роль → 🔗 [Карточка](../../characters/[линейка]/Имя.md)

---

## 📚 Каноничные НПС

$canonBlock

---

## 🆕 Модульные НПС (неканоничные)

> Карточки хранятся в ``нпс/``. Станут каноничными при выполнении условий из ``rules/module_rules.md``.

- ⚠️ Имя — роль → 🔗 [Карточка](нпс/Имя/Имя.md)
"@
[System.IO.File]::WriteAllText($npcFile, $npcContent, $utf8bom)

# ─── Итог ─────────────────────────────────────────────────────────────────────

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  OK  modules\$Name" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Файлы:" -ForegroundColor Cyan
Write-Host "    modules\$Name\$ShortName.md    <- лог сессии (заполнить после)"
Write-Host "    modules\$Name\сценарий.md      <- сценарий Мастера (заполнить до)"
Write-Host "    modules\$Name\нпс.md           <- список НПС"
Write-Host "    modules\$Name\нпс\             <- папка для модульных НПС"
if ($linkedDisplayName -ne "") {
    Write-Host ""
    Write-Host "  Связан с: modules\$linkedDisplayName\финал.md" -ForegroundColor Yellow
}
Write-Host ""
Write-Host "  Следующие шаги:" -ForegroundColor Cyan
Write-Host "    1. Попросить Claude заполнить сценарий.md (сцены, кульминация)"
if ($npcNames.Count -gt 0) {
    Write-Host "    2. Для каждого НПС уточнить: каноничный или модульный"
    Write-Host "       Каноничный -> characters/[линейка]/Имя.md"
    Write-Host "       Модульный  -> modules\$Name\нпс\Имя\Имя.md (упрощённый лист)"
} else {
    Write-Host "    2. Заполнить список НПС в нпс.md"
}
if ($locNames.Count -gt 0) {
    Write-Host "    3. Для каждой локации проверить наличие карточки:"
    Write-Host "       tools\search.ps1 `"Название`""
    Write-Host "       Если нет -> создать по rules/portret.md"
} else {
    Write-Host "    3. Заполнить список локаций в сценарий.md"
}
Write-Host "    4. Добавить запись в Stories_of_Paris.md"
Write-Host "    5. Создать финал.md когда сессия разыграна"
Write-Host "    6. Запустить tools\validate_links.ps1"
Write-Host ""
Write-Host "  Нажмите любую клавишу для закрытия..." -ForegroundColor DarkGray
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
