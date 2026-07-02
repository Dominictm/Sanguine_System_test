# VTM: Технический долг и нереализованные фичи — Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Устранить технический долг, заменить нативные диалоги на стилизованный UI и подготовить кодовую базу к модуляризации.

**Architecture:** God-файлы (server.js 7262 строк, scripts.js 10352 строк) постепенно разбиваются через выделение shared-хелперов, затем роутеров. Нативные alert/confirm заменяются через единые утилиты showToast/showConfirm. Rate-limiting добавляется как middleware.

**Tech Stack:** Node.js/Express, Vanilla JS SPA, Markdown-файлы, node:test

---

## Итоговый анализ перед планом

После изучения реального кода установлено следующее:

**location-modal-improvements.md — все 6 задач уже реализованы** (по состоянию на 2026-07-02):

| Задача | Файл | Строки | Статус |
|---|---|---|---|
| Task 1: H1 при rename | `web/server.js` | 3166-3175 | ✅ Реализовано |
| Task 2: keyPoints в шаблон | `web/server.js` | 3176-3182 | ✅ Реализовано |
| Task 3: sensoryPalette парсер | `web/lib/parsers.js` | 547-559 | ✅ Реализовано |
| Task 4: два textarea в edit-modal | `web/public/index.html`, `web/public/scripts.js` | 1065-1075, 9853-9950 | ✅ Реализовано |
| Task 5: вкладка Сенсорика | `web/public/scripts.js` | 8866-8949 | ✅ Реализовано |
| Task 6: редактирование keyPoints | `web/public/scripts.js` | 8864, 9087-9088 | ✅ Реализовано |

**P1.2 (несовместимость PUT handler и парсера) — устранена:** handler и парсер синхронизированы, данные не теряются.

**Lazy-load изображений:** атрибут `loading="lazy"` уже расставлен везде (`scripts.js:457, 8051, 8765, 8899`). Проблема решена.

**Soft-delete:** для персонажей уже реализован (`server.js:4701-4810`), для городов тоже. Для **локаций** — нет (`server.js:3353-3363` — `fs.rm` необратимо).

---

## Часть A: Нереализованные фичи (Location Modal)

**Статус: ПОЛНОСТЬЮ РЕАЛИЗОВАНО.** Дополнительных действий не требуется.

---

## Часть B: P1 Критичные фиксы

### B1: Soft-delete для локаций

**Проблема:** `DELETE /api/locations/:slug` (`server.js:3352-3363`) использует `fs.rm` — необратимо, в отличие от персонажей и городов.

**B1.1: Добавить корзину для локаций** — трудоёмкость: 2 часа

**Файлы:**
- Modify: `web/server.js:3352-3363`

- [ ] **Шаг 1: Изучи паттерн soft-delete персонажей**

```bash
# Посмотри как реализовано для персонажей
grep -n "_deleted\|trash\|restore" web/server.js | head -30
```

Паттерн: папка локации перемещается в `cities/<city>/locations/_deleted/<slug>_<timestamp>/`.

- [ ] **Шаг 2: Замени `fs.rm` на перемещение в корзину**

В `server.js:3352-3363` вместо:
```js
await fs.rm(path.dirname(mdPath), { recursive: true, force: true });
```
Используй:
```js
const deletedDir = path.join(chroniclesDir(city), '..', 'locations', '_deleted');
await fs.mkdir(deletedDir, { recursive: true });
const trashPath = path.join(deletedDir, `${slug}_${Date.now()}`);
await fs.rename(path.dirname(mdPath), trashPath);
```

- [ ] **Шаг 3: Убедись что `getAllLocations` пропускает `_deleted`**

В функции загрузки локаций проверь наличие фильтра:
```js
if (entry.name.startsWith('_')) continue;
```
Если нет — добавь по аналогии с персонажами.

- [ ] **Шаг 4: Тест**

```bash
curl -X DELETE "http://localhost:3000/api/locations/test-slug?city=paris"
# Папка должна появиться в cities/paris/locations/_deleted/
```

- [ ] **Шаг 5: Commit**
```bash
git add web/server.js
git commit -m "feat: soft-delete для локаций — перемещение в _deleted вместо физического удаления"
```

---

### B2: Замена 88 native alert()/confirm() диалогов

