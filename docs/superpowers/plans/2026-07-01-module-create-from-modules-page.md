# Module Create From Modules Page — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Добавить кнопку «+ Модуль» на страницу «Модули» и в таб «Модуль» раздела Инструменты, с дропдауном выбора существующей хроники — чтобы не надо было сначала открывать хронику.

**Architecture:** Переиспользуем существующий `mod-create-modal`. Добавляем в него поле `<select id="mod-create-chr">` с хрониками, которое показывается только когда модал открыт «автономно» (не из детальной карточки хроники). Источник хроник — уже существующий `GET /api/chronicles`. Кнопка «+ Модуль» добавляется в header страницы `#page-modules` и в таб `#tab-new-module`.

**Tech Stack:** Vanilla JS, Express (server.js), index.html, scripts.js, styles.css — всё уже используется в проекте.

---

## Файлы, которые меняются

| Файл | Что меняется |
|---|---|
| `web/public/index.html` | `#mod-create-modal`: + `<div>` с `<select id="mod-create-chr">`. `#page-modules`: + кнопка «+ Модуль». `#tab-new-module`: заменить заглушку на кнопку. |
| `web/public/scripts.js` | `openModCreateModal(source)` — новая функция-фасад. Обновить `btn-create-module-in-chr`, добавить listeners для новых кнопок. `mod-create-submit`: брать `chr` из `_chrDetailSlug` ИЛИ из `select`. |
| `web/public/styles.css` | Стиль для `mod-create-chr-row` (строка с дропдауном хроники). |

Сервер (`server.js`) **не меняется** — `GET /api/chronicles` и `POST /api/chronicles/:slug/modules` уже есть.

---

## Контекст кода — что важно знать

- **`_chrDetailSlug`** (scripts.js ~2325) — глобальная переменная, хранит slug текущей открытой хроники. Когда модал открывают из детальной карточки, она уже заполнена. При «автономном» открытии — `null`.
- **`btn-create-module-in-chr`** (index.html:269, scripts.js:2745) — существующая кнопка внутри `#chr-detail-modal`. Её логика открытия модала — образец для нового.
- **`mod-create-submit` listener** (scripts.js:2789–2821) — POST на `/api/chronicles/${_chrDetailSlug}/modules`. Нужно заменить `_chrDetailSlug` на функцию-геттер `_getModCreateChr()`.
- **`GET /api/chronicles?city=paris`** возвращает `[{ slug, display, modules, ... }]` — подходит для `<option>`.
- **CSS-токены**: новые `font-size` только через `var(--fs-*)`, высота touch-целей ≥ 44px.

---

### Task 1: Chronicle selector в `mod-create-modal`

**Files:**
- Modify: `web/public/index.html:293–347` (mod-create-modal)
- Modify: `web/public/styles.css` (добавить стиль для строки)

- [ ] **Шаг 1.1: Добавить строку с `<select>` в начало `mod-fill-body`**

В `web/public/index.html`, после `<div class="chr-modal-body mod-fill-body">` (строка ~296), добавить перед блоком «Название»:

```html
<!-- Показывается только при автономном открытии (не из хроники) -->
<div class="chr-form-group mod-create-chr-row" id="mod-create-chr-row" style="display:none">
  <label class="chr-form-label">Хроника <span style="color:#e87070">*</span></label>
  <select class="chr-form-input" id="mod-create-chr">
    <option value="">— выбери хронику —</option>
  </select>
</div>
```

- [ ] **Шаг 1.2: Добавить стиль в `styles.css`**

Найди блок стилей для `.chr-form-group` и добавь:

```css
.mod-create-chr-row select.chr-form-input {
  min-height: 44px;
}
```

- [ ] **Шаг 1.3: Проверить в браузере**

Открыть хронику → «+ Модуль» — строка с дропдауном должна быть скрыта (display:none).

- [ ] **Шаг 1.4: Коммит**

```bash
git add web/public/index.html web/public/styles.css
git commit -m "feat: добавлен select хроники в mod-create-modal (скрыт по умолчанию)"
```

---

### Task 2: JS — загрузка хроник и управление видимостью строки

**Files:**
- Modify: `web/public/scripts.js` — функция `openModCreateModal`, геттер `_getModCreateChr`

- [ ] **Шаг 2.1: Добавить глобальную переменную режима открытия**

