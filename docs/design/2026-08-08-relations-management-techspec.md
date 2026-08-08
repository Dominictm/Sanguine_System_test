# Техспека (Фаза 1): библиотека «Постоянные связи» + модалка управления + цвет на графе

**Роль:** Системный аналитик · **Дата:** 2026-08-08
**Источник:** [2026-08-08-relations-management-analysis.md](2026-08-08-relations-management-analysis.md) (Аналитик)

## §0. Границы этой техспеки

Реализует **полностью** пункты запроса 1, 2, 8, 9. Пункты 3-7 (разбор поля на два, «Взаимно»,
авто-пары Сир/Чайлд·Брат/Сестра·Домитор/Гуль) — **отдельная последующая техспека**, зависящая от
структурных решений, зафиксированных в анализе (§«Ключевые архитектурные развилки»). Эта техспека
**не меняет** формат хранения связей в карточках персонажей (`- **Отношения:**\n  - Имя —
текст`) — только добавляет новую независимую библиотеку и подключает её к чтению существующих
данных (граф, агрегация «Авторских связей»), не трогая запись.

**Уточнение относительно анализа**: анализ разносил левую и правую половины модалки на Фазу 1 и
Фазу 3 (считая правую часть зависимой от структурного поля типа). При ближайшем рассмотрении
зависимости нет — «Авторские связи» строятся сравнением `description` со списком имён библиотеки
(строковое сравнение), это работает и на СЕГОДНЯШНЕМ формате хранения. Обе половины модалки,
включая «Сделать постоянной», входят в эту техспеку целиком.

---

## §1. Библиотека «Постоянные связи» — хранение и бэкенд

### 1.1 Формат — плоский JSON-массив, без категорий

В отличие от достоинств/недостатков/бэкграундов (`_jsonLibRoutes`, категории вида
physical/social/…), у типов связи категорий нет — один плоский список. Переиспользование
`_jsonLibRoutes` потребовало бы искусственной фейковой категории; вместо этого — отдельный,
более простой набор роутов по тому же духу (custom-флаг, slugify, `writeFileAtomic`).

**Новый файл** `system/library/relation-types.json` (создать с сид-данными, см. §1.4):
```json
[
  { "slug": "sir",           "name": "Сир",          "color": "#DC143C", "custom": false },
  { "slug": "chaild",        "name": "Чайлд",        "color": "#B2374A", "custom": false },
  { "slug": "brat",          "name": "Брат",         "color": "#4472C4", "custom": false },
  { "slug": "sestra",        "name": "Сестра",       "color": "#C94AA0", "custom": false },
  { "slug": "gul",           "name": "Гуль",         "color": "#6B8E23", "custom": false },
  { "slug": "domitor",       "name": "Домитор",      "color": "#8B5A2B", "custom": false },
  { "slug": "familiar",      "name": "Фамильяр",     "color": "#5B9A5B", "custom": false },
  { "slug": "soyuznik",      "name": "Союзник",      "color": "#4A8FD9", "custom": false },
  { "slug": "vrag",          "name": "Враг",         "color": "#E06000", "custom": false },
  { "slug": "semya",         "name": "Семья",        "color": "#C94040", "custom": false },
  { "slug": "taynaya-svyaz", "name": "Тайная связь", "color": "#8A4FB0", "custom": false }
]
```
(`slug` — результат `slugify(name)`, указан для наглядности; при реализации сгенерировать через
саму функцию `slugify`, не переписывать вручную — на случай, если транслитерация даст другой
результат.) Цвета для уже существовавших в `REL_COLORS` понятий (Сир/Фамильяр/Союзник/Враг/
Семья/Тайная связь) взяты оттуда для визуальной преемственности; для новых (Чайлд/Брат/Сестра/
Гуль/Домитор) — подобраны вручную как первое приближение. **Финальную палитру стоит свести с
Дизайнером** перед реализацией — это не архитектурное решение, можно скорректировать значения
`color` в JSON без остального кода.