**Проблема:** 69 `alert()` + 19 `confirm()` в `scripts.js`. UX ужасен — alert блокирует поток, нельзя стилизовать, multiline выглядит отвратительно.

**B2.1: Создать утилиты `showToast()` и `showConfirm()`** — трудоёмкость: 4 часа

**Файлы:**
- Modify: `web/public/scripts.js` (~строка 1431, область helper-функций)
- Modify: `web/public/styles.css` (добавить в конец)
- Modify: `web/public/index.html` (добавить контейнер тостов)

- [ ] **Шаг 1: Добавь контейнер тостов в index.html**

В самом конце `<body>`, перед закрывающим тегом:
```html
<div id="toast-container" aria-live="polite" aria-atomic="false"></div>
```

- [ ] **Шаг 2: Добавь стили в styles.css**

```css
/* ── Toast Notifications ──────────────────────────────────── */
#toast-container {
  position: fixed; bottom: 20px; right: 20px;
  display: flex; flex-direction: column; gap: 8px;
  z-index: 9999; pointer-events: none;
}
.toast {
  min-width: 240px; max-width: 400px;
  padding: 10px 16px; border-radius: 6px;
  font-size: var(--fs-sm); line-height: 1.4;
  pointer-events: auto;
  animation: toast-in 0.2s ease;
  border-left: 3px solid transparent;
}
.toast.success { background: var(--bg3); border-color: var(--c-success); color: var(--c-success); }
.toast.error   { background: var(--bg3); border-color: var(--c-danger-text); color: var(--c-danger-text); }
.toast.warning { background: var(--bg3); border-color: #e8a020; color: #e8a020; }
.toast.info    { background: var(--bg3); border-color: var(--accent); color: var(--text); }
.toast.fade-out { animation: toast-out 0.3s ease forwards; }
@keyframes toast-in  { from { opacity: 0; transform: translateX(20px); } to { opacity: 1; transform: translateX(0); } }
@keyframes toast-out { from { opacity: 1; } to { opacity: 0; transform: translateX(20px); } }

/* ── Confirm Dialog ───────────────────────────────────────── */
#confirm-overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,.6);
  display: flex; align-items: center; justify-content: center;
  z-index: 10000;
}
.confirm-box {
  background: var(--bg2); border: 1px solid var(--border2);
  border-radius: 8px; padding: 20px 24px;
  max-width: 400px; width: 90%;
}
.confirm-msg  { font-size: var(--fs-base); margin-bottom: 16px; color: var(--text); line-height: 1.5; }
.confirm-acts { display: flex; gap: 10px; justify-content: flex-end; }
```

- [ ] **Шаг 3: Добавь функции в scripts.js (~строка 1431)**

```js
// ── Toast / Confirm utilities ──────────────────────────────
function showToast(message, type = 'info', duration = 4000) {
  const container = document.getElementById('toast-container');
  if (!container) { console.error(message); return; }
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => {
    el.classList.add('fade-out');
    el.addEventListener('animationend', () => el.remove(), { once: true });
  }, duration);
}

function showConfirm(message, { danger = false, confirmText = 'Подтвердить', cancelText = 'Отмена' } = {}) {
  return new Promise(resolve => {
    const ov = document.createElement('div');
    ov.id = 'confirm-overlay';
    ov.innerHTML = `
      <div class="confirm-box">
        <div class="confirm-msg">${escHtml(message)}</div>
        <div class="confirm-acts">
          <button class="chr-modal-btn cancel" id="_conf-cancel">${escHtml(cancelText)}</button>
          <button class="chr-modal-btn ${danger ? 'danger' : 'create'}" id="_conf-ok">${escHtml(confirmText)}</button>
        </div>
      </div>`;
    document.body.appendChild(ov);
    const cleanup = (result) => { ov.remove(); resolve(result); };
    ov.querySelector('#_conf-ok').onclick     = () => cleanup(true);
    ov.querySelector('#_conf-cancel').onclick = () => cleanup(false);
    ov.addEventListener('click', e => { if (e.target === ov) cleanup(false); });
  });
}
```

- [ ] **Шаг 4: Проверь в браузере**

