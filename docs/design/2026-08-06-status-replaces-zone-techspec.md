# Техспека: «Статус» заменяет «Зона контроля» + обратная запись

**Роль:** Системный аналитик. **Входные данные:**
[2026-08-06-status-replaces-zone-analysis.md](2026-08-06-status-replaces-zone-analysis.md)
(Аналитик) — все ссылки file:line ниже предполагают этот документ прочитанным,
повторяю только то, что меняю/уточняю. Решения пользователя (§3.3 документа
Аналитика) не пересматриваются: фильтр локаций переделывается под «Статус»
(не убирается); бейдж «Статус» — только в детальной модалке; сброс статуса
из локации при непустой заметке — запрещён.

---

## 0. Сводка архитектурных решений этой техспеки

| # | Вопрос | Решение |
|---|---|---|
| A | Формат хранения `locStatus` | Меняется с `[Город] <Тип>[ — <Заметка>]` на чистое значение типа (`Элизиум` и т.п.), без маркера и без заметки — см. §2 |
| B | Где жить общей логике (список типов, парсинг/сериализация записей города, сопоставление имён) | Новый модуль `web/lib/significant_places.js` — используется и `cities.js` (прямой синк), и `locations.js` (обратная запись, новая) — см. §1 |
| C | Куда добавлять обратную запись | В существующий `PUT /api/locations/:slug/fields`, внутри ветки `vtmTable`, а не новый эндпоинт — см. §4 |
| D | Сопоставление имён (короткое vs. полное с «хвостом» в заголовке) | Тот же приём, что уже в `_locNameKnown` (клиент, сегодняшний фикс) — сервер получает свой эквивалент в новом модуле — см. §1.3 |

---

## 1. Новый общий модуль `web/lib/significant_places.js`

Выносит то, что сейчас дублируется/понадобится в двух роутерах
(`cities.js` — уже есть, `locations.js` — понадобится для обратной записи).
Ничего в поведении существующего прямого синка (город → локация) не меняет
сверх §2 (смена формата) — чистый рефакторинг размещения кода.