**`custom: false` у всех 11 сид-записей** — тот же принцип защиты, что уже применён ко ВСЕМ
остальным библиотечным категориям в проекте (дисциплины/кланы/секты/титулы/«Смертные»):
`update.bat` делает `git reset --hard origin/test` при каждом обновлении релизной версии — прямая
правка/удаление файла с сид-данными потерялась бы при следующем обновлении. Пользователь может
свободно **добавлять** свои новые связи (`custom: true`, полный CRUD) — базовый набор из 11
защищён от редактирования/удаления тем же кодом, что уже защищает остальные библиотеки (не новый
механизм).

### 1.2 Хелпер — `web/lib/relation-types.js` (новый файл)

```js
'use strict';
const fs   = require('fs').promises;
const path = require('path');
const { ROOT } = require('./db');

const FILE = path.join(ROOT, 'system', 'library', 'relation-types.json');

async function getRelationTypes() {
  try { return JSON.parse(await fs.readFile(FILE, 'utf-8')); }
  catch { return []; }
}

// Случайный цвет (п.9) — HSL с фиксированным диапазоном S/L, подобранным под уже
// используемую на графе палитру REL_COLORS (средняя насыщенность/светлота, читаемо
// на тёмном фоне интерфейса) — только оттенок (H) варьируется случайно.
function randomRelColor() {
  const h = Math.floor(Math.random() * 360);
  const s = 55 + Math.floor(Math.random() * 15); // 55–70%
  const l = 45 + Math.floor(Math.random() * 10); // 45–55%
  return hslToHex(h, s, l);
}
function hslToHex(h, s, l) {
  s /= 100; l /= 100;
  const k = n => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const toHex = x => Math.round(255 * x).toString(16).padStart(2, '0');
  return `#${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`;
}

module.exports = { FILE, getRelationTypes, randomRelColor };
```

Без кеша с инвалидацией (в отличие от `merits-loader.js`) — сознательно: файл маленький (десятки
записей), эндпоинт-потребитель (`/api/graph`) не является горячим путём, читается заново на
каждый запрос — та же цена, что и у `_readJsonArray` внутри самих CRUD-роутов ниже. Добавлять
слой кеша+инвалидации ради этого объёма данных — сверх того, что требует задача.

### 1.3 CRUD-роуты — добавить в `web/routes/library.js`

Импорт (рядом с остальными `require('../lib/...')`):
```js
const { FILE: RELATION_TYPES_FILE, getRelationTypes, randomRelColor } = require('../lib/relation-types');
```

Роуты (разместить рядом с JSON-track секцией, после `_jsonLibRoutes({...backgrounds...})`,
строка ~814):
```js
// ── Постоянные связи (2026-08-08, Фаза 1 «Связи и отношения») — плоский список, без
// категорий (в отличие от достоинств/недостатков), поэтому не через _jsonLibRoutes.
router.get('/api/library/relation-types', async (_req, res) => {
  try { res.json(await getRelationTypes()); }
  catch (e) { serverError(res, e); }
});

router.post('/api/library/relation-types', express.json(), async (req, res) => {
  try {
    const { name } = req.body || {};
    if (!name?.trim()) return res.status(400).json({ error: 'Название обязательно' });
    const slug = slugify(name);
    if (!slug) return res.status(400).json({ error: 'Не удалось построить slug из названия' });
    const list = await getRelationTypes();
    if (list.some(x => x.slug === slug))
      return res.status(409).json({ error: 'Связь с таким названием уже есть', slug });
    // Цвет — ВСЕГДА генерируется сервером (п.9, «случайным образом»), клиент его не передаёт.
    const entry = { slug, name: name.trim(), color: randomRelColor(), custom: true };
    list.push(entry);
    await writeFileAtomic(RELATION_TYPES_FILE, JSON.stringify(list, null, 2) + '\n', 'utf-8');
    res.json({ ok: true, slug, color: entry.color });
  } catch (e) { serverError(res, e); }
});

