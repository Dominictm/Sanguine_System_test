# Техспека: вкладка «Титулы» в Библиотеке → Сородичи

**Роль:** Системный аналитик. **Входные данные:** [2026-08-06-library-titles-data.md](2026-08-06-library-titles-data.md) (Аналитик).
**Основа реализации:** зеркало существующего паттерна K3/K4 (Кланы/Секты, `2026-08-04-library-kindred-*`) — третья под-вкладка внутри «Сородичи», без нового верхнеуровневого раздела библиотеки.

---

## 1. Решения по открытым вопросам данных

Все пять вопросов из §2 переданного документа — технические, решаю сам, без блокировки на пользователе (данные — markdown-файлы, изменить решение потом дёшево).

| № | Вопрос | Решение | Почему |
|---|---|---|---|
| 1 | Поле «принадлежность» — не всегда секта | Свободный текст, поле `affiliation`. Переиспользует уже существующий тип `clans` из `_LIB_FIELD_DEFS` (`{label: 'Клан / принадлежность', type: 'text'}`) с `fieldLabels` override на «Принадлежность» — та же техника, что у Клана с «Секта» (там `category-select`, но у Титулов список не ограничен только сектами, поэтому текст, не select). |
| 2 | Дубли имён (Регент/Доминион/Серафим/Мустаджиб/Эмиссар) | Отдельные карточки, slug уже разрешён (`regent_shabash`/`regent_tremery` и т.п. — см. §4 исходного документа). На карточке принадлежность отображается всегда (как у Клана — «Секта»), коллизия отображаемого имени решается визуально бейджем принадлежности, не переименованием. |
| 3 | 11 записей без текста источника | Заводятся как обычные записи с описанием-заглушкой `«⚠️ Требует заполнения — статья источника отсутствует или пуста.»`. Маркер `⚠️` — уже используемая в проекте конвенция «поле не заполнено» (см. `char-detail.js:52` — `raw.includes('⚠️')` определяет пустое поле карточки персонажа), переиспользуется по аналогии, не по прямому прецеденту в `system/library/` (там такой практики раньше не было — это первый прецедент). |
| 4 | Шабаш: подкатегории Чёрная Рука / Инквизиция | Не отдельная под-структура в UI — значение поля `affiliation` = `"Шабаш · Чёрная Рука"` / `"Шабаш · Инквизиция"` (одна строка, разделитель «·» — уже используется в бейджах фракций в другом месте проекта). |
| 5 | Шакар/Шакари (дубли «Силсила Ассамитов») | Не заводятся отдельными карточками. В карточку «Силсила» (Ассамиты) при авторском наполнении добавляется пометка алиасов в `note`. |

---

## 2. Формат данных — `system/library/titles/<slug>.md`

Полное зеркало `system/library/clans/*.md` / `sects/*.md` (см. `web/lib/clans.js`, `web/lib/sects.js`), с двумя новыми полями (`Принадлежность`, `Негативный`) вместо клановых (`Дисциплины`/`Слабость`):

```markdown
# <Название>

- **Принадлежность:** <секта / клан / группа — свободный текст, напр. "Камарилья" или "Шабаш · Чёрная Рука" или "Ассамиты (клан)">
- **Негативный:** да                    ← строка присутствует ТОЛЬКО если титул негативный (та же конвенция, что у «Авторское»: отсутствие строки = false)
- **Источник:** https://wod.fandom.com/ru/wiki/...
- **Авторское:** да                     ← только для пользовательских записей (создаются через POST)
> (опционально — примечание/цитата)

## Описание

<текст своими словами, НЕ дословная копия источника — тот же принцип, что применялся к 34 кланам в system/library/clans/>
```

**Важно:** §5 CLAUDE.md проекта («Инструменты» → миграции) не требуется — это новый раздел, не меняющий существующий формат карточек. `card_schema.md`/`validate_cards.js` не затрагиваются: библиотека справочников (`system/library/`) вне их контракта, как и Кланы/Секты сейчас.

---

## 3. Backend — `web/lib/titles.js` (новый файл)

Полная копия сигнатуры `parseClanMd`/`parseSectMd`:

```js
'use strict';
function parseTitleMd(rawContent, slug) {
  // ... поля: name, affiliation, negative (boolean), source, note, description, custom
}
module.exports = { parseTitleMd };
```

Отличие от `parseClanMd`: `t.negative = field(content, 'Негативный') === 'да';` (boolean, не строка).

## 4. Backend — `web/routes/library.js`

Мирроринг блока «Библиотека: справочник кланов» (строки 108–135) + CRUD-блока (399–447) построчно:

```js
const { parseTitleMd } = require('../lib/titles');
const TITLES_DIR = path.join(ROOT, 'system', 'library', 'titles');
let _titleCache = null;

async function loadTitles() { /* тот же mtime-sig кэш, что loadClans/loadSects */ }

router.get('/api/library/titles', async (_req, res) => {
  try { res.json(await loadTitles()); }
  catch (e) { serverError(res, e); }
});

function _titleTemplate({ name, affiliation, negative, source, note, description }) {
  const lines = [`# ${name}`];
  if (affiliation) lines.push(`- **Принадлежность:** ${sanitizeInlineText(affiliation)}`);
  if (negative) lines.push('- **Негативный:** да');
  if (source) lines.push(`- **Источник:** ${sanitizeInlineText(source)}`);
  lines.push('- **Авторское:** да');
  if (note) { lines.push(''); for (const l of note.split('\n')) lines.push(`> ${sanitizeInlineText(l)}`); }
  lines.push('', '## Описание', '', sanitizeInlineText(description || ''), '');
  return lines.join('\n');
}

router.post('/api/library/titles', express.json(), async (req, res) => { /* зеркало POST /clans, поля: name, affiliation, negative, source, note, description */ });
router.put('/api/library/titles/:slug', express.json(), async (req, res) => { /* зеркало PUT /clans/:slug — canon-protected, 403 если !custom */ });
router.delete('/api/library/titles/:slug', async (req, res) => { /* зеркало DELETE /clans/:slug — soft-delete в TITLES_DIR/_deleted/ */ });
```

**Контракт эндпоинтов** (для полноты — идентичен уже существующему `/api/library/clans`):

| Метод | Путь | Тело запроса | Успех | Ошибки |
|---|---|---|---|---|
| GET | `/api/library/titles` | — | `200`, `Title[]` | — |
| POST | `/api/library/titles` | `{name, affiliation?, negative?, source?, note?, description?}` | `200 {ok, slug}` | `400` пустое имя / slug не строится, `409` slug занят |
| PUT | `/api/library/titles/:slug` | то же | `200 {ok, slug}` | `400`, `404` не найден, `403` не авторская запись |
| DELETE | `/api/library/titles/:slug` | — | `200 {ok}` | `404`, `403` не авторская запись |

`Title` DTO:
```ts
{ slug: string, name: string, affiliation: string, negative: boolean,
  source: string, note: string, description: string, custom: boolean }
```

---

## 5. Frontend — разметка (`web/public/index.html`)

Третья кнопка под-вкладки рядом с «Кланы»/«Секты» (строки 746–749) + панель (751–763):

```html
<div class="disciplines-subtab-bar">
  <button class="disciplines-subtab-btn active" data-kin-group="clans" aria-pressed="true">Кланы</button>
  <button class="disciplines-subtab-btn" data-kin-group="sects" aria-pressed="false">Секты</button>
  <button class="disciplines-subtab-btn" data-kin-group="titles" aria-pressed="false">Титулы</button>
</div>
...
<div class="kindred-subpanel" id="kin-sub-titles">
  <div class="lib-add-row"><button type="button" class="mod-fill-add-btn" data-lib-add="titles">+ Добавить титул</button></div>
  <div class="lib-panel" id="lib-titles-body">
    <div class="loading-state"><div class="spinner"></div>Загрузка...</div>
  </div>
