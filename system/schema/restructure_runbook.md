# Restructure Runbook — архитектура «город как контейнер»

> **Статус:** УТВЕРЖДЁН, решения зафиксированы 2026-06-05.
> **Как выполнять:** пофазно, каждая фаза = отдельный коммит в ветке `restructure/cities`.
> **Переотдача:** пришли мне «сделай Фазу N по runbook» — выполню фазу строго по этому документу.

---

## 0. Зафиксированные решения

| Вопрос | Решение |
|--------|---------|
| **Q1 — имена папок-сущностей** | **ASCII-слаг** для папок + поле `display_name` (кириллица) в карточке. Слаг не обязан быть обратимым — истина имени живёт в `display_name`/H1. |
| **Q2 — персонаж в двух городах** | **Один источник истины.** Поля `home_city` + `presence` в карточке; в принимающем городе — `archive/visitors.md` (только ссылки). Копий файлов нет. |
| **Q3 — дефолты** | `art/` для изображений; `open_threads.md` на хронику + агрегат в город; `npc_image_mapping` вложен в карточки (файл удаляется); дневник `journal/ГГГГ-ММ.md` + `retrospective.md` (граница — ноябрь 2010). |
| **Структурные папки** | Английские. Пробелы в путях → `_`. Веб НЕ показывает `_` и для сущностей рендерит `display_name`. |

---

## 1. Конвенции имён

- **slug:** транслит `display_name` → нижний регистр → пробелы/пунктуация → `_` → схлопнуть повторы `_` → при коллизии суффикс `_2`, `_3`. Только `[a-z0-9_]`.
- **display_name:** реальное имя кириллицей (совпадает с H1 карточки).
- **Города (slug):** `paris`, `los_angeles`.
- **Линейки (slug):** `vampires`, `fairies`, `mortals`, `werewolves`, `mages`, `hunters`.
- **Округа:** `district_01`, `district_02`, … (без `№`).
- **Веб-отображение:** `display(s) = s.replace(/_/g, ' ')`; для сущностей приоритетно поле `display_name`.

---

## 2. Схема карточки персонажа (обязательные поля)

Добавляются к существующему блоку НПС. Хранятся во frontmatter или в шапке карточки (формат уточняется в Фазе 1).

| Поле | Назначение | Пример |
|------|-----------|--------|
| `slug` | ASCII-ключ папки | `sofi_jonser` |
| `display_name` | Имя кириллицей (= H1) | `Софи Жонсьер` |
| `lineage` | Линейка (= имя под-папки) | `vampires` |
| `aliases` | Альт-имена/личины (для двойных личностей) | `[Госпожа Бубенчик]` |
| `home_city` | Родной город (slug) | `paris` |
| `presence` | Где появлялся вне дома: город / хроника / даты | `[{los_angeles, summer_2011, 2011-06}]` |
| `art` | Список файлов из `art/` + источник/фон (бывш. `npc_image_mapping`) | `art/01.png — фон: ...` |

`validate_cards.js` проверяет: наличие всех полей, `lineage` ∈ enum, `home_city` ∈ городов, секцию изображений, уникальность `slug` и непересечение `aliases` в пределах города.

---

## 3. Целевое дерево

