# new_npc.ps1 — Создание карточки канонического НПС
# Создаёт папку + шаблон карточки, обновляет characters_ALL.md и npc_image_mapping.md
#
# Usage:
#   .\tools\new_npc.ps1 -Name "Пьер Морно" -Type vampire
#   .\tools\new_npc.ps1 -Name "Агнес Бруно" -Type mortal -Clan "Смертная" -Role "Информатор" -Emoji "👁️"
#
# После создания Claude пишет: биографию, голос, промт изображения, цвет фона.

param(
    [Parameter(Mandatory=$true)]
    [string]$Name,

    [Parameter(Mandatory=$true)]
    [ValidateSet("vampire","mortal","fairy","werewolf","mage","hunter")]
    [string]$Type,

    [string]$Clan  = "⚠️ Заполнить",
    [string]$Sect  = "⚠️ Заполнить",
    [string]$Role  = "⚠️ Заполнить",
    [string]$Emoji = ""
)

$Root        = Split-Path -Parent $PSScriptRoot
$utf8bom     = [System.Text.UTF8Encoding]::new($true)

# ─── Маппинг типов ────────────────────────────────────────────────────────────

$typeInfo = @{
    "vampire"  = @{ Folder = "vampires";   SectionEnd = "`n---`n`n## 🧚 Феи";      DefaultEmoji = "🧛"; Tmpl = "vampire" }
    "fairy"    = @{ Folder = "fairies";    SectionEnd = "`n---`n`n## 🧑 Смертные"; DefaultEmoji = "🧚"; Tmpl = "fairy"   }
    "mortal"   = @{ Folder = "mortals";    SectionEnd = "`n---`n`n## 📂 Пустые";   DefaultEmoji = "👤"; Tmpl = "mortal"  }
    "werewolf" = @{ Folder = "werewolves"; SectionEnd = $null;                      DefaultEmoji = "🐺"; Tmpl = "vampire" }
    "mage"     = @{ Folder = "mages";      SectionEnd = $null;                      DefaultEmoji = "🔮"; Tmpl = "vampire" }
    "hunter"   = @{ Folder = "hunters";    SectionEnd = $null;                      DefaultEmoji = "🏹"; Tmpl = "vampire" }
}

$info       = $typeInfo[$Type]
$lineageDir = $info.Folder
if (-not $Emoji) { $Emoji = $info.DefaultEmoji }

$charDir    = Join-Path $Root "characters\$lineageDir\$Name"
$cardFile   = Join-Path $charDir "$Name.md"
$allFile    = Join-Path $Root "characters\characters_ALL.md"
$mapFile    = Join-Path $Root "rules\npc_image_mapping.md"

Write-Host ""
Write-Host "=======================================" -ForegroundColor Cyan
Write-Host "  VTM Paris 2010 -- Новый НПС" -ForegroundColor Cyan
Write-Host "  $Emoji $Name  [$Type]" -ForegroundColor White
Write-Host "=======================================" -ForegroundColor Cyan
Write-Host ""

if (Test-Path $charDir) {
    Write-Host "WARN: папка уже существует: characters\$lineageDir\$Name" -ForegroundColor Yellow
    exit 1
}

New-Item -ItemType Directory -Path $charDir | Out-Null

# ─── Шаблон карточки ─────────────────────────────────────────────────────────

$wod_type = switch ($Type) {
    "vampire"  { "Вампир" }
    "mortal"   { "Смертный" }
    "fairy"    { "Фея / Ченджлинг" }
    "werewolf" { "Оборотень" }
    "mage"     { "Маг" }
    "hunter"   { "Охотник" }
}