router.put('/api/library/relation-types/:slug', express.json(), async (req, res) => {
  try {
    const { slug } = req.params;
    const list = await getRelationTypes();
    const idx = list.findIndex(x => x.slug === slug);
    if (idx === -1) return res.status(404).json({ error: 'Связь не найдена' });
    if (!list[idx].custom) return res.status(403).json({ error: 'Редактирование доступно только для авторских связей' });
    const { name } = req.body || {};
    if (!name?.trim()) return res.status(400).json({ error: 'Название обязательно' });
    list[idx] = { ...list[idx], name: name.trim() }; // цвет правкой имени не меняется
    await writeFileAtomic(RELATION_TYPES_FILE, JSON.stringify(list, null, 2) + '\n', 'utf-8');
    res.json({ ok: true });
  } catch (e) { serverError(res, e); }
});

router.delete('/api/library/relation-types/:slug', async (req, res) => {
  try {
    const { slug } = req.params;
    const list = await getRelationTypes();
    const idx = list.findIndex(x => x.slug === slug);
    if (idx === -1) return res.status(404).json({ error: 'Связь не найдена' });
    if (!list[idx].custom) return res.status(403).json({ error: 'Удаление доступно только для авторских связей' });
    list.splice(idx, 1);
    await writeFileAtomic(RELATION_TYPES_FILE, JSON.stringify(list, null, 2) + '\n', 'utf-8');
    res.json({ ok: true });
  } catch (e) { serverError(res, e); }
});
```

### 1.4 Сид-файл — как создать

Записать `system/library/relation-types.json` буквально с содержимым §1.1 (custom:false у всех
11) как часть реализации — не генерировать через API (POST всегда ставит `custom: true`).

---

## §2. UI — кнопка и модалка

### 2.1 Кнопка «Добавить связи» — `web/public/index.html`, рядом с `#btn-reset` (строка 188)

```html
<button class="btn-icon" id="btn-manage-relations" title="Добавить связи" aria-label="Управление связями">⊞</button>
```
`⊞` (U+229E, SQUARED PLUS) — плюс в квадрате буквально, по формулировке запроса. Финальный выбор
глифа/иконки — на усмотрение Дизайнера при ревью, меняется одной строкой без последствий для
остального кода.

### 2.2 Модалка — новый блок в `index.html` (рядом с существующими модалками, например после
`#chr-create-modal`, см. `index.html:218-240` для образца разметки, которую переиспользуем)

```html
<div id="relations-manage-modal" class="chr-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="relmgr-title">
  <div class="chr-modal relmgr-modal">
    <div class="chr-modal-title" id="relmgr-title">🔗 Управление связями</div>
    <div class="chr-modal-body relmgr-columns">
      <div class="relmgr-col">
        <div class="relmgr-col-title">Постоянные связи</div>
        <div class="relmgr-hint">Отображаются в выпадающем меню «Вид отношений». Базовый набор
          защищён от изменений; свои связи можно редактировать и удалять.</div>
        <div id="relmgr-permanent-list" class="relmgr-list"></div>
        <div class="relmgr-add-row">
          <input type="text" id="relmgr-new-name" class="chr-form-input" placeholder="Новая связь…" autocomplete="off">
          <button type="button" id="relmgr-add-btn" class="chr-modal-btn create">+ Добавить</button>
        </div>
        <div id="relmgr-add-error" class="chr-form-error" style="display:none"></div>
      </div>
      <div class="relmgr-col">
        <div class="relmgr-col-title">Авторские связи</div>
        <div class="relmgr-hint">Формулировки, которые встречаются в карточках персонажей и не
          совпадают ни с одной постоянной связью.</div>
        <div id="relmgr-authored-list" class="relmgr-list"></div>
      </div>
    </div>
    <div class="chr-modal-actions">
      <button id="relmgr-close" class="chr-modal-btn cancel">Закрыть</button>
    </div>
  </div>
</div>
```

### 2.3 Подключение скрипта — `index.html`, после `<script src="scripts/graph.js"></script>` (строка 1392)

```html
<script src="scripts/relations-manage.js"></script>
```

---

## §3. Логика — новый файл `web/public/scripts/relations-manage.js`

