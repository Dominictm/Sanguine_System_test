# Scenario Block Editing Enhancements — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Четыре доработки вкладки «Сценарий» на странице модуля: (1) кнопка «Сохранить всё» в режиме редактирования блока, (2) красная тень при наведении на блок, (3) минимальный редактируемый каркас сценария при создании модуля (без ИИ), (4) кнопка «Добавить сцену» + предупреждение «сценарий был изменён» на блоке «Финал» с предложением его перегенерировать.

**Architecture:** Блоки сценария (`## `-заголовок + вложенные `### `-поля) уже парсятся и группируются в `_renderScenarioPanel` (`web/public/scripts.js`) поверх `parseScenarioSections`/`replaceScenarioSection`/`serializeScenarioSections` (`web/lib/parsers.js`). Три новых серверных примитива добавляются в `lib/parsers.js` (чистые функции, без I/O) и оборачиваются тремя новыми/изменёнными эндпоинтами в `web/routes/modules.js`: батч-сохранение полей блока, вставка новой сцены, и точечное снятие флага «сценарий изменён» при перегенерации блока «Финал». Фронтенд (`scripts.js` + `styles.css`) добавляет кнопки/индикаторы поверх уже существующего рендера блоков — новых компонентов верстки не создаётся.

**Tech Stack:** Node.js/Express (`web/routes/modules.js`), чистые парсеры (`web/lib/parsers.js`), vanilla JS SPA (`web/public/scripts.js`), CSS-переменные дизайн-системы (`web/public/styles.css`), `node --test` для API/юнит-тестов, headless Chrome (`run-sanguine-web` skill) для фронтенд-проверки.

---

## Карта файлов

| Файл | Что меняется |
|---|---|
| `web/lib/parsers.js` | +`replaceScenarioSections` (батч-замена полей), +`insertScenarioScene` (вставка новой сцены перед «Финал»), +`hasManualSceneMarker`/`addManualSceneMarker`/`clearManualSceneMarker` (метка «сценарий изменён вручную») |
| `web/routes/modules.js` | +`PUT /scenario/block/fields` (батч-сохранение), +`POST /scenario/scene` (добавить сцену), правка `POST /scenario/block/regenerate` (снимает метку при перегенерации «Финал») |
| `web/public/scripts.js` | `_renderScenarioPanel`: кнопка «💾 Сохранить всё» на блоке, кнопка «➕ Добавить сцену» в тулбаре, каркас-скелетон в пустом состоянии, надпись-предупреждение на блоке «Финал»; новые обработчики кликов |
| `web/public/styles.css` | hover-тень на `.modp-scenario-block`, стили `.modp-block-saveall-btn`, `.modp-block-warn`, `.modp-scenario-empty-actions` |
| `web/tests/all.test.js` | юнит-тесты новых функций `lib/parsers.js` + API-тесты трёх серверных изменений |

**Важно про фронтенд-часть**: в этом проекте `web/public/scripts.js` не покрыт юнит-тестами (браузерный SPA-код без сборщика) — задачи 5–8 проверяются вручную через headless Chrome по рецепту скилла `run-sanguine-web` (см. Task 9), а не через `node --test`.

---

## Task 1: `lib/parsers.js` — батч-замена полей блока (`replaceScenarioSections`)

Нужна для кнопки «Сохранить всё»: сохранить N полей одного блока за один проход parse→mutate×N→serialize вместо N отдельных HTTP-запросов и файловых записей.

**Files:**
- Modify: `web/lib/parsers.js` (сразу после `findScenarioSectionIndex`, см. `grep` ниже)
- Test: `web/tests/all.test.js`

- [ ] **Step 1: Найди место вставки**

```bash
grep -n "^function findScenarioSectionIndex" web/lib/parsers.js
```
Ожидаемый вывод: `427:function findScenarioSectionIndex(sections, heading, parent) {` (номер строки может немного отличаться).

- [ ] **Step 2: Напиши падающий тест**

Добавь в `web/tests/all.test.js` внутрь `describe('parseScenarioSections / replaceScenarioSection', () => { ... })` (использует уже существующую фикстуру `SCEN`, объявленную в начале этого блока — см. `grep -n "const SCEN = \[" web/tests/all.test.js`), сразу после теста `'replaceScenarioSection — неизвестный заголовок возвращает текст без изменений'`:

```js
    it('replaceScenarioSections — применяет несколько замен за один проход, неизвестные заголовки — в skipped', () => {
      const { text, skipped } = replaceScenarioSections(SCEN, [
        { heading: 'Пролог', body: 'Новая завязка.' },
        { heading: 'Финал', body: 'Новая развязка.' },
        { heading: '__нет такого__', body: 'x' },
      ]);
      const { sections } = parseScenarioSections(text);
      assert.equal(sections.find(s => s.heading === 'Пролог').body, 'Новая завязка.');
      assert.equal(sections.find(s => s.heading === 'Финал').body, 'Новая развязка.');
      assert.equal(sections.find(s => s.heading === 'Сцена 1 — Бар').body, 'Первая сцена.\nВнутренний разделитель:\n\n---\n\nПродолжение той же сцены.');
      assert.deepEqual(skipped, ['__нет такого__']);
    });
```

Добавь `replaceScenarioSections` в импорт из `../lib/parsers` в начале `web/tests/all.test.js` (строка с `parseScenarioSections, replaceScenarioSection, checkScenarioStructure,`):

```js
  parseScenarioSections, replaceScenarioSection, replaceScenarioSections, checkScenarioStructure,
```

- [ ] **Step 3: Запусти тест, убедись что падает**

```bash
cd web && AI_MOCK=1 node --test tests/all.test.js 2>&1 | grep -A5 "применяет несколько замен"
```
Ожидаемый результат: `TypeError: replaceScenarioSections is not a function` (функции ещё нет).

- [ ] **Step 4: Добавь функцию в `web/lib/parsers.js`**

Вставь сразу после `findScenarioSectionIndex` (после его закрывающей `}`):

```js
/**
 * Батч-версия replaceScenarioSection — применяет несколько замен за один
 * parse/serialize проход (одна файловая запись вместо N) для кнопки
 * «Сохранить всё» на блоке сценария.
 * @param {string} raw
 * @param {{heading:string, parent?:string, body:string}[]} replacements
 * @returns {{ text: string, skipped: string[] }} skipped — заголовки, для которых раздел не найден
 */
function replaceScenarioSections(raw, replacements) {
  const { preamble, sections } = parseScenarioSections(raw);
  const skipped = [];
  for (const r of replacements) {
    const idx = findScenarioSectionIndex(sections, r.heading, r.parent);
    if (idx === -1) { skipped.push(r.heading); continue; }
    sections[idx] = { ...sections[idx], body: String(r.body == null ? '' : r.body).trim() };
  }
  return { text: serializeScenarioSections(preamble, sections), skipped };
}
```