```
VTM-project-Claude/
├─ CLAUDE.md                    # универсальный протокол Рассказчика + указатель активного города
├─ system/                      # ГЛОБАЛЬНОЕ (одно на все города)
│  ├─ rules/                    # npcs_city, module_rules, diary_rules, chronicle,
│  │                            #   character_sheet_v20, portret, CHECKLIST
│  └─ schema/
│     ├─ card_schema.md
│     ├─ validate_cards.js
│     └─ restructure_runbook.md  # этот файл
├─ cities/
│  ├─ paris/
│  │  ├─ city.md                # парижский сеттинг (из CLAUDE.md)
│  │  ├─ rules/                 # «Правила Парижа» — специфика города
│  │  ├─ archive/
│  │  │  ├─ political_state.md  # = factions_paris.md
│  │  │  ├─ events.md           # АГРЕГАТ из хроник (генерируется, руками не править)
│  │  │  ├─ timeline.md         # = timeline_paris.md
│  │  │  ├─ rumors_elysium.md / rumors_dreaming.md
│  │  │  ├─ characters_index.md # = characters_ALL.md по городу
│  │  │  └─ visitors.md         # гости из других городов (ссылки)
│  │  ├─ chronicles/
│  │  │  └─ <chronicle_slug>/   # напр. winter_2010
│  │  │     ├─ chronicle.md     # спина хроники + финал
│  │  │     ├─ events.md        # события хроники → источник для archive/events.md
│  │  │     ├─ open_threads.md
│  │  │     └─ modules/<module_slug>/{module.md, finale.md, заготовки}
│  │  ├─ characters/<lineage>/<slug>/
│  │  │     ├─ <slug>.md  ├─ art/  └─ journal/{retrospective.md, ГГГГ-ММ.md}
│  │  └─ locations/district_NN/[район_slug]/<loc_slug>/   # глубина ГИБКАЯ
│  └─ los_angeles/ … (та же форма)
├─ web/   tools/   tests/       # инструментарий — перенацелить пути (+ ?city=)
└─ .claude/                     # без изменений
```

---

## 4. Размещение файлов: текущее → целевое

**Глобальное → `system/rules/`:**

| Сейчас | Цель |
|--------|------|
| `rules/npcs_city.md` | `system/rules/npcs_city.md` |
| `rules/module_rules.md` | `system/rules/module_rules.md` |
| `rules/diary_rules.md` | `system/rules/diary_rules.md` |
| `rules/chronicle_paris.md` | `system/rules/chronicle.md` (протокол, переименование) |
| `rules/character_sheet_v20.md` | `system/rules/character_sheet_v20.md` |
| `rules/portret.md` | `system/rules/portret.md` |
| `rules/CHECKLIST.md` | `system/rules/CHECKLIST.md` |
| `rules/npc_image_mapping.md` | **удалить** — вложить в карточки (Q3) |

**Городское → `cities/paris/`:**

| Сейчас | Цель |
|--------|------|
| `factions_paris.md` | `cities/paris/archive/political_state.md` |
| `rumors_elysium.md` / `rumors_dreaming.md` | `cities/paris/archive/` |
| `rules/timeline_paris.md` | `cities/paris/archive/timeline.md` |
| `characters/characters_ALL.md` | `cities/paris/archive/characters_index.md` |
| `Stories_of_Paris.md` | разнести: события → `chronicles/<chr>/events.md`; агрегат → `archive/events.md` |
| `rules/open_threads.md` | разнести по хроникам → `chronicles/<chr>/open_threads.md` |
| `characters/<lineage>/<Имя>/` | `cities/paris/characters/<lineage>/<slug>/` |
| `locations/<…>` | `cities/paris/locations/district_NN/…` |
| `modules/<…>` | `cities/paris/chronicles/<chr>/modules/<slug>/` |
| `CLAUDE.md` (парижская часть) | `cities/paris/city.md`; универсальный протокол остаётся в `CLAUDE.md` |

**Остаётся в корне (перенацелить пути в Фазе 7):** `web/`, `tools/`, `tests/`, `.claude/`.

---

## 5. Контракт мигратора `tools/migrate_to_cities.ps1`

- **Идемпотентность** + флаг **`-DryRun`** (только лог, без записи).
- **slugmap:** строит `tools/_slugmap.json` = `[{type, old_path, new_path, slug, display_name}]`. Транслит имён собственных **проверяет человек** до боевого прогона.
- **Перемещение:** `git mv` (сохранить историю).
- **Ссылки:** переписать ВСЕ внутренние ссылки во всех `.md` по карте old→new; относительные `../` пересчитать (резолв до корня репо → реотносительность). Включая секции `## 🖼️ Изображения`, `Лист:`, `Арт:`, ссылки в индексе/модулях/дневниках.
- **Кодировки:** `.ps1` — UTF-8 BOM; `.md` — UTF-8 без BOM.
- **Лог:** каждое действие → `tools/_migration_log.txt`.
- **Выход dry-run:** ничего не пишет в дерево; только `_slugmap.json` + лог для ревью.