```js
'use strict';
// Общая модель «Значимых мест» города (Отмеченные локации) — список допустимых
// типов, парсинг/сериализация строк секции «Ключевые локации» city.md,
// сопоставление имени локации с записью. Используется и прямым синком
// (город → локация, cities.js), и обратной записью (локация → город,
// locations.js, 2026-08-06). Вынесено в общий модуль, чтобы не дублировать
// парсинг/сопоставление между роутерами.

const CITY_LOCATION_TYPES = ['Элизиум', 'Приёмная князя', 'Убежище', 'Шериф', 'Сенешаль'];

// Строка секции → { type, name, note } | null, если строка не структурная
// (свободный текст/нарратив). Та же валидация лейбла/значения, что уже
// проверена на реальных данных Парижа (техспека §8.1, ранее в этом цикле).
function parseLocationLine(line) {
  const ci = line.indexOf(':');
  if (ci <= 0 || ci > 40) return null;
  const label = line.slice(0, ci).trim();
  let value = line.slice(ci + 1).trim();
  let note = '';
  const dashIdx = value.search(/\s+—\s+/);
  if (dashIdx !== -1) {
    note = value.slice(dashIdx).replace(/^\s+—\s+/, '').trim();
    value = value.slice(0, dashIdx).trim();
  }
  const labelOk = label && label.length <= 24 && label.split(/\s+/).length <= 2 && !label.includes(',');
  const valueOk = value.length > 0 && value.length <= 48 && !/[.!?,;]/.test(value);
  if (!labelOk || !valueOk) return null;
  return { type: label, name: value, note };
}

// Разбирает ВСЮ секцию «Ключевые локации» на { narrative, records } — narrative
// (свободный текст) НЕ теряется (в отличие от старого parseLocationRecords в
// cities.js, который просто фильтровал нарратив выбросом — годилось для
// диффа при синке, но не годится для точечной перезаписи ОДНОЙ записи с
// сохранением остального текста, нужного обратной записи, §4).
function splitLocationSection(text) {
  const lines = String(text || '').split('\n').map(l => l.replace(/^\s*-\s?/, '').trim()).filter(Boolean);
  const narrative = [], records = [];
  for (const line of lines) {
    const rec = parseLocationLine(line);
    if (rec) records.push(rec); else narrative.push(line);
  }
  return { narrative: narrative.join('\n'), records };
}

// Обратная сериализация — тот же формат, что _locationRowToLine на клиенте
// (city.js), нужна серверу для точечной обратной записи (§4), где нет
// клиента, который бы это сделал сам.
function serializeLocationSection(narrative, records) {
  const narrativeLines = narrative ? narrative.split('\n').map(l => l.trim()).filter(Boolean) : [];
  const recordLines = records.map(r => {
    const base = r.type ? `${r.type}: ${r.name}` : r.name;
    const note = r.note ? String(r.note).trim().replace(/—/g, '–') : '';
    return note ? `${base} — ${note}` : base;
  });
  return [...narrativeLines, ...recordLines].join('\n');
}

// Совпадение имени локации с записью — не только точным именем, но и по
// части ЗАГОЛОВКА локации до первого « — » (карточки вроде «Опера Гарнье —
// Главный Элизиум, 9-й округ», где «хвост» исторически вписан в H1, см.
// техспеку location-card-actions §7.1, фикс `_locNameKnown` на клиенте —
// это его серверный эквивалент, СПИСОК записей вместо булева результата).
function findRecordIndexForLocation(records, locTitle) {
  let idx = records.findIndex(r => r.name === locTitle);
  if (idx !== -1) return idx;
  const shortTitle = String(locTitle || '').split(/\s+—\s+/)[0].trim();
  if (!shortTitle) return -1;
  return records.findIndex(r => r.name === shortTitle);
}

module.exports = {
  CITY_LOCATION_TYPES,
  parseLocationLine, splitLocationSection, serializeLocationSection,
  findRecordIndexForLocation,
};
```

### 1.1 Рефакторинг `web/routes/cities.js` под общий модуль

```js
const { CITY_LOCATION_TYPES, parseLocationLine } = require('../lib/significant_places');
```

- `parseLocationRecords(lines)` (`cities.js:239-262`) — заменяется на
  `lines.map(l => l.replace(/^\s*-\s?/,'').trim()).filter(Boolean).map(parseLocationLine).filter(Boolean)`
  (эквивалент прежнего поведения — фильтрует нарратив выбросом, ровно как
  раньше, для диффа синку это и нужно).
- `CITY_LOCATION_TYPES` в `city.js` (клиент, `:83`) — **не трогаем**, клиент
  не читает `web/lib/*` напрямую (браузерный скрипт, не Node-модуль) —
  список там продолжает жить отдельной строкой, дублирующей серверный
  источник истины. **Открытый технический риск, не блокирует**: если
  когда-то список типов изменится, придётся править в двух местах вручную
  — принимается как есть (5 фиксированных канонических слов, менять их в
  реальности не планируется; заводить эндпоинт `GET /api/significant-place-types`
  ради одной статической строки — несоразмерно).

---

## 2. Смена формата хранения `locStatus`

### 2.1 Было / стало

| | Было | Стало |
|---|---|---|
| Значение в карточке локации | `[Город] Элизиум — Главный Элизиум, 9-й округ` | `Элизиум` |
| Кто пишет заметку | Синк, в то же поле, склеенной строкой | Только город, в `sec.locations`, поле НЕ в локации вообще |
| Матчинг «наше/не наше» при сбросе | `current.startsWith(conf.value)` (проверка маркера) | `current === conf.type` (прямое равенство) |

### 2.2 Правки `web/routes/cities.js`