</div>
```

Переключение подхватывается существующим делегатом (`scripts.js:964-976`) без изменений — он уже общий по `data-kin-group`/`.kindred-subpanel`.

## 6. Frontend — загрузка (`web/public/scripts/v20-sheet.js`)

`loadKindred()` (строка 1508) — добавить третий блок по тому же шаблону:

```js
if (!which || which === 'titles') {
  const body = document.getElementById('lib-titles-body');
  if (body && !_titlesCache) body.innerHTML = '<div class="loading-state"><div class="spinner"></div>Загрузка...</div>';
  await ensureTitles();
  _libRenderTitleList();
}
```

Новые функции — точное зеркало `ensureClans`/`_clanBySlug`/`_libClanDetailHtml`/`_libClanCardsHtml`/`_v20RenderClanDetail`/`_v20OpenClanModal`/`_libRenderClanList` + click-делегат (строки 1385–1443), с заменой `sect` → `affiliation` и добавлением бейджа `negative`:

```js
function _libTitleCardsHtml() {
  return `<div class="lib-cards">${(_titlesCache || []).map(t => {
    const badge = t.custom ? '<span class="lib-card-custom-badge">✏️ Авторское</span>' : '';
    const negBadge = t.negative ? '<span class="lib-card-negative-badge">⚠️ Негативный</span>' : '';
    const aff = t.affiliation ? `<div class="lib-card-sect">${escHtml(t.affiliation)}</div>` : '';
    return `<button type="button" class="lib-card" data-title-slug="${escAttr(t.slug)}">
      <div class="lib-card-name">${escHtml(t.name)}</div>${aff}${negBadge}${badge}
    </button>`;
  }).join('')}</div>`;
}
```

`_libTitleDetailHtml(t)` — заголовок + бейдж принадлежности + бейдж «Негативный титул» (если применимо) + `note` + `description`, без полей «Дисциплины»/«Слабость» (они клановые, у Титула их нет).

## 7. Frontend — форма создания/правки (`web/public/scripts/library-authoring.js`)

`_LIB_KIND_CONFIG` — новая запись:

```js
titles: {
  title: 'титул',
  fields: ['clans', 'checkbox-negative', 'source', 'note', 'description'],
  fieldLabels: { clans: 'Принадлежность' },
  reload: () => { _titlesCache = null; return loadKindred('titles'); },
},
```

**Новый тип поля** `checkbox-negative` — в `_LIB_FIELD_DEFS`/`_libFieldRowHtml` сейчас нет boolean-полей (только text/textarea/select/number/levels). Три точки правки, все — третья ветка в уже существующих switch-подобных местах (не новая инфраструктура):

1. `_LIB_FIELD_DEFS` — новый дескриптор:
   ```js
   'checkbox-negative': { label: 'Негативный титул', type: 'checkbox' },
   ```
2. `_LIB_FIELD_RECORD_KEY` (`library-authoring.js:47-51`) — маппинг на реальное имя поля в записи, как уже сделано для `category-text`/`system-text`/`discipline-list`:
   ```js
   'checkbox-negative': 'negative',
   ```
   Благодаря этому `_libFormFieldsHtml` (строка 137-149) уже БЕЗ дополнительных правок прокинет `rec.negative` (boolean) как `value` в `_libFieldRowHtml('checkbox-negative', rec.negative, label)` — тот же механизм, что и у текстовых полей, отдельного шага «проставить checked после рендера» не требуется.
3. `_libFieldRowHtml` (строка 105+) — новая ветка, использующая пробрасываемый `value` для `checked`:
   ```js
   if (def.type === 'checkbox') {
     return `<div class="chr-form-group chr-form-checkbox-row" data-lib-field="${key}">
       <label class="chr-form-checkbox-label">
         <input type="checkbox" data-lib-input${value ? ' checked' : ''}>
         ${escHtml(label)}
       </label>
     </div>`;
   }
   ```

И в `_libCollectForm` (`library-authoring.js:192-206`) — цикл, читающий `input.value` по всем полям из `cfg.fields`; для `key === 'checkbox-negative'` нужен третий спецкейс по образцу уже существующих `levels`/`category-select`:

```js
if (key === 'checkbox-negative') { body.negative = !!_libFieldInput(root, key)?.checked; continue; }
```

## 8. CSS (`web/public/styles.css`)

Один новый класс `.lib-card-negative-badge`, рядом с существующим `.lib-card-custom-badge` (строка 10224) — тот же паттерн, но цвет `var(--c-error)` вместо `var(--gold)`:

```css
.lib-card-negative-badge {
  display: inline-block;
  font-size: var(--fs-3xs);
  color: var(--c-error);
  margin-top: 6px;
}
```

`.lib-card-sect` (строка 10160) переиспользуется как есть для «Принадлежность» — уже нейтральное название по смыслу (это и есть «пометка на карточке» по коду-комментарию), новый CSS не нужен.

---

## 9. Наполнение данными — ВНЕ этой техспеки

91 текстовое описание (см. переданный документ, §3) требуют переписывания своими словами перед вставкой в `.md`-файлы — прямое копирование с wod.fandom.com не делается (тот же принцип, что был применён к 34 кланам). Это отдельный по объёму этап контент-райтинга, не инженерная задача — передаётся Разработчику отдельным шагом после того, как инфраструктура (§3–8) готова и протестирована на 2–3 записях для проверки конвейера.

11 записей без источника получают шаблонную заглушку (см. §1, п.3) при первом проходе.

---

## 10. Тест-план (для Разработчика)

Зеркалит существующие тесты K3/K4 в `web/tests/all.test.js` (искать `'библиотека кланов'`/`'библиотека сект'` в файле) — тот же набор кейсов на `titles`:
- GET пустой/непустой список.
- POST создаёт файл, слаг из имени, 409 при коллизии слага.
- PUT/DELETE — 403 на канонической записи, 200 на авторской.
- `negative` boolean корректно сериализуется в markdown и обратно парсится.
- Карточка с `affiliation`, содержащим «·» (Шабаш · Чёрная Рука), не ломает рендер/escaping.
- `validate_cards.js`/`--strict` не трогает `system/library/` — подтвердить, что новая папка не ловится линтером карточек персонажей/локаций (тот же инвариант, что уже верен для clans/sects).

---

## Порядок выполнения (рекомендация)

1. `web/lib/titles.js` + роуты (§3–4) — без этого фронтенд нечего дёргать.
2. Разметка + `loadKindred`/рендер-функции (§5–6) на пустом списке (0 файлов в `system/library/titles/`) — проверить, что вкладка не падает на пустоте.
3. Форма создания (§7) + checkbox-тип (новый код, не копипаста — тестировать отдельно).
4. CSS-бейдж (§8).
5. Создать 2-3 тестовые записи вручную (Князь, Изгой — с негативным флагом) — прогнать полный цикл create/edit/delete глазами в браузере.
6. Только после проверки конвейера — контент-райтинг оставшихся ~88 записей (§9), пакетами по категориям.