В консоли браузера:
```js
showToast('Тест успеха', 'success');
showToast('Тест ошибки', 'error');
showConfirm('Удалить всё?', { danger: true }).then(r => console.log('result:', r));
```

- [ ] **Шаг 5: Commit**
```bash
git add web/public/scripts.js web/public/styles.css web/public/index.html
git commit -m "feat: утилиты showToast() и showConfirm() — база для замены native alert/confirm"
```

---

**B2.2: Заменить alert() — 69 вхождений** — трудоёмкость: 6 часов

**Файлы:**
- Modify: `web/public/scripts.js`

Приоритетные группы для замены (в порядке важности):

| Группа | Примерные строки | Тип замены |
|---|---|---|
| Ошибки AI-генерации | ~3862, 4050, 4130, 4140, 4186, 4212 | `showToast(msg, 'error')` |
| Успехи AI-генерации | ~2978, 4243 | `showToast(msg, 'success')` |
| Валидация форм | ~1569-1632, 1700, 1708 | `showToast(msg, 'warning')` |
| Rate limit предупреждения | ~7979, 8209, 8292, 8370 | `showToast(msg, 'warning')` |
| Ошибки соединения | ~8024, 8655 | `showToast(msg, 'error')` |
| Все остальные alert() | ~40 вхождений | `showToast(msg, 'error')` |

- [ ] **Шаг 1: Найди все alert() в scripts.js**
```bash
grep -n "alert(" web/public/scripts.js
```

- [ ] **Шаг 2: Заменяй группами, начиная с ошибок генерации**

Паттерн замены:
```js
// Было:
alert('Ошибка: ' + e.message);
// Стало:
showToast('Ошибка: ' + e.message, 'error');

// Было:
alert('✓ Персонаж создан');
// Стало:
showToast('✓ Персонаж создан', 'success');
```

- [ ] **Шаг 3: Commit после каждой группы**
```bash
git commit -m "refactor: alert() → showToast() — ошибки генерации и успехи"
```

---

**B2.3: Заменить confirm() — 19 вхождений** — трудоёмкость: 3 часа

**Файлы:**
- Modify: `web/public/scripts.js`

- [ ] **Шаг 1: Найди все confirm() в scripts.js**
```bash
grep -n "confirm(" web/public/scripts.js
```

- [ ] **Шаг 2: Замени паттерном async/await**

```js
// Было:
if (!confirm('Удалить дневник?')) return;

// Стало:
if (!await showConfirm('Удалить дневник?', { danger: true, confirmText: 'Удалить' })) return;
```

Убедись что родительская функция объявлена как `async` (большинство уже асинхронные).

- [ ] **Шаг 3: Двойные confirm() → один с checkbox или один showConfirm**

Пример (`scripts.js:4224-4225`):
```js
// Было:
if (!confirm('Закрыть модуль? Действие пишет канон.')) return;
if (!confirm('Точно? Это необратимо.')) return;

// Стало:
if (!await showConfirm(
  'Закрыть модуль по правилам Фазы C?\nБудут сгенерированы финал и каноничное событие в хронику. Действие необратимо.',
  { danger: true, confirmText: 'Закрыть модуль' }
)) return;
```

- [ ] **Шаг 4: Commit**
```bash
git add web/public/scripts.js
git commit -m "refactor: confirm() → showConfirm() — все 19 вхождений"
```

---

## Часть C: P2 Важные улучшения

### C1: Rate-limiting на AI-эндпоинтах

**Проблема:** AI-эндпоинты без throttle — DoS риск, бюджет AI-провайдеров может выбежать.

**C1.1: Добавить rate-limit middleware** — трудоёмкость: 3 часа

**Файлы:**
- Modify: `web/server.js` (~строка 100-107, область middleware)

- [ ] **Шаг 1: Добавь middleware после существующих middleware**

```js
// Rate-limiting для AI-генерации
const _aiCallLog = new Map();
function aiRateLimit(req, res, next) {
  const ip = req.ip;
  const now = Date.now();
  const window = 60_000; // 1 минута
  const limit = 20;
  const log = (_aiCallLog.get(ip) || []).filter(t => now - t < window);
  if (log.length >= limit) {
    return res.status(429).json({ ok: false, error: 'Слишком много запросов к AI. Подождите минуту.' });
  }
  log.push(now);
  _aiCallLog.set(ip, log);
  next();
}
// Очистка старых записей раз в 5 минут
setInterval(() => {
  const cutoff = Date.now() - 120_000;
  for (const [ip, log] of _aiCallLog) {
    const fresh = log.filter(t => t > cutoff);
    if (fresh.length === 0) _aiCallLog.delete(ip);
    else _aiCallLog.set(ip, fresh);
  }
}, 300_000);
```