```js
// БЫЛО:
const CITY_CONTROL_MARKER = '[Город]';
const SIGNIFICANT_PLACE_TYPES = {
  'Элизиум':        { field: 'locStatus', value: `${CITY_CONTROL_MARKER} Элизиум` },
  'Приёмная князя':  { field: 'locStatus', value: `${CITY_CONTROL_MARKER} Приёмная князя` },
  'Убежище':         { field: 'locStatus', value: `${CITY_CONTROL_MARKER} Убежище` },
  'Шериф':           { field: 'locStatus', value: `${CITY_CONTROL_MARKER} Шериф` },
  'Сенешаль':        { field: 'locStatus', value: `${CITY_CONTROL_MARKER} Сенешаль` },
};
function _significantPlaceValue(conf, note) {
  const clean = note ? String(note).trim().replace(/—/g, '–') : '';
  if (!clean) return conf.value;
  return `${conf.value} — ${clean}`;
}

// СТАЛО (заметка вообще не участвует в значении поля локации — она остаётся
// только в city.md, п.2 задачи пользователя «только это значение»):
const SIGNIFICANT_PLACE_TYPES = Object.fromEntries(
  CITY_LOCATION_TYPES.map(type => [type, { field: 'locStatus', value: type }])
);
// _significantPlaceValue() — удаляется целиком, больше не нужна (значение
// синка теперь просто = conf.value = сам тип, без склейки с заметкой).
```

`syncSignificantPlaceStatus()` (`cities.js:356-389`) — точечные правки:
```js
// Строка ~376, было:
if (!current.trim().startsWith(conf.value)) continue;
// Стало (прямое равенство, маркера больше нет):
if (current.trim() !== conf.value) continue;

// Строка ~385, было:
const value = _significantPlaceValue(conf, rec.note);
// Стало: заметка больше не подмешивается в значение поля локации.
const value = conf.value;
```
Остальная логика функции (поиск локации через `locByName` с фолбэком по
короткому заголовку, сегодняшний фикс) — **не меняется**.

### 2.3 Миграция — не требуется

Существующие уже-синканные карточки (например «Опера Гарнье» —
`[Город] Элизиум — Главный Элизиум, 9-й округ`) переписываются в чистый
формат сами, при первом же следующем срабатывании синка с любой стороны
(город сохраняет Географию ИЛИ Рассказчик меняет статус в модалке локации) —
тот же принцип, что пользователь уже принял сегодня («синк всегда
побеждает»). Отдельная миграция не нужна и не запрашивалась.

---

## 3. UI — «Статус» вместо «Зона контроля»

### 3.1 Удаление «Зона контроля» — построчный контракт

| Файл | Было | Действие |
|---|---|---|
| `web/public/scripts/locations.js` | `ZONE_CLASS_LABELS` (:8-14) | Удалить |
| — | `zoneClass()` (:31-39) | Удалить |
| — | `.loc-zone-icon` в `_locCardHtml()` (:152) | Заменить на нейтральную заглушку без категорий — `📍` (тот же символ, что уже используется как «прочее» в `ZONE_CLASS_LABELS.other`, но БЕЗ логики выбора по категории) |
| — | `.locdet-no-img` в `openLocDetail()` (:360) | Та же замена на `📍` |
| — | Бейдж «Зона контроля» в `.locdet-legend-row` (:549-553) | Заменить на «Статус», см. §3.2 |
| — | `#loc-filter-zone` обработчик (:634-637) | Переименовать под «Статус» (переиспользовать элемент, не создавать новый id) — см. §3.3 |
| — | Фильтрация в `renderLocations()` (:85) | `zoneClass(l.zone) === zone` → `l.locStatus === status` |
| — | `#loc-edit-zone` — заполнение/сброс/чтение (:1071, :1095-1098, :1237, :1272) | Удалить все 4 точки целиком |
| `web/public/index.html` | `#loc-filter-zone` (:696-703) | Переименовать опции под 5 типов (см. §3.3), сам select/id можно оставить — только его смысл и опции меняются |
| — | `#loc-edit-zone` + лейбл + тултип (:1276-1283) | Удалить целиком (форма создания без замены, п.4 задачи) |
| `web/public/styles.css` | `.badge-loc-*` (5 классов, :5819-5848) | Удалить (новые бейджи статуса — свои классы, см. §3.2) |
| `web/lib/parsers/location.js` | `loc.zone = metaField('Зона')` (:39) | **Оставить как есть** — решение Аналитика §1, поле безвредно как неиспользуемые исторические данные |
| `web/routes/locations.js` | `**Зона:** [📍 Локация]` в `_locCardTemplate()` (:23) | **Оставить как есть**, тем же обоснованием — новые карточки продолжают получать пустое поле, никто его не читает, менять шаблон нет смысла раз поле не мигрируется |
| — | `zone: 'Зона'` в `fieldMap` (:256) | **Оставить как есть** — путь чтения/записи не вызывается больше ни из одного UI-элемента, но не мешает; удаление — за счёт лишнего риска без пользы |