- [ ] **Step 5: Экспортируй функцию**

В `module.exports` блоке (в конце файла, рядом с `findScenarioSectionIndex,`) добавь:

```js
  replaceScenarioSections,
```

- [ ] **Step 6: Запусти тест, убедись что проходит**

```bash
cd web && AI_MOCK=1 node --test tests/all.test.js 2>&1 | grep -A2 "применяет несколько замен"
```
Ожидаемый результат: `✔ replaceScenarioSections — применяет несколько замен за один проход...`

- [ ] **Step 7: Commit**

```bash
git add web/lib/parsers.js web/tests/all.test.js
git commit -m "feat: add replaceScenarioSections batch helper for block save-all"
```

---

## Task 2: `lib/parsers.js` — вставка новой сцены (`insertScenarioScene`) + метка «сценарий изменён»

Нужна для кнопки «Добавить сцену»: вставляет пустую `## Сцена N — ...` перед блоком «Финал» (или в конец, если «Финал» нет), с автоинкрементом номера, и помечает файл флагом `<!-- meta:sceneAdded: 1 -->` в preamble — этот флаг вызывает надпись-предупреждение на блоке «Финал» (Task 4/8).

**Files:**
- Modify: `web/lib/parsers.js` (сразу после `replaceScenarioSections` из Task 1)
- Test: `web/tests/all.test.js`

- [ ] **Step 1: Напиши падающие тесты**

Добавь в `web/tests/all.test.js`, в том же блоке `describe('parseScenarioSections / replaceScenarioSection', ...)`, после теста из Task 1:

```js
    it('hasManualSceneMarker/addManualSceneMarker/clearManualSceneMarker — round-trip', () => {
      assert.equal(hasManualSceneMarker(SCEN), false);
      const marked = addManualSceneMarker(SCEN);
      assert.equal(hasManualSceneMarker(marked), true);
      assert.equal(addManualSceneMarker(marked), marked); // идемпотентно, не дублирует метку
      const cleared = clearManualSceneMarker(marked);
      assert.equal(hasManualSceneMarker(cleared), false);
      // сама структура разделов не пострадала
      assert.deepEqual(parseScenarioSections(cleared).sections.map(s => s.heading), ['Пролог', 'Сцена 1 — Бар', 'Финал']);
    });

    it('insertScenarioScene — вставляет новую сцену перед «Финал» с инкрементом номера, ставит метку', () => {
      const { text, heading } = insertScenarioScene(SCEN);
      assert.equal(heading, 'Сцена 2');
      const { sections } = parseScenarioSections(text);
      assert.deepEqual(sections.map(s => s.heading),
        ['Пролог', 'Сцена 1 — Бар', 'Сцена 2', 'Описание для игрока', 'Колорит', 'Финал']);
      const newScene = sections.find(s => s.heading === 'Сцена 2');
      assert.equal(newScene.level, 2);
      const descField = sections.find(s => s.heading === 'Описание для игрока');
      assert.equal(descField.parent, 'Сцена 2');
      assert.equal(hasManualSceneMarker(text), true);
    });

    it('insertScenarioScene — без блока «Финал» добавляет сцену в конец', () => {
      const noFinale = [
        '# Сценарий — Тест', '', '---', '',
        '## Пролог', '', 'Завязка.', '',
      ].join('\n');
      const { text, heading } = insertScenarioScene(noFinale);
      assert.equal(heading, 'Сцена 1');
      const { sections } = parseScenarioSections(text);
      assert.deepEqual(sections.map(s => s.heading),
        ['Пролог', 'Сцена 1', 'Описание для игрока', 'Колорит']);
    });
```

Добавь новые импорты в `web/tests/all.test.js` (та же строка, что в Task 1 Step 2 — расширь ещё раз):

```js
  parseScenarioSections, replaceScenarioSection, replaceScenarioSections,
  insertScenarioScene, hasManualSceneMarker, addManualSceneMarker, clearManualSceneMarker,
  checkScenarioStructure,
```

- [ ] **Step 2: Запусти тесты, убедись что падают**

```bash
cd web && AI_MOCK=1 node --test tests/all.test.js 2>&1 | grep -B1 -A5 "insertScenarioScene\|ManualSceneMarker"
```
Ожидаемый результат: `TypeError: insertScenarioScene is not a function` (и аналогично для marker-функций).

- [ ] **Step 3: Добавь функции в `web/lib/parsers.js`**

Вставь сразу после `replaceScenarioSections` (добавленной в Task 1):

```js
// Метка «сценарий был изменён вручную (добавлена своя сцена)» — живёт в
// preamble scenario.md (до первого `## `, значит никогда не рендерится в
// самой вкладке «Сценарий» — см. _renderScenarioPanel). Снимается точечно
// при перегенерации блока «Финал» (routes/modules.js scenario/block/regenerate).
const SCENE_ADDED_MARKER_RE = /\n?<!--\s*meta:sceneAdded:\s*1\s*-->\n?/i;

function hasManualSceneMarker(raw) {
  return SCENE_ADDED_MARKER_RE.test(raw);
}