---

## 6. Фазы

### Фаза 0 — Подготовка
- **Цель:** чистый старт.
- **Шаги:** ветка `restructure/cities`; рабочее дерево чистое (текущие правки закоммитить ОТДЕЛЬНО — это контент-работа пользователя, не мешать с реструктуризацией); прогнать `validate_links` → зафиксировать «ноль битых ДО».
- **Проверка:** `git status` чист, базовый отчёт сохранён.
- **Откат:** удалить ветку.

### Фаза 1 — Схема и каркас
- **Цель:** схема без переноса данных.
- **Шаги:** создать `system/` и `cities/paris/` (пусто); `system/schema/card_schema.md` (поля из §2); `system/schema/validate_cards.js`.
- **Проверка:** тест запускается (на пустом наборе — ноль нарушений).
- **Откат:** удалить `system/`, `cities/`.

### Фаза 2 — Мигратор
- **Цель:** скрипт + dry-run отчёт (§5).
- **Шаги:** написать `tools/migrate_to_cities.ps1`; прогнать `-DryRun`; ревью `_slugmap.json` (транслит) и лога.
- **Проверка:** dry-run чист, slugmap одобрен.
- **Откат:** не пишет в дерево.

### Фаза 3 — Правила и архивы
- **Цель:** разнести по §4 (глобальное/городское).
- **Шаги:** переместить правила в `system/rules/`; данные города в `cities/paris/archive/`; парижский сеттинг → `cities/paris/city.md`.
- **Проверка:** `validate_links` (ссылки добьёт Фаза 7).

### Фаза 4 — Хроники и модули
- **Цель:** модули под хрониками, события разнесены.
- **Вход от пользователя:** привязка модуль→хроника (или вывести из дат/тегов в `Stories_of_Paris.md`).
- **Шаги:** создать `chronicles/<chr>/`; перенести модули; разнести события в `chronicles/<chr>/events.md`; пометить `archive/events.md` как генерируемый агрегат; разнести нити.
- **Проверка:** все 7 модулей на местах с внутренними файлами.

### Фаза 5 — Персонажи
- **Цель:** карточки по схеме.
- **Шаги:** добавить поля `slug/display_name/lineage/aliases/home_city/presence/art`; картинки → `art/`; дневники → `journal/`; убить `npc_image_mapping`.
- **Проверка:** `validate_cards.js` = ноль нарушений.

### Фаза 6 — Локации и мульти-город
- **Цель:** локации перенесены, второй город готов.
- **Шаги:** локации → `locations/district_NN/…` (глубина гибкая; правило в `system/rules/`); создать `archive/visitors.md`; заготовка `cities/los_angeles/`.
- **Проверка:** локации валидны, каркас ЛА есть.

### Фаза 7 — Инструментарий
- **Цель:** веб и утилиты на новой структуре.
- **Шаги:** `web/server.js` — пути → `cities/<city>/…`, параметр `?city=`, агрегатор `archive/events.md`, хелперы `display()` (`_`→пробел) и приоритет `display_name`; обновить все `tools/*.ps1`; обновить `tests/`.
- **Проверка:** веб открывается, эндпоинты по городу отвечают.

### Фаза 8 — Валидация и приёмка
- **Цель:** ноль регресса.
- **Шаги:** `validate_links` = ноль (сверка с базой Фазы 0); `validate_cards` = ноль; веб-смоук (Selenium); ручная сверка 3–4 карточек и дерева; merge ветки.
- **Откат:** вся работа в ветке.

### Фаза 9 — Мета-доки
- **Цель:** документация под итог.
- **Шаги:** переписать `CLAUDE.md` (город-независимый + «активный город»), `CHECKLIST.md`, `card_schema.md`.

---

## 7. Как переотдать задачу

- «сделай Фазу N по runbook» — выполню фазу.
- «покажи контракт Фазы 2 подробнее» / «разверни схему карточки» — детализирую без выполнения.
- Перед Фазой 4 потребуется твой ввод: привязка модуль→хроника.