- [ ] **Шаг 2: Найди все AI-эндпоинты и добавь middleware**

```bash
grep -n "makeGenerationClient\|/fill\|/generate\|/appearance\|/personality\|/biography\|/dialogue\|/recap\|canon-check" web/server.js | grep "app\."
```

Добавь `aiRateLimit` первым аргументом после пути:
```js
// Было:
app.post('/api/chronicles/:chr/modules/:mod/fill', express.json(), async (req, res) => {
// Стало:
app.post('/api/chronicles/:chr/modules/:mod/fill', aiRateLimit, express.json(), async (req, res) => {
```

- [ ] **Шаг 3: Обработай 429 на клиенте**

В scripts.js найди места где fetchJSON не проверяет 429:
```js
// Добавь в shared-обработчик или в каждый catch:
if (r.status === 429) { showToast('Слишком много запросов к AI. Подождите минуту.', 'warning'); return; }
```

- [ ] **Шаг 4: Тест**
```bash
# Запусти 25 запросов подряд — с 21-го должен вернуться 429
for i in {1..25}; do curl -s -o /dev/null -w "%{http_code}\n" -X POST "http://localhost:3000/api/locations/generate?city=paris" -H "Content-Type: application/json" -d '{"name":"тест"}'; done
```

- [ ] **Шаг 5: Commit**
```bash
git add web/server.js web/public/scripts.js
git commit -m "feat: rate-limit middleware для AI-эндпоинтов (20 req/min per IP)"
```

---

### C2: Тесты для новых эндпоинтов модулей

**Проблема:** Нет тестов для PUT /fields, PUT /scenario, POST /npc модулей (Tasks 1–3 из предыдущего плана).

**C2.1: Добавить тесты** — трудоёмкость: 3 часа

**Файлы:**
- Modify: `web/tests/all.test.js` (добавить блок после строки ~1193)

- [ ] **Шаг 1: Найди существующий тестовый модуль**
```bash
grep -n "chronicles\|modules" web/tests/all.test.js | tail -30
```

- [ ] **Шаг 2: Добавь тесты**

