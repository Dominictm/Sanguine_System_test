# Техспека: карточка локации — бейджи, удаление, VTM-вкладка, таблица «Ключевые локации»

**Роль:** Системный аналитик. **Входные данные:**
[2026-08-06-location-card-actions-analysis.md](2026-08-06-location-card-actions-analysis.md)
(Аналитик) — все ссылки file:line ниже предполагают этот документ прочитанным,
повторяю только то, что меняю/уточняю/решаю. Разделы §4-§6 документа-анализа
**отменены и не описываются здесь** (заменены §7 того же документа — решение
уже принято пользователем). Актуальный охват этой техспеки: §1, §2, §3, §7, §8
документа-анализа.

**Решения пользователя** (не пересматриваются):
1. Cascade-unlink из модулей при удалении локации — тихий, без отдельного UI-выбора (§3.3).
2. VTM-вкладка локации — «полноценная страница»: Статус синкается из
   Географии города, Фракция — select из фракций города, Опасность
   добавляется туда же, чекбокс «Частный домен» переключает
   Фракция↔Хозяин (§7).
3. «Зону» (`loc.zone`, `zoneClass()`, 4 цветных бейджа, фильтр «Все зоны») —
   **не трогаем** отдельно от этой задачи.
4. Таблица «Отмеченные локации» вместо текстового блока на Географии,
   отдельный блок «Общее описание ключевых локаций города» под ней (§8).

---

## 0. Сводка решений по открытым вопросам анализа

| # | Вопрос | Решение |
|---|---|---|
| §3.2 | `deleteLocCurrent()` завязан на модуль-переменную `_locEditSlug` | Параметризовать: `deleteLoc(slug)`, старый вызов без аргумента продолжает работать через дефолт (см. §3) |
| §3.3 | Cascade-unlink из модулей — как реализовать | Новая функция `unlinkLocationFromAllModules()`, переиспользует `_parseModuleLocSlugs`/`_writeModuleLocSlugs` (см. §3) |
| §7.1 | **Найдено СИСТЕМНЫМ АНАЛИТИКОМ, не было в анализе**: `Статус` — это НЕ metaField-бюллет, а строка markdown-ТАБЛИЦЫ (`\| **Статус** \| значение \|`) внутри секции `## VtM` — существующий `writeLocationCardField()` (`web/lib/db.js:158-170`) пишет только `**Label:**`-бюллеты и **не найдёт** табличную строку (разные форматы полужирного: `**Статус:**` с двоеточием vs `**Статус**` без). Прямой редирект `conf.mdKey` на `'Статус'` **не будет работать молча** без правки. Решение — новая функция `writeLocationVtmTableField()` (см. §7.1) |
| §7.2 | Источник списка фракций для select «Фракция» | Новый эндпоинт `GET /api/cities/:slug/factions-list`, парсит `sec.factions`+`factionsMortal`+`factionsState` (тот же принцип, что `_currentFactionNames()`) — НЕ переиспользуем `/api/factions` (другой формат/источник, см. §7.5 анализа) |
| §7.5 | «Фракция» (VTM) vs «Контроль» (Метаданные) — дублирование смысла | Оставить оба поля как есть (вариант 1 Аналитика) — не в объёме этой задачи |

---

# Тема 1. Карточка локации — бейджи (§1, §2 анализа)

## 1.1 Убрать «Зона контроля» (`zoneBadge`) с карточки

**Файл:** `web/public/scripts/locations.js`, функция `_locCardHtml()` (строки 115-143).

Было:
```js
const textBlock = `
    <div class="loc-title">${escHtml(cardTitle)}</div>
    ${distLine    ? `<div class="loc-district">${distLine}</div>` : ''}
    ${loc.address ? `<div class="loc-address">${escHtml(loc.address)}</div>` : ''}
    <div class="loc-badges">${zoneBadge}${masqBadge}</div>`;
```
Стало (см. §1.2 ниже за составом `.loc-badges` целиком после обеих правок):
убрать `zoneBadge` из строки сборки `.loc-badges`. Переменная `zoneBadge`
(строка 121) и её вычисление можно оставить как мёртвый код только если она
используется где-то ещё в функции — **не используется**, удалить целиком
вместе с константой.

`.loc-zone-icon` (строка 139, крупный значок-заглушка для карточек без
изображения) — **не трогаем**, подтверждено анализом (§1 документа-анализа):
он не подписан текстом «Зона контроля», решает другую задачу.

## 1.2 Компактные бейджи «Опасность»/«Маскарад»

**Тот же файл, та же функция.** Добавить `dangerBadge` (сейчас отсутствует
в `_locCardHtml`, есть только в `_v20...`/детальной модалке), сжать
`masqBadge` до одной иконки:

