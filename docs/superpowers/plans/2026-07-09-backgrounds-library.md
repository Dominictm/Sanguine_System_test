# Библиотека → «Факты биографии» (Backgrounds) — план реализации

> Спека: `docs/superpowers/specs/2026-07-09-backgrounds-library-design.md`
> (утверждена). Выполняется инлайн, без сабагентов.

**Цель:** пятый раздел библиотеки — карточки Дополнений (5 категорий:
Общие/Вампиры/Гули/Маги/Подменыши), клик открывает общую модалку с
литературным описанием + по-точечной системой (как у дисциплин, не как у
достоинств — у Дополнений нет фиксированной стоимости, это шкала 1–5).

**Архитектура:** точная копия Достоинств/Недостатков на бэкенде и
фронтенде (loader → роуты → кэш → карточки → общая модалка `_v20EnsureLibModal`),
рендер уровней — по образцу дисциплин (`_libPowerHtml`).

---

### Задача 1 — Сбор контента с вики (данные, не код)

Дозапросить вики-страницы через Fandom API
(`action=parse&page=<Название>&prop=wikitext&format=json`, уже проверенный
метод обхода Cloudflare) для ~46 дополнений по 5 категориям (список — из
спеки, п.2), исключив 11 пунктов из «Гули», помеченных вики как
Достоинства.

Для каждого дополнения извлечь: литературное описание (вводный абзац) +
по-точечную систему (текст на каждый уровень 1–5, если есть в вики;
если структуры по уровням нет — оставить `system: ""` и одно общее
описание, не выдумывать текст).

Результат — 5 JSON-файлов:
`system/library/backgrounds/{general,vampire,ghoul,mage,changeling}.json`

- [ ] Собрать точный список URL/названий страниц по каждой категории
- [ ] Дозапросить каждую страницу, извлечь описание + систему
- [ ] Собрать 5 JSON-файлов по схеме из спеки (`slug`/`name`/`description`/`system`/`category`)
- [ ] Прогнать `node -e` валидацию: нет пустых/дублирующихся `slug` (тот же баг, что чинили у Достоинств)

### Задача 2 — Backend: loader

**Файл:** `web/lib/backgrounds-loader.js` (новый, копия `merits-loader.js`)

- [ ] Написать `loadBackgrounds(category)`/`getBackgrounds(category)`/`getAllBackgrounds()`
- [ ] Список категорий: `['general','vampire','ghoul','mage','changeling']`

### Задача 3 — Backend: роуты

**Файл:** `web/routes/library.js` (правка)

- [ ] `GET /api/library/backgrounds/:category`
- [ ] `GET /api/library/backgrounds` (плоский список всех категорий)
- [ ] Тест: `web/tests/all.test.js` — по образцу тестов `/api/library/merits`

### Задача 4 — Frontend: карточки + модалка

**Файл:** `web/public/v20-sheet.js` (правка)

- [ ] `_backgroundsCache = { general: null, vampire: null, ghoul: null, mage: null, changeling: null }`
- [ ] `_backgroundBySlug(category, slug)`
- [ ] `_libBackgroundDetailHtml(b)` — по образцу `_libDisciplineDetailHtml` (заголовок + `_libPowerHtml`-подобный рендер уровней), НЕ по образцу `_libMeritDetailHtml`
- [ ] `_libBackgroundCardsHtml(category)` — карточка: имя + индикатор «есть шкала уровней» (не фиксированные точки, как у достоинств)
- [ ] `_libRenderBackgroundList(category)`
- [ ] `_v20RenderBackgroundDetail(slug, category)` → рендер в `#v20-disc-modal-body`, кнопка `data-modal-close`
- [ ] `_v20OpenBackgroundModal(slug, category)` → `_v20EnsureLibModal().classList.add('open')` + рендер
- [ ] `loadBackgroundsLibrary(category)` — fetch + кэш + рендер
- [ ] Клик-делегирование на `#lib-backgrounds-body` (по образцу merits/flaws)

### Задача 5 — HTML: пятая вкладка + суб-табы

**Файл:** `web/public/index.html` (правка)

- [ ] Кнопка `data-tab="lib-backgrounds"` в `#page-library .tab-bar`
- [ ] `<div class="tab-panel" id="tab-lib-backgrounds">` с суб-таб-баром
      (`.backgrounds-subtab-bar`/`-btn`, `data-bg-cat="general|vampire|ghoul|mage|changeling"`)
      и `<div class="lib-panel" id="lib-backgrounds-body">`

### Задача 6 — CSS + JS-биндинг суб-табов

- [ ] `styles.css`: расширить существующий comma-selector
      `.merits-subtab-bar, .flaws-subtab-bar` → добавить `.backgrounds-subtab-bar`
      (не дублировать блок)
- [ ] `scripts.js`: делегированный обработчик `.backgrounds-subtab-btn` (по
      образцу merits/flaws, строки ~613-637) + вызов `loadBackgroundsLibrary('general')`
      при первом открытии вкладки `lib-backgrounds`

### Задача 7 — Проверка

- [ ] `npm run test:unit` — всё зелёное
- [ ] Headless Chrome: все 5 категорий рендерят карточки, клик открывает
      модалку с верным содержимым (тест на конкретном дополнении — как
      находили баг с дублирующимися слагами у Достоинств)
- [ ] `impeccable` детектор по изменённым файлам
- [ ] Коммиты по задачам, финальный прогон тестов, отчёт пользователю

---

Выполняю по порядку, инлайн, без сабагентов.