### 3.2 Бейдж «Статус» в `.locdet-legend-row`

**Файл:** `web/public/scripts/locations.js`, `openLocDetail()`. Заменить:
```js
// Было (:549-553):
<div class="locdet-legend-item">
  <span class="locdet-legend-lbl">Зона контроля</span>
  <span class="badge badge-loc-${zc}">${ZONE_CLASS_LABELS[zc]}</span>
</div>
```
на:
```js
<div class="locdet-legend-item">
  <span class="locdet-legend-lbl">Статус</span>
  <span class="badge badge-status-${_statusClass(loc.locStatus)}">${loc.locStatus ? loc.locStatus.toUpperCase() : '—'}</span>
</div>
```
Новая функция-классификатор (замена `zoneClass()`, но по прямому равенству,
не подстрочному матчингу — значение теперь чистое, подстрочный поиск не
нужен):
```js
const STATUS_BADGE_CLASS = {
  'Элизиум': 'elysium', 'Приёмная князя': 'prince', 'Убежище': 'haven',
  'Шериф': 'sheriff', 'Сенешаль': 'seneschal',
};
function _statusClass(status) { return STATUS_BADGE_CLASS[status] || 'other'; }
```
`zc`/`ZONE_CLASS_LABELS[zc]` — обе переменные `openLocDetail()` (:348, :360)
и `_locCardHtml()` (:116) — удаляются как источник бейджа, но `zc`
переменная в `_locCardHtml()`/`openLocDetail()` всё ещё нужна ТОЛЬКО для
заглушки безартовой карточки/модалки — заменяется на константный `'📍'`
(§3.1), сама переменная `zc`/вызов `zoneClass()` удаляются, литерал
подставляется напрямую.

**CSS** (`web/public/styles.css`, рядом с бывшими `.badge-loc-*`) — 5 новых
классов `.badge-status-elysium/prince/haven/sheriff/seneschal` + `.badge-status-other`
(для случая, когда значение не входит в 5 типов — например, недавно
мигрированный текст на карточке, который ещё не тронут UI, см. §2.3) —
цвета переиспользовать по духу как у прежних `.badge-loc-*` (реализующий
подбирает 5 отличимых оттенков, дизайнерского решения эта техспека не
даёт — при реализации свериться с `impeccable`/`web-design-guidelines`
на контраст, как того требует `CLAUDE.md` проекта для правок `styles.css`).

### 3.3 Фильтр «Статус» на странице «Локации»