```js
function _locCardHtml(loc, { delay = '', overlayExtra = '' } = {}) {
  const dLvl  = zoneDangerLevel(loc.dangerLevel);   // уже импортирована в файл, используется в детальной модалке
  const mLvl  = loc.masqueradeLevel || 'unknown';
  const dangerBadge = dLvl !== 'unknown' ? `<span class="badge badge-danger-${dLvl}" title="${escAttr(DANGER_BADGE_LABELS[dLvl])}">⚔️</span>` : '';
  const masqBadge    = mLvl !== 'unknown' ? `<span class="badge badge-masq-${mLvl}" title="${escAttr(MASQ_BADGE_LABELS[mLvl])}">🎭</span>` : '';
  // ...
  const textBlock = `
    <div class="loc-title">${escHtml(cardTitle)}</div>
    ${distLine    ? `<div class="loc-district">${distLine}</div>` : ''}
    ${loc.address ? `<div class="loc-address">${escHtml(loc.address)}</div>` : ''}
    <div class="loc-badges">${dangerBadge}${masqBadge}</div>`;
  // ...
}
```

`title="..."` на каждом бейдже (полный текст — «⚔️ Высокий» и т.п.) —
компенсирует потерю текста внутри бейджа нативным browser-тултипом при
наведении (десктоп; на тач-устройствах бесполезен, но это дополнение, не
единственный канал информации — иконки семантически разные, задача не
требует 100% доступности тултипа именно здесь). Порядок — danger, затем
masq (риск важнее уровня Маскарада при быстром сканировании сетки).

**CSS не меняется** — `.badge-danger-*`/`.badge-masq-*` уже дают цвет
заливки+рамки (`styles.css:5850-5886`), контент бейджа сокращается на
уровне JS-рендера, не CSS.

**Точка подключения одна** — `_locCardHtml()` используется и в сетке
«Локации», и в «Связанных локациях» модуля (`modp-loc-cards`) — правка в
одном месте покрывает обе поверхности (подтверждено анализом).

---

# Тема 2. Удаление локации (§3 анализа)

## 2.1 Параметризация `deleteLocCurrent()` → `deleteLoc(slug)`

**Файл:** `web/public/scripts/locations.js`, строки 1209-1239.

```js
async function deleteLoc(slug = _locEditSlug) {
  if (!slug) return;
  let warnText = '';
  try {
    const bl = await fetch(`/api/locations/${encodeURIComponent(slug)}/backlinks?city=${encodeURIComponent(CITY)}`).then(r => r.ok ? r.json() : null);
    if (bl && bl.count > 0) {
      const shown = bl.files.slice(0, 5).join(', ') + (bl.files.length > 5 ? `, ещё ${bl.files.length - 5}…` : '');
      warnText = ` На эту локацию ссылаются файлы (${bl.count}): ${shown} — ссылки станут битыми.`;
    }
  } catch { /* best-effort */ }

  if (!await showConfirm(`Удалить локацию «${slug}»? Это действие необратимо.${warnText}`, { danger: true, confirmText: 'Удалить' })) return;
  const btn = document.getElementById('loc-edit-delete-btn'); // может не существовать, если вызвано не из формы — см. ниже
  if (btn) btn.disabled = true;
  try {
    const r = await fetch(`/api/locations/${encodeURIComponent(slug)}?city=${encodeURIComponent(CITY)}`, { method: 'DELETE' });
    if (!r.ok) throw new Error((await r.json()).error || r.statusText);
    closeLocEditModal();          // no-op, если форма не открыта
    closeModal('loc-detail-modal'); // no-op, если модалка не открыта
    STATE.locations = [];
    await loadLocations();
    showToast('Локация удалена', 'success'); // новый вызов при удалении с карточки/детальной модалки — раньше пользователь видел закрытие формы как обратную связь, при удалении с карточки формы нет вообще, нужен явный сигнал
  } catch (e) {
    const errEl = document.getElementById('loc-edit-error');
    if (errEl) { errEl.textContent = e.message; errEl.style.display = ''; }
    else showToast('Не удалось удалить: ' + e.message, 'error'); // фоллбэк, если вызвано не из формы (нет #loc-edit-error на экране)
    if (btn) btn.disabled = false;
  }
}
// Обратная совместимость — старый вызов из формы редактирования не переписывать построчно.
const deleteLocCurrent = () => deleteLoc();
```

**Проверить при реализации** (флаг Аналитика, не проверено в этом
документе): `closeModal()` — действительно no-op на уже закрытой модалке
(грепнуть определение в `utils.js`/`scripts.js` перед тем, как полагаться
на это в новых точках вызова).

## 2.2 Иконка удаления на карточке (`.loc-card`)

**Файл:** `locations.js`, `_locCardHtml()`. Добавить кнопку в `overlayExtra`-подобный
слот, но НЕ через параметр `overlayExtra` (тот уже занят на странице модуля
кнопкой «Открепить», см. `locations.js:1372`) — добавить прямо в разметку
карточки, отдельно от `overlayExtra`:

```js
const delBtn = `<button type="button" class="loc-card-del-btn" data-del-loc="${escHtml(loc.slug)}" title="Удалить локацию" aria-label="Удалить локацию">🗑</button>`;
```
Добавить `${delBtn}` в оба варианта разметки (`has-art`/безартовая, строки
132-142), рядом с `${overlayExtra}`. `event.stopPropagation()` на клике —
обязательно (карточка сама кликабельна и открывает детальную модалку, без
остановки всплытия клик по 🗑 откроет и удаление, и модалку одновременно).