```js
// ═══════════════════════════════════════════════════════════════
// Управление связями — «Постоянные» (библиотека) / «Авторские» (агрегация по картам
// персонажей) (2026-08-08, Фаза 1 «Связи и отношения»). Открывается с графа (#btn-reset
// сосед). Не меняет формат хранения связей персонажей — только читает description для
// агрегации «Авторских» и создаёт новые записи библиотеки при «Сделать постоянной».
// ═══════════════════════════════════════════════════════════════

let _relTypesCache = null; // сброс на invalidateRelTypesCache() после любой записи
async function ensureRelTypes(force) {
  if (_relTypesCache && !force) return _relTypesCache;
  _relTypesCache = await fetch('/api/library/relation-types').then(r => r.json()).catch(() => []);
  return _relTypesCache;
}
function invalidateRelTypesCache() { _relTypesCache = null; }

function _relItemHtml(t) {
  const actions = t.custom
    ? `<button type="button" class="relmgr-item-edit" data-relmgr-edit="${escAttr(t.slug)}" title="Переименовать">✏</button>
       <button type="button" class="relmgr-item-del" data-relmgr-del="${escAttr(t.slug)}" title="Удалить">🗑</button>`
    : '';
  return `
    <div class="relmgr-item" data-relmgr-slug="${escAttr(t.slug)}">
      <div class="rel-type-dot" style="background:${escAttr(t.color)}"></div>
      <span class="relmgr-item-name">${escHtml(t.name)}</span>
      <span class="relmgr-item-actions">${actions}</span>
    </div>`;
}

async function _renderPermanentList() {
  const types = await ensureRelTypes();
  const box = document.getElementById('relmgr-permanent-list');
  box.innerHTML = types.length ? types.map(_relItemHtml).join('') : '<div class="cdet-empty">Список пуст.</div>';
}

// «Авторские связи» — уникальные description из relationships ВСЕХ персонажей текущего
// города, не совпадающие (точное сравнение, без учёта регистра/пробелов по краям) ни с
// одним именем из «Постоянных» — сознательно точное совпадение, а не подстрока (см.
// техспеку §6 для ДРУГОГО, подстрочного сравнения на графе — разные цели, разная семантика).
async function _authoredDescriptions() {
  const types = await ensureRelTypes();
  const permanentNames = new Set(types.map(t => t.name.trim().toLowerCase()));
  const seen = new Set();
  const out = [];
  for (const c of (STATE.characters || [])) {
    for (const r of (c.relationships || [])) {
      const desc = (r.description || '').trim();
      if (!desc) continue;
      const key = desc.toLowerCase();
      if (permanentNames.has(key) || seen.has(key)) continue;
      seen.add(key);
      out.push(desc);
    }
  }
  return out.sort((a, b) => a.localeCompare(b, 'ru'));
}

async function _renderAuthoredList() {
  const box = document.getElementById('relmgr-authored-list');
  const list = await _authoredDescriptions();
  box.innerHTML = list.length ? list.map(desc => `
    <div class="relmgr-item">
      <span class="relmgr-item-name">${escHtml(desc)}</span>
      <button type="button" class="relmgr-item-promote" data-relmgr-promote="${escAttr(desc)}">Сделать постоянной</button>
    </div>`).join('') : '<div class="cdet-empty">Авторских связей не найдено.</div>';
}

async function _refreshRelMgr() {
  await Promise.all([_renderPermanentList(), _renderAuthoredList()]);
}

document.getElementById('btn-manage-relations')?.addEventListener('click', async () => {
  invalidateRelTypesCache();
  openModal('relations-manage-modal');
  await _refreshRelMgr();
});
document.getElementById('relmgr-close')?.addEventListener('click', () => closeModal('relations-manage-modal'));

document.getElementById('relmgr-add-btn')?.addEventListener('click', async () => {
  const input = document.getElementById('relmgr-new-name');
  const errBox = document.getElementById('relmgr-add-error');
  errBox.style.display = 'none';
  const name = input.value.trim();
  if (!name) return;
  const r = await fetch('/api/library/relation-types', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
  });
  const d = await r.json();
  if (!r.ok) { errBox.textContent = d.error || 'Не удалось добавить связь'; errBox.style.display = ''; return; }
  input.value = '';
  invalidateRelTypesCache();
  await _refreshRelMgr();
});

document.addEventListener('click', async e => {
  const delBtn = e.target.closest('[data-relmgr-del]');
  if (delBtn) {
    if (!confirm('Удалить эту связь из постоянных?')) return;
    await fetch(`/api/library/relation-types/${encodeURIComponent(delBtn.dataset.relmgrDel)}`, { method: 'DELETE' });
    invalidateRelTypesCache();
    await _refreshRelMgr();
    return;
  }
  const editBtn = e.target.closest('[data-relmgr-edit]');
  if (editBtn) {
    const slug = editBtn.dataset.relmgrEdit;
    const row = editBtn.closest('.relmgr-item');
    const current = row.querySelector('.relmgr-item-name').textContent;
    const next = prompt('Новое название связи:', current);
    if (!next || !next.trim() || next.trim() === current) return;
    const r = await fetch(`/api/library/relation-types/${encodeURIComponent(slug)}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: next.trim() }),
    });
    if (!r.ok) { const d = await r.json(); alert(d.error || 'Не удалось переименовать связь'); return; }
    invalidateRelTypesCache();
    await _refreshRelMgr();
    return;
  }
  const promoteBtn = e.target.closest('[data-relmgr-promote]');
  if (promoteBtn) {
    const name = promoteBtn.dataset.relmgrPromote;
    const r = await fetch('/api/library/relation-types', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
    });
    const d = await r.json();
    if (!r.ok) { alert(d.error || 'Не удалось сделать связь постоянной'); return; }
    invalidateRelTypesCache();
    await _refreshRelMgr();
    return;
  }
});
```

`prompt()`/`confirm()` — сознательно простой вариант (не отдельная inline-форма
редактирования), последовательно с объёмом Фазы 1: у записи ровно одно редактируемое поле
(имя), полноценная inline-форма ради одного текстового значения — оверинжиниринг для этого шага;
Дизайнер может заменить на инлайн-редактирование при ревью без структурных последствий.

`escAttr(t.color)` — `color` приходит с сервера (либо из сид-файла, либо из
`randomRelColor()`), не пользовательский ввод напрямую, но экранирование как атрибут — по той же
дисциплине, что и везде в проекте (защита от `custom: true`-записи с испорченным полем в
JSON-файле, отредактированным вручную мимо API).

---

## §4. CSS — добавить в `web/public/styles.css` (рядом с `.chr-modal-*`, после существующих
правил модалок)

```css
.relmgr-modal { width: min(760px, 92vw); }
.relmgr-columns { display: flex; gap: 24px; }
.relmgr-col { flex: 1; min-width: 0; }
.relmgr-col-title {
  font-family: 'Cinzel', serif; letter-spacing: .04em; color: var(--gold);
  font-size: var(--fs-lg); margin-bottom: 4px;
}
.relmgr-hint { color: var(--text3); font-size: var(--fs-sm); margin-bottom: 10px; }
.relmgr-list { display: flex; flex-direction: column; gap: 4px; max-height: 340px; overflow-y: auto; margin-bottom: 10px; }
.relmgr-item {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 8px; border-radius: var(--r-sm);
  background: var(--bg1);
}
.relmgr-item-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.relmgr-item-actions { display: flex; gap: 4px; flex-shrink: 0; }
.relmgr-item-edit, .relmgr-item-del, .relmgr-item-promote {
  background: none; border: none; cursor: pointer; color: var(--text3);
  padding: 4px 6px; border-radius: var(--r-sm); font-size: var(--fs-sm);
}
.relmgr-item-edit:hover, .relmgr-item-promote:hover { color: var(--text); background: rgba(255,255,255,.06); }
.relmgr-item-del:hover { color: var(--crimson); background: rgba(220,20,60,.1); }
.relmgr-add-row { display: flex; gap: 8px; }
.relmgr-add-row .chr-form-input { flex: 1; }
```

Токены (`--bg1`, `--gold`, `--crimson`, `--text3`, `--r-sm`, `--fs-*`) — уже существующие
CSS-переменные проекта (см. `:root`), новых не вводится, в соответствии с правилами `CLAUDE.md`
для веб-интерфейса. Touch-цели `.relmgr-item-edit/-del/-promote` — проверить на живом ревью, что
итоговая область клика ≥44px на `pointer: coarse` (правило проекта); при необходимости —
увеличить `padding`, не структуру.

---

## §5. Тест-план для §1-4 (без графа — граф см. §7)

- **`npm test`** — новых серверных тестов для CRUD достаточно по образцу уже существующих тестов
  на `_jsonLibRoutes`-подобные категории (создать/переименовать custom-запись, попытка
  редактировать/удалить canon-запись → 403, создание с занятым именем → 409).
- **Живая проверка** (`run-sanguine-web`): открыть граф → кнопка ⊞ → убедиться, что открылись обе
  колонки, 11 сид-записей видны слева без кнопок редактирования/удаления (canon); добавить новую
  связь → появляется слева с кнопками ✏/🗑 и случайным цветом; переименовать; удалить; убедиться,
  что «Авторские связи» показывают реальные `description` из карточек текущего тестового города,
  не совпадающие ни с одним именем слева.

---

## §6. Интеграция с графом (доводит п.9 до реального эффекта на графе)

Без этого раздела библиотека — просто список без влияния на визуализацию, а именно оно
запрошено в п.9 («для отображения… на графе»).

### 6.1 Сервер — `web/routes/dashboard.js`, `/api/graph` (строки 70-156)

Импорт (в начало файла, рядом с другими `require`):
```js
const { getRelationTypes } = require('../lib/relation-types');
```

Внутри обработчика, до цикла построения `links` (после строки 96, где определён `idSet`):
```js
const relTypes = await getRelationTypes();
// Сортировка по убыванию длины имени — более длинные/специфичные названия матчатся first,
// чтобы короткое имя не «перехватывало» совпадение раньше более точного (в реальных
// русских формулировках почти не пересекается, но детерминированный порядок — не лишний).
const sortedRelTypes = [...relTypes].sort((a, b) => b.name.length - a.name.length);
// Подстрочное совпадение (не точное, в отличие от «Авторских связей» в relations-manage.js —
// там цель «это ТА ЖЕ формулировка», здесь цель «упоминается ли это слово в свободном тексте»,
// тот же принцип, что уже использует categorizeRel(desc) для встроенных ключевых слов).
function matchRelType(desc) {
  const d = (desc || '').toLowerCase();
  return sortedRelTypes.find(t => d.includes(t.name.toLowerCase())) || null;
}
```

В цикле построения `links` (строки 106-125) — при создании нового `link` добавить резолв цвета:
```js
for (const c of chars) {
  for (const r of c.relationships) {
    const tgt = resolveTarget(r.target);
    if (!tgt || tgt === c.name) continue;
    const key = [c.name, tgt].sort().join('\x00');
    const label = r.description.split(';')[0].slice(0, 55);
    const matched = matchRelType(r.description);
    const existing = byKey.get(key);
    if (!existing) {
      const link = { source: c.name, target: tgt, type: r.type,
                     label, fromChar: c.name, description: r.description,
                     ...(matched ? { color: matched.color, typeLabel: matched.name } : {}) };
      byKey.set(key, link);
      links.push(link);
    } else if (!existing.fromChar2 && existing.fromChar !== c.name) {
      existing.fromChar2    = c.name;
      existing.type2        = r.type;
      existing.label2       = label;
      existing.description2 = r.description;
    }
  }
}
```
(Правка — только добавленные строки `matched`/`...(matched ? {...} : {})`; остальная логика
дедупликации пары не меняется. `color`/`typeLabel` — опциональные поля, есть только когда
описание совпало с постоянной связью; для несовпавших линк выглядит как раньше и клиент падает
на старый фоллбэк, см. §6.2.)

### 6.2 Клиент — `web/public/scripts/graph.js`

**Обводка ребра** (строка 276) — цвет с сервера первым в цепочке фоллбэков:
```js
.attr('stroke', d => d.color || REL_COLORS[d.type] || REL_COLORS.neutral)
```

**Маркеры стрелок** (строки 205-214) — сейчас перебирают только хардкодные ключи
`REL_COLORS`, из-за чего у связи с сервер-цветом, но НЕ входящей в старый фиксированный набор
типов (`d.type` всё ещё остаётся классификатор-slug вроде `neutral`, если новый тип не совпал ни
с одним ключевым словом классификатора), маркер найдётся (по `type`, который есть всегда) — это
уже работает даже без правки, так как `type` не меняется. Правка не нужна.

**Фильтр по типу связи** (`buildRelTypeFilter`, строки 140-150) — легенда/чекбоксы строятся по
`REL_LABELS[k]`/`REL_COLORS[k]`, что для типа-совпадения с постоянной связью, НЕ входящей в
старый хардкодный `REL_LABELS` (например «Гуль»/«Домитор»/новая авторская связь), даст пустую
подпись и цвет по умолчанию в самом ФИЛЬТРЕ (обводка ребра при этом уже верно покрашена по
§6.2 первым правилом) — известное, осознанно принимаемое ограничение Фазы 1: `type`
на ребре остаётся выходом старого классификатора по ключевым словам (`categorizeRel`), а не
слагом постоянной связи, поэтому фильтр/легенда для абсолютно новых типов (не входивших в
классификатор) не получат отдельной строки, пока классификатор не заменён структурным полем
(Фаза 2, п.3 запроса). Расширять `buildRelTypeFilter` фоллбэком на `typeLabel` в рамках этой
техспеки не входит — правка исказила бы фильтр (чекбокс появится, но переключение фильтра будет
работать по устаревшему `type`, не по факту наличия `color`) без реальной пользы без Фазы 2.
Фиксирую это явно, чтобы не потерять при передаче Разработчику: обводка ребра — работает и
корректна уже в этой техспеке, фильтр/легенда для абсолютно новых типов — нет, это ожидаемо.

**Инфопанель** (`showInfoPanel`, строка 426) — `rel-type-dot` берёт цвет из `REL_COLORS[type]`,
та же причина того же ограничения — не трогаем в этой техспеке по той же логике.

---

## §7. Краевые случаи

- **Совпадение сразу нескольких постоянных связей в одном описании** (например текст содержит и
  «союзник», и «враг» одновременно, что странно, но не запрещено пользователю) — побеждает более
  длинное по символам имя (см. сортировку §6.1); при равной длине — порядок в файле. Не
  тестируется отдельно, крайний случай, поведение детерминировано и достаточно.
- **Пустая библиотека** (все 11 записей случайно удалены — невозможно штатно, `custom: false`
  блокирует удаление, но теоретически возможно прямой правкой файла) — `matchRelType` вернёт
  `null` для всех описаний, граф продолжает работать по старому классификатору без ошибок.
- **«Сделать постоянной» дважды на одну и ту же формулировку** (два разных персонажа независимо
  ввели одинаковый текст) — второй клик получит `409` от POST (slug уже занят); UI должен
  показать `alert` с текстом ошибки сервера (уже предусмотрено в §3), не падать молча.
- **Слишком длинный «авторский» текст как имя новой постоянной связи** — POST не ограничивает
  длину `name` отдельно от общей практики проекта (другие категории библиотеки тоже не имеют
  явного лимита на `name`) — не вводится новое ограничение, консистентно с остальными
  категориями.

## §8. Порядок реализации

Один цельный кусок, без внутренних под-фаз — §1 (бэкенд+сид) → §2-4 (UI) → §6 (граф) можно
реализовывать последовательно в рамках одной задачи, но §6 зависит от §1 (нужен
`getRelationTypes`), а §2-4 зависят от §1 (нужны роуты). Порядок реализации: §1 → §2-4 → §6 → §5
(тест-план по всему сразу, после того как все три части готовы).