function addManualSceneMarker(raw) {
  if (hasManualSceneMarker(raw)) return raw;
  const firstHeadingIdx = raw.search(/^##\s+/m);
  if (firstHeadingIdx === -1) return raw.replace(/\n*$/, '\n') + '<!-- meta:sceneAdded: 1 -->\n';
  return raw.slice(0, firstHeadingIdx) + '<!-- meta:sceneAdded: 1 -->\n' + raw.slice(firstHeadingIdx);
}

function clearManualSceneMarker(raw) {
  return raw.replace(SCENE_ADDED_MARKER_RE, '\n');
}

/**
 * Добавляет пустую сцену «## Сцена N[ — title]» перед блоком «Финал» (или в
 * конец документа, если «Финал» нет), с двумя заготовленными полями внутри.
 * Номер сцены — на 1 больше максимального среди уже существующих «Сцена N».
 * Ставит метку hasManualSceneMarker (см. выше) — используется UI, чтобы
 * предложить перегенерировать «Финал» под новую сцену.
 * @param {string} raw
 * @param {string} [title] — необязательный подзаголовок сцены («Сцена N — <title>»)
 * @returns {{ text: string, heading: string }} heading — точный заголовок вставленной сцены
 */
function insertScenarioScene(raw, title) {
  const { preamble, sections } = parseScenarioSections(raw);
  const nums = sections
    .filter(s => s.level === 2)
    .map(s => parseInt((s.heading.match(/^Сцена\s*(\d+)/i) || [])[1], 10))
    .filter(n => !Number.isNaN(n));
  const nextNum = nums.length ? Math.max(...nums) + 1 : 1;
  const heading = `Сцена ${nextNum}${title ? ` — ${title}` : ''}`;

  const newScene  = { heading, body: '', level: 2, parent: null };
  const newFields = [
    { heading: 'Описание для игрока', body: '⚠️ Заполни описание сцены для игрока.', level: 3, parent: heading },
    { heading: 'Колорит', body: '⚠️ 2-3 детали места/времени, которые нельзя перепутать с другим городом.', level: 3, parent: heading },
  ];

  const finaleIdx = sections.findIndex(s => s.level === 2 && /^Финал/i.test(s.heading));
  const insertAt  = finaleIdx === -1 ? sections.length : finaleIdx;
  const newSections = [
    ...sections.slice(0, insertAt),
    newScene, ...newFields,
    ...sections.slice(insertAt),
  ];
  const text = addManualSceneMarker(serializeScenarioSections(preamble, newSections));
  return { text, heading };
}
```

- [ ] **Step 4: Экспортируй новые функции**

В `module.exports`, рядом с `replaceScenarioSections,` (добавленной в Task 1):

```js
  insertScenarioScene,
  hasManualSceneMarker,
  addManualSceneMarker,
  clearManualSceneMarker,
```

- [ ] **Step 5: Запусти тесты, убедись что проходят**

```bash
cd web && AI_MOCK=1 node --test tests/all.test.js 2>&1 | grep -A2 "insertScenarioScene\|ManualSceneMarker"
```
Ожидаемый результат: все три теста `✔`.

- [ ] **Step 6: Commit**

```bash
git add web/lib/parsers.js web/tests/all.test.js
git commit -m "feat: add insertScenarioScene + manual-scene marker helpers"
```

---

## Task 3: Сервер — `PUT /scenario/block/fields` (батч-сохранение блока)

**Files:**
- Modify: `web/routes/modules.js`
- Test: `web/tests/all.test.js`

- [ ] **Step 1: Найди место вставки и обнови импорт**

```bash
grep -n "router.put('/api/chronicles/:chr/modules/:mod/scenario/section'," web/routes/modules.js
```
Ожидаемый вывод: строка с `router.put(...)`, за которой сразу следует `});` через ~23 строки, а затем комментарий `// ── Scenario, per-section: AI regeneration`.

Обнови импорт из `../lib/parsers` вверху `web/routes/modules.js` (строка `const { slugify, parseEvent, parseScenarioSections, ... } = require('../lib/parsers');`), добавив:

```js
const { slugify, parseEvent, parseScenarioSections, replaceScenarioSection, replaceScenarioSections, splitH3Body, serializeScenarioSections, findScenarioSectionIndex, insertScenarioScene, hasManualSceneMarker, clearManualSceneMarker, checkScenarioStructure } = require('../lib/parsers');
```

- [ ] **Step 2: Напиши падающий тест**

Добавь в `web/tests/all.test.js`, внутрь `describe('Module write endpoints', ...)`, сразу после теста `'PUT /scenario/section — с parent правит нужное одноимённое поле, не первое попавшееся'` (искать через `grep -n "с parent правит нужное" web/tests/all.test.js`):

```js
    it('PUT /scenario/block/fields — сохраняет несколько полей одним запросом', async () => {
      if (!modDir) return;
      const seed = [
        '# Сценарий — Тест', '', '---', '',
        '## Сцена 1', '',
        '### Описание для игрока', '', 'Старое описание.', '',
        '### Колорит', '', 'Старый колорит.', '',
      ].join('\n');
      await apiJson(`/api/chronicles/${encodeURIComponent(chr)}/modules/${encodeURIComponent(mod)}/scenario${CITY}`,
        { method: 'PUT', body: JSON.stringify({ content: seed }) });

      const put = await apiJson(`/api/chronicles/${encodeURIComponent(chr)}/modules/${encodeURIComponent(mod)}/scenario/block/fields${CITY}`,
        { method: 'PUT', body: JSON.stringify({ fields: [
          { heading: 'Описание для игрока', parent: 'Сцена 1', content: 'Новое описание.' },
          { heading: 'Колорит', parent: 'Сцена 1', content: 'Новый колорит.' },
        ] }) });
      assert.equal(put.status, 200);
      assert.ok(put.body.ok);
      assert.deepEqual(put.body.skipped, []);
      assert.match(put.body.scenario, /### Описание для игрока\n\nНовое описание\./);
      assert.match(put.body.scenario, /### Колорит\n\nНовый колорит\./);

      const raw = await fs.readFile(path.join(modDir, 'scenario.md'), 'utf-8');
      assert.match(raw, /Новое описание\./);
      assert.match(raw, /Новый колорит\./);
    });

    it('PUT /scenario/block/fields — неизвестное поле идёт в skipped, остальные сохраняются', async () => {
      if (!modDir) return;
      const seed = [
        '# Сценарий — Тест', '', '---', '',
        '## Сцена 1', '',
        '### Описание для игрока', '', 'Старое описание.', '',
      ].join('\n');
      await apiJson(`/api/chronicles/${encodeURIComponent(chr)}/modules/${encodeURIComponent(mod)}/scenario${CITY}`,
        { method: 'PUT', body: JSON.stringify({ content: seed }) });

      const put = await apiJson(`/api/chronicles/${encodeURIComponent(chr)}/modules/${encodeURIComponent(mod)}/scenario/block/fields${CITY}`,
        { method: 'PUT', body: JSON.stringify({ fields: [
          { heading: 'Описание для игрока', parent: 'Сцена 1', content: 'Новое описание.' },
          { heading: '__нет такого__', parent: 'Сцена 1', content: 'x' },
        ] }) });
      assert.equal(put.status, 200);
      assert.deepEqual(put.body.skipped, ['__нет такого__']);
      assert.match(put.body.scenario, /Новое описание\./);
    });

    it('PUT /scenario/block/fields — пустой массив fields → 400', async () => {
      if (!modDir) return;
      const { status } = await apiJson(`/api/chronicles/${encodeURIComponent(chr)}/modules/${encodeURIComponent(mod)}/scenario/block/fields${CITY}`,
        { method: 'PUT', body: JSON.stringify({ fields: [] }) });
      assert.equal(status, 400);
    });
```

- [ ] **Step 3: Запусти тесты, убедись что падают**

```bash
cd web && AI_MOCK=1 node --test tests/all.test.js 2>&1 | grep -B1 -A5 "scenario/block/fields"
```
Ожидаемый результат: `404` вместо `200` (роута ещё нет — Express вернёт стандартный 404 для незнакомого пути).

- [ ] **Step 4: Добавь эндпоинт в `web/routes/modules.js`**

Вставь сразу после закрывающей `});` эндпоинта `PUT /api/chronicles/:chr/modules/:mod/scenario/section` (перед комментарием `// ── Scenario, per-section: AI regeneration`):