Обработчик — делегированный, рядом с существующим делегатом клика по
`.loc-card` (`locations.js:574`, `e.target.closest('.loc-card[data-slug]')`):
```js
document.addEventListener('click', e => {
  const delBtn = e.target.closest('.loc-card-del-btn');
  if (delBtn) { e.stopPropagation(); deleteLoc(delBtn.dataset.delLoc); return; }
  // ... существующий делегат открытия карточки — ставить ПОСЛЕ этой проверки
  // в той же функции, либо использовать e.stopPropagation() (см. выше) и не
  // трогать существующий делегат вовсе, если он в отдельном listener'е.
});
```
**Место в разметке** — верхний правый угол оверлея (стандартное место для
деструктивных иконок в этом проекте, см. `.diary-item-del-btn`,
`.modp-loc-card-unlink` — тот же паттерн). CSS-класс `.loc-card-del-btn` —
новый, по образцу `.modp-loc-card-unlink` (позиционирование `position:
absolute`, полупрозрачный фон, проявляется на hover карточки).

## 2.3 Иконка удаления в детальной модалке (`#loc-detail-modal`)

**Файл:** `locations.js`, строка 513 (кнопка «✏ Редактировать / Генерация»,
`#locdet-open-edit-modal`) — добавить рядом:
```js
<button class="cdet-edit-btn" id="locdet-open-edit-modal" data-slug="${escHtml(slug)}" style="margin-bottom:6px">✏ Редактировать / Генерация</button>
<button class="cdet-edit-btn locdet-delete-btn" id="locdet-delete-btn" data-slug="${escHtml(slug)}" style="margin-bottom:6px">🗑 Удалить</button>
```
Обработчик — `document.getElementById('locdet-delete-btn')?.addEventListener('click', e => deleteLoc(e.currentTarget.dataset.slug))`
рядом с уже существующей привязкой `#loc-edit-delete-btn` (`locations.js:1333`).

## 2.4 Cascade-unlink из модулей — новая серверная функция

**Файл:** `web/routes/locations.js`, внутри `DELETE /api/locations/:slug`
(строки 482-496), ПОСЛЕ успешного `fs.rename` (soft-delete), ДО ответа
клиенту:

```js
router.delete('/api/locations/:slug', async (req, res) => {
  try {
    const slug   = decodeURIComponent(req.params.slug);
    const city   = reqCity(req);
    const mdPath = await findLocMdPath(slug, city);
    if (!mdPath) return res.status(404).json({ error: 'Локация не найдена' });
    const trashRoot = path.join(locsDir(city), '_deleted');
    await fs.mkdir(trashRoot, { recursive: true });
    const dst = path.join(trashRoot, `${slug}_${Date.now()}`);
    await fs.rename(path.dirname(mdPath), dst);
    invalidateLocs(city);

    const unlinkedFrom = await unlinkLocationFromAllModules(city, slug); // новое

    console.log(`[delete-location] ${city}/${slug} → locations/_deleted/${path.basename(dst)}`);
    res.json({ ok: true, movedTo: `locations/_deleted/${path.basename(dst)}`, unlinkedFrom });
  } catch (e) { serverError(res, e); }
});
```

Новая функция (место — `web/routes/modules/shared.js`, рядом с
`_parseModuleLocSlugs`/`_writeModuleLocSlugs`, экспортировать оттуда как
остальные `_`-хелперы этого файла):

```js
// Обходит chronicles/*/modules/*/<mod>.md текущего города, у каждого — если slug
// привязанной локации совпадает с удаляемым, убирает его из списка (та же логика,
// что DELETE /api/chronicles/:chr/modules/:mod/locations/:locSlug, но по всем модулям
// сразу — вызывается ПОСЛЕ soft-delete локации, 2026-08-06, план Аналитика §3.3 вариант 2).
async function unlinkLocationFromAllModules(city, locSlug) {
  const unlinkedFrom = [];
  const chrRoot = chroniclesDir(city);
  let chronicles;
  try { chronicles = await fs.readdir(chrRoot, { withFileTypes: true }); } catch { return unlinkedFrom; }
  for (const chrEnt of chronicles) {
    if (!chrEnt.isDirectory() || chrEnt.name.startsWith('_')) continue;
    const modulesRoot = path.join(chrRoot, chrEnt.name, 'modules');
    let modules;
    try { modules = await fs.readdir(modulesRoot, { withFileTypes: true }); } catch { continue; }
    for (const modEnt of modules) {
      if (!modEnt.isDirectory()) continue;
      const modFile = path.join(modulesRoot, modEnt.name, `${modEnt.name}.md`);
      let raw;
      try { raw = await fs.readFile(modFile, 'utf-8'); } catch { continue; }
      const existing = _parseModuleLocSlugs(raw);
      if (!existing.includes(locSlug)) continue;
      const filtered = existing.filter(s => s !== locSlug);
      await writeFileAtomic(modFile, _writeModuleLocSlugs(raw, filtered), 'utf-8');
      unlinkedFrom.push(`${chrEnt.name}/${modEnt.name}`);
    }
  }
  return unlinkedFrom;
}
```

**Обоснование обхода вручную, не через `findMdLinks`/backlinks**: backlinks
находит файлы по текстовому совпадению пути — избыточно и менее надёжно
для целевой задачи «найти модули со slug в списке привязанных локаций»,
где формат хранения (`_parseModuleLocSlugs`) уже строго определён и есть
готовый парсер/writer. Прямой обход `chronicles/*/modules/*` — тот же
паттерн, что уже использует `getAllLocations`/`getAllCharacters` (рекурсивный
`fs.readdir`), просто на другом корне.

