# Мастер-чеклист

> Один файл вместо семи. `<город>` — slug города (напр. `paris`); `<линейка>` ∈ vampires/fairies/mortals/werewolves/mages/hunters; `<slug>` — ASCII-слаг сущности.

---

## 1. Новый персонаж

> Детальный протокол: [npcs_city.md](npcs_city.md) | Промты: [portret.md](portret.md) | Контракт полей: [card_schema.md](../schema/card_schema.md)

- [ ] Проверить дубликаты по имени, внешности, роли, сиру
- [ ] Создать `cities/<город>/characters/<линейка>/<slug>/<slug>.md` по шаблону из `npcs_city.md`
- [ ] Обязательные поля: H1 (эмодзи + имя), **Слаг**, **Родной город**, Линейка WoD, Клан/Раса, Статус, …; при двойной личности — **Алиасы**
- [ ] Описать Внешность (3–5 маркеров), Голос, Отношения
- [ ] Блок `🎨 Промт` (3 блока по `portret.md`) + секция `## 🖼️ Изображения` (или `⏳ Изображение не предоставлено`)
- [ ] Изображения класть в `<slug>/art/`; фон/референс указывать в секции изображений карточки
- [ ] Добавить персонажа в `cities/<город>/archive/characters_index.md`
- [ ] Добавить обратные ссылки в карточки сира / союзников (поле «Отношения»)
- [ ] Если нужен V20-лист: `<slug>/<slug>-sheet.md` по [character_sheet_v20.md](character_sheet_v20.md)
- [ ] `node system/schema/validate_cards.js` (поля/статусы/коллизии) + `tools/validate_links.ps1` (ссылки)

---

## 2. Новый модуль

> Детальный протокол: [module_rules.md](module_rules.md) | Хроника: [chronicle.md](chronicle.md)

**Фаза A — Подготовка (до игры):**
- [ ] Проверить связь с предыдущими хрониками
- [ ] Определить хронику. Создать `cities/<город>/chronicles/<хроника>/modules/<модуль>/`. **Поле «Время» обязательно** (желательно с годом — нужно для проверки таймлайна)
- [ ] `<модуль>.md` (или `scenario.md`) — Предпосылки, Сцены (3–5), Кульминация, Финалы, Крючки, колорит города
- [ ] `npc.md` с тремя секциями: ПК / Каноничные НПС / Модульные НПС
  - Каноничные → ссылки на `cities/<город>/characters/<линейка>/<slug>/`; новые добавить по чеклисту **1**
  - Модульные → карточки в `<модуль>/npc/<slug>/<slug>.md` по **Шаблону Г** из [npcs_city.md](npcs_city.md)
- [ ] Проверить локации — если новая, создать карточку по [portret.md](portret.md):
  - `cities/<город>/locations/district_NN/<район>/<локация>/<локация>.md` (глубина гибкая)
  - Проверить наличие: `tools/search.ps1 "Название локации"`

**Фаза B — Во время игры** (если модуль идёт больше одной сессии):
- [ ] После каждой сессии — запись в `<модуль>/sessions.md` (вкладка «🎲 Сессии»): сыгранные сцены, события, статус. Рабочий журнал, **не канон**
- [ ] Статус 🟢 Завершён → переходить к Фазе C

**Фаза C — Закрытие** (модуль доигран):
- [ ] Заполнить основной файл модуля (краткое содержание, ссылки на дневники)
- [ ] `finale.md` — только если финал написан
- [ ] Перенести события из `sessions.md` в `cities/<город>/chronicles/<хроника>/events.md`; агрегируется в `cities/<город>/archive/events.md` (протокол — [chronicle.md](chronicle.md))
- [ ] Обновить `cities/<город>/chronicles/<хроника>/open_threads.md` — новые нити
- [ ] Дневники участников: `cities/<город>/characters/<линейка>/<slug>/journal/ГГГГ-ММ.md` (граница ноябрь-2010 → `retrospective.md`); правила — [diary_rules.md](diary_rules.md)
- [ ] Проверить условия продвижения модульных НПС → [module_rules.md](module_rules.md)
- [ ] `tools/validate_links.ps1`

---

## 3. Переименование персонажа

> Со слаг-папками **дёшево**, если меняется только отображаемое имя: правишь H1/`display_name` и упоминания в тексте, **папку-слаг не трогаешь** → ссылки целы. Менять сам слаг (папку) — дорого (затрагивает N файлов).

**Сменить только имя (display_name):**
- [ ] Обновить H1 карточки `<slug>/<slug>.md`
- [ ] Обновить упоминания имени в `characters_index.md`, событиях хроник, дневниках, модулях, полях «Отношения/Сир/Дитя» других карточек
- [ ] `tools/validate_links.ps1` (ссылки не должны были сломаться)

**Сменить слаг (папку):** найти все вхождения старого пути и переписать ссылки:
```powershell
Select-String -Path (Get-ChildItem -Recurse -Filter "*.md").FullName -Pattern "стар_слаг" | Select-Object Path, LineNumber, Line
```
- [ ] Переименовать `…/<стар_slug>/` → `…/<нов_slug>/` и файлы внутри (`<slug>.md`, `<slug>-sheet.md`)
- [ ] Переписать все ссылки на старый путь (карточки, events, modules, index, journal)
- [ ] `tools/validate_links.ps1` → 0 ошибок

---

## 4. Быстрые ссылки

| Документ | Назначение |
|---|---|
| [events.md](../../cities/paris/archive/events.md) | События города (агрегат хроник) |
| [chronicle.md](chronicle.md) | Протокол внесения записей в хронику |
| [characters_index.md](../../cities/paris/archive/characters_index.md) | Сводник персонажей города |
| [political_state.md](../../cities/paris/archive/political_state.md) | Карта фракций Парижа 2010 |
| [rumors_elysium.md](../../cities/paris/archive/rumors_elysium.md) | Слухи Элизиума d20 |
| [timeline.md](../../cities/paris/archive/timeline.md) | Хронология WoD Парижа |
| [card_schema.md](../schema/card_schema.md) | Контракт полей карточки |
| [validate_cards.js](../schema/validate_cards.js) · [validate_links.ps1](../../tools/validate_links.ps1) | Валидаторы |