```js
describe('Module write endpoints', () => {
  const city = 'test-city';
  const chr = 'test-chronicle';
  const mod = 'test-module';

  test('PUT /fields — обновляет поле description', async () => {
    const r = await fetch(`http://localhost:3000/api/chronicles/${chr}/modules/${mod}/fields?city=${city}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: { description: 'Обновлено' } })
    });
    assert.strictEqual(r.status, 200);
    const d = await r.json();
    assert.ok(d.ok);
  });

  test('PUT /scenario — сохраняет текст сценария', async () => {
    const r = await fetch(`http://localhost:3000/api/chronicles/${chr}/modules/${mod}/scenario?city=${city}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scenario: 'Тестовый сценарий' })
    });
    assert.strictEqual(r.status, 200);
  });

  test('POST /npc без имени → 400', async () => {
    const r = await fetch(`http://localhost:3000/api/chronicles/${chr}/modules/${mod}/npc?city=${city}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    assert.strictEqual(r.status, 400);
  });
});
```

- [ ] **Шаг 3: Запусти тесты**
```bash
cd web && npm test
```

- [ ] **Шаг 4: Commit**
```bash
git add web/tests/all.test.js
git commit -m "test: тесты для PUT /fields, PUT /scenario, POST /npc модулей"
```

---

### C3: Унификация regex-парсеров

**Проблема:** `runLocFullGen` в scripts.js дублирует regex из parsers.js с незначительными отличиями.

**C3.1: Shared parsing endpoint** — трудоёмкость: 2 часа

**Статус: ✅ ГОТОВО (2026-07-03).** Реализовано в актуальной модульной структуре
(не `server.js`/`scripts.js` из исходного плана — оба давно разбиты на
`routes/*.js`/`public/*.js`):
- `web/routes/locations.js`: `POST /api/locations/parse-generated` — тонкая
  обёртка над `parseLocation` из `lib/parsers.js` (сигнатура на деле
  `parseLocation(rawContent, folderName)`, не `(slug, content)`, как было в
  черновике плана).
- `web/public/locations.js`: `runLocFullGen` больше не дублирует regex —
  зовёт новый эндпоинт и читает `parsed.atmosphere`, `parsed.hooks`,
  `parsed.sensoryPalette`, `parsed.vtmText`.
- Добавлены 2 теста в `tests/all.test.js` (успешный парсинг + 400 без `text`).
- Браузерная проверка: полный цикл `runLocFullGen` со stub'нутым
  `/api/locations/generate` (реальный AI не вызывался — только бесплатный
  regex-эндпоинт) на отдельном тестовом сервере (порт 3099, `AI_MOCK=1`) —
  живой dev-сервер пользователя (порт 3000, `supervised: false`) не трогали.
  `npm test` 221/221.

### C3.1 (черновик из плана, для истории)

- [x] Шаг 1: эндпоинт парсинга (в `routes/locations.js`, не `server.js`)
- [x] Шаг 2: `runLocFullGen` использует эндпоинт (в `public/locations.js`, не `scripts.js`)
- [x] Шаг 3: Commit

---

## Часть D: P3 Желательные улучшения

### D1: UI-тесты в CI — 1 час

**Статус: ✅ ГОТОВО (2026-07-03).** `tests/ui.test.js` (26 тестов, Selenium/Chrome)
не запускался headless до сих пор — при первом прогоне `HEADLESS=1 npm run
test:ui` упало 10/26: онбординг-тур не подавлялся (`#tour-backdrop` перехватывал
клики по сайдбару/вкладкам — реальный юзер кликает «Пропустить», headless некому),
тест `sv-chars` проверял элемент, переставший существовать после редизайна
дашборда на per-lineage карточки, и тест создания НПС не заполнял обязательные
поля Пол/Клан/Секта (клиент молча блокирует отправку `showToast`'ом). Все три
починены в `tests/ui.test.js` — теперь 26/26 headless, ~14с (было бы 56с+ на
таймаутах). `web/tests/run-tests.bat` теперь гоняет `test:all`, и при их
успехе — `HEADLESS=1 npm run test:ui`.

- [x] Добавить запуск `ui.test.js` в `web/tests/run-tests.bat`
- [x] Проверить что тесты работают headless — 26/26, 3 найденных и починенных бага

### D2: JSDoc-аннотации — 8 часов (инкрементально)

**Статус: ✅ ГОТОВО для `web/lib/parsers.js` (2026-07-03).** Все 27 экспортов
файла аннотированы `@param`/`@returns` (сигнатуры реальные, не из черновика
плана — например, `parseLocation` на деле `(rawContent, folderName)`, а не
`(slug, content)`). Задача была изначально размечена «инкрементально, при
каждом касании файла» — этот файл был единственным реально затронутым в ходе
исполнения плана (C3.1 трогал `parseLocation`), поэтому дальше по кодовой базе
(например `server.js`/`routes/*.js`) не расширялось — по духу исходной
формулировки D2, а не единым проходом по всему проекту. `node --check` + `npm
test` (221/221) после аннотирования.

### D3: Экспорт данных — 4 часа

**Статус: ✅ ГОТОВО (2026-07-03).** Реализовано в актуальной модульной
структуре: `GET /api/export/characters` (`routes/characters.js`) и
`GET /api/export/locations` (`routes/locations.js`) — та же выборка, что
обычные `GET /api/characters`/`GET /api/locations`, плюс заголовок
`Content-Disposition: attachment; filename="<тип>_<город>.json"` для скачивания
браузером (`?format=json` из черновика плана не понадобился — эндпоинт всегда
отдаёт JSON, формат не параметризован, т.к. другого формата не запрашивалось).
Кнопки «⇩ Экспорт» — на страницах Characters (рядом с «+ Создать») и Locations
(рядом с «+ Создать локацию»), обработчик — простой редирект на эндпоинт с
сохранением текущего `?city=`. 2 новых теста (совпадение данных с обычным
списком + заголовок скачивания) в `tests/all.test.js`, `npm test` 223/223.
Браузерная проверка headless Chrome на отдельном тестовом сервере (порт 3099) —
живой dev-сервер пользователя не трогали.

- [x] `GET /api/export/characters?city=X` — все персонажи
- [x] `GET /api/export/locations?city=X` — все локации
- [x] Кнопка «Экспорт» на страницах Characters и Locations

### D4: Оптимизация D3-графа — 4 часа

**Статус: ✅ ГОТОВО (2026-07-03).** Файлы — `public/graph.js` и
`routes/dashboard.js` (не `scripts.js`/`server.js` из черновика — оба давно
разбиты). `.alphaDecay(0.05)` на симуляции (дефолт D3 ≈0.0228, ~300 тиков до
`alphaMin` — теперь ~90); поверх — жёсткий предохранитель `sim.stop()` после
400 тиков в обработчике `tick` (не полагается только на естественное затухание,
т.к. `alphaTarget` при драге узла может держать симуляцию активной дольше
расчётного). `GET /api/graph?compact=true` — один узел на линейку с `count`,
рёбра агрегированы по паре линейек с `count` и `type: 'aggregate'` (добавлены
цвет/лейбл для этого типа в `REL_COLORS`/`REL_LABELS`, иначе стрелка рёбер
рендерилась бы без маркера). Тест на `?compact=true` в `tests/all.test.js`,
`npm test` 224/224. Браузерная проверка headless Chrome (порт 3099,
живой dev-сервер не трогали): симуляция стабилизируется и останавливается
(`sim.alpha() < alphaMin()`) в течение ~2с после открытия страницы, клик по
узлу и zoom работают, ошибок в консоли нет.

- [x] Увеличить `alphaDecay` для быстрой стабилизации на больших графах
- [x] Добавить `sim.stop()` после N тиков
- [x] Добавить `?compact=true` на `GET /api/graph` — агрегация по линейке

---

## Часть E: Модуляризация (God Files)

**Ситуация:**

| Файл | Строк | Проблема |
|---|---|---|
| `web/server.js` | 7262 | 101 эндпоинт в одном файле |
| `web/public/scripts.js` | 10352 | 297+ функций в одном файле |

### E1: Разбивка server.js на роутеры — трудоёмкость: 13 часов

**ВАЖНО:** Высокий риск регрессий. Делать строго последовательно. После каждого шага запускать `npm test`.

**E1.1: Выделить shared infrastructure в `web/lib/db.js`** — 3 часа

Файлы:
- Создать: `web/lib/db.js`
- Modify: `web/server.js`

Перенести в `db.js`:
- `reqCity`, `charsDir`, `locsDir`, `chroniclesDir`, `charsDir` хелперы (строки ~50-70)
- `getAllCharacters`, `getAllLocations`, `findLocMdPath` (строки ~228-380)
- `_cache`, `_locCache`, `CHARS_TTL`, `LOCS_TTL` (строки ~571-675)
- `writeFileAtomic` (строки ~40-50)

```js
// web/lib/db.js
module.exports = { reqCity, charsDir, locsDir, chroniclesDir, getAllCharacters, getAllLocations, writeFileAtomic, _cache, _locCache };
```

- [ ] Шаг 1: Создать `web/lib/db.js` с перенесёнными хелперами
- [ ] Шаг 2: В `server.js` заменить на `const { charsDir, ... } = require('./lib/db')`
- [ ] Шаг 3: `npm test` — все 175 тестов должны пройти
- [ ] Шаг 4: Commit

**E1.2: Роутеры по доменам** — 8 часов

Создать `web/routes/` с файлами:

| Файл | Эндпоинты | Строки server.js |
|---|---|---|
| `web/routes/cities.js` | POST/PUT/DELETE /api/cities | ~676-920 |
| `web/routes/chronicles.js` | все /api/chronicles | ~920-2515 |
| `web/routes/locations.js` | все /api/locations | ~2693-3497 |
| `web/routes/characters.js` | /api/characters CRUD | ~4350-4816 |
| `web/routes/generation.js` | AI-генерации | ~5297-5705 |
| `web/routes/library.js` | /api/library | ~3042-3073 |

Паттерн каждого файла:
```js
// web/routes/chronicles.js
const express = require('express');
const router = express.Router();
const { charsDir, getAllCharacters } = require('../lib/db');
// ... роуты ...
module.exports = router;
```

- [ ] Переносить по одному файлу, каждый раз прогоняя `npm test`
- [ ] Commit после каждого роутера

**E1.3: Обновить server.js** — 2 часа

server.js становится точкой входа (~300 строк):
```js
app.use('/api', require('./routes/cities'));
app.use('/api', require('./routes/chronicles'));
// ...
```

- [ ] Шаг 1: Добавить use() в server.js
- [ ] Шаг 2: Финальный `npm test`
- [ ] Шаг 3: Commit

---

### E2: Разбивка scripts.js на модули — трудоёмкость: 13 часов

**ОСТОРОЖНО:** Экстремально высокий риск. Все функции глобальные. Делать только после E1 и только с браузерным тестированием после каждого шага.

**Альтернатива (рекомендуется как первый шаг):**

**E2.0: Комментарии-маркеры в scripts.js** — 2 часа (низкий риск)

Добавить крупные разделители для навигации в существующем файле:
```js
// ═══════════════════════════════════════════════════════
// SECTION: Utils & Helpers (~1431-1540)
// ═══════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════
// SECTION: Graph (~561-944)
// ═══════════════════════════════════════════════════════
```

**E2.1: Выделить utils.js** — 4 часа (низкий риск, функции без side effects)

- Создать `web/public/utils.js` с: `escHtml`, `escAttr`, `mdInline`, `mdToHtml`, `slugifyJS`, `statusLabel`, `_charSlug`, `_nameMatch`, `formatDate` (~строки 1431-1540)
- Добавить `<script src="utils.js"></script>` в index.html ПЕРЕД scripts.js
- Удалить дубликаты из scripts.js
- Проверить в браузере

**E2.2: Выделить graph.js** — 4 часа

- Создать `web/public/graph.js` с: `loadGraph`, `renderGraph`, `buildLegend`, `highlightNode`, `showInfoPanel`
- D3-зависимости — убедиться что D3 загружается перед graph.js
- Добавить в index.html

**E2.3: Выделить locations.js** — 8 часов (высокий риск — много зависимостей)

**Статус: ✅ ГОТОВО (2026-07-03).** Полная построчная сверка показала, что
локационный код фактически лежит в 3 контигуальных блоках (строки ~8306–8766,
~8855–9014, ~9458–9994 на момент извлечения), а не в одном сплошном участке:
между ними вклиниваются два чужеродных острова — хелперы панели модуля
(`_modToggleEdit`/`_modSavePanel`/`_reloadModulePage`, строки ~8767–8853) и
секция Create Character Modal + Onboarding Tour (строки ~9016–9457). Оба острова
оставлены на месте в `scripts.js`.

Проверка отсутствия скрытых связей — скриптом по всем файлам найдены все имена
локационных функций (`openLocDetail`, `openLocEditModal`, `loadLocations`,
`_locSavePanel`, `runLocFullGen`, `ensureLocsLoaded`, `_renderModuleLocPanel` и
т.д.) и подтверждено, что ни одна не используется вне трёх выделенных блоков и
не ссылается на функции из двух чужеродных островов — блоки оказались чистым
замкнутым подграфом, зависящим только от истинных глобалей (`STATE`, `CITY`,
`escHtml`, `escAttr`, `showToast`, `showConfirm`, `fetch`, `document`).

Создан `web/public/locations.js` (~1160 строк), подключён в `index.html` между
`graph.js` и `scripts.js`. `scripts.js` уменьшен на ~1150 строк, на местах
вырезки оставлены комментарии-указатели. `node --check` на обоих файлах,
`npm test` (219/219), затем браузерная проверка через headless Chrome (CDP,
`?city=paris`): открытие карточки локации, редактирование поля «Атмосфера» с
сохранением через `PUT /fields`, создание новой локации через
`openLocEditModal(null)` + `saveLocEdit()`, удаление через `deleteLocCurrent()`
(с автокликом по `#_conf-ok`, т.к. `showConfirm` — промис на модалку) — все шаги
прошли, ошибок в консоли нет. Тестовые артефакты (`_deleted/`, тестовая правка
поля) удалены после проверки, `git status` на `cities/paris/` чист.

**Зависимости E2:** E2.0 → E2.1 → E2.2 → E2.3. B2.1 должен быть завершён до E2.

---

## Сводная таблица приоритетов

| ID | Задача | Файлы | Трудоём. | Приоритет | Статус |
|---|---|---|---|---|---|
| A | Location Modal (все) | — | 0 ч | — | ✅ ГОТОВО (было готово до плана) |
| B1.1 | Soft-delete локаций | `server.js`→`routes/locations.js` | 2 ч | P2 | ✅ ГОТОВО |
| B2.1 | showToast/showConfirm | `scripts.js→utils.js, styles.css, index.html` | 4 ч | **P1** | ✅ ГОТОВО |
| B2.2 | Замена alert() | `scripts.js` (69 штук) | 6 ч | **P1** | ✅ ГОТОВО |
| B2.3 | Замена confirm() | `scripts.js` (19 штук) | 3 ч | **P1** | ✅ ГОТОВО |
| C1.1 | Rate-limit middleware | `server.js` / `lib/http.js` | 3 ч | P2 | ✅ ГОТОВО (16 AI-эндпоинтов) |
| C2.1 | Тесты модульных эндпоинтов | `tests/all.test.js` | 3 ч | P2 | ✅ ГОТОВО (нашли и починили BOM-баг) |
| C3.1 | Shared parse endpoint | `routes/locations.js, public/locations.js` | 2 ч | P3 | ✅ ГОТОВО |
| D1 | UI-тесты в CI | `tests/run-tests.bat` | 1 ч | P3 | ✅ ГОТОВО — 26/26 headless, 3 найденных бага починены |
| D2 | JSDoc аннотации | `lib/parsers.js` | 8 ч | P3 | ✅ ГОТОВО (для файла, реально затронутого в этом плане) |
| D3 | Экспорт данных | `routes/characters.js, routes/locations.js` | 4 ч | P3 | ✅ ГОТОВО |
| D4 | Оптимизация D3-графа | `public/graph.js, routes/dashboard.js` | 4 ч | P3 | ✅ ГОТОВО |
| E1.1 | DB/HTTP helpers | `lib/db.js`, `lib/http.js` | 3 ч | P2 | ✅ ГОТОВО |
| E1.2 | Роутеры (`routes/*.js`) | 11 файлов (library, cities, archive, locations, threads, characters, chronicles, modules, generation, dashboard, tools) | 8 ч | P2 | ✅ ГОТОВО — вышло больше файлов, чем планировалось (полное покрытие, не только 6) |
| E1.3 | server.js как точка входа | `server.js` | 2 ч | P2 | ✅ ГОТОВО — **7262 → 1005 строк** (86%) |
| E2.0 | Маркеры-разделители в scripts.js | `scripts.js` | 2 ч | P2 | ➖ не требовалось — маркеры уже были в файле |
| E2.1 | Выделить utils.js | `public/utils.js` | 4 ч | P3 | ✅ ГОТОВО — проверено в headless Chrome (CDP) |
| E2.2 | Выделить graph.js | `public/graph.js` | 4 ч | P3 | ✅ ГОТОВО — проверено в headless Chrome, реальный клик по узлу графа |
| E2.3 | Выделить locations.js | `public/locations.js` | 8 ч | P3 | ✅ ГОТОВО — 3 контигуальных блока с 2 чужеродными островами, проверено в headless Chrome (открытие/правка/создание/удаление локации) |

**Рекомендуемый порядок выполнения:**

**Спринт 1 (~13 ч): Диалоги + Rate-limit**
→ B2.1 → B2.2 + B2.3 (параллельно) → C1.1

**Спринт 2 (~10 ч): Тесты + Soft-delete + Разделители**
→ C2.1 + B1.1 + E2.0 (независимые, параллельно)

**Спринт 3 (~13 ч): Модуляризация сервера**
→ E1.1 → E1.2 → E1.3 (строго последовательно)

**Спринт 4+ (~20 ч): Модуляризация фронтенда**
→ E2.1 → E2.2 → E2.3 (последовательно, с браузерным тестированием)