**Ответ API расширяется** полем `unlinkedFrom: string[]` — фронтенд
(`deleteLoc()`, §2.1) может опционально показать это в toast
(«Локация удалена, отвязана от 2 модулей») — **не обязательно для MVP**,
но раз сервер уже это знает, дёшево прокинуть в ответ для будущего
использования.

---

# Тема 3. VTM-вкладка как «полноценная страница» (§7 анализа)

## 3.1 Редирект `syncSignificantPlaceStatus` на «Статус» (VTM-таблица)

**Ключевая техническая находка этой техспеки** (не была в анализе): «Статус»
на VTM-вкладке — строка ТАБЛИЦЫ markdown внутри `## VtM`/`## Контекст`
(`\| **Статус** \| значение \|`, парсер — `web/lib/parsers/location.js:62-71`),
а НЕ `**Label:** значение`-бюллет, каким являются «Зона»/«Контроль»
(`metaField()`, `location.js:29-33`). Существующий
`writeLocationCardField(city, slug, mdKey, rawValue)` (`web/lib/db.js:158-170`)
матчит регэкспом `**${mdKey}:**` (**с двоеточием**) — табличную строку
`**Статус**` (без двоеточия, между `|`) он не найдёт и не запишет. Прямая
замена `conf.mdKey` на `'Статус'` в существующей функции **тихо сломается**
(regex не совпадёт, `card.replace()` вернёт файл без изменений, ошибки не
будет — обнаружится только при ручной проверке).

**Решение — новая функция**, использующая ТУ ЖЕ логику вставки/замены
табличной строки, что уже есть в `PUT /api/locations/:slug/fields`
(`web/routes/locations.js:226-247`, ветка `vtmTable`) — вынести её в
переиспользуемую функцию (важно: убрать дублирование между PUT-роутом и
новым sync-путём, а не копировать regex второй раз):

**Файл:** `web/lib/db.js` (рядом с `writeLocationCardField`):
```js
// Пишет ОДНУ строку VtM-таблицы локации (| **Label** | значение |) — то же место
// хранения, что locStatus/faction/figures/threats/masquerade (парсер — location.js
// VtM table fields). В отличие от writeLocationCardField (бюллеты **Label:**), формат
// таблицы другой — нужна отдельная функция, не общий метод (2026-08-06, техспека
// «карточка локации» §3.1 — выделено из PUT /api/locations/:slug/fields, ветка vtmTable,
// чтобы не дублировать regex между HTTP-путём и sync-путём).
async function writeLocationVtmTableField(city, slug, key, value) {
  const LABELS = { locStatus: 'Статус', faction: 'Фракция', figures: 'Постоянные фигуры', threats: 'Угрозы', masquerade: 'Маскарад' };
  const label = LABELS[key];
  if (!label) throw new Error(`Неизвестный VtM-ключ таблицы: ${key}`);
  const mdPath = await findLocMdPath(slug, city);
  if (!mdPath) return false;
  let card = await fs.readFile(mdPath, 'utf-8');
  const cellVal = sanitizeInlineText(String(value ?? '').trim()).replace(/\|/g, '∣');
  card = card.replace(
    /(## (?:🩸\s+)?(?:VtM[^\n]*|Контекст[^\n]*)\n+)([\s\S]+?)(\n## |\n---|$)/i,
    (_, hdr, body, tail) => {
      const lines = body.split('\n');
      const esc = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const rowRe = new RegExp(`^\\|\\s*\\*\\*${esc}\\*\\*\\s*\\|`);
      const idx = lines.findIndex(l => rowRe.test(l));
      if (!cellVal) { if (idx !== -1) lines.splice(idx, 1); return hdr + lines.join('\n') + tail; }
      const row = `| **${label}** | ${cellVal} |`;
      if (idx !== -1) lines[idx] = row; else lines.push(row);
      return hdr + lines.join('\n') + tail;
    }
  );
  await writeFileAtomic(mdPath, card, 'utf-8');
  invalidateLocs(city);
  return true;
}
```
Экспортировать из `db.js` рядом с `writeLocationCardField`.

**Рефакторинг PUT-роута** (`web/routes/locations.js:226-247`) — заменить
инлайн-логику на вызов новой функции ПОШТУЧНО по ключам `tableFields`
(вместо одного `card.replace` на всю таблицу разом) — **опционально**, не
обязательно для этой задачи (роут и так работает), но убирает дублирование
кода между двумя местами, которые теперь делают одно и то же по одной
строке за раз. Рекомендация — рефакторить, раз функция всё равно
выделяется.

