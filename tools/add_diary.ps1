# add_diary.ps1 — Создание файла дневника персонажа
# Находит папку персонажа, создаёт Journal_[Имя]/ если нужно,
# создаёт шаблон дневниковой записи по правилам diary_rules.md.
#
# Usage:
#   .\tools\add_diary.ps1 -CharacterName "Эмилия" -Period "2011-02"
#   .\tools\add_diary.ps1 -CharacterName "Верене де Кюстин" -Period retrospective
#   .\tools\add_diary.ps1 -CharacterName "Джек" -Period "2010-11" -ModuleRef "ноябрь_2010_кошки_и_мышки"

param(
    [Parameter(Mandatory=$true)] [string]$CharacterName,
    [Parameter(Mandatory=$true)] [string]$Period,
    [string]$ModuleRef = ""
)

$Root    = Split-Path -Parent $PSScriptRoot
$utf8bom = [System.Text.UTF8Encoding]::new($true)

Write-Host ""
Write-Host "=======================================" -ForegroundColor Cyan
Write-Host "  VTM Paris 2010 -- Дневник" -ForegroundColor Cyan
Write-Host "  $CharacterName / $Period" -ForegroundColor White
Write-Host "=======================================" -ForegroundColor Cyan
Write-Host ""

# ─── Поиск папки персонажа ───────────────────────────────────────────────────

$lineages = @("vampires","mortals","fairies","werewolves","mages","hunters")
$charDir  = $null
$lineage  = $null

foreach ($lg in $lineages) {
    $candidate = Join-Path $Root "characters\$lg\$CharacterName"
    if (Test-Path $candidate) {
        $charDir = $candidate
        $lineage = $lg
        break
    }
}

if (-not $charDir) {
    Write-Host "FAIL: Персонаж '$CharacterName' не найден в characters/" -ForegroundColor Red
    Write-Host "  Проверьте написание имени (регистр важен)."
    Write-Host "  Ожидается папка: characters/[линейка]/$CharacterName/"
    exit 1
}

Write-Host "  Персонаж найден: characters\$lineage\$CharacterName" -ForegroundColor DarkGray

# ─── Имя журнала ─────────────────────────────────────────────────────────────

# Первое слово имени (без скобок) -> Journal_Имя
$firstName   = ($CharacterName -split '\s+')[0] -replace '[()]', ''
$journalName = "Journal_$firstName"

# Проверка коллизии: если папка Journal_Имя принадлежит другому персонажу,
# используем Journal_ПолноеИмя (через подчёркивание)
$journalDir = Join-Path $charDir $journalName
$collision  = $false

Get-ChildItem -Path (Join-Path $Root "characters") -Recurse -Directory |
    Where-Object { $_.Name -eq $journalName -and $_.FullName -ne $journalDir } |
    ForEach-Object { $collision = $true }

if ($collision) {
    $journalName = "Journal_" + ($CharacterName -replace '\s+', '_' -replace '[()]', '')
    $journalDir  = Join-Path $charDir $journalName
    Write-Host "  INFO: Коллизия имён — использую '$journalName'" -ForegroundColor Yellow
}

if (-not (Test-Path $journalDir)) {
    New-Item -ItemType Directory -Path $journalDir | Out-Null
    Write-Host "  Создана папка: $journalName\" -ForegroundColor DarkGray
}

# ─── Имя файла ───────────────────────────────────────────────────────────────

$fileName = if ($Period -eq "retrospective") { "retrospective.md" } else { "$Period.md" }
$diaryFile = Join-Path $journalDir $fileName

if (Test-Path $diaryFile) {
    Write-Host "WARN: Файл уже существует: $journalName\$fileName" -ForegroundColor Yellow
    $ans = Read-Host "  Добавить новую сцену в конец файла? [д/н]"
    if ($ans -notmatch '^[дД]') { exit 0 }
    $appendMode = $true
} else {
    $appendMode = $false
}

# ─── Ссылки ──────────────────────────────────────────────────────────────────

# От дневника до карточки персонажа: ../[Name].md (выход из Journal_X/ в папку персонажа)
$cardRelPath = "../$CharacterName.md"