```js
  // ── Scenario, block: batch-save all fields at once («Сохранить всё» в режиме
  // редактирования блока) — один parse/serialize проход вместо N отдельных
  // PUT /scenario/section запросов. ──────────────────────────────────────────
  router.put('/api/chronicles/:chr/modules/:mod/scenario/block/fields', express.json(), async (req, res) => {
    try {
      const city = reqCity(req);
      const { chr, mod } = req.params;
      if (chr.includes('..') || mod.includes('..'))
        return res.status(400).json({ ok: false, error: 'Недопустимое имя' });
      const fields = Array.isArray(req.body?.fields) ? req.body.fields : [];
      if (!fields.length) return res.status(400).json({ ok: false, error: 'Не переданы поля' });

      const scenarioPath = path.join(chroniclesDir(city), chr, 'modules', mod, 'scenario.md');
      const raw = await fs.readFile(scenarioPath, 'utf-8').catch(() => null);
      if (raw == null) return res.status(404).json({ ok: false, error: 'Сценарий не найден' });

      const { text, skipped } = replaceScenarioSections(raw, fields);
      await writeFileAtomic(scenarioPath, text, 'utf-8');
      invalidateChars(city);
      console.log(`[scenario-block-fields] ${city}/${chr}/${mod} → сохранено ${fields.length - skipped.length}/${fields.length}`);
      res.json({ ok: true, scenario: text, skipped });
    } catch (e) {
      console.error('[scenario-block-fields]', e.message);
      serverError(res, e);
    }
  });

```

- [ ] **Step 5: Запусти тесты, убедись что проходят**

```bash
cd web && AI_MOCK=1 node --test tests/all.test.js 2>&1 | grep -A2 "scenario/block/fields"
```
Ожидаемый результат: все три теста `✔`.

- [ ] **Step 6: Commit**

```bash
git add web/routes/modules.js web/tests/all.test.js
git commit -m "feat: add PUT /scenario/block/fields batch-save endpoint"
```

---

## Task 4: Сервер — `POST /scenario/scene` + снятие метки при перегенерации «Финал»

**Files:**
- Modify: `web/routes/modules.js`
- Test: `web/tests/all.test.js`

- [ ] **Step 1: Напиши падающие тесты**

Добавь в `web/tests/all.test.js`, в `describe('Module write endpoints', ...)`, сразу после тестов из Task 3:

```js
    it('POST /scenario/scene — добавляет новую сцену перед «Финал», ставит метку', async () => {
      if (!modDir) return;
      const seed = [
        '# Сценарий — Тест', '', '---', '',
        '## Пролог', '', 'Завязка.', '',
        '---', '',
        '## Сцена 1', '', 'Первая сцена.', '',
        '---', '',
        '## Финал', '', 'Развязка.', '',
      ].join('\n');
      await apiJson(`/api/chronicles/${encodeURIComponent(chr)}/modules/${encodeURIComponent(mod)}/scenario${CITY}`,
        { method: 'PUT', body: JSON.stringify({ content: seed }) });

      const post = await apiJson(`/api/chronicles/${encodeURIComponent(chr)}/modules/${encodeURIComponent(mod)}/scenario/scene${CITY}`,
        { method: 'POST', body: JSON.stringify({}) });
      assert.equal(post.status, 200);
      assert.ok(post.body.ok);
      assert.equal(post.body.heading, 'Сцена 2');
      assert.match(post.body.scenario, /## Сцена 2\n/);
      // Новая сцена — перед «Финал», после «Сцена 1»
      assert.ok(post.body.scenario.indexOf('## Сцена 2') > post.body.scenario.indexOf('## Сцена 1'));
      assert.ok(post.body.scenario.indexOf('## Сцена 2') < post.body.scenario.indexOf('## Финал'));

      const raw = await fs.readFile(path.join(modDir, 'scenario.md'), 'utf-8');
      assert.match(raw, /<!--\s*meta:sceneAdded:\s*1\s*-->/i);
    });

    it('POST /scenario/scene — сценарий не найден → 404', async () => {
      const { status } = await apiJson(`/api/chronicles/__nochron__/modules/__nomod__/scenario/scene${CITY}`,
        { method: 'POST', body: JSON.stringify({}) });
      assert.equal(status, 404);
    });

    it('POST /scenario/block/regenerate — перегенерация «Финал» снимает метку sceneAdded (AI_MOCK)', async () => {
      if (!modDir) return;
      const seed = [
        '# Сценарий — Тест', '', '---', '',
        '## Сцена 1', '', 'Сцена.', '',
        '---', '',
        '## Финал', '', 'Развязка.', '',
      ].join('\n');
      await apiJson(`/api/chronicles/${encodeURIComponent(chr)}/modules/${encodeURIComponent(mod)}/scenario${CITY}`,
        { method: 'PUT', body: JSON.stringify({ content: seed }) });
      // Ставим метку через тот же add-scene эндпоинт
      await apiJson(`/api/chronicles/${encodeURIComponent(chr)}/modules/${encodeURIComponent(mod)}/scenario/scene${CITY}`,
        { method: 'POST', body: JSON.stringify({}) });
      const beforeRaw = await fs.readFile(path.join(modDir, 'scenario.md'), 'utf-8');
      assert.match(beforeRaw, /meta:sceneAdded/i);

      const regen = await apiJson(
        `/api/chronicles/${encodeURIComponent(chr)}/modules/${encodeURIComponent(mod)}/scenario/block/regenerate${CITY}`,
        { method: 'POST', body: JSON.stringify({ heading: 'Финал', pcs: [], npcs: [] }) });
      assert.equal(regen.status, 200);
      assert.doesNotMatch(regen.body.scenario, /meta:sceneAdded/i);

      const afterRaw = await fs.readFile(path.join(modDir, 'scenario.md'), 'utf-8');
      assert.doesNotMatch(afterRaw, /meta:sceneAdded/i);
    });
```

- [ ] **Step 2: Запусти тесты, убедись что падают**

```bash
cd web && AI_MOCK=1 node --test tests/all.test.js 2>&1 | grep -B1 -A8 "scenario/scene\|снимает метку"
```
Ожидаемый результат: первые два теста — `404` (роута нет); третий — метка остаётся (регенерация её пока не чистит).

- [ ] **Step 3: Добавь эндпоинт `POST /scenario/scene`**

Вставь сразу после эндпоинта `PUT /scenario/block/fields`, добавленного в Task 3 (перед комментарием `// ── Scenario, per-section: AI regeneration`):