**`SIGNIFICANT_PLACE_TYPES`** (`web/routes/cities.js:307-313`) — меняется на:
```js
const SIGNIFICANT_PLACE_TYPES = {
  'Элизиум':        { field: 'locStatus', value: '[Город] Элизиум' },
  'Приёмная князя':  { field: 'locStatus', value: '[Город] Приёмная князя' },
  'Убежище':         { field: 'locStatus', value: '[Город] Убежище' },
  'Шериф':           { field: 'locStatus', value: '[Город] Шериф' },
  'Сенешаль':        { field: 'locStatus', value: '[Город] Сенешаль' },
};
```
`mdKey` больше не нужен (единственный получатель — `locStatus`, метка
захардкожена внутри `writeLocationVtmTableField`) — удалить поле из объекта
конфигурации либо оставить как документирующую избыточность, решает
реализующий. **`CITY_CONTROL_MARKER = '[Город]'`** (`cities.js:302`) —
теперь применяется единообразно ко всем 5 типам, включая «Элизиум» (раньше
у него не было маркера — писал голое `🏛️ Элизиум` в «Зону», теперь это поле
не трогаем вовсе, значит маркер нужен и здесь для единообразия сброса по
`startsWith`, см. `syncSignificantPlaceStatus`, `cities.js:349`).

**`syncSignificantPlaceStatus()`** (`cities.js:329-364`) — точечная правка:
строки 345/357 (`conf.field === 'zone' ? loc.zone : loc.control`) →
`loc[conf.field]` (просто `loc.locStatus`, ветвление больше не нужно —
единственное поле-получатель); строки 350/360
(`writeLocationCardField(city, loc.slug, conf.mdKey, value)`) →
`writeLocationVtmTableField(city, loc.slug, conf.field, value)`.

## 3.2 «Фракция» (VTM) — select из фракций города

### 3.2.1 Новый эндпоинт

**Файл:** `web/routes/cities.js`, рядом с остальными `GET /api/cities/:slug/*`:
```js
router.get('/api/cities/:slug/factions-list', async (req, res) => {
  try {
    const slug = req.params.slug;
    if (!(await listCities()).includes(slug)) return res.status(404).json({ error: 'Город не найден' });
    const md = await fs.readFile(path.join(cityDir(slug), 'city.md'), 'utf-8');
    const sec = parseCityMd(md).sections || {};
    const parseList = text => String(text || '').split('\n').map(l => l.replace(/^\s*-\s?/, '').trim()).filter(Boolean);
    const all = [...new Set([
      ...parseList(sec.factions).filter(l => CITY_SECTS.includes(l) || CITY_INDEPENDENT_CLANS.includes(l) || true), // все строки factions — чипы+«Другие» уже смешаны в одном поле, фильтрация по известным спискам здесь не нужна (в отличие от клиентского _cityViewFactionsHtml, который группирует по разделам для UI)
      ...parseList(sec.factionsMortal),
      ...parseList(sec.factionsState),
    ])];
    res.json(all);
  } catch (e) { serverError(res, e); }
});
```
`CITY_SECTS`/`CITY_INDEPENDENT_CLANS` — уже существуют серверной стороной?
**Проверить при реализации** — в документе-анализе они цитируются как
клиентские константы (`city.js:74-75`); если на сервере таких констант нет
(парсинг «Фракции» на бэкенде мог никогда не различать чипы от «Другие» —
и не обязан для ЭТОЙ задачи, весь список нужен плоским) — упростить до
`[...parseList(sec.factions), ...parseList(sec.factionsMortal), ...parseList(sec.factionsState)]`
без фильтрации по чипам вовсе (комментарий выше уже это отражает — filter
избыточен, можно убрать `.filter(...)` целиком при реализации).

### 3.2.2 Фронтенд

**Файл:** `locations.js`, `vtmEditHtml` (строки 405-427) — поле «Фракция»
(строки 410-413) меняется на `<input list="locdet-factions-list">`:
```js
<div class="locdet-field-row">
  <label class="locdet-field-lbl" id="locdet-vtm-faction-lbl">Фракция</label>
  <input class="form-control locdet-field-inp" id="locdet-vtm-faction" list="locdet-factions-list" value="${escAttr(loc.faction || '')}" placeholder="Фракция" autocomplete="off">
  <label class="locdet-checkbox-row"><input type="checkbox" id="locdet-vtm-private-domain"${loc.privateDomain ? ' checked' : ''}> Частный домен</label>
</div>
<datalist id="locdet-factions-list"></datalist>
```
Загрузка списка — при открытии детальной модалки локации (там, где уже
грузятся `_loadDistrictsList()`/аналоги для формы создания — **для
детальной модалки нужна отдельная точка входа**, т.к. `_loadFactionsList()`
(`locations.js:1095`) сейчас вызывается только из `openLocEditModal`, не из
открытия `#loc-detail-modal`):
```js
async function _loadCityFactionsList(city) {
  const dl = document.getElementById('locdet-factions-list');
  if (!dl) return;
  try {
    const list = await fetch(`/api/cities/${encodeURIComponent(city)}/factions-list`).then(r => r.ok ? r.json() : []);
    dl.innerHTML = list.map(f => `<option value="${escAttr(f)}">`).join('');
  } catch { /* молча — автодополнение необязательно для работы поля */ }
}
```
Вызывается при рендере VTM-панели детальной модалки (там, где строится
`vtmEditHtml`) — **не при каждом открытии модалки**, только при входе в
режим редактирования вкладки VTM (симметрично тому, как персонажная модалка
грузит даталисты кланов/сект при входе в edit, техспека
`2026-08-06-char-loc-city-fields-techspec.md` §A3.1 — тот же принцип).