if ($info.Tmpl -eq "mortal") {
$cardContent = @"
# $Emoji $Name

> 🔗 [Все персонажи](../../characters_ALL.md)

---

- **Линейка WoD:** $wod_type
- **Профессия:** $Role
- **Родственники:** —
- **Домен / Локация:** ⚠️ Заполнить
- **Роль:** ⚠️ Заполнить
- **Статус:** Смертный / Смертная (жив/жива)
- **Биография:** ⚠️ Заполнить
- **Внешность:** ⚠️ Заполнить
- **Голос:** ⚠️ Заполнить
- **Отношения:**
  - ⚠️ Заполнить

- **🎨 Промт для генерации изображения:**
  [Блок 1] ⚠️ Заполнить
  [Блок 2] ⚠️ Заполнить
  [Блок 3] Dark fantasy digital painting, visible painterly brushstrokes, textured oil-paint effect, cinematic composition, moody gothic atmosphere, Vampire the Masquerade aesthetic, concept art quality, painterly realism, artstation quality, masterpiece
- **🚫 Негативный промт:**
  photorealistic photography, digital art, anime, cartoon, illustration, watermark, text overlay, blurry, low quality, artifacts, deformed anatomy, extra limbs, oversaturated colors, bright white background, 3D render, CGI.

---

## 🖼️ Изображения

- ⏳ Изображение не предоставлено
"@
} elseif ($info.Tmpl -eq "fairy") {
$cardContent = @"
# $Emoji $Name

> 🔗 [Все персонажи](../../characters_ALL.md)

---

- **Линейка WoD:** $wod_type
- **Раса:** $Clan
- **Род:** ⚠️ Заполнить
- **Двор:** ⚠️ Заполнить
- **Титул:** ⚠️ Заполнить
- **Год рождения / Первое пробуждение:** ⚠️ Заполнить
- **Фригольд / Локация:** ⚠️ Заполнить
- **Роль:** $Role
- **Статус:** Активен
- **Биография:** ⚠️ Заполнить
- **Внешность:** ⚠️ Заполнить
- **Особенности / Способности:** ⚠️ Заполнить
- **Голос:** ⚠️ Заполнить
- **Отношения:**
  - ⚠️ Заполнить

- **🎨 Промт для генерации изображения:**
  [Блок 1] ⚠️ Заполнить
  [Блок 2] ⚠️ Заполнить
  [Блок 3] Dark fantasy digital painting, visible painterly brushstrokes, textured oil-paint effect, cinematic composition, moody gothic atmosphere, Vampire the Masquerade aesthetic, concept art quality, painterly realism, artstation quality, masterpiece
- **🚫 Негативный промт:**
  photorealistic photography, digital art, anime, cartoon, illustration, watermark, text overlay, blurry, low quality, artifacts, deformed anatomy, extra limbs, oversaturated colors, bright white background, 3D render, CGI.

---

## 🖼️ Изображения

- ⏳ Изображение не предоставлено
"@
} else {
$cardContent = @"
# $Emoji $Name

> 🔗 [Все персонажи](../../characters_ALL.md)

---

- **Линейка WoD:** $wod_type
- **Клан:** $Clan
- **Секта:** $Sect
- **Поколение:** ⚠️ Заполнить
- **Год рождения:** ⚠️ Заполнить
- **Год обращения:** ⚠️ Заполнить
- **Сир:** ⚠️ Заполнить
- **Дитя:** —
- **Домен / Локация:** ⚠️ Заполнить
- **Парижская иерархия:** ⚠️ Заполнить
- **Роль:** $Role
- **Статус:** Активен

- **Биография:** ⚠️ Заполнить

- **Внешность:** ⚠️ Заполнить

- **Дисциплины:** ⚠️ Заполнить

- **Голос:** ⚠️ Заполнить

- **Отношения:**
  - ⚠️ Заполнить

- **🎨 Промт для генерации изображения:**
  [Блок 1] ⚠️ Заполнить
  [Блок 2] ⚠️ Заполнить
  [Блок 3] Dark fantasy digital painting, visible painterly brushstrokes, textured oil-paint effect, cinematic composition, moody gothic atmosphere, Vampire the Masquerade aesthetic, concept art quality, painterly realism, artstation quality, masterpiece
- **🚫 Негативный промт:**
  photorealistic photography, digital art, anime, cartoon, illustration, watermark, text overlay, blurry, low quality, artifacts, deformed anatomy, extra limbs, oversaturated colors, bright white background, 3D render, CGI.

---

## 🖼️ Изображения

- ⏳ Изображение не предоставлено
"@
}