```js
  // ── Scenario: add an empty manual scene before «Финал» (без ИИ) ────────────────
  router.post('/api/chronicles/:chr/modules/:mod/scenario/scene', express.json(), async (req, res) => {
    try {
      const city = reqCity(req);
      const { chr, mod } = req.params;
      if (chr.includes('..') || mod.includes('..'))
        return res.status(400).json({ ok: false, error: 'Недопустимое имя' });
      const title = String(req.body?.title || '').trim();

      const scenarioPath = path.join(chroniclesDir(city), chr, 'modules', mod, 'scenario.md');
      const raw = await fs.readFile(scenarioPath, 'utf-8').catch(() => null);
      if (raw == null) return res.status(404).json({ ok: false, error: 'Сценарий не найден' });

      const { text, heading } = insertScenarioScene(raw, title);
      await writeFileAtomic(scenarioPath, text, 'utf-8');
      invalidateChars(city);
      console.log(`[scenario-scene] ${city}/${chr}/${mod} → добавлена «${heading}»`);
      res.json({ ok: true, scenario: text, heading });
    } catch (e) {
      console.error('[scenario-scene]', e.message);
      serverError(res, e);
    }
  });

```

- [ ] **Step 4: Запусти первые два теста, убедись что проходят**

```bash
cd web && AI_MOCK=1 node --test tests/all.test.js 2>&1 | grep -A2 "добавляет новую сцену\|сценарий не найден"
```
Ожидаемый результат: `✔` для обоих.

- [ ] **Step 5: Правь `POST /scenario/block/regenerate`, чтобы снимать метку для «Финал»**

```bash
grep -n "const updated = serializeScenarioSections(preamble, newSections);" web/routes/modules.js
```
Ожидаемый вывод: одна строка внутри роута `scenario/block/regenerate`.

Замени эту строку и две следующие (запись файла) на:

```js
      let updated = serializeScenarioSections(preamble, newSections);
      if (/^Финал/i.test(heading) && hasManualSceneMarker(updated)) updated = clearManualSceneMarker(updated);
      await writeFileAtomic(scenarioPath, updated, 'utf-8');
```

(Было: `const updated = ...; await writeFileAtomic(scenarioPath, updated, 'utf-8');` — меняется `const` → `let` и добавляется условная строка между ними.)

- [ ] **Step 6: Запусти все тесты, убедись что проходят**

```bash
cd web && AI_MOCK=1 node --test tests/all.test.js 2>&1 | tail -15
```
Ожидаемый результат: `fail 0`, включая все новые тесты этого таска.

- [ ] **Step 7: Commit**

```bash
git add web/routes/modules.js web/tests/all.test.js
git commit -m "feat: add POST /scenario/scene endpoint, clear scene-added marker on finale regen"
```

---

## Task 5: Фронтенд — CSS для красной тени при наведении на блок (Feature 2)

Самая маленькая и независимая правка — делаем первой на фронтенде, чтобы сразу увидеть результат.

**Files:**
- Modify: `web/public/styles.css`

- [ ] **Step 1: Найди правило `.modp-scenario-block`**

```bash
grep -n "^\.modp-scenario-block {" web/public/styles.css
```

- [ ] **Step 2: Добавь transition и hover-тень**

Замени блок:
```css
.modp-scenario-block {
  background: var(--bg3);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 14px 16px;
  margin-bottom: 14px;
}
```
на:
```css
.modp-scenario-block {
  background: var(--bg3);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 14px 16px;
  margin-bottom: 14px;
  transition: border-color .2s var(--ease), box-shadow .2s var(--ease);
}
.modp-scenario-block:hover {
  border-color: var(--border2);
  box-shadow: 0 0 10px var(--glow);
}
```

- [ ] **Step 3: Проверь в браузере**

Следуй рецепту скилла `run-sanguine-web` (§1 restart, §2 headless Chrome, §3 skip onboarding tour). Открой любой модуль со сценарием, вкладка «Сценарий», наведи курсор на блок через `Runtime.evaluate`:

```js
const block = document.querySelector('.modp-scenario-block');
block.dispatchEvent(new MouseEvent('mouseover', {bubbles:true}));
getComputedStyle(block).boxShadow; // ожидается непустая тень, не "none"
```

- [ ] **Step 4: Commit**

```bash
git add web/public/styles.css
git commit -m "feat: add red hover shadow to scenario blocks"
```

---

## Task 6: Фронтенд — кнопка «Сохранить всё» на блоке (Feature 1)

**Files:**
- Modify: `web/public/scripts.js`
- Modify: `web/public/styles.css`

- [ ] **Step 1: Добавь кнопку в шаблон блока**

```bash
grep -n "data-blockregen=\"\${b.idx}\">🔄 Перегенерировать</button>" web/public/scripts.js
```

Замени:
```js
          <div class="modp-scenario-sec-btns">
            <button class="modp-edit-btn" data-editblock="${b.idx}">✏ Редактировать</button>
            <button class="modp-edit-btn" data-blockregen="${b.idx}">🔄 Перегенерировать</button>
          </div>
```
на:
```js
          <div class="modp-scenario-sec-btns">
            <button class="modp-edit-btn" data-editblock="${b.idx}">✏ Редактировать</button>
            <button class="modp-edit-btn modp-block-saveall-btn" data-blocksaveall="${b.idx}" style="display:none">💾 Сохранить всё</button>
            <button class="modp-edit-btn" data-blockregen="${b.idx}">🔄 Перегенерировать</button>
          </div>
```

- [ ] **Step 2: Покажи кнопку при входе в режим редактирования блока**

```bash
grep -n "const editBlockBtn = e.target.closest" web/public/scripts.js
```

Замени:
```js
  const editBlockBtn = e.target.closest('[data-editblock]');
  if (editBlockBtn) {
    const block = editBlockBtn.closest('.modp-scenario-block');
    const idxs  = (block?.dataset.fieldIdxs || '').split(',').filter(Boolean);
    idxs.forEach(idx => _modToggleEdit(`scensec${idx}`, true));
    return;
  }
```
на:
```js
  const editBlockBtn = e.target.closest('[data-editblock]');
  if (editBlockBtn) {
    const block = editBlockBtn.closest('.modp-scenario-block');
    const idxs  = (block?.dataset.fieldIdxs || '').split(',').filter(Boolean);
    idxs.forEach(idx => _modToggleEdit(`scensec${idx}`, true));
    const saveAllBtn = block?.querySelector('[data-blocksaveall]');
    if (saveAllBtn) saveAllBtn.style.display = '';
    return;
  }
```

- [ ] **Step 3: Скрывай кнопку, если все поля блока свёрнуты по отдельной «Отмена»**

```bash
grep -n "if (editModBtn)   { _modToggleEdit(editModBtn.dataset.editmod, true);      return; }" web/public/scripts.js
```
Это внутри `document.getElementById('modp-panel-scenario').addEventListener('click', ...)`. Замени три строки:
```js
  if (editModBtn)   { _modToggleEdit(editModBtn.dataset.editmod, true);      return; }
  if (cancelModBtn) { _modToggleEdit(cancelModBtn.dataset.cancelmod, false);  return; }
  if (saveModBtn)   { _modSavePanel(saveModBtn.dataset.savemod);              return; }
```
на:
```js
  if (editModBtn)   { _modToggleEdit(editModBtn.dataset.editmod, true);      return; }
  if (cancelModBtn) {
    _modToggleEdit(cancelModBtn.dataset.cancelmod, false);
    _modSyncBlockSaveAllVisibility(cancelModBtn.dataset.cancelmod);
    return;
  }
  if (saveModBtn)   { _modSavePanel(saveModBtn.dataset.savemod);              return; }
```