**Форма создания/редактирования** (`index.html`, `#loc-edit-modal`,
`loc-edit-control` строка 1298) — **не трогаем** («Фракция» на VTM-вкладке
существует только в детальной модалке просмотра/редактирования уже
созданной локации, `vtmEditHtml`; отдельная форма создания её не показывает
вовсе — она не про VTM-контекст, только базовые метаданные+генерация,
см. состав полей `index.html:1252-1345` — «Фракция»/«Статус»/«Постоянные
фигуры»/«Угрозы»/«Маскарад» там нет ни одного). Значит и «Опасность» (§3.3
ниже), и чекбокс «Частный домен» (§3.4) — тоже только в детальной модалке,
не в форме создания. **Расхождение с документом-анализа**: анализ
предполагал правки и в форме создания (`#loc-edit-modal`) для этих полей
«тоже» — по факту формы создания там просто нет ни для одного VTM-поля,
переносить их туда — отдельная, более крупная задача (создание сразу с
VTM-контекстом), вне текущего запроса пользователя (речь шла о «VTM-вкладке»
единственное число — она одна, в детальной модалке).

## 3.3 «Опасность» — добавить в VTM-таблицу просмотра/редактирования

**Уточнение к анализу**: «Опасность» (`loc.dangerLevel`) — **НЕ** строка
VTM-таблицы (в отличие от «Статус»/«Фракция»/…), а обычный
`**Опасность:**`-бюллет (`location.js:40`, `metaField('Опасность')`),
хранящийся вне секции `## VtM` (там же, где «Зона»/«Контроль» — секция
метаданных). Добавление в VTM-вкладку — **чисто визуальное перемещение
поля в другую вкладку UI**, формат хранения не меняется (никакой новой
функции записи не требуется — используется уже существующий путь через
`fields.dangerLevel`, тот же, что и старая форма `loc-edit-danger`).

**Файл:** `locations.js`, `vtmEditHtml` — добавить select после «Маскарад»:
```js
<div class="locdet-field-row">
  <label class="locdet-field-lbl">Опасность</label>
  <select class="form-control locdet-field-inp" id="locdet-vtm-danger">
    ${[['', '—'], ['🟢', '🟢 Низкая'], ['🟡', '🟡 Средняя'], ['🔴', '🔴 Высокая']]
      .map(([v, label]) => `<option value="${v}"${(loc.dangerLevel || '').includes(v) && v ? ' selected' : ''}>${label}</option>`).join('')}
  </select>
</div>
```
`_locSavePanel('vtm')` (`locations.js:744-760`) — добавить поштучное поле
ВНЕ объекта `vtmTable` (это не табличная строка):
```js
} else if (panel === 'vtm') {
  fields.vtmText = document.getElementById('locdet-vtm-ta')?.value || '';
  fields.dangerLevel = document.getElementById('locdet-vtm-danger')?.value || ''; // новое — обычный бюллет, не vtmTable
  fields.vtmTable = { /* как было, без изменений */ };
}
```
**Метаданные-вкладка** (`metaFields`, `locations.js:350-356`) — «Опасность»
там сейчас и не было (только в отдельной форме создания), значит дублировать
негде — просто новая точка появления поля, конфликтов с существующими view
нет.

## 3.4 Чекбокс «Частный домен»

**Парсер** (`web/lib/parsers/location.js`, рядом с `zone`/`dangerLevel`,
строка 39-41):
```js
loc.privateDomain = /^да$/i.test(metaField('Частный домен') || '');
```
md-формат: `- **Частный домен:** да` — обычный бюллет-метаданные, вне
секции VtM (та же категория поля, что «Опасность» выше — НЕ строка
таблицы). Разметка чекбокса — уже показана в §3.2.2 (`locdet-vtm-private-domain`,
рядом с полем «Фракция»).

**JS-переключатель** (новый обработчик, `locations.js`):
```js
document.addEventListener('change', e => {
  if (!e.target.matches('#locdet-vtm-private-domain')) return;
  const input = document.getElementById('locdet-vtm-faction');
  const lbl   = document.getElementById('locdet-vtm-faction-lbl');
  if (!input || !lbl) return;
  input.value = ''; // очистка при переключении — решение Аналитика §7.4, подтверждено
  if (e.target.checked) {
    lbl.textContent = 'Хозяин';
    input.placeholder = 'Персонаж';
    input.setAttribute('list', 'locdet-owner-chars-list');
  } else {
    lbl.textContent = 'Фракция';
    input.placeholder = 'Фракция';
    input.setAttribute('list', 'locdet-factions-list');
  }
});
```
Второй `<datalist id="locdet-owner-chars-list">` — заполняется из
`STATE.characters.filter(c => c.lineage === 'vampire').map(c => c.name)`
при первом переключении чекбокса в состояние «включено» (лениво, не при
каждом открытии модалки — персонажи почти наверняка уже загружены в
`STATE.characters` к моменту открытия детальной модалки локации, значит
доп. сетевого запроса не требуется, только фильтрация уже загруженного
списка).

**Сохранение** (`_locSavePanel('vtm')`) — добавить:
```js
fields.privateDomain = document.getElementById('locdet-vtm-private-domain')?.checked ? 'да' : '';
```
(пустая строка стирает поле при снятии галки — тот же принцип, что везде в
проекте для булевых md-полей).