# От дневника до Stories_of_Paris.md: 4 уровня вверх (Journal_X -> Имя -> линейка -> characters -> root)
$storiesPath = "../../../../Stories_of_Paris.md"

$moduleLink = if ($ModuleRef) {
    "`n> 🔗 [Модуль: $ModuleRef](../../../../modules/$ModuleRef/$($ModuleRef -split '_' | Select-Object -Skip 2 | Join-String -Separator '_').md)"
} else { "" }

# ─── Период и стиль ──────────────────────────────────────────────────────────

$periodDisplay = if ($Period -eq "retrospective") {
    "Ретроспектива"
} else {
    # Конвертируем YYYY-MM в читаемый вид
    try {
        $dt = [datetime]::ParseExact($Period, "yyyy-MM", $null)
        $months = @("","Январь","Февраль","Март","Апрель","Май","Июнь","Июль","Август","Сентябрь","Октябрь","Ноябрь","Декабрь")
        "$($months[$dt.Month]) $($dt.Year)"
    } catch { $Period }
}

# ─── Шаблон дневника ─────────────────────────────────────────────────────────

$entryTemplate = @"

### 📅 $periodDisplay — ⚠️ Тема записи
- **👤 Автор:** $CharacterName
- **📍 Локация:** ⚠️ Заполнить
- **🎭 Тон/Стиль:** ⚠️ Нуар / Готический / Параноидальный / Меланхоличный / Яростный / Эстетический
- **📖 Текст записи:**
  ⚠️ 1–3 абзаца. Литературный язык. Внутренний мир, ощущения, скрытые мотивы. Без механики.

- **🔗 Зеркальная ссылка:**
  ⚠️ [Имя участника] → [Как автор видел его в этой сцене]
- **👁️ Восприятие других:** ⚠️ Ключевые эмоции/наблюдения по каждому присутствующему
- **📝 Скрытые детали/Прозрения:** ⚠️ Что автор утаивает, боится признать или понимает превратно
"@

if ($appendMode) {
    # Добавляем сцену-разделитель в конец существующего файла
    $existing = [System.IO.File]::ReadAllText($diaryFile, [System.Text.Encoding]::UTF8)
    $existing = $existing.TrimEnd() + "`n`n---`n" + $entryTemplate
    $fBytes  = [System.IO.File]::ReadAllBytes($diaryFile)
    $fHasBom = ($fBytes[0] -eq 0xEF -and $fBytes[1] -eq 0xBB -and $fBytes[2] -eq 0xBF)
    [System.IO.File]::WriteAllText($diaryFile, $existing, [System.Text.UTF8Encoding]::new($fHasBom))
    Write-Host "  OK  Сцена добавлена в $journalName\$fileName" -ForegroundColor Green
} else {
    # Создаём новый файл
    $headerLink = if ($Period -eq "retrospective") {
        "Ретроспектива — $CharacterName"
    } else {
        "$periodDisplay — $CharacterName"
    }

    $diaryContent = @"
# Дневник — $headerLink

> 🔗 [Персонаж]($cardRelPath) | 🔗 [Хроника]($storiesPath)$moduleLink

---
$entryTemplate
"@

    [System.IO.File]::WriteAllText($diaryFile, $diaryContent, $utf8bom)
    Write-Host "  OK  characters\$lineage\$CharacterName\$journalName\$fileName" -ForegroundColor Green
}

# ─── Итог ─────────────────────────────────────────────────────────────────────

Write-Host ""
Write-Host "=======================================" -ForegroundColor Green
Write-Host "  OK  Дневник создан" -ForegroundColor Green
Write-Host "=======================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Требует Claude:" -ForegroundColor Yellow
Write-Host "    -- Текст записи в стиле персонажа (см. diary_rules.md)"
Write-Host "    -- Зеркальные ссылки на других участников"
Write-Host "    -- Скрытые детали / прозрения"
Write-Host ""
Write-Host "  Справка по стилю: rules\diary_rules.md" -ForegroundColor DarkGray
Write-Host ""
Write-Host "  Нажмите любую клавишу..." -ForegroundColor DarkGray
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