В scripts.js, рядом с `let _modSlugEdited = false;` (~строка 2329), добавить:

```js
let _modCreateStandalone = false; // true — открыт не из хроники, нужен select
```

- [ ] **Шаг 2.2: Добавить функцию-геттер для slug хроники**

После переменной `_modCreateStandalone`:

```js
function _getModCreateChr() {
  return _modCreateStandalone
    ? document.getElementById('mod-create-chr').value.trim()
    : _chrDetailSlug;
}
```

- [ ] **Шаг 2.3: Добавить функцию загрузки хроник в select**

```js
async function _loadChrSelect() {
  const sel = document.getElementById('mod-create-chr');
  sel.innerHTML = '<option value="">— выбери хронику —</option>';
  try {
    const qs   = window.location.search;
    const list = await fetch(`/api/chronicles${qs}`).then(r => r.json());
    list.forEach(c => {
      const opt = document.createElement('option');
      opt.value       = c.slug;
      opt.textContent = c.display || c.slug;
      sel.appendChild(opt);
    });
  } catch { /* молча — список просто пустой */ }
}
```

- [ ] **Шаг 2.4: Заменить инлайн-код открытия модала на функцию `openModCreateModal(standalone)`**

Найди listener `document.getElementById('btn-create-module-in-chr').addEventListener('click', async () => {` (~строка 2745) и замени весь его внутренний код на вызов новой функции:

```js
document.getElementById('btn-create-module-in-chr').addEventListener('click', () => {
  openModCreateModal(false);
});

async function openModCreateModal(standalone) {
  _modCreateStandalone = standalone;
  _createPCs  = []; _createNPCs = [];
  ['mod-create-name','mod-create-time','mod-create-slug','mod-create-content'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  document.getElementById('mod-create-pcs').innerHTML  = '';
  document.getElementById('mod-create-npcs').innerHTML = '';
  document.getElementById('mod-create-error').style.display = 'none';
  _modSlugEdited = false;

  const chrRow = document.getElementById('mod-create-chr-row');
  if (standalone) {
    chrRow.style.display = '';
    await _loadChrSelect();
  } else {
    chrRow.style.display = 'none';
  }

  document.getElementById('mod-create-modal').classList.add('open');
  setTimeout(() => document.getElementById('mod-create-name').focus(), 50);
  _populateCharDatalist('mod-create-pc-list', 'mod-create-npc-list');
}
```

- [ ] **Шаг 2.5: Обновить `mod-create-submit` — заменить `_chrDetailSlug` на `_getModCreateChr()`**

В listener `mod-create-submit` (~строка 2789) найти:

```js
const d  = await fetch(`/api/chronicles/${encodeURIComponent(_chrDetailSlug)}/modules${qs}`,
```

Заменить на:

```js
const chr = _getModCreateChr();
if (!chr) { errEl.textContent = 'Выбери хронику'; errEl.style.display = ''; return; }
const d  = await fetch(`/api/chronicles/${encodeURIComponent(chr)}/modules${qs}`,
```

И в строку с `openChrDetail` после успеха (~строка 2815):

```js
document.getElementById('mod-create-modal').classList.remove('open');
if (_modCreateStandalone) {
  loadModules(); // обновить страницу модулей
} else {
  openChrDetail(_chrDetailSlug, _chrDetailDisplay, 'modules');
}
```

- [ ] **Шаг 2.6: Вручную проверить — открыть хронику, нажать «+ Модуль», создать модуль**

Убедиться что: дропдаун хроники скрыт, модуль создаётся в нужной хронике, после успеха открывается детальная карточка хроники.

- [ ] **Шаг 2.7: Коммит**

```bash
git add web/public/scripts.js
git commit -m "feat: openModCreateModal(standalone) — геттер хроники, загрузка select"
```

---

### Task 3: Кнопка «+ Модуль» на странице `#page-modules`

**Files:**
- Modify: `web/public/index.html:214–222` (секция page-modules)
- Modify: `web/public/scripts.js` (listener новой кнопки + обновление `loadModules`)

- [ ] **Шаг 3.1: Добавить кнопку в header `#page-modules`**

В index.html найди:

```html
<section id="page-modules" class="page">
  <div class="page-header">
    <h1 class="page-title">Модули</h1>
    <span class="page-sub" id="modules-sub">Хроника</span>
  </div>
```