**Файл:** `index.html:696-703`. Опции — 5 типов вместо 4 категорий зоны:
```html
<select class="filter-select" id="loc-filter-zone">
  <option value="all">Все статусы</option>
  <option value="Элизиум">🏛️ Элизиум</option>
  <option value="Приёмная князя">👑 Приёмная князя</option>
  <option value="Убежище">🛌 Убежище</option>
  <option value="Шериф">⚔️ Шериф</option>
  <option value="Сенешаль">📜 Сенешаль</option>
</select>
```
(id `loc-filter-zone` можно оставить как есть — переименование id не несёт
функциональной пользы и требует правки всех мест, где на него ссылаются;
если реализующий предпочитает переименовать в `loc-filter-status` для
читаемости кода — это чисто косметическое решение, не влияет на контракт).

**Файл:** `locations.js:85`, `renderLocations()`:
```js
// Было:
if (zone !== 'all') list = list.filter(l => zoneClass(l.zone) === zone);
// Стало:
if (zone !== 'all') list = list.filter(l => l.locStatus === zone);
```
(`STATE.locFilter.zone` — само имя поля состояния можно не переименовывать,
внутренняя деталь, не пользовательский контракт).

### 3.4 VtM-вкладка — `<input>` → `<select>`

**Файл:** `locations.js`, `vtmEditHtml` (там же, где сегодня добавлен
`locdet-vtm-danger`, техспека location-card-actions §3.3). Было:
```js
<input class="form-control locdet-field-inp" id="locdet-vtm-status" value="${escAttr(loc.locStatus || '')}" placeholder="Статус">
```
Стало:
```js
<select class="form-control locdet-field-inp" id="locdet-vtm-status">
  <option value=""${!loc.locStatus ? ' selected' : ''}>—</option>
  ${CITY_LOCATION_TYPES.map(t => `<option value="${escAttr(t)}"${t === loc.locStatus ? ' selected' : ''}>${escHtml(t)}</option>`).join('')}
</select>
```
`CITY_LOCATION_TYPES` — глобал из `city.js` (см. §1.1, дублирование списка
принято как есть) — доступен на момент вызова `vtmEditHtml()` (вызывается
из пользовательского взаимодействия, оба скрипта к этому моменту уже
загружены, несмотря на то что `locations.js` физически подключён раньше
`city.js` в `index.html`, порядок `<script>`-тегов на порядок выполнения
ФУНКЦИЙ, вызванных позже, не влияет).

`_locSavePanel('vtm')` (`locations.js`, `fields.vtmTable.locStatus`) — без
изменений в СБОРЕ payload (тот же `document.getElementById('locdet-vtm-status')?.value`,
просто теперь читает `<select>`, а не `<input>` — API идентичен).

---

## 4. Обратная запись: локация → город

### 4.1 Точка входа

**Файл:** `web/routes/locations.js`, `PUT /api/locations/:slug/fields`,
ветка `key === 'vtmTable'` (:227-253, план location-card-actions техспеки
уже документировал эту ветку в §3.1 сегодня). После записи самой VtM-таблицы
локации — если среди изменённых ключей есть `locStatus`, дополнительно
синкать город:

```js
if (key === 'vtmTable') {
  // ... существующая запись таблицы в card, без изменений ...
  if ('locStatus' in tableFields) {
    const locTitle = parseLocation(card, slug).title || slug;
    try {
      const syncResult = await syncLocationStatusToCity(city, locTitle, tableFields.locStatus);
      if (syncResult.blocked) {
        return res.status(409).json({
          error: `У локации «${locTitle}» в «Отмеченных локациях» города есть заметка «${syncResult.note}» — сними статус через вкладку «География» города, чтобы не потерять её`,
        });
      }
    } catch (e) { /* см. §4.3 — не блокирует сохранение локации */ }
  }
  continue;
}
```