- [ ] **Step 4: Добавь хелпер `_modSyncBlockSaveAllVisibility` и обработчик клика по «Сохранить всё»**

```bash
grep -n "^function _modToggleEdit" web/public/scripts.js
```

Вставь новую функцию сразу ПЕРЕД `function _modToggleEdit`:

```js
// После отмены редактирования одного поля внутри блока проверяет, остались ли
// ещё открытые поля — если нет, прячет кнопку «Сохранить всё» этого блока
// (она включается только при входе в блок целиком, см. data-editblock).
function _modSyncBlockSaveAllVisibility(panel) {
  if (!panel || !panel.startsWith('scensec')) return;
  const viewEl = document.getElementById(`moddet-${panel}-view`);
  const block  = viewEl?.closest('.modp-scenario-block');
  if (!block) return;
  const saveAllBtn = block.querySelector('[data-blocksaveall]');
  if (!saveAllBtn) return;
  const anyEditing = Array.from(block.querySelectorAll('.modp-scenario-field [id$="-edit"]'))
    .some(ed => ed.style.display !== 'none');
  if (!anyEditing) saveAllBtn.style.display = 'none';
}
```

Добавь обработчик клика для `[data-blocksaveall]` — вставь его в `document.getElementById('modp-panel-scenario').addEventListener('click', ...)`, сразу после блока `blockRegenBtn` (перед закрывающей `});` этого addEventListener):

```bash
grep -n "^});" web/public/scripts.js | awk -F: '$1 > 3600 && $1 < 3800' | head -1
```
(это закрывающая скобка обработчика `modp-panel-scenario` — найди её визуально по контексту `blockRegenBtn` чуть выше).

```js
  const saveAllBtn = e.target.closest('[data-blocksaveall]');
  if (saveAllBtn) {
    const block = saveAllBtn.closest('.modp-scenario-block');
    const idxs  = (block?.dataset.fieldIdxs || '').split(',').filter(Boolean);
    const d     = STATE.currentModuleData;
    const chr   = d?.chronicle || STATE.currentModule?.chronicle;
    const mod   = d?.name      || STATE.currentModule?.name;
    if (!chr || !mod || !idxs.length) return;

    const fields = idxs.map(idx => {
      const info = (STATE.scenarioSectionHeadings || [])[parseInt(idx, 10)];
      const ta   = document.getElementById(`moddet-scensec${idx}-ta`);
      return info ? { heading: info.heading, parent: info.parent, content: ta ? ta.value : '' } : null;
    }).filter(Boolean);
    if (!fields.length) return;

    (async () => {
      saveAllBtn.disabled = true;
      const origLabel = saveAllBtn.textContent;
      saveAllBtn.textContent = '⏳ Сохраняю…';
      try {
        const r = await fetch(
          `/api/chronicles/${encodeURIComponent(chr)}/modules/${encodeURIComponent(mod)}/scenario/block/fields${window.location.search}`,
          { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fields }) }
        );
        const result = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(result.error || 'Ошибка сохранения');
        STATE.currentModuleData.scenario = result.scenario;
        _renderScenarioPanel(STATE.currentModuleData);
      } catch (err) {
        showToast('Не удалось сохранить блок: ' + err.message, 'error');
        saveAllBtn.disabled = false;
        saveAllBtn.textContent = origLabel;
      }
    })();
    return;
  }
```

- [ ] **Step 5: Добавь стиль кнопки (совпадает с прочими `.modp-edit-btn`, доп. стилей не требуется)**

```bash
grep -n "^\.modp-edit-btn {" web/public/styles.css
```
`.modp-block-saveall-btn` уже наследует `.modp-edit-btn` — новых CSS-правил не нужно (`display:none` задаётся inline при рендере/скрытии). Пропусти этот шаг, если базовый класс уже подключён — просто убедись, что кнопка получает класс `modp-edit-btn modp-block-saveall-btn` (сделано в Step 1).

- [ ] **Step 6: Проверь в браузере**

Рецепт `run-sanguine-web`. Открой модуль со сценарием → «Сценарий» → нажми «✏ Редактировать» на любом блоке → убедись что появилась «💾 Сохранить всё» → измени текст в 2 полях → нажми «Сохранить всё» → убедись, что оба поля сохранились одним запросом (Network: один `PUT .../scenario/block/fields`, не N штук `PUT .../scenario/section`) и `git diff` на `scenario.md` содержит оба изменения.

```js
(async()=>{
  navigate('modules');
  await new Promise(r=>setTimeout(r,700));
  document.querySelector('.module-card').click();
  await new Promise(r=>setTimeout(r,700));
  document.querySelector('[data-modtab="scenario"]')?.click();
  await new Promise(r=>setTimeout(r,500));
  const block = document.querySelector('.modp-scenario-block');
  block.querySelector('[data-editblock]').click();
  await new Promise(r=>setTimeout(r,200));
  const saveAllBtn = block.querySelector('[data-blocksaveall]');
  return { visible: saveAllBtn ? getComputedStyle(saveAllBtn).display !== 'none' : false };
})()
```

- [ ] **Step 7: Commit**

```bash
git add web/public/scripts.js
git commit -m "feat: add save-all button for scenario block edit mode"
```

---

## Task 7: Фронтенд — минимальный каркас сценария при создании модуля (Feature 3)

**Files:**
- Modify: `web/public/scripts.js`

- [ ] **Step 1: Найди пустое состояние вкладки «Сценарий»**

```bash
grep -n ": (raw ? mdToHtml(raw) : '<div class=\"cdet-empty\">Сценарий не сгенерирован" web/public/scripts.js
```

- [ ] **Step 2: Замени пустое состояние на сообщение + две кнопки**

Замени:
```js
    : (raw ? mdToHtml(raw) : '<div class="cdet-empty">Сценарий не сгенерирован. Нажми «🪄 Сгенерировать».</div>');
```
на:
```js
    : (raw ? mdToHtml(raw) : `
      <div class="cdet-empty">Сценарий не сгенерирован.</div>
      <div class="modp-scenario-empty-actions">
        <span class="cdet-empty">Нажми «🪄 Сгенерировать» вверху страницы для ИИ-генерации, или заполни каркас вручную:</span>
        <button class="modp-edit-btn" id="modp-scenario-manual-btn" style="margin-top:8px">📝 Создать вручную (пустой каркас)</button>
      </div>`);
```

- [ ] **Step 3: Добавь хелпер `_buildScenarioSkeleton`**

```bash
grep -n "^function _renderScenarioPanel" web/public/scripts.js
```
Вставь новую функцию сразу ПЕРЕД `function _renderScenarioPanel`:

```js
// Минимальный редактируемый каркас сценария (GM-справка / Пролог / Сцена 1 /
// Финал) — для ручного заполнения без ИИ-генерации. Формат/breadcrumb —
// как у AI-генерации (routes/modules.js POST .../fill), чтобы каркас потом
// парсился теми же блоками, что и сгенерированный сценарий.
function _buildScenarioSkeleton(title, modSlug) {
  return [
    `# Сценарий — ${title}`,
    '',
    `> 🔗 [Модуль](${modSlug}.md) | [Хроника](../../events.md) | [НПС](npc.md)`,
    '',
    '---',
    '',
    '## 🔒 GM-справка — закрытая информация',
    '> Читать перед игрой. Не раскрывать игроку напрямую.',
    '',
    '### Что произошло до начала сессии',
    '⚠️ Заполни.',
    '',
    '---',
    '',
    '## Пролог — Название',
    '### Описание для игрока',
    '⚠️ Заполни.',
    '',
    '### GM-подсказки',
    '⚠️ Заполни.',
    '',
    '---',
    '',
    '## Сцена 1 — Название',
    '### Описание для игрока',
    '⚠️ Заполни.',
    '',
    '### Колорит',
    '⚠️ 2-3 детали места/времени, которые нельзя перепутать с другим городом.',
    '',
    '---',
    '',
    '## Финал — Название',
    '### Описание для игрока',
    '⚠️ Заполни.',
    '',
  ].join('\n');
}
```

- [ ] **Step 4: Добавь обработчик клика**

```bash
grep -n "const manualBtn = e.target.closest" web/public/scripts.js
```
(должно быть пусто — обработчика ещё нет). Найди место для вставки:
```bash
grep -n "if (e.target.id === 'modp-toggle-gm-btn') {" web/public/scripts.js
```
Вставь новый блок сразу ПЕРЕД этим `if`, внутри того же `document.getElementById('modp-panel-scenario').addEventListener('click', e => { ... })`:

```js
  const manualBtn = e.target.closest('#modp-scenario-manual-btn');
  if (manualBtn) {
    const d   = STATE.currentModuleData;
    const chr = d?.chronicle || STATE.currentModule?.chronicle;
    const mod = d?.name      || STATE.currentModule?.name;
    if (!chr || !mod) return;
    (async () => {
      const ok = await showConfirm('Создать пустой каркас сценария (GM-справка / Пролог / Сцена 1 / Финал) для ручного заполнения?', { confirmText: 'Создать' });
      if (!ok) return;
      const skeleton = _buildScenarioSkeleton(d.title || d.name || mod, mod);
      try {
        const r = await fetch(
          `/api/chronicles/${encodeURIComponent(chr)}/modules/${encodeURIComponent(mod)}/scenario${window.location.search}`,
          { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: skeleton }) }
        );
        const result = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(result.error || 'Ошибка');
        STATE.currentModuleData.scenario = result.scenario;
        _renderScenarioPanel(STATE.currentModuleData);
      } catch (err) {
        showToast('Не удалось создать каркас: ' + err.message, 'error');
      }
    })();
    return;
  }

```

- [ ] **Step 5: Проверь в браузере**

Создай новый модуль без генерации сценария (через существующий флоу `+ Модуль`), открой его страницу → вкладка «Сценарий» → должно быть видно сообщение + кнопку «📝 Создать вручную» → нажми, подтверди → должны появиться 4 блока (GM-справка/Пролог/Сцена 1/Финал), каждый со своими полями и кнопками, как у сгенерированного сценария.

```js
(async()=>{
  navigate('modules');
  await new Promise(r=>setTimeout(r,700));
  document.getElementById('btn-create-module-standalone').click();
  await new Promise(r=>setTimeout(r,300));
  // ... заполнить форму создания (название + время обязательны), сабмит без вызова /fill
  // после создания — открыть модуль, вкладку «Сценарий», кликнуть #modp-scenario-manual-btn,
  // подтвердить showConfirm, проверить document.querySelectorAll('.modp-scenario-block').length === 4
})()
```

Удали тестовый модуль после проверки: `DELETE /api/chronicles/:chr/modules/:mod` (см. `run-sanguine-web` §6 про очистку тестовых данных).

- [ ] **Step 6: Commit**

```bash
git add web/public/scripts.js
git commit -m "feat: add manual scenario skeleton creation for modules without AI generation"
```

---

## Task 8: Фронтенд — кнопка «Добавить сцену» + предупреждение на блоке «Финал» (Feature 4)

**Files:**
- Modify: `web/public/scripts.js`
- Modify: `web/public/styles.css`

- [ ] **Step 1: Добавь кнопку «➕ Добавить сцену» в тулбар**

```bash
grep -n "modp-regen-scenario-btn" web/public/scripts.js | head -1
```
Замени:
```js
    ${raw ? `<button class="modp-edit-btn" id="modp-regen-scenario-btn" style="margin-left:8px">♻ Перегенерировать всё</button>` : ''}
```
на:
```js
    ${raw ? `<button class="modp-edit-btn" id="modp-regen-scenario-btn" style="margin-left:8px">♻ Перегенерировать всё</button>` : ''}
    ${raw ? `<button class="modp-edit-btn" id="modp-add-scene-btn" style="margin-left:8px">➕ Добавить сцену</button>` : ''}
```

- [ ] **Step 2: Добавь константу и надпись-предупреждение на блоке «Финал»**

```bash
grep -n "^const MODP_GM_SECTION_RE" web/public/scripts.js
```
Добавь сразу после этой строки:
```js
const MODP_SCENE_ADDED_RE = /<!--\s*meta:sceneAdded:\s*1\s*-->/i;
```

Затем найди рендер лейбла блока:
```bash
grep -n "const gmBadge = isGM ?" web/public/scripts.js
```
Замени:
```js
        const isGM = MODP_GM_SECTION_RE.test(b.heading);
        const gmAttr  = isGM ? ' data-gm="1"' : '';
        const gmBadge = isGM ? ' <span class="modp-gm-badge">🔒 Только для Мастера</span>' : '';
```
на:
```js
        const isGM = MODP_GM_SECTION_RE.test(b.heading);
        const gmAttr  = isGM ? ' data-gm="1"' : '';
        const gmBadge = isGM ? ' <span class="modp-gm-badge">🔒 Только для Мастера</span>' : '';
        const needsFinaleRegen = /^Финал/i.test(b.heading) && MODP_SCENE_ADDED_RE.test(raw);
        const finaleWarn = needsFinaleRegen
          ? ' <span class="modp-block-warn">⚠️ Сценарий был изменён. Сгенерировать новый финал?</span>' : '';
```

Найди строку с рендером `.modp-block-label` и добавь `finaleWarn`:
```bash
grep -n '<div class="modp-block-label">\${escHtml(b.heading)}\${gmBadge}</div>' web/public/scripts.js
```
Замени:
```js
          <div class="modp-block-label">${escHtml(b.heading)}${gmBadge}</div>