Заменить на:

```html
<section id="page-modules" class="page">
  <div class="page-header">
    <h1 class="page-title">Модули</h1>
    <span class="page-sub" id="modules-sub">Хроника</span>
    <button class="loc-create-btn" id="btn-create-module-standalone" style="margin-left:auto">+ Модуль</button>
  </div>
```

*(Класс `loc-create-btn` уже есть в проекте — используется на странице локаций, стиль подходит.)*

- [ ] **Шаг 3.2: Добавить listener в scripts.js**

После `document.getElementById('btn-create-module-in-chr').addEventListener(...)`:

```js
document.getElementById('btn-create-module-standalone').addEventListener('click', () => {
  openModCreateModal(true);
});
```

- [ ] **Шаг 3.3: Проверить в браузере**

Перейти на страницу «Модули» → кнопка «+ Модуль» появилась → нажать → дропдаун хроники виден, список хроник загружается → создать тестовый модуль → он появился в списке.

- [ ] **Шаг 3.4: Коммит**

```bash
git add web/public/index.html web/public/scripts.js
git commit -m "feat: кнопка '+ Модуль' на странице Модулей с выбором хроники"
```

---

### Task 4: Таб «Модуль» в Инструментах — убрать заглушку

**Files:**
- Modify: `web/public/index.html:701–707` (tab-panel#tab-new-module)

- [ ] **Шаг 4.1: Заменить заглушку на кнопку открытия модала**

Найди в index.html:

```html
<!-- New Module -->
<div class="tab-panel" id="tab-new-module">
  <p class="validate-hint">
    Модули теперь создаются <strong>внутри хроники<\strong>: открой хронику в разделе «Хроники»
    и нажми «+ Модуль». Так модуль сразу привязывается к нужной хронике, ПК и НПС.
  </p>
  <button class="btn-submit" id="btn-goto-chronicles">Перейти к хроникам</button>
```

Заменить на:

```html
<!-- New Module -->
<div class="tab-panel" id="tab-new-module">
  <p class="validate-hint">
    Создай модуль и привяжи его к нужной хронике прямо здесь.
  </p>
  <button class="btn-submit" id="btn-create-module-tools">+ Создать модуль</button>
```

- [ ] **Шаг 4.2: Обновить listener в scripts.js — убрать старый `btn-goto-chronicles`, добавить новый**

Найди в scripts.js listener для `btn-goto-chronicles` и замени:

```js
// было:
document.getElementById('btn-goto-chronicles').addEventListener('click', () => navigate('chronicles-page'));

// стало:
document.getElementById('btn-create-module-tools').addEventListener('click', () => {
  openModCreateModal(true);
});
```

- [ ] **Шаг 4.3: Проверить в браузере**

Перейти в Инструменты → таб «Модуль» → нажать кнопку → модал открывается с дропдауном хроники.

- [ ] **Шаг 4.4: Коммит**

```bash
git add web/public/index.html web/public/scripts.js
git commit -m "feat: таб 'Модуль' в инструментах — кнопка открывает форму с выбором хроники"
```

---

## Итоговая проверка

После всех тасков проверить три сценария:

| Сценарий | Ожидание |
|---|---|
| Хроники → открыть хронику → «+ Модуль» | Дропдаун скрыт, модуль создаётся в этой хронике, детальная карточка обновляется |
| Страница «Модули» → «+ Модуль» | Дропдаун виден, список хроник загружен, после создания — `loadModules()` |
| Инструменты → таб «Модуль» → «+ Создать модуль» | Дропдаун виден, список хроник загружен, после создания — `loadModules()` |

---

## Self-Review

**Spec coverage:**
- ✅ Выбор хроники при создании из раздела Модули — Task 2 + Task 3
- ✅ Выбор хроники при создании из таба Инструменты — Task 2 + Task 4
- ✅ Старый flow (из детальной карточки хроники) не сломан — Task 2 сохраняет его
- ✅ Сервер не трогается — уже есть нужные эндпоинты

**Placeholder scan:** Нет TBD, все шаги с кодом.

**Type consistency:** `_getModCreateChr()` используется только в одном месте — `mod-create-submit`. `openModCreateModal(standalone: boolean)` — сигнатура одна везде.