**Важно про `locTitle`**: маршрут `PUT /api/locations/:slug/fields`
(`web/routes/locations.js:135-170`) сейчас работает с СЫРЫМ текстом карточки
(`card = await fs.readFile(mdPath, 'utf-8')`, дальше — построчные regex-правки),
**никакой переменной с заголовком локации там сегодня нет** — только `slug`
из URL (не отображаемое имя, использовать для сопоставления с городом
нельзя, см. §1.3). Нужно явно получить заголовок: `parseLocation` уже
импортирован в этом файле (`const { slugify, writePrompt, parseLocation, ... } = require('../lib/parsers');`,
`locations.js:16`) — перед вызовом `syncLocationStatusToCity` добавить
`const locTitle = parseLocation(card, slug).title || slug;` (на актуальном
`card` — правки заголовка через этот роут не предусмотрены, `card` на
момент вызова синка достаточно свежий).

### 4.2 Новая функция `syncLocationStatusToCity`

**Файл:** `web/routes/locations.js` (соседний модуль, не отдельный файл —
используется только этим роутом; если позже понадобится где-то ещё —
вынести, сейчас нет причины).

```js
const { CITY_LOCATION_TYPES, splitLocationSection, serializeLocationSection, findRecordIndexForLocation } = require('../lib/significant_places');
const { parseCityMd } = require('../lib/parsers'); // уже есть в проекте, используется cities.js
const { upsertCitySectionFromForm } = require('../lib/city_md_writer');

// Обратная запись «Статус» локации → «Отмеченные локации» города (2026-08-06,
// техспека «Статус заменяет Зону» §4). Симметрична syncSignificantPlaceStatus
// (cities.js, город → локация), но точечно правит ОДНУ запись, не весь диф.
// newStatus === '' — попытка снять статус (см. §4.3, блокировка при заметке).
async function syncLocationStatusToCity(city, locTitle, newStatus) {
  const cityMdPath = path.join(cityDir(city), 'city.md');
  const raw = await fs.readFile(cityMdPath, 'utf-8').catch(() => null);
  if (raw === null) return { blocked: false }; // города нет/не читается — не блокируем локацию из-за этого

  const sections = parseCityMd(raw).sections || {};
  const { narrative, records } = splitLocationSection(sections.locations || '');
  const idx = findRecordIndexForLocation(records, locTitle);

  if (!newStatus) {
    // Снятие статуса — п.5.4 плана Аналитика: блокируем, если есть заметка.
    if (idx !== -1 && records[idx].note) {
      return { blocked: true, note: records[idx].note };
    }
    if (idx === -1) return { blocked: false }; // нечего снимать — не трогаем city.md вовсе
    records.splice(idx, 1);
  } else if (idx !== -1) {
    if (records[idx].type === newStatus) return { blocked: false }; // уже актуально, не трогаем файл
    records[idx] = { ...records[idx], type: newStatus };
  } else {
    records.push({ type: newStatus, name: locTitle, note: '' });
  }

  const newSectionText = serializeLocationSection(narrative, records);
  const { text: newCityMd } = upsertCitySectionFromForm(raw, 'Ключевые локации', newSectionText);
  await writeFileAtomic(cityMdPath, newCityMd, 'utf-8');
  return { blocked: false };
}
```

**`locTitle` при создании НОВОЙ записи** (ветка `else`, `idx === -1`) —
пишется **полный заголовок карточки** (`loc.title`), не короткое имя — это
осознанно проще правила чтения (§1.3 сопоставляет и полным, и коротким), но
не переусложняет запись: если у карточки нет «слитного» заголовка (обычный
случай для новых/будущих локаций), полный заголовок и есть короткое имя,
они совпадают. Для локаций со «слитным» заголовком (как «Опера Гарнье») эта
ветка не сработает — у них запись уже существует (`idx !== -1`, попадут в
ветку обновления типа, не создания).

### 4.3 Обработка ошибок

- Если чтение/запись `city.md` падает (файл заблокирован, гонка и т.п.) —
  **не блокирует сохранение самой локации**: VtM-таблица карточки локации
  уже записана к этому моменту (см. порядок в §4.1 — синк идёт ПОСЛЕ
  успешной записи card), ошибка синка в город — best-effort, ловится и
  логируется, не возвращается клиенту как 500 (тот же принцип, что уже
  применяется к другим best-effort синкам в проекте, напр. `warnings`
  в ответе `PUT /api/cities/:slug`).