```
на:
```js
          <div class="modp-block-label">${escHtml(b.heading)}${gmBadge}${finaleWarn}</div>
```

- [ ] **Step 3: Добавь обработчик клика «Добавить сцену»**

```bash
grep -n "if (e.target.id === 'modp-regen-scenario-btn') {" web/public/scripts.js
```
Вставь новый блок сразу ПЕРЕД этим `if` (внутри того же `document.getElementById('modp-panel-scenario').addEventListener('click', e => { ... })`):

```js
  if (e.target.id === 'modp-add-scene-btn') {
    const d   = STATE.currentModuleData;
    const chr = d?.chronicle || STATE.currentModule?.chronicle;
    const mod = d?.name      || STATE.currentModule?.name;
    if (!chr || !mod) return;
    (async () => {
      try {
        const r = await fetch(
          `/api/chronicles/${encodeURIComponent(chr)}/modules/${encodeURIComponent(mod)}/scenario/scene${window.location.search}`,
          { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) }
        );
        const result = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(result.error || 'Ошибка');
        STATE.currentModuleData.scenario = result.scenario;
        _renderScenarioPanel(STATE.currentModuleData);
        showToast(`Добавлена «${result.heading}» — заполни поля и переименуй сцену через «Редактировать весь текст», если нужно`, 'success');
      } catch (err) {
        showToast('Не удалось добавить сцену: ' + err.message, 'error');
      }
    })();
    return;
  }

```

- [ ] **Step 4: Добавь CSS для `.modp-block-warn`**

```bash
grep -n "^\.modp-block-label {" web/public/styles.css
```
Вставь сразу после закрывающей `}` этого правила:
```css
.modp-block-warn {
  color: var(--c-danger-text);
  font-size: var(--fs-sm, 12px);
  font-weight: normal;
  text-transform: none;
  letter-spacing: normal;
  margin-left: 8px;
}
```

Также добавь стиль для `.modp-scenario-empty-actions` (из Task 7) сразу после `.modp-gm-badge` (или рядом — любое логичное место среди правил вкладки «Сценарий»):
```bash
grep -n "^\.modp-gm-badge {" web/public/styles.css
```
Вставь после блока `.modp-gm-badge { ... }`:
```css
.modp-scenario-empty-actions { display: flex; flex-direction: column; align-items: flex-start; }
```

- [ ] **Step 5: Проверь в браузере**

Рецепт `run-sanguine-web`. Открой модуль со сценарием, содержащим блок «Финал» → «Сценарий» → нажми «➕ Добавить сцену» → убедись, что появилась новая «Сцена N» перед «Финал», а в заголовке блока «Финал» появилась надпись «⚠️ Сценарий был изменён. Сгенерировать новый финал?». Нажми «🔄 Перегенерировать» на блоке «Финал», подтверди — после успешной перегенерации (реальный AI-вызов, НЕ через AI_MOCK в живом браузере — делай только если пользователь явно разрешил живой AI-вызов; иначе ограничься проверкой появления кнопки/надписи и отменой диалога) убедись, что надпись исчезла.

```js
(async()=>{
  navigate('modules');
  await new Promise(r=>setTimeout(r,700));
  document.querySelector('.module-card').click();
  await new Promise(r=>setTimeout(r,700));
  document.querySelector('[data-modtab="scenario"]')?.click();
  await new Promise(r=>setTimeout(r,500));
  const before = document.querySelectorAll('.modp-scenario-block').length;
  document.getElementById('modp-add-scene-btn')?.click();
  await new Promise(r=>setTimeout(r,600));
  const after = document.querySelectorAll('.modp-scenario-block').length;
  const warn = document.querySelector('.modp-block-warn');
  return { before, after, warnText: warn?.textContent };
})()
```

- [ ] **Step 6: Commit**

```bash
git add web/public/scripts.js web/public/styles.css
git commit -m "feat: add 'add scene' button and finale-regen warning banner"
```

---

## Task 9: Финальная проверка

- [ ] **Step 1: Полный прогон тестов**

```bash
cd web && AI_MOCK=1 npm test 2>&1 | tail -20
```
Ожидаемый результат: `fail 0`, счётчик `pass` вырос минимум на количество тестов, добавленных в Tasks 1–4 (11 новых: 3 в Task 1–2 + 3 в Task 3 + 3 в Task 4, плюс 2 из insertScenarioScene — сверь фактическое число по написанным `it(...)`).

- [ ] **Step 2: `git status` — чистое дерево**

```bash
cd f:/VTM/VTM-project-Claude && git status --short
```
Не должно быть посторонних файлов вне `web/lib/parsers.js`, `web/routes/modules.js`, `web/public/scripts.js`, `web/public/styles.css`, `web/tests/all.test.js` (плюс сам файл плана в `docs/superpowers/plans/`). Тестовые артефакты в `cities/paris/...` и `web/tests/report.html` — откатить через `git checkout --`.

- [ ] **Step 3: impeccable-аудит новых кусков CSS/HTML**

Per `CLAUDE.md`: после правок фронтенда прогнать `impeccable`, проверить touch-таргеты новых кнопок (`.modp-block-saveall-btn`, `#modp-add-scene-btn`) — они наследуют `.modp-edit-btn`, который уже входит в `@media (pointer: coarse) { ... min-height: 44px }` (добавлено в предыдущей сессии), доп. действий не требуется, но подтверди явно:

```bash
grep -n "modp-edit-btn" web/public/styles.css | grep -n "coarse\|44px"
```

- [ ] **Step 4: Ручная browser-проверка всех 4 фич подряд**

Следуй Step 5/6 из Task 5–8 последовательно на одном запущенном экземпляре headless Chrome (не пересоздавай профиль между шагами — экономит время), закрой браузер через `Browser.close` по завершении (см. `run-sanguine-web` §4).

---

## Самопроверка плана (сделана автором плана)

- **Покрытие фич**: (1) Save-all — Task 6; (2) hover-тень — Task 5; (3) каркас без ИИ — Task 7; (4) Add Scene + надпись на «Финал» — Task 8 (+ Task 2/4 бэкенд). Все 4 пункта из спеки покрыты.
- **Плейсхолдеры**: код во всех шагах — финальный, без `TODO`/«добавь обработку ошибок» — обработка ошибок везде явно расписана (`try/catch` + `showToast`).
- **Согласованность типов**: поле батч-сохранения называется `content` везде (клиент → `PUT /scenario/block/fields` → `replaceScenarioSections` внутри маппит на `r.body` только для внутреннего единообразия с `sections[idx].body` — API-контракт наружу везде `content`, как и у существующего `PUT /scenario/section`). `heading`/`parent` — везде одинаковые имена по всей цепочке клиент→сервер→parsers.