[System.IO.File]::WriteAllText($cardFile, $cardContent, $utf8bom)
Write-Host "  OK  characters\$lineageDir\$Name\$Name.md" -ForegroundColor Green

# ─── characters_ALL.md ───────────────────────────────────────────────────────

$sectionEnd = $info.SectionEnd

if ($sectionEnd) {
    $allRaw  = [System.IO.File]::ReadAllBytes($allFile)
    $allHasBom = ($allRaw[0] -eq 0xEF -and $allRaw[1] -eq 0xBB -and $allRaw[2] -eq 0xBF)
    $allText = [System.IO.File]::ReadAllText($allFile, [System.Text.Encoding]::UTF8) -replace "`r`n", "`n"

    $enc     = $Name -replace ' ', '%20'
    $hasParens = $Name -match '[()]'
    $linkMd  = if ($hasParens) {
        "[$Emoji $Name](<$lineageDir/$enc/$enc.md>)"
    } else {
        "[$Emoji $Name]($lineageDir/$enc/$enc.md)"
    }

    $sect_display = if ($Type -eq "mortal") { "—" } else { $Sect }

    $entry = "`n`n### $linkMd`n- **Клан / Раса:** $Clan`n- **Секта / Двор:** $sect_display`n- **Роль:** $Role`n- **Лист:** —`n- **Арт:** ⏳ Не предоставлено"

    if ($allText.Contains($sectionEnd)) {
        $allText = $allText.Replace($sectionEnd, "$entry$sectionEnd")
        [System.IO.File]::WriteAllText($allFile, $allText, [System.Text.UTF8Encoding]::new($allHasBom))
        Write-Host "  OK  characters_ALL.md" -ForegroundColor Green
    } else {
        Write-Host "  WARN: Секция '$Type' не найдена в characters_ALL.md — добавьте вручную" -ForegroundColor Yellow
    }
} else {
    Write-Host "  WARN: Тип '$Type' — добавьте запись в characters_ALL.md вручную" -ForegroundColor Yellow
}

# ─── npc_image_mapping.md ────────────────────────────────────────────────────

$mapRaw    = [System.IO.File]::ReadAllBytes($mapFile)
$mapHasBom = ($mapRaw[0] -eq 0xEF -and $mapRaw[1] -eq 0xBB -and $mapRaw[2] -eq 0xBF)
$mapText   = [System.IO.File]::ReadAllText($mapFile, [System.Text.Encoding]::UTF8) -replace "`r`n", "`n"
$mapMarker = "`n`n---`n`nВажные"

if ($mapText.Contains($mapMarker)) {
    $mapText = $mapText.Replace($mapMarker, "`n| $Name | ⚠️ Заполнить |$mapMarker")
    [System.IO.File]::WriteAllText($mapFile, $mapText, [System.Text.UTF8Encoding]::new($mapHasBom))
    Write-Host "  OK  npc_image_mapping.md" -ForegroundColor Green
} else {
    Write-Host "  WARN: Маркер таблицы не найден — добавьте строку в npc_image_mapping.md вручную" -ForegroundColor Yellow
}

# ─── Итог ─────────────────────────────────────────────────────────────────────

Write-Host ""
Write-Host "=======================================" -ForegroundColor Green
Write-Host "  OK  $Emoji $Name создан" -ForegroundColor Green
Write-Host "=======================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Файл: characters\$lineageDir\$Name\$Name.md" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Требует Claude:" -ForegroundColor Yellow
Write-Host "    -- Биография, голос, дисциплины"
Write-Host "    -- Промт изображения (3 блока)"
Write-Host "    -- Цвет фона в npc_image_mapping.md"
Write-Host "    -- Обратные ссылки в карточки связанных персонажей"
Write-Host ""
Write-Host "  tools\validate_links.ps1" -ForegroundColor DarkGray
Write-Host ""
Write-Host "  Нажмите любую клавишу..." -ForegroundColor DarkGray
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