- Блокировка при непустой заметке (§4.2, `blocked: true`) — **единственный
  случай**, когда синк ПРЕПЯТСТВУЕТ основной операции (согласно решению
  пользователя §3.3 п.3) — весь `PUT /fields` отклоняется целиком с `409` и
  понятным текстом, включающим саму заметку (чтобы Рассказчик видел, что
  именно рискует потерять, не открывая отдельно Географию).

---

## 5. Тест-план

**Вырезка «Зона контроля»:**
- Страница «Локации» открывается без ошибок в консоли, фильтр называется
  по смыслу «статусы», опции — 5 типов.
- Безартовая карточка сетки и безартовая детальная модалка показывают `📍`
  вместо прежнего зоно-зависимого символа.
- Форма создания локации не содержит поля «Зона» (и не содержит «Статус» —
  п.4 задачи).

**Формат `locStatus`:**
- Локация без назначения в «Отмеченных локациях» — `loc.locStatus` пуст,
  select на VtM-вкладке открывается на «—», бейдж в шапке — «—».
- Городская Географии назначает «Элизиум» локации → после сохранения города
  `loc.locStatus === 'Элизиум'` (без маркера/заметки в самом значении).
- Повторный прогон синка (без изменений) — `{ changed: 0 }`-подобная
  идемпотентность (файл локации не переписывается второй раз с тем же
  значением, см. `current.trim() !== conf.value`-проверку).

**Обратная запись:**
- Локация БЕЗ записи в «Отмеченных локациях» → выбор «Шериф» на VtM-вкладке
  и сохранение → в `city.md` появляется новая строка `Шериф: <Название>`
  (без заметки).
- Локация С записью (тип «Убежище», без заметки) → смена на «Сенешаль» в
  модалке локации → строка в городе меняет тип на «Сенешаль», имя/позиция
  строки не съезжают.
- Локация С записью И заметкой → попытка сбросить статус в «—» → `409`,
  текст ошибки называет заметку; сама VtM-таблица локации (остальные поля)
  сохраняется НЕЗАВИСИМО (если пользователь одновременно менял «Фракцию» —
  она должна сохраниться, несмотря на блокировку по «Статусу»; **уточнить
  при реализации** — учитывая, что вся `vtmTable` обычно приходит ОДНИМ
  PUT-запросом, блокировка по `locStatus` не должна откатывать уже
  записанные до неё поля той же таблицы, раз запись card уже прошла ДО
  вызова синка по порядку из §4.1).
- Локация с «Опера Гарнье»-подобным заголовком (короткое имя города ≠
  полный заголовок) → смена статуса из модалки локации находит СУЩЕСТВУЮЩУЮ
  запись «Опера Гарнье» в городе (не создаёт дубль) — регресс-тест на баг,
  найденный и исправленный сегодня для обратного направления.
- `npm test` — существующий тест `'Значимые места: смена локации со
  статусом «Элизиум» переносит «Статус» (VtM)'` (`web/tests/all.test.js`,
  обновлён сегодня под предыдущую итерацию формата) — **потребует повторного
  обновления** под новый чистый формат (без `[Город]`-маркера в ожидаемом
  значении, см. §2.1).

---

## 6. Порядок реализации

1. **Модуль `significant_places.js`** (§1) — фундамент, ничего не ломает
   сам по себе (рефакторинг размещения).
2. **Смена формата `locStatus`** (§2) — на новом модуле, меняет
   `cities.js`. Обновить существующий тест под новый формат (§5).
3. **Вырезка «Зона контроля» + бейдж/select «Статус»** (§3) — независимо
   от §4, можно параллельно с ним.
4. **Обратная запись** (§4) — последней, самая рискованная часть (новый
   код записи в city.md с другой стороны), после того как формат (§2)
   уже стабилен.