**Инициализация при открытии модалки** — при рендере `vtmEditHtml` лейбл/
placeholder/list уже должны соответствовать `loc.privateDomain` (не только
реагировать на `change`) — при построении разметки поля «Фракция» (§3.2.2)
учесть текущее состояние:
```js
const factionLbl = loc.privateDomain ? 'Хозяин' : 'Фракция';
const factionList = loc.privateDomain ? 'locdet-owner-chars-list' : 'locdet-factions-list';
```
и подставить в разметку вместо жёстко захардкоженных значений из §3.2.2
(там показан упрощённый вариант без учёта начального состояния — при
реализации нужно объединить оба фрагмента).

---

# Тема 4. Таблица «Отмеченные локации» в просмотре (§8 анализа)

## 4.1 Новая функция `_cityViewLocationsHtml(sec)`

**Файл:** `city.js`, рядом с `_cityViewPoliticalHtml` (после строки 983).

```js
function _cityViewLocationRow(r) {
  return `<div class="city-loc-view-row">
    <div class="city-loc-view-status">${escHtml(r.type || '—')}</div>
    <div class="city-loc-view-name">${escHtml(r.name || '—')}</div>
    <div class="city-loc-view-note">${escHtml(r.note || '—')}</div>
  </div>`;
}
function _cityViewLocationsHtml(sec) {
  const { narrative, recordLines } = _splitCitySectionRecords(sec.locations || '', _LOC_LABELS);
  const records = _parseLocationLines(recordLines);
  const tableHtml = records.length
    ? `<div class="city-loc-view-table">
         <div class="city-loc-view-row city-loc-view-head">
           <div class="city-loc-view-status">Статус локации</div>
           <div class="city-loc-view-name">Название локации</div>
           <div class="city-loc-view-note">Заметки</div>
         </div>
         ${records.map(_cityViewLocationRow).join('')}
       </div>`
    : '<div class="cdet-empty">Нет отмеченных локаций</div>';
  return `
    <div class="form-group">
      <label class="form-label">Отмеченные локации</label>
      ${tableHtml}
    </div>
    ${_cityViewFieldHtml('Общее описание ключевых локаций города', narrative)}`;
}
```

**Точка подключения** — `_cityViewGeographyHtml` (`city.js:1147-1149`):
```js
${_cityTabPanelHtml('geography',
  `${_cityViewLocationsHtml(sec)}${_cityViewFieldHtml('Охотничьи угодья', sec.hunting)}`,
  _cityGeoRemainingEditHtml(sec))}
```
(было: `${_cityViewFieldHtml('Ключевые локации', sec.locations)}${_cityViewFieldHtml('Охотничьи угодья', sec.hunting)}`).

## 4.2 Новый CSS-компонент

**Файл:** `styles.css`, рядом с `.locdet-table`/`.locdet-row` (после строки 6293):
```css
.city-loc-view-table {
  display: flex;
  flex-direction: column;
}
.city-loc-view-row {
  display: grid;
  grid-template-columns: 140px 1fr 1fr;
  gap: 12px;
  padding: 8px 0;
  border-bottom: 1px solid rgba(139, 0, 0, 0.301); /* тот же приём, что .locdet-row */
  align-items: start;
}
.city-loc-view-row:last-child { border-bottom: none; }
.city-loc-view-head {
  font-family: var(--f-heading);
  font-size: var(--fs-2xs);
  letter-spacing: .1em;
  text-transform: uppercase;
  color: var(--text3);
  border-bottom: 1px solid var(--border);
  padding-bottom: 6px;
}
.city-loc-view-status,
.city-loc-view-name,
.city-loc-view-note {
  font-size: var(--fs-body);
  color: var(--text2);
}
```
Три равнозначные текстовые колонки (не key/val пара, как `.locdet-row`) —
отдельный компонент, не модификатор существующего.

**Кликабельность названия локации (опция, не MVP)** — не реализуется в этой
техспеке (см. анализ §8.3.3, явно помечено опциональным). Если понадобится
позже — `.city-loc-view-name` оборачивается в `<a>`/`<button>` с
резолвингом по `_cityEditLocs`/`getAllLocations`, открывающим
`#loc-detail-modal` по найденному slug.

## 4.3 Edit-режим — порядок и подпись

**Файл:** `city.js`, `_cityLocEditorHtml()` (строки 304-330). Поменять
порядок вывода двух `form-group` (структурные строки — первыми, нарратив —
вторым) и переименовать лейбл нарратива:

```js
function _cityLocEditorHtml(sec, idPrefix = 'cdet-edit') {
  const { narrative, recordLines } = _splitCitySectionRecords(sec.locations || '', _LOC_LABELS);
  const records = _parseLocationLines(recordLines);
  const rows = records.length
    ? records.map(r => _locRowHtml(r.type, r.name, r.note, _cityEditLocs, idPrefix)).join('')
    : _locRowHtml('', '', '', _cityEditLocs, idPrefix);
  const districts = _parseDistrictNames(sec.districts);
  return `
    <div class="form-group">
      <label class="form-label">Отмеченные локации<span class="field-tip" ...>ⓘ</span></label>
      <div class="cdet-rels-hint">Статус локации — из списка или свой. Название — из созданных локаций или своё...</div>
      <div class="cdet-location-rows" data-loc-id-prefix="${escAttr(idPrefix)}">${rows}</div>
      <button class="cdet-rel-add-btn cdet-location-add-btn" type="button">+ Добавить запись</button>
      <datalist id="${idPrefix}-city-loc-names">${_cityEditLocs.map(n => `<option value="${escAttr(n)}">`).join('')}</datalist>
      <datalist id="${idPrefix}-city-district-names">${districts.map(n => `<option value="${escAttr(n)}">`).join('')}</datalist>
    </div>
    <div class="form-group">
      <label class="form-label">Общее описание ключевых локаций города<span class="field-tip" ...>ⓘ</span></label>
      <div class="cdet-rels-hint">Общее описание ключевых локаций города.</div>
      <textarea class="form-control" data-city-field="locations-narrative" rows="3"
        placeholder="По строке на пункт…">${escHtml(narrative)}</textarea>
    </div>`;
}
```
(текст тултипов — переносится из существующей версии без изменений, порядок
блоков и заголовок нарратива — единственное, что меняется; `data-city-field`
не меняется, round-trip сохранения не затронут).

**Риск:** низкий, полностью самостоятельная задача, не пересекается с
Темами 1-3.

---

# 5. Тест-план

**Тема 1 (бейджи):**
- Карточка локации без `dangerLevel`/`masqueradeLevel` — ни один бейдж не
  рендерится, карточка не ломается (пустая `.loc-badges`).
- Карточка с обоими уровнями «высокий» — два цветных бейджа с разными
  иконками (⚔️/🎭), оба красные, визуально различимы по иконке.
- `.loc-zone-icon` (безартовая карточка) — не изменился, всё ещё показывает
  первый символ `ZONE_CLASS_LABELS`.
- «Связанные локации» модуля — те же бейджи, что в сетке (одна функция).

**Тема 2 (удаление):**
- Клик по 🗑 на карточке → confirm с backlinks-предупреждением (если есть
  ссылки) → подтверждение → карточка исчезает из сетки, локация в
  `_deleted/`.
- Клик по 🗑 в детальной модалке → тот же поток, модалка закрывается после
  удаления.
- Старый путь (кнопка в форме `#loc-edit-modal`) продолжает работать без
  регрессии — `deleteLocCurrent()` как алиас на `deleteLoc()` без аргумента.
- Удаление локации, привязанной к модулю (`_parseModuleLocSlugs`) — после
  удаления открыть модуль → секция «ЛОКАЦИИ» не показывает заглушку с
  голым slug, привязка исчезла молча.
- Удаление локации без backlinks — confirm без предупреждающего текста.

**Тема 3 (VTM-вкладка):**
- На Географии отметить локацию статусом «Элизиум» → сохранить город →
  открыть карточку локации → вкладка VTM показывает «Статус: [Город]
  Элизиум» (не «Зона», не «Контроль» — оба поля не тронуты).
- Снять статус на Географии → сохранить → «Статус» у локации сброшен
  (строка убрана из VTM-таблицы, не осталась пустой строкой).
- «Фракция» на VTM — даталист показывает актуальный список фракций города
  (секты+кланы+другие+смертные+государственные), ручной ввод вне списка
  сохраняется как есть.
- «Опасность» на VTM-вкладке — select работает, значение синхронно с тем,
  что было бы видно в форме (если бы поле там осталось) — один источник
  данных (`dangerLevel`), просто два места редактирования (реально теперь
  только одно — VTM-вкладка, форма создания это поле не трогает вовсе, см.
  §3.3 уточнение).
- Чекбокс «Частный домен» включён → лейбл «Хозяин», даталист — персонажи-вампиры,
  старое значение поля очищено. Выключен обратно → «Фракция», даталист фракций,
  значение снова очищено.
- Сохранённая карточка с `privateDomain: да` и именем персонажа — при
  повторном открытии модалки чекбокс отмечен, поле показывает имя персонажа,
  не фракцию.

**Тема 4 (таблица «Отмеченные локации»):**
- Город без структурных записей (только нарратив) — таблица не рендерится,
  `cdet-empty` вместо неё, нарратив показан в своём блоке.
- Город с 3 отмеченными локациями и нарративом — таблица из 3 строк (3
  колонки каждая), нарратив отдельным блоком под таблицей с новым
  заголовком.
- Редактирование → сохранение → повторное открытие вкладки «География» —
  порядок и данные не расходятся между edit/view.

---

# 6. Порядок реализации

1. **Тема 1** (бейджи) — самостоятельно, минимальный риск.
2. **Тема 4** (таблица «Ключевые локации») — самостоятельно, не пересекается с остальным.
3. **Тема 2** (удаление) — 2.1 (параметризация) → 2.2+2.3 (точки входа) → 2.4 (cascade-unlink, отдельно тестируется).
4. **Тема 3 последней** — 3.1 (sync-редирект, новая функция записи — фундамент) → 3.3 (Опасность, не зависит от остального, можно раньше) → 3.2 (Фракция, нужен новый эндпоинт) → 3.4 (зависит от 3.2, использует то же поле).
